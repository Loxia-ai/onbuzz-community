/**
 * ESLintAnalyzer - JavaScript/TypeScript code style analysis using ESLint
 *
 * Purpose:
 * - Analyze code style and quality issues
 * - Detect best practice violations
 * - Support auto-fix for fixable issues
 * - Integration with popular ESLint configurations
 */

import { ESLint } from 'eslint';
import path from 'path';
import fs from 'fs/promises';
import { STATIC_ANALYSIS } from '../utilities/constants.js';

class ESLintAnalyzer {
  constructor(logger = null) {
    this.logger = logger;
    this.eslintCache = new Map();
  }

  /**
   * Analyze code with ESLint
   * @param {string} filePath - Path to file
   * @param {string} content - File content
   * @param {Object} options - Analysis options
   * @returns {Promise<Array>} Array of diagnostics
   */
  async analyze(filePath, content, options = {}) {
    try {
      const eslint = await this.getESLintInstance(options);

      // Analyze the code
      const results = await eslint.lintText(content, {
        filePath,
        warnIgnored: false
      });

      // Format results
      const diagnostics = [];

      if (results && results.length > 0) {
        const result = results[0];

        for (const message of result.messages) {
          diagnostics.push(this.formatMessage(message, filePath));
        }
      }

      this.logger?.debug('ESLint analysis completed', {
        file: filePath,
        totalDiagnostics: diagnostics.length,
        errors: diagnostics.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.ERROR).length,
        warnings: diagnostics.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.WARNING).length
      });

      return diagnostics;

    } catch (error) {
      this.logger?.error('ESLint analysis failed', {
        file: filePath,
        error: error.message
      });

      // Return empty array on error to allow TypeScript analyzer to continue
      return [];
    }
  }

  /**
   * Auto-fix code issues
   * @param {string} filePath - Path to file
   * @param {string} content - File content
   * @param {Object} options - Fix options
   * @returns {Promise<Object>} Fixed content and changes
   */
  async fix(filePath, content, options = {}) {
    try {
      const eslint = await this.getESLintInstance({
        ...options,
        fix: true  // Enable auto-fix
      });

      // Fix the code
      const results = await eslint.lintText(content, {
        filePath,
        warnIgnored: false
      });

      if (results && results.length > 0) {
        const result = results[0];

        return {
          fixed: result.output !== undefined,
          content: result.output || content,
          fixedCount: result.fixableErrorCount + result.fixableWarningCount,
          remainingErrors: result.errorCount - result.fixableErrorCount,
          remainingWarnings: result.warningCount - result.fixableWarningCount,
          changes: result.output ? this.describeChanges(content, result.output) : []
        };
      }

      return {
        fixed: false,
        content,
        fixedCount: 0,
        remainingErrors: 0,
        remainingWarnings: 0,
        changes: []
      };

    } catch (error) {
      this.logger?.error('ESLint fix failed', {
        file: filePath,
        error: error.message
      });

      throw new Error(`ESLint fix failed: ${error.message}`);
    }
  }

  /**
   * Get or create ESLint instance
   * @private
   */
  async getESLintInstance(options = {}) {
    const {
      workingDir,
      fix = false,
      framework
    } = options;

    // Create ESLint instance with configuration
    const eslintConfig = await this.getESLintConfig(workingDir, framework);

    const eslint = new ESLint({
      fix,
      useEslintrc: true,  // Use .eslintrc if available
      overrideConfig: eslintConfig,
      errorOnUnmatchedPattern: false
    });

    return eslint;
  }

  /**
   * Get ESLint configuration
   * @private
   */
  async getESLintConfig(workingDir, framework) {
    // Base configuration
    const config = {
      env: {
        browser: true,
        es2021: true,
        node: true
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      rules: {
        // Common rules
        'no-unused-vars': 'warn',
        'no-undef': 'error',
        'no-console': 'off',
        'semi': ['warn', 'always'],
        'quotes': ['warn', 'single', { avoidEscape: true }]
      }
    };

    // Framework-specific configurations
    if (framework === 'react') {
      config.extends = ['eslint:recommended'];
      config.parserOptions.ecmaFeatures = { jsx: true };
      config.settings = {
        react: {
          version: 'detect'
        }
      };
    } else if (framework === 'vue') {
      config.extends = ['eslint:recommended'];
    } else {
      config.extends = ['eslint:recommended'];
    }

    // Try to detect and use project's ESLint config
    if (workingDir) {
      const configFiles = [
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.json',
        'eslint.config.js'
      ];

      for (const configFile of configFiles) {
        try {
          const configPath = path.join(workingDir, configFile);
          await fs.access(configPath);
          this.logger?.debug('Found ESLint config', { configFile });
          // If config exists, let ESLint use it via useEslintrc
          return {}; // Return empty config to let ESLint use the file
        } catch {
          // Config file doesn't exist, continue
        }
      }
    }

    return config;
  }

  /**
   * Format ESLint message to standard diagnostic format
   * @private
   */
  formatMessage(message, filePath) {
    return {
      file: filePath,
      line: message.line || 1,
      column: message.column || 1,
      endLine: message.endLine,
      endColumn: message.endColumn,
      severity: message.severity === 2
        ? STATIC_ANALYSIS.SEVERITY.ERROR
        : STATIC_ANALYSIS.SEVERITY.WARNING,
      rule: message.ruleId || 'eslint',
      message: message.message,
      category: this.categorizeRule(message.ruleId),
      fixable: message.fix !== undefined,
      source: 'eslint'
    };
  }

  /**
   * Categorize ESLint rule into error category
   * @private
   */
  categorizeRule(ruleId) {
    if (!ruleId) return STATIC_ANALYSIS.CATEGORY.STYLE;

    // Security rules
    if (ruleId.includes('security') ||
        ruleId.includes('xss') ||
        ruleId === 'no-eval' ||
        ruleId === 'no-implied-eval') {
      return STATIC_ANALYSIS.CATEGORY.SECURITY;
    }

    // Performance rules
    if (ruleId.includes('performance') ||
        ruleId === 'no-await-in-loop' ||
        ruleId === 'prefer-promise-reject-errors') {
      return STATIC_ANALYSIS.CATEGORY.PERFORMANCE;
    }

    // Import rules
    if (ruleId.includes('import') ||
        ruleId === 'no-undef') {
      return STATIC_ANALYSIS.CATEGORY.IMPORT;
    }

    // Best practice rules
    if (ruleId.includes('best-practices') ||
        ruleId === 'no-unused-vars' ||
        ruleId === 'no-unreachable' ||
        ruleId === 'no-var') {
      return STATIC_ANALYSIS.CATEGORY.BEST_PRACTICE;
    }

    // Default to style
    return STATIC_ANALYSIS.CATEGORY.STYLE;
  }

  /**
   * Describe changes made by auto-fix
   * @private
   */
  describeChanges(original, fixed) {
    const changes = [];
    const originalLines = original.split('\n');
    const fixedLines = fixed.split('\n');

    // Simple diff - compare line by line
    const maxLines = Math.max(originalLines.length, fixedLines.length);

    for (let i = 0; i < maxLines; i++) {
      const origLine = originalLines[i] || '';
      const fixedLine = fixedLines[i] || '';

      if (origLine !== fixedLine) {
        changes.push({
          line: i + 1,
          type: origLine && fixedLine ? 'modified' : (origLine ? 'removed' : 'added'),
          original: origLine,
          fixed: fixedLine
        });
      }
    }

    return changes;
  }

  /**
   * Get supported file extensions
   * @returns {Array<string>} Array of supported extensions
   */
  getSupportedExtensions() {
    return ['.js', '.jsx', '.mjs', '.cjs'];
  }

  /**
   * Check if auto-fix is supported
   * @returns {boolean} True if auto-fix is supported
   */
  supportsAutoFix() {
    return true;
  }
}

export default ESLintAnalyzer;
