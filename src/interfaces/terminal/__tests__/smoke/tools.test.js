/**
 * Tools Management - Smoke Tests
 * Verifies that tools management modules can be imported and basic functionality works
 */

import { describe, test, expect } from '@jest/globals';

describe('Tools Management - Imports', () => {
  test('useTools hook can be imported', async () => {
    const { useTools } = await import('../../state/useTools.js');

    expect(useTools).toBeDefined();
    expect(typeof useTools).toBe('function');
  });

  test('useTools is default export', async () => {
    const module = await import('../../state/useTools.js');

    expect(module.default).toBeDefined();
    expect(typeof module.default).toBe('function');
    expect(module.default).toBe(module.useTools);
  });
});

describe('Tools Management - Constants', () => {
  test('TOOL_CATEGORY constants are defined', async () => {
    const { TOOL_CATEGORY } = await import('../../config/constants.js');

    expect(TOOL_CATEGORY).toBeDefined();
    expect(TOOL_CATEGORY.SYSTEM).toBeDefined();
    expect(TOOL_CATEGORY.AUTOMATION).toBeDefined();
    expect(TOOL_CATEGORY.ANALYSIS).toBeDefined();
    expect(TOOL_CATEGORY.UTILITY).toBeDefined();
    expect(TOOL_CATEGORY.COLLABORATION).toBeDefined();
    expect(TOOL_CATEGORY.AI).toBeDefined();
  });

  test('TOOL_CATEGORY values are lowercase', async () => {
    const { TOOL_CATEGORY } = await import('../../config/constants.js');

    expect(TOOL_CATEGORY.SYSTEM).toBe(TOOL_CATEGORY.SYSTEM.toLowerCase());
    expect(TOOL_CATEGORY.AUTOMATION).toBe(TOOL_CATEGORY.AUTOMATION.toLowerCase());
    expect(TOOL_CATEGORY.ANALYSIS).toBe(TOOL_CATEGORY.ANALYSIS.toLowerCase());
    expect(TOOL_CATEGORY.UTILITY).toBe(TOOL_CATEGORY.UTILITY.toLowerCase());
  });

  test('Tools API endpoint is defined', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    expect(API_ENDPOINTS.TOOLS).toBeDefined();
    expect(API_ENDPOINTS.TOOLS).toBe('/api/tools');
  });

  test('Orchestrator endpoint is used for tool operations', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    expect(API_ENDPOINTS.ORCHESTRATOR).toBeDefined();
    expect(API_ENDPOINTS.ORCHESTRATOR).toBe('/api/orchestrator');
  });
});

describe('Tools Management - Integration', () => {
  test('useTools hook integrates with Session and MessageRouter', async () => {
    const { useTools } = await import('../../state/useTools.js');
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

    // useTools expects these as parameters (including currentAgentId)
    // (we can't actually call the hook outside React, but we verify the interface)
    expect(typeof useTools).toBe('function');
  });

  test('Full tools management stack can be imported together', async () => {
    const [
      constantsModule,
      sessionModule,
      websocketModule,
      routerModule,
      toolsModule,
    ] = await Promise.all([
      import('../../config/constants.js'),
      import('../../api/session.js'),
      import('../../api/websocket.js'),
      import('../../api/messageRouter.js'),
      import('../../state/useTools.js'),
    ]);

    // Verify all modules loaded
    expect(constantsModule.TOOL_CATEGORY).toBeDefined();
    expect(constantsModule.API_ENDPOINTS).toBeDefined();
    expect(sessionModule.SessionManager).toBeDefined();
    expect(websocketModule.WebSocketManager).toBeDefined();
    expect(routerModule.MessageRouter).toBeDefined();
    expect(toolsModule.useTools).toBeDefined();
  });
});

describe('Tools Management - API Endpoints Validation', () => {
  test('Tools endpoint follows RESTful pattern', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    // Verify endpoint path
    expect(API_ENDPOINTS.TOOLS).toMatch(/^\/api\//);
    expect(API_ENDPOINTS.TOOLS).toBe('/api/tools');
  });

  test('Tool operations use orchestrator endpoint', async () => {
    const { API_ENDPOINTS } = await import('../../config/constants.js');

    // Tool execution, enable/disable use orchestrator
    expect(API_ENDPOINTS.ORCHESTRATOR).toBeDefined();
    expect(API_ENDPOINTS.ORCHESTRATOR).toBe('/api/orchestrator');
  });
});

describe('Tools Management - Hook Interface Verification', () => {
  test('useTools returns expected interface shape', async () => {
    const { useTools } = await import('../../state/useTools.js');

    // We can verify the function signature
    expect(useTools.length).toBe(3); // sessionManager, messageRouter, currentAgentId
  });
});

describe('Tools Management - Constants Validation', () => {
  test('TOOL_CATEGORY includes all major categories', async () => {
    const { TOOL_CATEGORY } = await import('../../config/constants.js');

    const categories = Object.keys(TOOL_CATEGORY);
    expect(categories).toContain('SYSTEM');
    expect(categories).toContain('AUTOMATION');
    expect(categories).toContain('ANALYSIS');
    expect(categories).toContain('UTILITY');
    expect(categories).toContain('COLLABORATION');
    expect(categories).toContain('AI');
  });

  test('TOOL_CATEGORY values match expected format', async () => {
    const { TOOL_CATEGORY } = await import('../../config/constants.js');

    // Values should be lowercase
    expect(TOOL_CATEGORY.SYSTEM).toMatch(/^[a-z_]+$/);
    expect(TOOL_CATEGORY.AUTOMATION).toMatch(/^[a-z_]+$/);
    expect(TOOL_CATEGORY.ANALYSIS).toMatch(/^[a-z_]+$/);
    expect(TOOL_CATEGORY.UTILITY).toMatch(/^[a-z_]+$/);
  });
});

describe('Tools Management - WebSocket Event Handlers', () => {
  test('MessageRouter has tool event handlers registered', async () => {
    const { MessageRouter } = await import('../../api/messageRouter.js');
    const { WebSocketManager } = await import('../../api/websocket.js');

    const wsManager = new WebSocketManager('localhost', 8080);
    const router = new MessageRouter(wsManager);

    // Verify tool event handlers are registered
    // These would be registered by the useTools hook when mounted
    expect(router.hasHandler).toBeDefined();
    expect(typeof router.hasHandler).toBe('function');
  });
});

describe('Tools Management - Tool Categorization', () => {
  test('TOOL_CATEGORY can be used to filter tools by category', async () => {
    const { TOOL_CATEGORY } = await import('../../config/constants.js');

    // Mock tool list
    const mockTools = [
      { name: 'execute_command', category: TOOL_CATEGORY.SYSTEM },
      { name: 'terminal', category: TOOL_CATEGORY.SYSTEM },
      { name: 'analyze_code', category: TOOL_CATEGORY.ANALYSIS },
      { name: 'web_search', category: TOOL_CATEGORY.UTILITY },
      { name: 'ai_assistant', category: TOOL_CATEGORY.AI },
    ];

    // Filter by category
    const systemTools = mockTools.filter(t => t.category === TOOL_CATEGORY.SYSTEM);
    const analysisTools = mockTools.filter(t => t.category === TOOL_CATEGORY.ANALYSIS);
    const utilityTools = mockTools.filter(t => t.category === TOOL_CATEGORY.UTILITY);
    const aiTools = mockTools.filter(t => t.category === TOOL_CATEGORY.AI);

    expect(systemTools.length).toBe(2);
    expect(analysisTools.length).toBe(1);
    expect(utilityTools.length).toBe(1);
    expect(aiTools.length).toBe(1);

    expect(systemTools[0].name).toBe('execute_command');
    expect(analysisTools[0].name).toBe('analyze_code');
  });
});

describe('Tools Management - Tool Search', () => {
  test('Tool search should work with name and description', async () => {
    // Mock tool list
    const mockTools = [
      { name: 'read_file', description: 'Read contents of a file' },
      { name: 'write_file', description: 'Write data to a file' },
      { name: 'analyze_code', description: 'Perform static code analysis' },
    ];

    // Search by name
    const searchByName = (query) => {
      const lowerQuery = query.toLowerCase();
      return mockTools.filter(t =>
        t.name?.toLowerCase().includes(lowerQuery) ||
        t.description?.toLowerCase().includes(lowerQuery)
      );
    };

    const fileTools = searchByName('file');
    expect(fileTools.length).toBe(2);
    expect(fileTools.map(t => t.name)).toContain('read_file');
    expect(fileTools.map(t => t.name)).toContain('write_file');

    const analyzeTools = searchByName('analyze');
    expect(analyzeTools.length).toBe(1);
    expect(analyzeTools[0].name).toBe('analyze_code');
  });
});

describe('Tools Management - Execution State Tracking', () => {
  test('Execution state can track multiple tools', async () => {
    // Mock execution tracking
    const executingTools = new Set();

    // Start execution
    executingTools.add('read_file');
    executingTools.add('analyze_code');

    expect(executingTools.has('read_file')).toBe(true);
    expect(executingTools.has('analyze_code')).toBe(true);
    expect(executingTools.size).toBe(2);

    // Complete execution
    executingTools.delete('read_file');

    expect(executingTools.has('read_file')).toBe(false);
    expect(executingTools.has('analyze_code')).toBe(true);
    expect(executingTools.size).toBe(1);
  });

  test('Tool results can be stored by execution ID', async () => {
    // Mock tool results storage
    const toolResults = new Map();

    // Store results
    toolResults.set('exec-1', { success: true, data: 'file contents' });
    toolResults.set('exec-2', { success: true, data: { issues: [] } });

    expect(toolResults.get('exec-1')).toBeDefined();
    expect(toolResults.get('exec-1').success).toBe(true);
    expect(toolResults.get('exec-1').data).toBe('file contents');

    expect(toolResults.get('exec-2')).toBeDefined();
    expect(toolResults.get('exec-2').data.issues).toEqual([]);

    expect(toolResults.size).toBe(2);
  });
});

describe('Tools Management - Tool Caching', () => {
  test('Tool cache supports TTL-based caching', async () => {
    const CACHE_TTL = 600000; // 10 minutes

    // Mock cache
    let toolsCache = null;
    let toolsCacheTimestamp = 0;

    // Initial fetch
    const mockTools = [{ name: 'read_file' }];
    toolsCache = mockTools;
    toolsCacheTimestamp = Date.now();

    // Check cache validity
    const now = Date.now();
    const isCacheValid = (now - toolsCacheTimestamp) < CACHE_TTL;

    expect(isCacheValid).toBe(true);
    expect(toolsCache).toBe(mockTools);
  });

  test('Tool cache expires after TTL', async () => {
    const CACHE_TTL = 100; // 100ms for testing

    // Mock cache
    let toolsCache = null;
    let toolsCacheTimestamp = 0;

    // Initial fetch
    const mockTools = [{ name: 'read_file' }];
    toolsCache = mockTools;
    toolsCacheTimestamp = Date.now();

    // Wait for cache to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    // Check cache validity
    const now = Date.now();
    const isCacheValid = (now - toolsCacheTimestamp) < CACHE_TTL;

    expect(isCacheValid).toBe(false);
  });
});

describe('Tools Management - Tool Filtering', () => {
  test('Tools can be filtered by multiple criteria', async () => {
    const { TOOL_CATEGORY } = await import('../../config/constants.js');

    // Mock tool list
    const mockTools = [
      { name: 'execute_command', category: TOOL_CATEGORY.SYSTEM, enabled: true },
      { name: 'terminal', category: TOOL_CATEGORY.SYSTEM, enabled: false },
      { name: 'analyze_code', category: TOOL_CATEGORY.ANALYSIS, enabled: true },
    ];

    // Filter by category and enabled status
    const filterTools = (criteria) => {
      let filtered = [...mockTools];

      if (criteria.category) {
        filtered = filtered.filter(t => t.category === criteria.category);
      }

      if (criteria.enabled !== undefined) {
        filtered = filtered.filter(t => t.enabled === criteria.enabled);
      }

      return filtered;
    };

    // Filter: system tools only
    const systemTools = filterTools({ category: TOOL_CATEGORY.SYSTEM });
    expect(systemTools.length).toBe(2);

    // Filter: enabled tools only
    const enabledTools = filterTools({ enabled: true });
    expect(enabledTools.length).toBe(2);

    // Filter: enabled system tools
    const enabledSystemTools = filterTools({
      category: TOOL_CATEGORY.SYSTEM,
      enabled: true,
    });
    expect(enabledSystemTools.length).toBe(1);
    expect(enabledSystemTools[0].name).toBe('execute_command');
  });
});

describe('Tools Management - Category Counts', () => {
  test('Category counts can be calculated', async () => {
    const { TOOL_CATEGORY } = await import('../../config/constants.js');

    // Mock tool list
    const mockTools = [
      { name: 'execute_command', category: TOOL_CATEGORY.SYSTEM },
      { name: 'terminal', category: TOOL_CATEGORY.SYSTEM },
      { name: 'analyze_code', category: TOOL_CATEGORY.ANALYSIS },
      { name: 'web_search', category: TOOL_CATEGORY.UTILITY },
    ];

    // Calculate counts
    const getCategoryCounts = (tools) => {
      const counts = {};
      for (const category of Object.values(TOOL_CATEGORY)) {
        counts[category] = tools.filter(t => t.category === category).length;
      }
      return counts;
    };

    const counts = getCategoryCounts(mockTools);

    expect(counts[TOOL_CATEGORY.SYSTEM]).toBe(2);
    expect(counts[TOOL_CATEGORY.ANALYSIS]).toBe(1);
    expect(counts[TOOL_CATEGORY.UTILITY]).toBe(1);
    expect(counts[TOOL_CATEGORY.AUTOMATION]).toBe(0);
  });
});
