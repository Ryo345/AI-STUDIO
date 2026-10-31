import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProjectConfig } from '@studio/domain';
import { neutralTemplate } from '@studio/niches';
import type { ScriptwriterRequest } from '../types.js';

import { AnthropicScriptwriter } from '../anthropic.js';
import { MockScriptwriter } from '../mock.js';
import { OpenAICompatibleScriptwriter } from '../openai-compatible.js';
import { ProviderCallError, ProviderConfigError } from '../types.js';
import { providerTimeoutMs, resolveScriptwriter } from '../registry.js';

const CONFIG: ProjectConfig = {
  aspectRatio: '9:16',
  targetDurationSeconds: 60,
  format: 'narrative',
};

function makeRequest(jobId = '11111111-1111-4111-8111-111111111111'): ScriptwriterRequest {
  return { jobId, topic: 'The fate of the Franklin expedition', template: neutralTemplate, config: CONFIG };
}

// A minimal fetch stub — postJsonForJson only touches ok/status/json/text.
function stubFetch(handler: (url: string, init: RequestInit) => unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = async (url: string | URL, init: RequestInit = {}) => {
    const urlText = String(url);
    calls.push({ url: urlText, init });
    return handler(urlText, init);
  };
  vi.stubGlobal('fetch', vi.fn(impl));
  return calls;
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

const ANTHROPIC_OK = {
  content: [{ type: 'text', text: '' }], // replaced per test with the script JSON
  stop_reason: 'end_turn',
  usage: { input_tokens: 1234, output_tokens: 567 },
};

function scriptJson(title = 'Frozen men') {
  return {
    title,
    scenes: [
      { beatId: 'hook', narration: 'In 1845, 129 men sailed into the ice and vanished.', durationMs: 4000 },
      { beatId: 'context', narration: 'The Franklin expedition was the Victorian era’s moon shot.', durationMs: 4000 },
      { beatId: 'development', narration: 'Rescue ships found only cairns, boats, and bones.', durationMs: 4000 },
    ],
    totalDurationMs: 12_000,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveScriptwriter', () => {
  it('defaults to the mock when SCRIPTWRITER_PROVIDER is unset', () => {
    const adapter = resolveScriptwriter({});
    expect(adapter.id).toBe('mock');
    expect(adapter.isMock).toBe(true);
  });

  it('returns the mock explicitly', () => {
    expect(resolveScriptwriter({ SCRIPTWRITER_PROVIDER: 'mock' }).id).toBe('mock');
  });

  it('fails fast when anthropic is selected without credentials', () => {
    expect(() => resolveScriptwriter({ SCRIPTWRITER_PROVIDER: 'anthropic' })).toThrow(ProviderConfigError);
    expect(() =>
      resolveScriptwriter({ SCRIPTWRITER_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }),
    ).toThrow(/ANTHROPIC_MODEL/);
  });

  it('resolves the anthropic adapter with credentials', () => {
    const adapter = resolveScriptwriter({
      SCRIPTWRITER_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_MODEL: 'claude-opus-4-8',
    });
    expect(adapter.id).toBe('anthropic');
    expect(adapter.isMock).toBe(false);
  });

  it('fails fast when openai-compatible is missing any of its three vars', () => {
    expect(() => resolveScriptwriter({ SCRIPTWRITER_PROVIDER: 'openai-compatible' })).toThrow(
      /OPENAI_COMPATIBLE_BASE_URL/,
    );
    expect(() =>
      resolveScriptwriter({ SCRIPTWRITER_PROVIDER: 'openai-compatible', OPENAI_COMPATIBLE_BASE_URL: 'http://x' }),
    ).toThrow(/OPENAI_COMPATIBLE_API_KEY/);
    expect(() =>
      resolveScriptwriter({
        SCRIPTWRITER_PROVIDER: 'openai-compatible',
        OPENAI_COMPATIBLE_BASE_URL: 'http://x',
        OPENAI_COMPATIBLE_API_KEY: 'k',
      }),
    ).toThrow(/OPENAI_COMPATIBLE_MODEL/);
  });

  it('resolves the openai-compatible adapter when fully configured', () => {
    const adapter = resolveScriptwriter({
      SCRIPTWRITER_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:1234/v1',
      OPENAI_COMPATIBLE_API_KEY: 'k',
      OPENAI_COMPATIBLE_MODEL: 'm',
    });
    expect(adapter.id).toBe('openai-compatible');
  });

  it('rejects unknown provider ids', () => {
    expect(() => resolveScriptwriter({ SCRIPTWRITER_PROVIDER: 'gpt' })).toThrow(ProviderConfigError);
  });

  it('applies the PROVIDER_TIMEOUT_MS default and clamps', () => {
    expect(providerTimeoutMs({})).toBe(120_000);
    expect(providerTimeoutMs({ PROVIDER_TIMEOUT_MS: 'nope' })).toBe(120_000);
    expect(providerTimeoutMs({ PROVIDER_TIMEOUT_MS: '0' })).toBe(120_000);
    expect(providerTimeoutMs({ PROVIDER_TIMEOUT_MS: '5000' })).toBe(5_000);
    expect(providerTimeoutMs({ PROVIDER_TIMEOUT_MS: '10' })).toBe(1_000);
    expect(providerTimeoutMs({ PROVIDER_TIMEOUT_MS: '999999999' })).toBe(600_000);
  });
});

describe('MockScriptwriter', () => {
  it('is deterministic per jobId — identical output across retries', async () => {
    const adapter = new MockScriptwriter({});
    const a = await adapter.generate(makeRequest(), { signal: new AbortController().signal });
    const b = await adapter.generate(makeRequest(), { signal: new AbortController().signal });
    expect(a.script).toEqual(b.script);
    // latencyMs is wall-clock, not seeded — everything else must be stable.
    const { latencyMs: _a, ...provA } = a.provenance;
    const { latencyMs: _b, ...provB } = b.provenance;
    expect(provA).toEqual(provB);
    expect(a.provenance.isMock).toBe(true);
    expect(a.provenance.seed).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('produces structurally valid scenes for the template', async () => {
    const adapter = new MockScriptwriter({});
    const { script } = await adapter.generate(makeRequest(), { signal: new AbortController().signal });
    expect(script.scenes.length).toBeGreaterThanOrEqual(3);
    expect(script.totalDurationMs).toBe(script.scenes.reduce((sum, s) => sum + s.durationMs, 0));
  });

  it('honors abort during simulated latency', async () => {
    const adapter = new MockScriptwriter({ MOCK_GENERATE_DELAY_MS: '10000' });
    const controller = new AbortController();
    const pending = adapter.generate(makeRequest(), { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('AnthropicScriptwriter', () => {
  function adapter() {
    return new AnthropicScriptwriter({ apiKey: 'test-key', model: 'claude-opus-4-8', timeoutMs: 1_000 });
  }

  it('posts the Messages API shape and parses a successful response', async () => {
    const calls = stubFetch(() => jsonResponse({ ...ANTHROPIC_OK, content: [{ type: 'text', text: JSON.stringify(scriptJson()) }] }));

    const { script, provenance } = await adapter().generate(makeRequest(), { signal: new AbortController().signal });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body.model).toBe('claude-opus-4-8');
    expect(typeof body.system).toBe('string');
    expect(Array.isArray(body.messages)).toBe(true);

    expect(script.title).toBe('Frozen men');
    expect(script.scenes).toHaveLength(3);
    expect(provenance.providerId).toBe('anthropic');
    expect(provenance.isMock).toBe(false);
    expect(provenance.model).toBe('claude-opus-4-8');
    expect(provenance.inputTokens).toBe(1_234);
    expect(provenance.outputTokens).toBe(567);
  });

  it('trims a trailing slash off a custom base URL', async () => {
    const custom = new AnthropicScriptwriter({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://proxy.example.com/',
      timeoutMs: 1_000,
    });
    const calls = stubFetch(() => jsonResponse({ ...ANTHROPIC_OK, content: [{ type: 'text', text: JSON.stringify(scriptJson()) }] }));
    await custom.generate(makeRequest(), { signal: new AbortController().signal });
    expect(calls[0]!.url).toBe('https://proxy.example.com/v1/messages');
  });

  it('ignores non-text content blocks', async () => {
    stubFetch(() =>
      jsonResponse({
        ...ANTHROPIC_OK,
        content: [{ type: 'thinking' }, { type: 'text', text: JSON.stringify(scriptJson()) }],
      }),
    );
    const { script } = await adapter().generate(makeRequest(), { signal: new AbortController().signal });
    expect(script.title).toBe('Frozen men');
  });

  it('treats a non-end_turn stop_reason as a classified failure', async () => {
    stubFetch(() => jsonResponse({ ...ANTHROPIC_OK, content: [], stop_reason: 'refusal' }));
    await expect(adapter().generate(makeRequest(), { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'stop_refusal',
      retryable: false,
    });
  });

  it('treats max_tokens truncation as non-retryable', async () => {
    stubFetch(() => jsonResponse({ ...ANTHROPIC_OK, content: [], stop_reason: 'max_tokens' }));
    await expect(adapter().generate(makeRequest(), { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'stop_max_tokens',
      retryable: false,
    });
  });

  it('classifies HTTP 400 as non-retryable and 429/5xx as retryable', async () => {
    stubFetch(() => jsonResponse({ error: 'bad request' }, 400));
    await expect(adapter().generate(makeRequest(), { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'http_400',
      retryable: false,
    });
    stubFetch(() => jsonResponse({ error: 'rate limited' }, 429));
    await expect(adapter().generate(makeRequest(), { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'http_429',
      retryable: true,
    });
  });

  it('funnels unparseable model output through invalid_output (retryable)', async () => {
    stubFetch(() => jsonResponse({ ...ANTHROPIC_OK, content: [{ type: 'text', text: 'not json {' }] }));
    await expect(adapter().generate(makeRequest(), { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'invalid_output',
      retryable: true,
    });
  });
});

describe('OpenAICompatibleScriptwriter', () => {
  function adapter() {
    return new OpenAICompatibleScriptwriter({
      baseUrl: 'http://localhost:1234/v1/',
      apiKey: 'test-key',
      model: 'test-model',
      timeoutMs: 1_000,
    });
  }

  it('posts the chat-completions shape with Bearer auth', async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: JSON.stringify(scriptJson()) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 900, completion_tokens: 400 },
      }),
    );

    const { script, provenance } = await adapter().generate(makeRequest(), { signal: new AbortController().signal });

    expect(calls[0]!.url).toBe('http://localhost:1234/v1/chat/completions');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    const body = JSON.parse(String(calls[0]!.init.body)) as { messages: Array<{ role: string }>; model: string };
    expect(body.model).toBe('test-model');
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);

    expect(script.title).toBe('Frozen men');
    expect(provenance.providerId).toBe('openai-compatible');
    expect(provenance.inputTokens).toBe(900);
    expect(provenance.outputTokens).toBe(400);
  });

  it('treats finish_reason=length as a non-retryable truncation', async () => {
    stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: '{"scenes":[' }, finish_reason: 'length' }] }),
    );
    await expect(adapter().generate(makeRequest(), { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'stop_length',
      retryable: false,
    });
  });

  it('rejects a response with no choices', async () => {
    stubFetch(() => jsonResponse({ choices: [] }));
    await expect(adapter().generate(makeRequest(), { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('classifies HTTP 401 as non-retryable', async () => {
    stubFetch(() => jsonResponse({ error: 'bad key' }, 401));
    await expect(adapter().generate(makeRequest(), { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'http_401',
      retryable: false,
    });
  });

  it('accepts responses that omit finish_reason when content is present', async () => {
    stubFetch(() => jsonResponse({ choices: [{ message: { content: JSON.stringify(scriptJson()) } }] }));
    const { script } = await adapter().generate(makeRequest(), { signal: new AbortController().signal });
    expect(script.title).toBe('Frozen men');
  });
});
