/**
 * @file tools/importAnalyzerTool.js
 * @description Modern tool for analyzing and detecting broken imports/exports in Node.js projects
 */

import { promises as fs } from 'fs';
import path from 'path';
import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';

/**
 * Configuration constants for the import analyzer
 */
const ANALYZER_CONFIG = {
  DEFAULT_MODE: 'full',
  VALID_MODES: ['full', 'quick', 'fix'],
  DEFAULT_OUTPUT: 'summary',
  VALID_OUTPUTS: ['summary', 'detailed', 'json'],
  DEFAULT_IGNORE_FILE: '.gitignore',
  MAX_FILES: 10000,                    // Safety limit for file count
  SUPPORTED_EXTENSIONS: ['.js', '.mjs', '.ts', '.jsx', '.tsx'],
  DEFAULT_IGNORE_PATTERNS: ['node_modules', '.git', 'dist', 'build', 'coverage'],
  FILE_READ_TIMEOUT: 5000              // Timeout for reading large files
};

/**
 * ImportAnalyzerTool - Modern implementation
 * Analyzes JavaScript/TypeScript projects to detect broken imports, missing exports, and dependency issues
 */
export class ImportAnalyzerTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    // Override tool ID to match documentation (with hyphen)
    this.id = 'import-analyzer';
  }

  /**
   * Get tool description for agent system prompt
   * @returns {string} Formatted tool description
   */
  getDescription() {
    return `Tool: Import Analyzer - Analyze JavaScript/TypeScript imports and exports

**Purpose:** Analyzes JavaScript/TypeScript projects to detect broken imports, missing exports, circular dependencies, and unused exports.

**USAGE:**
\`\`\`json
{
  "toolId": "import-analyzer",
  "parameters": {
    "path": "./src",
    "mode": "full",
    "output": "summary",
    "ignoreFile": ".gitignore"
  }
}
\`\`\`

**Parameters:**
- **path** (string, optional): Path to directory to analyze. Default: "."
- **mode** (string, optional): Analysis mode. Options:
  - "full" - Complete analysis (default)
  - "quick" - Fast scan for missing files only
  - "fix" - Includes fix suggestions
- **output** (string, optional): Output format. Options:
  - "summary" - Concise summary (default)
  - "detailed" - Full report with fixes
  - "json" - Machine-readable format
- **ignoreFile** (string, optional): Ignore file name. Default: ".gitignore"

**What It Detects:**
- Missing files (imports pointing to non-existent files)
- Missing exports (symbols not exported from target files)
- Circular dependencies (files that depend on each other in a loop)
- Unused exports (exports never imported anywhere)

**Examples:**

1. Quick project scan:
\`\`\`json
{
  "toolId": "import-analyzer",
  "parameters": { "mode": "quick" }
}
\`\`\`

2. Full analysis with detailed report:
\`\`\`json
{
  "toolId": "import-analyzer",
  "parameters": { "mode": "full", "output": "detailed" }
}
\`\`\`

3. Analyze specific directory:
\`\`\`json
{
  "toolId": "import-analyzer",
  "parameters": { "path": "./src/components", "mode": "full" }
}
\`\`\`

**Notes:**
- Supports ES6 modules (import/export) and CommonJS (require/module.exports)
- Respects .gitignore patterns
- Correctly handles commented imports and multi-line statements
- Works with .js, .mjs, .ts, .jsx, .tsx files`;
  }

  /**
   * Parse tool parameters from raw content (XML or JSON)
   * @param {string|Object} content - Raw tool content or parsed object
   * @returns {Object} Parsed parameters
   */
  parseParameters(content) {
    // If already an object, validate and return
    if (typeof content === 'object' && content !== null) {
      return {
        path: content.path || '.',
        mode: content.mode || ANALYZER_CONFIG.DEFAULT_MODE,
        output: content.output || ANALYZER_CONFIG.DEFAULT_OUTPUT,
        ignoreFile: content.ignoreFile || ANALYZER_CONFIG.DEFAULT_IGNORE_FILE
      };
    }

    // Parse XML content
    if (typeof content === 'string') {
      // Try modern XML format first: <import-analyzer>...</import-analyzer>
      const modernPattern = /<import-analyzer([^>]*)>([\s\S]*?)<\/import-analyzer>/i;
      const modernMatch = modernPattern.exec(content);

      if (modernMatch) {
        const attributesStr = modernMatch[1];
        const innerContent = modernMatch[2];

        // Parse attributes from opening tag
        const pathAttr = /path=["']([^"']*)["']/i.exec(attributesStr);
        const modeAttr = /mode=["']([^"']*)["']/i.exec(attributesStr);
        const outputAttr = /output=["']([^"']*)["']/i.exec(attributesStr);
        const ignoreFileAttr = /ignore-file=["']([^"']*)["']/i.exec(attributesStr);

        // Extract from inner content
        const pathPattern = /<path>(.*?)<\/path>/i;
        const pathMatch = pathPattern.exec(innerContent);

        const modePattern = /<mode>(.*?)<\/mode>/i;
        const modeMatch = modePattern.exec(innerContent);

        const outputPattern = /<output>(.*?)<\/output>/i;
        const outputMatch = outputPattern.exec(innerContent);

        const ignoreFilePattern = /<ignore-file>(.*?)<\/ignore-file>/i;
        const ignoreFileMatch = ignoreFilePattern.exec(innerContent);

        // Content takes precedence over attributes
        const extractedPath = (pathMatch ? pathMatch[1].trim() : null) || (pathAttr ? pathAttr[1] : '.');
        const extractedMode = (modeMatch ? modeMatch[1].trim() : null) || (modeAttr ? modeAttr[1] : ANALYZER_CONFIG.DEFAULT_MODE);
        const extractedOutput = (outputMatch ? outputMatch[1].trim() : null) || (outputAttr ? outputAttr[1] : ANALYZER_CONFIG.DEFAULT_OUTPUT);
        const extractedIgnoreFile = (ignoreFileMatch ? ignoreFileMatch[1].trim() : null) || (ignoreFileAttr ? ignoreFileAttr[1] : ANALYZER_CONFIG.DEFAULT_IGNORE_FILE);

        return {
          path: extractedPath,
          mode: extractedMode,
          output: extractedOutput,
          ignoreFile: extractedIgnoreFile
        };
      }

      // Try legacy format with TagParser
      try {
        const parsed = TagParser.parseTags(content, 'analyze');

        if (parsed && parsed.length > 0) {
          const analyzeCommand = parsed[0];

          return {
            path: analyzeCommand.attributes.path || '.',
            mode: analyzeCommand.attributes.mode || ANALYZER_CONFIG.DEFAULT_MODE,
            output: analyzeCommand.attributes.output || ANALYZER_CONFIG.DEFAULT_OUTPUT,
            ignoreFile: analyzeCommand.attributes['ignore-file'] || ANALYZER_CONFIG.DEFAULT_IGNORE_FILE
          };
        }
      } catch (error) {
        // Fall through to error
      }

      throw new Error('Invalid import-analyzer format. Use <import-analyzer> tags or JSON format.');
    }

    throw new Error('Invalid parameter format. Expected string (XML) or object (JSON).');
  }

  /**
   * Validate parameters
   * @param {Object} params - Parameters to validate
   * @throws {Error} If validation fails
   * @private
   */
  _validateParameters(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('Parameters must be an object');
    }

    if (params.path && typeof params.path !== 'string') {
      throw new Error('path must be a string');
    }

    if (params.mode && !ANALYZER_CONFIG.VALID_MODES.includes(params.mode)) {
      throw new Error(`Invalid mode: ${params.mode}. Must be one of: ${ANALYZER_CONFIG.VALID_MODES.join(', ')}`);
    }

    if (params.output && !ANALYZER_CONFIG.VALID_OUTPUTS.includes(params.output)) {
      throw new Error(`Invalid output: ${params.output}. Must be one of: ${ANALYZER_CONFIG.VALID_OUTPUTS.join(', ')}`);
    }

    if (params.ignoreFile && typeof params.ignoreFile !== 'string') {
      throw new Error('ignoreFile must be a string');
    }
  }

  /**
   * Validate and resolve file path
   * @param {string} targetPath - Target path from parameters
   * @param {Object} context - Execution context
   * @returns {string} Resolved absolute path
   * @throws {Error} If path is invalid or inaccessible
   * @private
   */
  _resolveAndValidatePath(targetPath, context) {
    const { projectDir, directoryAccess } = context;

    // Determine working directory
    let workingDirectory = projectDir || process.cwd();

    if (directoryAccess && directoryAccess.workingDirectory) {
      workingDirectory = directoryAccess.workingDirectory;
    }

    // Resolve the target path
    const resolvedPath = path.isAbsolute(targetPath)
      ? path.normalize(targetPath)
      : path.normalize(path.join(workingDirectory, targetPath));

    // Security: Check for path traversal
    const realWorkingDir = path.normalize(workingDirectory);
    if (!resolvedPath.startsWith(realWorkingDir)) {
      throw new Error(`Path traversal detected: ${targetPath} resolves outside working directory`);
    }

    return resolvedPath;
  }

  /**
   * Execute tool with parsed parameters
   * @param {Object} params - Parsed parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(params, context = {}) {
    try {
      // Validate parameters
      this._validateParameters(params);

      const { path: targetPath, mode, output, ignoreFile } = params;
      const { projectDir, agentId, directoryAccess } = context;

      // Resolve and validate path
      const resolvedPath = this._resolveAndValidatePath(targetPath, context);

      this.logger?.info('Import analyzer executing', {
        mode,
        resolvedPath,
        output,
        agentId
      });

      const outputLines = [];
      outputLines.push(`🔍 Analyzing imports in: ${resolvedPath}`);
      outputLines.push(`Mode: ${mode}`);
      outputLines.push(`Output: ${output}\n`);

      // Check if path exists
      try {
        await fs.access(resolvedPath);
      } catch {
        return {
          success: false,
          error: `Path does not exist: ${resolvedPath}`,
          output: outputLines.join('\n')
        };
      }

      // Run analysis
      const analyzer = new ImportExportAnalyzer(resolvedPath, ignoreFile, this.logger);
      const results = await analyzer.analyze(mode);

      // Format output based on requested format
      let formattedOutput;
      switch (output) {
        case 'json':
          // For JSON output, don't include header lines
          formattedOutput = JSON.stringify(results, null, 2);
          break;
        case 'detailed':
          formattedOutput = this._formatDetailedOutput(results);
          outputLines.push(formattedOutput);
          break;
        case 'summary':
        default:
          formattedOutput = this._formatSummaryOutput(results);
          outputLines.push(formattedOutput);
          break;
      }

      return {
        success: true,
        mode,
        message: 'Import analysis completed',
        statistics: {
          totalFiles: results.summary.totalFiles,
          totalImports: results.summary.totalImports,
          totalExports: results.summary.totalExports,
          issuesFound: results.fileNotFoundImports.length + Object.values(results.missingExports).reduce((sum, arr) => sum + arr.length, 0)
        },
        output: output === 'json' ? formattedOutput : outputLines.join('\n'),
        results
      };

    } catch (error) {
      this.logger?.error('Import analyzer error:', error);

      return {
        success: false,
        error: error.message,
        output: error.message
      };
    }
  }

  /**
   * Format summary output
   * @param {Object} results - Analysis results
   * @returns {string} Formatted output
   * @private
   */
  _formatSummaryOutput(results) {
    const lines = [];

    lines.push('📊 Import/Export Analysis Summary');
    lines.push('================================\n');

    lines.push(`📁 Files analyzed: ${results.summary.totalFiles}`);
    lines.push(`📥 Total imports: ${results.summary.totalImports}`);
    lines.push(`📤 Total exports: ${results.summary.totalExports}\n`);

    // Critical issues
    const missingFilesCount = results.fileNotFoundImports.length;
    const missingExportsCount = Object.values(results.missingExports).reduce((sum, arr) => sum + arr.length, 0);
    const circularDepsCount = results.circularDependencies ? results.circularDependencies.length : 0;

    if (missingFilesCount > 0) {
      lines.push(`❌ Missing files: ${missingFilesCount} imports pointing to non-existent files`);
    }

    if (missingExportsCount > 0) {
      lines.push(`⚠️  Missing exports: ${missingExportsCount} symbols not exported from their sources`);
    }

    if (circularDepsCount > 0) {
      lines.push(`🔄 Circular dependencies: ${circularDepsCount} circular dependency chains detected`);
    }

    if (missingFilesCount === 0 && missingExportsCount === 0 && circularDepsCount === 0) {
      lines.push('✅ No import/export issues detected!');
    } else {
      lines.push('\n🔍 Top Issues to Fix:');

      // Show top 5 files with issues
      if (Object.keys(results.missingFiles || {}).length > 0) {
        lines.push('\n  Missing Files:');
        Object.entries(results.missingFiles).slice(0, 3).forEach(([file, issues]) => {
          lines.push(`    • ${file} has ${issues.length} broken import(s)`);
        });
      }

      if (Object.keys(results.missingExports).length > 0) {
        lines.push('\n  Missing Exports:');
        Object.entries(results.missingExports).slice(0, 3).forEach(([file, issues]) => {
          lines.push(`    • ${file} imports ${issues.length} non-existent symbol(s)`);
        });
      }

      lines.push('\n💡 Run with output="detailed" for complete analysis and fix suggestions');
    }

    return lines.join('\n');
  }

  /**
   * Format detailed output
   * @param {Object} results - Analysis results
   * @returns {string} Formatted output
   * @private
   */
  _formatDetailedOutput(results) {
    const lines = [];

    lines.push('📊 Detailed Import/Export Analysis Report');
    lines.push('=========================================\n');

    lines.push('📈 Statistics:');
    lines.push(`  • Files analyzed: ${results.summary.totalFiles}`);
    lines.push(`  • Total imports: ${results.summary.totalImports}`);
    lines.push(`  • Total exports: ${results.summary.totalExports}\n`);

    // Missing files section
    if (results.fileNotFoundImports.length > 0) {
      lines.push('❌ MISSING FILES');
      lines.push('─────────────────');

      const fileGroups = {};
      results.fileNotFoundImports.forEach(item => {
        if (!fileGroups[item.importingFile]) {
          fileGroups[item.importingFile] = [];
        }
        fileGroups[item.importingFile].push(item);
      });

      Object.entries(fileGroups).forEach(([file, imports]) => {
        lines.push(`\n📄 ${file}:`);
        imports.forEach(imp => {
          const importType = imp.isDefault ? 'default' : imp.isNamespace ? 'namespace' : 'named';
          lines.push(`   ⚠️  Cannot find file: ${imp.importedFromFile}`);
          lines.push(`      Trying to import: ${imp.importedSymbol} (${importType})`);
          lines.push(`      💡 Fix: Check if file exists or correct the import path`);
        });
      });
    }

    // Missing exports section
    if (Object.keys(results.missingExports).length > 0) {
      lines.push('\n⚠️  MISSING EXPORTS');
      lines.push('──────────────────');

      Object.entries(results.missingExports).forEach(([file, issues]) => {
        lines.push(`\n📄 ${file}:`);
        issues.forEach(issue => {
          const importType = issue.isDefault ? 'default' : issue.isNamespace ? 'namespace' : 'named';
          lines.push(`   ❌ Symbol not exported: "${issue.importedSymbol}" (${importType})`);
          lines.push(`      From file: ${issue.importedFromFile}`);

          if (issue.availableExports.length > 0) {
            lines.push(`      📤 Available exports: ${issue.availableExports.join(', ')}`);

            // Suggest potential fixes
            if (issue.isDefault && issue.availableExports.includes('default')) {
              lines.push(`      💡 Fix: Default export exists, check import syntax`);
            } else if (issue.isDefault && !issue.availableExports.includes('default')) {
              lines.push(`      💡 Fix: No default export. Use named import: { ${issue.availableExports[0] || 'symbolName'} }`);
            } else {
              // Check for similar names
              const similar = issue.availableExports.find(exp =>
                exp.toLowerCase() === issue.importedSymbol.toLowerCase()
              );
              if (similar) {
                lines.push(`      💡 Fix: Did you mean "${similar}"? (case mismatch)`);
              } else {
                lines.push(`      💡 Fix: Add export for "${issue.importedSymbol}" or use one of the available exports`);
              }
            }
          } else {
            lines.push(`      📤 No exports found in target file`);
            lines.push(`      💡 Fix: Add exports to ${issue.importedFromFile} or check if it's the correct file`);
          }
        });
      });
    }

    // Circular dependencies
    if (results.circularDependencies && results.circularDependencies.length > 0) {
      lines.push('\n🔄 CIRCULAR DEPENDENCIES');
      lines.push('────────────────────────');

      results.circularDependencies.forEach((cycle, index) => {
        lines.push(`\n  Cycle ${index + 1}:`);
        cycle.forEach((file, i) => {
          if (i < cycle.length - 1) {
            lines.push(`    ${file} → ${cycle[i + 1]}`);
          }
        });
        lines.push(`    💡 Fix: Refactor to break the circular dependency`);
      });
    }

    // Unused exports (if available)
    if (results.unusedExports && Object.keys(results.unusedExports).length > 0) {
      lines.push('\n🗑️  POTENTIALLY UNUSED EXPORTS');
      lines.push('──────────────────────────────');

      Object.entries(results.unusedExports).slice(0, 10).forEach(([file, exports]) => {
        lines.push(`\n📄 ${file}:`);
        lines.push(`   Unused: ${exports.join(', ')}`);
      });

      lines.push('\n   💡 Note: These exports are not imported within this project');
      lines.push('      They might be used by external packages or could be removed');
    }

    // Summary and recommendations
    lines.push('\n📋 RECOMMENDATIONS');
    lines.push('──────────────────');

    const totalIssues = results.fileNotFoundImports.length +
                       Object.values(results.missingExports).reduce((sum, arr) => sum + arr.length, 0);

    if (totalIssues === 0) {
      lines.push('✅ Your import/export structure looks good!');
    } else {
      lines.push(`Found ${totalIssues} issue(s) that need attention:`);

      if (results.fileNotFoundImports.length > 0) {
        lines.push(`  1. Fix ${results.fileNotFoundImports.length} missing file reference(s)`);
      }

      if (Object.keys(results.missingExports).length > 0) {
        lines.push(`  2. Resolve ${Object.values(results.missingExports).reduce((sum, arr) => sum + arr.length, 0)} missing export(s)`);
      }

      if (results.circularDependencies && results.circularDependencies.length > 0) {
        lines.push(`  3. Refactor ${results.circularDependencies.length} circular dependency chain(s)`);
      }
    }

    return lines.join('\n');
  }
}

/**
 * Internal analyzer class
 */
class ImportExportAnalyzer {
  constructor(rootDir, ignoreFile = '.gitignore', logger = null) {
    this.rootDir = path.resolve(rootDir);
    this.ignoreFile = ignoreFile;
    this.logger = logger;
    this.ignorePatterns = [...ANALYZER_CONFIG.DEFAULT_IGNORE_PATTERNS];
    this.imports = [];
    this.exports = new Map();
    this.dependencies = new Map(); // For circular dependency detection
  }

  async loadIgnoreFile() {
    try {
      const ignoreFilePath = path.join(this.rootDir, this.ignoreFile);
      const content = await fs.readFile(ignoreFilePath, 'utf-8');
      const patterns = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

      this.ignorePatterns.push(...patterns);
      this.logger?.debug('Loaded ignore patterns', { count: patterns.length });
    } catch {
      // Ignore file doesn't exist, use defaults
      this.logger?.debug('No ignore file found, using defaults');
    }
  }

  shouldIgnoreFile(filePath) {
    const relativePath = path.relative(this.rootDir, filePath);
    return this.ignorePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(relativePath) || regex.test(path.basename(filePath));
      }
      return relativePath.includes(pattern) || path.basename(filePath) === pattern;
    });
  }

  async getAllFiles(dir) {
    const files = [];

    const traverse = async (currentDir) => {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);

          if (this.shouldIgnoreFile(fullPath)) {
            continue;
          }

          if (entry.isDirectory()) {
            await traverse(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (ANALYZER_CONFIG.SUPPORTED_EXTENSIONS.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        // Skip directories we can't read
        this.logger?.warn('Cannot read directory', { dir: currentDir, error: error.message });
      }
    };

    await traverse(dir);

    // Safety check
    if (files.length > ANALYZER_CONFIG.MAX_FILES) {
      this.logger?.warn(`File count exceeds limit: ${files.length} > ${ANALYZER_CONFIG.MAX_FILES}`);
      throw new Error(`Too many files to analyze: ${files.length} (max: ${ANALYZER_CONFIG.MAX_FILES})`);
    }

    return files;
  }

  async parseImports(content, filePath) {
    const imports = [];
    const lines = content.split('\n');
    const relativePath = this.getRelativePath(filePath);

    // Track dependencies for circular detection
    if (!this.dependencies.has(relativePath)) {
      this.dependencies.set(relativePath, new Set());
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('//') || line.startsWith('/*')) continue;

      // Build multi-line statements
      let fullStatement = line;
      let j = i;
      while (!fullStatement.includes(';') && !fullStatement.match(/from\s+['"`][^'"`]+['"`]/) && j < lines.length - 1) {
        j++;
        const nextLine = lines[j].trim();
        // Skip commented lines when building multi-line statements
        if (nextLine.startsWith('//') || nextLine.startsWith('/*')) {
          continue;
        }
        fullStatement += ' ' + nextLine;
      }

      // ES6 imports
      const importRegex = /import\s+(?:(?:\{([^}]+)\})|(?:([^,\s]+)(?:\s*,\s*\{([^}]+)\})?)|(?:\*\s+as\s+([^,\s]+)))\s+from\s+['"`]([^'"`]+)['"`]/g;
      let match;

      while ((match = importRegex.exec(fullStatement)) !== null) {
        const [, namedImports, defaultImport, additionalNamed, namespaceImport, source] = match;
        const resolvedSource = await this.resolveImportPath(source, filePath);

        // Track dependency
        if (!resolvedSource.isExternal && resolvedSource.exists) {
          this.dependencies.get(relativePath).add(resolvedSource.path);
        }

        if (defaultImport) {
          imports.push({
            importingFile: relativePath,
            importedSymbol: defaultImport.trim(),
            importedFromFile: resolvedSource.path,
            fileExists: resolvedSource.exists,
            isExternal: resolvedSource.isExternal || false,
            isDefault: true
          });
        }

        if (namespaceImport) {
          imports.push({
            importingFile: relativePath,
            importedSymbol: namespaceImport.trim(),
            importedFromFile: resolvedSource.path,
            fileExists: resolvedSource.exists,
            isExternal: resolvedSource.isExternal || false,
            isNamespace: true
          });
        }

        const allNamedImports = [namedImports, additionalNamed].filter(Boolean).join(',');
        if (allNamedImports) {
          const symbols = allNamedImports.split(',').map(s => {
            const parts = s.trim().split(/\s+as\s+/);
            return parts[0].trim();
          });

          symbols.forEach(symbol => {
            if (symbol) {
              imports.push({
                importingFile: relativePath,
                importedSymbol: symbol,
                importedFromFile: resolvedSource.path,
                fileExists: resolvedSource.exists,
                isExternal: resolvedSource.isExternal || false,
                isDefault: false
              });
            }
          });
        }
      }

      // CommonJS requires
      const requireRegex = /(?:const|let|var)\s+(?:\{([^}]+)\}|([^=\s]+))\s*=\s*require\(['"`]([^'"`]+)['"`]\)/g;
      while ((match = requireRegex.exec(fullStatement)) !== null) {
        const [, destructured, variable, source] = match;
        const resolvedSource = await this.resolveImportPath(source, filePath);

        // Track dependency
        if (!resolvedSource.isExternal && resolvedSource.exists) {
          this.dependencies.get(relativePath).add(resolvedSource.path);
        }

        if (destructured) {
          const symbols = destructured.split(',').map(s => s.trim().split(':')[0].trim());
          symbols.forEach(symbol => {
            if (symbol) {
              imports.push({
                importingFile: relativePath,
                importedSymbol: symbol,
                importedFromFile: resolvedSource.path,
                fileExists: resolvedSource.exists,
                isExternal: resolvedSource.isExternal || false,
                isDefault: false
              });
            }
          });
        } else if (variable) {
          imports.push({
            importingFile: relativePath,
            importedSymbol: variable.trim(),
            importedFromFile: resolvedSource.path,
            fileExists: resolvedSource.exists,
            isExternal: resolvedSource.isExternal || false,
            isDefault: true
          });
        }
      }

      // Skip lines that were already processed as part of multi-line statement
      i = j;
    }

    return imports;
  }

  parseExports(content) {
    const exports = new Set();
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) continue;

      // Export default
      if (/export\s+default\s+/.test(trimmedLine)) {
        exports.add('default');
      }

      // Named exports
      const namedExportMatch = trimmedLine.match(/export\s+\{([^}]+)\}/);
      if (namedExportMatch) {
        const symbols = namedExportMatch[1].split(',').map(s => {
          const parts = s.trim().split(/\s+as\s+/);
          return parts[parts.length - 1].trim();
        });
        symbols.forEach(symbol => exports.add(symbol));
      }

      // Direct exports
      const directExportMatch = trimmedLine.match(/export\s+(?:const|let|var|function|class|async\s+function)\s+([^=\s(]+)/);
      if (directExportMatch) {
        exports.add(directExportMatch[1]);
      }

      // Export from
      const exportFromMatch = trimmedLine.match(/export\s+\{([^}]+)\}\s+from/);
      if (exportFromMatch) {
        const symbols = exportFromMatch[1].split(',').map(s => {
          const parts = s.trim().split(/\s+as\s+/);
          return parts[parts.length - 1].trim();
        });
        symbols.forEach(symbol => exports.add(symbol));
      }

      // Export all
      if (/export\s+\*\s+from/.test(trimmedLine)) {
        exports.add('*');
      }

      // CommonJS exports
      const moduleExportsMatch = trimmedLine.match(/module\.exports\s*=\s*\{([^}]+)\}/);
      if (moduleExportsMatch) {
        const symbols = moduleExportsMatch[1].split(',').map(s => {
          const parts = s.trim().split(':');
          return parts[0].trim();
        });
        symbols.forEach(symbol => exports.add(symbol));
      }

      if (/module\.exports\s*=\s*[^{]/.test(trimmedLine)) {
        exports.add('default');
      }

      const moduleExportsPropMatch = trimmedLine.match(/module\.exports\.([^=\s]+)\s*=/);
      if (moduleExportsPropMatch) {
        exports.add(moduleExportsPropMatch[1]);
      }

      const exportsPropMatch = trimmedLine.match(/exports\.([^=\s]+)\s*=/);
      if (exportsPropMatch) {
        exports.add(exportsPropMatch[1]);
      }
    }

    return exports;
  }

  async resolveImportPath(importPath, currentFile) {
    if (importPath.startsWith('.')) {
      const currentDir = path.dirname(currentFile);
      const resolved = path.resolve(currentDir, importPath);

      // Try with extension first if provided
      if (path.extname(importPath)) {
        try {
          const stat = await fs.stat(resolved);
          if (stat.isFile()) {
            return {
              path: this.getRelativePath(resolved),
              exists: true
            };
          }
        } catch {
          // File doesn't exist
        }
      }

      // Try different extensions
      const extensions = ['', '.js', '.mjs', '.ts', '.jsx', '.tsx', '/index.js', '/index.ts', '/index.jsx', '/index.tsx'];
      for (const ext of extensions) {
        const withExt = resolved + ext;
        try {
          const stat = await fs.stat(withExt);
          if (stat.isFile()) {
            return {
              path: this.getRelativePath(withExt),
              exists: true
            };
          }
        } catch {
          // Try next
        }
      }

      return {
        path: this.getRelativePath(resolved),
        exists: false
      };
    }

    // Node modules or absolute imports
    return {
      path: importPath,
      exists: true,
      isExternal: true
    };
  }

  getRelativePath(filePath) {
    return path.relative(this.rootDir, filePath).replace(/\\/g, '/');
  }

  findCircularDependencies() {
    const cycles = [];
    const visited = new Set();
    const recursionStack = new Set();

    const dfs = (node, path = []) => {
      if (recursionStack.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), node]);
        }
        return;
      }

      if (visited.has(node)) {
        return;
      }

      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const deps = this.dependencies.get(node) || new Set();
      for (const dep of deps) {
        dfs(dep, [...path]);
      }

      recursionStack.delete(node);
    };

    for (const node of this.dependencies.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  findUnusedExports() {
    const usedExports = new Map();

    // Track which exports are actually imported
    for (const imp of this.imports) {
      if (!imp.isExternal) {
        if (!usedExports.has(imp.importedFromFile)) {
          usedExports.set(imp.importedFromFile, new Set());
        }
        usedExports.get(imp.importedFromFile).add(imp.importedSymbol);
      }
    }

    // Find exports that are never imported
    const unusedExports = {};
    for (const [file, exports] of this.exports.entries()) {
      const used = usedExports.get(file) || new Set();
      const unused = Array.from(exports).filter(exp => !used.has(exp) && exp !== '*');

      if (unused.length > 0) {
        unusedExports[file] = unused;
      }
    }

    return unusedExports;
  }

  async analyze(mode = 'full') {
    this.logger?.info('Starting import analysis', { mode, rootDir: this.rootDir });

    await this.loadIgnoreFile();

    const files = await this.getAllFiles(this.rootDir);
    this.logger?.info('Found files', { count: files.length });

    // Parse all files
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const relativeFile = this.getRelativePath(file);

        const fileImports = await this.parseImports(content, file);
        this.imports.push(...fileImports);

        const fileExports = this.parseExports(content);
        this.exports.set(relativeFile, fileExports);
      } catch (error) {
        // Skip files with errors
        this.logger?.warn('Error parsing file', { file, error: error.message });
      }
    }

    this.logger?.info('Parsed all files', { imports: this.imports.length, exports: this.exports.size });

    // Analyze issues
    const results = {
      summary: {
        totalFiles: files.length,
        totalImports: this.imports.length,
        totalExports: Array.from(this.exports.values()).reduce((sum, exports) => sum + exports.size, 0)
      },
      missingExports: {},
      missingFiles: {},
      fileNotFoundImports: []
    };

    // Check imports
    for (const importEntry of this.imports) {
      const { importingFile, importedSymbol, importedFromFile, isDefault, isNamespace, fileExists, isExternal } = importEntry;

      if (!fileExists && !isExternal) {
        results.fileNotFoundImports.push({
          importingFile,
          importedSymbol,
          importedFromFile,
          isDefault: isDefault || false,
          isNamespace: isNamespace || false
        });

        if (!results.missingFiles[importingFile]) {
          results.missingFiles[importingFile] = [];
        }

        results.missingFiles[importingFile].push({
          missingFile: importedFromFile,
          importedSymbol,
          isDefault: isDefault || false,
          isNamespace: isNamespace || false
        });

        continue;
      }

      if (isExternal) continue;

      const exportingFileExports = this.exports.get(importedFromFile);
      let exists = false;

      if (exportingFileExports) {
        if (isNamespace) {
          exists = exportingFileExports.size > 0;
        } else if (isDefault) {
          exists = exportingFileExports.has('default');
        } else {
          exists = exportingFileExports.has(importedSymbol) || exportingFileExports.has('*');
        }
      }

      if (!exists) {
        if (!results.missingExports[importingFile]) {
          results.missingExports[importingFile] = [];
        }

        results.missingExports[importingFile].push({
          importedSymbol,
          importedFromFile,
          availableExports: exportingFileExports ? Array.from(exportingFileExports) : [],
          isDefault: isDefault || false,
          isNamespace: isNamespace || false
        });
      }
    }

    // Additional analysis for full mode
    if (mode === 'full' || mode === 'fix') {
      this.logger?.info('Running full analysis');
      results.circularDependencies = this.findCircularDependencies();
      results.unusedExports = this.findUnusedExports();
    }

    this.logger?.info('Analysis complete', {
      missingFiles: results.fileNotFoundImports.length,
      missingExports: Object.keys(results.missingExports).length
    });

    return results;
  }
}

export default ImportAnalyzerTool;
