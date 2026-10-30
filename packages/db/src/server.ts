// SERVICE-TIER SUBPATH — import as '@studio/db/server' from the worker and
// the integration tests ONLY. Everything that can bypass RLS (env loading
// with the service key + the service client factory) lives behind this
// subpath so a plain '@studio/db' import structurally cannot reach it; a
// web-side breach requires a literal '@studio/db/server' import, which the
// credential-free guard test (server-subpath.guard.test.ts) fails on.
//
// Why not `import 'server-only'`: that package throws under default Node
// resolution conditions — its exports map only silences the throw under the
// react-server condition, which Next sets for its bundles but tsx (worker)
// and vitest (node env) do not. It would break the worker boot and both
// test suites to protect against a threat (client-vs-server within one Next
// app) this shared package doesn't have.

export {
  SUPABASE_SETUP_DOC,
  DbConfigurationError,
  integrationTestEnvAvailable,
  loadDbConfig,
  type DbConfig,
} from './config.js';

export { createServiceClient, type StudioDbClient } from './clients.js';
