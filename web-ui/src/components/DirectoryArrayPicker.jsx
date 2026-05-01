import React, { useState, useEffect } from 'react';
import { XMarkIcon, PlusIcon, CheckCircleIcon, MinusCircleIcon } from '@heroicons/react/24/outline';
import FolderPicker from './FolderPicker.jsx';

/**
 * DirectoryArrayPicker Component
 * Manages an array of directory paths with folder picker interface
 */
function DirectoryArrayPicker({
  directories = [],
  onChange,
  label,
  description,
  placeholder = 'Select a directory...',
  disabled = false,
  addButtonText = 'Add Directory'
}) {
  const [recentlyAdded, setRecentlyAdded] = useState(null);
  const [recentlyRemoved, setRecentlyRemoved] = useState(null);

  // Auto-hide success indicators
  useEffect(() => {
    if (recentlyAdded !== null) {
      const timer = setTimeout(() => setRecentlyAdded(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [recentlyAdded]);

  useEffect(() => {
    if (recentlyRemoved !== null) {
      const timer = setTimeout(() => setRecentlyRemoved(null), 1500);
      return () => clearTimeout(timer);
    }
  }, [recentlyRemoved]);

  const handleDirectoryChange = (index, newValue) => {
    const newDirectories = [...directories];
    newDirectories[index] = newValue;
    onChange(newDirectories);
  };

  const handleRemoveDirectory = (index) => {
    const newDirectories = directories.filter((_, i) => i !== index);
    onChange(newDirectories);
    setRecentlyRemoved(index);
  };

  const handleAddDirectory = () => {
    const newIndex = directories.length;
    onChange([...directories, '']);
    setRecentlyAdded(newIndex);
  };

  return (
    <div className="space-y-3">
      {label && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {label}
          </label>
          {description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {description}
            </p>
          )}
        </div>
      )}
      
      <div className="space-y-3">
        {directories.map((directory, index) => (
          <div 
            key={index} 
            className={`flex items-start space-x-2 transition-all duration-300 ${
              recentlyAdded === index 
                ? 'ring-2 ring-green-200 dark:ring-green-800 rounded-lg p-2 bg-green-50 dark:bg-green-900/20' 
                : ''
            }`}
          >
            <div className="flex-1">
              <FolderPicker
                value={directory}
                onChange={(value) => handleDirectoryChange(index, value)}
                placeholder={placeholder}
                disabled={disabled}
                allowBrowseHelper={true}
              />
            </div>
            <div className="flex items-center mt-2 space-x-1">
              {recentlyAdded === index && (
                <CheckCircleIcon className="h-4 w-4 text-green-600 dark:text-green-400 animate-pulse" />
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemoveDirectory(index)}
                  className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-500 rounded-lg transition-colors group"
                  title="Remove directory"
                >
                  <XMarkIcon className="h-4 w-4 group-hover:scale-110 transition-transform" />
                </button>
              )}
            </div>
          </div>
        ))}
        
        {!disabled && (
          <button
            type="button"
            onClick={handleAddDirectory}
            className={`
              w-full flex items-center justify-center px-3 py-3 border-2 border-dashed rounded-lg text-sm 
              focus:outline-none focus:ring-2 focus:ring-loxia-500 transition-all duration-200
              ${recentlyAdded === directories.length - 1
                ? 'border-green-400 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-loxia-400 dark:hover:border-loxia-500 hover:text-loxia-700 dark:hover:text-loxia-300 hover:bg-loxia-50 dark:hover:bg-loxia-900/20'
              }
            `}
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            {addButtonText}
          </button>
        )}
      </div>
    </div>
  );
}

export default DirectoryArrayPicker;