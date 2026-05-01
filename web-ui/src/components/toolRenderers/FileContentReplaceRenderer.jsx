/**
 * FileContentReplaceRenderer Component
 *
 * Displays file content replacements in a diff-style view.
 * Shows old vs new content side by side or inline.
 */

import React, { useState, useMemo } from 'react';
import {
  DocumentTextIcon,
  MinusIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline';

/**
 * Get filename from path
 */
function getFilename(filePath) {
  if (!filePath) return 'unknown';
  return filePath.split(/[/\\]/).pop() || filePath;
}

/**
 * Single replacement diff view
 */
function ReplacementDiff({ replacement, index }) {
  const [expanded, setExpanded] = useState(true);

  const oldContent = replacement.oldContent || '';
  const newContent = replacement.newContent || '';
  const linesLimit = replacement.linesLimit;

  // Split into lines for display
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-left"
      >
        {expanded ? (
          <ChevronDownIcon className="w-3 h-3 text-gray-400" />
        ) : (
          <ChevronRightIcon className="w-3 h-3 text-gray-400" />
        )}
        <span className="text-xs text-gray-500">
          Replacement {index + 1}
        </span>
        {linesLimit && (
          <span className="text-xs text-gray-400 ml-auto">
            lines: {linesLimit}
          </span>
        )}
      </button>

      {expanded && (
        <div className="text-xs font-mono">
          {/* Old content (removed) */}
          <div className="bg-red-50 dark:bg-red-900/20 border-b border-gray-200 dark:border-gray-700">
            {oldLines.map((line, i) => (
              <div key={`old-${i}`} className="flex">
                <span className="w-6 flex-shrink-0 text-center text-red-400 bg-red-100 dark:bg-red-900/40 select-none">
                  −
                </span>
                <pre className="flex-1 px-2 py-0.5 text-red-700 dark:text-red-300 overflow-x-auto whitespace-pre">
                  {line || ' '}
                </pre>
              </div>
            ))}
          </div>

          {/* New content (added) */}
          <div className="bg-emerald-50 dark:bg-emerald-900/20">
            {newLines.map((line, i) => (
              <div key={`new-${i}`} className="flex">
                <span className="w-6 flex-shrink-0 text-center text-emerald-500 bg-emerald-100 dark:bg-emerald-900/40 select-none">
                  +
                </span>
                <pre className="flex-1 px-2 py-0.5 text-emerald-700 dark:text-emerald-300 overflow-x-auto whitespace-pre">
                  {line || ' '}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Single file with replacements
 */
function FileReplacement({ file }) {
  const [expanded, setExpanded] = useState(true);
  const filename = getFilename(file.path);
  const replacements = file.replacements || [];

  return (
    <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* File header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 text-left border-b border-gray-200 dark:border-gray-700"
      >
        {expanded ? (
          <ChevronDownIcon className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRightIcon className="w-4 h-4 text-gray-400" />
        )}
        <DocumentTextIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
          {filename}
        </span>
        <span className="text-xs text-gray-500 ml-auto">
          {replacements.length} change{replacements.length !== 1 ? 's' : ''}
        </span>
      </button>

      {/* Path */}
      {expanded && file.path !== filename && (
        <div className="px-3 py-1 bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 font-mono border-b border-gray-200 dark:border-gray-700">
          {file.path}
        </div>
      )}

      {/* Replacements */}
      {expanded && (
        <div className="p-2 space-y-2 bg-white dark:bg-gray-900">
          {replacements.map((rep, idx) => (
            <ReplacementDiff key={idx} replacement={rep} index={idx} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Parse file replacements from JSON
 */
function parseReplacements(parsedData) {
  if (!parsedData) return [];

  // Direct files array
  if (parsedData.files && Array.isArray(parsedData.files)) {
    return parsedData.files;
  }

  // Inside actions
  if (parsedData.actions?.length > 0) {
    const first = parsedData.actions[0];
    if (first.files) return first.files;

    // Single file format
    if (first.path) {
      return [{
        path: first.path,
        replacements: first.replacements || [{
          oldContent: first.oldContent,
          newContent: first.newContent,
          linesLimit: first.linesLimit
        }]
      }];
    }
  }

  // Parameters format
  if (parsedData.parameters?.files) {
    return parsedData.parameters.files;
  }

  return [];
}

/**
 * Main component
 */
function FileContentReplaceRenderer({ toolId, rawContent, innerContent, parsedData }) {
  const files = useMemo(() => parseReplacements(parsedData), [parsedData]);

  if (files.length === 0) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-50 dark:bg-gray-800/50 text-sm text-gray-500">
        <DocumentTextIcon className="w-4 h-4" />
        <span>File content replace</span>
      </div>
    );
  }

  // Count total replacements
  const totalReplacements = files.reduce((sum, f) => sum + (f.replacements?.length || 0), 0);

  return (
    <div>
      {/* Summary line */}
      <div className="flex items-center gap-2 py-1 px-2 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <MinusIcon className="w-3 h-3 text-red-500" />
          <PlusIcon className="w-3 h-3 text-emerald-500" />
        </div>
        <span>
          {totalReplacements} replacement{totalReplacements !== 1 ? 's' : ''} in {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Files */}
      {files.map((file, idx) => (
        <FileReplacement key={idx} file={file} />
      ))}
    </div>
  );
}

export default FileContentReplaceRenderer;
