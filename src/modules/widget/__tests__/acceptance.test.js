/**
 * Acceptance test — three properties the widget tool surface must
 * maintain together. If any fails, the agent experience degrades.
 *
 *   (1) AWARENESS  — agent can enumerate every global/hook/primitive/alias
 *   (2) CAPABILITY — common patterns (state, reducer, forms, effects)
 *                    work out of the box
 *   (3) FEEDBACK   — every failure mode produces a named error + next step
 *
 * This file is a deliberate end-to-end check: it imports the real
 * widget tool, the real runtime bundle, builds capabilities, drives a
 * simulated widget through jsdom, and verifies the error pipeline
 * names the right APIs with the right rewrite paths.
 */
import { describe, test, expect } from '@jest/globals';
import { WidgetTool } from '../widgetTool.js';
import { WIDGET_RUNTIME } from '../runtime/bundle.js';
import { registerRoutes } from '../routes.js';

function tool() { return new WidgetTool(); }

function fakeApp() {
  const routes = { get: new Map(), post: new Map(), delete: new Map() };
  return {
    routes,
    get:    (p, h) => routes.get.set(p, h),
    post:   (p, h) => routes.post.set(p, h),
    delete: (p, h) => routes.delete.set(p, h),
  };
}
function fakeRes() {
  const r = { _status: 200, _json: null, _headers: {} };
  r.status = function(c) { this._status = c; return this; };
  r.json   = function(j) { this._json = j; return this; };
  r.send   = function(b) { this._body = b; return this; };
  r.setHeader = function(k, v) { this._headers[k.toLowerCase()] = v; };
  r.type   = function(t) { this._type = t; return this; };
  return r;
}

// ────────────────────────────────────────────────────────────────────────
// (1) AWARENESS
// ────────────────────────────────────────────────────────────────────────

describe('(1) AWARENESS — agent can enumerate what we provide', () => {
  test('list-capabilities returns a complete report covering every layer', async () => {
    const r = await tool().execute({ action: 'list-capabilities' }, { agentId: 'a' });
    expect(r.success).toBe(true);
    const c = r.capabilities;
    // All layers present
    expect(c).toHaveProperty('globals');
    expect(c).toHaveProperty('namespaces.aliased');
    expect(c).toHaveProperty('loxia');
    expect(c).toHaveProperty('browserApis');
    expect(c).toHaveProperty('notImplemented.classes');
    expect(c).toHaveProperty('notImplemented.functions');
    expect(c).toHaveProperty('notImplemented.rewritePaths');
    expect(c).toHaveProperty('hardErrors');
    expect(c).toHaveProperty('constraints');
  });

  test('every claimed global is actually present in the runtime bundle', async () => {
    const r = await tool().execute({ action: 'list-capabilities' }, { agentId: 'a' });
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    window.__loxiaWidgetId = 'w';
    window.__loxiaInitialProps = {};
    new window.Function(WIDGET_RUNTIME).call(window);

    // Every global the tool claims is available must exist in the runtime.
    for (const name of r.capabilities.globals) {
      // Some primitives are under the loxia.primitives namespace too,
      // but ALL globals must be reachable as bare identifiers on window.
      expect(window[name]).toBeDefined();
    }
    // Every namespace alias must exist and have hooks.
    for (const alias of r.capabilities.namespaces.aliased) {
      expect(window[alias]).toBeDefined();
      expect(typeof window[alias].useState).toBe('function');
    }
  });

  test('every claimed not-implemented API actually throws with a named error', async () => {
    const r = await tool().execute({ action: 'list-capabilities' }, { agentId: 'a' });
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    window.__loxiaWidgetId = 'w'; window.__loxiaInitialProps = {};
    new window.Function(WIDGET_RUNTIME).call(window);

    for (const className of r.capabilities.notImplemented.classes) {
      expect(typeof window[className]).toBe('function');
      expect(() => window[className]()).toThrow(new RegExp("'" + className + "' is not implemented"));
    }
    for (const fnName of r.capabilities.notImplemented.functions) {
      const fn = window.preact[fnName];
      expect(typeof fn).toBe('function');
      expect(() => fn()).toThrow(new RegExp("'" + fnName + "' is not implemented"));
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// (2) CAPABILITY — common patterns work safely
// ────────────────────────────────────────────────────────────────────────

describe('(2) CAPABILITY — common patterns work out of the box', () => {
  async function bootRuntime() {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    window.__loxiaWidgetId = 'w';
    window.__loxiaInitialProps = {};
    new window.Function(WIDGET_RUNTIME).call(window);
    return window;
  }

  test('pattern A: local counter with useState', async () => {
    const w = await bootRuntime();
    function App() {
      const [n, setN] = w.useState(0);
      return w.h('button', { id: 'b', onClick: () => setN(n + 1) }, 'n=' + n);
    }
    w.loxia.render(App, {});
    w.document.getElementById('b').click();
    w.document.getElementById('b').click();
    expect(w.document.getElementById('root').textContent).toContain('n=2');
  });

  test('pattern: useReducer-driven todo list', async () => {
    const w = await bootRuntime();
    function App() {
      const [state, dispatch] = w.useReducer((s, a) => {
        if (a.type === 'add') return [...s, a.text];
        if (a.type === 'clear') return [];
        return s;
      }, []);
      return w.h('div', null,
        w.h('button', { id: 'add',   onClick: () => dispatch({ type: 'add', text: 'item' }) }, 'add'),
        w.h('button', { id: 'clear', onClick: () => dispatch({ type: 'clear' }) }, 'clear'),
        w.h('span',   { id: 'count' }, 'count=' + state.length),
      );
    }
    w.loxia.render(App, {});
    w.document.getElementById('add').click();
    w.document.getElementById('add').click();
    w.document.getElementById('add').click();
    expect(w.document.getElementById('count').textContent).toBe('count=3');
    w.document.getElementById('clear').click();
    expect(w.document.getElementById('count').textContent).toBe('count=0');
  });

  test('pattern: useEffect cleanup runs on re-render when deps change', async () => {
    const w = await bootRuntime();
    let effectRuns = 0, cleanupRuns = 0;
    function App() {
      const [n, setN] = w.useState(0);
      w.useEffect(() => {
        effectRuns++;
        return () => { cleanupRuns++; };
      }, [n]);
      return w.h('button', { id: 'b', onClick: () => setN(n + 1) }, 'n=' + n);
    }
    w.loxia.render(App, {});
    await new Promise(r => setTimeout(r, 10));
    expect(effectRuns).toBe(1);
    w.document.getElementById('b').click();
    await new Promise(r => setTimeout(r, 10));
    expect(cleanupRuns).toBe(1);
    expect(effectRuns).toBe(2);
  });

  test('pattern: sendEvent for agent-owned state', async () => {
    const w = await bootRuntime();
    // Intercept postMessage to capture the event that would go to the parent.
    const messages = [];
    w.parent = { postMessage: (msg) => messages.push(msg) };
    function App() {
      return w.h('button', { id: 's', onClick: () => w.loxia.sendEvent({ type: 'save', value: 42 }) }, 'save');
    }
    w.loxia.render(App, {});
    w.document.getElementById('s').click();
    const evt = messages.find(m => m && m.type === 'event');
    expect(evt).toBeDefined();
    expect(evt.payload).toEqual({ type: 'save', value: 42 });
  });

  test('namespace aliases all resolve the same bundle (any name the agent reaches for works)', async () => {
    const w = await bootRuntime();
    const names = ['htmPreact', 'preact', 'preactHooks', 'React', 'hooks'];
    for (const n of names) {
      expect(w[n].useState).toBe(w.useState);
      expect(w[n].h).toBe(w.h);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// (3) FEEDBACK — failures are named + actionable
// ────────────────────────────────────────────────────────────────────────

describe('(3) FEEDBACK — every failure names the problem and points the way', () => {
  test('widget render error tool-result is shaped for easy parsing + references list-capabilities', async () => {
    const app = fakeApp();
    const calls = [], userCalls = [];
    registerRoutes(app, {
      agentPool: {
        addToolResult: async (id, p) => { calls.push({ id, p }); },
        addUserMessage: async (id, m) => { userCalls.push({ id, m }); },
      },
    });
    const handler = app.routes.post.get('/api/widget/event');
    const res = fakeRes();
    await handler({
      body: {
        agentId: 'a1', widgetId: 'scientific-calculator',
        payload: { __widgetError: true, phase: 'render', message: 'htmPreact is not defined' },
      },
    }, res);
    // Tool result carries everything the agent needs
    const err = calls[0].p.result;
    expect(err.success).toBe(false);
    expect(err.widgetId).toBe('scientific-calculator');
    expect(err.phase).toBe('render');
    expect(err.message).toBe('htmPreact is not defined');
    expect(err.error).toMatch(/WIDGET RENDER ERROR/);
    expect(err.error).toMatch(/htmPreact is not defined/);
    expect(err.error).toMatch(/list-capabilities/);
    expect(err.hint).toMatch(/list-capabilities/);
    // Agent is woken via synthetic user-message that ALSO mentions self-help
    expect(userCalls).toHaveLength(1);
    expect(userCalls[0].m.content).toMatch(/scientific-calculator/);
    expect(userCalls[0].m.content).toMatch(/htmPreact/);
    expect(userCalls[0].m.content).toMatch(/list-capabilities/);
  });

  test('unknown action returns an error naming every supported action', async () => {
    const r = await tool().execute({ action: 'telepathy' }, { agentId: 'a' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown action: telepathy/);
    expect(r.error).toMatch(/render/);
    expect(r.error).toMatch(/list-capabilities/);
  });

  test('render validation errors name the invalid field', async () => {
    const r = await tool().execute(
      { action: 'render', kind: 'xml', content: 'x' },
      { agentId: 'a', toolConfig: { allowCustomCode: true } }
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/kind/);
    expect(r.error).toMatch(/html/);
    expect(r.error).toMatch(/jsx/);
  });

  test('disabled-by-default returns a tailored message so the user knows what to do', async () => {
    const r = await tool().execute(
      { action: 'render', kind: 'jsx', content: 'return () => h("div");' },
      { agentId: 'a' } // no toolConfig → default off
    );
    expect(r.success).toBe(false);
    expect(r.disabled).toBe(true);
    expect(r.error).toMatch(/disabled/);
    expect(r.error).toMatch(/configurator/);
  });
});
