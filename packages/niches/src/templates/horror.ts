import type { NicheTemplate } from '../types.js';

export const horrorTemplate: NicheTemplate = {
  key: 'horror',
  label: 'Horror / creepy storytelling',
  description: 'Slow-burn dread, urban legends, unexplained events — atmosphere over gore.',
  defaultFormat: 'narrative',
  promptFragments: {
    system:
      'You are a horror short-form scriptwriter. You build quiet, escalating dread with concrete sensory detail and unanswered questions. Atmosphere over gore.',
    audience: 'late-night scrollers who love creepypasta and expect an ending that reframes everything',
    constraints: [
      'Never depict identifiable real people, named living victims, or real tragedies.',
      'Keep it PG-13: implied threat, no explicit gore, cruelty, or harm to children or animals.',
      'Present the events as a story being retold; never assert supernatural claims as verified fact.',
      'End on an image or implication, never a fully explained resolution.',
    ],
  },
  beats: [
    {
      id: 'hook',
      label: 'The hook',
      weight: 0.16,
      narrationDirective:
        'Open mid-moment with one unsettling sensory detail about the topic. Speak in second person or past tense; name the place or thing early.',
      visualDirective: 'A dark, quiet establishing frame — something slightly wrong with it.',
      onScreenTextStrategy: 'question',
      soundCue: 'distant knock',
      mockNarrationVariants: [
        'The story of {topic} starts the way these stories always start — with a sound you cannot explain.',
        'Nobody who has looked into {topic} sleeps the same afterward. Here is why.',
        'There is one detail about {topic} that the people who were there refuse to discuss.',
      ],
      mockOnScreenVariants: ['WHAT HAUNTS {topic}?', 'NO ONE EXPLAINS {topic}'],
    },
    {
      id: 'setting',
      label: 'The setting',
      weight: 0.18,
      narrationDirective: 'Establish where and when with mundane, specific detail — normalcy makes the wrongness land.',
      visualDirective: 'Empty rooms, empty streets; ordinary places photographed too still.',
      onScreenTextStrategy: 'statement',
      soundCue: 'room tone',
      mockNarrationVariants: [
        'At first, {topic} looked completely ordinary. That was the part nobody trusted.',
        'The records around {topic} are quiet, official, and missing exactly one page.',
        'Everyone who described {topic} used the same strange, calm words.',
      ],
      mockOnScreenVariants: ['IT LOOKED NORMAL', 'ONE PAGE IS MISSING'],
    },
    {
      id: 'unraveling',
      label: 'The unraveling',
      weight: 0.26,
      narrationDirective:
        'Introduce the anomaly and escalate it: small wrong details stacking up. One new escalation per scene.',
      visualDirective: 'Framing that hides as much as it shows; suggestion over depiction.',
      onScreenTextStrategy: 'statement',
      soundCue: 'low hum',
      mockNarrationVariants: [
        'The first strange thing about {topic} was how quietly it happened.',
        'Then the pattern around {topic} repeated — one step closer each time.',
        'By the third week, {topic} stopped pretending to be normal.',
        'Whoever looked into {topic} next found less, not more.',
      ],
      mockOnScreenVariants: ['THE FIRST SIGN', 'IT REPEATED', 'CLOSER EACH TIME'],
    },
    {
      id: 'escalation',
      label: 'The escalation',
      weight: 0.22,
      narrationDirective:
        'The worst incident, told plainly. Understate instead of dramatize; let the facts chill on their own.',
      visualDirective: 'Static, distortion, or sudden stillness — the visual flinches.',
      onScreenTextStrategy: 'statement',
      soundCue: 'tape stop',
      mockNarrationVariants: [
        'Whatever was behind {topic}, it stopped hiding the night everything changed.',
        'The last record of {topic} ends mid-sentence, and it was never finished.',
        'That was when {topic} stopped being a story people told for fun.',
      ],
      mockOnScreenVariants: ['THE LAST RECORD', 'IT ENDS MID-SENTENCE'],
    },
    {
      id: 'twist',
      label: 'The turn',
      weight: 0.12,
      narrationDirective:
        'Reveal the detail that reframes the story — a question the viewer cannot un-ask. Do not resolve it.',
      visualDirective: 'A single frame the viewer wants to rewind.',
      onScreenTextStrategy: 'statistic',
      mockNarrationVariants: [
        'Because the one thing {topic} never explained was who was counting.',
        'And the detail no one mentions about {topic} is that it never actually stopped.',
        'Which leaves a question about {topic} that has no comfortable answer.',
      ],
      mockOnScreenVariants: ['IT NEVER STOPPED', 'NO ANSWER'],
    },
    {
      id: 'cta',
      label: 'Call to action',
      weight: 0.06,
      narrationDirective: 'One chilling, short send-off inviting the viewer to stay for the next story.',
      visualDirective: 'Cut to black with room for an end-card.',
      onScreenTextStrategy: 'none',
      mockNarrationVariants: [
        'Follow for the next story — {topic} is only one of them.',
        "Part two on {topic} posts tomorrow night. You'll want the lights on.",
      ],
    },
  ],
  durationBands: {
    '9:16': { minSeconds: 60, idealSeconds: 90, maxSeconds: 175 },
    '16:9': { minSeconds: 120, idealSeconds: 240, maxSeconds: 480 },
  },
  visualStylePresets: [
    {
      id: 'vhs-found-footage',
      label: 'VHS found footage',
      promptFragment: 'VHS grain, timestamp overlays, handheld framing, degraded analog texture',
    },
    {
      id: 'cinematic-dark',
      label: 'Cinematic dark',
      promptFragment: 'near-black frames, single hard light source, deep shadows, cold color grade',
    },
  ],
  musicMoods: [
    { id: 'dread-ambient', label: 'Dread ambient', searchTerms: ['dark ambient drone', 'horror atmosphere pad'] },
    { id: 'orchestral-tension', label: 'Orchestral tension', searchTerms: ['suspense strings', 'slow orchestral build'] },
  ],
  captionStyleDefault: {
    id: 'flicker-bottom',
    wordsPerCue: 3,
    alignment: 'bottom',
    emphasisLabels: ['never', 'alone', 'stopped', 'missing'],
  },
  pacing: {
    wordsPerSecond: 2.2,
    idealSceneSeconds: 6.5,
    minSceneMs: 1500,
    maxSceneMs: 20_000,
  },
};
