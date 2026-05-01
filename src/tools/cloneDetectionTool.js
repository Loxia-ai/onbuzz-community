/**
 * CloneDetectionTool - Detect duplicated code (code clones) for refactoring
 *
 * Purpose:
 * - Identify exact and similar code clones across the codebase
 * - Provide refactoring recommendations with priorities
 * - Help reduce technical debt and improve maintainability
 * - Support JavaScript, TypeScript, JSX, TSX, Vue files
 */

import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';
import DirectoryAccessManager from '../utilities/directoryAccessManager.js';
import path from 'path';

import {
  TOOL_STATUS,
  SYSTEM_DEFAULTS
} from '../utilities/constants.js';

class CloneDetectionTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    // Tool metadata
    this.requiresProject = true;
    this.isAsync = true; // Run async to avoid blocking the event loop
    this.timeout = config.timeout || 300000; // 5 minutes default (increased for large projects)
    this.maxConcurrentOperations = config.maxConcurrentOperations || 1;

    // Clone detection settings
    this.defaultMinTokens = config.defaultMinTokens || 50;
    this.defaultMinLines = config.defaultMinLines || 5;
    this.defaultSimilarityThreshold = config.defaultSimilarityThreshold || 0.85;
    this.maxFileSize = config.maxFileSize || 500000; // 500KB per file

    // Directory access manager
    this.directoryAccessManager = new DirectoryAccessManager(config, logger);

    // Clone detector will be initialized lazily when needed
    this.cloneDetector = null;
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
Code Clone Detection Tool: Find duplicated code for refactoring opportunities

This tool identifies exact and similar code patterns (code clones) across your codebase to help reduce duplication, improve maintainability, and identify refactoring opportunities.

WHAT IT DETECTS:
- Exact Clones (Type 1): Identical code with different formatting/comments
- Similar Clones (Type 2/3): Structurally similar code with minor variations

SUPPORTED LANGUAGES:
- JavaScript (.js, .jsx, .mjs, .cjs)
- TypeScript (.ts, .tsx)
- Vue (.vue)

USAGE:
\`\`\`json
{
  "toolId": "clonedetection",
  "actions": [
    {
      "type": "detect-clones",
      "directory": "src",
      "minTokens": 50,
      "minLines": 5,
      "similarityThreshold": 0.85,
      "priorityFilter": "high",
      "maxResults": 10,
      "outputMode": "summary"
    }
  ]
}
\`\`\`

PARAMETERS:
- directory: Directory to analyze (required)
- minTokens: Minimum token count (default: 50, lower = more sensitive)
- minLines: Minimum line count (default: 5)
- similarityThreshold: 0-1 similarity threshold (default: 0.85)
- priorityFilter: Filter by priority (high/medium/low, optional)
- maxResults: Maximum number of clones to return (optional)
- outputMode: summary|detailed|recommendations (default: detailed)

EXAMPLES:

1. Find all clones in project:
\`\`\`json
{
  "toolId": "clonedetection",
  "actions": [{ "type": "detect-clones", "directory": "." }]
}
\`\`\`

2. High-priority refactoring opportunities only:
\`\`\`json
{
  "toolId": "clonedetection",
  "actions": [{ "type": "detect-clones", "directory": "src", "priorityFilter": "high", "maxResults": 10 }]
}
\`\`\`

3. More sensitive detection (finds smaller clones):
\`\`\`json
{
  "toolId": "clonedetection",
  "actions": [{ "type": "detect-clones", "directory": ".", "minTokens": 30, "similarityThreshold": 0.80 }]
}
\`\`\`

4. Quick overview:
\`\`\`json
{
  "toolId": "clonedetection",
  "actions": [{ "type": "detect-clones", "directory": ".", "outputMode": "summary" }]
}
\`\`\`

OUTPUT FORMAT:
Returns clone detection results with:
- summary: Overall statistics (total clones, duplication %, priority breakdown)
- clones: Array of detected clone groups with:
  - id, type, confidence, instances, metrics
  - refactoringAdvice: priority, strategy, suggestedName, reasoning, actionableSteps

OUTPUT MODES:
- summary: High-level overview only (duplication %, top 5 clones)
- detailed: Full clone details with code snippets (default)
- recommendations: Refactoring priorities with actionable steps

LIMITATIONS:
- Analyzes JavaScript/TypeScript family only
- Maximum file size: ${Math.round(this.maxFileSize / 1024)}KB per file
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

      this.logger?.debug('CloneDetection tool parsing parameters', {
        contentLength: content.length,
        contentPreview: content.substring(0, 200)
      });

      // Extract self-closing <detect-clones> tags
      const detectClonesPattern = /<detect-clones\s+(.+?)\/>/g;
      let match;

      while ((match = detectClonesPattern.exec(content)) !== null) {
        const attributeString = match[1].trim();
        const parser = new TagParser();
        const attributes = parser.parseAttributes(attributeString);

        const action = {
          type: 'detect-clones',
          ...attributes
        };

        // Normalize attribute names
        if (action['min-tokens']) {
          action.minTokens = parseInt(action['min-tokens'], 10);
          delete action['min-tokens'];
        }
        if (action['min-lines']) {
          action.minLines = parseInt(action['min-lines'], 10);
          delete action['min-lines'];
        }
        if (action['similarity-threshold']) {
          action.similarityThreshold = parseFloat(action['similarity-threshold']);
          delete action['similarity-threshold'];
        }
        if (action['priority-filter']) {
          action.priorityFilter = action['priority-filter'];
          delete action['priority-filter'];
        }
        if (action['max-results']) {
          action.maxResults = parseInt(action['max-results'], 10);
          delete action['max-results'];
        }
        if (action['output-mode']) {
          action.outputMode = action['output-mode'];
          delete action['output-mode'];
        }

        actions.push(action);
      }

      params.actions = actions;
      params.rawContent = content.trim();

      this.logger?.debug('Parsed CloneDetection tool parameters', {
        totalActions: actions.length,
        actionTypes: actions.map(a => a.type)
      });

      return params;

    } catch (error) {
      throw new Error(`Failed to parse clone detection parameters: ${error.message}`);
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

        if (action.type === 'detect-clones') {
          if (!action.directory) {
            errors.push(`Action ${index + 1}: directory is required for detect-clones`);
          }

          // Validate numeric parameters
          if (action.minTokens !== undefined && (action.minTokens < 10 || action.minTokens > 1000)) {
            errors.push(`Action ${index + 1}: min-tokens must be between 10 and 1000`);
          }

          if (action.minLines !== undefined && (action.minLines < 1 || action.minLines > 100)) {
            errors.push(`Action ${index + 1}: min-lines must be between 1 and 100`);
          }

          if (action.similarityThreshold !== undefined &&
              (action.similarityThreshold < 0.5 || action.similarityThreshold > 1.0)) {
            errors.push(`Action ${index + 1}: similarity-threshold must be between 0.5 and 1.0`);
          }

          // Validate enum parameters
          if (action.priorityFilter && !['high', 'medium', 'low'].includes(action.priorityFilter)) {
            errors.push(`Action ${index + 1}: priority-filter must be high, medium, or low`);
          }

          if (action.outputMode && !['summary', 'detailed', 'recommendations'].includes(action.outputMode)) {
            errors.push(`Action ${index + 1}: output-mode must be summary, detailed, or recommendations`);
          }
        } else {
          errors.push(`Action ${index + 1}: unknown action type: ${action.type}`);
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
    const { actions } = params;
    const { projectDir, agentId, directoryAccess } = context;

    // Get directory access configuration
    const accessConfig = directoryAccess ||
      this.directoryAccessManager.createDirectoryAccess({
        workingDirectory: projectDir || process.cwd(),
        writeEnabledDirectories: [],
        readOnlyDirectories: [projectDir || process.cwd()],
        restrictToProject: true
      });

    const workingDir = this.directoryAccessManager.getWorkingDirectory(accessConfig);
    const results = [];

    for (const action of actions) {
      try {
        if (action.type === 'detect-clones') {
          const result = await this.detectClones(
            action.directory,
            workingDir,
            accessConfig,
            action
          );
          results.push(result);
        } else {
          throw new Error(`Unknown action type: ${action.type}`);
        }

      } catch (error) {
        this.logger?.error('Clone detection action failed', {
          action: action.type,
          error: error.message
        });

        results.push({
          directory: action.directory,
          error: error.message,
          success: false
        });
      }
    }

    return {
      success: true,
      results,
      toolUsed: 'clonedetection'
    };
  }

  /**
   * Detect clones in directory
   * @private
   */
  async detectClones(directory, workingDir, accessConfig, options = {}) {
    const fullDir = path.isAbsolute(directory)
      ? path.normalize(directory)
      : path.resolve(workingDir, directory);

    // Validate read access
    const accessResult = this.directoryAccessManager.validateReadAccess(fullDir, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason}`);
    }

    try {
      // Get clone detector instance
      const detector = await this.getCloneDetector();

      // Prepare configuration
      const config = {
        minTokens: options.minTokens || this.defaultMinTokens,
        minLines: options.minLines || this.defaultMinLines,
        similarityThreshold: options.similarityThreshold || this.defaultSimilarityThreshold,
        include: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs', '**/*.ts', '**/*.tsx', '**/*.vue'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.js', '**/*.spec.js'],
        maxFileSize: this.maxFileSize
      };

      this.logger?.info('Starting clone detection', {
        directory: fullDir,
        config
      });

      // Run clone detection (without output file)
      const report = await detector.run(fullDir, null);

      if (!report) {
        return {
          directory: this.directoryAccessManager.createRelativePath(fullDir, accessConfig),
          fullPath: fullDir,
          success: true,
          summary: {
            totalFiles: 0,
            totalClones: 0,
            duplicationPercentage: 0
          },
          clones: [],
          message: 'No files found or no clones detected'
        };
      }

      // Apply filters
      let filteredClones = report.clones;

      // Filter by priority
      if (options.priorityFilter) {
        filteredClones = filteredClones.filter(
          clone => clone.refactoringAdvice.priority === options.priorityFilter
        );
      }

      // Limit results
      if (options.maxResults) {
        filteredClones = filteredClones.slice(0, options.maxResults);
      }

      // Format output based on mode
      const outputMode = options.outputMode || 'detailed';

      if (outputMode === 'summary') {
        return this.formatSummaryOutput(report, filteredClones, fullDir, accessConfig);
      } else if (outputMode === 'recommendations') {
        return this.formatRecommendationsOutput(report, filteredClones, fullDir, accessConfig);
      } else {
        return this.formatDetailedOutput(report, filteredClones, fullDir, accessConfig);
      }

    } catch (error) {
      throw new Error(`Failed to detect clones in ${directory}: ${error.message}`);
    }
  }

  /**
   * Format summary output
   * @private
   */
  formatSummaryOutput(report, clones, fullDir, accessConfig) {
    return {
      directory: this.directoryAccessManager.createRelativePath(fullDir, accessConfig),
      fullPath: fullDir,
      success: true,
      outputMode: 'summary',
      summary: {
        totalFiles: report.summary.totalFiles,
        totalClones: report.summary.totalClones,
        duplicatedLines: report.summary.totalDuplicatedLines,
        duplicationPercentage: report.summary.duplicationPercentage,
        priorityCounts: report.summary.priorityCounts,
        topClones: clones.slice(0, 5).map(clone => ({
          id: clone.id,
          type: clone.type,
          confidence: clone.confidence,
          instances: clone.metrics.instanceCount,
          lines: clone.metrics.lineCount,
          priority: clone.refactoringAdvice.priority,
          strategy: clone.refactoringAdvice.strategy,
          locations: clone.instances.map(i => `${i.file}:${i.startLine}-${i.endLine}`)
        }))
      }
    };
  }

  /**
   * Format recommendations output
   * @private
   */
  formatRecommendationsOutput(report, clones, fullDir, accessConfig) {
    return {
      directory: this.directoryAccessManager.createRelativePath(fullDir, accessConfig),
      fullPath: fullDir,
      success: true,
      outputMode: 'recommendations',
      summary: {
        totalFiles: report.summary.totalFiles,
        totalClones: report.summary.totalClones,
        duplicationPercentage: report.summary.duplicationPercentage
      },
      recommendations: clones.map(clone => ({
        id: clone.id,
        priority: clone.refactoringAdvice.priority,
        strategy: clone.refactoringAdvice.strategy,
        suggestedName: clone.refactoringAdvice.suggestedName,
        reasoning: clone.refactoringAdvice.reasoning,
        effort: clone.refactoringAdvice.estimatedEffort,
        benefits: clone.refactoringAdvice.benefits,
        steps: clone.refactoringAdvice.actionableSteps,
        metrics: {
          instances: clone.metrics.instanceCount,
          lines: clone.metrics.lineCount,
          files: clone.metrics.filesCovered,
          impact: clone.metrics.impactScore
        },
        locations: clone.instances.map(i => ({
          file: i.file,
          startLine: i.startLine,
          endLine: i.endLine
        }))
      }))
    };
  }

  /**
   * Format detailed output
   * @private
   */
  formatDetailedOutput(report, clones, fullDir, accessConfig) {
    return {
      directory: this.directoryAccessManager.createRelativePath(fullDir, accessConfig),
      fullPath: fullDir,
      success: true,
      outputMode: 'detailed',
      summary: report.summary,
      clones: clones.map(clone => ({
        ...clone,
        // Truncate code snippets for agent readability
        instances: clone.instances.map(instance => ({
          ...instance,
          code: instance.code.split('\n').slice(0, 10).join('\n') +
                (instance.code.split('\n').length > 10 ? '\n... (truncated)' : '')
        }))
      }))
    };
  }

  /**
   * Get clone detector instance (lazy initialization)
   * @private
   */
  async getCloneDetector() {
    if (!this.cloneDetector) {
      const { CloneDetectionTool } = await import('../analyzers/codeCloneDetector/index.js');

      const config = {
        minTokens: this.defaultMinTokens,
        minLines: this.defaultMinLines,
        similarityThreshold: this.defaultSimilarityThreshold,
        include: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx', '**/*.vue'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/build/**'],
        maxFileSize: this.maxFileSize
      };

      this.cloneDetector = new CloneDetectionTool(config);
      this.logger?.debug('Clone detector initialized', { config });
    }

    return this.cloneDetector;
  }

  /**
   * Get supported actions for this tool
   * @returns {Array<string>} Array of supported action names
   */
  getSupportedActions() {
    return ['detect-clones'];
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
              directory: { type: 'string' },
              minTokens: { type: 'number', minimum: 10, maximum: 1000 },
              minLines: { type: 'number', minimum: 1, maximum: 100 },
              similarityThreshold: { type: 'number', minimum: 0.5, maximum: 1.0 },
              priorityFilter: { type: 'string', enum: ['high', 'medium', 'low'] },
              maxResults: { type: 'number', minimum: 1 },
              outputMode: { type: 'string', enum: ['summary', 'detailed', 'recommendations'] }
            },
            required: ['type', 'directory']
          }
        }
      },
      required: ['actions']
    };
  }
}

export default CloneDetectionTool;
