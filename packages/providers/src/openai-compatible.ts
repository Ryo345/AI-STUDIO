// OpenAI-compatible chat-completions adapter for third-party / self-hosted
// servers (vLLM, LM Studio, OpenRouter, …). Wire shape: POST
// {base}/chat/completions with Bearer auth. No max_tokens in the body —
// compatible servers disagree on the parameter name (max_tokens vs
// max_completion_tokens); the prompt contract and the request timeout bound
// the output instead.

import type { GeneratedScript, ScriptProvenance } from '@studio/domain';
import { buildScriptPrompt } from '@studio/pipeline';

import { asOptionalInt, buildPromptInput, normalizeProviderText } from './common.js';
import { postJsonForJson } from './http.js';
import { ProviderCallError, type ScriptwriterAdapter, type ScriptwriterContext, type ScriptwriterRequest, type ScriptwriterResult } from './types.js';

export const OPENAI_COMPATIBLE_VERSION = '0.1.0';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export class OpenAICompatibleScriptwriter implements ScriptwriterAdapter {
  readonly id = 'openai-compatible' as const;
  readonly isMock = false;

  constructor(private readonly config: OpenAICompatibleConfig) {}

  async generate(request: ScriptwriterRequest, ctx: ScriptwriterContext): Promise<ScriptwriterResult> {
    const startedAt = Date.now();
    const prompt = buildScriptPrompt(request.template, buildPromptInput(request));
    ctx.log?.('openai-compatible: generating script', { model: this.config.model });

    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const data = await postJsonForJson(url, {
      timeoutMs: this.config.timeoutMs,
      signal: ctx.signal,
      headers: { authorization: `Bearer ${this.config.apiKey}` },
      body: {
        model: this.config.model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      },
    });

    const { text, finishReason, usage } = readResponse(data);

    if (!text) {
      throw new ProviderCallError('openai-compatible returned no message content', 'empty_response', true);
    }
    if (finishReason === 'length') {
      // Truncated output cannot parse as the contracted JSON; a retry with
      // the same server limits cannot succeed either.
      throw new ProviderCallError('openai-compatible truncated the output (finish_reason=length)', 'stop_length', false);
    }

    const script = normalizeProviderText(text, request, ctx.log);
    const usageFields = usage?.inputTokens !== undefined || usage?.outputTokens !== undefined
      ? { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens }
      : {};
    const provenance: ScriptProvenance = {
      providerId: 'openai-compatible',
      model: this.config.model,
      isMock: false,
      // No seed parameter on the wire; a fresh id keeps provenance honest.
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

function readResponse(data: unknown): { text: string; finishReason: string | null; usage: ProviderUsage | undefined } {
  if (typeof data !== 'object' || data === null) {
    throw new ProviderCallError('openai-compatible response is not an object', 'invalid_response', true);
  }
  const record = data as Record<string, unknown>;

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0];
  if (typeof first !== 'object' || first === null) {
    throw new ProviderCallError('openai-compatible response has no choices', 'invalid_response', true);
  }
  const choice = first as Record<string, unknown>;
  const message =
    typeof choice.message === 'object' && choice.message !== null
      ? (choice.message as Record<string, unknown>)
      : undefined;

  const usageRecord =
    typeof record.usage === 'object' && record.usage !== null
      ? (record.usage as Record<string, unknown>)
      : undefined;

  return {
    text: typeof message?.content === 'string' ? message.content : '',
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    usage: usageRecord
      ? {
          inputTokens: asOptionalInt(usageRecord.prompt_tokens),
          outputTokens: asOptionalInt(usageRecord.completion_tokens),
        }
      : undefined,
  };
}
