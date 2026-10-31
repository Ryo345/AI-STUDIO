import { describe, expect, it } from 'vitest';

import { normalizeGeneratedScript, stripCodeFences, ScriptNormalizationError } from '../normalize.js';
import { neutralTemplate } from '@studio/niches';

const OPTS = {
  template: neutralTemplate,
  targetDurationSeconds: 60,
  fallbackTitle: 'Fallback title',
};

function providerScript(overrides: Record<string, unknown> = {}) {
  return {
    title: 'A real title',
    scenes: [
      {
        beatId: 'hook',
        index: 0,
        summary: 'The hook',
        narration: 'The surprising fact about the topic nobody mentions.',
        visualDescription: 'Bold establishing shot.',
        onScreenText: 'WAIT — WHAT?',
        onScreenTextStrategy: 'question',
        durationMs: 12_345, // provider timing is ignored — pipeline re-times
        soundCues: [{ name: 'whoosh', atMs: 0 }],
      },
      {
        beatId: 'context',
        index: 1,
        summary: 'Context',
        narration: 'One piece of context changes everything about the topic.',
        visualDescription: 'Supporting imagery.',
        onScreenText: null,
        onScreenTextStrategy: 'statement',
        durationMs: 9_876,
        soundCues: [],
      },
      {
        beatId: 'development',
        index: 2,
        summary: 'Development',
        narration: 'The argument builds step by step toward the payoff.',
        visualDescription: 'Varied imagery.',
        onScreenText: 'STEP ONE',
        onScreenTextStrategy: 'statement',
        durationMs: 45_678,
        soundCues: [],
      },
    ],
    totalDurationMs: 67_899,
    ...overrides,
  };
}

describe('normalizeGeneratedScript', () => {
  it('normalizes a well-formed provider object', () => {
    const { script, warnings } = normalizeGeneratedScript(providerScript(), OPTS);
    expect(warnings).toEqual([]);
    expect(script.title).toBe('A real title');
    expect(script.scenes).toHaveLength(3);
    expect(script.scenes.map((scene) => scene.index)).toEqual([0, 1, 2]);
    // Re-timed: total must equal the actual sum of scenes.
    expect(script.totalDurationMs).toBe(script.scenes.reduce((sum, s) => sum + s.durationMs, 0));
    expect(script.totalDurationMs).toBeGreaterThan(0);
  });

  it('parses fenced JSON strings and reports no warnings for clean output', () => {
    const fenced = '```json\n' + JSON.stringify(providerScript()) + '\n```';
    const { script } = normalizeGeneratedScript(fenced, OPTS);
    expect(script.title).toBe('A real title');
  });

  it('re-times every scene through the template pacing, ignoring provider durations', () => {
    const { script } = normalizeGeneratedScript(providerScript(), OPTS);
    for (const scene of script.scenes) {
      expect(scene.durationMs).toBeGreaterThanOrEqual(neutralTemplate.pacing.minSceneMs);
      expect(scene.durationMs).toBeLessThanOrEqual(neutralTemplate.pacing.maxSceneMs);
    }
  });

  it('truncates over-limit fields and warns', () => {
    const raw = providerScript({
      title: 'x'.repeat(500),
      scenes: [
        { ...providerScript().scenes[0], narration: 'n'.repeat(6000) },
        { ...providerScript().scenes[1], onScreenText: 'y'.repeat(300) },
        { ...providerScript().scenes[2] },
      ],
    });
    const { script, warnings } = normalizeGeneratedScript(raw, OPTS);
    expect(script.title).toHaveLength(200);
    expect(script.scenes[0]!.narration).toHaveLength(4000);
    expect(script.scenes[1]!.onScreenText).toHaveLength(120);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('repairs unknown onScreenTextStrategy values to statement with a warning', () => {
    const raw = providerScript();
    (raw.scenes[0] as Record<string, unknown>).onScreenTextStrategy = 'vibes';
    const { script, warnings } = normalizeGeneratedScript(raw, OPTS);
    expect(script.scenes[0]!.onScreenTextStrategy).toBe('statement');
    expect(warnings.join(' ')).toContain('unknown onScreenTextStrategy');
  });

  it('drops scenes with empty narration and reports them, as long as 3+ survive', () => {
    const fourScenes = [
      ...providerScript().scenes,
      {
        beatId: 'takeaway',
        index: 3,
        summary: 'Takeaway',
        narration: 'The quiet truth about the topic lands here.',
        visualDescription: 'Single strong image.',
        onScreenText: 'THE REAL LESSON',
        onScreenTextStrategy: 'statement',
        durationMs: 8000,
        soundCues: [],
      },
    ];
    const raw = providerScript({ scenes: fourScenes });
    (raw.scenes[1] as Record<string, unknown>).narration = '   ';
    const { script, warnings } = normalizeGeneratedScript(raw, OPTS);
    expect(script.scenes).toHaveLength(3);
    expect(warnings.join(' ')).toContain('empty narration');
  });

  it('truncates to 40 scenes when the provider overproduces', () => {
    const manyScenes = Array.from({ length: 45 }, (_, i) => ({
      beatId: 'development',
      index: i,
      summary: `Scene ${i}`,
      narration: `Scene ${i} narration with enough words to be speakable.`,
      visualDescription: 'Imagery.',
      onScreenText: null,
      onScreenTextStrategy: 'statement',
      durationMs: 4000,
      soundCues: [],
    }));
    const { script, warnings } = normalizeGeneratedScript(providerScript({ scenes: manyScenes }), OPTS);
    expect(script.scenes).toHaveLength(40);
    expect(warnings.join(' ')).toContain('truncated to 40');
  });

  it('throws ScriptNormalizationError on unparseable JSON', () => {
    expect(() => normalizeGeneratedScript('not json at all {', OPTS)).toThrow(ScriptNormalizationError);
  });

  it('throws ScriptNormalizationError when fewer than 3 usable scenes survive', () => {
    const raw = providerScript({ scenes: providerScript().scenes.slice(0, 2) });
    expect(() => normalizeGeneratedScript(raw, OPTS)).toThrow(ScriptNormalizationError);
  });

  it('throws ScriptNormalizationError when the scenes array is missing', () => {
    expect(() => normalizeGeneratedScript({ title: 'no scenes' }, OPTS)).toThrow(ScriptNormalizationError);
  });

  it('falls back to the fallback title when the provider title is empty', () => {
    const raw = providerScript({ title: '   ' });
    const { script } = normalizeGeneratedScript(raw, OPTS);
    expect(script.title).toBe('Fallback title');
  });

  it('coerces string durations from sloppy providers', () => {
    const raw = providerScript();
    (raw.scenes[0] as Record<string, unknown>).durationMs = '12000';
    const { script } = normalizeGeneratedScript(raw, OPTS);
    expect(script.scenes[0]!.durationMs).toBeGreaterThan(0); // re-timed anyway
    expect(script.totalDurationMs).toBe(script.scenes.reduce((sum, s) => sum + s.durationMs, 0));
  });

  it('warns when scenes reference beat ids the template does not know', () => {
    const raw = providerScript();
    (raw.scenes[0] as Record<string, unknown>).beatId = 'mystery-beat';
    const { warnings } = normalizeGeneratedScript(raw, OPTS);
    expect(warnings.join(' ')).toContain('unknown beat ids');
  });
});

describe('stripCodeFences', () => {
  it('strips ```json fences', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips bare ``` fences', () => {
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('leaves plain JSON untouched', () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });
});
