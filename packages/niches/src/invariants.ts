import type { NicheTemplate } from './types.js';

// Structural invariants every template must satisfy. Run by the test suite
// on every registered template so registry drift fails loudly before it can
// break the mock, the LLM prompts, or the wizard.

export class TemplateIntegrityError extends Error {
  constructor(key: string, problems: string[]) {
    super(`niche template '${key}' failed integrity: ${problems.join('; ')}`);
    this.name = 'TemplateIntegrityError';
  }
}

export function assertTemplateIntegrity(template: NicheTemplate): void {
  const problems: string[] = [];
  const { key, beats, durationBands, visualStylePresets, musicMoods, captionStyleDefault, pacing } = template;

  if (beats.length < 3) {
    problems.push(`expected >= 3 beats, got ${beats.length}`);
  }

  const beatIds = new Set<string>();
  const weightSum = beats.reduce((sum, beat) => sum + beat.weight, 0);
  if (Math.abs(weightSum - 1) > 1e-9) {
    problems.push(`beat weights must sum to 1, got ${weightSum}`);
  }
  for (const beat of beats) {
    if (beat.id.length === 0) problems.push(`beat with empty id (${beat.label})`);
    if (beatIds.has(beat.id)) problems.push(`duplicate beat id '${beat.id}'`);
    beatIds.add(beat.id);
    if (beat.weight <= 0 || beat.weight > 1) problems.push(`beat '${beat.id}' weight out of (0,1]`);
    if (beat.mockNarrationVariants.length < 2) {
      problems.push(`beat '${beat.id}' needs >= 2 mockNarrationVariants`);
    }
    if (!beat.mockNarrationVariants.every((variant) => variant.includes('{topic}'))) {
      problems.push(`beat '${beat.id}' variants must contain the {topic} placeholder`);
    }
    if (beat.onScreenTextStrategy === 'none' && beat.mockOnScreenVariants) {
      problems.push(`beat '${beat.id}' declares on-screen variants but strategy is 'none'`);
    }
    if (beat.onScreenTextStrategy !== 'none' && !beat.mockOnScreenVariants?.length) {
      problems.push(`beat '${beat.id}' needs mockOnScreenVariants when strategy is '${beat.onScreenTextStrategy}'`);
    }
  }

  for (const aspect of ['9:16', '16:9'] as const) {
    const band = durationBands[aspect];
    if (!(band.minSeconds <= band.idealSeconds && band.idealSeconds <= band.maxSeconds)) {
      problems.push(`duration band for ${aspect} must satisfy min <= ideal <= max`);
    }
  }

  const styleIds = new Set<string>();
  if (visualStylePresets.length < 2) {
    problems.push(`expected >= 2 visual style presets, got ${visualStylePresets.length}`);
  }
  for (const preset of visualStylePresets) {
    if (styleIds.has(preset.id)) problems.push(`duplicate visual style id '${preset.id}'`);
    styleIds.add(preset.id);
  }

  if (musicMoods.length < 1) {
    problems.push('expected >= 1 music mood');
  }
  if (!Number.isInteger(captionStyleDefault.wordsPerCue) || captionStyleDefault.wordsPerCue < 1 || captionStyleDefault.wordsPerCue > 8) {
    problems.push(`captionStyleDefault.wordsPerCue must be an integer in [1,8], got ${captionStyleDefault.wordsPerCue}`);
  }
  if (!(pacing.wordsPerSecond > 0)) {
    problems.push('pacing.wordsPerSecond must be > 0');
  }
  if (!(pacing.minSceneMs >= 800 && pacing.minSceneMs < pacing.maxSceneMs && pacing.maxSceneMs <= 60_000)) {
    problems.push('pacing scene bounds must satisfy 800 <= min < max <= 60000');
  }

  if (problems.length > 0) {
    throw new TemplateIntegrityError(key, problems);
  }
}
