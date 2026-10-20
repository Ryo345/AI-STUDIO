// @studio/db — Supabase env config (fail-fast), client factory, row↔DTO
// mappers, typed queries, and wrappers around the SECURITY DEFINER RPCs.
// Callers pass THEIR client in (user-session for web → RLS enforced,
// service for worker → RPC-guarded); nothing here grants access by itself.

export const DB_VERSION = '0.1.0';

export {
  SUPABASE_SETUP_DOC,
  DbConfigurationError,
  integrationTestEnvAvailable,
  loadDbConfig,
  type DbConfig,
} from './config.js';

export {
  createServiceClient,
  type StudioDbClient,
} from './clients.js';

export {
  RowMappingError,
  mapJobRow,
  mapJobEventRow,
  mapProjectRow,
  mapSceneRow,
  mapScriptVersionRow,
  type DbRow,
} from './mappers.js';

export * from './queries/projects.js';
export * from './queries/script.js';
export * from './queries/jobs.js';
export * from './queries/usage.js';

export {
  RpcError,
  appendJobEvent,
  claimJobs,
  completeScriptGeneration,
  heartbeatJob,
  jobFailed,
  reclaimStaleJobs,
  reorderScenes,
  requestJobCancel,
  retryJob,
  type CompleteScriptGenerationArgs,
} from './rpc.js';
