/**
 * WidgetGalleryPage — /widget-gallery route. Cross-session catalog of
 * shared widget templates.
 *
 * What it shows:
 *   - Grid of templates: title, version, kind, who shared it, render
 *     count, tags
 *   - Live preview thumbnails (sandboxed iframe in static-preview mode
 *     by default; users can elevate trust per the trust ladder)
 *   - Unshare action
 *
 * What it doesn't (yet):
 *   - "Insert into chat" button → posts a synthetic user message that
 *     asks the agent to render-from-gallery. (Phase 4 follow-up.)
 *   - Forking via UI (agents can fork by render-from-gallery + re-share)
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  ArrowPathIcon,
  CodeBracketIcon,
  ShieldExclamationIcon,
  TrashIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import IframeWidget from './IframeWidget.jsx';
import { useTrust, trustWidget, revokeWidget, trustAgentSession } from './trustModel.js';
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

const KIND_CHIP = {
  html:         'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  jsx:          'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  webcomponent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};
const KIND_LABEL = { html: 'html', jsx: 'jsx', webcomponent: 'web component' };

function GalleryCard({ template, onUnshare }) {
  const [content, setContent] = useState(null);
  const [loadingContent, setLoadingContent] = useState(false);

  // Trust check — gallery shows static-preview by default; user can
  // elevate per-template.
  const trustLevel = useTrust({
    templateId: template.templateId,
    agentId:    template.sharedBy?.agentId,
  });
  const isTrusted = trustLevel > 0;

  // Lazy-fetch full content the first time we need to preview the widget.
  // The list endpoint omits `content` for payload size; this card uses
  // GET /api/widget/gallery/:templateId to pull the full entry.
  // Default props are stored alongside content on the gallery entry.
  // Without these, an interactive widget that expects initial state
  // (e.g. `{ items: [...] }`) renders but has no data to react to —
  // looks "visible but non-functional" because every handler operates
  // on an empty initial state.
  const [defaultProps, setDefaultProps] = useState(null);

  const ensureContent = useCallback(async () => {
    if (content !== null || loadingContent) return;
    setLoadingContent(true);
    try {
      const res = await fetch(`/api/widget/gallery/${encodeURIComponent(template.templateId)}`);
      const data = await res.json();
      if (data.success && data.template) {
        setContent(data.template.content || '');
        setDefaultProps(data.template.defaultProps || {});
      } else {
        setContent('');
        setDefaultProps({});
      }
    } catch {
      setContent('');   // Non-fatal — just leaves preview empty.
      setDefaultProps({});
    } finally {
      setLoadingContent(false);
    }
  }, [template.templateId, content, loadingContent]);

  // Only fetch full content once trust is granted — saves bandwidth and
  // avoids loading potentially-large widget bundles for templates the user
  // never elevates.
  useEffect(() => { if (isTrusted) ensureContent(); }, [isTrusted, ensureContent]);

  const flagged = (template.phishingHits?.length || 0) > 0;
  const sharedByName = template.sharedBy?.agentName || template.sharedBy?.agentId || 'unknown';

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden flex flex-col" data-testid="gallery-card">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center gap-2 min-w-0">
          <CodeBracketIcon className="w-4 h-4 text-loxia-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {template.title}
            </div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate">
              {template.templateId} · v{template.version}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onUnshare(template)}
            className="p-1 rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
            title="Remove from gallery"
            aria-label="Remove from gallery"
            data-testid="card-unshare"
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {/* Body */}
      <div className="p-3 flex-1 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className={`px-1.5 py-0.5 rounded font-mono ${KIND_CHIP[template.kind] || ''}`}>
            {KIND_LABEL[template.kind] || template.kind}
          </span>
          {(template.tags || []).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
              #{tag}
            </span>
          ))}
          {flagged && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
              title={template.phishingHits.join(', ')}
            >
              <ShieldExclamationIcon className="w-3 h-3" />
              {template.phishingHits.length}
            </span>
          )}
        </div>
        {!isTrusted && (
          <div
            className="text-[10px] text-gray-600 dark:text-gray-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-2 flex flex-col gap-1.5"
            data-testid="gallery-trust-prompt"
          >
            <div className="italic text-gray-600 dark:text-gray-300">
              Preview hidden — script execution requires per-template trust.
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => trustWidget(template.templateId)}
                className="px-2 py-0.5 text-[10px] font-medium bg-amber-600 text-white rounded hover:bg-amber-700"
                data-testid="trust-template-btn"
                title="Run scripts for this template only"
              >
                Trust this template
              </button>
              {template.sharedBy?.agentId && (
                <button
                  type="button"
                  onClick={() => trustAgentSession(template.sharedBy.agentId)}
                  className="px-2 py-0.5 text-[10px] font-medium bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  data-testid="trust-author-session-btn"
                  title={`Trust everything from ${sharedByName} for this session`}
                >
                  Trust author (session)
                </button>
              )}
            </div>
          </div>
        )}
        {isTrusted && content && (
          // `variant="embedded"` strips IframeWidget's own border + chrome
          // bar so the gallery card itself is the only card. The agent-name
          // and kind chip are already shown in the card's header/tags row,
          // and "View source" floats over the iframe as a tiny button.
          <IframeWidget
            kind={template.kind}
            content={content}
            initialProps={defaultProps || {}}
            widgetId={`gallery-${template.templateId}`}
            agentName={sharedByName}
            stripToStatic={false}
            variant="embedded"
          />
        )}
        {isTrusted && (
          <button
            type="button"
            onClick={() => revokeWidget(template.templateId)}
            className="self-end px-2 py-0.5 text-[10px] text-gray-500 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400"
            data-testid="revoke-template-btn"
            title="Stop running scripts for this template"
          >
            Revoke trust
          </button>
        )}
      </div>
      {/* Footer */}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 text-[10px] text-gray-500 dark:text-gray-400 flex items-center justify-between">
        <span>by {sharedByName}</span>
        <span className="inline-flex items-center gap-1">
          <ClockIcon className="w-3 h-3" />
          {timeAgo(template.sharedAt)}
        </span>
        {template.renderCount > 0 && (
          <span title="Times rendered by other sessions">
            ↻ {template.renderCount}
          </span>
        )}
      </div>
    </div>
  );
}

function WidgetGalleryPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterTag, setFilterTag] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = filterTag
        ? `/api/widget/gallery?tag=${encodeURIComponent(filterTag)}`
        : '/api/widget/gallery';
      const res = await fetch(url);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'failed');
      setTemplates(data.templates);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterTag]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleUnshare = useCallback(async (template) => {
    if (!template?.templateId) return;
    if (!confirm(`Remove "${template.title}" from the gallery?`)) return;
    try {
      const res = await fetch(`/api/widget/gallery/${encodeURIComponent(template.templateId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(`Unshared "${template.title}"`);
      await refresh();
    } catch (err) {
      toast.error(`Failed to unshare: ${err.message}`);
    }
  }, [refresh]);

  const allTags = Array.from(new Set(templates.flatMap(t => t.tags || []))).sort();

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <CodeBracketIcon className="w-6 h-6 text-loxia-500" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Widget gallery</h1>
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {templates.length} template{templates.length === 1 ? '' : 's'}
        </span>
        <div className="flex-1" />
        {allTags.length > 0 && (
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            aria-label="Filter by tag"
          >
            <option value="">All tags</option>
            {allTags.map(tag => <option key={tag} value={tag}>#{tag}</option>)}
          </select>
        )}
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          title="Refresh"
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="mb-4 text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded px-3 py-2">
            {error}
          </div>
        )}
        {!loading && !error && templates.length === 0 && (
          <div className="py-16 text-center text-gray-400">
            <CodeBracketIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No widgets in the gallery yet.</p>
            <p className="text-xs mt-1">Open a widget in the artifacts panel and click Share to publish.</p>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(t => (
            <GalleryCard key={t.templateId} template={t} onUnshare={handleUnshare} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default WidgetGalleryPage;
