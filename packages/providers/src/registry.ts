// Provider resolution — the honest-mock policy's enforcement point. A real
// provider selected without its credentials must kill the worker at boot
// (ProviderConfigError); it must never silently fall back to the mock, and
// the mock must never be loaded when a real provider is selected.

import { AnthropicScriptwriter } from './anthropic.js';
import { MockScriptwriter } from './mock.js';
import { OpenAICompatibleScriptwriter } from './openai-compatible.js';
import { ProviderConfigError, type ScriptwriterAdapter } from './types.js';

export const REGISTRY_VERSION = '0.1.0';

export const PROVIDER_ENV = 'SCRIPTWRITER_PROVIDER';
export const TIMEOUT_ENV = 'PROVIDER_TIMEOUT_MS';

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000; // matches the job backoff ceiling — a call hanging longer can never win

/** PROVIDER_TIMEOUT_MS with documented default 120000, clamped to [1s, 10min]. */
export function providerTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env[TIMEOUT_ENV]);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(raw), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/**
 * Resolve the scriptwriter adapter from env. Throws ProviderConfigError for
 * an unknown provider id or a real provider missing any required credential
 * — the worker treats that as fatal at boot.
 */
export function resolveScriptwriter(env: NodeJS.ProcessEnv = process.env): ScriptwriterAdapter {
  const provider = (env[PROVIDER_ENV] ?? 'mock').trim();

  switch (provider) {
    case 'mock':
      return new MockScriptwriter(env);

    case 'anthropic': {
      const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? '';
      const model = env.ANTHROPIC_MODEL?.trim() ?? '';
      if (!apiKey) {
        throw new ProviderConfigError('SCRIPTWRITER_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
      }
      if (!model) {
        throw new ProviderConfigError('SCRIPTWRITER_PROVIDER=anthropic requires ANTHROPIC_MODEL');
      }
      return new AnthropicScriptwriter({
        apiKey,
        model,
        baseUrl: env.ANTHROPIC_BASE_URL?.trim() || undefined,
        timeoutMs: providerTimeoutMs(env),
      });
    }

    case 'openai-compatible': {
      const baseUrl = env.OPENAI_COMPATIBLE_BASE_URL?.trim() ?? '';
      const apiKey = env.OPENAI_COMPATIBLE_API_KEY?.trim() ?? '';
      const model = env.OPENAI_COMPATIBLE_MODEL?.trim() ?? '';
      if (!baseUrl) {
        throw new ProviderConfigError(
          'SCRIPTWRITER_PROVIDER=openai-compatible requires OPENAI_COMPATIBLE_BASE_URL',
        );
      }
      if (!apiKey) {
        throw new ProviderConfigError(
          'SCRIPTWRITER_PROVIDER=openai-compatible requires OPENAI_COMPATIBLE_API_KEY',
        );
      }
      if (!model) {
        throw new ProviderConfigError(
          'SCRIPTWRITER_PROVIDER=openai-compatible requires OPENAI_COMPATIBLE_MODEL',
        );
      }
      return new OpenAICompatibleScriptwriter({ baseUrl, apiKey, model, timeoutMs: providerTimeoutMs(env) });
    }

    default:
      throw new ProviderConfigError(
        `unknown SCRIPTWRITER_PROVIDER '${provider}' (expected mock | anthropic | openai-compatible)`,
      );
  }
}
