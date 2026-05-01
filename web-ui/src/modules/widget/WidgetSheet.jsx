/**
 * WidgetSheet — full-size viewer for an artifact (one widget, with its
 * version history). Opens when the user clicks a card in
 * WidgetArtifactsSection. Lets the user:
 *
 *   - See the active version live (resizable iframe)
 *   - Switch which version is "main" (Phase 2 — set-main button)
 *   - Browse the version history (chronological dropdown)
 *
 * Mounts via portal — sits above the chat, below the global modals.
 *
 * Data flow:
 *   - Reads { agentId, widgetId } from widgetArtifactsStore.openArtifact
 *   - Fetches the FULL widget (with versions[]) from /api/widget/full
 *   - Local state: which version the user is currently viewing (defaults
 *     to mainVersionId)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, ClockIcon, StarIcon, ShareIcon, ArrowUturnLeftIcon, ArrowUpCircleIcon, PencilSquareIcon, CheckIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarSolid, ShareIcon as ShareSolid } from '@heroicons/react/24/solid';
import useWidgetArtifactsStore from '../../stores/widgetArtifactsStore.js';
import { useAppStore } from '../../stores/appStore.js';
import IframeWidget from './IframeWidget.jsx';
import { useTrust, trustWidget, trustAgentSession, revokeWidget, revokeAgentSession } from './trustModel.js';
import toast from 'react-hot-toast';

function timeAgo(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const seconds = Math.floor((Date.now() - t) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function WidgetSheet() {
  const openArtifact = useWidgetArtifactsStore(s => s.openArtifact);
  const closePanel = useWidgetArtifactsStore(s => s.closePanel);
  const upsertSummary = useWidgetArtifactsStore(s => s.upsertSummary);
  const currentAgent = useAppStore(s => s.currentAgent);

  const [widget, setWidget] = useState(null);
  const [viewVersionId, setViewVersionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Upgrade-available info from /api/widget/check-upgrade — null until checked.
  const [upgradeInfo, setUpgradeInfo] = useState(null);
  // Inline-rename state. `editingName` is null when not editing; otherwise
  // it's the in-progress string the user is typing. Submit on Enter or
  // blur; Escape cancels. Empty submission clears the name (revert to id).
  const [editingName, setEditingName] = useState(null);

  // Trust check — same ladder as chat. The sheet should respect the
  // user's prior trust decision; defaults to stripToStatic for safety.
  const trustLevel = useTrust({
    widgetId: openArtifact?.widgetId,
    agentId: openArtifact?.agentId,
  });
  const isTrusted = trustLevel > 0;

  // Fetch the full widget when openArtifact changes.
  useEffect(() => {
    if (!openArtifact) {
      setWidget(null);
      setViewVersionId(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/widget/full?agentId=${encodeURIComponent(openArtifact.agentId)}&widgetId=${encodeURIComponent(openArtifact.widgetId)}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) {
          setLoadError(data.error || `HTTP ${res.status}`);
          return;
        }
        setWidget(data.widget);
        setViewVersionId(data.widget.mainVersionId);
      } catch (err) {
        if (!cancelled) setLoadError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [openArtifact]);

  // Check whether an upgrade is available — only meaningful when the
  // widget is linked AND not diverged. Refresh whenever the widget's
  // linkage changes.
  useEffect(() => {
    if (!openArtifact || !widget) {
      setUpgradeInfo(null);
      return;
    }
    if (!widget.linkedGalleryTemplateId || widget.divergedFromGallery) {
      setUpgradeInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/widget/check-upgrade?agentId=${encodeURIComponent(openArtifact.agentId)}&widgetId=${encodeURIComponent(openArtifact.widgetId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.success) setUpgradeInfo(data);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [openArtifact, widget]);

  /**
   * Pull the latest gallery version into the local widget AS A NEW
   * VERSION (so the user can roll back via set-main if they regret it).
   */
  const handleApplyUpgrade = useCallback(async () => {
    if (!openArtifact) return;
    setBusy(true);
    try {
      const res = await fetch('/api/widget/apply-upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: openArtifact.agentId,
          widgetId: openArtifact.widgetId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      // Refresh widget — the new version is now in versions[]
      const fullRes = await fetch(`/api/widget/full?agentId=${encodeURIComponent(openArtifact.agentId)}&widgetId=${encodeURIComponent(openArtifact.widgetId)}`);
      const full = await fullRes.json();
      if (full.success) {
        setWidget(full.widget);
        setViewVersionId(full.widget.mainVersionId);
        upsertSummary(openArtifact.agentId, {
          widgetId:        full.widget.widgetId,
          kind:            full.widget.kind,
          createdAt:       full.widget.createdAt,
          updatedAt:       full.widget.updatedAt,
          lastRenderedAt:  full.widget.lastRenderedAt,
          size:            full.widget.size,
          phishingHits:    full.widget.phishingHits,
          versionCount:    full.widget.versions.length,
          mainVersionId:   full.widget.mainVersionId,
          linkedGalleryTemplateId: full.widget.linkedGalleryTemplateId,
          linkedGalleryVersion:    full.widget.linkedGalleryVersion,
          divergedFromGallery:     full.widget.divergedFromGallery,
        });
      }
      setUpgradeInfo(null); // we just applied — clear the prompt
      toast.success(`Upgraded from v${data.fromVersion} → v${data.toVersion}`);
    } catch (err) {
      toast.error(`Upgrade failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [openArtifact, upsertSummary]);

  /**
   * Share the widget's MAIN version to the gallery (frozen-at-share).
   * The local widget gets linked to the new template (`linkedGalleryTemplateId`)
   * so subsequent local renders can be detected as "diverged."
   */
  const handleShare = useCallback(async () => {
    if (!openArtifact || !widget) return;
    setBusy(true);
    try {
      const res = await fetch('/api/widget/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: openArtifact.agentId,
          widgetId: openArtifact.widgetId,
          // Default title = widgetId; user can edit later from the gallery page.
          title: openArtifact.widgetId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      // Re-fetch the full widget so local linkage state matches.
      const fullRes = await fetch(`/api/widget/full?agentId=${encodeURIComponent(openArtifact.agentId)}&widgetId=${encodeURIComponent(openArtifact.widgetId)}`);
      const full = await fullRes.json();
      if (full.success) setWidget(full.widget);
      // Mirror to the artifacts cache so the card chip updates instantly
      upsertSummary(openArtifact.agentId, {
        widgetId:        full.widget.widgetId,
        kind:            full.widget.kind,
        createdAt:       full.widget.createdAt,
        updatedAt:       full.widget.updatedAt,
        lastRenderedAt:  full.widget.lastRenderedAt,
        size:            full.widget.size,
        phishingHits:    full.widget.phishingHits,
        versionCount:    full.widget.versions.length,
        mainVersionId:   full.widget.mainVersionId,
        linkedGalleryTemplateId: full.widget.linkedGalleryTemplateId,
        linkedGalleryVersion:    full.widget.linkedGalleryVersion,
        divergedFromGallery:     full.widget.divergedFromGallery,
      });
      toast.success(`Shared to gallery as ${data.templateId}`);
    } catch (err) {
      toast.error(`Failed to share: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [openArtifact, widget, upsertSummary]);

  /**
   * Unshare — remove the linked template from the gallery. The local
   * widget keeps working but loses its upstream link.
   */
  const handleUnshare = useCallback(async () => {
    if (!openArtifact || !widget?.linkedGalleryTemplateId) return;
    setBusy(true);
    try {
      const tid = widget.linkedGalleryTemplateId;
      const res = await fetch(
        `/api/widget/gallery/${encodeURIComponent(tid)}?agentId=${encodeURIComponent(openArtifact.agentId)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      // Refresh local state — linkage is now null.
      const fullRes = await fetch(`/api/widget/full?agentId=${encodeURIComponent(openArtifact.agentId)}&widgetId=${encodeURIComponent(openArtifact.widgetId)}`);
      const full = await fullRes.json();
      if (full.success) {
        setWidget(full.widget);
        upsertSummary(openArtifact.agentId, {
          widgetId:        full.widget.widgetId,
          kind:            full.widget.kind,
          createdAt:       full.widget.createdAt,
          updatedAt:       full.widget.updatedAt,
          lastRenderedAt:  full.widget.lastRenderedAt,
          size:            full.widget.size,
          phishingHits:    full.widget.phishingHits,
          versionCount:    full.widget.versions.length,
          mainVersionId:   full.widget.mainVersionId,
          linkedGalleryTemplateId: full.widget.linkedGalleryTemplateId,
          linkedGalleryVersion:    full.widget.linkedGalleryVersion,
          divergedFromGallery:     full.widget.divergedFromGallery,
        });
      }
      toast.success('Unshared from gallery');
    } catch (err) {
      toast.error(`Failed to unshare: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [openArtifact, widget, upsertSummary]);

  /**
   * Promote the currently-viewed version to be the main one. Calls the
   * backend so the change is persisted and reflected in the artifacts
   * panel + chat dedup.
   */
  const handleSetMain = useCallback(async () => {
    if (!openArtifact || !viewVersionId || !widget) return;
    if (viewVersionId === widget.mainVersionId) return; // already main
    setBusy(true);
    try {
      const res = await fetch('/api/widget/set-main', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: openArtifact.agentId,
          widgetId: openArtifact.widgetId,
          versionId: viewVersionId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      // Patch local state — server returned the updated widget
      setWidget(data.widget);
      // Update the cached summary so the panel card reflects it too
      upsertSummary(openArtifact.agentId, {
        widgetId:        data.widget.widgetId,
        kind:            data.widget.kind,
        createdAt:       data.widget.createdAt,
        updatedAt:       data.widget.updatedAt,
        lastRenderedAt:  data.widget.lastRenderedAt,
        size:            data.widget.size,
        phishingHits:    data.widget.phishingHits,
        versionCount:    data.widget.versions.length,
        mainVersionId:   data.widget.mainVersionId,
        linkedGalleryTemplateId: data.widget.linkedGalleryTemplateId,
        linkedGalleryVersion:    data.widget.linkedGalleryVersion,
        divergedFromGallery:     data.widget.divergedFromGallery,
      });
      toast.success('Pinned as main version');
    } catch (err) {
      toast.error(`Failed to set main version: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [openArtifact, viewVersionId, widget, upsertSummary]);

  /**
   * Persist the in-progress rename via POST /api/widget/rename. Trims
   * whitespace; an empty string clears the name (revert to widgetId-as-display).
   * Same {agentId, widgetId} contract as the other widget routes.
   */
  const handleSubmitRename = useCallback(async () => {
    if (!openArtifact || editingName === null) return;
    const trimmed = editingName.trim();
    const current = widget?.name || '';
    setEditingName(null);
    if (trimmed === current) return;     // no-op
    setBusy(true);
    try {
      const res = await fetch('/api/widget/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: openArtifact.agentId,
          widgetId: openArtifact.widgetId,
          name: trimmed === '' ? null : trimmed,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      // Patch local state from the server response.
      setWidget(prev => prev ? { ...prev, name: data.name } : prev);
      // Update the cached summary so the panel card reflects the new name immediately.
      upsertSummary(openArtifact.agentId, {
        widgetId:        data.widget.widgetId,
        name:            data.widget.name || null,
        kind:            data.widget.kind,
        createdAt:       data.widget.createdAt,
        updatedAt:       data.widget.updatedAt,
        lastRenderedAt:  data.widget.lastRenderedAt,
        size:            data.widget.size,
        phishingHits:    data.widget.phishingHits,
        versionCount:    data.widget.versions.length,
        mainVersionId:   data.widget.mainVersionId,
        linkedGalleryTemplateId: data.widget.linkedGalleryTemplateId,
        linkedGalleryVersion:    data.widget.linkedGalleryVersion,
        divergedFromGallery:     data.widget.divergedFromGallery,
      });
      toast.success(trimmed === '' ? 'Name cleared' : `Renamed to "${trimmed}"`);
    } catch (err) {
      toast.error(`Rename failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [openArtifact, editingName, widget, upsertSummary]);

  if (!openArtifact) return null;

  const viewedVersion = widget?.versions?.find(v => v.versionId === viewVersionId)
                     || widget?.versions?.[widget?.versions?.length - 1];
  const isViewingMain = viewedVersion?.versionId === widget?.mainVersionId;

  const sheet = (
    <div
      className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={closePanel}
      data-testid="widget-sheet-backdrop"
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {/* Title row: friendly name (if any) editable, with widgetId
                as the small monospace subtitle. Click pencil → input;
                Enter or blur commits, Escape cancels. */}
            <div className="flex items-center gap-1.5 min-w-0">
              {editingName !== null ? (
                <>
                  <input
                    type="text"
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={handleSubmitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleSubmitRename(); }
                      else if (e.key === 'Escape') { e.preventDefault(); setEditingName(null); }
                    }}
                    maxLength={80}
                    placeholder="Name (leave empty to clear)"
                    className="text-sm font-medium px-2 py-0.5 border border-loxia-400 dark:border-loxia-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-loxia-500"
                    data-testid="widget-rename-input"
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}      // prevent blur-cancel
                    onClick={handleSubmitRename}
                    className="p-1 rounded text-loxia-600 hover:bg-loxia-50 dark:hover:bg-loxia-900/30"
                    title="Save name"
                    data-testid="widget-rename-save"
                  >
                    <CheckIcon className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <div
                    className={`text-sm font-medium truncate ${widget?.name ? 'text-gray-900 dark:text-gray-100' : 'font-mono text-gray-900 dark:text-gray-100'}`}
                    data-testid="widget-sheet-title"
                  >
                    {widget?.name || openArtifact.widgetId}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingName(widget?.name || '')}
                    className="p-1 rounded text-gray-400 hover:text-loxia-600 hover:bg-loxia-50 dark:hover:bg-loxia-900/30"
                    title={widget?.name ? 'Rename widget' : 'Add a display name'}
                    data-testid="widget-rename-btn"
                  >
                    <PencilSquareIcon className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
            {/* Subtitle: monospace widgetId (only when a name is set, so
                the user always sees the stable id; otherwise the title
                row already shows it monospace). */}
            {widget?.name && editingName === null && (
              <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate">
                {openArtifact.widgetId}
              </div>
            )}
            <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-2">
              <span>{widget ? `${widget.versions.length} version${widget.versions.length === 1 ? '' : 's'}` : ''}</span>
              {widget?.linkedGalleryTemplateId && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                  widget.divergedFromGallery
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                }`}>
                  {widget.divergedFromGallery ? '↯ diverged from gallery' : '🔗 shared in gallery'}
                </span>
              )}
            </div>
          </div>
          {/* Share / Unshare button */}
          {widget && (widget.linkedGalleryTemplateId ? (
            <button
              type="button"
              onClick={handleUnshare}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
              title="Remove this widget's template from the gallery"
              data-testid="unshare-btn"
            >
              <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
              Unshare
            </button>
          ) : (
            <button
              type="button"
              onClick={handleShare}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-loxia-50 dark:bg-loxia-900/30 text-loxia-700 dark:text-loxia-300 border border-loxia-200 dark:border-loxia-800 rounded hover:bg-loxia-100 dark:hover:bg-loxia-900/50 disabled:opacity-50"
              title="Publish this widget's main version to the cross-session gallery"
              data-testid="share-btn"
            >
              <ShareIcon className="w-3.5 h-3.5" />
              Share to Gallery
            </button>
          ))}
          <button
            type="button"
            onClick={closePanel}
            className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Version selector — chronological, newest first */}
        {widget && widget.versions.length > 1 && (
          <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2 overflow-x-auto">
            <span className="text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0">Versions</span>
            {[...widget.versions].reverse().map(v => {
              const isMain = v.versionId === widget.mainVersionId;
              const isViewing = v.versionId === viewVersionId;
              return (
                <button
                  key={v.versionId}
                  type="button"
                  onClick={() => setViewVersionId(v.versionId)}
                  className={`px-2 py-0.5 text-[11px] rounded font-mono inline-flex items-center gap-1 flex-shrink-0 ${
                    isViewing
                      ? 'bg-loxia-600 text-white'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600'
                  }`}
                  title={timeAgo(v.createdAt)}
                  data-testid={isMain ? 'version-pill-main' : 'version-pill'}
                >
                  {isMain && <StarSolid className="w-3 h-3 text-amber-400" />}
                  {v.versionId.slice(2, 8)}
                  <span className="text-[9px] opacity-70 ml-0.5">{timeAgo(v.createdAt)}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Upgrade banner — only when a newer gallery version is
            available AND the widget hasn't diverged locally. Lets the
            user opt-in to upstream updates without surprise. */}
        {upgradeInfo?.hasUpgrade && (
          <div
            className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-loxia-50 dark:bg-loxia-900/20 flex items-center gap-2 text-xs"
            data-testid="upgrade-banner"
          >
            <ArrowUpCircleIcon className="w-4 h-4 text-loxia-600 dark:text-loxia-400 flex-shrink-0" />
            <span className="flex-1 text-loxia-800 dark:text-loxia-200">
              <strong>v{upgradeInfo.latestVersion}</strong> is available
              (you have v{upgradeInfo.currentVersion}).
            </span>
            <button
              type="button"
              onClick={handleApplyUpgrade}
              disabled={busy}
              className="px-2.5 py-1 font-medium bg-loxia-600 text-white rounded hover:bg-loxia-700 disabled:opacity-50"
              data-testid="apply-upgrade-btn"
            >
              Upgrade
            </button>
          </div>
        )}

        {/* Trust bar — only shown for interactive widgets that aren't trusted yet.
            Without this, the body just renders a "[scripts stripped]" placeholder
            with no obvious way for the user to grant trust from inside the sheet.
            Two grants offered: this widget only, or this agent for the session. */}
        {widget && viewedVersion && !isTrusted
          && (viewedVersion.kind === 'jsx' || viewedVersion.kind === 'webcomponent') && (
          <div
            className="mx-4 mt-3 mb-1 px-3 py-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 flex items-start justify-between gap-3"
            data-testid="widget-trust-bar"
          >
            <div>
              <div className="font-medium">This widget needs JavaScript to render.</div>
              <div className="opacity-80">Scripts run in a null-origin iframe — no cookies, no network, no parent-page access.</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => trustWidget(openArtifact.widgetId)}
                className="px-2 py-1 text-[11px] font-medium bg-amber-600 text-white rounded hover:bg-amber-700"
                data-testid="trust-widget-btn"
              >
                Trust this widget
              </button>
              <button
                type="button"
                onClick={() => trustAgentSession(openArtifact.agentId)}
                className="px-2 py-1 text-[11px] font-medium bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
                data-testid="trust-agent-session-btn"
                title="Trust everything this agent renders for the rest of this session"
              >
                Trust agent (session)
              </button>
            </div>
          </div>
        )}

        {/* "Revoke trust" affordance — visible when scripts ARE running, so
            the user can pull the plug without leaving the sheet. */}
        {widget && viewedVersion && isTrusted
          && (viewedVersion.kind === 'jsx' || viewedVersion.kind === 'webcomponent') && (
          <div className="mx-4 mt-3 mb-1 flex items-center justify-end" data-testid="widget-revoke-bar">
            <button
              type="button"
              onClick={() => {
                // Revoke at all levels — widget-specific + agent-session.
                // Agent-forever (level 3) intentionally NOT revoked here:
                // it's a stronger setting managed in the trust prefs page.
                revokeWidget(openArtifact.widgetId);
                revokeAgentSession(openArtifact.agentId);
              }}
              className="px-2 py-1 text-[10px] text-gray-500 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400"
              data-testid="revoke-trust-btn"
              title="Stop running scripts for this widget"
            >
              Revoke trust
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {loading && <div className="text-xs text-gray-400">Loading widget…</div>}
          {loadError && (
            <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded px-2 py-1">
              {loadError}
            </div>
          )}
          {widget && viewedVersion && (
            <IframeWidget
              kind={viewedVersion.kind}
              content={viewedVersion.content}
              initialProps={viewedVersion.props}
              widgetId={openArtifact.widgetId}
              agentName={currentAgent?.name || 'agent'}
              stripToStatic={!isTrusted}
            />
          )}
        </div>

        {/* Footer — set-as-main control */}
        {widget && viewedVersion && !isViewingMain && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 flex items-center justify-between">
            <span className="text-[11px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
              <ClockIcon className="w-3.5 h-3.5" />
              Viewing {timeAgo(viewedVersion.createdAt)}
              {viewedVersion.versionId !== widget.mainVersionId && ' (not main)'}
            </span>
            <button
              type="button"
              onClick={handleSetMain}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-loxia-600 text-white rounded hover:bg-loxia-700 disabled:opacity-50"
              data-testid="set-main-btn"
            >
              <StarIcon className="w-3.5 h-3.5" />
              Pin as main version
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet;
}

export default WidgetSheet;
