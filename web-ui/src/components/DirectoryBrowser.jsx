import React, { useState, useEffect } from 'react';
import { FolderIcon, FolderOpenIcon, ChevronUpIcon, ChevronRightIcon, CheckIcon } from '@heroicons/react/24/outline';

/**
 * DirectoryBrowser Component
 * Server-side directory browsing that works within browser security constraints
 */
function DirectoryBrowser({ onSelect, currentPath = '', disabled = false }) {
  const [directories, setDirectories] = useState([]);
  const [currentDir, setCurrentDir] = useState('');
  const [parentDir, setParentDir] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPath, setSelectedPath] = useState(currentPath);

  // Load directory contents
  const loadDirectory = async (path = '') => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/directories?startPath=${encodeURIComponent(path)}`);
      const data = await response.json();
      
      if (data.success) {
        setDirectories(data.directories);
        setCurrentDir(data.currentPath);
        setParentDir(data.parentPath);
      } else {
        setError(data.error || 'Failed to load directory');
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Load initial directory on mount
  useEffect(() => {
    loadDirectory();
  }, []);

  const handleDirectoryClick = (dir) => {
    loadDirectory(dir.path);
  };

  const handleParentClick = () => {
    if (parentDir) {
      loadDirectory(parentDir);
    }
  };

  const handleSelectCurrent = () => {
    setSelectedPath(currentDir);
    if (onSelect) {
      // Provide relative path for better portability
      const relativePath = currentDir.replace(process.cwd() || '', '').replace(/^[\/\\]/, '') || '.';
      onSelect(relativePath);
    }
  };

  const handleUseTypedPath = () => {
    if (onSelect) {
      onSelect(selectedPath);
    }
  };

  return (
    <div className="space-y-4">
      {/* Current path and selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Browse Directories</span>
          <button
            onClick={handleSelectCurrent}
            disabled={disabled || loading}
            className="px-3 py-1 text-sm bg-loxia-600 text-white rounded hover:bg-loxia-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
          >
            <CheckIcon className="h-4 w-4" />
            <span>Use Current</span>
          </button>
        </div>
        
        <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 p-2 rounded">
          <strong>Current:</strong> {currentDir || 'Loading...'}
        </div>
      </div>

      {/* Manual path input */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Or type path directly:
        </label>
        <div className="flex space-x-2">
          <input
            type="text"
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            placeholder="e.g., ./my-project or ../parent-folder"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-loxia-500"
            disabled={disabled}
          />
          <button
            onClick={handleUseTypedPath}
            disabled={disabled || !selectedPath.trim()}
            className="px-3 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Use
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Supports relative paths like <code>./folder</code>, <code>../parent</code>, or absolute paths
        </p>
      </div>

      {/* Directory browser */}
      <div className="border border-gray-300 dark:border-gray-600 rounded-lg">
        <div className="bg-gray-50 dark:bg-gray-700 px-3 py-2 border-b border-gray-300 dark:border-gray-600">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Directory Browser</span>
        </div>
        
        <div className="max-h-64 overflow-y-auto">
          {loading && (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              Loading directories...
            </div>
          )}
          
          {error && (
            <div className="p-4 text-center text-red-600 dark:text-red-400">
              Error: {error}
            </div>
          )}
          
          {!loading && !error && (
            <div className="p-2 space-y-1">
              {/* Parent directory option */}
              {parentDir && (
                <button
                  onClick={handleParentClick}
                  className="w-full flex items-center space-x-2 px-2 py-1 text-left hover:bg-gray-100 dark:hover:bg-gray-600 rounded"
                  disabled={disabled}
                >
                  <ChevronUpIcon className="h-4 w-4 text-gray-500" />
                  <FolderIcon className="h-4 w-4 text-gray-500" />
                  <span className="text-sm text-gray-600 dark:text-gray-300">.. (parent directory)</span>
                </button>
              )}
              
              {/* Directory list */}
              {directories.map((dir, index) => (
                <button
                  key={index}
                  onClick={() => handleDirectoryClick(dir)}
                  className="w-full flex items-center space-x-2 px-2 py-1 text-left hover:bg-gray-100 dark:hover:bg-gray-600 rounded"
                  disabled={disabled}
                >
                  <ChevronRightIcon className="h-4 w-4 text-gray-400" />
                  <FolderOpenIcon className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{dir.name}</span>
                </button>
              ))}
              
              {directories.length === 0 && !loading && (
                <div className="p-2 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No subdirectories found
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DirectoryBrowser;