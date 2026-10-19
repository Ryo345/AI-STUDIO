import type { NicheTemplate } from '../types.js';

export const gamingTemplate: NicheTemplate = {
  key: 'gaming',
  label: 'Gaming',
  description: 'Fast listicle hits — lore, secrets, glitches, rankings, and takes with receipts.',
  defaultFormat: 'listicle',
  promptFragments: {
    system:
      'You are a gaming content writer who is fluent in the culture but allergic to empty hype. Every listicle entry is backed by something checkable — a clip, a patch note, a quote.',
    audience: 'players who have seen every generic top-ten and want specifics, dates, and receipts',
    constraints: [
      'Every entry cites something concrete: a patch version, a developer quote, a year, or the mechanic itself.',
      'Never present an exploit or glitch as a recommendation in live games; call it history.',
      'Keep the energy high-speed but the claims exactly accurate.',
    ],
  },
  beats: [
    {
      id: 'hook',
      label: 'The hook',
      weight: 0.15,
      narrationDirective:
        'Open with the single most absurd true fact about {topic}, said fast. Promise the list in one breath.',
      visualDirective: 'The most iconic frame of the topic, hit with an instant hard cut.',
      onScreenTextStrategy: 'question',
      soundCue: 'ui blip',
      mockNarrationVariants: [
        'The {topic} story has one moment even the devs could not believe shipped.',
        'There are things about {topic} that only speedrunners ever found — and here they are.',
        'Almost nobody knows which corner of {topic} still hides the strangest bug in the game.',
      ],
      mockOnScreenVariants: ['THE WILDEST {topic} FACT', 'STILL IN THE GAME?'],
    },
    {
      id: 'setup',
      label: 'The setup',
      weight: 0.1,
      narrationDirective: 'Frame the list in one sentence — how many, by what standard.',
      visualDirective: 'Menu or loadout montage; quick.',
      onScreenTextStrategy: 'statement',
      mockNarrationVariants: [
        'Here is the {topic} rundown, judged by one standard: receipts only.',
        'Five {topic} entries, each one provable by the patch notes that shipped it.',
        'The {topic} list is simple — it only counts if the game itself admits it happened.',
      ],
      mockOnScreenVariants: ['FIVE ENTRIES', 'RECEIPTS ONLY'],
    },
    {
      id: 'list',
      label: 'The list',
      weight: 0.45,
      narrationDirective:
        'One entry per scene at full pace: the claim, the receipt, one clean quip. Every entry distinct in kind.',
      visualDirective: 'Gameplay or patch-note overlays per entry; hard cuts, no dead frames.',
      onScreenTextStrategy: 'statistic',
      soundCue: 'combo',
      mockNarrationVariants: [
        'Entry one — the {topic} detail that took nine years for anyone to notice.',
        'Number two: the {topic} bug that shipped in patch notes as a "known issue" and never left.',
        'Third entry — the corner of {topic} that speedrunners weaponized within a week.',
        'Number four, and this {topic} one is in the files but never once appeared in game.',
        'The {topic} finale: the entry the developers themselves called a mistake on record.',
      ],
      mockOnScreenVariants: ['ENTRY ONE', 'KNOW YOUR PATCH NOTES', 'IN THE FILES', 'ON RECORD'],
    },
    {
      id: 'twist',
      label: 'The twist',
      weight: 0.15,
      narrationDirective:
        'The one entry that breaks the list — either the best or the one still undiscovered. Frame it as the payoff of watching.',
      visualDirective: 'The screenshot or clip everyone will pause on.',
      onScreenTextStrategy: 'statement',
      soundCue: 'reveal sting',
      mockNarrationVariants: [
        'And then there is the {topic} entry that breaks the entire ranking.',
        'Because the deepest cut of {topic} is one the community never got to fully solve.',
        'But the real ending of any {topic} list is the one nobody can confirm yet.',
      ],
      mockOnScreenVariants: ['THE ENTRY THAT BREAKS IT', 'UNSOLVED, STILL'],
    },
    {
      id: 'cta',
      label: 'Call to action',
      weight: 0.15,
      narrationDirective: 'One quick send-off — a comment-bait question or the next list teaser.',
      visualDirective: 'Quick end-card frame, room for follow overlay.',
      onScreenTextStrategy: 'none',
      mockNarrationVariants: [
        'Follow before you get to the comments — the {topic} follow-up is next week.',
        'Which {topic} entry did we miss? Read that — the comments decide the sequel.',
      ],
    },
  ],
  durationBands: {
    '9:16': { minSeconds: 30, idealSeconds: 60, maxSeconds: 120 },
    '16:9': { minSeconds: 120, idealSeconds: 240, maxSeconds: 480 },
  },
  visualStylePresets: [
    {
      id: 'neon-glitch',
      label: 'Neon glitch',
      promptFragment: 'vibrant neon palette, glitch-art transitions, high-contrast HUD-inspired overlays',
    },
    {
      id: 'esports-bold',
      label: 'Esports bold',
      promptFragment: 'dark arena backgrounds, bold saturated accents, sharp geometric overlays',
    },
  ],
  musicMoods: [
    { id: 'synthwave', label: 'Synthwave', searchTerms: ['synthwave instrumental', 'retro synth pulse'] },
    { id: 'edm-hype', label: 'EDM hype', searchTerms: ['high energy edm edit', 'gaming montage track'] },
  ],
  captionStyleDefault: {
    id: 'combo-pop',
    wordsPerCue: 3,
    alignment: 'center',
    emphasisLabels: ['never', 'patch', 'shipped', 'unsolved'],
  },
  pacing: {
    wordsPerSecond: 2.8,
    idealSceneSeconds: 6,
    minSceneMs: 1000,
    maxSceneMs: 20_000,
  },
};
