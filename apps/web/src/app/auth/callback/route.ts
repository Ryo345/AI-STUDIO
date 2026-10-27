import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { sanitizeNextPath } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// PKCE landing for auth links (email confirmation now; OAuth in Phase 3).
// The auth code is single-use — exchanged server-side so the session cookies
// finish materializing before any page render.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = sanitizeNextPath(searchParams.get("next"));

  if (!code) {
    return redirectToLogin(request, "missing-code");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // One fixed reason for every exchange failure — the login page maps it
    // to safe copy; raw library messages are never reflected through the URL.
    return redirectToLogin(request, "exchange-failed");
  }

  return NextResponse.redirect(new URL(next, request.url));
}

function redirectToLogin(request: NextRequest, reason: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}
