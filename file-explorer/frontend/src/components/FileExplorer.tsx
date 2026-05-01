import React, { useState, useEffect, useCallback } from 'react';
import { FileItem, FileExplorerProps, FileExplorerState } from '../types';
import { fileApi } from '../services/api';
import {
  getFileIcon,
  formatFileSize,
  formatDate,
  isHiddenFile,
  sortFileItems,
  getParentPath
} from '../utils/fileUtils';

const FileExplorer: React.FC<FileExplorerProps> = ({
  initialPath = '',
  onSelect,
  onNavigate,
  allowMultiSelect = false,
  height = '500px',
  width = '100%',
  className = '',
  showHidden = false
}) => {
  const [state, setState] = useState<FileExplorerState>({
    currentPath: initialPath,
    items: [],
    selectedItems: new Set<string>(),
    loading: false,
    error: null,
    history: [initialPath],
    historyIndex: 0
  });

  const loadDirectory = useCallback(async (path: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fileApi.browse(path);
      let filteredItems = response.items;

      if (!showHidden) {
        filteredItems = filteredItems.filter(item => !isHiddenFile(item.name));
      }

      setState(prev => ({
        ...prev,
        currentPath: response.currentPath,
        items: sortFileItems(filteredItems),
        loading: false,
        selectedItems: new Set<string>()
      }));

      onNavigate?.(response.currentPath);
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load directory'
      }));
    }
  }, [showHidden, onNavigate]);

  const navigate = useCallback((path: string) => {
    setState(prev => {
      const newHistory = prev.history.slice(0, prev.historyIndex + 1);
      newHistory.push(path);
      return {
        ...prev,
        history: newHistory,
        historyIndex: newHistory.length - 1
      };
    });
    loadDirectory(path);
  }, [loadDirectory]);

  const goBack = useCallback(() => {
    setState(prev => {
      if (prev.historyIndex > 0) {
        const newIndex = prev.historyIndex - 1;
        const path = prev.history[newIndex];
        loadDirectory(path);
        return { ...prev, historyIndex: newIndex };
      }
      return prev;
    });
  }, [loadDirectory]);

  const goForward = useCallback(() => {
    setState(prev => {
      if (prev.historyIndex < prev.history.length - 1) {
        const newIndex = prev.historyIndex + 1;
        const path = prev.history[newIndex];
        loadDirectory(path);
        return { ...prev, historyIndex: newIndex };
      }
      return prev;
    });
  }, [loadDirectory]);

  const goUp = useCallback(() => {
    const parentPath = getParentPath(state.currentPath);
    if (parentPath !== state.currentPath) {
      navigate(parentPath);
    }
  }, [state.currentPath, navigate]);

  const handleItemClick = useCallback((item: FileItem, event: React.MouseEvent) => {
    const isCtrlClick = event.ctrlKey || event.metaKey;

    if (item.type === 'directory') {
      navigate(item.path);
    } else {
      if (allowMultiSelect && isCtrlClick) {
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
        setState(prev => ({ ...prev, selectedItems: new Set([item.path]) }));
      }
      onSelect?.(item.path, item);
    }
  }, [allowMultiSelect, navigate, onSelect]);

  const handleItemDoubleClick = useCallback((item: FileItem) => {
    if (item.type === 'directory') {
      navigate(item.path);
    }
  }, [navigate]);

  useEffect(() => {
    const initializeDirectory = async () => {
      if (initialPath) {
        loadDirectory(initialPath);
      } else if (state.currentPath === '') {
        // If no initial path, get the current working directory from the backend
        try {
          const cwdResponse = await fileApi.getCurrentWorkingDirectory();
          loadDirectory(cwdResponse.cwd);
        } catch (error) {
          // If CWD fails, don't use a fallback - let the user know there's an issue
          setState(prev => ({
            ...prev,
            loading: false,
            error: 'Failed to initialize directory'
          }));
        }
      }
    };

    initializeDirectory();
  }, []); // Simplified dependency array - run only once on mount

  const canGoBack = state.historyIndex > 0;
  const canGoForward = state.historyIndex < state.history.length - 1;
  const canGoUp = state.currentPath !== '/' && state.currentPath !== '';

  return (
    <div
      className={`file-explorer border border-border rounded-lg overflow-hidden ${className}`}
      style={{ width, height }}
    >
      {/* Navigation Bar */}
      <div className="bg-muted border-b border-border p-2 flex items-center gap-2">
        <button
          onClick={goBack}
          disabled={!canGoBack}
          className="p-1 rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          title="Go Back"
        >
          ←
        </button>
        <button
          onClick={goForward}
          disabled={!canGoForward}
          className="p-1 rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          title="Go Forward"
        >
          →
        </button>
        <button
          onClick={goUp}
          disabled={!canGoUp}
          className="p-1 rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          title="Go Up"
        >
          ↑
        </button>
        <div className="flex-1 mx-2">
          <input
            type="text"
            value={state.currentPath}
            readOnly
            className="w-full px-2 py-1 text-sm bg-background border border-border rounded"
          />
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto">

        {state.loading && (
          <div className="flex items-center justify-center h-32">
            <div className="text-muted-foreground">Loading...</div>
          </div>
        )}

        {state.error && (
          <div className="flex items-center justify-center h-32">
            <div className="text-destructive">{state.error}</div>
          </div>
        )}

        {!state.loading && !state.error && (
          <div className="divide-y divide-border">
            {state.items.map((item, index) => {
              const isSelected = state.selectedItems.has(item.path);
              return (
                <div
                  key={`${item.path}-${index}`}
                  className={`file-item flex items-center p-2 cursor-pointer select-none ${
                    isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                  }`}
                  onClick={(e) => handleItemClick(item, e)}
                  onDoubleClick={() => handleItemDoubleClick(item)}
                >
                  <span className="file-icon mr-3 text-lg">
                    {getFileIcon(item)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{item.name}</div>
                    {item.type === 'file' && (
                      <div className="text-xs text-muted-foreground">
                        {formatFileSize(item.size)} • {formatDate(item.lastModified)}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground ml-2">
                    {item.type === 'directory' ? 'Folder' : item.extension?.toUpperCase() || 'File'}
                  </div>
                </div>
              );
            })}

            {state.items.length === 0 && (
              <div className="flex items-center justify-center h-32">
                <div className="text-muted-foreground">This folder is empty</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="bg-muted border-t border-border px-2 py-1 text-xs text-muted-foreground">
        {state.selectedItems.size > 0 ? (
          `${state.selectedItems.size} item${state.selectedItems.size === 1 ? '' : 's'} selected`
        ) : (
          `${state.items.length} item${state.items.length === 1 ? '' : 's'}`
        )}
      </div>
    </div>
  );
};

export default FileExplorer;