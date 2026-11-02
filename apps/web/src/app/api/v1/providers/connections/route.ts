import {
  getPrimaryWorkspaceId,
  insertProviderConnection,
  listProviderConnections,
} from "@studio/db";
import {
  ApiError,
  createProviderConnectionSchema,
  type ProviderConnectionDTO,
} from "@studio/domain";
import {
  encryptSecret,
  loadCredentialEncryptionKey,
  maskSecret,
} from "@studio/providers";

import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/require-user";
import { parseJsonBody } from "@/lib/api/validate";

// BYOK provider connections — GET (masked list) / POST (add a key).
//
// The plaintext key exists in exactly three places, all server-side, all
// momentary: the request body (zod-validated, never logged), the encrypt
// call frame, and the AES-256-GCM envelope it becomes. The DB stores only
// the envelope + a masked hint; the API returns only masked metadata; the
// column-level grant in 0006 makes the ciphertext unreadable to user
// sessions even if a future query forgets the column list.

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async (request: Request): Promise<Response> => {
  const { user, supabase } = await requireUser();

  const workspaceId = await getPrimaryWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return jsonOk({ connections: [] satisfies ProviderConnectionDTO[] });
  }

  const connections = await listProviderConnections(supabase, workspaceId);
  return jsonOk({ connections });
});

export const POST = withApiHandler(async (request: Request): Promise<Response> => {
  const { user, supabase } = await requireUser();
  const body = await parseJsonBody(request, createProviderConnectionSchema);

  const workspaceId = await getPrimaryWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    throw new ApiError("forbidden", "no workspace membership found for this account");
  }

  // Fail fast BEFORE writing anything if the KEK is missing — a connection
  // row with an undecryptable future is worse than a clean 500 now.
  const key = loadCredentialEncryptionKey(process.env);
  const connection = await insertProviderConnection(supabase, {
    workspaceId,
    createdBy: user.id,
    providerId: body.providerId,
    baseUrl: body.baseUrl?.trim() || null,
    credential: encryptSecret(body.apiKey, key),
    keyHint: maskSecret(body.apiKey),
  });

  return jsonOk({ connection }, { status: 201 });
});
