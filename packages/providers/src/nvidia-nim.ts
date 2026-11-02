// NVIDIA NIM adapter — the first BYOK provider (spec 2026-10-31).
//
// NIM's hosted API (integrate.api.nvidia.com) speaks the OpenAI chat
// completions wire format with Bearer auth, so generation reuses
// OpenAICompatibleScriptwriter wholesale; this module only binds the
// NIM identity, the default base URL, and NIM-specific connection testing
// + live model catalog lookup (GET /models).
//
// Catalog policy: model ids are NEVER hard-coded. The /models endpoint is
// the source of truth; the settings UI fetches it through the server route
// with the user's decrypted key. Connection test = GET /models with the
// caller's key — a key that can list models can also generate.

import type { ScriptwriterProviderId } from '@studio/domain';

import { asOptionalInt } from './common.js';
import { getJsonForJson, postJsonForJson } from './http.js';
import { ProviderCallError, type ScriptwriterContext } from './types.js';
import { OpenAICompatibleScriptwriter, type OpenAICompatibleConfig } from './openai-compatible.js';

export const NVIDIA_NIM_VERSION = '0.1.0';

export const DEFAULT_NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export interface NvidiaNimConfig {
  apiKey: string;
  model: string;
  /** Default: https://integrate.api.nvidia.com/v1 (self-hosted NIM allowed). */
  baseUrl?: string;
  timeoutMs: number;
}

export class NvidiaNimScriptwriter extends OpenAICompatibleScriptwriter {
  override readonly id: ScriptwriterProviderId = 'nvidia-nim';

  constructor(config: NvidiaNimConfig) {
    super({
      baseUrl: config.baseUrl?.trim() || DEFAULT_NVIDIA_NIM_BASE_URL,
      apiKey: config.apiKey,
      model: config.model,
      timeoutMs: config.timeoutMs,
    });
  }
}

// ── Connection test + live model catalog ─────────────────────────────────
// Shared with the future per-provider test surface: a provider module knows
// how to validate its own credentials and list its own models. No catalog
// is cached in code — availability changes daily on NIM.

export interface ProviderCatalogResult {
  ok: boolean;
  /** Model ids currently offered to this key, sorted — empty when !ok. */
  models: string[];
  /** { code, message } when !ok — provider-specific, safe to surface (never contains the key). */
  error?: { code: string; message: string };
}

interface ModelListResponse {
  data?: unknown;
}

function extractModelIds(data: unknown): string[] {
  if (typeof data !== 'object' || data === null) return [];
  const list = (data as ModelListResponse).data;
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

/** GET {base}/models with Bearer auth — doubles as the connection test. */
export async function listNvidiaNimModels(config: {
  apiKey: string;
  baseUrl?: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<ProviderCatalogResult> {
  const base = (config.baseUrl?.trim() || DEFAULT_NVIDIA_NIM_BASE_URL).replace(/\/+$/, '');
  try {
    const data = await getJsonForJson(`${base}/models`, {
      timeoutMs: config.timeoutMs,
      signal: config.signal,
      headers: { authorization: `Bearer ${config.apiKey}` },
    });
    return { ok: true, models: extractModelIds(data) };
  } catch (error) {
    // The test endpoint reports; it does not throw — every classified failure
    // becomes a structured result the UI can render as-is.
    if (error instanceof ProviderCallError) {
      return { ok: false, models: [], error: { code: error.code, message: error.message } };
    }
    return {
      ok: false,
      models: [],
      error: { code: 'network_error', message: `network error: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}

/**
 * Connection test = "can this key list models". Kept as a named wrapper so
 * the web route reads as intent, and so a future richer handshake (e.g. a
 * tiny generation probe) swaps in one place.
 */
export async function testNvidiaNimConnection(config: {
  apiKey: string;
  baseUrl?: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<ProviderCatalogResult> {
  return listNvidiaNimModels(config);
}

// ── Raw chat-completions passthrough (non-scriptwriter AI tasks) ─────────
// research.assist / fact.check / title+SEO tasks (later phases) call a
// model directly with arbitrary prompts — not the script contract. This is
// the typed seam for that: build messages, get text back, NIM-shaped
// errors normalized. Not used by script.generate (which goes through the
// scriptwriter adapter + normalization).

export interface NimChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface NimChatParams {
  messages: NimChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  seed?: number;
}

export async function nimChatCompletion(
  config: { apiKey: string; baseUrl?: string; model: string; timeoutMs: number },
  params: NimChatParams,
  ctx: ScriptwriterContext,
): Promise<{ text: string; finishReason: string | null; inputTokens?: number; outputTokens?: number }> {
  const base = (config.baseUrl?.trim() || DEFAULT_NVIDIA_NIM_BASE_URL).replace(/\/+$/, '');
  const body: Record<string, unknown> = {
    model: config.model,
    messages: params.messages,
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.topP !== undefined) body.top_p = params.topP;
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
  if (params.seed !== undefined) body.seed = params.seed;

  const data = await postJsonForJson(`${base}/chat/completions`, {
    timeoutMs: config.timeoutMs,
    signal: ctx.signal,
    headers: { authorization: `Bearer ${config.apiKey}` },
    body,
  });

  if (typeof data !== 'object' || data === null) {
    throw new ProviderCallError('nvidia-nim response is not an object', 'invalid_response', true);
  }
  const record = data as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choice = (typeof choices[0] === 'object' && choices[0] !== null ? choices[0] : {}) as Record<string, unknown>;
  const message = (typeof choice.message === 'object' && choice.message !== null ? choice.message : {}) as Record<string, unknown>;
  const usage = (typeof record.usage === 'object' && record.usage !== null ? record.usage : {}) as Record<string, unknown>;

  return {
    text: typeof message.content === 'string' ? message.content : '',
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    inputTokens: asOptionalInt(usage.prompt_tokens),
    outputTokens: asOptionalInt(usage.completion_tokens),
  };
}
