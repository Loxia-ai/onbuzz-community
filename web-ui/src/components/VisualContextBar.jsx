/**
 * @file VisualContextBar.jsx
 * @description Compact, modern capsule showing current visual selection context above chat input.
 * Displays selected element info, source location, and provides dismiss action.
 */

import React, { useState } from 'react';

/**
 * VisualContextBar - Shows current visual selection above chat input
 * Redesigned with a modern capsule/pill appearance
 */
export function VisualContextBar({ context, onClear, onScrollTo }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!context) return null;

  const { selector, tagName, text, attributes, sourceHint } = context;

  // Format element tag for display
  const formatTag = () => {
    let tag = tagName || 'element';
    if (attributes?.id) {
      tag += `#${attributes.id}`;
    }
    return tag;
  };

  // Get classes (first 2)
  const getClasses = () => {
    if (!attributes?.class) return null;
    const classes = attributes.class.split(' ').filter(Boolean).slice(0, 2);
    return classes.length > 0 ? classes : null;
  };

  // Truncate text for display
  const truncateText = (str, maxLen = 25) => {
    if (!str) return null;
    const trimmed = str.trim().replace(/\s+/g, ' ');
    return trimmed.length > maxLen ? trimmed.substring(0, maxLen) + '...' : trimmed;
  };

  const elementTag = formatTag();
  const classes = getClasses();
  const truncatedText = truncateText(text);
  const hasSource = sourceHint?.file || sourceHint?.component;
  const isLowConfidence = sourceHint?.confidence === 'low';

  return (
    <div className="relative max-w-full">
      {/* Main capsule - constrained width with overflow handling */}
      <div className="inline-flex items-center gap-1 max-w-full bg-gradient-to-r from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/20 dark:to-teal-500/20 border border-emerald-300/50 dark:border-emerald-600/50 rounded-full pl-2 pr-1 py-1 shadow-sm hover:shadow-md transition-shadow">
        {/* Target icon */}
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-emerald-500 text-white">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
            <path d="M8 1a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 1ZM8 11a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 11ZM11.75 8a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75ZM1 8a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 1 8ZM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
          </svg>
        </div>

        {/* Element tag - truncate if too long */}
        <code className="text-xs font-mono font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-100/50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded truncate max-w-[150px]">
          &lt;{elementTag}&gt;
        </code>

        {/* Classes (if any) - hidden on small screens, limited display */}
        {classes && (
          <div className="hidden md:flex items-center gap-0.5 flex-shrink min-w-0">
            {classes.slice(0, 1).map((cls, i) => (
              <span
                key={i}
                className="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded truncate max-w-[80px]"
              >
                .{cls}
              </span>
            ))}
            {(classes.length > 1 || attributes.class.split(' ').length > 2) && (
              <span className="text-xs text-gray-400 flex-shrink-0">+{attributes.class.split(' ').length - 1}</span>
            )}
          </div>
        )}

        {/* Text preview - hidden on smaller screens */}
        {truncatedText && (
          <span className="text-xs text-gray-500 dark:text-gray-400 italic max-w-[100px] truncate hidden lg:inline flex-shrink min-w-0">
            "{truncatedText}"
          </span>
        )}

        {/* Source hint indicator - hidden on very small screens */}
        {hasSource && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={`hidden sm:flex flex-shrink-0 items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors ${
              isExpanded
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                : 'text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
            }`}
            title={isExpanded ? 'Hide source' : 'Show source'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
              <path fillRule="evenodd" d="M4 1.75a.75.75 0 0 1 1.5 0V3h5V1.75a.75.75 0 0 1 1.5 0V3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2V1.75ZM4.5 6a1 1 0 0 0-1 1v4.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-7Z" clipRule="evenodd" />
            </svg>
            <span className="hidden md:inline truncate max-w-[80px]">
              {sourceHint?.component || sourceHint?.file?.split('/').pop()}
            </span>
            {isLowConfidence && (
              <span className="text-amber-500" title="Low confidence">?</span>
            )}
          </button>
        )}

        {/* Scroll to element button - always visible */}
        {onScrollTo && (
          <button
            onClick={() => onScrollTo(selector)}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
            title="Scroll to element"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M8 1a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5A.75.75 0 0 1 8 1ZM4.22 7.22a.75.75 0 0 1 1.06 0L8 9.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 8.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              <path d="M2 13.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" />
            </svg>
          </button>
        )}

        {/* Clear button - always visible and accessible */}
        <button
          onClick={onClear}
          className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 rounded-full hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
          title="Clear selection"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
          </svg>
        </button>
      </div>

      {/* Expanded source details panel */}
      {isExpanded && hasSource && (
        <div className="absolute left-0 top-full mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 min-w-[250px] max-w-[400px]">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {/* Component name */}
              {sourceHint?.component && (
                <div className="flex items-center gap-1.5 mb-1">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-purple-500 flex-shrink-0">
                    <path d="M2.5 3A1.5 1.5 0 0 0 1 4.5v.793c.026.009.051.02.076.032L7.674 8.51c.206.1.446.1.652 0l6.598-3.185A.755.755 0 0 1 15 5.293V4.5A1.5 1.5 0 0 0 13.5 3h-11Z" />
                    <path d="M15 6.954 8.978 9.86a2.25 2.25 0 0 1-1.956 0L1 6.954V11.5A1.5 1.5 0 0 0 2.5 13h11a1.5 1.5 0 0 0 1.5-1.5V6.954Z" />
                  </svg>
                  <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                    {sourceHint.component}
                  </span>
                </div>
              )}

              {/* File path */}
              {sourceHint?.file && (
                <div className="flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-gray-400 flex-shrink-0">
                    <path fillRule="evenodd" d="M3.5 2A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 12.5 4H9.621a1.5 1.5 0 0 1-1.06-.44L7.439 2.44A1.5 1.5 0 0 0 6.378 2H3.5Zm6.75 7.75a.75.75 0 0 0 0-1.5h-4.5a.75.75 0 0 0 0 1.5h4.5Z" clipRule="evenodd" />
                  </svg>
                  <code className="text-xs text-gray-600 dark:text-gray-300 font-mono truncate">
                    {sourceHint.file}
                    {sourceHint.line && (
                      <span className="text-blue-500">:{sourceHint.line}</span>
                    )}
                  </code>
                </div>
              )}

              {/* Confidence warning */}
              {isLowConfidence && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-600 dark:text-amber-400">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.804a1.5 1.5 0 0 1-1.3-2.25l5.197-9ZM8 5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5Zm0 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                  </svg>
                  <span>Source location may need verification</span>
                </div>
              )}
            </div>

            {/* Close expanded panel */}
            <button
              onClick={() => setIsExpanded(false)}
              className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                <path d="M3.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 9l-4.72 4.72a.75.75 0 1 0 1.06 1.06L8 10.06l4.72 4.72a.75.75 0 1 0 1.06-1.06L9.06 9l4.72-4.72a.75.75 0 0 0-1.06-1.06L8 7.94 3.28 3.22Z" />
              </svg>
            </button>
          </div>

          {/* Full selector (for developers) */}
          <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700">
            <div className="text-xs text-gray-400 mb-1">CSS Selector</div>
            <code className="block text-xs font-mono text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 p-2 rounded overflow-x-auto whitespace-nowrap">
              {selector}
            </code>
          </div>
        </div>
      )}
    </div>
  );
}

export default VisualContextBar;
