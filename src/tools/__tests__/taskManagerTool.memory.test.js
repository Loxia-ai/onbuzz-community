/**
 * Tests for task ↔ memory linking inside TaskManagerTool.
 *
 * Covers:
 *   - _agentHasMemory: detects 'memory' capability on context.agent
 *   - _storeDescriptionAsMemory: returns description unchanged if too short,
 *     no capability, or memory service fails; otherwise creates a memory and
 *     returns "[memory:mem-xxx] summary..."
 *   - _extractMemoryRefs: pulls mem-xxx IDs out of task descriptions
 *   - create action: long descriptions auto-stored as memory and replaced
 *     with reference, included in returned task
 *   - complete action: memoryHint emitted when task description references
 *     a memory
 *   - sync action: memoryHint included when synced tasks contain memory refs
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock the memory service before importing the tool
const mockAddMemory = jest.fn();
const mockInitialize = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../../services/memoryService.js', () => ({
  getMemoryService: jest.fn(() => ({
    initialize: mockInitialize,
    addMemory: mockAddMemory
  }))
}));

// Mock uuid for deterministic IDs
let uuidCounter = 0;
jest.unstable_mockModule('uuid', () => ({
  v4: jest.fn(() => `mock-uuid-${++uuidCounter}`)
}));

const { default: TaskManagerTool } = await import('../taskManagerTool.js');

function makeTool() {
  const tool = new TaskManagerTool({ description: 'test' });
  tool.logger = createMockLogger();
  return tool;
}

function makeContext({ hasMemoryCapability = true, taskList = { tasks: [], lastUpdated: new Date().toISOString() } } = {}) {
  const agent = {
    id: 'agent-1',
    name: 'Memory Test Agent',
    capabilities: hasMemoryCapability ? ['memory', 'tools'] : ['tools'],
    taskList
  };
  return {
    agent,
    context: {
      agentId: 'agent-1',
      agentName: 'Memory Test Agent',
      agent,
      agentPool: {
        getAgent: jest.fn().mockResolvedValue(agent),
        persistAgentState: jest.fn().mockResolvedValue(undefined)
      },
      projectDir: '/tmp/test'
    }
  };
}

beforeEach(() => {
  uuidCounter = 0;
  mockAddMemory.mockReset();
  mockInitialize.mockReset();
  mockInitialize.mockResolvedValue(undefined);
});

describe('TaskManagerTool — task ↔ memory linking', () => {
  // ── _agentHasMemory ──────────────────────────────────────────────
  describe('_agentHasMemory', () => {
    test('returns true when agent.capabilities includes "memory"', () => {
      const tool = makeTool();
      expect(tool._agentHasMemory({ agent: { capabilities: ['memory', 'web'] } })).toBe(true);
    });

    test('returns false when capabilities array does not contain "memory"', () => {
      const tool = makeTool();
      expect(tool._agentHasMemory({ agent: { capabilities: ['web', 'terminal'] } })).toBe(false);
    });

    test('returns false when agent has no capabilities array', () => {
      const tool = makeTool();
      expect(tool._agentHasMemory({ agent: {} })).toBeFalsy();
    });

    test('returns false when context has no agent', () => {
      const tool = makeTool();
      expect(tool._agentHasMemory({})).toBeFalsy();
    });
  });

  // ── _storeDescriptionAsMemory ────────────────────────────────────
  describe('_storeDescriptionAsMemory', () => {
    test('returns description unchanged when shorter than 200 chars', async () => {
      const tool = makeTool();
      const { context } = makeContext();
      const short = 'a short description';
      const result = await tool._storeDescriptionAsMemory('agent-1', 'My Task', short, context);
      expect(result).toBe(short);
      expect(mockAddMemory).not.toHaveBeenCalled();
    });

    test('returns description unchanged when agent lacks memory capability', async () => {
      const tool = makeTool();
      const { context } = makeContext({ hasMemoryCapability: false });
      const long = 'x'.repeat(500);
      const result = await tool._storeDescriptionAsMemory('agent-1', 'My Task', long, context);
      expect(result).toBe(long);
      expect(mockAddMemory).not.toHaveBeenCalled();
    });

    test('stores long description as memory and returns reference summary', async () => {
      mockAddMemory.mockResolvedValueOnce({ id: 'mem-abc-123' });
      const tool = makeTool();
      const { context } = makeContext({ hasMemoryCapability: true });

      const long = 'This is a fairly long description that exceeds the 200-character threshold. '.repeat(5);
      const result = await tool._storeDescriptionAsMemory('agent-1', 'Build API', long, context);

      expect(mockInitialize).toHaveBeenCalled();
      expect(mockAddMemory).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        title: 'task-context: Build API',
        content: long,
        description: 'Context for task "Build API"'
      }));
      expect(result).toMatch(/^\[memory:mem-abc-123\] /);
      expect(result).toContain('...');
      // Summary should be max 100 chars + the prefix + suffix
      expect(result.length).toBeLessThan(200);
    });

    test('falls back to original description when memory service throws', async () => {
      mockAddMemory.mockRejectedValueOnce(new Error('vault full'));
      const tool = makeTool();
      const { context } = makeContext({ hasMemoryCapability: true });

      const long = 'y'.repeat(500);
      const result = await tool._storeDescriptionAsMemory('agent-1', 'Build', long, context);
      expect(result).toBe(long);
      expect(tool.logger.warn).toHaveBeenCalledWith(
        'Failed to store task description as memory',
        expect.objectContaining({ error: 'vault full', agentId: 'agent-1', taskTitle: 'Build' })
      );
    });

    test('falls back when addMemory returns no id', async () => {
      mockAddMemory.mockResolvedValueOnce({}); // no id field
      const tool = makeTool();
      const { context } = makeContext();
      const long = 'z'.repeat(500);
      const result = await tool._storeDescriptionAsMemory('agent-1', 'X', long, context);
      expect(result).toBe(long);
    });

    test('handles empty description gracefully', async () => {
      const tool = makeTool();
      const { context } = makeContext();
      expect(await tool._storeDescriptionAsMemory('agent-1', 'X', '', context)).toBe('');
      expect(await tool._storeDescriptionAsMemory('agent-1', 'X', null, context)).toBeNull();
      expect(mockAddMemory).not.toHaveBeenCalled();
    });
  });

  // ── _extractMemoryRefs ───────────────────────────────────────────
  describe('_extractMemoryRefs', () => {
    test('extracts mem-xxx IDs from task descriptions', () => {
      const tool = makeTool();
      const refs = tool._extractMemoryRefs([
        { description: '[memory:mem-abc] do this' },
        { description: '[memory:mem-xyz-456] another' },
        { description: 'plain task without ref' }
      ]);
      expect(refs).toEqual(['mem-abc', 'mem-xyz-456']);
    });

    test('returns empty array when no memory refs present', () => {
      const tool = makeTool();
      expect(tool._extractMemoryRefs([
        { description: 'just text' },
        { description: '' },
        { description: undefined }
      ])).toEqual([]);
    });

    test('returns empty array for empty task list', () => {
      const tool = makeTool();
      expect(tool._extractMemoryRefs([])).toEqual([]);
    });

    test('only matches mem- prefix (not other [foo:bar] tags)', () => {
      const tool = makeTool();
      expect(tool._extractMemoryRefs([
        { description: '[user:bob] hi' },
        { description: '[memory:other-xyz] no' }, // not mem- prefix
        { description: '[memory:mem-good] yes' }
      ])).toEqual(['mem-good']);
    });
  });

  // ── create action: auto-storing as memory ────────────────────────
  describe('create action — auto-stores long description', () => {
    test('replaces long description with memory reference when memory capability present', async () => {
      mockAddMemory.mockResolvedValueOnce({ id: 'mem-task-1' });
      const tool = makeTool();
      const { context } = makeContext({ hasMemoryCapability: true });

      const longDesc = 'A very detailed task spec. '.repeat(20);
      const result = await tool.execute(
        { action: 'create', title: 'Implement Feature', description: longDesc, priority: 'high' },
        context
      );

      expect(result.success).toBe(true);
      expect(result.result.task.description).toMatch(/^\[memory:mem-task-1\]/);
      expect(mockAddMemory).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        title: 'task-context: Implement Feature',
        content: longDesc
      }));
    });

    test('keeps short description as-is (no memory creation)', async () => {
      const tool = makeTool();
      const { context } = makeContext({ hasMemoryCapability: true });

      const result = await tool.execute(
        { action: 'create', title: 'Quick fix', description: 'Tiny note', priority: 'low' },
        context
      );

      expect(result.success).toBe(true);
      expect(result.result.task.description).toBe('Tiny note');
      expect(mockAddMemory).not.toHaveBeenCalled();
    });

    test('keeps long description as-is when agent has no memory capability', async () => {
      const tool = makeTool();
      const { context } = makeContext({ hasMemoryCapability: false });

      const longDesc = 'Detailed.'.repeat(50);
      const result = await tool.execute(
        { action: 'create', title: 'No memory agent task', description: longDesc },
        context
      );

      expect(result.success).toBe(true);
      expect(result.result.task.description).toBe(longDesc);
      expect(mockAddMemory).not.toHaveBeenCalled();
    });
  });

  // ── complete action: memory cleanup hint ─────────────────────────
  describe('complete action — emits memoryHint when task references a memory', () => {
    test('includes memoryHint with the referenced memory ID', async () => {
      const tool = makeTool();
      const { agent, context } = makeContext({ hasMemoryCapability: true });
      agent.taskList.tasks = [{
        id: 'task-1',
        title: 'Old Task',
        description: '[memory:mem-context-99] summary text...',
        status: 'in_progress',
        priority: 'medium',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }];

      const result = await tool.execute(
        { action: 'complete', taskId: 'task-1' },
        context
      );

      expect(result.success).toBe(true);
      expect(result.result.memoryHint).toContain('mem-context-99');
      expect(result.result.memoryHint).toMatch(/cleaning up/i);
    });

    test('does not emit memoryHint when task has no memory reference', async () => {
      const tool = makeTool();
      const { agent, context } = makeContext();
      agent.taskList.tasks = [{
        id: 'task-1',
        title: 'Plain task',
        description: 'No reference here',
        status: 'in_progress',
        priority: 'medium',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }];

      const result = await tool.execute(
        { action: 'complete', taskId: 'task-1' },
        context
      );

      expect(result.success).toBe(true);
      expect(result.result.memoryHint).toBeUndefined();
    });
  });
});
