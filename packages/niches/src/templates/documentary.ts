import type { NicheTemplate } from '../types.js';

export const documentaryTemplate: NicheTemplate = {
  key: 'documentary',
  label: 'Documentary / storytelling',
  description: 'Longer narrative arcs — history, investigations, and untold stories.',
  defaultFormat: 'narrative',
  promptFragments: {
    system:
      'You are a documentary scriptwriter for short-form video. Measured, factual, with connective narrative tissue — never editorializing beyond the record.',
    audience: 'viewers who enjoy 20-minute documentary deep-dives compressed into a story they can finish',
    constraints: [
      'Anchor every scene to a date, place, or named source from the public record.',
      'Attribute contested claims ("reporters at the time described …") instead of asserting them.',
      'No invented dialogue or imagined interior thoughts; paraphrase documented statements only.',
      'Maintain strict chronology — no flash-forwards that spoil the arc.',
    ],
  },
  beats: [
    {
      id: 'hook',
      label: 'The hook',
      weight: 0.12,
      narrationDirective:
        'Drop the viewer at the moment the story turns. A dated present-tense beat, then step back.',
      visualDirective: 'Archive-style opening frame; a place, a date, a held silence.',
      onScreenTextStrategy: 'question',
      soundCue: 'projector',
      mockNarrationVariants: [
        'The full story of {topic} starts years before anyone wrote it down.',
        'Long before {topic} made the papers, one decision quietly set it in motion.',
        'Every documentary about {topic} opens at the end. This one starts at the beginning.',
      ],
      mockOnScreenVariants: ['WHERE {topic} ACTUALLY BEGINS', 'BEFORE THE HEADLINES'],
    },
    {
      id: 'origins',
      label: 'The origins',
      weight: 0.22,
      narrationDirective:
        'Establish the world before the events: who, where, and what the stakes were. Concrete and dated.',
      visualDirective: 'Period-appropriate establishing imagery; maps and documents.',
      onScreenTextStrategy: 'statement',
      mockNarrationVariants: [
        'To understand {topic}, start with the world that allowed it to happen.',
        'The setting for {topic} was ordinary — that is what makes the record so unsettling.',
        'At the time {topic} began, almost nobody involved knew the name it would carry.',
      ],
      mockOnScreenVariants: ['Chapter One — The Setting', 'AN ORDINARY BEGINNING'],
    },
    {
      id: 'arc',
      label: 'The arc',
      weight: 0.34,
      narrationDirective:
        'Chronological escalation: decisions, consequences, and the record trail. One development per scene, each anchored.',
      visualDirective: 'Archive texture throughout: clippings, photographs, slow map moves.',
      onScreenTextStrategy: 'statement',
      mockNarrationVariants: [
        'The first move in the {topic} story looked harmless in the minutes of the meeting.',
        'Then the {topic} record shows the point where the options narrowed to one.',
        'Within months, {topic} had outgrown everyone who tried to contain it.',
        'The turning point of {topic} is documented in a single memo almost nobody has read.',
      ],
      mockOnScreenVariants: ['IN THE MINUTES', 'OPTIONS NARROW', 'THE TURNING POINT'],
    },
    {
      id: 'turning-point',
      label: 'The reckoning',
      weight: 0.18,
      narrationDirective:
        'The consequence arrives. Report what the record shows, including what remains unresolved.',
      visualDirective: 'The iconic image of the story, granted space and restraint.',
      onScreenTextStrategy: 'statement',
      soundCue: 'final chord',
      mockNarrationVariants: [
        'When the {topic} reckoning came, it arrived faster than anyone defended against.',
        'The official record of {topic} ends with a conclusion — and one line left open.',
        'Afterward, {topic} was measured by what it changed, not what it settled.',
      ],
      mockOnScreenVariants: ['THE RECKONING', 'ONE LINE LEFT OPEN'],
    },
    {
      id: 'legacy',
      label: 'The legacy',
      weight: 0.08,
      narrationDirective: 'What {topic} changed that persists today — one concrete traceable effect.',
      visualDirective: 'Present-day contrast frame against earlier period imagery.',
      onScreenTextStrategy: 'statistic',
      mockNarrationVariants: [
        'The traceable legacy of {topic} is still measurable in systems we use today.',
        'Decades on, {topic} still shapes decisions nobody connects back to it.',
        'The paper trail of {topic} closed; its effects never did.',
      ],
      mockOnScreenVariants: ['THE LASTING MARK', 'STILL MEASURABLE'],
    },
    {
      id: 'cta',
      label: 'Call to action',
      weight: 0.06,
      onScreenTextStrategy: 'none',
      narrationDirective: 'A quiet one-line invitation to the next installment of the series.',
      visualDirective: 'Fade to black with series end-card room.',
      mockNarrationVariants: [
        'Part two of {topic} follows the thread the record left open.',
        'The next installment returns to {topic} with the part nobody filmed.',
      ],
    },
  ],
  durationBands: {
    '9:16': { minSeconds: 60, idealSeconds: 120, maxSeconds: 240 },
    '16:9': { minSeconds: 240, idealSeconds: 600, maxSeconds: 1200 },
  },
  visualStylePresets: [
    {
      id: 'archive-grain',
      label: 'Archive grain',
      promptFragment: '16mm grain, archival photo pushes, subtle dust and scratches, muted period palette',
    },
    {
      id: 'cinematic-natural',
      label: 'Cinematic natural',
      promptFragment: 'natural light cinematography, muted earth tones, patient locked-off compositions',
    },
  ],
  musicMoods: [
    { id: 'somber-strings', label: 'Somber strings', searchTerms: ['somber cello documentary', 'slow strings reflection'] },
    { id: 'piano-drift', label: 'Piano drift', searchTerms: ['minimal piano documentary', 'sparse piano bed'] },
  ],
  captionStyleDefault: {
    id: 'quiet-lower',
    wordsPerCue: 6,
    alignment: 'bottom',
    emphasisLabels: ['record', 'still', 'remains'],
  },
  pacing: {
    wordsPerSecond: 2.1,
    idealSceneSeconds: 9,
    minSceneMs: 1800,
    maxSceneMs: 45_000,
  },
};
