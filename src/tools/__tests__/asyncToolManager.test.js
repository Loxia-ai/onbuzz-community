import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

jest.unstable_mockModule('../../utilities/constants.js', () => ({
  TOOL_STATUS: {
    PENDING: 'pending',
    EXECUTING: 'executing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    TIMEOUT: 'timeout'
  },
  SYSTEM_DEFAULTS: { MAX_TOOL_EXECUTION_TIME: 300000 },
  OPERATION_STATUS: {},
  ERROR_TYPES: {}
}));

const { default: AsyncToolManager } = await import('../asyncToolManager.js');

describe('AsyncToolManager', () => {
  let manager;
  let logger;

  beforeEach(() => {
    jest.useFakeTimers();
    logger = createMockLogger();
    manager = new AsyncToolManager({
      maxConcurrentOperations: 5,
      defaultTimeout: 10000,
      cleanupInterval: 60000
    }, logger);
  });

  afterEach(() => {
    manager.stopMonitoring();
    manager.removeAllListeners();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    test('should set default config', () => {
      expect(manager.maxConcurrentOperations).toBe(5);
      expect(manager.defaultTimeout).toBe(10000);
      expect(manager.operations).toBeInstanceOf(Map);
      expect(manager.operationHistory).toEqual([]);
    });

    test('should start monitoring on creation', () => {
      expect(manager.monitoringInterval).not.toBeNull();
    });
  });

  describe('startOperation', () => {
    test('should create and track a new operation', async () => {
      const opId = await manager.startOperation('filesystem', 'agent-1', { path: '/test' });
      expect(typeof opId).toBe('string');
      expect(opId).toMatch(/^op-/);
      expect(manager.operations.has(opId)).toBe(true);
    });

    test('should set pending status initially', async () => {
      const opId = await manager.startOperation('filesystem', 'agent-1', {});
      const op = manager.operations.get(opId);
      expect(op.status).toBe('pending');
    });

    test('should throw when max concurrent operations reached', async () => {
      // Fill up operations
      for (let i = 0; i < 5; i++) {
        await manager.startOperation('tool', `agent-${i}`, {});
      }
      await expect(manager.startOperation('tool', 'agent-extra', {}))
        .rejects.toThrow('Maximum concurrent operations');
    });

    test('should use custom timeout from context', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {}, { timeout: 5000 });
      const op = manager.operations.get(opId);
      expect(op.timeout).toBe(5000);
    });
  });

  describe('updateOperation', () => {
    test('should update operation status', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {});
      const result = manager.updateOperation(opId, 'executing');
      expect(result).toBe(true);
      expect(manager.operations.get(opId).status).toBe('executing');
    });

    test('should set startedAt on executing', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {});
      manager.updateOperation(opId, 'executing');
      expect(manager.operations.get(opId).startedAt).not.toBeNull();
    });

    test('should set completedAt on completed', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {});
      manager.updateOperation(opId, 'completed', { result: 'done' });
      expect(manager.operations.get(opId).completedAt).not.toBeNull();
      expect(manager.operations.get(opId).result).toBe('done');
    });

    test('should return false for unknown operation', () => {
      const result = manager.updateOperation('nonexistent', 'completed');
      expect(result).toBe(false);
    });

    test('should store error data', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {});
      manager.updateOperation(opId, 'failed', { error: 'Something broke' });
      expect(manager.operations.get(opId).error).toBe('Something broke');
    });

    test('should store progress data', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {});
      manager.updateOperation(opId, 'executing', { progress: 50 });
      expect(manager.operations.get(opId).progress).toBe(50);
    });
  });

  describe('getOperation', () => {
    test('should return operation details', async () => {
      const opId = await manager.startOperation('filesystem', 'agent-1', { path: '/test' });
      const op = manager.getOperation(opId);
      expect(op).not.toBeNull();
      expect(op.toolId).toBe('filesystem');
      expect(op.agentId).toBe('agent-1');
      expect(op.status).toBe('pending');
    });

    test('should return null for unknown operation', () => {
      expect(manager.getOperation('nonexistent')).toBeNull();
    });

    test('should include executionTime', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {});
      manager.updateOperation(opId, 'executing');
      const op = manager.getOperation(opId);
      expect(op.executionTime).toBeDefined();
    });
  });

  describe('getAgentOperations', () => {
    test('should return only operations for specified agent', async () => {
      await manager.startOperation('tool1', 'agent-1', {});
      await manager.startOperation('tool2', 'agent-1', {});
      await manager.startOperation('tool3', 'agent-2', {});

      const ops = manager.getAgentOperations('agent-1');
      expect(ops).toHaveLength(2);
    });

    test('returns all operations for agent', async () => {
      const id1 = await manager.startOperation('tool1', 'agent-1', {});
      const id2 = await manager.startOperation('tool2', 'agent-1', {});
      const ops = manager.getAgentOperations('agent-1');
      const ids = ops.map(op => op.id);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
    });
  });

  describe('cancelOperation', () => {
    test('should cancel a pending operation', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {});
      const result = await manager.cancelOperation(opId, 'No longer needed');
      expect(result).toBe(true);
    });

    test('should return false for unknown operation', async () => {
      const result = await manager.cancelOperation('nonexistent');
      expect(result).toBe(false);
    });

    test('should not cancel completed operation', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {});
      manager.updateOperation(opId, 'completed');
      const result = await manager.cancelOperation(opId);
      expect(result).toBe(false);
    });
  });

  describe('retryOperation', () => {
    test('should retry a failed operation with retries remaining', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {}, { maxRetries: 3 });
      manager.updateOperation(opId, 'failed', { error: 'timeout' });
      const result = await manager.retryOperation(opId);
      expect(result).toBe(true);
      expect(manager.operations.get(opId).retryCount).toBe(1);
      expect(manager.operations.get(opId).status).toBe('pending');
    });

    test('should not retry when max retries exceeded', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {}, { maxRetries: 0 });
      manager.updateOperation(opId, 'failed');
      const result = await manager.retryOperation(opId);
      expect(result).toBe(false);
    });

    test('should not retry non-failed operation', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {});
      const result = await manager.retryOperation(opId);
      expect(result).toBe(false);
    });

    test('should return false for unknown operation', async () => {
      const result = await manager.retryOperation('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getStatistics', () => {
    test('should return correct stats', async () => {
      await manager.startOperation('filesystem', 'agent-1', {});
      await manager.startOperation('terminal', 'agent-1', {});
      await manager.startOperation('filesystem', 'agent-2', {});

      const stats = manager.getStatistics();
      expect(stats.total).toBe(3);
      expect(stats.byTool.filesystem).toBe(2);
      expect(stats.byTool.terminal).toBe(1);
      expect(stats.byAgent['agent-1']).toBe(2);
    });

    test('should return empty stats when no operations', () => {
      const stats = manager.getStatistics();
      expect(stats.total).toBe(0);
      expect(stats.averageExecutionTime).toBe(0);
    });
  });

  describe('cleanupCompletedOperations', () => {
    test('should clean up old completed operations', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {});
      manager.updateOperation(opId, 'completed');

      // Set completedAt to past
      manager.operations.get(opId).completedAt = new Date(Date.now() - 7200000).toISOString();

      const count = await manager.cleanupCompletedOperations(3600000);
      expect(count).toBe(1);
      expect(manager.operations.has(opId)).toBe(false);
    });

    test('should not clean up recent operations', async () => {
      const opId = await manager.startOperation('tool', 'agent-1', {});
      manager.updateOperation(opId, 'completed');

      const count = await manager.cleanupCompletedOperations(3600000);
      expect(count).toBe(0);
    });
  });

  describe('shutdown', () => {
    test('should cancel active operations and stop monitoring', async () => {
      await manager.startOperation('tool1', 'agent-1', {});
      await manager.startOperation('tool2', 'agent-1', {});

      await manager.shutdown();
      expect(manager.isShuttingDown).toBe(true);
      expect(manager.operations.size).toBe(0);
      expect(manager.monitoringInterval).toBeNull();
    });
  });

  describe('getOperationHistory', () => {
    test('should return empty history initially', () => {
      const history = manager.getOperationHistory();
      expect(history).toEqual([]);
    });

    test('should filter by agentId', async () => {
      // Add to history manually
      manager.operationHistory.push(
        { agentId: 'agent-1', toolId: 'tool1', createdAt: new Date().toISOString() },
        { agentId: 'agent-2', toolId: 'tool2', createdAt: new Date().toISOString() }
      );
      const history = manager.getOperationHistory({ agentId: 'agent-1' });
      expect(history).toHaveLength(1);
    });

    test('should filter by toolId', () => {
      manager.operationHistory.push(
        { agentId: 'agent-1', toolId: 'filesystem', createdAt: new Date().toISOString() },
        { agentId: 'agent-1', toolId: 'terminal', createdAt: new Date().toISOString() }
      );
      const history = manager.getOperationHistory({ toolId: 'filesystem' });
      expect(history).toHaveLength(1);
    });

    test('should filter by status', () => {
      manager.operationHistory.push(
        { agentId: 'agent-1', status: 'completed', createdAt: new Date().toISOString() },
        { agentId: 'agent-1', status: 'failed', createdAt: new Date().toISOString() }
      );
      const history = manager.getOperationHistory({ status: 'completed' });
      expect(history).toHaveLength(1);
    });

    test('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        manager.operationHistory.push({
          agentId: 'agent-1', createdAt: new Date().toISOString()
        });
      }
      const history = manager.getOperationHistory({ limit: 3 });
      expect(history).toHaveLength(3);
    });
  });

  describe('generateOperationId', () => {
    test('should generate unique IDs', () => {
      const id1 = manager.generateOperationId();
      const id2 = manager.generateOperationId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^op-/);
    });
  });

  describe('calculateExecutionTime', () => {
    test('should return 0 when not started', () => {
      const result = manager.calculateExecutionTime({ startedAt: null });
      expect(result).toBe(0);
    });

    test('should calculate time for completed operation', () => {
      const start = new Date('2024-01-01T00:00:00Z');
      const end = new Date('2024-01-01T00:01:00Z');
      const result = manager.calculateExecutionTime({
        startedAt: start.toISOString(),
        completedAt: end.toISOString()
      });
      expect(result).toBe(60000);
    });
  });

  describe('stopMonitoring', () => {
    test('should clear the interval', () => {
      manager.stopMonitoring();
      expect(manager.monitoringInterval).toBeNull();
    });
  });
});
