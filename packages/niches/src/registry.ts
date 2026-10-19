import type { AspectRatio, NicheKey } from '@studio/domain';

import {
  NEUTRAL_AUDIENCE,
  NEUTRAL_BASE_CONSTRAINTS,
  NEUTRAL_SYSTEM_PROMPT,
  neutralTemplate,
} from './templates/neutral.js';
import { automotiveTemplate } from './templates/automotive.js';
import { documentaryTemplate } from './templates/documentary.js';
import { educationTemplate } from './templates/education.js';
import { gamingTemplate } from './templates/gaming.js';
import { horrorTemplate } from './templates/horror.js';
import { assertTemplateIntegrity } from './invariants.js';
import type {
  CustomTemplateOverrides,
  DurationBand,
  NicheTemplate,
  NicheTemplateSummary,
} from './types.js';

// ── Registry ──────────────────────────────────────────────────────────────
// Zero hard-coded niches downstream: everything (API, wizard, mock, LLM
// prompts, validation) resolves templates through this module. Adding a
// niche = adding one file + one line here; `assertTemplateIntegrity` in the
// test suite catches structural drift at `npm test` time.

export class NicheTemplateNotFoundError extends Error {
  constructor(key: string) {
    super(`No niche template registered for '${key}'`);
    this.name = 'NicheTemplateNotFoundError';
  }
}

type SeededNicheKey = Exclude<NicheKey, 'custom'>;

const SEED_TEMPLATES: Record<SeededNicheKey, NicheTemplate> = {
  horror: horrorTemplate,
  automotive: automotiveTemplate,
  education: educationTemplate,
  documentary: documentaryTemplate,
  gaming: gamingTemplate,
};

const SEED_ORDER: readonly SeededNicheKey[] = [
  'horror',
  'automotive',
  'education',
  'documentary',
  'gaming',
];

export interface SeededTemplates {
  keys: readonly SeededNicheKey[];
  get(key: SeededNicheKey): NicheTemplate;
}

/** Wizard-order list of the five non-custom templates. */
export const listedNicheTemplates: readonly NicheTemplate[] = SEED_ORDER.map(
  (key) => SEED_TEMPLATES[key],
);

/**
 * Compose the 'custom' template from the neutral base + user overrides.
 * Same NicheTemplate shape as every seeded niche — downstream code has zero
 * special-casing for custom, and the composition is deterministic so mocks
 * are reproducible.
 */
export function buildCustomTemplate(overrides: CustomTemplateOverrides = {}): NicheTemplate {
  const system = overrides.tone
    ? `${NEUTRAL_SYSTEM_PROMPT} Tone: ${overrides.tone.trim()}.`
    : NEUTRAL_SYSTEM_PROMPT;
  const audience = overrides.audience?.trim() || NEUTRAL_AUDIENCE;
  const constraints = overrides.extraConstraints?.length
    ? [...NEUTRAL_BASE_CONSTRAINTS, ...overrides.extraConstraints.map((c) => c.trim()).filter(Boolean)]
    : [...NEUTRAL_BASE_CONSTRAINTS];

  const template: NicheTemplate = structuredClone(neutralTemplate);
  template.promptFragments = { system, audience, constraints };
  if (overrides.format) template.defaultFormat = overrides.format;
  return template;
}

/** Resolve any niche to its template; 'custom' composes on the fly. */
export function resolveNiche(key: NicheKey, overrides?: CustomTemplateOverrides): NicheTemplate {
  if (key === 'custom') return buildCustomTemplate(overrides);
  const template = SEED_TEMPLATES[key as SeededNicheKey];
  if (!template) throw new NicheTemplateNotFoundError(key);
  return template;
}

/** Integrity-check every seeded template plus a default and overriden custom. */
export function assertAllTemplatesIntegrity(): void {
  for (const template of listedNicheTemplates) assertTemplateIntegrity(template);
  assertTemplateIntegrity(buildCustomTemplate());
  assertTemplateIntegrity(
    buildCustomTemplate({
      format: 'listicle',
      tone: 'dry and academic',
      audience: 'conference speakers',
      extraConstraints: ['Cite at least two sources per scene.'],
    }),
  );
}

export function durationBandFor(template: NicheTemplate, aspectRatio: AspectRatio): DurationBand {
  return template.durationBands[aspectRatio];
}

/** Is a target duration inside the niche+aspect band? Validated at create. */
export function isDurationInBand(
  template: NicheTemplate,
  aspectRatio: AspectRatio,
  targetDurationSeconds: number,
): boolean {
  const band = durationBandFor(template, aspectRatio);
  return (
    targetDurationSeconds >= band.minSeconds &&
    targetDurationSeconds <= band.maxSeconds
  );
}

export function templateSummary(template: NicheTemplate): NicheTemplateSummary {
  return {
    key: template.key,
    label: template.label,
    description: template.description,
    defaultFormat: template.defaultFormat,
    durationBands: template.durationBands,
    visualStyles: template.visualStylePresets.map((preset) => ({ id: preset.id, label: preset.label })),
    musicMoods: template.musicMoods.map((mood) => ({ id: mood.id, label: mood.label })),
    captionStyleId: template.captionStyleDefault.id,
    beats: template.beats.map((beat) => ({ id: beat.id, label: beat.label })),
  };
}
