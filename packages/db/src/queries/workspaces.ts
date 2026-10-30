import type { StudioDbClient } from '../clients.js';

// Workspace resolution for the API tier. Phase 1 gives every user exactly
// one workspace (created by the handle_new_user trigger), so "which
// workspace does this caller mean" is answered server-side from their
// membership rows — never from a client-supplied id, which would let a
// request address a workspace it does not belong to (RLS would still catch
// it, but the error shape belongs at this layer).

/**
 * The caller's primary workspace id, or null when they hold no membership.
 * Runs on the USER-SESSION client: workspace_members is SELECT-only for
 * authenticated (0005) and the RLS policy exposes the caller's own rows.
 */
export async function getPrimaryWorkspaceId(
  client: StudioDbClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .limit(1);

  if (error) throw new Error(`getPrimaryWorkspaceId failed: ${error.message}`);
  const row = (data ?? [])[0] as { workspace_id?: unknown } | undefined;
  return typeof row?.workspace_id === 'string' ? row.workspace_id : null;
}
