// Small pure HTTP helpers shared by pages and route handlers.

/**
 * Normalizes a post-login redirect target ("next" query param).
 *
 * Accepts only same-origin root-relative paths ("/dashboard"). Rejects
 * absolute URLs and protocol-relative "//evil.com" values — an attacker
 * who can craft a login link with ?next= must not be able to bounce a
 * just-authenticated user off-site.
 */
export function sanitizeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  return raw;
}
