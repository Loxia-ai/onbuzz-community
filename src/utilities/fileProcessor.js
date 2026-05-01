/**
 * File Processor
 * Handles file reading, conversion, and processing operations
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// PDF support disabled due to DOM API requirements in Node.js environment
// The pdf-parse library requires browser DOM APIs (DOMMatrix, ImageData, Path2D)
// which are not available in Node.js. PDF text extraction can be re-enabled
// by installing canvas-based polyfills or using an alternative PDF library.

class FileProcessor {
  constructor(config = {}, logger = null) {
    this.config = config;
    this.logger = logger;
    this.pdfSupported = false; // Disabled - requires DOM APIs
  }

  /**
   * Read file content
   * @param {string} filePath - Path to file
   * @param {string} encoding - File encoding (default: 'utf8')
   * @returns {Promise<string|Buffer>}
   */
  async readFile(filePath, encoding = 'utf8') {
    try {
      const content = await fs.readFile(filePath, encoding);
      return content;
    } catch (error) {
      this.logger?.error('Error reading file', { filePath, error: error.message });
      throw new Error(`Failed to read file: ${error.message}`);
    }
  }

  /**
   * Convert image to base64
   * @param {string} filePath - Path to image file
   * @returns {Promise<string>} Base64 encoded string with data URI
   */
  async imageToBase64(filePath) {
    try {
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();

      // Determine MIME type
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml'
      };

      const mimeType = mimeTypes[ext] || 'image/jpeg';
      const base64 = buffer.toString('base64');

      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      this.logger?.error('Error converting image to base64', { filePath, error: error.message });
      throw new Error(`Failed to convert image: ${error.message}`);
    }
  }

  /**
   * Extract text from PDF
   * @param {string} filePath - Path to PDF file
   * @returns {Promise<Object>} { text: string, numPages: number }
   */
  async extractPdfText(filePath) {
    if (!this.pdfSupported) {
      throw new Error('PDF text extraction is not supported - pdf-parse library not available');
    }

    try {
      const dataBuffer = await fs.readFile(filePath);
      const data = await pdfParse(dataBuffer);

      return {
        text: data.text,
        numPages: data.numpages,
        info: data.info || {},
        metadata: data.metadata || {}
      };
    } catch (error) {
      this.logger?.error('Error extracting PDF text', { filePath, error: error.message });
      throw new Error(`Failed to extract PDF text: ${error.message}`);
    }
  }

  /**
   * Calculate file hash (SHA-256)
   * @param {string} filePath - Path to file
   * @returns {Promise<string>} Hash as hex string
   */
  async calculateHash(filePath) {
    try {
      const buffer = await fs.readFile(filePath);
      const hash = crypto.createHash('sha256');
      hash.update(buffer);
      return hash.digest('hex');
    } catch (error) {
      this.logger?.error('Error calculating file hash', { filePath, error: error.message });
      throw new Error(`Failed to calculate hash: ${error.message}`);
    }
  }

  /**
   * Get file stats
   * @param {string} filePath - Path to file
   * @returns {Promise<Object>} File stats
   */
  async getFileStats(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory()
      };
    } catch (error) {
      this.logger?.error('Error getting file stats', { filePath, error: error.message });
      throw new Error(`Failed to get file stats: ${error.message}`);
    }
  }

  /**
   * Check if file exists
   * @param {string} filePath - Path to file
   * @returns {Promise<boolean>}
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Process file based on content type
   * @param {string} filePath - Path to file
   * @param {string} contentType - 'text' | 'image' | 'pdf'
   * @returns {Promise<Object>} { content: string, metadata: Object }
   */
  async processFile(filePath, contentType) {
    const metadata = {};

    try {
      switch (contentType) {
        case 'text': {
          const content = await this.readFile(filePath, 'utf8');
          metadata.lines = content.split('\n').length;
          metadata.characters = content.length;
          return { content, metadata };
        }

        case 'image': {
          const content = await this.imageToBase64(filePath);
          const stats = await this.getFileStats(filePath);
          metadata.size = stats.size;
          return { content, metadata };
        }

        case 'pdf': {
          const pdfData = await this.extractPdfText(filePath);
          metadata.numPages = pdfData.numPages;
          metadata.info = pdfData.info;
          return { content: pdfData.text, metadata };
        }

        default:
          throw new Error(`Unsupported content type: ${contentType}`);
      }
    } catch (error) {
      this.logger?.error('Error processing file', { filePath, contentType, error: error.message });
      throw error;
    }
  }

  /**
   * Estimate token count for text
   * @param {string} text - Text content
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    // Rough estimate: 1 token ≈ 4 characters for text
    // For base64 images: 1 token ≈ 1.5 characters (overhead)

    if (!text) return 0;

    // Check if it's a base64 data URI
    if (text.startsWith('data:image')) {
      // Extract base64 part and estimate
      const base64Part = text.split(',')[1] || '';
      return Math.ceil(base64Part.length / 1.5);
    }

    // Regular text
    return Math.ceil(text.length / 4);
  }

  /**
   * Write content to file
   * @param {string} filePath - Path to file
   * @param {string|Buffer} content - Content to write
   * @param {string} encoding - Encoding (default: 'utf8')
   * @returns {Promise<void>}
   */
  async writeFile(filePath, content, encoding = 'utf8') {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, content, encoding);
    } catch (error) {
      this.logger?.error('Error writing file', { filePath, error: error.message });
      throw new Error(`Failed to write file: ${error.message}`);
    }
  }

  /**
   * Delete file
   * @param {string} filePath - Path to file
   * @returns {Promise<void>}
   */
  async deleteFile(filePath) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      this.logger?.error('Error deleting file', { filePath, error: error.message });
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  /**
   * Copy file
   * @param {string} sourcePath - Source file path
   * @param {string} destPath - Destination file path
   * @returns {Promise<void>}
   */
  async copyFile(sourcePath, destPath) {
    try {
      // Ensure destination directory exists
      const dir = path.dirname(destPath);
      await fs.mkdir(dir, { recursive: true });

      await fs.copyFile(sourcePath, destPath);
    } catch (error) {
      this.logger?.error('Error copying file', { sourcePath, destPath, error: error.message });
      throw new Error(`Failed to copy file: ${error.message}`);
    }
  }

  /**
   * Create directory
   * @param {string} dirPath - Directory path
   * @returns {Promise<void>}
   */
  async createDirectory(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      this.logger?.error('Error creating directory', { dirPath, error: error.message });
      throw new Error(`Failed to create directory: ${error.message}`);
    }
  }

  /**
   * Delete directory recursively
   * @param {string} dirPath - Directory path
   * @returns {Promise<void>}
   */
  async deleteDirectory(dirPath) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      this.logger?.error('Error deleting directory', { dirPath, error: error.message });
      throw new Error(`Failed to delete directory: ${error.message}`);
    }
  }

  /**
   * List files in directory
   * @param {string} dirPath - Directory path
   * @returns {Promise<string[]>} Array of file names
   */
  async listFiles(dirPath) {
    try {
      const files = await fs.readdir(dirPath);
      return files;
    } catch (error) {
      this.logger?.error('Error listing files', { dirPath, error: error.message });
      throw new Error(`Failed to list files: ${error.message}`);
    }
  }
}

export default FileProcessor;
