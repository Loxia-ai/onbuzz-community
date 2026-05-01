/**
 * FileTreeRenderer Component
 *
 * Interactive file tree visualization with folder expand/collapse,
 * file-type icons, and directory statistics.
 */

import React, { useState, useMemo } from 'react';
import { usePersistedToggle, extractResult } from './usePersistedState';
import {
  FolderIcon,
  FolderOpenIcon,
  DocumentIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeBracketIcon,
  PhotoIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  CubeIcon
} from '@heroicons/react/24/outline';

/**
 * File extension to icon/color mapping
 */
const FILE_TYPE_CONFIG = {
  // JavaScript/TypeScript
  '.js': { color: 'text-yellow-500', label: 'JS' },
  '.jsx': { color: 'text-blue-400', label: 'JSX' },
  '.ts': { color: 'text-blue-600', label: 'TS' },
  '.tsx': { color: 'text-blue-500', label: 'TSX' },
  '.mjs': { color: 'text-yellow-500', label: 'MJS' },
  // Web
  '.html': { color: 'text-orange-500', label: 'HTML' },
  '.css': { color: 'text-blue-400', label: 'CSS' },
  '.scss': { color: 'text-pink-500', label: 'SCSS' },
  // Data
  '.json': { color: 'text-green-500', label: 'JSON' },
  '.yaml': { color: 'text-red-400', label: 'YAML' },
  '.yml': { color: 'text-red-400', label: 'YML' },
  '.xml': { color: 'text-orange-400', label: 'XML' },
  '.env': { color: 'text-yellow-600', label: 'ENV' },
  // Languages
  '.py': { color: 'text-blue-500', label: 'PY' },
  '.java': { color: 'text-red-500', label: 'JAVA' },
  '.go': { color: 'text-cyan-500', label: 'GO' },
  '.rs': { color: 'text-orange-600', label: 'RS' },
  '.cs': { color: 'text-green-600', label: 'C#' },
  '.rb': { color: 'text-red-600', label: 'RB' },
  // Images
  '.png': { color: 'text-purple-400', icon: 'photo' },
  '.jpg': { color: 'text-purple-400', icon: 'photo' },
  '.svg': { color: 'text-orange-400', icon: 'photo' },
  '.gif': { color: 'text-purple-400', icon: 'photo' },
  '.ico': { color: 'text-purple-400', icon: 'photo' },
  // Config
  '.toml': { color: 'text-gray-500', label: 'TOML' },
  '.ini': { color: 'text-gray-500', label: 'INI' },
  '.lock': { color: 'text-gray-400', label: 'LOCK' },
  // Docs
  '.md': { color: 'text-blue-300', icon: 'doc' },
  '.txt': { color: 'text-gray-400', icon: 'doc' },
  // Shell
  '.sh': { color: 'text-green-400', label: 'SH' },
  '.bat': { color: 'text-gray-500', label: 'BAT' },
  '.ps1': { color: 'text-blue-600', label: 'PS1' },
};

function getFileConfig(filename) {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return FILE_TYPE_CONFIG[ext] || { color: 'text-gray-400' };
}

function FileIcon({ filename }) {
  const config = getFileConfig(filename);

  if (config.icon === 'photo') return <PhotoIcon className={`w-4 h-4 ${config.color}`} />;
  if (config.icon === 'doc') return <DocumentTextIcon className={`w-4 h-4 ${config.color}`} />;
  if (config.label) return <CodeBracketIcon className={`w-4 h-4 ${config.color}`} />;
  return <DocumentIcon className={`w-4 h-4 ${config.color}`} />;
}

/**
 * Parse the ASCII tree string into a structured tree
 */
function parseTreeStructure(treeString) {
  if (!treeString) return [];

  const lines = treeString.split('\n').filter(l => l.trim());
  const nodes = [];

  for (const line of lines) {
    // Calculate depth from indentation characters
    const strippedLine = line.replace(/^[│├└─\s┃┣┗━]+/, '');
    const prefix = line.substring(0, line.length - strippedLine.length);
    // Each level of tree indentation is roughly 4 chars (├── or │   )
    const depth = Math.floor(prefix.replace(/[^\s│┃]/g, '').length / 2);

    const name = strippedLine.trim();
    if (!name) continue;

    const isDirectory = name.endsWith('/') || name.endsWith('\\') || !name.includes('.');
    nodes.push({
      name: name.replace(/[/\\]$/, ''),
      depth,
      isDirectory,
      raw: line
    });
  }

  return nodes;
}

/**
 * Parse file tree data
 */
function parseFileTreeData(parsedData) {
  if (!parsedData) return null;

  const params = parsedData.parameters || parsedData;

  return {
    directory: params.directory || '.',
    tree: params.tree || '',
    totalFiles: params.totalFiles || params.total_files || 0,
    totalDirectories: params.totalDirectories || params.total_directories || 0,
    maxDepth: params.maxDepth || params.max_depth || 4,
    skippedCount: params.skippedCount || 0,
    statistics: params.statistics || null,
    summary: params.summary || '',
    success: params.success
  };
}

/**
 * Tree node component
 */
function TreeNode({ node, isLast }) {
  const [expanded, setExpanded] = useState(true);
  const config = !node.isDirectory ? getFileConfig(node.name) : null;

  return (
    <div
      className="flex items-center gap-1 py-0.5 px-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded transition-colors cursor-default"
      style={{ paddingLeft: `${(node.depth * 16) + 8}px` }}
    >
      {node.isDirectory ? (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            {expanded ? (
              <ChevronDownIcon className="w-3 h-3 flex-shrink-0" />
            ) : (
              <ChevronRightIcon className="w-3 h-3 flex-shrink-0" />
            )}
            {expanded ? (
              <FolderOpenIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />
            ) : (
              <FolderIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />
            )}
          </button>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{node.name}</span>
        </>
      ) : (
        <>
          <span className="w-3 flex-shrink-0" />
          <FileIcon filename={node.name} />
          <span className="text-sm text-gray-600 dark:text-gray-400">{node.name}</span>
          {config?.label && (
            <span className={`text-[10px] ${config.color} opacity-60 ml-1`}>{config.label}</span>
          )}
        </>
      )}
    </div>
  );
}

function FileTreeRenderer({ toolId, rawContent, parsedData, messageTimestamp, index }) {
  const data = useMemo(() => parseFileTreeData(parsedData), [parsedData]);
  const [showRaw, toggleShowRaw] = usePersistedToggle('fileTree', messageTimestamp, index, false);
  const { hasResults: _hasResults, result: _result } = extractResult(parsedData);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 text-sm">
        <FolderIcon className="w-4 h-4" />
        <span>File Tree (unable to parse)</span>
      </div>
    );
  }

  // Merge _result tree data if available
  const mergedTree = data.tree || (_result?.tree || '');
  const nodes = useMemo(() => parseTreeStructure(mergedTree), [mergedTree]);
  const stats = data.statistics || _result?.statistics || {};
  const totalFiles = stats.filesCount || data.totalFiles || (_result?.totalFiles || 0);
  const totalDirs = stats.directoriesCount || data.totalDirectories || (_result?.totalDirectories || 0);

  const hasResults = _hasResults || !!(data.tree || data.totalFiles || data.totalDirectories || data.success !== undefined);

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <FolderOpenIcon className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            File Tree
          </span>
          <code className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded font-mono">
            {data.directory}
          </code>
        </div>

        <div className="flex items-center gap-2">
          {!hasResults && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              scanning...
            </span>
          )}
          {hasResults && data.tree && (
            <button
              onClick={toggleShowRaw}
              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              {showRaw ? 'Tree View' : 'Raw'}
            </button>
          )}
        </div>
      </div>

      {/* Tree body */}
      <div className="bg-white dark:bg-gray-900 max-h-96 overflow-y-auto">
        {!hasResults ? (
          /* Input-only: show scanning state with directory info */
          <div className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
              <FolderOpenIcon className="w-5 h-5 text-amber-500 animate-pulse" />
            </div>
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">Scanning directory structure...</p>
              <div className="flex gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                {data.maxDepth && <span>Max depth: {data.maxDepth}</span>}
                {data.includeExtensions?.length > 0 && <span>Filter: {data.includeExtensions.join(', ')}</span>}
              </div>
            </div>
          </div>
        ) : showRaw ? (
          <pre className="p-3 text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre overflow-x-auto">
            {mergedTree}
          </pre>
        ) : nodes.length > 0 ? (
          <div className="py-1">
            {nodes.map((node, idx) => (
              <TreeNode key={idx} node={node} isLast={idx === nodes.length - 1} />
            ))}
          </div>
        ) : mergedTree ? (
          /* Has tree string but couldn't parse nodes — show raw */
          <pre className="p-3 text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre overflow-x-auto">
            {mergedTree}
          </pre>
        ) : (
          <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
            <FolderIcon className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
            <p>Empty directory</p>
          </div>
        )}
      </div>

      {/* Stats footer */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-3">
          {totalFiles > 0 && (
            <span>
              <span className="font-semibold text-gray-700 dark:text-gray-300">{totalFiles}</span> files
            </span>
          )}
          {totalDirs > 0 && (
            <span>
              <span className="font-semibold text-gray-700 dark:text-gray-300">{totalDirs}</span> directories
            </span>
          )}
          {data.skippedCount > 0 && (
            <span className="text-gray-400">({data.skippedCount} skipped)</span>
          )}
        </div>
        <span>depth: {data.maxDepth}</span>
      </div>
    </div>
  );
}

export default FileTreeRenderer;
