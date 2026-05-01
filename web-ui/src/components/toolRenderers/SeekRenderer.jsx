/**
 * SeekRenderer Component
 *
 * VS Code-style search results panel.
 * Groups matches by file with highlighted search terms, line numbers,
 * collapsible file sections, and match count summary.
 */

import React, { useState, useMemo } from 'react';
import { usePersistedToggle, extractResult } from './usePersistedState';
import {
  MagnifyingGlassIcon,
  DocumentTextIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderOpenIcon
} from '@heroicons/react/24/outline';

/**
 * Parse seek results from various JSON formats
 */
function parseSeekData(parsedData) {
  if (!parsedData) return null;

  const params = parsedData.parameters || parsedData;

  // Input parameters
  const filePaths = params.filePaths || params.file_paths || [];
  const searchTerms = params.searchTerms || params.search_terms || [];

  // Result data
  const matchesByTerm = params.matchesByTerm || params.matches_by_term || {};
  const totalMatches = params.totalMatches || params.total_matches || 0;
  const filesSearched = params.filesSearched || params.files_searched || 0;

  // Restructure: group by file for display
  const fileGroups = {};
  for (const [term, matches] of Object.entries(matchesByTerm)) {
    if (!Array.isArray(matches)) continue;
    for (const match of matches) {
      const file = match.filePath || match.file_path || match.file || 'unknown';
      if (!fileGroups[file]) {
        fileGroups[file] = [];
      }
      fileGroups[file].push({
        lineNumber: match.lineNumber || match.line_number || match.line || 0,
        lineContent: match.lineContent || match.line_content || match.content || '',
        term
      });
    }
  }

  // Sort matches within each file by line number
  for (const file of Object.keys(fileGroups)) {
    fileGroups[file].sort((a, b) => a.lineNumber - b.lineNumber);
  }

  return {
    filePaths,
    searchTerms,
    matchesByTerm,
    totalMatches,
    filesSearched,
    fileGroups,
    formattedResults: params.formattedResults,
    success: params.success,
    guidance: params.guidance
  };
}

/**
 * Get filename from path
 */
function getFilename(filePath) {
  if (!filePath) return 'unknown';
  return filePath.split(/[/\\]/).pop() || filePath;
}

/**
 * Highlight search terms within a line
 */
function HighlightedLine({ content, terms }) {
  if (!terms || terms.length === 0) return <span>{content}</span>;

  // Build a regex to match any search term (case-insensitive)
  const escapedTerms = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escapedTerms.join('|')})`, 'gi');

  const parts = content.split(regex);

  return (
    <span>
      {parts.map((part, i) => {
        const isMatch = terms.some(t => part.toLowerCase() === t.toLowerCase());
        return isMatch ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/60 text-yellow-900 dark:text-yellow-100 rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </span>
  );
}

/**
 * Collapsible file group with matches
 */
function FileGroup({ filePath, matches, searchTerms, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const filename = getFilename(filePath);

  return (
    <div className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      {/* File header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        )}
        <DocumentTextIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
          {filename}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500 truncate hidden sm:inline" title={filePath}>
          {filePath}
        </span>
        <span className="ml-auto flex-shrink-0 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded-full">
          {matches.length}
        </span>
      </button>

      {/* Match lines */}
      {expanded && (
        <div className="pl-9 pr-3 pb-1">
          {matches.map((match, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 py-0.5 text-xs font-mono hover:bg-yellow-50/50 dark:hover:bg-yellow-900/10 rounded"
            >
              <span className="text-gray-400 dark:text-gray-600 w-8 text-right flex-shrink-0 select-none">
                {match.lineNumber}
              </span>
              <span className="text-gray-700 dark:text-gray-300 break-all whitespace-pre-wrap">
                <HighlightedLine content={match.lineContent} terms={searchTerms} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SeekRenderer({ toolId, rawContent, parsedData, messageTimestamp, index }) {
  const data = useMemo(() => parseSeekData(parsedData), [parsedData]);
  const { hasResults: _hasResults, result: _result } = extractResult(parsedData);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 text-sm">
        <MagnifyingGlassIcon className="w-4 h-4" />
        <span>Search (unable to parse)</span>
      </div>
    );
  }

  // Merge _result search matches if available
  const mergedFileGroups = { ...data.fileGroups };
  if (_result?.matchesByTerm || _result?.matches_by_term) {
    const resultMatches = _result.matchesByTerm || _result.matches_by_term || {};
    for (const [term, matches] of Object.entries(resultMatches)) {
      if (!Array.isArray(matches)) continue;
      for (const match of matches) {
        const file = match.filePath || match.file_path || match.file || 'unknown';
        if (!mergedFileGroups[file]) mergedFileGroups[file] = [];
        mergedFileGroups[file].push({
          lineNumber: match.lineNumber || match.line_number || match.line || 0,
          lineContent: match.lineContent || match.line_content || match.content || '',
          term
        });
      }
    }
  }

  const fileCount = Object.keys(mergedFileGroups).length;
  const mergedTotalMatches = data.totalMatches || (_result?.totalMatches || _result?.total_matches || 0);
  const hasMatches = mergedTotalMatches > 0 || fileCount > 0;
  const hasResults = _hasResults || data.success !== undefined || data.totalMatches > 0 || data.filesSearched > 0 || Object.keys(data.matchesByTerm).length > 0;

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-md">
      {/* Header - VS Code search style */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <MagnifyingGlassIcon className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {hasResults ? 'Search Results' : 'Searching...'}
          </span>
        </div>

        {/* Summary stats */}
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          {!hasResults && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              running
            </span>
          )}
          {mergedTotalMatches > 0 && (
            <span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">{mergedTotalMatches}</span> matches
            </span>
          )}
          {fileCount > 0 && (
            <span>
              in <span className="font-semibold">{fileCount}</span> files
            </span>
          )}
          {data.filesSearched > 0 && (
            <span className="text-gray-400">
              ({data.filesSearched} searched)
            </span>
          )}
        </div>
      </div>

      {/* Search terms */}
      {data.searchTerms.length > 0 && (
        <div className="px-3 py-2 bg-gray-50 dark:bg-gray-850 border-b border-gray-100 dark:border-gray-800 flex flex-wrap gap-1.5">
          {data.searchTerms.map((term, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-mono"
            >
              <MagnifyingGlassIcon className="w-3 h-3" />
              {term}
            </span>
          ))}
          {data.filePaths.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-xs font-mono">
              <FolderOpenIcon className="w-3 h-3" />
              {data.filePaths.length} path{data.filePaths.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Results body */}
      <div className="bg-white dark:bg-gray-900 max-h-96 overflow-y-auto">
        {hasMatches ? (
          Object.entries(mergedFileGroups).map(([filePath, matches], idx) => (
            <FileGroup
              key={filePath}
              filePath={filePath}
              matches={matches}
              searchTerms={data.searchTerms}
              defaultExpanded={idx < 5}
            />
          ))
        ) : !hasResults ? (
          /* Input-only: still searching */
          <div className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <MagnifyingGlassIcon className="w-5 h-5 text-blue-500 animate-pulse" />
            </div>
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">Searching files...</p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {data.searchTerms.map((term, i) => (
                  <span key={i} className="text-xs font-mono bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">{term}</span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Has results but no matches */
          <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            <MagnifyingGlassIcon className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
            <p>No matches found</p>
            {data.filesSearched > 0 && (
              <p className="text-xs mt-1 text-gray-400">Searched {data.filesSearched} files</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SeekRenderer;
