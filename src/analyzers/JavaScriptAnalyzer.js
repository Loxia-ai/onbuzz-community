/**
 * JavaScriptAnalyzer - Analyze JavaScript files for errors using TypeScript Compiler API
 *
 * Purpose:
 * - Analyze JavaScript files for syntax, type, and semantic errors
 * - Use TypeScript Compiler API with allowJs for JavaScript analysis
 * - Provide detailed error information with line numbers
 * - Support JSX syntax
 */

import ts from 'typescript';
import path from 'path';
import { STATIC_ANALYSIS } from '../utilities/constants.js';

class JavaScriptAnalyzer {
  constructor(logger = null) {
    this.logger = logger;
    this.compilerOptions = {
      allowJs: true,
      checkJs: true,
      noEmit: true,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
      skipLibCheck: true,
      strict: false, // Don't be too strict for JavaScript
      noImplicitAny: false // Allow implicit any in JavaScript
    };
  }

  /**
   * Analyze JavaScript file for errors
   * @param {string} filePath - Path to file
   * @param {string} content - File content
   * @param {Object} options - Analysis options
   * @returns {Promise<Array>} Array of diagnostic errors
   */
  async analyze(filePath, content, options = {}) {
    try {
      const diagnostics = [];

      // Create in-memory source file
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true // setParentNodes
      );

      // Get syntactic diagnostics (syntax errors)
      const syntacticDiagnostics = this.getSyntacticDiagnostics(sourceFile);
      diagnostics.push(...syntacticDiagnostics);

      // Get semantic diagnostics (type errors, undefined variables, etc.)
      // For JavaScript, semantic analysis is limited but still useful
      const semanticDiagnostics = await this.getSemanticDiagnostics(filePath, content);
      diagnostics.push(...semanticDiagnostics);

      this.logger?.debug('JavaScript analysis completed', {
        file: filePath,
        totalDiagnostics: diagnostics.length,
        errors: diagnostics.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.ERROR).length,
        warnings: diagnostics.filter(d => d.severity === STATIC_ANALYSIS.SEVERITY.WARNING).length
      });

      return diagnostics;

    } catch (error) {
      this.logger?.error('JavaScript analysis failed', {
        file: filePath,
        error: error.message
      });

      return [{
        file: filePath,
        line: 0,
        column: 0,
        severity: STATIC_ANALYSIS.SEVERITY.ERROR,
        rule: 'analyzer-error',
        message: `Analysis failed: ${error.message}`,
        category: STATIC_ANALYSIS.CATEGORY.SYNTAX
      }];
    }
  }

  /**
   * Get syntactic diagnostics (syntax errors)
   * @private
   */
  getSyntacticDiagnostics(sourceFile) {
    const diagnostics = [];

    // Walk the AST to find syntax errors
    const visit = (node) => {
      // Check for syntax errors
      if (node.kind === ts.SyntaxKind.Unknown) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        diagnostics.push({
          file: sourceFile.fileName,
          line: position.line + 1, // 1-indexed
          column: position.character + 1,
          severity: STATIC_ANALYSIS.SEVERITY.ERROR,
          rule: 'syntax-error',
          message: 'Syntax error',
          category: STATIC_ANALYSIS.CATEGORY.SYNTAX,
          fixable: false
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // Also check for parsing errors
    if (sourceFile.parseDiagnostics && sourceFile.parseDiagnostics.length > 0) {
      for (const diagnostic of sourceFile.parseDiagnostics) {
        diagnostics.push(this.formatDiagnostic(diagnostic, sourceFile));
      }
    }

    return diagnostics;
  }

  /**
   * Get semantic diagnostics (type errors, undefined variables)
   * @private
   */
  async getSemanticDiagnostics(filePath, content) {
    const diagnostics = [];

    try {
      // Create a minimal program for semantic analysis
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );

      // Create a compiler host that provides files from memory
      const host = {
        getSourceFile: (fileName) => {
          if (fileName === filePath) {
            return sourceFile;
          }
          return undefined;
        },
        getDefaultLibFileName: () => 'lib.d.ts',
        writeFile: () => {},
        getCurrentDirectory: () => path.dirname(filePath),
        getDirectories: () => [],
        fileExists: (fileName) => fileName === filePath,
        readFile: (fileName) => {
          if (fileName === filePath) {
            return content;
          }
          return undefined;
        },
        getCanonicalFileName: (fileName) => fileName,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n'
      };

      // Create program
      const program = ts.createProgram({
        rootNames: [filePath],
        options: this.compilerOptions,
        host
      });

      // Get semantic diagnostics
      const tsDiagnostics = program.getSemanticDiagnostics(sourceFile);

      for (const diagnostic of tsDiagnostics) {
        diagnostics.push(this.formatDiagnostic(diagnostic, sourceFile));
      }

    } catch (error) {
      this.logger?.debug('Semantic analysis skipped', {
        file: filePath,
        reason: error.message
      });
    }

    return diagnostics;
  }

  /**
   * Format TypeScript diagnostic to standard error format
   * @private
   */
  formatDiagnostic(diagnostic, sourceFile) {
    let line = 0;
    let column = 0;

    if (diagnostic.file && diagnostic.start !== undefined) {
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      line = position.line + 1; // 1-indexed
      column = position.character + 1;
    } else if (sourceFile && diagnostic.start !== undefined) {
      const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
      line = position.line + 1;
      column = position.character + 1;
    }

    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

    // Determine severity
    let severity;
    switch (diagnostic.category) {
      case ts.DiagnosticCategory.Error:
        severity = STATIC_ANALYSIS.SEVERITY.ERROR;
        break;
      case ts.DiagnosticCategory.Warning:
        severity = STATIC_ANALYSIS.SEVERITY.WARNING;
        break;
      case ts.DiagnosticCategory.Message:
      case ts.DiagnosticCategory.Suggestion:
        severity = STATIC_ANALYSIS.SEVERITY.INFO;
        break;
      default:
        severity = STATIC_ANALYSIS.SEVERITY.ERROR;
    }

    // Determine category
    let category = STATIC_ANALYSIS.CATEGORY.SYNTAX;
    const code = diagnostic.code;

    // Categorize based on error code
    if (code >= 2000 && code < 3000) {
      category = STATIC_ANALYSIS.CATEGORY.TYPE;
    } else if (code >= 1000 && code < 2000) {
      category = STATIC_ANALYSIS.CATEGORY.SYNTAX;
    } else if (code >= 2300 && code < 2400) {
      category = STATIC_ANALYSIS.CATEGORY.IMPORT;
    }

    // Check if message indicates import error
    if (message.toLowerCase().includes('cannot find module') ||
        message.toLowerCase().includes('import')) {
      category = STATIC_ANALYSIS.CATEGORY.IMPORT;
    }

    return {
      file: diagnostic.file?.fileName || sourceFile?.fileName || 'unknown',
      line,
      column,
      severity,
      rule: `TS${code}`,
      message,
      category,
      fixable: false, // TypeScript doesn't provide fix information easily
      code: diagnostic.code
    };
  }
}

export default JavaScriptAnalyzer;
