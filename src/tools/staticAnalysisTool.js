/**
 * StaticAnalysisTool - Static code analysis for finding errors without execution
 *
 * Purpose:
 * - Analyze code files for syntax, type, and import errors
 * - Detect programming languages and frameworks
 * - Provide actionable error references with line numbers
 * - Support single file, multiple files, and project-wide analysis
 * - Use official language parsers for accurate results
 */

import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';
import DirectoryAccessManager from '../utilities/directoryAccessManager.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

import {
  STATIC_ANALYSIS,
  TOOL_STATUS,
  SYSTEM_DEFAULTS
} from '../utilities/constants.js';
import {
  validateContent,
  validateStructuredFile,
  detectFormat,
  getSupportedFormats
} from '../utilities/structuredFileValidator.js';

class StaticAnalysisTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    // Tool metadata
    this.requiresProject = true;
    this.isAsync = false;
    this.timeout = config.timeout || STATIC_ANALYSIS.ANALYSIS_TIMEOUT;
    this.maxConcurrentOperations = config.maxConcurrentOperations || 1;

    // Analysis settings
    this.maxFileSize = config.maxFileSize || STATIC_ANALYSIS.MAX_FILE_SIZE_FOR_ANALYSIS;
    this.maxFilesPerBatch = config.maxFilesPerBatch || STATIC_ANALYSIS.MAX_FILES_PER_BATCH;
    this.enableCache = config.enableCache !== false && STATIC_ANALYSIS.ENABLE_CACHE;

    // Cache for analysis results
    this.analysisCache = new Map();
    this.cacheExpiry = STATIC_ANALYSIS.CACHE_DURATION;

    // Performance optimization settings
    this.parallelAnalysis = config.parallelAnalysis !== false;
    this.maxParallelFiles = config.maxParallelFiles || 10;
    this.useContentHash = config.useContentHash !== false;

    // Performance metrics
    this.metrics = {
      totalAnalyses: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalAnalysisTime: 0,
      filesAnalyzed: 0,
      parallelBatches: 0
    };

    // Directory access manager
    this.directoryAccessManager = new DirectoryAccessManager(config, logger);

    // Analyzers will be initialized lazily when needed
    this.analyzers = {
      javascript: null,
      typescript: null,
      python: null,
      css: null,
      scss: null,
      less: null,
      eslint: null,
      security: null,
      config: null,
      sparrow: null  // Tree-sitter based SAST
    };

    // Formatters will be initialized lazily when needed
    this.formatters = {
      prettier: null
    };
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
Static Code Analysis Tool: Analyze code files for errors without execution

This tool performs static analysis on code files to find syntax errors, type errors, import issues, and other problems without running the code. It uses official language parsers for accurate results.

SUPPORTED LANGUAGES:
- JavaScript (.js, .jsx, .mjs, .cjs)
- TypeScript (.ts, .tsx)
- Python (.py)
- CSS (.css)
- SCSS (.scss, .sass)
- LESS (.less)

USAGE:
\`\`\`json
{
  "toolId": "staticanalysis",
  "actions": [
    {
      "type": "analyze",
      "filePath": "src/index.js"
    },
    {
      "type": "analyze-project",
      "directory": "src",
      "pattern": "**/*.{js,ts,py}"
    }
  ]
}
\`\`\`

ACTION TYPES:
- analyze: Analyze a single file
- analyze-project: Analyze all files in a directory
- fix: Auto-fix code issues
- format: Format code with Prettier
- security-scan: Scan for security vulnerabilities (uses external tools if available)
- security-scan-project: Scan entire project for security issues
- sparrow-scan: Tree-sitter based SAST scan (no external dependencies, 12 languages)
- sparrow-scan-project: Project-wide Sparrow SAST scan
- validate-config: Validate configuration files
- validate-config-directory: Validate all config files in directory
- validate-structured: Validate structured file formats (JSON, YAML, XML, TOML, INI, ENV)

STRUCTURED FILE FORMATS SUPPORTED:
JSON (.json, .jsonc, .json5), YAML (.yaml, .yml), XML (.xml), TOML (.toml), INI (.ini), ENV (.env)

SPARROW SAST LANGUAGES:
Python, JavaScript, TypeScript, Go, Java, Ruby, Rust, PHP, C#, Bash, HTML, CSS

PARAMETERS:
- filePath: Path to file to analyze (for single file actions)
- directory: Directory to analyze (for project-wide actions)
- pattern: Glob pattern for files to include (optional)
- includeWarnings: Include warnings in results (true/false, default: true)
- maxErrors: Maximum number of errors to return (default: all)
- writeFile: Write fixed/formatted content back to file (for fix/format actions)
- content: Inline content to validate (for validate-structured, requires format)
- format: Format override (json, yaml, xml, toml, ini, env) - auto-detected from filePath if not specified

EXAMPLES:

1. Analyze a single JavaScript file:
\`\`\`json
{
  "toolId": "staticanalysis",
  "actions": [{ "type": "analyze", "filePath": "src/app.js" }]
}
\`\`\`

2. Analyze all files in a directory:
\`\`\`json
{
  "toolId": "staticanalysis",
  "actions": [{ "type": "analyze-project", "directory": "src", "pattern": "**/*.js" }]
}
\`\`\`

3. Auto-fix code issues:
\`\`\`json
{
  "toolId": "staticanalysis",
  "actions": [{ "type": "fix", "filePath": "src/app.js", "writeFile": true }]
}
\`\`\`

4. Security scan a project:
\`\`\`json
{
  "toolId": "staticanalysis",
  "actions": [{ "type": "security-scan-project", "directory": "src" }]
}
\`\`\`

5. Validate a JSON/YAML/XML file structure:
\`\`\`json
{
  "toolId": "staticanalysis",
  "actions": [{ "type": "validate-structured", "filePath": "config.json" }]
}
\`\`\`

6. Validate inline content (specify format):
\`\`\`json
{
  "toolId": "staticanalysis",
  "actions": [{ "type": "validate-structured", "content": "{\"key\": \"value\"}", "format": "json" }]
}
\`\`\`

OUTPUT FORMAT:
Returns structured error information with: file, line, column, severity, rule, message, category, fixable, suggestion

LIMITATIONS:
- File size limit: ${Math.round(this.maxFileSize / 1024 / 1024)}MB per file
- Batch limit: ${this.maxFilesPerBatch} files per operation
- Analysis timeout: ${this.timeout / 1000} seconds
    `;
  }

  /**
   * Parse parameters from tool command content
   * @param {string} content - Raw tool command content
   * @returns {Object} Parsed parameters
   */
  parseParameters(content) {
    try {
      const params = {};
      const actions = [];

      this.logger?.debug('StaticAnalysis tool parsing parameters', {
        contentLength: content.length,
        contentPreview: content.substring(0, 200)
      });

      // Extract self-closing <analyze> tags
      // Pattern: <analyze ...attributes... />
      // We need to capture everything between 'analyze' and '/>' which includes file paths with /
      const analyzePattern = /<analyze\s+(.+?)\/>/g;
      let match;

      while ((match = analyzePattern.exec(content)) !== null) {
        const attributeString = match[1].trim();
        const parser = new TagParser();
        const attributes = parser.parseAttributes(attributeString);

        const action = {
          type: 'analyze',
          ...attributes
        };

        // Normalize attribute names
        if (action['file-path']) {
          action.filePath = action['file-path'];
          delete action['file-path'];
        }
        if (action['include-warnings']) {
          action.includeWarnings = action['include-warnings'] === 'true';
          delete action['include-warnings'];
        }
        if (action['max-errors']) {
          action.maxErrors = parseInt(action['max-errors'], 10);
          delete action['max-errors'];
        }

        actions.push(action);
      }

      // Extract self-closing <analyze-project> tags
      const projectPattern = /<analyze-project\s+(.+?)\/>/g;

      while ((match = projectPattern.exec(content)) !== null) {
        const attributeString = match[1].trim();
        const parser = new TagParser();
        const attributes = parser.parseAttributes(attributeString);

        const action = {
          type: 'analyze-project',
          ...attributes
        };

        // Normalize attribute names
        if (action['include-warnings']) {
          action.includeWarnings = action['include-warnings'] === 'true';
          delete action['include-warnings'];
        }
        if (action['max-errors']) {
          action.maxErrors = parseInt(action['max-errors'], 10);
          delete action['max-errors'];
        }

        actions.push(action);
      }

      // Extract self-closing <fix> tags
      const fixPattern = /<fix\s+(.+?)\/>/g;

      while ((match = fixPattern.exec(content)) !== null) {
        const attributeString = match[1].trim();
        const parser = new TagParser();
        const attributes = parser.parseAttributes(attributeString);

        const action = {
          type: 'fix',
          ...attributes
        };

        // Normalize attribute names
        if (action['file-path']) {
          action.filePath = action['file-path'];
          delete action['file-path'];
        }
        if (action['write-file']) {
          action.writeFile = action['write-file'] === 'true';
          delete action['write-file'];
        }

        actions.push(action);
      }

      // Extract self-closing <format> tags
      const formatPattern = /<format\s+(.+?)\/>/g;

      while ((match = formatPattern.exec(content)) !== null) {
        const attributeString = match[1].trim();
        const parser = new TagParser();
        const attributes = parser.parseAttributes(attributeString);

        const action = {
          type: 'format',
          ...attributes
        };

        // Normalize attribute names
        if (action['file-path']) {
          action.filePath = action['file-path'];
          delete action['file-path'];
        }
        if (action['write-file']) {
          action.writeFile = action['write-file'] === 'true';
          delete action['write-file'];
        }

        actions.push(action);
      }

      // Extract self-closing <security-scan> tags
      const securityScanPattern = /<security-scan\s+(.+?)\/>/g;

      while ((match = securityScanPattern.exec(content)) !== null) {
        const attributeString = match[1].trim();
        const parser = new TagParser();
        const attributes = parser.parseAttributes(attributeString);

        const action = {
          type: 'security-scan',
          ...attributes
        };

        // Normalize attribute names
        if (action['file-path']) {
          action.filePath = action['file-path'];
          delete action['file-path'];
        }
        if (action['skip-test-files']) {
          action.skipTestFiles = action['skip-test-files'] === 'true';
          delete action['skip-test-files'];
        }

        actions.push(action);
      }

      // Extract self-closing <security-scan-project> tags
      const securityScanProjectPattern = /<security-scan-project\s+(.+?)\/>/g;

      while ((match = securityScanProjectPattern.exec(content)) !== null) {
        const attributeString = match[1].trim();
        const parser = new TagParser();
        const attributes = parser.parseAttributes(attributeString);

        const action = {
          type: 'security-scan-project',
          ...attributes
        };

        // Normalize attribute names
        if (action['skip-test-files']) {
          action.skipTestFiles = action['skip-test-files'] === 'true';
          delete action['skip-test-files'];
        }

        actions.push(action);
      }

      // Extract self-closing <validate-config> tags
      const validateConfigPattern = /<validate-config\s+(.+?)\/>/g;

      while ((match = validateConfigPattern.exec(content)) !== null) {
        const attributeString = match[1].trim();
        const parser = new TagParser();
        const attributes = parser.parseAttributes(attributeString);

        const action = {
          type: 'validate-config',
          ...attributes
        };

        // Normalize attribute names
        if (action['file-path']) {
          action.filePath = action['file-path'];
          delete action['file-path'];
        }

        actions.push(action);
      }

      // Extract self-closing <validate-config-directory> tags
      const validateConfigDirPattern = /<validate-config-directory\s+(.+?)\/>/g;

      while ((match = validateConfigDirPattern.exec(content)) !== null) {
        const attributeString = match[1].trim();
        const parser = new TagParser();
        const attributes = parser.parseAttributes(attributeString);

        const action = {
          type: 'validate-config-directory',
          ...attributes
        };

        // Normalize attribute names (none specific yet)

        actions.push(action);
      }

      // Extract self-closing <validate-structured> tags
      const validateStructuredPattern = /<validate-structured\s+(.+?)\/>/g;

      while ((match = validateStructuredPattern.exec(content)) !== null) {
        const attributeString = match[1].trim();
        const parser = new TagParser();
        const attributes = parser.parseAttributes(attributeString);

        const action = {
          type: 'validate-structured',
          ...attributes
        };

        // Normalize attribute names
        if (action['file-path']) {
          action.filePath = action['file-path'];
          delete action['file-path'];
        }
        if (action['format']) {
          action.format = action['format'];
        }

        actions.push(action);
      }

      params.actions = actions;
      params.rawContent = content.trim();

      this.logger?.debug('Parsed StaticAnalysis tool parameters', {
        totalActions: actions.length,
        actionTypes: actions.map(a => a.type)
      });

      return params;

    } catch (error) {
      throw new Error(`Failed to parse static analysis parameters: ${error.message}`);
    }
  }

  /**
   * Get required parameters
   * @returns {Array<string>} Array of required parameter names
   */
  getRequiredParameters() {
    return ['actions'];
  }

  /**
   * Custom parameter validation
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result
   */
  customValidateParameters(params) {
    const errors = [];

    if (!params.actions || !Array.isArray(params.actions) || params.actions.length === 0) {
      errors.push('At least one action is required');
    } else {
      // Validate each action
      for (const [index, action] of params.actions.entries()) {
        if (!action.type) {
          errors.push(`Action ${index + 1}: type is required`);
          continue;
        }

        switch (action.type) {
          case 'analyze':
            if (!action.filePath) {
              errors.push(`Action ${index + 1}: file-path is required for analyze`);
            }
            break;

          case 'analyze-project':
            if (!action.directory) {
              errors.push(`Action ${index + 1}: directory is required for analyze-project`);
            }
            break;

          case 'fix':
            if (!action.filePath) {
              errors.push(`Action ${index + 1}: file-path is required for fix`);
            }
            break;

          case 'format':
            if (!action.filePath) {
              errors.push(`Action ${index + 1}: file-path is required for format`);
            }
            break;

          case 'security-scan':
            if (!action.filePath) {
              errors.push(`Action ${index + 1}: file-path is required for security-scan`);
            }
            break;

          case 'security-scan-project':
            if (!action.directory) {
              errors.push(`Action ${index + 1}: directory is required for security-scan-project`);
            }
            break;

          case 'validate-config':
            if (!action.filePath) {
              errors.push(`Action ${index + 1}: file-path is required for validate-config`);
            }
            break;

          case 'validate-config-directory':
            if (!action.directory) {
              errors.push(`Action ${index + 1}: directory is required for validate-config-directory`);
            }
            break;

          case 'sparrow-scan':
            if (!action.filePath) {
              errors.push(`Action ${index + 1}: file-path is required for sparrow-scan`);
            }
            break;

          case 'sparrow-scan-project':
            if (!action.directory) {
              errors.push(`Action ${index + 1}: directory is required for sparrow-scan-project`);
            }
            break;

          case 'validate-structured':
            if (!action.filePath && !action.content) {
              errors.push(`Action ${index + 1}: file-path or content is required for validate-structured`);
            }
            break;

          default:
            errors.push(`Action ${index + 1}: unknown action type: ${action.type}`);
        }
      }

      // Check batch size limit
      if (params.actions.length > this.maxFilesPerBatch) {
        errors.push(`Too many actions: ${params.actions.length} (max ${this.maxFilesPerBatch})`);
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
    const { actions } = params;
    const { projectDir, agentId, directoryAccess } = context;

    // Get directory access configuration
    const accessConfig = directoryAccess ||
      this.directoryAccessManager.createDirectoryAccess({
        workingDirectory: projectDir || process.cwd(),
        writeEnabledDirectories: [projectDir || process.cwd()],
        restrictToProject: true
      });

    const workingDir = this.directoryAccessManager.getWorkingDirectory(accessConfig);
    const results = {
      files: [],
      summary: {
        totalFiles: 0,
        totalErrors: 0,
        totalWarnings: 0,
        totalInfo: 0,
        errorsByCategory: {},
        filesByLanguage: {},
        filesWithErrors: 0
      }
    };

    for (const action of actions) {
      try {
        let actionResult;

        switch (action.type) {
          case 'analyze':
            actionResult = await this.analyzeFile(action.filePath, workingDir, accessConfig, action);
            if (actionResult) {
              results.files.push(actionResult);
              this.updateSummary(results.summary, actionResult);
            }
            break;

          case 'analyze-project':
            const projectFiles = await this.analyzeProject(action.directory, action.pattern, workingDir, accessConfig, action);
            results.files.push(...projectFiles);
            for (const fileResult of projectFiles) {
              this.updateSummary(results.summary, fileResult);
            }
            break;

          case 'fix':
            actionResult = await this.fixFile(action.filePath, workingDir, accessConfig, action);
            if (actionResult) {
              results.files.push(actionResult);
            }
            break;

          case 'format':
            actionResult = await this.formatFile(action.filePath, workingDir, accessConfig, action);
            if (actionResult) {
              results.files.push(actionResult);
            }
            break;

          case 'security-scan':
            actionResult = await this.securityScanFile(action.filePath, workingDir, accessConfig, action);
            if (actionResult) {
              results.files.push(actionResult);
              this.updateSummary(results.summary, actionResult);
            }
            break;

          case 'security-scan-project':
            const securityProjectFiles = await this.securityScanProject(action.directory, action.pattern, workingDir, accessConfig, action);
            results.files.push(...securityProjectFiles);
            for (const fileResult of securityProjectFiles) {
              this.updateSummary(results.summary, fileResult);
            }
            break;

          case 'validate-config':
            actionResult = await this.validateConfigFile(action.filePath, workingDir, accessConfig, action);
            if (actionResult) {
              results.files.push(actionResult);
              this.updateSummary(results.summary, actionResult);
            }
            break;

          case 'validate-config-directory':
            const configFiles = await this.validateConfigDirectory(action.directory, workingDir, accessConfig, action);
            results.files.push(...configFiles);
            for (const fileResult of configFiles) {
              this.updateSummary(results.summary, fileResult);
            }
            break;

          case 'sparrow-scan':
            actionResult = await this.sparrowScanFile(action.filePath, workingDir, accessConfig, action);
            if (actionResult) {
              results.files.push(actionResult);
              this.updateSummary(results.summary, actionResult);
            }
            break;

          case 'sparrow-scan-project':
            const sparrowResult = await this.sparrowScanProject(action.directory, action.pattern, workingDir, accessConfig, action);
            if (sparrowResult.files) {
              results.files.push(...sparrowResult.files);
              for (const fileResult of sparrowResult.files) {
                this.updateSummary(results.summary, fileResult);
              }
            }
            break;

          case 'validate-structured':
            actionResult = await this.validateStructuredFile(action.filePath, action.content, action.format, workingDir, accessConfig, action);
            if (actionResult) {
              results.files.push(actionResult);
              this.updateSummary(results.summary, actionResult);
            }
            break;

          default:
            throw new Error(`Unknown action type: ${action.type}`);
        }

      } catch (error) {
        this.logger?.error('Static analysis action failed', {
          action: action.type,
          error: error.message
        });

        results.files.push({
          file: action.filePath || action.directory,
          error: error.message,
          success: false
        });
      }
    }

    return {
      success: true,
      results,
      toolUsed: 'staticanalysis',
      performance: this.getPerformanceMetrics()
    };
  }

  /**
   * Analyze a single file
   * @private
   */
  async analyzeFile(filePath, workingDir, accessConfig, options = {}) {
    const fullPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(workingDir, filePath);

    // Validate read access
    const accessResult = this.directoryAccessManager.validateReadAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason}`);
    }

    // Check file exists
    try {
      const stats = await fs.stat(fullPath);

      if (stats.size > this.maxFileSize) {
        throw new Error(`File too large: ${stats.size} bytes (max ${this.maxFileSize})`);
      }

      // Detect language from file extension
      const language = this.detectLanguage(fullPath);

      if (!language) {
        return {
          file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
          fullPath,
          language: 'unknown',
          errors: [],
          warnings: [],
          info: [],
          skipped: true,
          skipReason: 'Unsupported file type'
        };
      }

      // Read file content
      const content = await fs.readFile(fullPath, 'utf-8');

      // Check cache (use content hash for more accurate caching)
      const contentHash = this.useContentHash ? this.computeContentHash(content) : null;
      const cacheKey = this.useContentHash
        ? `${fullPath}:${contentHash}`
        : `${fullPath}:${stats.mtime.getTime()}`;

      if (this.enableCache && this.analysisCache.has(cacheKey)) {
        const cached = this.analysisCache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheExpiry) {
          this.logger?.debug('Using cached analysis result', { file: fullPath });
          this.metrics.cacheHits++;
          this.metrics.totalAnalyses++;
          return cached.result;
        }
      }

      this.metrics.cacheMisses++;
      this.metrics.totalAnalyses++;

      // Get analyzer for language
      const analyzer = await this.getAnalyzer(language);

      if (!analyzer) {
        return {
          file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
          fullPath,
          language,
          errors: [],
          warnings: [],
          info: [],
          skipped: true,
          skipReason: `No analyzer available for ${language}`
        };
      }

      // Perform analysis with timing
      const analysisStart = Date.now();
      const diagnostics = await analyzer.analyze(fullPath, content, {
        workingDir,
        accessConfig,
        framework: await this.detectFramework(workingDir, language)
      });
      const analysisTime = Date.now() - analysisStart;

      this.metrics.totalAnalysisTime += analysisTime;
      this.metrics.filesAnalyzed++;

      // Format results
      const result = {
        file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
        fullPath,
        language,
        framework: await this.detectFramework(workingDir, language),
        errors: diagnostics.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.ERROR),
        warnings: options.includeWarnings !== false
          ? diagnostics.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.WARNING)
          : [],
        info: diagnostics.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.INFO),
        totalIssues: diagnostics.length,
        analyzed: true,
        timestamp: new Date().toISOString()
      };

      // Apply max errors limit
      if (options.maxErrors && result.errors.length > options.maxErrors) {
        result.errors = result.errors.slice(0, options.maxErrors);
        result.truncated = true;
      }

      // Cache result
      if (this.enableCache) {
        this.analysisCache.set(cacheKey, {
          result,
          timestamp: Date.now()
        });
      }

      return result;

    } catch (error) {
      throw new Error(`Failed to analyze ${filePath}: ${error.message}`);
    }
  }

  /**
   * Analyze project directory
   * @private
   */
  async analyzeProject(directory, pattern, workingDir, accessConfig, options = {}) {
    const fullDir = path.isAbsolute(directory)
      ? path.normalize(directory)
      : path.resolve(workingDir, directory);

    // Validate read access
    const accessResult = this.directoryAccessManager.validateReadAccess(fullDir, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason}`);
    }

    // Find all matching files
    const files = await this.findFiles(fullDir, pattern);

    if (files.length > this.maxFilesPerBatch) {
      throw new Error(`Too many files: ${files.length} (max ${this.maxFilesPerBatch})`);
    }

    // Analyze files (parallel or sequential based on configuration)
    const results = [];

    if (this.parallelAnalysis && files.length > 1) {
      // Parallel analysis in batches
      this.logger?.debug('Using parallel analysis', {
        totalFiles: files.length,
        batchSize: this.maxParallelFiles
      });

      for (let i = 0; i < files.length; i += this.maxParallelFiles) {
        const batch = files.slice(i, i + this.maxParallelFiles);
        this.metrics.parallelBatches++;

        // Report progress
        const progress = {
          completed: i,
          total: files.length,
          percentage: Math.round((i / files.length) * 100)
        };

        if (options.onProgress) {
          options.onProgress(progress);
        }

        this.logger?.debug('Analyzing batch', {
          batch: Math.floor(i / this.maxParallelFiles) + 1,
          filesInBatch: batch.length,
          progress: `${progress.completed}/${progress.total}`
        });

        // Analyze batch in parallel
        const batchPromises = batch.map(async (file) => {
          try {
            const result = await this.analyzeFile(file, workingDir, accessConfig, options);
            return result;
          } catch (error) {
            this.logger?.warn('Failed to analyze file in project', {
              file,
              error: error.message
            });

            return {
              file: this.directoryAccessManager.createRelativePath(file, accessConfig),
              fullPath: file,
              error: error.message,
              success: false
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(r => r !== null));
      }

      // Final progress report
      if (options.onProgress) {
        options.onProgress({
          completed: files.length,
          total: files.length,
          percentage: 100
        });
      }

    } else {
      // Sequential analysis
      for (const file of files) {
        try {
          const result = await this.analyzeFile(file, workingDir, accessConfig, options);
          if (result) {
            results.push(result);
          }
        } catch (error) {
          this.logger?.warn('Failed to analyze file in project', {
            file,
            error: error.message
          });

          results.push({
            file: this.directoryAccessManager.createRelativePath(file, accessConfig),
            fullPath: file,
            error: error.message,
            success: false
          });
        }
      }
    }

    return results;
  }

  /**
   * Fix code issues in a file
   * @private
   */
  async fixFile(filePath, workingDir, accessConfig, options = {}) {
    const fullPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(workingDir, filePath);

    // Validate read access
    const readResult = this.directoryAccessManager.validateReadAccess(fullPath, accessConfig);
    if (!readResult.allowed) {
      throw new Error(`Read access denied: ${readResult.reason}`);
    }

    // Validate write access if writeFile is true
    if (options.writeFile) {
      const writeResult = this.directoryAccessManager.validateWriteAccess(fullPath, accessConfig);
      if (!writeResult.allowed) {
        throw new Error(`Write access denied: ${writeResult.reason}`);
      }
    }

    try {
      // Read file
      const content = await fs.readFile(fullPath, 'utf-8');

      // Get ESLint analyzer
      const eslintAnalyzer = await this.getESLintAnalyzer();

      // Fix the code
      const fixResult = await eslintAnalyzer.fix(fullPath, content, {
        workingDir,
        accessConfig,
        framework: await this.detectFramework(workingDir, this.detectLanguage(fullPath))
      });

      // Write file if requested and changes were made
      if (options.writeFile && fixResult.fixed) {
        await fs.writeFile(fullPath, fixResult.content, 'utf-8');
        this.logger?.info('File fixed and written', { file: fullPath });
      }

      return {
        file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
        fullPath,
        action: 'fix',
        fixed: fixResult.fixed,
        fixedCount: fixResult.fixedCount,
        remainingErrors: fixResult.remainingErrors,
        remainingWarnings: fixResult.remainingWarnings,
        changes: fixResult.changes,
        written: !!(options.writeFile && fixResult.fixed),
        preview: !options.writeFile && fixResult.fixed ? fixResult.content : undefined
      };

    } catch (error) {
      throw new Error(`Failed to fix ${filePath}: ${error.message}`);
    }
  }

  /**
   * Format code in a file
   * @private
   */
  async formatFile(filePath, workingDir, accessConfig, options = {}) {
    const fullPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(workingDir, filePath);

    // Validate read access
    const readResult = this.directoryAccessManager.validateReadAccess(fullPath, accessConfig);
    if (!readResult.allowed) {
      throw new Error(`Read access denied: ${readResult.reason}`);
    }

    // Validate write access if writeFile is true
    if (options.writeFile) {
      const writeResult = this.directoryAccessManager.validateWriteAccess(fullPath, accessConfig);
      if (!writeResult.allowed) {
        throw new Error(`Write access denied: ${writeResult.reason}`);
      }
    }

    try {
      // Read file
      const content = await fs.readFile(fullPath, 'utf-8');

      // Get Prettier formatter
      const prettierFormatter = await this.getPrettierFormatter();

      // Check if file type is supported
      if (!prettierFormatter.isSupported(fullPath)) {
        return {
          file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
          fullPath,
          action: 'format',
          formatted: false,
          skipped: true,
          skipReason: 'File type not supported by Prettier'
        };
      }

      // Format the code
      const formatResult = await prettierFormatter.format(fullPath, content, {
        workingDir,
        accessConfig
      });

      // Write file if requested and changes were made
      if (options.writeFile && formatResult.formatted) {
        await fs.writeFile(fullPath, formatResult.content, 'utf-8');
        this.logger?.info('File formatted and written', { file: fullPath });
      }

      return {
        file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
        fullPath,
        action: 'format',
        formatted: formatResult.formatted,
        linesChanged: formatResult.linesChanged,
        changes: formatResult.changes,
        written: !!(options.writeFile && formatResult.formatted),
        preview: !options.writeFile && formatResult.formatted ? formatResult.content : undefined
      };

    } catch (error) {
      throw new Error(`Failed to format ${filePath}: ${error.message}`);
    }
  }

  /**
   * Security scan a single file
   * @private
   */
  async securityScanFile(filePath, workingDir, accessConfig, options = {}) {
    const fullPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(workingDir, filePath);

    // Validate read access
    const accessResult = this.directoryAccessManager.validateReadAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason}`);
    }

    try {
      const stats = await fs.stat(fullPath);

      if (stats.size > this.maxFileSize) {
        throw new Error(`File too large: ${stats.size} bytes (max ${this.maxFileSize})`);
      }

      // Detect language
      const language = this.detectLanguage(fullPath);

      // Security analyzer only supports JS/TS/Python
      if (!language || !['javascript', 'typescript', 'python'].includes(language)) {
        return {
          file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
          fullPath,
          language: language || 'unknown',
          issues: [],
          skipped: true,
          skipReason: 'Security scanning only supports JavaScript, TypeScript, and Python files'
        };
      }

      // Read file content
      const content = await fs.readFile(fullPath, 'utf-8');

      // Get security analyzer
      const securityAnalyzer = await this.getSecurityAnalyzer();

      // Perform security scan
      const issues = await securityAnalyzer.analyze(fullPath, content, {
        skipTestFiles: options.skipTestFiles !== false
      });

      // Categorize issues by severity
      const result = {
        file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
        fullPath,
        language,
        action: 'security-scan',
        critical: issues.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.CRITICAL),
        errors: issues.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.ERROR),
        warnings: issues.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.WARNING),
        info: issues.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.INFO),
        totalIssues: issues.length,
        analyzed: true,
        scannersUsed: issues.map(i => i.scanner).filter((v, i, a) => a.indexOf(v) === i),
        timestamp: new Date().toISOString()
      };

      return result;

    } catch (error) {
      throw new Error(`Failed to security scan ${filePath}: ${error.message}`);
    }
  }

  /**
   * Security scan project directory
   * @private
   */
  async securityScanProject(directory, pattern, workingDir, accessConfig, options = {}) {
    const fullDir = path.isAbsolute(directory)
      ? path.normalize(directory)
      : path.resolve(workingDir, directory);

    // Validate read access
    const accessResult = this.directoryAccessManager.validateReadAccess(fullDir, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason}`);
    }

    // Get security analyzer for dependency scanning
    const securityAnalyzer = await this.getSecurityAnalyzer();

    // Run dependency scans at project level
    const dependencyIssues = await securityAnalyzer.analyzeProject(fullDir, 'javascript', options);

    // Find all matching files (only JS/TS/Python for security scanning)
    const searchPattern = pattern || '**/*.{js,jsx,mjs,cjs,ts,tsx,py}';
    const files = await this.findFiles(fullDir, searchPattern);

    if (files.length > this.maxFilesPerBatch) {
      throw new Error(`Too many files: ${files.length} (max ${this.maxFilesPerBatch})`);
    }

    // Scan files (parallel or sequential)
    const results = [];

    if (this.parallelAnalysis && files.length > 1) {
      // Parallel scanning in batches
      this.logger?.debug('Using parallel security scanning', {
        totalFiles: files.length,
        batchSize: this.maxParallelFiles
      });

      for (let i = 0; i < files.length; i += this.maxParallelFiles) {
        const batch = files.slice(i, i + this.maxParallelFiles);

        if (options.onProgress) {
          options.onProgress({
            completed: i,
            total: files.length,
            percentage: Math.round((i / files.length) * 100)
          });
        }

        const batchPromises = batch.map(async (file) => {
          try {
            return await this.securityScanFile(file, workingDir, accessConfig, options);
          } catch (error) {
            this.logger?.warn('Failed to security scan file in project', {
              file,
              error: error.message
            });

            return {
              file: this.directoryAccessManager.createRelativePath(file, accessConfig),
              fullPath: file,
              error: error.message,
              success: false
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(r => r !== null));
      }

      if (options.onProgress) {
        options.onProgress({
          completed: files.length,
          total: files.length,
          percentage: 100
        });
      }

    } else {
      // Sequential scanning
      for (const file of files) {
        try {
          const result = await this.securityScanFile(file, workingDir, accessConfig, options);
          if (result) {
            results.push(result);
          }
        } catch (error) {
          this.logger?.warn('Failed to security scan file in project', {
            file,
            error: error.message
          });

          results.push({
            file: this.directoryAccessManager.createRelativePath(file, accessConfig),
            fullPath: file,
            error: error.message,
            success: false
          });
        }
      }
    }

    // Add dependency scan results if any
    if (dependencyIssues.length > 0) {
      results.push({
        file: path.join(fullDir, 'package.json'),
        fullPath: path.join(fullDir, 'package.json'),
        action: 'dependency-scan',
        critical: dependencyIssues.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.CRITICAL),
        errors: dependencyIssues.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.ERROR),
        warnings: dependencyIssues.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.WARNING),
        info: dependencyIssues.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.INFO),
        totalIssues: dependencyIssues.length,
        analyzed: true,
        scannersUsed: ['npm-audit'],
        timestamp: new Date().toISOString()
      });
    }

    return results;
  }

  /**
   * Get Sparrow analyzer (lazy initialization)
   * @private
   */
  async getSparrowAnalyzer() {
    if (!this.analyzers.sparrow) {
      const SparrowAnalyzer = (await import('../analyzers/SparrowAnalyzer.js')).default;
      this.analyzers.sparrow = new SparrowAnalyzer(this.logger);
    }
    return this.analyzers.sparrow;
  }

  /**
   * Sparrow SAST scan for a single file (tree-sitter based, no external dependencies)
   * @private
   */
  async sparrowScanFile(filePath, workingDir, accessConfig, options = {}) {
    const fullPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(workingDir, filePath);

    // Validate read access
    const accessResult = this.directoryAccessManager.validateReadAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason}`);
    }

    try {
      const stats = await fs.stat(fullPath);

      if (stats.size > this.maxFileSize) {
        throw new Error(`File too large: ${stats.size} bytes (max ${this.maxFileSize})`);
      }

      // Get Sparrow analyzer
      const sparrowAnalyzer = await this.getSparrowAnalyzer();

      // Check if file is supported
      if (!sparrowAnalyzer.isSupported(fullPath)) {
        return {
          file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
          fullPath,
          action: 'sparrow-scan',
          skipped: true,
          reason: 'Unsupported file type for Sparrow SAST',
          analyzed: false,
          timestamp: new Date().toISOString()
        };
      }

      // Perform Sparrow scan
      const scanResult = await sparrowAnalyzer.scanFile(fullPath, {
        useBuiltinCheckers: options.useBuiltinCheckers !== false,
        enabledCheckers: options.enabledCheckers,
        disabledCheckers: options.disabledCheckers
      });

      if (!scanResult.success) {
        throw new Error(scanResult.error || 'Sparrow scan failed');
      }

      // Categorize issues by severity
      const result = {
        file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
        fullPath,
        action: 'sparrow-scan',
        critical: scanResult.issues.filter(i => i.severity === 'critical'),
        errors: scanResult.issues.filter(i => i.severity === 'error'),
        warnings: scanResult.issues.filter(i => i.severity === 'warning'),
        info: scanResult.issues.filter(i => i.severity === 'info'),
        totalIssues: scanResult.issues.length,
        analyzed: true,
        scanner: 'sparrow',
        executionTime: scanResult.executionTime,
        timestamp: new Date().toISOString()
      };

      return result;

    } catch (error) {
      this.logger?.error('Sparrow scan file failed', { file: fullPath, error: error.message });
      return {
        file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
        fullPath,
        action: 'sparrow-scan',
        error: error.message,
        analyzed: false,
        success: false,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Sparrow SAST scan for a project directory (tree-sitter based, no external dependencies)
   * @private
   */
  async sparrowScanProject(directory, pattern, workingDir, accessConfig, options = {}) {
    const fullDir = path.isAbsolute(directory)
      ? path.normalize(directory)
      : path.resolve(workingDir, directory);

    // Validate read access
    const accessResult = this.directoryAccessManager.validateReadAccess(fullDir, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason}`);
    }

    try {
      // Get Sparrow analyzer
      const sparrowAnalyzer = await this.getSparrowAnalyzer();

      // Run project scan with Sparrow
      const scanResult = await sparrowAnalyzer.scanProject(fullDir, {
        useBuiltinCheckers: options.useBuiltinCheckers !== false,
        enabledCheckers: options.enabledCheckers,
        disabledCheckers: options.disabledCheckers,
        excludePatterns: options.excludePatterns,
        languages: options.languages
      });

      if (!scanResult.success) {
        throw new Error(scanResult.error || 'Sparrow project scan failed');
      }

      // Transform file results to standard format
      const results = scanResult.files.map(fileResult => ({
        file: this.directoryAccessManager.createRelativePath(fileResult.file, accessConfig),
        fullPath: fileResult.file,
        action: 'sparrow-scan',
        critical: fileResult.issues.filter(i => i.severity === 'critical'),
        errors: fileResult.issues.filter(i => i.severity === 'error'),
        warnings: fileResult.issues.filter(i => i.severity === 'warning'),
        info: fileResult.issues.filter(i => i.severity === 'info'),
        totalIssues: fileResult.issues.length,
        analyzed: true,
        scanner: 'sparrow',
        timestamp: new Date().toISOString()
      }));

      return {
        success: true,
        files: results,
        summary: scanResult.summary,
        executionTime: scanResult.executionTime
      };

    } catch (error) {
      this.logger?.error('Sparrow project scan failed', { directory: fullDir, error: error.message });
      return {
        success: false,
        files: [],
        error: error.message
      };
    }
  }

  /**
   * Validate a configuration file
   * @private
   */
  async validateConfigFile(filePath, workingDir, accessConfig, options = {}) {
    const fullPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(workingDir, filePath);

    // Validate read access
    const accessResult = this.directoryAccessManager.validateReadAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason}`);
    }

    try {
      const stats = await fs.stat(fullPath);

      if (stats.size > this.maxFileSize) {
        throw new Error(`File too large: ${stats.size} bytes (max ${this.maxFileSize})`);
      }

      // Get config validator
      const configValidator = await this.getConfigValidator();

      // Perform validation
      const issues = await configValidator.validate(fullPath, options);

      // Categorize issues by severity
      const result = {
        file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
        fullPath,
        action: 'validate-config',
        critical: issues.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.CRITICAL),
        errors: issues.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.ERROR),
        warnings: issues.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.WARNING),
        info: issues.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.INFO),
        totalIssues: issues.length,
        analyzed: true,
        validatorsUsed: issues.map(i => i.validator).filter((v, i, a) => a.indexOf(v) === i),
        timestamp: new Date().toISOString()
      };

      return result;

    } catch (error) {
      throw new Error(`Failed to validate config ${filePath}: ${error.message}`);
    }
  }

  /**
   * Validate configuration files in a directory
   * @private
   */
  async validateConfigDirectory(directory, workingDir, accessConfig, options = {}) {
    const fullDir = path.isAbsolute(directory)
      ? path.normalize(directory)
      : path.resolve(workingDir, directory);

    // Validate read access
    const accessResult = this.directoryAccessManager.validateReadAccess(fullDir, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason}`);
    }

    // Find common config files
    const configFiles = await this.findConfigFiles(fullDir);

    if (configFiles.length > this.maxFilesPerBatch) {
      throw new Error(`Too many config files: ${configFiles.length} (max ${this.maxFilesPerBatch})`);
    }

    // Validate files
    const results = [];

    for (const file of configFiles) {
      try {
        const result = await this.validateConfigFile(file, workingDir, accessConfig, options);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        this.logger?.warn('Failed to validate config file', {
          file,
          error: error.message
        });

        results.push({
          file: this.directoryAccessManager.createRelativePath(file, accessConfig),
          fullPath: file,
          error: error.message,
          success: false
        });
      }
    }

    return results;
  }

  /**
   * Validate a structured file (JSON, YAML, XML, TOML, etc.)
   * Uses the pluggable structuredFileValidator utility
   * @private
   */
  async validateStructuredFile(filePath, content, format, workingDir, accessConfig, options = {}) {
    // If content is provided directly, validate it
    if (content && format) {
      const validationResult = validateContent(content, format, { returnParsed: options.returnParsed });

      return {
        file: filePath || '<inline-content>',
        fullPath: null,
        action: 'validate-structured',
        format: validationResult.format,
        valid: validationResult.valid,
        errors: validationResult.errors.filter(e => e.severity === 'error').map(e => ({
          line: e.line,
          column: e.column,
          message: e.message,
          severity: STATIC_ANALYSIS.SEVERITY.ERROR,
          category: 'structure'
        })),
        warnings: validationResult.errors.filter(e => e.severity === 'warning').map(e => ({
          line: e.line,
          column: e.column,
          message: e.message,
          severity: STATIC_ANALYSIS.SEVERITY.WARNING,
          category: 'structure'
        })),
        info: [],
        totalIssues: validationResult.errors.length,
        analyzed: true,
        supportedFormats: getSupportedFormats(),
        timestamp: new Date().toISOString()
      };
    }

    // Otherwise, validate from file path
    if (!filePath) {
      throw new Error('Either filePath or content+format must be provided');
    }

    const fullPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(workingDir, filePath);

    // Validate read access
    const accessResult = this.directoryAccessManager.validateReadAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason}`);
    }

    try {
      const stats = await fs.stat(fullPath);

      if (stats.size > this.maxFileSize) {
        throw new Error(`File too large: ${stats.size} bytes (max ${this.maxFileSize})`);
      }

      // Detect format if not provided
      const detectedFormat = format || detectFormat(fullPath);

      if (!detectedFormat) {
        return {
          file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
          fullPath,
          action: 'validate-structured',
          format: 'unknown',
          valid: false,
          errors: [{
            message: `Cannot detect format for file: ${filePath}. Supported: ${getSupportedFormats().join(', ')}`,
            severity: STATIC_ANALYSIS.SEVERITY.ERROR,
            category: 'structure'
          }],
          warnings: [],
          info: [],
          totalIssues: 1,
          analyzed: false,
          supportedFormats: getSupportedFormats(),
          timestamp: new Date().toISOString()
        };
      }

      // Read and validate file
      const fileContent = await fs.readFile(fullPath, 'utf-8');
      const validationResult = validateContent(fileContent, detectedFormat, { returnParsed: options.returnParsed });

      return {
        file: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
        fullPath,
        action: 'validate-structured',
        format: validationResult.format,
        valid: validationResult.valid,
        errors: validationResult.errors.filter(e => e.severity === 'error').map(e => ({
          line: e.line,
          column: e.column,
          message: e.message,
          severity: STATIC_ANALYSIS.SEVERITY.ERROR,
          category: 'structure'
        })),
        warnings: validationResult.errors.filter(e => e.severity === 'warning').map(e => ({
          line: e.line,
          column: e.column,
          message: e.message,
          severity: STATIC_ANALYSIS.SEVERITY.WARNING,
          category: 'structure'
        })),
        info: [],
        totalIssues: validationResult.errors.length,
        analyzed: true,
        supportedFormats: getSupportedFormats(),
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      throw new Error(`Failed to validate structured file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Find common configuration files in directory
   * @private
   */
  async findConfigFiles(directory) {
    const files = [];
    const configFileNames = [
      'package.json',
      'tsconfig.json',
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
      '.env',
      '.env.example',
      '.eslintrc.js',
      '.eslintrc.json',
      '.prettierrc',
      '.prettierrc.json'
    ];

    const configExtensions = ['.yml', '.yaml', '.json', '.tf', '.tfvars'];

    const walk = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Check specific directories for config files
          if (entry.name === '.github' || entry.name === 'kubernetes' || entry.name === 'k8s' || entry.name === 'terraform') {
            await walk(fullPath);
          } else if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
            // Don't recurse into all subdirectories, only known config dirs
            // Check this level only
            continue;
          }
        } else if (entry.isFile()) {
          // Check if it's a known config file
          if (configFileNames.includes(entry.name)) {
            files.push(fullPath);
          } else {
            // Check if it's in a config directory with config extension
            const ext = path.extname(entry.name).toLowerCase();
            if (configExtensions.includes(ext)) {
              const dirname = path.basename(path.dirname(fullPath));
              if (dirname === 'kubernetes' || dirname === 'k8s' || dirname === 'terraform' || dirname === 'workflows') {
                files.push(fullPath);
              }
            }
          }
        }
      }
    };

    await walk(directory);
    return files;
  }

  /**
   * Detect programming language from file extension
   * @private
   */
  detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return STATIC_ANALYSIS.EXTENSION_TO_LANGUAGE[ext] || null;
  }

  /**
   * Detect framework from project directory
   * @private
   */
  async detectFramework(projectDir, language) {
    try {
      if (language === STATIC_ANALYSIS.LANGUAGE.JAVASCRIPT ||
          language === STATIC_ANALYSIS.LANGUAGE.TYPESCRIPT) {
        return await this.detectJSFramework(projectDir);
      }

      if (language === STATIC_ANALYSIS.LANGUAGE.PYTHON) {
        return await this.detectPythonFramework(projectDir);
      }

      return null;
    } catch (error) {
      this.logger?.debug('Framework detection failed', { error: error.message });
      return null;
    }
  }

  /**
   * Detect JavaScript/TypeScript framework
   * @private
   */
  async detectJSFramework(projectDir) {
    try {
      const pkgPath = path.join(projectDir, STATIC_ANALYSIS.FRAMEWORK_MANIFESTS.JAVASCRIPT);
      const pkgContent = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);

      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies
      };

      // Check for frameworks in priority order
      for (const [name, identifier] of Object.entries(STATIC_ANALYSIS.JS_FRAMEWORKS)) {
        if (deps[identifier]) {
          return name.toLowerCase();
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Detect Python framework
   * @private
   */
  async detectPythonFramework(projectDir) {
    try {
      // Try requirements.txt
      const reqPath = path.join(projectDir, STATIC_ANALYSIS.FRAMEWORK_MANIFESTS.PYTHON);
      const reqContent = await fs.readFile(reqPath, 'utf-8');

      // Check for frameworks
      for (const [name, identifier] of Object.entries(STATIC_ANALYSIS.PYTHON_FRAMEWORKS)) {
        if (reqContent.toLowerCase().includes(identifier)) {
          return name.toLowerCase();
        }
      }

      return null;
    } catch (error) {
      // Try pyproject.toml
      try {
        const tomlPath = path.join(projectDir, STATIC_ANALYSIS.FRAMEWORK_MANIFESTS.PYTHON_POETRY);
        const tomlContent = await fs.readFile(tomlPath, 'utf-8');

        for (const [name, identifier] of Object.entries(STATIC_ANALYSIS.PYTHON_FRAMEWORKS)) {
          if (tomlContent.toLowerCase().includes(identifier)) {
            return name.toLowerCase();
          }
        }
      } catch {
        // No framework detected
      }

      return null;
    }
  }

  /**
   * Find files matching pattern in directory
   * @private
   */
  async findFiles(directory, pattern) {
    const files = [];

    // Default patterns by language if not specified
    const searchPattern = pattern || '**/*.{js,jsx,mjs,cjs,ts,tsx,py,css,scss,sass,less}';

    // Parse pattern to extract extensions
    // Supports patterns like "**/*.ts", "**/*.{js,ts}", "*.js", etc.
    const getExtensionsFromPattern = (pat) => {
      const exts = [];

      // Match patterns like *.{js,ts,tsx} or *.js
      const bracesMatch = pat.match(/\*\.\{([^}]+)\}/);
      if (bracesMatch) {
        // Multiple extensions: *.{js,ts,tsx}
        const extList = bracesMatch[1].split(',').map(e => e.trim());
        extList.forEach(ext => exts.push(ext.startsWith('.') ? ext : '.' + ext));
      } else {
        // Single extension: *.js or **/*.ts
        const singleMatch = pat.match(/\*\.([a-z]+)$/i);
        if (singleMatch) {
          const ext = singleMatch[1];
          exts.push(ext.startsWith('.') ? ext : '.' + ext);
        }
      }

      // If no pattern found, allow all supported extensions
      if (exts.length === 0) {
        return null; // null means "all supported extensions"
      }

      return exts;
    };

    const allowedExtensions = getExtensionsFromPattern(searchPattern);

    // Simple recursive file search
    const walk = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip common ignore directories
          if (!['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv'].includes(entry.name)) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();

          // Check if file extension is supported
          if (STATIC_ANALYSIS.EXTENSION_TO_LANGUAGE[ext]) {
            // If pattern specified, check if extension matches
            if (allowedExtensions === null || allowedExtensions.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      }
    };

    await walk(directory);
    return files;
  }

  /**
   * Get analyzer for language (lazy initialization)
   * @private
   */
  async getAnalyzer(language) {
    try {
      // Lazy load analyzers
      if (language === STATIC_ANALYSIS.LANGUAGE.JAVASCRIPT) {
        if (!this.analyzers.javascript) {
          const { default: JavaScriptAnalyzer } = await import('../analyzers/JavaScriptAnalyzer.js');
          this.analyzers.javascript = new JavaScriptAnalyzer(this.logger);
        }
        return this.analyzers.javascript;
      }

      if (language === STATIC_ANALYSIS.LANGUAGE.TYPESCRIPT) {
        if (!this.analyzers.typescript) {
          const { default: TypeScriptAnalyzer } = await import('../analyzers/TypeScriptAnalyzer.js');
          this.analyzers.typescript = new TypeScriptAnalyzer(this.logger);
        }
        return this.analyzers.typescript;
      }

      // Python analyzer
      if (language === STATIC_ANALYSIS.LANGUAGE.PYTHON) {
        if (!this.analyzers.python) {
          const { default: PythonAnalyzer } = await import('../analyzers/PythonAnalyzer.js');
          this.analyzers.python = new PythonAnalyzer(this.logger);
        }
        return this.analyzers.python;
      }

      // CSS analyzer (handles CSS, SCSS, LESS)
      if (language === STATIC_ANALYSIS.LANGUAGE.CSS ||
          language === STATIC_ANALYSIS.LANGUAGE.SCSS ||
          language === STATIC_ANALYSIS.LANGUAGE.LESS) {
        if (!this.analyzers.css) {
          const { default: CSSAnalyzer } = await import('../analyzers/CSSAnalyzer.js');
          this.analyzers.css = new CSSAnalyzer(this.logger);
        }
        return this.analyzers.css;
      }

      return null;
    } catch (error) {
      this.logger?.error('Failed to load analyzer', {
        language,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get ESLint analyzer (lazy initialization)
   * @private
   */
  async getESLintAnalyzer() {
    if (!this.analyzers.eslint) {
      const { default: ESLintAnalyzer } = await import('../analyzers/ESLintAnalyzer.js');
      this.analyzers.eslint = new ESLintAnalyzer(this.logger);
    }
    return this.analyzers.eslint;
  }

  /**
   * Get Prettier formatter (lazy initialization)
   * @private
   */
  async getPrettierFormatter() {
    if (!this.formatters.prettier) {
      const { default: PrettierFormatter } = await import('../analyzers/PrettierFormatter.js');
      this.formatters.prettier = new PrettierFormatter(this.logger);
    }
    return this.formatters.prettier;
  }

  /**
   * Get Security analyzer (lazy initialization)
   * @private
   */
  async getSecurityAnalyzer() {
    if (!this.analyzers.security) {
      const { default: SecurityAnalyzer } = await import('../analyzers/SecurityAnalyzer.js');
      this.analyzers.security = new SecurityAnalyzer(this.logger);
    }
    return this.analyzers.security;
  }

  /**
   * Get Config validator (lazy initialization)
   * @private
   */
  async getConfigValidator() {
    if (!this.analyzers.config) {
      const { default: ConfigValidator } = await import('../analyzers/ConfigValidator.js');
      this.analyzers.config = new ConfigValidator(this.logger);
    }
    return this.analyzers.config;
  }

  /**
   * Update summary statistics
   * @private
   */
  updateSummary(summary, fileResult) {
    if (fileResult.analyzed) {
      summary.totalFiles++;

      const criticalCount = fileResult.critical?.length || 0;
      const errorCount = fileResult.errors?.length || 0;
      const warningCount = fileResult.warnings?.length || 0;
      const infoCount = fileResult.info?.length || 0;

      // Initialize totalCritical if not exists (for backward compatibility)
      if (summary.totalCritical === undefined) {
        summary.totalCritical = 0;
      }

      summary.totalCritical += criticalCount;
      summary.totalErrors += errorCount;
      summary.totalWarnings += warningCount;
      summary.totalInfo += infoCount;

      if (criticalCount > 0 || errorCount > 0) {
        summary.filesWithErrors++;
      }

      // Count by language
      if (fileResult.language) {
        summary.filesByLanguage[fileResult.language] =
          (summary.filesByLanguage[fileResult.language] || 0) + 1;
      }

      // Count by category (include critical issues)
      const allIssues = [
        ...(fileResult.critical || []),
        ...(fileResult.errors || []),
        ...(fileResult.warnings || [])
      ];

      for (const issue of allIssues) {
        if (issue.category) {
          summary.errorsByCategory[issue.category] =
            (summary.errorsByCategory[issue.category] || 0) + 1;
        }
      }
    }
  }

  /**
   * Compute content hash for caching
   * @private
   */
  computeContentHash(content) {
    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex')
      .substring(0, 16); // Use first 16 chars for shorter cache keys
  }

  /**
   * Get performance metrics
   * @returns {Object} Performance metrics
   */
  getPerformanceMetrics() {
    const cacheHitRate = this.metrics.totalAnalyses > 0
      ? (this.metrics.cacheHits / this.metrics.totalAnalyses) * 100
      : 0;

    const avgAnalysisTime = this.metrics.filesAnalyzed > 0
      ? this.metrics.totalAnalysisTime / this.metrics.filesAnalyzed
      : 0;

    return {
      ...this.metrics,
      cacheHitRate: Math.round(cacheHitRate * 10) / 10, // Round to 1 decimal
      averageAnalysisTime: Math.round(avgAnalysisTime),
      cacheSize: this.analysisCache.size
    };
  }

  /**
   * Reset performance metrics
   */
  resetPerformanceMetrics() {
    this.metrics = {
      totalAnalyses: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalAnalysisTime: 0,
      filesAnalyzed: 0,
      parallelBatches: 0
    };
  }

  /**
   * Clear analysis cache
   */
  clearCache() {
    this.analysisCache.clear();
    this.logger?.debug('Analysis cache cleared');
  }

  /**
   * Get supported actions for this tool
   * @returns {Array<string>} Array of supported action names
   */
  getSupportedActions() {
    return [
      'analyze', 'analyze-project', 'fix', 'format',
      'security-scan', 'security-scan-project',
      'sparrow-scan', 'sparrow-scan-project',  // Tree-sitter based SAST
      'validate-config', 'validate-config-directory',
      'validate-structured'  // JSON, YAML, XML, TOML, INI, ENV validation
    ];
  }

  /**
   * Get parameter schema for validation
   * @returns {Object} Parameter schema
   */
  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: this.getSupportedActions()
              },
              filePath: { type: 'string' },
              directory: { type: 'string' },
              pattern: { type: 'string' },
              includeWarnings: { type: 'boolean' },
              maxErrors: { type: 'number' }
            },
            required: ['type']
          }
        }
      },
      required: ['actions']
    };
  }
}

export default StaticAnalysisTool;
