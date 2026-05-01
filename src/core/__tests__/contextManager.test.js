import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock fs/promises
const mockStat = jest.fn();
const mockReadFile = jest.fn();
const mockReaddir = jest.fn();

jest.unstable_mockModule('fs', () => ({
  promises: {
    stat: mockStat,
    readFile: mockReadFile,
    readdir: mockReaddir,
  }
}));

const { default: ContextManager } = await import('../contextManager.js');

describe('ContextManager', () => {
  let cm;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    cm = new ContextManager(
      createMockConfig({ context: { maxSize: 10000, maxReferences: 5, cacheExpiry: 3600 } }),
      logger
    );
    jest.clearAllMocks();
  });

  // --- processMessageWithContext ---

  test('processMessageWithContext returns message unchanged if no contextReferences', async () => {
    const msg = { content: 'Hello', contextReferences: [] };
    const result = await cm.processMessageWithContext(msg, '/project');
    expect(result.content).toBe('Hello');
  });

  test('processMessageWithContext returns message unchanged if contextReferences is missing', async () => {
    const msg = { content: 'Hello' };
    const result = await cm.processMessageWithContext(msg, '/project');
    expect(result.content).toBe('Hello');
  });

  test('processMessageWithContext enhances message with file context', async () => {
    mockStat.mockResolvedValue({ isFile: () => true, mtime: new Date(), size: 100 });
    mockReadFile.mockResolvedValue('const x = 1;');

    const msg = {
      content: 'Fix this code',
      contextReferences: [{ type: 'file', path: 'src/index.js' }]
    };
    const result = await cm.processMessageWithContext(msg, '/project');

    expect(result.content).toContain('PROJECT CONTEXT REFERENCES');
    expect(result.content).toContain('Fix this code');
    expect(result.originalContent).toBe('Fix this code');
    expect(result.processedContextReferences.length).toBe(1);
    expect(result.contextSize).toBeGreaterThan(0);
  });

  test('processMessageWithContext returns error info on catastrophic failure', async () => {
    // Force loadContextReferences to throw by making sortReferencesByPriority throw
    cm.sortReferencesByPriority = () => { throw new Error('sort failure'); };

    const msg = {
      content: 'Fix this code',
      contextReferences: [{ type: 'file', path: 'x.js' }]
    };
    const result = await cm.processMessageWithContext(msg, '/project');
    expect(result.contextProcessingError).toBe('sort failure');
    expect(result.processedContextReferences).toEqual([]);
  });

  // --- loadSingleReference ---

  test('loadSingleReference reads file content for type=file', async () => {
    mockStat.mockResolvedValue({ isFile: () => true, mtime: new Date(), size: 50 });
    mockReadFile.mockResolvedValue('hello world');

    const ref = { type: 'file', path: 'test.txt' };
    const loaded = await cm.loadSingleReference(ref, '/project');

    expect(loaded.content).toBe('hello world');
    expect(loaded.exists).toBe(true);
    expect(loaded.checksum).toBeDefined();
  });

  test('loadSingleReference handles missing file with File not found error', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'));

    const ref = { type: 'file', path: 'missing.js' };
    await expect(cm.loadSingleReference(ref, '/project')).rejects.toThrow('File not found');
  });

  test('loadSingleReference applies line range for file references', async () => {
    mockStat.mockResolvedValue({ isFile: () => true, mtime: new Date(), size: 100 });
    mockReadFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5');

    const ref = { type: 'file', path: 'test.js', lines: [2, 4] };
    const loaded = await cm.loadSingleReference(ref, '/project');

    expect(loaded.content).toBe('line2\nline3\nline4');
  });

  test('loadSingleReference throws for unknown reference type', async () => {
    const ref = { type: 'unknown', path: 'x' };
    await expect(cm.loadSingleReference(ref, '/project')).rejects.toThrow('Unknown reference type');
  });

  test('loadSingleReference loads directory listing for type=directory', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true });
    mockReaddir.mockResolvedValue([
      { name: 'file.js', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'subfolder', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
    ]);

    const ref = { type: 'directory', path: 'src' };
    const loaded = await cm.loadSingleReference(ref, '/project');

    expect(loaded.exists).toBe(true);
    expect(loaded.content).toContain('file.js');
    expect(loaded.content).toContain('subfolder');
    expect(loaded.fileCount).toBe(1);
    expect(loaded.directoryCount).toBe(1);
  });

  test('loadSingleReference loads selection reference without file', async () => {
    const ref = { type: 'selection', content: 'selected text' };
    const loaded = await cm.loadSingleReference(ref, '/project');
    expect(loaded.exists).toBe(true);
    expect(loaded.validated).toBe(false);
  });

  test('loadSingleReference loads component reference', async () => {
    mockReadFile.mockResolvedValue('function myFunc() {\n  return 1;\n}');

    const ref = { type: 'component', file: 'utils.js', name: 'myFunc' };
    const loaded = await cm.loadSingleReference(ref, '/project');
    expect(loaded.exists).toBe(true);
    expect(loaded.content).toContain('myFunc');
  });

  // --- generateContextPrompt ---

  test('generateContextPrompt returns empty string for no references', () => {
    expect(cm.generateContextPrompt([])).toBe('');
  });

  test('generateContextPrompt formats references with code blocks and language', () => {
    const refs = [{
      type: 'file',
      path: 'test.js',
      content: 'const a = 1;',
      exists: true
    }];
    const prompt = cm.generateContextPrompt(refs);
    expect(prompt).toContain('FILE: test.js');
    expect(prompt).toContain('```javascript');
    expect(prompt).toContain('const a = 1;');
    expect(prompt).toContain('END CONTEXT REFERENCES');
  });

  test('generateContextPrompt shows error for failed references', () => {
    const refs = [{ type: 'file', path: 'bad.js', error: 'File not found', content: '[Error]' }];
    const prompt = cm.generateContextPrompt(refs);
    expect(prompt).toContain('Error: File not found');
  });

  test('generateContextPrompt shows line range metadata', () => {
    const refs = [{
      type: 'file', path: 'x.py', content: 'pass', exists: true,
      lines: [10, 20]
    }];
    const prompt = cm.generateContextPrompt(refs);
    expect(prompt).toContain('Lines 10-20');
  });

  test('generateContextPrompt shows truncation and change warnings', () => {
    const refs = [{
      type: 'file', path: 'x.js', content: 'code', exists: true,
      truncated: true, hasChanged: true
    }];
    const prompt = cm.generateContextPrompt(refs);
    expect(prompt).toContain('truncated');
    expect(prompt).toContain('changed');
  });

  // --- Cache operations ---

  test('addToCache and getFromCache round-trip', () => {
    const data = { content: 'cached data', loadedAt: new Date().toISOString() };
    cm.addToCache('key1', data);
    const cached = cm.getFromCache('key1');
    expect(cached).toBe(data);
  });

  test('getFromCache returns null for missing key', () => {
    expect(cm.getFromCache('nonexistent')).toBeNull();
  });

  test('shouldRefreshCache returns true when cache is old', () => {
    const oldRef = { loadedAt: new Date(Date.now() - 7200 * 1000).toISOString() };
    expect(cm.shouldRefreshCache(oldRef)).toBe(true);
  });

  test('shouldRefreshCache returns false for fresh cache', () => {
    const freshRef = { loadedAt: new Date().toISOString() };
    expect(cm.shouldRefreshCache(freshRef)).toBe(false);
  });

  // --- generateCacheKey ---

  test('generateCacheKey returns consistent keys for same input', () => {
    const ref = { type: 'file', path: 'a.js' };
    const key1 = cm.generateCacheKey(ref, '/project');
    const key2 = cm.generateCacheKey(ref, '/project');
    expect(key1).toBe(key2);
  });

  test('generateCacheKey returns different keys for different paths', () => {
    const key1 = cm.generateCacheKey({ type: 'file', path: 'a.js' }, '/project');
    const key2 = cm.generateCacheKey({ type: 'file', path: 'b.js' }, '/project');
    expect(key1).not.toBe(key2);
  });

  // --- loadContextReferences ---

  test('loadContextReferences truncates content when exceeding maxContextSize', async () => {
    cm.maxContextSize = 50;
    mockStat.mockResolvedValue({ isFile: () => true, mtime: new Date(), size: 200 });
    mockReadFile.mockResolvedValue('A'.repeat(200));

    const refs = [{ type: 'file', path: 'big.js' }];
    const loaded = await cm.loadContextReferences(refs, '/project');

    // Content should be shorter than original 200 chars
    expect(loaded[0].content.length).toBeLessThan(200);
  });

  test('loadContextReferences pushes error reference when loading fails', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'));

    const refs = [{ type: 'file', path: 'missing.js' }];
    const loaded = await cm.loadContextReferences(refs, '/project');

    expect(loaded.length).toBe(1);
    expect(loaded[0].error).toBeDefined();
    expect(loaded[0].exists).toBe(false);
  });
});
