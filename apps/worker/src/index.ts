// Entrypoint: fail-fast on every contract before the first poll — DB env
// (DbConfigurationError), provider selection (ProviderConfigError) — then
// run until SIGINT/SIGTERM. This process is the only holder of provider
// keys and the service role key.

import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

import { createServiceClient, loadDbConfig } from '@studio/db/server';
import { loadCredentialEncryptionKey, providerTimeoutMs, resolveScriptwriter } from '@studio/providers';

import { loadWorkerConfig } from './config.js';
import { runWorker } from './run.js';

const config = loadWorkerConfig(process.env);
const db = createServiceClient(loadDbConfig(process.env));
// Env fallback (mock in dev) — used only when a workspace has no model
// assignment for the job's task. BYOK workspaces resolve per job.
const fallbackAdapter = resolveScriptwriter(process.env);
// Required unconditionally: BYOK connections cannot be decrypted without it.
const encryptionKey = loadCredentialEncryptionKey(process.env);

// Identifies this worker in locked_by / job events: host + pid + a short
// random suffix so two workers on the same host never share an identity.
const workerId = `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;

await runWorker({
  config,
  db,
  fallback: fallbackAdapter,
  encryptionKey,
  timeoutMs: providerTimeoutMs(process.env),
  workerId,
  log: (message, detail) => {
    const suffix = detail ? ` ${JSON.stringify(detail)}` : '';
    console.log(`[worker] ${message}${suffix}`);
  },
});
