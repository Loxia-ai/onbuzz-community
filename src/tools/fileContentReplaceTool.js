/**
 * FileContentReplaceTool - Replace specific content within files
 *
 * Purpose:
 * - Replace text content in files with precision
 * - Support line-limited replacements
 * - Handle whitespace intelligently with trim modes
 * - Create backups before modifications
 * - Generate diff reports
 * - Support multi-file operations
 */

import { BaseTool } from './baseTool.js';
import { promises as fs } from 'fs';
import path from 'path';

// Configuration constants
const REPLACE_CONFIG = {
  // File size limits
  MAX_FILE_SIZE: 10 * 1024 * 1024,      // 10MB max file size
  MAX_OLD_CONTENT_SIZE: 100 * 1024,      // 100KB max old content
  MAX_NEW_CONTENT_SIZE: 100 * 1024,      // 100KB max new content

  // Operation limits
  MAX_REPLACEMENTS_PER_FILE: 1000,       // Max replacements in single file
  MAX_FILES_PER_OPERATION: 50,           // Max files in one operation
  MAX_LINE_RANGE_SIZE: 10000,            // Max lines in a range

  // Backup settings
  CREATE_BACKUPS: true,
  BACKUP_EXTENSION: '.bak',

  // Diff settings
  DIFF_CONTEXT_LINES: 3,                 // Lines of context in diff
  MAX_DIFF_LINES: 100,                   // Max lines to show in diff

  // Default settings
  DEFAULT_TRIM_MODE: 'trim'
};

class FileContentReplaceTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    // Override tool ID to match documentation (with hyphens)
    this.id = 'file-content-replace';

    // Tool metadata
    this.requiresProject = true;
    this.isAsync = true;
    this.timeout = config.timeout || 120000; // 2 minutes default

    // Merge config with defaults
    this.replaceConfig = {
      ...REPLACE_CONFIG,
      ...config.replaceConfig
    };
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
File Content Replace Tool: Replace specific content within files with precision.

USAGE:
\`\`\`json
{
  "toolId": "file-content-replace",
  "files": [
    {
      "path": "src/app.js",
      "replacements": [
        {
          "oldContent": "const oldFunction = () => {}",
          "newContent": "const newFunction = () => {}",
          "mode": "trim",
          "linesLimit": "5,7-10"
        }
      ]
    }
  ]
}
\`\`\`

PARAMETERS:

path (required):
  - Path to the file to modify
  - Can be relative or absolute
  - Examples: "src/app.js", "./config.json"

oldContent (required):
  - Content to find and replace
  - Subject to trim mode processing
  - Must exist in file

newContent (required):
  - Replacement content
  - Subject to trim mode processing
  - Can be same length, shorter, or longer

mode (optional):
  - Whitespace handling mode
  - Options:
    * "trim" (default): Trim all whitespace from both ends
    * "newlines": Only trim newline characters
    * "none": Use content exactly as provided
  - Helps with matching despite indentation differences

linesLimit (optional):
  - Restrict replacement to specific lines
  - Format: Comma-separated line numbers or ranges
  - Examples: "5", "5,10,15", "5-10", "1-5,10,15-20"
  - Line numbers are 1-based

dryRun (optional):
  - Preview changes first with unified diff output
  - No backups or file writes are performed when true

EXAMPLES:

Example 1 - Basic replacement:
\`\`\`json
{
  "toolId": "file-content-replace",
  "files": [{
    "path": "src/components/Button.js",
    "replacements": [{
      "oldContent": "const handleClick = (event) => { console.log('clicked'); }",
      "newContent": "const handleClick = (event) => { console.log('clicked'); props.onClick?.(event); }",
      "mode": "trim"
    }]
  }]
}
\`\`\`

Example 2 - Line-limited replacement:
\`\`\`json
{
  "toolId": "file-content-replace",
  "files": [{
    "path": "src/App.js",
    "replacements": [{
      "oldContent": "const API_URL = 'http://localhost:3000'",
      "newContent": "const API_URL = process.env.API_URL",
      "linesLimit": "10-20"
    }]
  }]
}
\`\`\`

Example 3 - Multiple replacements in one file:
\`\`\`json
{
  "toolId": "file-content-replace",
  "files": [{
    "path": "src/config.js",
    "replacements": [
      { "oldContent": "DEBUG = false", "newContent": "DEBUG = true" },
      { "oldContent": "LOG_LEVEL = 'error'", "newContent": "LOG_LEVEL = 'debug'" }
    ]
  }]
}
\`\`\`

Example 4 - Multiple files:
\`\`\`json
{
  "toolId": "file-content-replace",
  "files": [
    {
      "path": "src/app.js",
      "replacements": [{ "oldContent": "version = '1.0.0'", "newContent": "version = '1.1.0'" }]
    },
    {
      "path": "package.json",
      "replacements": [{ "oldContent": "\\"version\\": \\"1.0.0\\"", "newContent": "\\"version\\": \\"1.1.0\\"", "mode": "none" }]
    }
  ]
}
\`\`\`

TIP: Before replacing, use code-map read-range to preview the target lines and verify the exact content to match. This avoids failed replacements due to unexpected whitespace or content.

FEATURES:
- Automatic backup creation (.bak files)
- Before/after diff reports
- Replacement counting and statistics
- Multi-file operations
- Line-limited replacements
- Intelligent whitespace handling

LIMITATIONS:
- Maximum file size: ${REPLACE_CONFIG.MAX_FILE_SIZE / (1024 * 1024)}MB
- Maximum old content size: ${REPLACE_CONFIG.MAX_OLD_CONTENT_SIZE / 1024}KB
- Maximum new content size: ${REPLACE_CONFIG.MAX_NEW_CONTENT_SIZE / 1024}KB
- Maximum replacements per file: ${REPLACE_CONFIG.MAX_REPLACEMENTS_PER_FILE}
- Maximum files per operation: ${REPLACE_CONFIG.MAX_FILES_PER_OPERATION}
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
        return this.parseJSON(content);
      }

      // Otherwise parse XML
      return this.parseXML(content);
    } catch (error) {
      this.logger?.error('Failed to parse file-content-replace parameters', {
        error: error.message
      });
      throw new Error(`Parameter parsing failed: ${error.message}`);
    }
  }

  /**
   * Parse JSON format
   * @param {string} content - JSON string
   * @returns {Object} Parsed parameters
   */
  parseJSON(content) {
    const parsed = JSON.parse(content);

    if (!parsed.files || !Array.isArray(parsed.files)) {
      throw new Error('JSON must have "files" array');
    }

    return {
      dryRun: parsed.dryRun === true,
      files: parsed.files.map(file => ({
        path: file.path,
        replacements: (file.replacements || []).map(r => ({
          oldContent: r.oldContent,
          newContent: r.newContent,
          mode: r.mode || REPLACE_CONFIG.DEFAULT_TRIM_MODE,
          linesLimit: r.linesLimit || null
        }))
      }))
    };
  }

  /**
   * Parse XML format
   * @param {string} content - XML string
   * @returns {Object} Parsed parameters
   */
  parseXML(content) {
    const files = [];
    const dryRunMatch = /<dry-?run>(true|false)<\/dry-?run>/i.exec(content);
    const dryRun = dryRunMatch ? dryRunMatch[1].toLowerCase() === 'true' : false;

    // Extract <file> tags
    const filePattern = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/gi;
    let fileMatch;

    while ((fileMatch = filePattern.exec(content)) !== null) {
      const filePath = fileMatch[1];
      const fileContent = fileMatch[2];

      const replacements = [];

      // Extract <replace> tags within this file
      const replacePattern = /<replace(?:\s+([^>]*?))?>([\s\S]*?)<\/replace>/gi;
      let replaceMatch;

      while ((replaceMatch = replacePattern.exec(fileContent)) !== null) {
        const attributes = replaceMatch[1] || '';
        const replaceContent = replaceMatch[2];

        // Parse attributes
        const mode = this.extractAttribute(attributes, 'mode') || REPLACE_CONFIG.DEFAULT_TRIM_MODE;
        const linesLimit = this.extractAttribute(attributes, 'lines-limit');

        // Extract old-content
        const oldContentMatch = /<old-content>([\s\S]*?)<\/old-content>/i.exec(replaceContent);
        if (!oldContentMatch) {
          this.logger?.warn('Missing old-content in replace tag');
          continue;
        }
        const oldContentRaw = oldContentMatch[1];

        // Extract new-content
        const newContentMatch = /<new-content>([\s\S]*?)<\/new-content>/i.exec(replaceContent);
        if (!newContentMatch) {
          this.logger?.warn('Missing new-content in replace tag');
          continue;
        }
        const newContentRaw = newContentMatch[1];

        // Apply trim mode
        const oldContent = this.applyTrimMode(oldContentRaw, mode);
        const newContent = this.applyTrimMode(newContentRaw, mode);

        replacements.push({
          oldContent,
          newContent,
          mode,
          linesLimit
        });
      }

      if (replacements.length > 0) {
        files.push({
          path: filePath,
          replacements
        });
      }
    }

    return { dryRun, files };
  }

  /**
   * Extract attribute value from attribute string
   * @param {string} attributes - Attribute string
   * @param {string} name - Attribute name
   * @returns {string|null} Attribute value
   */
  extractAttribute(attributes, name) {
    const pattern = new RegExp(`${name}=["']([^"']*)["']`, 'i');
    const match = pattern.exec(attributes);
    return match ? match[1] : null;
  }

  /**
   * Apply trim mode to content
   * @param {string} content - Content to process
   * @param {string} mode - Trim mode
   * @returns {string} Processed content
   */
  applyTrimMode(content, mode) {
    switch (mode) {
      case 'newlines':
        return content.replace(/^\n+|\n+$/g, '');
      case 'none':
        return content;
      case 'trim':
      default:
        return content.trim();
    }
  }

  /**
   * Get required parameters
   * @returns {Array<string>} Array of required parameter names
   */
  getRequiredParameters() {
    return ['files'];
  }

  /**
   * Custom parameter validation
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result
   */
  customValidateParameters(params) {
    const errors = [];

    // Validate dry run flag
    if (Object.prototype.hasOwnProperty.call(params, 'dryRun') && typeof params.dryRun !== 'boolean') {
      errors.push('dryRun must be a boolean');
    }

    // Validate files array
    if (!params.files || !Array.isArray(params.files)) {
      errors.push('files must be an array');
    } else {
      if (params.files.length === 0) {
        errors.push('files array cannot be empty');
      }

      if (params.files.length > this.replaceConfig.MAX_FILES_PER_OPERATION) {
        errors.push(`Cannot process more than ${this.replaceConfig.MAX_FILES_PER_OPERATION} files in one operation`);
      }

      // Validate each file
      for (const file of params.files) {
        if (!file.path) {
          errors.push('Each file must have a path');
        }

        // Check for path traversal
        if (file.path && file.path.includes('..')) {
          errors.push(`Path traversal (..) not allowed for security: ${file.path}`);
        }

        if (!file.replacements || !Array.isArray(file.replacements)) {
          errors.push(`File ${file.path} must have replacements array`);
        } else if (file.replacements.length === 0) {
          errors.push(`File ${file.path} replacements array cannot be empty`);
        } else {
          // Validate each replacement
          for (const replacement of file.replacements) {
            if (!replacement.oldContent && replacement.oldContent !== '') {
              errors.push(`Replacement in ${file.path} missing oldContent`);
            }

            if (!replacement.newContent && replacement.newContent !== '') {
              errors.push(`Replacement in ${file.path} missing newContent`);
            }

            // Validate content sizes
            if (replacement.oldContent && replacement.oldContent.length > this.replaceConfig.MAX_OLD_CONTENT_SIZE) {
              errors.push(`oldContent too large (max ${this.replaceConfig.MAX_OLD_CONTENT_SIZE / 1024}KB)`);
            }

            if (replacement.newContent && replacement.newContent.length > this.replaceConfig.MAX_NEW_CONTENT_SIZE) {
              errors.push(`newContent too large (max ${this.replaceConfig.MAX_NEW_CONTENT_SIZE / 1024}KB)`);
            }

            // Validate mode
            if (replacement.mode && !['trim', 'newlines', 'none'].includes(replacement.mode)) {
              errors.push(`Invalid mode: ${replacement.mode}. Must be 'trim', 'newlines', or 'none'`);
            }
          }
        }
      }
    }

    // Throw error if validation fails
    if (errors.length > 0) {
      throw new Error(`Parameter validation failed: ${errors.join(', ')}`);
    }

    return {
      valid: true,
      errors: []
    };
  }

  /**
   * Check if params are already normalized (have replacements with mode defaults)
   * @param {Object} params - Parameters to check
   * @returns {boolean} True if already normalized
   * @private
   */
  _isNormalizedParams(params) {
    if (!params.files || !Array.isArray(params.files) || params.files.length === 0) {
      return false;
    }
    // Check if first file's first replacement has 'mode' property (set by parseJSON)
    const firstFile = params.files[0];
    if (!firstFile.replacements || !Array.isArray(firstFile.replacements) || firstFile.replacements.length === 0) {
      return false;
    }
    return Object.prototype.hasOwnProperty.call(firstFile.replacements[0], 'mode');
  }

  /**
   * Execute tool with parsed parameters
   * @param {Object} params - Parsed parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(params, context) {
    // Handle string input (needs parsing)
    if (typeof params === 'string') {
      this.logger?.info('FileContentReplaceTool: Parsing string parameters');
      params = this.parseParameters(params);
    }

    // Handle object that needs normalization (when files array exists but not parsed)
    if (params && typeof params === 'object' && params.files && !this._isNormalizedParams(params)) {
      this.logger?.info('FileContentReplaceTool: Normalizing object parameters');
      // Re-parse to ensure proper structure with defaults
      params = this.parseJSON(JSON.stringify(params));
    }

    const { files } = params;
    const dryRun = params.dryRun === true;
    const { projectDir, agentId, directoryAccess } = context;

    // Determine working directory (respect multi-directory access)
    let workingDirectory = projectDir || process.cwd();

    if (directoryAccess && directoryAccess.workingDirectory) {
      workingDirectory = directoryAccess.workingDirectory;
      this.logger?.info('Using agent configured working directory', {
        workingDirectory: directoryAccess.workingDirectory,
        agentId
      });
    }

    this.logger?.info('Executing file content replace', {
      fileCount: files.length,
      dryRun,
      workingDirectory,
      agentId
    });

    const results = [];
    const stats = {
      filesProcessed: 0,
      filesModified: 0,
      totalReplacements: 0,
      backupsCreated: 0,
      errors: 0
    };

    // Process each file
    for (const file of files) {
      try {
        const fileResult = await this.processFile(file, workingDirectory, directoryAccess, dryRun);
        results.push(fileResult);

        stats.filesProcessed++;
        if (fileResult.replacementsMade > 0) {
          stats.filesModified++;
          stats.totalReplacements += fileResult.replacementsMade;
        }
        if (fileResult.backupCreated) {
          stats.backupsCreated++;
        }
      } catch (error) {
        this.logger?.error(`Error processing file ${file.path}`, { error: error.message });
        results.push({
          filePath: file.path,
          success: false,
          error: error.message
        });
        stats.errors++;
      }
    }

    return {
      success: stats.errors === 0,
      results,
      statistics: stats,
      summary: this.generateSummary(stats),
      toolUsed: 'file-content-replace'
    };
  }

  /**
   * Process a single file
   * @param {Object} file - File object with path and replacements
   * @param {string} workingDirectory - Working directory
   * @param {Object} directoryAccess - Directory access config
   * @returns {Promise<Object>} File processing result
   */
  async processFile(file, workingDirectory, directoryAccess, dryRun = false) {
    const { path: filePath, replacements } = file;

    // Resolve path
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(workingDirectory, filePath);

    // Validate path access (if directoryAccess provided)
    if (directoryAccess) {
      const accessible = this.isPathAccessible(resolvedPath, workingDirectory, directoryAccess);
      if (!accessible) {
        throw new Error(`Path not accessible: ${filePath}`);
      }
    }

    // Check file exists
    try {
      await fs.access(resolvedPath);
    } catch (error) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Check file size
    const stats = await fs.stat(resolvedPath);
    if (stats.size > this.replaceConfig.MAX_FILE_SIZE) {
      throw new Error(`File too large (max ${this.replaceConfig.MAX_FILE_SIZE / (1024 * 1024)}MB): ${filePath}`);
    }

    // Read file content
    let content = await fs.readFile(resolvedPath, 'utf-8');
    const originalContent = content;

    // Create backup
    let backupCreated = false;
    if (!dryRun && this.replaceConfig.CREATE_BACKUPS) {
      const backupPath = resolvedPath + this.replaceConfig.BACKUP_EXTENSION;
      try {
        await fs.writeFile(backupPath, originalContent, 'utf-8');
        backupCreated = true;
      } catch (error) {
        this.logger?.warn(`Failed to create backup: ${error.message}`);
      }
    }

    // Apply replacements
    let replacementsMade = 0;
    const replacementDetails = [];

    for (const replacement of replacements) {
      const result = await this.applyReplacement(
        content,
        replacement.oldContent,
        replacement.newContent,
        replacement.linesLimit
      );

      content = result.newContent;
      replacementsMade += result.count;

      replacementDetails.push({
        oldContent: replacement.oldContent.substring(0, 50) + (replacement.oldContent.length > 50 ? '...' : ''),
        newContent: replacement.newContent.substring(0, 50) + (replacement.newContent.length > 50 ? '...' : ''),
        count: result.count,
        mode: replacement.mode,
        linesLimit: replacement.linesLimit
      });
    }

    // Write back if changes were made
    if (replacementsMade > 0 && !dryRun) {
      await fs.writeFile(resolvedPath, content, 'utf-8');
    }

    // Generate diff
    const diff = (dryRun || replacementsMade > 0)
      ? this.generateDiff(originalContent, content)
      : null;

    return {
      filePath,
      resolvedPath,
      success: true,
      replacementsMade,
      backupCreated,
      replacementDetails,
      diff,
      dryRun,
      message: replacementsMade > 0
        ? `${dryRun ? 'Dry-run: would make' : 'Made'} ${replacementsMade} replacement(s) in ${filePath}`
        : `${dryRun ? 'Dry-run: no' : 'No'} replacements made in ${filePath} (content not found)`
    };
  }

  /**
   * Check if path is accessible
   * @param {string} targetPath - Path to check
   * @param {string} workingDirectory - Working directory
   * @param {Object} directoryAccess - Directory access config
   * @returns {boolean} True if accessible
   */
  isPathAccessible(targetPath, workingDirectory, directoryAccess) {
    // Always allow paths within working directory
    const relativeToWorking = path.relative(workingDirectory, targetPath);
    if (!relativeToWorking.startsWith('..') && !path.isAbsolute(relativeToWorking)) {
      return true;
    }

    // Check writeEnabledDirectories
    if (directoryAccess.writeEnabledDirectories) {
      for (const dir of directoryAccess.writeEnabledDirectories) {
        const relative = path.relative(dir, targetPath);
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Apply a single replacement
   * @param {string} content - File content
   * @param {string} oldContent - Content to replace
   * @param {string} newContent - Replacement content
   * @param {string|null} linesLimit - Line limit specification
   * @returns {Object} Result with newContent and count
   */
  async applyReplacement(content, oldContent, newContent, linesLimit) {
    if (!linesLimit) {
      // Replace in entire file (simple string replace, not regex)
      const count = this.countOccurrences(content, oldContent);

      if (count === 0) {
        return { newContent: content, count: 0 };
      }

      // Simple replaceAll
      const newFileContent = content.split(oldContent).join(newContent);

      return { newContent: newFileContent, count };
    }

    // Line-limited replacement
    const lineNumbers = this.parseLineRanges(linesLimit);
    const lines = content.split('\n');
    let replacementCount = 0;

    // Process each line
    for (let i = 0; i < lines.length; i++) {
      const lineNumber = i + 1; // 1-based

      if (lineNumbers.has(lineNumber)) {
        // Check if this line contains the old content
        if (lines[i].includes(oldContent)) {
          const occurrencesInLine = this.countOccurrences(lines[i], oldContent);
          lines[i] = lines[i].split(oldContent).join(newContent);
          replacementCount += occurrencesInLine;
        }
      }
    }

    return {
      newContent: lines.join('\n'),
      count: replacementCount
    };
  }

  /**
   * Count occurrences of substring in string
   * @param {string} str - String to search
   * @param {string} substr - Substring to count
   * @returns {number} Count of occurrences
   */
  countOccurrences(str, substr) {
    if (!substr) return 0;
    return str.split(substr).length - 1;
  }

  /**
   * Parse line ranges from string like "3,5,7-9"
   * @param {string} rangesStr - Line range string
   * @returns {Set<number>} Set of line numbers
   */
  parseLineRanges(rangesStr) {
    const result = new Set();

    if (!rangesStr || rangesStr.trim() === '') {
      return result;
    }

    const ranges = rangesStr.split(',');

    for (const range of ranges) {
      const trimmed = range.trim();

      if (trimmed === '') continue;

      // Check if it's a range (e.g., "7-9")
      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map(n => parseInt(n.trim(), 10));

        if (!isNaN(start) && !isNaN(end) && end - start < this.replaceConfig.MAX_LINE_RANGE_SIZE) {
          for (let i = start; i <= end; i++) {
            result.add(i);
          }
        }
      } else {
        // Single line number
        const lineNum = parseInt(trimmed, 10);
        if (!isNaN(lineNum)) {
          result.add(lineNum);
        }
      }
    }

    return result;
  }

  /**
   * Generate diff between original and new content
   * @param {string} original - Original content
   * @param {string} modified - Modified content
   * @returns {string} Diff string
   */
  generateDiff(original, modified) {
    const oldLines = original.split('\n');
    const newLines = modified.split('\n');

    // Find first and last lines that differ
    let firstDiff = -1;
    let lastDiff = -1;

    const maxLines = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLines; i++) {
      const oldLine = i < oldLines.length ? oldLines[i] : '';
      const newLine = i < newLines.length ? newLines[i] : '';

      if (oldLine !== newLine) {
        if (firstDiff === -1) firstDiff = i;
        lastDiff = i;
      }
    }

    if (firstDiff === -1) return 'No differences';

    // Add context
    const contextLines = this.replaceConfig.DIFF_CONTEXT_LINES;
    const startLine = Math.max(0, firstDiff - contextLines);
    const endLine = Math.min(maxLines - 1, lastDiff + contextLines);

    // Limit total lines shown
    if (endLine - startLine > this.replaceConfig.MAX_DIFF_LINES) {
      return `Diff too large (${endLine - startLine + 1} lines), showing summary only:\n` +
             `Changed lines: ${firstDiff + 1} to ${lastDiff + 1}`;
    }

    let diff = `@@ -${startLine + 1},${endLine - startLine + 1} +${startLine + 1},${endLine - startLine + 1} @@\n`;

    for (let i = startLine; i <= endLine; i++) {
      const oldLine = i < oldLines.length ? oldLines[i] : '';
      const newLine = i < newLines.length ? newLines[i] : '';

      if (oldLine === newLine) {
        diff += `  ${oldLine}\n`;
      } else {
        diff += `- ${oldLine}\n`;
        diff += `+ ${newLine}\n`;
      }
    }

    return diff;
  }

  /**
   * Generate summary text
   * @param {Object} stats - Statistics object
   * @returns {string} Summary text
   */
  generateSummary(stats) {
    return `
Processed ${stats.filesProcessed} file(s)
Modified ${stats.filesModified} file(s)
Total replacements: ${stats.totalReplacements}
Backups created: ${stats.backupsCreated}
Errors: ${stats.errors}
    `.trim();
  }

  /**
   * Resource cleanup
   * @param {string} operationId - Operation identifier
   */
  async cleanup(operationId) {
    // No persistent resources to clean up
    this.logger?.info('File content replace tool cleanup completed', { operationId });
  }
}

export default FileContentReplaceTool;
