// Beat allocation — turn a template's beat weights into per-beat scene
// counts for a planned scene count. Largest-remainder method: the counts
// always sum to exactly `sceneCount`, and higher-weight beats are never
// starved by rounding.

import type { BeatSkeleton } from '@studio/niches';

export const BEATS_VERSION = '0.1.0';

/**
 * Allocate `sceneCount` scenes across beat weights, summing exactly to
 * `sceneCount`. When the plan is smaller than the beat list, only the
 * heaviest beats survive (template order breaks ties) — a 3-scene script
 * still leads with the hook.
 */
export function allocateBeats(beats: readonly BeatSkeleton[], sceneCount: number): number[] {
  if (beats.length === 0) return [];
  const n = Math.max(1, Math.trunc(sceneCount));

  if (n <= beats.length) {
    // n scenes across n-or-more beats: one scene for each of the heaviest.
    const order = beats
      .map((beat, index) => ({ weight: beat.weight, index }))
      .sort((a, b) => b.weight - a.weight || a.index - b.index);
    const chosen = new Set(order.slice(0, n).map((entry) => entry.index));
    return beats.map((_, index) => (chosen.has(index) ? 1 : 0));
  }

  const exact = beats.map((beat) => beat.weight * n);
  const floors = exact.map((value) => Math.floor(value));
  let remaining = n - floors.reduce((sum, count) => sum + count, 0);

  // Hand out the leftover scenes to the largest fractional parts
  // (deterministic: template order breaks ties).
  const byFraction = exact
    .map((value, index) => ({ fraction: value - Math.floor(value), index }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const counts = [...floors];
  for (const entry of byFraction) {
    if (remaining <= 0) break;
    counts[entry.index] = (counts[entry.index] ?? 0) + 1;
    remaining -= 1;
  }

  return counts;
}
