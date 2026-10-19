import { describe, expect, it } from 'vitest';

import type { NicheKey } from '@studio/domain';

import {
  assertAllTemplatesIntegrity,
  assertTemplateIntegrity,
  buildCustomTemplate,
  durationBandFor,
  isDurationInBand,
  listedNicheTemplates,
  NEUTRAL_AUDIENCE,
  neutralTemplate,
  NicheTemplateNotFoundError,
  resolveNiche,
  TemplateIntegrityError,
  templateSummary,
} from '../index.js';

// ── Structural integrity (the suite that catches registry drift) ───────────

describe('template integrity', () => {
  it('passes for every seeded template and both custom compositions', () => {
    expect(() => assertAllTemplatesIntegrity()).not.toThrow();
  });

  it('rejects beat weights that do not sum to 1', () => {
    const template = structuredClone(neutralTemplate);
    template.beats[0]!.weight = 0.9; // now sums to 1.76
    expect(() => assertTemplateIntegrity(template)).toThrow(TemplateIntegrityError);
  });

  it('rejects a beat without {topic} interpolation slots', () => {
    const template = structuredClone(neutralTemplate);
    template.beats[0]!.mockNarrationVariants = ['No placeholder in here.', 'Also none here.'];
    expect(() => assertTemplateIntegrity(template)).toThrow(TemplateIntegrityError);
  });
});

// ── Registry lookup ────────────────────────────────────────────────────────

describe('resolveNiche', () => {
  it('lists the five seeded niches in wizard order', () => {
    expect(listedNicheTemplates.map((t) => t.key)).toEqual([
      'horror',
      'automotive',
      'education',
      'documentary',
      'gaming',
    ]);
  });

  it('resolves every valid key', () => {
    const keys: NicheKey[] = ['horror', 'automotive', 'education', 'documentary', 'gaming', 'custom'];
    for (const key of keys) {
      expect(resolveNiche(key).key).toBe(key);
    }
  });

  it('throws NicheTemplateNotFoundError for unknown keys', () => {
    expect(() => resolveNiche('finance' as NicheKey)).toThrow(NicheTemplateNotFoundError);
  });
});

// ── Custom composition ─────────────────────────────────────────────────────

describe('buildCustomTemplate', () => {
  it('composes deterministically: two identical builds are deep-equal', () => {
    const overrides = {
      format: 'listicle' as const,
      tone: 'dry and academic',
      audience: 'conference speakers',
      extraConstraints: ['Cite at least two sources per scene.'],
    };
    expect(buildCustomTemplate(overrides)).toEqual(buildCustomTemplate(overrides));
  });

  it('applies tone, audience, format and extra constraints', () => {
    const template = buildCustomTemplate({
      tone: 'dry and academic',
      audience: 'conference speakers',
      format: 'narrative',
      extraConstraints: ['Cite at least two sources per scene.', ''],
    });

    expect(template.key).toBe('custom');
    expect(template.defaultFormat).toBe('narrative');
    expect(template.promptFragments.system).toContain('Tone: dry and academic');
    expect(template.promptFragments.audience).toBe('conference speakers');
    expect(template.promptFragments.constraints).toContain('Cite at least two sources per scene.');
    // empty extra constraints are dropped, base constraints always present
    expect(template.promptFragments.constraints[0]).toContain('scene count');
  });

  it('falls back to neutral defaults with no overrides', () => {
    const template = buildCustomTemplate();
    expect(template.promptFragments.audience).toBe(NEUTRAL_AUDIENCE);
    expect(template.defaultFormat).toBe('explainer');
  });

  it('never mutates the neutral base template', () => {
    buildCustomTemplate({
      tone: 'hostile',
      audience: 'nobody',
      extraConstraints: ['X'],
      format: 'listicle',
    });
    expect(neutralTemplate.promptFragments.audience).toBe(NEUTRAL_AUDIENCE);
    expect(neutralTemplate.defaultFormat).toBe('explainer');
    expect(neutralTemplate.promptFragments.constraints).toHaveLength(3);
  });
});

// ── Duration bands ──────────────────────────────────────────────────────────

describe('duration bands', () => {
  it('returns per-aspect bands from the template', () => {
    const horror = resolveNiche('horror');
    expect(durationBandFor(horror, '9:16')).toEqual({ minSeconds: 60, idealSeconds: 90, maxSeconds: 175 });
    expect(durationBandFor(horror, '16:9')).toEqual({ minSeconds: 120, idealSeconds: 240, maxSeconds: 480 });
  });

  it('is inclusive at both band boundaries', () => {
    const gaming = resolveNiche('gaming');
    expect(isDurationInBand(gaming, '9:16', 30)).toBe(true);
    expect(isDurationInBand(gaming, '9:16', 29)).toBe(false);
    expect(isDurationInBand(gaming, '9:16', 120)).toBe(true);
    expect(isDurationInBand(gaming, '9:16', 121)).toBe(false);
  });
});

// ── Wizard summary (public shape; mock internals must not leak) ─────────────

describe('templateSummary', () => {
  it('exposes wizard-relevant fields only', () => {
    const summary = templateSummary(resolveNiche('education'));
    expect(summary.key).toBe('education');
    expect(summary.visualStyles).toHaveLength(2);
    expect(summary.beats[0]).toEqual({ id: 'hook', label: 'The hook' });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('mockNarrationVariants');
    expect(serialized).not.toContain('promptFragments');
  });
});
