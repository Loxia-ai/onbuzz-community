/**
 * SeekTool - Search for content within project files
 *
 * Purpose:
 * - Search for specific content/patterns within files
 * - Support glob patterns for file paths
 * - Verify imports, function usage, and variable references
 * - Provide detailed match information with line numbers
 */

import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';
import { promises as fs } from 'fs';
import path from 'path';

// Configuration constants
const SEEK_CONFIG = {
  // File size limits
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB - don't search files larger than this

  // Search limits
  MAX_FILES_PER_SEARCH: 1000, // Maximum files to search in one operation
  MAX_MATCHES_PER_FILE: 100, // Maximum matches to return per file
  MAX_TOTAL_MATCHES: 500, // Maximum total matches to return

  // Performance limits
  MAX_SEARCH_TERMS: 50, // Maximum number of search terms
  MAX_FILE_PATHS: 100, // Maximum number of file path patterns

  // Recursion limits
  MAX_DIRECTORY_DEPTH: 20, // Maximum directory recursion depth

  // Result formatting
  MAX_LINE_CONTENT_LENGTH: 200, // Maximum line content to show in results
  CONTEXT_LINES_BEFORE: 0, // Lines of context before match
  CONTEXT_LINES_AFTER: 0, // Lines of context after match
};

// File encoding
const FILE_ENCODING = 'utf-8';

// Common binary file extensions to skip
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv',
  '.woff', '.woff2', '.ttf', '.eot',
  '.bin', '.dat', '.db', '.sqlite'
]);

class SeekTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    // Tool metadata
    this.requiresProject = true; // Requires project directory
    this.isAsync = true; // File operations are async
    this.timeout = config.timeout || 120000; // 2 minutes default

    // Merge config with defaults
    this.seekConfig = {
      ...SEEK_CONFIG,
      ...config.seekConfig
    };
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
Seek Tool: Search for specific content within project files. Ideal for verifying imports, function usage, and variable references.

USAGE:
\`\`\`json
{
  "toolId": "seek",
  "filePaths": ["src/**/*.js", "package.json"],
  "searchTerms": ["import React", "useState"]
}
\`\`\`

PARAMETERS:
- filePaths: Array of file paths or glob patterns
- searchTerms: Array of search strings (case-sensitive, exact match)

GLOB PATTERNS:
- *.js         - All .js files in directory
- **/*.js      - All .js files recursively
- src/**/*.jsx - All .jsx files under src/

EXAMPLES:

Find function usage:
\`\`\`json
{
  "toolId": "seek",
  "filePaths": ["src/components/*.js", "src/utils/helpers.js"],
  "searchTerms": ["function handleSubmit", "useState("]
}
\`\`\`

Verify imports:
\`\`\`json
{
  "toolId": "seek",
  "filePaths": ["src/components/Header.js"],
  "searchTerms": ["import React", "from 'react'"]
}
\`\`\`

Search all JS files:
\`\`\`json
{
  "toolId": "seek",
  "filePaths": ["src/**/*.js"],
  "searchTerms": ["apiClient", "config.apiUrl"]
}
\`\`\`

TIP: After finding matches, use code-map read-range to view surrounding context without reading entire files.

LIMITS:
- Max ${SEEK_CONFIG.MAX_FILES_PER_SEARCH} files per search
- Max ${SEEK_CONFIG.MAX_SEARCH_TERMS} search terms
- Max ${SEEK_CONFIG.MAX_FILE_SIZE / (1024 * 1024)}MB per file
- Max ${SEEK_CONFIG.MAX_TOTAL_MATCHES} matches total
    `;
  }

  /**
   * Parse parameters from tool command content
   * @param {string} content - Raw tool command content
   * @returns {Object} Parsed parameters
   */
  parseParameters(content) {
    try {
      // Try JSON first
      if (content.trim().startsWith('{')) {
        const parsed = JSON.parse(content);

        return {
          filePaths: parsed.filePaths || [],
          searchTerms: parsed.searchTerms || []
        };
      }

      // XML parsing
      const params = {
        filePaths: [],
        searchTerms: []
      };

      // Extract in-files content
      const inFilesPattern = /<in-files>([\s\S]*?)<\/in-files>/i;
      const inFilesMatch = inFilesPattern.exec(content);

      if (inFilesMatch) {
        const filesContent = inFilesMatch[1];
        params.filePaths = filesContent
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0);
      }

      // Extract search-terms content
      const searchTermsPattern = /<search-terms>([\s\S]*?)<\/search-terms>/i;
      const searchTermsMatch = searchTermsPattern.exec(content);

      if (searchTermsMatch) {
        const termsContent = searchTermsMatch[1];

        // Extract individual <term> tags
        const termPattern = /<term>(.*?)<\/term>/gi;
        let termMatch;

        while ((termMatch = termPattern.exec(termsContent)) !== null) {
          const term = termMatch[1].trim();
          if (term.length > 0) {
            params.searchTerms.push(term);
          }
        }
      }

      return params;

    } catch (error) {
      this.logger?.error('Failed to parse seek parameters', { error: error.message });
      return {
        filePaths: [],
        searchTerms: [],
        parseError: error.message
      };
    }
  }

  /**
   * Get required parameters
   * @returns {Array<string>} Array of required parameter names
   */
  getRequiredParameters() {
    return ['filePaths', 'searchTerms'];
  }

  /**
   * Custom parameter validation
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result
   */
  customValidateParameters(params) {
    const errors = [];

    // Validate filePaths
    if (!params.filePaths || !Array.isArray(params.filePaths) || params.filePaths.length === 0) {
      errors.push('At least one file path is required');
    } else if (params.filePaths.length > this.seekConfig.MAX_FILE_PATHS) {
      errors.push(`Too many file paths (max ${this.seekConfig.MAX_FILE_PATHS})`);
    }

    // Validate searchTerms
    if (!params.searchTerms || !Array.isArray(params.searchTerms) || params.searchTerms.length === 0) {
      errors.push('At least one search term is required');
    } else if (params.searchTerms.length > this.seekConfig.MAX_SEARCH_TERMS) {
      errors.push(`Too many search terms (max ${this.seekConfig.MAX_SEARCH_TERMS})`);
    }

    // Validate search terms are non-empty strings
    if (params.searchTerms && Array.isArray(params.searchTerms)) {
      for (const [index, term] of params.searchTerms.entries()) {
        if (typeof term !== 'string' || term.trim().length === 0) {
          errors.push(`Search term ${index + 1}: must be a non-empty string`);
        }
      }
    }

    // Validate file paths are non-empty strings
    if (params.filePaths && Array.isArray(params.filePaths)) {
      for (const [index, filePath] of params.filePaths.entries()) {
        if (typeof filePath !== 'string' || filePath.trim().length === 0) {
          errors.push(`File path ${index + 1}: must be a non-empty string`);
        }

        // Check for path traversal attempts
        if (filePath.includes('..')) {
          errors.push(`File path ${index + 1}: path traversal (..) not allowed for security`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Execute tool with parsed parameters
   * @param {Object} params - Parsed parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(params, context) {
    const { filePaths, searchTerms } = params;
    const { projectDir, agentId, directoryAccess } = context;

    // IMPORTANT: Get all accessible directories for the agent
    // This includes workingDirectory, readOnlyDirectories, and writeEnabledDirectories
    let workingDirectory = projectDir || process.cwd();
    let accessibleDirectories = [workingDirectory];

    if (directoryAccess && directoryAccess.workingDirectory) {
      workingDirectory = directoryAccess.workingDirectory;

      // Collect all accessible directories (for read operations)
      accessibleDirectories = this.getAllAccessibleDirectories(directoryAccess);

      this.logger?.info('Using agent configured directory access', {
        workingDirectory: directoryAccess.workingDirectory,
        totalAccessibleDirs: accessibleDirectories.length,
        readOnlyDirs: directoryAccess.readOnlyDirectories?.length || 0,
        writeEnabledDirs: directoryAccess.writeEnabledDirectories?.length || 0,
        agentId
      });
    }

    if (!workingDirectory) {
      throw new Error('Project directory is required for seek tool');
    }

    this.logger?.info('Executing seek tool', {
      filePathCount: filePaths.length,
      searchTermCount: searchTerms.length,
      workingDirectory,
      accessibleDirectories: accessibleDirectories.length,
      agentId
    });

    try {
      // Resolve file paths (expand globs)
      // Pass accessible directories for validation (if agent has directoryAccess configured)
      const resolveResult = await this.resolveFilePaths(
        filePaths,
        workingDirectory,
        directoryAccess ? accessibleDirectories : null
      );

      const resolvedFiles = resolveResult.found;
      const notFoundFiles = resolveResult.notFound;

      // Check file count limit
      if (resolvedFiles.length > this.seekConfig.MAX_FILES_PER_SEARCH) {
        return {
          success: false,
          error: `Too many files to search (${resolvedFiles.length}). Maximum is ${this.seekConfig.MAX_FILES_PER_SEARCH}. Use more specific file patterns.`,
          filesResolved: resolvedFiles.length,
          filesNotFound: notFoundFiles.length
        };
      }

      // Search in files
      const searchResult = await this.searchFiles(resolvedFiles, searchTerms, workingDirectory);

      // Format results
      const formattedResults = this.formatResults(
        searchResult.matches,
        searchResult.errorFiles,
        notFoundFiles,
        resolvedFiles.length
      );

      return {
        success: true,
        filesSearched: resolvedFiles.length,
        filesNotFound: notFoundFiles.length,
        filesWithErrors: searchResult.errorFiles.length,
        totalMatches: searchResult.matches.length,
        matchesByTerm: searchResult.matchesByTerm,
        formattedResults,
        toolUsed: 'seek',
        guidance: searchResult.matches.length > 0
          ? 'To view code context around matches, use code-map read-range with the file path and line numbers from above. Example: {"toolId":"code-map","parameters":{"action":"read-range","filePath":"<matched-file>","startLine":<line-5>,"endLine":<line+25>}}'
          : undefined
      };

    } catch (error) {
      this.logger?.error('Seek tool execution failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Get all accessible directories for read operations
   * @param {Object} directoryAccess - Directory access configuration
   * @returns {Array<string>} Array of accessible directory paths
   * @private
   */
  getAllAccessibleDirectories(directoryAccess) {
    const directories = new Set();

    // Add working directory
    if (directoryAccess.workingDirectory) {
      directories.add(directoryAccess.workingDirectory);
    }

    // Add read-only directories
    if (directoryAccess.readOnlyDirectories && Array.isArray(directoryAccess.readOnlyDirectories)) {
      for (const dir of directoryAccess.readOnlyDirectories) {
        directories.add(dir);
      }
    }

    // Add write-enabled directories (if you can write, you can read)
    if (directoryAccess.writeEnabledDirectories && Array.isArray(directoryAccess.writeEnabledDirectories)) {
      for (const dir of directoryAccess.writeEnabledDirectories) {
        directories.add(dir);
      }
    }

    return Array.from(directories);
  }

  /**
   * Check if a path is within any accessible directory
   * @param {string} targetPath - Path to check
   * @param {Array<string>} accessibleDirs - Array of accessible directories
   * @returns {boolean} True if path is accessible
   * @private
   */
  isPathAccessible(targetPath, accessibleDirs) {
    for (const dir of accessibleDirs) {
      const relative = path.relative(dir, targetPath);
      const isWithin = !relative.startsWith('..') && !path.isAbsolute(relative);
      if (isWithin) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolve file paths, expanding glob patterns
   * @param {Array<string>} filePaths - File paths with possible glob patterns
   * @param {string} projectDir - Project directory
   * @param {Array<string>} accessibleDirs - Optional array of accessible directories
   * @returns {Promise<Object>} Object with found and notFound arrays
   * @private
   */
  async resolveFilePaths(filePaths, projectDir, accessibleDirs = null) {
    const result = {
      found: [],
      notFound: []
    };

    for (const filePath of filePaths) {
      const normalizedPath = filePath.trim();

      if (normalizedPath.includes('*')) {
        // Handle glob patterns
        const globResult = await this.expandGlobPattern(normalizedPath, projectDir);

        if (globResult.found.length > 0) {
          result.found.push(...globResult.found);
        } else {
          result.notFound.push(`${normalizedPath} (no matching files)`);
        }
      } else {
        // Handle direct file reference
        const absolutePath = path.isAbsolute(normalizedPath)
          ? normalizedPath
          : path.resolve(projectDir, normalizedPath);

        // Check if path is within accessible directories (if configured)
        if (accessibleDirs && accessibleDirs.length > 0) {
          if (!this.isPathAccessible(absolutePath, accessibleDirs)) {
            result.notFound.push(`${normalizedPath} (not in accessible directories)`);
            continue;
          }
        }

        try {
          const stats = await fs.stat(absolutePath);

          if (stats.isFile()) {
            result.found.push(absolutePath);
          } else if (stats.isDirectory()) {
            result.notFound.push(`${normalizedPath} (is a directory, not a file)`);
          } else {
            result.notFound.push(`${normalizedPath} (not a regular file)`);
          }
        } catch (error) {
          result.notFound.push(`${normalizedPath} (${error.code || error.message})`);
        }
      }
    }

    return result;
  }

  /**
   * Expand glob pattern to matching file paths
   * @param {string} pattern - Glob pattern
   * @param {string} projectDir - Project directory
   * @returns {Promise<Object>} Object with found files
   * @private
   */
  async expandGlobPattern(pattern, projectDir) {
    const result = { found: [] };

    // Handle recursive pattern: src/**/*.js
    if (pattern.includes('**/')) {
      const [baseDir, filePattern] = pattern.split('**/');
      const basePath = path.resolve(projectDir, baseDir);

      try {
        const stats = await fs.stat(basePath);

        if (stats.isDirectory()) {
          await this.findFilesRecursively(
            basePath,
            filePattern,
            result.found,
            0,
            this.seekConfig.MAX_DIRECTORY_DEPTH
          );
        }
      } catch (error) {
        // Directory doesn't exist
        this.logger?.warn('Base directory not found for glob pattern', { basePath, error: error.message });
      }
    }
    // Handle simple pattern: src/*.js
    else if (pattern.includes('*')) {
      const dirPath = path.dirname(path.resolve(projectDir, pattern));
      const filePattern = path.basename(pattern);

      try {
        const stats = await fs.stat(dirPath);

        if (stats.isDirectory()) {
          const files = await fs.readdir(dirPath);

          for (const file of files) {
            const filePath = path.join(dirPath, file);

            try {
              const fileStats = await fs.stat(filePath);

              if (fileStats.isFile() && this.matchesPattern(file, filePattern)) {
                result.found.push(filePath);
              }
            } catch (error) {
              // Skip files we can't stat
              continue;
            }
          }
        }
      } catch (error) {
        // Directory doesn't exist
        this.logger?.warn('Directory not found for glob pattern', { dirPath, error: error.message });
      }
    }

    return result;
  }

  /**
   * Find files recursively matching a pattern
   * @param {string} dir - Directory to search
   * @param {string} filePattern - File pattern to match
   * @param {Array<string>} results - Results array
   * @param {number} currentDepth - Current recursion depth
   * @param {number} maxDepth - Maximum recursion depth
   * @returns {Promise<void>}
   * @private
   */
  async findFilesRecursively(dir, filePattern, results, currentDepth, maxDepth) {
    // Prevent infinite recursion
    if (currentDepth >= maxDepth) {
      this.logger?.warn('Maximum directory depth reached', { dir, currentDepth });
      return;
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden files and directories
        if (entry.name.startsWith('.')) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);

        try {
          if (entry.isDirectory()) {
            // Skip common large directories
            if (this.shouldSkipDirectory(entry.name)) {
              continue;
            }

            await this.findFilesRecursively(
              fullPath,
              filePattern,
              results,
              currentDepth + 1,
              maxDepth
            );
          } else if (entry.isFile()) {
            if (this.matchesPattern(entry.name, filePattern)) {
              results.push(fullPath);

              // Stop if we've found too many files
              if (results.length >= this.seekConfig.MAX_FILES_PER_SEARCH) {
                return;
              }
            }
          }
        } catch (error) {
          // Skip entries we can't access
          continue;
        }
      }
    } catch (error) {
      this.logger?.warn('Error reading directory', { dir, error: error.message });
    }
  }

  /**
   * Check if filename matches a wildcard pattern
   * @param {string} filename - Filename to check
   * @param {string} pattern - Wildcard pattern
   * @returns {boolean} True if matches
   * @private
   */
  matchesPattern(filename, pattern) {
    // Simple wildcard matching
    const regexPattern = pattern
      .split('*')
      .map(part => this.escapeRegExp(part))
      .join('.*');

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(filename);
  }

  /**
   * Escape special regex characters
   * @param {string} string - String to escape
   * @returns {string} Escaped string
   * @private
   */
  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Check if directory should be skipped during recursive search
   * @param {string} dirName - Directory name
   * @returns {boolean} True if should skip
   * @private
   */
  shouldSkipDirectory(dirName) {
    const skipDirs = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      'coverage',
      '.next',
      '.nuxt',
      'out',
      'target',
      'vendor',
      '__pycache__',
      '.cache',
      'tmp',
      'temp'
    ]);

    return skipDirs.has(dirName.toLowerCase());
  }

  /**
   * Check if file should be skipped (binary files)
   * @param {string} filePath - File path
   * @returns {boolean} True if should skip
   * @private
   */
  shouldSkipFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
  }

  /**
   * Search for terms in multiple files
   * @param {Array<string>} filePaths - File paths to search
   * @param {Array<string>} searchTerms - Search terms
   * @param {string} projectDir - Project directory for relative paths
   * @returns {Promise<Object>} Search results
   * @private
   */
  async searchFiles(filePaths, searchTerms, projectDir) {
    const allMatches = [];
    const errorFiles = [];
    let totalMatches = 0;

    for (const filePath of filePaths) {
      // Skip binary files
      if (this.shouldSkipFile(filePath)) {
        continue;
      }

      try {
        // Check file size
        const stats = await fs.stat(filePath);

        if (stats.size > this.seekConfig.MAX_FILE_SIZE) {
          errorFiles.push({
            filePath: path.relative(projectDir, filePath),
            error: `File too large (${Math.round(stats.size / (1024 * 1024))}MB, max ${Math.round(this.seekConfig.MAX_FILE_SIZE / (1024 * 1024))}MB)`
          });
          continue;
        }

        // Search in file
        const matches = await this.searchInFile(filePath, searchTerms, projectDir);

        allMatches.push(...matches);
        totalMatches += matches.length;

        // Stop if we've exceeded max total matches
        if (totalMatches >= this.seekConfig.MAX_TOTAL_MATCHES) {
          this.logger?.warn('Maximum total matches reached', { totalMatches });
          break;
        }

      } catch (error) {
        errorFiles.push({
          filePath: path.relative(projectDir, filePath),
          error: error.message
        });
      }
    }

    // Group matches by search term
    const matchesByTerm = {};

    for (const match of allMatches) {
      if (!matchesByTerm[match.term]) {
        matchesByTerm[match.term] = [];
      }

      matchesByTerm[match.term].push({
        filePath: match.filePath,
        lineNumber: match.lineNumber,
        lineContent: match.lineContent
      });
    }

    return {
      matches: allMatches,
      matchesByTerm,
      errorFiles
    };
  }

  /**
   * Search for terms in a single file
   * @param {string} filePath - File path
   * @param {Array<string>} searchTerms - Search terms
   * @param {string} projectDir - Project directory for relative paths
   * @returns {Promise<Array<Object>>} Matches found
   * @private
   */
  async searchInFile(filePath, searchTerms, projectDir) {
    const matches = [];
    let matchesInFile = 0;

    try {
      // Read file content
      const content = await fs.readFile(filePath, FILE_ENCODING);

      // Split into lines
      const lines = content.split('\n');
      const relativePath = path.relative(projectDir, filePath);

      // Search each line
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const lineNumber = lineIndex + 1; // 1-based line numbers

        // Check each search term
        for (const term of searchTerms) {
          if (line.includes(term)) {
            // Truncate line content if too long
            let lineContent = line;
            if (lineContent.length > this.seekConfig.MAX_LINE_CONTENT_LENGTH) {
              const termIndex = lineContent.indexOf(term);
              const start = Math.max(0, termIndex - 50);
              const end = Math.min(lineContent.length, termIndex + term.length + 50);
              lineContent = (start > 0 ? '...' : '') +
                           lineContent.substring(start, end) +
                           (end < lineContent.length ? '...' : '');
            }

            matches.push({
              term,
              filePath: relativePath,
              lineNumber,
              lineContent: lineContent.trim()
            });

            matchesInFile++;

            // Limit matches per file
            if (matchesInFile >= this.seekConfig.MAX_MATCHES_PER_FILE) {
              this.logger?.warn('Maximum matches per file reached', { filePath: relativePath });
              return matches;
            }
          }
        }
      }

    } catch (error) {
      throw new Error(`Failed to read file: ${error.message}`);
    }

    return matches;
  }

  /**
   * Format search results for display
   * @param {Array<Object>} matches - Search matches
   * @param {Array<Object>} errorFiles - Files with errors
   * @param {Array<string>} notFoundFiles - Files not found
   * @param {number} filesSearched - Number of files searched
   * @returns {string} Formatted results
   * @private
   */
  formatResults(matches, errorFiles, notFoundFiles, filesSearched) {
    let output = '';

    // Report files not found
    if (notFoundFiles.length > 0) {
      output += 'FILES NOT FOUND:\n';
      for (const file of notFoundFiles) {
        output += `  - ${file}\n`;
      }
      output += '\n';
    }

    // Report files with errors
    if (errorFiles.length > 0) {
      output += 'FILES WITH ERRORS:\n';
      for (const file of errorFiles) {
        output += `  - ${file.filePath}: ${file.error}\n`;
      }
      output += '\n';
    }

    // Report search results
    if (matches.length === 0) {
      output += `No matches found for the specified search terms in ${filesSearched} file(s).\n`;
    } else {
      // Group by term
      const matchesByTerm = {};
      for (const match of matches) {
        if (!matchesByTerm[match.term]) {
          matchesByTerm[match.term] = [];
        }
        matchesByTerm[match.term].push(match);
      }

      output += `SEARCH RESULTS (${matches.length} total matches in ${filesSearched} file(s)):\n\n`;

      for (const [term, termMatches] of Object.entries(matchesByTerm)) {
        output += `Search term: "${term}" (${termMatches.length} matches)\n`;

        for (const match of termMatches) {
          output += `  ${match.filePath}:${match.lineNumber} - ${match.lineContent}\n`;
        }

        output += '\n';
      }

      // Add warning if max matches reached
      if (matches.length >= this.seekConfig.MAX_TOTAL_MATCHES) {
        output += `⚠️  Maximum matches limit reached (${this.seekConfig.MAX_TOTAL_MATCHES}). Some matches may not be shown.\n`;
      }
    }

    return output.trim();
  }

  /**
   * Get supported file extensions
   * @returns {Array<string>} Array of supported extensions
   */
  getSupportedExtensions() {
    return [
      '.js', '.jsx', '.ts', '.tsx',
      '.json', '.xml', '.html', '.css', '.scss', '.sass', '.less',
      '.md', '.txt', '.log',
      '.py', '.rb', '.java', '.go', '.rs',
      '.c', '.cpp', '.h', '.hpp',
      '.sh', '.bash', '.zsh',
      '.yml', '.yaml', '.toml', '.ini', '.conf'
    ];
  }

  /**
   * Resource cleanup
   * @param {string} operationId - Operation identifier
   */
  async cleanup(operationId) {
    // No persistent resources to clean up
    this.logger?.info('Seek tool cleanup completed', { operationId });
  }
}

export default SeekTool;
