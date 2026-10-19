import type { NicheTemplate } from '../types.js';

export const automotiveTemplate: NicheTemplate = {
  key: 'automotive',
  label: 'Automotive',
  description: 'Listicle breakdowns of cars, mods, and automotive culture with a verdict.',
  defaultFormat: 'listicle',
  promptFragments: {
    system:
      'You are an automotive content writer: part journalist, part enthusiast. You write tight, spec-momented listicles with real, checkable details.',
    audience: 'car enthusiasts who distrust hype and want numbers, history, and honest verdicts',
    constraints: [
      'Every claim must be publicly verifiable — real specs, real model years, real production numbers.',
      'Give each list item one crisp credential (a spec, a year, a record) before the opinion.',
      'No brand tribalism; praise and criticize by evidence, not loyalty.',
    ],
  },
  beats: [
    {
      id: 'hook',
      label: 'The hook',
      weight: 0.14,
      narrationDirective:
        'Lead with the car angle of the topic plus one number or record. Frame why gearheads care about {topic} specifically.',
      visualDirective: 'Hero motion shot or detail macro; motion blur welcome.',
      onScreenTextStrategy: 'question',
      soundCue: 'engine start',
      mockNarrationVariants: [
        'Most people get {topic} completely wrong, and the numbers prove it.',
        'There is one version of {topic} that collectors will not talk about in public.',
        'The story of {topic} comes down to a single spec sheet most reviewers skip.',
      ],
      mockOnScreenVariants: ['WHY {topic} MATTERS', 'THE NUMBER NOBODY QUOTES'],
    },
    {
      id: 'setup',
      label: 'The setup',
      weight: 0.1,
      narrationDirective: 'Frame the list: what criteria, what era, what counts. One or two sentences.',
      visualDirective: 'Trim walkaround or era montage.',
      onScreenTextStrategy: 'statement',
      mockNarrationVariants: [
        'To judge {topic} fairly, stick to the facts that survived the marketing.',
        'Here is the {topic} rundown: five entries, one verdict, zero hype.',
        'The rules for this {topic} list are simple — by the numbers only.',
      ],
      mockOnScreenVariants: ['THE RUNDOWN', 'BY THE NUMBERS ONLY'],
    },
    {
      id: 'rundown',
      label: 'The rundown',
      weight: 0.5,
      narrationDirective:
        'One entry per scene: credential, context in one line, why it ranks. Entries must be distinct, no repeats.',
      visualDirective: 'Distinct track or street footage per entry; spec overlays.',
      onScreenTextStrategy: 'statement',
      soundCue: 'rev blip',
      mockNarrationVariants: [
        'First up: the one spec in {topic} that changed the segment permanently.',
        'Next entry — the {topic} version everyone quotes and almost nobody has driven.',
        'Third: the dark-horse of {topic} that beat the badge equity on merit.',
        'Fourth entry, and this is where {topic} gets genuinely weird.',
        'Last entry — the pinnacle {topic} build that closed the argument.',
      ],
      mockOnScreenVariants: ['ENTRY ONE', 'NEXT UP', 'THE DARK HORSE', 'AND FINALLY'],
    },
    {
      id: 'verdict',
      label: 'The verdict',
      weight: 0.16,
      narrationDirective: 'Pick a winner and defend it in one breath with the credential that decides it.',
      visualDirective: 'The winner, held on a locked-off beauty shot.',
      onScreenTextStrategy: 'statement',
      soundCue: 'exhaust pop',
      mockNarrationVariants: [
        'So the verdict on {topic} comes down to what it did, not what it was badged as.',
        'One {topic} entry does everything the others do, minus the excuses.',
        'Which makes the {topic} winner the one that never needed the marketing.',
      ],
      mockOnScreenVariants: ['THE VERDICT', 'WINNER — BY THE NUMBERS'],
    },
    {
      id: 'cta',
      label: 'Call to action',
      weight: 0.1,
      narrationDirective: 'One-line send-off to the next breakdown or a question that bait comments.',
      visualDirective: 'Rolling shot with end-card room.',
      onScreenTextStrategy: 'none',
      mockNarrationVariants: [
        'Follow for the next breakdown — {topic} is only round one.',
        'Disagree with the {topic} order? The comments are the next lap.',
      ],
    },
  ],
  durationBands: {
    '9:16': { minSeconds: 30, idealSeconds: 75, maxSeconds: 120 },
    '16:9': { minSeconds: 60, idealSeconds: 180, maxSeconds: 360 },
  },
  visualStylePresets: [
    {
      id: 'showroom-clean',
      label: 'Showroom clean',
      promptFragment: 'clean studio automotive lighting, polished paint reflections, precise detail shots',
    },
    {
      id: 'night-drive-neon',
      label: 'Night drive neon',
      promptFragment: 'wet asphalt at night, neon rim lighting, cinematic teal-orange grade',
    },
  ],
  musicMoods: [
    { id: 'engine-bass', label: 'Engine + bass', searchTerms: ['heavy bass electronic', 'engine rev hybrid edit'] },
    { id: 'garage-rock', label: 'Garage rock', searchTerms: ['garage rock instrumental', 'driving rock riff'] },
  ],
  captionStyleDefault: {
    id: 'spec-bold',
    wordsPerCue: 4,
    alignment: 'bottom',
    emphasisLabels: ['zero', 'sixty', 'records', 'only'],
  },
  pacing: {
    wordsPerSecond: 2.7,
    idealSceneSeconds: 7,
    minSceneMs: 1200,
    maxSceneMs: 25_000,
  },
};
