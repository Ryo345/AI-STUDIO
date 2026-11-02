import {
  getPrimaryWorkspaceId,
  getProviderConnection,
  setConnectionTestOutcome,
} from "@studio/db";
import { ApiError, connectionTestResultSchema } from "@studio/domain";
import { testProviderConnection } from "@studio/providers";
import { z } from "zod";

import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/require-user";
import { parseJsonBody, parseOrThrow } from "@/lib/api/validate";

// POST /api/v1/providers/connections/:id/test { apiKey } — probe a key
// against its provider and persist the outcome (status + diagnostics).
//
// The key under test travels in the REQUEST body, not from storage: the web
// tier holds no service key and cannot decrypt the stored envelope (0006
// column grants + the '@studio/db/server' guard test keep it that way) —
// only the worker ever decrypts. This makes the endpoint a pre-save
// validator too: the UI tests a newly entered key, and only a passing key
// is worth PATCHing into the connection. The provider-specific handshake
// (NIM/OpenAI: GET /models; Anthropic: GET /v1/models) lives in
// @studio/providers testProviderConnection — errors come back structured,
// never as raw provider bodies.

const idParamSchema = z.object({ id: z.uuid() });

const testBodySchema = z.object({
  apiKey: z.string().trim().min(8).max(4096),
});

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withApiHandler(
  async (request: Request, { params }: RouteContext): Promise<Response> => {
    const { user, supabase } = await requireUser();
    const { id } = parseOrThrow(idParamSchema, await params);
    const body = await parseJsonBody(request, testBodySchema);

    const workspaceId = await getPrimaryWorkspaceId(supabase, user.id);
    if (!workspaceId) {
      throw new ApiError("forbidden", "no workspace membership found for this account");
    }

    const connection = await getProviderConnection(supabase, workspaceId, id);
    if (!connection) throw new ApiError("not_found", "connection not found");

    const result = await testProviderConnection({
      providerId: connection.providerId,
      apiKey: body.apiKey,
      baseUrl: connection.baseUrl,
      timeoutMs: 15_000,
      signal: request.signal,
    });

    const testedAt = new Date().toISOString();
    const persisted = await setConnectionTestOutcome(supabase, {
      workspaceId,
      connectionId: id,
      ok: result.ok,
      testedAt,
      error: result.error ?? null,
    });

    return jsonOk({
      test: connectionTestResultSchema.parse({
        ok: result.ok,
        status: result.ok ? "active" : "failed",
        testedAt,
        error: result.error ?? null,
      }),
      models: result.models,
      connection: persisted,
    });
  },
);
