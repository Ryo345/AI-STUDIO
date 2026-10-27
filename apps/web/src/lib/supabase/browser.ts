import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublicAppConfig } from "@/lib/config";

// Browser client for client components ("use client"). Born from the anon key
// — public by design, with RLS enforcing every request server-side.
//
// One instance per tab: supabase-js keeps its own session state and a second
// client would desynchronize auth listeners later on (job polling, M5).
let cachedClient: SupabaseClient | undefined;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const { supabaseUrl, supabaseAnonKey } = getPublicAppConfig();
  cachedClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return cachedClient;
}
