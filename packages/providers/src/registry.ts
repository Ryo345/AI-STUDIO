// Provider resolution — the honest-mock policy's enforcement point. A real
// provider selected without its credentials must kill the worker at boot
// (ProviderConfigError); it must never silently fall back to the mock, and
// the mock must never be loaded when a real provider is selected.

import type { ScriptwriterProviderId } from '@studio/domain';

import { AnthropicScriptwriter } from './anthropic.js';
import { MockScriptwriter } from './mock.js';
import { NvidiaNimScriptwriter } from './nvidia-nim.js';
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

    case 'nvidia-nim': {
      const apiKey = env.NVIDIA_NIM_API_KEY?.trim() ?? '';
      const model = env.NVIDIA_NIM_MODEL?.trim() ?? '';
      if (!apiKey) {
        throw new ProviderConfigError('SCRIPTWRITER_PROVIDER=nvidia-nim requires NVIDIA_NIM_API_KEY');
      }
      if (!model) {
        throw new ProviderConfigError('SCRIPTWRITER_PROVIDER=nvidia-nim requires NVIDIA_NIM_MODEL');
      }
      return new NvidiaNimScriptwriter({
        apiKey,
        model,
        baseUrl: env.NVIDIA_NIM_BASE_URL?.trim() || undefined,
        timeoutMs: providerTimeoutMs(env),
      });
    }

    default:
      throw new ProviderConfigError(
        `unknown SCRIPTWRITER_PROVIDER '${provider}' (expected mock | anthropic | openai-compatible | nvidia-nim)`,
      );
  }
}

// ── BYOK factory ─────────────────────────────────────────────────────────
// Per-job adapter construction with explicit, workspace-supplied credentials
// (decrypted server-side moments earlier). This is the path the model router
// exercises; resolveScriptwriter stays for env-only/dev operation.

export interface ScriptwriterCredentials {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
}

/** Build a scriptwriter from an explicit credential set (BYOK). mock is not constructible here — it has no credentials. */
export function createScriptwriter(
  providerId: Exclude<ScriptwriterProviderId, 'mock'>,
  credentials: ScriptwriterCredentials,
): ScriptwriterAdapter {
  const model = credentials.model.trim();
  if (!model) {
    throw new ProviderConfigError(`model assignment for '${providerId}' has an empty model id`);
  }
  switch (providerId) {
    case 'anthropic':
      return new AnthropicScriptwriter({
        apiKey: credentials.apiKey,
        model,
        baseUrl: credentials.baseUrl,
        timeoutMs: credentials.timeoutMs,
      });
    case 'openai-compatible':
      return new OpenAICompatibleScriptwriter({
        baseUrl: credentials.baseUrl?.trim() || '',
        apiKey: credentials.apiKey,
        model,
        timeoutMs: credentials.timeoutMs,
      });
    case 'nvidia-nim':
      return new NvidiaNimScriptwriter({
        apiKey: credentials.apiKey,
        model,
        baseUrl: credentials.baseUrl,
        timeoutMs: credentials.timeoutMs,
      });
    default:
      // Includes 'mock' at runtime (the type excludes it, but callers can
      // arrive with unvalidated data): the mock must never be constructible
      // through the BYOK path.
      throw new ProviderConfigError(`provider '${providerId as string}' cannot be constructed with credentials`);
  }
}
