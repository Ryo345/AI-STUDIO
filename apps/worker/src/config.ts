// Worker runtime knobs — docs/env-vars.md is canonical for names and
// defaults; the clamps here are safety rails, not policy (the server-side
// claim_jobs clamp 1–10 is the only limit that actually matters).

export const WORKER_CONFIG_VERSION = '0.1.0';

export interface WorkerConfig {
  /** WORKER_POLL_MS (default 2000) — pause between poll cycles after processing work. */
  pollMs: number;
  /** WORKER_IDLE_POLL_MS (default 15000) — backoff after an empty claim. */
  idlePollMs: number;
  /** WORKER_CLAIM_BATCH (default 2) — jobs per claim; server clamps 1–10. */
  claimBatch: number;
  /** WORKER_STALE_LOCK_SECONDS (default 300) — running-lock age considered reclaimable. */
  staleLockSeconds: number;
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = Number(env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.max(Math.trunc(raw), min), max);
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    pollMs: readInt(env, 'WORKER_POLL_MS', 2_000, 250, 60_000),
    idlePollMs: readInt(env, 'WORKER_IDLE_POLL_MS', 15_000, 1_000, 300_000),
    claimBatch: readInt(env, 'WORKER_CLAIM_BATCH', 2, 1, 10),
    staleLockSeconds: readInt(env, 'WORKER_STALE_LOCK_SECONDS', 300, 30, 3_600),
  };
}
