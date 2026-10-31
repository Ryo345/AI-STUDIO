// Generated-script normalization — funnel whatever a provider actually
// returned (LLM JSON, fixture text, hand-built mock objects) into the
// canonical GeneratedScriptSchema shape before it reaches persistence.
//
// Policy: repair liberally (truncations, re-timing, re-indexing, unknown
// enums), fail loudly only on structural impossibilities (unparseable,
// too few scenes). Every repair is reported as a warning so provenance
// stays honest about what was mangled.

import { OnScreenTextStrategySchema, type GeneratedScript, type GeneratedScene } from '@studio/domain';
import type { NicheTemplate } from '@studio/niches';

import { MIN_SCENES, MAX_SCENES, planSceneDurations, sumDurations } from './timing.js';

export const NORMALIZE_VERSION = '0.1.0';

export class ScriptNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptNormalizationError';
  }
}

export interface NormalizeOptions {
  template: NicheTemplate;
  targetDurationSeconds: number;
  /** Used when the provider returned no usable title. */
  fallbackTitle: string;
}

export interface NormalizeResult {
  script: GeneratedScript;
  warnings: string[];
}

const LIMITS = {
  title: 200,
  summary: 120,
  narration: 4000,
  visualDescription: 2000,
  onScreenText: 120,
} as const;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/** Truncate and report — every repair is a warning (honest provenance). */
function truncateWarn(value: string, max: number, label: string, warnings: string[]): string {
  if (value.length <= max) return value;
  warnings.push(`${label}: truncated from ${value.length} to ${max} chars`);
  return value.slice(0, max);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Strip markdown code fences an LLM wrapped its JSON in. */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? (fenced[1] ?? '').trim() : trimmed;
}

function parseScenes(rawScenes: unknown, warnings: string[]): Partial<GeneratedScene>[] {
  if (!Array.isArray(rawScenes)) {
    throw new ScriptNormalizationError('provider output has no scenes array');
  }

  const parsed: Partial<GeneratedScene>[] = [];
  for (const [index, entry] of rawScenes.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      warnings.push(`scene ${index}: not an object, dropped`);
      continue;
    }
    const scene = entry as Record<string, unknown>;

    const narration = truncateWarn((asString(scene.narration) ?? '').trim(), LIMITS.narration, `scene ${index}: narration`, warnings);
    if (!narration) {
      warnings.push(`scene ${index}: empty narration, dropped`);
      continue;
    }

    const onScreenTextRaw = asString(scene.onScreenText)?.trim() ?? null;
    if (onScreenTextRaw === '') warnings.push(`scene ${index}: whitespace-only onScreenText, stored as null`);
    const onScreenText = onScreenTextRaw ? truncateWarn(onScreenTextRaw, LIMITS.onScreenText, `scene ${index}: onScreenText`, warnings) : null;

    const strategyRaw = asString(scene.onScreenTextStrategy);
    const strategy = strategyRaw && OnScreenTextStrategySchema.safeParse(strategyRaw).success
      ? strategyRaw
      : null;
    if (strategyRaw && !strategy) {
      warnings.push(`scene ${index}: unknown onScreenTextStrategy '${truncate(strategyRaw, 32)}', fell back to 'statement'`);
    }

    let soundCues: GeneratedScene['soundCues'] = [];
    if (Array.isArray(scene.soundCues)) {
      soundCues = scene.soundCues
        .filter((cue): cue is Record<string, unknown> => typeof cue === 'object' && cue !== null)
        .flatMap((cue) => {
          const name = asString(cue.name)?.trim();
          if (!name) return [];
          const atMs = asFiniteNumber(cue.atMs);
          return [{ name: truncate(name, 64), ...(atMs !== null && atMs >= 0 ? { atMs: Math.trunc(atMs) } : {}) }];
        })
        .slice(0, 4);
    }

    parsed.push({
      beatId: truncate(asString(scene.beatId)?.trim() || `scene-${index}`, 64),
      index,
      summary: truncateWarn(asString(scene.summary)?.trim() || narration.slice(0, LIMITS.summary), LIMITS.summary, `scene ${index}: summary`, warnings),
      narration,
      visualDescription: truncateWarn((asString(scene.visualDescription) ?? '').trim(), LIMITS.visualDescription, `scene ${index}: visualDescription`, warnings),
      onScreenText,
      onScreenTextStrategy: (strategy ?? 'statement') as GeneratedScene['onScreenTextStrategy'],
      durationMs: 0, // re-timed below
      soundCues,
    });
  }

  return parsed;
}

/**
 * Normalize raw provider output into a GeneratedScript. Throws
 * ScriptNormalizationError when the output is structurally unusable
 * (unparseable JSON, fewer than 3 narratable scenes).
 */
export function normalizeGeneratedScript(raw: unknown, opts: NormalizeOptions): NormalizeResult {
  const warnings: string[] = [];

  let payload: unknown = raw;
  if (typeof raw === 'string') {
    const text = stripCodeFences(raw);
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ScriptNormalizationError('provider output is not valid JSON');
    }
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new ScriptNormalizationError('provider output is not a JSON object');
  }
  const record = payload as Record<string, unknown>;

  let scenes = parseScenes(record.scenes, warnings);

  if (scenes.length > MAX_SCENES) {
    warnings.push(`provider returned ${scenes.length} scenes, truncated to ${MAX_SCENES}`);
    scenes = scenes.slice(0, MAX_SCENES);
  }
  if (scenes.length < MIN_SCENES) {
    throw new ScriptNormalizationError(
      `provider produced ${scenes.length} usable scene(s), need at least ${MIN_SCENES}`,
    );
  }

  // One home for timing: re-time every scene to the project's target
  // duration through the template's pacing, regardless of what the
  // provider claimed.
  const durations = planSceneDurations(
    scenes.map((scene) => scene.narration ?? ''),
    opts.template.pacing,
    opts.targetDurationSeconds,
  );

  const normalized: GeneratedScene[] = scenes.map((scene, index) => ({
    beatId: scene.beatId ?? `scene-${index}`,
    index,
    summary: scene.summary ?? '',
    narration: scene.narration ?? '',
    visualDescription: scene.visualDescription ?? '',
    onScreenText: scene.onScreenText ?? null,
    onScreenTextStrategy: scene.onScreenTextStrategy ?? 'statement',
    durationMs: durations[index] ?? opts.template.pacing.minSceneMs,
    soundCues: scene.soundCues ?? [],
  }));

  const title = truncateWarn((asString(record.title) ?? '').trim(), LIMITS.title, 'title', warnings)
    || truncate(opts.fallbackTitle.trim(), LIMITS.title)
    || `${opts.template.label} script`;

  // Beat sanity: scenes claiming beat ids the template does not know are
  // kept (beatId is free text downstream) but reported — the prompt asked
  // for template beats, so a full miss hints at a degraded provider run.
  const knownBeats = new Set(opts.template.beats.map((beat) => beat.id));
  const unknownBeats = [...new Set(normalized.map((scene) => scene.beatId))].filter(
    (beatId) => !knownBeats.has(beatId),
  );
  if (unknownBeats.length > 0) {
    warnings.push(`scenes reference unknown beat ids: ${unknownBeats.join(', ')}`);
  }

  return {
    script: {
      title,
      scenes: normalized,
      totalDurationMs: sumDurations(durations),
    },
    warnings,
  };
}
