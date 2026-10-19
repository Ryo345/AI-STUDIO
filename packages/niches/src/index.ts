// @studio/niches — niche template registry (pure data + pure functions).
// Consumed by the mock scriptwriter, the real LLM prompt builder, the
// wizard, and project validation. No I/O, no env reads.

export const NICHES_VERSION = '0.1.0';

export type {
  BeatSkeleton,
  CaptionStyleDefault,
  CustomTemplateOverrides,
  DurationBand,
  MusicMood,
  NicheTemplate,
  NicheTemplateSummary,
  PacingConfig,
  VisualStylePreset,
} from './types.js';

export {
  TemplateIntegrityError,
  assertTemplateIntegrity,
} from './invariants.js';

export {
  NEUTRAL_SYSTEM_PROMPT,
  NEUTRAL_AUDIENCE,
  NEUTRAL_BASE_CONSTRAINTS,
  neutralTemplate,
} from './templates/neutral.js';

export { horrorTemplate } from './templates/horror.js';
export { automotiveTemplate } from './templates/automotive.js';
export { educationTemplate } from './templates/education.js';
export { documentaryTemplate } from './templates/documentary.js';
export { gamingTemplate } from './templates/gaming.js';

export {
  NicheTemplateNotFoundError,
  assertAllTemplatesIntegrity,
  buildCustomTemplate,
  durationBandFor,
  isDurationInBand,
  listedNicheTemplates,
  resolveNiche,
  templateSummary,
} from './registry.js';
