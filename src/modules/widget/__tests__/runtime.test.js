/**
 * Runtime bundle smoke — we can't execute the bundle in node (it wants
 * window/document), but we CAN pin the surface: named hooks the iframe
 * page relies on must be present in the string, or jsx widgets silently
 * break. This catches accidental renames + truncations.
 *
 * Also parses the string as JavaScript to catch syntax errors — a typo
 * in the bundle currently has no compile-time check.
 */
import { describe, test, expect } from '@jest/globals';
import vm from 'node:vm';
import { WIDGET_RUNTIME } from '../runtime/bundle.js';

describe('WIDGET_RUNTIME — surface + parseability', () => {
  test('is a non-trivial string', () => {
    expect(typeof WIDGET_RUNTIME).toBe('string');
    expect(WIDGET_RUNTIME.length).toBeGreaterThan(1000);
  });

  test('parses as valid JavaScript', () => {
    // new vm.Script() throws on parse errors. It does NOT execute.
    expect(() => new vm.Script(WIDGET_RUNTIME)).not.toThrow();
  });

  test('exposes the public SDK surface on window.loxia', () => {
    // Simple string assertions — the bundle IIFE writes these.
    expect(WIDGET_RUNTIME).toMatch(/window\.loxia\s*=/);
    for (const method of ['h', 'html', 'render', 'sendEvent', 'onUpdate', 'requestHeight']) {
      expect(WIDGET_RUNTIME).toMatch(new RegExp(`\\b${method}\\b`));
    }
  });

  test('exposes primitives catalog', () => {
    for (const prim of ['LoxiaCard', 'LoxiaButton', 'LoxiaInput', 'LoxiaText', 'LoxiaMetric', 'LoxiaRow', 'LoxiaCol']) {
      expect(WIDGET_RUNTIME).toMatch(new RegExp(`\\b${prim}\\b`));
    }
  });

  test('does not hit the network from inside the sandbox', () => {
    // No fetch/XHR references — CSP is meant to block them, but belt-and-braces:
    // the runtime itself shouldn't invoke them.
    expect(WIDGET_RUNTIME).not.toMatch(/\bfetch\s*\(/);
    expect(WIDGET_RUNTIME).not.toMatch(/XMLHttpRequest/);
    expect(WIDGET_RUNTIME).not.toMatch(/WebSocket/);
  });

  test('uses postMessage for parent communication (authenticated via source at receiver)', () => {
    expect(WIDGET_RUNTIME).toMatch(/postMessage/);
    expect(WIDGET_RUNTIME).toMatch(/__loxia/);
  });

  test('runs inside an IIFE (does not leak top-level identifiers)', () => {
    // Strip leading /* ... */ comment (bundle header), then check IIFE shape.
    const stripped = WIDGET_RUNTIME.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '').trim();
    expect(stripped).toMatch(/^\(function\s*\(/);
    expect(stripped).toMatch(/\}\)\(\);?\s*$/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Hook integration — agents reflexively reach for useState; we support it
// ────────────────────────────────────────────────────────────────────────

describe('runtime hooks — integration via jsdom', () => {
  let dom, window;

  beforeEach(async () => {
    const { JSDOM } = await import('jsdom');
    dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    window.__loxiaWidgetId = 'w';
    window.__loxiaInitialProps = {};
    new window.Function(WIDGET_RUNTIME).call(window);
  });

  test('useState is exported three ways (bare, on h, on loxia)', () => {
    expect(typeof window.useState).toBe('function');
    expect(typeof window.h.useState).toBe('function');
    expect(typeof window.loxia.useState).toBe('function');
  });

  test('`const { useState } = h` destructure pattern works (this is the one agents write)', () => {
    const { useState, useEffect, useMemo, useCallback, useRef } = window.h;
    expect(typeof useState).toBe('function');
    expect(typeof useEffect).toBe('function');
    expect(typeof useMemo).toBe('function');
    expect(typeof useCallback).toBe('function');
    expect(typeof useRef).toBe('function');
  });

  // REGRESSION: agents trained on online htm/preact/React tutorials reach
  // for varied namespace names: `htmPreact`, `preact`, `React`, `htm`, etc.
  // Rather than reject those as "undefined," we alias every known name
  // to the same bundle so the destructure pattern works however the
  // agent decided to name it.
  // Every known namespace alias (htmPreact / preactHooks / React / ...)
  // must expose the full hooks surface — agents reach for any of them
  // based on whatever snippet their training data surfaced.
  test.each([
    ['htmPreact'],     ['htm_preact'], ['preactHtm'],
    ['htm'],           ['Htm'],
    ['preact'],        ['Preact'],     ['preactjs'],
    ['preactHooks'],   ['PreactHooks'], ['preact_hooks'],
    ['hooks'],         ['Hooks'],
    ['React'],         ['react'],
    ['reactHooks'],    ['ReactHooks'],  ['react_hooks'],
    ['preactStandalone'], ['preact_standalone'],
  ])('namespace alias window.%s exposes { useState, useEffect, useMemo, useCallback, useRef, h, html }', (name) => {
    const ns = window[name];
    expect(ns).toBeDefined();
    expect(typeof ns.useState).toBe('function');
    expect(typeof ns.useEffect).toBe('function');
    expect(typeof ns.useMemo).toBe('function');
    expect(typeof ns.useCallback).toBe('function');
    expect(typeof ns.useRef).toBe('function');
    expect(typeof ns.h).toBe('function');
    expect(typeof ns.html).toBe('function');
    // createElement is an alias for h (React naming)
    expect(ns.createElement).toBe(ns.h);
  });

  test('namespace supports `import X from "preact"` shape via .default self-reference', () => {
    // Some transpiled snippets import the namespace's default: default
    // points back at the namespace itself so X.useState still works.
    expect(window.preact.default.useState).toBe(window.preact.useState);
  });

  test('namespace Proxy: unknown hooks throw a SPECIFIC "not implemented" error', () => {
    // If an agent reaches for useLayoutEffect / useContext / forwardRef /
    // etc., the Proxy returns a throwing stub so the error text names
    // the missing API instead of a generic "undefined is not a function".
    const notImplemented = [
      'useLayoutEffect', 'useContext', 'forwardRef',
      'memo', 'createContext', 'Suspense',
    ];
    // useReducer used to be in this list; it\'s implemented now. Assert
    // the opposite so regressions trigger here.
    expect(typeof window.preact.useReducer).toBe('function');
    expect(() => window.preact.useReducer((s) => s, 0)).not.toThrow();
    for (const key of notImplemented) {
      const fn = window.preact[key];
      expect(typeof fn).toBe('function');
      expect(() => fn()).toThrow(new RegExp(`'${key}' is not implemented`));
      expect(() => fn()).toThrow(/Supported hooks:/);
    }
  });

  test('class components throw a NAMED error (Component / PureComponent)', () => {
    // REGRESSION: prior behaviour was `Component` returning undefined,
    // which gave "Class extends value undefined is not a constructor" —
    // generic and unhelpful. Now the error names the class + the
    // rewrite path.
    for (const className of ['Component', 'PureComponent']) {
      const Cls = window.React[className];
      expect(typeof Cls).toBe('function');
      // Direct call path (e.g. Component())
      expect(() => Cls()).toThrow(new RegExp(`'${className}' is not implemented`));
      // Also available as a bare global
      expect(window[className]).toBeDefined();
      expect(() => window[className]()).toThrow(new RegExp(`'${className}' is not implemented`));
    }
  });

  test('bare-global not-implemented names throw named errors too (not just via namespace)', () => {
    // Agents that reach for bare `useContext(x)` without a namespace also
    // get the named error, not a generic ReferenceError.
    expect(typeof window.useContext).toBe('function');
    expect(() => window.useContext({})).toThrow(/'useContext' is not implemented/);
    expect(typeof window.forwardRef).toBe('function');
    expect(() => window.forwardRef(() => {})).toThrow(/'forwardRef' is not implemented/);
  });

  test('CONSISTENCY: every not-implemented name from the runtime is mentioned in the tool description', async () => {
    // The tool description and the Proxy\'s not-implemented sets are
    // independent — they can drift. Pin them: every name the runtime
    // throws for MUST appear in the agent\'s context, or the agent gets
    // a clear error without any guidance on how to avoid it next time.
    const { WidgetTool } = await import('../widgetTool.js');
    const desc = new WidgetTool().getDescription();

    // The runtime bundle is a string — extract the literal names from
    // the Sets via grepping the source (source of truth).
    const { WIDGET_RUNTIME } = await import('../runtime/bundle.js');
    const classesMatch = WIDGET_RUNTIME.match(/_notImplementedClasses\s*=\s*new Set\(\[([^\]]+)\]\)/);
    const fnsMatch     = WIDGET_RUNTIME.match(/_notImplementedFns\s*=\s*new Set\(\[([^\]]+)\]\)/);
    expect(classesMatch).toBeTruthy();
    expect(fnsMatch).toBeTruthy();
    const extract = (m) => {
      // Strip `// ...` comments first — apostrophes inside comments (e.g.
      // "don\'t implement") otherwise break the quoted-string regex.
      const stripped = m[1].replace(/\/\/.*$/gm, '');
      return (stripped.match(/'[^']+'/g) || []).map(s => s.slice(1, -1));
    };
    const allNames = [...new Set([...extract(classesMatch), ...extract(fnsMatch)])];
    expect(allNames.length).toBeGreaterThan(10); // sanity

    const missing = allNames.filter(n => !desc.includes(n));
    expect(missing).toEqual([]);
  });

  test('namespace Proxy: truly-unknown keys (not in not-implemented list) return undefined', () => {
    expect(window.preact.somethingCompletelyMadeUp).toBeUndefined();
  });

  test('window.htm exposes { html } (htm library convention)', () => {
    expect(typeof window.htm).toBe('object');
    expect(typeof window.htm.html).toBe('function');
    expect(window.htm.html).toBe(window.html);
  });

  test('window.ReactDOM.render exists (even if minimal) so ReactDOM.render(vnode, el) doesn\'t ReferenceError', () => {
    expect(typeof window.ReactDOM).toBe('object');
    expect(typeof window.ReactDOM.render).toBe('function');
  });

  test('window.ReactDOM.createRoot(x).render(vnode) works (React 18 idiom)', () => {
    const root = window.ReactDOM.createRoot(window.document.body);
    expect(typeof root.render).toBe('function');
    expect(typeof root.unmount).toBe('function');
    // Just confirm the shape — actual render is the same path as ReactDOM.render.
    expect(() => root.render(window.h('div'))).not.toThrow();
  });

  test('agent code using "const { useState } = preactHooks" (the pattern that triggered the Proxy expansion) works', () => {
    const userCode = [
      'const { useState } = preactHooks;',
      'return function() {',
      '  const [n, setN] = useState(10);',
      '  return h("button", { onClick: () => setN(n + 1), id: "ph" }, "n=" + n);',
      '};',
    ].join('\n');
    const fn = new window.Function(userCode);
    window.loxia.render(fn, {});
    const root = window.document.getElementById('root');
    expect(root.textContent).toContain('n=10');
    window.document.getElementById('ph').click();
    expect(root.textContent).toContain('n=11');
  });

  test('agent code using "const { useState } = htmPreact" (the pattern that triggered this fix) works', () => {
    // Verbatim pattern from the failed tool invocation that prompted the alias.
    const userCode = [
      'const { useState, useCallback } = htmPreact;',
      'const App = () => {',
      '  const [n, setN] = useState(3);',
      '  const inc = useCallback(() => setN(n + 1), [n]);',
      '  return h("button", { onClick: inc, id: "htmp" }, "n=" + n);',
      '};',
      'return App();',
    ].join('\n');
    const fn = new window.Function(userCode);
    window.loxia.render(fn, {});
    const root = window.document.getElementById('root');
    expect(root.textContent).toContain('n=3');
    window.document.getElementById('htmp').click();
    expect(root.textContent).toContain('n=4');
  });

  test('useState drives a real click-to-increment counter', () => {
    function App() {
      const [count, setCount] = window.useState(0);
      return window.h('div', null,
        window.h('span', null, 'c=' + count),
        window.h('button', { onClick: () => setCount(count + 1), id: 'btn' }, '+'),
      );
    }
    window.loxia.render(App, {});
    const root = window.document.getElementById('root');
    expect(root.textContent).toContain('c=0');
    // Re-query button each click — renderToRoot replaces the DOM subtree.
    window.document.getElementById('btn').click();
    expect(root.textContent).toContain('c=1');
    window.document.getElementById('btn').click();
    expect(root.textContent).toContain('c=2');
  });

  test('useMemo caches until deps change', () => {
    let computeCount = 0;
    function App() {
      const [n, setN] = window.useState(1);
      const squared = window.useMemo(() => { computeCount++; return n * n; }, [n]);
      return window.h('div', null,
        window.h('span', null, 'sq=' + squared),
        window.h('button', { onClick: () => setN(n + 1), id: 'b' }, '+'),
      );
    }
    window.loxia.render(App, {});
    expect(computeCount).toBe(1);
    // Clicking changes n, which invalidates the memo
    window.document.getElementById('b').click();
    expect(computeCount).toBe(2);
    expect(window.document.getElementById('root').textContent).toContain('sq=4');
  });

  test('functional setState (setCount(c => c + 1)) works', () => {
    function App() {
      const [n, setN] = window.useState(10);
      return window.h('button', { onClick: () => setN(c => c + 5), id: 'b' }, 'n=' + n);
    }
    window.loxia.render(App, {});
    window.document.getElementById('b').click();
    expect(window.document.getElementById('root').textContent).toContain('n=15');
  });

  test('useReducer dispatches reducer and re-renders with new state', () => {
    function App() {
      const [state, dispatch] = window.useReducer((s, a) => {
        if (a.type === 'inc') return { n: s.n + 1 };
        if (a.type === 'dec') return { n: s.n - 1 };
        return s;
      }, { n: 10 });
      return window.h('div', null,
        window.h('span', null, 'n=' + state.n),
        window.h('button', { id: 'inc', onClick: () => dispatch({ type: 'inc' }) }, '+'),
        window.h('button', { id: 'dec', onClick: () => dispatch({ type: 'dec' }) }, '-'),
      );
    }
    window.loxia.render(App, {});
    const root = window.document.getElementById('root');
    expect(root.textContent).toContain('n=10');
    window.document.getElementById('inc').click();
    expect(root.textContent).toContain('n=11');
    window.document.getElementById('dec').click();
    window.document.getElementById('dec').click();
    expect(root.textContent).toContain('n=9');
  });

  test('useReducer supports the (reducer, init, initFn) lazy-init form', () => {
    function App() {
      const [n, dispatch] = window.useReducer((s) => s + 1, 5, x => x * 10);
      return window.h('button', { id: 'r', onClick: () => dispatch() }, 'v=' + n);
    }
    window.loxia.render(App, {});
    // init(5) = 50 → lazy init applied once
    expect(window.document.getElementById('root').textContent).toContain('v=50');
    window.document.getElementById('r').click();
    expect(window.document.getElementById('root').textContent).toContain('v=51');
  });

  test('identical setState value does not trigger re-render', () => {
    let renderCount = 0;
    function App() {
      renderCount++;
      const [v, setV] = window.useState('x');
      return window.h('button', { onClick: () => setV('x'), id: 'b' }, 'v=' + v);
    }
    window.loxia.render(App, {});
    expect(renderCount).toBe(1);
    window.document.getElementById('b').click();
    expect(renderCount).toBe(1); // unchanged — no re-render
  });

  // REGRESSION: when loxia.render is given a factory function (one that
  // returns another function — the pattern `return function App(){...}`),
  // it must promote the inner function to be the real component so hooks
  // run in the right scope. Previously, the outer factory was treated as
  // the component, hooks were called in its scope, state was captured at
  // the first call, and the inner function was never invoked.
  test('factory-style agent code: component returning a function is promoted + hooks work', () => {
    function Factory() {
      // This is the "outer wrapper" — it does NOT call hooks; it
      // returns the real component function.
      return function App() {
        const [n, setN] = window.useState(0);
        return window.h('button', { onClick: () => setN(n + 1), id: 'fb' }, 'n=' + n);
      };
    }
    window.loxia.render(Factory, {});
    const root = window.document.getElementById('root');
    expect(root.textContent).toContain('n=0');
    window.document.getElementById('fb').click();
    expect(root.textContent).toContain('n=1');
    window.document.getElementById('fb').click();
    expect(root.textContent).toContain('n=2');
  });

  // REGRESSION: parseTemplate used to reference `values` from the outer
  // scope — except `values` only exists inside html(), not in parseTemplate.
  // The first interpolated template the agent wrote blew up with
  // "values is not defined". Fix is to use strings.length-1 as the
  // "values remaining" check. This pins it.
  test('html`…` with interpolations works (REGRESSION: parseTemplate had an out-of-scope ref)', () => {
    const userCode = [
      'return function App() {',
      '  const [count, setCount] = useState(0);',
      '  return html`<div>',
      '    <span>c=${count}</span>',
      '    <button id="b" onClick=${() => setCount(count + 1)}>+1</button>',
      '  </div>`;',
      '};',
    ].join('\n');
    const fn = new window.Function(userCode)();
    window.loxia.render(fn, {});
    const root = window.document.getElementById('root');
    expect(root.textContent).toContain('c=0');
    window.document.getElementById('b').click();
    expect(root.textContent).toContain('c=1');
    window.document.getElementById('b').click();
    expect(root.textContent).toContain('c=2');
  });
});
