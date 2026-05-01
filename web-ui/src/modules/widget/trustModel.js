/**
 * Widget trust ladder — one source of truth for whether a given widget
 * should run JavaScript, shared between the gallery and (eventually) the
 * chat feed.
 *
 * FOUR LEVELS, least → most privilege:
 *
 *   0  Static preview  — no trust; JSX widgets render with stripToStatic
 *                        so the user sees the shape but handlers don't run.
 *                        This is the default for every JSX widget.
 *
 *   1  Trust this widget (per-template)  — stored in localStorage under
 *                        `loxia-widget-trust-template-<templateId>`. Covers
 *                        one specific widget forever.
 *
 *   2  Trust this agent — now (per-agent, this "app-session")
 *                        Stored in sessionStorage so it's wiped when all
 *                        tabs close. Cross-tab sync via BroadcastChannel
 *                        so turning it on in one tab immediately lights up
 *                        every other tab and stays lit until the last tab
 *                        closes.
 *
 *   3  Trust this agent — forever (per-agent, persistent)
 *                        `localStorage` under `loxia-widget-trust-agent-<id>`.
 *                        This is the "not recommended" option.
 *
 * `isTrusted` returns true if ANY level 1/2/3 signal matches. Chat and
 * gallery both call it to decide whether to pass stripToStatic=true.
 *
 * Forward-compat: adding a level 4 (e.g. "trust all widgets from this
 * team") is one extra lookup in isTrusted + one extra key prefix.
 */

import { useState, useEffect } from 'react';

// ── storage keys ───────────────────────────────────────────────────────

const KEY_TEMPLATE  = 'loxia-widget-trust-template-';     // level 1 — localStorage
const KEY_AGENT_SESSION = 'loxia-widget-trust-agent-';    // level 2 — sessionStorage, suffix -session
const KEY_AGENT_FOREVER = 'loxia-widget-trust-agent-';    // level 3 — localStorage
const SESSION_SUFFIX = '-session';

// ── safe storage accessors (some sandboxed contexts throw on access) ──

function lsGet(k)    { try { return localStorage.getItem(k); }    catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); }        catch { /* quota / private mode */ } }
function lsDel(k)    { try { localStorage.removeItem(k); }        catch {} }
function ssGet(k)    { try { return sessionStorage.getItem(k); }  catch { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); }      catch {} }
function ssDel(k)    { try { sessionStorage.removeItem(k); }      catch {} }

// ── cross-tab session-trust sync (BroadcastChannel) ──────────────────

const CHANNEL_NAME = 'loxia-widget-trust';
let _channel = null;
function getChannel() {
  if (_channel !== null) return _channel;
  try {
    _channel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(CHANNEL_NAME) : false;
  } catch { _channel = false; }
  return _channel || null;
}

const _listeners = new Set();
/**
 * Subscribe to trust-state changes from this tab OR other tabs. Used by
 * React components to re-render when trust flips (e.g. Tab A grants
 * session-trust for agent X → Tab B's gallery card lights up instantly).
 *
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onTrustChange(fn) {
  _listeners.add(fn);
  ensureChannelWired();
  return () => _listeners.delete(fn);
}
function notify() { for (const fn of _listeners) { try { fn(); } catch {} } }

let _channelWired = false;
function ensureChannelWired() {
  if (_channelWired) return;
  const ch = getChannel();
  if (!ch) { _channelWired = true; return; }
  ch.onmessage = (e) => {
    const data = e.data || {};
    switch (data.type) {
      case 'session-trust-added': {
        if (data.agentId) ssSet(KEY_AGENT_SESSION + data.agentId + SESSION_SUFFIX, 'true');
        notify();
        break;
      }
      case 'session-trust-revoked': {
        if (data.agentId) ssDel(KEY_AGENT_SESSION + data.agentId + SESSION_SUFFIX);
        notify();
        break;
      }
      case 'widget-trust-changed': {
        // template-scope change — mirror into localStorage IS already done
        // locally on every tab (localStorage is shared), but we still
        // need to notify listeners of the change.
        notify();
        break;
      }
      case 'request-session-trust-snapshot': {
        // A fresh tab wants to catch up — respond with our agents.
        const agents = [];
        for (let i = 0; i < (sessionStorage.length || 0); i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(KEY_AGENT_SESSION) && k.endsWith(SESSION_SUFFIX)) {
            agents.push(k.slice(KEY_AGENT_SESSION.length, -SESSION_SUFFIX.length));
          }
        }
        if (agents.length > 0) {
          try { ch.postMessage({ type: 'session-trust-snapshot', agents }); } catch {}
        }
        break;
      }
      case 'session-trust-snapshot': {
        // Some sibling tab just told us their session-trusted agents — merge.
        if (Array.isArray(data.agents)) {
          let changed = false;
          for (const agentId of data.agents) {
            const k = KEY_AGENT_SESSION + agentId + SESSION_SUFFIX;
            if (!ssGet(k)) { ssSet(k, 'true'); changed = true; }
          }
          if (changed) notify();
        }
        break;
      }
    }
  };
  _channelWired = true;
  // Ask siblings for their snapshot so a freshly-opened tab inherits
  // the current "Now" trust without the user re-granting.
  try { ch.postMessage({ type: 'request-session-trust-snapshot' }); } catch {}
}

function broadcast(msg) {
  const ch = getChannel();
  if (!ch) return;
  try { ch.postMessage(msg); } catch {}
}

// ── public API ────────────────────────────────────────────────────────

/**
 * Is a widget authorised to run scripts?
 * @param {{ templateId?: string, widgetId?: string, agentId?: string }} target
 * @returns {boolean}
 */
export function isTrusted({ templateId, widgetId, agentId } = {}) {
  const tid = templateId || widgetId;
  if (tid && lsGet(KEY_TEMPLATE + tid) === 'true') return true;             // level 1
  if (agentId && ssGet(KEY_AGENT_SESSION + agentId + SESSION_SUFFIX) === 'true') return true; // level 2
  if (agentId && lsGet(KEY_AGENT_FOREVER + agentId) === 'true') return true;                  // level 3
  return false;
}

/** What level granted the trust (or 0 if none). Useful for UI copy. */
export function trustLevel({ templateId, widgetId, agentId } = {}) {
  const tid = templateId || widgetId;
  if (agentId && lsGet(KEY_AGENT_FOREVER + agentId) === 'true') return 3;
  if (agentId && ssGet(KEY_AGENT_SESSION + agentId + SESSION_SUFFIX) === 'true') return 2;
  if (tid && lsGet(KEY_TEMPLATE + tid) === 'true') return 1;
  return 0;
}

export function trustWidget(templateOrWidgetId) {
  if (!templateOrWidgetId) return;
  lsSet(KEY_TEMPLATE + templateOrWidgetId, 'true');
  notify();
  broadcast({ type: 'widget-trust-changed', templateId: templateOrWidgetId });
}
export function revokeWidget(templateOrWidgetId) {
  if (!templateOrWidgetId) return;
  lsDel(KEY_TEMPLATE + templateOrWidgetId);
  notify();
  broadcast({ type: 'widget-trust-changed', templateId: templateOrWidgetId });
}

export function trustAgentSession(agentId) {
  if (!agentId) return;
  ssSet(KEY_AGENT_SESSION + agentId + SESSION_SUFFIX, 'true');
  notify();
  broadcast({ type: 'session-trust-added', agentId });
}
export function trustAgentForever(agentId) {
  if (!agentId) return;
  lsSet(KEY_AGENT_FOREVER + agentId, 'true');
  notify();
  broadcast({ type: 'widget-trust-changed', agentId });
}
export function revokeAgentSession(agentId) {
  if (!agentId) return;
  ssDel(KEY_AGENT_SESSION + agentId + SESSION_SUFFIX);
  notify();
  broadcast({ type: 'session-trust-revoked', agentId });
}
export function revokeAgentForever(agentId) {
  if (!agentId) return;
  lsDel(KEY_AGENT_FOREVER + agentId);
  notify();
  broadcast({ type: 'widget-trust-changed', agentId });
}
/** Revoke BOTH session + forever trust for an agent. */
export function revokeAgent(agentId) {
  revokeAgentSession(agentId);
  revokeAgentForever(agentId);
}

/**
 * React hook: returns the current trust level for the given target AND
 * re-renders the component whenever the level changes (including cross-tab).
 */
export function useTrust(target) {
  const [level, setLevel] = useState(() => trustLevel(target));
  useEffect(() => {
    const recalc = () => setLevel(trustLevel(target));
    const unsubscribe = onTrustChange(recalc);
    // Also re-check on storage events (multi-tab localStorage changes
    // for levels 1 and 3 — session-level uses BroadcastChannel).
    const onStorage = (e) => {
      if (!e.key) return;
      if (e.key.startsWith('loxia-widget-trust-')) recalc();
    };
    window.addEventListener('storage', onStorage);
    recalc();
    return () => { unsubscribe(); window.removeEventListener('storage', onStorage); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target && target.templateId, target && target.widgetId, target && target.agentId]);
  return level;
}

// Exposed for unit tests. Not part of the public API.
export const __test__ = {
  KEY_TEMPLATE, KEY_AGENT_SESSION, KEY_AGENT_FOREVER, SESSION_SUFFIX,
};
