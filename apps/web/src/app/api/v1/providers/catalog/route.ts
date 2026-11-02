import { getPrimaryWorkspaceId } from "@studio/db";
import { ApiError, ConnectionProviderIdSchema } from "@studio/domain";
import { testProviderConnection } from "@studio/providers";
import { z } from "zod";

import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/require-user";
import { parseJsonBody } from "@/lib/api/validate";

// POST /api/v1/providers/catalog { providerId, apiKey, baseUrl? } — the live
// model catalog for a provider, fetched with the key from the request body.
//
// Catalog policy (spec: "do not hard-code a permanent model catalog"): the
// provider's own /models listing is the only source of truth, fetched
// server-side per request. The key travels in the request body — same
// posture as the test endpoint: the web tier cannot decrypt stored
// envelopes, so catalogs are keyed to what the user is actively entering or
// has just saved (the settings UI re-sends the stored key's hint only for
// display, never the key itself).
//
// Used by the model-selection UI to populate provider/model dropdowns when
// adding a connection or changing a model assignment.

const catalogBodySchema = z.object({
  providerId: ConnectionProviderIdSchema,
  apiKey: z.string().trim().min(8).max(4096),
  baseUrl: z.url().max(500).optional(),
});

export const dynamic = "force-dynamic";

export const POST = withApiHandler(async (request: Request): Promise<Response> => {
  const { user, supabase } = await requireUser();
  const body = await parseJsonBody(request, catalogBodySchema);

  const workspaceId = await getPrimaryWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    throw new ApiError("forbidden", "no workspace membership found for this account");
  }

  const result = await testProviderConnection({
    providerId: body.providerId,
    apiKey: body.apiKey,
    baseUrl: body.baseUrl ?? null,
    timeoutMs: 15_000,
    signal: request.signal,
  });

  if (!result.ok) {
    // A catalog fetch that fails IS the connection test failing — surface
    // the same structured error the test endpoint would.
    throw new ApiError("provider_error", result.error?.message ?? "provider catalog unavailable", {
      code: result.error?.code ?? "provider_error",
    });
  }

  return jsonOk({ models: result.models });
});
