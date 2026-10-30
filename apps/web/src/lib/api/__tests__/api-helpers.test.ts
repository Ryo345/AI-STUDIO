import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiError, ApiErrorEnvelopeSchema } from '@studio/domain';

import { jsonError, jsonOk, withApiHandler } from '../errors.js';
import { parseJsonBody, parseOrThrow, queryParams } from '../validate.js';

// Pure, credential-free: the envelope + validation policy of the API tier.
// The auth guard itself is exercised end-to-end against the dev server
// (401 without a session, 401 for a forged JWT) — it cannot be unit
// tested without a live Supabase session.

describe('jsonOk', () => {
  it('wraps the payload in { data }', async () => {
    const response = jsonOk({ status: 'ok' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { status: 'ok' } });
  });
});

describe('jsonError', () => {
  it('produces the domain envelope with the code-derived status', async () => {
    const response = jsonError('not_found', 'no such project');
    expect(response.status).toBe(404);
    const body = await response.json();
    // The body must satisfy the shared envelope schema, or the web client
    // cannot parse failures at all.
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body).toEqual({ error: { code: 'not_found', message: 'no such project' } });
  });

  it('attaches details only when they exist', async () => {
    const body = await jsonError('validation_error', 'bad', { issues: [] }).json();
    expect(body.error.details).toEqual({ issues: [] });
  });

  it('maps unique_active_job onto 409 (double-queue guard)', () => {
    expect(jsonError('unique_active_job', 'a job is already running').status).toBe(409);
  });
});

describe('withApiHandler', () => {
  it('passes a successful response through untouched', async () => {
    const handler = withApiHandler(async () => jsonOk({ ok: true }));
    const response = await handler();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { ok: true } });
  });

  it('maps an ApiError onto its code and status', async () => {
    const handler = withApiHandler(async () => {
      throw new ApiError('forbidden', 'not your workspace');
    });
    const response = await handler();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'forbidden', message: 'not your workspace' },
    });
  });

  it('maps a zod failure onto 400 with issue paths but no values', async () => {
    const handler = withApiHandler(async () => {
      throw z.object({ topic: z.string().min(3) }).parse({ topic: 'x' });
    });
    const response = await handler();
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details.issues[0].path).toBe('topic');
    expect(JSON.stringify(body)).not.toContain('"x"');
  });

  it('hides an unexpected error behind a generic 500', async () => {
    const handler = withApiHandler(async () => {
      throw new Error('connection string postgres://user:hunter2@db/prod');
    });
    const response = await handler();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: { code: 'internal_error', message: 'internal server error' } });
    // The internal message (which can carry SQL, ids, or secrets) must not
    // reach the caller.
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});

describe('parseOrThrow', () => {
  it('returns the parsed value when it is valid', () => {
    expect(parseOrThrow(z.object({ a: z.number() }), { a: 1 })).toEqual({ a: 1 });
  });

  it('throws a 400 ApiError naming the failing path', () => {
    try {
      parseOrThrow(z.object({ a: z.number() }), { a: 'nope' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.code).toBe('validation_error');
      expect(apiError.status).toBe(400);
      expect((apiError.details as { issues: { path: string }[] }).issues[0]?.path).toBe('a');
    }
  });
});

describe('parseJsonBody', () => {
  it('parses a JSON body', async () => {
    const request = new Request('http://localhost/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ topic: 'backrooms' }),
      headers: { 'content-type': 'application/json' },
    });
    await expect(parseJsonBody(request, z.object({ topic: z.string() }))).resolves.toEqual({
      topic: 'backrooms',
    });
  });

  it('rejects a non-JSON body with a 400', async () => {
    const request = new Request('http://localhost/api/v1/projects', {
      method: 'POST',
      body: 'not json',
    });
    await expect(parseJsonBody(request, z.object({ topic: z.string() }))).rejects.toMatchObject({
      code: 'validation_error',
    });
  });
});

describe('queryParams', () => {
  it('collects the query string into a plain object', () => {
    const request = new Request('http://localhost/api/v1/session?workspaceId=abc&x=1');
    expect(queryParams(request)).toEqual({ workspaceId: 'abc', x: '1' });
  });

  it('returns an empty object when there is no query string', () => {
    expect(queryParams(new Request('http://localhost/api/v1/session'))).toEqual({});
  });
});
