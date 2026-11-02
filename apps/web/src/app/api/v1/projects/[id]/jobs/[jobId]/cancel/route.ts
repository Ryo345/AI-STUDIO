import { getJobRow, requestJobCancel } from "@studio/db";
import { ApiError } from "@studio/domain";
import { z } from "zod";

import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/require-user";
import { parseOrThrow } from "@/lib/api/validate";

// POST /api/v1/projects/:id/jobs/:jobId/cancel — request cancellation of an
// active job. Cooperative by design (0003): the flag is observed by the
// worker's heartbeat loop, which aborts the provider call and settles the
// job as 'cancelled'. Terminal jobs answer 409 — a cancel request that can
// never be observed must not pretend it was queued.

const paramsSchema = z.object({ id: z.uuid(), jobId: z.uuid() });

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; jobId: string }> };

export const POST = withApiHandler(
  async (request: Request, { params }: RouteContext): Promise<Response> => {
    const { supabase } = await requireUser();
    const { id, jobId } = parseOrThrow(paramsSchema, await params);

    // RLS-scoped read: a foreign job reads as not_found, same no-leak
    // posture as every other id-bearing route.
    const job = await getJobRow(supabase, jobId);
    if (!job || job.projectId !== id) {
      throw new ApiError("not_found", "job not found");
    }
    if (["succeeded", "failed", "cancelled"].includes(job.status)) {
      throw new ApiError("conflict", `job already finished as '${job.status}'`);
    }

    const cancelled = await requestJobCancel(supabase, jobId);
    return jsonOk({ job: cancelled });
  },
);
