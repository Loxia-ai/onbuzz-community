/**
 * AgentPool - Comprehensive unit tests (target: 80%+ line coverage)
 * Tests agent lifecycle, state transitions, message queuing, pause/resume,
 * conversation management, directory access, and edge cases.
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig, createMockStateManager } from '../../__test-utils__/mockFactories.js';

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockValidateAccessConfiguration = jest.fn().mockReturnValue({ valid: true });
const mockCreateProjectDefaults = jest.fn().mockReturnValue({
  workingDirectory: '/tmp/project',
  readOnlyDirectories: [],
  writeEnabledDirectories: ['/tmp/project']
});

jest.unstable_mockModule('../../utilities/directoryAccessManager.js', () => {
  const MockDAM = jest.fn().mockImplementation(() => ({
    validateAccessConfiguration: mockValidateAccessConfiguration
  }));
  MockDAM.createProjectDefaults = mockCreateProjectDefaults;
  return { default: MockDAM };
});

jest.unstable_mockModule('../../services/visualEditorBridge.js', () => ({
  getVisualEditorBridge: jest.fn().mockReturnValue({
    hasInstance: jest.fn().mockReturnValue(false),
    stopInstance: jest.fn().mockResolvedValue(undefined)
  })
}));

const { default: AgentPool } = await import('../agentPool.js');

// ── Helpers ──────────────────────────────────────────────────────────────────
function makePool(overrides = {}) {
  const config = createMockConfig(overrides.config);
  const logger = createMockLogger();
  const stateManager = createMockStateManager();
  const contextManager = { getContext: jest.fn() };
  const toolsRegistry = overrides.toolsRegistry || null;
  const pool = new AgentPool(config, logger, stateManager, contextManager, toolsRegistry);
  return { pool, config, logger, stateManager, contextManager };
}

function agentCfg(overrides = {}) {
  return {
    name: 'TestAgent',
    systemPrompt: 'You are a test agent.',
    preferredModel: 'test-model',
    capabilities: [],
    projectDir: '/tmp/project',
    ...overrides
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('AgentPool', () => {
  let pool, logger, stateManager;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ pool, logger, stateManager } = makePool());
  });

  // ─── createAgent ───────────────────────────────────────────────────────
  describe('createAgent', () => {
    test('creates agent with correct default fields', async () => {
      const agent = await pool.createAgent(agentCfg());
      expect(agent.id).toMatch(/^agent-testagent-/);
      expect(agent.name).toBe('TestAgent');
      expect(agent.status).toBe('active');
      expect(agent.mode).toBe('chat');
      expect(agent.preferredModel).toBe('test-model');
      expect(agent.conversations.full.messages).toEqual([]);
      expect(agent.messageQueues.userMessages).toEqual([]);
      expect(agent.messageQueues.interAgentMessages).toEqual([]);
      expect(agent.messageQueues.toolResults).toEqual([]);
      expect(agent.iterationCount).toBe(0);
      expect(agent.maxIterations).toBe(10);
      expect(agent.stopRequested).toBe(false);
      expect(agent.taskList.tasks).toEqual([]);
    });

    test('generates unique IDs for different agents', async () => {
      const a1 = await pool.createAgent(agentCfg({ name: 'Alpha' }));
      const a2 = await pool.createAgent(agentCfg({ name: 'Beta' }));
      expect(a1.id).not.toBe(a2.id);
      expect(a1.id).toMatch(/^agent-alpha-/);
      expect(a2.id).toMatch(/^agent-beta-/);
    });

    test('applies mode from config', async () => {
      const agent = await pool.createAgent(agentCfg({ mode: 'agent' }));
      expect(agent.mode).toBe('agent');
    });

    test('initializes model-specific conversation for preferredModel', async () => {
      const agent = await pool.createAgent(agentCfg({ preferredModel: 'gpt-4' }));
      expect(agent.conversations['gpt-4']).toBeDefined();
      expect(agent.conversations['gpt-4'].messages).toEqual([]);
      expect(agent.conversations['gpt-4'].compactizedMessages).toBeNull();
      expect(agent.conversations['gpt-4'].compactizationCount).toBe(0);
    });

    test('persists agent state after creation', async () => {
      await pool.createAgent(agentCfg());
      expect(stateManager.persistAgentState).toHaveBeenCalled();
    });

    test('enhances system prompt via toolsRegistry when capabilities present', async () => {
      const toolsRegistry = {
        enhanceSystemPrompt: jest.fn().mockReturnValue('enhanced prompt')
      };
      const { pool: p2 } = makePool({ toolsRegistry });
      const agent = await p2.createAgent(agentCfg({ capabilities: ['terminal'] }));
      expect(toolsRegistry.enhanceSystemPrompt).toHaveBeenCalledWith(
        'You are a test agent.',
        ['terminal'],
        expect.objectContaining({ compact: false })
      );
      expect(agent.systemPrompt).toBe('enhanced prompt');
      expect(agent.originalSystemPrompt).toBe('You are a test agent.');
    });

    test('falls back to original prompt when enhancement throws', async () => {
      const toolsRegistry = {
        enhanceSystemPrompt: jest.fn().mockImplementation(() => { throw new Error('boom'); })
      };
      const { pool: p2 } = makePool({ toolsRegistry });
      const agent = await p2.createAgent(agentCfg({ capabilities: ['terminal'] }));
      expect(agent.systemPrompt).toBe('You are a test agent.');
    });

    test('skips enhancement when capabilities is empty', async () => {
      const toolsRegistry = { enhanceSystemPrompt: jest.fn() };
      const { pool: p2 } = makePool({ toolsRegistry });
      await p2.createAgent(agentCfg({ capabilities: [] }));
      expect(toolsRegistry.enhanceSystemPrompt).not.toHaveBeenCalled();
    });

    test('validates directory access configuration when provided', async () => {
      const dirAccess = { workingDirectory: '/custom', readOnlyDirectories: [], writeEnabledDirectories: ['/custom'] };
      const agent = await pool.createAgent(agentCfg({ directoryAccess: dirAccess }));
      expect(mockValidateAccessConfiguration).toHaveBeenCalledWith(dirAccess);
      expect(agent.directoryAccess).toBe(dirAccess);
    });

    test('throws on invalid directory access configuration', async () => {
      mockValidateAccessConfiguration.mockReturnValueOnce({ valid: false, errors: ['bad path'] });
      await expect(pool.createAgent(agentCfg({
        directoryAccess: { workingDirectory: '/bad' }
      }))).rejects.toThrow('Invalid directory access configuration');
    });

    test('creates default directory access when none provided', async () => {
      await pool.createAgent(agentCfg());
      expect(mockCreateProjectDefaults).toHaveBeenCalledWith('/tmp/project');
    });

    test('enforces MAX_AGENTS limit', async () => {
      const { pool: p2 } = makePool({ config: { system: { maxAgentsPerProject: 2 } } });
      await p2.createAgent(agentCfg({ name: 'A1' }));
      await p2.createAgent(agentCfg({ name: 'A2' }));
      await expect(p2.createAgent(agentCfg({ name: 'A3' }))).rejects.toThrow('Maximum agents per project exceeded');
    });

    test('stores sessionId and metadata', async () => {
      const agent = await pool.createAgent(agentCfg({
        sessionId: 'sess-123',
        metadata: { foo: 'bar' },
      }));
      expect(agent.sessionId).toBe('sess-123');
      expect(agent.metadata).toEqual({ foo: 'bar' });
    });

    test('uses process.cwd when no projectDir specified and no directoryAccess', async () => {
      mockCreateProjectDefaults.mockClear();
      await pool.createAgent(agentCfg({ projectDir: undefined }));
      // Should call with process.cwd() as fallback
      expect(mockCreateProjectDefaults).toHaveBeenCalled();
    });
  });

  // ─── getAgent ──────────────────────────────────────────────────────────
  describe('getAgent', () => {
    test('returns agent by ID after creation', async () => {
      const created = await pool.createAgent(agentCfg());
      const found = await pool.getAgent(created.id);
      expect(found).toBe(created);
    });

    test('returns null for non-existent agent', async () => {
      expect(await pool.getAgent('nonexistent')).toBeNull();
    });
  });

  // ─── updateAgent ──────────────────────────────────────────────────────
  describe('updateAgent', () => {
    test('updates fields and preserves ID', async () => {
      const agent = await pool.createAgent(agentCfg());
      const updated = await pool.updateAgent(agent.id, { name: 'Updated', id: 'should-be-ignored' });
      expect(updated.name).toBe('Updated');
      expect(updated.id).toBe(agent.id);
      expect(updated.lastModified).toBeDefined();
    });

    test('throws for non-existent agent', async () => {
      await expect(pool.updateAgent('nonexistent', { name: 'X' })).rejects.toThrow('Agent not found');
    });

    test('persists state after update', async () => {
      const agent = await pool.createAgent(agentCfg());
      stateManager.persistAgentState.mockClear();
      await pool.updateAgent(agent.id, { name: 'Updated' });
      expect(stateManager.persistAgentState).toHaveBeenCalled();
    });

    test('validates directory access in updates', async () => {
      const agent = await pool.createAgent(agentCfg());
      mockValidateAccessConfiguration.mockReturnValueOnce({ valid: false, errors: ['invalid'] });
      await expect(pool.updateAgent(agent.id, {
        directoryAccess: { workingDirectory: '/bad' }
      })).rejects.toThrow('Invalid directory access configuration');
    });

    test('updates currentModel when preferredModel changes and copies conversation', async () => {
      const agent = await pool.createAgent(agentCfg({ preferredModel: 'model-a' }));
      // Add a message to old model conversation
      agent.conversations['model-a'].messages.push({ role: 'user', content: 'old msg' });
      const updated = await pool.updateAgent(agent.id, { preferredModel: 'model-b' });
      expect(updated.currentModel).toBe('model-b');
      expect(updated.conversations['model-b']).toBeDefined();
      // Conversation should have been copied
      expect(updated.conversations['model-b'].messages).toHaveLength(1);
    });

    test('regenerates system prompt when capabilities change', async () => {
      const toolsRegistry = { enhanceSystemPrompt: jest.fn().mockReturnValue('new enhanced') };
      const { pool: p2 } = makePool({ toolsRegistry });
      const agent = await p2.createAgent(agentCfg());
      toolsRegistry.enhanceSystemPrompt.mockClear();
      await p2.updateAgent(agent.id, { capabilities: ['terminal'] });
      expect(toolsRegistry.enhanceSystemPrompt).toHaveBeenCalled();
    });

    test('regenerates system prompt when originalSystemPrompt is updated', async () => {
      const toolsRegistry = { enhanceSystemPrompt: jest.fn().mockReturnValue('re-enhanced') };
      const { pool: p2 } = makePool({ toolsRegistry });
      const agent = await p2.createAgent(agentCfg());
      toolsRegistry.enhanceSystemPrompt.mockClear();
      const updated = await p2.updateAgent(agent.id, { originalSystemPrompt: 'Brand new prompt' });
      expect(toolsRegistry.enhanceSystemPrompt).toHaveBeenCalled();
      expect(updated.originalSystemPrompt).toBe('Brand new prompt');
    });
  });

  // ─── deleteAgent ──────────────────────────────────────────────────────
  describe('deleteAgent', () => {
    test('removes agent from pool and returns success', async () => {
      const agent = await pool.createAgent(agentCfg());
      const result = await pool.deleteAgent(agent.id);
      expect(result.success).toBe(true);
      expect(result.remainingAgents).toBe(0);
      expect(await pool.getAgent(agent.id)).toBeNull();
    });

    test('throws for non-existent agent', async () => {
      await expect(pool.deleteAgent('nonexistent')).rejects.toThrow('Agent not found');
    });

    test('cleans up maps (directory, paused, notification)', async () => {
      const agent = await pool.createAgent(agentCfg());
      pool.pausedAgents.set(agent.id, {});
      pool.notificationQueue.set(agent.id, []);
      await pool.deleteAgent(agent.id);
      expect(pool.pausedAgents.has(agent.id)).toBe(false);
      expect(pool.notificationQueue.has(agent.id)).toBe(false);
      expect(pool.agentDirectory.has(agent.id)).toBe(false);
    });

    test('agent is no longer retrievable after delete', async () => {
      const agent = await pool.createAgent(agentCfg());
      await pool.deleteAgent(agent.id);
      const retrieved = await pool.getAgent(agent.id);
      expect(retrieved).toBeFalsy();
    });
  });

  // ─── unloadAgent ──────────────────────────────────────────────────────
  describe('unloadAgent', () => {
    test('removes from memory but persists state first', async () => {
      const agent = await pool.createAgent(agentCfg());
      stateManager.persistAgentState.mockClear();
      const result = await pool.unloadAgent(agent.id);
      expect(result.success).toBe(true);
      expect(result.agentName).toBe('TestAgent');
      expect(result.message).toContain('unloaded');
      expect(await pool.getAgent(agent.id)).toBeNull();
      expect(stateManager.persistAgentState).toHaveBeenCalled();
    });

    test('throws for non-existent agent', async () => {
      await expect(pool.unloadAgent('nonexistent')).rejects.toThrow('Agent not found');
    });

    test('calls scheduler.removeAgent if scheduler is set', async () => {
      const mockScheduler = { removeAgent: jest.fn() };
      pool.setScheduler(mockScheduler);
      const agent = await pool.createAgent(agentCfg());
      await pool.unloadAgent(agent.id);
      expect(mockScheduler.removeAgent).toHaveBeenCalledWith(agent.id, 'unloaded');
    });
  });

  // ─── pauseAgent / resumeAgent ─────────────────────────────────────────
  describe('pauseAgent', () => {
    test('sets paused status and pausedUntil with seconds duration', async () => {
      const agent = await pool.createAgent(agentCfg());
      const result = await pool.pauseAgent(agent.id, 60, 'test pause');
      expect(result.success).toBe(true);
      expect(agent.status).toBe('paused');
      expect(agent.pausedUntil).toBeDefined();
      expect(pool.pausedAgents.has(agent.id)).toBe(true);
      const pauseInfo = pool.pausedAgents.get(agent.id);
      expect(pauseInfo.reason).toBe('test pause');
    });

    test('accepts Date as duration', async () => {
      const agent = await pool.createAgent(agentCfg());
      const future = new Date(Date.now() + 60000);
      const result = await pool.pauseAgent(agent.id, future);
      expect(result.success).toBe(true);
      expect(new Date(agent.pausedUntil).getTime()).toBe(future.getTime());
    });

    test('caps duration to maxPauseDuration config', async () => {
      const { pool: p2 } = makePool({ config: { system: { maxPauseDuration: 10 } } });
      const agent = await p2.createAgent(agentCfg());
      await p2.pauseAgent(agent.id, 9999, 'long pause');
      const pauseEnd = new Date(agent.pausedUntil).getTime();
      expect(pauseEnd).toBeLessThan(Date.now() + 15000);
    });

    test('throws for non-existent agent', async () => {
      await expect(pool.pauseAgent('nonexistent', 60)).rejects.toThrow('Agent not found');
    });
  });

  describe('resumeAgent (unpause)', () => {
    test('resumes paused agent to active', async () => {
      const agent = await pool.createAgent(agentCfg());
      await pool.pauseAgent(agent.id, 300, 'test');
      const result = await pool.resumeAgent(agent.id);
      expect(result.success).toBe(true);
      expect(agent.status).toBe('active');
      expect(agent.pausedUntil).toBeNull();
      expect(pool.pausedAgents.has(agent.id)).toBe(false);
    });

    test('no-op for non-paused agent', async () => {
      const agent = await pool.createAgent(agentCfg());
      const result = await pool.resumeAgent(agent.id);
      expect(result.success).toBe(true);
      expect(result.message).toContain('not paused');
    });

    test('throws for non-existent agent', async () => {
      await expect(pool.resumeAgent('nonexistent')).rejects.toThrow('Agent not found');
    });
  });

  // ─── Message queue methods ────────────────────────────────────────────
  describe('addUserMessage', () => {
    test('pushes message with generated ID and timestamps', async () => {
      const agent = await pool.createAgent(agentCfg());
      await pool.addUserMessage(agent.id, { content: 'hello', role: 'user' });
      expect(agent.messageQueues.userMessages).toHaveLength(1);
      const msg = agent.messageQueues.userMessages[0];
      expect(msg.content).toBe('hello');
      expect(msg.id).toBeDefined();
      expect(msg.queuedAt).toBeDefined();
    });

    test('auto-creates task for AGENT mode agents', async () => {
      const agent = await pool.createAgent(agentCfg({ mode: 'agent' }));
      await pool.addUserMessage(agent.id, { content: 'do something' });
      expect(agent.taskList.tasks).toHaveLength(1);
      expect(agent.taskList.tasks[0].source).toBe('auto-created');
    });

    test('throws for non-existent agent', async () => {
      await expect(pool.addUserMessage('nonexistent', { content: 'hi' })).rejects.toThrow('Agent not found');
    });

    test('clears a future scheduler-applied delayEndTime on user message', async () => {
      // A user message is an explicit signal to act now — any back-off
      // delay set by the scheduler (rate-limit, network error, builtin
      // tool delay) should evaporate rather than making the user wait
      // out the remainder.
      const agent = await pool.createAgent(agentCfg());
      agent.delayEndTime = new Date(Date.now() + 60_000).toISOString();

      await pool.addUserMessage(agent.id, { content: 'please act now' });

      expect(agent.delayEndTime).toBeNull();
      expect(agent.messageQueues.userMessages).toHaveLength(1);
    });

    test('leaves a past/expired delayEndTime alone', async () => {
      // Already-expired delays don't need clearing — the scheduler ignores
      // them on the next tick anyway. We only act on actively-blocking delays.
      const agent = await pool.createAgent(agentCfg());
      const pastIso = new Date(Date.now() - 1_000).toISOString();
      agent.delayEndTime = pastIso;

      await pool.addUserMessage(agent.id, { content: 'go' });

      expect(agent.delayEndTime).toBe(pastIso);
    });

    test('no-ops when delayEndTime is null', async () => {
      const agent = await pool.createAgent(agentCfg());
      agent.delayEndTime = null;

      await pool.addUserMessage(agent.id, { content: 'go' });

      expect(agent.delayEndTime).toBeNull();
    });

    test('broadcasts agent state update when a delay was cleared', async () => {
      // The UI's delay chip listens for `agent_state_updated` — when we
      // clear a delay we should surface it immediately so the chip
      // disappears without a reload.
      const agent = await pool.createAgent(agentCfg());
      agent.delayEndTime = new Date(Date.now() + 30_000).toISOString();

      const broadcast = jest.fn().mockResolvedValue(undefined);
      pool.scheduler = { broadcastAgentStateUpdate: broadcast };

      await pool.addUserMessage(agent.id, { content: 'now' });

      expect(broadcast).toHaveBeenCalledWith(agent.id, 'user-message-clears-delay');
    });

    test('does not broadcast when no delay was set', async () => {
      const agent = await pool.createAgent(agentCfg());
      const broadcast = jest.fn().mockResolvedValue(undefined);
      pool.scheduler = { broadcastAgentStateUpdate: broadcast };

      await pool.addUserMessage(agent.id, { content: 'hi' });

      expect(broadcast).not.toHaveBeenCalled();
    });
  });

  describe('addInterAgentMessage', () => {
    test('pushes message with sender info', async () => {
      const agent = await pool.createAgent(agentCfg());
      await pool.addInterAgentMessage(agent.id, { content: 'inter-msg', sender: 'agent-x', senderName: 'AgentX' });
      expect(agent.messageQueues.interAgentMessages).toHaveLength(1);
      expect(agent.messageQueues.interAgentMessages[0].content).toBe('inter-msg');
    });

    test('auto-creates task for AGENT mode agents with sender label', async () => {
      const agent = await pool.createAgent(agentCfg({ mode: 'agent' }));
      await pool.addInterAgentMessage(agent.id, { content: 'help', sender: 'other', senderName: 'OtherAgent' });
      expect(agent.taskList.tasks).toHaveLength(1);
      expect(agent.taskList.tasks[0].title).toContain('inter-agent');
    });

    test('throws for non-existent agent', async () => {
      await expect(pool.addInterAgentMessage('nonexistent', { content: 'hi' })).rejects.toThrow('Agent not found');
    });
  });

  describe('addToolResult', () => {
    test('pushes result with generated ID and timestamps', async () => {
      const agent = await pool.createAgent(agentCfg());
      await pool.addToolResult(agent.id, { toolId: 'terminal', status: 'completed', result: 'ok' });
      expect(agent.messageQueues.toolResults).toHaveLength(1);
      const r = agent.messageQueues.toolResults[0];
      expect(r.toolId).toBe('terminal');
      expect(r.id).toBeDefined();
      expect(r.queuedAt).toBeDefined();
    });

    test('throws for non-existent agent', async () => {
      await expect(pool.addToolResult('nonexistent', {})).rejects.toThrow('Agent not found');
    });
  });

  // ─── clearConversation ────────────────────────────────────────────────
  describe('clearConversation', () => {
    test('empties all conversation history, queues, and task list', async () => {
      const agent = await pool.createAgent(agentCfg());
      agent.conversations.full.messages.push({ role: 'user', content: 'old' });
      agent.messageQueues.userMessages.push({ content: 'queued' });
      agent.messageQueues.toolResults.push({ toolId: 'x' });
      agent.messageQueues.interAgentMessages.push({ content: 'inter' });
      agent.taskList.tasks.push({ id: 'task1', title: 'do thing' });

      const result = await pool.clearConversation(agent.id);
      expect(result.success).toBe(true);
      expect(result.previousMessageCount).toBe(1);
      expect(agent.conversations.full.messages).toEqual([]);
      expect(agent.messageQueues.userMessages).toEqual([]);
      expect(agent.messageQueues.toolResults).toEqual([]);
      expect(agent.messageQueues.interAgentMessages).toEqual([]);
      expect(agent.taskList.tasks).toEqual([]);
      expect(agent.currentTask).toBeNull();
      expect(agent.iterationCount).toBe(0);
    });

    test('resets model-specific conversations', async () => {
      const agent = await pool.createAgent(agentCfg({ preferredModel: 'model-a' }));
      agent.conversations['model-a'].messages.push({ role: 'user', content: 'msg' });
      await pool.clearConversation(agent.id);
      expect(agent.conversations['model-a'].messages).toEqual([]);
      expect(agent.conversations['model-a'].compactizedMessages).toBeNull();
    });

    test('throws for non-existent agent', async () => {
      await expect(pool.clearConversation('nonexistent')).rejects.toThrow('Agent not found');
    });
  });

  // ─── listActiveAgents / getAllAgents ───────────────────────────────────
  describe('listActiveAgents', () => {
    test('returns shaped array of all agents', async () => {
      await pool.createAgent(agentCfg({ name: 'A1' }));
      await pool.createAgent(agentCfg({ name: 'A2' }));
      const list = await pool.listActiveAgents();
      expect(list).toHaveLength(2);
      expect(list[0]).toHaveProperty('id');
      expect(list[0]).toHaveProperty('name');
      expect(list[0]).toHaveProperty('mode');
      expect(list[0]).toHaveProperty('capabilities');
      expect(list[0]).toHaveProperty('isPaused');
      expect(list[0]).toHaveProperty('messageCount');
    });
  });

  describe('getAllAgents', () => {
    test('returns all agents and auto-resumes expired pauses', async () => {
      const agent = await pool.createAgent(agentCfg());
      agent.status = 'paused';
      agent.pausedUntil = new Date(Date.now() - 1000).toISOString();
      const all = await pool.getAllAgents();
      const found = all.find(a => a.id === agent.id);
      expect(found.status).toBe('active');
      expect(found.pausedUntil).toBeNull();
    });
  });

  // ─── persistAgentState ────────────────────────────────────────────────
  describe('persistAgentState', () => {
    test('delegates to stateManager with agent object', async () => {
      const agent = await pool.createAgent(agentCfg());
      stateManager.persistAgentState.mockClear();
      await pool.persistAgentState(agent.id);
      expect(stateManager.persistAgentState).toHaveBeenCalledWith(agent);
    });

    test('throws for non-existent agent', async () => {
      await expect(pool.persistAgentState('nonexistent')).rejects.toThrow('Agent not found');
    });
  });

  // ─── Private helpers ──────────────────────────────────────────────────
  describe('private helpers', () => {
    test('_generateAgentId sanitizes name', () => {
      const id = pool._generateAgentId('Hello World!');
      expect(id).toMatch(/^agent-hello-world--\d+$/);
    });

    test('_isAgentPaused returns false for active agent', () => {
      expect(pool._isAgentPaused({ status: 'active', pausedUntil: null })).toBe(false);
    });

    test('_isAgentPaused returns true for future pause', () => {
      const future = new Date(Date.now() + 60000).toISOString();
      expect(pool._isAgentPaused({ status: 'paused', pausedUntil: future })).toBe(true);
    });

    test('_isAgentPaused returns false for expired pause', () => {
      const past = new Date(Date.now() - 60000).toISOString();
      expect(pool._isAgentPaused({ status: 'paused', pausedUntil: past })).toBe(false);
    });

    test('_isPauseExpired returns true when no pausedUntil', () => {
      expect(pool._isPauseExpired({})).toBe(true);
    });

    test('_isPauseExpired returns false when future pause', () => {
      const future = new Date(Date.now() + 60000).toISOString();
      expect(pool._isPauseExpired({ pausedUntil: future })).toBe(false);
    });

    test('_getFirstUserMessageSnippet returns null for empty conversations', () => {
      const agent = { conversations: { full: { messages: [] } } };
      expect(pool._getFirstUserMessageSnippet(agent)).toBeNull();
    });

    test('_getFirstUserMessageSnippet returns snippet for first user message', () => {
      const agent = {
        conversations: { full: { messages: [
          { role: 'assistant', content: 'hi' },
          { role: 'user', content: 'Build me a web app', type: 'consolidated-input' }
        ] } }
      };
      expect(pool._getFirstUserMessageSnippet(agent)).toBe('Build me a web app');
    });

    test('_getFirstUserMessageSnippet truncates long snippets', () => {
      const longMsg = 'A'.repeat(200);
      const agent = {
        conversations: { full: { messages: [
          { role: 'user', content: longMsg }
        ] } }
      };
      const snippet = pool._getFirstUserMessageSnippet(agent);
      expect(snippet.length).toBeLessThanOrEqual(120);
      expect(snippet).toContain('...');
    });

    test('_queueNotification stores notification for agent', () => {
      pool._queueNotification('agent-1', { content: 'test' });
      expect(pool.notificationQueue.has('agent-1')).toBe(true);
      expect(pool.notificationQueue.get('agent-1')).toHaveLength(1);
    });

    test('_generateAgentDescription includes capabilities', () => {
      const desc = pool._generateAgentDescription({ name: 'Bot', type: 'user-created', capabilities: ['terminal', 'filesystem'] });
      expect(desc).toContain('Bot');
      expect(desc).toContain('terminal');
    });
  });

  // ─── setters ──────────────────────────────────────────────────────────
  describe('setter methods', () => {
    test('setToolsRegistry stores the registry', () => {
      const registry = { getTool: jest.fn() };
      pool.setToolsRegistry(registry);
      expect(pool.toolsRegistry).toBe(registry);
    });

    test('setMessageProcessor stores the reference', () => {
      const mp = { processMessage: jest.fn() };
      pool.setMessageProcessor(mp);
      expect(pool.messageProcessor).toBe(mp);
    });

    test('setScheduler stores the scheduler reference', () => {
      const sched = { addAgent: jest.fn() };
      pool.setScheduler(sched);
      expect(pool.scheduler).toBe(sched);
    });
  });
});
