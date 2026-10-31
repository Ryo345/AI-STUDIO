// Shared plumbing for the real (fetch-based) adapters. Anthropic and
// openai-compatible differ only in wire shape — everything from request →
// prompt → normalized script is identical, so it lives here once.

import type { GeneratedScript } from '@studio/domain';
import {
  ScriptNormalizationError,
  buildScriptPrompt,
  normalizeGeneratedScript,
  type ScriptPromptInput,
} from '@studio/pipeline';

import { ProviderCallError, type ScriptwriterRequest } from './types.js';

export const COMMON_VERSION = '0.1.0';

/** Merge config + payload instructions and shape the prompt input. */
export function buildPromptInput(request: ScriptwriterRequest): ScriptPromptInput {
  const instructions =
    [request.config.instructions?.trim(), request.instructions?.trim()]
      .filter((part): part is string => Boolean(part))
      .join('\n\n') || undefined;
  return {
    topic: request.topic,
    format: request.config.format,
    aspectRatio: request.config.aspectRatio,
    targetDurationSeconds: request.config.targetDurationSeconds,
    instructions,
  };
}

/** Used when the provider returns no usable title. */
export function fallbackTitle(request: ScriptwriterRequest): string {
  return request.topic.trim().slice(0, 200) || request.template.label;
}

/**
 * Funnel raw provider text through the same normalizer the mock uses — one
 * timing home, one clamp policy, for every provider. Structurally unusable
 * output becomes a retryable invalid_output: the model may do better on a
 * second attempt, and retry attempts are bounded upstream by the queue.
 */
export function normalizeProviderText(
  text: string,
  request: ScriptwriterRequest,
  log?: (message: string, detail?: Record<string, unknown>) => void,
): GeneratedScript {
  try {
    const { script, warnings } = normalizeGeneratedScript(text, {
      template: request.template,
      targetDurationSeconds: request.config.targetDurationSeconds,
      fallbackTitle: fallbackTitle(request),
    });
    for (const warning of warnings) log?.('provider output repaired', { warning });
    return script;
  } catch (error) {
    if (error instanceof ScriptNormalizationError) {
      throw new ProviderCallError(`provider output unusable: ${error.message}`, 'invalid_output', true);
    }
    throw error;
  }
}

/** Token counts from a provider usage object — absent or non-integer → undefined. */
export function asOptionalInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
