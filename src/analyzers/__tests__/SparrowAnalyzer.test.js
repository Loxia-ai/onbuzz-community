import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock fs/promises
const mockAccess = jest.fn();
const mockStat = jest.fn();
jest.unstable_mockModule('fs/promises', () => ({
  default: { access: mockAccess, stat: mockStat },
  access: mockAccess,
  stat: mockStat
}));

// Mock sparrow-sast
const mockScan = jest.fn();
const mockGetRegistry = jest.fn();
const mockGetAllAnalyzers = jest.fn();
jest.unstable_mockModule('sparrow-sast', () => ({
  default: {
    scan: mockScan,
    getRegistry: mockGetRegistry,
    getAllAnalyzers: mockGetAllAnalyzers,
    Language: {
      Python: 'python',
      JavaScript: 'javascript',
      TypeScript: 'typescript',
      Go: 'go',
      Java: 'java',
      Ruby: 'ruby',
      Rust: 'rust',
      PHP: 'php',
      CSharp: 'csharp',
      Bash: 'bash',
      HTML: 'html',
      CSS: 'css'
    }
  },
  scan: mockScan,
  getRegistry: mockGetRegistry,
  getAllAnalyzers: mockGetAllAnalyzers,
  Language: {
    Python: 'python',
    JavaScript: 'javascript',
    TypeScript: 'typescript'
  }
}));

const { default: SparrowAnalyzer } = await import('../SparrowAnalyzer.js');

describe('SparrowAnalyzer', () => {
  let analyzer;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    analyzer = new SparrowAnalyzer(logger);
    analyzer.initialized = false;
    analyzer.sparrow = null;
    jest.clearAllMocks();
  });

  // ── Constructor ──
  test('constructor initializes with defaults', () => {
    expect(analyzer.logger).toBe(logger);
    expect(analyzer.sparrow).toBeNull();
    expect(analyzer.initialized).toBe(false);
  });

  // ── getSupportedLanguages ──
  test('getSupportedLanguages returns all supported languages', () => {
    const langs = analyzer.getSupportedLanguages();
    expect(langs).toContain('python');
    expect(langs).toContain('javascript');
    expect(langs).toContain('typescript');
    expect(langs).toContain('go');
    expect(langs.length).toBe(12);
  });

  // ── getSupportedExtensions ──
  test('getSupportedExtensions returns file extensions', () => {
    const exts = analyzer.getSupportedExtensions();
    expect(exts).toContain('.py');
    expect(exts).toContain('.js');
    expect(exts).toContain('.ts');
    expect(exts).toContain('.go');
  });

  // ── isSupported ──
  test('isSupported returns true for supported files', () => {
    expect(analyzer.isSupported('test.py')).toBe(true);
    expect(analyzer.isSupported('test.js')).toBe(true);
    expect(analyzer.isSupported('test.ts')).toBe(true);
    expect(analyzer.isSupported('test.go')).toBe(true);
  });

  test('isSupported returns false for unsupported files', () => {
    expect(analyzer.isSupported('test.txt')).toBe(false);
    expect(analyzer.isSupported('test.md')).toBe(false);
  });

  // ── ensureInitialized ──
  test('ensureInitialized loads sparrow module', async () => {
    await analyzer.ensureInitialized();
    expect(analyzer.initialized).toBe(true);
    expect(analyzer.sparrow).toBeDefined();
  });

  test('ensureInitialized skips if already initialized', async () => {
    analyzer.initialized = true;
    analyzer.sparrow = { scan: jest.fn() };
    await analyzer.ensureInitialized();
    // No error thrown
  });

  // ── transformIssue ──
  test('transformIssue converts sparrow issue to standard format', () => {
    const issue = {
      id: 'SQL_INJECTION',
      filepath: '/project/test.py',
      range: { start: { row: 4, column: 0 }, end: { row: 4, column: 20 } },
      severity: 'error',
      category: 'security',
      message: 'Possible SQL injection'
    };

    const result = analyzer.transformIssue(issue, '/project/test.py');
    expect(result.id).toBe('SQL_INJECTION');
    expect(result.line).toBe(5); // 0-based to 1-based
    expect(result.column).toBe(1);
    expect(result.endLine).toBe(5);
    expect(result.severity).toBe('error');
    expect(result.source).toBe('sparrow');
    expect(result.fixable).toBe(false);
  });

  test('transformIssue handles missing range', () => {
    const issue = {
      id: 'TEST',
      filepath: '/project/test.py',
      message: 'Test issue'
    };

    const result = analyzer.transformIssue(issue, '/project/test.py');
    expect(result.line).toBe(1);
    expect(result.column).toBe(1);
  });

  // ── groupByCategory ──
  test('groupByCategory groups issues correctly', () => {
    const issues = [
      { category: 'security' },
      { category: 'security' },
      { category: 'performance' },
      { category: undefined }
    ];
    const groups = analyzer.groupByCategory(issues);
    expect(groups.security).toBe(2);
    expect(groups.performance).toBe(1);
    expect(groups.other).toBe(1);
  });

  // ── groupByLanguage ──
  test('groupByLanguage groups file results by language', () => {
    const fileResults = [
      { file: 'test.py', issues: [] },
      { file: 'app.js', issues: [] },
      { file: 'util.js', issues: [] },
      { file: 'main.go', issues: [] }
    ];
    const groups = analyzer.groupByLanguage(fileResults);
    expect(groups.python).toBe(1);
    expect(groups.javascript).toBe(2);
    expect(groups.go).toBe(1);
  });

  test('groupByLanguage maps unknown extensions to other', () => {
    const fileResults = [{ file: 'readme.txt', issues: [] }];
    const groups = analyzer.groupByLanguage(fileResults);
    expect(groups.other).toBe(1);
  });

  // ── scanFile ──
  test('scanFile returns skipped result for unsupported file', async () => {
    mockAccess.mockResolvedValue(undefined);

    const result = await analyzer.scanFile('/project/readme.txt');
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test('scanFile returns issues for supported file', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockScan.mockResolvedValue([
      { id: 'XSS', filepath: '/project/test.js', message: 'XSS vulnerability', severity: 'error', category: 'security' }
    ]);

    const result = await analyzer.scanFile('/project/test.js');
    expect(result.success).toBe(true);
    expect(result.issues.length).toBe(1);
    expect(result.summary.total).toBe(1);
  });

  test('scanFile handles scan errors', async () => {
    mockAccess.mockRejectedValue(new Error('File not found'));

    const result = await analyzer.scanFile('/project/test.js');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  // ── scanProject ──
  test('scanProject scans directory and returns grouped results', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true });
    mockScan.mockResolvedValue([
      { id: 'XSS', filepath: '/project/app.js', message: 'XSS', severity: 'error', category: 'security' },
      { id: 'SQLI', filepath: '/project/db.py', message: 'SQL injection', severity: 'critical', category: 'security' }
    ]);

    const result = await analyzer.scanProject('/project');
    expect(result.success).toBe(true);
    expect(result.isDirectory).toBe(true);
    expect(result.files.length).toBe(2);
    expect(result.summary.totalFiles).toBe(2);
    expect(result.summary.totalIssues).toBe(2);
  });

  test('scanProject handles scan errors', async () => {
    mockStat.mockRejectedValue(new Error('Path not found'));

    const result = await analyzer.scanProject('/nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('scanProject applies language filter', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true });
    mockScan.mockResolvedValue([]);

    const result = await analyzer.scanProject('/project', { languages: ['python', 'javascript'] });
    expect(result.success).toBe(true);
  });

  // ── getCheckersInfo ──
  test('getCheckersInfo returns analyzer info', async () => {
    mockGetRegistry.mockReturnValue({});
    mockGetAllAnalyzers.mockReturnValue([
      { name: 'sql-injection', language: 'python', category: 'security', severity: 'error' }
    ]);

    const info = await analyzer.getCheckersInfo();
    expect(info.length).toBe(1);
    expect(info[0].name).toBe('sql-injection');
  });

  test('getCheckersInfo returns empty on error', async () => {
    mockGetRegistry.mockReturnValue(null);

    const info = await analyzer.getCheckersInfo();
    expect(info).toEqual([]);
  });

  test('getCheckersInfo handles missing getRegistry', async () => {
    // sparrow without getRegistry
    analyzer.sparrow = {};
    analyzer.initialized = true;

    const info = await analyzer.getCheckersInfo();
    expect(info).toEqual([]);
  });
});
