/**
 * WidgetArtifactsSection — a section embedded in the right-side
 * Artifacts panel, listing every widget the agent has rendered in the
 * current session. Each widget gets one card; opening the card opens
 * a full-size sheet (WidgetSheet) where the live widget runs.
 *
 * Sourcing:
 *   - Cached state lives in `widgetArtifactsStore`. Filled by
 *     WidgetRenderer's render-observation effect AND on panel open
 *     by fetching /api/widget/audit?agentId=...
 *   - Re-fetches on panel open or agent switch.
 *
 * Display:
 *   - Sorted newest-rendered first
 *   - Each card shows: title (widgetId), kind chip, version count,
 *     last-rendered timestamp, phishing flag if any, share-state
 *     placeholder (filled in Phase 3)
 *
 * Click → opens WidgetSheet for that artifact.
 */

import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore.js';
import useWidgetArtifactsStore from '../../stores/widgetArtifactsStore.js';
import {
  CodeBracketIcon,
  ShieldExclamationIcon,
  ClockIcon,
  ArrowUpCircleIcon,
} from '@heroicons/react/24/outline';

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
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const KIND_CHIP = {
  html:         { label: 'html',          cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  jsx:          { label: 'jsx',           cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  webcomponent: { label: 'web component', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
};

function WidgetCard({ summary, onOpen, agentId }) {
  const chip = KIND_CHIP[summary.kind] || { label: summary.kind, cls: 'bg-gray-100 text-gray-700' };
  const flagged = (summary.phishingHits?.length || 0) > 0;
  const linked = !!summary.linkedGalleryTemplateId;
  const diverged = linked && summary.divergedFromGallery;

  // Upgrade-aware: poll the backend for "is there a newer template
  // version?" once per card mount. Non-linked/diverged widgets short-circuit
  // server-side, so this is cheap. The badge appears on linked-AND-newer.
  const [upgradeAvailable, setUpgradeAvailable] = useState(false);
  useEffect(() => {
    if (!linked || diverged) {
      setUpgradeAvailable(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/widget/check-upgrade?agentId=${encodeURIComponent(agentId)}&widgetId=${encodeURIComponent(summary.widgetId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.success) setUpgradeAvailable(!!data.hasUpgrade);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [linked, diverged, agentId, summary.widgetId, summary.linkedGalleryVersion]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left px-3 py-2 border-l-2 border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:border-loxia-500 transition-colors"
      data-testid="widget-artifact-card"
    >
      <div className="flex items-center gap-2 min-w-0">
        <CodeBracketIcon className="w-4 h-4 text-loxia-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          {/* Display name takes precedence; widgetId becomes a small monospace
              subtitle for traceability (a card with a friendly name and the
              raw id underneath is more usable than just the id). */}
          {summary.name ? (
            <>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate" data-testid="widget-card-name">
                {summary.name}
              </div>
              <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate font-mono">
                {summary.widgetId}
              </div>
            </>
          ) : (
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate font-mono">
              {summary.widgetId}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            <span className={`px-1.5 py-0.5 rounded font-mono ${chip.cls}`}>{chip.label}</span>
            {summary.versionCount > 1 && (
              <span className="px-1.5 py-0.5 rounded-full bg-loxia-100 text-loxia-700 dark:bg-loxia-900/30 dark:text-loxia-300">
                v{summary.versionCount}
              </span>
            )}
            {flagged && (
              <span
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                title={summary.phishingHits.join(', ')}
              >
                <ShieldExclamationIcon className="w-3 h-3" />
                {summary.phishingHits.length}
              </span>
            )}
            {linked && (
              <span
                className={`px-1.5 py-0.5 rounded ${diverged
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                }`}
                title={diverged ? 'Edited locally — diverged from gallery' : 'Linked to gallery template'}
              >
                {diverged ? '↯ diverged' : '🔗 gallery'}
              </span>
            )}
            {upgradeAvailable && (
              <span
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-loxia-100 text-loxia-700 dark:bg-loxia-900/30 dark:text-loxia-300 font-semibold"
                title="A newer version is available in the gallery — open the widget to upgrade"
                data-testid="upgrade-available-badge"
              >
                <ArrowUpCircleIcon className="w-3 h-3" />
                upgrade
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
          <ClockIcon className="w-3 h-3" />
          {timeAgo(summary.lastRenderedAt || summary.updatedAt)}
        </div>
      </div>
    </button>
  );
}

function WidgetArtifactsSection() {
  const currentAgent = useAppStore(s => s.currentAgent);
  const agentId = currentAgent?.id;
  const summaries = useWidgetArtifactsStore(s =>
    agentId ? s.getSummariesForAgent(agentId) : []
  );
  const fetchForAgent = useWidgetArtifactsStore(s => s.fetchForAgent);
  const openInPanel = useWidgetArtifactsStore(s => s.openInPanel);

  // Pull fresh state when this section becomes visible / agent changes.
  // The component being mounted is sufficient signal — the parent panel
  // already gates render on its own open state.
  useEffect(() => {
    if (agentId) fetchForAgent(agentId);
  }, [agentId, fetchForAgent]);

  if (!agentId) return null;

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/30 flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
          Widgets
        </div>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          {summaries.length}
        </span>
      </div>
      {summaries.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
          No widgets rendered yet. Ask the agent to render one.
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {summaries.map(s => (
            <WidgetCard
              key={s.widgetId}
              summary={s}
              agentId={agentId}
              onOpen={() => openInPanel({ agentId, widgetId: s.widgetId })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default WidgetArtifactsSection;
