import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  HomeIcon,
  FolderIcon,
  FolderPlusIcon,
  PencilSquareIcon,
  DocumentIcon,
  EyeIcon,
  EyeSlashIcon,
  XMarkIcon,
  FunnelIcon,
  ComputerDesktopIcon,
  ArrowDownTrayIcon,
  BookmarkIcon,
  CheckIcon
} from '@heroicons/react/24/outline';

import fileExplorerApi from '../services/api.js';
import {
  formatFileSize,
  formatDate,
  getFileIcon,
  isHiddenItem,
  sortFileItems,
  filterFileItems
} from '../utils/fileUtils.js';
import { FILE_TYPES } from '../types/index.js';

// Storage key for last used path
const LAST_PATH_STORAGE_KEY = 'loxia-file-explorer-last-path';

/**
 * FileExplorer Component
 * Provides file system browsing capabilities with your existing design patterns
 */
function FileExplorer({
  initialPath,
  onSelect,
  onNavigate,
  allowMultiSelect = false,
  height = '500px',
  width = '100%',
  className = '',
  showHidden = false,
  directoriesOnly = false
}) {
  const [state, setState] = useState({
    currentPath: '',
    items: [],
    selectedItems: new Set(),
    loading: false,
    error: null,
    history: [],
    historyIndex: -1
  });

  const [showHiddenFiles, setShowHiddenFiles] = useState(showHidden);
  const [searchQuery, setSearchQuery] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [homeDir, setHomeDir] = useState('');

  // Rename state: { path, originalName, newName } or null
  const [renaming, setRenaming] = useState(null);
  // New folder state: true when showing inline input
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const renameInputRef = useRef(null);
  const newFolderInputRef = useRef(null);
  const [quickAccessPaths, setQuickAccessPaths] = useState(null);
  const [showQuickAccess, setShowQuickAccess] = useState(false);
  const pathInputRef = useRef(null);
  const quickAccessRef = useRef(null);

  /**
   * Load directory contents
   */
  const loadDirectory = useCallback(async (path) => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fileExplorerApi.browseDirectory(path, {
        showHidden: showHiddenFiles
      });

      // Filter items if directoriesOnly is enabled
      let items = response.items;
      if (directoriesOnly) {
        items = items.filter(item => item.type === FILE_TYPES.DIRECTORY);
      }

      setState(prev => ({
        ...prev,
        currentPath: response.currentPath,
        items,
        loading: false,
        selectedItems: new Set() // Clear selection when navigating
      }));

      // Update path input and save to localStorage
      setPathInput(response.currentPath);
      try {
        localStorage.setItem(LAST_PATH_STORAGE_KEY, response.currentPath);
      } catch (e) {
        // Ignore localStorage errors
      }

      // Add to history if this is a new navigation (not back/forward)
      setState(prev => {
        if (prev.history[prev.historyIndex] !== response.currentPath) {
          const newHistory = prev.history.slice(0, prev.historyIndex + 1);
          newHistory.push(response.currentPath);
          return {
            ...prev,
            history: newHistory,
            historyIndex: newHistory.length - 1
          };
        }
        return prev;
      });

      if (onNavigate) {
        onNavigate(response.currentPath);
      }

    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error.message
      }));
    }
  }, [showHiddenFiles, directoriesOnly, onNavigate]);

  /**
   * Handle item selection
   */
  const handleItemClick = useCallback((item, event) => {
    if (allowMultiSelect && (event.ctrlKey || event.metaKey)) {
      // Multi-select with Ctrl/Cmd
      setState(prev => {
        const newSelected = new Set(prev.selectedItems);
        if (newSelected.has(item.path)) {
          newSelected.delete(item.path);
        } else {
          newSelected.add(item.path);
        }
        return { ...prev, selectedItems: newSelected };
      });
    } else {
      // Single select with toggle functionality
      setState(prev => {
        const isCurrentlySelected = prev.selectedItems.has(item.path);
        const newSelected = isCurrentlySelected ? new Set() : new Set([item.path]);
        return { ...prev, selectedItems: newSelected };
      });

      // Call onSelect with the new selection state
      if (onSelect) {
        const isCurrentlySelected = state.selectedItems.has(item.path);
        if (!isCurrentlySelected) {
          onSelect(item.path, item);
        } else {
          onSelect('', null); // Deselected
        }
      }
    }
  }, [allowMultiSelect, onSelect, state.selectedItems]);

  /**
   * Handle item double click (navigate into directories)
   */
  const handleItemDoubleClick = useCallback((item) => {
    if (item.type === FILE_TYPES.DIRECTORY) {
      loadDirectory(item.path);
    }
  }, [loadDirectory]);

  /**
   * Navigation functions
   */
  const goBack = useCallback(() => {
    if (state.historyIndex > 0) {
      const newIndex = state.historyIndex - 1;
      const path = state.history[newIndex];
      setState(prev => ({ ...prev, historyIndex: newIndex }));
      loadDirectory(path);
    }
  }, [state.historyIndex, state.history, loadDirectory]);

  const goForward = useCallback(() => {
    if (state.historyIndex < state.history.length - 1) {
      const newIndex = state.historyIndex + 1;
      const path = state.history[newIndex];
      setState(prev => ({ ...prev, historyIndex: newIndex }));
      loadDirectory(path);
    }
  }, [state.historyIndex, state.history, loadDirectory]);

  const goUp = useCallback(() => {
    if (state.currentPath && state.currentPath !== '/' && state.currentPath !== '') {
      const parentPath = state.currentPath.split(/[/\\]/).slice(0, -1).join('/') || '/';
      loadDirectory(parentPath);
    }
  }, [state.currentPath, loadDirectory]);

  const goHome = useCallback(async () => {
    // If we have the home directory cached, use it
    if (homeDir) {
      loadDirectory(homeDir);
      return;
    }
    // Otherwise fetch it
    try {
      const response = await fileExplorerApi.getCurrentWorkingDirectory();
      loadDirectory(response.homedir);
    } catch (error) {
      console.error('Failed to navigate to home:', error);
    }
  }, [loadDirectory, homeDir]);

  /**
   * Handle path input change (for paste-to-navigate)
   */
  const handlePathInputChange = useCallback((e) => {
    const newPath = e.target.value;
    setPathInput(newPath);
  }, []);

  /**
   * Handle path input key press (navigate on Enter)
   */
  const handlePathInputKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmedPath = pathInput.trim();
      if (trimmedPath) {
        loadDirectory(trimmedPath);
      }
    }
  }, [pathInput, loadDirectory]);

  /**
   * Handle path input blur (navigate when focus leaves)
   */
  const handlePathInputBlur = useCallback(() => {
    const trimmedPath = pathInput.trim();
    if (trimmedPath && trimmedPath !== state.currentPath) {
      loadDirectory(trimmedPath);
    }
  }, [pathInput, state.currentPath, loadDirectory]);

  /**
   * Clear selection
   */
  const clearSelection = useCallback(() => {
    setState(prev => ({ ...prev, selectedItems: new Set() }));
    if (onSelect) {
      onSelect('', null);
    }
  }, [onSelect]);

  // --- New Folder ---
  const handleNewFolder = useCallback(() => {
    setCreatingFolder(true);
    setNewFolderName('New Folder');
    setTimeout(() => newFolderInputRef.current?.select(), 50);
  }, []);

  const handleNewFolderConfirm = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || !state.currentPath) {
      setCreatingFolder(false);
      return;
    }
    try {
      const sep = state.currentPath.includes('\\') ? '\\' : '/';
      await fileExplorerApi.createDirectory(`${state.currentPath}${sep}${name}`);
      setCreatingFolder(false);
      setNewFolderName('');
      loadDirectory(state.currentPath); // refresh
    } catch (error) {
      console.error('Failed to create folder:', error);
    }
  }, [newFolderName, state.currentPath, loadDirectory]);

  // --- Rename ---
  const handleRenameStart = useCallback((item) => {
    setRenaming({ path: item.path, originalName: item.name, newName: item.name });
    setTimeout(() => {
      if (renameInputRef.current) {
        renameInputRef.current.focus();
        // Select name without extension
        const dotIndex = item.name.lastIndexOf('.');
        renameInputRef.current.setSelectionRange(0, dotIndex > 0 ? dotIndex : item.name.length);
      }
    }, 50);
  }, []);

  const handleRenameConfirm = useCallback(async () => {
    if (!renaming) return;
    const name = renaming.newName.trim();
    if (!name || name === renaming.originalName) {
      setRenaming(null);
      return;
    }
    try {
      await fileExplorerApi.renameItem(renaming.path, name);
      setRenaming(null);
      loadDirectory(state.currentPath); // refresh
    } catch (error) {
      console.error('Failed to rename:', error);
    }
  }, [renaming, state.currentPath, loadDirectory]);

  /**
   * Initialize component
   */
  useEffect(() => {
    const initializeDirectory = async () => {
      // If an explicit initialPath is provided, use it
      if (initialPath) {
        loadDirectory(initialPath);
        return;
      }

      try {
        // Fetch home directory info from server
        const response = await fileExplorerApi.getCurrentWorkingDirectory();
        const homedir = response.homedir;
        setHomeDir(homedir);

        // Try to get last used path from localStorage
        let startPath = homedir;
        try {
          const lastPath = localStorage.getItem(LAST_PATH_STORAGE_KEY);
          if (lastPath) {
            startPath = lastPath;
          }
        } catch (e) {
          // Ignore localStorage errors
        }

        loadDirectory(startPath);
      } catch (error) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: 'Failed to initialize directory'
        }));
      }
    };

    initializeDirectory();
  }, [initialPath, loadDirectory]);

  // Fetch quick access paths on mount
  useEffect(() => {
    const fetchQuickAccess = async () => {
      try {
        const data = await fileExplorerApi.getQuickAccessPaths();
        setQuickAccessPaths(data.paths);
      } catch (error) {
        console.error('Failed to fetch quick access paths:', error);
      }
    };
    fetchQuickAccess();
  }, []);

  // Close quick access dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (quickAccessRef.current && !quickAccessRef.current.contains(event.target)) {
        setShowQuickAccess(false);
      }
    };

    if (showQuickAccess) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showQuickAccess]);

  // Filter and sort items
  const processedItems = sortFileItems(
    filterFileItems(state.items, searchQuery),
    'name',
    'asc'
  );

  const canGoBack = state.historyIndex > 0;
  const canGoForward = state.historyIndex < state.history.length - 1;
  const canGoUp = state.currentPath !== '/' && state.currentPath !== '';

  return (
    <div
      className={`border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden bg-white dark:bg-gray-800 flex flex-col ${className}`}
      style={{ width, height }}
    >
      {/* Toolbar */}
      <div className="bg-gray-50 dark:bg-gray-700 border-b border-gray-300 dark:border-gray-600 p-3">
        <div className="flex items-center justify-between mb-2">
          {/* Navigation buttons */}
          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); goBack(); }}
              disabled={!canGoBack}
              className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Back"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); goForward(); }}
              disabled={!canGoForward}
              className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Forward"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); goUp(); }}
              disabled={!canGoUp}
              className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Up"
            >
              <ChevronUpIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); goHome(); }}
              className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              title="Home"
            >
              <HomeIcon className="h-5 w-5" />
            </button>

            {/* Quick Access Dropdown */}
            <div className="relative" ref={quickAccessRef}>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); setShowQuickAccess(!showQuickAccess); }}
                className={`p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 ${!quickAccessPaths ? 'opacity-50' : ''}`}
                title="Quick Access"
                disabled={!quickAccessPaths}
              >
                <BookmarkIcon className="h-5 w-5" />
              </button>

              {showQuickAccess && quickAccessPaths && (
                <div className="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 min-w-[160px]">
                  <div className="py-1">
                    {Object.entries(quickAccessPaths).map(([key, item]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          loadDirectory(item.path);
                          setShowQuickAccess(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center space-x-2"
                      >
                        {key === 'home' && <HomeIcon className="h-4 w-4 text-gray-500" />}
                        {key === 'desktop' && <ComputerDesktopIcon className="h-4 w-4 text-gray-500" />}
                        {key === 'documents' && <DocumentIcon className="h-4 w-4 text-gray-500" />}
                        {key === 'downloads' && <ArrowDownTrayIcon className="h-4 w-4 text-gray-500" />}
                        {!['home', 'desktop', 'documents', 'downloads'].includes(key) && <FolderIcon className="h-4 w-4 text-gray-500" />}
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); handleNewFolder(); }}
              className="p-1 text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400"
              title="New Folder"
            >
              <FolderPlusIcon className="h-5 w-5" />
            </button>
            {state.selectedItems.size === 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  const selectedPath = [...state.selectedItems][0];
                  const item = state.items.find(i => i.path === selectedPath);
                  if (item) handleRenameStart(item);
                }}
                className="p-1 text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400"
                title="Rename"
              >
                <PencilSquareIcon className="h-5 w-5" />
              </button>
            )}
            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />
            {state.selectedItems.size > 0 && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); clearSelection(); }}
                className="p-1 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                title="Clear selection"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); setShowHiddenFiles(!showHiddenFiles); }}
              className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              title={showHiddenFiles ? 'Hide hidden files' : 'Show hidden files'}
            >
              {showHiddenFiles ? (
                <EyeSlashIcon className="h-5 w-5" />
              ) : (
                <EyeIcon className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        {/* Path and search */}
        <div className="space-y-2">
          <input
            ref={pathInputRef}
            type="text"
            value={pathInput}
            onChange={handlePathInputChange}
            onKeyDown={handlePathInputKeyDown}
            onBlur={handlePathInputBlur}
            placeholder="Enter path or paste to navigate..."
            className="w-full px-2 py-1 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-loxia-500"
          />
          
          <div className="relative">
            <FunnelIcon className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter list..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-2 py-1 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-loxia-500"
            />
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
        {state.loading && (
          <div className="flex items-center justify-center h-32">
            <div className="text-gray-500 dark:text-gray-400">Loading...</div>
          </div>
        )}

        {state.error && (
          <div className="flex items-center justify-center h-32">
            <div className="text-red-600 dark:text-red-400 text-center">
              <p className="font-medium">Error</p>
              <p className="text-sm">{state.error}</p>
            </div>
          </div>
        )}

        {!state.loading && !state.error && (
          <div className="divide-y divide-gray-200 dark:divide-gray-600">
            {/* New Folder inline input */}
            {creatingFolder && (
              <div className="flex items-center px-3 py-2 bg-green-50 dark:bg-green-900/20">
                <div className="w-6 mr-3 text-center">
                  <FolderIcon className="h-5 w-5 text-green-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    ref={newFolderInputRef}
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleNewFolderConfirm(); }
                      if (e.key === 'Escape') { e.preventDefault(); setCreatingFolder(false); }
                    }}
                    onBlur={handleNewFolderConfirm}
                    className="w-full px-1 py-0.5 text-sm bg-white dark:bg-gray-800 border border-green-400 rounded focus:outline-none focus:ring-1 focus:ring-green-500 text-gray-900 dark:text-gray-100"
                    autoFocus
                  />
                </div>
                <button type="button" onClick={handleNewFolderConfirm} className="ml-2 p-1 text-green-600 hover:bg-green-100 dark:hover:bg-green-800 rounded">
                  <CheckIcon className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setCreatingFolder(false)} className="ml-1 p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            )}
            {processedItems.map((item) => {
              const isSelected = state.selectedItems.has(item.path);
              const isHidden = isHiddenItem(item);
              const isRenaming = renaming?.path === item.path;

              return (
                <div
                  key={item.path}
                  className={`
                    group flex items-center px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer
                    ${isSelected ? 'bg-loxia-50 dark:bg-loxia-900 border-l-2 border-loxia-500' : ''}
                    ${isHidden ? 'opacity-60' : ''}
                  `}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!isRenaming) handleItemClick(item, e); }}
                  onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!isRenaming) handleItemDoubleClick(item); }}
                >
                  {/* Icon */}
                  <div className="w-6 mr-3 text-center">
                    {item.type === FILE_TYPES.DIRECTORY ? (
                      <FolderIcon className="h-5 w-5 text-blue-500" />
                    ) : (
                      <DocumentIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                    )}
                  </div>

                  {/* Name — inline rename or display */}
                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renaming.newName}
                        onChange={(e) => setRenaming(prev => ({ ...prev, newName: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); handleRenameConfirm(); }
                          if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); }
                        }}
                        onBlur={handleRenameConfirm}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full px-1 py-0.5 text-sm bg-white dark:bg-gray-800 border border-amber-400 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-900 dark:text-gray-100"
                      />
                    ) : (
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {item.name}
                      </div>
                    )}
                  </div>

                  {/* Size */}
                  {!directoriesOnly && (
                    <div className="w-20 text-right">
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {item.type === FILE_TYPES.FILE ? formatFileSize(item.size) : '--'}
                      </div>
                    </div>
                  )}

                  {/* Modified */}
                  <div className="w-24 text-right">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(item.lastModified)}
                    </div>
                  </div>

                  {/* Enter/Open button for directories - appears on hover */}
                  {item.type === FILE_TYPES.DIRECTORY && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleItemDoubleClick(item);
                      }}
                      className="ml-2 p-1 opacity-0 group-hover:opacity-100 hover:bg-loxia-100 dark:hover:bg-loxia-800 rounded transition-all"
                      title="Open directory"
                    >
                      <ChevronRightIcon className="h-4 w-4 text-loxia-600 dark:text-loxia-400" />
                    </button>
                  )}
                </div>
              );
            })}

            {processedItems.length === 0 && !state.loading && (
              <div className="flex items-center justify-center h-32">
                <div className="text-gray-500 dark:text-gray-400 text-center">
                  <p className="text-sm">
                    {searchQuery ? 'No items match your filter' : 'This directory is empty'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-gray-50 dark:bg-gray-700 border-t border-gray-300 dark:border-gray-600 px-3 py-2">
        <div className="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
          <span>
            {processedItems.length} {processedItems.length === 1 ? 'item' : 'items'}
            {state.selectedItems.size > 0 && ` (${state.selectedItems.size} selected)`}
          </span>
          <span>{state.currentPath}</span>
        </div>
      </div>
    </div>
  );
}

export default FileExplorer;