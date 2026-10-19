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
export const ScriptwriterProviderIdSchema = z.enum(['mock', 'anthropic', 'openai-compatible']);
export type ScriptwriterProviderId = z.infer<typeof ScriptwriterProviderIdSchema>;

// ── On-screen text strategy (drives mock copy + Phase 2 caption styling) ──
export const OnScreenTextStrategySchema = z.enum(['question', 'statement', 'statistic', 'none']);
export type OnScreenTextStrategy = z.infer<typeof OnScreenTextStrategySchema>;
