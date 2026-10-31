// @studio/providers — provider adapter interfaces + implementations.
// M5: scriptwriter (mock default / anthropic / openai-compatible).
// Phase 2: TTS, image generation + stock search, storage.
// All provider selection is env-driven server-side; no secrets reach the frontend.

export { PROVIDERS_VERSION } from './types.js';
export {
  ProviderCallError,
  ProviderConfigError,
  type ScriptwriterAdapter,
  type ScriptwriterContext,
  type ScriptwriterRequest,
  type ScriptwriterResult,
} from './types.js';

export { HTTP_VERSION, postJsonForJson, type HttpJsonOptions } from './http.js';

export { COMMON_VERSION, buildPromptInput, normalizeProviderText } from './common.js';

export { MOCK_VERSION, MOCK_DELAY_ENV, MockScriptwriter } from './mock.js';

export {
  ANTHROPIC_VERSION,
  ANTHROPIC_API_VERSION,
  DEFAULT_ANTHROPIC_BASE_URL,
  AnthropicScriptwriter,
  type AnthropicConfig,
} from './anthropic.js';

export {
  OPENAI_COMPATIBLE_VERSION,
  OpenAICompatibleScriptwriter,
  type OpenAICompatibleConfig,
} from './openai-compatible.js';

export {
  REGISTRY_VERSION,
  PROVIDER_ENV,
  TIMEOUT_ENV,
  providerTimeoutMs,
  resolveScriptwriter,
} from './registry.js';
