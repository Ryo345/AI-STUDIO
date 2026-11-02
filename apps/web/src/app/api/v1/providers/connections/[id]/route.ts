import {
  deleteProviderConnection,
  getPrimaryWorkspaceId,
  getProviderConnection,
  updateProviderCredential,
} from "@studio/db";
import { ApiError, updateProviderConnectionSchema } from "@studio/domain";
import { encryptSecret, loadCredentialEncryptionKey, maskSecret } from "@studio/providers";
import { z } from "zod";

import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/require-user";
import { parseJsonBody, parseOrThrow } from "@/lib/api/validate";

//   PATCH  /api/v1/providers/connections/:id   { apiKey } — replace the key
//   DELETE /api/v1/providers/connections/:id
//
// The id is always scoped by the caller's workspace id (resolved server-side
// from membership), so a guessed foreign id reads as not_found — the same
// no-leak posture as the projects routes. Role gates live in RLS
// (update = editor, delete = owner); a denied write/delete surfaces as the
// same 404, with no distinction made.

const idParamSchema = z.object({ id: z.uuid() });

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withApiHandler(
  async (request: Request, { params }: RouteContext): Promise<Response> => {
    const { user, supabase } = await requireUser();
    const { id } = parseOrThrow(idParamSchema, await params);
    const body = await parseJsonBody(request, updateProviderConnectionSchema);

    const workspaceId = await workspaceIdOrThrow(supabase, user.id);

    const existing = await getProviderConnection(supabase, workspaceId, id);
    if (!existing) throw new ApiError("not_found", "connection not found");

    const key = loadCredentialEncryptionKey(process.env);
    const connection = await updateProviderCredential(supabase, {
      workspaceId,
      connectionId: id,
      credential: encryptSecret(body.apiKey, key),
      keyHint: maskSecret(body.apiKey),
    });

    return jsonOk({ connection });
  },
);

export const DELETE = withApiHandler(
  async (request: Request, { params }: RouteContext): Promise<Response> => {
    const { user, supabase } = await requireUser();
    const { id } = parseOrThrow(idParamSchema, await params);

    const workspaceId = await workspaceIdOrThrow(supabase, user.id);

    await deleteProviderConnection(supabase, workspaceId, id);
    // 204 — deletion carries no body, matching the projects DELETE route.
    return new Response(null, { status: 204 });
  },
);

async function workspaceIdOrThrow(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
): Promise<string> {
  const workspaceId = await getPrimaryWorkspaceId(supabase, userId);
  if (!workspaceId) {
    throw new ApiError("forbidden", "no workspace membership found for this account");
  }
  return workspaceId;
}
