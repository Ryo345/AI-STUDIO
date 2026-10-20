import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Gated integration config: `npm run test:int` — requires INT=1 plus real
// Supabase env from docs/supabase-setup.md. The default `npm test` run
// deliberately excludes *.int.test.ts so the credential-free suite stays
// green with zero secrets.
//
// .env is loaded explicitly here (prefix '' = every key, not just VITE_*):
// vitest does not inject .env into process.env on its own, and the suites
// read config through loadDbConfig(), which expects real process.env vars.
export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, process.cwd(), ''),
    include: ['packages/*/src/**/*.int.test.ts', 'apps/*/src/**/*.int.test.ts'],
    exclude: ['node_modules/**'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
}));
