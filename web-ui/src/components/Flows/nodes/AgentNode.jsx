import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  CpuChipIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  SignalIcon,
  ChatBubbleLeftRightIcon
} from '@heroicons/react/24/outline';
import { NODE_EXECUTION_STATUS, getStatusLabel } from '../../../constants/flowExecution.js';
import { useFlowsStore } from '../../../stores/flowsStore.js';

/**
 * Format number with K/M suffix for readability
 */
function formatNumber(num) {
  if (!num || num < 1000) return num || '0';
  if (num < 1000000) return (num / 1000).toFixed(1) + 'K';
  return (num / 1000000).toFixed(1) + 'M';
}

function AgentNode({ data, selected, agents = [], id }) {
  // Find the selected agent
  const selectedAgent = agents.find(a => a.id === data.agentId);
  const hasAgent = !!selectedAgent;

  // Execution status from data.executionStatus (passed from FlowCanvas)
  const executionStatus = data.executionStatus;

  // Get real-time progress from store
  const nodeProgress = useFlowsStore(state => state.nodeProgress[id]);
  const isRunning = executionStatus === NODE_EXECUTION_STATUS.RUNNING;

  // Determine border color based on execution status
  const getBorderClass = () => {
    if (isRunning) {
      return 'border-blue-500 ring-2 ring-blue-300 animate-pulse';
    }
    if (executionStatus === NODE_EXECUTION_STATUS.COMPLETED) {
      return 'border-green-500 ring-2 ring-green-200 dark:ring-green-800';
    }
    if (executionStatus === NODE_EXECUTION_STATUS.FAILED) {
      return 'border-red-500 ring-2 ring-red-200 dark:ring-red-800';
    }
    if (selected) {
      return 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800';
    }
    if (!hasAgent) {
      return 'border-yellow-400 dark:border-yellow-600';
    }
    return 'border-blue-300 dark:border-blue-700';
  };

  return (
    <div
      className={`
        min-w-[200px] bg-white dark:bg-gray-800 rounded-xl shadow-lg border-2 transition-all
        ${getBorderClass()}
      `}
    >
      {/* Header */}
      <div className={`
        flex items-center gap-2 px-3 py-2 rounded-t-lg border-b
        ${isRunning
          ? 'bg-blue-100 dark:bg-blue-900/50 border-blue-300 dark:border-blue-700'
          : executionStatus === NODE_EXECUTION_STATUS.COMPLETED
            ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800'
            : executionStatus === NODE_EXECUTION_STATUS.FAILED
              ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
              : hasAgent
                ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800'
                : 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800'}
      `}>
        <div className={`
          w-6 h-6 rounded flex items-center justify-center
          ${isRunning
            ? 'bg-blue-200 dark:bg-blue-700'
            : executionStatus === NODE_EXECUTION_STATUS.COMPLETED
              ? 'bg-green-100 dark:bg-green-800'
              : executionStatus === NODE_EXECUTION_STATUS.FAILED
                ? 'bg-red-100 dark:bg-red-800'
                : hasAgent
                  ? 'bg-blue-100 dark:bg-blue-800'
                  : 'bg-yellow-100 dark:bg-yellow-800'}
        `}>
          {isRunning ? (
            <ArrowPathIcon className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
          ) : executionStatus === NODE_EXECUTION_STATUS.COMPLETED ? (
            <CheckCircleIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
          ) : executionStatus === NODE_EXECUTION_STATUS.FAILED ? (
            <XCircleIcon className="w-4 h-4 text-red-600 dark:text-red-400" />
          ) : hasAgent ? (
            <CpuChipIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          ) : (
            <ExclamationCircleIcon className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
          )}
        </div>
        <span className={`
          text-sm font-semibold flex-1
          ${isRunning
            ? 'text-blue-800 dark:text-blue-200'
            : executionStatus === NODE_EXECUTION_STATUS.COMPLETED
              ? 'text-green-800 dark:text-green-200'
              : executionStatus === NODE_EXECUTION_STATUS.FAILED
                ? 'text-red-800 dark:text-red-200'
                : hasAgent
                  ? 'text-blue-800 dark:text-blue-200'
                  : 'text-yellow-800 dark:text-yellow-200'}
        `}>
          {data.label || 'Agent'}
        </span>
        {executionStatus && (
          <span className={`
            text-xs px-1.5 py-0.5 rounded font-medium
            ${isRunning
              ? 'bg-blue-200 text-blue-700 dark:bg-blue-800 dark:text-blue-300'
              : executionStatus === NODE_EXECUTION_STATUS.COMPLETED
                ? 'bg-green-200 text-green-700 dark:bg-green-800 dark:text-green-300'
                : 'bg-red-200 text-red-700 dark:bg-red-800 dark:text-red-300'}
          `}>
            {getStatusLabel(executionStatus)}
          </span>
        )}
        {/* Phase 5: lint warnings — amber chip with hover-tooltip detail.
            Distinct from execution status (red/green) so users can tell
            "edit-time issue" from "runtime failure" at a glance. */}
        {Array.isArray(data.lintWarnings) && data.lintWarnings.length > 0 && (
          <span
            className="text-xs px-1.5 py-0.5 rounded font-medium bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200"
            title={data.lintWarnings.map(w => `• ${w.message}`).join('\n')}
          >
            ⚠ {data.lintWarnings.length}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-2">
        {/* Agent Info */}
        {hasAgent ? (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-loxia-100 dark:bg-loxia-900/50 rounded-full flex items-center justify-center">
              <span className="text-xs font-bold text-loxia-600 dark:text-loxia-400">
                {selectedAgent.name?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {selectedAgent.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {selectedAgent.currentModel || 'No model'}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
            No agent selected
          </p>
        )}

        {/* Activity Indicator - shown when running */}
        {isRunning && (
          <div className="flex items-center gap-3 px-2 py-1.5 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
            {/* Activity dot with pulse */}
            <div className="relative">
              <SignalIcon className="w-4 h-4 text-blue-500 dark:text-blue-400" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 rounded-full animate-ping" />
            </div>

            {/* Stats - show if we have progress data */}
            {nodeProgress ? (
              <div className="flex items-center gap-3 text-xs">
                {/* Characters streamed */}
                <div className="flex items-center gap-1 text-blue-700 dark:text-blue-300" title="Characters streamed">
                  <span className="font-mono font-medium">
                    {formatNumber(nodeProgress.charactersStreamed)}
                  </span>
                  <span className="text-blue-500 dark:text-blue-400">chars</span>
                </div>

                {/* Chunk count */}
                <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400" title="Response chunks">
                  <ChatBubbleLeftRightIcon className="w-3 h-3" />
                  <span className="font-mono">
                    {nodeProgress.chunkCount}
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-xs text-blue-600 dark:text-blue-400">Processing...</span>
            )}
          </div>
        )}

        {/* Completed stats - show final character count */}
        {executionStatus === NODE_EXECUTION_STATUS.COMPLETED && data.charactersStreamed > 0 && (
          <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
            <CheckCircleIcon className="w-3 h-3" />
            <span>{formatNumber(data.charactersStreamed)} chars generated</span>
          </div>
        )}

        {/* Output Key */}
        {data.outputKey && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="text-gray-400">Output:</span>
            <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-900 rounded font-mono">
              {data.outputKey}
            </code>
          </div>
        )}

        {/* Phase 5 UI: typed I/O contract chips — visual confirmation of
            what the agent receives and must produce. Red/amber type
            colors mirror NodePropertiesPanel so the editor stays
            consistent. Hidden when there are no declarations to
            avoid clutter on legacy nodes. */}
        {Array.isArray(data.declaredInputs) && data.declaredInputs.length > 0 && (
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">In</div>
            <div className="flex flex-wrap gap-1">
              {data.declaredInputs.map((io, i) => (
                <FieldChip key={`in-${i}`} field={io} />
              ))}
            </div>
          </div>
        )}
        {Array.isArray(data.declaredOutputs) && data.declaredOutputs.length > 0 && (
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Out</div>
            <div className="flex flex-wrap gap-1">
              {data.declaredOutputs.map((io, i) => (
                <FieldChip key={`out-${i}`} field={io} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white dark:!border-gray-800"
      />

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white dark:!border-gray-800"
      />
    </div>
  );
}

// Phase 5 UI: small typed-I/O chip — name + type badge + required marker.
// Color-coded by type to mirror NodePropertiesPanel's editor.
const TYPE_CHIP_COLORS = {
  'text':       'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'number':     'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  'boolean':    'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  'json':       'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  'file':       'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'file[]':     'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  'list<text>': 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
};
function FieldChip({ field }) {
  const color = TYPE_CHIP_COLORS[field.type] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded ${color}`}
      title={`${field.name}: ${field.type}${field.required ? ' (required)' : ''}`}
    >
      <span className="font-semibold">{field.name}</span>
      <span className="opacity-60">:{field.type}</span>
      {field.required && <span className="opacity-70">*</span>}
    </span>
  );
}

export default memo(AgentNode);
