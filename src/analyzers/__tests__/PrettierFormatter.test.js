import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock prettier
const mockFormat = jest.fn();
const mockResolveConfig = jest.fn();
jest.unstable_mockModule('prettier', () => ({
  default: {
    format: mockFormat,
    resolveConfig: mockResolveConfig
  },
  format: mockFormat,
  resolveConfig: mockResolveConfig
}));

const { default: PrettierFormatter } = await import('../PrettierFormatter.js');

describe('PrettierFormatter', () => {
  let formatter;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    formatter = new PrettierFormatter(logger);
    formatter.configCache.clear();
    jest.clearAllMocks();
  });

  // ── Constructor ──
  test('constructor initializes with logger and cache', () => {
    expect(formatter.logger).toBe(logger);
    expect(formatter.configCache).toBeInstanceOf(Map);
  });

  test('constructor works without logger', () => {
    const f = new PrettierFormatter();
    expect(f.logger).toBeNull();
  });

  // ── getSupportedExtensions ──
  test('getSupportedExtensions returns all supported file types', () => {
    const exts = formatter.getSupportedExtensions();
    expect(exts).toContain('.js');
    expect(exts).toContain('.ts');
    expect(exts).toContain('.css');
    expect(exts).toContain('.json');
    expect(exts).toContain('.html');
    expect(exts).toContain('.md');
    expect(exts).toContain('.yaml');
  });

  // ── isSupported ──
  test('isSupported returns true for supported extensions', () => {
    expect(formatter.isSupported('test.js')).toBe(true);
    expect(formatter.isSupported('test.ts')).toBe(true);
    expect(formatter.isSupported('test.css')).toBe(true);
  });

  test('isSupported returns false for unsupported extensions', () => {
    expect(formatter.isSupported('test.py')).toBe(false);
    expect(formatter.isSupported('test.go')).toBe(false);
  });

  // ── getParser ──
  test('getParser returns correct parser for known extensions', () => {
    expect(formatter.getParser('test.js')).toBe('babel');
    expect(formatter.getParser('test.jsx')).toBe('babel');
    expect(formatter.getParser('test.ts')).toBe('typescript');
    expect(formatter.getParser('test.tsx')).toBe('typescript');
    expect(formatter.getParser('test.json')).toBe('json');
    expect(formatter.getParser('test.css')).toBe('css');
    expect(formatter.getParser('test.scss')).toBe('scss');
    expect(formatter.getParser('test.less')).toBe('less');
    expect(formatter.getParser('test.html')).toBe('html');
    expect(formatter.getParser('test.vue')).toBe('vue');
    expect(formatter.getParser('test.md')).toBe('markdown');
    expect(formatter.getParser('test.yaml')).toBe('yaml');
    expect(formatter.getParser('test.yml')).toBe('yaml');
  });

  test('getParser returns babel for unknown extension', () => {
    expect(formatter.getParser('test.xyz')).toBe('babel');
  });

  // ── format ──
  test('format returns formatted content when changes made', async () => {
    mockFormat.mockResolvedValue('const x = 1;\n');

    const result = await formatter.format('test.js', 'const x=1\n');
    expect(result.formatted).toBe(true);
    expect(result.content).toBe('const x = 1;\n');
    expect(result.original).toBe('const x=1\n');
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.linesChanged).toBeGreaterThan(0);
  });

  test('format returns unchanged content when no changes needed', async () => {
    const code = 'const x = 1;\n';
    mockFormat.mockResolvedValue(code);

    const result = await formatter.format('test.js', code);
    expect(result.formatted).toBe(false);
    expect(result.content).toBe(code);
    expect(result.changes).toEqual([]);
    expect(result.linesChanged).toBe(0);
  });

  test('format throws on prettier error', async () => {
    mockFormat.mockRejectedValue(new Error('Parse error'));

    await expect(formatter.format('test.js', 'invalid{{')).rejects.toThrow('Prettier formatting failed');
  });

  // ── check ──
  test('check returns true when formatting needed', async () => {
    mockFormat.mockResolvedValue('formatted\n');

    const result = await formatter.check('test.js', 'original\n');
    expect(result).toBe(true);
  });

  test('check returns false when no formatting needed', async () => {
    const code = 'const x = 1;\n';
    mockFormat.mockResolvedValue(code);

    const result = await formatter.check('test.js', code);
    expect(result).toBe(false);
  });

  test('check returns false on error', async () => {
    mockFormat.mockRejectedValue(new Error('Parse error'));

    const result = await formatter.check('test.js', 'invalid');
    expect(result).toBe(false);
  });

  // ── getPrettierConfig ──
  test('getPrettierConfig returns cached config on second call', async () => {
    mockResolveConfig.mockResolvedValue(null);

    const config1 = await formatter.getPrettierConfig('test.js', '/project');
    const config2 = await formatter.getPrettierConfig('test.js', '/project');
    expect(config1).toBe(config2);
  });

  test('getPrettierConfig uses project config when available', async () => {
    mockResolveConfig.mockResolvedValue({ semi: false, singleQuote: false });

    const config = await formatter.getPrettierConfig('test.js', '/project');
    expect(config.semi).toBe(false); // project config overrides default
  });

  test('getPrettierConfig uses defaults when no project config', async () => {
    const config = await formatter.getPrettierConfig('test.js', null);
    expect(config.semi).toBe(true);
    expect(config.singleQuote).toBe(true);
    expect(config.tabWidth).toBe(2);
  });

  test('getPrettierConfig handles resolveConfig error', async () => {
    mockResolveConfig.mockRejectedValue(new Error('config error'));

    const config = await formatter.getPrettierConfig('test.js', '/project');
    expect(config.semi).toBe(true); // Falls back to defaults
  });

  // ── describeChanges ──
  test('describeChanges identifies modified lines', () => {
    const original = 'line1\nline2\nline3';
    const formatted = 'line1\nLINE2\nline3';
    const changes = formatter.describeChanges(original, formatted);
    expect(changes.length).toBe(1);
    expect(changes[0].type).toBe('modified');
    expect(changes[0].line).toBe(2);
  });

  test('describeChanges handles added lines', () => {
    const original = 'line1';
    const formatted = 'line1\nline2';
    const changes = formatter.describeChanges(original, formatted);
    expect(changes.some(c => c.type === 'added')).toBe(true);
  });

  test('describeChanges handles removed lines', () => {
    const original = 'line1\nline2';
    const formatted = 'line1';
    const changes = formatter.describeChanges(original, formatted);
    expect(changes.some(c => c.type === 'removed')).toBe(true);
  });

  // ── countChangedLines ──
  test('countChangedLines returns correct count', () => {
    expect(formatter.countChangedLines('a\nb\nc', 'a\nB\nc')).toBe(1);
    expect(formatter.countChangedLines('a\nb', 'a\nb\nc')).toBe(1);
    expect(formatter.countChangedLines('a', 'a')).toBe(0);
  });
});
