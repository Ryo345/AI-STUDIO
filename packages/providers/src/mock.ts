// The mock scriptwriter — deterministic, niche-structured, honestly fake.
// Reads the SAME template data the real prompt does (beats, pacing, mock
// variants) and produces schema-identical output, so cancel/heartbeat/
// reclaim paths and the whole downstream pipeline are exercisable with
// zero credentials. MOCK_GENERATE_DELAY_MS simulates provider latency,
// abort-aware, so a 60s delay can exercise cancel-during-run locally.

import type { GeneratedScene, GeneratedScript, ScriptProvenance } from '@studio/domain';
import { allocateBeats, normalizeGeneratedScript, planSceneCount } from '@studio/pipeline';

import type {
  ScriptwriterAdapter,
  ScriptwriterContext,
  ScriptwriterRequest,
  ScriptwriterResult,
} from './types.js';

export const MOCK_VERSION = '0.1.0';

/** Env knob — simulates latency so cancel/reclaim paths work without credentials. */
export const MOCK_DELAY_ENV = 'MOCK_GENERATE_DELAY_MS';

// ── Deterministic PRNG (mulberry32 + FNV-1a seed) ────────────────────────
// Same jobId → same script. Retries regenerate identical output, which is
// exactly what a mock should do: nothing about the job changed.

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('mock pick from empty list');
  return item;
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0 || signal.aborted) {
      if (signal.aborted) reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      else resolve();
      return;
    }
    // Wake in slices so a cancel mid-delay lands within ~100ms, not after
    // the full simulated latency.
    const SLICE_MS = 100;
    const timer = setInterval(() => {
      if (signal.aborted) {
        clearInterval(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      }
    }, SLICE_MS);
    setTimeout(() => {
      clearInterval(timer);
      resolve();
    }, ms);
  });
}

function mockDelayMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env[MOCK_DELAY_ENV] ?? 0);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(raw, 10 * 60_000); // hard 10-minute ceiling on simulated latency
}

// ── Adapter ───────────────────────────────────────────────────────────────

export class MockScriptwriter implements ScriptwriterAdapter {
  readonly id = 'mock' as const;
  readonly isMock = true;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async generate(request: ScriptwriterRequest, ctx: ScriptwriterContext): Promise<ScriptwriterResult> {
    const startedAt = Date.now();

    const delay = mockDelayMs(this.env);
    if (delay > 0) {
      ctx.log?.('mock: simulating provider latency', { delayMs: delay });
      await sleepAbortable(delay, ctx.signal);
    }

    // Deterministic per job: seed the PRNG from the job id.
    const rng = mulberry32(fnv1a(request.jobId));
    const topic = request.topic.trim() || request.template.label;
    const pacing = request.template.pacing;

    // Same scene plan + beat allocation the real prompt advertises.
    const targetDurationSeconds = request.config.targetDurationSeconds;
    const sceneCount = planSceneCount(pacing, targetDurationSeconds);

    // Build scenes from the SAME beat allocation the real prompt advertises:
    // template order, heaviest beats, zero-count beats skipped.
    const allocation = allocateBeats(request.template.beats, sceneCount);
    const scenes: GeneratedScene[] = [];
    for (const [beatIndex, beat] of request.template.beats.entries()) {
      const count = allocation[beatIndex] ?? 0;
      for (let i = 0; i < count; i += 1) {
        const narration = pick(rng, beat.mockNarrationVariants).replaceAll('{topic}', topic);

        const onScreenText =
          beat.onScreenTextStrategy === 'none'
            ? null
            : beat.mockOnScreenVariants
              ? pick(rng, beat.mockOnScreenVariants).replaceAll('{topic}', topic)
              : null;

        scenes.push({
          beatId: beat.id,
          index: scenes.length,
          summary: beat.label,
          narration,
          visualDescription: beat.visualDirective,
          onScreenText,
          onScreenTextStrategy: beat.onScreenTextStrategy,
          durationMs: 0,
          soundCues: beat.soundCue ? [{ name: beat.soundCue }] : [],
        });
      }
    }

    // Funnel through the same normalizer as real providers: one timing
    // home, one clamp policy — mock output is structurally identical.
    const { script } = normalizeGeneratedScript(
      { title: topic.slice(0, 200), scenes, totalDurationMs: 0 },
      { template: request.template, targetDurationSeconds, fallbackTitle: topic.slice(0, 200) },
    );

    const provenance: ScriptProvenance = {
      providerId: 'mock',
      model: null,
      isMock: true,
      seed: request.jobId,
      latencyMs: Date.now() - startedAt,
    };

    return { script: script as GeneratedScript, provenance };
  }
}
