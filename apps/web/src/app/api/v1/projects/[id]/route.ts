import {
  deleteProjectRow,
  getProjectRow,
  hasActiveJob,
  listActiveJobsByProject,
  updateProjectRow,
  type ProjectPatch,
} from "@studio/db";
import { ApiError, ProjectConfigSchema, updateProjectSchema } from "@studio/domain";
import {
  durationBandFor,
  isDurationInBand,
  resolveNiche,
  type NicheTemplate,
} from "@studio/niches";
import { z } from "zod";

import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/require-user";
import { parseJsonBody, parseOrThrow } from "@/lib/api/validate";

// GET / PATCH / DELETE /api/v1/projects/[id].
//
// RLS is the enforcement layer: the id is resolved through the caller's own
// session client, so a foreign or deleted project reads back as null. Both
// cases answer 404 on purpose — the route never reveals that a project
// exists outside the caller's reach. The role gates (update = editor,
// delete = owner) live in the RLS policies per operation; a denied write
// surfaces as null/false and gets the same 404, with no distinction made.
//
//   GET    /api/v1/projects/:id
//   PATCH  /api/v1/projects/:id   { title?, topic?, niche?, config?, status? }
//   DELETE /api/v1/projects/:id

// Path params arrive as text: a malformed id is a 400 about the request
// shape before any database round-trip, and the value is never echoed back.
const idParamSchema = z.object({ id: z.uuid() });

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApiHandler(
  async (request: Request, { params }: RouteContext): Promise<Response> => {
    const { user, supabase } = await requireUser();
    const { id } = parseOrThrow(idParamSchema, await params);

    const project = await getProjectRow(supabase, id);
    if (!project) throw new ApiError("not_found", "project not found");

    const activeJobs =
      (await listActiveJobsByProject(supabase, [project.id])).get(project.id) ?? [];

    return jsonOk({ project, activeJobs });
  },
);

export const PATCH = withApiHandler(
  async (request: Request, { params }: RouteContext): Promise<Response> => {
    const { user, supabase } = await requireUser();
    const { id } = parseOrThrow(idParamSchema, await params);
    const body = await parseJsonBody(request, updateProjectSchema);

    const existing = await getProjectRow(supabase, id);
    if (!existing) throw new ApiError("not_found", "project not found");

    // A config patch is sparse: merge it over the stored config and validate
    // the WHOLE thing, because the jsonb column only ever holds complete
    // ProjectConfigs — a partial write would poison every later read.
    const mergedConfig =
      body.config !== undefined
        ? parseOrThrow(ProjectConfigSchema, { ...existing.config, ...body.config })
        : undefined;

    // Re-check the duration band only when the (niche, aspect, duration)
    // triple could have moved: a title-only patch must not start failing
    // because of band data it never touched.
    if (body.niche !== undefined || body.config !== undefined) {
      const effectiveNiche = body.niche ?? existing.niche;
      const effectiveConfig = mergedConfig ?? existing.config;
      let template: NicheTemplate;
      try {
        template = resolveNiche(effectiveNiche);
      } catch {
        throw new ApiError("validation_error", "unknown niche");
      }
      if (
        !isDurationInBand(template, effectiveConfig.aspectRatio, effectiveConfig.targetDurationSeconds)
      ) {
        const band = durationBandFor(template, effectiveConfig.aspectRatio);
        throw new ApiError(
          "validation_error",
          `targetDurationSeconds must be between ${band.minSeconds} and ${band.maxSeconds} seconds for this niche at ${effectiveConfig.aspectRatio}`,
        );
      }
    }

    // Only defined keys reach the patch: in ProjectPatch an absent key means
    // "leave the column alone", not "set null". status is limited to
    // draft/archived by the schema — generating/ready/editing transitions
    // are worker-owned and stay behind the RPCs.
    const patch: ProjectPatch = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.topic !== undefined) patch.topic = body.topic;
    if (body.niche !== undefined) patch.nicheKey = body.niche;
    if (mergedConfig !== undefined) patch.config = mergedConfig;
    if (body.status !== undefined) patch.status = body.status;

    const updated = await updateProjectRow(supabase, id, patch);
    if (!updated) {
      // RLS hid the row from the UPDATE: a viewer (read-only) called, or the
      // project was deleted concurrently. Same 404 as the read — no
      // distinction, no leak.
      throw new ApiError("not_found", "project not found");
    }

    return jsonOk({ project: updated });
  },
);

export const DELETE = withApiHandler(
  async (request: Request, { params }: RouteContext): Promise<Response> => {
    const { user, supabase } = await requireUser();
    const { id } = parseOrThrow(idParamSchema, await params);

    // A project must not disappear under a job in flight — the worker would
    // complete into a void. 409 tells the client to cancel first.
    if (await hasActiveJob(supabase, id)) {
      throw new ApiError("conflict", "project has an active job — cancel it before deleting");
    }

    const deleted = await deleteProjectRow(supabase, id);
    if (!deleted) throw new ApiError("not_found", "project not found");

    // 204 carries no body — not even the success envelope.
    return new Response(null, { status: 204 });
  },
);
