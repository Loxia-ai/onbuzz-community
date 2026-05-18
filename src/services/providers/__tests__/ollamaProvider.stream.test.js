/**
 * Regression test for the OllamaProvider streaming shape translation.
 *
 * Background — what this guards
 * -----------------------------
 * OllamaService.sendMessageStream resolves to a FLAT object:
 *   { content, model, tokenUsage, finishReason, toolCalls? }
 *
 * The non-streaming sibling (OllamaService.sendMessage) resolves to the
 * OpenAI-shaped object:
 *   { choices: [{ message: { content, tool_calls }, finish_reason }], model, usage }
 *
 * An earlier version of OllamaProvider.sendMessageStream copy-pasted the
 * non-streaming translator and read raw.choices[0].message.content from
 * the streaming response. That always yielded final.content === '', which
 * the scheduler's empty-message guard dropped, which made the browser
 * extension's quick-send poll loop time out with "Timed out waiting for
 * the agent reply." despite Ollama happily streaming the answer and the
 * WebSocket UI receiving chunks normally.
 *
 * If this test fails, the regression has come back.
 */

import { describe, test, expect, jest } from '@jest/globals';
import OllamaProvider from '../ollamaProvider.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function stubService(p, returnValue, opts = {}) {
  p._service = {
    sendMessageStream: jest.fn(async (modelId, messages, options) => {
      if (opts.emitChunks && options.onChunk) {
        for (const c of opts.emitChunks) options.onChunk(c);
      }
      return returnValue;
    }),
  };
}

describe('OllamaProvider.sendMessageStream — final shape translation', () => {
  test('maps flat ollamaService result onto canonical {content,usage,finishReason}', async () => {
    const p = new OllamaProvider({}, silentLogger);
    stubService(p, {
      content:      'Hello world',
      model:        'ollama-qwen2.5-1.5b',
      tokenUsage:   { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      finishReason: 'stop',
    }, {
      emitChunks: [
        { content: 'Hello', type: 'chunk' },
        { content: ' world', type: 'chunk' },
      ],
    });

    const chunks = [];
    const onDone = jest.fn();
    const final = await p.sendMessageStream(
      {
        model:    'ollama-qwen2.5-1.5b',
        messages: [{ role: 'user', content: 'hi' }],
        options:  { stream: true },
      },
      { onChunk: (c) => chunks.push(c), onDone },
    );

    // Chunks flow straight through; the provider does not transform them.
    expect(chunks).toEqual([
      { content: 'Hello', type: 'chunk' },
      { content: ' world', type: 'chunk' },
    ]);

    // The translation: tokenUsage → usage, finishReason passthrough,
    // content lifted from the flat object (NOT from a non-existent
    // choices[] array).
    expect(final.content).toBe('Hello world');
    expect(final.usage).toEqual({ prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 });
    expect(final.finishReason).toBe('stop');
    expect(final.model).toBe('ollama-qwen2.5-1.5b');

    // onDone receives the same object the function returns.
    expect(onDone).toHaveBeenCalledWith(final);
  });

  test('translates Ollama-style message.tool_calls into canonical toolCalls', async () => {
    const p = new OllamaProvider({}, silentLogger);
    stubService(p, {
      content:      '',
      model:        'ollama-qwen2.5-1.5b',
      tokenUsage:   { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
      finishReason: 'stop',
      toolCalls: [
        {
          function: {
            name:      'web',
            arguments: { url: 'https://example.com' },
          },
        },
      ],
    });

    const final = await p.sendMessageStream(
      { model: 'ollama-qwen2.5-1.5b', messages: [{ role: 'user', content: 'fetch' }], options: {} },
      {},
    );

    expect(final.toolCalls).toHaveLength(1);
    expect(final.toolCalls[0].name).toBe('web');
    // Object-form arguments must be JSON-stringified for the canonical contract.
    expect(typeof final.toolCalls[0].arguments).toBe('string');
    expect(JSON.parse(final.toolCalls[0].arguments)).toEqual({ url: 'https://example.com' });
    expect(final.toolCalls[0].id).toBe('call_web');
  });

  test('logs a warn diagnostic when streaming completes with empty content and no tools', async () => {
    const warn = jest.fn();
    const p = new OllamaProvider({}, { ...silentLogger, warn });
    stubService(p, {
      content:      '',
      model:        'ollama-qwen2.5-1.5b',
      tokenUsage:   { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
      finishReason: 'length',
    });

    const final = await p.sendMessageStream(
      { model: 'ollama-qwen2.5-1.5b', messages: [{ role: 'user', content: 'hi' }], options: {} },
      {},
    );

    expect(final.content).toBe('');
    expect(warn).toHaveBeenCalledWith(
      '[Ollama] streaming completed with empty content',
      expect.objectContaining({ finishReason: 'length', hasToolCalls: false }),
    );
  });

  test('falls back to a stop finishReason when service did not provide one', async () => {
    const p = new OllamaProvider({}, silentLogger);
    stubService(p, { content: 'ok', model: 'ollama-x', tokenUsage: null });
    const final = await p.sendMessageStream(
      { model: 'ollama-x', messages: [{ role: 'user', content: 'hi' }], options: {} },
      {},
    );
    expect(final.finishReason).toBe('stop');
  });
});
