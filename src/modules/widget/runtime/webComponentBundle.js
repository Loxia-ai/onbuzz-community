/**
 * Web-Component runtime bundle — STRING, served to every webcomponent-mode iframe.
 *
 * Strictly smaller and simpler than the JSX bundle. Why this path exists:
 * the JSX path keeps producing failures rooted in our custom runtime
 * (htm parser quirks, hooks call-order, namespace whack-a-mole). Custom
 * elements use only the platform — `class extends HTMLElement`,
 * `customElements.define`, `connectedCallback` — APIs every modern
 * browser ships and every LLM has thousands of training examples for.
 *
 * Ergonomic helper: `LoxiaElement` base class that absorbs the boilerplate
 * (state, render, auto-binding for `data-bind` and `data-emit`). Agents
 * who want raw `HTMLElement` can still use it; the runtime detects.
 *
 * The agent's code is expected to:
 *   1. Define a class (extends LoxiaElement OR HTMLElement)
 *   2. Call loxia.render(TheClass, initialProps)
 *
 * The runtime registers the class with a unique tag name, instantiates,
 * mounts to #root, and wires the postMessage bridge.
 */

export const WIDGET_WC_RUNTIME = `
/* ==== Loxia widget web-component runtime v1 ==== */
(function () {
  'use strict';

  let _rootInstance = null;
  let _tagCounter = 0;

  /* ---------- LoxiaElement base class ---------- */
  // Optional ergonomic base. Inherits from HTMLElement, adds:
  //   - this.state                     — instance object, init in constructor or as a class field
  //   - this.setState(updater)         — merges or replaces state, triggers re-render
  //   - this.template(state) → string  — override; returned HTML is set on innerHTML
  //   - this.emit(type, payload)       — sendEvent via postMessage to parent
  //   - data-bind="key" auto-binding   — input/change events update state[key]
  //   - data-emit="name" auto-binding  — clicks emit the named event
  //   - this.handleUpdate(props)       — called when agent sends widget.update; default is setState(props)
  //
  // For raw HTMLElement subclasses (no LoxiaElement), widget.update sets
  // attributes — agent's attributeChangedCallback handles re-render.
  class LoxiaElement extends HTMLElement {
    constructor() {
      super();
      // Attach a shadow root so:
      //   1. \`this.shadowRoot\` is non-null — agents trained on web
      //      components heavily expect it (was the #2 reported failure)
      //   2. CSS scopes don't bleed between widget and parent iframe
      //   3. Selectors like this.shadowRoot.querySelector work
      // CSS custom properties pierce shadow boundaries, so theme tokens
      // (--gray-500, --loxia-600) still apply inside the widget.
      try { this.attachShadow({ mode: 'open' }); }
      catch (_) { /* already attached or environment doesn\'t support */ }

      // Allow subclasses to declare \`state = { ... }\` as a class field.
      // \`super()\` runs before field initializers, so we can't depend on
      // them being set yet. Default to {} and merge later.
      if (this.state === undefined) this.state = {};
    }
    /** The render target — shadowRoot when available, otherwise the element itself. */
    get _root() { return this.shadowRoot || this; }
    setState(updater) {
      this.state = (typeof updater === 'function')
        ? updater(this.state)
        : Object.assign({}, this.state, updater);
      this.render();
    }
    connectedCallback() {
      this.render();
      try { if (this.onMount) this.onMount(); }
      catch (err) { if (window.__loxiaReportError) window.__loxiaReportError(err, 'mount'); }
    }
    disconnectedCallback() {
      try { if (this.onUnmount) this.onUnmount(); }
      catch (err) { if (window.__loxiaReportError) window.__loxiaReportError(err, 'unmount'); }
    }
    render() {
      let html = '';
      try {
        html = this.template ? this.template(this.state) : (this._root.innerHTML || '');
      } catch (err) {
        if (window.__loxiaReportError) window.__loxiaReportError(err, 'render');
        return;
      }
      this._root.innerHTML = html;
      // Normalize footgun shapes BEFORE wiring so the rewritten
      // attributes (data-bind-click → data-on-click, etc.) participate
      // in the standard binding pass and the buttons actually work.
      this._normalizeFootguns();
      this._wireBindings();
      // afterRender(root) — sanctioned hook for agents who need to attach
      // listeners that the auto-wiring doesn't cover (intersection
      // observer, complex pointer drag, focus-trap, ...). Called AFTER
      // every render — listeners attached here survive setState because
      // they're re-attached on the fresh DOM. Without this, agents who
      // call addEventListener in onMount() see their listeners die on
      // the first re-render (innerHTML wipe) — and there's no error.
      try { if (typeof this.afterRender === 'function') this.afterRender(this._root); }
      catch (err) { if (window.__loxiaReportError) window.__loxiaReportError(err, 'afterRender'); }
    }
    /**
     * Scan the freshly-rendered DOM for known typo shapes that LOOK like
     * they should wire something up but DON'T. Reports each as a render
     * error so agents see a clear message instead of "nothing happens".
     *
     * What's flagged:
     *   - data-bind-<anything>  (data-bind-click, data-bind-input, ...)
     *   - data-action, data-handler, data-click, data-onclick
     *   - inline on*= attributes (onclick, onchange, onkeydown, ...)
     *
     * Each pattern includes a "did you mean ...?" hint pointing at the
     * supported alternative. Reported once per attribute per render
     * (de-duped via the global error infrastructure's "seen" map).
     */
    /**
     * Scan the freshly-rendered DOM for known typo shapes that LOOK like
     * they should wire something up but don't. For each detected typo:
     *   1. Emit a non-fatal warning (so the agent learns the right shape)
     *   2. Rewrite the attribute IN PLACE to the canonical equivalent
     *      so the standard wiring pass picks it up — meaning the widget
     *      actually works on this render, not just "next time the agent
     *      ships a fix".
     *
     * Inline on*= attributes are warning-only — we can't safely transform
     * a JS expression like onclick="this.foo()" into a method-name binding
     * (we don't know the intent), so the agent has to fix those.
     */
    _normalizeFootguns() {
      const root = this._root;
      // Footgun detection is a LINT, not a fatal error. The widget itself
      // rendered fine; only specific click-handler bindings are dead. Route
      // through the warning channel so the user still sees the widget
      // (with a small "scripts have warnings" badge) instead of a red
      // "widget failed to load" screen replacing the whole thing.
      // Unified emit: warnings if the warning channel is available,
      // otherwise fall back to error reporting. Always passes a STRING
      // message — the warning channel takes a string; the error channel
      // accepts a string too via its toString() path.
      const emit = (msg) => {
        if (window.__loxiaReportWarning) {
          window.__loxiaReportWarning(msg, 'lint');
        } else if (window.__loxiaReportError) {
          window.__loxiaReportError(new Error(msg), 'lint');
        }
      };
      const FAKE_DATA_EXACT = {
        'data-action':  'data-on-click="methodName"',
        'data-handler': 'data-on-click="methodName"',
        'data-click':   'data-on-click="methodName"',
        'data-onclick': 'data-on-click="methodName"',
      };
      // Inline on*= attributes (onclick, onchange, ...) — these run in
      // the iframe's GLOBAL scope, not bound to the LoxiaElement, so
      // \`this.method()\` references silently miss the instance.
      const INLINE_ON_RE = /^on[a-z]+$/;

      // Rewrite an attribute on \`el\` from \`oldName\` to \`newName\`, keeping
      // the value, but only if \`newName\` isn't already there (don't
      // clobber a real binding the agent also wrote).
      const rename = (el, oldName, newName) => {
        const value = el.getAttribute(oldName);
        el.removeAttribute(oldName);
        if (!el.hasAttribute(newName)) el.setAttribute(newName, value);
      };

      root.querySelectorAll('*').forEach(function(el) {
        if (!el.attributes) return;
        // Iterate over a SNAPSHOT — we mutate attributes in this loop,
        // and the live NamedNodeMap shifts indices when we removeAttribute.
        const snapshot = [];
        for (let i = 0; i < el.attributes.length; i++) {
          snapshot.push(el.attributes[i].name);
        }
        for (const name of snapshot) {
          if (!name) continue;

          // 1. data-bind-<x>  →  data-on-<x>   (autofix)
          if (name !== 'data-bind' && name.indexOf('data-bind-') === 0) {
            const evt = name.slice('data-bind-'.length) || 'click';
            const target = 'data-on-' + evt;
            emit(
              'Attribute "' + name + '" is NOT auto-wired — auto-rewrote to "' +
              target + '". Update your template to use ' + target +
              '="methodName" so this warning goes away. ' +
              '(data-bind is for input→state binding; for event→method use data-on-<event>.)'
            );
            rename(el, name, target);
            continue;
          }

          // 2. data-on:<x>  →  data-on-<x>   (autofix)
          if (name.indexOf('data-on:') === 0) {
            const evt = name.slice('data-on:'.length) || 'click';
            const target = 'data-on-' + evt;
            emit(
              'Attribute "' + name + '" uses ":" but the runtime expects "-" — ' +
              'auto-rewrote to "' + target + '". Update your template.'
            );
            rename(el, name, target);
            continue;
          }

          // 3. data-action / data-handler / data-click / data-onclick
          //    →  data-on-click   (autofix)
          if (FAKE_DATA_EXACT[name]) {
            emit(
              'Attribute "' + name + '" is NOT auto-wired — auto-rewrote to "data-on-click". ' +
              'Update your template to use ' + FAKE_DATA_EXACT[name] + '.'
            );
            rename(el, name, 'data-on-click');
            continue;
          }

          // 4. Inline on*= attributes — WARNING ONLY. We can't safely
          //    transform a JS expression like onclick="this.foo()" into
          //    a method-name binding (we don't know the agent's intent).
          //    The agent has to ship a fixed template. The widget still
          //    renders fine; only this specific handler is dead.
          if (INLINE_ON_RE.test(name)) {
            const evt = name.slice(2);
            emit(
              'Inline attribute "' + name + '" runs in the iframe global scope ' +
              '— "this" inside it is the element, not your LoxiaElement instance, ' +
              'so "this.method()" silently fails. Use data-on-' + evt +
              '="methodName" instead. (Cannot auto-rewrite — the value is a JS ' +
              'expression, not a method name.)'
            );
            continue;
          }

          // 5. data-on / data-on- with no event name — agent forgot the
          //    suffix. Can't autofix (we don't know which event).
          if (name === 'data-on-' || name === 'data-on') {
            emit(
              'Attribute "' + name + '" is missing the event name. ' +
              'Use data-on-click="methodName", data-on-input="methodName", etc.'
            );
          }
        }
      });
    }
    _wireBindings() {
      const self = this;
      // data-bind="key" — input/change/textContent updates state[key].
      // Query against shadowRoot if present (where the agent\'s template
      // was actually rendered) so bindings work in both shadow + light DOM.
      this._root.querySelectorAll('[data-bind]').forEach(function(el) {
        const key = el.dataset.bind;
        const handler = function(e) {
          const t = e.target;
          let value;
          if (t.type === 'checkbox') value = t.checked;
          else if (t.type === 'number' || t.type === 'range') value = t.value === '' ? '' : Number(t.value);
          else value = t.value;
          self.setState(Object.assign({}, self.state, { [key]: value }));
        };
        el.oninput = handler;
        el.onchange = handler;
      });
      // data-emit="name" — click sends an event to the agent.
      this._root.querySelectorAll('[data-emit]').forEach(function(el) {
        el.onclick = function(e) {
          // Optional data-payload="{...}" for custom payloads.
          let extra = {};
          try { if (el.dataset.payload) extra = JSON.parse(el.dataset.payload); } catch (_) {}
          self.emit(el.dataset.emit, Object.assign({ state: self.state }, extra));
        };
      });
      // data-on-<event>="methodName" — call a LOCAL instance method when
      // the named DOM event fires on the element. \`this\` inside the
      // method is bound to the LoxiaElement instance; the DOM event is
      // passed as the first argument.
      //
      // GENERIC: any \`data-on-<anything>\` attribute is wired via
      // addEventListener — browser-supported event names just work.
      // Confirmed to fire for the obvious set (click, input, change,
      // submit, focus, blur, keydown, keyup, mouseenter, mouseleave,
      // mouseover, mouseout, mousedown, mouseup, mousemove, dblclick,
      // contextmenu, wheel, pointerdown, pointerup, pointermove,
      // pointerenter, pointerleave, touchstart, touchend, touchmove,
      // dragstart, drag, dragend, dragenter, dragleave, dragover, drop,
      // copy, cut, paste, scroll, transitionend, animationend, ...).
      //
      // Why generic rather than an allowlist: agents shouldn't have to
      // guess "is keypress wired? what about pointerdown?" — anything
      // addEventListener accepts works. addEventListener silently
      // ignores nonexistent event names, so typos in the EVENT name
      // can't blow up the page; typos in the METHOD name (the more
      // common mistake) are caught explicitly below.
      self._root.querySelectorAll('*').forEach(function(el) {
        if (!el.attributes) return;
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          if (!attr.name || attr.name.indexOf('data-on-') !== 0) continue;
          const eventName = attr.name.slice('data-on-'.length);
          if (!eventName) continue;
          const methodName = attr.value;
          const fn = self[methodName];
          if (typeof fn !== 'function') {
            // Surface the typo loudly so agents stop guessing attribute
            // names. Without this, mistakes like data-bind-click silently
            // do nothing — looks like a broken widget with no error.
            //
            // Routed through the WARNING channel: the rest of the widget
            // mounted fine and we don't want to replace it with a red
            // error screen because of one missing handler.
            const warn = window.__loxiaReportWarning || window.__loxiaReportError;
            if (warn) {
              warn(
                'data-on-' + eventName + '="' + methodName + '" but the class has no method named "' + methodName + '". Define it on your LoxiaElement subclass, or check the attribute spelling.',
                'lint'
              );
            }
            continue;
          }
          el.addEventListener(eventName, function(e) {
            try { fn.call(self, e); }
            catch (err) {
              if (window.__loxiaReportError) window.__loxiaReportError(err, 'event-handler');
            }
          });
        }
      });
    }
    emit(type, payload) {
      try {
        window.parent.postMessage({
          __loxia: true, type: 'event', widgetId: window.__loxiaWidgetId,
          payload: Object.assign({ type: type }, payload || {})
        }, '*');
      } catch (_) {}
    }
    handleUpdate(newProps) {
      // Default: merge into state. Subclasses can override for custom logic.
      this.setState(newProps);
    }
  }

  /* ---------- auto-resize ---------- */
  let _heightDebounce = null;
  function scheduleHeight() {
    if (_heightDebounce) clearTimeout(_heightDebounce);
    _heightDebounce = setTimeout(function () {
      try {
        window.parent.postMessage({
          __loxia: true, type: 'resize', widgetId: window.__loxiaWidgetId,
          height: Math.ceil(document.body.scrollHeight)
        }, '*');
      } catch (_) {}
    }, 50);
  }
  if (typeof ResizeObserver !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      const ro = new ResizeObserver(scheduleHeight);
      ro.observe(document.body);
    });
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(scheduleHeight, 50); });
  }

  /* ---------- prop updates from agent → instance ---------- */
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.__loxia !== true) return;
    if (e.source !== window.parent) return;
    if (e.data.type === 'update' && e.data.props && _rootInstance) {
      try {
        if (typeof _rootInstance.handleUpdate === 'function') {
          _rootInstance.handleUpdate(e.data.props);
        } else if (typeof _rootInstance.setState === 'function') {
          _rootInstance.setState(e.data.props);
        } else {
          // Plain HTMLElement — set attributes and let attributeChangedCallback fire.
          for (const k in e.data.props) {
            if (Object.prototype.hasOwnProperty.call(e.data.props, k)) {
              _rootInstance.setAttribute(k, String(e.data.props[k]));
            }
          }
        }
      } catch (err) {
        if (window.__loxiaReportError) window.__loxiaReportError(err, 'update');
      }
    }
  });

  /* ---------- public API ---------- */
  window.LoxiaElement = LoxiaElement;
  window.loxia = window.loxia || {};

  function uniqueTagName() {
    return 'loxia-w-' + (++_tagCounter) + '-' + Math.random().toString(36).slice(2, 8);
  }

  Object.assign(window.loxia, {
    LoxiaElement: LoxiaElement,
    /**
     * Register the class (with a fresh unique tag), create one instance,
     * and mount it into #root. Agent calls this LAST. Don't call
     * customElements.define yourself — this handles registration.
     */
    render: function (ElementClass, initialProps) {
      if (typeof ElementClass !== 'function') {
        throw new Error(
          'loxia.render expects a class (extends LoxiaElement or HTMLElement). ' +
          'Got: ' + typeof ElementClass + '. ' +
          'Define your class then call loxia.render(YourClass, initialProps).'
        );
      }
      // Pre-flight: prototype-chain check. customElements.define is
      // permissive in some implementations and accepts classes that
      // aren't HTMLElement subclasses (jsdom). Catching it ourselves
      // means the agent sees a NAMED, actionable error.
      if (!(ElementClass.prototype instanceof HTMLElement) && ElementClass.prototype !== HTMLElement.prototype) {
        throw new Error(
          'loxia.render expects a class that extends HTMLElement (or LoxiaElement, which is an HTMLElement subclass). ' +
          'Your class does NOT. Rewrite as: class YourWidget extends LoxiaElement { template(state) { ... } }.'
        );
      }
      const tagName = uniqueTagName();
      try {
        customElements.define(tagName, ElementClass);
      } catch (err) {
        throw new Error(
          'customElements.define failed: ' + err.message + '. ' +
          'If your class already calls customElements.define(...) itself, remove that line — loxia.render handles registration.'
        );
      }
      const instance = document.createElement(tagName);
      // Seed initial state. For LoxiaElement: use setState (or assign so
      // connectedCallback's render uses the seed). For raw HTMLElement:
      // set as attributes (the standard web-component idiom).
      const props = initialProps || {};
      if (instance instanceof LoxiaElement) {
        // Assign before connectedCallback fires so first render sees the seed.
        instance.state = Object.assign({}, instance.state || {}, props);
      } else {
        for (const k in props) {
          if (Object.prototype.hasOwnProperty.call(props, k)) {
            instance.setAttribute(k, String(props[k]));
          }
        }
      }
      const root = document.getElementById('root') || document.body;
      root.innerHTML = '';
      root.appendChild(instance);
      _rootInstance = instance;
      return instance;
    },
    sendEvent: function (evt) {
      try {
        window.parent.postMessage({
          __loxia: true, type: 'event', widgetId: window.__loxiaWidgetId, payload: evt
        }, '*');
      } catch (_) {}
    },
    requestHeight: function (px) {
      try {
        window.parent.postMessage({
          __loxia: true, type: 'resize', widgetId: window.__loxiaWidgetId, height: px
        }, '*');
      } catch (_) {}
    },
    // onUpdate is intentionally NOT mirrored from the JSX runtime —
    // in webcomponent mode, the instance's handleUpdate(props) method
    // is the right hook (instance has its own setState, etc.).
  });
})();
`;

export default WIDGET_WC_RUNTIME;
