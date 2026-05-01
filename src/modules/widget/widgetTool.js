/**
 * WidgetTool — agent-facing tool for rendering custom UI widgets inline
 * in the chat stream. Two modes:
 *
 *   kind: 'html'  — static HTML+CSS, rendered in an iframe with sandbox=""
 *                   (no scripts, no forms, no same-origin). Safe for
 *                   visualisations, decorated callouts, infographics.
 *
 *   kind: 'jsx'   — Preact+htm render code, rendered in an iframe with
 *                   sandbox="allow-scripts" (scripts only, no same-origin).
 *                   Can round-trip user interactions back to the agent
 *                   via the loxia.sendEvent() SDK baked into the runtime.
 *
 * Agents invoke:
 *   { toolId: 'widget', action: 'render',  kind, content, widgetId?, props? }
 *   { toolId: 'widget', action: 'update',  widgetId, props }
 *   { toolId: 'widget', action: 'destroy', widgetId }
 *   { toolId: 'widget', action: 'list' }
 *
 * Results come back as a tool-result the frontend WidgetRenderer picks up
 * and hands to <IframeWidget>. Agent-visible output intentionally does
 * NOT echo the full content — the content lives in the message feed once,
 * inside the iframe's srcdoc.
 *
 * State lives on the tool instance (Map<agentId, Map<widgetId, widget>>).
 * LRU-evicted per-agent beyond MAX_WIDGETS_PER_AGENT so a runaway agent
 * can't OOM the process.
 */

import { EventEmitter } from 'events';
import { BaseTool } from '../../tools/baseTool.js';
import {
  validateRenderParams,
  validateUpdateParams,
  validateDestroyParams,
  validateListVersionsParams,
  validateGetVersionParams,
  validateSetMainParams,
  validateRenameParams,
  normalizeName,
  WIDGET_LIMITS,
} from './schema.js';
import { scanForPhishingKeywords } from './phishingScanner.js';
import { GalleryStore } from './galleryStore.js';
import { analyzeWidgetCode } from './codeAnalyzer.js';

/**
 * Generate an opaque, sortable version id. Sortability isn't relied on
 * for ordering (the versions array is chronological by insertion) but
 * helps with audit logs and debugging.
 */
function generateVersionId() {
  return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Build a version record from a render payload. Each version captures
 * everything needed to re-mount the widget at that version: kind,
 * content, initial props, the phishing-scan result at write time, and
 * size in UTF-8 bytes.
 */
function buildVersion({ kind, content, props }) {
  return {
    versionId:    generateVersionId(),
    kind,
    content,
    props:        props || {},
    phishingHits: scanForPhishingKeywords(content),
    size:         Buffer.byteLength(content, 'utf8'),
    createdAt:    new Date().toISOString(),
  };
}

/**
 * Mirror the active version's content/kind/props/etc. onto the widget
 * record's top-level fields. This keeps every existing consumer
 * (frontend WidgetRenderer, /api/widget/audit, list action, tests)
 * working without changes — they read `.content` / `.kind` / `.props`
 * and they get the active (main) version's values.
 *
 * Mutates `widget` in place and returns it for chaining.
 */
function mirrorActiveVersion(widget) {
  const main = widget.versions.find(v => v.versionId === widget.mainVersionId)
            || widget.versions[widget.versions.length - 1];
  widget.kind         = main.kind;
  widget.content      = main.content;
  widget.props        = main.props;
  widget.phishingHits = main.phishingHits;
  widget.size         = main.size;
  widget.updatedAt    = main.createdAt; // "active version's effective-since time"
  // Latest-rendered timestamp lives separately so audit/UI can show
  // "last rendered" even if the user pinned an older version as main.
  widget.lastRenderedAt = widget.versions[widget.versions.length - 1].createdAt;
  return widget;
}

export class WidgetTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);
    this.id = 'widget';

    // Map<agentId, Map<widgetId, widget>> — widgets are per-agent so
    // listings don't leak across the tenancy boundary.
    this._widgetsByAgent = new Map();
    // Monotonic counter for auto-generated ids (user-friendly + unique).
    this._nextAutoId = 1;

    // Gallery (cross-session shared widget catalog). Lazy — created on
    // first share/list-gallery/render-from-gallery call. Tests/route
    // handlers can replace this with a custom-filePath instance via
    // `setGalleryStore(...)` so they don't touch the user's real file.
    this._gallery = null;

    // Event bus for widget-state mutations. The web server bridges this
    // to a WebSocket `widget_changed` message so the frontend artifacts
    // panel stays in sync without depending on the chat feed (which is
    // lazy-loaded — older messages may not be mounted, so feed-only
    // observation misses widgets that exist on the backend).
    //
    // Emitted event:
    //   'widget-changed' { agentId, widgetId, changeType, summary, templateId? }
    //
    // changeType ∈ 'rendered' | 'updated' | 'destroyed' | 'main-set'
    //              | 'shared' | 'unshared' | 'upgrade-applied'
    //
    // For 'destroyed', `summary` is null and `widgetId` is the removed id.
    this.events = new EventEmitter();
    // Don't crash the process if the bus has no listener attached yet
    // (e.g. tests, or the web server is starting up).
    this.events.setMaxListeners(50);
  }

  /**
   * Build the summary shape consumed by the artifacts panel and the
   * `widget_changed` WS push. Matches the per-row shape returned by
   * `_list(agentId)` so the frontend can use a single code path.
   * @private
   */
  _buildSummary(widget) {
    if (!widget) return null;
    return {
      widgetId:        widget.widgetId,
      name:            widget.name || null,
      kind:            widget.kind,
      createdAt:       widget.createdAt,
      updatedAt:       widget.updatedAt,
      lastRenderedAt:  widget.lastRenderedAt,
      size:            widget.size,
      phishingHits:    widget.phishingHits,
      versionCount:    widget.versions ? widget.versions.length : 0,
      mainVersionId:   widget.mainVersionId,
      linkedGalleryTemplateId: widget.linkedGalleryTemplateId || null,
      linkedGalleryVersion:    widget.linkedGalleryVersion || null,
      divergedFromGallery:     !!widget.divergedFromGallery,
    };
  }

  /**
   * Emit a widget-changed event. Wrapped in a try/catch so a buggy
   * listener can never break the tool call itself — the widget mutation
   * has already happened by the time we emit.
   * @private
   */
  _emitChange(agentId, widgetId, changeType, widget, extra = {}) {
    try {
      this.events.emit('widget-changed', {
        agentId,
        widgetId,
        changeType,
        summary: widget ? this._buildSummary(widget) : null,
        ...extra,
      });
    } catch (err) {
      this.logger?.warn?.('widget-changed listener threw', { error: err?.message });
    }
  }

  /** Allow tests / routes / app boot to inject a configured GalleryStore. */
  setGalleryStore(store) { this._gallery = store; }

  /**
   * Lazy-init helper. Returns a GalleryStore — defaults to ~/.loxia/widget-gallery.json.
   * @private
   */
  _galleryStore() {
    if (!this._gallery) this._gallery = new GalleryStore({ logger: this.logger });
    return this._gallery;
  }

  getDescription() {
    return `
Widget Tool: Render custom UI widgets inline in the message stream.

USAGE:
\`\`\`json
{ "toolId": "widget", "action": "render", "kind": "html", "content": "<div>...</div>" }
\`\`\`

ACTIONS:
- render             — mount or replace a widget. kind: 'html' (static) or 'jsx' (interactive)
- update             — replace props on an existing widget (jsx only; triggers re-render)
- destroy            — remove a widget from the stream
- list               — return { widgetId, kind, createdAt, size } for all widgets this agent owns
- list-capabilities  — return a structured report of every global, hook, primitive,
                        namespace alias, and "not implemented" API with rewrite paths.
                        Call this any time you're unsure what's available, or after
                        a WIDGET RENDER ERROR mentions an undefined identifier.

KINDS:
- **html**: static HTML+CSS. Script tags, inline handlers, and <form> submissions
  are blocked by the sandbox. Images allowed from 'data:' and 'blob:' URIs only.
  Use this for visualisations, decorated callouts, and anything that doesn't
  need interactivity.

- **webcomponent** (RECOMMENDED for interactive widgets): you write a class
  that extends LoxiaElement (an HTMLElement subclass), then call
  loxia.render(YourClass, initialProps). Standard web platform — no JSX,
  no hooks, no namespace imports. The agent surface is just:
    class MyWidget extends LoxiaElement {
      state = { count: 0 };
      template(state) {
        return \`
          <div>
            <span>Count: \${state.count}</span>
            <button data-bind-click="increment">+1</button>
            <input data-bind="name" value="\${state.name || ''}" placeholder="Name" />
          </div>
        \`;
      }
      increment() { this.setState({ count: this.state.count + 1 }); }
    }
    loxia.render(MyWidget, window.__loxiaInitialProps);

  EVENT WIRING — THE PRIMARY PATTERN:

    Use addEventListener inside this.afterRender(root). This is web-standard,
    typo-proof, gives full Event API access (AbortSignal, { once, capture,
    passive }, custom events, event delegation), and works for events
    data-on-<event> can't express. afterRender(root) runs after EVERY render
    (including post-setState), so listeners attached there survive state
    updates — innerHTML is rewritten on each render, but the hook re-attaches
    your listeners on the fresh DOM each time.

    Example:
      class MyWidget extends LoxiaElement {
        state = { count: 0 };
        increment() { this.setState({ count: this.state.count + 1 }); }
        afterRender(root) {
          root.querySelector('#bumpBtn').addEventListener('click', () => this.increment());
          root.querySelector('#nameInput').addEventListener('input', (e) => {
            this.setState({ name: e.target.value });
          });
        }
        template(state) {
          return \`<div>
            <span>Count: \${state.count}</span>
            <button id="bumpBtn">+1</button>
            <input id="nameInput" placeholder="Name" />
          </div>\`;
        }
      }
      loxia.render(MyWidget, window.__loxiaInitialProps);

    Why afterRender and NOT onMount: onMount fires once on first connection.
    setState rewrites innerHTML, which destroys all DOM listeners attached
    in onMount. They silently stop firing on the first re-render. afterRender
    is the only correct place to attach listeners that need to survive state.

  AUTO-WIRING SHORTCUTS (optional ergonomics, only for the simple cases):

    data-bind="key"             → input/change events update state[key] automatically.
                                   Useful for two-way binding text/number inputs.
    data-on-<event>="methodName" → fires any DOM event → calls this.methodName(e).
                                   Concise alternative to addEventListener for
                                   trivial cases. Works for any browser event name
                                   (click, input, keydown, pointerdown, dblclick,
                                   wheel, transitionend, …).
                                   \`this\` inside the handler is the LoxiaElement.

  DO NOT USE for local interactivity:

    ✗ data-emit="name"
        Sends a postMessage to the AGENT — does NOT call your method on click.
        The button click will appear to do nothing locally; the agent receives
        an event on its NEXT TURN. Use ONLY when you specifically want to
        notify the agent (e.g. "user clicked submit, fetch fresh data").
        For a click that should run a local method, use addEventListener
        in afterRender or data-on-click="methodName".

    ✗ Inline onclick="this.foo()" / onchange="…"
        Runs in iframe global scope; \`this\` is the element, not your class.

    ✗ data-bind-click / data-action / data-handler / data-onclick / data-on:click
        Not recognized. The runtime now auto-rewrites these to data-on-<event>
        AND surfaces a warning, but it's better to write data-on-click directly.

    ✗ addEventListener in onMount()
        Dies on the first setState because innerHTML is rewritten. Use afterRender.

  SHADOW DOM:
  LoxiaElement attaches a shadow root in its constructor, so this.shadowRoot
  is always available. template()'s output is written to shadowRoot.innerHTML.
  CSS scoped to your widget (in the template's <style>) does NOT leak out;
  CSS custom properties (--gray-500, --loxia-600) DO pierce in. Use
  this.shadowRoot.querySelector / addEventListener for direct DOM access.

  CRITICAL — HOW TO MOUNT (the #1 failure mode):
  ALWAYS end your code with:
      loxia.render(YourClass, window.__loxiaInitialProps);

  Do NOT do any of these — they will produce a "Your widget did not mount" error:
      ✗ customElements.define('your-tag', YourClass);  // by itself
      ✗ document.body.appendChild(document.createElement('your-tag'));
      ✗ new YourClass();   // without appending
      ✗ class YourClass { ... }  // forgetting the loxia.render call entirely

  loxia.render handles registration, instantiation, and mounting in one call.

  PROP UPDATES from agent:
    When you call widget.update with new props, the iframe receives them
    and the base class's handleUpdate(props) is called (default: setState).
    Override handleUpdate() if you want custom merge logic.

  ESCAPE HATCH: extend HTMLElement directly if you want raw DOM control.
  loxia.render still mounts you and bridges events to the agent.

- **jsx**: interactive mini-Preact widget rendered in a null-origin
  sandbox iframe. This is NOT React, NOT Preact, NOT a Node environment.
  Read the GLOBALS list below BEFORE writing code — every identifier you
  reference must appear there or it will ReferenceError at runtime.

  ═══════════════════════════════════════════════════════════════════
  THE COMPLETE LIST OF GLOBALS AVAILABLE INSIDE YOUR WIDGET
  ═══════════════════════════════════════════════════════════════════
  All available as bare identifiers, as properties on \`h\`, and on
  \`loxia\` — pick whichever you like:

    h(type, props, ...children)   — hyperscript (VDOM node constructor)
    html\`…\`                       — htm tagged-template, compiles to h()
    LoxiaCard, LoxiaButton, LoxiaInput, LoxiaText,
    LoxiaMetric, LoxiaRow, LoxiaCol  — component primitives

  Hooks — these DO work, scoped to the ROOT component:

    useState(initial)             → [value, setValue]
    useEffect(fn, deps)           → runs fn after render when deps change;
                                    fn may return a cleanup function
    useMemo(compute, deps)        → cached value
    useCallback(fn, deps)         → cached function reference
    useRef(initial)               → { current } — stable across renders
    useReducer(reducer, init[, i])→ [state, dispatch] — implemented as
                                    a useState wrapper

  loxia-only APIs:

    loxia.render(Component, props)      — mount; call this last
    loxia.sendEvent({ type, payload })  — send event up to the agent
    loxia.onUpdate(fn)                  — subscribe to prop updates
    loxia.requestHeight(px)             — manual height override

  Browser APIs (standard in every iframe):

    document, window, console, setTimeout, setInterval, clearTimeout,
    clearInterval, Promise, JSON, Math, Date, Array, Object, String,
    Number, Boolean, Map, Set, Symbol, Error

  ═══════════════════════════════════════════════════════════════════
  NOT AVAILABLE
  ═══════════════════════════════════════════════════════════════════

  HARD ERRORS (ReferenceError — environment doesn't provide them):
    ✗ JSX angle-bracket syntax (bare <div>...)  → use html\`<div>...\`
    ✗ import, require, export                    → iframe is null-origin, no modules
    ✗ fetch, XMLHttpRequest, WebSocket           → CSP blocks all network
    ✗ localStorage, sessionStorage, cookies      → null origin, no storage
    ✗ indexedDB                                  → null origin
    ✗ Any npm package (lodash, d3, chart.js, ...) → none are loaded
    ✗ process, global, Buffer                    → this is a browser, not Node
    ✗ Hooks in NESTED components                 → hooks are call-order-keyed
        on the ROOT component. Lift nested state up.

  NAMED "NOT IMPLEMENTED" ERRORS (APIs that LOOK available via namespaces
  but throw with a specific message so you know exactly what to change):

    Class components — "X is not implemented … use a function component":
      ✗ Component, PureComponent
      ✗ \`class App extends React.Component { ... }\`  → rewrite as
         a function component with useState.

    React/Preact APIs beyond the 6 supported hooks:
      ✗ useContext, useLayoutEffect, useImperativeHandle,
        useDeferredValue, useTransition, useId, useSyncExternalStore,
        useErrorBoundary
      ✗ createContext, createRef, forwardRef, memo, lazy, Suspense,
        StrictMode, Children, cloneElement, isValidElement

    When you hit these, the error message names the API and lists
    supported alternatives. Example rewrites:
      - useContext(Context)         → prop-drill or move state to agent
      - useLayoutEffect(fn, deps)   → useEffect(fn, deps) is close enough
      - Component class             → function App() { ... useState ... }

    For a PROGRAMMATIC list (with rewrite paths for each), call
    { "toolId": "widget", "action": "list-capabilities" }.

  NAMES THAT ARE AVAILABLE but don't contain what you think:
    - React / ReactDOM / preact / htmPreact / preactHooks / htm — ALL
      alias to the same widget-runtime bundle. They have useState,
      useEffect, useMemo, useCallback, useRef, h, html, createElement,
      Fragment. They do NOT have Component, forwardRef, Suspense, etc.
      (see NOT IMPLEMENTED above).

  ═══════════════════════════════════════════════════════════════════
  TEMPLATE ATTRIBUTE SYNTAX — GOTCHAS
  ═══════════════════════════════════════════════════════════════════

  Inside html\`...\` templates, interpolation uses \${expr}. Attributes
  with non-string values (objects, functions) need the \${...} wrapper.

  INLINE STYLE AS AN OBJECT — the common mistake:

    ✗  <div style="{ color: 'red' }">             ← wrong: string literal,
                                                    div has no real styling
    ✗  <div style="\${styleObj}">                 ← wrong: coerced to string
    ✓  <div style=\${{ color: 'red' }}>           ← correct: object interp
    ✓  <div style=\${styleObj}>                   ← correct: object variable

  The outer \${...} is the template interpolation; the inner {...} is the
  JS object literal. When an agent uses style="\${expr}" (with the quotes
  closing INSIDE the interpolation), the runtime treats the whole thing
  as a string and your styling gets silently ignored.

  SAME RULE for event handlers and any non-string attribute:

    ✓  <button onClick=\${fn}>                    ← unquoted interpolation
    ✓  <input value=\${s}>
    ✗  <button onClick="\${fn}">                  ← string "function..."
    ✗  <input value="\${s}">                      ← stringified

  Quoted interpolations are only right for STRING attributes:

    ✓  <div class=\${cls}>   or   class="\${cls}"  ← both OK (both strings)
    ✓  <a href=\${url}>                            ← url is a string anyway

  ═══════════════════════════════════════════════════════════════════
  STATE MODEL
  ═══════════════════════════════════════════════════════════════════

  Two patterns — pick based on who needs the state.

  (A) LOCAL STATE (useState): keep it in the widget. Good for form
      inputs, hover effects, expand/collapse, etc. — anything the
      agent doesn't need to reason about.

  (B) AGENT-OWNED STATE (sendEvent + widget.update): the widget is a
      view, the agent is the state machine. Good for state the agent
      should track or persist (final decisions, completed selections).

  Combine both freely: keep typing/dragging state local with useState,
  and sendEvent only on submit/commit.

  ═══════════════════════════════════════════════════════════════════
  MINIMAL WORKING EXAMPLES
  ═══════════════════════════════════════════════════════════════════

  Pattern A — local counter with useState:

    return function App() {
      const [count, setCount] = useState(0);
      return html\`
        <div style=\${{ padding: 16 }}>
          <div>Count: \${count}</div>
          <button onClick=\${() => setCount(count + 1)}>+1</button>
        </div>
      \`;
    };

  Pattern B — agent-owned counter:

    return function App({ count = 0 }) {
      return html\`
        <div>
          <div>Count: \${count}</div>
          <button onClick=\${() => loxia.sendEvent({ type: 'increment' })}>
            +1
          </button>
        </div>
      \`;
    };
    // Agent handles the 'increment' event and calls widget.update({ count: count + 1 }).

  PREFERRED: bare identifiers. They always work, no namespace juggling:
    // just use them directly, no destructure, no import:
    const [n, setN] = useState(0);
    useEffect(() => { ... }, []);

  Namespace destructure patterns (all equivalent, all work):
    const { useState, useEffect } = h;
    const { useState, useEffect } = htmPreact;
    const { useState, useEffect } = preact;
    const { useState, useEffect } = preactHooks;
    const { useState, useEffect } = React;
    const { useState, useEffect } = hooks;

  The following global names ALL point at the same hooks bundle so you
  can reach for whichever name you remember — the widget runtime aliases
  them aggressively:

    htmPreact, htm_preact, preactHtm, htm, Htm,
    preact, Preact, preactjs,
    preactHooks, PreactHooks, preact_hooks, hooks, Hooks,
    React, react, reactHooks, ReactHooks, react_hooks,
    preactStandalone, preact_standalone,
    ReactDOM.render(vnode, target), ReactDOM.createRoot(x).render(vnode)

  If you reach for a name not in that list, add a fallback:
    const useState = (globalThis.useState || h.useState);

  NOT IMPLEMENTED (will throw a specific "X is not implemented" error
  you'll see in the next-turn feedback — then switch to the supported
  APIs): useLayoutEffect, useImperativeHandle, useContext, useReducer,
  useDeferredValue, useTransition, useId, useSyncExternalStore,
  createContext, createRef, forwardRef, memo, lazy, Suspense, StrictMode,
  Children, cloneElement, isValidElement.

  ═══════════════════════════════════════════════════════════════════
  FEEDBACK LOOP
  ═══════════════════════════════════════════════════════════════════

  When the iframe throws (undefined identifier, bad syntax, handler
  error), a tool result arrives on your NEXT turn shaped like a normal
  failure:

    [widget] {
      "toolId": "widget",
      "status": "failed",
      "result": {
        "success": false,
        "action": "render",
        "widgetId": "<id>",
        "error": "WIDGET RENDER ERROR — widget \"<id>\" failed during \"<phase>\": <message>. Your widget code did not execute; fix the error and call widget.render again.",
        "phase": "render" | "runtime" | "async" | "runtime-setup",
        "message": "<short cause>",
        "stack": "<stack or (no stack)>"
      }
    }

  IMPORTANT: the tool CALL returning { success: true } only means the
  backend STORED your widget — it does NOT mean it rendered. If the
  next turn shows a widget tool-result with status:"failed" or the
  error string "WIDGET RENDER ERROR", your widget is broken. FIX the
  specific error from result.message (not guess a different cause) and
  re-issue widget.render.

  Repeated identical errors are suppressed to protect your context —
  you get at most 5 distinct errors per widget. If you keep hitting
  the same cause, re-read GLOBALS AVAILABLE above before trying again.

  Common first-try mistakes that produce __widgetError:
    - Using hooks (useState, useEffect, useMemo, useRef) → ReferenceError
    - Importing / requiring packages → ReferenceError: require not defined
    - Calling fetch / XMLHttpRequest → blocked by CSP
    - Writing bare JSX angle-bracket syntax → parse error
    - Assuming React / ReactDOM / preact are globals → ReferenceError

PARAMETERS:
- kind     (required): 'html' | 'jsx'
- content  (required): the payload. HTML string for 'html'; JS render function body for 'jsx'
- widgetId (optional): stable id so you can update/destroy later. Auto-generated if omitted.
- props    (optional): initial props for jsx widgets; merged on render and update.

LIMITS:
- Max ${WIDGET_LIMITS.MAX_CONTENT_BYTES / 1024} KB per widget payload
- Max ${WIDGET_LIMITS.MAX_WIDGETS_PER_AGENT} concurrent widgets per agent (oldest evicted)

SAFETY:
- Widgets run in a sandboxed iframe with null origin. They cannot read your
  cookies, make network requests, or touch the parent page.
- If your content includes credential-shaped prompts ("password", "login",
  "credit card" etc.), the user will see a stronger confirmation modal
  before rendering. That is normal and expected — phishing-shape detection
  protects users; it does not indicate a bug in your widget.
- The user may disable custom widgets entirely per-agent via the widget
  configurator. When disabled, render calls return { disabled: true }
  and the widget is not shown.`;
  }

  getSupportedActions() {
    return [
      'render', 'update', 'destroy', 'list', 'list-capabilities',
      // Versioning — each render appends a new version. Agent (and
      // user) can promote a version as main or fetch any version's content.
      'list-versions', 'get-version', 'set-main',
      // Naming — set/clear a human-friendly display name (cosmetic;
      // widgetId remains the stable identifier).
      'rename',
      // Gallery — cross-session catalog of shared widget templates.
      'share-to-gallery', 'unshare-from-gallery',
      'list-gallery', 'render-from-gallery',
      // Upgrade-awareness for gallery-linked widgets.
      'check-upgrade', 'apply-upgrade',
    ];
  }

  async execute(params, context = {}) {
    if (!params || typeof params !== 'object') {
      return { success: false, error: 'params must be an object' };
    }
    const action = params.action || 'render';
    const agentId = context?.agentId || 'unknown';

    // Per-agent kill switch via toolConfig. When the agent has not been
    // granted custom-widget permission, calls short-circuit with a
    // helpful message so the agent knows not to retry.
    const effectiveConfig = this.getEffectiveConfig(context, { allowCustomCode: false });
    const allowed = effectiveConfig.allowCustomCode !== false; // default allowed when unspecified

    switch (action) {
      case 'render':                return this._render(agentId, params, { allowed, context });
      case 'update':                return this._update(agentId, params, { allowed });
      case 'destroy':               return this._destroy(agentId, params);
      case 'list':                  return this._list(agentId);
      case 'list-capabilities':     return this._listCapabilities();
      case 'list-versions':         return this._listVersions(agentId, params);
      case 'get-version':           return this._getVersion(agentId, params);
      case 'set-main':              return this._setMain(agentId, params);
      case 'rename':                return this._rename(agentId, params);
      case 'share-to-gallery':      return this._shareToGallery(agentId, params, context);
      case 'unshare-from-gallery':  return this._unshareFromGallery(agentId, params);
      case 'list-gallery':          return this._listGallery(params);
      case 'render-from-gallery':   return this._renderFromGallery(agentId, params, { allowed });
      case 'check-upgrade':         return this._checkUpgrade(agentId, params);
      case 'apply-upgrade':         return this._applyUpgrade(agentId, params, { allowed });
      default:                      return { success: false, error: `Unknown action: ${action}. Supported: ${this.getSupportedActions().join(', ')}` };
    }
  }

  /**
   * Machine-readable capabilities report. Returned to the agent on
   * `widget.list-capabilities` AND embedded in every render-failure so
   * the agent has a programmatic way to see what IS available without
   * re-parsing the long prose description.
   *
   * Keep this list IN SYNC with the runtime bundle — the tests pin this
   * against runtime/bundle.js so drift is caught at CI time.
   */
  _listCapabilities() {
    return {
      success: true,
      action: 'list-capabilities',
      capabilities: {
        kinds: {
          html: 'static HTML+CSS, no scripts (sandbox="")',
          jsx: 'Preact + htm runtime; hooks (useState/useEffect/...), h(), html``',
          webcomponent: 'class extends LoxiaElement; standard web platform, no custom runtime quirks. RECOMMENDED for new interactive widgets.',
        },
        webcomponent: {
          baseClass: 'LoxiaElement (extends HTMLElement)',
          mountApi: 'loxia.render(YourClass, initialProps) — registers a unique tag, instantiates, mounts to #root',
          ergonomics: {
            'class field state = {...}':       'initial state',
            'this.setState(updater)':          'merge OR pass a function for prev-state updates; triggers re-render',
            'this.template(state) → string':   'override; return innerHTML',
            'this.emit(type, payload)':        'send event to agent (alias for loxia.sendEvent with type set)',
            'this.handleUpdate(newProps)':     'called when agent posts widget.update; default setState(newProps)',
            'this.onMount() / this.onUnmount()': 'lifecycle; called from connectedCallback / disconnectedCallback',
            'this.afterRender(root)':         'called AFTER every render (including post-setState). Sanctioned hook for manual addEventListener — listeners attached here survive setState because they\'re re-attached on the fresh DOM. (onMount fires only once; addEventListener calls there die on the first re-render.)',
          },
          autoWiredAttrs: {
            'data-bind="key"':              'input/change → setState({key: value}) (numeric inputs auto-coerced)',
            'data-emit="name"':             'click → emit(name, { state }) — sends to AGENT',
            'data-on-<event>="methodName"': 'ANY DOM event (click, input, keydown, pointerdown, dragover, wheel, transitionend, …) → this.methodName(event) — calls LOCAL instance method',
            'data-payload="{...}"':         'JSON payload merged into the emit (optional, data-emit only)',
          },
          escapeHatch: 'You can extend HTMLElement directly. loxia.render still mounts you. Use attributeChangedCallback for prop updates in that path.',
        },
        // Every name that can appear as a bare identifier and works.
        globals: [
          // VDOM primitives
          'h', 'html', 'createElement', 'Fragment',
          // Hooks (all implemented — safe to use)
          'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useReducer',
          // Component primitives
          'LoxiaCard', 'LoxiaButton', 'LoxiaInput', 'LoxiaText',
          'LoxiaMetric', 'LoxiaRow', 'LoxiaCol',
        ],
        // Objects the agent can use as namespaces — all alias the same bundle.
        namespaces: {
          aliased: [
            'htmPreact', 'htm_preact', 'preactHtm', 'htm', 'Htm',
            'preact', 'Preact', 'preactjs',
            'preactHooks', 'PreactHooks', 'preact_hooks', 'hooks', 'Hooks',
            'React', 'react', 'reactHooks', 'ReactHooks', 'react_hooks',
            'preactStandalone', 'preact_standalone',
          ],
          reactDomShim: ['ReactDOM.render(vnode, el)', 'ReactDOM.createRoot(el).render(vnode)'],
        },
        // loxia namespace — widget-specific APIs.
        loxia: {
          'loxia.render(Component, props)':      'mount the root component (call this last)',
          'loxia.sendEvent({type, payload})':    'send event to the agent; arrives next turn as a tool-result',
          'loxia.onUpdate(fn)':                  'subscribe to prop updates from agent widget.update',
          'loxia.requestHeight(px)':             'manually override iframe height',
        },
        // Browser APIs the iframe has (standard, always available).
        browserApis: [
          'document', 'window', 'console', 'setTimeout', 'setInterval',
          'clearTimeout', 'clearInterval', 'Promise', 'JSON', 'Math',
          'Date', 'Array', 'Object', 'String', 'Number', 'Boolean',
          'Map', 'Set', 'Symbol', 'Error',
        ],
        // Named errors — using any of these throws with a specific message.
        notImplemented: {
          classes: ['Component', 'PureComponent'],
          functions: [
            'useLayoutEffect', 'useImperativeHandle', 'useContext',
            'useDeferredValue', 'useTransition', 'useId',
            'useSyncExternalStore', 'useErrorBoundary',
            'createContext', 'createRef', 'forwardRef', 'memo',
            'lazy', 'Suspense', 'StrictMode',
            'Children', 'cloneElement', 'isValidElement',
          ],
          rewritePaths: {
            'useContext(Ctx)':     'prop-drill, OR move the state to the agent via sendEvent + widget.update',
            'useLayoutEffect':     'useEffect is a close substitute (fires after paint instead of before)',
            'useReducer':          'IMPLEMENTED — you can use it directly. (Older docs said not; now supported.)',
            'forwardRef':          'refs to child components are not supported; use useRef for DOM nodes only',
            'memo(Component)':     'memoize derived values with useMemo inside the component instead',
            'Component / class':   'rewrite as a function component — function App(){ const [s,setS]=useState(); ... }',
          },
        },
        // Hard errors — things that throw ReferenceError.
        hardErrors: [
          'fetch', 'XMLHttpRequest', 'WebSocket',
          'localStorage', 'sessionStorage', 'cookies', 'indexedDB',
          'import', 'require', 'export',
          'process', 'global', 'Buffer',
          'Any npm package (lodash, d3, chart.js, react-router, etc.)',
        ],
        // Security and scope constraints — immutable, just informational.
        constraints: {
          sandbox: 'null-origin iframe — no cookies, no network, no parent-page access',
          maxContentBytes: WIDGET_LIMITS.MAX_CONTENT_BYTES,
          maxWidgetsPerAgent: WIDGET_LIMITS.MAX_WIDGETS_PER_AGENT,
          hooksScope: 'hooks are call-order-keyed on the ROOT component — nested components can\'t use hooks; lift state up',
          stateModel: 'function components only, no classes',
        },
      },
    };
  }

  _render(agentId, params, { allowed, context }) {
    const v = validateRenderParams(params);
    if (!v.valid) return { success: false, error: v.error };

    if (!allowed) {
      return {
        success: false,
        disabled: true,
        error: 'Custom widgets are disabled for this agent. Enable in the widget configurator.',
      };
    }

    const widgetId = params.widgetId || this._generateWidgetId(params.kind);
    const newVersion = buildVersion({
      kind:    params.kind,
      content: params.content,
      props:   params.props,
    });

    const widget = this._appendVersion(agentId, widgetId, newVersion);

    // Optional display name: only set on FIRST render (so subsequent
    // renders don't accidentally clear or change a name the user picked).
    // To rename an existing widget, use the dedicated `rename` action.
    const requestedName = normalizeName(params.name);
    if (requestedName && !widget.name) {
      widget.name = requestedName;
    }

    this.logger?.info?.('Widget rendered', {
      agentId, widgetId,
      kind:          widget.kind,
      size:          widget.size,
      versionId:     newVersion.versionId,
      versionCount:  widget.versions.length,
      phishingFlags: newVersion.phishingHits.length,
    });

    this._emitChange(agentId, widgetId, 'rendered', widget);

    // Static analysis — surface "looks broken even before rendering"
    // findings (typo attributes, unreferenced handler-shaped methods).
    // Fed back through the tool result so the agent's NEXT turn sees
    // them and can ship a corrected render without waiting for the
    // user to interact with a half-broken widget. iframe-side runtime
    // warnings still fire when the widget actually mounts; the two
    // sources are complementary (this catches things at submission
    // time, the runtime catches things that depend on actual DOM
    // shape after innerHTML).
    const { warnings: codeWarnings } = analyzeWidgetCode(params.content, params.kind);

    return {
      success:       true,
      action:        'render',
      widgetId,
      versionId:     newVersion.versionId,
      versionCount:  widget.versions.length,
      widget,
      ...(codeWarnings.length > 0 && { warnings: codeWarnings }),
    };
  }

  _update(agentId, params, { allowed }) {
    const v = validateUpdateParams(params);
    if (!v.valid) return { success: false, error: v.error };

    if (!allowed) {
      return { success: false, disabled: true, error: 'Custom widgets are disabled for this agent.' };
    }

    const agentWidgets = this._widgetsByAgent.get(agentId);
    const widget = agentWidgets?.get(params.widgetId);
    if (!widget) {
      return { success: false, error: `Widget not found: ${params.widgetId}` };
    }

    widget.props = { ...widget.props, ...params.props };
    widget.updatedAt = new Date().toISOString();

    this.logger?.info?.('Widget updated', { agentId, widgetId: params.widgetId });
    this._emitChange(agentId, params.widgetId, 'updated', widget);
    return { success: true, action: 'update', widgetId: params.widgetId, widget };
  }

  _destroy(agentId, params) {
    const v = validateDestroyParams(params);
    if (!v.valid) return { success: false, error: v.error };
    const agentWidgets = this._widgetsByAgent.get(agentId);
    if (!agentWidgets?.has(params.widgetId)) {
      return { success: false, error: `Widget not found: ${params.widgetId}` };
    }
    agentWidgets.delete(params.widgetId);
    this.logger?.info?.('Widget destroyed', { agentId, widgetId: params.widgetId });
    this._emitChange(agentId, params.widgetId, 'destroyed', null);
    return { success: true, action: 'destroy', widgetId: params.widgetId };
  }

  _list(agentId) {
    const agentWidgets = this._widgetsByAgent.get(agentId);
    if (!agentWidgets) return { success: true, widgets: [] };
    // Project to a list-summary shape — names match what the frontend
    // artifacts panel needs to render a card without fetching content.
    const widgets = Array.from(agentWidgets.values()).map(w => ({
      widgetId:        w.widgetId,
      name:            w.name || null,
      kind:            w.kind,
      createdAt:       w.createdAt,
      updatedAt:       w.updatedAt,
      lastRenderedAt:  w.lastRenderedAt,
      size:            w.size,
      phishingHits:    w.phishingHits,
      versionCount:    w.versions.length,
      mainVersionId:   w.mainVersionId,
      // Gallery linkage (filled in by Phase 4 — null today). Listed
      // here so the frontend can render the share state without a
      // second round-trip.
      linkedGalleryTemplateId: w.linkedGalleryTemplateId || null,
      linkedGalleryVersion:    w.linkedGalleryVersion || null,
      divergedFromGallery:     !!w.divergedFromGallery,
    }));
    return { success: true, widgets };
  }

  /**
   * `list-versions { widgetId }` — return the version history for a
   * widget without including each version's content. Useful for the
   * artifacts panel's version dropdown.
   */
  _listVersions(agentId, params) {
    const v = validateListVersionsParams(params);
    if (!v.valid) return { success: false, error: v.error };
    const widget = this._widgetsByAgent.get(agentId)?.get(params.widgetId);
    if (!widget) return { success: false, error: `Widget not found: ${params.widgetId}` };
    return {
      success: true,
      action: 'list-versions',
      widgetId: widget.widgetId,
      mainVersionId: widget.mainVersionId,
      // Chronological — oldest first; the latest version is at the end.
      versions: widget.versions.map(v => ({
        versionId:    v.versionId,
        kind:         v.kind,
        size:         v.size,
        createdAt:    v.createdAt,
        phishingHits: v.phishingHits,
        // content omitted on purpose — fetch with get-version
      })),
    };
  }

  /** `get-version { widgetId, versionId }` — fetch a specific version's content. */
  _getVersion(agentId, params) {
    const v = validateGetVersionParams(params);
    if (!v.valid) return { success: false, error: v.error };
    const widget = this._widgetsByAgent.get(agentId)?.get(params.widgetId);
    if (!widget) return { success: false, error: `Widget not found: ${params.widgetId}` };
    const version = widget.versions.find(x => x.versionId === params.versionId);
    if (!version) {
      return {
        success: false,
        error: `Version not found: ${params.versionId}. Available: ${widget.versions.map(x => x.versionId).join(', ')}`,
      };
    }
    return { success: true, action: 'get-version', widgetId: widget.widgetId, version };
  }

  /**
   * `set-main { widgetId, versionId }` — promote a version to be the
   * active one. The widget's mirrored top-level fields update so the
   * frontend's next render uses the chosen content.
   */
  _setMain(agentId, params) {
    const v = validateSetMainParams(params);
    if (!v.valid) return { success: false, error: v.error };
    const widget = this._widgetsByAgent.get(agentId)?.get(params.widgetId);
    if (!widget) return { success: false, error: `Widget not found: ${params.widgetId}` };
    const exists = widget.versions.some(x => x.versionId === params.versionId);
    if (!exists) {
      return {
        success: false,
        error: `Version not found: ${params.versionId}. Available: ${widget.versions.map(x => x.versionId).join(', ')}`,
      };
    }
    widget.mainVersionId = params.versionId;
    mirrorActiveVersion(widget);
    this.logger?.info?.('Widget main version set', {
      agentId, widgetId: widget.widgetId, mainVersionId: params.versionId,
    });
    this._emitChange(agentId, widget.widgetId, 'main-set', widget);
    return { success: true, action: 'set-main', widgetId: widget.widgetId, widget };
  }

  /**
   * `rename { widgetId, name }` — set/clear the human-friendly display name.
   * Pass null/'' to clear (revert to widgetId-as-display).
   * Names are NOT unique per agent — multiple widgets can share a name;
   * widgetId remains the stable identifier.
   */
  _rename(agentId, params) {
    const v = validateRenameParams(params);
    if (!v.valid) return { success: false, error: v.error };
    const widget = this._widgetsByAgent.get(agentId)?.get(params.widgetId);
    if (!widget) return { success: false, error: `Widget not found: ${params.widgetId}` };

    const previous = widget.name || null;
    if (v.clear) {
      widget.name = null;
    } else {
      // validator returns the trimmed canonical form when valid.
      widget.name = v.normalized != null ? v.normalized : String(params.name).trim();
    }
    widget.updatedAt = new Date().toISOString();

    this.logger?.info?.('Widget renamed', {
      agentId, widgetId: widget.widgetId,
      from: previous, to: widget.name,
    });
    this._emitChange(agentId, widget.widgetId, 'renamed', widget, {
      previousName: previous,
    });
    return {
      success: true, action: 'rename',
      widgetId: widget.widgetId,
      name: widget.name,
      previousName: previous,
      widget,
    };
  }

  /**
   * Append a new version to a widget (or create a new widget for the
   * agent if none exists). Returns the (mutated) widget record.
   *
   * Enforces TWO independent caps:
   *   - MAX_VERSIONS_PER_WIDGET   — drop oldest version once we exceed
   *   - MAX_WIDGETS_PER_AGENT     — drop oldest widget once we exceed
   *
   * Mark `divergedFromGallery` if the widget was linked to a gallery
   * template — once the agent renders new content, it's no longer
   * tracking upstream and shouldn't show upgrade prompts.
   *
   * @private
   */
  _appendVersion(agentId, widgetId, version) {
    let agentWidgets = this._widgetsByAgent.get(agentId);
    if (!agentWidgets) {
      agentWidgets = new Map();
      this._widgetsByAgent.set(agentId, agentWidgets);
    }

    let widget = agentWidgets.get(widgetId);
    const now = new Date().toISOString();

    if (!widget) {
      widget = {
        widgetId,
        versions:      [version],
        mainVersionId: version.versionId,
        createdAt:     now,
        // Gallery linkage fields — initialized null; render-from-gallery
        // (Phase 4) sets them; subsequent local renders will set
        // divergedFromGallery=true via the branch below.
        linkedGalleryTemplateId: null,
        linkedGalleryVersion:    null,
        divergedFromGallery:     false,
      };
      agentWidgets.set(widgetId, widget);
    } else {
      // Bump LRU recency by re-inserting at the end of the agent's map.
      agentWidgets.delete(widgetId);
      agentWidgets.set(widgetId, widget);

      widget.versions.push(version);
      widget.mainVersionId = version.versionId;

      // Cap version history per widget — drop oldest, keep main if it
      // would otherwise be evicted (rare: would need >MAX renders since
      // mainVersionId was set on a since-evicted version).
      while (widget.versions.length > WIDGET_LIMITS.MAX_VERSIONS_PER_WIDGET) {
        const evicted = widget.versions.shift();
        this.logger?.debug?.('Widget version evicted', {
          agentId, widgetId, versionId: evicted.versionId,
        });
        if (evicted.versionId === widget.mainVersionId) {
          // Defensive: re-pin to oldest remaining version so we never
          // dangle an invalid mainVersionId.
          widget.mainVersionId = widget.versions[0].versionId;
        }
      }

      // Linked-to-gallery widgets diverge as soon as the agent renders
      // anything that isn't the linked content. We don't compare bytes
      // (cheaper + safer to assume divergence on any local render).
      if (widget.linkedGalleryTemplateId) {
        widget.divergedFromGallery = true;
      }
    }

    mirrorActiveVersion(widget);

    // Per-agent widget cap.
    while (agentWidgets.size > WIDGET_LIMITS.MAX_WIDGETS_PER_AGENT) {
      const oldestKey = agentWidgets.keys().next().value;
      agentWidgets.delete(oldestKey);
      this.logger?.debug?.('Widget evicted (LRU)', { agentId, widgetId: oldestKey });
    }
    return widget;
  }

  _generateWidgetId(kind) {
    const n = this._nextAutoId++;
    return `w-${kind}-${n}-${Date.now().toString(36)}`;
  }

  // ──────────────────────────────────────────────────────────────────
  // Gallery — cross-session shared widget catalog.
  // ──────────────────────────────────────────────────────────────────

  /**
   * `share-to-gallery { widgetId, title?, tags? }` — publish the
   * widget's CURRENT MAIN VERSION to the gallery as a new template.
   * Re-sharing the same widget bumps the template's version (so other
   * sessions can detect upgrades). The agent's local widget gets a
   * `linkedGalleryTemplateId` pointing at the new template — until the
   * agent renders new content and `divergedFromGallery` flips.
   */
  async _shareToGallery(agentId, params, context) {
    const widgetId = params?.widgetId;
    if (typeof widgetId !== 'string' || !widgetId) {
      return { success: false, error: 'widgetId is required' };
    }
    const widget = this._widgetsByAgent.get(agentId)?.get(widgetId);
    if (!widget) return { success: false, error: `Widget not found: ${widgetId}` };

    const gallery = this._galleryStore();
    try {
      const { templateId, version, entry } = await gallery.share(widget, {
        agentId,
        agentName: context?.agentName || null,
        sessionId: context?.sessionId || null,
        title:     params.title,
        tags:      params.tags,
        forkedFrom: widget.linkedGalleryTemplateId || null,
      });
      // Link the widget to the freshly-created template. Reset the
      // diverged flag — we just synced upstream.
      widget.linkedGalleryTemplateId = templateId;
      widget.linkedGalleryVersion    = version;
      widget.divergedFromGallery     = false;
      this.logger?.info?.('Widget shared to gallery', { agentId, widgetId, templateId, version });
      this._emitChange(agentId, widgetId, 'shared', widget, { templateId, templateVersion: version });
      return {
        success: true, action: 'share-to-gallery',
        templateId, version, entry,
        widget: this._summarizeWidget(widget),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * `unshare-from-gallery { templateId }` — remove a template from the
   * gallery. Local widgets keep working but lose their upstream link
   * (cleared on the matching widget if any).
   */
  async _unshareFromGallery(agentId, params) {
    const templateId = params?.templateId;
    if (typeof templateId !== 'string' || !templateId) {
      return { success: false, error: 'templateId is required' };
    }
    const gallery = this._galleryStore();
    const removed = await gallery.unshare(templateId);
    // Clear the link on any local widget that pointed at this template.
    const agentWidgets = this._widgetsByAgent.get(agentId);
    if (agentWidgets) {
      for (const w of agentWidgets.values()) {
        if (w.linkedGalleryTemplateId === templateId) {
          w.linkedGalleryTemplateId = null;
          w.linkedGalleryVersion    = null;
          w.divergedFromGallery     = false;
          // Each affected widget gets its own change event so the
          // frontend can refresh badges without a full re-fetch.
          this._emitChange(agentId, w.widgetId, 'unshared', w, { templateId });
        }
      }
    }
    return {
      success:  removed,
      action:   'unshare-from-gallery',
      templateId,
      removed,
      ...(removed ? {} : { error: `Template not found: ${templateId}` }),
    };
  }

  /**
   * `list-gallery { tag?, agentId? }` — list templates available in
   * the gallery, optionally filtered. Content is included so the agent
   * can preview before render-from-gallery; for very large galleries a
   * future call will return summaries only.
   */
  async _listGallery(params = {}) {
    const gallery = this._galleryStore();
    const filter = {};
    if (params.tag)      filter.tag = String(params.tag).slice(0, 32);
    if (params.agentId)  filter.agentId = String(params.agentId).slice(0, 128);
    const entries = await gallery.list(filter);
    return {
      success: true,
      action: 'list-gallery',
      count: entries.length,
      templates: entries.map(e => ({
        templateId:   e.templateId,
        version:      e.version,
        title:        e.title,
        kind:         e.kind,
        tags:         e.tags,
        sharedBy:     e.sharedBy,
        sharedAt:     e.sharedAt,
        renderCount:  e.renderCount,
        starred:      e.starred,
        forkedFrom:   e.forkedFrom,
        phishingHits: e.phishingHits,
        size:         (e.content || '').length,
      })),
    };
  }

  /**
   * `render-from-gallery { templateId, widgetId?, props? }` — instantiate
   * a gallery template into the agent's local widgets. The new local
   * widget is LINKED to the gallery template via `linkedGalleryTemplateId`,
   * so the upgrade-prompt machinery (Phase 4) can later compare versions.
   */
  async _renderFromGallery(agentId, params, { allowed }) {
    const templateId = params?.templateId;
    if (typeof templateId !== 'string' || !templateId) {
      return { success: false, error: 'templateId is required' };
    }
    if (!allowed) {
      return {
        success: false, disabled: true,
        error: 'Custom widgets are disabled for this agent. Enable in the widget configurator.',
      };
    }
    const gallery = this._galleryStore();
    const tpl = await gallery.get(templateId);
    if (!tpl) return { success: false, error: `Template not found: ${templateId}` };

    const widgetId = params.widgetId || this._generateWidgetId(tpl.kind);
    const merged = { ...(tpl.defaultProps || {}), ...(params.props || {}) };

    const newVersion = buildVersion({
      kind:    tpl.kind,
      content: tpl.content,
      props:   merged,
    });
    // Append normally, then mark linkage. Note: _appendVersion would
    // otherwise flip divergedFromGallery to true, so we set linkage
    // AFTER the append (to a fresh widget; no prior linkage).
    const widget = this._appendVersion(agentId, widgetId, newVersion);
    widget.linkedGalleryTemplateId = templateId;
    widget.linkedGalleryVersion    = tpl.version;
    widget.divergedFromGallery     = false;

    // Bump the template's render counter — useful "popular templates" metric.
    await gallery.bumpRenderCount(templateId);

    this.logger?.info?.('Widget rendered from gallery', { agentId, widgetId, templateId, version: tpl.version });
    this._emitChange(agentId, widgetId, 'rendered', widget, { templateId, templateVersion: tpl.version });
    return {
      success: true, action: 'render-from-gallery',
      widgetId, versionId: newVersion.versionId,
      templateId, templateVersion: tpl.version,
      widget,
    };
  }

  /**
   * `check-upgrade { widgetId }` — for a gallery-linked widget,
   * report whether a newer template version is available.
   *
   * Result shape:
   *   { success, hasUpgrade, currentVersion, latestVersion, latestTemplateId,
   *     diverged, sharedAt, ... }
   *
   * Returns hasUpgrade=false (with a reason) when the widget isn't
   * linked OR has diverged (local edits broke the link).
   */
  async _checkUpgrade(agentId, params) {
    const widgetId = params?.widgetId;
    if (typeof widgetId !== 'string' || !widgetId) {
      return { success: false, error: 'widgetId is required' };
    }
    const widget = this._widgetsByAgent.get(agentId)?.get(widgetId);
    if (!widget) return { success: false, error: `Widget not found: ${widgetId}` };

    if (!widget.linkedGalleryTemplateId) {
      return {
        success: true, action: 'check-upgrade', widgetId,
        hasUpgrade: false, reason: 'not-linked',
      };
    }
    if (widget.divergedFromGallery) {
      return {
        success: true, action: 'check-upgrade', widgetId,
        hasUpgrade: false, reason: 'diverged',
        linkedTemplateId: widget.linkedGalleryTemplateId,
        currentVersion:   widget.linkedGalleryVersion,
      };
    }

    const gallery = this._galleryStore();
    const latest = await gallery.findLatestForOrigin(widget.linkedGalleryTemplateId);
    if (!latest) {
      // The linked template was removed from the gallery (unshared upstream).
      return {
        success: true, action: 'check-upgrade', widgetId,
        hasUpgrade: false, reason: 'linked-template-missing',
        linkedTemplateId: widget.linkedGalleryTemplateId,
      };
    }
    const hasUpgrade = latest.version > (widget.linkedGalleryVersion || 0);
    return {
      success: true, action: 'check-upgrade', widgetId,
      hasUpgrade,
      currentVersion:   widget.linkedGalleryVersion,
      latestVersion:    latest.version,
      latestTemplateId: latest.templateId,
      sharedAt:         latest.sharedAt,
      sharedBy:         latest.sharedBy,
    };
  }

  /**
   * `apply-upgrade { widgetId }` — pull the latest gallery version
   * into the linked widget AS A NEW LOCAL VERSION. The user keeps the
   * old version in their history (so they can revert via set-main).
   *
   * Refuses if the widget has diverged — that means the user/agent
   * edited locally, and we don't want to silently overwrite their work.
   */
  async _applyUpgrade(agentId, params, { allowed }) {
    const widgetId = params?.widgetId;
    if (typeof widgetId !== 'string' || !widgetId) {
      return { success: false, error: 'widgetId is required' };
    }
    if (!allowed) {
      return {
        success: false, disabled: true,
        error: 'Custom widgets are disabled for this agent.',
      };
    }
    const widget = this._widgetsByAgent.get(agentId)?.get(widgetId);
    if (!widget) return { success: false, error: `Widget not found: ${widgetId}` };
    if (!widget.linkedGalleryTemplateId) {
      return { success: false, error: 'Widget is not linked to any gallery template.' };
    }
    if (widget.divergedFromGallery) {
      return {
        success: false,
        error: 'Widget has been edited locally and diverged from the gallery template. Refusing to overwrite local edits — share again or fork.',
      };
    }

    const gallery = this._galleryStore();
    const latest = await gallery.findLatestForOrigin(widget.linkedGalleryTemplateId);
    if (!latest) {
      return { success: false, error: 'Linked gallery template no longer exists (was unshared upstream).' };
    }
    if (latest.version <= (widget.linkedGalleryVersion || 0)) {
      return {
        success: false,
        error: 'Already on the latest version. Nothing to upgrade.',
      };
    }

    // Capture the linkage BEFORE we mutate it — we need to report the
    // "fromVersion" in the result, and the log entry needs the actual
    // upgrade arc, not the post-upgrade values.
    const fromTemplateId = widget.linkedGalleryTemplateId;
    const fromVersion    = widget.linkedGalleryVersion;

    // Append a new local version with the latest content. Important:
    // _appendVersion would normally flip divergedFromGallery=true on a
    // linked widget; we restore it to false (and bump linkedVersion)
    // AFTER the append because this IS the upstream sync.
    const newVersion = buildVersion({
      kind:    latest.kind,
      content: latest.content,
      props:   widget.props || latest.defaultProps || {},
    });
    this._appendVersion(agentId, widgetId, newVersion);
    widget.linkedGalleryTemplateId = latest.templateId;
    widget.linkedGalleryVersion    = latest.version;
    widget.divergedFromGallery     = false;
    await gallery.bumpRenderCount(latest.templateId);
    this.logger?.info?.('Widget upgraded from gallery', {
      agentId, widgetId,
      from: { templateId: fromTemplateId, version: fromVersion },
      to:   { templateId: latest.templateId, version: latest.version },
    });
    this._emitChange(agentId, widgetId, 'upgrade-applied', widget, {
      fromVersion, toVersion: latest.version,
    });
    return {
      success: true, action: 'apply-upgrade', widgetId,
      newVersionId: newVersion.versionId,
      fromVersion,
      toVersion:    latest.version,
      widget,
    };
  }

  /** Compact summary used by share-to-gallery (no full versions[] payload). */
  _summarizeWidget(w) {
    return {
      widgetId:     w.widgetId,
      kind:         w.kind,
      versionCount: w.versions.length,
      mainVersionId: w.mainVersionId,
      linkedGalleryTemplateId: w.linkedGalleryTemplateId,
      linkedGalleryVersion:    w.linkedGalleryVersion,
      divergedFromGallery:     w.divergedFromGallery,
    };
  }

  /** Test-only helper: total widget count across all agents. */
  _totalWidgetCount() {
    let n = 0;
    for (const m of this._widgetsByAgent.values()) n += m.size;
    return n;
  }
}

export default WidgetTool;
