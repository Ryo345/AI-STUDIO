import { describe, expect, it } from 'vitest';

import { allocateBeats } from '../beats.js';
import type { BeatSkeleton } from '@studio/niches';

function beat(id: string, weight: number): BeatSkeleton {
  return {
    id,
    label: id,
    weight,
    narrationDirective: '',
    visualDirective: '',
    onScreenTextStrategy: 'statement',
    mockNarrationVariants: [`${id} about {topic}`],
  };
}

const WEIGHTS = [beat('a', 0.14), beat('b', 0.18), beat('c', 0.32), beat('d', 0.22), beat('e', 0.14)];

describe('allocateBeats', () => {
  it('sums to exactly sceneCount for any allocation', () => {
    for (let n = 3; n <= 40; n += 1) {
      const counts = allocateBeats(WEIGHTS, n);
      expect(counts.reduce((sum, c) => sum + c, 0)).toBe(n);
    }
  });

  it('gives the heaviest beat the most scenes at large counts', () => {
    const counts = allocateBeats(WEIGHTS, 20);
    const heaviest = WEIGHTS.reduce((best, beat, index) => (beat.weight > WEIGHTS[best]!.weight ? index : best), 0);
    const max = Math.max(...counts);
    expect(counts[heaviest]).toBe(max);
  });

  it('keeps the hook when the plan is smaller than the beat list', () => {
    // 3 scenes across 5 beats → the three heaviest beats win, hook is 0.14…
    // heaviest three are c (0.32), d (0.22), b (0.18).
    const counts = allocateBeats(WEIGHTS, 3);
    expect(counts).toEqual([0, 1, 1, 1, 0]);
  });

  it('one scene goes to the single heaviest beat', () => {
    expect(allocateBeats(WEIGHTS, 1)).toEqual([0, 0, 1, 0, 0]);
  });

  it('is deterministic', () => {
    expect(allocateBeats(WEIGHTS, 12)).toEqual(allocateBeats(WEIGHTS, 12));
  });

  it('handles an empty beat list', () => {
    expect(allocateBeats([], 5)).toEqual([]);
  });
});
