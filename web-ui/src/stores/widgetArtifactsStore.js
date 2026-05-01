/**
 * Widget Artifacts Store — separate from artifactsStore (which tracks
 * filesystem writes) because widgets have their own lifecycle:
 *
 *   - Each `widget.render` call appends a VERSION to a widget identified
 *     by `widgetId`. Many renders → one artifact, many versions.
 *   - The user can pick which version is "main" via `widget.set-main`.
 *   - The artifacts panel renders a card per widget; click → opens a
 *     sheet with the live widget + version dropdown.
 *   - Chat-feed dedup: the FIRST occurrence of `(agentId, widgetId)`
 *     in the message timeline shows the inline iframe; subsequent
 *     ones get a one-line "📦 Updated" summary. The store tracks
 *     "is this the latest message for this widget?" so the renderer
 *     can decide.
 *
 * Source of truth is the backend (the WidgetTool's per-agent map).
 * The frontend caches what it has seen + fetches fresh state when the
 * artifacts panel opens.
 */

import { create } from 'zustand';

/**
 * Shape of a cached widget summary (matches the backend `list` output).
 *
 * @typedef {Object} WidgetSummary
 * @property {string}   widgetId
 * @property {'html'|'jsx'|'webcomponent'} kind
 * @property {string}   createdAt
 * @property {string}   updatedAt
 * @property {string}   lastRenderedAt
 * @property {number}   size
 * @property {string[]} phishingHits
 * @property {number}   versionCount
 * @property {string}   mainVersionId
 * @property {string|null}  linkedGalleryTemplateId
 * @property {number|null}  linkedGalleryVersion
 * @property {boolean}  divergedFromGallery
 */

/**
 * Shape of a single rendered-widget tool-call observation in the chat.
 * The store uses these to compute "is this message the latest render of
 * this widget?" — only the latest renders inline, the rest collapse.
 */
const useWidgetArtifactsStore = create((set, get) => ({
  // Map<agentId, Map<widgetId, WidgetSummary>>
  byAgent: new Map(),

  // Set<`agentId::widgetId::messageId`> for chat-dedup. We mark which
  // (agent, widget, message) tuple is the LATEST render in the message
  // timeline; only those render inline. The rest collapse.
  // Built lazily by chat-feed code via `markRenderObservation` / `latestRenderKey`.
  latestRenderByWidget: new Map(), // Map<`agentId::widgetId`, messageId>

  // Currently-open artifact in the panel sheet (for full-size view).
  openArtifact: null, // { agentId, widgetId } | null

  /**
   * Replace the cached summary list for an agent. Called by the
   * artifacts panel when it fetches /api/widget/audit (or via
   * targeted refreshes after render/set-main events).
   */
  setSummariesForAgent: (agentId, summaries) => {
    if (!agentId) return;
    set(state => {
      const byAgent = new Map(state.byAgent);
      const inner = new Map();
      for (const s of (summaries || [])) {
        if (s && s.widgetId) inner.set(s.widgetId, s);
      }
      byAgent.set(agentId, inner);
      return { byAgent };
    });
  },

  /**
   * Merge a single widget summary (e.g. from a fresh render-result).
   * Cheaper than re-fetching the full audit just to update one widget.
   */
  upsertSummary: (agentId, summary) => {
    if (!agentId || !summary || !summary.widgetId) return;
    set(state => {
      const byAgent = new Map(state.byAgent);
      const inner = new Map(byAgent.get(agentId) || []);
      inner.set(summary.widgetId, summary);
      byAgent.set(agentId, inner);
      return { byAgent };
    });
  },

  /**
   * Remove a widget summary (called after destroy). No-op if not present.
   */
  removeSummary: (agentId, widgetId) => {
    if (!agentId || !widgetId) return;
    set(state => {
      const byAgent = new Map(state.byAgent);
      const inner = new Map(byAgent.get(agentId) || []);
      if (!inner.delete(widgetId)) return state; // unchanged
      byAgent.set(agentId, inner);
      return { byAgent };
    });
  },

  /**
   * Record that a particular chat message rendered widget X.
   *
   * MONOTONIC: only overwrites the recorded observation if the new id
   * compares GREATER than the recorded one (lexical, which is correct
   * for ISO 8601 timestamps and any chronologically-monotonic id).
   *
   * Why monotonic and not "last writer wins": the chat feed mounts
   * renderers in arbitrary order (React reconciliation, scroll-driven
   * windowing, etc). If an older-message renderer mounts AFTER the
   * newer one, last-writer would incorrectly demote the newer one.
   * Monotonic guarantees the latest ALWAYS wins regardless of mount
   * order.
   */
  markRenderObservation: (agentId, widgetId, messageId) => {
    if (!agentId || !widgetId || !messageId) return;
    set(state => {
      const key = `${agentId}::${widgetId}`;
      const current = state.latestRenderByWidget.get(key);
      // Skip if our id isn't strictly newer than what's already there.
      // String comparison works because ISO timestamps are lexically
      // ordered; non-timestamp ids sort deterministically too.
      if (current && messageId <= current) return state;
      const next = new Map(state.latestRenderByWidget);
      next.set(key, messageId);
      return { latestRenderByWidget: next };
    });
  },

  /**
   * Predicate the chat renderer calls per render-block: is THIS
   * messageId the most-recent render for (agentId, widgetId)? If not,
   * the renderer shows a one-line "📦 Updated" stub instead of the
   * full iframe.
   */
  isLatestRender: (agentId, widgetId, messageId) => {
    const recorded = get().latestRenderByWidget.get(`${agentId}::${widgetId}`);
    // If we haven't seen any observation, treat the first one we see
    // (the caller) as the latest by default.
    if (!recorded) return true;
    return recorded === messageId;
  },

  openInPanel: ({ agentId, widgetId }) => set({ openArtifact: { agentId, widgetId } }),
  closePanel: () => set({ openArtifact: null }),

  /**
   * Fetch the audit (server source of truth) for one agent and load
   * the summaries into the store. Used when the panel opens or after
   * a render/destroy notification. Failure is tolerated — UI keeps
   * showing whatever it had cached.
   */
  fetchForAgent: async (agentId) => {
    if (!agentId) return;
    try {
      const res = await fetch(`/api/widget/audit?agentId=${encodeURIComponent(agentId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.widgets)) {
        get().setSummariesForAgent(agentId, data.widgets);
      }
    } catch (err) {
      console.warn('[widgetArtifacts] fetchForAgent failed:', err.message);
    }
  },

  /**
   * Clear ALL cached state. Used when the user clears the chat or
   * switches sessions — old widget observations would otherwise
   * persist and surprise the user.
   */
  clearAll: () => set({
    byAgent: new Map(),
    latestRenderByWidget: new Map(),
    openArtifact: null,
  }),

  // ── Convenience selectors (called by components, not external code) ──

  /** All summaries for one agent, sorted newest first. */
  getSummariesForAgent: (agentId) => {
    const inner = get().byAgent.get(agentId);
    if (!inner) return [];
    return Array.from(inner.values()).sort((a, b) => {
      // Sort by lastRenderedAt desc — newest first
      const at = a.lastRenderedAt || a.updatedAt || a.createdAt || '';
      const bt = b.lastRenderedAt || b.updatedAt || b.createdAt || '';
      return bt.localeCompare(at);
    });
  },

  /** Total count across all agents — for the panel's tab badge. */
  getTotalCount: () => {
    let n = 0;
    for (const inner of get().byAgent.values()) n += inner.size;
    return n;
  },
}));

// Register on window for cross-store access (mirrors __artifactsStore).
// Used by appStore.handleWebSocketMessage to apply backend `widget_changed`
// pushes without a circular import.
if (typeof window !== 'undefined') {
  window.__widgetArtifactsStore = useWidgetArtifactsStore;
}

export default useWidgetArtifactsStore;
