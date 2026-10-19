import { z } from 'zod';

import {
  AspectRatioSchema,
  NicheKeySchema,
  ProjectStatusSchema,
  ScriptFormatSchema,
} from './enums.js';

export const PROJECT_TITLE_MAX = 120;
export const TOPIC_MAX = 300;
export const INSTRUCTIONS_MAX = 2000;

// ProjectConfig is stored as a jsonb column on public.projects and validated
// with this schema on every write.
export const ProjectConfigSchema = z.object({
  aspectRatio: AspectRatioSchema,
  // Global sanity bounds only — the niche's per-aspect duration band is
  // enforced at the API layer (@studio/niches durationBandFor) because bands
  // are template-scoped, not shape-level concerns.
  targetDurationSeconds: z.number().int().min(10).max(3600),
  format: ScriptFormatSchema,
  visualStyleId: z.string().min(1).max(64).optional(),
  musicMoodId: z.string().min(1).max(64).optional(),
  captionStyleId: z.string().min(1).max(64).optional(),
  instructions: z.string().max(INSTRUCTIONS_MAX).optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const createProjectSchema = z.object({
  niche: NicheKeySchema,
  topic: z.string().trim().min(3).max(TOPIC_MAX),
  title: z.string().trim().min(1).max(PROJECT_TITLE_MAX).optional(),
  config: ProjectConfigSchema,
  autoGenerate: z.boolean().default(true),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(PROJECT_TITLE_MAX).optional(),
    topic: z.string().trim().min(3).max(TOPIC_MAX).optional(),
    niche: NicheKeySchema.optional(),
    config: ProjectConfigSchema.partial().optional(),
    status: z.enum(['draft', 'archived']).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'at least one field is required',
  });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const ProjectDTOSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  title: z.string(),
  niche: NicheKeySchema,
  topic: z.string(),
  config: ProjectConfigSchema,
  status: ProjectStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ProjectDTO = z.infer<typeof ProjectDTOSchema>;
