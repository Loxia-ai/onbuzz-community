/**
 * Tests for reasoning-content handling in conversationQuery.read().
 *
 * Contract:
 *   - `hasReasoning` is ALWAYS surfaced when the archived message carries
 *     a non-empty `reasoning` field, even when the text isn't returned.
 *     Gives the agent a signal to re-fetch with includeReasoning=true.
 *   - `reasoningTokens` is ALWAYS surfaced when present (non-null).
 *   - The reasoning TEXT is returned only when includeReasoning=true.
 *   - Other modes (overview, range, search, around, byTool) are
 *     unaffected by this change — reasoning is deliberately scoped to
 *     `read` because loading chain-of-thought in bulk responses would
 *     blow the byte cap immediately.
 */

import { describe, test, expect } from '@jest/globals';
import { read, range, around } from '../conversationQuery.js';

function mkMsg({ id = 'msg_0001', content = 'hello', reasoning, reasoningTokens }) {
  const m = {
    id,
    role: 'assistant',
    content,
    createdAt: '2026-04-21T10:00:00Z',
    tokenUsage: { totalTokens: 100 },
  };
  if (reasoning !== undefined) m.reasoning = reasoning;
  if (reasoningTokens !== undefined) m.reasoningTokens = reasoningTokens;
  return m;
}

describe('read() — reasoning presence signalling', () => {
  test('hasReasoning=true + reasoningTokens surfaced without returning the text', () => {
    const messages = [mkMsg({ reasoning: 'long chain of thought', reasoningTokens: 512 })];
    const out = read(messages, { messageId: 'msg_0001' });
    expect(out.targetFound).toBe(true);
    expect(out.message.hasReasoning).toBe(true);
    expect(out.message.reasoningTokens).toBe(512);
    // Reasoning text is NOT returned by default
    expect(out.message.reasoning).toBeUndefined();
  });

  test('includeReasoning=true returns the reasoning text', () => {
    const thought = 'Let me think step by step. First I need to...';
    const messages = [mkMsg({ reasoning: thought, reasoningTokens: 150 })];
    const out = read(messages, { messageId: 'msg_0001', includeReasoning: true });
    expect(out.message.reasoning).toBe(thought);
    expect(out.message.hasReasoning).toBe(true);
    expect(out.message.reasoningTokens).toBe(150);
  });

  test('message with no reasoning → hasReasoning=false, reasoningTokens=null', () => {
    const messages = [mkMsg({})];
    const out = read(messages, { messageId: 'msg_0001' });
    expect(out.message.hasReasoning).toBe(false);
    expect(out.message.reasoningTokens).toBeNull();
    expect(out.message.reasoning).toBeUndefined();
  });

  test('message with only reasoningTokens (opaque provider, no text)', () => {
    // OpenAI o-series case: we know they thought, but not what they thought.
    const messages = [mkMsg({ reasoningTokens: 4217 })];
    const out = read(messages, { messageId: 'msg_0001', includeReasoning: true });
    expect(out.message.hasReasoning).toBe(false);    // no text present
    expect(out.message.reasoningTokens).toBe(4217);
    expect(out.message.reasoning).toBeUndefined();
  });

  test('empty reasoning string treated as absent (keeps signal honest)', () => {
    const messages = [mkMsg({ reasoning: '', reasoningTokens: 0 })];
    const out = read(messages, { messageId: 'msg_0001', includeReasoning: true });
    expect(out.message.hasReasoning).toBe(false);
    expect(out.message.reasoning).toBeUndefined();
  });

  test('reasoning is not pulled into around()/range() responses (byte-cap discipline)', () => {
    // Other modes return slim entries; reasoning inclusion is scoped to
    // read() only because chain-of-thought content can dwarf content.
    const messages = [mkMsg({ reasoning: 'x'.repeat(50_000) })];
    const rangeOut = range(messages);
    const aroundOut = around(messages, { messageId: 'msg_0001' });
    expect(rangeOut.messages[0].reasoning).toBeUndefined();
    expect(aroundOut.messages[0].reasoning).toBeUndefined();
  });

  test('includeReasoning does not leak reasoning across byte cap — cap still applies', () => {
    // A large reasoning block honored alongside a small content block
    // should still be bounded by maxBytes in the overall response.
    const huge = 'R'.repeat(50_000);
    const messages = [mkMsg({ content: 'tiny', reasoning: huge })];
    const out = read(messages, {
      messageId: 'msg_0001',
      includeReasoning: true,
      maxBytes: 4096,
    });
    // Either reasoning was omitted entirely, OR included but the content
    // field was trimmed via the existing byte-cap path — both are valid.
    // What must NOT happen: the full 50KB reasoning in the response.
    const serialized = JSON.stringify(out);
    expect(serialized.length).toBeLessThan(50_000);
  });
});
