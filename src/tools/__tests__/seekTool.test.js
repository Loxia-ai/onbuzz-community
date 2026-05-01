import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock fs/promises before import
const mockFs = {
  stat: jest.fn(),
  readFile: jest.fn(),
  readdir: jest.fn()
};

jest.unstable_mockModule('fs', () => ({
  promises: mockFs,
  default: { promises: mockFs }
}));

// Mock constants
jest.unstable_mockModule('../../utilities/constants.js', () => ({
  TOOL_STATUS: { PENDING: 'pending', EXECUTING: 'executing', COMPLETED: 'completed', FAILED: 'failed' },
  OPERATION_STATUS: { EXECUTING: 'executing', COMPLETED: 'completed', FAILED: 'failed', NOT_FOUND: 'not_found' },
  ERROR_TYPES: {},
  SYSTEM_DEFAULTS: { MAX_TOOL_EXECUTION_TIME: 300000 }
}));

// Mock tagParser
jest.unstable_mockModule('../../utilities/tagParser.js', () => ({
  default: { extractContent: jest.fn(() => []) }
}));

const { default: SeekTool } = await import('../seekTool.js');

describe('SeekTool', () => {
  let tool;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
    tool = new SeekTool({}, logger);
  });

  test('constructor sets metadata correctly', () => {
    expect(tool.id).toBe('seek');
    expect(tool.requiresProject).toBe(true);
    expect(tool.isAsync).toBe(true);
    expect(tool.timeout).toBe(120000);
  });

  test('getDescription returns seek description', () => {
    const desc = tool.getDescription();
    expect(desc).toContain('Seek Tool');
    expect(desc).toContain('filePaths');
    expect(desc).toContain('searchTerms');
  });

  test('getRequiredParameters returns filePaths and searchTerms', () => {
    expect(tool.getRequiredParameters()).toEqual(['filePaths', 'searchTerms']);
  });

  test('parseParameters parses JSON content', () => {
    const content = JSON.stringify({
      filePaths: ['src/*.js'],
      searchTerms: ['import React']
    });
    const result = tool.parseParameters(content);
    expect(result.filePaths).toEqual(['src/*.js']);
    expect(result.searchTerms).toEqual(['import React']);
  });

  test('parseParameters parses XML content', () => {
    const content = `
      <in-files>
        src/index.js
        src/app.js
      </in-files>
      <search-terms>
        <term>useState</term>
        <term>useEffect</term>
      </search-terms>
    `;
    const result = tool.parseParameters(content);
    expect(result.filePaths).toEqual(['src/index.js', 'src/app.js']);
    expect(result.searchTerms).toEqual(['useState', 'useEffect']);
  });

  test('parseParameters returns parseError on invalid content', () => {
    const result = tool.parseParameters('{ broken json');
    expect(result).toHaveProperty('parseError');
  });

  test('customValidateParameters rejects empty filePaths', () => {
    const result = tool.customValidateParameters({ filePaths: [], searchTerms: ['foo'] });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters rejects empty searchTerms', () => {
    const result = tool.customValidateParameters({ filePaths: ['a.js'], searchTerms: [] });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters rejects path traversal', () => {
    const result = tool.customValidateParameters({
      filePaths: ['../../etc/passwd'],
      searchTerms: ['test']
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('traversal'))).toBe(true);
  });

  test('customValidateParameters accepts valid params', () => {
    const result = tool.customValidateParameters({
      filePaths: ['src/index.js'],
      searchTerms: ['import']
    });
    expect(result.valid).toBe(true);
  });

  test('execute searches file and returns matches', async () => {
    const fileContent = 'line 1\nimport React from "react";\nline 3\nimport useState from "react";\n';

    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 100
    });
    mockFs.readFile.mockResolvedValue(fileContent);

    const result = await tool.execute(
      { filePaths: ['src/app.js'], searchTerms: ['import React'] },
      { projectDir: '/project', agentId: 'agent-1' }
    );

    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(1);
    expect(result.filesSearched).toBe(1);
  });

  test('execute handles file not found', async () => {
    mockFs.stat.mockRejectedValue({ code: 'ENOENT', message: 'not found' });

    const result = await tool.execute(
      { filePaths: ['missing.js'], searchTerms: ['test'] },
      { projectDir: '/project', agentId: 'agent-1' }
    );

    expect(result.success).toBe(true);
    expect(result.filesNotFound).toBe(1);
    expect(result.totalMatches).toBe(0);
  });

  test('execute returns no matches when search term not found', async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 50
    });
    mockFs.readFile.mockResolvedValue('no matching content here\n');

    const result = await tool.execute(
      { filePaths: ['src/app.js'], searchTerms: ['nonexistent'] },
      { projectDir: '/project', agentId: 'agent-1' }
    );

    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(0);
  });

  test('execute skips binary files', async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 100
    });

    const result = await tool.execute(
      { filePaths: ['image.png'], searchTerms: ['test'] },
      { projectDir: '/project', agentId: 'agent-1' }
    );

    expect(result.success).toBe(true);
    // Binary file is resolved but skipped during search
    expect(mockFs.readFile).not.toHaveBeenCalled();
  });

  test('execute skips oversized files', async () => {
    mockFs.stat
      .mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false, size: 100 })  // resolveFilePaths
      .mockResolvedValueOnce({ size: 20 * 1024 * 1024 }); // searchFiles - too large

    const result = await tool.execute(
      { filePaths: ['large.js'], searchTerms: ['test'] },
      { projectDir: '/project', agentId: 'agent-1' }
    );

    expect(result.success).toBe(true);
    expect(result.filesWithErrors).toBe(1);
  });

  test('execute truncates long line content around match', async () => {
    const longLine = 'a'.repeat(100) + 'MATCH_HERE' + 'b'.repeat(200);
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 500
    });
    mockFs.readFile.mockResolvedValue(longLine + '\n');

    const result = await tool.execute(
      { filePaths: ['file.js'], searchTerms: ['MATCH_HERE'] },
      { projectDir: '/project', agentId: 'agent-1' }
    );

    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(1);
  });

  test('execute uses directoryAccess when provided', async () => {
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 50
    });
    mockFs.readFile.mockResolvedValue('hello world\n');

    const result = await tool.execute(
      { filePaths: ['test.js'], searchTerms: ['hello'] },
      {
        projectDir: '/project',
        agentId: 'agent-1',
        directoryAccess: {
          workingDirectory: '/project',
          readOnlyDirectories: ['/shared'],
          writeEnabledDirectories: ['/output']
        }
      }
    );

    expect(result.success).toBe(true);
  });

  test('matchesPattern handles wildcard patterns', () => {
    expect(tool.matchesPattern('file.js', '*.js')).toBe(true);
    expect(tool.matchesPattern('file.ts', '*.js')).toBe(false);
    expect(tool.matchesPattern('test.spec.js', '*.spec.js')).toBe(true);
  });

  test('shouldSkipDirectory returns true for node_modules', () => {
    expect(tool.shouldSkipDirectory('node_modules')).toBe(true);
    expect(tool.shouldSkipDirectory('.git')).toBe(true);
    expect(tool.shouldSkipDirectory('src')).toBe(false);
  });

  test('shouldSkipFile returns true for binary extensions', () => {
    expect(tool.shouldSkipFile('image.png')).toBe(true);
    expect(tool.shouldSkipFile('script.js')).toBe(false);
  });

  test('formatResults with no matches', () => {
    const output = tool.formatResults([], [], [], 5);
    expect(output).toContain('No matches found');
  });

  test('formatResults with matches', () => {
    const matches = [
      { term: 'foo', filePath: 'a.js', lineNumber: 10, lineContent: 'const foo = 1;' }
    ];
    const output = tool.formatResults(matches, [], [], 1);
    expect(output).toContain('SEARCH RESULTS');
    expect(output).toContain('foo');
    expect(output).toContain('a.js:10');
  });

  test('formatResults with not found and error files', () => {
    const output = tool.formatResults(
      [],
      [{ filePath: 'err.js', error: 'read error' }],
      ['missing.js (ENOENT)'],
      0
    );
    expect(output).toContain('FILES NOT FOUND');
    expect(output).toContain('FILES WITH ERRORS');
  });
});
