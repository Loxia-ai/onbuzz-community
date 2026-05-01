import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock eslint
const mockLintText = jest.fn();
const MockESLint = jest.fn().mockImplementation(() => ({
  lintText: mockLintText
}));
jest.unstable_mockModule('eslint', () => ({
  ESLint: MockESLint
}));

// Mock fs/promises
const mockAccess = jest.fn();
jest.unstable_mockModule('fs/promises', () => ({
  default: { access: mockAccess },
  access: mockAccess
}));

// Mock constants
jest.unstable_mockModule('../../utilities/constants.js', () => ({
  STATIC_ANALYSIS: {
    SEVERITY: {
      CRITICAL: 'critical',
      ERROR: 'error',
      WARNING: 'warning',
      INFO: 'info',
      SUGGESTION: 'suggestion'
    },
    CATEGORY: {
      SYNTAX: 'syntax',
      TYPE: 'type',
      IMPORT: 'import',
      STYLE: 'style',
      SECURITY: 'security',
      PERFORMANCE: 'performance',
      BEST_PRACTICE: 'best_practice'
    }
  }
}));

const { default: ESLintAnalyzer } = await import('../ESLintAnalyzer.js');

describe('ESLintAnalyzer', () => {
  let analyzer;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    analyzer = new ESLintAnalyzer(logger);
    jest.clearAllMocks();
  });

  // ── Constructor ──
  test('constructor initializes with logger and cache', () => {
    expect(analyzer.logger).toBe(logger);
    expect(analyzer.eslintCache).toBeInstanceOf(Map);
  });

  test('constructor works without logger', () => {
    const a = new ESLintAnalyzer();
    expect(a.logger).toBeNull();
  });

  // ── getSupportedExtensions ──
  test('getSupportedExtensions returns JS extensions', () => {
    const exts = analyzer.getSupportedExtensions();
    expect(exts).toContain('.js');
    expect(exts).toContain('.jsx');
    expect(exts).toContain('.mjs');
    expect(exts).toContain('.cjs');
  });

  // ── supportsAutoFix ──
  test('supportsAutoFix returns true', () => {
    expect(analyzer.supportsAutoFix()).toBe(true);
  });

  // ── analyze ──
  test('analyze returns diagnostics for linted code', async () => {
    mockLintText.mockResolvedValue([{
      messages: [
        { line: 1, column: 5, severity: 2, ruleId: 'no-undef', message: 'x is not defined' },
        { line: 2, column: 1, severity: 1, ruleId: 'semi', message: 'Missing semicolon' }
      ]
    }]);

    const result = await analyzer.analyze('test.js', 'x\ny');
    expect(result.length).toBe(2);
    expect(result[0].severity).toBe('error');
    expect(result[0].rule).toBe('no-undef');
    expect(result[1].severity).toBe('warning');
  });

  test('analyze returns empty array on no results', async () => {
    mockLintText.mockResolvedValue([]);

    const result = await analyzer.analyze('test.js', 'const x = 1;');
    expect(result).toEqual([]);
  });

  test('analyze returns empty array on null results', async () => {
    mockLintText.mockResolvedValue(null);

    const result = await analyzer.analyze('test.js', 'const x = 1;');
    expect(result).toEqual([]);
  });

  test('analyze returns empty array on ESLint error', async () => {
    mockLintText.mockRejectedValue(new Error('ESLint config error'));

    const result = await analyzer.analyze('test.js', 'const x = 1;');
    expect(result).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  // ── fix ──
  test('fix returns fixed content when changes made', async () => {
    mockLintText.mockResolvedValue([{
      output: 'const x = 1;\n',
      fixableErrorCount: 1,
      fixableWarningCount: 0,
      errorCount: 1,
      warningCount: 0
    }]);

    const result = await analyzer.fix('test.js', 'const x = 1\n');
    expect(result.fixed).toBe(true);
    expect(result.content).toBe('const x = 1;\n');
    expect(result.fixedCount).toBe(1);
  });

  test('fix returns original content when no changes', async () => {
    mockLintText.mockResolvedValue([{
      output: undefined,
      fixableErrorCount: 0,
      fixableWarningCount: 0,
      errorCount: 0,
      warningCount: 0
    }]);

    const result = await analyzer.fix('test.js', 'const x = 1;\n');
    expect(result.fixed).toBe(false);
    expect(result.content).toBe('const x = 1;\n');
  });

  test('fix returns default when no results', async () => {
    mockLintText.mockResolvedValue([]);

    const result = await analyzer.fix('test.js', 'const x = 1;');
    expect(result.fixed).toBe(false);
    expect(result.fixedCount).toBe(0);
  });

  test('fix throws on ESLint error', async () => {
    mockLintText.mockRejectedValue(new Error('ESLint error'));

    await expect(analyzer.fix('test.js', 'x')).rejects.toThrow('ESLint fix failed');
  });

  // ── formatMessage ──
  test('formatMessage maps severity 2 to error', () => {
    const msg = { line: 10, column: 5, severity: 2, ruleId: 'no-eval', message: 'eval is bad' };
    const result = analyzer.formatMessage(msg, 'test.js');
    expect(result.severity).toBe('error');
    expect(result.file).toBe('test.js');
    expect(result.line).toBe(10);
    expect(result.source).toBe('eslint');
  });

  test('formatMessage maps severity 1 to warning', () => {
    const msg = { severity: 1, ruleId: 'semi', message: 'Missing semicolon' };
    const result = analyzer.formatMessage(msg, 'test.js');
    expect(result.severity).toBe('warning');
  });

  test('formatMessage handles fixable message', () => {
    const msg = { severity: 1, ruleId: 'semi', message: 'Missing', fix: { range: [0, 1], text: ';' } };
    const result = analyzer.formatMessage(msg, 'test.js');
    expect(result.fixable).toBe(true);
  });

  test('formatMessage handles missing ruleId', () => {
    const msg = { severity: 2, message: 'Error' };
    const result = analyzer.formatMessage(msg, 'test.js');
    expect(result.rule).toBe('eslint');
  });

  // ── categorizeRule ──
  test('categorizeRule returns STYLE for null ruleId', () => {
    expect(analyzer.categorizeRule(null)).toBe('style');
  });

  test('categorizeRule detects security rules', () => {
    expect(analyzer.categorizeRule('no-eval')).toBe('security');
    expect(analyzer.categorizeRule('no-implied-eval')).toBe('security');
    expect(analyzer.categorizeRule('security/detect-xss')).toBe('security');
  });

  test('categorizeRule detects performance rules', () => {
    expect(analyzer.categorizeRule('no-await-in-loop')).toBe('performance');
    expect(analyzer.categorizeRule('prefer-promise-reject-errors')).toBe('performance');
  });

  test('categorizeRule detects import rules', () => {
    expect(analyzer.categorizeRule('import/no-unresolved')).toBe('import');
    expect(analyzer.categorizeRule('no-undef')).toBe('import');
  });

  test('categorizeRule detects best practice rules', () => {
    expect(analyzer.categorizeRule('no-unused-vars')).toBe('best_practice');
    expect(analyzer.categorizeRule('no-unreachable')).toBe('best_practice');
    expect(analyzer.categorizeRule('no-var')).toBe('best_practice');
  });

  test('categorizeRule defaults to style', () => {
    expect(analyzer.categorizeRule('some-other-rule')).toBe('style');
  });

  // ── describeChanges ──
  test('describeChanges detects modified lines', () => {
    const original = 'line1\nline2\nline3';
    const fixed = 'line1\nLINE2\nline3';
    const changes = analyzer.describeChanges(original, fixed);
    expect(changes.length).toBe(1);
    expect(changes[0].type).toBe('modified');
    expect(changes[0].line).toBe(2);
  });

  test('describeChanges detects added lines', () => {
    const original = 'line1';
    const fixed = 'line1\nline2';
    const changes = analyzer.describeChanges(original, fixed);
    expect(changes.length).toBe(1);
    expect(changes[0].type).toBe('added');
  });

  test('describeChanges detects removed lines', () => {
    const original = 'line1\nline2';
    const fixed = 'line1';
    const changes = analyzer.describeChanges(original, fixed);
    expect(changes.length).toBe(1);
    expect(changes[0].type).toBe('removed');
  });

  // ── getESLintConfig ──
  test('getESLintConfig returns base config without workingDir', async () => {
    const config = await analyzer.getESLintConfig(null, null);
    expect(config.env).toBeDefined();
    expect(config.rules).toBeDefined();
  });

  test('getESLintConfig adds react settings for react framework', async () => {
    const config = await analyzer.getESLintConfig(null, 'react');
    expect(config.parserOptions.ecmaFeatures.jsx).toBe(true);
  });

  test('getESLintConfig returns empty when project config found', async () => {
    mockAccess.mockResolvedValueOnce(undefined);

    const config = await analyzer.getESLintConfig('/project', null);
    expect(Object.keys(config).length).toBe(0);
  });

  test('getESLintConfig returns full config when no project config', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const config = await analyzer.getESLintConfig('/project', null);
    expect(config.rules).toBeDefined();
  });
});
