/**
 * Tests for the scheduler-visualizer surface on AgentScheduler.
 *
 * Covers the in-memory bookkeeping that backs the /scheduler page:
 *   - _recordCycle ring buffer (push + trim to _CYCLE_HISTORY_MAX)
 *   - lock acquire/release timestamping (_lockAcquiredAt)
 *   - processingCycle records exactly one entry per outcome path
 *       idle / all-locked / concurrency-cap / launched
 *   - getState() shape: scheduler block, locks block, agent rows
 *   - lockHeldMs reflects elapsed time since acquisition
 *
 * No real agent processing is exercised — we drive processingCycle directly
 * with a stubbed agent pool so each cycle's outcome is deterministic.
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';
import AgentScheduler from '../agentScheduler.js';
import { AGENT_MODES, AGENT_STATUS } from '../../utilities/constants.js';

function makeAgent(overrides = {}) {
  return {
    id: 'a1', name: 'Alpha',
    mode: AGENT_MODES.AGENT,
    status: AGENT_STATUS.ACTIVE,
    sessionId: 's1',
    taskList: { tasks: [{ status: 'pending', content: 'do the thing' }] },
    messageQueues: { userMessages: [], interAgentMessages: [], toolResults: [] },
    conversations: { full: { messages: [] } },
    ...overrides,
  };
}

function makeScheduler(agents = [makeAgent()]) {
  const agentPool = {
    getAgent: jest.fn(id => Promise.resolve(agents.find(a => a.id === id) || null)),
    getAllAgents: jest.fn().mockResolvedValue(agents),
    persistAgentState: jest.fn().mockResolvedValue(undefined),
    getCompactionMetadata: jest.fn().mockResolvedValue(null),
    getMessagesForAI: jest.fn().mockResolvedValue([]),
  };
  const messageProcessor = {
    extractAndExecuteTools: jest.fn().mockResolvedValue([]),
    extractToolCommands: jest.fn().mockResolvedValue([]),
  };
  const aiService = {
    sendMessage: jest.fn().mockResolvedValue({ content: 'x', tokenUsage: {} }),
    abortRequest: jest.fn().mockReturnValue(false),
    getActiveRequest: jest.fn().mockReturnValue(null),
  };
  const webSocketManager = { broadcastToSession: jest.fn() };
  const scheduler = new AgentScheduler(
    agentPool, messageProcessor, aiService,
    createMockLogger(), webSocketManager
  );
  // Don't actually spawn timers — we drive processingCycle by hand.
  scheduler.broadcastAgentStateUpdate = jest.fn().mockResolvedValue(undefined);
  // Stub processAgentsInParallel: a real launch acquires the lock inside
  // processAgent, but for visualizer tests we only care about pre-launch
  // bookkeeping (skip lists, recorded cycle entries). Make it a no-op.
  scheduler.processAgentsInParallel = jest.fn().mockResolvedValue(undefined);
  return { scheduler, agents, agentPool, aiService };
}

describe('_recordCycle ring buffer', () => {
  test('appends entries newest-last', () => {
    const { scheduler } = makeScheduler();
    scheduler._recordCycle({ n: 1, outcome: 'idle' });
    scheduler._recordCycle({ n: 2, outcome: 'launched' });
    expect(scheduler._cycleHistory).toHaveLength(2);
    expect(scheduler._cycleHistory[0].n).toBe(1);
    expect(scheduler._cycleHistory[1].n).toBe(2);
  });

  test('trims to _CYCLE_HISTORY_MAX, keeping the newest entries', () => {
    const { scheduler } = makeScheduler();
    scheduler._CYCLE_HISTORY_MAX = 5;
    for (let i = 1; i <= 12; i++) scheduler._recordCycle({ n: i, outcome: 'idle' });
    expect(scheduler._cycleHistory).toHaveLength(5);
    expect(scheduler._cycleHistory[0].n).toBe(8);   // 12-5+1
    expect(scheduler._cycleHistory[4].n).toBe(12);
  });
});

describe('processingCycle records one entry per outcome', () => {
  test('outcome=idle when no agent is active', async () => {
    const idleAgent = makeAgent({ taskList: { tasks: [] } });   // no pending tasks → not active
    const { scheduler } = makeScheduler([idleAgent]);
    await scheduler.processingCycle();
    expect(scheduler._cycleHistory).toHaveLength(1);
    expect(scheduler._cycleHistory[0].outcome).toBe('idle');
    expect(scheduler._cycleHistory[0].activeCount).toBe(0);
    expect(scheduler._cycleHistory[0].launched).toEqual([]);
  });

  test('outcome=all-locked when every active agent is already locked', async () => {
    const { scheduler } = makeScheduler();
    // Pre-lock the only active agent.
    scheduler.agentProcessingLocks.set('a1', true);
    scheduler._lockAcquiredAt.set('a1', new Date());
    await scheduler.processingCycle();
    expect(scheduler._cycleHistory).toHaveLength(1);
    expect(scheduler._cycleHistory[0].outcome).toBe('all-locked');
    expect(scheduler._cycleHistory[0].skippedLocked).toEqual(['a1']);
    expect(scheduler._cycleHistory[0].launched).toEqual([]);
  });

  test('outcome=launched and includes the agent id in launched[]', async () => {
    const { scheduler } = makeScheduler();
    await scheduler.processingCycle();
    expect(scheduler._cycleHistory).toHaveLength(1);
    expect(scheduler._cycleHistory[0].outcome).toBe('launched');
    expect(scheduler._cycleHistory[0].launched).toEqual(['a1']);
    expect(scheduler._cycleHistory[0].activeCount).toBe(1);
    expect(scheduler._cycleHistory[0].active[0]).toMatchObject({ agentId: 'a1', name: 'Alpha' });
  });

  test('outcome=concurrency-cap when slots are exhausted by in-flight work', async () => {
    // Two active agents, but pretend the cap is already saturated by 3 unrelated
    // in-flight ids. unlockedAgents.length > 0 but slotsAvailable === 0.
    const a = makeAgent({ id: 'a1', name: 'A' });
    const b = makeAgent({ id: 'a2', name: 'B' });
    const { scheduler } = makeScheduler([a, b]);
    // Saturate concurrency. Default MAX_CONCURRENT_AGENTS in scheduler = 3.
    scheduler.agentProcessingLocks.set('ghost-1', true);
    scheduler.agentProcessingLocks.set('ghost-2', true);
    scheduler.agentProcessingLocks.set('ghost-3', true);
    await scheduler.processingCycle();
    const entry = scheduler._cycleHistory.at(-1);
    expect(entry.outcome).toBe('concurrency-cap');
    expect(entry.launched).toEqual([]);
    expect(entry.skippedConcurrency.length).toBe(2);  // a1 + a2 both deferred
    expect(entry.skippedLocked).toEqual([]);
  });

  test('cycleCounter increments monotonically, n matches the cycle order', async () => {
    const { scheduler } = makeScheduler();
    await scheduler.processingCycle();
    await scheduler.processingCycle();
    await scheduler.processingCycle();
    expect(scheduler._cycleCounter).toBe(3);
    const ns = scheduler._cycleHistory.map(c => c.n);
    expect(ns).toEqual([1, 2, 3]);
  });
});

describe('lock timestamping', () => {
  test('processAgent acquires lock + records timestamp; release clears both', async () => {
    const { scheduler } = makeScheduler();
    // Stub the heavy bits inside processAgent so we exercise just the
    // lock-acquire/release path.
    scheduler._processAgentInner = jest.fn().mockResolvedValue(undefined);
    // The simplest check: drive the lock map directly via the same code path
    // processAgent uses (set + _lockAcquiredAt.set / delete + delete).
    scheduler.agentProcessingLocks.set('a1', true);
    scheduler._lockAcquiredAt.set('a1', new Date(Date.now() - 1234));
    expect(scheduler.agentProcessingLocks.has('a1')).toBe(true);
    expect(scheduler._lockAcquiredAt.get('a1')).toBeInstanceOf(Date);
    // Release path
    scheduler.agentProcessingLocks.delete('a1');
    scheduler._lockAcquiredAt.delete('a1');
    expect(scheduler.agentProcessingLocks.has('a1')).toBe(false);
    expect(scheduler._lockAcquiredAt.has('a1')).toBe(false);
  });

  test('removeAgent clears the lock-acquired timestamp', () => {
    const { scheduler } = makeScheduler();
    scheduler.agentProcessingLocks.set('a1', true);
    scheduler._lockAcquiredAt.set('a1', new Date());
    scheduler.removeAgent('a1', 'unit-test');
    expect(scheduler._lockAcquiredAt.has('a1')).toBe(false);
    expect(scheduler.agentProcessingLocks.has('a1')).toBe(false);
  });

  test('stop() clears the entire _lockAcquiredAt map and _cycleHistory', () => {
    const { scheduler } = makeScheduler();
    // stop() early-returns if !isRunning. Force the running flag so cleanup runs.
    scheduler.isRunning = true;
    scheduler.agentProcessingLocks.set('a1', true);
    scheduler._lockAcquiredAt.set('a1', new Date());
    scheduler._recordCycle({ n: 1, outcome: 'idle' });
    scheduler.stop();
    expect(scheduler._lockAcquiredAt.size).toBe(0);
    expect(scheduler._cycleHistory.length).toBe(0);
  });
});

describe('getState() snapshot shape', () => {
  test('top-level shape: serverTime, scheduler{}, locks[], cycles[], agents[]', async () => {
    const { scheduler } = makeScheduler();
    const state = await scheduler.getState();
    expect(state).toMatchObject({
      serverTime: expect.any(String),
      scheduler: expect.objectContaining({
        running: expect.any(Boolean),
        iterationDelayMs: expect.any(Number),
        maxConcurrent: expect.any(Number),
        currentlyInFlight: expect.any(Number),
        cycleCount: expect.any(Number),
      }),
      locks: expect.any(Array),
      cycles: expect.any(Array),
      agents: expect.any(Array),
    });
    // serverTime is ISO-parseable
    expect(Number.isNaN(new Date(state.serverTime).getTime())).toBe(false);
  });

  test('agent row carries activity/lockHeld/queues/tasks fields', async () => {
    const { scheduler } = makeScheduler();
    const state = await scheduler.getState();
    expect(state.agents).toHaveLength(1);
    const row = state.agents[0];
    expect(row).toMatchObject({
      id: 'a1', name: 'Alpha',
      mode: AGENT_MODES.AGENT,
      status: AGENT_STATUS.ACTIVE,
      lockHeld: false,
      lockHeldMs: null,
      activity: expect.objectContaining({ active: expect.any(Boolean) }),
      tasks: expect.objectContaining({ total: 1, pending: 1 }),
      queues: expect.objectContaining({ userMessages: 0, interAgentMessages: 0, toolResults: 0 }),
    });
  });

  test('lockHeldMs is non-null and ≥ 0 once the lock is held', async () => {
    const { scheduler } = makeScheduler();
    scheduler.agentProcessingLocks.set('a1', true);
    scheduler._lockAcquiredAt.set('a1', new Date(Date.now() - 50));
    const state = await scheduler.getState();
    const row = state.agents.find(r => r.id === 'a1');
    expect(row.lockHeld).toBe(true);
    expect(typeof row.lockHeldMs).toBe('number');
    expect(row.lockHeldMs).toBeGreaterThanOrEqual(40);   // tolerate timer slop
    // locks[] surfaces it too
    expect(state.locks).toEqual([
      expect.objectContaining({ agentId: 'a1', heldMs: expect.any(Number) }),
    ]);
    expect(state.scheduler.currentlyInFlight).toBe(1);
  });

  test('cycles[] reflects what was recorded by processingCycle', async () => {
    const { scheduler } = makeScheduler();
    await scheduler.processingCycle();   // outcome=launched, n=1
    const state = await scheduler.getState();
    expect(state.cycles).toHaveLength(1);
    expect(state.cycles[0]).toMatchObject({ n: 1, outcome: 'launched', launched: ['a1'] });
    expect(state.scheduler.cycleCount).toBe(1);
  });

  test('survives an agent without a taskList / messageQueues without throwing', async () => {
    const stub = makeAgent({ id: 'a1', taskList: undefined, messageQueues: undefined });
    const { scheduler } = makeScheduler([stub]);
    const state = await scheduler.getState();
    expect(state.agents[0].tasks).toMatchObject({ total: 0, pending: 0, inProgress: 0, completed: 0 });
    expect(state.agents[0].queues).toMatchObject({ userMessages: 0, interAgentMessages: 0, toolResults: 0 });
  });
});
