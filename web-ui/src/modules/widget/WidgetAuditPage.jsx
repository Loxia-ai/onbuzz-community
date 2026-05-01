/**
 * WidgetAuditPage — /widget-audit route.
 *
 * Shows every widget every agent has rendered, grouped by agent, with
 * size, kind, phishing flags, timestamps. Source is the backend widget
 * tool instance (see /api/widget/audit).
 *
 * Self-contained: no dependencies on Gallery, VideoStudio, or any other
 * page. Removing the module deletes this file and the one route line
 * in App.jsx.
 */

import React, { useEffect, useState } from 'react';
import { ShieldExclamationIcon, ArrowPathIcon, CodeBracketIcon } from '@heroicons/react/24/outline';

function fmt(iso) {
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}
function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function WidgetAuditPage() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/widget/audit');
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'unknown');
      setGroups(data.groups || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const totalWidgets = groups.reduce((n, g) => n + (g.count || 0), 0);
  const totalFlagged = groups.reduce(
    (n, g) => n + (g.widgets || []).filter(w => w.phishingHits?.length > 0).length, 0
  );

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <CodeBracketIcon className="w-6 h-6 text-loxia-500" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Widget audit</h1>
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {totalWidgets} widgets across {groups.length} agents
          {totalFlagged > 0 && <span className="ml-2 text-rose-600 dark:text-rose-400"> · {totalFlagged} flagged</span>}
        </span>
        <div className="flex-1" />
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          title="Refresh"
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded px-3 py-2">
            {error}
          </div>
        )}
        {!loading && !error && groups.length === 0 && (
          <div className="py-16 text-center text-gray-400">
            <CodeBracketIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No widgets rendered yet.</p>
          </div>
        )}
        {groups.map(g => (
          <div key={g.agentId} className="mb-6">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2 font-mono">
              {g.agentId} <span className="text-xs text-gray-500 font-normal">({g.count} widgets)</span>
            </h2>
            <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
                    <th className="text-left px-3 py-2 font-medium">Widget id</th>
                    <th className="text-left px-3 py-2 font-medium">Kind</th>
                    <th className="text-left px-3 py-2 font-medium">Size</th>
                    <th className="text-left px-3 py-2 font-medium">Created</th>
                    <th className="text-left px-3 py-2 font-medium">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {g.widgets.map(w => (
                    <tr key={w.widgetId} className="border-t border-gray-200 dark:border-gray-700">
                      <td className="px-3 py-2 font-mono text-gray-800 dark:text-gray-200">{w.widgetId}</td>
                      <td className="px-3 py-2 font-mono">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                          w.kind === 'jsx'
                            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}>{w.kind}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{fmtBytes(w.size)}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{fmt(w.createdAt)}</td>
                      <td className="px-3 py-2">
                        {w.phishingHits?.length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400" title={w.phishingHits.join(', ')}>
                            <ShieldExclamationIcon className="w-3 h-3" />
                            {w.phishingHits.length} flag{w.phishingHits.length === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default WidgetAuditPage;
