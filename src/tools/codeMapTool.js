/**
 * @file src/tools/codeMapTool.js
 * @description Code Map Tool — structural code exploration with multi-level skeleton extraction
 * and line-range reading. Enables agents to understand large codebases without reading entire files.
 *
 * Workflow: skeleton scan → identify interesting areas → read-range for details
 */

import { BaseTool } from './baseTool.js';
import fs from 'fs';
import path from 'path';

const CODE_MAP_CONFIG = {
  SUPPORTED_EXTENSIONS: new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py']),
  MAX_FILES: 500,
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB per file
  MAX_READ_RANGE: 500,            // Max lines per read-range call
  MAX_DIRECTORY_DEPTH: 20,
  VALID_LEVELS: ['A.0', 'A.1', 'B.0', 'B.1'],
  DEFAULT_LEVEL: 'B.0',
  SKIP_DIRS: new Set(['node_modules', '__pycache__', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt'])
};

class CodeMapTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    this.id = 'code-map';
    this.requiresProject = true;
    this.isAsync = true;
    this.timeout = config.timeout || 120000;
  }

  getDescription() {
    return `Code Map Tool: Explore code structure without reading entire files. Two-step workflow:

1. **skeleton** — Extract structural overview (signatures, classes, functions) with line numbers
2. **read-range** — Read specific line ranges identified from the skeleton

SKELETON LEVELS:
- A.0: Public/exported signatures only
- A.1: Public/exported signatures + comments/docstrings
- B.0: All signatures (public + private + methods) — DEFAULT
- B.1: All signatures + comments/docstrings

Supported files: .js, .ts, .jsx, .tsx, .mjs, .cjs, .py
Respects .gitignore rules. Skips node_modules, __pycache__, .git, dist, build.

USAGE — Skeleton scan:
\`\`\`json
{
  "toolId": "code-map",
  "parameters": {
    "action": "skeleton",
    "path": "src/",
    "level": "B.0",
    "includeImports": false
  }
}
\`\`\`

Or for a single file:
\`\`\`json
{
  "toolId": "code-map",
  "parameters": {
    "action": "skeleton",
    "path": "src/services/aiService.js",
    "level": "A.0"
  }
}
\`\`\`

USAGE — Read specific lines (use line numbers from skeleton output):
\`\`\`json
{
  "toolId": "code-map",
  "parameters": {
    "action": "read-range",
    "filePath": "src/services/aiService.js",
    "startLine": 42,
    "endLine": 90
  }
}
\`\`\`

XML format also supported:
<code-map>
  <action>skeleton</action>
  <path>src/</path>
  <level>B.0</level>
</code-map>

<code-map>
  <action>read-range</action>
  <file-path>src/index.js</file-path>
  <start-line>100</start-line>
  <end-line>150</end-line>
</code-map>`;
  }

  parseParameters(content) {
    try {
      if (content.trim().startsWith('{')) {
        const parsed = JSON.parse(content);
        return {
          action: parsed.action || parsed.parameters?.action,
          path: parsed.path || parsed.parameters?.path,
          level: parsed.level || parsed.parameters?.level,
          includeImports: parsed.includeImports ?? parsed.parameters?.includeImports ?? false,
          filePath: parsed.filePath || parsed.parameters?.filePath,
          startLine: parsed.startLine ?? parsed.parameters?.startLine,
          endLine: parsed.endLine ?? parsed.parameters?.endLine
        };
      }

      // XML parsing
      const params = {};
      const actionMatch = /<action>(.*?)<\/action>/i.exec(content);
      if (actionMatch) params.action = actionMatch[1].trim();

      const pathMatch = /<path>(.*?)<\/path>/i.exec(content);
      if (pathMatch) params.path = pathMatch[1].trim();

      const levelMatch = /<level>(.*?)<\/level>/i.exec(content);
      if (levelMatch) params.level = levelMatch[1].trim();

      const importsMatch = /<include-imports>(.*?)<\/include-imports>/i.exec(content);
      if (importsMatch) params.includeImports = importsMatch[1].trim() === 'true';

      const filePathMatch = /<file-path>(.*?)<\/file-path>/i.exec(content);
      if (filePathMatch) params.filePath = filePathMatch[1].trim();

      const startLineMatch = /<start-line>(.*?)<\/start-line>/i.exec(content);
      if (startLineMatch) params.startLine = parseInt(startLineMatch[1].trim(), 10);

      const endLineMatch = /<end-line>(.*?)<\/end-line>/i.exec(content);
      if (endLineMatch) params.endLine = parseInt(endLineMatch[1].trim(), 10);

      return params;
    } catch (error) {
      this.logger?.error('Failed to parse code-map parameters', { error: error.message });
      return { parseError: error.message };
    }
  }

  getRequiredParameters() {
    return ['action'];
  }

  customValidateParameters(params) {
    const errors = [];

    if (!params.action) {
      errors.push('action is required (skeleton or read-range)');
    } else if (!['skeleton', 'read-range'].includes(params.action)) {
      errors.push(`Invalid action "${params.action}". Must be "skeleton" or "read-range"`);
    }

    if (params.action === 'skeleton') {
      if (!params.path) errors.push('path is required for skeleton action');
      if (params.level && !CODE_MAP_CONFIG.VALID_LEVELS.includes(params.level.toUpperCase())) {
        errors.push(`Invalid level "${params.level}". Must be one of: ${CODE_MAP_CONFIG.VALID_LEVELS.join(', ')}`);
      }
    }

    if (params.action === 'read-range') {
      if (!params.filePath) errors.push('filePath is required for read-range action');
      if (params.startLine == null) errors.push('startLine is required for read-range action');
      if (params.endLine == null) errors.push('endLine is required for read-range action');
      if (params.startLine != null && params.endLine != null) {
        if (params.startLine < 1) errors.push('startLine must be >= 1');
        if (params.endLine < params.startLine) errors.push('endLine must be >= startLine');
        if (params.endLine - params.startLine + 1 > CODE_MAP_CONFIG.MAX_READ_RANGE) {
          errors.push(`Range too large. Maximum ${CODE_MAP_CONFIG.MAX_READ_RANGE} lines per request`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(params, context) {
    const { projectDir, directoryAccess } = context;

    let workingDir = projectDir || process.cwd();
    if (directoryAccess?.workingDirectory) {
      workingDir = directoryAccess.workingDirectory;
    }

    const accessibleDirs = this._getAccessibleDirectories(directoryAccess, workingDir);

    switch (params.action) {
      case 'skeleton':
        return await this._executeSkeleton(params, workingDir, accessibleDirs);
      case 'read-range':
        return await this._executeReadRange(params, workingDir, accessibleDirs);
      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  }

  // ── Directory access helpers ──────────────────────────────────────────────

  _getAccessibleDirectories(directoryAccess, fallbackDir) {
    const dirs = new Set();
    dirs.add(fallbackDir);

    if (directoryAccess) {
      if (directoryAccess.workingDirectory) dirs.add(directoryAccess.workingDirectory);
      if (directoryAccess.readOnlyDirectories) {
        for (const d of directoryAccess.readOnlyDirectories) dirs.add(d);
      }
      if (directoryAccess.writeEnabledDirectories) {
        for (const d of directoryAccess.writeEnabledDirectories) dirs.add(d);
      }
    }

    return Array.from(dirs);
  }

  _isPathAccessible(targetPath, accessibleDirs) {
    for (const dir of accessibleDirs) {
      const relative = path.relative(dir, targetPath);
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) return true;
    }
    return false;
  }

  // ── Skeleton action ───────────────────────────────────────────────────────

  async _executeSkeleton(params, workingDir, accessibleDirs) {
    const targetPath = path.resolve(workingDir, params.path);

    if (!this._isPathAccessible(targetPath, accessibleDirs)) {
      throw new Error(`Path not accessible: ${params.path}`);
    }

    const level = (params.level || CODE_MAP_CONFIG.DEFAULT_LEVEL).toUpperCase();
    const publicOnly = level.startsWith('A');
    const withComments = level.endsWith('.1');
    const includeImports = params.includeImports || false;
    const parseOptions = { publicOnly, withComments, includeImports };

    let stat;
    try {
      stat = await fs.promises.stat(targetPath);
    } catch {
      throw new Error(`Path not found: ${params.path}`);
    }

    let files;
    if (stat.isFile()) {
      const ext = path.extname(targetPath).toLowerCase();
      if (!CODE_MAP_CONFIG.SUPPORTED_EXTENSIONS.has(ext)) {
        throw new Error(`Unsupported file type: ${ext}. Supported: ${[...CODE_MAP_CONFIG.SUPPORTED_EXTENSIONS].join(', ')}`);
      }
      files = [targetPath];
    } else {
      files = await this._discoverFiles(targetPath, accessibleDirs);
    }

    if (files.length === 0) {
      return {
        success: true,
        action: 'skeleton',
        level,
        path: params.path,
        files: [],
        totalFiles: 0,
        totalEntries: 0,
        message: 'No supported files found in the specified path.',
        guidance: 'Try a different path or verify the directory contains .js, .ts, .jsx, .tsx, .mjs, .cjs, or .py files.'
      };
    }

    if (files.length > CODE_MAP_CONFIG.MAX_FILES) {
      files = files.slice(0, CODE_MAP_CONFIG.MAX_FILES);
    }

    const basePath = stat.isDirectory() ? targetPath : path.dirname(targetPath);
    const result = [];
    let totalEntries = 0;

    for (const file of files) {
      try {
        const fileStat = await fs.promises.stat(file);
        if (fileStat.size > CODE_MAP_CONFIG.MAX_FILE_SIZE) continue;

        const content = await fs.promises.readFile(file, 'utf-8');
        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const lang = this._langOf(file);

        const entries = lang === 'python'
          ? this._parsePython(lines, parseOptions)
          : this._parseJS(lines, parseOptions);

        if (entries.length === 0) continue;

        const relPath = path.relative(basePath, file);
        result.push({
          file: relPath,
          totalLines: lines.length,
          entries
        });
        totalEntries += entries.length;
      } catch (err) {
        this.logger?.debug(`Skipping file ${file}: ${err.message}`);
      }
    }

    return {
      success: true,
      action: 'skeleton',
      level,
      path: params.path,
      files: result,
      totalFiles: result.length,
      totalEntries,
      guidance: totalEntries > 0
        ? (() => {
            const sampleFile = result[0];
            const sampleLine = sampleFile?.entries[0]?.line || 1;
            const examplePath = stat.isDirectory()
              ? (params.path.endsWith('/') ? params.path : params.path + '/') + sampleFile.file
              : params.path;
            return `Found ${totalEntries} entries across ${result.length} files. Use code-map read-range to examine specific sections by line number. Example: {"toolId":"code-map","parameters":{"action":"read-range","filePath":"${examplePath}","startLine":${sampleLine},"endLine":${sampleLine + 30}}}`;
          })()
        : 'No code signatures found at this level. Try level B.0 or B.1 for more detail.'
    };
  }

  // ── Read-range action ─────────────────────────────────────────────────────

  async _executeReadRange(params, workingDir, accessibleDirs) {
    const filePath = path.resolve(workingDir, params.filePath);

    if (!this._isPathAccessible(filePath, accessibleDirs)) {
      throw new Error(`Path not accessible: ${params.filePath}`);
    }

    let content;
    try {
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      throw new Error(`File not found: ${params.filePath}`);
    }

    const allLines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const totalLines = allLines.length;
    const startLine = Math.max(1, params.startLine);
    const endLine = Math.min(totalLines, params.endLine);

    if (startLine > totalLines) {
      throw new Error(`startLine ${startLine} exceeds file length (${totalLines} lines)`);
    }

    const selectedLines = allLines.slice(startLine - 1, endLine);
    const maxWidth = String(endLine).length;
    const formatted = selectedLines.map((line, i) => {
      const num = String(startLine + i).padStart(maxWidth);
      return `${num}│${line}`;
    }).join('\n');

    return {
      success: true,
      action: 'read-range',
      filePath: params.filePath,
      startLine,
      endLine,
      linesReturned: selectedLines.length,
      totalLines,
      content: formatted,
      guidance: `Showing lines ${startLine}-${endLine} of ${totalLines}. ` +
        (endLine < totalLines
          ? `Use read-range with startLine:${endLine + 1} to continue reading. `
          : '') +
        'Use code-map skeleton to discover more code structure in other files.'
    };
  }

  // ── File discovery with .gitignore ────────────────────────────────────────

  async _discoverFiles(rootDir, accessibleDirs) {
    const gi = await this._loadGitignoreRules(rootDir);
    const results = [];
    let depth = 0;

    const walk = async (dir) => {
      if (depth > CODE_MAP_CONFIG.MAX_DIRECTORY_DEPTH) return;
      if (results.length >= CODE_MAP_CONFIG.MAX_FILES) return;

      const rel = path.relative(rootDir, dir);
      if (rel) gi.loadNested(dir, rel);

      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      // Sort for deterministic output
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (results.length >= CODE_MAP_CONFIG.MAX_FILES) break;
        if (entry.name.startsWith('.')) continue;

        const full = path.join(dir, entry.name);
        const entryRel = path.relative(rootDir, full);

        if (entry.isDirectory()) {
          if (CODE_MAP_CONFIG.SKIP_DIRS.has(entry.name)) continue;
          if (gi.isIgnored(entryRel, true) && !gi.hasNegationUnder(entryRel)) continue;
          if (!this._isPathAccessible(full, accessibleDirs)) continue;

          depth++;
          await walk(full);
          depth--;
        } else if (CODE_MAP_CONFIG.SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          if (gi.isIgnored(entryRel, false)) continue;
          results.push(full);
        }
      }
    };

    await walk(rootDir);
    return results;
  }

  // ── .gitignore support ────────────────────────────────────────────────────

  async _loadGitignoreRules(rootDir) {
    const allRules = [];

    const giPath = path.join(rootDir, '.gitignore');
    try {
      const content = await fs.promises.readFile(giPath, 'utf-8');
      allRules.push(...this._parseGitignore(content, ''));
    } catch {
      // No .gitignore at root — that's fine
    }

    return {
      rules: allRules,

      loadNested: (subDir, relPath) => {
        const nested = path.join(subDir, '.gitignore');
        try {
          const content = fs.readFileSync(nested, 'utf-8');
          const prefix = relPath ? relPath + '/' : '';
          allRules.push(...this._parseGitignore(content, prefix));
        } catch {
          // No nested .gitignore
        }
      },

      isIgnored: (relPath, isDir) => {
        let ignored = false;
        for (const rule of allRules) {
          if (rule.dirOnly && !isDir) {
            const parts = relPath.split('/');
            let parentMatch = false;
            for (let k = 1; k < parts.length; k++) {
              const parentPath = parts.slice(0, k).join('/');
              if (rule.regex.test(parentPath)) { parentMatch = true; break; }
            }
            if (!parentMatch) continue;
          } else if (!rule.regex.test(relPath)) {
            continue;
          }
          ignored = !rule.negate;
        }
        return ignored;
      },

      hasNegationUnder: (dirRelPath) => {
        const prefix = dirRelPath + '/';
        for (const rule of allRules) {
          if (!rule.negate) continue;
          if (rule.regex.test(prefix + 'x') || rule.regex.test(prefix + 'x.js')) return true;
          if (rule.regex.source.includes(dirRelPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) return true;
        }
        return false;
      }
    };
  }

  _parseGitignore(content, prefix) {
    const rules = [];
    for (const rawLine of content.split('\n')) {
      let line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      let negate = false;
      if (line.startsWith('!')) {
        negate = true;
        line = line.slice(1);
      }

      line = line.replace(/\\(\s)$/, '$1');

      let dirOnly = false;
      if (line.endsWith('/')) {
        dirOnly = true;
        line = line.slice(0, -1);
      }

      const hasSlash = line.includes('/');
      const rooted = line.startsWith('/');
      if (rooted) line = line.slice(1);

      let reStr;
      if (hasSlash || rooted) {
        reStr = '^' + prefix + this._gitignorePatternToRegex(line) + '(/.*)?$';
      } else {
        reStr = '(^|.+/)' + prefix + this._gitignorePatternToRegex(line) + '(/.*)?$';
      }

      try {
        rules.push({ regex: new RegExp(reStr), negate, dirOnly });
      } catch {
        // skip invalid patterns
      }
    }
    return rules;
  }

  _gitignorePatternToRegex(pattern) {
    let re = '';
    let i = 0;
    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === '*' && pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          re += '(.+/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else if (ch === '*') {
        re += '[^/]*';
        i++;
      } else if (ch === '?') {
        re += '[^/]';
        i++;
      } else if (ch === '[') {
        const end = pattern.indexOf(']', i + 1);
        if (end === -1) { re += '\\['; i++; }
        else { re += pattern.slice(i, end + 1); i = end + 1; }
      } else if ('.+^${}()|\\'.includes(ch)) {
        re += '\\' + ch;
        i++;
      } else {
        re += ch;
        i++;
      }
    }
    return re;
  }

  // ── Language detection ────────────────────────────────────────────────────

  _langOf(file) {
    return path.extname(file).toLowerCase() === '.py' ? 'python' : 'js';
  }

  // ── JS / TS parser ────────────────────────────────────────────────────────

  _parseJS(lines, { publicOnly, withComments, includeImports }) {
    const entries = [];
    let pendingComments = [];
    let inBlockComment = false;
    let blockCommentLines = [];

    let classDepth = 0;
    let braceStack = [];
    let braceDepth = 0;
    let methodDepths = [];

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const raw = lines[i];
      const trimmed = raw.trim();

      // block-comment tracking
      if (inBlockComment) {
        blockCommentLines.push({ line: lineNum, text: raw, kind: 'comment' });
        if (trimmed.includes('*/')) {
          inBlockComment = false;
          pendingComments = blockCommentLines;
          blockCommentLines = [];
        }
        continue;
      }

      if (trimmed.startsWith('/*')) {
        blockCommentLines = [{ line: lineNum, text: raw, kind: 'comment' }];
        if (trimmed.includes('*/')) {
          pendingComments = blockCommentLines;
          blockCommentLines = [];
        } else {
          inBlockComment = true;
        }
        continue;
      }

      if (trimmed.startsWith('//')) {
        pendingComments.push({ line: lineNum, text: raw, kind: 'comment' });
        continue;
      }

      // imports
      if (includeImports) {
        if (/^\s*import\s/.test(raw) || /\brequire\s*\(/.test(raw)) {
          entries.push({ line: lineNum, text: raw, kind: 'import' });
          pendingComments = [];
          continue;
        }
      }

      // brace tracking for class context
      const stripped = trimmed
        .replace(/\/\/.*$/, '')
        .replace(/`[^`]*`/g, '')
        .replace(/"(?:[^"\\]|\\.)*"/g, '')
        .replace(/'(?:[^'\\]|\\.)*'/g, '');
      const opens = (stripped.match(/\{/g) || []).length;
      const closes = (stripped.match(/\}/g) || []).length;

      const braceDepthBeforeLine = braceDepth;

      if (/^\s*(export\s+)?(default\s+)?(abstract\s+)?class\s/.test(raw) && opens > 0) {
        braceStack.push({ depth: braceDepth, type: 'class' });
        methodDepths.push(braceDepth + 1);
        classDepth++;
      }

      braceDepth += opens - closes;

      while (braceStack.length > 0 && braceDepth <= braceStack[braceStack.length - 1].depth) {
        const popped = braceStack.pop();
        if (popped.type === 'class') {
          classDepth--;
          methodDepths.pop();
        }
      }

      // detect signatures
      const isExport = /^\s*export\s/.test(raw);
      const isModuleExports = /^\s*module\.exports(\.\w+)?\s*=/.test(raw);
      const isExportsAssign = /^\s*exports\.\w+\s*=/.test(raw);
      const isPublic = isExport || isModuleExports || isExportsAssign;

      let matched = false;

      if (isExport) {
        if (/^\s*export\s+(default\s+)?(async\s+)?(function\b|class\b|const\b|let\b|var\b|enum\b|interface\b|type\b|abstract\b)/.test(raw)) {
          matched = true;
        }
      }

      if (isModuleExports || isExportsAssign) {
        matched = true;
      }

      if (!matched && !publicOnly) {
        if (/^\s*(async\s+)?function\s+\w+/.test(raw)) matched = true;
        if (/^\s*(abstract\s+)?class\s+\w+/.test(raw)) matched = true;
        if (/^\s*(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/.test(raw) && raw.includes('=>')) matched = true;
        if (/^\s*(const|let|var)\s+\w+\s*=\s*(async\s+)?function/.test(raw)) matched = true;
        if (/^\s*(const|let|var)\s+\w+\s*=\s*(async\s+)?\w+\s*=>/.test(raw)) matched = true;

        // method inside class
        const atMethodDepth = methodDepths.length > 0 && braceDepthBeforeLine === methodDepths[methodDepths.length - 1];
        if (classDepth > 0 && atMethodDepth && /^\s+(?:(?:private|protected|public|readonly|abstract|override|async|static|get|set)\s+)*(\w+)\s*[\(<]/.test(raw) && !isExport) {
          const methodMatch = raw.match(/^\s+(?:(?:private|protected|public|readonly|abstract|override|async|static|get|set)\s+)*(\w+)\s*[\(<]/);
          if (methodMatch) {
            const name = methodMatch[1];
            const isCall = /\)\s*;?\s*$/.test(trimmed) && !/\)\s*\{/.test(trimmed) && !/\)\s*:\s*\S/.test(trimmed);
            const excluded = ['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'typeof', 'delete', 'void', 'await', 'class', 'function', 'const', 'let', 'var', 'super', 'this'];
            if (!isCall && !excluded.includes(name)) matched = true;
          }
        }
      }

      if (!matched && isPublic) matched = true;

      if (matched && publicOnly && !isPublic) {
        pendingComments = [];
        continue;
      }

      if (matched) {
        if (withComments && pendingComments.length > 0) {
          for (const c of pendingComments) entries.push(c);
        }
        entries.push({ line: lineNum, text: raw, kind: 'signature' });
        pendingComments = [];
      } else {
        pendingComments = [];
      }
    }

    return entries;
  }

  // ── Python parser ─────────────────────────────────────────────────────────

  _parsePython(lines, { publicOnly, withComments, includeImports }) {
    const entries = [];
    let pendingComments = [];
    let i = 0;

    while (i < lines.length) {
      const lineNum = i + 1;
      const raw = lines[i];
      const trimmed = raw.trim();

      // imports
      if (includeImports) {
        if (/^\s*(import\s|from\s+\S+\s+import\s)/.test(raw)) {
          entries.push({ line: lineNum, text: raw, kind: 'import' });
          pendingComments = [];
          i++;
          continue;
        }
      }

      // # comments
      if (trimmed.startsWith('#')) {
        pendingComments.push({ line: lineNum, text: raw, kind: 'comment' });
        i++;
        continue;
      }

      // decorators
      if (trimmed.startsWith('@')) {
        pendingComments.push({ line: lineNum, text: raw, kind: 'decorator' });
        i++;
        continue;
      }

      // def / async def / class
      const ID = /[\p{L}\p{N}_]+/u.source;
      const defMatch = raw.match(new RegExp(`^(\\s*)(async\\s+)?def\\s+(${ID})\\s*\\(`, 'u'));
      const classMatch = !defMatch ? raw.match(new RegExp(`^(\\s*)(class)\\s+(${ID})`, 'u')) : null;
      const sigMatch = defMatch || classMatch;

      if (sigMatch) {
        const name = sigMatch[3];
        const isPublic = !name.startsWith('_');

        if (publicOnly && !isPublic) {
          pendingComments = [];
          i++;
          if (defMatch && !raw.includes('):') && !raw.includes(')')) {
            while (i < lines.length) {
              const pline = lines[i].trim();
              i++;
              if (pline.includes('):') || (pline.startsWith(')') && pline.includes(':'))) break;
            }
          }
          i = this._skipPythonDocstring(lines, i);
          continue;
        }

        if (withComments && pendingComments.length > 0) {
          for (const c of pendingComments) entries.push(c);
        }
        entries.push({ line: lineNum, text: raw, kind: 'signature' });
        pendingComments = [];
        i++;

        if (defMatch && !raw.includes('):') && !raw.includes(')')) {
          while (i < lines.length) {
            const pline = lines[i].trim();
            i++;
            if (pline.includes('):') || (pline.startsWith(')') && pline.includes(':'))) break;
          }
        }

        if (withComments) {
          const dsLines = this._collectPythonDocstring(lines, i);
          for (const ds of dsLines) entries.push(ds);
          i += dsLines.length;
        } else {
          i = this._skipPythonDocstring(lines, i);
        }
        continue;
      }

      // top-level assignments
      if (/^\S/.test(raw) && new RegExp(`^[\\p{L}_][\\p{L}\\p{N}_]*\\s*=\\s*.+`, 'u').test(trimmed)) {
        const varMatch = trimmed.match(new RegExp(`^([\\p{L}_][\\p{L}\\p{N}_]*)\\s*=`, 'u'));
        if (varMatch) {
          const varName = varMatch[1];
          const isPublicVar = !varName.startsWith('_');
          if (!publicOnly || isPublicVar) {
            if (withComments && pendingComments.length > 0) {
              for (const c of pendingComments) entries.push(c);
            }
            entries.push({ line: lineNum, text: raw, kind: 'data' });
          }
        }
        pendingComments = [];
        i++;
        continue;
      }

      pendingComments = [];
      i++;
    }

    return entries;
  }

  _collectPythonDocstring(lines, startIdx) {
    if (startIdx >= lines.length) return [];
    const first = lines[startIdx].trim();

    if (/^("""|''').*\1\s*$/.test(first)) {
      return [{ line: startIdx + 1, text: lines[startIdx], kind: 'comment' }];
    }

    const tripleMatch = first.match(/^("""|''')/);
    if (!tripleMatch) return [];

    const quote = tripleMatch[1];
    const result = [{ line: startIdx + 1, text: lines[startIdx], kind: 'comment' }];
    for (let j = startIdx + 1; j < lines.length; j++) {
      result.push({ line: j + 1, text: lines[j], kind: 'comment' });
      if (lines[j].includes(quote)) break;
    }
    return result;
  }

  _skipPythonDocstring(lines, startIdx) {
    if (startIdx >= lines.length) return startIdx;
    const first = lines[startIdx].trim();

    if (/^("""|''').*\1\s*$/.test(first)) return startIdx + 1;

    const tripleMatch = first.match(/^("""|''')/);
    if (!tripleMatch) return startIdx;

    const quote = tripleMatch[1];
    for (let j = startIdx + 1; j < lines.length; j++) {
      if (lines[j].includes(quote)) return j + 1;
    }
    return lines.length;
  }
}

export default CodeMapTool;
