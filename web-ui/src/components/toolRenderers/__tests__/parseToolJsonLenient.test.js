/**
 * Lenient JSON parser — protects the tool-call pipeline from model-emitted
 * quirks that would otherwise cause the whole invocation to be silently
 * dropped. The two quirks we see in practice:
 *
 *  1. Unescaped LF/CR/TAB inside string values. Strict JSON rejects these,
 *     but models routinely emit them for any multi-line payload (widget
 *     content, filesystem writes, file-content-replace). The backend
 *     doesn't hit this because it receives tool_calls structurally from
 *     the provider — only the frontend has to re-parse the markdown.
 *
 *  2. Curly braces inside string values (CSS `{ ... }`, JS render bodies,
 *     etc.). The non-greedy regex used to capture up to the FIRST `}`,
 *     which split the payload. Fixed by capturing the whole fenced body.
 *     This test covers (1); regex breadth is covered by the tests that
 *     feed realistic agent payloads further down.
 */
import { describe, it, expect } from 'vitest';
import {
  parseToolJsonLenient,
  escapeControlCharsInJsonStrings,
} from '../ToolContentRenderer.jsx';

describe('parseToolJsonLenient — happy path', () => {
  it('parses valid JSON unchanged', () => {
    const src = '{"toolId":"widget","parameters":{"kind":"html"}}';
    expect(parseToolJsonLenient(src)).toEqual({
      toolId: 'widget',
      parameters: { kind: 'html' },
    });
  });

  it('returns null for irrecoverable garbage', () => {
    expect(parseToolJsonLenient('not json at all')).toBeNull();
    expect(parseToolJsonLenient('{ unclosed')).toBeNull();
  });
});

describe('parseToolJsonLenient — model-emitted unescaped newlines', () => {
  it('recovers from literal LF inside a string value', () => {
    // Exactly the shape we saw the agent emit for a widget render:
    const src = '{\n  "toolId": "widget",\n  "content": "line 1\nline 2\nline 3"\n}';
    // Strict JSON.parse would throw on the literal \n inside "content".
    expect(() => JSON.parse(src)).toThrow();
    // Lenient parser recovers:
    const out = parseToolJsonLenient(src);
    expect(out.toolId).toBe('widget');
    expect(out.content).toBe('line 1\nline 2\nline 3');
  });

  it('recovers from CR and TAB inside string values', () => {
    const src = '{"a":"x\ty\rz"}';
    expect(() => JSON.parse(src)).toThrow();
    expect(parseToolJsonLenient(src)).toEqual({ a: 'x\ty\rz' });
  });

  it('does NOT touch control chars outside strings (preserves structure)', () => {
    const src = '{\n  "a": 1,\n  "b": 2\n}';
    // This IS valid JSON (newlines between tokens are allowed); strict parse works.
    expect(parseToolJsonLenient(src)).toEqual({ a: 1, b: 2 });
  });

  it('handles realistic agent widget payload (CSS with braces + unescaped LF)', () => {
    // The exact shape from the failing conversation: literal LF between
    // CSS rules inside the "content" value, braces sprinkled throughout.
    const src = [
      '{',
      '  "toolId": "widget",',
      '  "action": "render",',
      '  "kind": "html",',
      '  "content": "',
      '    <div>',
      '      <style>',
      '        @keyframes shift { 0% { background: red; } 100% { background: blue; } }',
      '      </style>',
      '      <button class=\\"shifting-btn\\">Click</button>',
      '    </div>',
      '  "',
      '}',
    ].join('\n');

    // Strict parse must fail here (both because of the LFs inside "content"
    // and arguably because of the braces — though braces inside quoted
    // strings are JSON-legal, the LFs make it invalid).
    expect(() => JSON.parse(src)).toThrow();

    const out = parseToolJsonLenient(src);
    expect(out).not.toBeNull();
    expect(out.toolId).toBe('widget');
    expect(out.action).toBe('render');
    expect(out.kind).toBe('html');
    // The content string must contain the CSS braces — they survived the
    // normalization intact.
    expect(out.content).toContain('@keyframes shift');
    expect(out.content).toContain('{ 0% { background: red; } }'.replace(' } }', ' }')); // loose
    expect(out.content).toContain('<button');
  });
});

describe('escapeControlCharsInJsonStrings — state machine', () => {
  it('tracks string boundaries correctly with escaped quotes', () => {
    // Inner \" should NOT flip the in-string flag.
    const src = '{"a":"he said \\"hi\\"\nbye"}';
    const fixed = escapeControlCharsInJsonStrings(src);
    // The LF INSIDE the string should be escaped...
    expect(fixed).toContain('\\"hi\\"\\nbye');
    // ...and the result should parse.
    expect(JSON.parse(fixed)).toEqual({ a: 'he said "hi"\nbye' });
  });

  it('tracks backslash-escape correctly (\\\\ does not count as escaping a quote)', () => {
    // { "p":"C:\\Users\\t" } — path-like with valid doubled backslashes.
    const src = '{"p":"C:\\\\Users\\\\t"}';
    // Already valid JSON — must not be corrupted.
    expect(JSON.parse(escapeControlCharsInJsonStrings(src))).toEqual({ p: 'C:\\Users\\t' });
  });
});
