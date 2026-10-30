// @studio/db — row↔DTO mappers, typed queries, and wrappers around the
// SECURITY DEFINER RPCs. Callers pass THEIR client in (user-session for
// web → RLS enforced, service for worker → RPC-guarded); nothing here
// grants access by itself.

export const DB_VERSION = '0.1.0';

// The service tier (env loading + the RLS-bypassing client factory) is
// deliberately NOT re-exported here — it lives behind the './server'
// subpath ('@studio/db/server'), so no web import of '@studio/db' can
// construct a service client. Workers and integration tests import the
// subpath instead.
export type { StudioDbClient } from './clients.js';

export {
  RowMappingError,
  mapJobRow,
  mapJobEventRow,
  mapProjectRow,
  mapRowsResilient,
  mapSceneRow,
  mapScriptVersionRow,
  type DbRow,
} from './mappers.js';

export * from './queries/projects.js';
export * from './queries/script.js';
export * from './queries/jobs.js';
export * from './queries/usage.js';
export * from './queries/workspaces.js';

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
