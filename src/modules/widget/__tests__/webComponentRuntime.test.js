/**
 * Web-component runtime — integration tests via jsdom.
 *
 * The WC path is the strictly-simpler alternative to the JSX path:
 * standard web platform APIs (HTMLElement, customElements.define,
 * connectedCallback) plus a small ergonomic base class. These tests
 * exercise the SDK end-to-end with realistic agent-style code.
 */
import { describe, test, expect } from '@jest/globals';
import { WIDGET_WC_RUNTIME } from '../runtime/webComponentBundle.js';

async function bootRuntime() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.__loxiaWidgetId = 'w';
  window.__loxiaInitialProps = {};
  // Minimal report-error stub — runtime calls this on internal errors.
  window.__loxiaReportError = (err, phase) => { window.__lastError = { err, phase }; };
  new window.Function(WIDGET_WC_RUNTIME).call(window);
  return window;
}

describe('WIDGET_WC_RUNTIME — surface', () => {
  test('exposes loxia.render, LoxiaElement, sendEvent, requestHeight', async () => {
    const w = await bootRuntime();
    expect(typeof w.LoxiaElement).toBe('function');
    expect(typeof w.loxia.render).toBe('function');
    expect(typeof w.loxia.sendEvent).toBe('function');
    expect(typeof w.loxia.requestHeight).toBe('function');
    expect(w.loxia.LoxiaElement).toBe(w.LoxiaElement);
  });

  test('LoxiaElement is a subclass of HTMLElement (so customElements.define accepts it)', async () => {
    const w = await bootRuntime();
    expect(w.LoxiaElement.prototype).toBeInstanceOf(w.HTMLElement);
  });

  test('does NOT expose the JSX runtime APIs (h, useState, hooks)', async () => {
    // Hard line — the WC path is independent. If these leak we'll see
    // the same hooks-call-order bugs that drove us here in the first place.
    const w = await bootRuntime();
    expect(w.useState).toBeUndefined();
    expect(w.useEffect).toBeUndefined();
    expect(w.h).toBeUndefined();
    expect(w.html).toBeUndefined();
    expect(w.htmPreact).toBeUndefined();
  });
});

describe('LoxiaElement — base class behavior', () => {
  test('class field state seeds initial render', async () => {
    const w = await bootRuntime();
    class Counter extends w.LoxiaElement {
      template(s) { return '<span id="t">n=' + (s.n ?? 0) + '</span>'; }
    }
    const inst = w.loxia.render(Counter, { n: 5 });
    // Output goes into shadow DOM now — query via shadowRoot
    expect(inst.shadowRoot.querySelector('#t').textContent).toBe('n=5');
  });

  test('setState({...}) merges and re-renders', async () => {
    const w = await bootRuntime();
    class App extends w.LoxiaElement {
      template(s) { return '<span id="x">' + (s.a || 0) + '/' + (s.b || 0) + '</span>'; }
    }
    const inst = w.loxia.render(App, { a: 1, b: 2 });
    expect(inst.shadowRoot.querySelector('#x').textContent).toBe('1/2');
    inst.setState({ a: 9 });
    expect(inst.shadowRoot.querySelector('#x').textContent).toBe('9/2');
  });

  test('setState(prev => next) supports functional updates', async () => {
    const w = await bootRuntime();
    class App extends w.LoxiaElement {
      template(s) { return '<span id="n">' + (s.n || 0) + '</span>'; }
    }
    const inst = w.loxia.render(App, { n: 10 });
    inst.setState(prev => ({ n: prev.n + 5 }));
    expect(inst.shadowRoot.querySelector('#n').textContent).toBe('15');
  });

  // REGRESSION: agents trained on web-component tutorials reach for
  // `this.shadowRoot.addEventListener(...)` in onMount. LoxiaElement
  // used to use light DOM (innerHTML on `this`), so shadowRoot was
  // null and the call threw "Cannot read properties of null".
  test('this.shadowRoot is non-null and event delegation works (REGRESSION)', async () => {
    const w = await bootRuntime();
    let clicks = 0;
    class App extends w.LoxiaElement {
      template() { return '<button id="b">click</button>'; }
      onMount() {
        // Mirrors the exact pattern from the failing widget
        this.shadowRoot.addEventListener('click', () => { clicks++; });
      }
    }
    const inst = w.loxia.render(App, {});
    expect(inst.shadowRoot).not.toBeNull();
    expect(inst.shadowRoot.querySelector('#b')).toBeTruthy();
    inst.shadowRoot.querySelector('#b').click();
    expect(clicks).toBe(1);
  });

  test('CSS in template is scoped (does not leak to outer document)', async () => {
    const w = await bootRuntime();
    class App extends w.LoxiaElement {
      template() {
        return '<style>.x { color: rgb(0, 128, 0); }</style><span class="x" id="t">leaf</span>';
      }
    }
    const inst = w.loxia.render(App);
    // The styled element exists inside shadowRoot
    expect(inst.shadowRoot.querySelector('#t')).toBeTruthy();
    // The outer document has no .x rule (style is scoped)
    expect(w.document.querySelector('.x')).toBeNull();
  });
});

describe('LoxiaElement — auto-wired attributes', () => {
  test('data-bind on input → setState on input event (string)', async () => {
    const w = await bootRuntime();
    class Form extends w.LoxiaElement {
      template(s) {
        return '<input id="i" data-bind="name" value="' + (s.name || '') + '"><span id="o">' + (s.name || '') + '</span>';
      }
    }
    const inst = w.loxia.render(Form, {});
    const input = inst.shadowRoot.querySelector('#i');
    input.value = 'alice';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    expect(inst.shadowRoot.querySelector('#o').textContent).toBe('alice');
  });

  test('data-bind on number input → setState with NUMERIC value', async () => {
    const w = await bootRuntime();
    class Calc extends w.LoxiaElement {
      template(s) { return '<input id="i" type="number" data-bind="x"><span id="o">x=' + (s.x || 0) + ', type=' + typeof s.x + '</span>'; }
    }
    const inst = w.loxia.render(Calc, {});
    const input = inst.shadowRoot.querySelector('#i');
    input.value = '42';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    // Number coercion: x is a Number, not a String
    expect(inst.shadowRoot.querySelector('#o').textContent).toMatch(/x=42/);
    expect(inst.shadowRoot.querySelector('#o').textContent).toMatch(/type=number/);
  });

  test('data-bind on checkbox → setState with BOOLEAN value', async () => {
    const w = await bootRuntime();
    class Toggle extends w.LoxiaElement {
      template(s) {
        return '<input id="c" type="checkbox" data-bind="on" ' + (s.on ? 'checked' : '') + '><span id="o">on=' + (s.on ? 'true' : 'false') + '</span>';
      }
    }
    const inst = w.loxia.render(Toggle, {});
    const cb = inst.shadowRoot.querySelector('#c');
    cb.checked = true;
    cb.dispatchEvent(new w.Event('change', { bubbles: true }));
    expect(inst.shadowRoot.querySelector('#o').textContent).toBe('on=true');
  });

  test('data-emit on click → postMessage to parent with state', async () => {
    const w = await bootRuntime();
    const messages = [];
    w.parent = { postMessage: (msg) => messages.push(msg) };
    class App extends w.LoxiaElement {
      template(s) { return '<button id="b" data-emit="save">Save</button>'; }
    }
    const inst = w.loxia.render(App, { x: 1 });
    inst.shadowRoot.querySelector('#b').click();
    const evt = messages.find(m => m && m.type === 'event');
    expect(evt).toBeDefined();
    expect(evt.payload.type).toBe('save');
    expect(evt.payload.state).toEqual({ x: 1 });
  });

  test('data-on-click calls a LOCAL instance method (this bound to LoxiaElement)', async () => {
    const w = await bootRuntime();
    class App extends w.LoxiaElement {
      state = { count: 0 };
      bump() { this.setState({ count: this.state.count + 1 }); }
      template(s) { return '<button id="b" data-on-click="bump">' + s.count + '</button>'; }
    }
    const inst = w.loxia.render(App);
    expect(inst.shadowRoot.querySelector('#b').textContent).toBe('0');
    inst.shadowRoot.querySelector('#b').click();
    expect(inst.shadowRoot.querySelector('#b').textContent).toBe('1');
    inst.shadowRoot.querySelector('#b').click();
    expect(inst.shadowRoot.querySelector('#b').textContent).toBe('2');
  });

  test('data-on-click reports a WARNING if the method is missing (non-fatal — widget still renders)', async () => {
    const w = await bootRuntime();
    const warnings = [];
    w.__loxiaReportWarning = (msg, phase) => warnings.push({ msg, phase });
    class App extends w.LoxiaElement {
      template() { return '<button id="b" data-on-click="doesNotExist">X</button>'; }
    }
    const inst = w.loxia.render(App);
    // Widget DID mount — the missing handler doesn't kill the render.
    expect(inst.shadowRoot.querySelector('#b')).toBeTruthy();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].phase).toBe('lint');
    expect(warnings[0].msg).toMatch(/doesNotExist/);
  });

  test('data-on-<event> works generically for any DOM event name (pointerdown, dblclick, wheel, contextmenu)', async () => {
    const w = await bootRuntime();
    const fired = [];
    class App extends w.LoxiaElement {
      onPointer(e) { fired.push(e.type); }
      onDouble(e)  { fired.push(e.type); }
      onWheel(e)   { fired.push(e.type); }
      onCtx(e)     { fired.push(e.type); }
      template() {
        return `
          <div id="p" data-on-pointerdown="onPointer">P</div>
          <div id="d" data-on-dblclick="onDouble">D</div>
          <div id="w" data-on-wheel="onWheel">W</div>
          <div id="c" data-on-contextmenu="onCtx">C</div>
        `;
      }
    }
    const inst = w.loxia.render(App);
    inst.shadowRoot.querySelector('#p').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    inst.shadowRoot.querySelector('#d').dispatchEvent(new w.Event('dblclick',    { bubbles: true }));
    inst.shadowRoot.querySelector('#w').dispatchEvent(new w.Event('wheel',       { bubbles: true }));
    inst.shadowRoot.querySelector('#c').dispatchEvent(new w.Event('contextmenu', { bubbles: true }));
    expect(fired).toEqual(['pointerdown', 'dblclick', 'wheel', 'contextmenu']);
  });

  test('data-on-input fires on input events for non-bind elements', async () => {
    const w = await bootRuntime();
    let lastEventType = null;
    class App extends w.LoxiaElement {
      onType(e) { lastEventType = e.type; }
      template() { return '<input id="i" data-on-input="onType">'; }
    }
    const inst = w.loxia.render(App);
    inst.shadowRoot.querySelector('#i').dispatchEvent(new w.Event('input', { bubbles: true }));
    expect(lastEventType).toBe('input');
  });

  test('FOOTGUN: data-bind-click is auto-rewritten to data-on-click AND warns', async () => {
    const w = await bootRuntime();
    const warnings = [];
    w.__loxiaReportWarning = (msg, phase) => warnings.push({ msg, phase });
    let toggled = 0;
    class App extends w.LoxiaElement {
      toggleYes() { toggled++; }
      template() { return '<button id="b" data-bind-click="toggleYes">X</button>'; }
    }
    const inst = w.loxia.render(App);
    const btn = inst.shadowRoot.querySelector('#b');
    expect(btn).toBeTruthy();                          // widget rendered
    expect(btn.hasAttribute('data-bind-click')).toBe(false);   // typo removed
    expect(btn.getAttribute('data-on-click')).toBe('toggleYes'); // canonical attribute set
    btn.click();                                       // and the handler ACTUALLY FIRES
    expect(toggled).toBe(1);
    const hit = warnings.find(e => /auto-rewrote/.test(e.msg));
    expect(hit).toBeDefined();
    expect(hit.phase).toBe('lint');
  });

  test('FOOTGUN: inline onclick="..." is flagged as a warning', async () => {
    const w = await bootRuntime();
    const warnings = [];
    w.__loxiaReportWarning = (msg, phase) => warnings.push({ msg, phase });
    class App extends w.LoxiaElement {
      template() { return '<button id="b" onclick="this.toggleYes()">X</button>'; }
    }
    w.loxia.render(App);
    const hit = warnings.find(e => /Inline attribute "onclick"/.test(e.msg));
    expect(hit).toBeDefined();
    expect(hit.msg).toMatch(/data-on-click/);
  });

  test('FOOTGUN: data-action / data-handler / data-onclick are all auto-rewritten and fire', async () => {
    const w = await bootRuntime();
    const warnings = [];
    w.__loxiaReportWarning = (msg, phase) => warnings.push({ msg, phase });
    const fired = [];
    class App extends w.LoxiaElement {
      x(){ fired.push('x'); }
      y(){ fired.push('y'); }
      z(){ fired.push('z'); }
      template() {
        return `
          <button id="a" data-action="x">A</button>
          <button id="b" data-handler="y">B</button>
          <button id="c" data-onclick="z">C</button>
        `;
      }
    }
    const inst = w.loxia.render(App);
    inst.shadowRoot.querySelector('#a').click();
    inst.shadowRoot.querySelector('#b').click();
    inst.shadowRoot.querySelector('#c').click();
    expect(fired).toEqual(['x', 'y', 'z']);
    expect(warnings.find(e => /data-action/.test(e.msg))).toBeDefined();
    expect(warnings.find(e => /data-handler/.test(e.msg))).toBeDefined();
    expect(warnings.find(e => /data-onclick/.test(e.msg))).toBeDefined();
  });

  test('FOOTGUN: auto-rewrite does NOT clobber an existing data-on-<event> the agent also wrote', async () => {
    const w = await bootRuntime();
    w.__loxiaReportWarning = () => {};
    const fired = [];
    class App extends w.LoxiaElement {
      good() { fired.push('good'); }
      bad()  { fired.push('bad'); }
      template() {
        // Belt-and-suspenders: agent wrote BOTH the typo and the right
        // attribute. The right one wins — we don't overwrite it.
        return '<button id="b" data-bind-click="bad" data-on-click="good">X</button>';
      }
    }
    const inst = w.loxia.render(App);
    inst.shadowRoot.querySelector('#b').click();
    expect(fired).toEqual(['good']);
  });

  test('FOOTGUN: data-on:click (colon) is auto-rewritten and fires', async () => {
    const w = await bootRuntime();
    const warnings = [];
    w.__loxiaReportWarning = (msg, phase) => warnings.push({ msg, phase });
    let fired = 0;
    class App extends w.LoxiaElement {
      foo() { fired++; }
      template() { return '<button id="b" data-on:click="foo">X</button>'; }
    }
    const inst = w.loxia.render(App);
    inst.shadowRoot.querySelector('#b').click();
    expect(fired).toBe(1);
    expect(warnings.find(e => /data-on:click/.test(e.msg))).toBeDefined();
  });

  test('FOOTGUN: real data-on-click does NOT trigger the typo detector', async () => {
    const w = await bootRuntime();
    const warnings = [];
    w.__loxiaReportWarning = (msg, phase) => warnings.push({ msg, phase });
    class App extends w.LoxiaElement {
      foo() {}
      template() { return '<button id="b" data-on-click="foo">X</button>'; }
    }
    w.loxia.render(App);
    expect(warnings).toHaveLength(0);  // no false positives
  });

  test('FOOTGUN: typos do NOT replace the widget with a red error screen (no fatal report)', async () => {
    // The original bug: a single data-bind-click typo caused the entire
    // widget to be replaced with "widget error (render): ..." because
    // the detector used the error channel. Now it uses warnings, so
    // __loxiaReportError must NOT fire for typos.
    const w = await bootRuntime();
    const errors = [];
    const warnings = [];
    w.__loxiaReportError = (err, phase) => errors.push({ msg: err.message, phase });
    w.__loxiaReportWarning = (msg, phase) => warnings.push({ msg, phase });
    class App extends w.LoxiaElement {
      template() { return '<button id="b" data-bind-click="x" onclick="this.y()">Z</button>'; }
    }
    w.loxia.render(App);
    expect(errors).toHaveLength(0);
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  test('FOOTGUN: falls back to error channel if warning channel is missing (back-compat)', async () => {
    const w = await bootRuntime();
    const errors = [];
    w.__loxiaReportError = (err, phase) => errors.push({ msg: err.message, phase });
    delete w.__loxiaReportWarning;   // older runtime — no warning channel
    class App extends w.LoxiaElement {
      template() { return '<button id="b" data-bind-click="x">X</button>'; }
    }
    w.loxia.render(App);
    expect(errors.find(e => /data-bind-click/.test(e.msg))).toBeDefined();
  });

  test('afterRender(root) hook fires after every render, NOT just first', async () => {
    const w = await bootRuntime();
    const calls = [];
    class App extends w.LoxiaElement {
      state = { n: 0 };
      bump() { this.setState({ n: this.state.n + 1 }); }
      afterRender(root) {
        calls.push({ n: this.state.n, hasButton: !!root.querySelector('#b') });
      }
      template(s) { return '<button id="b" data-on-click="bump">' + s.n + '</button>'; }
    }
    const inst = w.loxia.render(App);
    expect(calls).toHaveLength(1);   // initial render
    expect(calls[0]).toEqual({ n: 0, hasButton: true });
    inst.shadowRoot.querySelector('#b').click();
    expect(calls).toHaveLength(2);   // post-setState render
    expect(calls[1]).toEqual({ n: 1, hasButton: true });
    inst.shadowRoot.querySelector('#b').click();
    expect(calls).toHaveLength(3);
  });

  test('afterRender: manual addEventListener attached here SURVIVES setState (the whole point)', async () => {
    const w = await bootRuntime();
    const customEvents = [];
    class App extends w.LoxiaElement {
      state = { n: 0 };
      bump() { this.setState({ n: this.state.n + 1 }); }
      afterRender(root) {
        // Attach a listener for a custom event that data-on-* doesn't cover
        // — exactly the use case afterRender exists for.
        const el = root.querySelector('#area');
        if (el) el.addEventListener('my-custom', () => customEvents.push(this.state.n));
      }
      template(s) {
        return `
          <div id="area">${s.n}</div>
          <button id="b" data-on-click="bump">bump</button>
        `;
      }
    }
    const inst = w.loxia.render(App);
    inst.shadowRoot.querySelector('#area').dispatchEvent(new w.Event('my-custom'));
    expect(customEvents).toEqual([0]);
    inst.shadowRoot.querySelector('#b').click();   // setState → re-render
    inst.shadowRoot.querySelector('#area').dispatchEvent(new w.Event('my-custom'));
    expect(customEvents).toEqual([0, 1]);   // listener was re-attached, not orphaned
  });

  test('afterRender error → reported, does NOT crash subsequent renders', async () => {
    const w = await bootRuntime();
    const errors = [];
    w.__loxiaReportError = (err, phase) => errors.push({ msg: err.message, phase });
    class App extends w.LoxiaElement {
      state = { n: 0 };
      bump() { this.setState({ n: this.state.n + 1 }); }
      afterRender() { throw new Error('after-render-boom'); }
      template(s) { return '<button id="b" data-on-click="bump">' + s.n + '</button>'; }
    }
    const inst = w.loxia.render(App);
    expect(errors.find(e => e.phase === 'afterRender' && /boom/.test(e.msg))).toBeDefined();
    // Next render still happens — the throwing afterRender doesn't kill the widget.
    inst.shadowRoot.querySelector('#b').click();
    expect(inst.shadowRoot.querySelector('#b').textContent).toBe('1');
  });

  test('handler errors thrown inside data-on-click are reported, not swallowed', async () => {
    const w = await bootRuntime();
    const errors = [];
    w.__loxiaReportError = (err, phase) => errors.push({ msg: err.message, phase });
    class App extends w.LoxiaElement {
      crash() { throw new Error('boom-from-handler'); }
      template() { return '<button id="b" data-on-click="crash">X</button>'; }
    }
    const inst = w.loxia.render(App);
    inst.shadowRoot.querySelector('#b').click();
    const handlerErr = errors.find(e => e.phase === 'event-handler');
    expect(handlerErr).toBeDefined();
    expect(handlerErr.msg).toBe('boom-from-handler');
  });

  test('data-payload merges into the emit payload', async () => {
    const w = await bootRuntime();
    const messages = [];
    w.parent = { postMessage: (msg) => messages.push(msg) };
    class App extends w.LoxiaElement {
      template() { return '<button id="b" data-emit="action" data-payload=\'{"id":"abc"}\'>X</button>'; }
    }
    const inst = w.loxia.render(App);
    inst.shadowRoot.querySelector('#b').click();
    const evt = messages.find(m => m && m.type === 'event');
    expect(evt.payload).toEqual(expect.objectContaining({ type: 'action', id: 'abc' }));
  });
});

describe('loxia.render — class registration + mount', () => {
  test('rejects non-class arguments with a NAMED error', async () => {
    const w = await bootRuntime();
    expect(() => w.loxia.render('not-a-class', {})).toThrow(/expects a class/);
    expect(() => w.loxia.render(42, {})).toThrow(/expects a class/);
  });

  test('rejects non-HTMLElement classes with a NAMED error pointing at LoxiaElement/HTMLElement', async () => {
    const w = await bootRuntime();
    class NotAnElement {}
    expect(() => w.loxia.render(NotAnElement, {})).toThrow(/extends HTMLElement|extends LoxiaElement/);
  });

  test('renders into #root and replaces existing content', async () => {
    const w = await bootRuntime();
    w.document.getElementById('root').innerHTML = '<p>previous</p>';
    class Fresh extends w.LoxiaElement {
      template() { return '<span class="new">hello</span>'; }
    }
    const inst = w.loxia.render(Fresh);
    const root = w.document.getElementById('root');
    // Old <p>previous</p> is gone — root was cleared and re-mounted
    expect(root.querySelector('p')).toBeNull();
    // The custom element IS the root's child (light DOM); its content
    // lives in the instance's shadow DOM, not the parent root.
    expect(root.children.length).toBe(1);
    expect(root.children[0]).toBe(inst);
    expect(inst.shadowRoot.querySelector('.new')).toBeTruthy();
  });

  test('plain HTMLElement subclass: initialProps are set as ATTRIBUTES (web-component idiom)', async () => {
    const w = await bootRuntime();
    let observedAttr = null;
    class Plain extends w.HTMLElement {
      static get observedAttributes() { return ['title']; }
      attributeChangedCallback(name, _, val) { if (name === 'title') observedAttr = val; }
      connectedCallback() { this.innerHTML = 'plain'; }
    }
    w.loxia.render(Plain, { title: 'hi' });
    expect(observedAttr).toBe('hi');
  });
});

describe('agent → widget prop updates (handleUpdate flow)', () => {
  test('postMessage update with new props → instance.handleUpdate → setState → re-render', async () => {
    const w = await bootRuntime();
    class Counter extends w.LoxiaElement {
      template(s) { return '<span id="n">n=' + (s.n || 0) + '</span>'; }
    }
    const inst = w.loxia.render(Counter, { n: 1 });
    expect(inst.shadowRoot.querySelector('#n').textContent).toBe('n=1');
    // Simulate the parent posting a widget.update message
    w.dispatchEvent(new w.MessageEvent('message', {
      data: { __loxia: true, type: 'update', widgetId: 'w', props: { n: 99 } },
      source: w.parent,
    }));
    // jsdom dispatches synchronously; assert immediately
    expect(inst.shadowRoot.querySelector('#n').textContent).toBe('n=99');
  });

  test('class can override handleUpdate for custom merge logic', async () => {
    const w = await bootRuntime();
    let called = null;
    class App extends w.LoxiaElement {
      template(s) { return '<span>' + (s.merged || '') + '</span>'; }
      handleUpdate(p) { called = p; this.setState({ merged: p.x + '!' }); }
    }
    const inst = w.loxia.render(App, {});
    w.dispatchEvent(new w.MessageEvent('message', {
      data: { __loxia: true, type: 'update', widgetId: 'w', props: { x: 'hi' } },
      source: w.parent,
    }));
    expect(called).toEqual({ x: 'hi' });
    expect(inst.shadowRoot.querySelector('span').textContent).toBe('hi!');
  });
});

describe('error reporting from inside the runtime', () => {
  test('template() throwing → reported via __loxiaReportError, not crashing', async () => {
    const w = await bootRuntime();
    class Bad extends w.LoxiaElement {
      template() { throw new Error('boom'); }
    }
    w.loxia.render(Bad);
    expect(w.__lastError).toBeDefined();
    expect(w.__lastError.phase).toBe('render');
    expect(w.__lastError.err.message).toBe('boom');
  });
});
