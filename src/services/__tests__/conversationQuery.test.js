/**
 * Tests for conversationQuery — the pure query lens over the archive.
 *
 * These cover the five public query modes + shared helpers. Because the
 * module is stateless and free of I/O, every test feeds a synthesized
 * `messages[]` array in and asserts against the returned structure — no
 * mocks, no fs, no agentPool.
 *
 * Heavy emphasis on:
 *   - POINTER STABILITY: messageIds survive across appends and queries.
 *   - GUARDRAILS: byte caps, hard max limits, hard max around window.
 *   - CURSOR ROUND-TRIP: opaque encoding, resumption across calls.
 *   - SEARCH SCOPE: content + tool-call arguments, NEVER tool results.
 *
 * If you're adding a new mode or changing semantics, add a locked test
 * here too — this file IS the behavioral contract.
 */

import { describe, test, expect } from '@jest/globals';
import {
  overview,
  range,
  search,
  around,
  byTool,
  encodeCursor,
  decodeCursor,
  capEntries,
  DEFAULT_MAX_BYTES,
  DEFAULT_LIMIT,
  HARD_MAX_LIMIT,
  DEFAULT_MAX_RESULTS,
  HARD_MAX_RESULTS,
  HARD_MAX_AROUND,
  OVERVIEW_TIMELINE_SIZE,
  read,
  HARD_MAX_READ_CHARS,
  HARD_MAX_READ_LINES,
} from '../conversationQuery.js';

// ─────────────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────────────

function msg(overrides = {}) {
  const i = overrides.i ?? 0;
  return {
    id: `msg_${String(i).padStart(4, '0')}`,
    role: 'user',
    content: `message ${i}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    tokenUsage: { totalTokens: 10 },
    toolExecutions: [],
    ...overrides,
  };
}

function conv(n) {
  return Array.from({ length: n }, (_, i) => msg({ i, role: i % 2 === 0 ? 'user' : 'assistant' }));
}

// ─────────────────────────────────────────────────────────────────────────
// overview
// ─────────────────────────────────────────────────────────────────────────

describe('overview()', () => {
  test('empty archive returns zeroed summary, never throws', () => {
    expect(overview([])).toEqual({
      totalMessages: 0, firstAt: null, lastAt: null, totalApproxTokens: 0, timeline: [],
    });
    expect(overview(null)).toEqual({
      totalMessages: 0, firstAt: null, lastAt: null, totalApproxTokens: 0, timeline: [],
    });
  });

  test('reports totalMessages and token total using tokenUsage when present', () => {
    const out = overview(conv(5));
    expect(out.totalMessages).toBe(5);
    expect(out.totalApproxTokens).toBe(50);
  });

  test('falls back to char/4 estimate when tokenUsage missing', () => {
    const messages = [msg({ i: 0, content: 'abcdefgh', tokenUsage: null })]; // 8 chars → 2 tokens
    expect(overview(messages).totalApproxTokens).toBe(2);
  });

  test('firstAt / lastAt are the first + last message timestamps', () => {
    const out = overview(conv(3));
    expect(out.firstAt).toBe('2026-01-01T00:00:00.000Z');
    expect(out.lastAt).toBe('2026-01-01T00:00:02.000Z');
  });

  test('timeline always includes first and last messageIds as bookmarks', () => {
    const messages = conv(100);
    const out = overview(messages);
    expect(out.timeline[0].messageId).toBe('msg_0000');
    expect(out.timeline[out.timeline.length - 1].messageId).toBe('msg_0099');
  });

  test('timeline caps at OVERVIEW_TIMELINE_SIZE markers for large archives', () => {
    const out = overview(conv(500));
    expect(out.timeline.length).toBe(OVERVIEW_TIMELINE_SIZE);
  });

  test('timeline shows every message when archive is smaller than the marker cap', () => {
    const out = overview(conv(3));
    expect(out.timeline.length).toBe(3);
  });

  test('snippet in timeline is truncated (not full content)', () => {
    const long = 'x'.repeat(200);
    const out = overview([msg({ i: 0, content: long })]);
    expect(out.timeline[0].snippet.length).toBeLessThanOrEqual(100);
    expect(out.timeline[0].snippet).toContain('more chars');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// range
// ─────────────────────────────────────────────────────────────────────────

describe('range()', () => {
  test('default limit caps at DEFAULT_LIMIT', () => {
    const out = range(conv(100));
    expect(out.messages.length).toBe(DEFAULT_LIMIT);
    expect(out.total).toBe(100);
    expect(out.hasMore).toBe(true);
    expect(out.offset).toBe(0);
  });

  test('offset+limit paginates correctly', () => {
    const out = range(conv(100), { offset: 20, limit: 5 });
    expect(out.messages.length).toBe(5);
    expect(out.messages[0].messageId).toBe('msg_0020');
    expect(out.messages[4].messageId).toBe('msg_0024');
    expect(out.offset).toBe(20);
    expect(out.hasMore).toBe(true);
  });

  test('hasMore false when reaching end', () => {
    const out = range(conv(25), { offset: 20, limit: 10 });
    expect(out.messages.length).toBe(5);
    expect(out.hasMore).toBe(false);
  });

  test('limit clamped to HARD_MAX_LIMIT', () => {
    const out = range(conv(500), { limit: 9999 });
    expect(out.messages.length).toBe(HARD_MAX_LIMIT);
    expect(out.limit).toBe(HARD_MAX_LIMIT);
  });

  test('from/to timestamp window filters before paginating', () => {
    const messages = conv(100);
    const out = range(messages, {
      from: '2026-01-01T00:00:10.000Z',
      to:   '2026-01-01T00:00:19.000Z',
      limit: 100,
    });
    expect(out.total).toBe(10);
    expect(out.messages[0].messageId).toBe('msg_0010');
    expect(out.messages[9].messageId).toBe('msg_0019');
  });

  test('detail="full" returns full content, toolExecutions, contextReferences', () => {
    const messages = [msg({
      i: 0,
      content: 'long '.repeat(1000),
      toolExecutions: [{ toolId: 't', input: 'x' }],
      contextReferences: [{ id: 'r1' }],
      metadata: { model: 'gpt-5' },
    })];
    const out = range(messages, { detail: 'full' });
    expect(out.messages[0].content.length).toBeGreaterThan(1000);
    expect(out.messages[0].toolExecutions).toHaveLength(1);
    expect(out.messages[0].contextReferences).toHaveLength(1);
    expect(out.messages[0].model).toBe('gpt-5');
  });

  test('default detail truncates content (messageId still present)', () => {
    const out = range([msg({ i: 0, content: 'x'.repeat(10000) })], { limit: 1 });
    expect(out.messages[0].content.length).toBeLessThan(10000);
    expect(out.messages[0].content).toMatch(/more chars/);
    expect(out.messages[0].messageId).toBe('msg_0000');
  });

  test('never exposes array indices in the return shape', () => {
    const out = range(conv(5));
    for (const m of out.messages) {
      expect(m).not.toHaveProperty('index');
      expect(m).not.toHaveProperty('idx');
    }
  });

  test('negative offset clamps to 0', () => {
    const out = range(conv(10), { offset: -5, limit: 3 });
    expect(out.offset).toBe(0);
    expect(out.messages[0].messageId).toBe('msg_0000');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// search — scope + role + cursor
// ─────────────────────────────────────────────────────────────────────────

describe('search()', () => {
  test('empty query returns empty matches, no cursor', () => {
    const out = search(conv(10), { query: '' });
    expect(out.matches).toEqual([]);
    expect(out.cursor).toBeNull();
  });

  test('case-insensitive substring match on content', () => {
    const messages = [
      msg({ i: 0, content: 'Building the DATABASE schema' }),
      msg({ i: 1, content: 'unrelated' }),
    ];
    const out = search(messages, { query: 'database' });
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].messageId).toBe('msg_0000');
    expect(out.matches[0].source).toBe('content');
  });

  test('search also matches tool-call arguments (toolId + input)', () => {
    const messages = [
      msg({ i: 0, content: 'nothing here' }),
      msg({ i: 1, content: 'also nothing', toolExecutions: [
        { toolId: 'terminal', input: { command: 'npm install react-query' } }
      ]}),
    ];
    const out = search(messages, { query: 'react-query' });
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].messageId).toBe('msg_0001');
    expect(out.matches[0].source).toBe('tool_args');
  });

  test('search does NOT match tool RESULTS (output/error) — user decision', () => {
    const messages = [
      msg({ i: 0, content: 'unrelated', toolExecutions: [
        { toolId: 'terminal', input: 'echo foo', output: 'the-secret-token-value' }
      ]}),
    ];
    const out = search(messages, { query: 'the-secret-token' });
    expect(out.matches).toHaveLength(0);
  });

  test('role filter narrows results by message.role', () => {
    const messages = [
      msg({ i: 0, role: 'user',      content: 'hello foo' }),
      msg({ i: 1, role: 'assistant', content: 'hello foo' }),
    ];
    expect(search(messages, { query: 'foo', role: 'user' }).matches).toHaveLength(1);
    expect(search(messages, { query: 'foo', role: 'assistant' }).matches).toHaveLength(1);
    expect(search(messages, { query: 'foo' }).matches).toHaveLength(2);
  });

  test('snippet surrounds the hit with up to 60 chars on each side', () => {
    const content = 'a'.repeat(200) + 'needle' + 'b'.repeat(200);
    const out = search([msg({ i: 0, content })], { query: 'needle' });
    const s = out.matches[0].snippet;
    expect(s).toContain('needle');
    expect(s.length).toBeLessThan(content.length);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
  });

  test('highlightRanges point at the match WITHIN the returned snippet', () => {
    const out = search([msg({ i: 0, content: 'aaaaaa needle bbbbbb' })], { query: 'needle' });
    const m = out.matches[0];
    const [start, end] = m.highlightRanges[0];
    expect(m.snippet.slice(start, end).toLowerCase()).toBe('needle');
  });

  test('maxResults clamps returned matches but total still reports the count', () => {
    const messages = Array.from({ length: 30 }, (_, i) => msg({ i, content: 'match ' + i }));
    const out = search(messages, { query: 'match', maxResults: 5 });
    expect(out.matches.length).toBe(5);
    expect(out.total).toBe(30);
    expect(out.hasMore).toBe(true);
    expect(out.cursor).toBeTruthy();
  });

  test('cursor round-trip resumes after the last returned match', () => {
    const messages = Array.from({ length: 12 }, (_, i) => msg({ i, content: 'match ' + i }));
    const page1 = search(messages, { query: 'match', maxResults: 5 });
    expect(page1.matches[4].messageId).toBe('msg_0004');
    const page2 = search(messages, { query: 'match', cursor: page1.cursor, maxResults: 5 });
    expect(page2.matches[0].messageId).toBe('msg_0005');
    expect(page2.matches[4].messageId).toBe('msg_0009');
  });

  test('cursor survives archive growth — appending new messages does not shift resumption', () => {
    const messages = Array.from({ length: 10 }, (_, i) => msg({ i, content: 'match ' + i }));
    const page1 = search(messages, { query: 'match', maxResults: 3 });
    // Now the archive grows; append brand-new messages.
    for (let i = 10; i < 20; i++) messages.push(msg({ i, content: 'match ' + i }));
    const page2 = search(messages, { query: 'match', cursor: page1.cursor, maxResults: 5 });
    // Resumption is AFTER the last hit id from page 1 — not affected by later appends.
    expect(page2.matches[0].messageId).toBe('msg_0003');
  });

  test('cursor with unknown lastMessageId silently falls back to start (no crash)', () => {
    const out = search(conv(5), {
      query: 'message',
      cursor: encodeCursor({ lastMessageId: 'does-not-exist' }),
    });
    expect(out.matches.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// around
// ─────────────────────────────────────────────────────────────────────────

describe('around()', () => {
  test('returns N before + target + N after', () => {
    const out = around(conv(20), { messageId: 'msg_0010', before: 2, after: 2 });
    expect(out.targetFound).toBe(true);
    expect(out.messages.map(m => m.messageId)).toEqual(
      ['msg_0008', 'msg_0009', 'msg_0010', 'msg_0011', 'msg_0012']
    );
  });

  test('clamps at archive start', () => {
    const out = around(conv(20), { messageId: 'msg_0001', before: 5, after: 2 });
    expect(out.messages[0].messageId).toBe('msg_0000');
    expect(out.messages.map(m => m.messageId)).toContain('msg_0001');
  });

  test('clamps at archive end', () => {
    const out = around(conv(20), { messageId: 'msg_0018', before: 2, after: 5 });
    expect(out.messages.map(m => m.messageId)).toContain('msg_0019');
    expect(out.messages[out.messages.length - 1].messageId).toBe('msg_0019');
  });

  test('targetFound=false when messageId not in archive', () => {
    const out = around(conv(10), { messageId: 'msg_hallucinated' });
    expect(out.targetFound).toBe(false);
    expect(out.messages).toEqual([]);
  });

  test('missing messageId → targetFound=false, not a crash', () => {
    const out = around(conv(10), {});
    expect(out.targetFound).toBe(false);
  });

  test('before/after clamp to HARD_MAX_AROUND', () => {
    const messages = conv(200);
    const out = around(messages, { messageId: 'msg_0100', before: 99999, after: 99999 });
    // With 20 each side, total is 2*20+1 = 41 messages (unless clamped).
    expect(out.messages.length).toBeLessThanOrEqual(HARD_MAX_AROUND * 2 + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// byTool
// ─────────────────────────────────────────────────────────────────────────

describe('byTool()', () => {
  function makeToolMessage(i, execs) {
    return msg({ i, role: 'assistant', content: `turn ${i}`, toolExecutions: execs });
  }

  test('returns one entry per tool call (flattened across messages)', () => {
    const messages = [
      makeToolMessage(0, [{ toolId: 'terminal', input: 'ls' }, { toolId: 'filesystem', input: 'cat' }]),
      makeToolMessage(1, [{ toolId: 'terminal', input: 'pwd' }]),
    ];
    const out = byTool(messages);
    expect(out.total).toBe(3);
    expect(out.toolCalls.map(t => t.toolId)).toEqual(['terminal', 'filesystem', 'terminal']);
  });

  test('toolId filter narrows results', () => {
    const messages = [
      makeToolMessage(0, [{ toolId: 'terminal', input: 'ls' }, { toolId: 'filesystem', input: 'cat' }]),
      makeToolMessage(1, [{ toolId: 'terminal', input: 'pwd' }]),
    ];
    const out = byTool(messages, { toolId: 'terminal' });
    expect(out.total).toBe(2);
    expect(out.toolCalls.every(t => t.toolId === 'terminal')).toBe(true);
  });

  test('points at messageId so the agent can `around()` into context', () => {
    const messages = [makeToolMessage(0, [{ toolId: 'x', input: 'y' }])];
    const out = byTool(messages);
    expect(out.toolCalls[0].messageId).toBe('msg_0000');
  });

  test('does NOT include tool outputs (user decision — results excluded)', () => {
    const messages = [makeToolMessage(0, [
      { toolId: 'x', input: 'in', output: 'secret-output', error: null }
    ])];
    const out = byTool(messages);
    expect(out.toolCalls[0]).not.toHaveProperty('output');
    expect(JSON.stringify(out.toolCalls[0])).not.toContain('secret-output');
  });

  test('cursor round-trip works across pages', () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      makeToolMessage(i, [{ toolId: 't', input: 'x' }])
    );
    const page1 = byTool(messages, { limit: 3 });
    expect(page1.toolCalls[2].messageId).toBe('msg_0002');
    const page2 = byTool(messages, { cursor: page1.cursor, limit: 3 });
    expect(page2.toolCalls[0].messageId).toBe('msg_0003');
  });

  test('inputSnippet truncates long inputs', () => {
    const messages = [makeToolMessage(0, [
      { toolId: 't', input: 'a'.repeat(1000) }
    ])];
    const out = byTool(messages);
    expect(out.toolCalls[0].inputSnippet.length).toBeLessThan(1000);
    expect(out.toolCalls[0].inputSnippet).toMatch(/more chars/);
  });

  test('empty archive returns empty list without crashing', () => {
    expect(byTool([]).toolCalls).toEqual([]);
    expect(byTool(null).toolCalls).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// encodeCursor / decodeCursor — opaque, round-trip safe
// ─────────────────────────────────────────────────────────────────────────

describe('cursor encoding', () => {
  test('encode/decode round-trip preserves the object', () => {
    const obj = { lastMessageId: 'msg_abc', query: 'hello', role: 'user' };
    const roundtripped = decodeCursor(encodeCursor(obj));
    expect(roundtripped).toEqual(obj);
  });

  test('decode of null / undefined / empty returns null', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  test('decode of garbage returns null, does not throw', () => {
    expect(decodeCursor('not-base64')).toBeNull();
    expect(decodeCursor('YWJj' /* base64 of "abc" */)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// capEntries — size guardrail
// ─────────────────────────────────────────────────────────────────────────

describe('capEntries()', () => {
  test('returns entries unchanged when under budget', () => {
    const entries = [{ a: 1 }, { a: 2 }];
    const out = capEntries(entries, 1024);
    expect(out.entries).toEqual(entries);
    expect(out.truncatedCount).toBe(0);
  });

  test('drops trailing entries when over budget; reports truncated count', () => {
    const bigEntry = { payload: 'x'.repeat(500) };
    const entries = Array.from({ length: 10 }, () => bigEntry);
    const out = capEntries(entries, 1000);
    expect(out.entries.length).toBeLessThan(10);
    expect(out.truncatedCount).toBeGreaterThan(0);
    expect(out.entries.length + out.truncatedCount).toBe(10);
  });

  test('handles empty input', () => {
    expect(capEntries([])).toEqual({ entries: [], truncatedCount: 0 });
    expect(capEntries(null)).toEqual({ entries: [], truncatedCount: 0 });
  });

  test('default maxBytes equals DEFAULT_MAX_BYTES', () => {
    // smoke — just ensure the export is a reasonable number
    expect(DEFAULT_MAX_BYTES).toBeGreaterThan(10_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// read — single message, sub-message window (lines OR chars)
// ─────────────────────────────────────────────────────────────────────────

describe('read()', () => {
  function makeBigMsg(lines = 200, charsPerLine = 80) {
    const body = Array.from({ length: lines }, (_, i) =>
      `line ${String(i + 1).padStart(4, '0')}: ` + 'x'.repeat(Math.max(0, charsPerLine - 12))
    ).join('\n');
    return msg({ i: 0, content: body });
  }

  describe('no window selectors — returns full content', () => {
    test('returns whole content + kind="full"', () => {
      const messages = [msg({ i: 0, content: 'short message' })];
      const out = read(messages, { messageId: 'msg_0000' });
      expect(out.targetFound).toBe(true);
      expect(out.message.content).toBe('short message');
      expect(out.message.contentWindow.kind).toBe('full');
      expect(out.message.contentWindow.hasMoreBefore).toBe(false);
      expect(out.message.contentWindow.hasMoreAfter).toBe(false);
    });

    test('byte cap trims content, marks hasMoreAfter=true and truncatedAtBytes', () => {
      const huge = 'y'.repeat(100_000);
      const messages = [msg({ i: 0, content: huge })];
      const out = read(messages, { messageId: 'msg_0000', maxBytes: 4096 });
      expect(out.message.content.length).toBeLessThan(huge.length);
      expect(out.message.contentWindow.truncatedAtBytes).toBeGreaterThan(0);
      expect(out.message.contentWindow.hasMoreAfter).toBe(true);
    });
  });

  describe('line-based window', () => {
    test('selects inclusive [lineFrom, lineTo] range', () => {
      const messages = [makeBigMsg(50)];
      const out = read(messages, { messageId: 'msg_0000', lineFrom: 10, lineTo: 14 });
      expect(out.message.contentWindow.kind).toBe('lines');
      expect(out.message.contentWindow.lineFrom).toBe(10);
      expect(out.message.contentWindow.lineTo).toBe(14);
      expect(out.message.contentWindow.totalLines).toBe(50);
      const lines = out.message.content.split('\n');
      expect(lines.length).toBe(5);
      expect(lines[0]).toMatch(/^line 0010:/);
      expect(lines[4]).toMatch(/^line 0014:/);
    });

    test('hasMoreBefore / hasMoreAfter reflect position in archive', () => {
      const messages = [makeBigMsg(100)];
      const mid = read(messages, { messageId: 'msg_0000', lineFrom: 40, lineTo: 60 });
      expect(mid.message.contentWindow.hasMoreBefore).toBe(true);
      expect(mid.message.contentWindow.hasMoreAfter).toBe(true);

      const start = read(messages, { messageId: 'msg_0000', lineFrom: 1, lineTo: 10 });
      expect(start.message.contentWindow.hasMoreBefore).toBe(false);
      expect(start.message.contentWindow.hasMoreAfter).toBe(true);

      const end = read(messages, { messageId: 'msg_0000', lineFrom: 95, lineTo: 100 });
      expect(end.message.contentWindow.hasMoreBefore).toBe(true);
      expect(end.message.contentWindow.hasMoreAfter).toBe(false);
    });

    test('out-of-bounds lineFrom/lineTo clamp instead of throwing', () => {
      const messages = [makeBigMsg(20)];
      const out = read(messages, { messageId: 'msg_0000', lineFrom: -5, lineTo: 9999 });
      expect(out.message.contentWindow.lineFrom).toBe(1);
      expect(out.message.contentWindow.lineTo).toBe(20);
    });

    test('swapped lineFrom > lineTo is normalized', () => {
      const messages = [makeBigMsg(20)];
      const out = read(messages, { messageId: 'msg_0000', lineFrom: 15, lineTo: 5 });
      expect(out.message.contentWindow.lineFrom).toBe(5);
      expect(out.message.contentWindow.lineTo).toBe(15);
    });

    test('bare lineFrom defaults to a sane line window (not rest-of-message)', () => {
      const messages = [makeBigMsg(1000)];
      const out = read(messages, { messageId: 'msg_0000', lineFrom: 100 });
      const span = out.message.contentWindow.lineTo - out.message.contentWindow.lineFrom + 1;
      expect(span).toBeLessThanOrEqual(HARD_MAX_READ_LINES);
      expect(span).toBeGreaterThan(1);
    });

    test('enormous lineTo clamps to HARD_MAX_READ_LINES', () => {
      const messages = [makeBigMsg(10_000)];
      const out = read(messages, {
        messageId: 'msg_0000', lineFrom: 1, lineTo: 100_000,
      });
      const span = out.message.contentWindow.lineTo - out.message.contentWindow.lineFrom + 1;
      expect(span).toBeLessThanOrEqual(HARD_MAX_READ_LINES);
    });
  });

  describe('char-based window', () => {
    test('selects half-open [contentFrom, contentTo) range', () => {
      const content = 'abcdefghijklmnopqrstuvwxyz';
      const messages = [msg({ i: 0, content })];
      const out = read(messages, { messageId: 'msg_0000', contentFrom: 3, contentTo: 8 });
      expect(out.message.content).toBe('defgh');
      expect(out.message.contentWindow.kind).toBe('chars');
      expect(out.message.contentWindow.contentFrom).toBe(3);
      expect(out.message.contentWindow.contentTo).toBe(8);
      expect(out.message.contentWindow.totalContentLength).toBe(26);
    });

    test('bare contentFrom defaults to a sane char window', () => {
      const messages = [msg({ i: 0, content: 'a'.repeat(100_000) })];
      const out = read(messages, { messageId: 'msg_0000', contentFrom: 5000 });
      const span = out.message.contentWindow.contentTo - out.message.contentWindow.contentFrom;
      expect(span).toBeLessThanOrEqual(HARD_MAX_READ_CHARS);
      expect(span).toBeGreaterThan(100);
    });

    test('out-of-bounds clamps to content length', () => {
      const messages = [msg({ i: 0, content: 'short' })];
      const out = read(messages, { messageId: 'msg_0000', contentFrom: -10, contentTo: 9999 });
      expect(out.message.contentWindow.contentFrom).toBe(0);
      expect(out.message.contentWindow.contentTo).toBe(5);
      expect(out.message.content).toBe('short');
    });

    test('enormous char window clamps to HARD_MAX_READ_CHARS', () => {
      const messages = [msg({ i: 0, content: 'x'.repeat(100_000) })];
      const out = read(messages, {
        messageId: 'msg_0000', contentFrom: 0, contentTo: 999_999,
      });
      const span = out.message.contentWindow.contentTo - out.message.contentWindow.contentFrom;
      expect(span).toBeLessThanOrEqual(HARD_MAX_READ_CHARS);
    });
  });

  describe('both selectors — lines wins', () => {
    test('ignores char selectors when lineFrom is present', () => {
      const messages = [makeBigMsg(50)];
      const out = read(messages, {
        messageId: 'msg_0000',
        lineFrom: 5, lineTo: 7,
        contentFrom: 1000, contentTo: 2000, // should be ignored
      });
      expect(out.message.contentWindow.kind).toBe('lines');
    });
  });

  describe('error and edge paths', () => {
    test('missing messageId → targetFound=false, message=null', () => {
      const out = read([msg({ i: 0 })], {});
      expect(out.targetFound).toBe(false);
      expect(out.message).toBeNull();
    });

    test('unknown messageId → targetFound=false', () => {
      const out = read([msg({ i: 0 })], { messageId: 'msg_hallucinated' });
      expect(out.targetFound).toBe(false);
    });

    test('empty content message returns empty string with kind=full', () => {
      const messages = [msg({ i: 0, content: '' })];
      const out = read(messages, { messageId: 'msg_0000' });
      expect(out.targetFound).toBe(true);
      expect(out.message.content).toBe('');
      expect(out.message.contentWindow.kind).toBe('full');
      expect(out.message.contentWindow.totalContentLength).toBe(0);
    });

    test('detail=full includes toolExecutions + contextReferences', () => {
      const messages = [msg({
        i: 0,
        content: 'hi',
        toolExecutions: [{ toolId: 't', input: 'x' }],
        contextReferences: [{ id: 'r1' }],
      })];
      const out = read(messages, { messageId: 'msg_0000', detail: 'full' });
      expect(out.message.toolExecutions).toHaveLength(1);
      expect(out.message.contextReferences).toHaveLength(1);
    });

    test('default detail omits toolExecutions / contextReferences', () => {
      const messages = [msg({
        i: 0,
        content: 'hi',
        toolExecutions: [{ toolId: 't', input: 'x' }],
      })];
      const out = read(messages, { messageId: 'msg_0000' });
      expect(out.message.toolExecutions).toBeUndefined();
      expect(out.message.contextReferences).toBeUndefined();
    });

    test('preserves messageId as a stable bookmark in the return shape', () => {
      const messages = [msg({ i: 0, content: 'x' })];
      const out = read(messages, { messageId: 'msg_0000' });
      expect(out.message.messageId).toBe('msg_0000');
      expect(out.center).toBe('msg_0000');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POINTER STABILITY — the #1 invariant the agent relies on
// ─────────────────────────────────────────────────────────────────────────

describe('pointer stability (the bookmark contract)', () => {
  test('messageIds returned by overview resolve via around()', () => {
    const messages = conv(50);
    const ov = overview(messages);
    // Pick a random timeline marker — agent bookmarks this id.
    const bookmark = ov.timeline[Math.floor(ov.timeline.length / 2)].messageId;
    const resolved = around(messages, { messageId: bookmark, before: 1, after: 1 });
    expect(resolved.targetFound).toBe(true);
    expect(resolved.messages.some(m => m.messageId === bookmark)).toBe(true);
  });

  test('messageIds returned by search resolve via around() later', () => {
    const messages = conv(50);
    const hits = search(messages, { query: 'message' });
    const bookmark = hits.matches[0].messageId;
    const resolved = around(messages, { messageId: bookmark });
    expect(resolved.targetFound).toBe(true);
    expect(resolved.center).toBe(bookmark);
  });

  test('bookmark survives archive growth — id resolves after 100 new messages appended', () => {
    const messages = conv(20);
    const bookmark = messages[10].id;
    // Simulate conversation growth: append 100 new messages.
    for (let i = 20; i < 120; i++) messages.push(msg({ i }));
    const resolved = around(messages, { messageId: bookmark, before: 2, after: 2 });
    expect(resolved.targetFound).toBe(true);
    expect(resolved.center).toBe(bookmark);
    expect(resolved.messages.map(m => m.messageId)).toContain(bookmark);
  });

  test('no mode exposes array `index` in returned entries', () => {
    const messages = conv(10);
    const sources = [
      ...range(messages).messages,
      ...search(messages, { query: 'message' }).matches,
      ...around(messages, { messageId: 'msg_0005' }).messages,
      ...byTool([msg({ i: 0, toolExecutions: [{ toolId: 't', input: 'i' }] })]).toolCalls,
      ...overview(messages).timeline,
    ];
    for (const entry of sources) {
      expect(entry).not.toHaveProperty('index');
    }
  });
});
