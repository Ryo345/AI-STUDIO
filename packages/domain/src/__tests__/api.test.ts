import { describe, expect, it } from 'vitest';

import {
  ApiError,
  ApiErrorEnvelopeSchema,
  API_ERROR_STATUS,
  ApiErrorCodeSchema,
  paginationQuerySchema,
  projectListQuerySchema,
} from '../index.js';

describe('API error envelope', () => {
  it('maps every registered code onto an HTTP status', () => {
    for (const code of ApiErrorCodeSchema.options) {
      const status = API_ERROR_STATUS[code];
      expect(Number.isInteger(status)).toBe(true);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('uses 409 for unique_active_job (double-queue guard) and 502 for provider_error', () => {
    expect(API_ERROR_STATUS.unique_active_job).toBe(409);
    expect(API_ERROR_STATUS.provider_error).toBe(502);
  });

  it('ApiError.status resolves from the code', () => {
    expect(new ApiError('not_found', 'missing').status).toBe(404);
    expect(new ApiError('unauthorized', 'no session').status).toBe(401);
  });

  it('accepts the wire envelope with optional details and rejects unknown codes', () => {
    expect(() =>
      ApiErrorEnvelopeSchema.parse({
        error: { code: 'validation_error', message: 'bad input', details: [{ path: 'topic' }] },
      }),
    ).not.toThrow();

    expect(() =>
      ApiErrorEnvelopeSchema.parse({ error: { code: 'teapot', message: 'no' } }),
    ).toThrow();

    expect(() =>
      ApiErrorEnvelopeSchema.parse({ error: { code: 'not_found' } }),
    ).toThrow();
  });
});

describe('query schemas (searchParams arrive as strings)', () => {
  it('coerces limit/offset strings and applies defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(paginationQuerySchema.parse({ limit: '5', offset: '10' })).toEqual({ limit: 5, offset: 10 });
    expect(() => paginationQuerySchema.parse({ limit: '0' })).toThrow();
    expect(() => paginationQuerySchema.parse({ limit: '101' })).toThrow();
    expect(() => paginationQuerySchema.parse({ offset: '-1' })).toThrow();
  });

  it('project list accepts an optional status filter', () => {
    expect(projectListQuerySchema.parse({ status: 'ready' })).toEqual({ limit: 20, offset: 0, status: 'ready' });
    expect(() => projectListQuerySchema.parse({ status: 'deleted' })).toThrow();
  });
});
