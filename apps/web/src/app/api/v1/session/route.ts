import { z } from "zod";

import { jsonOk, withApiHandler } from "@/lib/api/errors";
import { requireUser, requireWorkspaceRole } from "@/lib/api/require-user";
import { parseOrThrow, queryParams } from "@/lib/api/validate";

// GET /api/v1/session — the authenticated caller's identity, and (when a
// workspaceId is supplied) their role in it.
//
// This is the API tier pointed at auth: the caller is resolved from the
// Supabase session cookie and revalidated server-side by auth.getUser(),
// and every check below runs on the USER-SESSION client so RLS is the
// enforcement layer. The web tier never holds the service-role key.
//
//   GET /api/v1/session
//   GET /api/v1/session?workspaceId=<uuid>

const sessionQuerySchema = z.object({
  workspaceId: z.uuid().optional(),
});

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async (request: Request): Promise<Response> => {
  const { user, supabase } = await requireUser();

  const { workspaceId } = parseOrThrow(sessionQuerySchema, queryParams(request));

  const data: {
    user: { id: string; email: string | null };
    workspace?: { id: string };
  } = {
    user: { id: user.id, email: user.email ?? null },
  };

  if (workspaceId) {
    // Membership is checked through public.has_workspace_role() — a
    // SECURITY DEFINER helper granted to `authenticated` (0001). A
    // non-member gets 403 rather than an empty result, so the endpoint
    // never leaks whether a workspace exists to someone outside it.
    await requireWorkspaceRole(supabase, workspaceId);
    data.workspace = { id: workspaceId };
  }

  return jsonOk(data);
});
