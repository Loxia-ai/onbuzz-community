import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig, createMockAiService, createMockStateManager, createMockAgentPool } from '../../__test-utils__/mockFactories.js';

// Mock constants so the module loads without side effects
jest.unstable_mockModule('../../utilities/constants.js', () => ({
  INTERFACE_TYPES: { CLI: 'cli', WEB: 'web', VSCODE: 'vscode' },
  AGENT_TYPES: { USER_CREATED: 'user-created', SYSTEM_AGENT: 'system-agent' },
  AGENT_STATUS: { ACTIVE: 'active', IDLE: 'idle', BUSY: 'busy', PAUSED: 'paused', ERROR: 'error' },
  MESSAGE_MODES: { CHAT: 'chat', AGENT: 'agent' },
  ORCHESTRATOR_ACTIONS: {
    CREATE_AGENT: 'create_agent',
    UPDATE_AGENT: 'update_agent',
    DELETE_AGENT: 'delete_agent',
    UNLOAD_AGENT: 'unload_agent',
    SEND_MESSAGE: 'send_message',
    LIST_AGENTS: 'list_agents',
    RESUME_SESSION: 'resume_session',
    GET_SESSION_STATE: 'get_session_state',
    PAUSE_AGENT: 'pause_agent',
    RESUME_AGENT: 'resume_agent',
    SWITCH_MODEL: 'switch_model',
    GET_AGENT_STATUS: 'get_agent_status',
    GET_AGENT_CONVERSATIONS: 'get_agent_conversations'
  },
  SYSTEM_DEFAULTS: {}
}));

const { default: Orchestrator } = await import('../orchestrator.js');

describe('Orchestrator', () => {
  let orchestrator;
  let mockConfig;
  let mockLogger;
  let mockAgentPool;
  let mockMessageProcessor;
  let mockAiService;
  let mockStateManager;

  const makeRequest = (overrides = {}) => ({
    interface: 'web',
    sessionId: 'session-1',
    action: 'send_message',
    payload: {},
    projectDir: '/test/project',
    ...overrides
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = createMockConfig();
    mockLogger = createMockLogger();
    mockAiService = createMockAiService();
    mockStateManager = createMockStateManager();
    mockAgentPool = createMockAgentPool();

    // Add methods Orchestrator actually calls
    mockAgentPool.listActiveAgents = jest.fn().mockResolvedValue([]);
    mockAgentPool.pauseAgent = jest.fn().mockResolvedValue({ success: true });
    mockAgentPool.resumeAgent = jest.fn().mockResolvedValue({ success: true });
    mockAgentPool.restoreAgent = jest.fn().mockResolvedValue(undefined);
    mockAgentPool.deleteAgent = jest.fn().mockResolvedValue({ success: true });
    mockAgentPool.unloadAgent = jest.fn().mockResolvedValue({ success: true });

    mockMessageProcessor = {
      processMessage: jest.fn().mockResolvedValue({
        success: true,
        agentId: 'agent-1',
        queuedAt: new Date().toISOString()
      })
    };

    orchestrator = new Orchestrator(
      mockConfig,
      mockLogger,
      mockAgentPool,
      mockMessageProcessor,
      mockAiService,
      mockStateManager
    );
  });

  // ───── Cross-component wiring (regression locks) ─────

  describe('toolsRegistry exposure', () => {
    // Background: webServer's FlowExecutor init reads `this.orchestrator?.toolsRegistry`
    // (webServer.js:574) to find the JobDoneTool singleton and call
    // setFlowExecutor on it. Without that wiring, JobDoneTool's
    // Phase 8 contract validation silently no-ops because
    // `this.flowExecutor` stays undefined, and partial job-done calls
    // fall through to the legacy pendingTasks rejection path. The fix
    // is `index.js` setting `this.orchestrator.toolsRegistry =
    // this.toolsRegistry` after the orchestrator is constructed.
    // This test locks that contract: orchestrator must accept and
    // expose a toolsRegistry assignment so the webServer lookup works.

    test('exposes toolsRegistry after external assignment', () => {
      const fakeRegistry = {
        getTool: jest.fn().mockReturnValue({
          setFlowExecutor: jest.fn(),
        }),
      };
      orchestrator.toolsRegistry = fakeRegistry;

      // Simulate the webServer lookup at webServer.js:574
      const found = orchestrator?.toolsRegistry?.getTool?.('jobdone');
      expect(found).toBeDefined();
      expect(typeof found.setFlowExecutor).toBe('function');
      expect(orchestrator.toolsRegistry).toBe(fakeRegistry);
    });

    test('toolsRegistry lookup yields undefined when not wired (smoke)', () => {
      // If a future refactor breaks the wiring, this lookup pattern
      // returns undefined — which is exactly the failure mode that
      // caused Phase 8 to silently no-op for an entire process lifetime.
      // Keeping this assertion makes the failure mode visible.
      expect(orchestrator.toolsRegistry).toBeUndefined();
    });
  });

  // ───── Request Routing ─────

  describe('processRequest routing', () => {
    test('CREATE_AGENT action delegates to createAgent', async () => {
      const createdAgent = { id: 'new-1', name: 'Builder', preferredModel: 'gpt-4' };
      mockAgentPool.createAgent.mockResolvedValue(createdAgent);

      const response = await orchestrator.processRequest(makeRequest({
        action: 'create_agent',
        payload: { name: 'Builder', systemPrompt: 'You build things', model: 'gpt-4' }
      }));

      expect(response.success).toBe(true);
      expect(response.data.id).toBe('new-1');
      expect(mockAgentPool.createAgent).toHaveBeenCalledTimes(1);
    });

    test('SEND_MESSAGE action delegates to routeToAgent', async () => {
      const agent = {
        id: 'agent-1', name: 'Agent', status: 'active',
        currentModel: 'gpt-4', mode: 'chat'
      };
      mockAgentPool._agents.set('agent-1', agent);
      mockAgentPool.getAgent.mockImplementation((id) => mockAgentPool._agents.get(id));

      const response = await orchestrator.processRequest(makeRequest({
        action: 'send_message',
        payload: { agentId: 'agent-1', message: 'Hello agent' }
      }));

      expect(response.success).toBe(true);
      expect(mockMessageProcessor.processMessage).toHaveBeenCalledWith(
        'agent-1', 'Hello agent', expect.objectContaining({ sessionId: 'session-1' })
      );
    });

    test('LIST_AGENTS action returns agent list', async () => {
      const agents = [{ id: 'a1', name: 'Alpha' }, { id: 'a2', name: 'Beta' }];
      mockAgentPool.listActiveAgents.mockResolvedValue(agents);

      const response = await orchestrator.processRequest(makeRequest({
        action: 'list_agents',
        payload: {}
      }));

      expect(response.success).toBe(true);
      expect(response.data).toEqual(agents);
    });

    test('unknown action returns error response', async () => {
      const response = await orchestrator.processRequest(makeRequest({
        action: 'totally_invalid_action',
        payload: {}
      }));

      expect(response.success).toBe(false);
      expect(response.error).toContain('Unknown action');
    });

    test('response includes metadata with timestamp, executionTime, sessionId', async () => {
      mockAgentPool.listActiveAgents.mockResolvedValue([]);

      const response = await orchestrator.processRequest(makeRequest({
        action: 'list_agents',
        payload: {}
      }));

      expect(response.metadata).toBeDefined();
      expect(response.metadata.timestamp).toBeDefined();
      expect(typeof response.metadata.executionTime).toBe('number');
      expect(response.metadata.sessionId).toBe('session-1');
    });
  });

  // ───── Session Management ─────

  describe('session management', () => {
    test('_ensureSession creates new session on first call', async () => {
      expect(orchestrator.activeSessions.size).toBe(0);

      await orchestrator._ensureSession('s-new', '/project');

      expect(orchestrator.activeSessions.has('s-new')).toBe(true);
      const session = orchestrator.activeSessions.get('s-new');
      expect(session.projectDir).toBe('/project');
      expect(session.createdAt).toBeDefined();
    });

    test('_ensureSession reuses existing session on subsequent calls', async () => {
      await orchestrator._ensureSession('s-reuse', '/project');
      const firstCreated = orchestrator.activeSessions.get('s-reuse').createdAt;

      // Small delay to differentiate timestamps
      await new Promise(r => setTimeout(r, 5));
      await orchestrator._ensureSession('s-reuse', '/project');

      expect(orchestrator.activeSessions.size).toBe(1);
      // createdAt should remain unchanged
      expect(orchestrator.activeSessions.get('s-reuse').createdAt).toBe(firstCreated);
    });
  });

  // ───── Agent Operations ─────

  describe('agent operations', () => {
    test('routeToAgent with valid agent returns queued response', async () => {
      const agent = { id: 'agent-1', name: 'Bot', status: 'active', currentModel: 'gpt-4' };
      mockAgentPool.getAgent.mockResolvedValue(agent);

      const result = await orchestrator.routeToAgent('agent-1', 'Do something', { sessionId: 's1' });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('queued');
      expect(result.data.agentId).toBe('agent-1');
    });

    // REGRESSION: A user message must ALWAYS override pause/delay state.
    // The orchestrator used to short-circuit with a "paused" error here,
    // which bypassed agentPool._wakeAgentForMessage and left the agent
    // napping while the user saw a toast and waited. Now routeToAgent
    // forwards unconditionally to messageProcessor; the wake helper in
    // addUserMessage flips the agent back to active and queues the msg.
    // See orchestrator.js: the pre-flight PAUSED check is intentionally
    // absent.
    test('routeToAgent with paused agent STILL queues the message (wake-on-message wins)', async () => {
      const futureDate = new Date(Date.now() + 60_000).toISOString();
      const agent = { id: 'agent-1', name: 'Bot', status: 'paused', pausedUntil: futureDate, currentModel: 'gpt-4' };
      mockAgentPool.getAgent.mockResolvedValue(agent);

      const result = await orchestrator.routeToAgent('agent-1', 'Wake up', { sessionId: 's1' });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('queued');
      // messageProcessor got the message — the wake is handled inside
      // addUserMessage, not at the orchestrator layer.
      expect(mockMessageProcessor.processMessage).toHaveBeenCalledWith(
        'agent-1',
        'Wake up',
        expect.objectContaining({ sessionId: 's1' })
      );
    });

    test('createAgent delegates to agentPool.createAgent', async () => {
      const created = { id: 'new-a', name: 'Fresh', preferredModel: 'claude-3' };
      mockAgentPool.createAgent.mockResolvedValue(created);

      const result = await orchestrator.createAgent('You are helpful', 'claude-3', { name: 'Fresh' });

      expect(result.id).toBe('new-a');
      expect(mockAgentPool.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Fresh',
          systemPrompt: 'You are helpful',
          preferredModel: 'claude-3'
        })
      );
    });
  });

  // ───── Error Handling ─────

  describe('error handling', () => {
    test('processRequest catches errors and returns error response', async () => {
      mockAgentPool.listActiveAgents.mockRejectedValue(new Error('pool exploded'));

      const response = await orchestrator.processRequest(makeRequest({
        action: 'list_agents',
        payload: {}
      }));

      expect(response.success).toBe(false);
      expect(response.error).toBe('pool exploded');
      expect(response.metadata.timestamp).toBeDefined();
    });

    test('shutdown persists all agents and clears sessions', async () => {
      const agents = [{ id: 'a1' }, { id: 'a2' }];
      mockAgentPool.listActiveAgents.mockResolvedValue(agents);

      // Pre-populate a session
      orchestrator.activeSessions.set('s1', { id: 's1' });

      await orchestrator.shutdown();

      expect(mockStateManager.persistAgentState).toHaveBeenCalledTimes(2);
      expect(mockStateManager.persistAgentState).toHaveBeenCalledWith('a1');
      expect(mockStateManager.persistAgentState).toHaveBeenCalledWith('a2');
      expect(orchestrator.activeSessions.size).toBe(0);
    });
  });
});
