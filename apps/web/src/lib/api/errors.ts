import { API_ERROR_STATUS, ApiError, type ApiErrorCode } from "@studio/domain";

// The single response shape for every /api/v1 route (docs/architecture.md):
// success is { data: ... }, failure is { error: { code, message, details? } }.
// @studio/domain owns the envelope schema and the code→status mapping —
// this module only wraps them so handlers never hand-roll a Response.

/** Success body. */
export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, init);
}

/** Failure body — the envelope @studio/domain's ApiErrorEnvelopeSchema validates. */
export function jsonError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): Response {
  return Response.json(
    { error: details === undefined ? { code, message } : { code, message, details } },
    { status: API_ERROR_STATUS[code] },
  );
}

/**
 * Wraps a route handler so every failure leaves as the standard envelope.
 *
 * - ApiError → its own code/status (details attached).
 * - ZodError  → 400 validation_error (issue paths only, never values).
 * - anything else → 500 internal_error with a generic message; the real
 *   error is logged server-side, never echoed to the caller (an internal
 *   message can carry SQL fragments, ids, or env values).
 */
export function withApiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(error.code, error.message, error.details);
      }
      if (isZodError(error)) {
        return jsonError("validation_error", "request failed validation", {
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
      console.error("[api] unhandled error:", error);
      return jsonError("internal_error", "internal server error");
    }
  };
}

// Structural check instead of a zod import: the web tier does not depend on
// zod directly, and @studio/domain's schemas throw ZodError instances.
function isZodError(
  error: unknown,
): error is { issues: { path: PropertyKey[]; message: string }[] } {
  return (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray((error as { issues: unknown }).issues)
  );
}
