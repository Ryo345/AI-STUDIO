import { z } from 'zod';

import { ProjectStatusSchema } from '../enums.js';

// Shared query-string schema fragments (limit/offset coerced from strings,
// since searchParams arrive as text).

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const projectListQuerySchema = paginationQuerySchema.extend({
  status: ProjectStatusSchema.optional(),
});

export const projectJobsQuerySchema = paginationQuerySchema;

export const usageQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(12).default(12),
});
