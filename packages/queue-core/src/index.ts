// @studio/queue-core — pure job-queue state machine and backoff math.
// No I/O here: the worker owns all database interaction; this package owns
// transition rules and retry math so they are unit-testable without Supabase.
//
// THE BACKOFF MIRROR: job_failed (0003_queue.sql) schedules retries with
//   run_at = now() + least(30 * 2 ^ v_attempt, 600)
// where v_attempt is the POST-increment attempt number (the first retry
// therefore waits 60s, not 30s). backoffSeconds() reproduces that formula
// exactly — any drift here means the TS-side display/preview math lies
// about what the database will actually do.

import { TERMINAL_JOB_STATUSES, type JobStatus } from '@studio/domain';

export const QUEUE_CORE_VERSION = '0.1.0';

/** Upper bound on a single retry delay, mirroring the SQL `least(…, 600)`. */
export const MAX_BACKOFF_SECONDS = 600;

/**
 * Retry delay for a failed attempt, in seconds.
 *
 * @param attemptAfterIncrement the attempt number AFTER job_failed's
 *   `attempt + 1` — i.e. pass 1 for the first retry. Matches the SQL
 *   `least(30 * 2 ^ v_attempt, 600)` bit for bit.
 */
export function backoffSeconds(attemptAfterIncrement: number): number {
  const n = Math.max(1, Math.trunc(attemptAfterIncrement));
  return Math.min(30 * 2 ** n, MAX_BACKOFF_SECONDS);
}

/**
 * Ergonomic form taking the attempt value as read off a JobDTO (the
 * PRE-increment count) — how the API surface sees it.
 */
export function retryDelaySeconds(failedAttempt: number): number {
  return backoffSeconds(Math.max(0, Math.trunc(failedAttempt)) + 1);
}

/** Statuses a job never leaves without an explicit retry_job call. */
export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/**
 * Heartbeat cadence the worker uses while a job is running. Well under the
 * default stale-lock window (WORKER_STALE_LOCK_SECONDS=300) so a healthy
 * worker never has its lock reclaimed; not env-configurable on purpose —
 * it must stay comfortably inside ANY stale window an operator configures.
 */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Sentinel outcome of a single heartbeat beat, decoded for the processor:
 *   'keep'    – keep working
 *   'cancel'  – cancel was requested: abort the provider call, then let
 *               job_failed settle the job as cancelled
 *   'stolen'  – lock is gone (reclaimed / row deleted): stop immediately,
 *               discard all work, touch nothing further
 */
export type HeartbeatVerdict = 'keep' | 'cancel' | 'stolen';

/** Decode the RPC's tri-state return (true / false / null) into a verdict. */
export function decodeHeartbeat(beat: boolean | null): HeartbeatVerdict {
  if (beat === null) return 'stolen';
  return beat ? 'keep' : 'cancel';
}
