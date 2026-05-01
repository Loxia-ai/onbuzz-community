/**
 * IframeWidget — mounts an agent-generated widget in a sandboxed iframe.
 *
 * Security model (A+C from design doc):
 *   - srcdoc + sandbox flags only (NEVER with allow-same-origin)
 *   - `kind: 'jsx'`  → sandbox="allow-scripts"  — interactive
 *   - `kind: 'html'` → sandbox=""                — static only
 *   - CSP meta inside srcdoc pins script/style/img/connect sources
 *   - postMessage bridge authenticates by `event.source === iframeEl`
 *     (origin is always "null" for these iframes — useless for auth)
 *
 * Parent → child messages (postMessage with __loxia:true):
 *   { type: 'update', props }  — re-render with new props
 *   { type: 'theme',  tokens } — update CSS vars
 *
 * Child → parent messages:
 *   { type: 'event',  payload } — user interaction; bubbles up to onEvent
 *   { type: 'resize', height }  — auto-height from child ResizeObserver
 *
 * This component is self-contained. Removing the widget module requires
 * no changes to anything outside modules/widget/.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ShieldExclamationIcon, CodeBracketIcon, XMarkIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

// ── Runtime bundle: fetched once, inlined into every jsx iframe ───────

// Two runtimes — JSX (htm + hooks + VDOM) and Web Component (HTMLElement +
// LoxiaElement base class). Each is fetched lazily and cached. The kind
// passed to <IframeWidget> picks which one is loaded into the srcdoc.
const _runtimePromises = { jsx: null, wc: null };
function fetchRuntimeOnce(which /* 'jsx' | 'wc' */) {
  if (_runtimePromises[which]) return _runtimePromises[which];
  const url = which === 'wc' ? '/api/widget/runtime-wc.js' : '/api/widget/runtime.js';
  _runtimePromises[which] = fetch(url)
    .then(r => r.ok ? r.text() : Promise.reject(new Error(`runtime fetch ${r.status}`)))
    .catch(err => {
      _runtimePromises[which] = null; // let future mounts retry
      throw err;
    });
  return _runtimePromises[which];
}

// ── srcdoc builders ───────────────────────────────────────────────────

/**
 * CSP for jsx mode. `'unsafe-inline'` on script-src is necessary because
 * we inline the runtime bundle + agent code into the srcdoc (cross-origin
 * <script src> is blocked by null-origin CSP resolution; see design doc).
 * `connect-src 'none'` kills fetch/XHR. `img-src data: blob:` stops URL
 * exfiltration via <img> requests.
 */
// NOTE: `frame-ancestors` and `sandbox` directives are NOT supported
// when CSP is delivered via <meta> — browsers ignore them and emit a
// console warning. They only work as HTTP response headers. We ship
// the CSP via <meta http-equiv> because the iframe is srcdoc-backed
// (no HTTP response to attach headers to), so we omit those
// directives here. The sandbox IS still enforced via the parent
// iframe's `sandbox=""` / `sandbox="allow-scripts"` attribute, which
// is the source of truth for these widgets anyway.
const CSP_JSX = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** For html mode no scripts run, so drop script-src and tighten further. */
const CSP_HTML = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

function themeTokensFromDocument() {
  // Sample the current theme tokens off the root element so the iframe
  // can mirror them. Small set — we don't send the whole cascade.
  const root = getComputedStyle(document.documentElement);
  const names = [
    'gray-50','gray-100','gray-200','gray-300','gray-400','gray-500',
    'gray-600','gray-700','gray-800','gray-900','gray-950',
    'loxia-50','loxia-100','loxia-200','loxia-300','loxia-400','loxia-500',
    'loxia-600','loxia-700','loxia-800','loxia-900',
  ];
  const out = {};
  for (const n of names) out[n] = root.getPropertyValue('--' + n).trim();
  return out;
}

/**
 * Shared error-infrastructure script. Installed BEFORE the kind-specific
 * runtime so it catches parse/eval errors in the runtime bundle itself.
 * Used by both the JSX and Web Component srcdoc builders.
 */
function buildScript1ErrorInfra(widgetId, initialProps) {
  return `
<script>
(function(){
  var WIDGET_ID = ${JSON.stringify(widgetId)};
  window.__loxiaWidgetId = WIDGET_ID;
  window.__loxiaInitialProps = ${JSON.stringify(initialProps || {})};
  var MAX_UNIQUE = 5, MAX_MSG_LEN = 500;
  var seen = Object.create(null), uniqueCount = 0, suppressedCount = 0;
  window.__loxiaReportError = function(err, phase) {
    var msg = (err && (err.message || err.toString())) || 'unknown error';
    msg = String(msg).slice(0, MAX_MSG_LEN);
    var stack = (err && err.stack) ? String(err.stack).slice(0, 2000) : null;
    var sig = phase + '|' + msg;
    window.__loxiaHadError = true;
    if (uniqueCount === 0 && !seen[sig]) {
      try {
        var root = document.getElementById('root') || document.body;
        var badge = suppressedCount > 0
          ? '<div style="color:#888;font-size:10px;margin-top:4px">(' + suppressedCount + ' repeated errors suppressed)</div>'
          : '';
        if (root) root.innerHTML =
          '<pre style="color:#c00;white-space:pre-wrap;font-size:12px;font-family:monospace;padding:8px">widget error (' + phase + '): '
          + msg.replace(/[&<>]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];})
          + '</pre>' + badge;
      } catch(_){}
    }
    if (seen[sig]) { seen[sig]++; suppressedCount++; return; }
    if (uniqueCount >= MAX_UNIQUE) { suppressedCount++; return; }
    seen[sig] = 1; uniqueCount++;
    try {
      window.parent.postMessage({ __loxia: true, type: 'error', widgetId: WIDGET_ID, phase: phase, message: msg, stack: stack }, '*');
    } catch(_){}
    try {
      window.parent.postMessage({ __loxia: true, type: 'resize', widgetId: WIDGET_ID, height: document.body.scrollHeight }, '*');
    } catch(_){}
  };
  window.addEventListener('error', function(e){
    window.__loxiaReportError(e.error || new Error(e.message || 'runtime error'), 'runtime');
  });
  window.addEventListener('unhandledrejection', function(e){
    window.__loxiaReportError(e.reason || new Error('unhandled rejection'), 'async');
  });
  // Separate channel for NON-FATAL lint findings (typo detector,
  // missing-method on data-on-*, etc.). These DO NOT replace the widget
  // with a red error screen — they post a 'warning' message to the
  // parent which logs it and shows a small non-blocking badge.
  var seenWarn = Object.create(null), uniqueWarnCount = 0, suppressedWarnCount = 0;
  window.__loxiaReportWarning = function(msg, phase) {
    msg = String(msg).slice(0, MAX_MSG_LEN);
    var sig = (phase || 'lint') + '|' + msg;
    if (seenWarn[sig]) { seenWarn[sig]++; suppressedWarnCount++; return; }
    if (uniqueWarnCount >= MAX_UNIQUE) { suppressedWarnCount++; return; }
    seenWarn[sig] = 1; uniqueWarnCount++;
    try { console.warn('[loxia widget warning] ' + msg); } catch(_){}
    try {
      window.parent.postMessage({ __loxia: true, type: 'warning', widgetId: WIDGET_ID, phase: phase || 'lint', message: msg }, '*');
    } catch(_){}
  };
})();
</script>`;
}

/**
 * Web Component srcdoc — uses the WC runtime + lets the agent's code
 * call `loxia.render(MyClass, props)` itself. Strictly simpler than the
 * JSX srcdoc: no factory promotion, no body-vs-factory ambiguity, no
 * hook-counter machinery.
 */
function buildWebComponentSrcdoc({ runtime, agentCode, widgetId, initialProps, themeTokens }) {
  const tokensCss = Object.entries(themeTokens).map(([k, v]) => `--${k}:${v};`).join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP_JSX}" />
<style>
  html,body{margin:0;padding:0;background:transparent;color:rgb(var(--gray-900));
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;}
  :root{${tokensCss}}
  *{box-sizing:border-box;}
  #root{padding:12px;}
</style>
</head>
<body>
<div id="root"></div>
${buildScript1ErrorInfra(widgetId, initialProps)}

<!-- SCRIPT 2 — Web Component runtime (LoxiaElement + loxia.render shim). -->
<script>
try {
${runtime}
  window.__loxiaBundleCompleted = true;
} catch (err) {
  window.__loxiaBundleError = err;
  if (window.__loxiaReportError) window.__loxiaReportError(err, 'runtime-setup');
}
</script>

<!--
  SCRIPT 3 — agent code. The agent defines a class and calls
  loxia.render(TheClass, initialProps). No wrapper magic — the platform
  contract IS the contract. Errors in the agent's code (syntax, missing
  loxia.render call, customElements.define misuse, etc.) flow through
  window.onerror or our try/catch into the standard reporter.
-->
<script>
(function(){
  if (!window.loxia || typeof window.loxia.render !== 'function' || typeof window.LoxiaElement !== 'function') {
    if (window.__loxiaHadError || window.__loxiaBundleError) return;
    window.__loxiaReportError(
      new Error('webcomponent runtime failed to initialise — window.loxia.render or window.LoxiaElement missing. The bundle may have thrown silently.'),
      'runtime-setup'
    );
    return;
  }
  try {
    // Initial props are exposed on window for the agent's class to read.
    // Most agents pass initialProps to loxia.render directly:
    //   loxia.render(MyClass, window.__loxiaInitialProps);
    var __loxiaUserCode = function() {
${agentCode}
    };
    __loxiaUserCode();
    // Sanity check: did the agent actually mount something?
    var root = document.getElementById('root');
    if (!root || root.children.length === 0) {
      window.__loxiaReportError(
        new Error('Your widget did not mount. After defining your class, call loxia.render(YourClass, window.__loxiaInitialProps). Example:\\n  class MyWidget extends LoxiaElement {\\n    template(state) { return \\'<div>...</div>\\'; }\\n  }\\n  loxia.render(MyWidget, window.__loxiaInitialProps);'),
        'render'
      );
    }
  } catch (err) {
    window.__loxiaReportError(err, 'render');
  }
})();
</script>
</body>
</html>`;
}

function buildJsxSrcdoc({ runtime, agentCode, initialProps, widgetId, themeTokens }) {
  const tokensCss = Object.entries(themeTokens).map(([k, v]) => `--${k}:${v};`).join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP_JSX}" />
<style>
  html,body{margin:0;padding:0;background:transparent;color:rgb(var(--gray-900));
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;}
  :root{${tokensCss}}
  *{box-sizing:border-box;}
  #root{padding:12px;}
</style>
</head>
<body>
<div id="root"></div>

<!--
  SCRIPT 1 — runs BEFORE the runtime so it catches runtime-bundle errors.
  Installs window.__loxiaReportError, a window.onerror handler, and an
  unhandledrejection handler. If the runtime <script> below throws at
  top level (parse or eval), those handlers catch it and post back a
  clear "runtime-setup" error instead of letting the failure cascade
  into an opaque "window.loxia is undefined" mystery in SCRIPT 3.
-->
<script>
(function(){
  var WIDGET_ID = ${JSON.stringify(widgetId)};
  window.__loxiaWidgetId = WIDGET_ID;
  window.__loxiaInitialProps = ${JSON.stringify(initialProps || {})};

  var MAX_UNIQUE = 5, MAX_MSG_LEN = 500;
  var seen = Object.create(null), uniqueCount = 0, suppressedCount = 0;

  window.__loxiaReportError = function(err, phase) {
    var msg = (err && (err.message || err.toString())) || 'unknown error';
    msg = String(msg).slice(0, MAX_MSG_LEN);
    var stack = (err && err.stack) ? String(err.stack).slice(0, 2000) : null;
    var sig = phase + '|' + msg;
    // Mark that SOME error occurred — SCRIPT 3 checks this to avoid
    // overwriting a more-informative earlier error with a generic
    // "runtime-setup" diagnostic.
    window.__loxiaHadError = true;
    // Only update the inline display the FIRST time — the first error is
    // almost always the root cause (a parse/eval failure in SCRIPT 2),
    // and later errors are usually downstream consequences of it.
    if (uniqueCount === 0 && !seen[sig]) {
      try {
        var root = document.getElementById('root') || document.body;
        var badge = suppressedCount > 0
          ? '<div style="color:#888;font-size:10px;margin-top:4px">(' + suppressedCount + ' repeated errors suppressed)</div>'
          : '';
        if (root) root.innerHTML =
          '<pre style="color:#c00;white-space:pre-wrap;font-size:12px;font-family:monospace;padding:8px">widget error (' + phase + '): '
          + msg.replace(/[&<>]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];})
          + '</pre>' + badge;
      } catch(_){}
    }
    if (seen[sig]) { seen[sig]++; suppressedCount++; return; }
    if (uniqueCount >= MAX_UNIQUE) { suppressedCount++; return; }
    seen[sig] = 1; uniqueCount++;
    try {
      window.parent.postMessage({
        __loxia: true, type: 'error', widgetId: WIDGET_ID,
        phase: phase, message: msg, stack: stack,
      }, '*');
    } catch(_){}
    try {
      window.parent.postMessage({
        __loxia: true, type: 'resize', widgetId: WIDGET_ID,
        height: document.body.scrollHeight,
      }, '*');
    } catch(_){}
  };

  window.addEventListener('error', function(e){
    window.__loxiaReportError(e.error || new Error(e.message || 'runtime error'), 'runtime');
  });
  window.addEventListener('unhandledrejection', function(e){
    window.__loxiaReportError(e.reason || new Error('unhandled rejection'), 'async');
  });
})();
</script>

<!--
  SCRIPT 2 — the runtime bundle, wrapped in a try/catch so we capture
  the specific error if something inside throws during initialisation.
  Without the wrap, a bundle-level throw fires window.onerror but also
  leaves window.loxia undefined, and SCRIPT 3 then reports a generic
  "runtime failed to initialise" instead of the actual cause.
-->
<script>
try {
${runtime}
  window.__loxiaBundleCompleted = true;
} catch (err) {
  window.__loxiaBundleError = err;
  if (window.__loxiaReportError) {
    window.__loxiaReportError(err, 'runtime-setup');
  }
}
</script>

<!-- SCRIPT 3 — agent's widget code. -->
<script>
(function(){
  // Sanity check the runtime. If SCRIPT 2's wrapper already reported a
  // specific error, stay silent here (avoid duplicate reports). Otherwise
  // include a diagnostic snapshot so if this fires, we know how far the
  // bundle got — which globals made it, which didn't.
  if (!window.loxia || typeof window.loxia.render !== 'function') {
    // If an earlier error was already reported (bundle parse/eval),
    // don't pile on with a generic "runtime-setup" message — that first
    // error is the root cause and more useful.
    if (window.__loxiaHadError || window.__loxiaBundleError) return;
    var diag = {
      hasH:           typeof window.h,
      hasHtml:        typeof window.html,
      hasLoxia:       typeof window.loxia,
      bundleCompleted: !!window.__loxiaBundleCompleted,
    };
    window.__loxiaReportError(
      new Error('widget runtime failed to initialise — window.loxia is not available. Diagnostic: ' + JSON.stringify(diag) + '. This usually means the runtime bundle threw silently. Try a simpler render or report the bug.'),
      'runtime-setup'
    );
    return;
  }
  // Treat the entire agent code block as the BODY of a render function,
  // not an IIFE that runs once. Critical for hooks: useState etc. must
  // run on every render, with the same call order, so they re-read their
  // cells. Previously we ran the code once as an IIFE, captured the
  // returned vnode (with hooks frozen at their initial values), and
  // re-rendered that static vnode — defeating hooks entirely.
  //
  // This wrapping supports BOTH common agent patterns:
  //   (A) return html\`<div>\${count}</div>\`;          ← body-style
  //   (B) return function App(props) { return html\`…\`; };  ← factory-style
  //
  // For (A): userComponent(props) returns a vnode each call — perfect.
  // For (B): userComponent(props) returns a FUNCTION. We detect that in
  //          loxia.render and promote the inner function to the actual
  //          component on the first call.
  try {
    var userComponent = function(props) {
${agentCode}
    };
    window.loxia.render(userComponent, window.__loxiaInitialProps);
  } catch (err) {
    window.__loxiaReportError(err, 'render');
  }
})();
</script>
</body>
</html>`;
}

function buildHtmlSrcdoc({ markup, themeTokens }) {
  const tokensCss = Object.entries(themeTokens).map(([k, v]) => `--${k}:${v};`).join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP_HTML}" />
<style>
  html,body{margin:0;padding:0;background:transparent;color:rgb(var(--gray-900));
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;}
  :root{${tokensCss}}
  *{box-sizing:border-box;}
</style>
</head>
<body>${markup}</body>
</html>`;
}

// ── Main component ────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {'html'|'jsx'} props.kind
 * @param {string} props.content
 * @param {object} [props.initialProps]
 * @param {string} props.widgetId
 * @param {string} [props.agentName]
 * @param {(payload: any) => void} [props.onEvent] — handler for widget events
 * @param {boolean} [props.stripToStatic] — force html-mode rendering
 *                                           (used when user revokes scripts)
 */
function IframeWidget({
  kind,
  content,
  initialProps,
  widgetId,
  agentName,
  onEvent,
  stripToStatic = false,
  // When `stripToStatic && kind === 'jsx'`, the iframe would be a blank
  // "preview" of a render function. Instead we show a placeholder with
  // a prompt to grant trust. Callers (chat, gallery) pass a button/link
  // element that triggers their own trust-elevation UI.
  trustPlaceholderCTA,
  updateSignal, // parent can bump this to trigger postMessage update
  updateProps,
  // Render mode. Default `card` is the standalone in-chat presentation
  // (border + rounded + chrome bar with kind chip + "view source"). When
  // the parent already provides its own card chrome (gallery cards,
  // future preview tiles), pass `embedded` to drop the outer border and
  // the chrome bar so we don't end up with a card-inside-a-card.
  variant = 'card',
}) {
  const iframeRef = useRef(null);
  const paneRef = useRef(null);
  const [height, setHeight] = useState(80);
  // True once the user has manually dragged the resize handle — from that
  // point we stop auto-applying the iframe's measured height, so the
  // widget stops "jumping" back every time the iframe fires a resize.
  const [userSized, setUserSized] = useState(false);
  const [error, setError] = useState(null);
  // Non-fatal lint findings from the runtime (typo detector, missing
  // method on data-on-*, etc.). Each entry: { phase, message }. Capped
  // at MAX_WARNINGS so a re-rendering widget can't grow this unbounded.
  const [warnings, setWarnings] = useState([]);
  const [srcdoc, setSrcdoc] = useState(null);
  const [showSource, setShowSource] = useState(false);

  const effectiveKind = stripToStatic ? 'html' : kind;

  // Build the srcdoc. For jsx we need the runtime fetched first.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSrcdoc(null);
    const tokens = themeTokensFromDocument();

    (async () => {
      try {
        if (effectiveKind === 'jsx') {
          const runtime = await fetchRuntimeOnce('jsx');
          if (cancelled) return;
          setSrcdoc(buildJsxSrcdoc({ runtime, agentCode: content, initialProps, widgetId, themeTokens: tokens }));
        } else if (effectiveKind === 'webcomponent') {
          const runtime = await fetchRuntimeOnce('wc');
          if (cancelled) return;
          setSrcdoc(buildWebComponentSrcdoc({ runtime, agentCode: content, initialProps, widgetId, themeTokens: tokens }));
        } else {
          setSrcdoc(buildHtmlSrcdoc({
            markup: effectiveKind === 'html' && stripToStatic
              // When stripping scripts, we can only show what the original
              // content had as HTML. Not perfect — just enough for the
              // "I no longer trust this agent, keep the look" path.
              ? `<div style="opacity:.7"><em>[scripts stripped]</em><br/>${escapeHtml(content).slice(0, 2000)}</div>`
              : content,
            themeTokens: tokens,
          }));
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      }
    })();

    return () => { cancelled = true; };
  }, [effectiveKind, content, widgetId, JSON.stringify(initialProps), stripToStatic]);

  // Listen for postMessage from this specific iframe.
  useEffect(() => {
    function onMessage(e) {
      // Authenticate by source — origin is always "null" so cannot be used.
      if (!iframeRef.current) return;
      if (e.source !== iframeRef.current.contentWindow) return;
      if (!e.data || e.data.__loxia !== true) return;
      if (e.data.widgetId && e.data.widgetId !== widgetId) return;

      if (e.data.type === 'resize' && typeof e.data.height === 'number') {
        // Auto-height is an INITIAL convenience. Once the user has
        // manually dragged the resize handle, they own the size —
        // ignore further auto-resize messages so the widget doesn't
        // fight their chosen dimensions.
        if (userSized) return;
        const h = Math.max(40, Math.min(e.data.height + 4 /* safety */, 3000));
        setHeight(h);
      } else if (e.data.type === 'event') {
        if (typeof onEvent === 'function') {
          try { onEvent(e.data.payload); } catch (err) { console.warn('[widget] onEvent handler threw', err); }
        }
      } else if (e.data.type === 'warning') {
        // Non-fatal lint finding. Log to console; surface as a small
        // chip in the chrome so the user/agent see it without the
        // widget being replaced by a red error screen.
        const msg = String(e.data.message || '').slice(0, 500);
        const phase = String(e.data.phase || 'lint');
        try { console.warn('[widget warning]', phase, msg); } catch (_) {}
        setWarnings(prev => {
          if (prev.find(w => w.message === msg)) return prev;   // dedup
          if (prev.length >= 5) return prev;                    // cap
          return [...prev, { phase, message: msg }];
        });
        // Forward to the agent too — same as errors — so the agent's
        // next turn sees lint findings and can fix them. Phase 'lint'
        // distinguishes from runtime errors so the agent can choose
        // whether to retry the render.
        if (typeof onEvent === 'function') {
          try { onEvent({ __widgetWarning: true, phase, message: msg }); }
          catch (err) { console.warn('[widget] onEvent (warning) handler threw', err); }
        }
      } else if (e.data.type === 'error') {
        // Runtime error inside the iframe — surface it in our chrome AND
        // forward it through the event channel so the agent's next turn
        // sees the failure (without this, tool-call says success=true but
        // the iframe is broken, and the agent thinks it shipped).
        setError(`widget error (${e.data.phase || 'runtime'}): ${e.data.message}`);
        if (typeof onEvent === 'function') {
          try {
            onEvent({
              __widgetError: true,
              phase: e.data.phase,
              message: e.data.message,
              stack: e.data.stack,
            });
          } catch (err) { console.warn('[widget] onEvent (error) handler threw', err); }
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [widgetId, onEvent, userSized]);

  // Push prop updates to the iframe when parent requests.
  useEffect(() => {
    if (!iframeRef.current || updateProps == null) return;
    try {
      iframeRef.current.contentWindow?.postMessage(
        { __loxia: true, type: 'update', widgetId, props: updateProps },
        '*'
      );
    } catch (err) {
      console.warn('[widget] update postMessage failed', err);
    }
  }, [updateSignal, widgetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Both jsx and webcomponent need scripts; html is sandbox="" (no scripts);
  // stripToStatic forces sandbox="" regardless.
  const needsScripts = (effectiveKind === 'jsx' || effectiveKind === 'webcomponent') && !stripToStatic;
  const sandbox = needsScripts ? 'allow-scripts' : '';
  const chipLabel = stripToStatic ? 'scripts stripped'
    : effectiveKind === 'jsx' ? 'custom code (jsx)'
    : effectiveKind === 'webcomponent' ? 'custom code (web component)'
    : 'custom html';
  const chipColor = stripToStatic ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
    : effectiveKind === 'jsx' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
    : effectiveKind === 'webcomponent' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';

  // Detect a manual resize: when the user releases the native handle,
  // compare the pane's DOM size against our state height. If it differs
  // by more than noise, mark userSized — auto-height stops fighting them.
  const onPaneMouseUp = () => {
    const el = paneRef.current;
    if (!el) return;
    const actual = el.offsetHeight;
    if (Math.abs(actual - height) > 4) {
      setHeight(actual);
      setUserSized(true);
    }
  };
  const resetSize = () => {
    setUserSized(false);
    // Nudge iframe to re-report its natural height. Easiest: post a
    // no-op update message which causes our runtime's debounced
    // ResizeObserver to recompute and re-send its height.
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { __loxia: true, type: 'update', widgetId, props: {} },
        '*'
      );
    } catch {}
  };

  // `embedded` strips the outer card chrome (border + header bar) so a
  // parent that's already a card (e.g. WidgetGalleryPage cards) doesn't
  // produce a nested-card visual. We still keep "View source" reachable
  // via a tiny absolutely-positioned button so the user can audit code.
  const isEmbedded = variant === 'embedded';
  const rootClass = isEmbedded
    ? 'relative'
    : 'my-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900';

  return (
    <div className={rootClass}>
      {!isEmbedded && (
        /* Non-dismissible chrome — user can always tell this is agent code. */
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-xs">
          <ShieldExclamationIcon className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-gray-600 dark:text-gray-400">
            agent-generated · <span className="font-mono">{agentName || 'unknown'}</span>
          </span>
          <span className={`ml-1 px-1.5 py-0.5 rounded font-mono ${chipColor}`}>{chipLabel}</span>
          {warnings.length > 0 && (
            <span
              className="ml-1 px-1.5 py-0.5 rounded font-mono bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 cursor-help"
              title={warnings.map(w => `[${w.phase}] ${w.message}`).join('\n\n')}
              data-testid="widget-warnings-chip"
            >
              {warnings.length} warning{warnings.length === 1 ? '' : 's'}
            </span>
          )}
          <div className="flex-1" />
          {userSized && (
            <button
              type="button"
              onClick={resetSize}
              className="p-1 rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 text-[11px] font-medium"
              title="Reset to auto-height"
              aria-label="Reset size"
            >
              auto
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSource(true)}
            className="p-1 rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
            title="View source"
            aria-label="View widget source"
          >
            <CodeBracketIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {isEmbedded && (
        /* Compact "view source" affordance for the embedded variant —
           floats over the iframe so the parent's chrome owns the rest. */
        <button
          type="button"
          onClick={() => setShowSource(true)}
          className="absolute top-1 right-1 z-10 p-1 rounded bg-white/80 dark:bg-gray-800/80 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-white dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700"
          title="View source"
          aria-label="View widget source"
          data-testid="iframe-view-source-embedded"
        >
          <CodeBracketIcon className="w-3.5 h-3.5" />
        </button>
      )}

      {error ? (
        <div className="p-3 text-sm text-red-600 dark:text-red-400">
          Widget failed to load: {error}
        </div>
      ) : (stripToStatic && (kind === 'jsx' || kind === 'webcomponent')) ? (
        // A JSX widget rendered with scripts stripped is almost always
        // visually empty or confusing — the agent's code is a render
        // function, not static HTML. Showing the raw source dump
        // ("[scripts stripped] return function App(props) {...}") was
        // the earlier behaviour and it reads like a broken widget.
        //
        // Replace that with a deliberate placeholder: a friendly message
        // that says "preview not available, scripts required" and, if the
        // parent provided a trust CTA, a button to elevate trust. The
        // user isn't staring at a blank card wondering what's wrong.
        <div
          className="p-6 flex flex-col items-center justify-center gap-3 text-center bg-gray-50 dark:bg-gray-800/50"
          style={{ minHeight: '140px' }}
          data-testid="widget-preview-placeholder"
        >
          <EyeSlashIcon className="w-8 h-8 text-gray-400" />
          <div className="text-sm text-gray-700 dark:text-gray-200 font-medium">
            Preview not available
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 max-w-sm">
            This is an interactive widget — it needs JavaScript to render.
            Showing a static preview would be blank or misleading, so we
            don&apos;t try. Grant trust to run it.
          </div>
          {trustPlaceholderCTA && (
            <div className="mt-1">{trustPlaceholderCTA}</div>
          )}
        </div>
      ) : srcdoc ? (
        // Resizable pane: `resize: both` gives a native drag handle in the
        // bottom-right corner. overflow:hidden is required for the handle
        // to appear. min-width/min-height keep the widget usable; we do
        // NOT set a max so users can go as big as they like.
        <div
          ref={paneRef}
          onMouseUp={onPaneMouseUp}
          onTouchEnd={onPaneMouseUp}
          style={{
            height: `${height}px`,
            minHeight: '60px',
            minWidth: '240px',
            resize: 'both',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <iframe
            ref={iframeRef}
            title={`Widget ${widgetId}`}
            srcDoc={srcdoc}
            sandbox={sandbox}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              display: 'block',
              background: 'transparent',
            }}
          />
        </div>
      ) : (
        <div className="p-3 text-xs text-gray-400 italic">Preparing widget…</div>
      )}

      {showSource && (
        <SourceModal
          widgetId={widgetId}
          kind={effectiveKind}
          content={content}
          onClose={() => setShowSource(false)}
        />
      )}
    </div>
  );
}

function SourceModal({ widgetId, kind, content, onClose }) {
  const modal = (
    <div
      // Same z-index ladder as ConfirmationModal — above messages / widgets.
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="relative max-w-3xl w-full max-h-[80vh] flex flex-col bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
          <CodeBracketIcon className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{widgetId}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">({kind})</span>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close">
            <XMarkIcon className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-3 text-xs font-mono bg-gray-50 dark:bg-gray-950 text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
          {content}
        </pre>
      </div>
    </div>
  );
  // Portal out of the message stacking context — same reason as ConfirmationModal.
  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default IframeWidget;
