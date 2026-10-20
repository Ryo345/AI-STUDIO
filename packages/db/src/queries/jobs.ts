import { ApiError, type JobDTO, type JobEventDTO, type JobStatus } from '@studio/domain';

import type { StudioDbClient } from '../clients.js';
import { mapJobRow, mapJobEventRow, type DbRow } from '../mappers.js';

// Postgres error codes the queue relies on; surfaced through the shared
// API error envelope so a DB constraint becomes a specific HTTP answer
// (409 unique_active_job) instead of a generic 500.
const PG_UNIQUE_VIOLATION = '23505';

export async function getJobRow(client: StudioDbClient, jobId: string): Promise<JobDTO | null> {
  const { data, error } = await client
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(`getJobRow failed: ${error.message}`);
  return data ? mapJobRow(data as DbRow) : null;
}

export async function listProjectJobs(
  client: StudioDbClient,
  projectId: string,
  query: { limit: number; offset: number },
): Promise<JobDTO[]> {
  const { data, error } = await client
    .from('jobs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);
  if (error) throw new Error(`listProjectJobs failed: ${error.message}`);
  return ((data ?? []) as DbRow[]).map(mapJobRow);
}

export async function listJobEvents(
  client: StudioDbClient,
  jobId: string,
  limit = 50,
): Promise<JobEventDTO[]> {
  // Newest first, reversed back to chronological: the LATEST `limit`
  // events are the ones worth showing. An ascending fetch would silently
  // hide the newest failure/cancel/success once a job's history outgrew
  // the limit.
  const { data, error } = await client
    .from('job_events')
    .select('*')
    .eq('job_id', jobId)
    .order('at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listJobEvents failed: ${error.message}`);
  return ((data ?? []) as DbRow[]).map(mapJobEventRow).reverse();
}

export async function hasActiveJob(client: StudioDbClient, projectId: string): Promise<boolean> {
  const { data, error } = await client
    .from('jobs')
    .select('id')
    .eq('project_id', projectId)
    .in('status', ['pending', 'running'] satisfies JobStatus[])
    .limit(1);
  if (error) throw new Error(`hasActiveJob failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Dashboard helper: the active (pending/running) jobs for a batch of
 * projects, grouped by projectId. RLS-scoped by the caller's client, so a
 * user only ever sees their own workspaces' jobs regardless of the id list.
 */
export async function listActiveJobsByProject(
  client: StudioDbClient,
  projectIds: string[],
): Promise<Map<string, JobDTO[]>> {
  const byProject = new Map<string, JobDTO[]>();
  if (projectIds.length === 0) return byProject;

  const { data, error } = await client
    .from('jobs')
    .select('*')
    .in('project_id', projectIds)
    .in('status', ['pending', 'running'] satisfies JobStatus[])
    .order('created_at', { ascending: true });

  if (error) throw new Error(`listActiveJobsByProject failed: ${error.message}`);
  for (const row of (data ?? []) as DbRow[]) {
    const job = mapJobRow(row);
    if (!job.projectId) continue; // Phase 3 non-project jobs, not shown here
    const list = byProject.get(job.projectId) ?? [];
    list.push(job);
    byProject.set(job.projectId, list);
  }
  return byProject;
}

export interface EnqueueScriptGeneration {
  workspaceId: string;
  projectId: string;
  /** Must be the calling session's user id — the INSERT policy pins created_by. */
  createdBy: string;
  payload: Record<string, unknown>;
}

/**
 * Enqueue one script.generate job through the CALLER's client. Inserting via
 * the user-session client passes the jobs INSERT RLS policy: editor
 * membership, the project-must-be-in-the-same-workspace smuggling guard, a
 * pristine-pending row shape (server-owned state is not insertable), and
 * created_by pinned to the caller. The partial unique index makes a double
 * enqueue impossible: the second insert raises 23505 which becomes
 * ApiError('unique_active_job') → HTTP 409.
 */
export async function enqueueScriptGeneration(
  client: StudioDbClient,
  input: EnqueueScriptGeneration,
): Promise<JobDTO> {
  const { data, error } = await client
    .from('jobs')
    .insert({
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      type: 'script.generate',
      status: 'pending',
      payload: input.payload,
      created_by: input.createdBy,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      throw new ApiError(
        'unique_active_job',
        'A script generation job is already pending or running for this project',
      );
    }
    if (error.code === '42501') {
      throw new ApiError('forbidden', 'editor role required to enqueue jobs');
    }
    throw new Error(`enqueueScriptGeneration failed: ${error.message}`);
  }
  return mapJobRow(data as DbRow);
}
