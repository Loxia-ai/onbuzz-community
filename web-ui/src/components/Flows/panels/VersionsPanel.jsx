import React, { useEffect, useState, useCallback } from 'react';
import { XMarkIcon, ClockIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { api } from '../../../services/api.js';
import toast from 'react-hot-toast';

/**
 * VersionsPanel — list every persisted version of a flow with one-click
 * rollback. Versions are append-only on the backend; rollback restores
 * a snapshot AS the live record AND records a new version tagging the
 * action, so history is never lost.
 *
 * Props:
 *   flowId    : current flow's id
 *   liveVersion : the version stamped on the current live record
 *                 (used to highlight "you are here")
 *   onRollback() : called after a successful rollback so the editor
 *                  can refetch the live flow definition
 *   onClose()
 */
function VersionsPanel({ flowId, liveVersion, onRollback, onClose }) {
  const [versions, setVersions] = useState(null);   // null = loading
  const [error, setError] = useState(null);
  const [pendingRollback, setPendingRollback] = useState(null);

  const refresh = useCallback(async () => {
    try {
      // GET /flows/:id/versions returns { success, data: [...] }
      const res = await api.request(`/flows/${encodeURIComponent(flowId)}/versions`);
      setVersions(res?.data || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'failed to load versions');
      setVersions([]);
    }
  }, [flowId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRollback = async (target) => {
    setPendingRollback(target);
    try {
      await api.request(`/flows/${encodeURIComponent(flowId)}/rollback`, {
        method: 'POST',
        body: { version: target },
      });
      toast.success(`Rolled back to v${target}`);
      await refresh();
      if (onRollback) await onRollback();
    } catch (err) {
      toast.error(`Rollback failed: ${err.message}`);
    } finally {
      setPendingRollback(null);
    }
  };

  return (
    <div className="w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
            <ClockIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Versions</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Every save is a snapshot
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400"
          aria-label="Close versions panel"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {versions === null && (
          <p className="text-xs text-gray-400 text-center py-6">Loading...</p>
        )}
        {error && (
          <p className="text-xs text-red-500 text-center py-6">{error}</p>
        )}
        {versions !== null && versions.length === 0 && !error && (
          <p className="text-xs text-gray-400 text-center py-6 italic">
            No versions yet — save the flow to record one.
          </p>
        )}
        {versions !== null && versions.slice().reverse().map(v => {
          const isLive = liveVersion != null && v.version === liveVersion;
          const isLatest = versions.length > 0 && v.version === versions[versions.length - 1].version;
          return (
            <div
              key={v.version}
              className={`rounded-lg border p-2 ${
                isLive
                  ? 'border-loxia-400 bg-loxia-50 dark:bg-loxia-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-mono font-semibold text-gray-900 dark:text-gray-100">
                    v{v.version}
                  </span>
                  {isLive && (
                    <span className="text-[10px] uppercase tracking-wide text-loxia-600 dark:text-loxia-400 bg-loxia-100 dark:bg-loxia-900/40 px-1.5 py-0.5 rounded">
                      live
                    </span>
                  )}
                  {!isLive && isLatest && (
                    <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                      latest
                    </span>
                  )}
                </div>
                {!isLive && (
                  <button
                    onClick={() => handleRollback(v.version)}
                    disabled={pendingRollback === v.version}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                    title={`Restore version ${v.version} as the live record`}
                  >
                    <ArrowUturnLeftIcon className="w-3 h-3" />
                    {pendingRollback === v.version ? 'Rolling back...' : 'Rollback'}
                  </button>
                )}
              </div>
              {v.savedAt && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 ml-0.5">
                  {formatTime(v.savedAt)}
                </p>
              )}
              {v.name && v.name !== '' && (
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 truncate" title={v.name}>
                  {v.name}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default VersionsPanel;
