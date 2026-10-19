import { z } from 'zod';

import { OnScreenTextStrategySchema, ScriptwriterProviderIdSchema } from './enums.js';

// ── Canonical generated-script shapes (provider-agnostic) ─────────────────
// Every provider — including the mock — produces objects that parse against
// GeneratedScriptSchema. Providers return their own shape and are funneled
// through @studio/pipeline normalizeGeneratedScript before persisting.

export const SoundCueSchema = z.object({
  name: z.string().min(1).max(64),
  atMs: z.number().int().min(0).optional(),
});
export type SoundCue = z.infer<typeof SoundCueSchema>;

export const GeneratedSceneSchema = z.object({
  beatId: z.string().min(1).max(64),
  index: z.number().int().min(0),
  summary: z.string().min(1).max(120),
  narration: z.string().min(1).max(4000),
  visualDescription: z.string().min(1).max(2000),
  onScreenText: z.string().max(120).nullable(),
  onScreenTextStrategy: OnScreenTextStrategySchema,
  durationMs: z.number().int().min(800).max(60_000),
  soundCues: z.array(SoundCueSchema).max(4).default([]),
});
export type GeneratedScene = z.infer<typeof GeneratedSceneSchema>;

export const GeneratedScriptSchema = z.object({
  title: z.string().min(1).max(200),
  scenes: z.array(GeneratedSceneSchema).min(3).max(40),
  totalDurationMs: z.number().int().min(0),
});
export type GeneratedScript = z.infer<typeof GeneratedScriptSchema>;

// Honest provenance for every script: mock output is unfalsifiably labeled.
export const ScriptProvenanceSchema = z.object({
  providerId: ScriptwriterProviderIdSchema,
  model: z.string().nullable(),
  isMock: z.boolean(),
  seed: z.string().min(1),
  latencyMs: z.number().int().min(0),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
});
export type ScriptProvenance = z.infer<typeof ScriptProvenanceSchema>;

// ── DTOs surfaced by the API ─────────────────────────────────────────────

export const ScriptVersionDTOSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  versionNumber: z.number().int().positive(),
  provenance: ScriptProvenanceSchema,
  createdAt: z.iso.datetime({ offset: true }),
});
export type ScriptVersionDTO = z.infer<typeof ScriptVersionDTOSchema>;

export const SceneDTOSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  position: z.number().int().min(0),
  originScriptVersionId: z.uuid(),
  narration: z.string().min(1).max(4000),
  visualDescription: z.string().max(2000),
  onScreenText: z.string().max(120).nullable(),
  durationMs: z.number().int().min(800).max(60_000),
  soundCues: z.array(SoundCueSchema),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type SceneDTO = z.infer<typeof SceneDTOSchema>;

// ── Edit inputs ───────────────────────────────────────────────────────────

export const patchSceneSchema = z
  .strictObject({
    narration: z.string().min(1).max(4000).optional(),
    visualDescription: z.string().min(1).max(2000).optional(),
    onScreenText: z.string().max(120).nullable().optional(),
    durationMs: z.number().int().min(800).max(60_000).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'at least one field is required',
  });
export type PatchSceneInput = z.infer<typeof patchSceneSchema>;

export const reorderScenesSchema = z.strictObject({
  sceneIds: z.array(z.uuid()).min(1).max(40),
});

export const generateScriptSchema = z.strictObject({
  instructions: z.string().max(1000).optional(),
});
export type GenerateScriptInput = z.infer<typeof generateScriptSchema>;
