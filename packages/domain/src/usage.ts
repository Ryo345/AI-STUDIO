import { z } from 'zod';

// Usage accounting keeps expensive operations visible: every script (later
// every TTS/image/render call) lands in public.usage_events, and this is the
// aggregated shape the dashboard consumes. Mock rows are counted separately
// (mockRequests) so placeholder output is visible but honestly priced.

import { ScriptwriterProviderIdSchema } from './enums.js';

export const USAGE_OPERATIONS = ['script.generate'] as const;
export type UsageOperation = (typeof USAGE_OPERATIONS)[number];

/** One provider call recorded against a workspace. */
export const UsageEventSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid().nullable(),
  jobId: z.uuid().nullable(),
  providerId: ScriptwriterProviderIdSchema,
  operation: z.enum(USAGE_OPERATIONS),
  quantity: z.number(),
  unit: z.string().min(1),
  isMock: z.boolean(),
  recordedAt: z.iso.datetime({ offset: true }),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;

export const UsageReportRowSchema = z.object({
  /** 'YYYY-MM' */
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /** operation id → request count in this period */
  operations: z.record(z.string(), z.number().int()),
  realRequests: z.number().int().min(0),
  mockRequests: z.number().int().min(0),
});
export type UsageReportRow = z.infer<typeof UsageReportRowSchema>;

export const UsageReportDTOSchema = z.object({
  months: z.array(UsageReportRowSchema).max(12),
});
export type UsageReportDTO = z.infer<typeof UsageReportDTOSchema>;
