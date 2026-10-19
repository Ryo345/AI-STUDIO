import { z } from 'zod';

// Single error envelope for every /api/v1 route. The web client parses
// failures with ApiErrorEnvelopeSchema; success bodies are always { data }.

export const ApiErrorCodeSchema = z.enum([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'unique_active_job',
  'rate_limited',
  'provider_error',
  'internal_error',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** Error code → HTTP status. Single mapping, used by the API wrapper. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unique_active_job: 409,
  rate_limited: 429,
  provider_error: 502,
  internal_error: 500,
};

export const ApiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

/** Thrown by API handlers; withApiHandler maps it onto the envelope + status. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return API_ERROR_STATUS[this.code];
  }
}
