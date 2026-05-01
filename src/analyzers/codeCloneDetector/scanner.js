import { glob } from 'glob';
import fs from 'fs/promises';
import path from 'path';

/**
 * Scans project directory for source files (async, non-blocking)
 */
export class FileScanner {
  constructor(config) {
    this.config = config;
    this.batchSize = config.batchSize || 20; // Read files in parallel batches
  }

  /**
   * Find all files matching the configuration
   * @param {string} projectPath - Root directory to scan
   * @returns {Promise<Array>} Array of file objects with path and content
   */
  async scanProject(projectPath) {
    const files = [];
    const allFilePaths = [];

    // Find all matching files
    for (const pattern of this.config.include) {
      const matches = await glob(pattern, {
        cwd: projectPath,
        ignore: this.config.exclude,
        absolute: true,
        nodir: true
      });
      allFilePaths.push(...matches);
    }

    // Remove duplicates
    const uniqueFilePaths = [...new Set(allFilePaths)];
    console.log(`Found ${uniqueFilePaths.length} files to analyze`);

    // Process files in batches to avoid blocking and memory issues
    for (let i = 0; i < uniqueFilePaths.length; i += this.batchSize) {
      const batch = uniqueFilePaths.slice(i, i + this.batchSize);

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(filePath => this.readFile(filePath, projectPath))
      );

      // Filter out null results (skipped/failed files)
      files.push(...batchResults.filter(Boolean));

      // Yield to event loop between batches to prevent blocking
      await new Promise(resolve => setImmediate(resolve));
    }

    return files;
  }

  /**
   * Read a single file asynchronously
   * @param {string} filePath - Absolute path to file
   * @param {string} projectPath - Root project path for relative path calculation
   * @returns {Promise<Object|null>} File object or null if skipped/failed
   */
  async readFile(filePath, projectPath) {
    try {
      const stats = await fs.stat(filePath);

      // Skip files that are too large
      if (stats.size > this.config.maxFileSize) {
        console.warn(`Skipping large file: ${filePath}`);
        return null;
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const relativePath = path.relative(projectPath, filePath);

      return {
        path: relativePath,
        absolutePath: filePath,
        content,
        size: stats.size,
        extension: path.extname(filePath)
      };
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error.message);
      return null;
    }
  }
}
