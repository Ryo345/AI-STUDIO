// @studio/pipeline — pure pipeline logic shared by every provider:
// beat allocation, generated-script normalization, timing math, and the
// real-LLM prompt builder. No I/O, no env reads. Phase 2 adds caption
// math (SRT/ASS) and ffmpeg argument builders.

export const PIPELINE_VERSION = '0.1.0';

export { BEATS_VERSION, allocateBeats } from './beats.js';

export {
  NORMALIZE_VERSION,
  ScriptNormalizationError,
  normalizeGeneratedScript,
  stripCodeFences,
  type NormalizeOptions,
  type NormalizeResult,
} from './normalize.js';

export {
  PROMPT_VERSION,
  buildScriptPrompt,
  type ScriptPrompt,
  type ScriptPromptInput,
} from './prompt.js';

export {
  TIMING_VERSION,
  MAX_SCENES,
  MIN_SCENES,
  narrationDurationMs,
  planSceneCount,
  planSceneDurations,
  sumDurations,
} from './timing.js';
