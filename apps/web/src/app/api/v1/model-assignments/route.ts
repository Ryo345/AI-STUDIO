import {
  deleteModelAssignment,
  getPrimaryWorkspaceId,
  listModelAssignments,
  upsertModelAssignment,
} from "@studio/db";
import { ApiError, upsertModelAssignmentSchema } from "@studio/domain";
import { z } from "zod";

import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/require-user";
import { parseJsonBody, parseOrThrow, queryParams } from "@/lib/api/validate";

// The model router's read/write surface:
//
//   GET    /api/v1/model-assignments — every (workspace, task) row
//   PUT    /api/v1/model-assignments { task, providerId, model, settings? }
//   DELETE /api/v1/model-assignments?task=script.generate
//
// task='default' rows are the workspace-wide fallback; task-specific rows
// override them. The worker resolves per job: task row → default row → env.
// Uniqueness is (workspace_id, task) in the DB — PUT is a true upsert.

const deleteQuerySchema = z.object({
  task: z.enum([
    "default",
    "script.generate",
    "script.rewrite",
    "research.assist",
    "fact.check",
    "scene.describe",
    "video.title",
    "video.description",
    "seo.metadata",
    "script.quality",
  ]),
});

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async (request: Request): Promise<Response> => {
  const { user, supabase } = await requireUser();

  const workspaceId = await getPrimaryWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return jsonOk({ assignments: [] });
  }

  const assignments = await listModelAssignments(supabase, workspaceId);
  return jsonOk({ assignments });
});

export const PUT = withApiHandler(async (request: Request): Promise<Response> => {
  const { user, supabase } = await requireUser();
  const body = await parseJsonBody(request, upsertModelAssignmentSchema);

  const workspaceId = await getPrimaryWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    throw new ApiError("forbidden", "no workspace membership found for this account");
  }

  const assignment = await upsertModelAssignment(supabase, {
    workspaceId,
    task: body.task,
    providerId: body.providerId,
    model: body.model,
    settings: body.settings,
  });

  return jsonOk({ assignment });
});

export const DELETE = withApiHandler(async (request: Request): Promise<Response> => {
  const { user, supabase } = await requireUser();
  const query = parseOrThrow(deleteQuerySchema, queryParams(request));

  const workspaceId = await getPrimaryWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    throw new ApiError("forbidden", "no workspace membership found for this account");
  }

  await deleteModelAssignment(supabase, workspaceId, query.task);
  return new Response(null, { status: 204 });
});
