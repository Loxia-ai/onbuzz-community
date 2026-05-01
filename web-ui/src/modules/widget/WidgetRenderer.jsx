/**
 * WidgetRenderer — tool-call renderer for the `widget` tool.
 *
 * Mounted by the existing tool-renderer registry; receives the enriched
 * parsedData (tool invocation + tool result) and:
 *   1. Reads the widget record from the result
 *   2. Applies the first-use confirmation modal gate
 *   3. Mounts <IframeWidget> when allowed
 *   4. Forwards widget events to the agent via api.postWidgetEvent (sent
 *      as a synthetic user message tagged with the widget id)
 *
 * Respects per-agent localStorage decisions: "always" bypasses the modal,
 * "block" shows a placeholder instead of rendering.
 */

import React, { useState, useEffect, useMemo } from 'react';
import IframeWidget from './IframeWidget.jsx';
import ConfirmationModal, { getStoredDecision, storeDecision, clearDecision } from './ConfirmationModal.jsx';
import { scanForPhishingKeywords } from './phishingScanner.js';
import { useTrust, trustWidget, trustAgentSession } from './trustModel.js';
import { useAppStore } from '../../stores/appStore.js';
import useWidgetArtifactsStore from '../../stores/widgetArtifactsStore.js';
import { api } from '../../services/api.js';
import toast from 'react-hot-toast';
import { NoSymbolIcon, ArrowUpRightIcon } from '@heroicons/react/24/outline';

function WidgetRenderer({ parsedData, agentId: propAgentId, messageTimestamp }) {
  const { currentAgent } = useAppStore();
  const effectiveAgentId = propAgentId || currentAgent?.id || 'unknown';
  const agentName = currentAgent?.name || 'agent';

  const result = parsedData?._result;
  const widget = result?.widget;

  // Per-(agent, widget) chat-feed dedup: only the LATEST render of each
  // widget renders inline. Earlier renders collapse to a one-liner that
  // links to the artifacts panel. messageTimestamp is unique per
  // assistant turn — using it as the observation id is sufficient.
  // The store auto-treats unseen-as-latest, so this also works on
  // first-render (seamless).
  const observationId = messageTimestamp || (widget && widget.lastRenderedAt) || null;
  const markRenderObservation = useWidgetArtifactsStore(s => s.markRenderObservation);
  const upsertSummary = useWidgetArtifactsStore(s => s.upsertSummary);
  const openInPanel = useWidgetArtifactsStore(s => s.openInPanel);
  const isLatestRender = useWidgetArtifactsStore(s => s.isLatestRender);

  // Record this observation + cache the latest summary in the store
  // (so the artifacts panel reflects fresh state without an audit fetch).
  useEffect(() => {
    if (!widget || !widget.widgetId || !observationId) return;
    markRenderObservation(effectiveAgentId, widget.widgetId, observationId);
    // The render result includes versionCount + mainVersionId — perfect
    // for upserting the summary used by the panel cards.
    upsertSummary(effectiveAgentId, {
      widgetId:        widget.widgetId,
      kind:            widget.kind,
      createdAt:       widget.createdAt,
      updatedAt:       widget.updatedAt,
      lastRenderedAt:  widget.lastRenderedAt || widget.updatedAt,
      size:            widget.size,
      phishingHits:    widget.phishingHits || [],
      versionCount:    Array.isArray(widget.versions) ? widget.versions.length : (result.versionCount || 1),
      mainVersionId:   widget.mainVersionId || null,
      linkedGalleryTemplateId: widget.linkedGalleryTemplateId || null,
      linkedGalleryVersion:    widget.linkedGalleryVersion || null,
      divergedFromGallery:     !!widget.divergedFromGallery,
    });
  }, [effectiveAgentId, observationId, widget, result, markRenderObservation, upsertSummary]);

  // Local "allowed this render" state (independent of the persisted
  // decision — "allow once" doesn't store anything).
  const [localAllowed, setLocalAllowed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);

  // Trust ladder check — same source of truth as the gallery + sheet
  // surfaces. When the user grants trust elsewhere (gallery, sheet,
  // another tab via BroadcastChannel), this re-renders and removes
  // the script-stripped placeholder automatically.
  const widgetIdForTrust = widget?.widgetId;
  const trustLevel = useTrust({ widgetId: widgetIdForTrust, agentId: effectiveAgentId });
  const isTrusted = trustLevel > 0;
  const stripToStatic = !isTrusted;

  // Resolve the gate on mount and whenever agent/widget changes.
  useEffect(() => {
    if (!widget) return;
    const decision = getStoredDecision(effectiveAgentId);
    if (decision === 'always') { setLocalAllowed(true); setBlocked(false); return; }
    if (decision === 'block')  { setLocalAllowed(false); setBlocked(true);  return; }
    // No decision yet — pop the modal.
    setModalOpen(true);
    setLocalAllowed(false);
    setBlocked(false);
  }, [effectiveAgentId, widget?.widgetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const phishingHits = useMemo(
    () => widget ? scanForPhishingKeywords(widget.content) : [],
    [widget]
  );

  const handleDecision = (decision) => {
    storeDecision(effectiveAgentId, decision);
    setModalOpen(false);
    if (decision === 'block')  { setBlocked(true);  setLocalAllowed(false); }
    else                       {
      setBlocked(false); setLocalAllowed(true);
      // The agent-level "Allow" decision implies "I trust this agent for
      // the rest of this session" — grant level-2 trust so scripts run
      // immediately without the user having to also click a separate
      // trust button below the placeholder.
      if (decision === 'always' || decision === 'once') {
        trustAgentSession(effectiveAgentId);
      }
    }
  };

  const handleEvent = async (payload) => {
    // Push the widget event to the agent as a tool-result. We piggy-back
    // on the existing addToolResult / wake-on-message path; the agent
    // reads it from messageQueues.toolResults on the next scheduler tick.
    try {
      if (typeof api.postWidgetEvent === 'function') {
        await api.postWidgetEvent({
          agentId: effectiveAgentId,
          widgetId: widget.widgetId,
          payload,
        });
      } else {
        // API helper not present — log to console as a fallback.
        // (Agent still won't receive the event. Implement api.postWidgetEvent
        // alongside the widget routes to complete the round-trip.)
        console.info('[widget] event (no api.postWidgetEvent registered)', {
          widgetId: widget.widgetId, payload,
        });
      }
    } catch (err) {
      console.warn('[widget] postWidgetEvent failed', err);
      toast.error('Widget event could not be delivered to agent');
    }
  };

  if (!widget) {
    // Three reasons we might not have a widget:
    //   1. action was destroy/list/update → no widget to render (silent OK)
    //   2. tool returned { disabled: true } → agent lacks allowCustomCode
    //   3. tool returned an error      → validation/phishing/etc.
    //   4. result hasn't arrived yet   → still pending
    //
    // Case 1 is silent by design. Cases 2/3 deserve a visible hint so the
    // user isn't left staring at an empty spot below the tool call.
    const action = parsedData?.parameters?.action || 'render';
    if (action !== 'render') return null;                       // case 1
    if (!result) return null;                                   // case 4 — generic "Running…" chrome handles it

    if (result.disabled) {
      return (
        <div className="my-2 px-3 py-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-800 dark:text-amber-200">
          <strong>Widget not rendered:</strong> custom widgets are disabled for
          agent <span className="font-mono">{agentName}</span>. Open the agent&apos;s
          tool config → <strong>Widget</strong> → enable &quot;Allow custom widgets&quot;.
        </div>
      );
    }
    if (result.error || result.success === false) {
      return (
        <div className="my-2 px-3 py-2 rounded border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 text-xs text-rose-800 dark:text-rose-200">
          <strong>Widget error:</strong> {result.error || 'unknown failure'}
        </div>
      );
    }
    // Render call succeeded but result lacks widget field — shape mismatch.
    return (
      <div className="my-2 px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-300">
        <strong>Widget not rendered:</strong> tool returned success but no widget
        payload. (Result keys: {Object.keys(result).join(', ') || '∅'})
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="my-2 px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
        <NoSymbolIcon className="w-4 h-4 text-rose-500" />
        <span>Custom widgets from <span className="font-mono">{agentName}</span> are blocked.</span>
        <button
          type="button"
          onClick={() => { clearDecision(effectiveAgentId); setBlocked(false); setModalOpen(true); }}
          className="ml-auto text-xs underline text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
        >
          Undo
        </button>
      </div>
    );
  }

  // Chat-feed dedup: if this isn't the latest render of this widget,
  // collapse to a one-line stub with a link to the artifacts panel.
  // Avoids "1000 copies of the calculator" when the agent iterates.
  // The check is observation-id based, so re-renders by React don't
  // accidentally suppress this block (the SAME messageTimestamp is
  // always the latest for itself).
  const isLatest = observationId
    ? isLatestRender(effectiveAgentId, widget.widgetId, observationId)
    : true;
  if (!isLatest) {
    return (
      <div
        className="my-2 px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2"
        data-testid="widget-superseded"
      >
        <span aria-hidden>📦</span>
        <span>
          Widget <span className="font-mono">{widget.widgetId}</span> was updated.
          A newer version is rendered below.
        </span>
        <button
          type="button"
          onClick={() => openInPanel({ agentId: effectiveAgentId, widgetId: widget.widgetId })}
          className="ml-auto inline-flex items-center gap-1 text-xs underline text-loxia-600 hover:text-loxia-700 dark:text-loxia-400 dark:hover:text-loxia-300"
        >
          Open in Artifacts <ArrowUpRightIcon className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <>
      {modalOpen && (
        <ConfirmationModal
          agentName={agentName}
          agentId={effectiveAgentId}
          kind={widget.kind}
          content={widget.content}
          phishingHits={phishingHits}
          onDecide={handleDecision}
          onClose={() => setModalOpen(false)}
        />
      )}
      {localAllowed && (
        <IframeWidget
          kind={widget.kind}
          content={widget.content}
          initialProps={widget.props}
          widgetId={widget.widgetId}
          agentName={agentName}
          onEvent={handleEvent}
          stripToStatic={stripToStatic}
          trustPlaceholderCTA={stripToStatic ? (
            // Two grant levels — same shape as the gallery card and
            // the WidgetSheet trust bar so the user never has to hunt
            // for "where do I trust this?".
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <button
                type="button"
                onClick={() => trustWidget(widget.widgetId)}
                className="px-2.5 py-1 text-[11px] font-medium bg-amber-600 text-white rounded hover:bg-amber-700"
                data-testid="chat-trust-widget-btn"
              >
                Trust this widget
              </button>
              <button
                type="button"
                onClick={() => trustAgentSession(effectiveAgentId)}
                className="px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
                data-testid="chat-trust-agent-btn"
                title={`Trust everything ${agentName} renders for this session`}
              >
                Trust agent (session)
              </button>
            </div>
          ) : null}
        />
      )}
      {!localAllowed && !modalOpen && !blocked && (
        <div className="my-2 text-xs italic text-gray-400">Waiting for permission to render custom widget…</div>
      )}
    </>
  );
}

export default WidgetRenderer;
