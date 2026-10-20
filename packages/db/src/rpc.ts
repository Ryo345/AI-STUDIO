import {
  ApiError,
  type ApiErrorCode,
  type GeneratedScript,
  type JobDTO,
  type ScriptGenerateResult,
  type ScriptProvenance,
} from '@studio/domain';

import type { StudioDbClient } from './clients.js';
import { mapJobRow, type DbRow } from './mappers.js';

// Typed wrappers around the SECURITY DEFINER RPCs from migration 0003.
// Postgres errcodes raised deliberately by the SQL surface as ApiErrors so
// the web API can answer 401/403/404/409 without knowing SQLSTATE values.
// Everything else rethrows with the RPC name attached — a queue bug should
// never masquerade as a routine condition.

const RPC_POSTGRES_CODES: Record<string, ApiErrorCode> = {
  P0002: 'not_found',
  '42501': 'forbidden',
  '22023': 'validation_error',
  '55000': 'conflict',
  '23505': 'unique_active_job',
};

export class RpcError extends Error {
  constructor(functionName: string, message: string, readonly code?: string) {
    super(`${functionName} failed: ${message}${code ? ` (code ${code})` : ''}`);
    this.name = 'RpcError';
  }
}

type PostgrestError = { message: string; code?: string; details?: string | null };

function unwrap(functionName: string, error: PostgrestError | null): never {
  if (!error) throw new RpcError(functionName, 'unknown error');
  const apiCode = error.code ? RPC_POSTGRES_CODES[error.code] : undefined;
  if (apiCode) throw new ApiError(apiCode, error.message, { pgCode: error.code });
  throw new RpcError(functionName, error.message, error.code);
}

/** RPC error → ApiError passthrough for error.code values we know about. */
export { RPC_POSTGRES_CODES };

// ── Worker-facing (call with the SERVICE client only) ──────────────────

export async function claimJobs(
  client: StudioDbClient,
  workerId: string,
  limit = 2,
): Promise<JobDTO[]> {
  const { data, error } = await client.rpc('claim_jobs', {
    p_worker_id: workerId,
    p_limit: limit,
  });
  if (error) unwrap('claim_jobs', error as PostgrestError);
  return ((data ?? []) as DbRow[]).map(mapJobRow);
}

/**
 * Heartbeat + fused cancel poll. The RPC returns cancel_requested; the
 * wrapper inverts it so the worker contract reads as intent:
 *   true  – keep working
 *   false – cancel was requested: abort the provider call
 *   null  – lock is gone (stolen by reclaim / row deleted): stop immediately
 */
export async function heartbeatJob(
  client: StudioDbClient,
  jobId: string,
  workerId: string,
): Promise<boolean | null> {
  const { data, error } = await client.rpc('heartbeat_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
  });
  if (error) unwrap('heartbeat_job', error as PostgrestError);
  return data === null || data === undefined ? null : !data;
}

export async function jobFailed(
  client: StudioDbClient,
  jobId: string,
  workerId: string,
  error: { code: string; message: string; retryable?: boolean },
): Promise<JobDTO | null> {
  const { data, error: rpcError } = await client.rpc('job_failed', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_error: error,
  });
  if (rpcError) unwrap('job_failed', rpcError as PostgrestError);
  return data ? mapJobRow(data as DbRow) : null;
}

export async function reclaimStaleJobs(
  client: StudioDbClient,
  staleSeconds = 300,
): Promise<number> {
  const { data, error } = await client.rpc('reclaim_stale_jobs', {
    p_stale_seconds: staleSeconds,
  });
  if (error) unwrap('reclaim_stale_jobs', error as PostgrestError);
  return typeof data === 'number' ? data : 0;
}

/**
 * Worker progress mark ("save progress after every stage"). Guarded by the
 * same lock contract as the other worker RPCs: a stolen lock silently
 * drops the event — discarded work must not leave a fake paper trail.
 */
export async function appendJobEvent(
  client: StudioDbClient,
  jobId: string,
  workerId: string,
  kind: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await client.rpc('append_job_event', {
    p_worker_id: workerId,
    p_job_id: jobId,
    p_kind: kind,
    p_detail: detail,
  });
  if (error) unwrap('append_job_event', error as PostgrestError);
}

export interface CompleteScriptGenerationArgs {
  jobId: string;
  workerId: string;
  script: GeneratedScript;
  provenance: ScriptProvenance;
  result: ScriptGenerateResult;
  usage: {
    providerId: string;
    operation: string;
    quantity?: number;
    unit?: string;
    isMock: boolean;
  };
}

/**
 * The atomic fulfillment RPC. The returned row is the truth: when the guard
 * (status='running' AND locked_by=worker) did not hold — lock stolen, job
 * already settled — the row comes back unchanged, telling the worker its
 * work was discarded, not falsely "succeeded". NULL means the job row itself
 * is gone (project deleted mid-run): same discard contract as a null
 * heartbeat.
 */
export async function completeScriptGeneration(
  client: StudioDbClient,
  args: CompleteScriptGenerationArgs,
): Promise<JobDTO | null> {
  const { data, error } = await client.rpc('complete_script_generation', {
    p_job_id: args.jobId,
    p_worker_id: args.workerId,
    p_script: args.script,
    p_provenance: args.provenance,
    p_result: args.result,
    p_usage: args.usage,
  });
  if (error) unwrap('complete_script_generation', error as PostgrestError);
  if (data === null || data === undefined) return null;
  return mapJobRow(data as DbRow);
}

// ── User-facing (call with a user-SESSION client) ────────────────────────

export async function requestJobCancel(
  client: StudioDbClient,
  jobId: string,
): Promise<JobDTO> {
  const { data, error } = await client.rpc('request_job_cancel', { p_job_id: jobId });
  if (error) unwrap('request_job_cancel', error as PostgrestError);
  return mapJobRow(data as DbRow);
}

export async function retryJob(client: StudioDbClient, jobId: string): Promise<JobDTO> {
  const { data, error } = await client.rpc('retry_job', { p_job_id: jobId });
  if (error) unwrap('retry_job', error as PostgrestError);
  return mapJobRow(data as DbRow);
}

export async function reorderScenes(
  client: StudioDbClient,
  projectId: string,
  sceneIds: string[],
): Promise<void> {
  const { error } = await client.rpc('reorder_scenes', {
    p_project_id: projectId,
    p_scene_ids: sceneIds,
  });
  if (error) unwrap('reorder_scenes', error as PostgrestError);
}
