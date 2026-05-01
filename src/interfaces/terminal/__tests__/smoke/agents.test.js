/**
 * Agent Management - Smoke Tests
 * Verifies that agent management modules can be imported and basic functionality works
 */

import { describe, test, expect } from '@jest/globals';

describe('Agent Management - Imports', () => {
  test('useAgents hook can be imported', async () => {
    const { useAgents } = await import('../../state/useAgents.js');

    expect(useAgents).toBeDefined();
    expect(typeof useAgents).toBe('function');
  });

  test('useAgents is default export', async () => {
    const module = await import('../../state/useAgents.js');

    expect(module.default).toBeDefined();
    expect(typeof module.default).toBe('function');
    expect(module.default).toBe(module.useAgents);
  });
});

describe('Agent Management - Constants', () => {
  test('AGENT_MODE constants are defined', async () => {
    const { AGENT_MODE } = await import('../../config/constants.js');

    expect(AGENT_MODE).toBeDefined();
    expect(AGENT_MODE.CHAT).toBe('CHAT');
    expect(AGENT_MODE.AGENT).toBe('AGENT');
  });

  test('AGENT_STATUS constants are defined', async () => {
    const { AGENT_STATUS } = await import('../../config/constants.js');

    expect(AGENT_STATUS).toBeDefined();
    expect(AGENT_STATUS.ACTIVE).toBe('active');
    expect(AGENT_STATUS.PAUSED).toBe('paused');
    expect(AGENT_STATUS.IDLE).toBe('idle');
    expect(AGENT_STATUS.ERROR).toBe('error');
    expect(AGENT_STATUS.ARCHIVED).toBe('archived');
  });

  test('Agent API endpoints are defined', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    expect(API_ENDPOINTS.AGENTS_AVAILABLE).toBe('/api/agents/available');
    expect(API_ENDPOINTS.AGENTS_METADATA).toBe('/api/agents/:agentId/metadata');
    expect(API_ENDPOINTS.AGENTS_IMPORT).toBe('/api/agents/import');
    expect(API_ENDPOINTS.AGENTS_MODE_SET).toBe('/api/agents/:agentId/mode');
    expect(API_ENDPOINTS.AGENTS_MODE_GET).toBe('/api/agents/:agentId/mode');
    expect(API_ENDPOINTS.AGENTS_STOP).toBe('/api/agents/:agentId/stop');
  });

  test('AGENT_TEMPLATES constants are defined', async () => {
    const { AGENT_TEMPLATES } = await import('../../config/constants.js');

    expect(AGENT_TEMPLATES).toBeDefined();
    expect(AGENT_TEMPLATES.CODING_ASSISTANT).toBe('coding-assistant');
    expect(AGENT_TEMPLATES.DATA_ANALYST).toBe('data-analyst');
    expect(AGENT_TEMPLATES.CREATIVE_WRITER).toBe('creative-writer');
    expect(AGENT_TEMPLATES.SYSTEM_ADMINISTRATOR).toBe('system-administrator');
    expect(AGENT_TEMPLATES.CUSTOM).toBe('custom');
  });
});

describe('Agent Management - Integration', () => {
  test('useAgents hook integrates with Session and MessageRouter', async () => {
    const { useAgents } = await import('../../state/useAgents.js');
    const { SessionManager } = await import('../../api/session.js');
    const { MessageRouter } = await import('../../api/messageRouter.js');
    const { WebSocketManager } = await import('../../api/websocket.js');

    // Create dependencies
    const sessionManager = new SessionManager('localhost', 8080);
    const wsManager = new WebSocketManager('localhost', 8080);
    const messageRouter = new MessageRouter(wsManager);

    // Verify all components exist
    expect(sessionManager).toBeDefined();
    expect(messageRouter).toBeDefined();

    // useAgents expects these as parameters
    // (we can't actually call the hook outside React, but we verify the interface)
    expect(typeof useAgents).toBe('function');
  });

  test('Full agent management stack can be imported together', async () => {
    const [
      constantsModule,
      sessionModule,
      websocketModule,
      routerModule,
      agentsModule,
    ] = await Promise.all([
      import('../../config/constants.js'),
      import('../../api/session.js'),
      import('../../api/websocket.js'),
      import('../../api/messageRouter.js'),
      import('../../state/useAgents.js'),
    ]);

    // Verify all modules loaded
    expect(constantsModule.AGENT_MODE).toBeDefined();
    expect(sessionModule.SessionManager).toBeDefined();
    expect(websocketModule.WebSocketManager).toBeDefined();
    expect(routerModule.MessageRouter).toBeDefined();
    expect(agentsModule.useAgents).toBeDefined();
  });
});

describe('Agent Management - API Endpoints Validation', () => {
  test('All agent endpoints follow RESTful pattern', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    // Verify endpoint paths
    expect(API_ENDPOINTS.AGENTS_AVAILABLE).toMatch(/^\/api\/agents/);
    expect(API_ENDPOINTS.AGENTS_METADATA).toMatch(/^\/api\/agents/);
    expect(API_ENDPOINTS.AGENTS_IMPORT).toMatch(/^\/api\/agents/);
    expect(API_ENDPOINTS.AGENTS_MODE_SET).toMatch(/^\/api\/agents/);
    expect(API_ENDPOINTS.AGENTS_MODE_GET).toMatch(/^\/api\/agents/);
    expect(API_ENDPOINTS.AGENTS_STOP).toMatch(/^\/api\/agents/);

    // Verify parameter placeholders
    expect(API_ENDPOINTS.AGENTS_METADATA).toContain(':agentId');
    expect(API_ENDPOINTS.AGENTS_MODE_SET).toContain(':agentId');
    expect(API_ENDPOINTS.AGENTS_MODE_GET).toContain(':agentId');
    expect(API_ENDPOINTS.AGENTS_STOP).toContain(':agentId');
  });

  test('Orchestrator endpoint exists for agent operations', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    expect(API_ENDPOINTS.ORCHESTRATOR).toBeDefined();
    expect(API_ENDPOINTS.ORCHESTRATOR).toBe('/api/orchestrator');
  });
});
