/**
 * CloneDetectionRenderer Component
 *
 * Displays code clone detection results with duplication gauge,
 * priority breakdown, and clone cards with refactoring advice.
 */

import React, { useState, useMemo } from 'react';
import { usePersistedToggle, extractResult } from './usePersistedState';
import {
  DocumentDuplicateIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  WrenchScrewdriverIcon,
  ArrowPathIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline';

function parseCloneData(parsedData) {
  if (!parsedData) return null;
  const params = parsedData.parameters || parsedData;
  const actions = params.actions || [];

  return {
    summary: params.summary || {
      totalClones: 0,
      duplicationPercentage: 0,
      priorityBreakdown: { high: 0, medium: 0, low: 0 }
    },
    clones: params.clones || [],
    success: params.success
  };
}

const PRIORITY_COLORS = {
  high: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', bar: 'bg-red-500' },
  medium: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', bar: 'bg-amber-500' },
  low: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', bar: 'bg-blue-500' }
};

/**
 * Circular duplication gauge
 */
function DuplicationGauge({ percentage }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const filled = (percentage / 100) * circumference;
  const color = percentage > 30 ? '#ef4444' : percentage > 15 ? '#f59e0b' : '#22c55e';

  return (
    <div className="relative w-20 h-20 flex-shrink-0">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="currentColor" strokeWidth="6"
          className="text-gray-200 dark:text-gray-700" />
        <circle cx="32" cy="32" r={radius} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circumference} strokeDashoffset={circumference - filled}
          strokeLinecap="round" className="transition-all duration-500" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{percentage}%</span>
      </div>
    </div>
  );
}

/**
 * Single clone card
 */
function CloneCard({ clone, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const priority = clone.refactoringAdvice?.priority || 'low';
  const colors = PRIORITY_COLORS[priority] || PRIORITY_COLORS.low;
  const locations = clone.locations || [];

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        )}
        <DocumentDuplicateIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
        <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 truncate">
          {clone.type === 'exact' ? 'Exact' : 'Similar'} clone — {locations.length} locations
        </span>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
          {priority.toUpperCase()}
        </span>
        {clone.confidence && (
          <span className="text-xs text-gray-400">{Math.round(clone.confidence * 100)}%</span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Locations */}
          <div className="space-y-1">
            {locations.map((loc, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs font-mono bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1">
                <DocumentTextIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="text-gray-700 dark:text-gray-300 truncate">{(loc.file || '').split(/[/\\]/).pop()}</span>
                <span className="text-gray-400">L{loc.startLine}–{loc.endLine}</span>
              </div>
            ))}
          </div>

          {/* Metrics */}
          {clone.metrics && (
            <div className="flex gap-3 text-xs text-gray-500 dark:text-gray-400">
              {clone.metrics.tokens && <span>{clone.metrics.tokens} tokens</span>}
              {clone.metrics.lines && <span>{clone.metrics.lines} lines</span>}
              {clone.metrics.similarity && <span>{Math.round(clone.metrics.similarity * 100)}% similar</span>}
            </div>
          )}

          {/* Refactoring advice */}
          {clone.refactoringAdvice && (
            <div className="mt-1 p-2 rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
              <div className="flex items-center gap-1.5 mb-1">
                <WrenchScrewdriverIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                  {clone.refactoringAdvice.strategy}
                </span>
                {clone.refactoringAdvice.suggestedName && (
                  <code className="text-[10px] bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300 px-1 rounded">
                    {clone.refactoringAdvice.suggestedName}
                  </code>
                )}
              </div>
              {clone.refactoringAdvice.reasoning && (
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  {clone.refactoringAdvice.reasoning}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CloneDetectionRenderer({ toolId, rawContent, parsedData, messageTimestamp, index }) {
  const data = useMemo(() => parseCloneData(parsedData), [parsedData]);
  const { hasResults: _hasResults, result: _result } = extractResult(parsedData);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 text-sm">
        <DocumentDuplicateIcon className="w-4 h-4" />
        <span>Clone Detection (unable to parse)</span>
      </div>
    );
  }

  // Merge _result clone data if available
  const mergedClones = data.clones.length > 0 ? data.clones : (_result?.clones || []);
  const mergedSummary = data.summary?.totalClones > 0 ? data.summary : (_result?.summary || data.summary);
  const { summary } = { summary: mergedSummary };
  const breakdown = summary.priorityBreakdown || {};
  const hasResults = _hasResults || data.success !== undefined || summary.totalClones > 0 || data.clones.length > 0 || summary.duplicationPercentage > 0;
  const isClean = hasResults && summary.totalClones === 0 && mergedClones.length === 0;

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-md">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <DuplicationGauge percentage={summary.duplicationPercentage || 0} />

          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <DocumentDuplicateIcon className="w-4.5 h-4.5 text-gray-600 dark:text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Clone Detection
              </span>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              {isClean ? 'No code duplications found!' : `${summary.totalClones} clone${summary.totalClones !== 1 ? 's' : ''} detected`}
            </p>

            {/* Priority breakdown bar */}
            {!isClean && (
              <div className="flex items-center gap-3 text-xs">
                {breakdown.high > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-gray-600 dark:text-gray-400">{breakdown.high} high</span>
                  </span>
                )}
                {breakdown.medium > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-gray-600 dark:text-gray-400">{breakdown.medium} medium</span>
                  </span>
                )}
                {breakdown.low > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-gray-600 dark:text-gray-400">{breakdown.low} low</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Clone cards */}
      <div className="bg-white dark:bg-gray-900 max-h-96 overflow-y-auto p-2 space-y-2">
        {!hasResults ? (
          <div className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
              <DocumentDuplicateIcon className="w-5 h-5 text-gray-500 animate-pulse" />
            </div>
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">Scanning for code clones...</p>
              <p className="text-xs text-gray-400 mt-0.5">Analyzing code similarity patterns</p>
            </div>
          </div>
        ) : mergedClones.length > 0 ? (
          mergedClones.map((clone, idx) => (
            <CloneCard key={clone.id || idx} clone={clone} defaultExpanded={idx < 3} />
          ))
        ) : isClean ? (
          <div className="p-4 text-center">
            <ArrowPathIcon className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
            <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">No duplications</p>
            <p className="text-xs text-gray-400 mt-1">Code is DRY!</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default CloneDetectionRenderer;
