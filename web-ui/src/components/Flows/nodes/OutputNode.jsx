import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  ArrowRightEndOnRectangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { NODE_EXECUTION_STATUS, getStatusLabel } from '../../../constants/flowExecution.js';

function OutputNode({ data, selected, id }) {
  // Execution status from data.executionStatus (passed from FlowCanvas)
  const executionStatus = data.executionStatus;

  // Determine border color based on execution status
  const getBorderClass = () => {
    if (executionStatus === NODE_EXECUTION_STATUS.RUNNING) {
      return 'border-amber-500 ring-2 ring-amber-300 animate-pulse';
    }
    if (executionStatus === NODE_EXECUTION_STATUS.COMPLETED) {
      return 'border-green-500 ring-2 ring-green-200 dark:ring-green-800';
    }
    if (executionStatus === NODE_EXECUTION_STATUS.FAILED) {
      return 'border-red-500 ring-2 ring-red-200 dark:ring-red-800';
    }
    if (selected) {
      return 'border-amber-500 ring-2 ring-amber-200 dark:ring-amber-800';
    }
    return 'border-amber-300 dark:border-amber-700';
  };

  return (
    <div
      className={`
        min-w-[180px] bg-white dark:bg-gray-800 rounded-xl shadow-lg border-2 transition-all
        ${getBorderClass()}
      `}
    >
      {/* Header */}
      <div className={`
        flex items-center gap-2 px-3 py-2 rounded-t-lg border-b
        ${executionStatus === NODE_EXECUTION_STATUS.RUNNING
          ? 'bg-amber-100 dark:bg-amber-900/50 border-amber-300 dark:border-amber-700'
          : executionStatus === NODE_EXECUTION_STATUS.COMPLETED
            ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800'
            : executionStatus === NODE_EXECUTION_STATUS.FAILED
              ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
              : 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800'}
      `}>
        <div className={`
          w-6 h-6 rounded flex items-center justify-center
          ${executionStatus === NODE_EXECUTION_STATUS.RUNNING
            ? 'bg-amber-200 dark:bg-amber-700'
            : executionStatus === NODE_EXECUTION_STATUS.COMPLETED
              ? 'bg-green-100 dark:bg-green-800'
              : executionStatus === NODE_EXECUTION_STATUS.FAILED
                ? 'bg-red-100 dark:bg-red-800'
                : 'bg-amber-100 dark:bg-amber-800'}
        `}>
          {executionStatus === NODE_EXECUTION_STATUS.RUNNING ? (
            <ArrowPathIcon className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-spin" />
          ) : executionStatus === NODE_EXECUTION_STATUS.COMPLETED ? (
            <CheckCircleIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
          ) : executionStatus === NODE_EXECUTION_STATUS.FAILED ? (
            <XCircleIcon className="w-4 h-4 text-red-600 dark:text-red-400" />
          ) : (
            <ArrowRightEndOnRectangleIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          )}
        </div>
        <span className={`
          text-sm font-semibold flex-1
          ${executionStatus === NODE_EXECUTION_STATUS.COMPLETED
            ? 'text-green-800 dark:text-green-200'
            : executionStatus === NODE_EXECUTION_STATUS.FAILED
              ? 'text-red-800 dark:text-red-200'
              : 'text-amber-800 dark:text-amber-200'}
        `}>
          {data.label || 'Output'}
        </span>
        {executionStatus && (
          <span className={`
            text-xs px-1.5 py-0.5 rounded font-medium
            ${executionStatus === NODE_EXECUTION_STATUS.RUNNING
              ? 'bg-amber-200 text-amber-700 dark:bg-amber-800 dark:text-amber-300'
              : executionStatus === NODE_EXECUTION_STATUS.COMPLETED
                ? 'bg-green-200 text-green-700 dark:bg-green-800 dark:text-green-300'
                : 'bg-red-200 text-red-700 dark:bg-red-800 dark:text-red-300'}
          `}>
            {getStatusLabel(executionStatus)}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Flow result endpoint
        </p>
        {data.outputFormat && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="text-gray-400">Format:</span>
            <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-900 rounded font-mono">
              {data.outputFormat}
            </code>
          </div>
        )}
      </div>

      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-amber-500 !border-2 !border-white dark:!border-gray-800"
      />
    </div>
  );
}

export default memo(OutputNode);
