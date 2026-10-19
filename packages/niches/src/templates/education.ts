import type { NicheTemplate } from '../types.js';

export const educationTemplate: NicheTemplate = {
  key: 'education',
  label: 'Education / microlearning',
  description: 'Explainers that make one hard concept click in under three minutes.',
  defaultFormat: 'explainer',
  promptFragments: {
    system:
      'You are a microlearning scriptwriter in the style of the best science YouTube: plain words, vivid analogies, zero condescension.',
    audience: 'curious viewers with no background in the subject who want to actually understand, not just hear facts',
    constraints: [
      'One concept per scene; connect each scene to the previous with a hinge word ("which means", "so").',
      'Use one extended analogy per script and carry it through the whole concept.',
      'Any number or date must be widely published and attributable; round sensibly for speech.',
      'Define every technical term the instant it appears, inside the same sentence.',
    ],
  },
  beats: [
    {
      id: 'hook',
      label: 'The hook',
      weight: 0.12,
      narrationDirective:
        'Name the concept and immediately promise a payoff ("stick around and you will finally get why …"). Use "you".',
      visualDirective: 'The concept reduced to one iconic symbol or diagram sketch.',
      onScreenTextStrategy: 'question',
      soundCue: 'click',
      mockNarrationVariants: [
        '{topic} is taught so badly that most people go their whole lives misreading it.',
        'If {topic} still feels confusing, it is not your fault — it was explained backwards.',
        'Ninety seconds from now, {topic} will finally make sense. Here is the version nobody teaches.',
      ],
      mockOnScreenVariants: ['WHY {topic} CONFUSES EVERYONE', 'EXPLAINED CORRECTLY, IN 90 SECONDS'],
    },
    {
      id: 'context',
      label: 'The context',
      weight: 0.2,
      narrationDirective:
        'Introduce your core analogy and set up the one misconception this script will dismantle.',
      visualDirective: 'Split frame: the misconception crossed out beside the analogy.',
      onScreenTextStrategy: 'statement',
      mockNarrationVariants: [
        'Picture {topic} the way teachers rarely show it, and the confusion disappears.',
        'The usual {topic} explanation skips one step — the step that does all the work.',
        'Here is the analogy that makes {topic} click, in one sentence.',
      ],
      mockOnScreenVariants: ['THE MISSING STEP', 'ONE ANALOGY, ONE CLICK'],
    },
    {
      id: 'development',
      label: 'The build',
      weight: 0.4,
      narrationDirective:
        'Build the concept in strict ladder order — each scene assumes ONLY what earlier scenes established. No leaps.',
      visualDirective: 'Progressive diagram reveal or animated steps; each scene advances the visual.',
      onScreenTextStrategy: 'statement',
      mockNarrationVariants: [
        'Step one: {topic} only works the way it does because of one quiet rule.',
        'Now stack the second part of {topic} on top of that rule and watch what it forces.',
        'Which means the surprising behavior of {topic} was never optional — it had to happen.',
        'Hold both of those ideas together and the hardest part of {topic} already happened.',
      ],
      mockOnScreenVariants: ['RULE ONE', 'NOW STACK THEM', 'AND THAT FORCES THIS'],
    },
    {
      id: 'recap',
      label: 'The recap',
      weight: 0.18,
      narrationDirective:
        'Compress the ladder into one takeaway sentence, then extend it to something the viewer will notice in real life.',
      visualDirective: 'The full diagram, completed, held for one beat.',
      onScreenTextStrategy: 'statistic',
      mockNarrationVariants: [
        'So all of {topic} reduces to one sentence — and now you can spot it everywhere.',
        'That is the whole of {topic}: one rule, one consequence, endlessly repeated.',
        'Once {topic} clicks like that, you will see it working in places nobody mentions.',
      ],
      mockOnScreenVariants: ['{topic} IN ONE SENTENCE', 'NOW YOU SEE IT EVERYWHERE'],
    },
    {
      id: 'cta',
      label: 'Call to action',
      weight: 0.1,
      narrationDirective: 'One sentence pointing at the natural next concept, framed as a continuation of this click.',
      visualDirective: 'Next-concept teaser frame with end-card space.',
      onScreenTextStrategy: 'none',
      mockNarrationVariants: [
        'The next piece explains exactly that — follow so {topic} part two finds you.',
        'And the natural sequel to {topic} is even better. It posts next.',
      ],
    },
  ],
  durationBands: {
    '9:16': { minSeconds: 45, idealSeconds: 75, maxSeconds: 150 },
    '16:9': { minSeconds: 180, idealSeconds: 420, maxSeconds: 900 },
  },
  visualStylePresets: [
    {
      id: 'chalkboard-minimal',
      label: 'Chalkboard minimal',
      promptFragment: 'dark chalkboard texture, hand-drawn white diagrams, minimal color accent',
    },
    {
      id: 'motion-infographic',
      label: 'Motion infographic',
      promptFragment: 'flat vector infographic animation, generous negative space, brand accent colors',
    },
  ],
  musicMoods: [
    { id: 'focus-lofi', label: 'Focus lo-fi', searchTerms: ['lo-fi study beat', 'soft focus instrumental'] },
    { id: 'light-orchestral', label: 'Light orchestral', searchTerms: ['light orchestral wonder', 'gentle strings discovery'] },
  ],
  captionStyleDefault: {
    id: 'concept-chips',
    wordsPerCue: 5,
    alignment: 'bottom',
    emphasisLabels: ['means', 'because', 'rule', 'step'],
  },
  pacing: {
    wordsPerSecond: 2.5,
    idealSceneSeconds: 8,
    minSceneMs: 1500,
    maxSceneMs: 30_000,
  },
};
