import React, { useState, useCallback, useEffect } from 'react';
import { XMarkIcon, CheckIcon, FolderIcon, ClockIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import FileExplorer from './FileExplorer';

const RECENT_PATHS_KEY = 'loxia-recent-directories';
const MAX_RECENT_PATHS = 5;

/**
 * Get recent paths from localStorage
 */
const getRecentPaths = () => {
  try {
    const stored = localStorage.getItem(RECENT_PATHS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

/**
 * Save a path to recent paths
 */
const saveRecentPath = (path) => {
  if (!path) return;
  try {
    const recent = getRecentPaths().filter(p => p !== path);
    recent.unshift(path);
    localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_PATHS)));
  } catch {
    // Ignore storage errors
  }
};

/**
 * FileExplorerModal Component
 * Modal wrapper for FileExplorer that integrates with existing UI patterns
 */
function FileExplorerModal({
  isOpen,
  onClose,
  onSelectPath,
  title = 'Select Directory',
  initialPath,
  directoriesOnly = true,
  allowMultiSelect = false
}) {
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [currentBrowsePath, setCurrentBrowsePath] = useState('');
  const [recentPaths, setRecentPaths] = useState([]);

  // Load recent paths when modal opens
  useEffect(() => {
    if (isOpen) {
      setRecentPaths(getRecentPaths());
    }
  }, [isOpen]);

  /**
   * Handle file/directory selection from FileExplorer
   */
  const handleFileExplorerSelect = useCallback((path, item) => {
    setSelectedPath(path);
    setSelectedItem(item);
  }, []);

  /**
   * Handle navigation within FileExplorer
   */
  const handleNavigate = useCallback((path) => {
    setCurrentBrowsePath(path);
  }, []);

  /**
   * Handle confirm selection
   */
  const handleConfirm = useCallback(() => {
    if (selectedPath && selectedItem) {
      // User has selected a specific item
      saveRecentPath(selectedPath);
      onSelectPath(selectedPath, selectedItem);
      onClose();
    } else if (currentBrowsePath && directoriesOnly) {
      // No selection but browsing a directory - select containing folder
      const item = {
        name: currentBrowsePath.split(/[/\\]/).pop() || currentBrowsePath,
        path: currentBrowsePath,
        type: 'directory'
      };
      saveRecentPath(currentBrowsePath);
      onSelectPath(currentBrowsePath, item);
      onClose();
    }
  }, [selectedPath, selectedItem, currentBrowsePath, directoriesOnly, onSelectPath, onClose]);

  /**
   * Handle quick select from recent paths
   */
  const handleRecentPathSelect = useCallback((path) => {
    const item = {
      name: path.split(/[/\\]/).pop() || path,
      path: path,
      type: 'directory'
    };
    saveRecentPath(path);
    onSelectPath(path, item);
    onClose();
  }, [onSelectPath, onClose]);

  /**
   * Handle modal close with cleanup
   */
  const handleClose = useCallback(() => {
    setSelectedPath('');
    setSelectedItem(null);
    onClose();
  }, [onClose]);

  /**
   * Download current directory as ZIP
   */
  const handleDownloadZip = useCallback(async () => {
    const targetPath = currentBrowsePath || initialPath;
    if (!targetPath) return;
    try {
      const response = await fetch('/api/file-explorer/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath, respectGitignore: true })
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${targetPath.split(/[/\\]/).pop() || 'download'}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('ZIP download error:', error);
    }
  }, [currentBrowsePath, initialPath]);

  if (!isOpen) return null;

  return (
    <>
      {/* Modal backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity"
        onClick={handleClose}
      />
      
      {/* Modal content */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full h-[90vh] flex flex-col">
          {/* Modal header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-600">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="flex items-center space-x-2 flex-shrink-0">
                <FolderIcon className="h-5 w-5 text-loxia-600 dark:text-loxia-400" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {title}
                </h2>
              </div>

              {/* Recent Paths - Inline */}
              {recentPaths.length > 0 && (
                <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto scrollbar-hide">
                  <ClockIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  {recentPaths.slice(0, 4).map((path, index) => {
                    const folderName = path.split(/[/\\]/).pop() || path;
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => handleRecentPathSelect(path)}
                        className="inline-flex items-center px-2 py-1 text-xs font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-loxia-100 dark:hover:bg-loxia-900/30 hover:text-loxia-700 dark:hover:text-loxia-300 transition-colors flex-shrink-0"
                        title={path}
                      >
                        <span className="max-w-[80px] truncate">{folderName}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleDownloadZip}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors flex-shrink-0"
              title="Download current directory as ZIP"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              <span>ZIP</span>
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="p-2 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors flex-shrink-0 ml-2"
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Modal body - File Explorer */}
          <div className="flex-1 p-6 overflow-hidden min-h-0">
            <FileExplorer
              initialPath={initialPath}
              onSelect={handleFileExplorerSelect}
              onNavigate={handleNavigate}
              directoriesOnly={directoriesOnly}
              allowMultiSelect={allowMultiSelect}
              height="100%"
              width="100%"
              showHidden={false}
            />
          </div>

          {/* Selected path display - Always visible to prevent layout shift */}
          <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
            {selectedPath ? (
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Selected:
                  </p>
                  <p className="text-sm text-gray-900 dark:text-gray-100 truncate" title={selectedPath}>
                    {selectedPath}
                  </p>
                </div>
                <div className="ml-4">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-loxia-100 text-loxia-800 dark:bg-loxia-900 dark:text-loxia-200">
                    {selectedItem?.type === 'directory' ? 'Directory' : 'File'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-10">
                <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                  Click to select • Double-click to open • Or click "Select Current Folder"
                </p>
              </div>
            )}
          </div>

          {/* Modal footer */}
          <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 dark:border-gray-600">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-loxia-500 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!selectedPath && !currentBrowsePath}
              className="px-4 py-2 text-sm font-medium text-white bg-loxia-600 border border-transparent rounded-lg hover:bg-loxia-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-loxia-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 transition-colors"
            >
              <CheckIcon className="h-4 w-4" />
              <span>{selectedPath ? 'Select' : 'Select Current Folder'}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default FileExplorerModal;