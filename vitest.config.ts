import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Root config for credential-free unit suites across all workspaces.
// Integration tests that hit a real Supabase project are named *.int.test.ts and
// excluded here — they run via vitest.int.config.ts (added with @studio/db)
// behind an env gate so `npm test` always works with zero credentials.
export default defineConfig({
  // The web app resolves '@/*' to apps/web/src/* (apps/web/tsconfig.json),
  // but Vite does not read tsconfig paths on its own — so a route handler
  // that imports '@/lib/api/errors' cannot be loaded by a test without this
  // alias. The pattern is anchored on '@/' so the workspace packages
  // ('@studio/domain', '@studio/db') keep resolving through node_modules.
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL('./apps/web/src/', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    exclude: ['**/*.int.test.ts'],
    environment: 'node',
    reporters: 'default',
  },
});
