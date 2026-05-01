/**
 * FileSystemRenderer Component
 *
 * Specialized renderer for FileSystem tool invocations.
 * Displays file operations in a beautiful, IDE-style format.
 *
 * Features:
 * - IDE-style window frame with file tabs
 * - Syntax highlighting based on file extension
 * - Line numbers
 * - Different visual styling per action type (write, read, delete, etc.)
 * - Collapsible content for large files
 * - Copy to clipboard functionality
 */

import React, { useState, useMemo } from 'react';
import {
  DocumentPlusIcon,
  DocumentTextIcon,
  DocumentMinusIcon,
  DocumentDuplicateIcon,
  ArrowRightIcon,
  FolderPlusIcon,
  FolderOpenIcon,
  QuestionMarkCircleIcon,
  ChartBarIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardIcon,
  CheckIcon
} from '@heroicons/react/24/outline';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { usePersistedSet, extractResult } from './usePersistedState';
import { useAppStore } from '../../stores/appStore';
import { FILESYSTEM_ACTIONS } from '../../constants/toolConstants';

/**
 * Map file extensions to Prism language identifiers
 */
const EXTENSION_LANGUAGE_MAP = {
  // JavaScript/TypeScript
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',

  // Web
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',

  // Data formats
  '.json': 'json',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',

  // Python
  '.py': 'python',
  '.pyw': 'python',
  '.pyx': 'python',

  // Other languages
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.r': 'r',
  '.R': 'r',

  // Shell
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  '.ps1': 'powershell',
  '.bat': 'batch',
  '.cmd': 'batch',

  // Config files
  '.env': 'bash',
  '.gitignore': 'git',
  '.dockerignore': 'docker',
  '.editorconfig': 'ini',
  '.ini': 'ini',

  // Markup/Documentation
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.rst': 'rest',
  '.tex': 'latex',

  // SQL
  '.sql': 'sql',

  // GraphQL
  '.graphql': 'graphql',
  '.gql': 'graphql',
};

/**
 * Get language from file path
 */
function getLanguageFromPath(filePath) {
  if (!filePath) return 'text';

  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] || 'text';
}

/**
 * Get filename from path
 */
function getFilename(filePath) {
  if (!filePath) return 'unknown';
  return filePath.split(/[/\\]/).pop() || filePath;
}

/**
 * Get folder path from full path
 */
function getFolderPath(filePath) {
  if (!filePath) return '';
  const parts = filePath.split(/[/\\]/);
  parts.pop();
  return parts.join('/');
}

/**
 * Action configurations for visual styling
 */
const ACTION_CONFIG = {
  [FILESYSTEM_ACTIONS.WRITE]: {
    icon: DocumentPlusIcon,
    label: 'Write File',
    verb: 'Writing to',
    headerBg: 'bg-emerald-600 dark:bg-emerald-700',
    headerText: 'text-white',
    borderColor: 'border-emerald-500 dark:border-emerald-600',
    accentColor: 'text-emerald-500'
  },
  [FILESYSTEM_ACTIONS.READ]: {
    icon: DocumentTextIcon,
    label: 'Read File',
    verb: 'Reading',
    headerBg: 'bg-blue-600 dark:bg-blue-700',
    headerText: 'text-white',
    borderColor: 'border-blue-500 dark:border-blue-600',
    accentColor: 'text-blue-500'
  },
  [FILESYSTEM_ACTIONS.APPEND]: {
    icon: DocumentPlusIcon,
    label: 'Append to File',
    verb: 'Appending to',
    headerBg: 'bg-amber-600 dark:bg-amber-700',
    headerText: 'text-white',
    borderColor: 'border-amber-500 dark:border-amber-600',
    accentColor: 'text-amber-500'
  },
  [FILESYSTEM_ACTIONS.DELETE]: {
    icon: DocumentMinusIcon,
    label: 'Delete File',
    verb: 'Deleting',
    headerBg: 'bg-red-600 dark:bg-red-700',
    headerText: 'text-white',
    borderColor: 'border-red-500 dark:border-red-600',
    accentColor: 'text-red-500'
  },
  [FILESYSTEM_ACTIONS.COPY]: {
    icon: DocumentDuplicateIcon,
    label: 'Copy File',
    verb: 'Copying',
    headerBg: 'bg-violet-600 dark:bg-violet-700',
    headerText: 'text-white',
    borderColor: 'border-violet-500 dark:border-violet-600',
    accentColor: 'text-violet-500'
  },
  [FILESYSTEM_ACTIONS.MOVE]: {
    icon: ArrowRightIcon,
    label: 'Move File',
    verb: 'Moving',
    headerBg: 'bg-orange-600 dark:bg-orange-700',
    headerText: 'text-white',
    borderColor: 'border-orange-500 dark:border-orange-600',
    accentColor: 'text-orange-500'
  },
  [FILESYSTEM_ACTIONS.CREATE_DIR]: {
    icon: FolderPlusIcon,
    label: 'Create Directory',
    verb: 'Creating',
    headerBg: 'bg-teal-600 dark:bg-teal-700',
    headerText: 'text-white',
    borderColor: 'border-teal-500 dark:border-teal-600',
    accentColor: 'text-teal-500'
  },
  [FILESYSTEM_ACTIONS.LIST]: {
    icon: FolderOpenIcon,
    label: 'List Directory',
    verb: 'Listing',
    headerBg: 'bg-slate-600 dark:bg-slate-700',
    headerText: 'text-white',
    borderColor: 'border-slate-500 dark:border-slate-600',
    accentColor: 'text-slate-500'
  },
  [FILESYSTEM_ACTIONS.EXISTS]: {
    icon: QuestionMarkCircleIcon,
    label: 'Check Exists',
    verb: 'Checking',
    headerBg: 'bg-indigo-600 dark:bg-indigo-700',
    headerText: 'text-white',
    borderColor: 'border-indigo-500 dark:border-indigo-600',
    accentColor: 'text-indigo-500'
  },
  [FILESYSTEM_ACTIONS.STATS]: {
    icon: ChartBarIcon,
    label: 'File Stats',
    verb: 'Getting stats for',
    headerBg: 'bg-cyan-600 dark:bg-cyan-700',
    headerText: 'text-white',
    borderColor: 'border-cyan-500 dark:border-cyan-600',
    accentColor: 'text-cyan-500'
  }
};

const DEFAULT_ACTION_CONFIG = {
  icon: DocumentTextIcon,
  label: 'File Operation',
  verb: 'Processing',
  headerBg: 'bg-gray-600 dark:bg-gray-700',
  headerText: 'text-white',
  borderColor: 'border-gray-500 dark:border-gray-600',
  accentColor: 'text-gray-500'
};

/**
 * Maximum lines before collapsing
 */
const COLLAPSE_THRESHOLD = 25;

/**
 * IDE-style code window component for file content
 */
function CodeWindow({ action, content, filePath, isExpanded, onToggle }) {
  const { darkMode } = useAppStore();
  const [copied, setCopied] = useState(false);

  const language = getLanguageFromPath(filePath);
  const filename = getFilename(filePath);
  const folderPath = getFolderPath(filePath);
  const config = ACTION_CONFIG[action?.type] || DEFAULT_ACTION_CONFIG;
  const Icon = config.icon;

  const lineCount = content ? content.split('\n').length : 0;
  const shouldCollapse = lineCount > COLLAPSE_THRESHOLD;

  const displayContent = useMemo(() => {
    if (!content) return '';
    if (shouldCollapse && !isExpanded) {
      return content.split('\n').slice(0, COLLAPSE_THRESHOLD).join('\n');
    }
    return content;
  }, [content, shouldCollapse, isExpanded]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className={`rounded-lg overflow-hidden border-2 ${config.borderColor} shadow-lg my-3`}>
      {/* Window Title Bar - IDE style */}
      <div className={`${config.headerBg} ${config.headerText} px-4 py-2`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* Traffic light dots */}
            <div className="flex space-x-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500 opacity-80"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500 opacity-80"></div>
              <div className="w-3 h-3 rounded-full bg-green-500 opacity-80"></div>
            </div>

            {/* File icon and name */}
            <div className="flex items-center space-x-2">
              <Icon className="w-4 h-4" />
              <span className="font-semibold text-sm">{filename}</span>
            </div>
          </div>

          {/* Action badge and tools */}
          <div className="flex items-center space-x-3">
            <span className="text-xs opacity-80 bg-white/20 px-2 py-0.5 rounded">
              {config.label}
            </span>

            {content && (
              <button
                onClick={handleCopy}
                className="p-1 rounded hover:bg-white/20 transition-colors"
                title="Copy to clipboard"
              >
                {copied ? (
                  <CheckIcon className="w-4 h-4" />
                ) : (
                  <ClipboardIcon className="w-4 h-4" />
                )}
              </button>
            )}

            {shouldCollapse && (
              <button
                onClick={onToggle}
                className="p-1 rounded hover:bg-white/20 transition-colors"
                title={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? (
                  <ChevronDownIcon className="w-4 h-4" />
                ) : (
                  <ChevronRightIcon className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Path breadcrumb */}
        {folderPath && (
          <div className="mt-1 text-xs opacity-70 font-mono truncate">
            {folderPath}
          </div>
        )}
      </div>

      {/* Code content area */}
      {content ? (
        <div className="bg-gray-900 dark:bg-gray-950">
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            showLineNumbers={true}
            lineNumberStyle={{
              minWidth: '3em',
              paddingRight: '1em',
              color: '#636d83',
              borderRight: '1px solid #3e4451',
              marginRight: '1em'
            }}
            customStyle={{
              margin: 0,
              padding: '1rem',
              fontSize: '13px',
              lineHeight: '1.5',
              background: 'transparent',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
            }}
            wrapLines={true}
            wrapLongLines={true}
          >
            {displayContent}
          </SyntaxHighlighter>

          {/* Expand button at bottom */}
          {shouldCollapse && !isExpanded && (
            <button
              onClick={onToggle}
              className="w-full py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors border-t border-gray-700"
            >
              Show {lineCount - COLLAPSE_THRESHOLD} more lines ({lineCount} total)
            </button>
          )}
        </div>
      ) : (
        <div className="bg-gray-100 dark:bg-gray-800 p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
          No content
        </div>
      )}
    </div>
  );
}

/**
 * Compact one-line display for non-content operations (delete, copy, move, create-dir, etc.)
 */
function CompactActionDisplay({ action }) {
  const config = ACTION_CONFIG[action.type] || DEFAULT_ACTION_CONFIG;
  const Icon = config.icon;

  const getTargetPath = () => {
    return action.filePath || action.outputPath || action.directory || action.sourcePath || 'unknown';
  };

  const getDestinationPath = () => {
    return action.destPath;
  };

  return (
    <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-50 dark:bg-gray-800/50 text-sm">
      <Icon className={`w-4 h-4 flex-shrink-0 ${config.accentColor}`} />
      <span className="text-gray-500 dark:text-gray-400">{config.verb}</span>
      <code className="font-mono text-xs text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded truncate max-w-xs">
        {getTargetPath()}
      </code>
      {getDestinationPath() && (
        <>
          <ArrowRightIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
          <code className="font-mono text-xs text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded truncate max-w-xs">
            {getDestinationPath()}
          </code>
        </>
      )}
    </div>
  );
}

/**
 * Parse filesystem actions from JSON data
 */
function parseFilesystemActions(parsedData) {
  if (!parsedData) return [];

  const actions = [];

  // Handle actions array format
  if (parsedData.actions && Array.isArray(parsedData.actions)) {
    for (const action of parsedData.actions) {
      actions.push({
        type: action.type,
        filePath: action.filePath || action['file-path'],
        outputPath: action.outputPath || action['output-path'],
        sourcePath: action.sourcePath || action['source-path'],
        destPath: action.destPath || action['dest-path'],
        directory: action.directory,
        content: action.content,
        encoding: action.encoding,
        createDirs: action.createDirs || action['create-dirs']
      });
    }
  }

  // Handle parameters format (single action)
  if (parsedData.parameters) {
    const params = parsedData.parameters;
    if (params.type || params.action) {
      actions.push({
        type: params.type || params.action,
        filePath: params.filePath || params['file-path'],
        outputPath: params.outputPath || params['output-path'],
        sourcePath: params.sourcePath || params['source-path'],
        destPath: params.destPath || params['dest-path'],
        directory: params.directory,
        content: params.content,
        encoding: params.encoding,
        createDirs: params.createDirs || params['create-dirs']
      });
    }
  }

  return actions;
}

/**
 * Main FileSystemRenderer component
 */
function FileSystemRenderer({ toolId, rawContent, innerContent, parsedData, messageTimestamp }) {
  const actions = useMemo(() => parseFilesystemActions(parsedData), [parsedData]);
  const [expandedIndices, toggleExpanded] = usePersistedSet('filesystem', messageTimestamp);
  const { hasResults, result, success } = extractResult(parsedData);

  // Merge result data into actions when available (e.g., read content returned by tool)
  const enrichedActions = useMemo(() => {
    if (!hasResults || !result) return actions;
    const resultActions = result.results || (result.actions ? result.actions : [result]);
    return actions.map((action, i) => {
      const ra = resultActions[i];
      if (!ra) return action;
      return {
        ...action,
        // Result may contain actual file content for read operations
        content: action.content || ra.content || ra.data,
        // Result may indicate success/failure per action
        resultSuccess: ra.success,
        resultMessage: ra.message || ra.error
      };
    });
  }, [actions, hasResults, result]);

  // If no actions parsed, show fallback
  if (actions.length === 0) {
    return (
      <div className="my-2 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-3">
        <div className="flex items-center space-x-2">
          <DocumentTextIcon className="w-5 h-5 text-yellow-500" />
          <span className="text-sm text-yellow-700 dark:text-yellow-300">
            File System operation (unable to parse details)
          </span>
        </div>
        <pre className="mt-2 p-2 bg-white dark:bg-gray-900 rounded text-xs overflow-x-auto">
          {rawContent}
        </pre>
      </div>
    );
  }

  return (
    <div className="filesystem-renderer">
      {enrichedActions.map((action, index) => {
        const hasContent = action.content && (action.type === 'write' || action.type === 'append' || action.type === 'read');

        if (hasContent) {
          return (
            <CodeWindow
              key={index}
              action={action}
              content={action.content}
              filePath={action.outputPath || action.filePath}
              isExpanded={expandedIndices.has(index)}
              onToggle={() => toggleExpanded(index)}
            />
          );
        }

        return (
          <CompactActionDisplay
            key={index}
            action={action}
          />
        );
      })}
    </div>
  );
}

export default FileSystemRenderer;
