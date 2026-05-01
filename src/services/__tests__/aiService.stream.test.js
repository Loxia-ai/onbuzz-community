/**
 * CLI ingestion contract test — consumes the exact SSE bytes that
 * autopilot-backend's `/llm/chat` route emits (locked in backend's
 * `routes/__tests__/llm.chat.reasoning.test.js`) and asserts that the
 * resulting response object carries content, reasoning, and reasoning
 * tokens correctly.
 *
 * Why this exists: the feature spans two repos. Per-repo tests prove
 * each side holds its own assumption. This one proves they share the
 * SAME wire contract: backend emissions parse correctly on the CLI
 * side. If either drifts in the future, this tripwire catches it BEFORE
 * "works in dev, broken in prod."
 *
 * The tested function (`_parseSSEResponseStream`) is the real production
 * parser used by `_makeStreamingAPIRequest` — it's not a test double.
 * Production and tests share a single implementation, so passing tests
 * mean passing production.
 */

import { describe, test, expect } from '@jest/globals';
import { _parseSSEResponseStream } from '../aiService.js';

/**
 * Build a fake ReadableStream-default-reader over a series of Uint8Array
 * chunks. Mirrors what `response.body.getReader()` returns in production,
 * but with caller-controlled bytes.
 */
function makeReader(chunks) {
  let i = 0;
  return {
    async read() {
      if (i >= chunks.length) return { done: true, value: undefined };
      const value = typeof chunks[i] === 'string'
        ? new TextEncoder().encode(chunks[i])
        : chunks[i];
      i++;
      return { done: false, value };
    },
  };
}

/**
 * Build an SSE frame string. Backend emits these via
 * `data: ${JSON.stringify(event)}\n\n`.
 */
function sse(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ────────────────────────────────────────────────────────────────────────
// Backward compat — plain content-only stream
// ────────────────────────────────────────────────────────────────────────

describe('_parseSSEResponseStream — backward compat (no reasoning)', () => {
  test('plain chunk + done stream returns content only, reasoning empty', async () => {
    const chunks = [
      sse({ type: 'start', model: 'gpt-4o' }),
      sse({ type: 'chunk', content: 'Hello ' }),
      sse({ type: 'chunk', content: 'world.' }),
      sse({ type: 'done', content: 'Hello world.',
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
            model: 'gpt-4o', finishReason: 'stop' }),
    ];
    const result = await _parseSSEResponseStream(makeReader(chunks), { fallbackModel: 'gpt-4o' });

    expect(result.content).toBe('Hello world.');
    expect(result.reasoning).toBe('');
    expect(result.reasoningTokens).toBeNull();
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
    expect(result.model).toBe('gpt-4o');
    expect(result.finishReason).toBe('stop');
  });

  test('onChunk callback fires per chunk in order', async () => {
    const chunks = [
      sse({ type: 'chunk', content: 'a' }),
      sse({ type: 'chunk', content: 'b' }),
      sse({ type: 'chunk', content: 'c' }),
      sse({ type: 'done', usage: null, model: 'x', finishReason: 'stop' }),
    ];
    const captured = [];
    await _parseSSEResponseStream(makeReader(chunks), { onChunk: (c) => captured.push(c) });
    expect(captured).toEqual(['a', 'b', 'c']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Reasoning — full content path (DeepSeek / Kimi / xAI / Claude-thinking)
// ────────────────────────────────────────────────────────────────────────

describe('_parseSSEResponseStream — reasoning accumulation', () => {
  test('interleaved reasoning_chunk + chunk accumulate into separate fields', async () => {
    const chunks = [
      sse({ type: 'reasoning_chunk', content: 'Let me think...' }),
      sse({ type: 'chunk', content: 'Answer: ' }),
      sse({ type: 'reasoning_chunk', content: ' still checking.' }),
      sse({ type: 'chunk', content: '42.' }),
      sse({ type: 'done', content: 'Answer: 42.',
            usage: {
              input_tokens: 10, output_tokens: 50, total_tokens: 60,
              reasoning_tokens: 40,
            },
            model: 'DeepSeek-R1-0528', finishReason: 'stop' }),
    ];
    const result = await _parseSSEResponseStream(makeReader(chunks));

    expect(result.content).toBe('Answer: 42.');
    expect(result.reasoning).toBe('Let me think... still checking.');
    expect(result.reasoningTokens).toBe(40);
    expect(result.model).toBe('DeepSeek-R1-0528');
  });

  test('onReasoningChunk callback fires separately from onChunk', async () => {
    const chunks = [
      sse({ type: 'reasoning_chunk', content: 'thinking' }),
      sse({ type: 'chunk', content: 'answer' }),
      sse({ type: 'done', usage: null, model: 'x', finishReason: 'stop' }),
    ];
    const texts = [];
    const reasons = [];
    await _parseSSEResponseStream(makeReader(chunks), {
      onChunk: (c) => texts.push(c),
      onReasoningChunk: (c) => reasons.push(c),
    });
    expect(texts).toEqual(['answer']);
    expect(reasons).toEqual(['thinking']);
  });

  test('backend-batched reasoning on done event is used when no reasoning_chunk events arrived', async () => {
    const chunks = [
      sse({ type: 'chunk', content: 'answer' }),
      sse({ type: 'done', content: 'answer', reasoning: 'batched thinking trace',
            usage: { input_tokens: 10, output_tokens: 30, reasoning_tokens: 25, total_tokens: 40 },
            model: 'x', finishReason: 'stop' }),
    ];
    const result = await _parseSSEResponseStream(makeReader(chunks));
    expect(result.reasoning).toBe('batched thinking trace');
    expect(result.reasoningTokens).toBe(25);
  });

  test('streamed reasoning beats done.reasoning when both present', async () => {
    // Belt-and-suspenders backends might send both. Prefer the streamed
    // accumulation (it's what the caller's onReasoningChunk saw).
    const chunks = [
      sse({ type: 'reasoning_chunk', content: 'streamed' }),
      sse({ type: 'chunk', content: 'ok' }),
      sse({ type: 'done', reasoning: 'batched', usage: null, model: 'x', finishReason: 'stop' }),
    ];
    const result = await _parseSSEResponseStream(makeReader(chunks));
    expect(result.reasoning).toBe('streamed');
  });
});

// ────────────────────────────────────────────────────────────────────────
// OpenAI o-series — reasoning_tokens count without content text
// ────────────────────────────────────────────────────────────────────────

describe('_parseSSEResponseStream — opaque reasoning (count-only)', () => {
  test('reasoning_tokens in done.usage but no reasoning_chunk events → reasoning="" + count', async () => {
    const chunks = [
      sse({ type: 'chunk', content: 'Final answer.' }),
      sse({ type: 'done', content: 'Final answer.',
            usage: {
              input_tokens: 10, output_tokens: 100, total_tokens: 110,
              reasoning_tokens: 85,
            },
            model: 'o3', finishReason: 'stop' }),
    ];
    const result = await _parseSSEResponseStream(makeReader(chunks));
    expect(result.reasoning).toBe('');
    expect(result.reasoningTokens).toBe(85);
    expect(result.content).toBe('Final answer.');
  });

  test('reasoning_tokens in the completion_tokens_details alt shape also extracts', async () => {
    const chunks = [
      sse({ type: 'chunk', content: 'answer' }),
      sse({ type: 'done', usage: {
        input_tokens: 10, output_tokens: 50, total_tokens: 60,
        completion_tokens_details: { reasoning_tokens: 40 },
      }, model: 'x', finishReason: 'stop' }),
    ];
    const result = await _parseSSEResponseStream(makeReader(chunks));
    expect(result.reasoningTokens).toBe(40);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Robustness — chunking boundaries, malformed frames, errors
// ────────────────────────────────────────────────────────────────────────

describe('_parseSSEResponseStream — robustness', () => {
  test('SSE frames split across TCP chunks at arbitrary byte positions still parse correctly', async () => {
    // Assemble one big SSE stream, then slice it at weird positions.
    const full =
      sse({ type: 'reasoning_chunk', content: 'Hmm.' }) +
      sse({ type: 'chunk', content: 'Answer.' }) +
      sse({ type: 'done', content: 'Answer.',
            usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10, reasoning_tokens: 3 },
            model: 'x', finishReason: 'stop' });
    // Split into 7-byte chunks (nothing magical — small enough to cross event boundaries).
    const chunks = [];
    for (let i = 0; i < full.length; i += 7) chunks.push(full.slice(i, i + 7));

    const result = await _parseSSEResponseStream(makeReader(chunks));
    expect(result.content).toBe('Answer.');
    expect(result.reasoning).toBe('Hmm.');
    expect(result.reasoningTokens).toBe(3);
  });

  test('malformed JSON data frames are skipped without crashing', async () => {
    const chunks = [
      'data: this-is-not-json\n\n',
      sse({ type: 'chunk', content: 'real' }),
      sse({ type: 'done', usage: null, model: 'x', finishReason: 'stop' }),
    ];
    const result = await _parseSSEResponseStream(makeReader(chunks));
    expect(result.content).toBe('real');
  });

  test('[DONE] sentinel is ignored (SSE end-of-stream marker convention)', async () => {
    const chunks = [
      sse({ type: 'chunk', content: 'hi' }),
      sse({ type: 'done', content: 'hi', usage: null, model: 'x', finishReason: 'stop' }),
      'data: [DONE]\n\n',
    ];
    const result = await _parseSSEResponseStream(makeReader(chunks));
    expect(result.content).toBe('hi');
  });

  test('stream ending without trailing newline still emits the final done event', async () => {
    // Some proxies drop the terminal \n\n. Verify the trailing-line flush works.
    const chunks = [
      'data: {"type":"chunk","content":"x"}\n\n',
      'data: {"type":"done","content":"x","usage":null,"model":"m","finishReason":"stop"}', // NO \n\n
    ];
    const result = await _parseSSEResponseStream(makeReader(chunks));
    expect(result.content).toBe('x');
    expect(result.finishReason).toBe('stop');
  });

  test('type:"error" event throws with .code propagated', async () => {
    const chunks = [
      sse({ type: 'error', error: 'provider 500', code: 'upstream_500' }),
    ];
    await expect(_parseSSEResponseStream(makeReader(chunks))).rejects.toMatchObject({
      message: 'provider 500',
      code: 'upstream_500',
    });
  });

  test('stream ends before done → returns accumulated content with no finalData', async () => {
    const chunks = [
      sse({ type: 'chunk', content: 'partial' }),
      // No done event.
    ];
    const result = await _parseSSEResponseStream(makeReader(chunks), { fallbackModel: 'm' });
    expect(result.content).toBe('partial');
    expect(result.finishReason).toBe('stop');
    expect(result.model).toBe('m');
  });

  test('unknown event types are silently ignored (forward compat)', async () => {
    const chunks = [
      sse({ type: 'start', model: 'x', requestId: 'r1' }), // metadata, no content
      sse({ type: 'some_new_future_event', data: 'whatever' }),
      sse({ type: 'chunk', content: 'real' }),
      sse({ type: 'done', content: 'real', usage: null, model: 'x', finishReason: 'stop' }),
    ];
    const result = await _parseSSEResponseStream(makeReader(chunks));
    expect(result.content).toBe('real');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Tool-call bridge output — inline JSON flows through as content
// ────────────────────────────────────────────────────────────────────────

describe('_parseSSEResponseStream — tool-call inline JSON passthrough', () => {
  test('backend-bridged tool_call inline JSON arrives in content verbatim', async () => {
    // The backend converts native tool_calls to inline JSON blocks and
    // yields them as regular `chunk` events. Verify the CLI receives
    // them intact so its TagParser can extract.
    // Header only — see toolCallBridge.js DESIGN NOTE: the preamble
    // is "**Calling X**" with no param preview, because the JSON block
    // below is the single source of truth and duplicating its contents
    // in a preview was bloating the context.
    const inlineBlock = '\n**Calling filesystem**\n\n'
      + '```json\n'
      + '{\n  "toolId": "filesystem",\n  "parameters": {\n    "action": "read"\n  }\n}\n'
      + '```\n';
    const chunks = [
      sse({ type: 'chunk', content: 'Sure, checking. ' }),
      sse({ type: 'chunk', content: inlineBlock }),
      sse({ type: 'done', content: 'Sure, checking. ' + inlineBlock,
            usage: { input_tokens: 5, output_tokens: 30, total_tokens: 35 },
            model: 'DeepSeek-R1-0528', finishReason: 'tool_calls' }),
    ];
    const result = await _parseSSEResponseStream(makeReader(chunks));
    expect(result.content).toContain('```json');
    expect(result.content).toContain('"toolId": "filesystem"');
    expect(result.content).toContain('"action": "read"');
    expect(result.finishReason).toBe('tool_calls');
  });
});
