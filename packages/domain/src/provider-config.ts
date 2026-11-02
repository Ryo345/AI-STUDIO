// BYOK provider configuration contracts — provider_connections rows (masked
// metadata only; the encrypted credential never appears here) and
// model_assignments rows (the task→provider/model router). Mirrors
// migration 0006_byok_model_router.sql.

import { z } from 'zod';

import { AiTaskSchema, ConnectionProviderIdSchema, ConnectionStatusSchema, type AiTask, RoutingTaskSchema } from './enums.js';

// ── Provider connections ─────────────────────────────────────────────────

export const TestErrorSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(500),
});
export type TestError = z.infer<typeof TestErrorSchema>;

export const ProviderConnectionDTOSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  createdBy: z.uuid().nullable(),
  providerId: ConnectionProviderIdSchema,
  // Custom endpoint (null = provider hosted default). Never a secret.
  baseUrl: z.url().nullable(),
  // Masked display form ('nvapi-…9f2c') — derived at write time; readers
  // never see the ciphertext, let alone the key.
  keyHint: z.string().min(4).max(40),
  status: ConnectionStatusSchema,
  lastTestedAt: z.iso.datetime({ offset: true }).nullable(),
  lastTestError: TestErrorSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ProviderConnectionDTO = z.infer<typeof ProviderConnectionDTOSchema>;

/** POST /api/v1/providers/connections — key is consumed server-side, never stored raw, never echoed back. */
export const createProviderConnectionSchema = z
  .object({
    providerId: ConnectionProviderIdSchema,
    apiKey: z.string().trim().min(8, 'API key is too short').max(4096),
    // Required only for openai-compatible (no hosted default exists); the
    // named providers fall back to their built-in base URLs when omitted.
    baseUrl: z.url().max(500).optional(),
  })
  .refine((data) => data.providerId !== 'openai-compatible' || !!data.baseUrl, {
    message: 'openai-compatible connections require a baseUrl',
    path: ['baseUrl'],
  });
export type CreateProviderConnectionInput = z.infer<typeof createProviderConnectionSchema>;

/** PATCH /api/v1/providers/connections/[id] — replace the key (resets test status). */
export const updateProviderConnectionSchema = z.object({
  apiKey: z.string().trim().min(8, 'API key is too short').max(4096),
});
export type UpdateProviderConnectionInput = z.infer<typeof updateProviderConnectionSchema>;

/** Result of POST …/test — mirrored into status/last_test_error. */
export const connectionTestResultSchema = z.object({
  ok: z.boolean(),
  status: ConnectionStatusSchema,
  testedAt: z.iso.datetime({ offset: true }),
  error: TestErrorSchema.nullable(),
});
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

// ── Model router (model_assignments) ─────────────────────────────────────

export const ModelAssignmentDTOSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  task: AiTaskSchema,
  providerId: ConnectionProviderIdSchema,
  model: z.string().min(1).max(200),
  // Generation settings (temperature, top_p, …) — free-form here, validated
  // per-provider when a call is built; keeps new provider parameters
  // migration-free.
  settings: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ModelAssignmentDTO = z.infer<typeof ModelAssignmentDTOSchema>;

/** PUT /api/v1/model-assignments — upsert one row per (workspace, task). */
export const upsertModelAssignmentSchema = z.object({
  task: AiTaskSchema,
  providerId: ConnectionProviderIdSchema,
  model: z.string().trim().min(1).max(200),
  settings: z.record(z.string(), z.unknown()).optional().default({}),
});
export type UpsertModelAssignmentInput = z.infer<typeof upsertModelAssignmentSchema>;

/**
 * Router resolution, pure and total: the task's own row wins, then the
 * workspace 'default' row, then undefined (caller falls back to env config).
 */
export function resolveModelAssignment<T extends { task: AiTask }>(
  assignments: readonly T[],
  task: z.infer<typeof RoutingTaskSchema>,
): T | undefined {
  return assignments.find((a) => a.task === task) ?? assignments.find((a) => a.task === 'default');
}
