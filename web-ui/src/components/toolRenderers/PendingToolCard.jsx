/**
 * PendingToolCard Component
 *
 * Skeleton/placeholder card shown while a tool invocation is still being streamed.
 * Displays partial information extracted from the incomplete JSON.
 *
 * Features:
 * - Shows tool name if detectable from partial JSON
 * - Shows action if detectable
 * - Animated loading indicator
 * - Preview of partial JSON content (first line + live tail)
 * - Glowing character counter for visibility
 */

import React from 'react';
import {
  WrenchScrewdriverIcon,
  FolderOpenIcon,
  CommandLineIcon,
  ClipboardDocumentListIcon,
  ChatBubbleLeftRightIcon,
  GlobeAltIcon,
  CheckCircleIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
  CodeBracketIcon
} from '@heroicons/react/24/outline';
import { getToolDisplayName, TOOL_IDS } from '../../constants/toolConstants';

/**
 * Get icon component for a tool ID
 */
function getToolIcon(toolId) {
  if (!toolId) return WrenchScrewdriverIcon;

  const iconMap = {
    [TOOL_IDS.FILESYSTEM]: FolderOpenIcon,
    [TOOL_IDS.TERMINAL]: CommandLineIcon,
    [TOOL_IDS.TASK_MANAGER]: ClipboardDocumentListIcon,
    [TOOL_IDS.AGENT_COMMUNICATION]: ChatBubbleLeftRightIcon,
    [TOOL_IDS.WEB]: GlobeAltIcon,
    [TOOL_IDS.JOB_DONE]: CheckCircleIcon,
    [TOOL_IDS.AGENT_DELAY]: ClockIcon,
    [TOOL_IDS.SEEK]: MagnifyingGlassIcon,
    [TOOL_IDS.FILE_CONTENT_REPLACE]: DocumentTextIcon,
    [TOOL_IDS.STATIC_ANALYSIS]: CodeBracketIcon,
    [TOOL_IDS.IMPORT_ANALYZER]: MagnifyingGlassIcon,
    [TOOL_IDS.DEPENDENCY_RESOLVER]: CodeBracketIcon,
    [TOOL_IDS.CLONE_DETECTION]: DocumentTextIcon,
    [TOOL_IDS.FILE_TREE]: FolderOpenIcon
  };

  return iconMap[toolId] || WrenchScrewdriverIcon;
}

/**
 * Get color scheme for a tool ID
 */
function getToolColorScheme(toolId) {
  if (!toolId) {
    return {
      bg: 'bg-gray-50 dark:bg-gray-800',
      border: 'border-gray-200 dark:border-gray-700',
      icon: 'text-gray-500 dark:text-gray-400',
      text: 'text-gray-700 dark:text-gray-300',
      bar: 'bg-gray-400'
    };
  }

  const colorMap = {
    [TOOL_IDS.FILESYSTEM]: {
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      border: 'border-blue-200 dark:border-blue-800',
      icon: 'text-blue-500 dark:text-blue-400',
      text: 'text-blue-700 dark:text-blue-300',
      bar: 'bg-blue-500'
    },
    [TOOL_IDS.TERMINAL]: {
      bg: 'bg-gray-50 dark:bg-gray-800',
      border: 'border-gray-300 dark:border-gray-600',
      icon: 'text-gray-600 dark:text-gray-400',
      text: 'text-gray-700 dark:text-gray-300',
      bar: 'bg-gray-500'
    },
    [TOOL_IDS.TASK_MANAGER]: {
      bg: 'bg-purple-50 dark:bg-purple-900/20',
      border: 'border-purple-200 dark:border-purple-800',
      icon: 'text-purple-500 dark:text-purple-400',
      text: 'text-purple-700 dark:text-purple-300',
      bar: 'bg-purple-500'
    },
    [TOOL_IDS.AGENT_COMMUNICATION]: {
      bg: 'bg-indigo-50 dark:bg-indigo-900/20',
      border: 'border-indigo-200 dark:border-indigo-800',
      icon: 'text-indigo-500 dark:text-indigo-400',
      text: 'text-indigo-700 dark:text-indigo-300',
      bar: 'bg-indigo-500'
    },
    [TOOL_IDS.WEB]: {
      bg: 'bg-cyan-50 dark:bg-cyan-900/20',
      border: 'border-cyan-200 dark:border-cyan-800',
      icon: 'text-cyan-500 dark:text-cyan-400',
      text: 'text-cyan-700 dark:text-cyan-300',
      bar: 'bg-cyan-500'
    },
    [TOOL_IDS.JOB_DONE]: {
      bg: 'bg-green-50 dark:bg-green-900/20',
      border: 'border-green-200 dark:border-green-800',
      icon: 'text-green-500 dark:text-green-400',
      text: 'text-green-700 dark:text-green-300',
      bar: 'bg-green-500'
    },
    [TOOL_IDS.CODE_MAP]: {
      bg: 'bg-teal-50 dark:bg-teal-900/20',
      border: 'border-teal-200 dark:border-teal-800',
      icon: 'text-teal-500 dark:text-teal-400',
      text: 'text-teal-700 dark:text-teal-300',
      bar: 'bg-teal-500'
    }
  };

  return colorMap[toolId] || {
    bg: 'bg-gray-50 dark:bg-gray-800',
    border: 'border-gray-200 dark:border-gray-700',
    icon: 'text-gray-500 dark:text-gray-400',
    text: 'text-gray-700 dark:text-gray-300',
    bar: 'bg-gray-400'
  };
}

/**
 * Extract progress metrics from partial JSON content
 * @param {string} partial - Partial JSON string
 * @returns {Object} Progress metrics { chars }
 */
function extractProgressMetrics(partial) {
  if (!partial) return { chars: 0 };
  return { chars: partial.length };
}

/**
 * Format progress display (character count)
 * @param {Object} metrics - Progress metrics
 * @returns {string} Formatted progress string
 */
function formatProgress(metrics) {
  if (metrics.chars < 50) return '';

  // Format with K suffix for thousands
  if (metrics.chars >= 1000) {
    return `${(metrics.chars / 1000).toFixed(1)}K chars`;
  }
  return `${metrics.chars} chars`;
}

/**
 * Extract the last meaningful portion of content (live tail)
 * Shows the user what's actively being written
 * @param {string} content - Full partial content
 * @param {number} maxLength - Maximum characters to show
 * @returns {string} Last portion of content
 */
function extractLiveTail(content, maxLength = 60) {
  if (!content || content.length <= maxLength) return '';

  // Get the last portion
  let tail = content.slice(-maxLength);

  // Try to start at a word boundary (after a space)
  const spaceIndex = tail.indexOf(' ');
  if (spaceIndex > 0 && spaceIndex < 20) {
    tail = tail.slice(spaceIndex + 1);
  }

  return tail;
}

/**
 * PendingToolCard Component
 *
 * @param {Object} props
 * @param {string} props.toolId - Detected tool ID (may be null)
 * @param {string} props.action - Detected action (may be null)
 * @param {string} props.partial - Partial JSON content
 */
function PendingToolCard({ toolId, action, partial }) {
  const IconComponent = getToolIcon(toolId);
  const colors = getToolColorScheme(toolId);
  const displayName = toolId ? getToolDisplayName(toolId) : 'Tool';

  // Extract progress metrics from partial content
  const progressMetrics = extractProgressMetrics(partial);
  const progressText = formatProgress(progressMetrics);

  // Get first line preview (truncated)
  const firstLinePreview = partial
    ? partial.length > 60
      ? partial.substring(0, 60) + '...'
      : partial
    : '';

  // Get live tail (last portion being written) - only if content is long enough
  const liveTail = partial && partial.length > 120 ? extractLiveTail(partial) : '';

  return (
    <div
      className={`my-2 p-3 rounded-lg border ${colors.bg} ${colors.border} transition-all duration-200`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconComponent className={`w-5 h-5 ${colors.icon}`} />
          <span className={`text-sm font-medium ${colors.text}`}>
            {displayName}
          </span>
          {action && (
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
              {action}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Progress indicator with gentle glow */}
          {progressText && (
            <span className="text-xs font-mono text-amber-600 dark:text-amber-400 animate-glow-subtle">
              {progressText}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            streaming...
          </span>
        </div>
      </div>

      {/* Partial content preview - first line + live tail */}
      {(firstLinePreview || liveTail) && (
        <div className="mt-2 text-xs font-mono bg-gray-100 dark:bg-gray-900/50 rounded px-2 py-1 space-y-1">
          {/* First line preview */}
          {firstLinePreview && (
            <div className="text-gray-400 dark:text-gray-500 truncate">
              {firstLinePreview}
            </div>
          )}
          {/* Live tail - shows what's actively being written */}
          {liveTail && (
            <div className="text-gray-500 dark:text-gray-400 truncate border-l-2 border-amber-400 pl-2 animate-pulse-subtle">
              ...{liveTail}
            </div>
          )}
        </div>
      )}

      {/* Animated loading bar */}
      <div className="mt-2 h-1 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
        <div
          className={`h-full ${colors.bar} rounded animate-pulse`}
          style={{
            width: '100%',
            animation: 'shimmer 1.5s ease-in-out infinite'
          }}
        />
      </div>

      {/* CSS for animations */}
      <style>{`
        @keyframes shimmer {
          0% { opacity: 0.3; transform: translateX(-100%); }
          50% { opacity: 1; }
          100% { opacity: 0.3; transform: translateX(100%); }
        }
        @keyframes glow-subtle {
          0%, 100% {
            opacity: 0.7;
            text-shadow: 0 0 2px currentColor;
          }
          50% {
            opacity: 1;
            text-shadow: 0 0 8px currentColor, 0 0 12px currentColor;
          }
        }
        @keyframes pulse-subtle {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        .animate-glow-subtle {
          animation: glow-subtle 2s ease-in-out infinite;
        }
        .animate-pulse-subtle {
          animation: pulse-subtle 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

export default PendingToolCard;
