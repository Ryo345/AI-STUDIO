// Timing math — the one home for scene-count and duration planning.
// Both the mock scriptwriter and the real-LLM normalizer re-time every
// scene through here, so mock output and real output obey identical
// pacing rules (same wordsPerSecond, same per-scene clamps).

import type { PacingConfig } from '@studio/niches';

export const TIMING_VERSION = '0.1.0';

/** Hard scene bounds from the GeneratedScriptSchema — never plan past them. */
export const MIN_SCENES = 3;
export const MAX_SCENES = 40;

/** How many scenes a target duration plans to, clamped to the schema bounds. */
export function planSceneCount(pacing: PacingConfig, targetDurationSeconds: number): number {
  const raw = Math.round(targetDurationSeconds / Math.max(pacing.idealSceneSeconds, 1));
  return Math.min(MAX_SCENES, Math.max(MIN_SCENES, raw));
}

/** Spoken-word estimate for a narration line, in milliseconds. */
export function narrationDurationMs(narration: string, pacing: PacingConfig): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  return (words / Math.max(pacing.wordsPerSecond, 0.1)) * 1000;
}

function clampSceneMs(ms: number, pacing: PacingConfig): number {
  return Math.min(pacing.maxSceneMs, Math.max(pacing.minSceneMs, Math.round(ms)));
}

/**
 * Time a full scene list: per-scene narration reading speed, then a
 * proportional rescale so the sum lands on the project's target duration,
 * with per-scene clamps applied on both passes. The final total is whatever
 * the clamped scenes sum to — that sum becomes totalDurationMs, so the
 * stored timing is always internally consistent.
 */
export function planSceneDurations(
  narrations: string[],
  pacing: PacingConfig,
  targetDurationSeconds: number,
): number[] {
  if (narrations.length === 0) return [];

  const targetMs = targetDurationSeconds * 1000;
  const raw = narrations.map((narration) =>
    clampSceneMs(narrationDurationMs(narration, pacing), pacing),
  );

  const rawTotal = raw.reduce((sum, ms) => sum + ms, 0);
  if (rawTotal === 0) {
    // Degenerate input (all-empty narrations): spread the target evenly.
    const even = clampSceneMs(targetMs / raw.length, pacing);
    return raw.map(() => even);
  }

  const scale = targetMs / rawTotal;
  return raw.map((ms) => clampSceneMs(ms * scale, pacing));
}

export function sumDurations(durationsMs: number[]): number {
  return durationsMs.reduce((sum, ms) => sum + ms, 0);
}
