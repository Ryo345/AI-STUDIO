import { describe, expect, it } from 'vitest';

import {
  JobDTOSchema,
  JobEventDTOSchema,
  ScriptGeneratePayloadSchema,
  TERMINAL_JOB_STATUSES,
  UsageEventSchema,
  UsageReportDTOSchema,
  UsageReportRowSchema,
  usageQuerySchema,
} from '../index.js';

// ── Job payloads + statuses ────────────────────────────────────────────────

describe('ScriptGeneratePayloadSchema', () => {
  it('defaults to {} when the value is missing', () => {
    expect(ScriptGeneratePayloadSchema.parse(undefined)).toEqual({});
    expect(ScriptGeneratePayloadSchema.parse({}).instructions).toBeUndefined();
  });

  it('accepts optional instructions up to 1000 chars', () => {
    expect(ScriptGeneratePayloadSchema.parse({ instructions: 'Sleep paralysis only.' }).instructions).toBe(
      'Sleep paralysis only.',
    );
    expect(() => ScriptGeneratePayloadSchema.parse({ instructions: 'x'.repeat(1001) })).toThrow();
  });
});

describe('TERMINAL_JOB_STATUSES', () => {
  it('contains exactly succeeded, failed, cancelled — never queued/running', () => {
    expect([...TERMINAL_JOB_STATUSES].sort()).toEqual(['cancelled', 'failed', 'succeeded']);
  });
});

describe('JobDTOSchema', () => {
  const jobFixture = {
    id: '4f8f7d76-5b8e-4f4d-a3b2-66e7c8f9d0e5',
    workspaceId: '1c8f7d76-2b8e-4f4d-a3b2-66e7c8f9d0e2',
    projectId: '0b9e6c76-1b7e-4f4d-a3b2-66e7c8f9d0e1',
    type: 'script.generate',
    status: 'running',
    attempt: 1,
    maxAttempts: 3,
    cancelRequested: false,
    error: null,
    result: null,
    createdAt: '2026-01-15T10:00:00.000Z',
    startedAt: '2026-01-15T10:00:05.000Z',
    finishedAt: null,
  };

  it('accepts a running job with null error/result and nullable projectId', () => {
    expect(() => JobDTOSchema.parse(jobFixture)).not.toThrow();
    expect(() => JobDTOSchema.parse({ ...jobFixture, projectId: null })).not.toThrow();
  });

  it('rejects unknown statuses and strips unknown keys (receiver-side schema)', () => {
    expect(() => JobDTOSchema.parse({ ...jobFixture, status: 'paused' })).toThrow();
    expect(JobDTOSchema.parse({ ...jobFixture, extra: 1 })).not.toHaveProperty('extra');
  });

  it('accepts a terminal job with error and result shapes', () => {
    expect(() =>
      JobDTOSchema.parse({
        ...jobFixture,
        status: 'succeeded',
        finishedAt: '2026-01-15T10:00:12.000Z',
        result: {
          versionNumber: 1,
          sceneCount: 6,
          totalDurationMs: 92_000,
          providerId: 'mock',
          isMock: true,
        },
      }),
    ).not.toThrow();

    expect(() =>
      JobDTOSchema.parse({
        ...jobFixture,
        status: 'failed',
        finishedAt: '2026-01-15T10:00:12.000Z',
        error: { code: 'provider_error', message: 'upstream 429', retryable: true },
      }),
    ).not.toThrow();
  });
});

describe('JobEventDTOSchema', () => {
  it('defaults detail to {} and accepts stage events', () => {
    const parsed = JobEventDTOSchema.parse({
      id: '5a8f7d76-6b8e-4f4d-a3b2-66e7c8f9d0e6',
      jobId: '4f8f7d76-5b8e-4f4d-a3b2-66e7c8f9d0e5',
      kind: 'stage',
      at: '2026-01-15T10:00:06.000Z',
    });
    expect(parsed.detail).toEqual({});
  });
});

// ── Usage accounting ────────────────────────────────────────────────────────

describe('usage schemas', () => {
  it('accepts a usage event with a mock provider and nullable ids', () => {
    expect(() =>
      UsageEventSchema.parse({
        id: '6b8f7d76-7b8e-4f4d-a3b2-66e7c8f9d0e7',
        workspaceId: '1c8f7d76-2b8e-4f4d-a3b2-66e7c8f9d0e2',
        projectId: null,
        jobId: null,
        providerId: 'mock',
        operation: 'script.generate',
        quantity: 1,
        unit: 'request',
        isMock: true,
        recordedAt: '2026-01-15T10:00:12.000Z',
      }),
    ).not.toThrow();
  });

  it('rejects unknown operations (only script.generate exists in Phase 1)', () => {
    expect(() =>
      UsageEventSchema.parse({
        id: '6b8f7d76-7b8e-4f4d-a3b2-66e7c8f9d0e7',
        workspaceId: '1c8f7d76-2b8e-4f4d-a3b2-66e7c8f9d0e2',
        projectId: null,
        jobId: null,
        providerId: 'mock',
        operation: 'render.video',
        quantity: 1,
        unit: 'request',
        isMock: true,
        recordedAt: '2026-01-15T10:00:12.000Z',
      }),
    ).toThrow();
  });

  it('validates report rows: YYYY-MM periods, integer counts', () => {
    const row = { period: '2026-01', operations: { 'script.generate': 3 }, realRequests: 1, mockRequests: 2 };
    expect(() => UsageReportRowSchema.parse(row)).not.toThrow();
    expect(() => UsageReportRowSchema.parse({ ...row, period: '2026-1' })).toThrow();
    expect(() => UsageReportRowSchema.parse({ ...row, period: '2026-13' })).toThrow();
    expect(() => UsageReportRowSchema.parse({ ...row, realRequests: 1.5 })).toThrow();
  });

  it('caps usage reports at 12 monthly rows', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      period: `2025-${String((i % 12) + 1).padStart(2, '0')}`,
      operations: {} as Record<string, number>,
      realRequests: 0,
      mockRequests: 0,
    }));
    expect(() => UsageReportDTOSchema.parse({ months: rows })).not.toThrow();
    expect(() => UsageReportDTOSchema.parse({ months: [...rows, rows[0]] })).toThrow();
  });

  it('coerces querystring usage params and defaults months to 12', () => {
    expect(usageQuerySchema.parse({}).months).toBe(12);
    expect(usageQuerySchema.parse({ months: '3' }).months).toBe(3);
    expect(() => usageQuerySchema.parse({ months: '13' })).toThrow();
  });
});
