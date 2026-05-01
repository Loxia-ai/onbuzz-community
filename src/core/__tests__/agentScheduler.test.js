/**
 * AgentScheduler - Comprehensive unit tests (target: 80%+ line coverage)
 * Focuses on hash/loop detection, scheduling lifecycle, processing guards,
 * and agent session management.
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// ── Mock dependencies ────────────────────────────────────────────────────────
jest.unstable_mockModule('../../services/contextInjectionService.js', () => ({
  default: jest.fn().mockImplementation(() => ({
    injectContext: jest.fn().mockResolvedValue({ messages: [], injected: false })
  }))
}));

jest.unstable_mockModule('../../services/flowContextService.js', () => ({
  default: jest.fn().mockImplementation(() => ({
    injectFlowContext: jest.fn().mockResolvedValue({ messages: [] })
  }))
}));

jest.unstable_mockModule('../../services/tokenCountingService.js', () => ({
  default: jest.fn().mockImplementation(() => ({
    countTokens: jest.fn().mockReturnValue(100),
    cleanup: jest.fn()
  }))
}));

jest.unstable_mockModule('../../services/conversationCompactionService.js', () => ({
  default: jest.fn().mockImplementation(() => ({
    shouldCompact: jest.fn().mockReturnValue(false),
    compact: jest.fn().mockResolvedValue(null),
    setModelsService: jest.fn()
  }))
}));

const mockShouldAgentBeActive = jest.fn().mockReturnValue({ active: false, reason: 'no-messages' });
const mockGetActiveAgents = jest.fn().mockReturnValue([]);
const mockShouldSkipIteration = jest.fn().mockReturnValue({ skip: false });

jest.unstable_mockModule('../../services/agentActivityService.js', () => ({
  shouldAgentBeActive: mockShouldAgentBeActive,
  getActiveAgents: mockGetActiveAgents,
  shouldSkipIteration: mockShouldSkipIteration
}));

const { default: AgentScheduler } = await import('../agentScheduler.js');

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeAgent(overrides = {}) {
  return {
    id: overrides.id || 'agent-test-1',
    name: overrides.name || 'TestAgent',
    mode: overrides.mode || 'chat',
    status: 'active',
    stopRequested: false,
    preferredModel: 'test-model',
    currentModel: 'test-model',
    sessionId: 'sess-1',
    iterationCount: 0,
    maxIterations: 10,
    delayEndTime: null,
    ttl: null,
    conversations: {
      full: { messages: overrides.messages || [], lastUpdated: new Date().toISOString() },
      'test-model': { messages: overrides.messages || [], lastUpdated: new Date().toISOString() }
    },
    messageQueues: {
      userMessages: overrides.userMessages || [],
      interAgentMessages: [],
      toolResults: []
    },
    taskList: { tasks: [], lastUpdated: new Date().toISOString() },
    directoryAccess: { workingDirectory: '/tmp' },
    ...overrides
  };
}

function makeScheduler() {
  const logger = createMockLogger();
  const agentPool = {
    getAgent: jest.fn().mockResolvedValue(null),
    getAllAgents: jest.fn().mockResolvedValue([]),
    persistAgentState: jest.fn().mockResolvedValue(undefined),
    addToolResult: jest.fn().mockResolvedValue(undefined),
    getCompactionMetadata: jest.fn().mockResolvedValue(null),
    getMessagesForAI: jest.fn().mockResolvedValue([])
  };
  const messageProcessor = {
    extractAndExecuteTools: jest.fn().mockResolvedValue([]),
    extractToolCommands: jest.fn().mockResolvedValue([])
  };
  const aiService = {
    sendMessage: jest.fn().mockResolvedValue({ content: 'AI response', tokenUsage: { total_tokens: 100 } }),
    abortRequest: jest.fn().mockReturnValue(false)
  };
  const scheduler = new AgentScheduler(agentPool, messageProcessor, aiService, logger);
  return { scheduler, agentPool, messageProcessor, aiService, logger };
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('AgentScheduler', () => {
  let scheduler, agentPool, logger;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ scheduler, agentPool, logger } = makeScheduler());
  });

  afterEach(() => {
    scheduler.stop();
  });

  // ─── generateAgentStateHash ────────────────────────────────────────────
  describe('generateAgentStateHash', () => {
    test('generates consistent hash for same conversation state', () => {
      const agent = makeAgent({
        messages: [
          { role: 'assistant', content: 'Hello world' }
        ]
      });
      const hash1 = scheduler.generateAgentStateHash(agent);
      const hash2 = scheduler.generateAgentStateHash(agent);
      expect(hash1).toBe(hash2);
    });

    test('generates different hash for different content', () => {
      const agent1 = makeAgent({ messages: [{ role: 'assistant', content: 'Hello' }] });
      const agent2 = makeAgent({ messages: [{ role: 'assistant', content: 'Goodbye' }] });
      const hash1 = scheduler.generateAgentStateHash(agent1);
      const hash2 = scheduler.generateAgentStateHash(agent2);
      expect(hash1).not.toBe(hash2);
    });

    test('only considers last 3 assistant messages', () => {
      const msgs = Array.from({ length: 10 }, (_, i) => ({
        role: 'assistant', content: `Message ${i}`
      }));
      const agent = makeAgent({ messages: msgs });
      const hash = scheduler.generateAgentStateHash(agent);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    test('includes tool calls in hash', () => {
      const agent1 = makeAgent({
        messages: [{ role: 'assistant', content: 'X', toolCalls: [{ toolId: 'terminal', parameters: { cmd: 'ls' } }] }]
      });
      const agent2 = makeAgent({
        messages: [{ role: 'assistant', content: 'X', toolCalls: [{ toolId: 'filesystem', parameters: { action: 'read' } }] }]
      });
      expect(scheduler.generateAgentStateHash(agent1)).not.toBe(scheduler.generateAgentStateHash(agent2));
    });

    test('handles empty conversation gracefully', () => {
      const agent = makeAgent({ messages: [] });
      const hash = scheduler.generateAgentStateHash(agent);
      expect(hash).toBeDefined();
    });

    test('handles missing conversations gracefully', () => {
      const agent = { conversations: {} };
      const hash = scheduler.generateAgentStateHash(agent);
      expect(hash).toBeDefined();
    });

    test('filters to only assistant messages, ignores user messages', () => {
      const agent1 = makeAgent({ messages: [
        { role: 'user', content: 'question' },
        { role: 'assistant', content: 'answer' }
      ]});
      const agent2 = makeAgent({ messages: [
        { role: 'user', content: 'different question' },
        { role: 'assistant', content: 'answer' }
      ]});
      // Same assistant content should produce same hash
      expect(scheduler.generateAgentStateHash(agent1)).toBe(scheduler.generateAgentStateHash(agent2));
    });
  });

  // ─── detectRepetitiveLoop ──────────────────────────────────────────────
  describe('detectRepetitiveLoop', () => {
    test('returns no loop for empty history', () => {
      const result = scheduler.detectRepetitiveLoop('agent-1', 'hash-abc');
      expect(result.isLoop).toBe(false);
      expect(result.isImmediateDuplicate).toBe(false);
      expect(result.occurrences).toBe(0);
    });

    test('detects immediate duplicate', () => {
      scheduler.stateHashHistory.set('agent-1', [
        { hash: 'hash-abc', timestamp: Date.now() }
      ]);
      const result = scheduler.detectRepetitiveLoop('agent-1', 'hash-abc');
      expect(result.isImmediateDuplicate).toBe(true);
      expect(result.occurrences).toBe(1);
    });

    test('detects loop when threshold is met', () => {
      // Fill with enough repeated hashes to trigger loop (threshold = 5)
      const history = Array.from({ length: 5 }, () => ({ hash: 'repeat-hash', timestamp: Date.now() }));
      scheduler.stateHashHistory.set('agent-1', history);
      const result = scheduler.detectRepetitiveLoop('agent-1', 'repeat-hash');
      expect(result.isLoop).toBe(true);
      expect(result.occurrences).toBe(5);
    });

    test('does not detect loop below threshold', () => {
      const history = Array.from({ length: 3 }, () => ({ hash: 'some-hash', timestamp: Date.now() }));
      scheduler.stateHashHistory.set('agent-1', history);
      const result = scheduler.detectRepetitiveLoop('agent-1', 'some-hash');
      expect(result.isLoop).toBe(false);
      expect(result.occurrences).toBe(3);
    });

    test('uses sliding window - old entries are not counted', () => {
      // Create more entries than window size, with repeated hash only in oldest entries
      const history = [];
      for (let i = 0; i < 25; i++) {
        history.push({ hash: i < 5 ? 'old-hash' : `unique-${i}`, timestamp: Date.now() });
      }
      scheduler.stateHashHistory.set('agent-1', history);
      // The 'old-hash' entries are outside the window (last 20)
      const result = scheduler.detectRepetitiveLoop('agent-1', 'old-hash');
      expect(result.isLoop).toBe(false);
    });
  });

  // ─── recordStateHash ───────────────────────────────────────────────────
  describe('recordStateHash', () => {
    test('adds hash entry to history', () => {
      scheduler.recordStateHash('agent-1', 'hash-123');
      const history = scheduler.stateHashHistory.get('agent-1');
      expect(history).toHaveLength(1);
      expect(history[0].hash).toBe('hash-123');
      expect(history[0].timestamp).toBeDefined();
    });

    test('creates history array if not exists', () => {
      expect(scheduler.stateHashHistory.has('new-agent')).toBe(false);
      scheduler.recordStateHash('new-agent', 'hash-x');
      expect(scheduler.stateHashHistory.has('new-agent')).toBe(true);
    });

    test('trims history when exceeding max size (2x window)', () => {
      // Window is 20, so max history is 40
      const history = Array.from({ length: 45 }, (_, i) => ({
        hash: `hash-${i}`, timestamp: Date.now()
      }));
      scheduler.stateHashHistory.set('agent-1', history);
      scheduler.recordStateHash('agent-1', 'new-hash');
      const updated = scheduler.stateHashHistory.get('agent-1');
      expect(updated.length).toBeLessThanOrEqual(41); // 40 max + 1 new
    });
  });

  // ─── handleRepetitiveLoop ──────────────────────────────────────────────
  describe('handleRepetitiveLoop', () => {
    test('switches agent to chat mode without polluting the chat transcript', async () => {
      // Loop detection is a system event, not conversation content. The mode
      // flip is the action; the humanReason is surfaced via the
      // `agent_mode_changed` broadcast so the UI can render a toast /
      // notification-center entry. NO transcript bubble is added (previous
      // behavior tripled-posted the same "I notice I've been producing
      // similar responses..." text every time the loop tripped).
      const agent = makeAgent({ id: 'agent-loop', mode: 'agent' });
      agentPool.getAgent.mockResolvedValue(agent);

      await scheduler.handleRepetitiveLoop('agent-loop', { occurrences: 5, windowSize: 20 });

      expect(agent.mode).toBe('chat');
      expect(agent.conversations.full.messages.length).toBe(0); // no chat bubble
      expect(agentPool.persistAgentState).toHaveBeenCalledWith('agent-loop');

      // Mode transition was recorded with a human-readable reason.
      const history = scheduler._modeTransitionHistory.get('agent-loop');
      expect(history).toHaveLength(1);
      expect(history[0].reasonCode).toBe('loop-detected');
      expect(history[0].humanReason).toMatch(/repeated 5 times in a 20-step window/);
    });

    test('clears hash history after handling', async () => {
      const agent = makeAgent({ id: 'agent-loop' });
      agentPool.getAgent.mockResolvedValue(agent);
      scheduler.stateHashHistory.set('agent-loop', [{ hash: 'x', timestamp: Date.now() }]);

      await scheduler.handleRepetitiveLoop('agent-loop', { occurrences: 5, windowSize: 20 });

      expect(scheduler.stateHashHistory.has('agent-loop')).toBe(false);
    });

    test('does nothing when agent not found', async () => {
      agentPool.getAgent.mockResolvedValue(null);
      await scheduler.handleRepetitiveLoop('nonexistent', { occurrences: 5, windowSize: 20 });
      expect(agentPool.persistAgentState).not.toHaveBeenCalled();
    });

    test('broadcasts to websocket if available', async () => {
      // See sibling test — needs mode:'agent' so the flip is a real transition.
      const agent = makeAgent({ id: 'agent-loop', mode: 'agent', sessionId: 'sess-abc' });
      agentPool.getAgent.mockResolvedValue(agent);
      const ws = { broadcastToSession: jest.fn() };
      scheduler.webSocketManager = ws;
      scheduler.agentSessionMap.set('agent-loop', 'sess-abc');

      await scheduler.handleRepetitiveLoop('agent-loop', { occurrences: 5, windowSize: 20 });

      expect(ws.broadcastToSession).toHaveBeenCalled();
    });

    test('clears hash history BEFORE persist/broadcast so a persist error cannot wedge the loop detector', async () => {
      const agent = makeAgent({ id: 'agent-loop' });
      agentPool.getAgent.mockResolvedValue(agent);
      // Seed the history with threshold+ occurrences
      scheduler.stateHashHistory.set('agent-loop', Array(5).fill({ hash: 'H', timestamp: Date.now() }));
      // Force persistAgentState to throw
      agentPool.persistAgentState.mockRejectedValue(new Error('disk full'));

      // Should not re-throw — handler is crash-safe
      await scheduler.handleRepetitiveLoop('agent-loop', { occurrences: 5, windowSize: 20 });

      // History must be cleared even though persist threw.
      expect(scheduler.stateHashHistory.has('agent-loop')).toBe(false);
      // Mode must still be set to chat
      expect(agent.mode).toBe('chat');
    });
  });

  // ─── addMessageToConversation — empty-message drop signal ─────────────
  describe('addMessageToConversation (empty-drop return value)', () => {
    test('returns true when message is appended', async () => {
      const agent = makeAgent();
      agentPool.getAgent.mockResolvedValue(agent);
      const ok = await scheduler.addMessageToConversation(agent.id, { role: 'assistant', content: 'hello' }, false);
      expect(ok).toBe(true);
      expect(agent.conversations.full.messages.length).toBe(1);
    });

    test('returns false when content is empty-string', async () => {
      const agent = makeAgent();
      agentPool.getAgent.mockResolvedValue(agent);
      const ok = await scheduler.addMessageToConversation(agent.id, { role: 'assistant', content: '' }, false);
      expect(ok).toBe(false);
      expect(agent.conversations.full.messages.length).toBe(0);
    });

    test('returns false when content is whitespace-only', async () => {
      const agent = makeAgent();
      agentPool.getAgent.mockResolvedValue(agent);
      const ok = await scheduler.addMessageToConversation(agent.id, { role: 'assistant', content: '   \n  \t' }, false);
      expect(ok).toBe(false);
      expect(agent.conversations.full.messages.length).toBe(0);
    });
  });

  // ─── Empty-response stall circuit breaker ─────────────────────────────
  describe('_trackEmptyResponse + _handleEmptyResponseStall', () => {
    test('records empty responses without polluting stateHashHistory', async () => {
      const agent = makeAgent({ id: 'agent-empty' });
      agentPool.getAgent.mockResolvedValue(agent);

      await scheduler._trackEmptyResponse('agent-empty');
      await scheduler._trackEmptyResponse('agent-empty');
      await scheduler._trackEmptyResponse('agent-empty');

      const entry = scheduler._emptyResponseTracker.get('agent-empty');
      expect(entry.count).toBe(3);
      // Tracker is independent of the hash history
      expect(scheduler.stateHashHistory.has('agent-empty')).toBe(false);
    });

    test('does NOT fire stall handler below threshold', async () => {
      const agent = makeAgent({ id: 'agent-empty' });
      agentPool.getAgent.mockResolvedValue(agent);

      for (let i = 0; i < 4; i++) {
        await scheduler._trackEmptyResponse('agent-empty');
      }

      // Agent mode untouched — stall handler did not fire
      expect(agent.mode).toBe('chat');  // started as chat; unchanged
      expect(scheduler._emptyResponseTracker.has('agent-empty')).toBe(true);
    });

    test('does NOT fire stall handler below time window even at high count', async () => {
      const agent = makeAgent({ id: 'agent-empty', mode: 'agent' });
      agentPool.getAgent.mockResolvedValue(agent);

      // 6 calls in rapid succession — elapsed time < 60s
      for (let i = 0; i < 6; i++) {
        await scheduler._trackEmptyResponse('agent-empty');
      }

      // Stall handler only fires when BOTH count >= threshold AND elapsed >= window
      expect(agent.mode).toBe('agent');
      expect(scheduler._emptyResponseTracker.has('agent-empty')).toBe(true);
    });

    test('fires stall handler when count and time window both satisfied', async () => {
      const agent = makeAgent({ id: 'agent-empty', mode: 'agent' });
      agentPool.getAgent.mockResolvedValue(agent);

      // Seed the tracker with an old firstAt so the time window is already exceeded
      const oldFirstAt = Date.now() - 120 * 1000; // 2 min ago
      scheduler._emptyResponseTracker.set('agent-empty', {
        count: 4,
        firstAt: oldFirstAt,
        lastAt: oldFirstAt,
      });

      await scheduler._trackEmptyResponse('agent-empty'); // count -> 5

      expect(agent.mode).toBe('chat');
      expect(scheduler._emptyResponseTracker.has('agent-empty')).toBe(false);

      // NO chat-transcript bubble — the stall is surfaced via the
      // `agent_mode_changed` broadcast's `humanReason`, not a fake
      // assistant message in the conversation. Previously every stall
      // posted the same "I've switched to chat mode" paragraph into the
      // feed, which operators (reasonably) complained about.
      expect(agent.conversations.full.messages.length).toBe(0);

      // The transition, however, is recorded with count + elapsedSec
      // interpolated into the human reason.
      const history = scheduler._modeTransitionHistory.get('agent-empty');
      expect(history).toHaveLength(1);
      expect(history[0].reasonCode).toBe('empty-response-stall');
      expect(history[0].humanReason).toMatch(/5 empty responses/);
    });

    test('stall handler is crash-safe when persist throws', async () => {
      const agent = makeAgent({ id: 'agent-empty', mode: 'agent' });
      agentPool.getAgent.mockResolvedValue(agent);
      agentPool.persistAgentState.mockRejectedValue(new Error('disk full'));
      scheduler.stateHashHistory.set('agent-empty', [{ hash: 'x', timestamp: Date.now() }]);

      // Trigger the stall directly to avoid fiddling with timing
      await scheduler._handleEmptyResponseStall('agent-empty', {
        count: 5, firstAt: Date.now() - 61000, lastAt: Date.now(),
      });

      // Hash history was cleared BEFORE persist, so even with persist throwing
      // the scheduler cannot re-fire on next cycle.
      expect(scheduler.stateHashHistory.has('agent-empty')).toBe(false);
      // Mode change still applies in-memory
      expect(agent.mode).toBe('chat');
    });
  });

  // ─── clearHashHistory ──────────────────────────────────────────────────
  describe('clearHashHistory', () => {
    test('empties history for agent', () => {
      scheduler.stateHashHistory.set('agent-1', [{ hash: 'x', timestamp: 1 }]);
      scheduler.clearHashHistory('agent-1');
      expect(scheduler.stateHashHistory.get('agent-1')).toEqual([]);
    });

    test('no-op when agent has no history', () => {
      scheduler.clearHashHistory('nonexistent');
      expect(scheduler.stateHashHistory.has('nonexistent')).toBe(false);
    });
  });

  // ─── start / stop ─────────────────────────────────────────────────────
  describe('start / stop lifecycle', () => {
    test('start sets isRunning and creates interval', () => {
      scheduler.start();
      expect(scheduler.isRunning).toBe(true);
      expect(scheduler.scheduleInterval).not.toBeNull();
    });

    test('start is idempotent when already running', () => {
      scheduler.start();
      const firstInterval = scheduler.scheduleInterval;
      scheduler.start();
      expect(scheduler.scheduleInterval).toBe(firstInterval);
    });

    test('stop clears running state and interval', () => {
      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning).toBe(false);
      expect(scheduler.scheduleInterval).toBeNull();
    });

    test('stop clears all tracking maps', () => {
      // Must be running for stop() to execute
      scheduler.isRunning = true;
      scheduler.agentSessionMap.set('a', 's');
      scheduler.stateHashHistory.set('a', []);
      scheduler.agentProcessingLocks.set('a', true);
      scheduler.consecutiveNoToolMessages.set('a', 3);
      scheduler.stop();
      expect(scheduler.agentProcessingLocks.size).toBe(0);
      expect(scheduler.stateHashHistory.size).toBe(0);
      expect(scheduler.consecutiveNoToolMessages.size).toBe(0);
      expect(scheduler.agentSessionMap.size).toBe(0);
    });

    test('stop is a no-op when not running', () => {
      scheduler.stop(); // should not throw
      expect(scheduler.isRunning).toBe(false);
    });
  });

  // ─── addAgent / removeAgent ───────────────────────────────────────────
  describe('addAgent', () => {
    test('registers session ID for agent', async () => {
      await scheduler.addAgent('agent-1', { sessionId: 'sess-abc', triggeredBy: 'user-message' });
      expect(scheduler.getAgentSession('agent-1')).toBe('sess-abc');
    });

    test('clears hash history on user-message trigger', async () => {
      scheduler.stateHashHistory.set('agent-1', [{ hash: 'x', timestamp: 1 }]);
      await scheduler.addAgent('agent-1', { sessionId: 'sess-1', triggeredBy: 'user-message' });
      expect(scheduler.stateHashHistory.get('agent-1')).toEqual([]);
    });

    test('resets no-tool counter on user-message trigger', async () => {
      scheduler.consecutiveNoToolMessages.set('agent-1', 5);
      await scheduler.addAgent('agent-1', { sessionId: 'sess-1', triggeredBy: 'user-message' });
      expect(scheduler.consecutiveNoToolMessages.get('agent-1')).toBe(0);
    });

    test('initializes hash history if not exists', async () => {
      await scheduler.addAgent('agent-new', { sessionId: 'sess-1' });
      expect(scheduler.stateHashHistory.has('agent-new')).toBe(true);
    });

    test('starts scheduler if not running', async () => {
      expect(scheduler.isRunning).toBe(false);
      await scheduler.addAgent('agent-1', { sessionId: 'sess-1' });
      expect(scheduler.isRunning).toBe(true);
    });

    test('warns when no sessionId provided', async () => {
      await scheduler.addAgent('agent-1', { triggeredBy: 'unknown' });
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('removeAgent', () => {
    test('cleans up all tracking for agent', () => {
      scheduler.agentSessionMap.set('agent-1', 'sess-1');
      scheduler.stateHashHistory.set('agent-1', []);
      scheduler.agentProcessingLocks.set('agent-1', true);
      scheduler.consecutiveNoToolMessages.set('agent-1', 3);

      scheduler.removeAgent('agent-1', 'completed');

      expect(scheduler.agentSessionMap.has('agent-1')).toBe(false);
      expect(scheduler.stateHashHistory.has('agent-1')).toBe(false);
      expect(scheduler.agentProcessingLocks.has('agent-1')).toBe(false);
      expect(scheduler.consecutiveNoToolMessages.has('agent-1')).toBe(false);
    });
  });

  // ─── processingCycle ──────────────────────────────────────────────────
  describe('processingCycle', () => {
    test('returns early when no active agents', async () => {
      mockGetActiveAgents.mockReturnValue([]);
      agentPool.getAllAgents.mockResolvedValue([]);
      await scheduler.processingCycle();
      // Should not throw, and no agents processed
    });

    test('skips agents already locked for processing', async () => {
      const agent = makeAgent({ id: 'agent-locked' });
      mockGetActiveAgents.mockReturnValue([{ agentId: 'agent-locked', reason: 'messages' }]);
      agentPool.getAllAgents.mockResolvedValue([agent]);
      scheduler.agentProcessingLocks.set('agent-locked', true);

      await scheduler.processingCycle();
      // Should not process the locked agent
      expect(agentPool.getAgent).not.toHaveBeenCalled();
    });

    test('respects concurrency cap', async () => {
      // Fill up processing locks to max
      scheduler.agentProcessingLocks.set('in-flight-1', true);
      scheduler.agentProcessingLocks.set('in-flight-2', true);
      scheduler.agentProcessingLocks.set('in-flight-3', true);

      mockGetActiveAgents.mockReturnValue([{ agentId: 'agent-new', reason: 'messages' }]);
      agentPool.getAllAgents.mockResolvedValue([makeAgent({ id: 'agent-new' })]);

      await scheduler.processingCycle();
      // With 3 already in-flight and max 3, no new agents should launch
    });
  });

  // ─── registerAgentSession / getAgentSession ────────────────────────────
  describe('session management', () => {
    test('registerAgentSession stores session', () => {
      scheduler.registerAgentSession('a1', 'sess-1');
      expect(scheduler.getAgentSession('a1')).toBe('sess-1');
    });

    test('getAgentSession returns undefined for unregistered', () => {
      expect(scheduler.getAgentSession('unknown')).toBeUndefined();
    });

    test('registerAgentSession ignores null agentId', () => {
      scheduler.registerAgentSession(null, 'sess-1');
      expect(scheduler.agentSessionMap.size).toBe(0);
    });
  });

  // ─── getStatus ─────────────────────────────────────────────────────────
  describe('getStatus', () => {
    test('returns scheduler status with active agents', async () => {
      scheduler.start();
      mockGetActiveAgents.mockReturnValue([
        { agentId: 'a1', reason: 'messages' }
      ]);
      agentPool.getAllAgents.mockResolvedValue([makeAgent({ id: 'a1' })]);

      const status = await scheduler.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.agentCount).toBe(1);
      expect(status.activeAgents[0].agentId).toBe('a1');
    });

    test('returns empty when no active agents', async () => {
      mockGetActiveAgents.mockReturnValue([]);
      agentPool.getAllAgents.mockResolvedValue([]);
      const status = await scheduler.getStatus();
      expect(status.agentCount).toBe(0);
    });
  });

  // ─── stopAgentExecution ───────────────────────────────────────────────
  describe('stopAgentExecution', () => {
    test('stops agent and switches to chat mode', async () => {
      const agent = makeAgent({ id: 'agent-stop', mode: 'agent' });
      agentPool.getAgent.mockResolvedValue(agent);

      const result = await scheduler.stopAgentExecution('agent-stop');
      expect(result.success).toBe(true);
      expect(agent.mode).toBe('chat');
      expect(agent.delayEndTime).toBeNull();
      expect(agentPool.persistAgentState).toHaveBeenCalled();
    });

    test('returns error for non-existent agent', async () => {
      agentPool.getAgent.mockResolvedValue(null);
      const result = await scheduler.stopAgentExecution('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent not found');
    });

    test('aborts active AI request if abortRequest is available', async () => {
      const agent = makeAgent({ id: 'agent-abort' });
      agentPool.getAgent.mockResolvedValue(agent);
      scheduler.aiService = { abortRequest: jest.fn().mockReturnValue(true) };

      await scheduler.stopAgentExecution('agent-abort');
      expect(scheduler.aiService.abortRequest).toHaveBeenCalledWith('agent-abort');
    });
  });

  // ─── isAgentInScheduler ───────────────────────────────────────────────
  describe('isAgentInScheduler', () => {
    test('returns false when agent not found', async () => {
      agentPool.getAgent.mockResolvedValue(null);
      expect(await scheduler.isAgentInScheduler('missing')).toBe(false);
    });

    test('delegates to shouldAgentBeActive', async () => {
      const agent = makeAgent();
      agentPool.getAgent.mockResolvedValue(agent);
      mockShouldAgentBeActive.mockReturnValue({ active: true });
      expect(await scheduler.isAgentInScheduler('agent-test-1')).toBe(true);
    });
  });

  // ─── formatToolResult ─────────────────────────────────────────────────
  describe('formatToolResult', () => {
    test('formats completed object result', () => {
      const result = scheduler.formatToolResult({ toolId: 'fs', status: 'completed', result: { data: 'ok' } });
      expect(result).toContain('[fs]');
      expect(result).toContain('"data"');
    });

    test('formats completed string result', () => {
      const result = scheduler.formatToolResult({ toolId: 'terminal', status: 'completed', result: 'done' });
      expect(result).toContain('[terminal]');
      expect(result).toContain('done');
    });

    test('formats completed with no result', () => {
      const result = scheduler.formatToolResult({ toolId: 'x', status: 'completed', result: null });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('formats failed result', () => {
      const result = scheduler.formatToolResult({ toolId: 'x', status: 'failed', error: 'boom' });
      expect(result).toContain('failed');
      expect(result).toContain('boom');
    });

    test('formats failed without error message', () => {
      const result = scheduler.formatToolResult({ toolId: 'x', status: 'failed' });
      expect(result).toContain('Unknown error');
    });

    test('formats other status with result', () => {
      const result = scheduler.formatToolResult({ toolId: 'x', status: 'warning', result: 'careful' });
      expect(result).toContain('careful');
    });

    test('formats unknown status', () => {
      const result = scheduler.formatToolResult({ toolId: 'x', status: 'unknown' });
      expect(result).toContain('status: unknown');
    });

    test('handles missing toolId gracefully', () => {
      const result = scheduler.formatToolResult({ status: 'completed', result: 'ok' });
      expect(result).toContain('ok');
    });
  });
});
