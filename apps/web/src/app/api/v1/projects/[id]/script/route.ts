import { getProjectRow, getProjectScript } from "@studio/db";
import { ApiError } from "@studio/domain";

import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/require-user";
import { parseOrThrow } from "@/lib/api/validate";
import { idParamSchema } from "../schema";

// GET /api/v1/projects/:id/script — the current script version + its scenes.
//
// A project that has never generated (or is mid-generation) answers
// { version: null, scenes: [] } — one shape to branch on, never a 404 for
// "no script yet". A project outside the caller's reach is a 404: the
// project read resolves through RLS first, so existence is never leaked
// through the script surface.

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApiHandler(
  async (_request: Request, { params }: RouteContext): Promise<Response> => {
    const { user, supabase } = await requireUser();
    const { id } = parseOrThrow(idParamSchema, await params);

    const project = await getProjectRow(supabase, id);
    if (!project) throw new ApiError("not_found", "project not found");

    const script = await getProjectScript(supabase, id);
    return jsonOk(script);
  },
);
