import React from 'react';
import { XMarkIcon, ExclamationTriangleIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';

/**
 * Inline panel showing the result of POST /api/flows/dry-run.
 * Replaces the previous "ephemeral toast" surface so users can read
 * each issue, click an offending node to jump to it, and address them
 * one by one.
 *
 * Props:
 *   result: { ok, schemaErrors[], lintErrors[], lintWarnings[] }
 *   nodes: array of canvas nodes (used to look up labels)
 *   onSelectNode(nodeId): jump to a node when its row is clicked
 *   onClose()
 */
function DryRunResultsPanel({ result, nodes, onSelectNode, onClose }) {
  if (!result) return null;
  const schemaErrors  = result.schemaErrors  || [];
  const lintErrors    = result.lintErrors    || [];
  const lintWarnings  = result.lintWarnings  || [];
  const totalIssues = schemaErrors.length + lintErrors.length + lintWarnings.length;
  const passed = result.ok && totalIssues === 0;

  // Try to extract a nodeId from a schema error's path field (e.g.
  // "nodes[1].data.agentId" → second node). Used so schema errors
  // also become clickable.
  const nodeIdFromSchemaPath = (errPath) => {
    if (!errPath) return null;
    const m = /^nodes\[(\d+)\]/.exec(errPath);
    if (!m) return null;
    const idx = parseInt(m[1], 10);
    return nodes?.[idx]?.id || null;
  };

  const nodeLabel = (nodeId) => {
    const n = nodes?.find(x => x.id === nodeId);
    return n?.data?.label || nodeId;
  };

  return (
    <div className="absolute bottom-4 left-4 right-4 z-20 max-h-[40vh] flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b ${
        passed
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          : schemaErrors.length > 0
            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
      }`}>
        <div className="flex items-center gap-2">
          {passed ? (
            <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
          ) : schemaErrors.length > 0 ? (
            <ExclamationCircleIcon className="w-5 h-5 text-red-600 dark:text-red-400" />
          ) : (
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          )}
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
            {passed
              ? 'Dry-run passed'
              : `${totalIssues} issue${totalIssues === 1 ? '' : 's'} found`}
          </span>
          {!passed && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {schemaErrors.length > 0 && `${schemaErrors.length} error${schemaErrors.length === 1 ? '' : 's'}`}
              {schemaErrors.length > 0 && lintWarnings.length > 0 && ' · '}
              {lintWarnings.length > 0 && `${lintWarnings.length} warning${lintWarnings.length === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-gray-500"
          aria-label="Close dry-run results"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {passed && (
          <p className="text-sm text-green-700 dark:text-green-300 px-2 py-3 text-center">
            Schema and lint both clean — this flow is safe to save and execute.
          </p>
        )}

        {schemaErrors.map((err, i) => {
          const nodeId = nodeIdFromSchemaPath(err.path);
          return (
            <IssueRow
              key={`schema-${i}`}
              kind="error"
              path={err.path}
              message={err.message}
              nodeId={nodeId}
              nodeLabel={nodeId ? nodeLabel(nodeId) : null}
              onSelectNode={onSelectNode}
            />
          );
        })}

        {lintErrors.map((err, i) => (
          <IssueRow
            key={`lint-err-${i}`}
            kind="error"
            message={err.message}
            nodeId={err.nodeId}
            nodeLabel={err.nodeId ? nodeLabel(err.nodeId) : null}
            onSelectNode={onSelectNode}
          />
        ))}

        {lintWarnings.map((w, i) => (
          <IssueRow
            key={`warn-${i}`}
            kind="warning"
            message={w.message}
            nodeId={w.nodeId}
            nodeLabel={w.nodeId ? nodeLabel(w.nodeId) : null}
            onSelectNode={onSelectNode}
          />
        ))}
      </div>
    </div>
  );
}

function IssueRow({ kind, path, message, nodeId, nodeLabel, onSelectNode }) {
  const isError = kind === 'error';
  const colorBg = isError
    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30'
    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30';
  const dot = isError ? 'bg-red-500' : 'bg-amber-500';
  const clickable = !!nodeId;

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onSelectNode(nodeId) : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectNode(nodeId); } } : undefined}
      className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-sm ${colorBg} ${clickable ? 'cursor-pointer' : ''}`}
      title={clickable ? `Click to select node ${nodeLabel}` : undefined}
    >
      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
      <div className="flex-1 min-w-0">
        <p className="text-gray-800 dark:text-gray-200">{message}</p>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {nodeLabel && (
            <span className="px-1.5 py-0.5 bg-white/70 dark:bg-gray-900/40 rounded font-mono">
              {nodeLabel}
            </span>
          )}
          {path && !nodeLabel && (
            <code className="font-mono text-[11px]">{path}</code>
          )}
        </div>
      </div>
    </div>
  );
}

export default DryRunResultsPanel;
