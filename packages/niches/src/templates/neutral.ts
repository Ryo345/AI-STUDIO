import type { NicheTemplate } from '../types.js';

// The neutral template: balance-focused explainer skeleton. It is the base
// that 'custom' projects compose from (buildCustomTemplate in registry.ts).

export const NEUTRAL_SYSTEM_PROMPT =
  'You are a concise, high-retention short-form video scriptwriter. You write punchy, concrete narration that a viewer cannot pause; no filler, no clichés like "in today\'s video".';

export const NEUTRAL_AUDIENCE =
  'curious general-audience viewers scrolling a feed, with zero prior context on the topic';

export const NEUTRAL_BASE_CONSTRAINTS = [
  'Stick to the scene count, per-scene duration, and beat order given in the structure section.',
  'Narration must be speakable aloud — no stage directions, markdown, or emoji inside narration.',
  'Base every claim on widely reported facts; never invent statistics or sources.',
];

export const neutralTemplate: NicheTemplate = {
  key: 'custom',
  label: 'Custom topic',
  description: 'Any topic in your own words — a balanced, high-retention general structure.',
  defaultFormat: 'explainer',
  promptFragments: {
    system: NEUTRAL_SYSTEM_PROMPT,
    audience: NEUTRAL_AUDIENCE,
    constraints: [...NEUTRAL_BASE_CONSTRAINTS],
  },
  beats: [
    {
      id: 'hook',
      label: 'Hook',
      weight: 0.14,
      narrationDirective:
        'Open with the single most surprising or counter-intuitive fact about the topic. Name the topic within the first sentence.',
      visualDirective: 'A bold establishing visual that makes the topic instantly legible.',
      onScreenTextStrategy: 'question',
      soundCue: 'whoosh',
      mockNarrationVariants: [
        "Here's the thing about {topic} — almost everyone gets one part of it wrong.",
        "Everyone thinks they understand {topic}. Give me sixty seconds to prove otherwise.",
        "{topic} is far stranger than it looks, and it starts with one overlooked detail.",
      ],
      mockOnScreenVariants: ['WAIT — WHAT IS {topic}?', 'EVERYONE GETS {topic} WRONG'],
    },
    {
      id: 'context',
      label: 'Context',
      weight: 0.18,
      narrationDirective: 'Give only the background a viewer needs to care about what comes next.',
      visualDirective: 'Clean supporting imagery that anchors the setting.',
      onScreenTextStrategy: 'statement',
      mockNarrationVariants: [
        "To see why {topic} matters, start with the one detail most explanations skip.",
        "Before the interesting part of {topic}, one piece of context changes everything.",
        "{topic} only makes sense once you know where it actually began.",
      ],
      mockOnScreenVariants: ['IT STARTED QUIETLY', 'ONE OVERLOOKED DETAIL'],
    },
    {
      id: 'development',
      label: 'Development',
      weight: 0.32,
      narrationDirective:
        'Build the argument in escalating, self-contained steps. Each scene must add a new idea, not restated ones.',
      visualDirective: 'Varied imagery; each scene visually distinct from the previous.',
      onScreenTextStrategy: 'statement',
      mockNarrationVariants: [
        "First, {topic} behaves differently once you stop treating it as one thing.",
        "Then notice what happens when {topic} is pushed to its own limits.",
        "Next comes the part of {topic} that quietly rewrites the usual story.",
        "And that single shift makes the rest of {topic} fall into place.",
      ],
      mockOnScreenVariants: ['STEP ONE — LOOK CLOSER', 'THEN IT CHANGES', 'AND THEN IT CLICKS'],
    },
    {
      id: 'takeaway',
      label: 'Takeaway',
      weight: 0.22,
      narrationDirective: 'Land the payoff: state what the viewer now understands that they did not before.',
      visualDirective: 'Single strong image summarizing the payoff.',
      onScreenTextStrategy: 'statement',
      mockNarrationVariants: [
        "So the real lesson of {topic} is not the fact itself — it is how easily it hides.",
        "Which means {topic} was never the boring part; the boring explanation was.",
        "That is the quiet truth about {topic}, and it applies to more than you think.",
      ],
      mockOnScreenVariants: ['SO THAT IS THE TRUTH', 'THE REAL LESSON'],
    },
    {
      id: 'cta',
      label: 'Call to action',
      weight: 0.14,
      narrationDirective: 'One short, specific follow-up framed as benefit to the viewer, under 20 words.',
      visualDirective: 'Closing frame with room for an end-card overlay.',
      onScreenTextStrategy: 'none',
      mockNarrationVariants: [
        "Follow for the next look at {topic} — the strange part is still ahead.",
        "Want the deeper side of {topic}? The next piece is already queued.",
        "If this changed how you see {topic}, the follow button is right there.",
      ],
    },
  ],
  durationBands: {
    '9:16': { minSeconds: 45, idealSeconds: 90, maxSeconds: 180 },
    '16:9': { minSeconds: 120, idealSeconds: 300, maxSeconds: 600 },
  },
  visualStylePresets: [
    {
      id: 'cinematic-desaturated',
      label: 'Cinematic desaturated',
      promptFragment: 'moody cinematic frames, desaturated palette, shallow depth of field',
    },
    {
      id: 'clean-vlog',
      label: 'Clean vlog',
      promptFragment: 'bright, clean modern settings, natural light, airy composition',
    },
    {
      id: 'bold-typographic',
      label: 'Bold typographic',
      promptFragment: 'bold graphic backgrounds, high contrast, strong typographic elements',
    },
  ],
  musicMoods: [
    { id: 'neutral-ambient', label: 'Neutral ambient', searchTerms: ['calm ambient pad', 'minimal background'] },
    { id: 'uplifting-electronic', label: 'Uplifting electronic', searchTerms: ['uplifting electronic', 'bright synth'] },
  ],
  captionStyleDefault: {
    id: 'bold-bottom',
    wordsPerCue: 4,
    alignment: 'bottom',
    emphasisLabels: ['key', 'now'],
  },
  pacing: {
    wordsPerSecond: 2.4,
    idealSceneSeconds: 8,
    minSceneMs: 1500,
    maxSceneMs: 30_000,
  },
};
