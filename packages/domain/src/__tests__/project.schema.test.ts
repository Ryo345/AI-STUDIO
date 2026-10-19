import { describe, expect, it } from 'vitest';

import {
  createProjectSchema,
  ProjectDTOSchema,
  updateProjectSchema,
} from '../index.js';

const validConfig = {
  aspectRatio: '9:16',
  targetDurationSeconds: 90,
  format: 'explainer',
} as const;

const validCreate = {
  niche: 'horror',
  topic: '  The Backrooms   ',
  config: validConfig,
};

describe('createProjectSchema', () => {
  it('accepts a valid creation input and defaults autoGenerate to true', () => {
    const parsed = createProjectSchema.parse(validCreate);
    expect(parsed.autoGenerate).toBe(true);
    expect(parsed.topic).toBe('The Backrooms'); // trimmed
  });

  it('rejects an unknown niche', () => {
    expect(() =>
      createProjectSchema.parse({ ...validCreate, niche: 'finance' }),
    ).toThrow();
  });

  it('rejects topics shorter than 3 or longer than 300 chars', () => {
    expect(() => createProjectSchema.parse({ ...validCreate, topic: 'ab' })).toThrow();
    expect(() =>
      createProjectSchema.parse({ ...validCreate, topic: 'a'.repeat(301) }),
    ).toThrow();
  });

  it('rejects durations outside the global sanity bounds', () => {
    expect(() =>
      createProjectSchema.parse({
        ...validCreate,
        config: { ...validConfig, targetDurationSeconds: 5 },
      }),
    ).toThrow();
    expect(() =>
      createProjectSchema.parse({
        ...validCreate,
        config: { ...validConfig, targetDurationSeconds: 4000 },
      }),
    ).toThrow();
  });

  it('rejects non-integer durations', () => {
    expect(() =>
      createProjectSchema.parse({
        ...validCreate,
        config: { ...validConfig, targetDurationSeconds: 90.5 },
      }),
    ).toThrow();
  });

  it('rejects an unknown aspect ratio', () => {
    expect(() =>
      createProjectSchema.parse({
        ...validCreate,
        config: { ...validConfig, aspectRatio: '1:1' },
      }),
    ).toThrow();
  });
});

describe('updateProjectSchema', () => {
  it('accepts a single-field patch', () => {
    const parsed = updateProjectSchema.parse({ topic: 'Dyatlov Pass incident' });
    expect(parsed.topic).toBe('Dyatlov Pass incident');
  });

  it('rejects an empty patch (at least one field required)', () => {
    expect(() => updateProjectSchema.parse({})).toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => updateProjectSchema.parse({ deprecated: true })).toThrow();
  });

  it('allows status only as draft or archived', () => {
    expect(updateProjectSchema.parse({ status: 'draft' }).status).toBe('draft');
    expect(updateProjectSchema.parse({ status: 'archived' }).status).toBe('archived');
    expect(() => updateProjectSchema.parse({ status: 'ready' })).toThrow();
    expect(() => updateProjectSchema.parse({ status: 'generating' })).toThrow();
  });

  it('accepts a partial config patch', () => {
    const parsed = updateProjectSchema.parse({ config: { targetDurationSeconds: 120 } });
    expect(parsed.config).toEqual({ targetDurationSeconds: 120 });
  });
});

const validProjectDTO = {
  id: '0b9e6c76-1b7e-4f4d-a3b2-66e7c8f9d0e1',
  workspaceId: '1c8f7d76-2b8e-4f4d-a3b2-66e7c8f9d0e2',
  title: 'The Backrooms',
  niche: 'horror',
  topic: 'The Backrooms',
  config: validConfig,
  status: 'draft',
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
};

describe('ProjectDTOSchema', () => {
  it('accepts a complete DTO with offset timestamps', () => {
    expect(() => ProjectDTOSchema.parse(validProjectDTO)).not.toThrow();
  });

  it('rejects a naive timestamp (offset required — postgres timestamptz via JS Date serializes with Z)', () => {
    expect(() =>
      ProjectDTOSchema.parse({ ...validProjectDTO, createdAt: '2026-01-15T10:00:00' }),
    ).toThrow();
  });

  it('rejects a non-uuid id', () => {
    expect(() => ProjectDTOSchema.parse({ ...validProjectDTO, id: 'not-a-uuid' })).toThrow();
  });
});

// ApiError lives in api/error.ts; duplicated prove-nothing assertions removed.
