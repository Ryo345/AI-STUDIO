// Prompt builder — the single home for the real-LLM scriptwriter prompt.
// The niche template carries the persona, audience, constraints, and beat
// directives; this module assembles them with the project's config into a
// system + user prompt pair and pins the exact JSON contract the
// normalizer will parse. The mock never uses this — it reads the same
// template data structurally, without prose.

import type { AspectRatio, ScriptFormat } from '@studio/domain';
import { durationBandFor, type NicheTemplate } from '@studio/niches';

import { allocateBeats } from './beats.js';
import { planSceneCount } from './timing.js';

export const PROMPT_VERSION = '0.1.0';

export interface ScriptPromptInput {
  topic: string;
  format: ScriptFormat;
  aspectRatio: AspectRatio;
  targetDurationSeconds: number;
  /** User-supplied steering from the wizard / project config. */
  instructions?: string;
}

export interface ScriptPrompt {
  system: string;
  user: string;
}

const JSON_CONTRACT = `Respond with ONLY a JSON object — no prose before or after, no markdown fences — matching exactly this shape:

{
  "title": string (1-200 chars),
  "scenes": [
    {
      "beatId": string (the beat id from the structure section),
      "index": number (0-based, sequential),
      "summary": string (1-120 chars, what the scene is doing),
      "narration": string (1-4000 chars, speakable aloud),
      "visualDescription": string (1-2000 chars, concrete imagery),
      "onScreenText": string (max 120 chars) or null,
      "onScreenTextStrategy": "question" | "statement" | "statistic" | "none",
      "durationMs": number (800-60000),
      "soundCues": [{"name": string (max 64), "atMs": number (optional, >= 0)}] (max 4)
    }
  ],
  "totalDurationMs": number
}

Rules:
- 3 to 40 scenes; follow the beat plan and scene counts given above.
- narration must be plain speakable text — no stage directions, markdown, or emoji.
- totalDurationMs must equal the sum of all scene durationMs.
- Every claim must be based on widely reported facts; never invent statistics or sources.`;

/**
 * Build the scriptwriter prompt pair for a real LLM. Pure: same template +
 * input always produce the same prompt (prompt regressions are reviewable
 * as diffs).
 */
export function buildScriptPrompt(template: NicheTemplate, input: ScriptPromptInput): ScriptPrompt {
  const band = durationBandFor(template, input.aspectRatio);
  const sceneCount = planSceneCount(template.pacing, input.targetDurationSeconds);
  const allocation = allocateBeats(template.beats, sceneCount);

  const structure = template.beats
    .map((beat, index) => {
      const count = allocation[index] ?? 0;
      if (count === 0) return null;
      return [
        `- beat "${beat.id}" (${beat.label}) — produce ~${count} scene(s)`,
        `  narration: ${beat.narrationDirective}`,
        `  visuals: ${beat.visualDirective}`,
        `  on-screen text strategy: ${beat.onScreenTextStrategy}${beat.soundCue ? `; sound cue name: "${beat.soundCue}"` : ''}`,
      ].join('\n');
    })
    .filter((line): line is string => line !== null)
    .join('\n');

  const sections: string[] = [
    `TOPIC\n${input.topic.trim()}`,
    `AUDIENCE\n${template.promptFragments.audience}`,
    `FORMAT\n${input.format}, ${input.aspectRatio}, target total duration ${input.targetDurationSeconds}s (accepted range for this niche: ${band.minSeconds}-${band.maxSeconds}s), plan ~${sceneCount} scenes`,
    `STRUCTURE\n${structure}`,
    `CONSTRAINTS\n${template.promptFragments.constraints.map((constraint) => `- ${constraint}`).join('\n')}`,
  ];

  const instructions = (input.instructions ?? '').trim();
  if (instructions) {
    sections.push(`USER INSTRUCTIONS (obey unless they conflict with the constraints above)\n${instructions}`);
  }
  sections.push(JSON_CONTRACT);

  const personaLine = template.promptFragments.system;
  const nicheLine = `You are writing a short-form video script for the "${template.label}" niche.`;

  return {
    system: `${nicheLine} ${personaLine}`,
    user: sections.join('\n\n'),
  };
}
