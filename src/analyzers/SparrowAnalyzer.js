/**
 * SparrowAnalyzer - Tree-sitter based SAST using sparrow-sast
 *
 * Provides security scanning without external dependencies.
 * Uses Globstar-compatible YAML checker format.
 *
 * Supported languages: Python, JavaScript, TypeScript, Go, Java,
 * Ruby, Rust, PHP, C#, Bash, HTML, CSS
 */

import path from 'path';
import fs from 'fs/promises';

class SparrowAnalyzer {
  constructor(logger = null) {
    this.logger = logger;
    this.sparrow = null;
    this.initialized = false;
  }

  /**
   * Lazy-load sparrow-sast to avoid startup overhead
   */
  async ensureInitialized() {
    if (this.initialized) return;

    try {
      this.sparrow = await import('sparrow-sast');
      this.initialized = true;
      this.logger?.debug('Sparrow SAST initialized');
    } catch (error) {
      this.logger?.error('Failed to initialize Sparrow SAST', { error: error.message });
      throw new Error(`Sparrow SAST initialization failed: ${error.message}`);
    }
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages() {
    return [
      'python', 'javascript', 'typescript', 'go', 'java',
      'ruby', 'rust', 'php', 'csharp', 'bash', 'html', 'css'
    ];
  }

  /**
   * Get file extensions for supported languages
   */
  getSupportedExtensions() {
    return [
      '.py', '.js', '.jsx', '.ts', '.tsx', '.go', '.java',
      '.rb', '.rs', '.php', '.cs', '.sh', '.bash', '.html', '.css'
    ];
  }

  /**
   * Check if a file is supported by Sparrow
   */
  isSupported(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.getSupportedExtensions().includes(ext);
  }

  /**
   * Scan a single file
   * @param {string} filePath - Path to the file
   * @param {Object} options - Scan options
   * @returns {Promise<Object>} Scan results
   */
  async scanFile(filePath, options = {}) {
    await this.ensureInitialized();

    const startTime = Date.now();

    try {
      // Check if file exists
      await fs.access(filePath);

      // Check if file is supported
      if (!this.isSupported(filePath)) {
        return {
          success: true,
          file: filePath,
          issues: [],
          skipped: true,
          reason: 'Unsupported file type',
          executionTime: Date.now() - startTime
        };
      }

      // Run Sparrow scan
      const issues = await this.sparrow.scan(filePath, {
        useBuiltinCheckers: options.useBuiltinCheckers !== false,
        checkerDir: options.checkerDir,
        enabledCheckers: options.enabledCheckers,
        disabledCheckers: options.disabledCheckers,
        excludePatterns: options.excludePatterns
      });

      // Transform issues to standard format
      const transformedIssues = issues.map(issue => this.transformIssue(issue, filePath));

      return {
        success: true,
        file: filePath,
        issues: transformedIssues,
        summary: {
          total: transformedIssues.length,
          critical: transformedIssues.filter(i => i.severity === 'critical').length,
          error: transformedIssues.filter(i => i.severity === 'error').length,
          warning: transformedIssues.filter(i => i.severity === 'warning').length,
          info: transformedIssues.filter(i => i.severity === 'info').length
        },
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      this.logger?.error('Sparrow scan failed', { file: filePath, error: error.message });
      return {
        success: false,
        file: filePath,
        error: error.message,
        issues: [],
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Scan a directory or project
   * @param {string} targetPath - Path to scan
   * @param {Object} options - Scan options
   * @returns {Promise<Object>} Scan results
   */
  async scanProject(targetPath, options = {}) {
    await this.ensureInitialized();

    const startTime = Date.now();

    try {
      // Check if path exists
      const stat = await fs.stat(targetPath);
      const isDirectory = stat.isDirectory();

      // Build exclude patterns
      const defaultExcludes = [
        'node_modules/**',
        'vendor/**',
        '.git/**',
        'dist/**',
        'build/**',
        '*.min.js',
        '*.bundle.js'
      ];

      const excludePatterns = [
        ...defaultExcludes,
        ...(options.excludePatterns || [])
      ];

      // Filter languages if specified
      const languages = options.languages?.map(lang => {
        // Map language names to Sparrow Language enum
        const langMap = {
          'python': this.sparrow.Language?.Python,
          'javascript': this.sparrow.Language?.JavaScript,
          'typescript': this.sparrow.Language?.TypeScript,
          'go': this.sparrow.Language?.Go,
          'java': this.sparrow.Language?.Java,
          'ruby': this.sparrow.Language?.Ruby,
          'rust': this.sparrow.Language?.Rust,
          'php': this.sparrow.Language?.PHP,
          'csharp': this.sparrow.Language?.CSharp,
          'bash': this.sparrow.Language?.Bash,
          'html': this.sparrow.Language?.HTML,
          'css': this.sparrow.Language?.CSS
        };
        return langMap[lang.toLowerCase()];
      }).filter(Boolean);

      // Run Sparrow scan
      const issues = await this.sparrow.scan(targetPath, {
        useBuiltinCheckers: options.useBuiltinCheckers !== false,
        checkerDir: options.checkerDir,
        enabledCheckers: options.enabledCheckers,
        disabledCheckers: options.disabledCheckers,
        excludePatterns,
        languages: languages?.length > 0 ? languages : undefined
      });

      // Transform and group issues by file
      const issuesByFile = new Map();
      for (const issue of issues) {
        const filePath = issue.filepath;
        if (!issuesByFile.has(filePath)) {
          issuesByFile.set(filePath, []);
        }
        issuesByFile.get(filePath).push(this.transformIssue(issue, filePath));
      }

      // Build file results
      const fileResults = [];
      for (const [file, fileIssues] of issuesByFile) {
        fileResults.push({
          file,
          issues: fileIssues,
          summary: {
            total: fileIssues.length,
            critical: fileIssues.filter(i => i.severity === 'critical').length,
            error: fileIssues.filter(i => i.severity === 'error').length,
            warning: fileIssues.filter(i => i.severity === 'warning').length,
            info: fileIssues.filter(i => i.severity === 'info').length
          }
        });
      }

      // Calculate overall summary
      const allIssues = Array.from(issuesByFile.values()).flat();
      const summary = {
        totalFiles: issuesByFile.size,
        totalIssues: allIssues.length,
        critical: allIssues.filter(i => i.severity === 'critical').length,
        error: allIssues.filter(i => i.severity === 'error').length,
        warning: allIssues.filter(i => i.severity === 'warning').length,
        info: allIssues.filter(i => i.severity === 'info').length,
        byCategory: this.groupByCategory(allIssues),
        byLanguage: this.groupByLanguage(fileResults)
      };

      return {
        success: true,
        path: targetPath,
        isDirectory,
        files: fileResults,
        summary,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      this.logger?.error('Sparrow project scan failed', { path: targetPath, error: error.message });
      return {
        success: false,
        path: targetPath,
        error: error.message,
        files: [],
        summary: { totalFiles: 0, totalIssues: 0 },
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Transform Sparrow issue to standard format
   */
  transformIssue(issue, filePath) {
    return {
      id: issue.id,
      file: path.relative(process.cwd(), issue.filepath || filePath),
      fullPath: issue.filepath || filePath,
      line: issue.range?.start?.row + 1 || 1,  // Convert to 1-based
      column: issue.range?.start?.column + 1 || 1,
      endLine: issue.range?.end?.row + 1 || undefined,
      endColumn: issue.range?.end?.column + 1 || undefined,
      severity: issue.severity || 'warning',
      category: issue.category || 'security',
      rule: issue.id,
      message: issue.message,
      source: 'sparrow',
      fixable: false
    };
  }

  /**
   * Group issues by category
   */
  groupByCategory(issues) {
    const groups = {};
    for (const issue of issues) {
      const category = issue.category || 'other';
      groups[category] = (groups[category] || 0) + 1;
    }
    return groups;
  }

  /**
   * Group files by language
   */
  groupByLanguage(fileResults) {
    const groups = {};
    for (const result of fileResults) {
      const ext = path.extname(result.file).toLowerCase();
      const langMap = {
        '.py': 'python',
        '.js': 'javascript',
        '.jsx': 'javascript',
        '.ts': 'typescript',
        '.tsx': 'typescript',
        '.go': 'go',
        '.java': 'java',
        '.rb': 'ruby',
        '.rs': 'rust',
        '.php': 'php',
        '.cs': 'csharp',
        '.sh': 'bash',
        '.bash': 'bash',
        '.html': 'html',
        '.css': 'css'
      };
      const lang = langMap[ext] || 'other';
      groups[lang] = (groups[lang] || 0) + 1;
    }
    return groups;
  }

  /**
   * Get available checkers info
   */
  async getCheckersInfo() {
    await this.ensureInitialized();

    try {
      const registry = this.sparrow.getRegistry?.();
      if (registry) {
        const analyzers = this.sparrow.getAllAnalyzers?.() || [];
        return analyzers.map(a => ({
          name: a.name,
          language: a.language,
          category: a.category,
          severity: a.severity
        }));
      }
      return [];
    } catch (error) {
      this.logger?.warn('Could not get checkers info', { error: error.message });
      return [];
    }
  }
}

export default SparrowAnalyzer;
