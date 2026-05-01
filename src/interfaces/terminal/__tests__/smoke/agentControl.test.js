/**
 * Agent Control Management - Smoke Tests
 * Verifies that agent control modules can be imported and basic functionality works
 */

import { describe, test, expect } from '@jest/globals';

describe('Agent Control Management - Imports', () => {
  test('useAgentControl hook can be imported', async () => {
    const { useAgentControl } = await import('../../state/useAgentControl.js');

    expect(useAgentControl).toBeDefined();
    expect(typeof useAgentControl).toBe('function');
  });

  test('useAgentControl is default export', async () => {
    const module = await import('../../state/useAgentControl.js');

    expect(module.default).toBeDefined();
    expect(typeof module.default).toBe('function');
    expect(module.default).toBe(module.useAgentControl);
  });
});

describe('Agent Control Management - Constants', () => {
  test('AGENT_MODE constants are defined', async () => {
    const { AGENT_MODE } = await import('../../config/constants.js');

    expect(AGENT_MODE).toBeDefined();
    expect(AGENT_MODE.CHAT).toBe('CHAT');
    expect(AGENT_MODE.AGENT).toBe('AGENT');
  });

  test('MODEL_CATEGORY constants are defined', async () => {
    const { MODEL_CATEGORY } = await import('../../config/constants.js');

    expect(MODEL_CATEGORY).toBeDefined();
    expect(MODEL_CATEGORY.ANTHROPIC).toBe('anthropic');
    expect(MODEL_CATEGORY.OPENAI).toBe('openai');
    expect(MODEL_CATEGORY.DEEPSEEK).toBe('deepseek');
    expect(MODEL_CATEGORY.MICROSOFT).toBe('microsoft');
  });

  test('Mode and model API endpoints are defined', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    expect(API_ENDPOINTS.AGENTS_MODE_SET).toBe('/api/agents/:agentId/mode');
    expect(API_ENDPOINTS.AGENTS_MODE_GET).toBe('/api/agents/:agentId/mode');
    expect(API_ENDPOINTS.LLM_MODELS).toBe('/api/llm/models');
  });

  test('WS_MESSAGE_TYPE includes mode and model change events', async () => {
    const { WS_MESSAGE_TYPE } = await import('../../config/constants.js');

    expect(WS_MESSAGE_TYPE).toBeDefined();
    expect(WS_MESSAGE_TYPE.AGENT_MODE_CHANGED).toBe('agent_mode_changed');
  });
});

describe('Agent Control Management - Integration', () => {
  test('useAgentControl hook integrates with Session and MessageRouter', async () => {
    const { useAgentControl } = await import('../../state/useAgentControl.js');
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

    // useAgentControl expects these as parameters (including currentAgent)
    // (we can't actually call the hook outside React, but we verify the interface)
    expect(typeof useAgentControl).toBe('function');
  });

  test('Full agent control stack can be imported together', async () => {
    const [
      constantsModule,
      sessionModule,
      websocketModule,
      routerModule,
      agentControlModule,
    ] = await Promise.all([
      import('../../config/constants.js'),
      import('../../api/session.js'),
      import('../../api/websocket.js'),
      import('../../api/messageRouter.js'),
      import('../../state/useAgentControl.js'),
    ]);

    // Verify all modules loaded
    expect(constantsModule.AGENT_MODE).toBeDefined();
    expect(constantsModule.MODEL_CATEGORY).toBeDefined();
    expect(constantsModule.API_ENDPOINTS).toBeDefined();
    expect(sessionModule.SessionManager).toBeDefined();
    expect(websocketModule.WebSocketManager).toBeDefined();
    expect(routerModule.MessageRouter).toBeDefined();
    expect(agentControlModule.useAgentControl).toBeDefined();
  });
});

describe('Agent Control Management - API Endpoints Validation', () => {
  test('Agent mode endpoints follow RESTful pattern', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    // Verify endpoint paths
    expect(API_ENDPOINTS.AGENTS_MODE_SET).toMatch(/^\/api\/agents/);
    expect(API_ENDPOINTS.AGENTS_MODE_GET).toMatch(/^\/api\/agents/);

    // Verify parameter placeholders
    expect(API_ENDPOINTS.AGENTS_MODE_SET).toContain(':agentId');
    expect(API_ENDPOINTS.AGENTS_MODE_GET).toContain(':agentId');
  });

  test('LLM models endpoint exists', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    expect(API_ENDPOINTS.LLM_MODELS).toBeDefined();
    expect(API_ENDPOINTS.LLM_MODELS).toBe('/api/llm/models');
  });

  test('Orchestrator endpoint exists for model and config operations', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    expect(API_ENDPOINTS.ORCHESTRATOR).toBeDefined();
    expect(API_ENDPOINTS.ORCHESTRATOR).toBe('/api/orchestrator');
  });
});

describe('Agent Control Management - Hook Interface Verification', () => {
  test('useAgentControl returns expected interface shape', async () => {
    const { useAgentControl } = await import('../../state/useAgentControl.js');

    // We can verify the function signature
    expect(useAgentControl.length).toBe(3); // sessionManager, messageRouter, currentAgent
  });
});

describe('Agent Control Management - Constants Validation', () => {
  test('AGENT_MODE has exactly two modes', async () => {
    const { AGENT_MODE } = await import('../../config/constants.js');

    const modeKeys = Object.keys(AGENT_MODE);
    expect(modeKeys.length).toBe(2);
    expect(modeKeys).toContain('CHAT');
    expect(modeKeys).toContain('AGENT');
  });

  test('AGENT_MODE values are uppercase', async () => {
    const { AGENT_MODE } = await import('../../config/constants.js');

    expect(AGENT_MODE.CHAT).toBe('CHAT');
    expect(AGENT_MODE.AGENT).toBe('AGENT');
    expect(AGENT_MODE.CHAT).toBe(AGENT_MODE.CHAT.toUpperCase());
    expect(AGENT_MODE.AGENT).toBe(AGENT_MODE.AGENT.toUpperCase());
  });

  test('MODEL_CATEGORY values are lowercase', async () => {
    const { MODEL_CATEGORY } = await import('../../config/constants.js');

    expect(MODEL_CATEGORY.ANTHROPIC).toBe('anthropic');
    expect(MODEL_CATEGORY.OPENAI).toBe('openai');
    expect(MODEL_CATEGORY.DEEPSEEK).toBe('deepseek');
    expect(MODEL_CATEGORY.MICROSOFT).toBe('microsoft');

    expect(MODEL_CATEGORY.ANTHROPIC).toBe(MODEL_CATEGORY.ANTHROPIC.toLowerCase());
    expect(MODEL_CATEGORY.OPENAI).toBe(MODEL_CATEGORY.OPENAI.toLowerCase());
  });

  test('MODEL_CATEGORY includes major LLM providers', async () => {
    const { MODEL_CATEGORY } = await import('../../config/constants.js');

    const categories = Object.keys(MODEL_CATEGORY);
    expect(categories).toContain('ANTHROPIC');
    expect(categories).toContain('OPENAI');
    expect(categories).toContain('DEEPSEEK');
    expect(categories).toContain('MICROSOFT');
  });
});

describe('Agent Control Management - WebSocket Event Handlers', () => {
  test('MessageRouter has mode change event handler registered', async () => {
    const { MessageRouter } = await import('../../api/messageRouter.js');
    const { WebSocketManager } = await import('../../api/websocket.js');
    const { WS_MESSAGE_TYPE } = await import('../../config/constants.js');

    const wsManager = new WebSocketManager('localhost', 8080);
    const router = new MessageRouter(wsManager);

    // Verify mode change event handler is registered
    expect(router.hasHandler(WS_MESSAGE_TYPE.AGENT_MODE_CHANGED)).toBe(true);
  });
});

describe('Agent Control Management - Mode Switching Logic', () => {
  test('AGENT_MODE supports toggling between modes', async () => {
    const { AGENT_MODE } = await import('../../config/constants.js');

    // Toggle from CHAT to AGENT
    let currentMode = AGENT_MODE.CHAT;
    let newMode = currentMode === AGENT_MODE.CHAT ? AGENT_MODE.AGENT : AGENT_MODE.CHAT;
    expect(newMode).toBe(AGENT_MODE.AGENT);

    // Toggle from AGENT to CHAT
    currentMode = AGENT_MODE.AGENT;
    newMode = currentMode === AGENT_MODE.CHAT ? AGENT_MODE.AGENT : AGENT_MODE.CHAT;
    expect(newMode).toBe(AGENT_MODE.CHAT);
  });
});

describe('Agent Control Management - Model Filtering', () => {
  test('MODEL_CATEGORY can be used to filter models by category', async () => {
    const { MODEL_CATEGORY } = await import('../../config/constants.js');

    // Mock model list
    const mockModels = [
      { id: 'claude-3-5-sonnet', category: MODEL_CATEGORY.ANTHROPIC },
      { id: 'gpt-4', category: MODEL_CATEGORY.OPENAI },
      { id: 'deepseek-chat', category: MODEL_CATEGORY.DEEPSEEK },
    ];

    // Filter by category
    const anthropicModels = mockModels.filter(m => m.category === MODEL_CATEGORY.ANTHROPIC);
    const openAIModels = mockModels.filter(m => m.category === MODEL_CATEGORY.OPENAI);

    expect(anthropicModels.length).toBe(1);
    expect(anthropicModels[0].id).toBe('claude-3-5-sonnet');
    expect(openAIModels.length).toBe(1);
    expect(openAIModels[0].id).toBe('gpt-4');
  });
});
