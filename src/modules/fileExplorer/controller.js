/**
 * File Explorer Controller
 * Handles all file system operations for the file explorer module
 */

import { promises as fs } from 'fs';
import { exec } from 'child_process';
import path from 'path';
import os from 'os';

class FileExplorerController {
  constructor(config = {}) {
    this.config = {
      showHidden: false,
      allowedExtensions: [], // Empty array = all extensions allowed
      maxDepth: 50, // Prevent infinite directory traversal
      restrictedPaths: [], // Paths that cannot be accessed
      ...config
    };
  }

  /**
   * Get file/directory stats safely
   * @param {string} filePath - Path to check
   * @returns {Promise<{stats: fs.Stats | null, error?: string}>}
   */
  async getFileStats(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return { stats };
    } catch (error) {
      return { 
        stats: null, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Check if path is safe and accessible
   * @param {string} requestedPath - Path to validate
   * @returns {boolean}
   */
  isSafePath(requestedPath) {
    try {
      const resolvedPath = path.resolve(requestedPath);
      
      // Check if path is in restricted list
      if (this.config.restrictedPaths.some(restricted => 
        resolvedPath.startsWith(path.resolve(restricted))
      )) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Filter items based on configuration
   * @param {string} itemName - Item name to check
   * @param {fs.Stats} stats - File stats
   * @returns {boolean}
   */
  shouldIncludeItem(itemName, stats) {
    // Check hidden files
    if (!this.config.showHidden && itemName.startsWith('.')) {
      return false;
    }

    // Check file extensions (only for files)
    if (stats.isFile() && this.config.allowedExtensions.length > 0) {
      const ext = path.extname(itemName).toLowerCase();
      if (!this.config.allowedExtensions.includes(ext)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Browse directory contents
   * @param {string} requestedPath - Directory path to browse
   * @param {Object} options - Browse options
   * @returns {Promise<{success: boolean, data?: BrowseResponse, error?: string}>}
   */
  async browseDirectory(requestedPath = process.cwd(), options = {}) {
    try {
      const normalizedPath = path.resolve(requestedPath);

      // Security checks
      if (!this.isSafePath(normalizedPath)) {
        return {
          success: false,
          error: 'Access to this path is restricted'
        };
      }

      // Check if path exists and is directory
      const { stats, error } = await this.getFileStats(normalizedPath);
      if (error || !stats) {
        return {
          success: false,
          error: 'Path not found or inaccessible'
        };
      }

      if (!stats.isDirectory()) {
        return {
          success: false,
          error: 'Path is not a directory'
        };
      }

      // Read directory contents
      const items = await fs.readdir(normalizedPath);
      const fileItems = [];

      // Process each item
      for (const item of items) {
        const itemPath = path.join(normalizedPath, item);
        const { stats: itemStats } = await this.getFileStats(itemPath);

        if (itemStats && this.shouldIncludeItem(item, itemStats)) {
          const fileItem = {
            name: item,
            path: itemPath,
            type: itemStats.isDirectory() ? 'directory' : 'file',
            size: itemStats.isFile() ? itemStats.size : undefined,
            lastModified: itemStats.mtime,
            extension: itemStats.isFile() ? path.extname(item).toLowerCase() : undefined
          };
          fileItems.push(fileItem);
        }
      }

      // Sort: directories first, then files, both alphabetically
      fileItems.sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name);
        }
        return a.type === 'directory' ? -1 : 1;
      });

      // Calculate parent path
      const parentPath = path.dirname(normalizedPath);
      const hasParent = parentPath !== normalizedPath;

      return {
        success: true,
        data: {
          currentPath: normalizedPath,
          parentPath: hasParent ? parentPath : null,
          items: fileItems,
          totalItems: fileItems.length,
          directories: fileItems.filter(item => item.type === 'directory').length,
          files: fileItems.filter(item => item.type === 'file').length
        }
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Server error'
      };
    }
  }

  /**
   * Get file information
   * @param {string} filePath - File path to get info for
   * @returns {Promise<{success: boolean, data?: FileItem, error?: string}>}
   */
  async getFileInfo(filePath) {
    try {
      if (!filePath || !this.isSafePath(filePath)) {
        return {
          success: false,
          error: 'Invalid file path'
        };
      }

      const { stats, error } = await this.getFileStats(filePath);
      if (error || !stats) {
        return {
          success: false,
          error: 'File not found'
        };
      }

      const fileInfo = {
        name: path.basename(filePath),
        path: filePath,
        type: stats.isDirectory() ? 'directory' : 'file',
        size: stats.isFile() ? stats.size : undefined,
        lastModified: stats.mtime,
        extension: stats.isFile() ? path.extname(filePath).toLowerCase() : undefined
      };

      return {
        success: true,
        data: fileInfo
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Server error'
      };
    }
  }

  /**
   * Get current working directory info
   * @returns {{success: boolean, data: {cwd: string, platform: string, homedir: string}}}
   */
  getCurrentWorkingDirectory() {
    return {
      success: true,
      data: {
        cwd: process.cwd(),
        platform: process.platform,
        homedir: os.homedir()
      }
    };
  }

  /**
   * Create directory
   * @param {string} dirPath - Directory path to create
   * @param {Object} options - Creation options
   * @returns {Promise<{success: boolean, data?: {path: string}, error?: string}>}
   */
  async createDirectory(dirPath, options = {}) {
    try {
      if (!this.isSafePath(dirPath)) {
        return {
          success: false,
          error: 'Invalid directory path'
        };
      }

      await fs.mkdir(dirPath, { recursive: options.recursive || false });

      return {
        success: true,
        data: {
          path: dirPath,
          relativePath: path.relative(process.cwd(), dirPath)
        }
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create directory',
        code: error.code
      };
    }
  }

  /**
   * Rename a file or directory
   * @param {string} oldPath - Current full path
   * @param {string} newName - New name (not full path — just the filename/dirname)
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async renameItem(oldPath, newName) {
    try {
      const normalizedOld = path.resolve(oldPath);

      if (!this.isSafePath(normalizedOld)) {
        return { success: false, error: 'Access to this path is restricted' };
      }

      // Validate new name
      if (!newName || /[/\\:*?"<>|]/.test(newName)) {
        return { success: false, error: 'Invalid file/directory name' };
      }

      const parentDir = path.dirname(normalizedOld);
      const newPath = path.join(parentDir, newName);

      if (!this.isSafePath(newPath)) {
        return { success: false, error: 'Target path is restricted' };
      }

      // Check source exists
      const { stats } = await this.getFileStats(normalizedOld);
      if (!stats) {
        return { success: false, error: 'Source path does not exist' };
      }

      // Check target doesn't exist
      const { stats: targetStats } = await this.getFileStats(newPath);
      if (targetStats) {
        return { success: false, error: 'An item with that name already exists' };
      }

      await fs.rename(normalizedOld, newPath);

      return {
        success: true,
        data: {
          oldPath: normalizedOld,
          newPath,
          name: newName
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to rename',
        code: error.code
      };
    }
  }

  /**
   * Open directory in system's default file explorer
   * @param {string} dirPath - Directory path to open
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async openInExplorer(dirPath) {
    try {
      const normalizedPath = path.resolve(dirPath);

      // Security check
      if (!this.isSafePath(normalizedPath)) {
        return {
          success: false,
          error: 'Access to this path is restricted'
        };
      }

      // Check if path exists, create if it doesn't
      const { stats, error } = await this.getFileStats(normalizedPath);
      if (error || !stats) {
        // Try to create the directory
        try {
          await fs.mkdir(normalizedPath, { recursive: true });
        } catch (mkdirError) {
          return {
            success: false,
            error: `Directory does not exist and could not be created: ${mkdirError.message}`
          };
        }
      }

      // Determine the correct command based on platform
      const platform = os.platform();
      let command;

      if (platform === 'win32') {
        command = `explorer "${normalizedPath}"`;
      } else if (platform === 'darwin') {
        command = `open "${normalizedPath}"`;
      } else {
        // Linux and other Unix-like systems
        command = `xdg-open "${normalizedPath}"`;
      }

      return new Promise((resolve) => {
        exec(command, (error) => {
          if (error) {
            // On Windows, explorer returns exit code 1 even on success
            if (platform === 'win32') {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: error.message });
            }
          } else {
            resolve({ success: true });
          }
        });
      });

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open directory'
      };
    }
  }

  /**
   * Get quick access paths for common folders (OS-aware)
   * @returns {{success: boolean, data: {platform: string, paths: Object}}}
   */
  getQuickAccessPaths() {
    const home = os.homedir();
    const platform = os.platform();

    // Common folders that exist on all major platforms
    const paths = {
      home: {
        path: home,
        label: 'Home',
        icon: 'home'
      },
      desktop: {
        path: path.join(home, 'Desktop'),
        label: 'Desktop',
        icon: 'desktop'
      },
      documents: {
        path: path.join(home, 'Documents'),
        label: 'Documents',
        icon: 'document'
      },
      downloads: {
        path: path.join(home, 'Downloads'),
        label: 'Downloads',
        icon: 'download'
      }
    };

    // Add platform-specific paths
    if (platform === 'win32') {
      // Windows-specific drives
      paths.cDrive = {
        path: 'C:\\',
        label: 'C:',
        icon: 'drive'
      };
    } else if (platform === 'darwin') {
      // macOS-specific
      paths.applications = {
        path: '/Applications',
        label: 'Applications',
        icon: 'folder'
      };
    } else {
      // Linux - add root
      paths.root = {
        path: '/',
        label: 'Root',
        icon: 'drive'
      };
    }

    return {
      success: true,
      data: {
        platform,
        paths
      }
    };
  }

  /**
   * Health check
   * @returns {{success: boolean, data: {status: string, timestamp: string}}}
   */
  healthCheck() {
    return {
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        module: 'fileExplorer'
      }
    };
  }
}

export default FileExplorerController;