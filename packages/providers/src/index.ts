// @studio/providers — provider adapter interfaces + implementations.
// M5: scriptwriter (mock default / anthropic / openai-compatible).
// BYOK (M6): nvidia-nim adapter + AES-256-GCM credential crypto + explicit-
// credential factory for per-workspace, per-task model routing.
// Phase 2: TTS, image generation + stock search, storage.
// All provider selection is env- or router-driven server-side; no secrets reach the frontend.

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
  NVIDIA_NIM_VERSION,
  DEFAULT_NVIDIA_NIM_BASE_URL,
  NvidiaNimScriptwriter,
  type NvidiaNimConfig,
  listNvidiaNimModels,
  testNvidiaNimConnection,
  nimChatCompletion,
  type ProviderCatalogResult,
  type NimChatMessage,
  type NimChatParams,
} from './nvidia-nim.js';

export {
  CONNECTION_TEST_VERSION,
  testProviderConnection,
  type ProviderTestInput,
} from './connection-test.js';

// Credential encryption at rest — server-only (API routes + worker).
export {
  CREDENTIAL_CRYPTO_VERSION,
  CREDENTIAL_KEY_ENV,
  loadCredentialEncryptionKey,
  encryptSecret,
  decryptSecret,
  maskSecret,
  secretFingerprint,
} from './credential-crypto.js';

export {
  REGISTRY_VERSION,
  PROVIDER_ENV,
  TIMEOUT_ENV,
  providerTimeoutMs,
  resolveScriptwriter,
  createScriptwriter,
  type ScriptwriterCredentials,
} from './registry.js';
