import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';
import {
  shouldAgentBeActive,
  getActiveAgents,
  getAllAgentActivityStatus,
  shouldSkipIteration,
  hasPendingTasks,
  getMessageQueueStatus,
  isAgentDelayed,
  isAgentPaused,
  isExecutingTools
} from '../agentActivityService.js';

// Helper to create a base active agent
function makeAgent(overrides = {}) {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    sessionId: 'session-1',
    status: 'active',
    mode: 'agent',
    taskList: { tasks: [] },
    messageQueues: {},
    delayEndTime: null,
    pausedUntil: null,
    awaitingUserInput: null,
    stopRequested: false,
    toolExecutionInProgress: false,
    ttl: null,
    ...overrides
  };
}

describe('agentActivityService', () => {
  describe('hasPendingTasks', () => {
    test('returns false when taskList is null or missing', () => {
      expect(hasPendingTasks({})).toBe(false);
      expect(hasPendingTasks({ taskList: null })).toBe(false);
      expect(hasPendingTasks({ taskList: {} })).toBe(false);
      expect(hasPendingTasks({ taskList: { tasks: 'not-array' } })).toBe(false);
    });

    test('returns true when there are pending tasks', () => {
      const agent = makeAgent({
        taskList: { tasks: [{ status: 'pending' }] }
      });
      expect(hasPendingTasks(agent)).toBe(true);
    });

    test('returns true when there are in_progress tasks', () => {
      const agent = makeAgent({
        taskList: { tasks: [{ status: 'completed' }, { status: 'in_progress' }] }
      });
      expect(hasPendingTasks(agent)).toBe(true);
    });

    test('returns false when all tasks are completed', () => {
      const agent = makeAgent({
        taskList: { tasks: [{ status: 'completed' }, { status: 'failed' }] }
      });
      expect(hasPendingTasks(agent)).toBe(false);
    });
  });

  describe('getMessageQueueStatus', () => {
    test('returns zero counts for empty queues', () => {
      const result = getMessageQueueStatus({});
      expect(result.hasMessages).toBe(false);
      expect(result.counts.total).toBe(0);
    });

    test('counts messages across all queues', () => {
      const agent = makeAgent({
        messageQueues: {
          toolResults: [{ id: 1 }],
          interAgentMessages: [{ id: 2 }, { id: 3 }],
          userMessages: [{ id: 4 }]
        }
      });
      const result = getMessageQueueStatus(agent);
      expect(result.hasMessages).toBe(true);
      expect(result.hasUserMessages).toBe(true);
      expect(result.hasInterAgentMessages).toBe(true);
      expect(result.hasToolResults).toBe(true);
      expect(result.counts.total).toBe(4);
    });

    test('handles non-array queue values', () => {
      const agent = makeAgent({
        messageQueues: { toolResults: 'not-array', userMessages: null }
      });
      const result = getMessageQueueStatus(agent);
      expect(result.counts.toolResults).toBe(0);
      expect(result.counts.userMessages).toBe(0);
    });
  });

  describe('isAgentDelayed', () => {
    test('returns false when no delayEndTime', () => {
      expect(isAgentDelayed(makeAgent())).toBe(false);
    });

    test('returns true when delay is in the future', () => {
      const future = new Date(Date.now() + 60000).toISOString();
      expect(isAgentDelayed(makeAgent({ delayEndTime: future }))).toBe(true);
    });

    test('returns false when delay is in the past', () => {
      const past = new Date(Date.now() - 60000).toISOString();
      expect(isAgentDelayed(makeAgent({ delayEndTime: past }))).toBe(false);
    });
  });

  describe('isAgentPaused', () => {
    test('returns false for active, non-paused agent', () => {
      expect(isAgentPaused(makeAgent())).toBe(false);
    });

    test('returns true for paused status without expiry', () => {
      expect(isAgentPaused(makeAgent({ status: 'paused' }))).toBe(true);
    });

    test('returns true for paused status with future expiry', () => {
      const future = new Date(Date.now() + 60000).toISOString();
      expect(isAgentPaused(makeAgent({ status: 'paused', pausedUntil: future }))).toBe(true);
    });

    test('returns false for paused status with past expiry', () => {
      const past = new Date(Date.now() - 60000).toISOString();
      expect(isAgentPaused(makeAgent({ status: 'paused', pausedUntil: past }))).toBe(false);
    });

    test('returns true when pausedUntil is in future even without paused status', () => {
      const future = new Date(Date.now() + 60000).toISOString();
      expect(isAgentPaused(makeAgent({ pausedUntil: future }))).toBe(true);
    });
  });

  describe('isExecutingTools', () => {
    test('returns true when toolExecutionInProgress is true', () => {
      expect(isExecutingTools({ toolExecutionInProgress: true })).toBe(true);
    });

    test('returns false otherwise', () => {
      expect(isExecutingTools({ toolExecutionInProgress: false })).toBe(false);
      expect(isExecutingTools({})).toBe(false);
    });
  });

  describe('shouldAgentBeActive', () => {
    test('returns inactive for null agent', () => {
      const result = shouldAgentBeActive(null);
      expect(result.active).toBe(false);
      expect(result.reason).toBe('agent-not-found');
    });

    test('returns inactive for non-active status', () => {
      const result = shouldAgentBeActive(makeAgent({ status: 'idle' }));
      expect(result.active).toBe(false);
      expect(result.reason).toBe('agent-inactive-status');
    });

    test('returns inactive when delayed', () => {
      const future = new Date(Date.now() + 60000).toISOString();
      const result = shouldAgentBeActive(makeAgent({ delayEndTime: future }));
      expect(result.active).toBe(false);
      expect(result.reason).toBe('agent-delayed');
    });

    test('returns inactive when paused', () => {
      const result = shouldAgentBeActive(makeAgent({ status: 'active', pausedUntil: new Date(Date.now() + 60000).toISOString() }));
      expect(result.active).toBe(false);
      expect(result.reason).toBe('agent-paused');
    });

    test('returns inactive when awaiting user input', () => {
      const result = shouldAgentBeActive(makeAgent({ awaitingUserInput: { type: 'credentials' } }));
      expect(result.active).toBe(false);
      expect(result.reason).toBe('awaiting-user-input');
    });

    test('returns inactive when stop requested', () => {
      const result = shouldAgentBeActive(makeAgent({ stopRequested: true }));
      expect(result.active).toBe(false);
      expect(result.reason).toBe('stop-requested');
    });

    test('returns active when TTL remaining', () => {
      const result = shouldAgentBeActive(makeAgent({ ttl: 3 }));
      expect(result.active).toBe(true);
      expect(result.reason).toBe('has-ttl-remaining');
    });

    test('AGENT mode: active when has pending tasks', () => {
      const result = shouldAgentBeActive(makeAgent({
        taskList: { tasks: [{ status: 'pending' }] }
      }));
      expect(result.active).toBe(true);
      expect(result.reason).toBe('has-pending-tasks');
    });

    test('AGENT mode: inactive when no pending tasks', () => {
      const result = shouldAgentBeActive(makeAgent({
        taskList: { tasks: [{ status: 'completed' }] }
      }));
      expect(result.active).toBe(false);
      expect(result.reason).toBe('no-pending-work');
    });

    test('CHAT mode: active when has user messages', () => {
      const result = shouldAgentBeActive(makeAgent({
        mode: 'chat',
        messageQueues: { userMessages: [{ id: 1 }] }
      }));
      expect(result.active).toBe(true);
      expect(result.reason).toBe('has-user-messages');
    });

    test('CHAT mode: active when has inter-agent messages', () => {
      const result = shouldAgentBeActive(makeAgent({
        mode: 'chat',
        messageQueues: { interAgentMessages: [{ id: 1 }] }
      }));
      expect(result.active).toBe(true);
      expect(result.reason).toBe('has-inter-agent-messages');
    });

    test('CHAT mode: inactive with only tool results', () => {
      const result = shouldAgentBeActive(makeAgent({
        mode: 'chat',
        messageQueues: { toolResults: [{ id: 1 }] }
      }));
      expect(result.active).toBe(false);
      expect(result.reason).toBe('chat-mode-no-messages');
      expect(result.details).toContain('tool results');
    });

    test('CHAT mode: inactive with no messages', () => {
      const result = shouldAgentBeActive(makeAgent({ mode: 'chat' }));
      expect(result.active).toBe(false);
      expect(result.reason).toBe('chat-mode-no-messages');
    });

    test('returns unknown mode for unrecognized mode', () => {
      const result = shouldAgentBeActive(makeAgent({ mode: 'weird' }));
      expect(result.active).toBe(false);
      expect(result.reason).toBe('unknown-mode');
    });
  });

  describe('getActiveAgents', () => {
    test('filters active agents from an array', () => {
      const agents = [
        makeAgent({ id: 'a1', taskList: { tasks: [{ status: 'pending' }] } }),
        makeAgent({ id: 'a2', status: 'idle' }),
        makeAgent({ id: 'a3', taskList: { tasks: [{ status: 'pending' }] } })
      ];
      const active = getActiveAgents(agents);
      expect(active).toHaveLength(2);
      expect(active.map(a => a.agentId)).toEqual(['a1', 'a3']);
    });

    test('works with a Map input', () => {
      const agents = new Map();
      agents.set('a1', makeAgent({ id: 'a1', taskList: { tasks: [{ status: 'pending' }] } }));
      agents.set('a2', makeAgent({ id: 'a2', status: 'idle' }));
      const active = getActiveAgents(agents);
      expect(active).toHaveLength(1);
    });
  });

  describe('getAllAgentActivityStatus', () => {
    test('returns detailed status for all agents', () => {
      const agents = [
        makeAgent({ id: 'a1', name: 'Agent 1', taskList: { tasks: [{ status: 'pending' }] } })
      ];
      const statuses = getAllAgentActivityStatus(agents);
      expect(statuses).toHaveLength(1);
      expect(statuses[0].agentId).toBe('a1');
      expect(statuses[0].active).toBe(true);
      expect(statuses[0]).toHaveProperty('queueCounts');
      expect(statuses[0]).toHaveProperty('hasPendingTasks');
      expect(statuses[0]).toHaveProperty('isExecutingTools');
    });

    test('works with Map input', () => {
      const map = new Map();
      map.set('a1', makeAgent({ id: 'a1' }));
      const statuses = getAllAgentActivityStatus(map);
      expect(statuses).toHaveLength(1);
    });
  });

  describe('shouldSkipIteration', () => {
    test('returns skip for null agent', () => {
      const result = shouldSkipIteration(null);
      expect(result.skip).toBe(true);
    });

    test('returns skip when delayed', () => {
      const future = new Date(Date.now() + 60000).toISOString();
      const result = shouldSkipIteration(makeAgent({ delayEndTime: future }));
      expect(result.skip).toBe(true);
    });

    test('returns skip when paused with future expiry', () => {
      const future = new Date(Date.now() + 60000).toISOString();
      const result = shouldSkipIteration(makeAgent({ pausedUntil: future }));
      expect(result.skip).toBe(true);
    });

    test('returns no skip for normal agent', () => {
      const result = shouldSkipIteration(makeAgent());
      expect(result.skip).toBe(false);
      expect(result.reason).toBeNull();
    });

    // Belt-and-suspenders: inbound work always beats delay/pause. The
    // primary fix lives in agentPool._wakeAgentForMessage — this is the
    // second line of defence against any path that bypasses it.
    test('delayed agent with queued user message does NOT skip', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const agent = makeAgent({
        delayEndTime: future,
        messageQueues: { userMessages: [{ content: 'hi' }], interAgentMessages: [], toolResults: [] },
      });
      expect(shouldSkipIteration(agent).skip).toBe(false);
    });

    test('delayed agent with queued inter-agent message does NOT skip', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const agent = makeAgent({
        delayEndTime: future,
        messageQueues: { userMessages: [], interAgentMessages: [{ content: 'ping' }], toolResults: [] },
      });
      expect(shouldSkipIteration(agent).skip).toBe(false);
    });

    test('delayed agent with queued tool result does NOT skip', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const agent = makeAgent({
        delayEndTime: future,
        messageQueues: { userMessages: [], interAgentMessages: [], toolResults: [{ toolId: 'x', status: 'completed' }] },
      });
      expect(shouldSkipIteration(agent).skip).toBe(false);
    });

    test('paused-until agent with queued message does NOT skip', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const agent = makeAgent({
        pausedUntil: future,
        messageQueues: { userMessages: [{ content: 'hi' }], interAgentMessages: [], toolResults: [] },
      });
      expect(shouldSkipIteration(agent).skip).toBe(false);
    });
  });

  describe('shouldAgentBeActive — inbound work overrides delay/pause', () => {
    test('delayed agent with user message → active', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const agent = makeAgent({
        delayEndTime: future,
        messageQueues: { userMessages: [{ content: 'hi' }], interAgentMessages: [], toolResults: [] },
        taskList: { tasks: [{ status: 'pending' }] },
      });
      expect(shouldAgentBeActive(agent).active).toBe(true);
    });

    test('delayed agent with inter-agent message → active', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const agent = makeAgent({
        delayEndTime: future,
        messageQueues: { userMessages: [], interAgentMessages: [{ content: 'ping' }], toolResults: [] },
        taskList: { tasks: [{ status: 'pending' }] },
      });
      expect(shouldAgentBeActive(agent).active).toBe(true);
    });

    test('pausedUntil agent (status=active) with queued work → active', () => {
      // Unusual but defensive: status still ACTIVE but pausedUntil set
      const future = new Date(Date.now() + 60_000).toISOString();
      const agent = makeAgent({
        pausedUntil: future,
        messageQueues: { userMessages: [], interAgentMessages: [{ content: 'ping' }], toolResults: [] },
        taskList: { tasks: [{ status: 'pending' }] },
      });
      expect(shouldAgentBeActive(agent).active).toBe(true);
    });

    test('delayed agent WITHOUT queued work → still inactive (delay honoured)', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const agent = makeAgent({
        delayEndTime: future,
        messageQueues: { userMessages: [], interAgentMessages: [], toolResults: [] },
      });
      const r = shouldAgentBeActive(agent);
      expect(r.active).toBe(false);
      expect(r.reason).toBe('agent-delayed');
    });
  });
});
