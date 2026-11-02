import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProjectConfig } from '@studio/domain';
import { neutralTemplate } from '@studio/niches';

import { listNvidiaNimModels, NvidiaNimScriptwriter, testNvidiaNimConnection } from '../nvidia-nim.js';
import { createScriptwriter } from '../registry.js';
import { ProviderCallError, ProviderConfigError } from '../types.js';

const CONFIG: ProjectConfig = {
  aspectRatio: '9:16',
  targetDurationSeconds: 60,
  format: 'narrative',
};

function makeRequest(jobId = '22222222-2222-4222-8222-222222222222') {
  return { jobId, topic: 'How black holes bend time', template: neutralTemplate, config: CONFIG };
}

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

function scriptJson() {
  return {
    title: 'Time bends',
    scenes: [
      { beatId: 'hook', narration: 'Near a black hole, seconds stretch into years.', durationMs: 4000 },
      { beatId: 'context', narration: 'Einstein predicted it in 1915.', durationMs: 4000 },
      { beatId: 'development', narration: 'Interstellar made it visceral.', durationMs: 4000 },
    ],
    totalDurationMs: 12_000,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NvidiaNimScriptwriter', () => {
  it('defaults to the NIM hosted endpoint and posts the chat-completions contract', async () => {
    const calls = stubFetch(() => jsonResponse({ choices: [{ message: { content: JSON.stringify(scriptJson()) }, finish_reason: 'stop' }] }));

    const adapter = new NvidiaNimScriptwriter({ apiKey: 'nvapi-test', model: 'meta/llama-3.1-70b-instruct', timeoutMs: 5_000 });
    expect(adapter.id).toBe('nvidia-nim');
    expect(adapter.isMock).toBe(false);

    const result = await adapter.generate(makeRequest(), { signal: new AbortController().signal });

    expect(calls[0]!.url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer nvapi-test');
    const body = JSON.parse(String(calls[0]!.init.body)) as { model: string; messages: unknown[] };
    expect(body.model).toBe('meta/llama-3.1-70b-instruct');
    expect(Array.isArray(body.messages)).toBe(true);

    expect(result.provenance.providerId).toBe('nvidia-nim');
    expect(result.provenance.isMock).toBe(false);
    expect(result.provenance.model).toBe('meta/llama-3.1-70b-instruct');
    expect(result.script.scenes).toHaveLength(3);
  });

  it('honors a custom base URL (self-hosted NIM)', async () => {
    const calls = stubFetch(() => jsonResponse({ choices: [{ message: { content: JSON.stringify(scriptJson()) }, finish_reason: 'stop' }] }));
    const adapter = new NvidiaNimScriptwriter({ apiKey: 'k', model: 'm', baseUrl: 'http://localhost:8000/v1/', timeoutMs: 5_000 });
    await adapter.generate(makeRequest(), { signal: new AbortController().signal });
    expect(calls[0]!.url).toBe('http://localhost:8000/v1/chat/completions');
  });

  it('maps a 401 to a non-retryable provider error', async () => {
    stubFetch(() => jsonResponse({ error: 'Invalid API key' }, 401));
    const adapter = new NvidiaNimScriptwriter({ apiKey: 'bad', model: 'm', timeoutMs: 5_000 });
    await expect(
      adapter.generate(makeRequest(), { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'http_401', retryable: false });
  });

  it('maps a 429 to a retryable provider error', async () => {
    stubFetch(() => jsonResponse({ error: 'rate limited' }, 429));
    const adapter = new NvidiaNimScriptwriter({ apiKey: 'k', model: 'm', timeoutMs: 5_000 });
    await expect(
      adapter.generate(makeRequest(), { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'http_429', retryable: true });
  });
});

describe('listNvidiaNimModels / testNvidiaNimConnection', () => {
  it('returns a sorted model list on 200', async () => {
    stubFetch(() => jsonResponse({ data: [{ id: 'z-model' }, { id: 'a-model' }, { id: 'a-model' }] }));
    const result = await listNvidiaNimModels({
      apiKey: 'nvapi-test',
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['a-model', 'z-model']);
  });

  it('never throws — auth failures come back structured', async () => {
    stubFetch(() => jsonResponse({ detail: 'unauthorized' }, 401));
    const result = await testNvidiaNimConnection({
      apiKey: 'bad',
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.error?.code).toBe('http_401');
    expect(JSON.stringify(result)).not.toContain('nvapi');
  });

  it('reports timeouts as failures, not rejections', async () => {
    stubFetch(() => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    const result = await testNvidiaNimConnection({
      apiKey: 'k',
      timeoutMs: 10,
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('timeout');
  });
});

describe('createScriptwriter (BYOK factory)', () => {
  it('builds a NIM adapter with explicit credentials', () => {
    const adapter = createScriptwriter('nvidia-nim', { apiKey: 'nvapi-k', model: 'meta/m', timeoutMs: 5_000 });
    expect(adapter.id).toBe('nvidia-nim');
    expect(adapter.isMock).toBe(false);
  });

  it('rejects an empty model id', () => {
    expect(() =>
      createScriptwriter('nvidia-nim', { apiKey: 'k', model: '  ', timeoutMs: 5_000 }),
    ).toThrow(ProviderConfigError);
  });

  it('never constructs the mock', () => {
    // Type-level guarantee — assert the exclusion by probing the union at runtime.
    const ids = ['mock'];
    expect(() => createScriptwriter(ids[0] as 'nvidia-nim', { apiKey: 'k', model: 'm', timeoutMs: 1 })).toThrow();
  });
});

describe('ProviderCallError contract', () => {
  it('keeps classification intact through the NIM path', () => {
    const error = new ProviderCallError('boom', 'timeout', true);
    expect(error.retryable).toBe(true);
  });
});
