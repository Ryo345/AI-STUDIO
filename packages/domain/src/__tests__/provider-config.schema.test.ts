import { describe, expect, it } from 'vitest';

import {
  createProviderConnectionSchema,
  ModelAssignmentDTOSchema,
  ProviderConnectionDTOSchema,
  resolveModelAssignment,
  upsertModelAssignmentSchema,
} from '../provider-config.js';

describe('createProviderConnectionSchema', () => {
  it('accepts a NIM key', () => {
    const parsed = createProviderConnectionSchema.parse({
      providerId: 'nvidia-nim',
      apiKey: 'nvapi-abcdefgh',
    });
    expect(parsed.baseUrl).toBeUndefined();
  });

  it('rejects mock as a connection provider', () => {
    expect(() => createProviderConnectionSchema.parse({ providerId: 'mock', apiKey: 'k'.repeat(12) })).toThrow();
  });

  it('rejects short keys', () => {
    expect(() => createProviderConnectionSchema.parse({ providerId: 'nvidia-nim', apiKey: 'short' })).toThrow();
  });

  it('requires baseUrl for openai-compatible', () => {
    expect(() =>
      createProviderConnectionSchema.parse({ providerId: 'openai-compatible', apiKey: 'k'.repeat(12) }),
    ).toThrow();
    expect(() =>
      createProviderConnectionSchema.parse({
        providerId: 'openai-compatible',
        apiKey: 'k'.repeat(12),
        baseUrl: 'https://my.server.example/v1',
      }),
    ).not.toThrow();
  });

  it('rejects a non-URL baseUrl', () => {
    expect(() =>
      createProviderConnectionSchema.parse({
        providerId: 'nvidia-nim',
        apiKey: 'k'.repeat(12),
        baseUrl: 'not a url',
      }),
    ).toThrow();
  });
});

describe('ProviderConnectionDTOSchema', () => {
  it('parses a masked row', () => {
    const dto = ProviderConnectionDTOSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      createdBy: null,
      providerId: 'nvidia-nim',
      baseUrl: null,
      keyHint: 'nvapi-…9f2c',
      status: 'active',
      lastTestedAt: '2026-10-31T20:00:00Z',
      lastTestError: null,
      createdAt: '2026-10-31T19:00:00Z',
      updatedAt: '2026-10-31T20:00:00Z',
    });
    expect(dto.keyHint).toBe('nvapi-…9f2c');
  });

  it('rejects unknown provider ids', () => {
    expect(() =>
      ProviderConnectionDTOSchema.parse({
        id: '11111111-1111-4111-8111-111111111111',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        createdBy: null,
        providerId: 'skynet',
        baseUrl: null,
        keyHint: 'x-…xxxx',
        status: 'untested',
        lastTestedAt: null,
        lastTestError: null,
        createdAt: '2026-10-31T19:00:00Z',
        updatedAt: '2026-10-31T19:00:00Z',
      }),
    ).toThrow();
  });
});

describe('upsertModelAssignmentSchema', () => {
  it('accepts a task assignment and defaults settings', () => {
    const parsed = upsertModelAssignmentSchema.parse({
      task: 'script.generate',
      providerId: 'nvidia-nim',
      model: 'meta/llama-3.1-70b-instruct',
    });
    expect(parsed.settings).toEqual({});
  });

  it('accepts the default task row and generation settings', () => {
    const parsed = upsertModelAssignmentSchema.parse({
      task: 'default',
      providerId: 'anthropic',
      model: 'claude-sonnet-5',
      settings: { temperature: 0.7, maxTokens: 8000 },
    });
    expect(parsed.task).toBe('default');
    expect(parsed.settings).toEqual({ temperature: 0.7, maxTokens: 8000 });
  });

  it('rejects mock', () => {
    expect(() =>
      upsertModelAssignmentSchema.parse({ task: 'default', providerId: 'mock', model: 'm' }),
    ).toThrow();
  });
});

describe('ModelAssignmentDTOSchema', () => {
  it('parses an assignment row', () => {
    const dto = ModelAssignmentDTOSchema.parse({
      id: '33333333-3333-4333-8333-333333333333',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      task: 'script.generate',
      providerId: 'nvidia-nim',
      model: 'meta/llama-3.1-70b-instruct',
      settings: {},
      createdAt: '2026-10-31T19:00:00Z',
      updatedAt: '2026-10-31T19:00:00Z',
    });
    expect(dto.task).toBe('script.generate');
  });
});

describe('resolveModelAssignment', () => {
  const taskRow = { task: 'script.generate' as const, model: 'task-model' };
  const defaultRow = { task: 'default' as const, model: 'default-model' };

  it('prefers the task-specific row', () => {
    expect(resolveModelAssignment([defaultRow, taskRow], 'script.generate')?.model).toBe('task-model');
  });

  it('falls back to the default row', () => {
    expect(resolveModelAssignment([defaultRow], 'script.generate')?.model).toBe('default-model');
  });

  it('returns undefined with no assignment at all (env fallback)', () => {
    expect(resolveModelAssignment([], 'script.generate')).toBeUndefined();
  });
});
