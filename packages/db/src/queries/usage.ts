import type { UsageOperation, UsageReportDTO } from '@studio/domain';

import type { StudioDbClient } from '../clients.js';

// Usage aggregation. Raw events in range are fetched page-by-page — an
// unpaginated select would be silently truncated at the PostgREST
// max-rows cap, and a quietly short cost report is exactly the failure
// this surface exists to prevent — then folded in TypeScript: one code
// path, trivially testable, no SQL view to keep in sync with the API shape.

/** UTC 'YYYY-MM' for a timestamp string (PostgREST ISO format). */
function periodOf(recordedAt: string): string {
  return recordedAt.slice(0, 7);
}

/** First day of the month `months - 1` months before now, as ISO date. */
export function monthWindowStart(reference: Date, months: number): string {
  const d = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - (months - 1), 1),
  );
  return d.toISOString();
}

/** PostgREST's default SELECT cap: paging at this size keeps the cap from
 *  ever silently trimming a window. */
const PAGE_SIZE = 1000;

export async function usageReport(
  client: StudioDbClient,
  workspaceId: string,
  months = 12,
  now: Date = new Date(),
): Promise<UsageReportDTO> {
  type UsageEventRow = {
    operation: UsageOperation;
    is_mock: boolean;
    recorded_at: string;
  };

  const events: UsageEventRow[] = [];
  // Descending pages until a short one returns: the window is then
  // provably complete, never silently capped.
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from('usage_events')
      .select('operation, is_mock, recorded_at')
      .eq('workspace_id', workspaceId)
      .gte('recorded_at', monthWindowStart(now, months))
      .order('recorded_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`usageReport failed: ${error.message}`);

    const page = (data ?? []) as UsageEventRow[];
    events.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const rows = new Map<string, {
    operations: Map<string, number>;
    realRequests: number;
    mockRequests: number;
  }>();

  for (const event of events) {
    const key = periodOf(event.recorded_at);
    const row = rows.get(key) ?? {
      operations: new Map<string, number>(),
      realRequests: 0,
      mockRequests: 0,
    };
    row.operations.set(event.operation, (row.operations.get(event.operation) ?? 0) + 1);
    if (event.is_mock) row.mockRequests += 1;
    else row.realRequests += 1;
    rows.set(key, row);
  }

  return {
    months: [...rows.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .slice(0, months)
      .map(([period, row]) => ({
        period,
        operations: Object.fromEntries(row.operations),
        realRequests: row.realRequests,
        mockRequests: row.mockRequests,
      })),
  };
}
