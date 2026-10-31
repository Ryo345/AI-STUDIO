// Error classification for job_failed. Provider failures arrive already
// classified (ProviderCallError carries code + retryable); anything else is
// a worker/pipeline bug or an unexpected condition and must NOT burn retry
// attempts on the same code path.

import { ProviderCallError } from '@studio/providers';

export const ERRORS_VERSION = '0.1.0';

export interface ClassifiedFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export function classifyFailure(error: unknown): ClassifiedFailure {
  if (error instanceof ProviderCallError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'unexpected_error', message, retryable: false };
}
