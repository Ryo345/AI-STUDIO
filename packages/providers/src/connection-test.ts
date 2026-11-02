// Connection-test dispatcher — one entry point the web tier calls for any
// BYOK provider. Each provider's handshake is its own: NIM and OpenAI-
// compatible servers share the GET {base}/models listing; Anthropic lists
// models at /v1/models with x-api-key + a pinned version header. The
// dispatcher keeps that provider-specific knowledge out of the web routes.

import type { ConnectionProviderId } from '@studio/domain';

import { ANTHROPIC_API_VERSION, DEFAULT_ANTHROPIC_BASE_URL } from './anthropic.js';
import { getJsonForJson } from './http.js';
import { DEFAULT_NVIDIA_NIM_BASE_URL, listNvidiaNimModels, type ProviderCatalogResult } from './nvidia-nim.js';
import { ProviderCallError } from './types.js';

export const CONNECTION_TEST_VERSION = '0.1.0';

export interface ProviderTestInput {
  providerId: ConnectionProviderId;
  apiKey: string;
  /** Custom endpoint (openai-compatible requires it); null/undefined = hosted default. */
  baseUrl?: string | null;
  timeoutMs: number;
  signal: AbortSignal;
}

/** Test a BYOK credential against its provider. Never throws — returns a structured result. */
export async function testProviderConnection(input: ProviderTestInput): Promise<ProviderCatalogResult> {
  switch (input.providerId) {
    case 'nvidia-nim':
      return listNvidiaNimModels({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl ?? undefined,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      });

    case 'openai-compatible': {
      const base = input.baseUrl?.trim().replace(/\/+$/, '') ?? '';
      if (!base) {
        return {
          ok: false,
          models: [],
          error: { code: 'config_error', message: 'openai-compatible connections require a base URL' },
        };
      }
      try {
        const data = await getJsonForJson(`${base}/models`, {
          timeoutMs: input.timeoutMs,
          signal: input.signal,
          headers: { authorization: `Bearer ${input.apiKey}` },
        });
        return { ok: true, models: extractIds(data) };
      } catch (error) {
        return toCatalogResult(error);
      }
    }

    case 'anthropic': {
      const base = (input.baseUrl?.trim().replace(/\/+$/, '') || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, '');
      try {
        const data = await getJsonForJson(`${base}/v1/models`, {
          timeoutMs: input.timeoutMs,
          signal: input.signal,
          headers: {
            'x-api-key': input.apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
        });
        return { ok: true, models: extractIds(data) };
      } catch (error) {
        return toCatalogResult(error);
      }
    }
  }
}

function toCatalogResult(error: unknown): ProviderCatalogResult {
  if (error instanceof ProviderCallError) {
    return { ok: false, models: [], error: { code: error.code, message: error.message } };
  }
  return {
    ok: false,
    models: [],
    error: { code: 'network_error', message: `network error: ${error instanceof Error ? error.message : String(error)}` },
  };
}

function extractIds(data: unknown): string[] {
  if (typeof data !== 'object' || data === null) return [];
  const list = (data as { data?: unknown }).data;
  if (!Array.isArray(list)) return [];
  const ids: string[] = [];
  for (const entry of list) {
    if (typeof entry === 'object' && entry !== null) {
      const id = (entry as Record<string, unknown>).id;
      if (typeof id === 'string' && id.length > 0) ids.push(id);
    }
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
