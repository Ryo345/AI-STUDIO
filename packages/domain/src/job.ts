import { z } from 'zod';

import {
  JobStatusSchema,
  JobTypeSchema,
  ScriptwriterProviderIdSchema,
} from './enums.js';

// ── Job payloads (per-type, parsed by the worker handler) ─────────────────

export const ScriptGeneratePayloadSchema = z
  .object({
    instructions: z.string().max(1000).optional(),
  })
  .default({});
export type ScriptGeneratePayload = z.infer<typeof ScriptGeneratePayloadSchema>;

// ── Job results (per-type) ────────────────────────────────────────────────

export const ScriptGenerateResultSchema = z.object({
  versionNumber: z.number().int().positive(),
  sceneCount: z.number().int().positive(),
  totalDurationMs: z.number().int().min(0),
  providerId: ScriptwriterProviderIdSchema,
  isMock: z.boolean(),
});
export type ScriptGenerateResult = z.infer<typeof ScriptGenerateResultSchema>;

export const JobErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
});
export type JobError = z.infer<typeof JobErrorSchema>;

// ── Wire DTOs ─────────────────────────────────────────────────────────────

export const JobDTOSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid().nullable(),
  type: JobTypeSchema,
  status: JobStatusSchema,
  attempt: z.number().int().min(0),
  maxAttempts: z.number().int().min(1),
  cancelRequested: z.boolean(),
  error: JobErrorSchema.nullable(),
  result: ScriptGenerateResultSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type JobDTO = z.infer<typeof JobDTOSchema>;

export const JobEventDTOSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  kind: z.string().min(1),
  detail: z.record(z.string(), z.unknown()).default({}),
  at: z.iso.datetime({ offset: true }),
});
export type JobEventDTO = z.infer<typeof JobEventDTOSchema>;
