import React, { useState, useRef, useEffect } from 'react';
import { FolderOpenIcon, XMarkIcon, CheckCircleIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import FileExplorerModal from '../modules/fileExplorer/index.js';

/**
 * FolderPicker Component
 * Provides a user-friendly way to select directories instead of manual text input
 */
function FolderPicker({
  value = '',
  onChange,
  onBlur,
  onComplete,
  placeholder = 'Enter directory path...',
  disabled = false,
  allowBrowseHelper = true,
  className = ''
}) {
  const [showSuccessIndicator, setShowSuccessIndicator] = useState(false);
  const [showRemovalIndicator, setShowRemovalIndicator] = useState(false);
  const [showFileExplorer, setShowFileExplorer] = useState(false);
  const fileInputRef = useRef(null);

  // Auto-hide success indicator after 3 seconds (longer for better visibility)
  useEffect(() => {
    if (showSuccessIndicator) {
      const timer = setTimeout(() => setShowSuccessIndicator(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showSuccessIndicator]);

  // Auto-hide removal indicator after 2 seconds
  useEffect(() => {
    if (showRemovalIndicator) {
      const timer = setTimeout(() => setShowRemovalIndicator(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [showRemovalIndicator]);

  const handleFolderSelect = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileInputChange = (event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      let selectedPath = '';
      
      // Log all available properties for debugging
      console.log('File object properties:', {
        name: file.name,
        path: file.path,
        webkitRelativePath: file.webkitRelativePath,
        fullPath: file.fullPath,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified
      });
      
      // For debugging: show all enumerable properties
      console.log('All file properties:', Object.getOwnPropertyNames(file));
      
      // First try: Direct file path (available in some environments like Electron/desktop apps)
      if (file.path) {
        selectedPath = file.path.includes('/') 
          ? file.path.substring(0, file.path.lastIndexOf('/'))
          : file.path.substring(0, file.path.lastIndexOf('\\'));
      }
      // Second try: webkitRelativePath for directory selection
      else if (file.webkitRelativePath) {
        // For webkitRelativePath, we get "folder/subfolder/file.txt"
        // We want just the root folder name for now
        const parts = file.webkitRelativePath.split('/');
        selectedPath = parts[0]; // Just the folder name
        
        // But let's also try to construct a fuller path if possible
        console.log('webkitRelativePath parts:', parts);
      }
      // Third try: fullPath property if available
      else if (file.fullPath) {
        selectedPath = file.fullPath.includes('/') 
          ? file.fullPath.substring(0, file.fullPath.lastIndexOf('/'))
          : file.fullPath.substring(0, file.fullPath.lastIndexOf('\\'));
      }
      
      console.log('Selected path:', selectedPath);
      
      if (selectedPath) {
        onChange(selectedPath);
        setShowSuccessIndicator(true);
        onComplete?.(selectedPath);
      } else {
        // If no path available, just show what we found for debugging
        console.warn('No path information available in file object');
        const debugInfo = `${file.name} (webkitRelativePath: ${file.webkitRelativePath || 'none'})`;
        onChange(debugInfo);
        setShowSuccessIndicator(true);
      }
    }
    
    // Reset the input so the same folder can be selected again
    event.target.value = '';
  };

  const handleDirectorySelect = () => {
    setShowFileExplorer(true);
  };

  const handleFileExplorerSelect = (selectedPath, item) => {
    onChange(selectedPath);
    setShowSuccessIndicator(true);
    setShowFileExplorer(false);
    // Notify parent that a directory was selected (with the actual value)
    onComplete?.(selectedPath);
  };

  const handleFileExplorerClose = () => {
    setShowFileExplorer(false);
  };

  const handleInputChange = (event) => {
    onChange(event.target.value);
  };

  const clearValue = () => {
    onChange('');
    setShowRemovalIndicator(true);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center space-x-2">
        <div className={`
          flex-1 relative
          ${showSuccessIndicator 
            ? 'ring-2 ring-green-200 dark:ring-green-800' 
            : showRemovalIndicator
            ? 'ring-2 ring-orange-100 dark:ring-orange-800'
            : ''
          }
          transition-all duration-300 rounded-lg
        `}>
          <div className="relative flex items-center">
            <FolderOpenIcon className={`absolute left-3 h-5 w-5 pointer-events-none transition-colors ${
              showSuccessIndicator 
                ? 'text-green-600 dark:text-green-400' 
                : 'text-gray-400'
            }`} />
            <input
              type="text"
              value={value}
              onChange={handleInputChange}
              onBlur={onBlur}
              placeholder={placeholder}
              className={`
                w-full pl-10 pr-20 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                focus:outline-none focus:ring-2 focus:ring-loxia-500 focus:border-transparent
                transition-all duration-300
                ${showSuccessIndicator 
                  ? 'border-green-500 dark:border-green-400' 
                  : showRemovalIndicator
                  ? 'border-orange-400 dark:border-orange-500'
                  : disabled 
                  ? 'border-gray-300 dark:border-gray-600 opacity-50 cursor-not-allowed' 
                  : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                }
              `}
              disabled={disabled}
            />
            <div className="absolute right-2 flex items-center space-x-1">
              {showSuccessIndicator && (
                <div className="flex items-center space-x-1">
                  <CheckCircleIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <span className="text-xs text-green-600 dark:text-green-400 font-medium">Added</span>
                </div>
              )}
              {showRemovalIndicator && (
                <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">Cleared</span>
              )}
              {value && !disabled && !showSuccessIndicator && !showRemovalIndicator && (
                <button
                  onClick={clearValue}
                  className="p-1 text-gray-400 hover:text-red-500 focus:outline-none transition-colors"
                  type="button"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
        
        {allowBrowseHelper && (
          <button
            type="button"
            onClick={handleDirectorySelect}
            className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg hover:border-gray-400 dark:hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-loxia-500 transition-colors flex items-center space-x-1"
            disabled={disabled}
            title="Open file explorer to select directory"
          >
            <FolderOpenIcon className="h-4 w-4" />
            <span>Browse</span>
          </button>
        )}
      </div>
      
      {/* Hidden file input for browse helper */}
      {allowBrowseHelper && (
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
          webkitdirectory=""
          multiple
        />
      )}
      
      {/* File Explorer Modal */}
      <FileExplorerModal
        isOpen={showFileExplorer}
        onClose={handleFileExplorerClose}
        onSelectPath={handleFileExplorerSelect}
        title="Select Directory"
        directoriesOnly={true}
        allowMultiSelect={false}
      />
      
      {/* Help text */}
      {!value && allowBrowseHelper && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Type a directory path directly or click "Browse" to open the file explorer and select a directory
        </p>
      )}
    </div>
  );
}

export default FolderPicker;