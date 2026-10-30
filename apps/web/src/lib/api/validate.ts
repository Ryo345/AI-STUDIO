import { ApiError } from "@studio/domain";
import type { ZodType } from "zod";

// Request-shape validation for /api/v1 handlers.
//
// The domain package owns the schemas; the API layer owns the policy of
// what an invalid request looks like on the wire (400 validation_error with
// issue paths — never the submitted values, which can contain user text).

/** Parses `input` with `schema`, or throws a 400 ApiError listing the failed paths. */
export function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  throw new ApiError("validation_error", "request failed validation", {
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

/** Parses a JSON request body, or throws a 400 ApiError. */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("validation_error", "request body must be valid JSON");
  }
  return parseOrThrow(schema, body);
}

/** Collects a query string into a plain object (repeated keys keep the last). */
export function queryParams(request: Request): Record<string, string> {
  const url = new URL(request.url);
  const out: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
