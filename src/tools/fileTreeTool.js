/**
 * FileTreeTool - Generate hierarchical file tree representations
 *
 * Purpose:
 * - Generate ASCII tree of project directory structure
 * - Help agents understand project organization
 * - Support filtering by file types (whitelist/blacklist)
 * - Respect directory access permissions
 * - Provide focused views of codebases
 */

import { BaseTool } from './baseTool.js';
import { promises as fs } from 'fs';
import path from 'path';

// Configuration constants
const TREE_CONFIG = {
  // Depth limits
  DEFAULT_MAX_DEPTH: 3,
  MAX_DEPTH_LIMIT: 10, // Absolute maximum to prevent performance issues

  // Size limits
  MAX_FILES_IN_TREE: 10000, // Maximum files to include
  MAX_DIRECTORIES: 1000, // Maximum directories to scan

  // Display settings
  SHOW_FILES_DEFAULT: true,
  SHOW_HIDDEN_DEFAULT: false,
  SHOW_SIZES_DEFAULT: false,

  // Tree symbols
  SYMBOLS: {
    BRANCH: '├── ',
    LAST_BRANCH: '└── ',
    VERTICAL: '│   ',
    INDENT: '    '
  }
};

// Default directories to ignore
const DEFAULT_IGNORE_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  'out',
  'target',
  'vendor',
  'bower_components',
  '.vscode',
  '.idea',
  '.vs',
  '__pycache__',
  'venv',
  'env',
  '.env',
  '.pytest_cache',
  '.mypy_cache',
  'eggs',
  '.eggs',
  'lib',
  'lib64',
  'parts',
  'sdist',
  'wheels',
  '.tox',
  '.nox',
  'htmlcov',
  '.hypothesis',
  'tmp',
  'temp',
  '.tmp',
  '.temp'
];

// Default file extensions to ignore (blacklist)
const DEFAULT_IGNORE_EXTENSIONS = [
  '.map',
  '.min.js',
  '.min.css',
  '.lock',
  '.log',
  '.tmp',
  '.temp',
  '.pyc',
  '.pyo',
  '.pyd',
  '.so',
  '.dll',
  '.dylib',
  '.exe',
  '.obj',
  '.o',
  '.a',
  '.class',
  '.jar',
  '.war'
];

// Common binary/media file extensions to optionally ignore
const BINARY_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv',
  '.woff', '.woff2', '.ttf', '.eot',
  '.bin', '.dat', '.db', '.sqlite'
];

class FileTreeTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    // Override tool ID to match documentation (with hyphen)
    this.id = 'file-tree';

    // Tool metadata
    this.requiresProject = true;
    this.isAsync = true;
    this.timeout = config.timeout || 120000; // 2 minutes default

    // Merge config with defaults
    this.treeConfig = {
      ...TREE_CONFIG,
      ...config.treeConfig
    };

    // Track statistics during tree generation
    this.stats = {
      filesCount: 0,
      directoriesCount: 0,
      skippedCount: 0
    };
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
File Tree Tool: Generate hierarchical tree representation of project directory structure.

USAGE:
\`\`\`json
{
  "toolId": "file-tree",
  "directory": "src",
  "maxDepth": 4,
  "includeExtensions": [".js", ".jsx", ".ts", ".tsx"],
  "excludeExtensions": [".test.js", ".spec.js"],
  "showFiles": true,
  "showHidden": false
}
\`\`\`

PARAMETERS:

directory (optional):
  - Directory to scan (default: working directory)
  - Can be relative or absolute path
  - Examples: "src", "src/components", "/home/user/project"

maxDepth (optional):
  - Maximum depth to scan (default: ${TREE_CONFIG.DEFAULT_MAX_DEPTH})
  - Range: 1-${TREE_CONFIG.MAX_DEPTH_LIMIT}
  - Deeper = more detail, slower performance

includeExtensions (optional - WHITELIST):
  - Include ONLY these file extensions
  - Array of extensions
  - Examples: [".js", ".jsx", ".ts", ".tsx"]
  - Takes precedence over excludeExtensions

excludeExtensions (optional - BLACKLIST):
  - Exclude these file extensions
  - Array of extensions
  - Examples: [".test.js", ".spec.js", ".min.js"]
  - Only applies if includeExtensions is not set

excludeDirectories (optional):
  - Additional directories to ignore
  - Already ignores: node_modules, .git, dist, build, etc.
  - Examples: ["tests", "fixtures", "mocks"]

showFiles (optional):
  - Whether to show files (default: true)
  - Set to false to show only directory structure

showHidden (optional):
  - Whether to show hidden files/folders (default: false)
  - Hidden = starts with '.'

showSizes (optional):
  - Whether to show file sizes (default: false)
  - Format: KB, MB

ignoreBinaryFiles (optional):
  - Whether to ignore binary/media files (default: false)
  - Ignores: images, videos, archives, fonts, etc.

EXAMPLES:

Example 1 - Basic tree:
\`\`\`json
{
  "toolId": "file-tree",
  "directory": "."
}
\`\`\`

Example 2 - JavaScript/TypeScript only:
\`\`\`json
{
  "toolId": "file-tree",
  "directory": "src",
  "includeExtensions": [".js", ".jsx", ".ts", ".tsx"],
  "maxDepth": 5
}
\`\`\`

Example 3 - Python project structure:
\`\`\`json
{
  "toolId": "file-tree",
  "directory": ".",
  "includeExtensions": [".py"],
  "excludeExtensions": [".pyc"],
  "showFiles": true
}
\`\`\`

Example 4 - Directory structure only:
\`\`\`json
{
  "toolId": "file-tree",
  "directory": "src",
  "showFiles": false,
  "maxDepth": 3
}
\`\`\`

Example 5 - Exclude test files:
\`\`\`json
{
  "toolId": "file-tree",
  "directory": "src",
  "excludeExtensions": [".test.js", ".spec.js", ".test.ts", ".spec.ts"],
  "excludeDirectories": ["__tests__", "tests", "specs"]
}
\`\`\`

OUTPUT FORMAT:
src/
├── components/
│   ├── Header.jsx
│   ├── Footer.jsx
│   └── Layout.jsx
├── utils/
│   ├── helpers.js
│   └── config.js
└── index.js

AUTOMATIC IGNORES:
The tool automatically ignores common directories:
- node_modules, .git, dist, build, coverage
- .next, .nuxt, .cache, out, target
- .vscode, .idea, __pycache__, venv

LIMITATIONS:
- Maximum depth: ${TREE_CONFIG.MAX_DEPTH_LIMIT}
- Maximum files: ${TREE_CONFIG.MAX_FILES_IN_TREE}
- Maximum directories: ${TREE_CONFIG.MAX_DIRECTORIES}
- Binary files can be filtered with ignoreBinaryFiles option
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
          directory: parsed.directory || '.',
          maxDepth: parsed.maxDepth || TREE_CONFIG.DEFAULT_MAX_DEPTH,
          includeExtensions: parsed.includeExtensions || [],
          excludeExtensions: parsed.excludeExtensions || [],
          excludeDirectories: parsed.excludeDirectories || [],
          showFiles: parsed.showFiles !== false,
          showHidden: parsed.showHidden === true,
          showSizes: parsed.showSizes === true,
          ignoreBinaryFiles: parsed.ignoreBinaryFiles === true
        };
      }

      // XML parsing
      const params = {
        directory: '.',
        maxDepth: TREE_CONFIG.DEFAULT_MAX_DEPTH,
        includeExtensions: [],
        excludeExtensions: [],
        excludeDirectories: [],
        showFiles: true,
        showHidden: false,
        showSizes: false,
        ignoreBinaryFiles: false
      };

      // Extract directory
      const dirPattern = /<directory>(.*?)<\/directory>/i;
      const dirMatch = dirPattern.exec(content);
      if (dirMatch) {
        params.directory = dirMatch[1].trim();
      }

      // Extract max-depth
      const depthPattern = /<max-depth>(\d+)<\/max-depth>/i;
      const depthMatch = depthPattern.exec(content);
      if (depthMatch) {
        params.maxDepth = parseInt(depthMatch[1], 10);
      }

      // Extract include-extensions (whitelist)
      const includePattern = /<include-extensions>(.*?)<\/include-extensions>/i;
      const includeMatch = includePattern.exec(content);
      if (includeMatch) {
        params.includeExtensions = includeMatch[1]
          .split(',')
          .map(ext => ext.trim())
          .filter(ext => ext.length > 0);
      }

      // Extract exclude-extensions (blacklist)
      const excludePattern = /<exclude-extensions>(.*?)<\/exclude-extensions>/i;
      const excludeMatch = excludePattern.exec(content);
      if (excludeMatch) {
        params.excludeExtensions = excludeMatch[1]
          .split(',')
          .map(ext => ext.trim())
          .filter(ext => ext.length > 0);
      }

      // Extract exclude-directories
      const excludeDirsPattern = /<exclude-directories>(.*?)<\/exclude-directories>/i;
      const excludeDirsMatch = excludeDirsPattern.exec(content);
      if (excludeDirsMatch) {
        params.excludeDirectories = excludeDirsMatch[1]
          .split(',')
          .map(dir => dir.trim())
          .filter(dir => dir.length > 0);
      }

      // Extract boolean flags
      const showFilesPattern = /<show-files>(.*?)<\/show-files>/i;
      const showFilesMatch = showFilesPattern.exec(content);
      if (showFilesMatch) {
        params.showFiles = showFilesMatch[1].trim().toLowerCase() !== 'false';
      }

      const showHiddenPattern = /<show-hidden>(.*?)<\/show-hidden>/i;
      const showHiddenMatch = showHiddenPattern.exec(content);
      if (showHiddenMatch) {
        params.showHidden = showHiddenMatch[1].trim().toLowerCase() === 'true';
      }

      const showSizesPattern = /<show-sizes>(.*?)<\/show-sizes>/i;
      const showSizesMatch = showSizesPattern.exec(content);
      if (showSizesMatch) {
        params.showSizes = showSizesMatch[1].trim().toLowerCase() === 'true';
      }

      const ignoreBinaryPattern = /<ignore-binary-files>(.*?)<\/ignore-binary-files>/i;
      const ignoreBinaryMatch = ignoreBinaryPattern.exec(content);
      if (ignoreBinaryMatch) {
        params.ignoreBinaryFiles = ignoreBinaryMatch[1].trim().toLowerCase() === 'true';
      }

      return params;

    } catch (error) {
      this.logger?.error('Failed to parse file-tree parameters', { error: error.message });
      return {
        directory: '.',
        maxDepth: TREE_CONFIG.DEFAULT_MAX_DEPTH,
        includeExtensions: [],
        excludeExtensions: [],
        excludeDirectories: [],
        showFiles: true,
        showHidden: false,
        showSizes: false,
        ignoreBinaryFiles: false,
        parseError: error.message
      };
    }
  }

  /**
   * Get required parameters
   * @returns {Array<string>} Array of required parameter names
   */
  getRequiredParameters() {
    return []; // All parameters are optional
  }

  /**
   * Custom parameter validation
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result
   */
  customValidateParameters(params) {
    const errors = [];

    // Validate maxDepth
    if (params.maxDepth !== undefined) {
      if (typeof params.maxDepth !== 'number' || params.maxDepth < 1) {
        errors.push('max-depth must be a positive number');
      } else if (params.maxDepth > this.treeConfig.MAX_DEPTH_LIMIT) {
        errors.push(`max-depth cannot exceed ${this.treeConfig.MAX_DEPTH_LIMIT}`);
      }
    }

    // Validate directory path
    if (params.directory && params.directory.includes('..')) {
      errors.push('Path traversal (..) not allowed for security');
    }

    // Validate includeExtensions format
    if (params.includeExtensions !== undefined && params.includeExtensions !== null) {
      if (!Array.isArray(params.includeExtensions)) {
        errors.push('includeExtensions must be an array');
      } else {
        for (const ext of params.includeExtensions) {
          if (!ext.startsWith('.')) {
            errors.push(`Extension "${ext}" must start with a dot (e.g., ".js")`);
          }
        }
      }
    }

    // Validate excludeExtensions format
    if (params.excludeExtensions !== undefined && params.excludeExtensions !== null) {
      if (!Array.isArray(params.excludeExtensions)) {
        errors.push('excludeExtensions must be an array');
      } else {
        for (const ext of params.excludeExtensions) {
          if (!ext.startsWith('.')) {
            errors.push(`Extension "${ext}" must start with a dot (e.g., ".js")`);
          }
        }
      }
    }

    // Validate excludeDirectories format
    if (params.excludeDirectories !== undefined && params.excludeDirectories !== null) {
      if (!Array.isArray(params.excludeDirectories)) {
        errors.push('excludeDirectories must be an array');
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
   * Execute tool with parsed parameters
   * @param {Object} params - Parsed parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(params, context) {
    // Extract params with defaults
    const {
      directory = '.',
      maxDepth = TREE_CONFIG.DEFAULT_MAX_DEPTH,
      includeExtensions = [],
      excludeExtensions = [],
      excludeDirectories = [],
      showFiles = true,
      showHidden = false,
      showSizes = false,
      ignoreBinaryFiles = false
    } = params;
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

    // Resolve target directory
    const targetDir = path.isAbsolute(directory)
      ? directory
      : path.resolve(workingDirectory, directory);

    // Validate directory exists
    try {
      const stats = await fs.stat(targetDir);
      if (!stats.isDirectory()) {
        throw new Error('Path is not a directory');
      }
    } catch (error) {
      throw new Error(`Directory does not exist or is inaccessible: ${directory}`);
    }

    this.logger?.info('Generating file tree', {
      directory,
      targetDir,
      maxDepth,
      includeExtensions: includeExtensions?.length || 0,
      excludeExtensions: excludeExtensions?.length || 0,
      agentId
    });

    // Reset statistics
    this.stats = {
      filesCount: 0,
      directoriesCount: 0,
      skippedCount: 0
    };

    // Build ignore lists (ensure arrays exist)
    const ignoreDirs = [...DEFAULT_IGNORE_DIRECTORIES, ...(excludeDirectories || [])];
    const ignoreExts = [...DEFAULT_IGNORE_EXTENSIONS];

    if (ignoreBinaryFiles) {
      ignoreExts.push(...BINARY_EXTENSIONS);
    }

    // Generate tree (ensure arrays exist)
    const tree = await this.buildTree(
      targetDir,
      targetDir,
      0,
      maxDepth,
      ignoreDirs,
      includeExtensions || [],
      [...(excludeExtensions || []), ...ignoreExts],
      showFiles,
      showHidden,
      showSizes
    );

    // Format tree as string
    const treeString = this.formatTree(tree);

    // Generate summary
    const summary = this.generateSummary(directory, this.stats, maxDepth);

    return {
      success: true,
      directory: targetDir,
      tree: treeString,
      summary,
      maxDepth,
      totalFiles: this.stats.filesCount,
      totalDirectories: this.stats.directoriesCount,
      skippedCount: this.stats.skippedCount,
      statistics: { ...this.stats },
      toolUsed: 'file-tree',
      guidance: 'To understand the code structure of files shown above, use code-map skeleton. Example: {"toolId":"code-map","parameters":{"action":"skeleton","path":"src/","level":"B.0"}}'
    };
  }

  /**
   * Build tree data structure recursively
   * @param {string} basePath - Base path for relative calculations
   * @param {string} currentPath - Current directory being processed
   * @param {number} currentDepth - Current depth in tree
   * @param {number} maxDepth - Maximum depth to scan
   * @param {Array<string>} ignoreDirs - Directories to ignore
   * @param {Array<string>} includeExts - Extensions to include (whitelist)
   * @param {Array<string>} excludeExts - Extensions to exclude (blacklist)
   * @param {boolean} showFiles - Whether to show files
   * @param {boolean} showHidden - Whether to show hidden files/folders
   * @param {boolean} showSizes - Whether to show file sizes
   * @returns {Promise<Object>} Tree node
   * @private
   */
  async buildTree(
    basePath,
    currentPath,
    currentDepth,
    maxDepth,
    ignoreDirs,
    includeExts,
    excludeExts,
    showFiles,
    showHidden,
    showSizes
  ) {
    // Check depth limit
    if (currentDepth > maxDepth) {
      return null;
    }

    // Check directory count limit
    if (this.stats.directoriesCount >= this.treeConfig.MAX_DIRECTORIES) {
      this.logger?.warn('Maximum directory count reached', {
        maxDirectories: this.treeConfig.MAX_DIRECTORIES
      });
      return null;
    }

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      const node = {
        name: currentDepth === 0 ? path.basename(currentPath) + '/' : path.basename(currentPath),
        path: path.relative(basePath, currentPath),
        type: 'directory',
        children: []
      };

      this.stats.directoriesCount++;

      for (const entry of entries) {
        // Check file count limit
        if (this.stats.filesCount >= this.treeConfig.MAX_FILES_IN_TREE) {
          this.logger?.warn('Maximum file count reached', {
            maxFiles: this.treeConfig.MAX_FILES_IN_TREE
          });
          break;
        }

        // Skip hidden files/folders if not showing hidden
        if (!showHidden && entry.name.startsWith('.')) {
          this.stats.skippedCount++;
          continue;
        }

        const entryPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          // Skip ignored directories
          if (ignoreDirs.includes(entry.name)) {
            this.stats.skippedCount++;
            continue;
          }

          // Recursively build subtree
          const subTree = await this.buildTree(
            basePath,
            entryPath,
            currentDepth + 1,
            maxDepth,
            ignoreDirs,
            includeExts,
            excludeExts,
            showFiles,
            showHidden,
            showSizes
          );

          if (subTree && (subTree.children.length > 0 || currentDepth === 0)) {
            node.children.push(subTree);
          }
        } else if (entry.isFile() && showFiles) {
          // Files are children of current directory, so they're at currentDepth + 1
          // Don't show files if they would exceed maxDepth
          if (currentDepth + 1 > maxDepth) {
            continue;
          }

          const ext = path.extname(entry.name);

          // WHITELIST: If includeExtensions is specified, ONLY include those
          if (includeExts.length > 0) {
            if (!includeExts.includes(ext)) {
              this.stats.skippedCount++;
              continue;
            }
          }
          // BLACKLIST: Otherwise, exclude based on excludeExtensions
          else if (excludeExts.includes(ext)) {
            this.stats.skippedCount++;
            continue;
          }

          // Get file size if requested
          let sizeInfo = '';
          if (showSizes) {
            try {
              const stats = await fs.stat(entryPath);
              sizeInfo = ` (${this.formatFileSize(stats.size)})`;
            } catch (error) {
              // Ignore size errors
            }
          }

          node.children.push({
            name: entry.name + sizeInfo,
            path: path.relative(basePath, entryPath),
            type: 'file',
            ext
          });

          this.stats.filesCount++;
        }
      }

      // Sort children: directories first, then files, both alphabetically
      node.children.sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name);
        }
        return a.type === 'directory' ? -1 : 1;
      });

      return node;

    } catch (error) {
      this.logger?.error('Error building tree', {
        currentPath,
        error: error.message
      });
      return {
        name: path.basename(currentPath),
        path: path.relative(basePath, currentPath),
        type: 'directory',
        error: error.message,
        children: []
      };
    }
  }

  /**
   * Format tree as ASCII string
   * @param {Object} node - Tree node
   * @param {string} prefix - Prefix for current line
   * @param {boolean} isLast - Whether this is the last child
   * @param {boolean} isRoot - Whether this is the root node
   * @returns {string} Formatted tree string
   * @private
   */
  formatTree(node, prefix = '', isLast = true, isRoot = true) {
    if (!node) return '';

    const symbols = this.treeConfig.SYMBOLS;
    let result = '';

    // Root node special case
    if (isRoot) {
      result = `${node.name}\n`;
    } else {
      result = `${prefix}${isLast ? symbols.LAST_BRANCH : symbols.BRANCH}${node.name}\n`;
    }

    // Add children
    if (node.children && node.children.length > 0) {
      const childPrefix = isRoot ? '' : prefix + (isLast ? symbols.INDENT : symbols.VERTICAL);

      node.children.forEach((child, index) => {
        const isLastChild = index === node.children.length - 1;
        result += this.formatTree(child, childPrefix, isLastChild, false);
      });
    }

    return result;
  }

  /**
   * Format file size in human-readable format
   * @param {number} bytes - File size in bytes
   * @returns {string} Formatted size
   * @private
   */
  formatFileSize(bytes) {
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;

    if (bytes >= GB) {
      return `${(bytes / GB).toFixed(2)} GB`;
    } else if (bytes >= MB) {
      return `${(bytes / MB).toFixed(2)} MB`;
    } else if (bytes >= KB) {
      return `${(bytes / KB).toFixed(2)} KB`;
    } else {
      return `${bytes} B`;
    }
  }

  /**
   * Generate summary text
   * @param {string} directory - Directory scanned
   * @param {Object} stats - Statistics object
   * @param {number} maxDepth - Maximum depth used
   * @returns {string} Summary text
   * @private
   */
  generateSummary(directory, stats, maxDepth) {
    return `
Directory: ${directory}
Max Depth: ${maxDepth}
Files: ${stats.filesCount}
Directories: ${stats.directoriesCount}
Skipped: ${stats.skippedCount}
    `.trim();
  }

  /**
   * Resource cleanup
   * @param {string} operationId - Operation identifier
   */
  async cleanup(operationId) {
    // No persistent resources to clean up
    this.logger?.info('File tree tool cleanup completed', { operationId });
  }
}

export default FileTreeTool;
