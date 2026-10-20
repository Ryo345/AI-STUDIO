import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { DbConfig } from './config.js';

// Client discipline:
//   * The WEB app authenticates per-request users with @supabase/ssr cookie
//     sessions (apps/web/src/lib/supabase/*) and passes that client here —
//     RLS is the live enforcement layer for everything those calls touch.
//   * The WORKER uses createServiceClient — the service key bypasses RLS
//     and is only ever exercised through the SECURITY DEFINER RPCs
//     (claim_jobs, heartbeat_job, complete_script_generation, …), never
//     raw table writes against user data.
//   * The service key is never referenced outside server processes; the
//     browser bundle only ever sees the anon key.

/** Any Supabase client — user-session (RLS-enforced) or service (worker). */
export type StudioDbClient = SupabaseClient;

export function createServiceClient(cfg: DbConfig): StudioDbClient {
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
