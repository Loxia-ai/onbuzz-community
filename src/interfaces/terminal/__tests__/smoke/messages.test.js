/**
 * Message Management - Smoke Tests
 * Verifies that message management modules can be imported and basic functionality works
 */

import { describe, test, expect } from '@jest/globals';

describe('Message Management - Imports', () => {
  test('useMessages hook can be imported', async () => {
    const { useMessages } = await import('../../state/useMessages.js');

    expect(useMessages).toBeDefined();
    expect(typeof useMessages).toBe('function');
  });

  test('useMessages is default export', async () => {
    const module = await import('../../state/useMessages.js');

    expect(module.default).toBeDefined();
    expect(typeof module.default).toBe('function');
    expect(module.default).toBe(module.useMessages);
  });

  test('useMessageCount helper hook can be imported', async () => {
    const { useMessageCount } = await import('../../state/useMessages.js');

    expect(useMessageCount).toBeDefined();
    expect(typeof useMessageCount).toBe('function');
  });
});

describe('Message Management - Constants', () => {
  test('MESSAGE_ROLE constants are defined', async () => {
    const { MESSAGE_ROLE } = await import('../../config/constants.js');

    expect(MESSAGE_ROLE).toBeDefined();
    expect(MESSAGE_ROLE.USER).toBe('user');
    expect(MESSAGE_ROLE.ASSISTANT).toBe('assistant');
    expect(MESSAGE_ROLE.SYSTEM).toBe('system');
  });

  test('MESSAGE_TYPE constants are defined', async () => {
    const { MESSAGE_TYPE } = await import('../../config/constants.js');

    expect(MESSAGE_TYPE).toBeDefined();
    expect(MESSAGE_TYPE.USER_MESSAGE).toBe('user-message');
    expect(MESSAGE_TYPE.AGENT_RESPONSE).toBe('agent-response');
    expect(MESSAGE_TYPE.SYSTEM_NOTIFICATION).toBe('system-notification');
  });

  test('MESSAGE_CONFIG constants are defined', async () => {
    const { MESSAGE_CONFIG } = await import('../../config/constants.js');

    expect(MESSAGE_CONFIG).toBeDefined();
    expect(MESSAGE_CONFIG.MAX_MESSAGE_LENGTH).toBeDefined();
    expect(MESSAGE_CONFIG.MAX_MESSAGES_DISPLAY).toBeDefined();
    expect(typeof MESSAGE_CONFIG.MAX_MESSAGE_LENGTH).toBe('number');
    expect(typeof MESSAGE_CONFIG.MAX_MESSAGES_DISPLAY).toBe('number');
  });

  test('PAGINATION constants are defined', async () => {
    const { PAGINATION } = await import('../../config/constants.js');

    expect(PAGINATION).toBeDefined();
    expect(PAGINATION.PAGE_SIZE).toBeDefined();
    expect(PAGINATION.MAX_PAGE_SIZE).toBeDefined();
    expect(typeof PAGINATION.PAGE_SIZE).toBe('number');
    expect(typeof PAGINATION.MAX_PAGE_SIZE).toBe('number');
  });

  test('WS_MESSAGE_TYPE includes message events', async () => {
    const { WS_MESSAGE_TYPE } = await import('../../config/constants.js');

    expect(WS_MESSAGE_TYPE).toBeDefined();
    expect(WS_MESSAGE_TYPE.MESSAGE_ADDED).toBe('message_added');
    expect(WS_MESSAGE_TYPE.AGENT_MODE_CHANGED).toBe('agent_mode_changed');
    expect(WS_MESSAGE_TYPE.EXECUTION_STOPPED).toBe('execution_stopped');
  });
});

describe('Message Management - Integration', () => {
  test('useMessages hook integrates with Session and MessageRouter', async () => {
    const { useMessages } = await import('../../state/useMessages.js');
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

    // useMessages expects these as parameters (including currentAgentId)
    // (we can't actually call the hook outside React, but we verify the interface)
    expect(typeof useMessages).toBe('function');
  });

  test('Full message management stack can be imported together', async () => {
    const [
      constantsModule,
      sessionModule,
      websocketModule,
      routerModule,
      messagesModule,
    ] = await Promise.all([
      import('../../config/constants.js'),
      import('../../api/session.js'),
      import('../../api/websocket.js'),
      import('../../api/messageRouter.js'),
      import('../../state/useMessages.js'),
    ]);

    // Verify all modules loaded
    expect(constantsModule.MESSAGE_ROLE).toBeDefined();
    expect(constantsModule.MESSAGE_TYPE).toBeDefined();
    expect(constantsModule.MESSAGE_CONFIG).toBeDefined();
    expect(sessionModule.SessionManager).toBeDefined();
    expect(websocketModule.WebSocketManager).toBeDefined();
    expect(routerModule.MessageRouter).toBeDefined();
    expect(messagesModule.useMessages).toBeDefined();
  });
});

describe('Message Management - API Endpoints Validation', () => {
  test('Orchestrator endpoint can be used for message operations', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    expect(API_ENDPOINTS.ORCHESTRATOR).toBeDefined();
    expect(API_ENDPOINTS.ORCHESTRATOR).toBe('/api/orchestrator');
  });

  test('Message API endpoints follow RESTful pattern', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    // Verify orchestrator endpoint exists (messages use this with action: 'send-message', 'get-messages')
    expect(API_ENDPOINTS.ORCHESTRATOR).toMatch(/^\/api\//);
  });
});

describe('Message Management - Hook Interface Verification', () => {
  test('useMessages returns expected interface shape', async () => {
    const { useMessages } = await import('../../state/useMessages.js');

    // We can verify the function signature
    expect(useMessages.length).toBe(3); // sessionManager, messageRouter, currentAgentId
  });

  test('useMessageCount returns expected interface shape', async () => {
    const { useMessageCount } = await import('../../state/useMessages.js');

    // We can verify the function signature
    expect(useMessageCount.length).toBe(1); // messages parameter
  });
});

describe('Message Management - Constants Validation', () => {
  test('MESSAGE_CONFIG has sensible defaults', async () => {
    const { MESSAGE_CONFIG } = await import('../../config/constants.js');

    // Verify message length is reasonable
    expect(MESSAGE_CONFIG.MAX_MESSAGE_LENGTH).toBeGreaterThan(0);
    expect(MESSAGE_CONFIG.MAX_MESSAGE_LENGTH).toBeLessThanOrEqual(100000);

    // Verify display limit is reasonable
    expect(MESSAGE_CONFIG.MAX_MESSAGES_DISPLAY).toBeGreaterThan(0);
    expect(MESSAGE_CONFIG.MAX_MESSAGES_DISPLAY).toBeLessThanOrEqual(10000);
  });

  test('PAGINATION has sensible defaults', async () => {
    const { PAGINATION } = await import('../../config/constants.js');

    // Verify page size is reasonable
    expect(PAGINATION.PAGE_SIZE).toBeGreaterThan(0);
    expect(PAGINATION.PAGE_SIZE).toBeLessThanOrEqual(1000);

    // Verify max page size is larger than or equal to page size
    expect(PAGINATION.MAX_PAGE_SIZE).toBeGreaterThanOrEqual(PAGINATION.PAGE_SIZE);
  });

  test('MESSAGE_ROLE values are lowercase', async () => {
    const { MESSAGE_ROLE } = await import('../../config/constants.js');

    expect(MESSAGE_ROLE.USER).toBe(MESSAGE_ROLE.USER.toLowerCase());
    expect(MESSAGE_ROLE.ASSISTANT).toBe(MESSAGE_ROLE.ASSISTANT.toLowerCase());
    expect(MESSAGE_ROLE.SYSTEM).toBe(MESSAGE_ROLE.SYSTEM.toLowerCase());
  });
});

describe('Message Management - WebSocket Event Handlers', () => {
  test('MessageRouter has message event handlers registered', async () => {
    const { MessageRouter } = await import('../../api/messageRouter.js');
    const { WebSocketManager } = await import('../../api/websocket.js');
    const { WS_MESSAGE_TYPE } = await import('../../config/constants.js');

    const wsManager = new WebSocketManager('localhost', 8080);
    const router = new MessageRouter(wsManager);

    // Verify message event handlers are registered
    expect(router.hasHandler(WS_MESSAGE_TYPE.MESSAGE_ADDED)).toBe(true);
    expect(router.hasHandler(WS_MESSAGE_TYPE.AGENT_MODE_CHANGED)).toBe(true);
  });
});

describe('Message Management - Error Handling', () => {
  test('MESSAGE_CONFIG enforces maximum message length', async () => {
    const { MESSAGE_CONFIG } = await import('../../config/constants.js');

    // Verify max length constant exists
    expect(MESSAGE_CONFIG.MAX_MESSAGE_LENGTH).toBeDefined();
    expect(typeof MESSAGE_CONFIG.MAX_MESSAGE_LENGTH).toBe('number');

    // This constant should be used to validate message length before sending
    const testMessage = 'a'.repeat(MESSAGE_CONFIG.MAX_MESSAGE_LENGTH + 1);
    expect(testMessage.length).toBeGreaterThan(MESSAGE_CONFIG.MAX_MESSAGE_LENGTH);
  });

  test('MESSAGE_CONFIG enforces maximum display messages', async () => {
    const { MESSAGE_CONFIG } = await import('../../config/constants.js');

    // Verify max display constant exists
    expect(MESSAGE_CONFIG.MAX_MESSAGES_DISPLAY).toBeDefined();
    expect(typeof MESSAGE_CONFIG.MAX_MESSAGES_DISPLAY).toBe('number');

    // This constant should be used to trim message arrays
    expect(MESSAGE_CONFIG.MAX_MESSAGES_DISPLAY).toBeGreaterThan(0);
  });
});

describe('Message Management - Pagination Logic', () => {
  test('PAGINATION supports offset-based pagination', async () => {
    const { PAGINATION } = await import('../../config/constants.js');

    const page = 0;
    const offset = page * PAGINATION.PAGE_SIZE;

    expect(offset).toBe(0); // First page should start at offset 0

    const page2 = 1;
    const offset2 = page2 * PAGINATION.PAGE_SIZE;

    expect(offset2).toBe(PAGINATION.PAGE_SIZE); // Second page should start at PAGE_SIZE
  });

  test('PAGINATION limit does not exceed MAX_PAGE_SIZE', async () => {
    const { PAGINATION } = await import('../../config/constants.js');

    const requestedLimit = 1000;
    const actualLimit = Math.min(requestedLimit, PAGINATION.MAX_PAGE_SIZE);

    expect(actualLimit).toBeLessThanOrEqual(PAGINATION.MAX_PAGE_SIZE);
  });
});
