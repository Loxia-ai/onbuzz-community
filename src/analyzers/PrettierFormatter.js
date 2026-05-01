/**
 * PrettierFormatter - Code formatting using Prettier
 *
 * Purpose:
 * - Format code according to consistent style rules
 * - Support multiple languages (JS, TS, CSS, HTML, JSON, etc.)
 * - Detect and use project's Prettier configuration
 * - Provide before/after comparison
 */

import prettier from 'prettier';
import path from 'path';
import fs from 'fs/promises';

class PrettierFormatter {
  constructor(logger = null) {
    this.logger = logger;
    this.configCache = new Map();
  }

  /**
   * Format code with Prettier
   * @param {string} filePath - Path to file
   * @param {string} content - File content
   * @param {Object} options - Format options
   * @returns {Promise<Object>} Formatted content and changes
   */
  async format(filePath, content, options = {}) {
    try {
      // Get Prettier configuration
      const config = await this.getPrettierConfig(filePath, options.workingDir);

      // Determine parser from file extension
      const parser = this.getParser(filePath);

      // Format the code
      const formatted = await prettier.format(content, {
        ...config,
        filepath: filePath,
        parser
      });

      // Check if formatting made changes
      const hasChanges = formatted !== content;

      return {
        formatted: hasChanges,
        content: formatted,
        original: content,
        changes: hasChanges ? this.describeChanges(content, formatted) : [],
        linesChanged: hasChanges ? this.countChangedLines(content, formatted) : 0
      };

    } catch (error) {
      this.logger?.error('Prettier formatting failed', {
        file: filePath,
        error: error.message
      });

      throw new Error(`Prettier formatting failed: ${error.message}`);
    }
  }

  /**
   * Check if file needs formatting
   * @param {string} filePath - Path to file
   * @param {string} content - File content
   * @param {Object} options - Check options
   * @returns {Promise<boolean>} True if file needs formatting
   */
  async check(filePath, content, options = {}) {
    try {
      const config = await this.getPrettierConfig(filePath, options.workingDir);
      const parser = this.getParser(filePath);

      const formatted = await prettier.format(content, {
        ...config,
        filepath: filePath,
        parser
      });

      return formatted !== content;

    } catch (error) {
      this.logger?.warn('Prettier check failed', {
        file: filePath,
        error: error.message
      });

      return false;
    }
  }

  /**
   * Get Prettier configuration
   * @private
   */
  async getPrettierConfig(filePath, workingDir) {
    // Check cache
    const cacheKey = workingDir || path.dirname(filePath);
    if (this.configCache.has(cacheKey)) {
      return this.configCache.get(cacheKey);
    }

    let config = {};

    // Try to load project's Prettier config
    if (workingDir) {
      try {
        const projectConfig = await prettier.resolveConfig(filePath, {
          config: workingDir
        });

        if (projectConfig) {
          this.logger?.debug('Found Prettier config', { workingDir });
          config = projectConfig;
        }
      } catch (error) {
        this.logger?.debug('No Prettier config found, using defaults');
      }
    }

    // Default configuration
    const defaultConfig = {
      semi: true,
      singleQuote: true,
      tabWidth: 2,
      trailingComma: 'es5',
      printWidth: 100,
      arrowParens: 'avoid',
      endOfLine: 'lf',
      ...config
    };

    // Cache the configuration
    this.configCache.set(cacheKey, defaultConfig);

    return defaultConfig;
  }

  /**
   * Get parser for file type
   * @private
   */
  getParser(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    const parserMap = {
      '.js': 'babel',
      '.jsx': 'babel',
      '.mjs': 'babel',
      '.cjs': 'babel',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.json': 'json',
      '.json5': 'json5',
      '.css': 'css',
      '.scss': 'scss',
      '.less': 'less',
      '.html': 'html',
      '.vue': 'vue',
      '.md': 'markdown',
      '.yaml': 'yaml',
      '.yml': 'yaml'
    };

    return parserMap[ext] || 'babel';
  }

  /**
   * Describe changes made by formatting
   * @private
   */
  describeChanges(original, formatted) {
    const changes = [];
    const originalLines = original.split('\n');
    const formattedLines = formatted.split('\n');

    const maxLines = Math.max(originalLines.length, formattedLines.length);

    for (let i = 0; i < maxLines; i++) {
      const origLine = originalLines[i];
      const formattedLine = formattedLines[i];

      if (origLine !== formattedLine) {
        changes.push({
          line: i + 1,
          type: origLine !== undefined && formattedLine !== undefined
            ? 'modified'
            : (origLine !== undefined ? 'removed' : 'added'),
          original: origLine || '',
          formatted: formattedLine || ''
        });
      }
    }

    return changes;
  }

  /**
   * Count changed lines
   * @private
   */
  countChangedLines(original, formatted) {
    const originalLines = original.split('\n');
    const formattedLines = formatted.split('\n');
    let changedCount = 0;

    const maxLines = Math.max(originalLines.length, formattedLines.length);

    for (let i = 0; i < maxLines; i++) {
      if (originalLines[i] !== formattedLines[i]) {
        changedCount++;
      }
    }

    return changedCount;
  }

  /**
   * Get supported file extensions
   * @returns {Array<string>} Array of supported extensions
   */
  getSupportedExtensions() {
    return [
      '.js', '.jsx', '.mjs', '.cjs',
      '.ts', '.tsx',
      '.json', '.json5',
      '.css', '.scss', '.less',
      '.html', '.vue',
      '.md',
      '.yaml', '.yml'
    ];
  }

  /**
   * Check if file type is supported
   * @param {string} filePath - Path to file
   * @returns {boolean} True if supported
   */
  isSupported(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.getSupportedExtensions().includes(ext);
  }
}

export default PrettierFormatter;
