import { getProjectRow, listScenes, patchSceneRow } from "@studio/db";
import { ApiError, patchSceneSchema } from "@studio/domain";
import { z } from "zod";

import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/require-user";
import { parseJsonBody, parseOrThrow } from "@/lib/api/validate";
import { idParamSchema } from "../../schema";

// PATCH /api/v1/projects/:id/scenes/:sceneId — edit one scene of the current
// storyboard (narration / visual description / on-screen text / duration).
//
// RLS governs the write itself; the extra lookup is ownership inside the
// workspace: a scene id from a *different* project must read as 404, not
// as a cross-project write the URL shape implies is allowed. Scenes are
// capped at 40 per script, so listing them to find the match is cheap.

const sceneIdParamSchema = z.object({ id: z.uuid(), sceneId: z.uuid() });

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; sceneId: string }> };

export const PATCH = withApiHandler(
  async (request: Request, { params }: RouteContext): Promise<Response> => {
    const { user, supabase } = await requireUser();
    const { id, sceneId } = parseOrThrow(sceneIdParamSchema, await params);
    const patch = await parseJsonBody(request, patchSceneSchema);

    const project = await getProjectRow(supabase, id);
    if (!project) throw new ApiError("not_found", "project not found");

    const scene = (await listScenes(supabase, id)).find((candidate) => candidate.id === sceneId);
    if (!scene) throw new ApiError("not_found", "scene not found");

    const updated = await patchSceneRow(supabase, sceneId, patch);
    if (!updated) {
      // Deleted concurrently (a regenerate rewrote the storyboard) between
      // the lookup and the write — same 404 the read would have given.
      throw new ApiError("not_found", "scene not found");
    }

    return jsonOk({ scene: updated });
  },
);
