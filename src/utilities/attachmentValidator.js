/**
 * Attachment Validator
 * Validates file attachments for security and size constraints
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { getSystemRestrictedPaths, getPlatformBlockedExtensions } from './platformUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const SIZE_LIMITS = {
  content: 1024 * 1024,      // 1MB for content mode
  reference: Number.MAX_VALUE // No limit for reference mode (just metadata)
};

const SIZE_WARNING_THRESHOLD = {
  yellow: 100 * 1024,  // 100KB
  red: 1024 * 1024     // 1MB
};

// Platform-specific blocked extensions (from platformUtils)
// Only blocks executables relevant to the current platform
const BLOCKED_EXTENSIONS = getPlatformBlockedExtensions();

const SUPPORTED_TEXT_EXTENSIONS = [
  '.txt', '.md', '.js', '.jsx', '.ts', '.tsx',
  '.json', '.xml', '.html', '.css', '.scss',
  '.py', '.java', '.cpp', '.c', '.h',
  '.go', '.rs', '.rb', '.php', '.sh',
  '.yml', '.yaml', '.toml', '.env',
  '.log', '.sql', '.vue', '.svelte'
];

const SUPPORTED_IMAGE_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif',
  '.webp', '.bmp', '.svg'
];

const SUPPORTED_PDF_EXTENSIONS = ['.pdf'];

class AttachmentValidator {
  constructor(config = {}, logger = null) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Validate file size
   * @param {number} size - File size in bytes
   * @param {string} mode - 'content' or 'reference'
   * @returns {Object} { valid: boolean, error?: string, warning?: string, level?: string }
   */
  validateSize(size, mode = 'content') {
    const limit = SIZE_LIMITS[mode];

    if (size > limit) {
      return {
        valid: false,
        error: `File size (${this.formatBytes(size)}) exceeds ${mode} mode limit (${this.formatBytes(limit)})`
      };
    }

    // Check warning thresholds
    if (mode === 'content') {
      if (size > SIZE_WARNING_THRESHOLD.red) {
        return {
          valid: true,
          warning: `This file is large (${this.formatBytes(size)}) and will consume significant tokens`,
          level: 'red'
        };
      } else if (size > SIZE_WARNING_THRESHOLD.yellow) {
        return {
          valid: true,
          warning: `This file is moderately large (${this.formatBytes(size)})`,
          level: 'yellow'
        };
      }
    }

    return { valid: true, level: 'green' };
  }

  /**
   * Validate file type (block executables)
   * @param {string} fileName - File name
   * @returns {Object} { valid: boolean, error?: string }
   */
  validateFileType(fileName) {
    const ext = path.extname(fileName).toLowerCase();

    if (this.isExecutable(fileName)) {
      return {
        valid: false,
        error: `Executable files (${ext}) are not allowed for security reasons`
      };
    }

    return { valid: true };
  }

  /**
   * Check if file is executable
   * @param {string} fileName - File name
   * @returns {boolean}
   */
  isExecutable(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return BLOCKED_EXTENSIONS.includes(ext);
  }

  /**
   * Validate file path (for reference mode)
   * Uses platform-aware system directory checks
   * @param {string} filePath - File path
   * @returns {Object} { valid: boolean, error?: string }
   */
  validatePath(filePath) {
    // Check for directory traversal attempts
    const normalizedPath = path.normalize(filePath);

    if (normalizedPath.includes('..')) {
      return {
        valid: false,
        error: 'Directory traversal is not allowed'
      };
    }

    // Platform-aware system directory check (case-insensitive on macOS/Windows)
    const restrictedPaths = getSystemRestrictedPaths();
    const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32';
    const checkPath = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;

    if (restrictedPaths.some(dir => {
      const checkDir = caseInsensitive ? dir.toLowerCase() : dir;
      return checkPath.startsWith(checkDir);
    })) {
      return {
        valid: false,
        error: 'Access to system directories is not allowed'
      };
    }

    return { valid: true };
  }

  /**
   * Get content type from file extension
   * @param {string} fileName - File name
   * @returns {string} - 'text' | 'image' | 'pdf' | 'binary'
   */
  getContentType(fileName) {
    const ext = path.extname(fileName).toLowerCase();

    if (SUPPORTED_TEXT_EXTENSIONS.includes(ext)) {
      return 'text';
    }
    if (SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
      return 'image';
    }
    if (SUPPORTED_PDF_EXTENSIONS.includes(ext)) {
      return 'pdf';
    }
    return 'binary';
  }

  /**
   * Check if file type is supported
   * @param {string} fileName - File name
   * @returns {boolean}
   */
  isSupported(fileName) {
    const contentType = this.getContentType(fileName);
    return contentType !== 'binary';
  }

  /**
   * Validate all aspects of an attachment
   * @param {Object} options
   * @param {string} options.fileName - File name
   * @param {number} options.size - File size in bytes
   * @param {string} options.mode - 'content' or 'reference'
   * @param {string} options.path - File path (for reference mode)
   * @returns {Object} { valid: boolean, errors: string[], warnings: string[], sizeLevel: string }
   */
  validate({ fileName, size, mode = 'content', path: filePath = null }) {
    const errors = [];
    const warnings = [];
    let sizeLevel = 'green';

    // Validate file type
    const typeValidation = this.validateFileType(fileName);
    if (!typeValidation.valid) {
      errors.push(typeValidation.error);
    }

    // Validate size
    const sizeValidation = this.validateSize(size, mode);
    if (!sizeValidation.valid) {
      errors.push(sizeValidation.error);
    } else if (sizeValidation.warning) {
      warnings.push(sizeValidation.warning);
      sizeLevel = sizeValidation.level;
    }

    // Validate path (reference mode only)
    if (mode === 'reference' && filePath) {
      const pathValidation = this.validatePath(filePath);
      if (!pathValidation.valid) {
        errors.push(pathValidation.error);
      }
    }

    // Check if file type is supported
    if (!this.isSupported(fileName)) {
      warnings.push(`File type may not be fully supported (${path.extname(fileName)})`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sizeLevel
    };
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes
   * @returns {string}
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get MIME type from file extension
   * @param {string} fileName - File name
   * @returns {string}
   */
  getMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
      // Text
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.jsx': 'text/javascript',
      '.ts': 'text/typescript',
      '.tsx': 'text/typescript',
      '.py': 'text/x-python',
      '.java': 'text/x-java',
      '.cpp': 'text/x-c++',
      '.c': 'text/x-c',
      '.yml': 'text/yaml',
      '.yaml': 'text/yaml',

      // Images
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',

      // PDF
      '.pdf': 'application/pdf',

      // Default
      'default': 'application/octet-stream'
    };

    return mimeTypes[ext] || mimeTypes['default'];
  }
}

export default AttachmentValidator;
