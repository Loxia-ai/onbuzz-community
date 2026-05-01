import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// ── Mock fs/promises ──────────────────────────────────────────────
const fsMock = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 500, mtime: new Date() }),
  access: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  mkdir: jest.fn().mockResolvedValue(undefined)
};
jest.unstable_mockModule('fs/promises', () => ({ default: fsMock, ...fsMock }));

// ── Mock crypto ───────────────────────────────────────────────────
jest.unstable_mockModule('crypto', () => ({
  default: {
    createHash: jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('abcdef0123456789abcdef')
    }))
  }
}));

// ── Mock TagParser ────────────────────────────────────────────────
jest.unstable_mockModule('../../utilities/tagParser.js', () => ({
  default: class MockTagParser {
    static extractTagsWithAttributes() { return []; }
    parseAttributes(str) {
      const attrs = {};
      const matches = str.matchAll(/([\w-]+)=["']([^"']+)["']/g);
      for (const m of matches) attrs[m[1]] = m[2];
      return attrs;
    }
  }
}));

// ── Mock DirectoryAccessManager ───────────────────────────────────
jest.unstable_mockModule('../../utilities/directoryAccessManager.js', () => ({
  default: class MockDAM {
    constructor() {}
    createDirectoryAccess(cfg) { return cfg; }
    getWorkingDirectory(cfg) { return cfg?.workingDirectory || '/tmp/test'; }
    validateReadAccess() { return { allowed: true }; }
    validateWriteAccess() { return { allowed: true }; }
    createRelativePath(p) { return p.replace(/^\/tmp\/test\/?/, ''); }
  }
}));

// ── Mock structuredFileValidator ──────────────────────────────────
jest.unstable_mockModule('../../utilities/structuredFileValidator.js', () => ({
  validateContent: jest.fn().mockReturnValue({ valid: true, errors: [] }),
  validateStructuredFile: jest.fn().mockReturnValue({ valid: true, errors: [] }),
  detectFormat: jest.fn().mockReturnValue('json'),
  getSupportedFormats: jest.fn().mockReturnValue(['json', 'yaml', 'xml'])
}));

// ── Mock constants ────────────────────────────────────────────────
jest.unstable_mockModule('../../utilities/constants.js', () => ({
  STATIC_ANALYSIS: {
    ANALYSIS_TIMEOUT: 30000,
    MAX_FILE_SIZE_FOR_ANALYSIS: 5 * 1024 * 1024,
    MAX_FILES_PER_BATCH: 50,
    ENABLE_CACHE: true,
    CACHE_DURATION: 300000,
    SEVERITY: { CRITICAL: 'critical', ERROR: 'error', WARNING: 'warning', INFO: 'info', SUGGESTION: 'suggestion' },
    EXTENSION_TO_LANGUAGE: {
      '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
      '.ts': 'typescript', '.tsx': 'typescript',
      '.py': 'python',
      '.css': 'css', '.scss': 'scss', '.less': 'less'
    },
    LANGUAGE: {
      JAVASCRIPT: 'javascript', TYPESCRIPT: 'typescript', PYTHON: 'python',
      CSS: 'css', SCSS: 'scss', LESS: 'less'
    },
    FRAMEWORK_MANIFESTS: {
      JAVASCRIPT: 'package.json',
      PYTHON: 'requirements.txt',
      PYTHON_POETRY: 'pyproject.toml'
    },
    JS_FRAMEWORKS: { REACT: 'react', VUE: 'vue', ANGULAR: '@angular/core' },
    PYTHON_FRAMEWORKS: { DJANGO: 'django', FLASK: 'flask', FASTAPI: 'fastapi' }
  },
  TOOL_STATUS: { SUCCESS: 'success', ERROR: 'error' },
  SYSTEM_DEFAULTS: { MAX_TOOL_EXECUTION_TIME: 30000 }
}));

// ── Mock BaseTool ─────────────────────────────────────────────────
jest.unstable_mockModule('../baseTool.js', () => ({
  BaseTool: class {
    constructor() {
      this.id = 'staticanalysis';
      this.config = {};
      this.logger = null;
      this.requiresProject = false;
      this.isAsync = false;
      this.timeout = 30000;
      this.maxConcurrentOperations = 1;
      this.builtinDelay = 0;
      this.activeOperations = new Map();
      this.operationHistory = [];
      this.isEnabled = true;
      this.lastUsed = null;
      this.usageCount = 0;
    }
    getDescription() { return ''; }
    getSummary() { return ''; }
  }
}));

const { default: StaticAnalysisTool } = await import('../staticAnalysisTool.js');

// ── Helpers ───────────────────────────────────────────────────────
function createTestSetup() {
  const logger = createMockLogger();
  const tool = new StaticAnalysisTool({}, logger);
  tool.logger = logger;

  const context = {
    projectDir: '/tmp/test',
    agentId: 'test-agent',
    directoryAccess: {
      workingDirectory: '/tmp/test',
      writeEnabledDirectories: ['/tmp/test'],
      restrictToProject: true
    }
  };

  return { tool, context, logger };
}

beforeEach(() => {
  jest.clearAllMocks();
  fsMock.stat.mockResolvedValue({ size: 500, mtime: new Date() });
  fsMock.readFile.mockResolvedValue('const x = 1;');
  fsMock.readdir.mockResolvedValue([]);
});

describe('StaticAnalysisTool', () => {
  // ── constructor ─────────────────────────────────────────────────
  describe('constructor', () => {
    test('initializes with defaults', () => {
      const tool = new StaticAnalysisTool({});
      expect(tool.requiresProject).toBe(true);
      expect(tool.analysisCache).toBeInstanceOf(Map);
      expect(tool.metrics.totalAnalyses).toBe(0);
    });

    test('accepts custom config', () => {
      const tool = new StaticAnalysisTool({ maxFilesPerBatch: 10 });
      expect(tool.maxFilesPerBatch).toBe(10);
    });
  });

  // ── getDescription ──────────────────────────────────────────────
  describe('getDescription', () => {
    test('returns description mentioning supported languages', () => {
      const { tool } = createTestSetup();
      const desc = tool.getDescription();
      expect(desc).toContain('JavaScript');
      expect(desc).toContain('TypeScript');
      expect(desc).toContain('Python');
    });
  });

  // ── parseParameters ─────────────────────────────────────────────
  describe('parseParameters', () => {
    test('returns params object with actions array', () => {
      const { tool } = createTestSetup();
      const result = tool.parseParameters('<analyze file-path="src/index.js" />');
      expect(result.actions).toBeDefined();
    });
  });

  // ── customValidateParameters ────────────────────────────────────
  describe('customValidateParameters', () => {
    test('valid with correct analyze action', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'analyze', filePath: 'src/index.js' }]
      });
      expect(result.valid).toBe(true);
    });

    test('invalid when actions is empty', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({ actions: [] });
      expect(result.valid).toBe(false);
    });

    test('invalid when filePath missing for analyze', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'analyze' }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('file-path is required');
    });

    test('invalid when directory missing for analyze-project', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'analyze-project' }]
      });
      expect(result.valid).toBe(false);
    });

    test('invalid for unknown action type', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'fly-to-moon' }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('unknown action type');
    });

    test('validates security-scan requires filePath', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'security-scan' }]
      });
      expect(result.valid).toBe(false);
    });

    test('validates security-scan-project requires directory', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'security-scan-project' }]
      });
      expect(result.valid).toBe(false);
    });

    test('validates validate-config requires filePath', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'validate-config' }]
      });
      expect(result.valid).toBe(false);
    });

    test('validates validate-structured accepts content without filePath', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'validate-structured', content: '{"a":1}' }]
      });
      expect(result.valid).toBe(true);
    });

    test('validates validate-structured rejects both missing', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'validate-structured' }]
      });
      expect(result.valid).toBe(false);
    });

    test('validates batch size limit', () => {
      const { tool } = createTestSetup();
      tool.maxFilesPerBatch = 2;
      const result = tool.customValidateParameters({
        actions: [
          { type: 'analyze', filePath: 'a.js' },
          { type: 'analyze', filePath: 'b.js' },
          { type: 'analyze', filePath: 'c.js' }
        ]
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Too many actions'))).toBe(true);
    });

    test('validates fix requires filePath', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'fix' }]
      });
      expect(result.valid).toBe(false);
    });

    test('validates format requires filePath', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'format' }]
      });
      expect(result.valid).toBe(false);
    });
  });

  // ── execute - analyze ───────────────────────────────────────────
  describe('execute - analyze', () => {
    test('analyzes a JavaScript file with mock analyzer', async () => {
      const { tool, context } = createTestSetup();
      const mockAnalyzer = {
        analyze: jest.fn().mockResolvedValue([
          { severity: 'error', message: 'unused var', line: 1, column: 5 }
        ])
      };
      tool.getAnalyzer = jest.fn().mockResolvedValue(mockAnalyzer);
      tool.detectFramework = jest.fn().mockResolvedValue(null);

      const result = await tool.execute({
        actions: [{ type: 'analyze', filePath: 'src/index.js' }]
      }, context);

      expect(result.success).toBe(true);
      expect(result.results.files).toHaveLength(1);
      expect(result.results.files[0].errors).toHaveLength(1);
    });

    test('returns skipped for unsupported file type', async () => {
      const { tool, context } = createTestSetup();
      // .xyz has no language mapping
      const result = await tool.execute({
        actions: [{ type: 'analyze', filePath: 'file.xyz' }]
      }, context);

      expect(result.success).toBe(true);
      expect(result.results.files[0].skipped).toBe(true);
    });

    test('returns skipped when no analyzer available', async () => {
      const { tool, context } = createTestSetup();
      tool.getAnalyzer = jest.fn().mockResolvedValue(null);
      tool.detectFramework = jest.fn().mockResolvedValue(null);

      const result = await tool.execute({
        actions: [{ type: 'analyze', filePath: 'src/app.js' }]
      }, context);

      expect(result.results.files[0].skipped).toBe(true);
      expect(result.results.files[0].skipReason).toContain('No analyzer');
    });

    test('handles file too large error', async () => {
      const { tool, context } = createTestSetup();
      fsMock.stat.mockResolvedValueOnce({ size: 999999999, mtime: new Date() });

      const result = await tool.execute({
        actions: [{ type: 'analyze', filePath: 'huge.js' }]
      }, context);

      expect(result.results.files[0].error).toContain('too large');
    });
  });

  // ── execute - analyze-project ───────────────────────────────────
  describe('execute - analyze-project', () => {
    test('analyzes project directory', async () => {
      const { tool, context } = createTestSetup();
      // findFiles returns file list
      tool.findFiles = jest.fn().mockResolvedValue(['/tmp/test/src/a.js']);
      tool.analyzeFile = jest.fn().mockResolvedValue({
        file: 'src/a.js',
        language: 'javascript',
        errors: [], warnings: [], info: [],
        analyzed: true, totalIssues: 0
      });

      const result = await tool.execute({
        actions: [{ type: 'analyze-project', directory: 'src', pattern: '**/*.js' }]
      }, context);

      expect(result.success).toBe(true);
      expect(result.results.files.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ── execute - unknown action ────────────────────────────────────
  describe('execute - unknown action', () => {
    test('adds error result for unknown action type', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        actions: [{ type: 'teleport', filePath: 'x.js' }]
      }, context);

      expect(result.success).toBe(true); // overall success is always true
      expect(result.results.files[0].error).toContain('Unknown action type');
    });
  });

  // ── detectLanguage ──────────────────────────────────────────────
  describe('detectLanguage', () => {
    test('detects JavaScript from .js extension', () => {
      const { tool } = createTestSetup();
      expect(tool.detectLanguage('/path/to/file.js')).toBe('javascript');
    });

    test('detects TypeScript from .ts extension', () => {
      const { tool } = createTestSetup();
      expect(tool.detectLanguage('/path/to/file.ts')).toBe('typescript');
    });

    test('detects Python from .py extension', () => {
      const { tool } = createTestSetup();
      expect(tool.detectLanguage('/path/to/file.py')).toBe('python');
    });

    test('detects CSS from .css extension', () => {
      const { tool } = createTestSetup();
      expect(tool.detectLanguage('/path/to/style.css')).toBe('css');
    });

    test('returns null for unsupported extension', () => {
      const { tool } = createTestSetup();
      expect(tool.detectLanguage('/path/to/file.xyz')).toBeNull();
    });
  });

  // ── updateSummary ───────────────────────────────────────────────
  describe('updateSummary', () => {
    test('updates summary counts from file result', () => {
      const { tool } = createTestSetup();
      const summary = {
        totalFiles: 0, totalErrors: 0, totalWarnings: 0, totalInfo: 0,
        errorsByCategory: {}, filesByLanguage: {}, filesWithErrors: 0
      };

      tool.updateSummary(summary, {
        analyzed: true,
        language: 'javascript',
        errors: [{ severity: 'error', category: 'syntax' }],
        warnings: [{ severity: 'warning' }],
        info: []
      });

      expect(summary.totalFiles).toBe(1);
      expect(summary.totalErrors).toBe(1);
      expect(summary.totalWarnings).toBe(1);
      expect(summary.filesWithErrors).toBe(1);
      expect(summary.filesByLanguage.javascript).toBe(1);
      expect(summary.errorsByCategory.syntax).toBe(1);
    });

    test('skips non-analyzed results', () => {
      const { tool } = createTestSetup();
      const summary = {
        totalFiles: 0, totalErrors: 0, totalWarnings: 0, totalInfo: 0,
        errorsByCategory: {}, filesByLanguage: {}, filesWithErrors: 0
      };
      tool.updateSummary(summary, { analyzed: false });
      expect(summary.totalFiles).toBe(0);
    });
  });

  // ── getPerformanceMetrics ───────────────────────────────────────
  describe('getPerformanceMetrics', () => {
    test('returns metrics with cache hit rate', () => {
      const { tool } = createTestSetup();
      tool.metrics.totalAnalyses = 10;
      tool.metrics.cacheHits = 3;
      tool.metrics.filesAnalyzed = 7;
      tool.metrics.totalAnalysisTime = 1400;

      const metrics = tool.getPerformanceMetrics();
      expect(metrics.cacheHitRate).toBe(30);
      expect(metrics.averageAnalysisTime).toBe(200);
      expect(metrics.cacheSize).toBe(0);
    });

    test('handles zero analyses', () => {
      const { tool } = createTestSetup();
      const metrics = tool.getPerformanceMetrics();
      expect(metrics.cacheHitRate).toBe(0);
      expect(metrics.averageAnalysisTime).toBe(0);
    });
  });

  // ── computeContentHash ──────────────────────────────────────────
  describe('computeContentHash', () => {
    test('returns truncated hash string', () => {
      const { tool } = createTestSetup();
      const hash = tool.computeContentHash('some content');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(16);
    });
  });

  // ── execute returns performance metrics ─────────────────────────
  describe('execute - result structure', () => {
    test('result includes performance and toolUsed', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        actions: [{ type: 'analyze', filePath: 'test.xyz' }]
      }, context);
      expect(result.toolUsed).toBe('staticanalysis');
      expect(result.performance).toBeDefined();
    });
  });

  // ── cache behavior ──────────────────────────────────────────────
  describe('caching', () => {
    test('uses cached result on second analysis of same file', async () => {
      const { tool, context } = createTestSetup();
      const mockAnalyzer = {
        analyze: jest.fn().mockResolvedValue([])
      };
      tool.getAnalyzer = jest.fn().mockResolvedValue(mockAnalyzer);
      tool.detectFramework = jest.fn().mockResolvedValue(null);

      // First call - should analyze
      await tool.execute({ actions: [{ type: 'analyze', filePath: 'src/cached.js' }] }, context);
      expect(mockAnalyzer.analyze).toHaveBeenCalledTimes(1);

      // Second call - same content hash should use cache
      await tool.execute({ actions: [{ type: 'analyze', filePath: 'src/cached.js' }] }, context);
      expect(tool.metrics.cacheHits).toBeGreaterThanOrEqual(1);
    });
  });
});
