/**
 * ToolResultCard Component
 *
 * Renders tool execution results in a collapsible, structured format.
 * Displays key-value pairs for objects, with nested expandable sections.
 */

import React, { useState, useMemo } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ClockIcon,
  CommandLineIcon,
  DocumentIcon,
  FolderIcon,
  GlobeAltIcon,
  CpuChipIcon,
  WrenchScrewdriverIcon,
  MagnifyingGlassIcon,
  CodeBracketIcon,
  MapIcon
} from '@heroicons/react/24/outline';
import { getRenderer, hasCustomRenderer } from './toolRenderers/registry';

// Tool icon mapping
const TOOL_ICONS = {
  terminal: CommandLineIcon,
  filesystem: FolderIcon,
  web: GlobeAltIcon,
  taskmanager: ClockIcon,
  agentcommunication: CpuChipIcon,
  seek: MagnifyingGlassIcon,
  'file-tree': FolderIcon,
  'file-content-replace': DocumentIcon,
  'static-analysis': CodeBracketIcon,
  'clone-detection': CodeBracketIcon,
  'import-analyzer': CodeBracketIcon,
  'dependency-resolver': CodeBracketIcon,
  'code-map': MapIcon
};

// Status styling
const STATUS_STYLES = {
  completed: {
    icon: CheckCircleIcon,
    color: 'text-green-500',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-200 dark:border-green-800',
    label: 'Completed'
  },
  failed: {
    icon: ExclamationCircleIcon,
    color: 'text-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-800',
    label: 'Error'
  },
  executing: {
    icon: ClockIcon,
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    label: 'Running'
  }
};

/**
 * Renders a value based on its type
 */
function ValueRenderer({ value, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (value === null || value === undefined) {
    return <span className="text-gray-400 italic">null</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <span className={value ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
        {value.toString()}
      </span>
    );
  }

  if (typeof value === 'number') {
    return <span className="text-blue-600 dark:text-blue-400">{value}</span>;
  }

  if (typeof value === 'string') {
    // Check if it's a long string or multiline
    if (value.length > 100 || value.includes('\n')) {
      return (
        <pre className="bg-gray-100 dark:bg-gray-800 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
          {value}
        </pre>
      );
    }
    return <span className="text-gray-900 dark:text-gray-100">{value}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-gray-400 italic">[]</span>;
    }

    return (
      <div className="ml-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          {expanded ? (
            <ChevronDownIcon className="w-3 h-3 mr-1" />
          ) : (
            <ChevronRightIcon className="w-3 h-3 mr-1" />
          )}
          Array [{value.length}]
        </button>
        {expanded && (
          <div className="ml-3 mt-1 space-y-1 border-l-2 border-gray-200 dark:border-gray-700 pl-2">
            {value.map((item, index) => (
              <div key={index} className="flex">
                <span className="text-gray-400 text-xs mr-2">[{index}]</span>
                <ValueRenderer value={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return <span className="text-gray-400 italic">{'{}'}</span>;
    }

    return (
      <div className="ml-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          {expanded ? (
            <ChevronDownIcon className="w-3 h-3 mr-1" />
          ) : (
            <ChevronRightIcon className="w-3 h-3 mr-1" />
          )}
          Object {'{'}...{'}'}
        </button>
        {expanded && (
          <div className="ml-3 mt-1 space-y-1 border-l-2 border-gray-200 dark:border-gray-700 pl-2">
            {keys.map((key) => (
              <div key={key} className="flex flex-wrap">
                <span className="text-purple-600 dark:text-purple-400 text-xs mr-2 font-medium">
                  {key}:
                </span>
                <ValueRenderer value={value[key]} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return <span>{String(value)}</span>;
}

/**
 * Renders the result content in a structured key-value format
 */
function ResultContent({ result }) {
  if (!result) return null;

  // Handle string results
  if (typeof result === 'string') {
    return (
      <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
        {result}
      </pre>
    );
  }

  // Handle object results - show as key-value pairs
  if (typeof result === 'object') {
    const entries = Object.entries(result);

    // Filter out some internal/noisy fields for cleaner display
    const displayEntries = entries.filter(([key]) =>
      !['timestamp', 'requestId', 'traceId'].includes(key)
    );

    if (displayEntries.length === 0) {
      return (
        <div className="text-gray-500 italic text-sm">No data</div>
      );
    }

    return (
      <div className="space-y-2">
        {displayEntries.map(([key, value]) => (
          <div key={key} className="flex flex-col sm:flex-row sm:items-start gap-1">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 min-w-[100px] shrink-0">
              {formatKeyName(key)}
            </span>
            <div className="text-xs flex-1 overflow-hidden">
              <ValueRenderer value={value} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Fallback for other types
  return <div className="text-sm">{String(result)}</div>;
}

/**
 * Format key names for display (camelCase to Title Case)
 */
function formatKeyName(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .replace(/_/g, ' ')
    .trim();
}

/**
 * Format tool name for display
 */
function formatToolName(toolId) {
  if (!toolId) return 'Tool';

  const names = {
    terminal: 'Terminal',
    filesystem: 'File System',
    web: 'Web Browser',
    taskmanager: 'Task Manager',
    agentcommunication: 'Agent Communication',
    agentdelay: 'Agent Delay',
    jobdone: 'Job Done',
    seek: 'Code Search',
    'file-tree': 'File Tree',
    'file-content-replace': 'File Replace',
    'static-analysis': 'Static Analysis',
    'clone-detection': 'Clone Detection',
    'import-analyzer': 'Import Analyzer',
    'dependency-resolver': 'Dependency Resolver',
    'code-map': 'Code Map'
  };

  return names[toolId?.toLowerCase()] || toolId;
}

/**
 * Main ToolResultCard component
 */
function ToolResultCard({ result, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const statusStyle = STATUS_STYLES[result.status] || STATUS_STYLES.completed;
  const StatusIcon = statusStyle.icon;
  const ToolIcon = TOOL_ICONS[result.toolId?.toLowerCase()] || WrenchScrewdriverIcon;

  // Memoize the tool name
  const toolName = useMemo(() => formatToolName(result.toolId), [result.toolId]);

  return (
    <div className={`rounded-lg border ${statusStyle.borderColor} overflow-hidden`}>
      {/* Header - Always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full px-3 py-2 flex items-center justify-between ${statusStyle.bgColor} hover:opacity-90 transition-opacity`}
      >
        <div className="flex items-center gap-2">
          {/* Expand/Collapse Icon */}
          {expanded ? (
            <ChevronDownIcon className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRightIcon className="w-4 h-4 text-gray-500" />
          )}

          {/* Tool Icon */}
          <ToolIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />

          {/* Tool Name */}
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {toolName}
          </span>

          {/* Status Badge */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${statusStyle.color}`}>
            <StatusIcon className="w-3 h-3" />
            <span>{statusStyle.label}</span>
          </div>
        </div>

        {/* Execution Time */}
        {result.executionTime && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {result.executionTime}ms
          </span>
        )}
      </button>

      {/* Body - Collapsible */}
      {expanded && (
        <div className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
          {/* Error Message */}
          {result.error && (
            <div className="mx-3 mt-2 mb-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-600 dark:text-red-400">
              {typeof result.error === 'string' ? result.error : (result.error?.message || JSON.stringify(result.error))}
            </div>
          )}

          {/* Result Content - Use custom renderer if available */}
          {result.result && (() => {
            const toolId = result.toolId?.toLowerCase();
            if (toolId && hasCustomRenderer(toolId)) {
              // Use the custom renderer with result data as parsedData
              // The result.result contains the actual output (tree, matches, etc.)
              const CustomRenderer = getRenderer(toolId);
              const resultData = {
                ...result.result,
                success: result.status === 'completed',
                toolId
              };
              return (
                <CustomRenderer
                  toolId={toolId}
                  rawContent={JSON.stringify(result.result, null, 2)}
                  parsedData={resultData}
                />
              );
            }
            // Fallback to generic key-value renderer
            return (
              <div className="px-3 py-2">
                <ResultContent result={result.result} />
              </div>
            );
          })()}

          {/* Empty state */}
          {!result.error && !result.result && (
            <div className="px-3 py-2 text-gray-500 italic text-sm">No output</div>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolResultCard;
