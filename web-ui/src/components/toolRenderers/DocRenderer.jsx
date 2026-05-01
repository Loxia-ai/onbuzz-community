/**
 * DocRenderer Component
 *
 * Document viewer for DOCX tool operations.
 * Shows doc metadata, content preview, and creation status.
 */

import React, { useMemo } from 'react';
import { usePersistedToggle, extractResult } from './usePersistedState';
import {
  DocumentTextIcon,
  BookOpenIcon,
  DocumentPlusIcon,
  CheckCircleIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';

function parseDocData(parsedData) {
  if (!parsedData) return null;
  const params = parsedData.parameters || parsedData;
  const actions = params.actions || [];
  const firstAction = actions[0] || params;

  return {
    action: firstAction.action || firstAction.type || 'read',
    filePath: firstAction.filePath || firstAction.file_path || params.filePath || '',
    format: firstAction.format || 'text',
    // Result fields
    result: params.result || {},
    wordCount: params.result?.wordCount || params.wordCount || 0,
    pageCount: params.result?.pageCount || params.pageCount || 0,
    content: params.result?.content || params.content || '',
    outputPath: params.result?.outputPath || firstAction.outputPath || null,
    success: params.success
  };
}

function DocRenderer({ toolId, rawContent, parsedData, messageTimestamp, index }) {
  const [expanded, toggleExpanded] = usePersistedToggle('doc', messageTimestamp, index, false);
  const data = useMemo(() => parseDocData(parsedData), [parsedData]);
  const { hasResults: _hasResults } = extractResult(parsedData);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 text-sm">
        <DocumentTextIcon className="w-4 h-4" />
        <span>Document (unable to parse)</span>
      </div>
    );
  }

  const filename = (data.filePath || data.outputPath || 'document.docx').split(/[/\\]/).pop();

  const actionConfig = {
    'get-info': { icon: InformationCircleIcon, label: 'Doc Info', color: 'bg-blue-600 dark:bg-blue-700' },
    'read': { icon: BookOpenIcon, label: 'Read Document', color: 'bg-sky-600 dark:bg-sky-700' },
    'create': { icon: DocumentPlusIcon, label: 'Create Document', color: 'bg-indigo-600 dark:bg-indigo-700' }
  };
  const config = actionConfig[data.action] || actionConfig['read'];
  const Icon = config.icon;

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-md">
      <div className={`flex items-center justify-between px-3 py-2 ${config.color} text-white`}>
        <div className="flex items-center gap-2">
          <Icon className="w-4.5 h-4.5" />
          <span className="text-sm font-semibold">{config.label}</span>
        </div>
        <span className="text-xs bg-white/20 px-2 py-0.5 rounded">{filename}</span>
      </div>

      <div className="bg-white dark:bg-gray-900">
        {/* Metadata */}
        {(data.wordCount > 0 || data.pageCount > 0) && (
          <div className="px-4 py-2 flex gap-4 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
            {data.wordCount > 0 && <span>{data.wordCount.toLocaleString()} words</span>}
            {data.pageCount > 0 && <span>{data.pageCount} pages</span>}
          </div>
        )}

        {/* Content preview */}
        {data.content && (
          <div>
            {data.format === 'html' ? (
              <div
                className={`p-4 text-sm text-gray-700 dark:text-gray-300 prose prose-sm dark:prose-invert max-w-none overflow-y-auto ${expanded ? 'max-h-[500px]' : 'max-h-40'}`}
                dangerouslySetInnerHTML={{ __html: data.content }}
              />
            ) : (
              <pre className={`p-4 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-y-auto ${expanded ? 'max-h-[500px]' : 'max-h-40'}`}>
                {data.content}
              </pre>
            )}
            <button
              onClick={toggleExpanded}
              className="w-full py-1.5 text-xs text-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-t border-gray-200 dark:border-gray-700"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          </div>
        )}

        {/* Create success */}
        {data.action === 'create' && !data.content && (
          <div className="p-4 flex items-center gap-3">
            <CheckCircleIcon className="w-8 h-8 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Document Created</p>
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

export default DocRenderer;
