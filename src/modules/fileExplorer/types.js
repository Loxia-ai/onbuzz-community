/**
 * File Explorer Module Types
 * Defines types and interfaces for file system operations
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
 * @typedef {Object} FileExplorerConfig
 * @property {boolean} showHidden - Show hidden files/directories
 * @property {string[]} allowedExtensions - Allowed file extensions (empty = all)
 * @property {number} maxDepth - Maximum directory traversal depth
 * @property {string[]} restrictedPaths - Paths that cannot be accessed
 */

export {
  // Export types as JSDoc comments for runtime usage
};