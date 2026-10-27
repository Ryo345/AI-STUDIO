import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

// Page-level guard. Contract (docs + plan): middleware refreshes sessions and
// guards pages only — /api/* is excluded by the matcher below and every API
// handler must guard itself.

const AUTH_PAGES = new Set(["/login", "/signup"]);
// Anonymous flows that still involve auth: the emailed confirmation link
// (and Phase 3 OAuth) lands logged-out users directly on the callback.
const PUBLIC_PAGES = new Set(["/login", "/signup", "/auth/callback"]);

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  // Signed-in users never see the login/signup pages again. The redirect must
  // carry any cookies updateSession just rotated — dropping them strands the
  // browser on an already-rotated refresh token (reuse detection then
  // logs the user out).
  if (AUTH_PAGES.has(pathname) && user) {
    const redirect = NextResponse.redirect(new URL("/dashboard", request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  // Everything else (including "/") requires a session; preserve the
  // intended destination through the login round-trip.
  if (!PUBLIC_PAGES.has(pathname) && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // All pages, but never Next internals, API routes (they self-guard),
    // or static assets. `api(?:/|$)` anchors the exclusion to the /api
    // segment — a bare `api` prefix would also skip /apifoo-style pages.
    "/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
