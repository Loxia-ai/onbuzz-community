/**
 * File Explorer Types
 * Type definitions for file explorer components
 */

/**
 * @typedef {Object} FileItem
 * @property {string} name - File or directory name
 * @property {string} path - Full absolute path
 * @property {'file'|'directory'} type - Item type
 * @property {number} [size] - File size in bytes (files only)
 * @property {Date} [lastModified] - Last modification date
 * @property {string} [extension] - File extension (files only)
 */

/**
 * @typedef {Object} BrowseResponse
 * @property {string} currentPath - Current directory path
 * @property {string} parentPath - Parent directory path
 * @property {FileItem[]} items - Directory contents
 * @property {number} totalItems - Total number of items
 * @property {number} directories - Number of directories
 * @property {number} files - Number of files
 */

/**
 * @typedef {Object} ApiResponse
 * @property {boolean} success - Operation success status
 * @property {*} [data] - Response data
 * @property {string} [error] - Error message if failed
 * @property {string} [code] - Error code if applicable
 */

/**
 * @typedef {Object} FileExplorerProps
 * @property {string} [initialPath] - Starting directory path
 * @property {function} [onSelect] - Callback when file/directory is selected: (path, item) => void
 * @property {function} [onNavigate] - Callback when directory is navigated: (path) => void
 * @property {boolean} [allowMultiSelect] - Enable multi-selection
 * @property {string} [height] - Component height CSS value
 * @property {string} [width] - Component width CSS value
 * @property {string} [className] - Additional CSS classes
 * @property {boolean} [showHidden] - Show hidden files/directories
 * @property {boolean} [directoriesOnly] - Only show directories (for folder picker)
 */

/**
 * @typedef {Object} FileExplorerState
 * @property {string} currentPath - Current directory path
 * @property {FileItem[]} items - Directory contents
 * @property {Set<string>} selectedItems - Selected item paths
 * @property {boolean} loading - Loading state
 * @property {string|null} error - Error message
 * @property {string[]} history - Navigation history
 * @property {number} historyIndex - Current position in history
 */

export const FILE_TYPES = {
  FILE: 'file',
  DIRECTORY: 'directory'
};

export const API_ENDPOINTS = {
  HEALTH: '/api/file-explorer/health',
  CWD: '/api/file-explorer/cwd',
  BROWSE: '/api/file-explorer/browse',
  FILE_INFO: '/api/file-explorer/file-info',
  MKDIR: '/api/file-explorer/mkdir',
  RENAME: '/api/file-explorer/rename',
  QUICK_ACCESS: '/api/file-explorer/quick-access'
};