/**
 * CodeMapRenderer Component
 *
 * Displays code structure skeletons as collapsible file accordions.
 * Shows function/class/method signatures with line numbers and kind badges.
 * For read-range actions: syntax-highlighted code with line numbers.
 */

import React, { useState, useMemo } from 'react';
import { usePersistedToggle, extractResult } from './usePersistedState';
import {
  MapIcon,
  DocumentTextIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeBracketIcon,
  CubeIcon,
  HashtagIcon
} from '@heroicons/react/24/outline';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAppStore } from '../../stores/appStore';

/**
 * Kind badge styling
 */
const KIND_CONFIG = {
  'function': { label: 'fn', bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
  'signature': { label: 'fn', bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
  'class': { label: 'class', bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-700 dark:text-purple-300' },
  'method': { label: 'method', bg: 'bg-teal-100 dark:bg-teal-900/40', text: 'text-teal-700 dark:text-teal-300' },
  'variable': { label: 'var', bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300' },
  'const': { label: 'const', bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300' },
  'export': { label: 'export', bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300' },
  'import': { label: 'import', bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-600 dark:text-gray-400' },
  'interface': { label: 'iface', bg: 'bg-indigo-100 dark:bg-indigo-900/40', text: 'text-indigo-700 dark:text-indigo-300' },
  'type': { label: 'type', bg: 'bg-pink-100 dark:bg-pink-900/40', text: 'text-pink-700 dark:text-pink-300' },
};

function KindBadge({ kind }) {
  const config = KIND_CONFIG[kind] || { label: kind, bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-600 dark:text-gray-400' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

/**
 * Parse code map data
 */
function parseCodeMapData(parsedData) {
  if (!parsedData) return null;
  const params = parsedData.parameters || parsedData;

  return {
    action: params.action || 'skeleton',
    level: params.level || 'B.0',
    path: params.path || params.filePath || '',
    files: params.files || [],
    totalFiles: params.totalFiles || params.total_files || 0,
    totalEntries: params.totalEntries || params.total_entries || 0,
    // read-range fields
    filePath: params.filePath || params.file_path || '',
    startLine: params.startLine || params.start_line || 0,
    endLine: params.endLine || params.end_line || 0,
    linesReturned: params.linesReturned || 0,
    totalLines: params.totalLines || 0,
    content: params.content || '',
    success: params.success,
    guidance: params.guidance
  };
}

function getFilename(path) {
  return path ? path.split(/[/\\]/).pop() || path : 'unknown';
}

/**
 * Single file skeleton accordion
 */
function FileAccordion({ file, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const entries = file.entries || [];

  return (
    <div className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        )}
        <CodeBracketIcon className="w-4 h-4 text-cyan-500 flex-shrink-0" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
          {getFilename(file.file)}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500 truncate hidden sm:inline" title={file.file}>
          {file.file}
        </span>
        <span className="ml-auto flex-shrink-0 flex items-center gap-2">
          {file.totalLines && (
            <span className="text-[10px] text-gray-400">{file.totalLines} lines</span>
          )}
          <span className="text-xs bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 px-1.5 py-0.5 rounded-full">
            {entries.length}
          </span>
        </span>
      </button>

      {expanded && entries.length > 0 && (
        <div className="pl-9 pr-3 pb-2 space-y-0.5">
          {entries.map((entry, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 py-0.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/30 text-xs font-mono"
            >
              <span className="text-gray-400 w-6 text-right flex-shrink-0 select-none">
                {entry.line}
              </span>
              <KindBadge kind={entry.kind} />
              <span className="text-gray-700 dark:text-gray-300 truncate">
                {entry.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CodeMapRenderer({ toolId, rawContent, parsedData, messageTimestamp, index }) {
  const { darkMode } = useAppStore();
  const data = useMemo(() => parseCodeMapData(parsedData), [parsedData]);
  const { hasResults: _hasResults, result: _result } = extractResult(parsedData);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 text-sm">
        <MapIcon className="w-4 h-4" />
        <span>Code Map (unable to parse)</span>
      </div>
    );
  }

  // Read-range action: show syntax-highlighted code
  if (data.action === 'read-range' && data.content) {
    const ext = data.filePath.substring(data.filePath.lastIndexOf('.')).toLowerCase();
    const langMap = { '.js': 'javascript', '.jsx': 'jsx', '.ts': 'typescript', '.tsx': 'tsx', '.py': 'python', '.json': 'json', '.css': 'css', '.html': 'html' };
    const language = langMap[ext] || 'text';

    return (
      <div className="my-2 rounded-lg overflow-hidden border border-cyan-200 dark:border-cyan-800 shadow-md">
        <div className="flex items-center justify-between px-3 py-2 bg-cyan-50 dark:bg-cyan-900/20 border-b border-cyan-200 dark:border-cyan-800">
          <div className="flex items-center gap-2">
            <HashtagIcon className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {getFilename(data.filePath)}
            </span>
            <span className="text-xs text-gray-500">
              L{data.startLine}–{data.endLine}
            </span>
          </div>
          <span className="text-xs text-gray-400">
            {data.linesReturned} of {data.totalLines} lines
          </span>
        </div>
        <div className="bg-gray-900 dark:bg-gray-950">
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            showLineNumbers={true}
            startingLineNumber={data.startLine}
            lineNumberStyle={{ minWidth: '3em', paddingRight: '1em', color: '#636d83' }}
            customStyle={{ margin: 0, padding: '1rem', fontSize: '12px', background: 'transparent' }}
            wrapLines={true}
            wrapLongLines={true}
          >
            {data.content}
          </SyntaxHighlighter>
        </div>
      </div>
    );
  }

  // Skeleton action: show file accordions
  return (
    <div className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-cyan-50 dark:bg-cyan-900/20 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <MapIcon className="w-4.5 h-4.5 text-cyan-600 dark:text-cyan-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Code Map</span>
          <code className="text-xs bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 px-1.5 py-0.5 rounded font-mono">
            {data.path}
          </code>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span><span className="font-semibold">{data.totalFiles}</span> files</span>
          <span><span className="font-semibold">{data.totalEntries}</span> entries</span>
          <span className="text-gray-400">Level {data.level}</span>
        </div>
      </div>

      {/* File list */}
      <div className="bg-white dark:bg-gray-900 max-h-96 overflow-y-auto">
        {(() => {
          // Merge _result files/entries if available
          const mergedFiles = data.files.length > 0 ? data.files : (_result?.files || []);
          return mergedFiles.length > 0 ? (
          mergedFiles.map((file, idx) => (
            <FileAccordion key={file.file || idx} file={file} defaultExpanded={idx < 3} />
          ))
        ) : (_hasResults || data.success !== undefined) ? (
          <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
            <MapIcon className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
            <p>No entries found</p>
          </div>
        ) : (
          <div className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center flex-shrink-0">
              <MapIcon className="w-5 h-5 text-cyan-500 animate-pulse" />
            </div>
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">Mapping code structure...</p>
              <p className="text-xs text-gray-400 mt-0.5">{data.path}</p>
            </div>
          </div>
        );
        })()}
      </div>
    </div>
  );
}

export default CodeMapRenderer;
