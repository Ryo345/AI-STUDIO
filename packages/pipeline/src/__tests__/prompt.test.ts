import { describe, expect, it } from 'vitest';

import { buildScriptPrompt } from '../prompt.js';
import { horrorTemplate, neutralTemplate } from '@studio/niches';

const BASE = {
  topic: 'The forgotten history of lighthouses',
  format: 'narrative' as const,
  aspectRatio: '9:16' as const,
  targetDurationSeconds: 90,
};

describe('buildScriptPrompt', () => {
  it('carries the template persona and the topic', () => {
    const prompt = buildScriptPrompt(neutralTemplate, BASE);
    expect(prompt.system).toContain(neutralTemplate.promptFragments.system);
    expect(prompt.user).toContain(BASE.topic);
  });

  it('states the target duration and planned scene count', () => {
    const prompt = buildScriptPrompt(neutralTemplate, BASE);
    expect(prompt.user).toContain('target total duration 90s');
    expect(prompt.user).toContain('~11 scenes'); // 90/8 → 11.25 → 11
  });

  it('pins the JSON contract the normalizer parses', () => {
    const prompt = buildScriptPrompt(neutralTemplate, BASE);
    expect(prompt.user).toContain('"narration"');
    expect(prompt.user).toContain('onScreenTextStrategy');
    expect(prompt.user).toContain('ONLY a JSON object');
  });

  it('uses the niche-specific template for niche projects', () => {
    const prompt = buildScriptPrompt(horrorTemplate, BASE);
    expect(prompt.system).toContain(horrorTemplate.promptFragments.system);
    expect(prompt.system).toContain(horrorTemplate.label);
  });

  it('appends user instructions in a dedicated section', () => {
    const prompt = buildScriptPrompt(neutralTemplate, { ...BASE, instructions: 'Mention lighthouse keepers.' });
    expect(prompt.user).toContain('USER INSTRUCTIONS');
    expect(prompt.user).toContain('Mention lighthouse keepers.');
  });

  it('omits the instructions section when none are given', () => {
    const prompt = buildScriptPrompt(neutralTemplate, BASE);
    expect(prompt.user).not.toContain('USER INSTRUCTIONS');
  });

  it('is deterministic for identical inputs', () => {
    expect(buildScriptPrompt(neutralTemplate, BASE)).toEqual(buildScriptPrompt(neutralTemplate, BASE));
  });

  it('adapts the scene plan to the aspect-ratio duration band', () => {
    const vertical = buildScriptPrompt(neutralTemplate, BASE);
    const horizontal = buildScriptPrompt(neutralTemplate, { ...BASE, aspectRatio: '16:9' });
    expect(vertical.user).not.toEqual(horizontal.user);
    // 16:9 band is 120-600s, so a 90s target is unusual — the band range must be stated either way.
    expect(horizontal.user).toContain('120-600s');
  });
});
