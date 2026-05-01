/**
 * Shared mock factories for unit tests.
 * Import these to avoid repeating mock construction across test files.
 */
import { jest } from '@jest/globals';

/** Standard mock logger matching Logger interface */
export function createMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logAgentActivity: jest.fn(),
    logToolExecution: jest.fn(),
    logSystemEvent: jest.fn(),
    logApiRequest: jest.fn(),
    child: jest.fn().mockReturnThis()
  };
}

/** Standard mock config with sensible defaults */
export function createMockConfig(overrides = {}) {
  return {
    apiKeys: { anthropic: 'test-key-fake' },
    models: {},
    tools: {},
    system: {
      maxAgentsPerProject: 10,
      stateDirectory: '.loxia-state',
      maxContextSize: 200000
    },
    ...overrides
  };
}

/** Mock AI service */
export function createMockAiService() {
  return {
    sendMessage: jest.fn().mockResolvedValue({
      content: 'mock response',
      tokenUsage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    }),
    getAvailableModels: jest.fn().mockReturnValue([]),
    initialize: jest.fn().mockResolvedValue(undefined)
  };
}

/** Mock state manager */
export function createMockStateManager() {
  const store = new Map();
  return {
    getState: jest.fn((key) => store.get(key)),
    setState: jest.fn((key, value) => store.set(key, value)),
    deleteState: jest.fn((key) => store.delete(key)),
    listStates: jest.fn(() => [...store.keys()]),
    initialize: jest.fn().mockResolvedValue(undefined),
    initializeStateDirectory: jest.fn().mockResolvedValue(undefined),
    persistAgentState: jest.fn().mockResolvedValue(undefined),
    getProjectState: jest.fn().mockResolvedValue({}),
    loadProjectState: jest.fn().mockResolvedValue({}),
    saveProjectState: jest.fn().mockResolvedValue(undefined),
    loadAgentIndex: jest.fn().mockResolvedValue({}),
    updateAgentIndex: jest.fn().mockResolvedValue(undefined),
    getStateDir: jest.fn().mockReturnValue('/tmp/test-state'),
    getAgentsDir: jest.fn().mockReturnValue('/tmp/test-state/agents'),
    resumeProject: jest.fn().mockResolvedValue({}),
    _store: store
  };
}

/** Mock agent pool */
export function createMockAgentPool() {
  const agents = new Map();
  return {
    getAgent: jest.fn((id) => agents.get(id)),
    getAllAgents: jest.fn(() => [...agents.values()]),
    createAgent: jest.fn((params) => {
      const agent = { id: `agent_test_${Date.now()}`, ...params, status: 'idle' };
      agents.set(agent.id, agent);
      return agent;
    }),
    removeAgent: jest.fn((id) => agents.delete(id)),
    updateAgent: jest.fn((id, updates) => {
      const agent = agents.get(id);
      if (agent) Object.assign(agent, updates);
      return agent;
    }),
    _agents: agents
  };
}

/** Create a minimal Express app for route testing with supertest */
export async function createTestExpressApp(routeSetupFn) {
  const { default: express } = await import('express');
  const app = express();
  app.use(express.json());
  if (routeSetupFn) await routeSetupFn(app);
  return app;
}
