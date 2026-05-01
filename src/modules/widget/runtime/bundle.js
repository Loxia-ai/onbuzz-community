/**
 * Widget runtime bundle — STRING, served to every jsx-mode iframe.
 *
 * This file is a Node module that exports a plain string. The string is
 * JavaScript that runs INSIDE the sandboxed iframe. Keep it self-contained:
 * the iframe has null origin, no network (CSP connect-src 'none'), and
 * no same-origin access — there is no way to lazy-load anything.
 *
 * Why inline everything as a single string (not a bundled file served
 * via <script src>): the iframe's CSP is script-src 'self' which, for a
 * srcdoc document, resolves 'self' to a unique/null origin that can't
 * match any URL. Inline scripts (via 'unsafe-inline' in CSP) are the
 * only reliable path.
 *
 * Contains:
 *   - A minimal Preact-flavoured h()/render() (hand-rolled, ~500 LOC)
 *   - htm-style tagged-template compiler (~200 LOC)
 *   - The loxia.* SDK (postMessage bridge)
 *   - A small primitive catalogue: Card, Button, Input, Text, Metric, Row, Col
 *
 * MVP note: the primitive catalog is intentionally minimal. Agents can
 * use plain HTML elements in their render functions too — `h('div', ...)`
 * and `html\`<div>...\`` both work. Primitives are ergonomics.
 */

export const WIDGET_RUNTIME = `
/* ==== Loxia widget runtime v1 ==== */
(function () {
  'use strict';

  /* ---------- tiny VDOM (Preact-flavoured) ---------- */
  // VNode: { type, props, children }
  function h(type, props, ...children) {
    return { type, props: props || {}, children: children.flat(Infinity).filter(c => c != null && c !== false) };
  }

  // Render a VNode/text into a real DOM node. Very small — re-renders
  // replace the whole subtree rather than diffing (fine for MVP widget
  // sizes; can upgrade later).
  function createDom(v) {
    if (v == null || v === false) return document.createTextNode('');
    if (typeof v === 'string' || typeof v === 'number') return document.createTextNode(String(v));
    if (typeof v.type === 'function') {
      // Component — call with props + children and recurse.
      const childrenArg = v.children.length === 1 ? v.children[0] : v.children;
      const out = v.type({ ...v.props, children: childrenArg });
      return createDom(out);
    }
    // Native element
    const el = document.createElement(v.type);
    for (const [k, val] of Object.entries(v.props || {})) {
      if (val == null || val === false) continue;
      if (k === 'children') continue;
      if (k === 'style' && typeof val === 'object') {
        Object.assign(el.style, val);
      } else if (k === 'className') {
        el.setAttribute('class', String(val));
      } else if (k === 'dangerouslySetInnerHTML') {
        // Deliberately not supported — users who want HTML can use kind:'html'.
        console.warn('[loxia] dangerouslySetInnerHTML is not supported in jsx widgets');
      } else if (k.startsWith('on') && typeof val === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), val);
      } else {
        el.setAttribute(k, String(val));
      }
    }
    for (const child of v.children) {
      el.appendChild(createDom(child));
    }
    return el;
  }

  let _rootEl = null;
  let _rootVNode = null;
  function renderToRoot(vnode, container) {
    _rootEl = container;
    _rootVNode = vnode;
    container.innerHTML = '';
    container.appendChild(createDom(vnode));
    scheduleHeight();
  }

  /* ---------- htm-ish tagged-template compiler ---------- */
  // Parses:   html\`<Card title=\${t}><Button onClick=\${f}>hi<//></>\`
  // into a VNode tree using the h() above. Small but sufficient for
  // widget-shape templates (elements, attributes, children, closing tags
  // in "//" form, component references via \${Component}).
  //
  // Adapted from the public-domain htm algorithm; rewritten terse for inlining.
  const CACHE = new WeakMap();
  function html(strings) {
    const values = Array.prototype.slice.call(arguments, 1);
    let tree = CACHE.get(strings);
    if (!tree) {
      tree = parseTemplate(strings);
      CACHE.set(strings, tree);
    }
    return evalTree(tree, values);
  }

  // Parse the template array into an instruction list we can replay with values.
  // Instructions: [kind, ...]
  //   [1, type]           OPEN (type is string|index)
  //   [2]                 CLOSE
  //   [3, name, valueOrIdx, isIndex]  ATTR
  //   [4, textOrIdx, isIndex]         CHILD
  function parseTemplate(strings) {
    const insts = [];
    let buf = '';
    let mode = 'text'; // text | tag | attr
    for (let i = 0; i < strings.length; i++) {
      const s = strings[i];
      for (let j = 0; j < s.length; j++) {
        const c = s[j];
        if (mode === 'text') {
          if (c === '<') {
            if (buf.trim()) insts.push([4, buf, false]);
            buf = '';
            mode = 'tag';
          } else {
            buf += c;
          }
        } else if (mode === 'tag') {
          if (c === '>') {
            commitTag(insts, buf);
            buf = '';
            mode = 'text';
          } else if (/\\s/.test(c) && buf) {
            commitTag(insts, buf);
            buf = '';
            mode = 'attr';
          } else if (c === '/' && j + 1 < s.length && s[j + 1] === '>') {
            // self-close: <Foo/> — commit then close
            commitTag(insts, buf);
            insts.push([2]);
            buf = '';
            j++;
            mode = 'text';
          } else {
            buf += c;
          }
        } else if (mode === 'attr') {
          if (c === '>') {
            if (buf.trim()) parseAttr(insts, buf);
            buf = '';
            mode = 'text';
          } else if (c === '/' && j + 1 < s.length && s[j + 1] === '>') {
            if (buf.trim()) parseAttr(insts, buf);
            insts.push([2]);
            buf = '';
            j++;
            mode = 'text';
          } else {
            buf += c;
          }
        }
      }
      // End of string segment — the value at index i goes next.
      // (Tagged template invariant: strings.length === values.length + 1,
      // so "there is a value after strings[i]" iff i < strings.length - 1.
      // We can't reference values here — parseTemplate runs with only the
      // strings array; values are substituted later in evalTree.)
      if (i < strings.length - 1) {
        if (mode === 'text') {
          if (buf) insts.push([4, buf, false]);
          buf = '';
          insts.push([4, i, true]);
        } else if (mode === 'attr') {
          const trimmed = buf.trim();
          if (trimmed.endsWith('=')) {
            // buf may contain earlier COMPLETED attrs followed by a new
            // name ending in "=". Example:  'id="b" onClick='  → the
            // earlier part 'id="b"' is a complete attr we must run
            // through parseAttr; the final word (after last whitespace)
            // is the name of the interpolated attribute.
            const withoutEq = trimmed.slice(0, -1);
            const m = withoutEq.match(/^([\\s\\S]*?)(\\S+)\\s*\$/);
            if (m && m[1].trim()) {
              parseAttr(insts, m[1].trim());
              insts.push([3, m[2].trim(), i, true]);
            } else {
              insts.push([3, withoutEq.trim(), i, true]);
            }
          } else if (trimmed === '') {
            // spread — not supported in MVP; ignore
          } else {
            // Something like  'id="b" onClick'  (boolean-ish / \${Comp}-as-type).
            // parseAttr splits multi-attrs; last token becomes boolean or
            // value-holder depending on our interpretation. Keep prior
            // behaviour — pass the whole thing.
            parseAttr(insts, trimmed + '=' + JSON.stringify('__val__' + i));
          }
          buf = '';
        } else if (mode === 'tag') {
          // opener is the value — \${Comp}
          insts.push([1, i, true]);
          buf = '';
          mode = 'attr';
        }
      }
    }
    if (buf.trim()) insts.push([4, buf, false]);
    return insts;
  }

  function commitTag(insts, raw) {
    const t = raw.trim();
    if (!t) return;
    if (t.startsWith('/')) {
      insts.push([2]);
    } else {
      insts.push([1, t, false]);
    }
  }

  function parseAttr(insts, raw) {
    // Attrs separated by whitespace, each as "name" or "name=value" or 'name="value"'
    const parts = raw.match(/[^\\s"']+=\"[^\"]*\"|[^\\s"']+='[^']*'|[^\\s"']+/g) || [];
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq === -1) {
        insts.push([3, part, true, false]); // boolean attr
      } else {
        const name = part.slice(0, eq);
        let val = part.slice(eq + 1);
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        insts.push([3, name, val, false]);
      }
    }
  }

  // Walk instructions, substituting values, building a tree of {type, props, children}.
  function evalTree(insts, values) {
    const stack = [{ type: '__root__', props: {}, children: [] }];
    for (const inst of insts) {
      const top = stack[stack.length - 1];
      if (inst[0] === 1) {
        const type = inst[2] ? values[inst[1]] : inst[1];
        const node = { type, props: {}, children: [] };
        top.children.push(node);
        stack.push(node);
      } else if (inst[0] === 2) {
        if (stack.length > 1) stack.pop();
      } else if (inst[0] === 3) {
        const [, name, valOrIdx, isIdx] = inst;
        top.props[name] = isIdx ? values[valOrIdx] : valOrIdx;
      } else if (inst[0] === 4) {
        const [, valOrIdx, isIdx] = inst;
        const v = isIdx ? values[valOrIdx] : valOrIdx;
        if (Array.isArray(v)) for (const x of v) top.children.push(x);
        else if (v != null) top.children.push(v);
      }
    }
    const root = stack[0];
    return root.children.length === 1 ? root.children[0] : root.children;
  }

  /* ---------- primitives (ergonomic wrappers) ---------- */
  function LoxiaCard({ title, children, padding = 'md' }) {
    const pad = padding === 'sm' ? '8px' : padding === 'lg' ? '24px' : '16px';
    return h('div', {
      className: 'loxia-card',
      style: {
        background: 'var(--loxia-card-bg, rgb(var(--gray-50)))',
        border: '1px solid var(--loxia-card-border, rgb(var(--gray-200)))',
        borderRadius: '8px',
        padding: pad,
        color: 'rgb(var(--gray-900))',
        fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      },
    },
      title ? h('div', { style: { fontWeight: '600', marginBottom: '8px', fontSize: '14px' } }, title) : null,
      children
    );
  }

  function LoxiaButton({ label, onClick, children, variant = 'primary', disabled }) {
    const bg = variant === 'primary' ? 'rgb(var(--loxia-600))' :
               variant === 'danger'  ? '#dc2626' : 'rgb(var(--gray-200))';
    const color = variant === 'primary' || variant === 'danger' ? 'white' : 'rgb(var(--gray-900))';
    return h('button', {
      onClick: disabled ? undefined : onClick,
      disabled,
      style: {
        background: bg, color, border: 'none',
        padding: '6px 14px', borderRadius: '6px', fontSize: '13px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      },
    }, label || children);
  }

  function LoxiaInput({ value, onChange, placeholder, type = 'text' }) {
    return h('input', {
      type, value: value ?? '', placeholder: placeholder ?? '',
      onInput: (e) => onChange && onChange(e.target.value),
      style: {
        padding: '6px 10px', border: '1px solid rgb(var(--gray-300))',
        borderRadius: '6px', fontSize: '13px', width: '100%',
        background: 'rgb(var(--gray-50))', color: 'rgb(var(--gray-900))',
      },
    });
  }

  function LoxiaText({ children, tone = 'default', size = 'md' }) {
    const color = tone === 'muted' ? 'rgb(var(--gray-500))' : 'rgb(var(--gray-900))';
    const fs = size === 'sm' ? '12px' : size === 'lg' ? '16px' : '14px';
    return h('span', { style: { color, fontSize: fs } }, children);
  }

  function LoxiaMetric({ label, value, unit }) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
      h('div', { style: { fontSize: '11px', color: 'rgb(var(--gray-500))', textTransform: 'uppercase', letterSpacing: '0.05em' } }, label),
      h('div', { style: { fontSize: '20px', fontWeight: '600', color: 'rgb(var(--gray-900))' } },
        value, unit ? h('span', { style: { fontSize: '13px', fontWeight: '400', color: 'rgb(var(--gray-500))', marginLeft: '4px' } }, unit) : null
      )
    );
  }

  function LoxiaRow({ children, gap = 'md', justify = 'start', align = 'start' }) {
    const g = gap === 'sm' ? '6px' : gap === 'lg' ? '20px' : '12px';
    return h('div', { style: { display: 'flex', flexDirection: 'row', gap: g, justifyContent: justify, alignItems: align, flexWrap: 'wrap' } }, children);
  }
  function LoxiaCol({ children, gap = 'md' }) {
    const g = gap === 'sm' ? '6px' : gap === 'lg' ? '20px' : '12px';
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: g } }, children);
  }

  /* ---------- postMessage SDK ---------- */
  const _updateListeners = [];
  function sendEvent(evt) {
    try {
      window.parent.postMessage({ __loxia: true, type: 'event', widgetId: window.__loxiaWidgetId, payload: evt }, '*');
    } catch (err) {
      console.warn('[loxia] sendEvent failed', err);
    }
  }
  function onUpdate(cb) { if (typeof cb === 'function') _updateListeners.push(cb); }
  function requestHeight(px) {
    try {
      window.parent.postMessage({ __loxia: true, type: 'resize', widgetId: window.__loxiaWidgetId, height: px }, '*');
    } catch {}
  }

  window.addEventListener('message', (e) => {
    if (!e.data || e.data.__loxia !== true) return;
    if (e.source !== window.parent) return;
    if (e.data.type === 'update' && e.data.props) {
      _updateListeners.forEach(cb => { try { cb(e.data.props); } catch (err) { console.warn('[loxia] update handler threw', err); } });
      _reRender();
    } else if (e.data.type === 'theme' && e.data.tokens) {
      applyThemeTokens(e.data.tokens);
    }
  });

  function applyThemeTokens(tokens) {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(tokens)) {
      root.style.setProperty('--' + k, v);
    }
  }

  /* ---------- auto-resize ---------- */
  let _heightDebounce = null;
  function scheduleHeight() {
    if (_heightDebounce) clearTimeout(_heightDebounce);
    _heightDebounce = setTimeout(() => {
      const h = Math.ceil(document.body.scrollHeight);
      requestHeight(h);
    }, 50);
  }

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => scheduleHeight());
    document.addEventListener('DOMContentLoaded', () => ro.observe(document.body));
  } else {
    // Fallback: just post once after load.
    document.addEventListener('DOMContentLoaded', () => setTimeout(scheduleHeight, 50));
  }

  /* ---------- hooks (for the ROOT component only) ---------- */
  // Agents are heavily trained on React hooks and reach for useState
  // reflexively. Supporting a minimal hooks set for the root component
  // eliminates a whole class of "widget didn't render" failures.
  //
  // Scope limitation: hooks are tracked by CALL ORDER in the root render.
  // Nested components calling hooks would break the call-order contract
  // (different trees, different orders) — so we only guarantee correctness
  // for the root App function. The tool description tells the agent to
  // keep state in the root component, which is almost always fine.
  const _hookCells = [];
  let _hookIdx = 0;
  function _sameDeps(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function useState(initial) {
    const i = _hookIdx++;
    if (!_hookCells[i]) _hookCells[i] = { value: typeof initial === 'function' ? initial() : initial };
    const cell = _hookCells[i];
    const setValue = (v) => {
      const next = typeof v === 'function' ? v(cell.value) : v;
      if (next === cell.value) return;
      cell.value = next;
      _reRender();
    };
    return [cell.value, setValue];
  }
  function useRef(initial) {
    const i = _hookIdx++;
    if (!_hookCells[i]) _hookCells[i] = { current: initial };
    return _hookCells[i];
  }
  function useMemo(compute, deps) {
    const i = _hookIdx++;
    const cell = _hookCells[i] || (_hookCells[i] = { deps: null, value: undefined });
    if (cell.deps === null || !_sameDeps(cell.deps, deps)) {
      cell.value = compute();
      cell.deps = deps ? deps.slice() : null;
    }
    return cell.value;
  }
  function useCallback(fn, deps) { return useMemo(() => fn, deps); }
  // useReducer — implemented as a thin wrapper over useState so agents
  // that know the pattern can reach for it. \`dispatch(action)\` calls
  // reducer(state, action) and schedules a re-render.
  function useReducer(reducer, initial, init) {
    const [state, setState] = useState(init ? init(initial) : initial);
    const dispatch = useCallback(function(action) {
      setState(function(prev) { return reducer(prev, action); });
    }, [reducer]);
    return [state, dispatch];
  }
  function useEffect(fn, deps) {
    const i = _hookIdx++;
    const cell = _hookCells[i] || (_hookCells[i] = { deps: null, cleanup: null });
    const changed = cell.deps === null || !_sameDeps(cell.deps, deps);
    if (changed) {
      if (typeof cell.cleanup === 'function') { try { cell.cleanup(); } catch (err) { console.warn('[loxia] effect cleanup threw', err); } }
      cell.deps = deps ? deps.slice() : null;
      // Defer until after DOM paint, matching React semantics.
      setTimeout(() => {
        try { cell.cleanup = fn() || null; }
        catch (err) {
          if (window.__loxiaReportError) window.__loxiaReportError(err, 'effect');
          else console.warn('[loxia] effect threw', err);
        }
      }, 0);
    }
  }

  /* ---------- mount API ---------- */
  let _agentComponent = null;
  let _currentProps = null;
  function _reRender() {
    if (!_agentComponent || !_rootEl) return;
    _hookIdx = 0; // reset hook counter for this render pass
    let vnode = _agentComponent({ ...(_currentProps || {}) });
    // Factory-style agent code (return function App(){...};): the
    // outer wrapper returned a function rather than a vnode. Promote
    // it to the real component and re-run so hooks run in the RIGHT
    // component's scope.
    if (typeof vnode === 'function') {
      _agentComponent = vnode;
      _hookIdx = 0;
      vnode = _agentComponent({ ...(_currentProps || {}) });
    }
    renderToRoot(vnode, _rootEl);
  }

  window.loxia = {
    h, html, render: (component, initialProps) => {
      _agentComponent = component;
      _currentProps = initialProps || {};
      const root = document.getElementById('root') || document.body;
      _rootEl = root;
      _reRender();
    },
    sendEvent, onUpdate, requestHeight,
    useState, useEffect, useMemo, useCallback, useRef, useReducer,
    primitives: { LoxiaCard, LoxiaButton, LoxiaInput, LoxiaText, LoxiaMetric, LoxiaRow, LoxiaCol },
  };
  // Expose as bare globals AND as properties on h, so all of these work:
  //   h.useState, loxia.useState, and bare useState
  //   const { useState } = h;  (← what agents keep writing — now works)
  // Bare globals — every one of these also exists under the namespace
  // aliases (React.X, preact.X, etc.) so agents can write bare OR
  // namespaced without thinking about it.
  const _Fragment = function Fragment(props){ return props && props.children; };
  Object.assign(window, {
    h, html, createElement: h, Fragment: _Fragment,
    LoxiaCard, LoxiaButton, LoxiaInput, LoxiaText, LoxiaMetric, LoxiaRow, LoxiaCol,
    useState, useEffect, useMemo, useCallback, useRef, useReducer,
  });
  Object.assign(h, { useState, useEffect, useMemo, useCallback, useRef, useReducer });

  // Namespace aliases. Agents are trained on online tutorials that use a
  // variety of names — htmPreact, preact, preactHooks, React, htm, etc.
  // Rather than fight the training data name-by-name (whack-a-mole),
  // we do two things:
  //
  //   1. Enumerate every plausible global name.
  //   2. Wrap the namespace object in a Proxy so accessing an unknown
  //      property (e.g. 'preact.useLayoutEffect' or 'React.Children')
  //      doesn't throw — it returns a clearly-named no-op we can point
  //      the agent at. Better to fail loudly with "useLayoutEffect is
  //      not implemented in this runtime" than with a cryptic undefined.
  //
  // If an identifier we didn't list comes up, add it to NS_NAMES and the
  // agent's next attempt will succeed. New additions are always O(1).
  const _nsBase = {
    h, html, render: window.loxia.render,
    useState, useEffect, useMemo, useCallback, useRef, useReducer,
    createElement: h,
    Fragment: function Fragment(props){ return props && props.children; },
    LoxiaCard, LoxiaButton, LoxiaInput, LoxiaText, LoxiaMetric, LoxiaRow, LoxiaCol,
  };
  // Self-reference so "import X from 'preact'" (X.default pattern) works.
  _nsBase.default = _nsBase;

  // Known-missing APIs. Return a stub (function OR class constructor)
  // that throws with a specific, actionable message instead of
  // undefined. The agent's next-turn feedback sees the API name
  // explicitly, so retry paths are direct — no guessing why
  // \`class X extends React.Component\` failed with "undefined is not a
  // constructor." This list is the SINGLE SOURCE OF TRUTH; the tool
  // description references it by name and tests assert alignment.
  //
  // Split into two groups:
  //   - _notImplementedClasses: used with \`new\` / \`extends\`; we return
  //     a class whose constructor throws with the specific name.
  //   - _notImplementedFns: everything else — a function that throws.
  const _notImplementedClasses = new Set([
    'Component', 'PureComponent',
  ]);
  const _notImplementedFns = new Set([
    // Hooks we do not implement
    'useLayoutEffect', 'useImperativeHandle', 'useContext',
    'useDeferredValue', 'useTransition', 'useId', 'useSyncExternalStore',
    'useErrorBoundary',
    // Non-hook APIs
    'createContext', 'createRef', 'forwardRef', 'memo',
    'lazy', 'Suspense', 'StrictMode', 'Children', 'cloneElement',
    'isValidElement',
  ]);
  function _makeNotImplementedFn(key) {
    return function notImplemented() {
      throw new Error(
        "'" + key + "' is not implemented in this widget runtime. " +
        'Supported hooks: useState, useEffect, useMemo, useCallback, useRef. ' +
        'Supported primitives: h, html, LoxiaCard, LoxiaButton, LoxiaInput, LoxiaText, LoxiaMetric, LoxiaRow, LoxiaCol. ' +
        'This runtime is function-components-only (no class components, no context, no suspense).'
      );
    };
  }
  function _makeNotImplementedClass(key) {
    // Returning a class (rather than a plain function) makes the message
    // land correctly whether the agent does \`new X()\` or \`class Y extends X\`.
    const C = function(){};
    C.prototype = {};
    // Subclass attempts: \`class Y extends Component { ... }\` will run our
    // constructor when \`super()\` is called from Y's constructor.
    C.prototype.constructor = function() {
      throw new Error(
        "'" + key + "' is not implemented in this widget runtime. " +
        'Class components are not supported — use a function component ' +
        'with useState/useEffect hooks instead.'
      );
    };
    // Also throw if used without new (e.g. \`Component()\` direct call).
    const asFn = function() {
      throw new Error("'" + key + "' is not implemented in this widget runtime (class components not supported — use function components with useState).");
    };
    asFn.prototype = C.prototype;
    return asFn;
  }
  const _ns = new Proxy(_nsBase, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key !== 'string') return undefined;
      if (_notImplementedClasses.has(key)) return _makeNotImplementedClass(key);
      if (_notImplementedFns.has(key))     return _makeNotImplementedFn(key);
      return undefined;
    },
  });

  // Expose as bare globals too — agents that write \`class X extends Component\`
  // without any namespace still hit the named error.
  for (const _className of _notImplementedClasses) {
    window[_className] = _makeNotImplementedClass(_className);
  }
  for (const _fnName of _notImplementedFns) {
    // Only set if not already defined (don't override anything legitimate).
    if (!(_fnName in window)) window[_fnName] = _makeNotImplementedFn(_fnName);
  }

  // Every known alias points at the SAME proxy, so agents can reach for
  // whichever name their training data surfaced and the destructure
  // pattern works uniformly: const { useState } = <any-of-these>.
  const NS_NAMES = [
    // htm + preact ecosystem
    'htmPreact', 'htm_preact', 'preactHtm', 'htm', 'Htm',
    'preact', 'Preact', 'preactjs',
    // hooks-specific package names
    'preactHooks', 'PreactHooks', 'preact_hooks',
    'hooks', 'Hooks',
    // React ecosystem (we aren't React but the surface matches closely)
    'React', 'react',
    'reactHooks', 'ReactHooks', 'react_hooks',
    // Signals / standalone bundles that sometimes appear
    'preactStandalone', 'preact_standalone',
  ];
  for (const _name of NS_NAMES) {
    window[_name] = _ns;
  }
  // ReactDOM gets a minimal render shim — React code often uses
  // ReactDOM.render(vnode, target) as a mount call. We map it into loxia.render.
  window.ReactDOM = {
    render: function(vnode, target) {
      window.loxia.render(function() { return vnode; }, {});
    },
    createRoot: function() {
      return {
        render: function(vnode) {
          window.loxia.render(function() { return vnode; }, {});
        },
        unmount: function() {},
      };
    },
  };
})();
`;

export default WIDGET_RUNTIME;
