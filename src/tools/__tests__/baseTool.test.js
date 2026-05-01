import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock constants before importing BaseTool
const TOOL_STATUS = {
  PENDING: 'pending',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

const OPERATION_STATUS = {
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  NOT_FOUND: 'not_found'
};

const SYSTEM_DEFAULTS = {
  MAX_TOOL_EXECUTION_TIME: 300000
};

jest.unstable_mockModule('../../utilities/constants.js', () => ({
  TOOL_STATUS,
  OPERATION_STATUS,
  ERROR_TYPES: {},
  SYSTEM_DEFAULTS
}));

const { BaseTool, ToolsRegistry } = await import('../baseTool.js');

// Concrete subclass for testing
class TestTool extends BaseTool {
  getDescription() { return 'Test tool for testing\nSecond line of description'; }
  getSummary() { return 'Test tool'; }
  parseParameters(content) {
    if (typeof content === 'string' && content.trim().startsWith('{')) return JSON.parse(content);
    return { raw: content };
  }
  async execute(params, context) { return { success: true, data: params }; }
}

// Subclass that throws on execute
class FailingTool extends BaseTool {
  getDescription() { return 'Failing tool'; }
  parseParameters(content) { return {}; }
  async execute() { throw new Error('Intentional failure'); }
}

// Subclass with required params
class StrictTool extends BaseTool {
  getDescription() { return 'Strict tool'; }
  parseParameters(content) { return JSON.parse(content); }
  async execute(params) { return params; }
  getRequiredParameters() { return ['name']; }
}

describe('BaseTool', () => {
  let tool;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    tool = new TestTool({}, logger);
  });

  test('constructor sets default values', () => {
    const t = new TestTool();
    expect(t.isEnabled).toBe(true);
    expect(t.usageCount).toBe(0);
    expect(t.lastUsed).toBeNull();
    expect(t.operationHistory).toEqual([]);
    expect(t.activeOperations.size).toBe(0);
    expect(t.requiresProject).toBe(false);
    expect(t.isAsync).toBe(false);
    expect(t.builtinDelay).toBe(0);
  });

  test('constructor respects config.enabled = false', () => {
    const t = new TestTool({ enabled: false });
    expect(t.isEnabled).toBe(false);
  });

  test('constructor uses config.timeout when provided', () => {
    const t = new TestTool({ timeout: 5000 });
    expect(t.timeout).toBe(5000);
  });

  test('id is derived from class name', () => {
    expect(tool.id).toBe('test');
  });

  test('getCapabilities returns correct object', () => {
    const caps = tool.getCapabilities();
    expect(caps.id).toBe('test');
    expect(caps.enabled).toBe(true);
    expect(caps.timeout).toBe(300000);
    expect(caps.supportedActions).toEqual(['execute']);
    expect(caps).toHaveProperty('parameterSchema');
    expect(caps).toHaveProperty('maxConcurrentOperations');
  });

  test('getSupportedActions returns default array', () => {
    expect(tool.getSupportedActions()).toEqual(['execute']);
  });

  test('getSummary returns first line of description', () => {
    expect(tool.getSummary()).toBe('Test tool');
  });

  test('getSummary returns fallback when getDescription throws', () => {
    const bare = new BaseTool();
    const summary = bare.getSummary();
    expect(summary).toContain('tool');
  });

  test('getParameterSchema returns default schema', () => {
    const schema = tool.getParameterSchema();
    expect(schema.type).toBe('object');
    expect(schema).toHaveProperty('properties');
    expect(schema).toHaveProperty('required');
  });

  test('getUsageStats returns stats object with all fields', () => {
    const stats = tool.getUsageStats();
    expect(stats.toolId).toBe('test');
    expect(stats.usageCount).toBe(0);
    expect(stats.lastUsed).toBeNull();
    expect(stats.activeOperations).toBe(0);
    expect(stats.totalOperations).toBe(0);
    expect(stats.averageExecutionTime).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.isEnabled).toBe(true);
  });

  test('enable and disable toggle isEnabled', () => {
    tool.disable();
    expect(tool.isEnabled).toBe(false);
    expect(logger.info).toHaveBeenCalled();
    tool.enable();
    expect(tool.isEnabled).toBe(true);
  });

  test('resetStats clears counters', () => {
    tool.usageCount = 5;
    tool.lastUsed = '2025-01-01';
    tool.operationHistory = [{ id: 'x' }];
    tool.resetStats();
    expect(tool.usageCount).toBe(0);
    expect(tool.lastUsed).toBeNull();
    expect(tool.operationHistory).toEqual([]);
  });

  test('executeWithLifecycle calls execute and tracks stats', async () => {
    const result = await tool.executeWithLifecycle({ foo: 'bar' }, {});
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ success: true, data: { foo: 'bar' } });
    expect(result.toolId).toBe('test');
    expect(result.executionTime).toBeGreaterThanOrEqual(0);
    expect(result).toHaveProperty('operationId');
    expect(tool.usageCount).toBe(1);
    expect(tool.lastUsed).toBeTruthy();
    expect(tool.operationHistory.length).toBe(1);
    expect(tool.operationHistory[0].status).toBe('completed');
  });

  test('executeWithLifecycle throws when tool is disabled', async () => {
    tool.disable();
    await expect(tool.executeWithLifecycle({}, {})).rejects.toThrow('disabled');
  });

  test('executeWithLifecycle throws on concurrent operation limit', async () => {
    tool.maxConcurrentOperations = 0;
    await expect(tool.executeWithLifecycle({}, {})).rejects.toThrow('concurrent');
  });

  test('executeWithLifecycle handles execute error and records failure', async () => {
    const failTool = new FailingTool({}, logger);
    await expect(failTool.executeWithLifecycle({}, {})).rejects.toThrow('Intentional failure');
    expect(failTool.operationHistory.length).toBe(1);
    expect(failTool.operationHistory[0].status).toBe('failed');
    expect(failTool.operationHistory[0].error).toBe('Intentional failure');
    expect(failTool.activeOperations.size).toBe(0);
  });

  test('executeWithLifecycle handles timeout', async () => {
    const slowTool = new TestTool({ timeout: 10 }, logger);
    slowTool.execute = async () => new Promise(resolve => setTimeout(resolve, 500));
    await expect(slowTool.executeWithLifecycle({}, {})).rejects.toThrow('timed out');
  }, 5000);

  test('validateParameters rejects non-object params', () => {
    expect(tool.validateParameters(null).valid).toBe(false);
    expect(tool.validateParameters('string').valid).toBe(false);
  });

  test('validateParameters checks required parameters', () => {
    const strictTool = new StrictTool({}, logger);
    const result = strictTool.validateParameters({ other: 'value' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('name');
  });

  test('validateParameters passes valid params', () => {
    const strictTool = new StrictTool({}, logger);
    const result = strictTool.validateParameters({ name: 'test' });
    expect(result.valid).toBe(true);
  });

  test('getStatus returns NOT_FOUND for unknown operation', async () => {
    const status = await tool.getStatus('nonexistent');
    expect(status.status).toBe('not_found');
  });

  test('getStatus returns history entry for completed operation', async () => {
    await tool.executeWithLifecycle({}, {});
    const opId = tool.operationHistory[0].id;
    const status = await tool.getStatus(opId);
    expect(status.status).toBe('completed');
  });

  test('sanitizeContext removes sensitive fields and truncates content', () => {
    const ctx = {
      apiKeys: 'secret',
      secrets: 'hidden',
      passwords: 'pass',
      content: 'a'.repeat(600),
      projectDir: '/test'
    };
    const sanitized = tool.sanitizeContext(ctx);
    expect(sanitized.apiKeys).toBeUndefined();
    expect(sanitized.secrets).toBeUndefined();
    expect(sanitized.passwords).toBeUndefined();
    expect(sanitized.content).toContain('[truncated]');
    expect(sanitized.content.length).toBeLessThan(600);
    expect(sanitized.projectDir).toBe('/test');
  });

  test('cleanupHistory trims beyond 100 entries', () => {
    tool.operationHistory = Array.from({ length: 120 }, (_, i) => ({ id: i }));
    tool.cleanupHistory();
    expect(tool.operationHistory.length).toBe(100);
    expect(tool.operationHistory[0].id).toBe(20);
  });

  test('cleanupHistory does nothing under limit', () => {
    tool.operationHistory = [{ id: 1 }, { id: 2 }];
    tool.cleanupHistory();
    expect(tool.operationHistory.length).toBe(2);
  });

  test('calculateSuccessRate returns correct percentage', () => {
    tool.operationHistory = [
      { status: 'completed' },
      { status: 'completed' },
      { status: 'failed' },
      { status: 'completed' }
    ];
    expect(tool.calculateSuccessRate()).toBe(75);
  });

  test('calculateSuccessRate returns 0 with no history', () => {
    expect(tool.calculateSuccessRate()).toBe(0);
  });

  test('calculateAverageExecutionTime computes correctly', () => {
    tool.operationHistory = [
      { status: 'completed', executionTime: 100 },
      { status: 'completed', executionTime: 200 },
      { status: 'failed', executionTime: 999 }
    ];
    expect(tool.calculateAverageExecutionTime()).toBe(150);
  });

  test('calculateAverageExecutionTime returns 0 with no completed ops', () => {
    tool.operationHistory = [{ status: 'failed' }];
    expect(tool.calculateAverageExecutionTime()).toBe(0);
  });

  test('base class getDescription throws', () => {
    const base = new BaseTool();
    expect(() => base.getDescription()).toThrow('must implement getDescription');
  });

  test('base class parseParameters throws', () => {
    const base = new BaseTool();
    expect(() => base.parseParameters('test')).toThrow('must implement parseParameters');
  });

  test('base class execute throws', async () => {
    const base = new BaseTool();
    await expect(base.execute({}, {})).rejects.toThrow('must implement execute');
  });
});

describe('ToolsRegistry', () => {
  let registry;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    registry = new ToolsRegistry(logger);
  });

  test('registerTool adds a tool', async () => {
    await registry.registerTool(TestTool);
    expect(registry.listTools()).toContain('test');
  });

  test('getTool retrieves by ID', async () => {
    await registry.registerTool(TestTool);
    const tool = registry.getTool('test');
    expect(tool).toBeInstanceOf(BaseTool);
  });

  test('getTool returns null for unknown ID', () => {
    expect(registry.getTool('unknown')).toBeNull();
  });

  test('listTools returns registered IDs', async () => {
    await registry.registerTool(TestTool);
    const tools = registry.listTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toContain('test');
  });

  test('executeToolSecurely validates and delegates', async () => {
    await registry.registerTool(TestTool);
    const result = await registry.executeToolSecurely('test', {}, {});
    expect(result.success).toBe(true);
  });

  test('executeToolSecurely throws for unknown tool', async () => {
    await expect(registry.executeToolSecurely('nope', {}, {})).rejects.toThrow('not found');
  });

  test('executeToolSecurely throws for disabled tool', async () => {
    await registry.registerTool(TestTool);
    registry.getTool('test').disable();
    await expect(registry.executeToolSecurely('test', {}, {})).rejects.toThrow('disabled');
  });

  test('generateToolDescriptionsForPrompt returns formatted string', async () => {
    await registry.registerTool(TestTool);
    const desc = registry.generateToolDescriptionsForPrompt();
    expect(desc).toContain('AVAILABLE TOOLS');
    expect(desc).toContain('TOOL INVOCATION SYNTAX');
  });

  test('generateToolDescriptionsForPrompt returns empty for no matching tools', () => {
    const desc = registry.generateToolDescriptionsForPrompt(['nonexistent']);
    expect(desc).toBe('');
  });

  test('generateToolDescriptionsForPrompt compact mode', async () => {
    await registry.registerTool(TestTool);
    const desc = registry.generateToolDescriptionsForPrompt([], { compact: true });
    expect(desc).toContain('test');
  });

  test('generateToolDescriptionsForPrompt layered mode', async () => {
    await registry.registerTool(TestTool);
    const desc = registry.generateToolDescriptionsForPrompt([], { layered: true });
    expect(desc).toContain('HOW TO GET TOOL DOCUMENTATION');
  });

  test('enhanceSystemPrompt appends tool docs', async () => {
    await registry.registerTool(TestTool);
    const enhanced = registry.enhanceSystemPrompt('Base prompt.', []);
    expect(enhanced).toContain('Base prompt.');
    expect(enhanced).toContain('AVAILABLE TOOLS');
  });

  test('enhanceSystemPrompt returns empty prompt when no tools match', () => {
    const enhanced = registry.enhanceSystemPrompt('', ['nonexistent']);
    expect(enhanced).toBe('');
  });

  test('enhanceSystemPrompt replaces existing tool section', async () => {
    await registry.registerTool(TestTool);
    const existing = 'Prefix\n## AVAILABLE TOOLS\nOld content\n## OTHER SECTION';
    const enhanced = registry.enhanceSystemPrompt(existing, []);
    expect(enhanced).toContain('Prefix');
    expect(enhanced).not.toContain('Old content');
  });

  test('getRegistryStats returns correct counts', async () => {
    await registry.registerTool(TestTool);
    const stats = registry.getRegistryStats();
    expect(stats.totalTools).toBe(1);
    expect(stats.enabledTools).toBe(1);
    expect(stats.totalOperations).toBe(0);
    expect(stats.activeOperations).toBe(0);
  });

  test('getToolCapabilities returns enabled tools only', async () => {
    await registry.registerTool(TestTool);
    const caps = registry.getToolCapabilities();
    expect(caps).toHaveProperty('test');
    expect(caps.test).toHaveProperty('description');
    expect(caps.test).toHaveProperty('usageStats');
  });

  test('getAvailableToolsForUI returns sorted array with expected shape', async () => {
    await registry.registerTool(TestTool);
    const tools = registry.getAvailableToolsForUI();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(1);
    expect(tools[0]).toHaveProperty('id');
    expect(tools[0]).toHaveProperty('name');
    expect(tools[0]).toHaveProperty('category');
    expect(tools[0]).toHaveProperty('enabled');
    expect(tools[0]).toHaveProperty('className');
    // iconName is part of the UI shape — every tool must carry one so the
    // web-UI can render without per-surface icon maps. Unknown tools fall
    // back to WrenchScrewdriver.
    expect(tools[0]).toHaveProperty('iconName');
    expect(typeof tools[0].iconName).toBe('string');
    expect(tools[0].iconName.length).toBeGreaterThan(0);
  });

  test('_getToolCategory maps every known tool (no "Other") incl. video-gen', () => {
    // Locks the "tools introduced to UI" alignment — a tool with no
    // explicit category falls into "Other" and gets buried in dropdowns.
    const expected = {
      'terminal': 'System', 'filesystem': 'File Operations',
      'file-content-replace': 'File Operations', 'seek': 'File Operations',
      'file-tree': 'File Operations', 'code-map': 'Analysis',
      'pdf': 'File Operations', 'doc': 'File Operations',
      'spreadsheet': 'File Operations', 'staticanalysis': 'Analysis',
      'clonedetection': 'Analysis', 'import-analyzer': 'Analysis',
      'dependency-resolver': 'Analysis',
      'web': 'Automation', 'visual-editor': 'Automation',
      'taskmanager': 'Utility', 'jobdone': 'Utility',
      'agentdelay': 'Utility', 'userprompt': 'Utility',
      'memory': 'Knowledge', 'skills': 'Knowledge',
      'agentcommunication': 'Collaboration', 'help': 'System',
    };
    for (const [toolId, category] of Object.entries(expected)) {
      expect(registry._getToolCategory(toolId)).toBe(category);
    }
  });

  test('_getToolIconName returns Heroicon name for every known tool', () => {
    const known = [
      'terminal', 'filesystem', 'file-content-replace', 'seek', 'file-tree',
      'code-map', 'pdf', 'doc', 'spreadsheet', 'staticanalysis',
      'clonedetection', 'import-analyzer', 'dependency-resolver',
      'web', 'visual-editor',
      'taskmanager', 'jobdone', 'agentcommunication', 'agentdelay',
      'memory', 'skills', 'userprompt', 'help',
    ];
    for (const toolId of known) {
      const icon = registry._getToolIconName(toolId);
      expect(typeof icon).toBe('string');
      expect(icon).not.toBe('WrenchScrewdriver'); // fallback; real tools must map
      expect(icon.length).toBeGreaterThan(0);
    }
  });

  test('_getToolIconName returns WrenchScrewdriver fallback for unknown tool', () => {
    expect(registry._getToolIconName('not-a-real-tool')).toBe('WrenchScrewdriver');
  });

  test('discoverTools returns 0', async () => {
    const count = await registry.discoverTools('/some/dir');
    expect(count).toBe(0);
  });
});
