import { z } from 'zod';

// ── Core enums shared by API contracts, DB rows, and provider output ──────
// @studio/domain is the source of truth; supabase/migrations mirror these as
// Postgres enum types so bad data cannot poison the database either.

export const AspectRatioSchema = z.enum(['9:16', '16:9']);
export type AspectRatio = z.infer<typeof AspectRatioSchema>;

export const ProjectStatusSchema = z.enum(['draft', 'generating', 'ready', 'editing', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const NicheKeySchema = z.enum([
  'horror',
  'automotive',
  'education',
  'documentary',
  'gaming',
  'custom',
]);
export type NicheKey = z.infer<typeof NicheKeySchema>;

export const ScriptFormatSchema = z.enum(['narrative', 'listicle', 'explainer']);
export type ScriptFormat = z.infer<typeof ScriptFormatSchema>;

export const WorkspaceRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

// ── Jobs ─────────────────────────────────────────────────────────────────
export const JobStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** Statuses a job never leaves without a retry_job call. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['succeeded', 'failed', 'cancelled'] as const;

export const JobTypeSchema = z.enum(['script.generate']);
export type JobType = z.infer<typeof JobTypeSchema>;
// Phase 2 appends values ('voiceover.generate', 'media.resolve', 'render.video', …)
// via a dedicated ALTER TYPE migration BEFORE any code references them.

// ── Providers ─────────────────────────────────────────────────────────────
export const ScriptwriterProviderIdSchema = z.enum(['mock', 'anthropic', 'openai-compatible', 'nvidia-nim']);
export type ScriptwriterProviderId = z.infer<typeof ScriptwriterProviderIdSchema>;

/**
 * Providers a workspace can hold BYOK credentials for. mock is platform-side
 * (dev only, no key) and is deliberately excluded — BYOK is for real keys.
 * Grows by migration + adapter together (value sets change only with code
 * that also changes writers).
 */
export const ConnectionProviderIdSchema = z.enum(['anthropic', 'openai-compatible', 'nvidia-nim']);
export type ConnectionProviderId = z.infer<typeof ConnectionProviderIdSchema>;

/** Connection test lifecycle, mirrored by provider_connections.status. */
export const ConnectionStatusSchema = z.enum(['untested', 'active', 'failed']);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

/**
 * AI tasks the model router can route. 'default' names the workspace-wide
 * fallback row; every other value is a concrete task a job can ask for.
 * Only script.generate is consumed by the worker today — the rest exist so
 * the routing surface is complete before later phases read them.
 */
export const AiTaskSchema = z.enum([
  'default',
  'script.generate',
  'script.rewrite',
  'research.assist',
  'fact.check',
  'scene.describe',
  'video.title',
  'video.description',
  'seo.metadata',
  'script.quality',
]);
export type AiTask = z.infer<typeof AiTaskSchema>;

/** Concrete (non-fallback) tasks a worker job can request. */
export const RoutingTaskSchema = AiTaskSchema.exclude(['default']);
export type RoutingTask = z.infer<typeof RoutingTaskSchema>;

// ── On-screen text strategy (drives mock copy + Phase 2 caption styling) ──
export const OnScreenTextStrategySchema = z.enum(['question', 'statement', 'statistic', 'none']);
export type OnScreenTextStrategy = z.infer<typeof OnScreenTextStrategySchema>;
