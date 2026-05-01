/**
 * Provider contract smoke tests — verify each adapter implements the
 * canonical interface, accepts known model names, and translates a
 * minimal SSE stream correctly. These tests do NOT make network calls;
 * they stub fetch via global mock or feed a synthetic stream.
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  ProviderRegistry,
  PROVIDER_IDS,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  XAIProvider,
  OllamaProvider,
} from '../index.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe('Provider registry', () => {
  test('registers all five built-in providers by default', () => {
    const r = new ProviderRegistry({}, silentLogger);
    expect(r.has(PROVIDER_IDS.ollama)).toBe(true);
    expect(r.has(PROVIDER_IDS.openai)).toBe(true);
    expect(r.has(PROVIDER_IDS.anthropic)).toBe(true);
    expect(r.has(PROVIDER_IDS.gemini)).toBe(true);
    expect(r.has(PROVIDER_IDS.xai)).toBe(true);
  });

  test('resolves model prefix to correct provider', () => {
    const r = new ProviderRegistry({}, silentLogger);
    expect(r.resolve({ model: 'gpt-4o' }).id).toBe('openai');
    expect(r.resolve({ model: 'o3-mini' }).id).toBe('openai');
    expect(r.resolve({ model: 'claude-3-5-sonnet-latest' }).id).toBe('anthropic');
    expect(r.resolve({ model: 'gemini-1.5-pro' }).id).toBe('gemini');
    expect(r.resolve({ model: 'grok-4' }).id).toBe('xai');
    expect(r.resolve({ model: 'ollama-llama3.1-8b' }).id).toBe('ollama');
  });

  test('explicit provider field overrides model-based matching', () => {
    const r = new ProviderRegistry({}, silentLogger);
    // Force an OpenAI-prefixed model through a custom endpoint
    expect(r.resolve({ model: 'gpt-4o', provider: 'anthropic' }).id).toBe('anthropic');
  });

  test('falls back to defaultProvider when nothing matches', () => {
    const r = new ProviderRegistry({ defaultProvider: 'openai' }, silentLogger);
    expect(r.resolve({ model: 'unknown-model-xyz' }).id).toBe('openai');
  });

  test('throws when nothing matches and no default', () => {
    const r = new ProviderRegistry({}, silentLogger);
    expect(() => r.resolve({ model: 'unknown-model-xyz' })).toThrow(/No provider matched/);
  });

  test('custom OpenAI-compatible endpoints register under their id', () => {
    const r = new ProviderRegistry({
      customEndpoints: [
        { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'or-…' },
      ],
    }, silentLogger);
    expect(r.has('openrouter')).toBe(true);
    expect(r.resolve({ model: 'anything', provider: 'openrouter' }).id).toBe('openrouter');
  });
});

describe('Provider matchers', () => {
  test('OpenAIProvider.matchesModel covers gpt/o-series including bare o1/o3/o4', () => {
    const p = new OpenAIProvider({}, silentLogger);
    expect(p.matchesModel('gpt-4o')).toBe(true);
    expect(p.matchesModel('gpt-5.4-mini')).toBe(true);
    expect(p.matchesModel('o3-mini')).toBe(true);
    expect(p.matchesModel('o1')).toBe(true);    // bare — no hyphen
    expect(p.matchesModel('o3')).toBe(true);    // bare
    expect(p.matchesModel('o4-mini')).toBe(true);
    expect(p.matchesModel('chatgpt-4o-latest')).toBe(true);
    expect(p.matchesModel('claude-3-opus')).toBe(false);
    expect(p.matchesModel('grok-4')).toBe(false);
  });

  test('AnthropicProvider.matchesModel covers claude-*', () => {
    const p = new AnthropicProvider({}, silentLogger);
    expect(p.matchesModel('claude-3-5-sonnet-latest')).toBe(true);
    expect(p.matchesModel('claude-opus-4')).toBe(true);
    expect(p.matchesModel('gpt-4o')).toBe(false);
  });

  test('GeminiProvider.matchesModel covers gemini-*', () => {
    const p = new GeminiProvider({}, silentLogger);
    expect(p.matchesModel('gemini-1.5-pro')).toBe(true);
    expect(p.matchesModel('models/gemini-2.0-flash')).toBe(true);
    expect(p.matchesModel('gpt-4o')).toBe(false);
  });

  test('XAIProvider.matchesModel covers grok-*', () => {
    const p = new XAIProvider({}, silentLogger);
    expect(p.matchesModel('grok-4')).toBe(true);
    expect(p.matchesModel('grok-2-vision')).toBe(true);
    expect(p.matchesModel('gpt-4o')).toBe(false);
  });

  test('OllamaProvider.matchesModel covers ollama-* prefix', () => {
    const p = new OllamaProvider({}, silentLogger);
    expect(p.matchesModel('ollama-llama3.1-8b')).toBe(true);
    expect(p.matchesModel('llama3.1:8b')).toBe(false);
  });
});

describe('Temperature gating for reasoning models', () => {
  // Some models (Anthropic Opus 4.7+, OpenAI o-series) reject the
  // `temperature` parameter with a 400. Each provider's _buildBody must
  // strip it for those models even though the dispatcher still defaults
  // it to 0.7 for non-reasoning models.

  test('AnthropicProvider strips temperature for claude-opus-4-7', () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' }, silentLogger);
    const body = p._buildBody({
      model:   'claude-opus-4-7',
      messages: [{ role: 'user', content: 'hi' }],
      options: { temperature: 0.7 },
    });
    expect(body.temperature).toBeUndefined();
  });

  test('AnthropicProvider keeps temperature for claude-haiku-4-5', () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' }, silentLogger);
    const body = p._buildBody({
      model:   'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      options: { temperature: 0.7 },
    });
    expect(body.temperature).toBe(0.7);
  });

  test('AnthropicProvider keeps temperature for claude-sonnet-4-6', () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' }, silentLogger);
    const body = p._buildBody({
      model:   'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      options: { temperature: 0.5 },
    });
    expect(body.temperature).toBe(0.5);
  });

  test('OpenAIProvider strips temperature for o-series reasoning models', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test' }, silentLogger);
    for (const model of ['o1-mini', 'o3-mini', 'o4-preview', 'o1', 'o3']) {
      const body = p._buildBody({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        options: { temperature: 0.7 },
      });
      expect(body.temperature).toBeUndefined();
    }
  });

  test('OpenAIProvider keeps temperature for gpt-4o', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test' }, silentLogger);
    const body = p._buildBody({
      model:   'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      options: { temperature: 0.7 },
    });
    expect(body.temperature).toBe(0.7);
  });
});

describe('Output-token field naming for OpenAI', () => {
  // OpenAI's reasoning models renamed `max_tokens` → `max_completion_tokens`.
  // Sending the old name to o-series returns:
  //   "'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."

  test('o-series receive `max_completion_tokens` (not `max_tokens`)', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test' }, silentLogger);
    for (const model of ['o1', 'o1-mini', 'o3', 'o3-mini', 'o4-preview']) {
      const body = p._buildBody({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        options:  { max_tokens: 4096 },
      });
      expect(body.max_tokens).toBeUndefined();
      expect(body.max_completion_tokens).toBe(4096);
    }
  });

  test('chat models still receive `max_tokens`', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test' }, silentLogger);
    const body = p._buildBody({
      model:   'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      options: { max_tokens: 4096 },
    });
    expect(body.max_tokens).toBe(4096);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  test('gpt-5 family receives max_completion_tokens (reasoning-mode by default)', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test' }, silentLogger);
    for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.1', 'gpt-5.2', 'gpt-5.4-mini']) {
      const body = p._buildBody({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        options:  { max_tokens: 4096 },
      });
      expect(body.max_tokens).toBeUndefined();
      expect(body.max_completion_tokens).toBe(4096);
    }
  });

  test('only gpt-5-chat-latest (exact) is exempt; gpt-5.1+ chat-latest is reasoning-mode', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test' }, silentLogger);

    // Original gpt-5-chat-latest: chat-mode, max_tokens
    const exemptBody = p._buildBody({
      model: 'gpt-5-chat-latest',
      messages: [{ role: 'user', content: 'hi' }],
      options:  { max_tokens: 4096 },
    });
    expect(exemptBody.max_tokens).toBe(4096);
    expect(exemptBody.max_completion_tokens).toBeUndefined();

    // gpt-5.1+ chat-latest variants: reasoning-mode, max_completion_tokens
    for (const model of ['gpt-5.1-chat-latest', 'gpt-5.2-chat-latest', 'gpt-5.3-chat-latest']) {
      const body = p._buildBody({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        options:  { max_tokens: 4096 },
      });
      expect(body.max_tokens).toBeUndefined();
      expect(body.max_completion_tokens).toBe(4096);
    }
  });
});

describe('Responses-only model classification', () => {
  test('gpt-5*-pro / o*-pro / gpt-5-codex are flagged chat:false', () => {
    for (const id of [
      'gpt-5-pro', 'gpt-5-pro-2025-10-06',
      'gpt-5.2-pro', 'gpt-5.4-pro-2026-03-05', 'gpt-5.5-pro',
      'o1-pro', 'o1-pro-2025-03-19', 'o3-pro', 'o3-pro-2025-06-10',
      'gpt-5-codex', 'gpt-5.1-codex',
    ]) {
      const c = OpenAIProvider._classifyOpenAIModel(id);
      expect(c.chat).toBe(false);
      expect(c.responsesOnly).toBe(true);
    }
  });

  test('non-pro / non-codex variants stay chat:true', () => {
    for (const id of ['gpt-5', 'gpt-5-mini', 'gpt-5.1', 'gpt-5.4-mini', 'gpt-4o', 'gpt-4o-mini', 'o1-mini', 'o3-mini', 'o4-mini']) {
      const c = OpenAIProvider._classifyOpenAIModel(id);
      expect(c.chat).toBe(true);
    }
  });
});

describe('Tool schema wrapping for the Chat Completions API', () => {
  // The CLI ships its tool catalog in the Responses API shape:
  //   { type: 'function', name, description, parameters }
  // OpenAI's Chat Completions API requires the wrapped shape:
  //   { type: 'function', function: { name, description, parameters } }
  // OpenAIProvider must normalize Responses-shaped schemas to wrapped
  // ones, otherwise the API returns:
  //   "Missing required parameter: 'tools[0].function'."

  test('OpenAIProvider wraps Responses-shaped schemas under `function`', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test' }, silentLogger);
    const body = p._buildBody({
      model:    'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      options: {
        tools: [
          {
            type: 'function',
            name: 'taskmanager',
            description: 'Manage tasks',
            parameters: { type: 'object', properties: { actions: { type: 'array' } } },
          },
        ],
      },
    });
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'taskmanager',
          description: 'Manage tasks',
          parameters: { type: 'object', properties: { actions: { type: 'array' } } },
        },
      },
    ]);
  });

  test('OpenAIProvider passes through already-wrapped Chat Completions schemas', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test' }, silentLogger);
    const wrapped = {
      type: 'function',
      function: {
        name: 'noop',
        description: 'No-op',
        parameters: { type: 'object', properties: {} },
      },
    };
    const body = p._buildBody({
      model:    'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      options:  { tools: [wrapped] },
    });
    expect(body.tools).toEqual([wrapped]);
  });

  test('OpenAIProvider supplies an empty parameters object when missing', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test' }, silentLogger);
    const body = p._buildBody({
      model:    'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      options: {
        tools: [{ type: 'function', name: 'pinger', description: 'No params' }],
      },
    });
    expect(body.tools[0].function.parameters).toEqual({ type: 'object', properties: {} });
  });
});

describe('OpenAIProvider — stream parsing (synthetic)', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  /** Build a ReadableStream that yields the given chunks as Uint8Arrays. */
  function streamFrom(...chunks) {
    let i = 0;
    return new ReadableStream({
      pull(controller) {
        if (i >= chunks.length) { controller.close(); return; }
        controller.enqueue(new TextEncoder().encode(chunks[i++]));
      },
    });
  }

  test('accumulates content across delta chunks and surfaces final usage', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok:      true,
      headers: new Map([['content-type', 'text/event-stream']]),
      body: streamFrom(
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5},"model":"gpt-4o"}\n',
        'data: [DONE]\n'
      ),
    });

    const p = new OpenAIProvider({ apiKey: 'sk-test' }, silentLogger);
    const chunks = [];
    const final = await p.sendMessageStream({
      model:    'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey:   'sk-test',
      options:  { stream: true },
    }, { onChunk: t => chunks.push(t) });

    expect(chunks).toEqual(['Hello', ' world']);
    expect(final.content).toBe('Hello world');
    expect(final.finishReason).toBe('stop');
    expect(final.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
    expect(final.model).toBe('gpt-4o');
  });

  test('routes reasoning_content deltas to onReasoningChunk', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok:      true,
      headers: new Map([['content-type', 'text/event-stream']]),
      body: streamFrom(
        'data: {"choices":[{"delta":{"reasoning_content":"Let me think..."}}]}\n',
        'data: {"choices":[{"delta":{"content":"answer"}}]}\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens_details":{"reasoning_tokens":42}}}\n'
      ),
    });

    const p = new OpenAIProvider({ apiKey: 'sk-test' }, silentLogger);
    const reasoningChunks = [];
    const final = await p.sendMessageStream({
      model:    'o3-mini',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey:   'sk-test',
      options:  { stream: true },
    }, { onReasoningChunk: t => reasoningChunks.push(t) });

    expect(reasoningChunks).toEqual(['Let me think...']);
    expect(final.reasoning).toBe('Let me think...');
    expect(final.reasoningTokens).toBe(42);
    expect(final.content).toBe('answer');
  });

  test('throws on HTTP error with status set', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok:         false,
      status:     401,
      statusText: 'Unauthorized',
      text:       async () => '{"error":{"message":"invalid api key"}}',
    });
    const p = new OpenAIProvider({ apiKey: 'bad' }, silentLogger);
    await expect(p.sendMessageStream({
      model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], apiKey: 'bad', options: { stream: true },
    })).rejects.toMatchObject({ status: 401 });
  });
});

describe('AnthropicProvider — body shape', () => {
  test('hoists systemPrompt to top-level system field', async () => {
    let captured;
    const realFetch = global.fetch;
    global.fetch = jest.fn(async (url, opts) => {
      captured = JSON.parse(opts.body);
      // Return a non-stream success body
      return {
        ok:      true,
        headers: new Map([['content-type', 'application/json']]),
        body:    null,
        json:    async () => ({
          content: [{ type: 'text', text: 'ok' }],
          model:   'claude-3-5-sonnet-latest',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      };
    });
    try {
      const p = new AnthropicProvider({ apiKey: 'sk-ant-test' }, silentLogger);
      const final = await p.sendMessage({
        model:        'claude-3-5-sonnet-latest',
        messages:     [{ role: 'user', content: 'hi' }],
        systemPrompt: 'You are a helpful assistant.',
        apiKey:       'sk-ant-test',
        options:      {},
      });
      expect(captured.system).toBe('You are a helpful assistant.');
      expect(captured.messages).toEqual([{ role: 'user', content: 'hi' }]);
      expect(captured.max_tokens).toBe(4096);
      expect(final.content).toBe('ok');
      expect(final.usage.prompt_tokens).toBe(1);
      expect(final.usage.completion_tokens).toBe(1);
      expect(final.finishReason).toBe('stop');
    } finally {
      global.fetch = realFetch;
    }
  });
});

describe('GeminiProvider — role/system translation', () => {
  test('maps assistant→model and hoists systemPrompt to systemInstruction', async () => {
    let captured;
    const realFetch = global.fetch;
    global.fetch = jest.fn(async (url, opts) => {
      captured = JSON.parse(opts.body);
      return {
        ok:      true,
        headers: new Map([['content-type', 'application/json']]),
        body:    null,
        json:    async () => ({
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          modelVersion: 'gemini-1.5-pro',
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        }),
      };
    });
    try {
      const p = new GeminiProvider({ apiKey: 'aiza-test' }, silentLogger);
      const final = await p.sendMessage({
        model:        'gemini-1.5-pro',
        messages:     [
          { role: 'user',      content: 'q1' },
          { role: 'assistant', content: 'a1' },
          { role: 'user',      content: 'q2' },
        ],
        systemPrompt: 'be terse',
        apiKey:       'aiza-test',
        options:      {},
      });
      expect(captured.systemInstruction.parts[0].text).toBe('be terse');
      expect(captured.contents.map(c => c.role)).toEqual(['user', 'model', 'user']);
      expect(captured.contents[0].parts[0].text).toBe('q1');
      expect(final.content).toBe('ok');
      expect(final.finishReason).toBe('stop');
    } finally {
      global.fetch = realFetch;
    }
  });
});
