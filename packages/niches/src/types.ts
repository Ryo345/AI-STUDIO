import type {
  AspectRatio,
  NicheKey,
  OnScreenTextStrategy,
  ScriptFormat,
} from '@studio/domain';

// ── Niche template shapes ─────────────────────────────────────────────────
// The same template object drives BOTH the deterministic mock and the real
// LLM prompt, so mock output is structurally identical to real output —
// same beats, same timing math, same zod contract; only the prose is fake.

export interface BeatSkeleton {
  /** Stable id within a template, e.g. 'hook'. */
  id: string;
  /** Human label, e.g. 'Hook'. Also used as the mock scene summary. */
  label: string;
  /** Share of total scenes; every template's weights sum to exactly 1. */
  weight: number;
  /** Instruction handed to a real LLM for narration in this beat. */
  narrationDirective: string;
  /** Instruction handed to a real LLM / image step for visuals. */
  visualDirective: string;
  onScreenTextStrategy: OnScreenTextStrategy;
  /** Sound cue name attached to scenes of this beat (Phase 2 audio layer). */
  soundCue?: string;
  /** ≥2 phrase templates containing '{topic}', picked by the mock's PRNG. */
  mockNarrationVariants: string[];
  /** Optional {topic} templates for mock on-screen text; omit when strategy is 'none'. */
  mockOnScreenVariants?: string[];
}

export interface VisualStylePreset {
  id: string;
  label: string;
  /** Fragment appended to the real image/prompt instructions (Phase 2). */
  promptFragment: string;
}

export interface MusicMood {
  id: string;
  label: string;
  /** Stock-music search terms (Phase 2 audio step). */
  searchTerms: string[];
}

export interface CaptionStyleDefault {
  id: string;
  wordsPerCue: number;
  alignment: 'top' | 'center' | 'bottom';
  /** Caption words this niche emphasizes (Phase 2 caption styling). */
  emphasisLabels: string[];
}

export interface PacingConfig {
  wordsPerSecond: number;
  idealSceneSeconds: number;
  minSceneMs: number;
  maxSceneMs: number;
}

export interface DurationBand {
  minSeconds: number;
  idealSeconds: number;
  maxSeconds: number;
}

export interface NicheTemplate {
  key: NicheKey;
  label: string;
  /** Wizard blurb shown under the niche card. */
  description: string;
  defaultFormat: ScriptFormat;
  promptFragments: {
    system: string;
    audience: string;
    constraints: string[];
  };
  beats: BeatSkeleton[];
  /** Per-aspect-ratio duration band validated at project creation. */
  durationBands: Record<AspectRatio, DurationBand>;
  visualStylePresets: VisualStylePreset[];
  musicMoods: MusicMood[];
  captionStyleDefault: CaptionStyleDefault;
  pacing: PacingConfig;
}

export interface CustomTemplateOverrides {
  format?: ScriptFormat;
  tone?: string;
  audience?: string;
  extraConstraints?: string[];
}

/** Wizard-facing trimmed view — mock internals never leak to the API. */
export interface NicheTemplateSummary {
  key: NicheKey;
  label: string;
  description: string;
  defaultFormat: ScriptFormat;
  durationBands: Record<AspectRatio, DurationBand>;
  visualStyles: { id: string; label: string }[];
  musicMoods: { id: string; label: string }[];
  captionStyleId: string;
  beats: { id: string; label: string }[];
}
