import { describe, expect, it } from 'vitest';

import {
  GeneratedScriptSchema,
  generateScriptSchema,
  patchSceneSchema,
  reorderScenesSchema,
  SceneDTOSchema,
  ScriptVersionDTOSchema,
} from '../index.js';

// ── helpers ────────────────────────────────────────────────────────────────

function sceneFixture(overrides: Record<string, unknown> = {}) {
  return {
    beatId: 'hook',
    index: 0,
    summary: 'The hook',
    narration: 'The story starts with a sound you cannot explain.',
    visualDescription: 'A dark, quiet establishing frame.',
    onScreenText: 'WHAT HAUNTS THIS PLACE?',
    onScreenTextStrategy: 'question',
    durationMs: 4200,
    soundCues: [{ name: 'distant knock', atMs: 0 }],
    ...overrides,
  };
}

function scriptFixture() {
  return {
    title: 'The Backrooms — the part nobody explains',
    scenes: [sceneFixture(), sceneFixture({ beatId: 'setting', index: 1 }), sceneFixture({ beatId: 'twist', index: 2 })],
    totalDurationMs: 12_600,
  };
}

// ── GeneratedScriptSchema ──────────────────────────────────────────────────

describe('GeneratedScriptSchema', () => {
  it('accepts a valid 3-scene script', () => {
    expect(() => GeneratedScriptSchema.parse(scriptFixture())).not.toThrow();
  });

  it('rejects fewer than 3 scenes and more than 40', () => {
    const two = { ...scriptFixture(), scenes: scriptFixture().scenes.slice(0, 2) };
    expect(() => GeneratedScriptSchema.parse(two)).toThrow();

    const fortyOne = { ...scriptFixture(), scenes: Array.from({ length: 41 }, (_, i) => sceneFixture({ index: i })) };
    expect(() => GeneratedScriptSchema.parse(fortyOne)).toThrow();
  });

  it('defaults soundCues to [] when omitted', () => {
    const parsed = GeneratedScriptSchema.parse({
      ...scriptFixture(),
      scenes: scriptFixture().scenes.map(({ soundCues: _ignored, ...rest }) => rest),
    });
    for (const scene of parsed.scenes) expect(scene.soundCues).toEqual([]);
  });

  it('rejects narration over 4000 chars and empty narration', () => {
    expect(() =>
      GeneratedScriptSchema.parse({
        ...scriptFixture(),
        scenes: [sceneFixture({ narration: 'x'.repeat(4001) })],
      }),
    ).toThrow();
    expect(() =>
      GeneratedScriptSchema.parse({ ...scriptFixture(), scenes: [sceneFixture({ narration: '' })] }),
    ).toThrow();
  });

  it('keeps durationMs within the 800–60000 corridor', () => {
    expect(() =>
      GeneratedScriptSchema.parse({ ...scriptFixture(), scenes: [sceneFixture({ durationMs: 799 })] }),
    ).toThrow();
    expect(() =>
      GeneratedScriptSchema.parse({ ...scriptFixture(), scenes: [sceneFixture({ durationMs: 60_001 })] }),
    ).toThrow();
  });

  it('allows onScreenText: null (explicitly no on-screen text)', () => {
    expect(() =>
      GeneratedScriptSchema.parse({
        ...scriptFixture(),
        scenes: [sceneFixture(), sceneFixture({ onScreenText: null }), sceneFixture({ beatId: 'x', index: 2 })],
      }),
    ).not.toThrow();
  });

  it('caps on-screen text at 120 chars', () => {
    expect(() =>
      GeneratedScriptSchema.parse({ ...scriptFixture(), scenes: [sceneFixture({ onScreenText: 'x'.repeat(121) })] }),
    ).toThrow();
  });
});

// ── generateScriptSchema (POST body) ────────────────────────────────────────

describe('generateScriptSchema', () => {
  it('accepts an empty body (instructions optional)', () => {
    expect(generateScriptSchema.parse({})).toEqual({});
  });

  it('accepts instructions up to 1000 chars', () => {
    expect(generateScriptSchema.parse({ instructions: 'x'.repeat(1000) }).instructions).toHaveLength(1000);
  });

  it('rejects instructions over 1000 chars and unknown keys', () => {
    expect(() => generateScriptSchema.parse({ instructions: 'x'.repeat(1001) })).toThrow();
    expect(() => generateScriptSchema.parse({ model: 'claude-x' })).toThrow();
  });
});

// ── patchSceneSchema ────────────────────────────────────────────────────────

describe('patchSceneSchema', () => {
  it('accepts a single-field narration patch', () => {
    expect(patchSceneSchema.parse({ narration: 'Rewritten line.' }).narration).toBe('Rewritten line.');
  });

  it('accepts onScreenText: null as a real patch (clearing text)', () => {
    const parsed = patchSceneSchema.parse({ onScreenText: null });
    expect(parsed.onScreenText).toBeNull();
  });

  it('rejects an empty patch and unknown keys', () => {
    expect(() => patchSceneSchema.parse({})).toThrow();
    expect(() => patchSceneSchema.parse({ position: 3 })).toThrow();
  });

  it('keeps the 800–60000 duration corridor', () => {
    expect(() => patchSceneSchema.parse({ durationMs: 700 })).toThrow();
    expect(patchSceneSchema.parse({ durationMs: 800 }).durationMs).toBe(800);
  });
});

// ── reorderScenesSchema ─────────────────────────────────────────────────────

describe('reorderScenesSchema', () => {
  it('accepts a uuid list in wizard order', () => {
    const ids = ['0b9e6c76-1b7e-4f4d-a3b2-66e7c8f9d0e1', '1c8f7d76-2b8e-4f4d-a3b2-66e7c8f9d0e2'];
    expect(reorderScenesSchema.parse({ sceneIds: ids }).sceneIds).toHaveLength(2);
  });

  it('rejects empty arrays, non-uuids, over 40, and unknown keys', () => {
    expect(() => reorderScenesSchema.parse({ sceneIds: [] })).toThrow();
    expect(() => reorderScenesSchema.parse({ sceneIds: ['nope'] })).toThrow();
    expect(() => reorderScenesSchema.parse({ sceneIds: Array.from({ length: 41 }, () => '0b9e6c76-1b7e-4f4d-a3b2-66e7c8f9d0e1') })).toThrow();
    expect(() => reorderScenesSchema.parse({ ids: [] })).toThrow();
  });
});

// ── Wire DTOs ───────────────────────────────────────────────────────────────

describe('ScriptVersionDTOSchema + SceneDTOSchema', () => {
  it('accepts complete DTOs', () => {
    expect(() =>
      ScriptVersionDTOSchema.parse({
        id: '2d8f7d76-3b8e-4f4d-a3b2-66e7c8f9d0e3',
        projectId: '0b9e6c76-1b7e-4f4d-a3b2-66e7c8f9d0e1',
        versionNumber: 1,
        provenance: { providerId: 'mock', model: null, isMock: true, seed: 'abc:def:1', latencyMs: 12 },
        createdAt: '2026-01-15T10:00:00.000Z',
      }),
    ).not.toThrow();

    expect(() =>
      SceneDTOSchema.parse({
        id: '3e8f7d76-4b8e-4f4d-a3b2-66e7c8f9d0e4',
        projectId: '0b9e6c76-1b7e-4f4d-a3b2-66e7c8f9d0e1',
        position: 0,
        originScriptVersionId: '2d8f7d76-3b8e-4f4d-a3b2-66e7c8f9d0e3',
        narration: 'The story starts with a sound you cannot explain.',
        visualDescription: 'A dark, quiet establishing frame.',
        onScreenText: 'WHAT HAUNTS THIS PLACE?',
        durationMs: 4200,
        soundCues: [{ name: 'distant knock' }],
        createdAt: '2026-01-15T10:00:00.000Z',
        updatedAt: '2026-01-15T10:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('rejects provenance with isMock=false but a mock provider id (honesty guard is upstream; shape guard here)', () => {
    // Provenance shape alone must accept every valid provider combination —
    // the mock/rad real pairing is a worker invariant, not a wire concern.
    expect(() =>
      ScriptVersionDTOSchema.parse({
        id: '2d8f7d76-3b8e-4f4d-a3b2-66e7c8f9d0e3',
        projectId: '0b9e6c76-1b7e-4f4d-a3b2-66e7c8f9d0e1',
        versionNumber: 1,
        provenance: { providerId: 'anthropic', model: 'claude-x', isMock: false, seed: 'n/a', latencyMs: 1200 },
        createdAt: '2026-01-15T10:00:00.000Z',
      }),
    ).not.toThrow();
  });
});
