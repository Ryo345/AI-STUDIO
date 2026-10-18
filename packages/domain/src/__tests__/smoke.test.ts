import { describe, expect, it } from 'vitest';

import { DOMAIN_VERSION } from '../index.js';

describe('monorepo scaffold (M0)', () => {
  it('resolves @studio/domain within the vitest workspace layout', () => {
    // If this fails, the npm-workspaces symlinks under node_modules/@studio
    // are stale — reinstall at the repo root.
    expect(DOMAIN_VERSION).toBe('0.1.0');
  });
});
