import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/require-user";
import { getScriptwriterProviderStatus } from "@/lib/providers";

// GET /api/v1/providers — which scriptwriter provider this deployment is
// pointed at, and whether it can serve a generation request right now.
// Readiness is account-holder information, so the guard is the same as
// everywhere else (401 without a session). The response carries booleans
// and, at most, the NAME of a missing env variable — never a secret value;
// the MOCK badge (isMock) must survive to every surface that renders it.

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async (request: Request): Promise<Response> => {
  await requireUser();

  return jsonOk({ providers: { scriptwriter: getScriptwriterProviderStatus() } });
});
