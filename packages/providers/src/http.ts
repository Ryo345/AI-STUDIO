// Shared HTTP plumbing for real providers: abortable timeout + status-based
// error classification. A timeout is a retryable job failure (env-vars.md);
// 408/429/5xx are transient; 4xx means the request itself is wrong and must
// not burn retry attempts.

import { ProviderCallError } from './types.js';

export const HTTP_VERSION = '0.1.0';

const RETRYABLE_STATUS = new Set([408, 409, 429]);

export interface HttpJsonOptions {
  timeoutMs: number;
  signal: AbortSignal;
  headers: Record<string, string>;
  body: unknown;
}

/** POST JSON, get parsed JSON back, classify failures as ProviderCallError. */
export async function postJsonForJson(url: string, opts: HttpJsonOptions): Promise<unknown> {
  // AbortSignal.any combines the worker's cancel signal with the timeout:
  // whichever fires first wins, and the cause tells us which.
  const timeoutSignal = AbortSignal.timeout(opts.timeoutMs);
  const signal = 'any' in AbortSignal ? AbortSignal.any([opts.signal, timeoutSignal]) : opts.signal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...opts.headers },
      body: JSON.stringify(opts.body),
      signal,
    });
  } catch (error) {
    throw classifyNetworkError(error, opts.timeoutMs);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    // Never echo a full provider body into the job error — truncate hard.
    const snippet = text.replace(/\s+/g, ' ').slice(0, 200);
    throw new ProviderCallError(
      `provider responded ${response.status}${snippet ? `: ${snippet}` : ''}`,
      `http_${response.status}`,
      RETRYABLE_STATUS.has(response.status) || response.status >= 500,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new ProviderCallError('provider returned malformed JSON', 'invalid_response', true);
  }
}

/** GET JSON (model catalogs, health probes) with the same classification as postJsonForJson. */
export async function getJsonForJson(
  url: string,
  opts: { timeoutMs: number; signal: AbortSignal; headers: Record<string, string> },
): Promise<unknown> {
  const timeoutSignal = AbortSignal.timeout(opts.timeoutMs);
  const signal = 'any' in AbortSignal ? AbortSignal.any([opts.signal, timeoutSignal]) : opts.signal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...opts.headers },
      signal,
    });
  } catch (error) {
    throw classifyNetworkError(error, opts.timeoutMs);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const snippet = text.replace(/\s+/g, ' ').slice(0, 200);
    throw new ProviderCallError(
      `provider responded ${response.status}${snippet ? `: ${snippet}` : ''}`,
      `http_${response.status}`,
      RETRYABLE_STATUS.has(response.status) || response.status >= 500,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new ProviderCallError('provider returned malformed JSON', 'invalid_response', true);
  }
}

function classifyNetworkError(error: unknown, timeoutMs: number): ProviderCallError {
  if (error instanceof ProviderCallError) return error;
  const isAbort = error instanceof Error && error.name === 'AbortError';
  const isTimeout = error instanceof Error && error.name === 'TimeoutError';
  if (isTimeout) {
    return new ProviderCallError(`provider call exceeded ${timeoutMs}ms`, 'timeout', true);
  }
  if (isAbort) {
    // Worker-cancelled or lock stolen — the caller checks cancel_requested
    // and settles the job; classification here only needs to not be 'timeout'.
    return new ProviderCallError('provider call aborted', 'cancelled', false);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderCallError(`provider network error: ${message}`, 'network_error', true);
}
