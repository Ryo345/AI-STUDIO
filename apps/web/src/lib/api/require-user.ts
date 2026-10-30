import { ApiError, type WorkspaceRole } from "@studio/domain";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";

// Auth guard for every /api/v1 route that touches user data.
//
// The API tier is "pointed at auth" in the strict sense: the caller's
// identity comes from the Supabase session cookie, verified server-side by
// auth.getUser() (which revalidates the JWT against the auth server —
// reading the cookie alone would trust a client-supplied value), and every
// subsequent query runs on the USER-SESSION client. RLS scopes those
// queries to that user's workspaces; the web tier never holds the
// service-role key (the service tier lives behind '@studio/db/server',
// which the web app must not import — see packages/db/src/__tests__/
// server-subpath.guard.test.ts).
//
// /api/* is excluded from the page middleware's matcher on purpose, so
// every handler must call this guard itself. No exceptions.

export interface AuthedContext {
  user: User;
  /** The caller's own session client — pass it to @studio/db query helpers. */
  supabase: SupabaseClient;
}

/**
 * Resolves the authenticated caller or throws 401.
 *
 * The returned client is RLS-scoped to `user`; it is NOT a service client.
 */
export async function requireUser(): Promise<AuthedContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ApiError("unauthorized", "authentication required");
  }

  return { user, supabase };
}

/**
 * Asserts the caller holds at least `minRole` in the workspace.
 *
 * Uses public.has_workspace_role(), a SECURITY DEFINER helper granted to
 * `authenticated` (0001) — the membership check cannot recurse through
 * RLS, and the caller's own JWT identifies them inside it. Returns 403
 * when the caller is authenticated but not a member.
 */
export async function requireWorkspaceRole(
  supabase: SupabaseClient,
  workspaceId: string,
  minRole: WorkspaceRole = "viewer",
): Promise<void> {
  const { data, error } = await supabase.rpc("has_workspace_role", {
    p_workspace_id: workspaceId,
    p_min_role: minRole,
  });

  if (error) {
    // A failed membership check must never read as "allowed".
    console.error("[api] has_workspace_role failed:", error.message);
    throw new ApiError("internal_error", "membership check failed");
  }

  if (data !== true) {
    throw new ApiError("forbidden", "you do not have access to this workspace");
  }
}
