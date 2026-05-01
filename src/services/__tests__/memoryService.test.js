import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock fs
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
const mockUnlink = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('fs', () => ({
  promises: {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    unlink: mockUnlink
  }
}));

// Mock userDataDir
const mockGetUserDataPaths = jest.fn().mockReturnValue({
  agents: '/tmp/test-agents',
  settings: '/tmp/test-settings'
});
const mockEnsureUserDataDirs = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../../utilities/userDataDir.js', () => ({
  getUserDataPaths: mockGetUserDataPaths,
  ensureUserDataDirs: mockEnsureUserDataDirs
}));

const { MemoryService, getMemoryService } = await import('../../services/memoryService.js');

describe('MemoryService', () => {
  let service;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    service = new MemoryService(logger);
    jest.clearAllMocks();
  });

  // ── Constructor ──
  test('constructor initializes with defaults', () => {
    expect(service.logger).toBe(logger);
    expect(service.memoriesCache).toBeInstanceOf(Map);
    expect(service.agentsDir).toBeNull();
    expect(service.initialized).toBe(false);
  });

  // ── initialize ──
  test('initialize sets up paths and marks initialized', async () => {
    await service.initialize();
    expect(service.initialized).toBe(true);
    expect(service.agentsDir).toBe('/tmp/test-agents');
    expect(mockEnsureUserDataDirs).toHaveBeenCalled();
  });

  test('initialize skips if already initialized', async () => {
    await service.initialize();
    await service.initialize();
    expect(mockEnsureUserDataDirs).toHaveBeenCalledTimes(1);
  });

  test('initialize throws on error', async () => {
    mockEnsureUserDataDirs.mockRejectedValueOnce(new Error('permission denied'));
    await expect(service.initialize()).rejects.toThrow('permission denied');
  });

  // ── _getMemoryFilePath ──
  test('_getMemoryFilePath returns correct path', async () => {
    await service.initialize();
    const filePath = service._getMemoryFilePath('agent-1');
    expect(filePath).toContain('agent-1-memory.json');
  });

  // ── _generateMemoryId ──
  test('_generateMemoryId returns unique IDs', () => {
    const id1 = service._generateMemoryId();
    const id2 = service._generateMemoryId();
    expect(id1).toMatch(/^mem-\d+-[a-z0-9]+$/);
    expect(id1).not.toBe(id2);
  });

  // ── loadMemories ──
  test('loadMemories loads from file and caches', async () => {
    const memories = [
      { id: 'mem-1', title: 'Test', description: '', content: 'data', createdAt: new Date().toISOString() }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.loadMemories('agent-1');
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Test');

    // Second call should use cache
    const result2 = await service.loadMemories('agent-1');
    expect(result2).toBe(result);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  test('loadMemories returns empty array for ENOENT', async () => {
    const error = new Error('not found');
    error.code = 'ENOENT';
    mockReadFile.mockRejectedValue(error);

    const result = await service.loadMemories('new-agent');
    expect(result).toEqual([]);
  });

  test('loadMemories returns empty on parse error', async () => {
    mockReadFile.mockResolvedValue('not json');

    const result = await service.loadMemories('bad-agent');
    expect(result).toEqual([]);
  });

  test('loadMemories filters expired memories', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const memories = [
      { id: 'mem-1', title: 'Expired', expiration: { type: 'date', value: pastDate } },
      { id: 'mem-2', title: 'Active', expiration: { type: 'date', value: futureDate } },
      { id: 'mem-3', title: 'No expiry' }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.loadMemories('agent-1');
    expect(result.length).toBe(2);
    expect(result.find(m => m.title === 'Expired')).toBeUndefined();
  });

  // ── saveMemories ──
  test('saveMemories writes to file and updates cache', async () => {
    const memories = [{ id: 'mem-1', title: 'Test' }];
    await service.saveMemories('agent-1', memories);

    expect(mockWriteFile).toHaveBeenCalled();
    expect(service.memoriesCache.get('agent-1')).toBe(memories);
  });

  test('saveMemories throws on write error', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'));
    await expect(service.saveMemories('agent-1', [])).rejects.toThrow('disk full');
  });

  // ── addMemory ──
  test('addMemory creates a new memory and saves', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const memory = await service.addMemory('agent-1', {
      title: 'New Memory',
      description: 'Description',
      content: 'Some content'
    });

    expect(memory.id).toMatch(/^mem-/);
    expect(memory.title).toBe('New Memory');
    expect(memory.description).toBe('Description');
    expect(memory.content).toBe('Some content');
    expect(memory.accessCount).toBe(0);
    expect(mockWriteFile).toHaveBeenCalled();
  });

  test('addMemory with expiration date', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const memory = await service.addMemory('agent-1', {
      title: 'Expiring',
      content: 'data',
      expiration: '2030-01-01'
    });

    expect(memory.expiration.type).toBe('date');
  });

  // ── _parseExpiration ──
  test('_parseExpiration returns never for null/undefined', () => {
    expect(service._parseExpiration(null)).toEqual({ type: 'never', value: null });
    expect(service._parseExpiration(undefined)).toEqual({ type: 'never', value: null });
  });

  test('_parseExpiration parses date string', () => {
    const result = service._parseExpiration('2030-01-01');
    expect(result.type).toBe('date');
    expect(result.value).toBeDefined();
  });

  test('_parseExpiration treats non-date string as condition', () => {
    const result = service._parseExpiration('when project is done');
    expect(result.type).toBe('condition');
    expect(result.value).toBe('when project is done');
  });

  test('_parseExpiration handles object input', () => {
    const result = service._parseExpiration({ type: 'date', value: '2030-01-01' });
    expect(result.type).toBe('date');
    expect(result.value).toBe('2030-01-01');
  });

  test('_parseExpiration handles object with date property', () => {
    const result = service._parseExpiration({ date: '2030-01-01' });
    expect(result.value).toBe('2030-01-01');
  });

  test('_parseExpiration returns never for number input', () => {
    const result = service._parseExpiration(12345);
    expect(result.type).toBe('never');
  });

  // ── updateMemory ──
  test('updateMemory updates existing memory', async () => {
    const memories = [
      { id: 'mem-1', title: 'Old Title', description: 'old', content: 'old content', updatedAt: '' }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.updateMemory('agent-1', 'mem-1', {
      title: 'New Title',
      content: 'new content'
    });

    expect(result.title).toBe('New Title');
    expect(result.content).toBe('new content');
    expect(result.description).toBe('old'); // unchanged
    expect(mockWriteFile).toHaveBeenCalled();
  });

  test('updateMemory returns null for non-existent memory', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await service.updateMemory('agent-1', 'nonexistent', { title: 'New' });
    expect(result).toBeNull();
  });

  test('updateMemory updates expiration', async () => {
    const memories = [
      { id: 'mem-1', title: 'Test', description: '', content: '', updatedAt: '' }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.updateMemory('agent-1', 'mem-1', {
      expiration: '2030-06-01'
    });

    expect(result.expiration.type).toBe('date');
  });

  // ── deleteMemory ──
  test('deleteMemory removes memory and saves', async () => {
    const memories = [
      { id: 'mem-1', title: 'Delete Me' },
      { id: 'mem-2', title: 'Keep Me' }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.deleteMemory('agent-1', 'mem-1');
    expect(result).toBe(true);
    expect(mockWriteFile).toHaveBeenCalled();
  });

  test('deleteMemory returns false for non-existent memory', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await service.deleteMemory('agent-1', 'nonexistent');
    expect(result).toBe(false);
  });

  // ── listMemories ──
  test('listMemories returns grouped by date with titles level', async () => {
    const memories = [
      { id: 'mem-1', title: 'Memory 1', description: 'desc', createdAt: '2024-01-15T10:00:00Z' },
      { id: 'mem-2', title: 'Memory 2', description: 'desc2', createdAt: '2024-01-15T11:00:00Z' }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.listMemories('agent-1', 'titles');
    expect(result.count).toBe(2);
    expect(result.grouped['2024-01-15'].length).toBe(2);
    // titles level should only have id and title
    expect(result.grouped['2024-01-15'][0]).toHaveProperty('id');
    expect(result.grouped['2024-01-15'][0]).toHaveProperty('title');
    expect(result.grouped['2024-01-15'][0]).not.toHaveProperty('description');
  });

  test('listMemories with descriptions level', async () => {
    const memories = [
      { id: 'mem-1', title: 'Memory 1', description: 'desc', createdAt: '2024-01-15T10:00:00Z' }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.listMemories('agent-1', 'descriptions');
    const item = result.grouped['2024-01-15'][0];
    expect(item).toHaveProperty('description');
    expect(item).not.toHaveProperty('expiration');
  });

  test('listMemories with full level', async () => {
    const memories = [
      { id: 'mem-1', title: 'M1', description: 'd', expiration: null, createdAt: '2024-01-15T10:00:00Z', updatedAt: '2024-01-15T10:00:00Z' }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.listMemories('agent-1', 'full');
    const item = result.grouped['2024-01-15'][0];
    expect(item).toHaveProperty('expiration');
    expect(item).toHaveProperty('createdAt');
  });

  test('listMemories with unknown level defaults to titles', async () => {
    const memories = [
      { id: 'mem-1', title: 'M1', description: 'd', createdAt: '2024-01-15T10:00:00Z' }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.listMemories('agent-1', 'unknown');
    const item = result.grouped['2024-01-15'][0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('title');
    expect(item).not.toHaveProperty('description');
  });

  // ── readMemory ──
  test('readMemory returns memory and updates access count', async () => {
    const memories = [
      { id: 'mem-1', title: 'Test', content: 'data', accessCount: 0 }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.readMemory('agent-1', 'mem-1');
    expect(result.title).toBe('Test');
    expect(result.accessCount).toBe(1);
    expect(result.lastAccessed).toBeDefined();
    expect(mockWriteFile).toHaveBeenCalled();
  });

  test('readMemory returns null for non-existent memory', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await service.readMemory('agent-1', 'nonexistent');
    expect(result).toBeNull();
  });

  // ── searchMemories ──
  test('searchMemories finds matching memories by title', async () => {
    const memories = [
      { id: 'mem-1', title: 'React Setup', description: 'How to setup React' },
      { id: 'mem-2', title: 'Vue Guide', description: 'Vue framework guide' }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.searchMemories('agent-1', 'react');
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('React Setup');
  });

  test('searchMemories finds matching memories by description', async () => {
    const memories = [
      { id: 'mem-1', title: 'Setup', description: 'How to configure database' }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.searchMemories('agent-1', 'database');
    expect(result.length).toBe(1);
  });

  test('searchMemories returns empty for no matches', async () => {
    const memories = [
      { id: 'mem-1', title: 'Test', description: 'desc' }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const result = await service.searchMemories('agent-1', 'xyz');
    expect(result).toEqual([]);
  });

  // ── clearMemories ──
  test('clearMemories removes all memories', async () => {
    const memories = [
      { id: 'mem-1', title: 'Test1' },
      { id: 'mem-2', title: 'Test2' }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const count = await service.clearMemories('agent-1');
    expect(count).toBe(2);
    expect(mockWriteFile).toHaveBeenCalled();
  });

  // ── deleteMemoryFile ──
  test('deleteMemoryFile deletes file and clears cache', async () => {
    service.memoriesCache.set('agent-1', [{ id: 'mem-1' }]);
    await service.initialize();

    const result = await service.deleteMemoryFile('agent-1');
    expect(result).toBe(true);
    expect(service.memoriesCache.has('agent-1')).toBe(false);
  });

  test('deleteMemoryFile returns true for already deleted', async () => {
    await service.initialize();
    const error = new Error('not found');
    error.code = 'ENOENT';
    mockUnlink.mockRejectedValueOnce(error);

    const result = await service.deleteMemoryFile('agent-1');
    expect(result).toBe(true);
  });

  test('deleteMemoryFile returns false on other errors', async () => {
    await service.initialize();
    mockUnlink.mockRejectedValueOnce(new Error('permission denied'));

    const result = await service.deleteMemoryFile('agent-1');
    expect(result).toBe(false);
  });

  // ── getMemoryStats ──
  test('getMemoryStats returns correct statistics', async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days
    const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
    const memories = [
      { id: 'mem-1', accessCount: 5, expiration: { type: 'date', value: soon } },
      { id: 'mem-2', accessCount: 3, expiration: { type: 'date', value: later } },
      { id: 'mem-3', accessCount: 0 }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify({ memories }));

    const stats = await service.getMemoryStats('agent-1');
    expect(stats.totalMemories).toBe(3);
    expect(stats.totalAccessCount).toBe(8);
    expect(stats.expiringWithin7Days).toBe(1);
    expect(stats.averageAccessCount).toBe('2.67');
  });

  test('getMemoryStats returns zero averages for empty', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const stats = await service.getMemoryStats('agent-1');
    expect(stats.totalMemories).toBe(0);
    expect(stats.averageAccessCount).toBe(0);
  });

  // ── _filterExpiredMemories ──
  test('_filterExpiredMemories keeps condition-based and never expiration', () => {
    const memories = [
      { id: 'mem-1', expiration: { type: 'condition', value: 'some condition' } },
      { id: 'mem-2', expiration: { type: 'never', value: null } },
      { id: 'mem-3' }
    ];
    const result = service._filterExpiredMemories(memories);
    expect(result.length).toBe(3);
  });
});
