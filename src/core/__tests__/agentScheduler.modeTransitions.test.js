/**
 * Tests for the mode-transition history surface on AgentScheduler.
 *
 * The scheduler owns the ring buffer (`_modeTransitionHistory`) and exposes
 * two entry points:
 *
 *   - `recordModeTransition(agentId, from, to, reasonCode, detail)`
 *     Bookkeeping only — no mutation, no persist, no broadcast. Called by
 *     agentPool.updateAgent when an external flip happens (UI toggle, etc.).
 *
 *   - `_transitionMode(agentId, to, reasonCode, detail)`
 *     End-to-end — mutates agent.mode, pushes transcript message (if any),
 *     persists via agentPool, broadcasts two events. Used by the scheduler's
 *     own protective flips (user stop, AI timeout, empty stall, loop).
 *
 * Tests exercise both without a real agent pool — a minimal mock pool is
 * plenty to lock the contract. The point here is "bookkeeping correctness
 * and broadcast shape", not agent lifecycle.
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';
import AgentScheduler from '../agentScheduler.js';
import { AGENT_MODES } from '../../utilities/constants.js';

function makeScheduler(opts = {}) {
  const broadcastToSession = jest.fn();
  const webSocketManager = { broadcastToSession };
  const persistAgentState = jest.fn().mockResolvedValue(undefined);
  const broadcastAgentStateUpdate = jest.fn().mockResolvedValue(undefined);
  const agent = opts.agent || {
    id: 'a1', name: 'A', mode: AGENT_MODES.AGENT,
    sessionId: 's1', conversations: { full: { messages: [] } },
  };
  const agentPool = {
    getAgent: jest.fn().mockImplementation(id => Promise.resolve(id === agent.id ? agent : null)),
    getAllAgents: jest.fn().mockResolvedValue([agent]),
    persistAgentState,
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
  // Actual constructor signature: (agentPool, messageProcessor, aiService, logger, webSocketManager, ...)
  const scheduler = new AgentScheduler(agentPool, messageProcessor, aiService,
    createMockLogger(), webSocketManager);
  // broadcastAgentStateUpdate is a real method on the scheduler that does UI
  // broadcasts — stub it so tests can focus on the agent_mode_changed event
  // shape without caring about the canonical-state event's wiring.
  scheduler.broadcastAgentStateUpdate = broadcastAgentStateUpdate;
  // Pretend we have a session map so the broadcast finds a target.
  scheduler.registerAgentSession(agent.id, agent.sessionId);
  return { scheduler, agent, agentPool, webSocketManager, broadcastToSession,
           persistAgentState, broadcastAgentStateUpdate };
}

describe('AgentScheduler.recordModeTransition', () => {
  test('appends an entry with timestamp + human reason', () => {
    const { scheduler } = makeScheduler();
    scheduler.recordModeTransition('a1', 'agent', 'chat', 'user-stop');

    const history = scheduler._modeTransitionHistory.get('a1');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      from: 'agent',
      to: 'chat',
      reasonCode: 'user-stop',
      humanReason: 'Stopped by user.',
    });
    expect(new Date(history[0].at).getTime()).not.toBeNaN();
  });

  test('interpolates detail into the human reason', () => {
    const { scheduler } = makeScheduler();
    scheduler.recordModeTransition('a1', 'agent', 'chat', 'empty-response-stall',
      { count: 5, elapsedSec: 57 });

    const entry = scheduler._modeTransitionHistory.get('a1')[0];
    expect(entry.humanReason).toBe(
      'The model returned 5 empty responses in a row over 57s — likely rate-limited, misconfigured, or rejecting the conversation. Switched to Guided Chat.'
    );
    expect(entry.detail).toEqual({ count: 5, elapsedSec: 57 });
  });

  test('no-op when from === to (prevents phantom same-mode entries)', () => {
    const { scheduler } = makeScheduler();
    scheduler.recordModeTransition('a1', 'chat', 'chat', 'user-toggle');
    expect(scheduler._modeTransitionHistory.get('a1')).toBeUndefined();
  });

  test('no-op when agentId is missing', () => {
    const { scheduler } = makeScheduler();
    scheduler.recordModeTransition('', 'agent', 'chat', 'user-stop');
    scheduler.recordModeTransition(null, 'agent', 'chat', 'user-stop');
    expect(scheduler._modeTransitionHistory.size).toBe(0);
  });

  test('ring buffer trims to MAX_PER_AGENT', () => {
    const { scheduler } = makeScheduler();
    const MAX = scheduler._MODE_TRANSITION_HISTORY_MAX_PER_AGENT;
    for (let i = 0; i < MAX + 10; i++) {
      // Alternate direction so from !== to every time.
      scheduler.recordModeTransition('a1',
        i % 2 === 0 ? 'agent' : 'chat',
        i % 2 === 0 ? 'chat' : 'agent',
        'user-toggle');
    }
    expect(scheduler._modeTransitionHistory.get('a1')).toHaveLength(MAX);
  });

  test('stores null detail when none provided (avoids empty-object noise)', () => {
    const { scheduler } = makeScheduler();
    scheduler.recordModeTransition('a1', 'agent', 'chat', 'user-stop');
    expect(scheduler._modeTransitionHistory.get('a1')[0].detail).toBeNull();
  });

  test('unknown reason codes still produce a readable humanReason (no bare symbol)', () => {
    const { scheduler } = makeScheduler();
    scheduler.recordModeTransition('a1', 'agent', 'chat', 'some-future-code');
    const entry = scheduler._modeTransitionHistory.get('a1')[0];
    expect(entry.humanReason).toBe('Mode change (some future code).');
  });
});

describe('AgentScheduler._transitionMode', () => {
  test('mutates agent.mode, records transition, persists, and broadcasts', async () => {
    const { scheduler, agent, persistAgentState, broadcastToSession,
            broadcastAgentStateUpdate } = makeScheduler();

    const changed = await scheduler._transitionMode('a1', AGENT_MODES.CHAT, 'user-stop');

    expect(changed).toBe(true);
    expect(agent.mode).toBe(AGENT_MODES.CHAT);
    expect(persistAgentState).toHaveBeenCalledWith('a1');
    expect(broadcastAgentStateUpdate).toHaveBeenCalledWith('a1', 'user-stop');

    // Find the agent_mode_changed broadcast
    const modeEvent = broadcastToSession.mock.calls
      .find(c => c[1].type === 'agent_mode_changed');
    expect(modeEvent).toBeDefined();
    expect(modeEvent[1].data).toMatchObject({
      agentId: 'a1',
      mode: AGENT_MODES.CHAT,
      reason: 'user-stop',                      // back-compat symbolic
      humanReason: 'Stopped by user.',          // new natural-language field
    });

    // Ring buffer records the flip
    expect(scheduler._modeTransitionHistory.get('a1')).toHaveLength(1);
  });

  test('transcriptMessage is pushed into conversations.full and broadcast as message_added', async () => {
    const { scheduler, agent, broadcastToSession } = makeScheduler();

    const msg = {
      id: 'm-1', role: 'assistant', content: 'Stalled.',
      timestamp: new Date().toISOString(),
    };
    await scheduler._transitionMode('a1', AGENT_MODES.CHAT, 'empty-response-stall',
      { count: 5, elapsedSec: 57, transcriptMessage: msg });

    // Conversation got the bubble
    expect(agent.conversations.full.messages).toHaveLength(1);
    expect(agent.conversations.full.messages[0].id).toBe('m-1');

    // transcriptMessage was excluded from the saved detail
    const entry = scheduler._modeTransitionHistory.get('a1')[0];
    expect(entry.detail).toEqual({ count: 5, elapsedSec: 57 });
    expect(entry.detail.transcriptMessage).toBeUndefined();

    // message_added broadcast fired
    const msgEvent = broadcastToSession.mock.calls
      .find(c => c[1].type === 'message_added');
    expect(msgEvent).toBeDefined();
    expect(msgEvent[1].data.message.id).toBe('m-1');
    expect(msgEvent[1].data.type).toBe('empty-response-stall');
  });

  test('no-op (returns false) when agent is already in the target mode', async () => {
    const { scheduler, persistAgentState } = makeScheduler();
    const changed = await scheduler._transitionMode('a1', AGENT_MODES.AGENT, 'user-toggle');
    expect(changed).toBe(false);
    expect(persistAgentState).not.toHaveBeenCalled();
    expect(scheduler._modeTransitionHistory.size).toBe(0);
  });

  test('returns false when agent does not exist', async () => {
    const { scheduler, persistAgentState } = makeScheduler();
    const changed = await scheduler._transitionMode('nonexistent', AGENT_MODES.CHAT, 'user-stop');
    expect(changed).toBe(false);
    expect(persistAgentState).not.toHaveBeenCalled();
  });

  test('persistence failure does NOT crash the flip (mode still mutated)', async () => {
    const { scheduler, agent, persistAgentState } = makeScheduler();
    persistAgentState.mockRejectedValueOnce(new Error('disk full'));

    const changed = await scheduler._transitionMode('a1', AGENT_MODES.CHAT, 'user-stop');
    expect(changed).toBe(true);
    expect(agent.mode).toBe(AGENT_MODES.CHAT);
    expect(scheduler._modeTransitionHistory.get('a1')).toHaveLength(1);
  });
});

describe('AgentScheduler.getState — surfaces modeTransitions per agent', () => {
  test('agent row includes the last N transitions', async () => {
    const { scheduler } = makeScheduler();
    scheduler.recordModeTransition('a1', 'agent', 'chat', 'empty-response-stall',
      { count: 5, elapsedSec: 57 });
    scheduler.recordModeTransition('a1', 'chat', 'agent', 'user-toggle');

    const state = await scheduler.getState();
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0].modeTransitions).toHaveLength(2);
    expect(state.agents[0].modeTransitions[0].reasonCode).toBe('empty-response-stall');
    expect(state.agents[0].modeTransitions[1].reasonCode).toBe('user-toggle');
    // humanReason is already interpolated — the frontend can render verbatim
    expect(state.agents[0].modeTransitions[0].humanReason).toContain('5 empty responses');
  });

  test('agent with no transitions reports an empty array (not undefined)', async () => {
    const { scheduler } = makeScheduler();
    const state = await scheduler.getState();
    expect(state.agents[0].modeTransitions).toEqual([]);
  });
});
