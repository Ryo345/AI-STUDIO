import { enqueueScriptGeneration, getProjectRow, updateProjectRow } from "@studio/db";
import { ApiError, generateScriptSchema } from "@studio/domain";

import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/require-user";
import { parseJsonBody, parseOrThrow } from "@/lib/api/validate";
import { idParamSchema } from "../schema";

// POST /api/v1/projects/:id/generate { instructions? } — (re)generate the
// script. Same enqueue contract as POST /projects with autoGenerate:
//
//   1. enqueue (the partial unique index makes a second active job a 409)
//   2. only then flip the project to 'generating'
//
// so a 409 never strands a project in 'generating' with no job behind it
// (M2 carry-forward invariant). The model used is whatever the workspace's
// model router resolves for this job — task row → default row → env.
// Whether the output is mock is recorded in provenance/usage and badged by
// the UI; it is never silently substituted for a real provider.

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withApiHandler(
  async (request: Request, { params }: RouteContext): Promise<Response> => {
    const { user, supabase } = await requireUser();
    const { id } = parseOrThrow(idParamSchema, await params);
    const body = await parseJsonBody(request, generateScriptSchema);

    const project = await getProjectRow(supabase, id);
    if (!project) throw new ApiError("not_found", "project not found");
    if (project.status === "archived") {
      throw new ApiError("conflict", "archived projects cannot generate scripts");
    }

    const job = await enqueueScriptGeneration(supabase, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      createdBy: user.id,
      payload: { instructions: body.instructions ?? project.config.instructions ?? null },
    });

    const generating = await updateProjectRow(supabase, project.id, { status: "generating" });
    if (!generating) {
      throw new ApiError(
        "internal_error",
        "job enqueued, but the status flip to generating failed — the job will still run",
      );
    }

    return jsonOk({ project: generating, job }, { status: 202 });
  },
);
