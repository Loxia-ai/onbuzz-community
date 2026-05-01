/**
 * CSSAnalyzer - CSS/SCSS/LESS code analysis using PostCSS and Stylelint
 *
 * Purpose:
 * - Analyze CSS, SCSS, and LESS files for syntax errors
 * - Validate style rules and properties
 * - Detect common CSS issues and bad practices
 * - Support preprocessor syntaxes (SCSS, LESS)
 */

import { STATIC_ANALYSIS } from '../utilities/constants.js';

class CSSAnalyzer {
  constructor(logger = null) {
    this.logger = logger;
    this.stylelint = null;
    this.postcss = null;
    this.postcssScss = null;
    this.postcssLess = null;
  }

  /**
   * Analyze CSS/SCSS/LESS code
   * @param {string} filePath - Path to file
   * @param {string} content - File content
   * @param {Object} options - Analysis options
   * @returns {Promise<Array>} Array of diagnostics
   */
  async analyze(filePath, content, options = {}) {
    try {
      const diagnostics = [];
      const language = this.detectLanguage(filePath);

      // Check syntax using PostCSS
      const syntaxErrors = await this.checkSyntax(filePath, content, language);
      diagnostics.push(...syntaxErrors);

      // Only run style linting if no syntax errors
      if (syntaxErrors.length === 0) {
        const styleIssues = await this.lintStyles(filePath, content, language);
        diagnostics.push(...styleIssues);
      }

      this.logger?.debug('CSS analysis completed', {
        file: filePath,
        language,
        totalDiagnostics: diagnostics.length,
        errors: diagnostics.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.ERROR).length,
        warnings: diagnostics.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.WARNING).length
      });

      return diagnostics;

    } catch (error) {
      this.logger?.error('CSS analysis failed', {
        file: filePath,
        error: error.message
      });

      // Return empty array on error to allow other analysis to continue
      return [];
    }
  }

  /**
   * Check CSS syntax using PostCSS
   * @private
   */
  async checkSyntax(filePath, content, language) {
    const diagnostics = [];

    try {
      // Lazy load PostCSS and syntax parsers
      if (!this.postcss) {
        const postcssModule = await import('postcss');
        this.postcss = postcssModule.default;
      }

      let syntax = null;

      if (language === 'scss') {
        if (!this.postcssScss) {
          const scssModule = await import('postcss-scss');
          this.postcssScss = scssModule.default;
        }
        syntax = this.postcssScss;
      } else if (language === 'less') {
        if (!this.postcssLess) {
          const lessModule = await import('postcss-less');
          this.postcssLess = lessModule.default;
        }
        syntax = this.postcssLess;
      }

      // Parse CSS with PostCSS
      const result = this.postcss().process(content, {
        from: filePath,
        syntax
      });

      // PostCSS parsing is synchronous - accessing result.root will throw if syntax error
      const root = result.root;

      // If we get here, syntax is valid
      this.logger?.debug('PostCSS syntax check passed', { file: filePath });

    } catch (error) {
      // PostCSS syntax error
      const diagnostic = this.formatPostCSSError(error, filePath);
      if (diagnostic) {
        diagnostics.push(diagnostic);
      }
    }

    return diagnostics;
  }

  /**
   * Lint styles using Stylelint
   * @private
   */
  async lintStyles(filePath, content, language) {
    const diagnostics = [];

    try {
      // Lazy load Stylelint
      if (!this.stylelint) {
        const stylelintModule = await import('stylelint');
        this.stylelint = stylelintModule.default;
      }

      // Configure Stylelint
      const config = {
        extends: ['stylelint-config-standard'],
        rules: {
          // Custom rules for better analysis
          'color-no-invalid-hex': true,
          'font-family-no-duplicate-names': true,
          'function-calc-no-invalid': true,
          'string-no-newline': true,
          'unit-no-unknown': true,
          'property-no-unknown': true,
          'declaration-block-no-duplicate-properties': true,
          'selector-pseudo-class-no-unknown': true,
          'selector-pseudo-element-no-unknown': true,
          'selector-type-no-unknown': [true, {
            ignoreTypes: ['/^custom-/', 'ng-deep'] // Allow custom elements
          }],
          'media-feature-name-no-unknown': true,
          'at-rule-no-unknown': language === 'scss' ? [true, {
            ignoreAtRules: ['mixin', 'include', 'extend', 'if', 'else', 'for', 'each', 'while', 'function', 'return', 'content', 'use', 'forward']
          }] : language === 'less' ? [true, {
            ignoreAtRules: ['plugin']
          }] : true,
          'comment-no-empty': true,
          'no-duplicate-selectors': true,
          'no-empty-source': null, // Allow empty files
          'block-no-empty': true,
          'declaration-block-no-shorthand-property-overrides': true,
          'font-family-no-missing-generic-family-keyword': true,
          'function-linear-gradient-no-nonstandard-direction': true,
          'no-descending-specificity': null, // Too strict for real projects
          'no-duplicate-at-import-rules': true,
          'no-extra-semicolons': true,
          'no-invalid-double-slash-comments': true,
          'selector-pseudo-element-colon-notation': 'double',
          'selector-type-case': 'lower'
        },
        customSyntax: language === 'scss' ? 'postcss-scss' :
                      language === 'less' ? 'postcss-less' : undefined
      };

      // Run Stylelint
      const result = await this.stylelint.lint({
        code: content,
        codeFilename: filePath,
        config
      });

      // Process results
      if (result.results && result.results.length > 0) {
        const fileResult = result.results[0];

        if (fileResult.warnings) {
          for (const warning of fileResult.warnings) {
            diagnostics.push({
              file: filePath,
              line: warning.line || 1,
              column: warning.column || 1,
              severity: warning.severity === 'error'
                ? STATIC_ANALYSIS.SEVERITY.ERROR
                : STATIC_ANALYSIS.SEVERITY.WARNING,
              rule: warning.rule || 'unknown',
              message: warning.text,
              category: this.categorizeStylelintRule(warning.rule),
              fixable: false,
              source: 'stylelint'
            });
          }
        }
      }

    } catch (error) {
      this.logger?.warn('Stylelint analysis failed', {
        file: filePath,
        error: error.message
      });
      // Don't fail the whole analysis if linting fails
    }

    return diagnostics;
  }

  /**
   * Format PostCSS error into diagnostic
   * @private
   */
  formatPostCSSError(error, filePath) {
    return {
      file: filePath,
      line: error.line || 1,
      column: error.column || 1,
      severity: STATIC_ANALYSIS.SEVERITY.ERROR,
      rule: error.name || 'CssSyntaxError',
      message: error.reason || error.message,
      category: STATIC_ANALYSIS.CATEGORY.SYNTAX,
      fixable: false,
      source: 'postcss',
      code: error.source || undefined
    };
  }

  /**
   * Categorize Stylelint rule into analysis category
   * @private
   */
  categorizeStylelintRule(rule) {
    if (!rule) return STATIC_ANALYSIS.CATEGORY.STYLE;

    const ruleLower = rule.toLowerCase();

    if (ruleLower.includes('no-invalid') ||
        ruleLower.includes('no-unknown') ||
        ruleLower.includes('no-empty') ||
        ruleLower.includes('syntax')) {
      return STATIC_ANALYSIS.CATEGORY.SYNTAX;
    }

    if (ruleLower.includes('performance') ||
        ruleLower.includes('optimize')) {
      return STATIC_ANALYSIS.CATEGORY.PERFORMANCE;
    }

    if (ruleLower.includes('best-practice') ||
        ruleLower.includes('recommended')) {
      return STATIC_ANALYSIS.CATEGORY.BEST_PRACTICE;
    }

    return STATIC_ANALYSIS.CATEGORY.STYLE;
  }

  /**
   * Detect language from file path
   * @private
   */
  detectLanguage(filePath) {
    const ext = filePath.toLowerCase();

    if (ext.endsWith('.scss') || ext.endsWith('.sass')) {
      return 'scss';
    }

    if (ext.endsWith('.less')) {
      return 'less';
    }

    return 'css';
  }

  /**
   * Get supported file extensions
   * @returns {Array<string>} Array of supported extensions
   */
  getSupportedExtensions() {
    return ['.css', '.scss', '.sass', '.less'];
  }

  /**
   * Check if auto-fix is supported
   * @returns {boolean} True if auto-fix is supported
   */
  supportsAutoFix() {
    return false; // Auto-fix not implemented yet
  }
}

export default CSSAnalyzer;
