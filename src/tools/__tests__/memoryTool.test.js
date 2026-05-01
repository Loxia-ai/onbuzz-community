import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock constants
jest.unstable_mockModule('../../utilities/constants.js', () => ({
  TOOL_STATUS: { PENDING: 'pending', EXECUTING: 'executing', COMPLETED: 'completed', FAILED: 'failed' },
  OPERATION_STATUS: { NOT_FOUND: 'not_found' },
  ERROR_TYPES: {},
  SYSTEM_DEFAULTS: { MAX_TOOL_EXECUTION_TIME: 300000 }
}));

// Create mock memory service
const mockMemoryService = {
  initialize: jest.fn().mockResolvedValue(undefined),
  addMemory: jest.fn(),
  updateMemory: jest.fn(),
  deleteMemory: jest.fn(),
  listMemories: jest.fn(),
  readMemory: jest.fn(),
  searchMemories: jest.fn(),
  getMemoryStats: jest.fn()
};

jest.unstable_mockModule('../../services/memoryService.js', () => ({
  getMemoryService: jest.fn(() => mockMemoryService)
}));

const { default: MemoryTool } = await import('../memoryTool.js');

describe('MemoryTool', () => {
  let tool;
  let logger;
  const context = { agentId: 'agent-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
    tool = new MemoryTool({}, logger);
  });

  test('constructor sets metadata correctly', () => {
    expect(tool.id).toBe('memory');
    expect(tool.requiresProject).toBe(false);
    expect(tool.timeout).toBe(30000);
  });

  test('getDescription contains all actions', () => {
    const desc = tool.getDescription();
    expect(desc).toContain('Memory Tool');
    expect(desc).toContain('add');
    expect(desc).toContain('update');
    expect(desc).toContain('delete');
    expect(desc).toContain('list');
    expect(desc).toContain('read');
    expect(desc).toContain('search');
    expect(desc).toContain('stats');
  });

  test('getSupportedActions returns all 8 actions', () => {
    expect(tool.getSupportedActions()).toEqual(
      ['add', 'update', 'delete', 'list', 'read', 'search', 'stats', 'reminisce']
    );
  });

  test('getRequiredParameters returns action', () => {
    expect(tool.getRequiredParameters()).toEqual(['action']);
  });

  test('getCapabilities includes persistent flag', () => {
    const caps = tool.getCapabilities();
    expect(caps.persistent).toBe(true);
    expect(caps.actions).toEqual(tool.getSupportedActions());
  });

  test('getParameterSchema has action enum', () => {
    const schema = tool.getParameterSchema();
    expect(schema.properties.action.enum).toEqual(tool.getSupportedActions());
  });

  test('parseParameters returns content as-is', () => {
    const input = { action: 'add', title: 'test' };
    expect(tool.parseParameters(input)).toBe(input);
  });

  test('validateParameterTypes catches invalid action type', () => {
    const result = tool.validateParameterTypes({ action: 123 });
    expect(result.valid).toBe(false);
  });

  test('validateParameterTypes catches invalid level', () => {
    const result = tool.validateParameterTypes({ level: 'invalid' });
    expect(result.valid).toBe(false);
  });

  test('validateParameterTypes accepts valid params', () => {
    const result = tool.validateParameterTypes({ action: 'add', title: 'test', level: 'titles' });
    expect(result.valid).toBe(true);
  });

  test('customValidateParameters rejects unknown action', () => {
    const result = tool.customValidateParameters({ action: 'unknown' });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters requires title and content for add', () => {
    const result = tool.customValidateParameters({ action: 'add' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('title'))).toBe(true);
    expect(result.errors.some(e => e.includes('content'))).toBe(true);
  });

  test('customValidateParameters requires id for update', () => {
    const result = tool.customValidateParameters({ action: 'update' });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters requires id for delete', () => {
    const result = tool.customValidateParameters({ action: 'delete' });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters requires id for read', () => {
    const result = tool.customValidateParameters({ action: 'read' });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters requires query for search', () => {
    const result = tool.customValidateParameters({ action: 'search' });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters enforces length limits', () => {
    const result = tool.customValidateParameters({
      action: 'add',
      title: 'a'.repeat(201),
      content: 'c'.repeat(10001),
      description: 'd'.repeat(501)
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
  });

  test('execute throws without agentId', async () => {
    await expect(tool.execute({ action: 'stats' }, {}))
      .rejects.toThrow('Agent ID is required');
  });

  test('execute add action creates memory', async () => {
    mockMemoryService.addMemory.mockResolvedValue({
      id: 'mem-1', title: 'Test', createdAt: '2025-01-01', expiration: null
    });

    const result = await tool.execute(
      { action: 'add', title: 'Test', content: 'content', description: 'desc' },
      context
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('add');
    expect(result.memory.id).toBe('mem-1');
    expect(mockMemoryService.addMemory).toHaveBeenCalledWith('agent-1', expect.objectContaining({ title: 'Test' }));
  });

  test('execute update action modifies memory', async () => {
    mockMemoryService.updateMemory.mockResolvedValue({
      id: 'mem-1', title: 'Updated', updatedAt: '2025-01-02'
    });

    const result = await tool.execute(
      { action: 'update', id: 'mem-1', title: 'Updated' },
      context
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('update');
  });

  test('execute update returns failure when memory not found', async () => {
    mockMemoryService.updateMemory.mockResolvedValue(null);

    const result = await tool.execute(
      { action: 'update', id: 'nonexistent', title: 'x' },
      context
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  test('execute delete action removes memory', async () => {
    mockMemoryService.deleteMemory.mockResolvedValue(true);

    const result = await tool.execute({ action: 'delete', id: 'mem-1' }, context);

    expect(result.success).toBe(true);
    expect(result.action).toBe('delete');
  });

  test('execute delete returns failure when memory not found', async () => {
    mockMemoryService.deleteMemory.mockResolvedValue(false);

    const result = await tool.execute({ action: 'delete', id: 'nonexistent' }, context);

    expect(result.success).toBe(false);
  });

  test('execute list action returns memories', async () => {
    mockMemoryService.listMemories.mockResolvedValue({
      count: 2,
      grouped: { '2025-01-01': [{ id: 'mem-1' }, { id: 'mem-2' }] }
    });

    const result = await tool.execute({ action: 'list', level: 'titles' }, context);

    expect(result.success).toBe(true);
    expect(result.totalMemories).toBe(2);
    expect(result.level).toBe('titles');
  });

  test('execute list with default level', async () => {
    mockMemoryService.listMemories.mockResolvedValue({ count: 0, grouped: {} });

    const result = await tool.execute({ action: 'list' }, context);

    expect(result.level).toBe('titles');
    expect(result.message).toContain('No memories');
  });

  test('execute read action loads memory', async () => {
    mockMemoryService.readMemory.mockResolvedValue({
      id: 'mem-1', title: 'Test', description: 'desc', content: 'full content',
      createdAt: '2025-01-01', updatedAt: null, expiration: null, accessCount: 3
    });

    const result = await tool.execute({ action: 'read', id: 'mem-1' }, context);

    expect(result.success).toBe(true);
    expect(result.memory.content).toBe('full content');
  });

  test('execute read returns failure when not found', async () => {
    mockMemoryService.readMemory.mockResolvedValue(null);

    const result = await tool.execute({ action: 'read', id: 'nonexistent' }, context);

    expect(result.success).toBe(false);
  });

  test('execute search action returns results', async () => {
    mockMemoryService.searchMemories.mockResolvedValue([
      { id: 'mem-1', title: 'Match' }
    ]);

    const result = await tool.execute({ action: 'search', query: 'Match' }, context);

    expect(result.success).toBe(true);
    expect(result.results.length).toBe(1);
    expect(result.query).toBe('Match');
  });

  test('execute search with no results', async () => {
    mockMemoryService.searchMemories.mockResolvedValue([]);

    const result = await tool.execute({ action: 'search', query: 'nothing' }, context);

    expect(result.success).toBe(true);
    expect(result.results.length).toBe(0);
    expect(result.message).toContain('No memories found');
  });

  test('execute stats action returns statistics', async () => {
    mockMemoryService.getMemoryStats.mockResolvedValue({
      totalMemories: 5, totalAccessCount: 20
    });

    const result = await tool.execute({ action: 'stats' }, context);

    expect(result.success).toBe(true);
    expect(result.stats.totalMemories).toBe(5);
    expect(result.message).toContain('5 total memories');
  });

  test('execute throws on unknown action', async () => {
    await expect(tool.execute({ action: 'unknown' }, context))
      .rejects.toThrow('Unknown action');
  });

  test('execute logs and re-throws service errors', async () => {
    mockMemoryService.addMemory.mockRejectedValue(new Error('DB error'));

    await expect(
      tool.execute({ action: 'add', title: 'x', content: 'y' }, context)
    ).rejects.toThrow('DB error');

    expect(logger.error).toHaveBeenCalled();
  });
});
