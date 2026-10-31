// Anthropic Messages API adapter. Raw fetch (Node 22 global) — the worker
// ships zero provider SDKs by design; http.ts owns timeout, abort, and
// error classification. Wire shape: POST {base}/v1/messages with x-api-key
// + anthropic-version headers, the system prompt as a top-level field.

import type { GeneratedScript, ScriptProvenance } from '@studio/domain';
import { buildScriptPrompt } from '@studio/pipeline';

import { asOptionalInt, buildPromptInput, normalizeProviderText } from './common.js';
import { postJsonForJson } from './http.js';
import { ProviderCallError, type ScriptwriterAdapter, type ScriptwriterContext, type ScriptwriterRequest, type ScriptwriterResult } from './types.js';

export const ANTHROPIC_VERSION = '0.1.0';

/** Wire protocol version — pinned; bump deliberately when the API drifts. */
export const ANTHROPIC_API_VERSION = '2023-06-01';

export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

// A 40-scene script is a few thousand JSON tokens; 16k leaves ample
// headroom. Truncation (stop_reason max_tokens) is a hard error — retrying
// with the same budget cannot succeed.
const MAX_OUTPUT_TOKENS = 16_000;

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
}

export class AnthropicScriptwriter implements ScriptwriterAdapter {
  readonly id = 'anthropic' as const;
  readonly isMock = false;

  constructor(private readonly config: AnthropicConfig) {}

  async generate(request: ScriptwriterRequest, ctx: ScriptwriterContext): Promise<ScriptwriterResult> {
    const startedAt = Date.now();
    const prompt = buildScriptPrompt(request.template, buildPromptInput(request));
    ctx.log?.('anthropic: generating script', { model: this.config.model });

    const url = `${(this.config.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, '')}/v1/messages`;
    const data = await postJsonForJson(url, {
      timeoutMs: this.config.timeoutMs,
      signal: ctx.signal,
      headers: {
        'x-api-key': this.config.apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: {
        model: this.config.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      },
    });

    const { text, stopReason, usage } = readResponse(data);

    if (stopReason !== 'end_turn') {
      // max_tokens → truncated JSON that cannot parse; refusal → content
      // policy. Neither is transient. pause_turn is the one retryable stop.
      throw new ProviderCallError(
        `anthropic stopped early: ${stopReason ?? 'none'}`,
        `stop_${stopReason ?? 'none'}`,
        stopReason === 'pause_turn',
      );
    }
    if (!text) {
      throw new ProviderCallError('anthropic returned no text content', 'empty_response', true);
    }

    const script = normalizeProviderText(text, request, ctx.log);
    const usageFields = usage?.inputTokens !== undefined || usage?.outputTokens !== undefined
      ? { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens }
      : {};
    const provenance: ScriptProvenance = {
      providerId: 'anthropic',
      model: this.config.model,
      isMock: false,
      // The API has no seed parameter; record a fresh id so provenance is
      // present and honest (retries of the same job get different output).
      seed: crypto.randomUUID(),
      latencyMs: Date.now() - startedAt,
      ...usageFields,
    };
    return { script, provenance };
  }
}

interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

function readResponse(data: unknown): { text: string; stopReason: string | null; usage: ProviderUsage | undefined } {
  if (typeof data !== 'object' || data === null) {
    throw new ProviderCallError('anthropic response is not an object', 'invalid_response', true);
  }
  const record = data as Record<string, unknown>;

  // content is a block array — only text blocks carry the script.
  let text = '';
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>).type === 'text' &&
        typeof (block as Record<string, unknown>).text === 'string'
      ) {
        text += (block as Record<string, unknown>).text as string;
      }
    }
  }

  const usageRecord =
    typeof record.usage === 'object' && record.usage !== null
      ? (record.usage as Record<string, unknown>)
      : undefined;

  return {
    text,
    stopReason: typeof record.stop_reason === 'string' ? record.stop_reason : null,
    usage: usageRecord
      ? {
          inputTokens: asOptionalInt(usageRecord.input_tokens),
          outputTokens: asOptionalInt(usageRecord.output_tokens),
        }
      : undefined,
  };
}
