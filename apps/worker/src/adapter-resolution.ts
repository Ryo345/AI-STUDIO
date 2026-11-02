// Per-job adapter resolution — the model router's runtime half (0006).
//
// Resolution order for a claimed job's workspace:
//   1. model_assignments row for (workspace, 'script.generate')
//   2. model_assignments row for (workspace, 'default')
//   3. env-resolved fallback adapter (SCRIPTWRITER_PROVIDER — dev/mock path)
//
// Steps 1–2 are BYOK: they require a provider_connections row for the
// assigned provider. The ciphertext is decrypted HERE, in the worker
// process, seconds before use — plaintext keys transit memory only, never
// logs. A BYOK assignment without a usable connection fails the job as a
// NON-retryable provider_config error: burning retries on a missing key
// would just burn attempts, and a silent env/mock fallback would violate
// the no-silent-fallback rule.

import { resolveModelAssignment, type AiTask, type JobDTO, type ScriptwriterProviderId } from '@studio/domain';
import { getConnectionCredential } from '@studio/db';
import {
  ProviderCallError,
  ProviderConfigError,
  createScriptwriter,
  decryptSecret,
  type ScriptwriterAdapter,
} from '@studio/providers';

import type { StudioDbClient } from '@studio/db/server';

export const ADAPTER_RESOLUTION_VERSION = '0.1.0';

export interface AdapterResolutionDeps {
  db: StudioDbClient;
  /** The env-resolved fallback (mock in dev). Used only when the workspace has no assignment. */
  fallback: ScriptwriterAdapter;
  encryptionKey: Buffer;
  timeoutMs: number;
  log: (message: string, detail?: Record<string, unknown>) => void;
}

/** Which path produced the adapter — recorded in the job event for honest provenance. */
export type AdapterSource = 'byok_task' | 'byok_default' | 'env';

export interface ResolvedAdapter {
  adapter: ScriptwriterAdapter;
  source: AdapterSource;
  model: string | null;
}

export async function resolveJobAdapter(
  deps: AdapterResolutionDeps,
  job: JobDTO,
): Promise<ResolvedAdapter> {
  const { db, fallback, encryptionKey, timeoutMs, log } = deps;

  // Only script.generate is routed today; future job types resolve their own
  // task ids when their processors exist.
  const task = job.type === 'script.generate' ? 'script.generate' : null;
  if (!task) {
    return { adapter: fallback, source: 'env', model: null };
  }

  const { data, error } = await db
    .from('model_assignments')
    .select('task, provider_id, model')
    .eq('workspace_id', job.workspaceId)
    .in('task', [task, 'default']);
  if (error) {
    throw new ProviderCallError(`model_assignments read failed: ${error.message}`, 'db_error', true);
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    task: String(row['task']) as AiTask,
    providerId: String(row['provider_id']),
    model: String(row['model']),
  }));
  const assignment = resolveModelAssignment(rows, task);
  if (!assignment) {
    return { adapter: fallback, source: 'env', model: null };
  }

  const connection = await getConnectionCredential(db, job.workspaceId, assignment.providerId);
  if (!connection) {
    throw new ProviderConfigError(
      `model assignment '${assignment.task}' → '${assignment.providerId}' has no provider connection in this workspace — add the API key in settings`,
    );
  }
  if (connection.status === 'failed') {
    throw new ProviderConfigError(
      `provider connection '${assignment.providerId}' last failed its connection test — re-test or update the key in settings`,
    );
  }

  const providerId = assignment.providerId as ScriptwriterProviderId;
  if (providerId === 'mock') {
    // DB CHECK prevents this today; belt-and-braces for schema drift.
    throw new ProviderConfigError('mock is not a BYOK provider');
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(connection.credential, encryptionKey);
  } catch (error) {
    log('credential decryption failed', { jobId: job.id, provider: providerId, error: String(error) });
    throw new ProviderConfigError(
      `credential for '${providerId}' could not be decrypted (CREDENTIAL_ENCRYPTION_KEY mismatch?)`,
    );
  }

  const adapter = createScriptwriter(providerId, {
    apiKey,
    model: assignment.model,
    timeoutMs,
  });
  log('resolved adapter for job', {
    jobId: job.id,
    source: assignment.task === 'default' ? 'byok_default' : 'byok_task',
    provider: providerId,
    model: assignment.model,
    keyHint: connection.keyHint,
  });
  return {
    adapter,
    source: assignment.task === 'default' ? 'byok_default' : 'byok_task',
    model: assignment.model,
  };
}
