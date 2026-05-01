import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock fs before import
const mockFsPromises = {
  stat: jest.fn(),
  readFile: jest.fn(),
  readdir: jest.fn()
};

jest.unstable_mockModule('fs', () => ({
  default: { promises: mockFsPromises, readFileSync: jest.fn(() => { throw new Error('no file'); }) },
  promises: mockFsPromises,
  readFileSync: jest.fn(() => { throw new Error('no file'); })
}));

// Mock constants
jest.unstable_mockModule('../../utilities/constants.js', () => ({
  TOOL_STATUS: { PENDING: 'pending', EXECUTING: 'executing', COMPLETED: 'completed', FAILED: 'failed' },
  OPERATION_STATUS: { NOT_FOUND: 'not_found' },
  ERROR_TYPES: {},
  SYSTEM_DEFAULTS: { MAX_TOOL_EXECUTION_TIME: 300000 }
}));

const { default: CodeMapTool } = await import('../codeMapTool.js');

describe('CodeMapTool', () => {
  let tool;
  let logger;
  const context = { projectDir: '/project', agentId: 'agent-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
    tool = new CodeMapTool({}, logger);
  });

  test('constructor sets metadata correctly', () => {
    expect(tool.id).toBe('code-map');
    expect(tool.requiresProject).toBe(true);
    expect(tool.isAsync).toBe(true);
  });

  test('getDescription mentions skeleton and read-range', () => {
    const desc = tool.getDescription();
    expect(desc).toContain('skeleton');
    expect(desc).toContain('read-range');
  });

  test('getRequiredParameters returns action', () => {
    expect(tool.getRequiredParameters()).toEqual(['action']);
  });

  test('parseParameters parses JSON content', () => {
    const content = JSON.stringify({
      action: 'skeleton',
      path: 'src/',
      level: 'B.0'
    });
    const result = tool.parseParameters(content);
    expect(result.action).toBe('skeleton');
    expect(result.path).toBe('src/');
    expect(result.level).toBe('B.0');
  });

  test('parseParameters parses nested parameters JSON', () => {
    const content = JSON.stringify({
      parameters: { action: 'read-range', filePath: 'index.js', startLine: 1, endLine: 10 }
    });
    const result = tool.parseParameters(content);
    expect(result.action).toBe('read-range');
    expect(result.filePath).toBe('index.js');
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(10);
  });

  test('parseParameters parses XML content', () => {
    const content = '<action>skeleton</action><path>src/</path><level>A.0</level>';
    const result = tool.parseParameters(content);
    expect(result.action).toBe('skeleton');
    expect(result.path).toBe('src/');
    expect(result.level).toBe('A.0');
  });

  test('parseParameters returns parseError on bad JSON', () => {
    const result = tool.parseParameters('{ broken');
    expect(result).toHaveProperty('parseError');
  });

  test('customValidateParameters rejects missing action', () => {
    const result = tool.customValidateParameters({});
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters rejects invalid action', () => {
    const result = tool.customValidateParameters({ action: 'invalid' });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters requires path for skeleton', () => {
    const result = tool.customValidateParameters({ action: 'skeleton' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('path'))).toBe(true);
  });

  test('customValidateParameters rejects invalid level', () => {
    const result = tool.customValidateParameters({ action: 'skeleton', path: 'src/', level: 'X.9' });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters requires filePath/startLine/endLine for read-range', () => {
    const result = tool.customValidateParameters({ action: 'read-range' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  test('customValidateParameters rejects endLine < startLine', () => {
    const result = tool.customValidateParameters({
      action: 'read-range', filePath: 'a.js', startLine: 10, endLine: 5
    });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters rejects range exceeding max', () => {
    const result = tool.customValidateParameters({
      action: 'read-range', filePath: 'a.js', startLine: 1, endLine: 600
    });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters accepts valid skeleton params', () => {
    const result = tool.customValidateParameters({ action: 'skeleton', path: 'src/' });
    expect(result.valid).toBe(true);
  });

  test('execute skeleton on single JS file', async () => {
    const jsContent = [
      'import express from "express";',
      '',
      'export class App {',
      '  constructor() {}',
      '  start() {',
      '    console.log("started");',
      '  }',
      '}',
      '',
      'export function main() {',
      '  return new App();',
      '}'
    ].join('\n');

    mockFsPromises.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: jsContent.length
    });
    mockFsPromises.readFile.mockResolvedValue(jsContent);

    const result = await tool.execute(
      { action: 'skeleton', path: 'src/app.js', level: 'B.0' },
      context
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('skeleton');
    expect(result.totalFiles).toBeGreaterThanOrEqual(1);
    expect(result.totalEntries).toBeGreaterThanOrEqual(1);
  });

  test('execute skeleton on directory with JS files', async () => {
    // First stat: directory check
    mockFsPromises.stat
      .mockResolvedValueOnce({ isFile: () => false, isDirectory: () => true })  // path stat
      .mockResolvedValueOnce({ size: 100 }); // file stat

    // Discover files - readdir for root
    mockFsPromises.readdir.mockResolvedValueOnce([
      { name: 'index.js', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }
    ]);

    mockFsPromises.readFile
      .mockRejectedValueOnce(new Error('no .gitignore'))  // _loadGitignoreRules
      .mockResolvedValueOnce('export function hello() { return 1; }\n'); // file content

    const result = await tool.execute(
      { action: 'skeleton', path: 'src/', level: 'A.0' },
      context
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('skeleton');
  });

  test('execute skeleton returns empty when no supported files', async () => {
    mockFsPromises.stat.mockResolvedValue({ isFile: () => false, isDirectory: () => true });
    mockFsPromises.readdir.mockResolvedValue([]);
    mockFsPromises.readFile.mockRejectedValue(new Error('no file'));

    const result = await tool.execute(
      { action: 'skeleton', path: 'empty/' },
      context
    );

    expect(result.success).toBe(true);
    expect(result.totalFiles).toBe(0);
    expect(result.message).toContain('No supported files');
  });

  test('execute skeleton throws for non-existent path', async () => {
    mockFsPromises.stat.mockRejectedValue(new Error('ENOENT'));

    await expect(tool.execute(
      { action: 'skeleton', path: 'missing/' },
      context
    )).rejects.toThrow('Path not found');
  });

  test('execute read-range returns formatted lines', async () => {
    const content = 'line1\nline2\nline3\nline4\nline5\n';
    mockFsPromises.readFile.mockResolvedValue(content);

    const result = await tool.execute(
      { action: 'read-range', filePath: 'src/index.js', startLine: 2, endLine: 4 },
      context
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('read-range');
    expect(result.linesReturned).toBe(3);
    expect(result.content).toContain('line2');
    expect(result.content).toContain('line3');
    expect(result.content).toContain('line4');
  });

  test('execute read-range throws when startLine exceeds file length', async () => {
    mockFsPromises.readFile.mockResolvedValue('line1\nline2\n');

    await expect(tool.execute(
      { action: 'read-range', filePath: 'a.js', startLine: 100, endLine: 110 },
      context
    )).rejects.toThrow('exceeds file length');
  });

  test('execute read-range throws for missing file', async () => {
    mockFsPromises.readFile.mockRejectedValue(new Error('ENOENT'));

    await expect(tool.execute(
      { action: 'read-range', filePath: 'missing.js', startLine: 1, endLine: 5 },
      context
    )).rejects.toThrow('File not found');
  });

  test('execute throws on unknown action', async () => {
    await expect(tool.execute(
      { action: 'unknown' },
      context
    )).rejects.toThrow('Unknown action');
  });

  test('_langOf detects python files', () => {
    expect(tool._langOf('script.py')).toBe('python');
    expect(tool._langOf('app.js')).toBe('js');
    expect(tool._langOf('component.tsx')).toBe('js');
  });

  test('_parseJS extracts exported functions', () => {
    const lines = [
      'export function hello() {',
      '  return 1;',
      '}'
    ];
    const entries = tool._parseJS(lines, { publicOnly: true, withComments: false, includeImports: false });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].kind).toBe('signature');
  });

  test('_parseJS extracts imports when includeImports is true', () => {
    const lines = [
      'import express from "express";',
      'const x = require("path");',
      'export function hello() {}'
    ];
    const entries = tool._parseJS(lines, { publicOnly: false, withComments: false, includeImports: true });
    const imports = entries.filter(e => e.kind === 'import');
    expect(imports.length).toBe(2);
  });

  test('_parseJS includes comments when withComments is true', () => {
    const lines = [
      '/** My doc */',
      'export function hello() {}'
    ];
    const entries = tool._parseJS(lines, { publicOnly: false, withComments: true, includeImports: false });
    const comments = entries.filter(e => e.kind === 'comment');
    expect(comments.length).toBeGreaterThanOrEqual(1);
  });

  test('_parsePython extracts def and class', () => {
    const lines = [
      'class MyClass:',
      '    def __init__(self):',
      '        pass',
      '',
      'def public_func():',
      '    return 1'
    ];
    const entries = tool._parsePython(lines, { publicOnly: false, withComments: false, includeImports: false });
    const sigs = entries.filter(e => e.kind === 'signature');
    expect(sigs.length).toBeGreaterThanOrEqual(2);
  });

  test('_parsePython respects publicOnly', () => {
    const lines = [
      'def public_func():',
      '    pass',
      'def _private_func():',
      '    pass'
    ];
    const entries = tool._parsePython(lines, { publicOnly: true, withComments: false, includeImports: false });
    const sigs = entries.filter(e => e.kind === 'signature');
    expect(sigs.length).toBe(1);
    expect(sigs[0].text).toContain('public_func');
  });

  test('_parseGitignore parses rules', () => {
    const content = '# comment\nnode_modules/\n*.log\n!important.log';
    const rules = tool._parseGitignore(content, '');
    expect(rules.length).toBe(3);
    expect(rules[2].negate).toBe(true);
  });

  test('_gitignorePatternToRegex handles ** patterns', () => {
    const re = tool._gitignorePatternToRegex('**/test');
    expect(re).toContain('(.+/)?');
  });

  test('execute skeleton on unsupported file type throws', async () => {
    mockFsPromises.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false
    });

    await expect(tool.execute(
      { action: 'skeleton', path: 'data.json' },
      context
    )).rejects.toThrow('Unsupported file type');
  });
});
