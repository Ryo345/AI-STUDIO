import { describe, expect, it } from 'vitest';

import {
  mapJobRow,
  mapProjectRow,
  mapSceneRow,
  monthWindowStart,
  RowMappingError,
  type DbRow,
} from '../index.js';

// Pure, credential-free: snake_case rows in, zod-validated camelCase DTOs out.

const projectRow: DbRow = {
  id: '0b9e6c76-1b7e-4f4d-a3b2-66e7c8f9d0e1',
  workspace_id: '1c8f7d76-2b8e-4f4d-a3b2-66e7c8f9d0e2',
  created_by: null,
  title: 'The Backrooms',
  niche_key: 'horror',
  topic: 'The Backrooms',
  config: { aspectRatio: '9:16', targetDurationSeconds: 90, format: 'narrative' },
  status: 'generating',
  current_script_version_id: null,
  creation_x: 'unknown column a new migration added', // mappers ignore extras
  created_at: '2026-01-15T10:00:00.123+00:00',
  updated_at: '2026-01-15T10:05:00.123+00:00',
};

describe('mapProjectRow', () => {
  it('renames snake_case columns to the API DTO shape (niche_key → niche)', () => {
    const dto = mapProjectRow(projectRow);
    expect(dto.niche).toBe('horror');
    expect(dto.workspaceId).toBe('1c8f7d76-2b8e-4f4d-a3b2-66e7c8f9d0e2');
    expect(dto.config.aspectRatio).toBe('9:16');
  });

  it('throws RowMappingError on a row with an invalid status', () => {
    expect(() => mapProjectRow({ ...projectRow, status: 'vaporized' })).toThrow(RowMappingError);
  });
});

describe('mapJobRow', () => {
  const jobRow: DbRow = {
    id: '4f8f7d76-5b8e-4f4d-a3b2-66e7c8f9d0e5',
    workspace_id: '1c8f7d76-2b8e-4f4d-a3b2-66e7c8f9d0e2',
    project_id: null,
    type: 'script.generate',
    status: 'running',
    attempt: 0,
    max_attempts: 3,
    cancel_requested: false,
    error: null,
    result: null,
    created_at: '2026-01-15T10:00:00.000+00:00',
    started_at: '2026-01-15T10:00:05.000+00:00',
    finished_at: null,
  };

  it('accepts a full queue row including nullable project', () => {
    const dto = mapJobRow(jobRow);
    expect(dto.projectId).toBeNull();
    expect(dto.maxAttempts).toBe(3);
    expect(dto.startedAt).toBe('2026-01-15T10:00:05.000+00:00');
  });

  it('rejects an off-enum status as RowMappingError (with cause)', () => {
    try {
      mapJobRow({ ...jobRow, status: 'dreaming' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RowMappingError);
      expect((err as RowMappingError).cause).toBeDefined();
    }
  });
});

describe('mapSceneRow', () => {
  const sceneRow: DbRow = {
    id: '3e8f7d76-4b8e-4f4d-a3b2-66e7c8f9d0e4',
    project_id: '0b9e6c76-1b7e-4f4d-a3b2-66e7c8f9d0e1',
    position: 2,
    origin_script_version_id: '2d8f7d76-3b8e-4f4d-a3b2-66e7c8f9d0e3',
    narration: 'The story starts with a sound you cannot explain.',
    visual_description: 'A dark, quiet establishing frame.',
    on_screen_text: null,
    duration_ms: 4200,
    sound_cues: [{ name: 'distant knock', atMs: 0 }],
    meta: { beatId: 'hook' },
    created_at: '2026-01-15T10:00:00.000+00:00',
    updated_at: '2026-01-15T10:00:00.000+00:00',
  };

  it('keeps meta out of the DTO and maps the duration corridor', () => {
    const dto = mapSceneRow(sceneRow);
    expect(dto.durationMs).toBe(4200);
    expect(dto.soundCues).toEqual([{ name: 'distant knock', atMs: 0 }]);
    expect(Object.hasOwn(dto as Record<string, unknown>, 'meta')).toBe(false);
  });
});

describe('monthWindowStart', () => {
  it('computes the first day of the (months-1)-ago month in UTC', () => {
    expect(monthWindowStart(new Date('2026-01-15T12:00:00Z'), 12)).toBe('2025-02-01T00:00:00.000Z');
    expect(monthWindowStart(new Date('2026-01-15T12:00:00Z'), 1)).toBe('2026-01-01T00:00:00.000Z');
  });
});
