import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getPublicAppConfig } from "@/lib/config";

export interface SessionUpdate {
  response: NextResponse;
  user: User | null;
}

// Session refresh for the middleware entry (src/middleware.ts). Exchanges
// expired tokens by writing refreshed cookies into both the request (so this
// same request sees them) and the response (so the browser persists them).
export async function updateSession(request: NextRequest): Promise<SessionUpdate> {
  const { supabaseUrl, supabaseAnonKey } = getPublicAppConfig();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      // Same explicit annotation as lib/supabase/server.ts — the union-typed
      // `cookies` option defeats parameter inference in strict mode.
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() revalidates the JWT against the auth server — the cookie alone
  // is never trusted for an access decision. Any auth error means "treat as
  // anonymous"; the page-guard acts on that, nothing crashes.
  const { data, error } = await supabase.auth.getUser();

  return { response, user: error ? null : data.user };
}
