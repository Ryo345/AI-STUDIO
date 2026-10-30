import {
  createProjectRow,
  deleteProjectRow,
  enqueueScriptGeneration,
  getPrimaryWorkspaceId,
  listActiveJobsByProject,
  listProjects,
  updateProjectRow,
} from "@studio/db";
import { ApiError, createProjectSchema, ProjectStatusSchema, type JobDTO } from "@studio/domain";
import {
  durationBandFor,
  isDurationInBand,
  resolveNiche,
  type NicheTemplate,
} from "@studio/niches";
import { z } from "zod";

import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/require-user";
import { parseJsonBody, parseOrThrow, queryParams } from "@/lib/api/validate";

// POST /api/v1/projects — create a project and (by default) enqueue its
// first script generation. GET /api/v1/projects — the caller's projects,
// newest first, each annotated with its in-flight job (dashboard grid).
//
// The workspace is never taken from the request: Phase 1 gives every user
// exactly one workspace, resolved server-side from their membership rows.
// A caller with no membership gets 403 — there is nothing to create into
// or list, and a client-supplied workspace id would only invite a
// smuggling attempt that RLS would then have to catch anyway.
//
//   POST /api/v1/projects            { niche, topic, title?, config, autoGenerate? }
//   GET  /api/v1/projects?limit=20&offset=0&status=draft

// List query — limit/offset arrive as text and are coerced; the bounds keep
// a single page from pulling the whole table. Never echo a bad value back:
// the envelope lists failed paths only (parseOrThrow).
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: ProjectStatusSchema.optional(),
});

export const dynamic = "force-dynamic";

/**
 * Grid-card title derived from the topic when the caller did not name the
 * project: cut at 60 chars, then back to the last word boundary so a
 * derived title never ends mid-word. A caller-supplied title is already
 * bounded at 120 by the schema — the shorter cap is for derived text,
 * which the dashboard renders without further truncation.
 */
function derivedTitle(topic: string): string {
  if (topic.length <= 60) return topic;
  const cut = topic.slice(0, 60);
  const boundary = cut.lastIndexOf(" ");
  return boundary > 0 ? cut.slice(0, boundary) : cut;
}

export const POST = withApiHandler(async (request: Request): Promise<Response> => {
  const { user, supabase } = await requireUser();

  const body = await parseJsonBody(request, createProjectSchema);

  // createProjectSchema already constrains niche to the registered keys, so
  // this catch is defense-in-depth: the registry (not the schema) is the
  // authority on what is creatable, and if the two ever drift the failure
  // must be a clean 400 — never a 500 leaking template internals.
  let template: NicheTemplate;
  try {
    template = resolveNiche(body.niche);
  } catch {
    throw new ApiError("validation_error", "unknown niche");
  }

  // The global 10..3600 bounds were checked by the schema; the niche's
  // per-aspect band is template data and can only be checked here. The
  // range in the message comes from the template itself, never from the
  // submitted value.
  if (!isDurationInBand(template, body.config.aspectRatio, body.config.targetDurationSeconds)) {
    const band = durationBandFor(template, body.config.aspectRatio);
    throw new ApiError(
      "validation_error",
      `targetDurationSeconds must be between ${band.minSeconds} and ${band.maxSeconds} seconds for this niche at ${body.config.aspectRatio}`,
    );
  }

  const workspaceId = await getPrimaryWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    throw new ApiError("forbidden", "no workspace membership found for this account");
  }

  let project = await createProjectRow(supabase, {
    workspaceId,
    createdBy: user.id,
    title: body.title ?? derivedTitle(body.topic),
    nicheKey: body.niche,
    topic: body.topic,
    config: body.config,
  });

  let job: JobDTO | null = null;
  if (body.autoGenerate) {
    try {
      job = await enqueueScriptGeneration(supabase, {
        workspaceId,
        projectId: project.id,
        createdBy: user.id,
        payload: { instructions: body.config.instructions },
      });
    } catch (error) {
      // Roll the fresh project back so a failed enqueue never strands an
      // orphaned draft — safe because the row is brand new and childless.
      // The delete's own failure must never mask the enqueue error the
      // client is about to see, and a `false` return (RLS lets only owners
      // delete — a future invited editor would be denied) must not pass
      // silently: either way the ORIGINAL error is what gets rethrown.
      try {
        const deleted = await deleteProjectRow(supabase, project.id);
        if (!deleted) {
          console.error("[api] rollback delete denied for", project.id);
        }
      } catch (rollbackError) {
        console.error("[api] rollback delete failed for", project.id, rollbackError);
      }
      throw error;
    }

    // Carry-forward invariant (M2 architecture review): the status flip
    // happens strictly AFTER a successful enqueue, so a 409 from a double
    // enqueue leaves the project in draft — never stranded in "generating"
    // with no job behind it. The flipped row is what the client receives.
    const generating = await updateProjectRow(supabase, project.id, { status: "generating" });
    if (!generating) {
      throw new ApiError(
        "internal_error",
        "project created and queued, but its status flip to generating failed",
      );
    }
    project = generating;
  }

  return jsonOk({ project, job }, { status: 201 });
});

export const GET = withApiHandler(async (request: Request): Promise<Response> => {
  const { user, supabase } = await requireUser();

  const query = parseOrThrow(listQuerySchema, queryParams(request));

  const workspaceId = await getPrimaryWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    throw new ApiError("forbidden", "no workspace membership found for this account");
  }

  const projects = await listProjects(supabase, workspaceId, query);

  // One batched query for the whole page: every grid card shows whether
  // work is in flight, and the newest active job (listActiveJobsByProject
  // returns ascending order, so the first) is the one worth surfacing.
  const activeJobs = await listActiveJobsByProject(
    supabase,
    projects.map((project) => project.id),
  );

  return jsonOk({
    projects: projects.map((project) => ({
      ...project,
      activeJob: activeJobs.get(project.id)?.[0] ?? null,
    })),
  });
});
