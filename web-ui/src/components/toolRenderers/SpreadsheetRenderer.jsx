/**
 * SpreadsheetRenderer Component
 *
 * Mini spreadsheet table for read operations with sheet tabs,
 * info cards, and creation success displays.
 */

import React, { useState, useMemo } from 'react';
import { usePersistedToggle, extractResult } from './usePersistedState';
import {
  TableCellsIcon,
  InformationCircleIcon,
  DocumentPlusIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

function parseSpreadsheetData(parsedData) {
  if (!parsedData) return null;
  const params = parsedData.parameters || parsedData;
  const actions = params.actions || [];
  const firstAction = actions[0] || params;

  return {
    action: firstAction.action || firstAction.type || 'read',
    filePath: firstAction.filePath || firstAction.file_path || params.filePath || '',
    sheetName: firstAction.sheetName || firstAction.sheet_name || null,
    // Result fields
    result: params.result || {},
    sheets: params.result?.sheets || params.sheets || [],
    metadata: params.result?.metadata || params.metadata || {},
    data: params.result?.data || params.data || [],
    outputPath: params.result?.outputPath || firstAction.outputPath || null,
    success: params.success
  };
}

function SpreadsheetRenderer({ toolId, rawContent, parsedData, messageTimestamp, index }) {
  const data = useMemo(() => parseSpreadsheetData(parsedData), [parsedData]);
  const [activeSheet, setActiveSheet] = useState(0);
  const { hasResults: _hasResults } = extractResult(parsedData);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 text-sm">
        <TableCellsIcon className="w-4 h-4" />
        <span>Spreadsheet (unable to parse)</span>
      </div>
    );
  }

  const filename = (data.filePath || data.outputPath || 'spreadsheet.xlsx').split(/[/\\]/).pop();
  const rows = Array.isArray(data.data) ? data.data : [];
  const columns = rows.length > 0 ? Object.keys(rows[0] || {}) : [];

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-emerald-600 dark:bg-emerald-700 text-white">
        <div className="flex items-center gap-2">
          <TableCellsIcon className="w-4.5 h-4.5" />
          <span className="text-sm font-semibold">
            {data.action === 'create' ? 'Create Spreadsheet' : data.action === 'get-info' ? 'Spreadsheet Info' : 'Spreadsheet'}
          </span>
        </div>
        <span className="text-xs bg-white/20 px-2 py-0.5 rounded">{filename}</span>
      </div>

      <div className="bg-white dark:bg-gray-900">
        {/* Sheet tabs */}
        {data.sheets.length > 1 && (
          <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
            {data.sheets.map((sheet, idx) => (
              <button
                key={idx}
                onClick={() => setActiveSheet(idx)}
                className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  idx === activeSheet
                    ? 'text-emerald-700 dark:text-emerald-300 border-b-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {typeof sheet === 'string' ? sheet : sheet.name || `Sheet ${idx + 1}`}
              </button>
            ))}
          </div>
        )}

        {/* Info view */}
        {data.action === 'get-info' && (
          <div className="p-4 space-y-2 text-sm">
            {data.sheets.length > 0 && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Sheets: </span>
                <span className="text-gray-700 dark:text-gray-300">
                  {data.sheets.map(s => typeof s === 'string' ? s : s.name).join(', ')}
                </span>
              </div>
            )}
            {data.metadata.totalSheets && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Total sheets: </span>
                <span className="font-semibold text-gray-700 dark:text-gray-300">{data.metadata.totalSheets}</span>
              </div>
            )}
          </div>
        )}

        {/* Data table */}
        {rows.length > 0 && (
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left text-gray-400 font-medium w-8">#</th>
                  {columns.map((col, idx) => (
                    <th key={idx} className="px-2 py-1 text-left text-gray-600 dark:text-gray-400 font-medium whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((row, rIdx) => (
                  <tr key={rIdx} className={`border-t border-gray-100 dark:border-gray-800 ${rIdx % 2 === 0 ? '' : 'bg-gray-50/50 dark:bg-gray-800/30'}`}>
                    <td className="px-2 py-1 text-gray-400 font-mono">{rIdx + 1}</td>
                    {columns.map((col, cIdx) => (
                      <td key={cIdx} className="px-2 py-1 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-[200px] truncate">
                        {row[col] != null ? String(row[col]) : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 50 && (
              <div className="py-1.5 text-center text-xs text-gray-400 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                Showing 50 of {rows.length} rows
              </div>
            )}
          </div>
        )}

        {/* Create success */}
        {data.action === 'create' && rows.length === 0 && (
          <div className="p-4 flex items-center gap-3">
            <CheckCircleIcon className="w-8 h-8 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Spreadsheet Created</p>
              {data.outputPath && (
                <p className="text-xs text-gray-500 font-mono mt-0.5">{data.outputPath}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SpreadsheetRenderer;
