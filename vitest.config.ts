import { defineConfig } from 'vitest/config';

// Root config for credential-free unit suites across all workspaces.
// Integration tests that hit a real Supabase project are named *.int.test.ts and
// excluded here — they run via vitest.int.config.ts (added with @studio/db)
// behind an env gate so `npm test` always works with zero credentials.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    exclude: ['**/*.int.test.ts'],
    environment: 'node',
    reporters: 'default',
  },
});
