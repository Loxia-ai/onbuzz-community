/**
 * PdfRenderer Component
 *
 * Displays PDF tool operations: get-info (metadata card),
 * read-pages (paginated text viewer), create-pdf (success card).
 */

import React, { useMemo } from 'react';
import { usePersistedToggle, extractResult } from './usePersistedState';
import {
  DocumentTextIcon,
  InformationCircleIcon,
  BookOpenIcon,
  DocumentPlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

function parsePdfData(parsedData) {
  if (!parsedData) return null;
  const params = parsedData.parameters || parsedData;

  // Handle actions array or direct action
  const actions = params.actions || [];
  const firstAction = actions[0] || params;

  return {
    action: firstAction.action || firstAction.type || 'get-info',
    filePath: firstAction.filePath || firstAction.file_path || params.filePath || '',
    startPage: firstAction.startPage || firstAction.start_page || 1,
    endPage: firstAction.endPage || firstAction.end_page || null,
    outputPath: firstAction.outputPath || firstAction.output_path || null,
    // Result fields
    result: params.result || {},
    pageCount: params.result?.pageCount || params.pageCount || 0,
    metadata: params.result?.metadata || params.metadata || {},
    content: params.result?.content || params.content || '',
    success: params.success
  };
}

function PdfRenderer({ toolId, rawContent, parsedData, messageTimestamp, index }) {
  const [expanded, toggleExpanded] = usePersistedToggle('pdf', messageTimestamp, index, false);
  const data = useMemo(() => parsePdfData(parsedData), [parsedData]);
  const { hasResults: _hasResults } = extractResult(parsedData);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 text-sm">
        <DocumentTextIcon className="w-4 h-4" />
        <span>PDF (unable to parse)</span>
      </div>
    );
  }

  const filename = data.filePath ? data.filePath.split(/[/\\]/).pop() : data.outputPath?.split(/[/\\]/).pop() || 'document.pdf';

  // Action-specific icons
  const actionConfig = {
    'get-info': { icon: InformationCircleIcon, label: 'PDF Info', color: 'bg-blue-600 dark:bg-blue-700' },
    'read-pages': { icon: BookOpenIcon, label: 'Read Pages', color: 'bg-emerald-600 dark:bg-emerald-700' },
    'create-pdf': { icon: DocumentPlusIcon, label: 'Create PDF', color: 'bg-violet-600 dark:bg-violet-700' }
  };
  const config = actionConfig[data.action] || actionConfig['get-info'];
  const Icon = config.icon;

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-md">
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2 ${config.color} text-white`}>
        <div className="flex items-center gap-2">
          <Icon className="w-4.5 h-4.5" />
          <span className="text-sm font-semibold">{config.label}</span>
        </div>
        <span className="text-xs bg-white/20 px-2 py-0.5 rounded">
          {filename}
        </span>
      </div>

      <div className="bg-white dark:bg-gray-900">
        {/* Get-info: metadata card */}
        {data.action === 'get-info' && (
          <div className="p-4 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {data.pageCount > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 dark:text-gray-400">Pages:</span>
                  <span className="font-semibold text-gray-700 dark:text-gray-300">{data.pageCount}</span>
                </div>
              )}
              {data.metadata.title && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 dark:text-gray-400">Title:</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{data.metadata.title}</span>
                </div>
              )}
              {data.metadata.author && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 dark:text-gray-400">Author:</span>
                  <span className="text-gray-700 dark:text-gray-300">{data.metadata.author}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Read-pages: text content */}
        {data.action === 'read-pages' && data.content && (
          <div>
            <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-xs text-gray-500">
                Pages {data.startPage}–{data.endPage || '?'} of {data.pageCount || '?'}
              </span>
              <button
                onClick={toggleExpanded}
                className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
              >
                {expanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
            <pre className={`p-3 text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-y-auto ${
              expanded ? 'max-h-[500px]' : 'max-h-40'
            }`}>
              {data.content}
            </pre>
          </div>
        )}

        {/* Create-pdf: success card */}
        {data.action === 'create-pdf' && (
          <div className="p-4 flex items-center gap-3">
            <CheckCircleIcon className="w-8 h-8 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">PDF Created</p>
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

export default PdfRenderer;
