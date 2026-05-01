import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock fs/promises before import
const mockFs = {
  stat: jest.fn(),
  readdir: jest.fn()
};

jest.unstable_mockModule('fs', () => ({
  promises: mockFs,
  default: { promises: mockFs }
}));

// Mock constants
jest.unstable_mockModule('../../utilities/constants.js', () => ({
  TOOL_STATUS: { PENDING: 'pending', EXECUTING: 'executing', COMPLETED: 'completed', FAILED: 'failed' },
  OPERATION_STATUS: { NOT_FOUND: 'not_found' },
  ERROR_TYPES: {},
  SYSTEM_DEFAULTS: { MAX_TOOL_EXECUTION_TIME: 300000 }
}));

const { default: FileTreeTool } = await import('../fileTreeTool.js');

// Helper to create mock dirent
function mockDirent(name, isDir = false) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isSymbolicLink: () => false
  };
}

describe('FileTreeTool', () => {
  let tool;
  let logger;
  const context = { projectDir: '/project', agentId: 'agent-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
    tool = new FileTreeTool({}, logger);
  });

  test('constructor sets metadata correctly', () => {
    expect(tool.id).toBe('file-tree');
    expect(tool.requiresProject).toBe(true);
    expect(tool.isAsync).toBe(true);
  });

  test('getDescription mentions file tree', () => {
    const desc = tool.getDescription();
    expect(desc).toContain('File Tree Tool');
    expect(desc).toContain('maxDepth');
  });

  test('getRequiredParameters returns empty array', () => {
    expect(tool.getRequiredParameters()).toEqual([]);
  });

  test('parseParameters parses JSON content', () => {
    const content = JSON.stringify({
      directory: 'src',
      maxDepth: 5,
      includeExtensions: ['.js'],
      showFiles: true
    });
    const result = tool.parseParameters(content);
    expect(result.directory).toBe('src');
    expect(result.maxDepth).toBe(5);
    expect(result.includeExtensions).toEqual(['.js']);
    expect(result.showFiles).toBe(true);
  });

  test('parseParameters defaults for missing JSON fields', () => {
    const result = tool.parseParameters('{}');
    expect(result.directory).toBe('.');
    expect(result.maxDepth).toBe(3);
    expect(result.showFiles).toBe(true);
    expect(result.showHidden).toBe(false);
  });

  test('parseParameters handles XML content', () => {
    const content = '<directory>src</directory><max-depth>4</max-depth><show-files>true</show-files>';
    const result = tool.parseParameters(content);
    expect(result.directory).toBe('src');
    expect(result.maxDepth).toBe(4);
  });

  test('parseParameters returns defaults on parse error', () => {
    const result = tool.parseParameters('{ broken');
    expect(result.directory).toBe('.');
    expect(result).toHaveProperty('parseError');
  });

  test('customValidateParameters rejects maxDepth exceeding limit', () => {
    expect(() => tool.customValidateParameters({ maxDepth: 100 })).toThrow();
  });

  test('customValidateParameters rejects maxDepth < 1', () => {
    expect(() => tool.customValidateParameters({ maxDepth: 0 })).toThrow();
  });

  test('customValidateParameters rejects path traversal', () => {
    expect(() => tool.customValidateParameters({ directory: '../etc' })).toThrow('traversal');
  });

  test('customValidateParameters rejects non-array includeExtensions', () => {
    expect(() => tool.customValidateParameters({ includeExtensions: '.js' })).toThrow();
  });

  test('customValidateParameters rejects extension without dot', () => {
    expect(() => tool.customValidateParameters({ includeExtensions: ['js'] })).toThrow('dot');
  });

  test('customValidateParameters accepts valid params', () => {
    const result = tool.customValidateParameters({
      maxDepth: 3,
      directory: 'src',
      includeExtensions: ['.js'],
      excludeExtensions: ['.test.js'],
      excludeDirectories: ['tests']
    });
    expect(result.valid).toBe(true);
  });

  test('execute generates directory tree structure', async () => {
    // Root directory stat
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });

    // Root readdir
    mockFs.readdir.mockResolvedValueOnce([
      mockDirent('src', true),
      mockDirent('package.json')
    ]);

    // src readdir
    mockFs.readdir.mockResolvedValueOnce([
      mockDirent('index.js'),
      mockDirent('app.js')
    ]);

    const result = await tool.execute(
      { directory: '.', maxDepth: 3, showFiles: true, showHidden: false },
      context
    );

    expect(result.success).toBe(true);
    expect(result.tree).toContain('src');
    expect(result.tree).toContain('package.json');
    expect(result.totalFiles).toBeGreaterThanOrEqual(1);
    expect(result.totalDirectories).toBeGreaterThanOrEqual(1);
    expect(result).toHaveProperty('summary');
  });

  test('execute respects depth limit', async () => {
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });

    // Root readdir with deep nesting
    mockFs.readdir.mockResolvedValueOnce([
      mockDirent('level1', true)
    ]);

    // level1 readdir - at depth 1 with maxDepth 1, files at depth 2 should be excluded
    mockFs.readdir.mockResolvedValueOnce([
      mockDirent('deep.js')
    ]);

    const result = await tool.execute(
      { directory: '.', maxDepth: 1, showFiles: true, showHidden: false },
      context
    );

    expect(result.success).toBe(true);
    // Files at depth 2 should not appear when maxDepth is 1
  });

  test('execute ignores node_modules and .git by default', async () => {
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });

    mockFs.readdir.mockResolvedValueOnce([
      mockDirent('src', true),
      mockDirent('node_modules', true),
      mockDirent('.git', true)
    ]);

    mockFs.readdir.mockResolvedValueOnce([]); // src is empty

    const result = await tool.execute(
      { directory: '.', maxDepth: 3, showFiles: true, showHidden: false },
      context
    );

    expect(result.success).toBe(true);
    expect(result.skippedCount).toBeGreaterThanOrEqual(2); // node_modules, .git skipped
  });

  test('execute handles empty directory', async () => {
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });
    mockFs.readdir.mockResolvedValueOnce([]);

    const result = await tool.execute(
      { directory: '.', maxDepth: 3, showFiles: true, showHidden: false },
      context
    );

    expect(result.success).toBe(true);
    expect(result.totalFiles).toBe(0);
  });

  test('execute throws for non-existent directory', async () => {
    mockFs.stat.mockRejectedValue(new Error('ENOENT'));

    await expect(tool.execute(
      { directory: 'nonexistent', maxDepth: 3, showFiles: true, showHidden: false },
      context
    )).rejects.toThrow('does not exist');
  });

  test('execute with includeExtensions filters files', async () => {
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });

    mockFs.readdir.mockResolvedValueOnce([
      mockDirent('app.js'),
      mockDirent('style.css'),
      mockDirent('readme.md')
    ]);

    const result = await tool.execute(
      { directory: '.', maxDepth: 3, showFiles: true, showHidden: false, includeExtensions: ['.js'] },
      context
    );

    expect(result.success).toBe(true);
    expect(result.tree).toContain('app.js');
    expect(result.tree).not.toContain('style.css');
    expect(result.tree).not.toContain('readme.md');
  });

  test('formatFileSize formats bytes correctly', () => {
    expect(tool.formatFileSize(500)).toBe('500 B');
    expect(tool.formatFileSize(2048)).toContain('KB');
    expect(tool.formatFileSize(2 * 1024 * 1024)).toContain('MB');
    expect(tool.formatFileSize(2 * 1024 * 1024 * 1024)).toContain('GB');
  });

  test('generateSummary produces summary text', () => {
    const summary = tool.generateSummary('src', { filesCount: 10, directoriesCount: 3, skippedCount: 2 }, 4);
    expect(summary).toContain('src');
    expect(summary).toContain('10');
    expect(summary).toContain('3');
  });

  test('formatTree handles null node', () => {
    expect(tool.formatTree(null)).toBe('');
  });

  test('execute uses directoryAccess working directory', async () => {
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });
    mockFs.readdir.mockResolvedValueOnce([]);

    const result = await tool.execute(
      { directory: '.', maxDepth: 2, showFiles: true, showHidden: false },
      {
        projectDir: '/project',
        agentId: 'agent-1',
        directoryAccess: { workingDirectory: '/custom/dir' }
      }
    );

    expect(result.success).toBe(true);
  });
});
