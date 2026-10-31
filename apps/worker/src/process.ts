// Job processor — one claimed script.generate job, end to end:
//   load payload + project → resolve template → heartbeat loop racing the
//   provider call → complete_script_generation / job_failed.
//
// Lock semantics (0003_queue.sql + queue-core):
//   heartbeat true   → keep working
//   heartbeat false  → cancel_requested: abort, then job_failed (the SQL
//                      settles cancel_requested → 'cancelled')
//   heartbeat null   → lock stolen: abort, discard, touch NOTHING else —
//                      discarded work must not leave a fake paper trail
//   complete returns null → job row vanished (project deleted mid-run):
//                      work was discarded, not "succeeded" — log honestly
//   complete returns an unchanged row → lock was lost at the finish line:
//                      same discard contract, reported by the row's status

import type { JobDTO, ProjectConfig, ScriptGenerateResult, ScriptProvenance } from '@studio/domain';
import { ProjectConfigSchema } from '@studio/domain';
import { appendJobEvent, heartbeatJob, jobFailed, completeScriptGeneration } from '@studio/db';
import type { ScriptwriterAdapter } from '@studio/providers';
import { ProviderCallError } from '@studio/providers';
import { HEARTBEAT_INTERVAL_MS } from '@studio/queue-core';
import { resolveNiche } from '@studio/niches';

import type { StudioDbClient } from '@studio/db/server';

import { classifyFailure } from './errors.js';

export const PROCESS_VERSION = '0.1.0';

export type WorkerLog = (message: string, detail?: Record<string, unknown>) => void;

export interface ProcessDeps {
  db: StudioDbClient;
  adapter: ScriptwriterAdapter;
  workerId: string;
  log: WorkerLog;
}

export type ProcessOutcome = 'succeeded' | 'failed' | 'cancelled' | 'stolen';

/** The payload web enqueues with script.generate (M4 contract). */
interface ScriptGeneratePayload {
  instructions?: unknown;
}

export async function processJob(deps: ProcessDeps, job: JobDTO): Promise<ProcessOutcome> {
  const { db, adapter, workerId, log } = deps;
  const jobId = job.id;

  // ── Phase 1: gather inputs (no heartbeat needed — reads are fast) ────

  if (job.type !== 'script.generate') {
    // Claim jobs returns only claimable work; an unknown future type that
    // somehow reached us must not crash the worker — settle it as failed.
    await settleFailure(deps, jobId, { code: 'unsupported_type', message: `no processor for job type '${job.type}'`, retryable: false });
    return 'failed';
  }
  if (job.projectId === null) {
    await settleFailure(deps, jobId, { code: 'invalid_job', message: 'script.generate job has no project', retryable: false });
    return 'failed';
  }
  const projectId = job.projectId;

  // JobDTO carries no payload (M4 wire contract) — read it straight from
  // the table with the service client.
  const { data: jobRow, error: payloadError } = await db
    .from('jobs')
    .select('payload')
    .eq('id', jobId)
    .single();
  if (payloadError) {
    await settleFailure(deps, jobId, { code: 'payload_read_failed', message: payloadError.message, retryable: true });
    return 'failed';
  }
  const payload = (jobRow?.payload ?? {}) as ScriptGeneratePayload;

  const { data: project, error: projectError } = await db
    .from('projects')
    .select('topic, config, niche_key')
    .eq('id', projectId)
    .single();
  if (projectError || !project) {
    // .single() errors on a missing row — from the worker's seat that is a
    // deleted project, not a transient failure.
    await settleFailure(deps, jobId, { code: 'project_deleted', message: 'Project no longer exists', retryable: false });
    return 'failed';
  }

  let template;
  try {
    template = resolveNiche(project.niche_key);
  } catch {
    await settleFailure(deps, jobId, { code: 'unknown_niche', message: `project niche '${project.niche_key}' is not registered`, retryable: false });
    return 'failed';
  }

  const parsedConfig = ProjectConfigSchema.safeParse(project.config);
  if (!parsedConfig.success) {
    await settleFailure(deps, jobId, { code: 'invalid_project_config', message: parsedConfig.error.message, retryable: false });
    return 'failed';
  }
  const config: ProjectConfig = parsedConfig.data;

  // ── Phase 2: generate under the heartbeat loop ────────────────────────

  await appendJobEvent(db, jobId, workerId, 'script_generate_started', {
    providerId: adapter.id,
    isMock: adapter.isMock,
  }).catch((error: unknown) => log('stage-mark append failed; continuing', { jobId, error: String(error) }));

  const controller = new AbortController();

  // Heartbeat loop: interval-canceled from outside so it stops promptly
  // when generation settles (no lingering 15s tail).
  let stopHeartbeat = false;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  // Held in an object, not a bare `let`: the heartbeat closure mutates it
  // concurrently, and TS narrowing on a plain let doesn't invalidate across
  // closure writes — a property read does reset after intervening calls.
  const settle: { value: 'ok' | 'cancel' | 'stolen' } = { value: 'ok' };
  const heartbeatLoop = (async () => {
    while (!stopHeartbeat) {
      await new Promise<void>((resolve) => {
        heartbeatTimer = setTimeout(resolve, HEARTBEAT_INTERVAL_MS);
      });
      if (stopHeartbeat) break;
      let keep: boolean | null;
      try {
        keep = await heartbeatJob(db, jobId, workerId);
      } catch (error) {
        // Transient DB trouble must not kill a healthy run — the stale-lock
        // reclaim horizon (300s) tolerates several missed beats.
        log('heartbeat rpc failed; continuing', { jobId, error: String(error) });
        continue;
      }
      if (keep === false) {
        settle.value = 'cancel';
        controller.abort();
        break;
      }
      if (keep === null) {
        settle.value = 'stolen';
        controller.abort();
        break;
      }
    }
  })();
  const stopHeartbeatLoop = () => {
    stopHeartbeat = true;
    clearTimeout(heartbeatTimer);
  };

  const request = {
    jobId,
    topic: project.topic,
    template,
    config,
    instructions: typeof payload.instructions === 'string' ? payload.instructions : undefined,
  };

  let outcome: ProcessOutcome;
  try {
    const result = await adapter.generate(request, {
      signal: controller.signal,
      log: (message, detail) => log(`provider: ${message}`, { jobId, ...detail }),
    });
    stopHeartbeatLoop();

    // Lock gone while we worked → the result is garbage regardless of
    // whether generate finished before the abort landed.
    if (settle.value === 'stolen') {
      log('lock stolen mid-run — discarding result', { jobId });
      return 'stolen';
    }

    // ── Phase 3: settle atomically via complete_script_generation ──────

    const versionNumber = await probeNextVersionNumber(deps, projectId);
    const scriptResult: ScriptGenerateResult = {
      versionNumber,
      sceneCount: result.script.scenes.length,
      totalDurationMs: result.script.totalDurationMs,
      providerId: result.provenance.providerId,
      isMock: result.provenance.isMock,
    };
    const provenance: ScriptProvenance = result.provenance;

    // Cancel arriving after the work finished: completion wins — the guard
    // in the RPC still holds the lock, and a finished script beats a wasted
    // cancel. Logged, not hidden.
    if (settle.value === 'cancel') {
      log('cancel requested but generation already finished — completing anyway', { jobId });
    }

    const settled = await completeScriptGeneration(db, {
      jobId,
      workerId,
      script: result.script,
      provenance,
      result: scriptResult,
      usage: {
        providerId: provenance.providerId,
        operation: 'script.generate',
        quantity: 1,
        unit: 'request',
        isMock: provenance.isMock,
      },
    });

    if (settled === null) {
      log('job row vanished at completion (project deleted mid-run) — work discarded', { jobId });
      return 'stolen';
    }
    if (settled.status !== 'succeeded') {
      log('completion guard rejected the write — work discarded', { jobId, status: settled.status });
      return 'stolen';
    }
    log('script generated', {
      jobId,
      projectId,
      versionNumber,
      scenes: scriptResult.sceneCount,
      provider: provenance.providerId,
      isMock: provenance.isMock,
      latencyMs: provenance.latencyMs,
    });
    outcome = 'succeeded';
  } catch (error) {
    stopHeartbeatLoop();

    if (settle.value === 'stolen') {
      // Stolen lock: no further RPCs — null heartbeats mean someone else
      // owns (or deleted) this job.
      log('lock stolen mid-run — discarding failed attempt', { jobId });
      return 'stolen';
    }
    if (settle.value === 'cancel') {
      // job_failed settles cancel_requested → 'cancelled' (0003 SQL).
      await settleFailure(deps, jobId, { code: 'cancelled', message: 'cancel requested', retryable: false });
      return 'cancelled';
    }

    const failure = classifyFailure(error);
    log('generation failed', { jobId, code: failure.code, retryable: failure.retryable, error: failure.message });
    await settleFailure(deps, jobId, failure);
    outcome = 'failed';
  } finally {
    stopHeartbeatLoop();
    // Swallow the loop's own exit — an in-flight RPC rejection here would
    // otherwise surface as an unhandled rejection.
    await heartbeatLoop.catch(() => undefined);
  }

  return outcome;
}

async function settleFailure(deps: ProcessDeps, jobId: string, failure: { code: string; message: string; retryable: boolean }): Promise<void> {
  try {
    await jobFailed(deps.db, jobId, deps.workerId, failure);
  } catch (error) {
    // A failing job_failed must never crash the poll loop — the stale-lock
    // reclaim will pick the job back up if it still exists.
    deps.log('job_failed rpc failed; stale-lock reclaim will re-examine this job', { jobId, error: String(error) });
  }
}

/** max(version_number) + 1 for the project — the same value the RPC computes; stored as-given in jobs.result. */
async function probeNextVersionNumber(deps: ProcessDeps, projectId: string): Promise<number> {
  const { data, error } = await deps.db
    .from('script_versions')
    .select('version_number')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(1);
  if (error) {
    // Transient DB trouble at the finish line — retryable, so the job burns
    // an attempt instead of dying as unexpected_error.
    throw new ProviderCallError(`version probe failed: ${error.message}`, 'db_error', true);
  }
  const max = data?.[0]?.version_number;
  return (typeof max === 'number' ? max : 0) + 1;
}
