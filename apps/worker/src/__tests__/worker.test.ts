import { describe, expect, it } from 'vitest';

import { ProviderCallError, ProviderConfigError, resolveScriptwriter } from '@studio/providers';

import { loadWorkerConfig } from '../config.js';
import { classifyFailure } from '../errors.js';

describe('loadWorkerConfig', () => {
  it('applies the documented defaults', () => {
    expect(loadWorkerConfig({})).toEqual({
      pollMs: 2_000,
      idlePollMs: 15_000,
      claimBatch: 2,
      staleLockSeconds: 300,
    });
  });

  it('accepts valid overrides', () => {
    expect(
      loadWorkerConfig({
        WORKER_POLL_MS: '5000',
        WORKER_IDLE_POLL_MS: '30000',
        WORKER_CLAIM_BATCH: '5',
        WORKER_STALE_LOCK_SECONDS: '600',
      }),
    ).toEqual({ pollMs: 5_000, idlePollMs: 30_000, claimBatch: 5, staleLockSeconds: 600 });
  });

  it('falls back to defaults on garbage, zero, or negative values', () => {
    expect(loadWorkerConfig({ WORKER_POLL_MS: 'nope', WORKER_CLAIM_BATCH: '0', WORKER_STALE_LOCK_SECONDS: '-5' })).toEqual({
      pollMs: 2_000,
      idlePollMs: 15_000,
      claimBatch: 2,
      staleLockSeconds: 300,
    });
  });

  it('clamps to the safety rails', () => {
    expect(loadWorkerConfig({ WORKER_POLL_MS: '1' }).pollMs).toBe(250);
    expect(loadWorkerConfig({ WORKER_CLAIM_BATCH: '100' }).claimBatch).toBe(10);
    expect(loadWorkerConfig({ WORKER_STALE_LOCK_SECONDS: '999999' }).staleLockSeconds).toBe(3_600);
    expect(loadWorkerConfig({ WORKER_IDLE_POLL_MS: '10' }).idlePollMs).toBe(1_000);
  });
});

describe('classifyFailure', () => {
  it('passes ProviderCallError code + retryable through unchanged', () => {
    const failure = classifyFailure(new ProviderCallError('provider responded 500: oops', 'http_500', true));
    expect(failure).toEqual({ code: 'http_500', message: 'provider responded 500: oops', retryable: true });

    const auth = classifyFailure(new ProviderCallError('provider responded 401', 'http_401', false));
    expect(auth).toEqual({ code: 'http_401', message: 'provider responded 401', retryable: false });
  });

  it('classifies unexpected errors as non-retryable worker bugs', () => {
    const failure = classifyFailure(new TypeError('cannot read properties of undefined'));
    expect(failure.code).toBe('unexpected_error');
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain('cannot read properties');
  });

  it('handles thrown non-Errors', () => {
    const failure = classifyFailure('a string was thrown');
    expect(failure.code).toBe('unexpected_error');
    expect(failure.message).toBe('a string was thrown');
  });
});

describe('boot fail-fast', () => {
  it('refuses to boot a real provider without credentials', () => {
    expect(() => resolveScriptwriter({ SCRIPTWRITER_PROVIDER: 'anthropic' })).toThrow(ProviderConfigError);
  });

  it('boots the mock with zero credentials', () => {
    expect(resolveScriptwriter({}).isMock).toBe(true);
  });
});
