/**
 * DependencyResolverRenderer Component
 *
 * Package update table showing current → latest versions,
 * update status indicators, and summary stats.
 */

import React, { useMemo } from 'react';
import { extractResult } from './usePersistedState';
import {
  ArrowsPointingOutIcon,
  CheckCircleIcon,
  MinusCircleIcon,
  ArrowUpCircleIcon,
  CubeIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';

function parseDependencyData(parsedData) {
  if (!parsedData) return null;
  const params = parsedData.parameters || parsedData;

  return {
    mode: params.mode || 'check',
    projectPath: params.projectPath || params.project_path || '',
    backupPath: params.backupPath || params.backup_path || null,
    updates: params.updates || [],
    statistics: params.statistics || {
      totalDependencies: 0,
      updatedCount: 0,
      skippedCount: 0
    },
    summary: params.summary || '',
    success: params.success
  };
}

function DependencyResolverRenderer({ toolId, rawContent, parsedData, messageTimestamp, index }) {
  const data = useMemo(() => parseDependencyData(parsedData), [parsedData]);
  const { hasResults: _hasResults, result: _result } = extractResult(parsedData);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 text-sm">
        <ArrowsPointingOutIcon className="w-4 h-4" />
        <span>Dependency Resolver (unable to parse)</span>
      </div>
    );
  }

  // Merge _result updates if available
  const mergedUpdates = data.updates.length > 0 ? data.updates : (_result?.updates || []);
  const mergedStatistics = data.statistics?.totalDependencies > 0 ? data.statistics : (_result?.statistics || data.statistics);
  const { statistics } = { statistics: mergedStatistics };
  const updates = mergedUpdates;
  const updatedCount = statistics.updatedCount || updates.filter(u => u.updated).length;
  const totalCount = statistics.totalDependencies || updates.length;

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <CubeIcon className="w-4.5 h-4.5 text-violet-600 dark:text-violet-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Dependency Resolver
          </span>
          <span className="text-xs bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded">
            {data.mode}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
            {updatedCount} updated
          </span>
          <span>{totalCount} total</span>
        </div>
      </div>

      {/* Update table or loading state */}
      {updates.length === 0 && !_hasResults && data.success === undefined && (
        <div className="bg-white dark:bg-gray-900 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
            <CubeIcon className="w-5 h-5 text-violet-500 animate-pulse" />
          </div>
          <div>
            <p className="text-sm text-gray-700 dark:text-gray-300">Resolving dependencies...</p>
            <p className="text-xs text-gray-400 mt-0.5">Mode: {data.mode}</p>
          </div>
        </div>
      )}
      {updates.length > 0 && (
        <div className="bg-white dark:bg-gray-900 max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800/50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium text-gray-500 dark:text-gray-400">Package</th>
                <th className="text-left px-3 py-1.5 font-medium text-gray-500 dark:text-gray-400">Current</th>
                <th className="text-center px-1 py-1.5 font-medium text-gray-400 w-6"></th>
                <th className="text-left px-3 py-1.5 font-medium text-gray-500 dark:text-gray-400">Latest</th>
                <th className="text-center px-3 py-1.5 font-medium text-gray-500 dark:text-gray-400 w-16">Status</th>
              </tr>
            </thead>
            <tbody>
              {updates.map((pkg, idx) => {
                const isUpdated = pkg.updated;
                const hasNewVersion = pkg.current !== pkg.latest;

                return (
                  <tr key={pkg.package || idx} className={`border-t border-gray-100 dark:border-gray-800 ${
                    isUpdated ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''
                  }`}>
                    <td className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300">
                      {pkg.package}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gray-500 dark:text-gray-400">
                      {pkg.current}
                    </td>
                    <td className="text-center px-1 py-1.5">
                      {hasNewVersion && (
                        <ArrowRightIcon className="w-3 h-3 text-gray-400 inline" />
                      )}
                    </td>
                    <td className={`px-3 py-1.5 font-mono ${
                      hasNewVersion ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-gray-400'
                    }`}>
                      {pkg.latest}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {isUpdated ? (
                        <CheckCircleIcon className="w-4 h-4 text-emerald-500 inline" />
                      ) : (
                        <MinusCircleIcon className="w-4 h-4 text-gray-400 inline" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer with backup info */}
      {(data.backupPath || data.summary) && (
        <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
          {data.backupPath && (
            <span>Backup: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{data.backupPath}</code></span>
          )}
          {data.summary && !data.backupPath && <span>{data.summary}</span>}
        </div>
      )}
    </div>
  );
}

export default DependencyResolverRenderer;
