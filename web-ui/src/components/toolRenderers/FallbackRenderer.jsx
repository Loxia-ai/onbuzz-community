/**
 * FallbackRenderer Component
 *
 * Default renderer for tool invocations when no specialized renderer exists.
 * Displays the raw tool content in a formatted, syntax-highlighted code block.
 *
 * Features:
 * - Collapsible content for long tool invocations
 * - Syntax highlighting for XML/JSON
 * - Tool name and icon header
 * - Copy to clipboard functionality
 */

import React, { useState } from 'react';
import { usePersistedToggle } from './usePersistedState';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardIcon,
  CheckIcon,
  WrenchScrewdriverIcon
} from '@heroicons/react/24/outline';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getToolDisplayName } from '../../constants/toolConstants';
import { useAppStore } from '../../stores/appStore';

/**
 * Maximum lines to show before collapsing
 */
const COLLAPSE_THRESHOLD_LINES = 10;

/**
 * Detect language from content
 */
function detectLanguage(content) {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'json';
  }
  if (trimmed.startsWith('<')) {
    return 'xml';
  }
  return 'text';
}

/**
 * Format content for display
 */
function formatContent(content, language) {
  if (language === 'json') {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content;
    }
  }
  return content;
}

function FallbackRenderer({ toolId, rawContent, parsedData, messageTimestamp, index }) {
  const { darkMode } = useAppStore();
  const [isExpanded, toggleExpanded, setIsExpanded] = usePersistedToggle('fallback', messageTimestamp, index, false);
  const [copied, setCopied] = useState(false);

  const displayName = getToolDisplayName(toolId);
  const language = detectLanguage(rawContent);
  const formattedContent = formatContent(rawContent, language);
  const lineCount = formattedContent.split('\n').length;
  const shouldCollapse = lineCount > COLLAPSE_THRESHOLD_LINES;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Determine what content to show
  const displayContent = shouldCollapse && !isExpanded
    ? formattedContent.split('\n').slice(0, COLLAPSE_THRESHOLD_LINES).join('\n') + '\n...'
    : formattedContent;

  return (
    <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-2">
          <WrenchScrewdriverIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {displayName}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-500 uppercase">
            {language}
          </span>
        </div>

        <div className="flex items-center space-x-1">
          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
            title="Copy to clipboard"
          >
            {copied ? (
              <CheckIcon className="w-4 h-4 text-green-500" />
            ) : (
              <ClipboardIcon className="w-4 h-4" />
            )}
          </button>

          {/* Expand/Collapse button */}
          {shouldCollapse && (
            <button
              onClick={toggleExpanded}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <ChevronDownIcon className="w-4 h-4" />
              ) : (
                <ChevronRightIcon className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={language}
          style={darkMode ? oneDark : oneLight}
          customStyle={{
            margin: 0,
            padding: '12px',
            fontSize: '12px',
            background: 'transparent'
          }}
          wrapLines={true}
          wrapLongLines={true}
        >
          {displayContent}
        </SyntaxHighlighter>
      </div>

      {/* Expand indicator */}
      {shouldCollapse && !isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="w-full py-1 text-xs text-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          Show {lineCount - COLLAPSE_THRESHOLD_LINES} more lines
        </button>
      )}
    </div>
  );
}

export default FallbackRenderer;
