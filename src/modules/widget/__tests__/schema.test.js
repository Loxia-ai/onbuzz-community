/**
 * Schema validation — per-action contracts.
 *
 * These are the exact checks the tool uses before touching state. Every
 * branch should be covered because agents will absolutely probe them —
 * bad `widgetId` charsets, missing content, oversized payloads, wrong
 * `kind` strings, array-as-props mistakes, etc.
 */

import { describe, test, expect } from '@jest/globals';
import {
  validateRenderParams,
  validateUpdateParams,
  validateDestroyParams,
  WIDGET_LIMITS,
  WIDGET_KINDS,
} from '../schema.js';

describe('WIDGET_LIMITS / WIDGET_KINDS', () => {
  test('limits are sane positive numbers', () => {
    expect(WIDGET_LIMITS.MAX_CONTENT_BYTES).toBeGreaterThan(0);
    expect(WIDGET_LIMITS.MAX_WIDGET_ID_LEN).toBeGreaterThan(0);
    expect(WIDGET_LIMITS.MAX_WIDGETS_PER_AGENT).toBeGreaterThan(0);
  });
  test('kinds are frozen to prevent accidental mutation', () => {
    expect(Object.isFrozen(WIDGET_KINDS)).toBe(true);
    expect(WIDGET_KINDS).toEqual(['html', 'jsx', 'webcomponent']);
  });
});

describe('validateRenderParams', () => {
  test('rejects non-object', () => {
    expect(validateRenderParams(null).valid).toBe(false);
    expect(validateRenderParams(undefined).valid).toBe(false);
    expect(validateRenderParams('hi').valid).toBe(false);
    expect(validateRenderParams(42).valid).toBe(false);
  });

  test('requires a valid kind', () => {
    const r = validateRenderParams({ kind: 'iframe', content: 'x' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/kind/);
  });

  test('accepts html and jsx as kinds', () => {
    expect(validateRenderParams({ kind: 'html', content: '<p/>' }).valid).toBe(true);
    expect(validateRenderParams({ kind: 'jsx',  content: 'return () => ({type:"div"});' }).valid).toBe(true);
  });

  test('requires non-empty string content', () => {
    expect(validateRenderParams({ kind: 'html' }).valid).toBe(false);
    expect(validateRenderParams({ kind: 'html', content: '' }).valid).toBe(false);
    expect(validateRenderParams({ kind: 'html', content: '   ' }).valid).toBe(false);
    expect(validateRenderParams({ kind: 'html', content: 123 }).valid).toBe(false);
  });

  test('rejects content exceeding MAX_CONTENT_BYTES', () => {
    const big = 'x'.repeat(WIDGET_LIMITS.MAX_CONTENT_BYTES + 1);
    const r = validateRenderParams({ kind: 'html', content: big });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/exceeds/);
  });

  test('measures size in UTF-8 bytes, not chars', () => {
    // "🌟" is 4 bytes. Fill exactly one byte over the limit using it.
    const emoji = '🌟'; // 4 bytes
    const count = Math.floor(WIDGET_LIMITS.MAX_CONTENT_BYTES / 4) + 1;
    const payload = emoji.repeat(count);
    const r = validateRenderParams({ kind: 'html', content: payload });
    expect(r.valid).toBe(false);
  });

  test('widgetId optional; when present, must be string of allowed charset', () => {
    expect(validateRenderParams({ kind: 'html', content: 'x', widgetId: 'a_1' }).valid).toBe(true);
    expect(validateRenderParams({ kind: 'html', content: 'x', widgetId: 'my.widget-01' }).valid).toBe(true);
    expect(validateRenderParams({ kind: 'html', content: 'x', widgetId: 'bad char' }).valid).toBe(false);
    expect(validateRenderParams({ kind: 'html', content: 'x', widgetId: '' }).valid).toBe(false);
    expect(validateRenderParams({ kind: 'html', content: 'x', widgetId: 42 }).valid).toBe(false);
    const tooLong = 'a'.repeat(WIDGET_LIMITS.MAX_WIDGET_ID_LEN + 1);
    expect(validateRenderParams({ kind: 'html', content: 'x', widgetId: tooLong }).valid).toBe(false);
  });

  test('widgetId rejects path traversal / whitespace / special chars', () => {
    for (const bad of ['../x', 'a b', 'a/b', 'a\\b', "a'b", 'a"b', 'a;b']) {
      const r = validateRenderParams({ kind: 'html', content: 'x', widgetId: bad });
      expect(r.valid).toBe(false);
    }
  });

  // REGRESSION: agents would render kind:'html' with <script> tags
  // expecting them to run, but html mode is sandbox="" — the browser
  // silently blocks the scripts in the iframe console, the user sees
  // a dead widget. Catch this at validation time with a named hint.
  test('kind:html with <script> tag is rejected with a HELPFUL error', () => {
    const cases = [
      '<div><script>alert(1)</script></div>',
      '<div></div><script type="module">x()</script>',
      '<SCRIPT>x</SCRIPT>',  // case-insensitive
      '<script src="..."></script>',
    ];
    for (const content of cases) {
      const r = validateRenderParams({ kind: 'html', content });
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/static-only/);
      expect(r.error).toMatch(/webcomponent/);
      expect(r.error).toMatch(/jsx/);
    }
  });

  test('kind:html WITHOUT <script> is accepted', () => {
    expect(validateRenderParams({ kind: 'html', content: '<div>hello</div>' }).valid).toBe(true);
    // The word "script" appearing in TEXT (not as a tag) is fine
    expect(validateRenderParams({ kind: 'html', content: '<p>this script does nothing</p>' }).valid).toBe(true);
  });

  test('kind:webcomponent or kind:jsx with <script>-shaped strings is fine (they are JS source, not HTML)', () => {
    // Agent's webcomponent code might LITERALLY contain the substring
    // "<script>" inside a template literal it builds. Since the agent
    // code goes through customElements/innerHTML rather than as HTML,
    // we only check kind:'html'.
    expect(validateRenderParams({ kind: 'webcomponent', content: 'class X extends LoxiaElement { template() { return "<script>foo</script>"; } } loxia.render(X);' }).valid).toBe(true);
    expect(validateRenderParams({ kind: 'jsx', content: 'return html`<div>${"<script>"}</div>`;' }).valid).toBe(true);
  });

  test('props optional; must be plain object when provided', () => {
    expect(validateRenderParams({ kind: 'html', content: 'x', props: {} }).valid).toBe(true);
    expect(validateRenderParams({ kind: 'html', content: 'x', props: { a: 1 } }).valid).toBe(true);
    expect(validateRenderParams({ kind: 'html', content: 'x', props: [] }).valid).toBe(false);
    expect(validateRenderParams({ kind: 'html', content: 'x', props: 'no' }).valid).toBe(false);
  });
});

describe('validateUpdateParams', () => {
  test('rejects non-object params', () => {
    expect(validateUpdateParams(null).valid).toBe(false);
  });
  test('requires widgetId and props', () => {
    expect(validateUpdateParams({}).valid).toBe(false);
    expect(validateUpdateParams({ widgetId: 'a' }).valid).toBe(false);
    expect(validateUpdateParams({ widgetId: 'a', props: null }).valid).toBe(false);
    expect(validateUpdateParams({ widgetId: 'a', props: [] }).valid).toBe(false);
    expect(validateUpdateParams({ widgetId: 'a', props: {} }).valid).toBe(true);
  });
});

describe('validateDestroyParams', () => {
  test('rejects non-object', () => {
    expect(validateDestroyParams(null).valid).toBe(false);
  });
  test('requires non-empty string widgetId', () => {
    expect(validateDestroyParams({}).valid).toBe(false);
    expect(validateDestroyParams({ widgetId: '' }).valid).toBe(false);
    expect(validateDestroyParams({ widgetId: 'a' }).valid).toBe(true);
  });
});
