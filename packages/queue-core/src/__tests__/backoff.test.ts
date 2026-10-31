import { describe, expect, it } from 'vitest';

import {
  MAX_BACKOFF_SECONDS,
  backoffSeconds,
  decodeHeartbeat,
  isTerminalStatus,
  retryDelaySeconds,
} from '../index.js';

describe('backoffSeconds — mirror of job_failed (0003_queue.sql)', () => {
  // The SQL schedules `least(30 * 2 ^ v_attempt, 600)` with v_attempt =
  // POST-increment attempt. These are the exact values Postgres produces:
  it('reproduces the SQL series: 60, 120, 240, 480, then capped at 600', () => {
    expect(backoffSeconds(1)).toBe(60);
    expect(backoffSeconds(2)).toBe(120);
    expect(backoffSeconds(3)).toBe(240);
    expect(backoffSeconds(4)).toBe(480);
    expect(backoffSeconds(5)).toBe(600); // 30 * 2^5 = 960 → capped
    expect(backoffSeconds(6)).toBe(600);
    expect(backoffSeconds(10)).toBe(600);
  });

  it('first retry is 60s, never 30s (post-increment semantics)', () => {
    expect(backoffSeconds(1)).not.toBe(30);
    expect(backoffSeconds(1)).toBe(60);
  });

  it('clamps bad input to the first-retry value instead of producing 0 or NaN', () => {
    expect(backoffSeconds(0)).toBe(60);
    expect(backoffSeconds(-3)).toBe(60);
    expect(backoffSeconds(1.7)).toBe(60); // truncated to 1
  });

  it('never exceeds the SQL cap', () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect(backoffSeconds(attempt)).toBeLessThanOrEqual(MAX_BACKOFF_SECONDS);
    }
  });
});

describe('retryDelaySeconds — JobDTO-facing form (pre-increment attempt)', () => {
  it('a job that failed on its first attempt (attempt=0) retries after 60s', () => {
    expect(retryDelaySeconds(0)).toBe(60);
  });

  it('shifts the series by one: attempt=n delays like backoffSeconds(n+1)', () => {
    for (let attempt = 0; attempt <= 5; attempt += 1) {
      expect(retryDelaySeconds(attempt)).toBe(backoffSeconds(attempt + 1));
    }
  });

  it('clamps negative attempts to the first-retry value', () => {
    expect(retryDelaySeconds(-1)).toBe(60);
  });
});

describe('isTerminalStatus', () => {
  it('terminal statuses never leave without a retry_job call', () => {
    expect(isTerminalStatus('succeeded')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  it('pending/running are live statuses', () => {
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
  });
});

describe('decodeHeartbeat — tri-state RPC return → worker verdict', () => {
  it('true → keep', () => {
    expect(decodeHeartbeat(true)).toBe('keep');
  });

  it('false → cancel was requested', () => {
    expect(decodeHeartbeat(false)).toBe('cancel');
  });

  it('null → lock stolen, stop immediately', () => {
    expect(decodeHeartbeat(null)).toBe('stolen');
  });
});
