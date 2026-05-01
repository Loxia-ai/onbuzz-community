import React from 'react';
import {
  XMarkIcon,
  PlayIcon,
  StopIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  SignalIcon
} from '@heroicons/react/24/outline';
import { NODE_EXECUTION_STATUS, FLOW_RUN_STATUS, getStatusLabel } from '../../../constants/flowExecution.js';
import { useFlowsStore } from '../../../stores/flowsStore.js';

/**
 * Format number with K/M suffix
 */
function formatNumber(num) {
  if (!num || num < 1000) return num || '0';
  if (num < 1000000) return (num / 1000).toFixed(1) + 'K';
  return (num / 1000000).toFixed(1) + 'M';
}

/**
 * ExecutionPanel - Shows flow execution status and progress.
 *
 * Phase 6 surfaces:
 *   - Per-node `error.kind` (timeout / agent-error / agent-failure)
 *     with attempt count when the failure went through retries
 *   - Resume button on failed runs (POSTs /api/flows/runs/:runId/resume)
 *   - flowVersion stamp showing which definition produced this run
 */
function ExecutionPanel({ currentRun, nodes, onStop, onResume, onClose }) {
  // Get real-time progress for nodes
  const nodeProgress = useFlowsStore(state => state.nodeProgress);

  if (!currentRun) {
    return null;
  }

  const { status, nodeStates = {}, output, error, startedAt, completedAt, flowVersion } = currentRun;
  const isRunning = status === FLOW_RUN_STATUS.RUNNING;
  const isCompleted = status === FLOW_RUN_STATUS.COMPLETED;
  const isFailed = status === FLOW_RUN_STATUS.FAILED;
  const isStopped = status === FLOW_RUN_STATUS.STOPPED;

  // Calculate progress
  const totalNodes = nodes?.length || 0;
  const completedNodes = Object.values(nodeStates).filter(
    s => s.status === NODE_EXECUTION_STATUS.COMPLETED
  ).length;
  const failedNodes = Object.values(nodeStates).filter(
    s => s.status === NODE_EXECUTION_STATUS.FAILED
  ).length;
  const progressPercent = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0;

  // Get status color and icon
  const getStatusStyles = () => {
    if (isRunning) return { bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-300' };
    if (isCompleted) return { bg: 'bg-green-50 dark:bg-green-900/30', border: 'border-green-200 dark:border-green-800', text: 'text-green-700 dark:text-green-300' };
    if (isFailed) return { bg: 'bg-red-50 dark:bg-red-900/30', border: 'border-red-200 dark:border-red-800', text: 'text-red-700 dark:text-red-300' };
    if (isStopped) return { bg: 'bg-gray-50 dark:bg-gray-800', border: 'border-gray-200 dark:border-gray-700', text: 'text-gray-600 dark:text-gray-400' };
    return { bg: 'bg-gray-50 dark:bg-gray-800', border: 'border-gray-200 dark:border-gray-700', text: 'text-gray-600 dark:text-gray-400' };
  };

  const styles = getStatusStyles();

  const StatusIcon = () => {
    if (isRunning) return <ArrowPathIcon className="w-5 h-5 text-blue-500 animate-spin" />;
    if (isCompleted) return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
    if (isFailed) return <XCircleIcon className="w-5 h-5 text-red-500" />;
    if (isStopped) return <StopIcon className="w-5 h-5 text-gray-500" />;
    return <ClockIcon className="w-5 h-5 text-gray-500" />;
  };

  const formatDuration = () => {
    if (!startedAt) return '';
    const start = new Date(startedAt);
    const end = completedAt ? new Date(completedAt) : new Date();
    const durationMs = end - start;
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 w-96 rounded-xl shadow-lg border ${styles.border} ${styles.bg} overflow-hidden`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2 border-b ${styles.border}`}>
        <div className="flex items-center gap-2">
          <StatusIcon />
          <span className={`text-sm font-semibold ${styles.text}`}>
            {isRunning ? 'Running' : isCompleted ? 'Completed' : isFailed ? 'Failed' : isStopped ? 'Stopped' : 'Pending'}
          </span>
          {formatDuration() && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              ({formatDuration()})
            </span>
          )}
          {/* Phase 6: which flow definition produced this run? */}
          {flowVersion != null && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-200/70 dark:bg-gray-700/70 text-gray-600 dark:text-gray-300"
              title="Flow definition version used by this run"
            >
              v{flowVersion}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isRunning && onStop && (
            <button
              onClick={onStop}
              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
              title="Stop execution"
            >
              <StopIcon className="w-4 h-4" />
            </button>
          )}
          {/* Phase 6: Resume button — visible only on failed runs.
              Re-runs from the first non-completed node using disk
              checkpoints. The backend route validates the run can
              be resumed. */}
          {(isFailed || isStopped) && onResume && (
            <button
              onClick={onResume}
              className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1"
              title="Resume from the first non-completed node (uses disk checkpoints)"
            >
              <PlayIcon className="w-3.5 h-3.5" />
              Resume
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
            title="Close panel"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="px-4 py-3">
        {/* Progress bar */}
        <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
          <span>Progress</span>
          <span>{completedNodes}/{totalNodes} nodes ({progressPercent}%)</span>
        </div>
        <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              isFailed || failedNodes > 0
                ? 'bg-red-500'
                : isCompleted
                  ? 'bg-green-500'
                  : 'bg-blue-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Node status list */}
        {Object.keys(nodeStates).length > 0 && (
          <div className="mt-3 space-y-1 max-h-32 overflow-y-auto">
            {nodes?.map(node => {
              const nodeState = nodeStates[node.id];
              if (!nodeState) return null;

              const progress = nodeProgress[node.id];
              const isNodeRunning = nodeState.status === NODE_EXECUTION_STATUS.RUNNING;

              const errInfo = nodeState.error;
              return (
                <div key={node.id} className="rounded bg-white/50 dark:bg-gray-800/50">
                  <div className="flex items-center justify-between text-xs py-1 px-2">
                    <div className="flex items-center gap-2 truncate">
                      {isNodeRunning && (
                        <SignalIcon className="w-3 h-3 text-blue-500 animate-pulse flex-shrink-0" />
                      )}
                      <span className="truncate text-gray-700 dark:text-gray-300">
                        {node.data?.label || node.id}
                      </span>
                      {/* Show streaming stats for running nodes */}
                      {isNodeRunning && progress && (
                        <span className="text-blue-500 dark:text-blue-400 flex-shrink-0">
                          {formatNumber(progress.charactersStreamed)} chars
                        </span>
                      )}
                    </div>
                    <span className={`
                      px-1.5 py-0.5 rounded font-medium flex-shrink-0
                      ${isNodeRunning
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                        : nodeState.status === NODE_EXECUTION_STATUS.COMPLETED
                          ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                          : nodeState.status === NODE_EXECUTION_STATUS.FAILED
                            ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}
                    `}>
                      {getStatusLabel(nodeState.status)}
                    </span>
                  </div>
                  {/* Phase 6: structured error detail per node — kind +
                      attempt count + the error message that propagated. */}
                  {errInfo && (
                    <div className="px-2 pb-1.5 pt-0.5 text-[11px] text-red-700 dark:text-red-300 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-red-200 dark:bg-red-900/60 font-mono text-[10px]">
                          {errInfo.kind || 'error'}
                        </span>
                        {Array.isArray(errInfo.attempts) && errInfo.attempts.length > 1 && (
                          <span className="text-red-600 dark:text-red-400">
                            after {errInfo.attempts.length} attempt{errInfo.attempts.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      {errInfo.message && (
                        <p className="break-words">{errInfo.message}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mt-3 p-2 bg-red-100 dark:bg-red-900/30 rounded text-xs text-red-700 dark:text-red-300">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Output preview */}
        {isCompleted && output && (
          <div className="mt-3 p-2 bg-green-100 dark:bg-green-900/30 rounded text-xs text-green-700 dark:text-green-300">
            <strong>Output:</strong>
            <pre className="mt-1 whitespace-pre-wrap max-h-20 overflow-y-auto">
              {typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output).slice(0, 200)}
              {typeof output === 'string' && output.length > 200 && '...'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default ExecutionPanel;
