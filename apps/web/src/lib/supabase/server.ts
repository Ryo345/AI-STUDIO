import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicAppConfig } from "@/lib/config";

// User-session client for server components and route handlers. Every query
// flows through RLS with the caller's JWT — this file (and the whole web
// tier) never touches the service-role key. docs/architecture.md: "the user
// session is the live enforcement layer on the web tier".
export async function createSupabaseServerClient() {
  const { supabaseUrl, supabaseAnonKey } = getPublicAppConfig();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      // Explicit parameter type — createServerClient types `cookies` as a
      // union whose setAll is optional, so contextual inference leaves the
      // bare parameter as implicit any under strict mode.
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Cookie writes throw from inside read-only Server Components.
          // Swallowing here is safe by design: middleware refreshes the
          // session on every request, so a failed write never strands the
          // user with stale tokens.
        }
      },
    },
  });
}
