// Poll loop — claim → process (sequentially; one job at a time keeps
// provider load predictable and the shutdown contract simple) → sleep.
// Reclaim of stale locks runs once at boot (a previous worker may have died
// holding locks) and then on an interval for the worker's lifetime.

import type { JobDTO } from '@studio/domain';
import { claimJobs, reclaimStaleJobs } from '@studio/db';

import { loadWorkerConfig, type WorkerConfig } from './config.js';
import { processJob, type ProcessDeps } from './process.js';

export const RUN_VERSION = '0.1.0';

/** How often the stale-lock sweep runs while the worker is alive. */
const RECLAIM_INTERVAL_MS = 60_000;

export interface WorkerDeps extends ProcessDeps {
  config: WorkerConfig;
}

export interface RunningWorker {
  stop(): void;
  /** Resolves once the poll loop has exited. */
  done: Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWorker(deps: WorkerDeps): Promise<void> {
  const { config, db, workerId, log } = deps;
  const running = { value: true };

  const reclaim = async (label: string) => {
    try {
      const count = await reclaimStaleJobs(db, config.staleLockSeconds);
      if (count > 0) log('reclaimed stale job(s)', { count, at: label });
    } catch (error) {
      // Never fatal — the next sweep retries; locks are also only stale
      // after WORKER_STALE_LOCK_SECONDS, so a missed sweep is harmless.
      log('stale-lock reclaim failed; will retry', { at: label, error: String(error) });
    }
  };

  log(`worker ${workerId} booting`, { provider: deps.adapter.id, isMock: deps.adapter.isMock, ...config });
  await reclaim('boot');

  const reclaimTimer = setInterval(() => {
    void reclaim('interval');
  }, RECLAIM_INTERVAL_MS);
  reclaimTimer.unref();

  const shutdown = () => {
    if (!running.value) return;
    running.value = false;
    log('shutdown signal received — finishing current work, claiming nothing new');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    while (running.value) {
      let jobs: JobDTO[];
      try {
        jobs = await claimJobs(db, workerId, config.claimBatch);
      } catch (error) {
        log('claim failed; backing off', { error: String(error) });
        await sleep(config.idlePollMs);
        continue;
      }

      if (jobs.length === 0) {
        await sleep(config.idlePollMs);
        continue;
      }

      for (const job of jobs) {
        if (!running.value) break; // shutdown: finish nothing new
        const outcome = await processJob(deps, job);
        log(`job ${outcome}`, { jobId: job.id, type: job.type, attempt: job.attempt });
      }
      // Work just landed — poll again after the short poll interval, not
      // the idle backoff.
      await sleep(config.pollMs);
    }
  } finally {
    clearInterval(reclaimTimer);
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    log(`worker ${workerId} stopped`);
  }
}
