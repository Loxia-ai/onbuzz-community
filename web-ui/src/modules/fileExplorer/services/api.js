/**
 * File Explorer API Service
 * Handles all API communication for file system operations
 */

import { API_ENDPOINTS } from '../types/index.js';

class FileExplorerApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'FileExplorerApiError';
    this.status = status;
  }
}

class FileExplorerApi {
  constructor() {
    this.baseUrl = window.location.origin; // Derives from current host — works locally and remotely
  }

  /**
   * Make API request with error handling
   * @param {string} endpoint 
   * @param {RequestInit} options 
   * @returns {Promise<any>}
   */
  async request(endpoint, options = {}) {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      });

      if (!response.ok) {
        throw new FileExplorerApiError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status
        );
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new FileExplorerApiError(
          data.error || 'API request failed',
          response.status
        );
      }

      return data;
    } catch (error) {
      if (error instanceof FileExplorerApiError) {
        throw error;
      }
      throw new FileExplorerApiError(`Network error: ${error.message}`);
    }
  }

  /**
   * Get current working directory
   * @returns {Promise<{cwd: string, platform: string, homedir: string}>}
   */
  async getCurrentWorkingDirectory() {
    const response = await this.request(API_ENDPOINTS.CWD);
    return response.data;
  }

  /**
   * Browse directory contents
   * @param {string} [path] - Directory path to browse
   * @param {Object} [options] - Browse options
   * @returns {Promise<BrowseResponse>}
   */
  async browseDirectory(path, options = {}) {
    const params = new URLSearchParams();
    if (path) params.append('path', path);
    if (options.showHidden) params.append('showHidden', 'true');

    const endpoint = `${API_ENDPOINTS.BROWSE}?${params.toString()}`;
    const response = await this.request(endpoint);
    return response.data;
  }

  /**
   * Get file information
   * @param {string} path - File path
   * @returns {Promise<FileItem>}
   */
  async getFileInfo(path) {
    const params = new URLSearchParams({ path });
    const endpoint = `${API_ENDPOINTS.FILE_INFO}?${params.toString()}`;
    const response = await this.request(endpoint);
    return response.data;
  }

  /**
   * Create directory
   * @param {string} path - Directory path to create
   * @param {boolean} [recursive] - Create parent directories if needed
   * @returns {Promise<{path: string, relativePath: string}>}
   */
  async createDirectory(path, recursive = false) {
    const response = await this.request(API_ENDPOINTS.MKDIR, {
      method: 'POST',
      body: JSON.stringify({ path, recursive })
    });
    return response.data;
  }

  /**
   * Rename a file or directory
   * @param {string} oldPath - Current full path
   * @param {string} newName - New name (just the filename/dirname, not full path)
   * @returns {Promise<{oldPath: string, newPath: string, name: string}>}
   */
  async renameItem(oldPath, newName) {
    const response = await this.request(API_ENDPOINTS.RENAME, {
      method: 'POST',
      body: JSON.stringify({ oldPath, newName })
    });
    return response.data;
  }

  /**
   * Health check
   * @returns {Promise<{status: string, timestamp: string, module: string}>}
   */
  async healthCheck() {
    const response = await this.request(API_ENDPOINTS.HEALTH);
    return response.data;
  }

  /**
   * Get quick access paths (OS-aware common folders)
   * @returns {Promise<{platform: string, paths: Object}>}
   */
  async getQuickAccessPaths() {
    const response = await this.request(API_ENDPOINTS.QUICK_ACCESS);
    return response.data;
  }
}

// Export singleton instance
export const fileExplorerApi = new FileExplorerApi();
export default fileExplorerApi;