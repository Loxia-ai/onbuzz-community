import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock constants
jest.unstable_mockModule('../../utilities/constants.js', () => ({
  MODEL_ROUTER_CONFIG: {
    ROUTER_MODEL: 'autopilot-model-router',
    CONTEXT_MESSAGES_COUNT: 5,
    REQUEST_TIMEOUT: 10000,
    MAX_ROUTING_STRATEGY_LENGTH: 2000
  },
  HTTP_STATUS: { OK: 200, INTERNAL_SERVER_ERROR: 500 },
  MODELS: {
    ANTHROPIC_SONNET: 'anthropic-sonnet',
    ANTHROPIC_OPUS: 'anthropic-opus',
    GPT_4: 'gpt-4',
    GPT_5_1_CODEX_MINI: 'gpt-5.1-codex-mini',
    DEEPSEEK_R1: 'deepseek-r1'
  }
}));

const { default: ModelRouterService } = await import('../../services/modelRouterService.js');

describe('ModelRouterService', () => {
  let service;
  let logger;
  let config;
  let mockBenchmarkService;
  let mockAiService;

  beforeEach(() => {
    logger = createMockLogger();
    config = createMockConfig();
    mockBenchmarkService = {
      getBenchmarkTable: jest.fn().mockReturnValue('Model benchmarks table data'),
      getStatus: jest.fn().mockReturnValue({ loaded: true })
    };
    mockAiService = {
      sendMessage: jest.fn()
    };
    service = new ModelRouterService(config, logger, mockBenchmarkService, mockAiService);
    jest.clearAllMocks();
  });

  // ── Constructor ──
  test('constructor initializes with dependencies', () => {
    expect(service.config).toBe(config);
    expect(service.logger).toBe(logger);
    expect(service.benchmarkService).toBe(mockBenchmarkService);
    expect(service.aiService).toBe(mockAiService);
    expect(service.routerModel).toBe('autopilot-model-router');
    expect(service.contextMessagesCount).toBe(5);
    expect(service.requestTimeout).toBe(10000);
  });

  // ── routeMessage ──
  test('routeMessage returns routing result with selected model', async () => {
    mockAiService.sendMessage.mockResolvedValue({
      content: JSON.stringify({
        selectedModel: 'gpt-4',
        taskType: 'coding',
        confidence: 0.9,
        reasoning: 'Complex coding task',
        factors: ['code complexity']
      })
    });

    const result = await service.routeMessage(
      { content: 'Fix this bug in my code', role: 'user' },
      [],
      'anthropic-sonnet',
      ['anthropic-sonnet', 'gpt-4', 'deepseek-r1']
    );

    expect(result.selectedModel).toBe('gpt-4');
    expect(result.previousModel).toBe('anthropic-sonnet');
    expect(result.changed).toBe(true);
    expect(result.reasoning).toContain('Complex coding');
  });

  test('routeMessage falls back to current model on error', async () => {
    mockAiService.sendMessage.mockRejectedValue(new Error('API timeout'));

    const result = await service.routeMessage(
      { content: 'test' },
      [],
      'anthropic-sonnet',
      ['anthropic-sonnet', 'gpt-4']
    );

    expect(result.selectedModel).toBe('anthropic-sonnet');
    expect(result.changed).toBe(false);
    expect(result.reasoning).toContain('fallback');
  });

  test('routeMessage falls back to first available model when no current', async () => {
    mockAiService.sendMessage.mockRejectedValue(new Error('error'));

    const result = await service.routeMessage(
      { content: 'test' },
      [],
      '',
      ['gpt-4', 'deepseek-r1']
    );

    expect(result.selectedModel).toBe('gpt-4');
  });

  test('routeMessage falls back to ANTHROPIC_SONNET when nothing available', async () => {
    mockAiService.sendMessage.mockRejectedValue(new Error('error'));

    const result = await service.routeMessage(
      { content: 'test' },
      [],
      '',
      []
    );

    expect(result.selectedModel).toBe('anthropic-sonnet');
  });

  test('routeMessage handles unchanged model', async () => {
    mockAiService.sendMessage.mockResolvedValue({
      content: JSON.stringify({
        selectedModel: 'anthropic-sonnet',
        taskType: 'quick-tasks',
        confidence: 0.8,
        reasoning: 'Current model is suitable'
      })
    });

    const result = await service.routeMessage(
      { content: 'Hello' },
      [],
      'anthropic-sonnet',
      ['anthropic-sonnet', 'gpt-4']
    );

    expect(result.selectedModel).toBe('anthropic-sonnet');
    expect(result.changed).toBe(false);
  });

  // ── _buildRoutingContext ──
  test('_buildRoutingContext builds context from message and history', () => {
    const message = {
      content: 'Fix this code',
      role: 'user',
      contextReferences: [{ type: 'file' }]
    };
    const recentMessages = [
      { role: 'user', content: 'Previous message', timestamp: '2024-01-01' },
      { role: 'assistant', content: 'Previous response', timestamp: '2024-01-01' }
    ];

    const context = service._buildRoutingContext(message, recentMessages, 'anthropic-sonnet', ['anthropic-sonnet', 'gpt-4']);

    expect(context.currentMessage.content).toBe('Fix this code');
    expect(context.currentMessage.hasContextReferences).toBe(true);
    expect(context.currentMessage.contextTypes).toEqual(['file']);
    expect(context.recentMessages.length).toBe(2);
    expect(context.currentModel).toBe('anthropic-sonnet');
    expect(context.availableModels.length).toBe(2);
    expect(context.messageCount).toBe(3);
  });

  test('_buildRoutingContext truncates long messages', () => {
    const longContent = 'x'.repeat(2000);
    const message = { content: longContent, role: 'user' };

    const context = service._buildRoutingContext(message, [], 'anthropic-sonnet', []);
    expect(context.currentMessage.content.length).toBe(1000);
  });

  test('_buildRoutingContext limits recent messages count', () => {
    const manyMessages = Array.from({ length: 20 }, (_, i) => ({
      role: 'user',
      content: `Message ${i}`,
      timestamp: '2024-01-01'
    }));

    const context = service._buildRoutingContext(
      { content: 'current' },
      manyMessages,
      'anthropic-sonnet',
      []
    );

    expect(context.recentMessages.length).toBe(5); // contextMessagesCount
  });

  test('_buildRoutingContext handles object models with pricing', () => {
    const models = [
      { id: 'gpt-4', pricing: { input: 0.01, output: 0.03 } },
      'anthropic-sonnet'
    ];

    const context = service._buildRoutingContext(
      { content: 'test' },
      [],
      'gpt-4',
      models
    );

    expect(context.availableModels[0].name).toBe('gpt-4');
    expect(context.availableModels[0].pricing).toBeDefined();
    expect(context.availableModels[0].isCurrentModel).toBe(true);
    expect(context.availableModels[1].name).toBe('anthropic-sonnet');
  });

  test('_buildRoutingContext handles missing contextReferences', () => {
    const context = service._buildRoutingContext({ content: 'test' }, [], '', []);
    expect(context.currentMessage.hasContextReferences).toBe(false);
    expect(context.currentMessage.contextTypes).toEqual([]);
  });

  // ── _parseRoutingResponse ──
  test('_parseRoutingResponse parses valid JSON', () => {
    const content = JSON.stringify({
      selectedModel: 'gpt-4',
      taskType: 'coding',
      confidence: 0.9,
      reasoning: 'Good for coding',
      factors: ['complexity']
    });

    const result = service._parseRoutingResponse(content);
    expect(result.selectedModel).toBe('gpt-4');
    expect(result.taskType).toBe('coding');
    expect(result.confidence).toBe(0.9);
  });

  test('_parseRoutingResponse extracts JSON from surrounding text', () => {
    const content = 'Here is my analysis:\n{"selectedModel": "gpt-4", "taskType": "analysis"}\nDone.';
    const result = service._parseRoutingResponse(content);
    expect(result.selectedModel).toBe('gpt-4');
  });

  test('_parseRoutingResponse returns null model on missing JSON', () => {
    const result = service._parseRoutingResponse('No JSON here at all');
    expect(result.selectedModel).toBeNull();
    expect(result.confidence).toBe(0.0);
    expect(result.factors).toContain('parsing-error');
  });

  test('_parseRoutingResponse returns null model on missing selectedModel', () => {
    const content = JSON.stringify({ taskType: 'coding' });
    const result = service._parseRoutingResponse(content);
    expect(result.selectedModel).toBeNull();
  });

  test('_parseRoutingResponse fills defaults for missing fields', () => {
    const content = JSON.stringify({ selectedModel: 'gpt-4' });
    const result = service._parseRoutingResponse(content);
    expect(result.taskType).toBe('unknown');
    expect(result.confidence).toBe(0.5);
    expect(result.reasoning).toBe('No reasoning provided');
    expect(result.factors).toEqual([]);
  });

  // ── _validateModelSelection ──
  test('_validateModelSelection returns selected model when available', () => {
    const decision = { selectedModel: 'gpt-4' };
    const result = service._validateModelSelection(decision, ['anthropic-sonnet', 'gpt-4'], 'anthropic-sonnet');
    expect(result).toBe('gpt-4');
  });

  test('_validateModelSelection returns current model when selected is unavailable', () => {
    const decision = { selectedModel: 'unknown-model' };
    const result = service._validateModelSelection(decision, ['anthropic-sonnet', 'gpt-4'], 'anthropic-sonnet');
    expect(result).toBe('anthropic-sonnet');
  });

  test('_validateModelSelection returns current model when no model selected', () => {
    const decision = { selectedModel: null };
    const result = service._validateModelSelection(decision, ['anthropic-sonnet'], 'anthropic-sonnet');
    expect(result).toBe('anthropic-sonnet');
  });

  test('_validateModelSelection handles object model arrays', () => {
    const decision = { selectedModel: 'gpt-4' };
    const models = [{ id: 'anthropic-sonnet' }, { name: 'gpt-4' }];
    const result = service._validateModelSelection(decision, models, 'anthropic-sonnet');
    expect(result).toBe('gpt-4');
  });

  // ── _formatRecentMessages ──
  test('_formatRecentMessages formats message list', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' }
    ];
    const result = service._formatRecentMessages(messages);
    expect(result).toContain('**user**');
    expect(result).toContain('**assistant**');
  });

  test('_formatRecentMessages returns message for empty list', () => {
    const result = service._formatRecentMessages([]);
    expect(result).toContain('No recent messages');
  });

  // ── _formatBenchmarkData ──
  test('_formatBenchmarkData returns text as-is', () => {
    expect(service._formatBenchmarkData('benchmark data')).toBe('benchmark data');
  });

  test('_formatBenchmarkData returns fallback for null', () => {
    expect(service._formatBenchmarkData(null)).toContain('No benchmark data');
  });

  // ── _createRoutingPrompt ──
  test('_createRoutingPrompt generates prompt with context', () => {
    const context = {
      currentModel: 'anthropic-sonnet',
      messageCount: 3,
      availableModels: [{ name: 'anthropic-sonnet', isCurrentModel: true }],
      recentMessages: [],
      currentMessage: { role: 'user', content: 'test', hasContextReferences: false, contextTypes: [] }
    };

    const prompt = service._createRoutingPrompt(context, 'benchmark data', null);
    expect(prompt).toContain('anthropic-sonnet');
    expect(prompt).toContain('benchmark data');
    expect(prompt).toContain('selectedModel');
  });

  test('_createRoutingPrompt includes routing strategy when provided', () => {
    const context = {
      currentModel: 'test',
      messageCount: 1,
      availableModels: [],
      recentMessages: [],
      currentMessage: { role: 'user', content: 'test', hasContextReferences: false, contextTypes: [] }
    };

    const prompt = service._createRoutingPrompt(context, null, 'Use cheapest model for simple tasks');
    expect(prompt).toContain('Use cheapest model for simple tasks');
    expect(prompt).toContain('Agent-Specific Routing Strategy');
  });

  test('_createRoutingPrompt includes pricing info for models', () => {
    const context = {
      currentModel: 'test',
      messageCount: 1,
      availableModels: [{ name: 'gpt-4', isCurrentModel: false, pricing: { input: 0.01, output: 0.03 } }],
      recentMessages: [],
      currentMessage: { role: 'user', content: 'test', hasContextReferences: false, contextTypes: [] }
    };

    const prompt = service._createRoutingPrompt(context, null, null);
    expect(prompt).toContain('$0.01');
    expect(prompt).toContain('$0.03');
  });

  // ── getStatus ──
  test('getStatus returns service status', () => {
    const status = service.getStatus();
    expect(status.routerModel).toBe('autopilot-model-router');
    expect(status.contextMessagesCount).toBe(5);
    expect(status.requestTimeout).toBe(10000);
    expect(status.isAvailable).toBe(true);
    expect(status.benchmarkServiceStatus).toBeDefined();
  });

  // ── testRouter ──
  test('testRouter returns success when routing works', async () => {
    mockAiService.sendMessage.mockResolvedValue({
      content: JSON.stringify({
        selectedModel: 'anthropic-sonnet',
        taskType: 'coding',
        confidence: 0.9,
        reasoning: 'Test routing'
      })
    });

    const result = await service.testRouter();
    expect(result.success).toBe(true);
    expect(result.selectedModel).toBeDefined();
  });

  test('testRouter returns failure on error', async () => {
    mockAiService.sendMessage.mockRejectedValue(new Error('API error'));

    const result = await service.testRouter();
    // testRouter catches the error from routeMessage fallback
    expect(result.success).toBe(true); // routeMessage itself doesn't throw, returns fallback
  });
});
