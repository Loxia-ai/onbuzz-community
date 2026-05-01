/**
 * Terminal UI Infrastructure - Smoke Tests
 * Verifies that all Phase 1 modules can be imported and instantiated
 */

import { describe, test, expect } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Terminal UI Infrastructure - Imports', () => {
  test('constants module exports all required constants', async () => {
    const constants = await import('../../config/constants.js');

    // Verify major constant groups exist
    expect(constants.UI_DIMENSIONS).toBeDefined();
    expect(constants.MESSAGE_CONFIG).toBeDefined();
    expect(constants.PAGINATION).toBeDefined();
    expect(constants.TIMING).toBeDefined();
    expect(constants.NETWORK).toBeDefined();
    expect(constants.CONNECTION_STATE).toBeDefined();
    expect(constants.AGENT_MODE).toBeDefined();
    expect(constants.WS_MESSAGE_TYPE).toBeDefined();
    expect(constants.API_ENDPOINTS).toBeDefined();
    expect(constants.COMMANDS).toBeDefined();

    // Verify some key values
    expect(constants.NETWORK.DEFAULT_HOST).toBe('localhost');
    expect(constants.NETWORK.DEFAULT_PORT).toBe(8080);
    expect(constants.CONNECTION_STATE.DISCONNECTED).toBe('disconnected');
    expect(constants.CONNECTION_STATE.CONNECTED).toBe('connected');
  });

  test('WebSocketManager class can be imported', async () => {
    const { WebSocketManager } = await import('../../api/websocket.js');

    expect(WebSocketManager).toBeDefined();
    expect(typeof WebSocketManager).toBe('function');

    // Verify it's a class
    const instance = new WebSocketManager('localhost', 8080);
    expect(instance).toBeDefined();
    expect(instance.host).toBe('localhost');
    expect(instance.port).toBe(8080);
    expect(instance.url).toBe('ws://localhost:8080');
  });

  test('SessionManager class can be imported', async () => {
    const { SessionManager } = await import('../../api/session.js');

    expect(SessionManager).toBeDefined();
    expect(typeof SessionManager).toBe('function');

    // Verify it's a class
    const instance = new SessionManager('localhost', 8080);
    expect(instance).toBeDefined();
    expect(instance.host).toBe('localhost');
    expect(instance.port).toBe(8080);
    expect(instance.baseUrl).toBe('http://localhost:8080');
  });

  test('MessageRouter class can be imported', async () => {
    const { MessageRouter } = await import('../../api/messageRouter.js');
    const { WebSocketManager } = await import('../../api/websocket.js');

    expect(MessageRouter).toBeDefined();
    expect(typeof MessageRouter).toBe('function');

    // Verify it's a class (requires WebSocketManager instance)
    const wsManager = new WebSocketManager('localhost', 8080);
    const instance = new MessageRouter(wsManager);
    expect(instance).toBeDefined();
    expect(instance.ws).toBe(wsManager);
  });

  test('MessageRouter middleware helpers can be imported', async () => {
    const {
      loggingMiddleware,
      filterMiddleware,
      transformMiddleware,
      timestampMiddleware,
      validationMiddleware,
    } = await import('../../api/messageRouter.js');

    expect(typeof loggingMiddleware).toBe('function');
    expect(typeof filterMiddleware).toBe('function');
    expect(typeof transformMiddleware).toBe('function');
    expect(typeof timestampMiddleware).toBe('function');
    expect(typeof validationMiddleware).toBe('function');
  });

  test('useConnection hook can be imported', async () => {
    const mod = await import('../../state/useConnection.js');

    expect(mod.useConnection).toBeDefined();
    expect(typeof mod.useConnection).toBe('function');
  });
});

describe('Terminal UI Infrastructure - Basic Functionality', () => {
  test('WebSocketManager initializes with correct state', async () => {
    const { WebSocketManager } = await import('../../api/websocket.js');
    const { CONNECTION_STATE } = await import('../../config/constants.js');

    const wsManager = new WebSocketManager('test-host', 9090);

    expect(wsManager.state).toBe(CONNECTION_STATE.DISCONNECTED);
    expect(wsManager.sessionId).toBe(null);
    expect(wsManager.messageQueue).toEqual([]);
    expect(wsManager.reconnectAttempts).toBe(0);
    expect(wsManager.shouldReconnect).toBe(true);
  });

  test('SessionManager initializes with correct state', async () => {
    const { SessionManager } = await import('../../api/session.js');

    const sessionManager = new SessionManager('test-host', 9090);

    expect(sessionManager.sessionId).toBe(null);
    expect(sessionManager.projectDir).toBe(null);
    expect(sessionManager.vendorKeys).toEqual({});
    expect(sessionManager.isValid()).toBe(false);
  });

  test('MessageRouter initializes with default handlers', async () => {
    const { MessageRouter } = await import('../../api/messageRouter.js');
    const { WebSocketManager } = await import('../../api/websocket.js');
    const { WS_MESSAGE_TYPE } = await import('../../config/constants.js');

    const wsManager = new WebSocketManager('localhost', 8080);
    const router = new MessageRouter(wsManager);

    // Verify default handlers are registered
    expect(router.hasHandler(WS_MESSAGE_TYPE.MESSAGE_ADDED)).toBe(true);
    expect(router.hasHandler(WS_MESSAGE_TYPE.AGENT_MODE_CHANGED)).toBe(true);
    expect(router.hasHandler(WS_MESSAGE_TYPE.EXECUTION_STOPPED)).toBe(true);
    expect(router.hasHandler(WS_MESSAGE_TYPE.COMPACTION_EVENT)).toBe(true);
    expect(router.hasHandler(WS_MESSAGE_TYPE.IMAGE_RESULT)).toBe(true);
  });

  test('MessageRouter middleware can be added and removed', async () => {
    const { MessageRouter } = await import('../../api/messageRouter.js');
    const { WebSocketManager } = await import('../../api/websocket.js');

    const wsManager = new WebSocketManager('localhost', 8080);
    const router = new MessageRouter(wsManager);

    const testMiddleware = (msg) => msg;

    expect(router.middleware.length).toBeGreaterThanOrEqual(0);

    router.use(testMiddleware);
    const middlewareCount = router.middleware.length;
    expect(middlewareCount).toBeGreaterThan(0);

    router.removeMiddleware(testMiddleware);
    expect(router.middleware.length).toBe(middlewareCount - 1);
  });

  test('SessionManager helper methods work', async () => {
    const { SessionManager } = await import('../../api/session.js');

    const sessionManager = new SessionManager('localhost', 8080);

    // Test getter methods
    expect(sessionManager.getSessionId()).toBe(null);
    expect(sessionManager.getProjectDir()).toBe(null);
    expect(sessionManager.isValid()).toBe(false);

    // Test session info
    const info = sessionManager.getSessionInfo();
    expect(info).toHaveProperty('sessionId');
    expect(info).toHaveProperty('projectDir');
    expect(info).toHaveProperty('vendorKeysCount');
  });

  test('WebSocketManager helper methods work', async () => {
    const { WebSocketManager } = await import('../../api/websocket.js');
    const { CONNECTION_STATE } = await import('../../config/constants.js');

    const wsManager = new WebSocketManager('localhost', 8080);

    // Test state methods
    expect(wsManager.getState()).toBe(CONNECTION_STATE.DISCONNECTED);
    expect(wsManager.isConnected()).toBe(false);
    expect(wsManager.getSessionId()).toBe(null);

    // Test stats
    const stats = wsManager.getStats();
    expect(stats).toHaveProperty('state');
    expect(stats).toHaveProperty('sessionId');
    expect(stats).toHaveProperty('reconnectAttempts');
    expect(stats).toHaveProperty('queuedMessages');
    expect(stats).toHaveProperty('pendingRequests');
  });

  test('MessageRouter can register and unregister handlers', async () => {
    const { MessageRouter } = await import('../../api/messageRouter.js');
    const { WebSocketManager } = await import('../../api/websocket.js');

    const wsManager = new WebSocketManager('localhost', 8080);
    const router = new MessageRouter(wsManager);

    const testHandler = () => {};

    expect(router.hasHandler('test-message')).toBe(false);

    router.registerHandler('test-message', testHandler);
    expect(router.hasHandler('test-message')).toBe(true);

    router.unregisterHandler('test-message');
    expect(router.hasHandler('test-message')).toBe(false);
  });

  test('MessageRouter middleware helpers create valid middleware', async () => {
    const {
      loggingMiddleware,
      timestampMiddleware,
      filterMiddleware,
    } = await import('../../api/messageRouter.js');

    // Test logging middleware
    const logMw = loggingMiddleware();
    expect(typeof logMw).toBe('function');

    // Test timestamp middleware
    const tsMw = timestampMiddleware();
    expect(typeof tsMw).toBe('function');
    const testMsg = { type: 'test' };
    const result = tsMw(testMsg);
    expect(result).toHaveProperty('receivedAt');
    expect(result.type).toBe('test');

    // Test filter middleware
    const filterMw = filterMiddleware(['allowed-type']);
    expect(typeof filterMw).toBe('function');
    expect(filterMw({ type: 'allowed-type' })).toBeTruthy();
    expect(filterMw({ type: 'blocked-type' })).toBe(null);
  });

  test('Constants have no magic numbers', async () => {
    const constants = await import('../../config/constants.js');

    // Verify all timing values are defined
    expect(typeof constants.TIMING.WEBSOCKET_RECONNECT_DELAY).toBe('number');
    expect(typeof constants.TIMING.WEBSOCKET_PING_INTERVAL).toBe('number');

    // Verify network defaults
    expect(typeof constants.NETWORK.DEFAULT_PORT).toBe('number');
    expect(typeof constants.NETWORK.MAX_RETRIES).toBe('number');
    expect(typeof constants.NETWORK.HTTP_TIMEOUT).toBe('number');

    // Verify UI dimensions
    expect(typeof constants.UI_DIMENSIONS.MESSAGE_LIST_HEIGHT).toBe('number');
    expect(typeof constants.UI_DIMENSIONS.SIDEBAR_WIDTH).toBe('number');
  });
});

describe('Terminal UI Infrastructure - Error Handling', () => {
  test('MessageRouter throws on invalid handler', async () => {
    const { MessageRouter } = await import('../../api/messageRouter.js');
    const { WebSocketManager } = await import('../../api/websocket.js');

    const wsManager = new WebSocketManager('localhost', 8080);
    const router = new MessageRouter(wsManager);

    expect(() => {
      router.registerHandler('test', 'not-a-function');
    }).toThrow('Handler must be a function');
  });

  test('MessageRouter throws on invalid middleware', async () => {
    const { MessageRouter } = await import('../../api/messageRouter.js');
    const { WebSocketManager } = await import('../../api/websocket.js');

    const wsManager = new WebSocketManager('localhost', 8080);
    const router = new MessageRouter(wsManager);

    expect(() => {
      router.use('not-a-function');
    }).toThrow('Middleware must be a function');
  });

  test('SessionManager clear() resets all state', async () => {
    const { SessionManager } = await import('../../api/session.js');

    const sessionManager = new SessionManager('localhost', 8080);

    // Manually set some state
    sessionManager.sessionId  = 'test-123';
    sessionManager.projectDir = '/test/dir';
    sessionManager.vendorKeys = { openai: 'key' };

    expect(sessionManager.isValid()).toBe(true);

    // Clear
    sessionManager.clear();

    // Verify all cleared
    expect(sessionManager.sessionId).toBe(null);
    expect(sessionManager.projectDir).toBe(null);
    expect(sessionManager.vendorKeys).toEqual({});
    expect(sessionManager.isValid()).toBe(false);
  });

  test('WebSocketManager generates unique request IDs', async () => {
    const { WebSocketManager } = await import('../../api/websocket.js');

    const wsManager = new WebSocketManager('localhost', 8080);

    const id1 = wsManager.generateRequestId();
    const id2 = wsManager.generateRequestId();
    const id3 = wsManager.generateRequestId();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);

    // Verify format
    expect(id1).toMatch(/^req-\d+-\d+$/);
    expect(id2).toMatch(/^req-\d+-\d+$/);
    expect(id3).toMatch(/^req-\d+-\d+$/);
  });
});
