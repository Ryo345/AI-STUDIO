import { describe, expect, it } from 'vitest';

import { planSceneCount, planSceneDurations, sumDurations } from '../timing.js';
import type { PacingConfig } from '@studio/niches';

const PACING: PacingConfig = {
  wordsPerSecond: 2.4,
  idealSceneSeconds: 8,
  minSceneMs: 1500,
  maxSceneMs: 30_000,
};

describe('planSceneCount', () => {
  it('plans target/ideal scenes', () => {
    expect(planSceneCount(PACING, 80)).toBe(10);
  });

  it('clamps to the schema bounds (3..40)', () => {
    expect(planSceneCount(PACING, 10)).toBe(3);
    expect(planSceneCount(PACING, 3600)).toBe(40);
  });
});

describe('planSceneDurations', () => {
  it('lands the sum on the target duration for balanced narration', () => {
    const narrations = Array.from({ length: 10 }, (_, i) => `Scene number ${i + 1} with a similar spoken length here.`);
    const durations = planSceneDurations(narrations, PACING, 60);
    expect(sumDurations(durations)).toBeCloseTo(60_000, -2); // within ~100ms (rounding)
  });

  it('respects the per-scene clamp on both passes', () => {
    const oneLiner = ['Short.'];
    const durations = planSceneDurations(oneLiner, PACING, 60);
    expect(durations[0]).toBeGreaterThanOrEqual(PACING.minSceneMs);

    const wall = ['word '.repeat(2000)]; // way over maxSceneMs at 2.4 wps
    const durations2 = planSceneDurations(wall, PACING, 30);
    expect(durations2[0]).toBeLessThanOrEqual(PACING.maxSceneMs);
  });

  it('longer narration earns longer scenes (proportional before rescale)', () => {
    const narrations = ['Short line.', 'A considerably longer line with many more words to speak aloud here.'];
    const durations = planSceneDurations(narrations, PACING, 20);
    expect(durations[1]).toBeGreaterThan(durations[0]!);
  });

  it('spreads the target evenly for degenerate empty-narration input', () => {
    const durations = planSceneDurations(['', ''], PACING, 20);
    expect(durations).toHaveLength(2);
    expect(durations[0]).toBe(durations[1]);
  });

  it('empty input yields empty output', () => {
    expect(planSceneDurations([], PACING, 20)).toEqual([]);
  });
});
