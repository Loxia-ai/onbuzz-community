/**
 * Unit tests for parseExternalBlocks — the frontend splitter that turns a
 * raw assistant-message string into a list of text / closed-external /
 * streaming-external segments.
 *
 * Intentionally exhaustive because the whole pretty-renderer flow is
 * downstream of this one pure function — a wrong segmentation here causes
 * visible transcript corruption, so the contract gets locked hard.
 */

import { parseExternalBlocks, hasExternalBlock } from '../parseExternalBlocks.js';

describe('parseExternalBlocks — closed blocks', () => {
  test('plain text with no external block returns a single text segment', () => {
    expect(parseExternalBlocks('hello world')).toEqual([
      { type: 'text', text: 'hello world' },
    ]);
  });

  test('single closed block with explicit target', () => {
    const out = parseExternalBlocks('<external to="discord:#ops">Build is green.</external>');
    expect(out).toEqual([
      { type: 'external', to: ['discord:#ops'], text: 'Build is green.' },
    ]);
  });

  test('interleaved text around a block', () => {
    const input = 'Thinking…\n<external to="discord:#ops">hi</external>\nContinuing locally.';
    const out = parseExternalBlocks(input);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: 'text', text: 'Thinking…\n' });
    expect(out[1]).toEqual({ type: 'external', to: ['discord:#ops'], text: 'hi' });
    expect(out[2]).toEqual({ type: 'text', text: '\nContinuing locally.' });
  });

  test('unaddressed block (no to=) — broadcast semantics', () => {
    const out = parseExternalBlocks('<external>Attention, everyone!</external>');
    expect(out).toEqual([
      { type: 'external', to: null, text: 'Attention, everyone!' },
    ]);
  });

  test('explicit wildcard to="*" is preserved as ["*"]', () => {
    const out = parseExternalBlocks('<external to="*">broadcast</external>');
    expect(out).toEqual([
      { type: 'external', to: ['*'], text: 'broadcast' },
    ]);
  });

  test('multi-target to="a, b, c" splits into an alias list', () => {
    const out = parseExternalBlocks('<external to="discord:#ops, telegram:chat-1">sync</external>');
    expect(out).toEqual([
      { type: 'external', to: ['discord:#ops', 'telegram:chat-1'], text: 'sync' },
    ]);
  });

  test('single-quoted to attribute is supported', () => {
    const out = parseExternalBlocks("<external to='discord:#ops'>hi</external>");
    expect(out).toEqual([
      { type: 'external', to: ['discord:#ops'], text: 'hi' },
    ]);
  });

  test('multiple closed blocks interleaved with text', () => {
    const input =
      'Note A.\n' +
      '<external to="discord:#ops">reply 1</external>\n' +
      'Between.\n' +
      '<external to="telegram">reply 2</external>\n' +
      'Tail.';
    const out = parseExternalBlocks(input);
    expect(out.map(s => s.type)).toEqual([
      'text', 'external', 'text', 'external', 'text'
    ]);
    expect(out[1].text).toBe('reply 1');
    expect(out[3].text).toBe('reply 2');
  });

  test('block body is whitespace-trimmed (leading + trailing newlines gone)', () => {
    const out = parseExternalBlocks('<external to="x">\n  hello\n</external>');
    expect(out[0].text).toBe('hello');
  });

  test('case-insensitive tag matching', () => {
    const out = parseExternalBlocks('<EXTERNAL TO="X">hi</EXTERNAL>');
    expect(out).toEqual([
      { type: 'external', to: ['X'], text: 'hi' },
    ]);
  });

  test('multi-line body with embedded markdown is preserved verbatim', () => {
    const body = '# heading\n\n- bullet 1\n- bullet 2\n\n```js\nconst x = 1;\n```';
    const input = `<external to="discord:#ops">${body}</external>`;
    const out = parseExternalBlocks(input);
    expect(out[0].text).toBe(body);
  });

  test('body containing angle brackets but no nested <external> is untouched', () => {
    const out = parseExternalBlocks('<external to="x">use <br> carefully</external>');
    expect(out[0].text).toBe('use <br> carefully');
  });
});

describe('parseExternalBlocks — streaming (unclosed) blocks', () => {
  test('a dangling open tag produces an external-streaming segment', () => {
    const out = parseExternalBlocks('thinking\n<external to="discord:#ops">typing a repl');
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: 'text', text: 'thinking\n' });
    expect(out[1]).toEqual({
      type: 'external-streaming',
      to: ['discord:#ops'],
      text: 'typing a repl',
    });
  });

  test('unaddressed open tag streams as broadcast skeleton', () => {
    const out = parseExternalBlocks('<external>partial');
    expect(out).toEqual([
      { type: 'external-streaming', to: null, text: 'partial' },
    ]);
  });

  test('streaming body is NOT whitespace-trimmed (prevents flicker)', () => {
    const out = parseExternalBlocks('<external to="x">  leading-space');
    expect(out[0].text).toBe('  leading-space');
  });

  test('only the tail is streaming — earlier closed blocks still emit normally', () => {
    const input = 'a <external to="one">done</external> b <external to="two">still typin';
    const out = parseExternalBlocks(input);
    expect(out.map(s => s.type)).toEqual([
      'text', 'external', 'text', 'external-streaming',
    ]);
    expect(out[1].text).toBe('done');
    expect(out[3].text).toBe('still typin');
    expect(out[3].to).toEqual(['two']);
  });

  test('content that looks like a closing-only tag is treated as trailing text', () => {
    // No open tag, just a stray close — defensively keep it as text.
    const out = parseExternalBlocks('hello </external>');
    expect(out).toEqual([{ type: 'text', text: 'hello </external>' }]);
  });

  test('open tag followed by only whitespace still emits a streaming segment', () => {
    const out = parseExternalBlocks('<external to="x">\n');
    expect(out).toEqual([
      { type: 'external-streaming', to: ['x'], text: '\n' },
    ]);
  });
});

describe('parseExternalBlocks — degenerate input', () => {
  test('null / undefined / empty string returns empty array', () => {
    expect(parseExternalBlocks(null)).toEqual([]);
    expect(parseExternalBlocks(undefined)).toEqual([]);
    expect(parseExternalBlocks('')).toEqual([]);
  });

  test('non-string input returns empty array', () => {
    expect(parseExternalBlocks(42)).toEqual([]);
    expect(parseExternalBlocks({})).toEqual([]);
  });

  test('empty-body closed block still emits an external segment with empty text', () => {
    const out = parseExternalBlocks('<external to="x"></external>');
    expect(out).toEqual([{ type: 'external', to: ['x'], text: '' }]);
  });
});

describe('hasExternalBlock', () => {
  test('true when a closed external exists', () => {
    expect(hasExternalBlock('x <external>y</external> z')).toBe(true);
  });

  test('true when only an open tag is present (streaming case)', () => {
    expect(hasExternalBlock('x <external to="y">still')).toBe(true);
  });

  test('false for plain text', () => {
    expect(hasExternalBlock('hello world')).toBe(false);
  });

  test('false for empty / null / non-string', () => {
    expect(hasExternalBlock('')).toBe(false);
    expect(hasExternalBlock(null)).toBe(false);
    expect(hasExternalBlock(undefined)).toBe(false);
    expect(hasExternalBlock(42)).toBe(false);
  });
});
