import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock dependencies before importing
jest.unstable_mockModule('../../utilities/tagParser.js', () => ({
  default: {
    extractContent: jest.fn((content, tag) => {
      const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, 'gs');
      const matches = [];
      let match;
      while ((match = regex.exec(content)) !== null) {
        matches.push(match[1]);
      }
      return matches;
    })
  }
}));

jest.unstable_mockModule('../../utilities/constants.js', () => ({
  TOOL_STATUS: { PENDING: 'pending', EXECUTING: 'executing', COMPLETED: 'completed', FAILED: 'failed' },
  SYSTEM_DEFAULTS: { MAX_PAUSE_DURATION: 300, MAX_TOOL_EXECUTION_TIME: 300000 },
  AGENT_STATUS: { ACTIVE: 'active', IDLE: 'idle', BUSY: 'busy', PAUSED: 'paused' },
  OPERATION_STATUS: { EXECUTING: 'executing', COMPLETED: 'completed', FAILED: 'failed' },
  ERROR_TYPES: {}
}));

const { default: AgentDelayTool } = await import('../agentDelayTool.js');

describe('AgentDelayTool', () => {
  let tool;
  let logger;
  let mockAgentPool;

  beforeEach(() => {
    logger = createMockLogger();
    mockAgentPool = {
      pauseAgent: jest.fn().mockResolvedValue({ success: true }),
      getAgent: jest.fn().mockResolvedValue({ id: 'agent-1', delayEndTime: null }),
      persistAgentState: jest.fn().mockResolvedValue(undefined)
    };
    tool = new AgentDelayTool({}, logger, mockAgentPool);
  });

  describe('constructor', () => {
    test('should set default pause durations', () => {
      expect(tool.maxPauseDuration).toBe(300);
      expect(tool.minPauseDuration).toBe(1);
      expect(tool.requiresProject).toBe(false);
      expect(tool.isAsync).toBe(false);
    });

    test('should accept custom durations', () => {
      const customTool = new AgentDelayTool({ maxDuration: 600, minDuration: 5 }, logger, null);
      expect(customTool.maxPauseDuration).toBe(600);
      expect(customTool.minPauseDuration).toBe(5);
    });
  });

  describe('getDescription', () => {
    test('should return description with pause range info', () => {
      const desc = tool.getDescription();
      expect(desc).toContain('Agent Delay Tool');
      expect(desc).toContain('duration');
    });
  });

  describe('getSupportedActions', () => {
    test('should return pause and delay', () => {
      const actions = tool.getSupportedActions();
      expect(actions).toContain('pause');
      expect(actions).toContain('delay');
    });
  });

  describe('getRequiredParameters', () => {
    test('should require duration', () => {
      expect(tool.getRequiredParameters()).toContain('duration');
    });
  });

  describe('parseParameters', () => {
    test('should parse duration and reason from tags', () => {
      const result = tool.parseParameters('<pause-duration>30</pause-duration><reason>Waiting</reason>');
      expect(result.duration).toBe(30);
      expect(result.reason).toBe('Waiting');
    });

    test('should default reason when not provided', () => {
      const result = tool.parseParameters('<pause-duration>60</pause-duration>');
      expect(result.duration).toBe(60);
      expect(result.reason).toBe('Agent pause requested');
    });

    test('should return null duration when not provided', () => {
      const result = tool.parseParameters('some content');
      expect(result.duration).toBeNull();
    });
  });

  describe('validateParameterTypes', () => {
    test('should accept valid params', () => {
      const result = tool.validateParameterTypes({ duration: 30, reason: 'test' });
      expect(result.valid).toBe(true);
    });

    test('should reject non-number duration', () => {
      const result = tool.validateParameterTypes({ duration: 'abc' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('valid number');
    });

    test('should reject non-string reason', () => {
      const result = tool.validateParameterTypes({ duration: 30, reason: 123 });
      expect(result.valid).toBe(false);
    });
  });

  describe('customValidateParameters', () => {
    test('should reject null duration', () => {
      const result = tool.customValidateParameters({ duration: null });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('required');
    });

    test('should reject duration below minimum', () => {
      const result = tool.customValidateParameters({ duration: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('at least');
    });

    test('should reject duration above maximum', () => {
      const result = tool.customValidateParameters({ duration: 999 });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('cannot exceed');
    });

    test('should reject non-integer duration', () => {
      const result = tool.customValidateParameters({ duration: 10.5 });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('whole number');
    });

    test('should reject reason over 200 chars', () => {
      const result = tool.customValidateParameters({ duration: 30, reason: 'x'.repeat(201) });
      expect(result.valid).toBe(false);
    });

    test('should accept valid parameters', () => {
      const result = tool.customValidateParameters({ duration: 60, reason: 'Valid reason' });
      expect(result.valid).toBe(true);
    });
  });

  describe('execute', () => {
    test('should throw when agentId is missing', async () => {
      await expect(tool.execute({ duration: 30, reason: 'test' }, {}))
        .rejects.toThrow('Agent ID is required');
    });

    test('should throw when agentPool is not available', async () => {
      tool.agentPool = null;
      await expect(tool.execute({ duration: 30, reason: 'test' }, { agentId: 'agent-1' }))
        .rejects.toThrow('Agent pool not available');
    });

    test('should successfully pause agent', async () => {
      const result = await tool.execute(
        { duration: 30, reason: 'npm install' },
        { agentId: 'agent-1' }
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe('agent-pause');
      expect(result.agentId).toBe('agent-1');
      expect(result.pauseDuration).toBe(30);
      expect(result.reason).toBe('npm install');
      expect(result.pausedUntil).toBeDefined();
      expect(mockAgentPool.pauseAgent).toHaveBeenCalled();
    });

    test('should set delayEndTime on agent', async () => {
      const mockAgent = { id: 'agent-1', delayEndTime: null };
      mockAgentPool.getAgent.mockResolvedValue(mockAgent);

      await tool.execute(
        { duration: 60, reason: 'build' },
        { agentId: 'agent-1' }
      );
      expect(mockAgent.delayEndTime).toBeDefined();
      expect(mockAgentPool.persistAgentState).toHaveBeenCalledWith('agent-1');
    });

    test('should throw when pause fails', async () => {
      mockAgentPool.pauseAgent.mockResolvedValue({ success: false, message: 'Agent not found' });

      await expect(tool.execute(
        { duration: 30, reason: 'test' },
        { agentId: 'agent-1' }
      )).rejects.toThrow('Failed to pause agent');
    });

    test('should format singular second correctly', async () => {
      const result = await tool.execute(
        { duration: 1, reason: 'brief' },
        { agentId: 'agent-1' }
      );
      expect(result.message).toBe('Agent will resume activity in 1 second');
    });

    test('should format plural seconds correctly', async () => {
      const result = await tool.execute(
        { duration: 30, reason: 'brief' },
        { agentId: 'agent-1' }
      );
      expect(result.message).toBe('Agent will resume activity in 30 seconds');
    });
  });

  describe('getCapabilities', () => {
    test('should include pause range info', () => {
      const caps = tool.getCapabilities();
      expect(caps.pauseRange).toBeDefined();
      expect(caps.pauseRange.min).toBe(1);
      expect(caps.pauseRange.max).toBe(300);
      expect(caps.affects).toBe('agent-status');
    });
  });

  describe('formatResumeTime', () => {
    test('should format seconds', () => {
      const futureDate = new Date(Date.now() + 30000);
      const result = tool.formatResumeTime(futureDate);
      expect(result).toMatch(/in \d+ seconds?/);
    });

    test('should format minutes', () => {
      const futureDate = new Date(Date.now() + 120000);
      const result = tool.formatResumeTime(futureDate);
      expect(result).toMatch(/in \d+ minutes?/);
    });

    test('should format hours', () => {
      const futureDate = new Date(Date.now() + 7200000);
      const result = tool.formatResumeTime(futureDate);
      expect(result).toMatch(/in \d+ hours?/);
    });
  });

  describe('canPauseAgent', () => {
    test('should return false when no agent pool', async () => {
      tool.agentPool = null;
      const result = await tool.canPauseAgent('agent-1');
      expect(result.canPause).toBe(false);
    });

    test('should return false when agent not found', async () => {
      mockAgentPool.getAgent.mockResolvedValue(null);
      const result = await tool.canPauseAgent('agent-1');
      expect(result.canPause).toBe(false);
      expect(result.reason).toContain('not found');
    });

    test('should return false when agent already paused', async () => {
      mockAgentPool.getAgent.mockResolvedValue({ status: 'paused', pausedUntil: 'sometime' });
      const result = await tool.canPauseAgent('agent-1');
      expect(result.canPause).toBe(false);
      expect(result.reason).toContain('already paused');
    });

    test('should return true when agent can be paused', async () => {
      mockAgentPool.getAgent.mockResolvedValue({ status: 'active' });
      const result = await tool.canPauseAgent('agent-1');
      expect(result.canPause).toBe(true);
    });

    test('should handle errors gracefully', async () => {
      mockAgentPool.getAgent.mockRejectedValue(new Error('DB error'));
      const result = await tool.canPauseAgent('agent-1');
      expect(result.canPause).toBe(false);
    });
  });

  describe('getPauseRecommendations', () => {
    test('should recommend for npm install', () => {
      const result = tool.getPauseRecommendations({ lastCommand: 'npm install' });
      expect(result.suggested.length).toBeGreaterThan(0);
      expect(result.suggested[0].duration).toBe(90);
    });

    test('should recommend for docker build', () => {
      const result = tool.getPauseRecommendations({ lastCommand: 'docker build .' });
      expect(result.suggested.length).toBeGreaterThan(0);
    });

    test('should warn about short pauses', () => {
      const result = tool.getPauseRecommendations({ requestedDuration: 5 });
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    test('should warn about long pauses', () => {
      const result = tool.getPauseRecommendations({ requestedDuration: 250 });
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    test('should return empty for no context', () => {
      const result = tool.getPauseRecommendations({});
      expect(result.suggested).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('setAgentPool', () => {
    test('should enable tool when pool is provided', () => {
      const newTool = new AgentDelayTool({}, logger, null);
      newTool.setAgentPool(mockAgentPool);
      expect(newTool.isEnabled).toBe(true);
    });

    test('should disable tool when pool is null', () => {
      tool.setAgentPool(null);
      expect(tool.isEnabled).toBe(false);
    });
  });

  describe('getUsageExamples', () => {
    test('should return array of examples', () => {
      const examples = tool.getUsageExamples();
      expect(Array.isArray(examples)).toBe(true);
      expect(examples.length).toBeGreaterThan(0);
      expect(examples[0].title).toBeDefined();
      expect(examples[0].command).toBeDefined();
    });
  });

  describe('getParameterSchema', () => {
    test('should return schema with duration and reason', () => {
      const schema = tool.getParameterSchema();
      expect(schema.properties.duration).toBeDefined();
      expect(schema.properties.reason).toBeDefined();
      expect(schema.required).toContain('duration');
    });
  });
});
