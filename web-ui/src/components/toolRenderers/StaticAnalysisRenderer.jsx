/**
 * StaticAnalysisRenderer Component
 *
 * Lint-style report with severity icons, error/warning counts,
 * file grouping, rule badges, and fixable indicators.
 */

import React, { useState, useMemo } from 'react';
import { usePersistedToggle, extractResult } from './usePersistedState';
import {
  CodeBracketIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  WrenchScrewdriverIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  ShieldCheckIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

function parseStaticAnalysisData(parsedData) {
  if (!parsedData) return null;
  const params = parsedData.parameters || parsedData;

  // Handle actions array format
  const actions = params.actions || [];
  const firstAction = actions[0] || params;

  return {
    type: firstAction.type || 'analyze',
    results: params.results || [],
    summary: params.summary || {
      filesAnalyzed: 0,
      totalErrors: 0,
      totalWarnings: 0
    },
    success: params.success
  };
}

function SeverityIcon({ severity }) {
  if (severity === 'error') {
    return <XCircleIcon className="w-4 h-4 text-red-500 flex-shrink-0" />;
  }
  return <ExclamationTriangleIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />;
}

function FileIssueGroup({ result, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const errors = result.errors || [];
  const errorCount = result.totalErrors || errors.filter(e => e.severity === 'error').length;
  const warnCount = result.totalWarnings || errors.filter(e => e.severity === 'warning').length;
  const filename = (result.file || 'unknown').split(/[/\\]/).pop();

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
        <DocumentTextIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
          {filename}
        </span>
        <span className="text-xs text-gray-400 truncate hidden sm:inline" title={result.file}>
          {result.file}
        </span>

        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
              <XCircleIcon className="w-3.5 h-3.5" />
              {errorCount}
            </span>
          )}
          {warnCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <ExclamationTriangleIcon className="w-3.5 h-3.5" />
              {warnCount}
            </span>
          )}
        </div>
      </button>

      {expanded && errors.length > 0 && (
        <div className="pl-9 pr-3 pb-2 space-y-0.5">
          {errors.map((error, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/30 text-xs"
            >
              <SeverityIcon severity={error.severity} />
              <span className="text-gray-400 font-mono w-12 text-right flex-shrink-0">
                {error.line}:{error.column || 0}
              </span>
              <span className="text-gray-700 dark:text-gray-300 flex-1">
                {error.message}
              </span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {error.fixable && (
                  <WrenchScrewdriverIcon className="w-3.5 h-3.5 text-green-500" title="Auto-fixable" />
                )}
                {error.rule && (
                  <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">
                    {error.rule}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StaticAnalysisRenderer({ toolId, rawContent, parsedData, messageTimestamp, index }) {
  const data = useMemo(() => parseStaticAnalysisData(parsedData), [parsedData]);
  const { hasResults: _hasResults, result: _result } = extractResult(parsedData);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 text-sm">
        <CodeBracketIcon className="w-4 h-4" />
        <span>Static Analysis (unable to parse)</span>
      </div>
    );
  }

  // Merge _result issues if available
  const mergedResults = data.results.length > 0 ? data.results : (_result?.results || []);
  const mergedSummary = data.summary?.filesAnalyzed > 0 ? data.summary : (_result?.summary || data.summary);
  const { summary } = { summary: mergedSummary };
  const totalIssues = (summary.totalErrors || 0) + (summary.totalWarnings || 0);
  const hasResults = _hasResults || data.success !== undefined || data.results.length > 0 || summary.filesAnalyzed > 0;
  const isClean = hasResults && totalIssues === 0 && mergedResults.length === 0;

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-md">
      {/* Header with summary bar */}
      <div className={`px-3 py-2 border-b border-gray-200 dark:border-gray-700 ${
        isClean ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-gray-100 dark:bg-gray-800'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isClean ? (
              <ShieldCheckIcon className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <CodeBracketIcon className="w-4.5 h-4.5 text-gray-600 dark:text-gray-400" />
            )}
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Static Analysis
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {summary.totalErrors > 0 && (
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold">
                <XCircleIcon className="w-4 h-4" />
                {summary.totalErrors} errors
              </span>
            )}
            {summary.totalWarnings > 0 && (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                <ExclamationTriangleIcon className="w-4 h-4" />
                {summary.totalWarnings} warnings
              </span>
            )}
            {isClean && (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                <CheckCircleIcon className="w-4 h-4" />
                All clear
              </span>
            )}
            {summary.filesAnalyzed > 0 && (
              <span className="text-gray-400">
                {summary.filesAnalyzed} files analyzed
              </span>
            )}
          </div>
        </div>

        {/* Issue severity bar */}
        {totalIssues > 0 && (
          <div className="mt-2 flex h-1.5 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
            {summary.totalErrors > 0 && (
              <div
                className="bg-red-500 h-full"
                style={{ width: `${(summary.totalErrors / totalIssues) * 100}%` }}
              />
            )}
            {summary.totalWarnings > 0 && (
              <div
                className="bg-amber-400 h-full"
                style={{ width: `${(summary.totalWarnings / totalIssues) * 100}%` }}
              />
            )}
          </div>
        )}
      </div>

      {/* File results */}
      <div className="bg-white dark:bg-gray-900 max-h-96 overflow-y-auto">
        {!hasResults ? (
          /* Input-only: still analyzing */
          <div className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
              <CodeBracketIcon className="w-5 h-5 text-gray-500 animate-pulse" />
            </div>
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">Analyzing code...</p>
              <p className="text-xs text-gray-400 mt-0.5">Running static analysis checks</p>
            </div>
          </div>
        ) : mergedResults.length > 0 ? (
          mergedResults.map((result, idx) => (
            <FileIssueGroup key={result.file || idx} result={result} defaultExpanded={idx < 5} />
          ))
        ) : isClean ? (
          <div className="p-6 text-center">
            <ShieldCheckIcon className="w-10 h-10 mx-auto mb-2 text-emerald-400" />
            <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">No issues found</p>
            <p className="text-xs text-gray-400 mt-1">Code looks clean!</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default StaticAnalysisRenderer;
