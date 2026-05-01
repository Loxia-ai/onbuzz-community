/**
 * File Explorer Utilities
 * Helper functions for file operations and formatting
 */

import { FILE_TYPES } from '../types/index.js';

/**
 * Format file size in human readable format
 * @param {number} bytes - File size in bytes
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted size string
 */
export function formatFileSize(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  if (!bytes) return '--';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format date in user-friendly format
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string
 */
export function formatDate(date) {
  if (!date) return '--';
  
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return '--';

  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today ' + dateObj.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  } else if (diffDays === 1) {
    return 'Yesterday ' + dateObj.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return dateObj.toLocaleDateString();
  }
}

/**
 * Get file extension
 * @param {string} filename - File name
 * @returns {string} File extension (without dot)
 */
export function getFileExtension(filename) {
  if (!filename || typeof filename !== 'string') return '';
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Get file icon based on file type/extension
 * @param {FileItem} item - File item
 * @returns {string} Icon class name or emoji
 */
export function getFileIcon(item) {
  if (item.type === FILE_TYPES.DIRECTORY) {
    return '📁';
  }

  const ext = item.extension || getFileExtension(item.name);
  
  // Common file type icons
  const iconMap = {
    // Documents
    'pdf': '📄',
    'doc': '📄',
    'docx': '📄',
    'txt': '📄',
    'rtf': '📄',
    
    // Spreadsheets
    'xls': '📊',
    'xlsx': '📊',
    'csv': '📊',
    
    // Presentations
    'ppt': '📊',
    'pptx': '📊',
    
    // Images
    'jpg': '🖼️',
    'jpeg': '🖼️',
    'png': '🖼️',
    'gif': '🖼️',
    'bmp': '🖼️',
    'svg': '🖼️',
    'webp': '🖼️',
    
    // Audio
    'mp3': '🎵',
    'wav': '🎵',
    'flac': '🎵',
    'aac': '🎵',
    'ogg': '🎵',
    
    // Video
    'mp4': '🎬',
    'avi': '🎬',
    'mkv': '🎬',
    'mov': '🎬',
    'wmv': '🎬',
    'webm': '🎬',
    
    // Code
    'js': '📜',
    'jsx': '📜',
    'ts': '📜',
    'tsx': '📜',
    'html': '📜',
    'css': '📜',
    'scss': '📜',
    'json': '📜',
    'xml': '📜',
    'yaml': '📜',
    'yml': '📜',
    'py': '📜',
    'java': '📜',
    'cpp': '📜',
    'c': '📜',
    'php': '📜',
    'rb': '📜',
    'go': '📜',
    'rs': '📜',
    
    // Archives
    'zip': '📦',
    'rar': '📦',
    '7z': '📦',
    'tar': '📦',
    'gz': '📦',
    
    // System
    'exe': '⚙️',
    'msi': '⚙️',
    'deb': '⚙️',
    'dmg': '⚙️',
    'app': '⚙️'
  };

  return iconMap[ext] || '📋';
}

/**
 * Check if item is hidden (starts with dot)
 * @param {FileItem} item - File item
 * @returns {boolean} True if hidden
 */
export function isHiddenItem(item) {
  return item.name.startsWith('.');
}

/**
 * Sort file items
 * @param {FileItem[]} items - Items to sort
 * @param {'name'|'size'|'modified'|'type'} sortBy - Sort field
 * @param {'asc'|'desc'} sortOrder - Sort order
 * @returns {FileItem[]} Sorted items
 */
export function sortFileItems(items, sortBy = 'name', sortOrder = 'asc') {
  const sorted = [...items].sort((a, b) => {
    // Always put directories first
    if (a.type !== b.type) {
      return a.type === FILE_TYPES.DIRECTORY ? -1 : 1;
    }

    let result = 0;
    switch (sortBy) {
      case 'name':
        result = a.name.localeCompare(b.name);
        break;
      case 'size':
        result = (a.size || 0) - (b.size || 0);
        break;
      case 'modified':
        const aTime = a.lastModified ? new Date(a.lastModified).getTime() : 0;
        const bTime = b.lastModified ? new Date(b.lastModified).getTime() : 0;
        result = aTime - bTime;
        break;
      case 'type':
        const aExt = getFileExtension(a.name);
        const bExt = getFileExtension(b.name);
        result = aExt.localeCompare(bExt);
        break;
      default:
        result = a.name.localeCompare(b.name);
    }

    return sortOrder === 'desc' ? -result : result;
  });

  return sorted;
}

/**
 * Filter file items based on search query
 * @param {FileItem[]} items - Items to filter
 * @param {string} query - Search query
 * @returns {FileItem[]} Filtered items
 */
export function filterFileItems(items, query) {
  if (!query || query.trim() === '') {
    return items;
  }

  const lowerQuery = query.toLowerCase().trim();
  return items.filter(item => 
    item.name.toLowerCase().includes(lowerQuery) ||
    (item.extension && item.extension.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Get parent directory path
 * @param {string} path - Current path
 * @returns {string} Parent path
 */
export function getParentPath(path) {
  if (!path || path === '/' || path === '\\') {
    return null;
  }
  
  // Handle Windows and Unix paths
  const separator = path.includes('\\') ? '\\' : '/';
  const parts = path.split(separator);
  parts.pop();
  
  const parent = parts.join(separator);
  return parent || separator;
}

/**
 * Join path segments safely
 * @param {...string} segments - Path segments
 * @returns {string} Joined path
 */
export function joinPath(...segments) {
  if (segments.length === 0) return '';
  
  const separator = segments[0].includes('\\') ? '\\' : '/';
  return segments
    .map(segment => segment.replace(/[/\\]+$/, ''))
    .join(separator);
}