import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock prompt service
const mockPromptService = {
  createPromptRequest: jest.fn(),
  formatResponseAsMessage: jest.fn().mockReturnValue('Formatted response')
};

jest.unstable_mockModule('../../services/promptService.js', () => ({
  getPromptService: jest.fn().mockReturnValue(mockPromptService)
}));

const { default: UserPromptTool } = await import('../userPromptTool.js');

describe('UserPromptTool', () => {
  let tool;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    tool = new UserPromptTool({}, logger);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should set correct metadata', () => {
      expect(tool.requiresProject).toBe(false);
      expect(tool.isAsync).toBe(false);
      expect(tool.timeout).toBe(300000); // 5 minutes
      expect(tool.agentPool).toBeNull();
      expect(tool.webSocketManager).toBeNull();
    });
  });

  describe('getDescription', () => {
    test('should return description with usage info', () => {
      const desc = tool.getDescription();
      expect(desc).toContain('User Prompt Tool');
      expect(desc).toContain('questions');
      expect(desc).toContain('options');
    });
  });

  describe('parseParameters', () => {
    test('should return content as-is', () => {
      const result = tool.parseParameters('test');
      expect(result).toBe('test');
    });
  });

  describe('getRequiredParameters', () => {
    test('should require questions', () => {
      expect(tool.getRequiredParameters()).toContain('questions');
    });
  });

  describe('getSupportedActions', () => {
    test('should include prompt and ask actions', () => {
      const actions = tool.getSupportedActions();
      expect(actions).toContain('prompt');
      expect(actions).toContain('ask');
      expect(actions).toContain('question');
    });
  });

  describe('validateParameterTypes', () => {
    test('should accept valid params', () => {
      const result = tool.validateParameterTypes({
        message: 'Context',
        questions: [{ message: 'Question?' }]
      });
      expect(result.valid).toBe(true);
    });

    test('should reject non-string message', () => {
      const result = tool.validateParameterTypes({ message: 123 });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('message must be a string');
    });

    test('should reject non-array questions', () => {
      const result = tool.validateParameterTypes({ questions: 'not-array' });
      expect(result.valid).toBe(false);
    });
  });

  describe('customValidateParameters', () => {
    test('should reject empty questions', () => {
      const result = tool.customValidateParameters({ questions: [] });
      expect(result.valid).toBe(false);
    });

    test('should reject more than 5 questions', () => {
      const questions = Array(6).fill({ message: 'Q' });
      const result = tool.customValidateParameters({ questions });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Maximum 5');
    });

    test('should reject question without message', () => {
      const result = tool.customValidateParameters({ questions: [{ options: ['A'] }] });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('message is required');
    });

    test('should reject long context message', () => {
      const result = tool.customValidateParameters({
        message: 'x'.repeat(501),
        questions: [{ message: 'Q?' }]
      });
      expect(result.valid).toBe(false);
    });

    test('should accept valid params', () => {
      const result = tool.customValidateParameters({
        questions: [{ message: 'Question?' }]
      });
      expect(result.valid).toBe(true);
    });

    test('should accept question with "question" field instead of "message"', () => {
      const result = tool.customValidateParameters({
        questions: [{ question: 'Question?' }]
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('execute', () => {
    test('should throw when agentId is missing', async () => {
      await expect(tool.execute(
        { questions: [{ message: 'Q?' }] },
        {}
      )).rejects.toThrow('Agent ID is required');
    });

    test('should throw when webSocketManager is not set', async () => {
      await expect(tool.execute(
        { questions: [{ message: 'Q?' }] },
        { agentId: 'agent-1' }
      )).rejects.toThrow('WebSocket manager not available');
    });

    test('should send prompt and return response on success', async () => {
      const mockWs = { broadcastToSession: jest.fn() };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue({ id: 'agent-1', mode: 'agent', awaitingUserInput: null }),
        persistAgentState: jest.fn().mockResolvedValue(undefined)
      };

      tool.setWebSocketManager(mockWs);
      tool.setAgentPool(mockPool);

      mockPromptService.createPromptRequest.mockReturnValue({
        requestInfo: {
          requestId: 'req-1',
          message: 'Context',
          questions: [{ message: 'Q?' }],
          timeoutAt: new Date().toISOString()
        },
        promise: Promise.resolve({ response: { q1: 'Answer' } })
      });

      const result = await tool.execute(
        { message: 'Context', questions: [{ message: 'Q?' }] },
        { agentId: 'agent-1', sessionId: 'sess-1' }
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('prompt');
      expect(result.formattedResponse).toBe('Formatted response');
      expect(mockWs.broadcastToSession).toHaveBeenCalled();
    });

    test('should handle timeout error', async () => {
      const mockWs = { broadcastToSession: jest.fn() };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue({ id: 'agent-1', mode: 'agent' }),
        persistAgentState: jest.fn().mockResolvedValue(undefined)
      };

      tool.setWebSocketManager(mockWs);
      tool.setAgentPool(mockPool);

      mockPromptService.createPromptRequest.mockReturnValue({
        requestInfo: {
          requestId: 'req-1',
          message: 'Context',
          questions: [{ message: 'Q?' }],
          timeoutAt: new Date().toISOString()
        },
        promise: Promise.reject(new Error('Request timed out'))
      });

      const result = await tool.execute(
        { questions: [{ message: 'Q?' }] },
        { agentId: 'agent-1', sessionId: 'sess-1' }
      );

      expect(result.success).toBe(false);
      expect(result.error.toLowerCase()).toMatch(/timed?\s*out|timeout|not respond/);
    });

    test('should handle cancellation', async () => {
      const mockWs = { broadcastToSession: jest.fn() };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue({ id: 'agent-1', mode: 'agent' }),
        persistAgentState: jest.fn().mockResolvedValue(undefined)
      };

      tool.setWebSocketManager(mockWs);
      tool.setAgentPool(mockPool);

      mockPromptService.createPromptRequest.mockReturnValue({
        requestInfo: {
          requestId: 'req-1',
          message: null,
          questions: [{ message: 'Q?' }],
          timeoutAt: new Date().toISOString()
        },
        promise: Promise.reject(new Error('Request cancelled'))
      });

      const result = await tool.execute(
        { questions: [{ message: 'Q?' }] },
        { agentId: 'agent-1', sessionId: 'sess-1' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');
    });

    test('should rethrow unexpected errors', async () => {
      const mockWs = { broadcastToSession: jest.fn() };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue({ id: 'agent-1', mode: 'agent' }),
        persistAgentState: jest.fn().mockResolvedValue(undefined)
      };

      tool.setWebSocketManager(mockWs);
      tool.setAgentPool(mockPool);

      mockPromptService.createPromptRequest.mockReturnValue({
        requestInfo: {
          requestId: 'req-1',
          message: null,
          questions: [],
          timeoutAt: new Date().toISOString()
        },
        promise: Promise.reject(new Error('Unexpected failure'))
      });

      await expect(tool.execute(
        { questions: [{ message: 'Q?' }] },
        { agentId: 'agent-1', sessionId: 'sess-1' }
      )).rejects.toThrow('Unexpected failure');
    });
  });

  describe('setAgentPool', () => {
    test('should store agent pool', () => {
      const pool = { getAgent: jest.fn() };
      tool.setAgentPool(pool);
      expect(tool.agentPool).toBe(pool);
    });
  });

  describe('setWebSocketManager', () => {
    test('should enable tool when ws manager is provided', () => {
      tool.setWebSocketManager({ broadcastToSession: jest.fn() });
      expect(tool.isEnabled).toBe(true);
    });

    test('should disable tool when ws manager is null', () => {
      tool.setWebSocketManager(null);
      expect(tool.isEnabled).toBe(false);
    });
  });

  describe('getCapabilities', () => {
    test('should include pausesAgent and requiresUI', () => {
      const caps = tool.getCapabilities();
      expect(caps.pausesAgent).toBe(true);
      expect(caps.requiresUI).toBe(true);
    });
  });

  describe('getParameterSchema', () => {
    test('should return schema with questions', () => {
      const schema = tool.getParameterSchema();
      expect(schema.required).toContain('questions');
      expect(schema.properties.questions).toBeDefined();
      expect(schema.properties.message).toBeDefined();
    });
  });
});
