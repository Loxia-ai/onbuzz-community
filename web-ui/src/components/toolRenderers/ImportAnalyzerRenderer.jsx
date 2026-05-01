/**
 * ImportAnalyzerRenderer Component
 *
 * Health dashboard with category cards for missing files, missing exports,
 * circular dependencies, and unused exports. Expandable issue lists.
 */

import React, { useState, useMemo } from 'react';
import { usePersistedToggle, extractResult } from './usePersistedState';
import {
  MagnifyingGlassIcon,
  ExclamationCircleIcon,
  ArrowPathIcon,
  ArchiveBoxXMarkIcon,
  DocumentMinusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

function parseImportAnalyzerData(parsedData) {
  if (!parsedData) return null;
  const params = parsedData.parameters || parsedData;

  const analysis = params.analysis || {};
  return {
    mode: analysis.mode || params.mode || 'full',
    missingFiles: analysis.missingFiles || analysis.missing_files || [],
    missingExports: analysis.missingExports || analysis.missing_exports || [],
    circularDependencies: analysis.circularDependencies || analysis.circular_dependencies || [],
    unusedExports: analysis.unusedExports || analysis.unused_exports || [],
    statistics: params.statistics || {
      totalFiles: 0,
      filesWithIssues: 0,
      totalIssues: 0
    },
    output: params.output || '',
    success: params.success
  };
}

/**
 * Category card with expandable issue list
 */
function CategoryCard({ title, icon: Icon, items, color, emptyText, renderItem }) {
  const [expanded, setExpanded] = useState(items.length > 0 && items.length <= 10);
  const count = items.length;

  const colorClasses = {
    red: { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800', text: 'text-red-600 dark:text-red-400', badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
    amber: { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', text: 'text-amber-600 dark:text-amber-400', badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
    purple: { bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800', text: 'text-purple-600 dark:text-purple-400', badge: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
    blue: { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-600 dark:text-blue-400', badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' }
  };

  const c = colorClasses[color] || colorClasses.blue;

  return (
    <div className={`rounded-lg border ${count > 0 ? c.border : 'border-gray-200 dark:border-gray-700'} overflow-hidden`}>
      <button
        onClick={() => count > 0 && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 transition-colors text-left ${
          count > 0 ? `${c.bg} hover:opacity-80` : 'bg-gray-50 dark:bg-gray-800/50'
        }`}
      >
        {count > 0 ? (
          expanded ? <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            : <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        ) : (
          <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
        )}
        <Icon className={`w-4 h-4 ${count > 0 ? c.text : 'text-emerald-500'} flex-shrink-0`} />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1">
          {title}
        </span>
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${count > 0 ? c.badge : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'}`}>
          {count}
        </span>
      </button>

      {expanded && count > 0 && (
        <div className="px-3 py-2 bg-white dark:bg-gray-900 space-y-1 max-h-40 overflow-y-auto">
          {items.map((item, idx) => (
            <div key={idx} className="text-xs font-mono text-gray-600 dark:text-gray-400 py-0.5">
              {renderItem ? renderItem(item) : (typeof item === 'string' ? item : JSON.stringify(item))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImportAnalyzerRenderer({ toolId, rawContent, parsedData, messageTimestamp, index }) {
  const data = useMemo(() => parseImportAnalyzerData(parsedData), [parsedData]);
  const { hasResults: _hasResults, result: _result } = extractResult(parsedData);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 text-sm">
        <MagnifyingGlassIcon className="w-4 h-4" />
        <span>Import Analyzer (unable to parse)</span>
      </div>
    );
  }

  // Merge _result data if available
  const mergedMissingFiles = data.missingFiles.length > 0 ? data.missingFiles : (_result?.missingFiles || _result?.missing_files || data.missingFiles);
  const mergedMissingExports = data.missingExports.length > 0 ? data.missingExports : (_result?.missingExports || _result?.missing_exports || data.missingExports);
  const mergedCircularDeps = data.circularDependencies.length > 0 ? data.circularDependencies : (_result?.circularDependencies || _result?.circular_dependencies || data.circularDependencies);
  const mergedUnusedExports = data.unusedExports.length > 0 ? data.unusedExports : (_result?.unusedExports || _result?.unused_exports || data.unusedExports);
  const { statistics } = data;
  const totalIssues = mergedMissingFiles.length + mergedMissingExports.length +
    mergedCircularDeps.length + mergedUnusedExports.length;
  const hasResults = _hasResults || data.success !== undefined || statistics.totalFiles > 0 || totalIssues > 0;

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <MagnifyingGlassIcon className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Import Analysis</span>
          <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded">
            {data.mode}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {!hasResults && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
              analyzing...
            </span>
          )}
          {statistics.totalFiles > 0 && <span>{statistics.totalFiles} files</span>}
          {hasResults && (
            <span className={totalIssues > 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-emerald-600 dark:text-emerald-400'}>
              {totalIssues} issues
            </span>
          )}
        </div>
      </div>

      {/* Category cards */}
      <div className="bg-white dark:bg-gray-900 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {!hasResults ? (
          <div className="col-span-2 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
              <MagnifyingGlassIcon className="w-5 h-5 text-indigo-500 animate-pulse" />
            </div>
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">Analyzing imports and dependencies...</p>
              <p className="text-xs text-gray-400 mt-0.5">Checking for missing files, circular deps, unused exports</p>
            </div>
          </div>
        ) : (
          <>
        <CategoryCard
          title="Missing Files"
          icon={DocumentMinusIcon}
          items={mergedMissingFiles}
          color="red"
          renderItem={(item) => typeof item === 'string' ? item : (item.file || item.path || JSON.stringify(item))}
        />
        <CategoryCard
          title="Missing Exports"
          icon={ExclamationCircleIcon}
          items={mergedMissingExports}
          color="amber"
          renderItem={(item) => typeof item === 'string' ? item : `${item.symbol || '?'} from ${(item.file || '').split(/[/\\]/).pop()}`}
        />
        <CategoryCard
          title="Circular Dependencies"
          icon={ArrowPathIcon}
          items={mergedCircularDeps}
          color="purple"
          renderItem={(item) => {
            if (Array.isArray(item)) return item.map(f => f.split(/[/\\]/).pop()).join(' → ');
            if (item.chain) return item.chain.map(f => f.split(/[/\\]/).pop()).join(' → ');
            return typeof item === 'string' ? item : JSON.stringify(item);
          }}
        />
        <CategoryCard
          title="Unused Exports"
          icon={ArchiveBoxXMarkIcon}
          items={mergedUnusedExports}
          color="blue"
          renderItem={(item) => typeof item === 'string' ? item : `${item.symbol || '?'} in ${(item.file || '').split(/[/\\]/).pop()}`}
        />
          </>
        )}
      </div>
    </div>
  );
}

export default ImportAnalyzerRenderer;
