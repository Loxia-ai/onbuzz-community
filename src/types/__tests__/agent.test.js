import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { AgentValidator, AgentFactory, AgentUtils } from '../agent.js';

describe('AgentFactory', () => {
  test('create with name returns valid agent with generated id', () => {
    const agent = AgentFactory.create({ name: 'Test Agent' });

    expect(agent).toBeDefined();
    expect(typeof agent.id).toBe('string');
    expect(agent.id).toMatch(/^agent_/);
    expect(agent.name).toBe('Test Agent');
  });

  test('create sets default status to IDLE', () => {
    const agent = AgentFactory.create({ name: 'Test Agent' });
    expect(agent.status).toBe('idle');
  });

  test('create includes default metrics with all zeros', () => {
    const agent = AgentFactory.create({ name: 'Test Agent' });

    expect(agent.metrics).toBeDefined();
    expect(agent.metrics.totalMessages).toBe(0);
    expect(agent.metrics.totalTokensUsed).toBe(0);
    expect(agent.metrics.totalCost).toBe(0);
    expect(agent.metrics.averageResponseTime).toBe(0);
    expect(agent.metrics.errorCount).toBe(0);
    expect(agent.metrics.toolExecutions).toBe(0);
    expect(agent.metrics.conversationsStarted).toBe(0);
  });

  test('create includes default state', () => {
    const agent = AgentFactory.create({ name: 'Test Agent' });
    expect(agent.state).toBeDefined();
    expect(agent.state.currentConversationId).toBeNull();
    expect(agent.state.messageCount).toBe(0);
    expect(agent.state.isProcessing).toBe(false);
    expect(agent.state.lastError).toBeNull();
    expect(agent.state.activeTools).toEqual([]);
  });

  test('create uses provided type and model', () => {
    const agent = AgentFactory.create({
      name: 'Custom Agent',
      type: 'system-agent',
      model: 'anthropic-opus'
    });
    expect(agent.type).toBe('system-agent');
    expect(agent.currentModel).toBe('anthropic-opus');
  });

  test('create uses defaults when type/model not provided', () => {
    const agent = AgentFactory.create({ name: 'Default Agent' });
    expect(agent.type).toBe('user-created');
    expect(agent.currentModel).toBe('anthropic-sonnet');
  });

  test('create sets systemPrompt when provided', () => {
    const agent = AgentFactory.create({
      name: 'Prompted Agent',
      systemPrompt: 'You are a helpful assistant.'
    });
    expect(agent.systemPrompt).toBe('You are a helpful assistant.');
  });

  test('create sets empty systemPrompt by default', () => {
    const agent = AgentFactory.create({ name: 'No Prompt' });
    expect(agent.systemPrompt).toBe('');
  });

  test('create sets metadata when provided', () => {
    const agent = AgentFactory.create({ name: 'Meta', metadata: { project: 'test' } });
    expect(agent.metadata).toEqual({ project: 'test' });
  });

  test('create sets pause fields to null', () => {
    const agent = AgentFactory.create({ name: 'Agent' });
    expect(agent.pausedUntil).toBeNull();
    expect(agent.pauseReason).toBeNull();
  });

  test('create sets ISO timestamp fields', () => {
    const agent = AgentFactory.create({ name: 'Agent' });
    expect(new Date(agent.createdAt).toISOString()).toBe(agent.createdAt);
    expect(new Date(agent.updatedAt).toISOString()).toBe(agent.updatedAt);
    expect(new Date(agent.lastActivity).toISOString()).toBe(agent.lastActivity);
  });

  test('create throws for missing name', () => {
    expect(() => AgentFactory.create({})).toThrow();
  });

  test('create throws for name too short', () => {
    expect(() => AgentFactory.create({ name: 'A' })).toThrow();
  });

  test('generateAgentId returns string starting with agent_', () => {
    const id = AgentFactory.generateAgentId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^agent_/);
  });

  describe('createDefaultConfiguration', () => {
    test('returns default config shape', () => {
      const config = AgentFactory.createDefaultConfiguration();
      expect(config.maxContextLength).toBe(50000);
      expect(config.temperature).toBe(0.7);
      expect(config.maxTokens).toBe(4096);
      expect(config.timeout).toBe(30000);
      expect(config.persistConversations).toBe(true);
      expect(config.enabledTools).toEqual(['terminal', 'filesys', 'editor']);
      expect(config.autoRetry).toBe(true);
      expect(config.maxRetries).toBe(3);
    });

    test('applies overrides', () => {
      const config = AgentFactory.createDefaultConfiguration({ temperature: 0.5, maxTokens: 8192 });
      expect(config.temperature).toBe(0.5);
      expect(config.maxTokens).toBe(8192);
      expect(config.maxContextLength).toBe(50000); // unchanged default
    });
  });

  describe('clone', () => {
    test('clones agent with new name and id', () => {
      const original = AgentFactory.create({ name: 'Original' });
      const cloned = AgentFactory.clone(original, 'Cloned');

      expect(cloned.name).toBe('Cloned');
      expect(cloned.id).not.toBe(original.id);
      expect(cloned.id).toMatch(/^agent_/);
    });

    test('clone resets status to idle', () => {
      const original = AgentFactory.create({ name: 'Original' });
      original.status = 'active';
      const cloned = AgentFactory.clone(original, 'Cloned');
      expect(cloned.status).toBe('idle');
    });

    test('clone resets metrics and state', () => {
      const original = AgentFactory.create({ name: 'Original' });
      original.metrics.totalMessages = 100;
      original.state.messageCount = 50;
      const cloned = AgentFactory.clone(original, 'Cloned');
      expect(cloned.metrics.totalMessages).toBe(0);
      expect(cloned.state.messageCount).toBe(0);
    });

    test('clone resets pause fields', () => {
      const original = AgentFactory.create({ name: 'Original' });
      original.pausedUntil = '2025-01-01T00:00:00.000Z';
      original.pauseReason = 'testing';
      const cloned = AgentFactory.clone(original, 'Cloned');
      expect(cloned.pausedUntil).toBeNull();
      expect(cloned.pauseReason).toBeNull();
    });

    test('clone preserves systemPrompt and configuration', () => {
      const original = AgentFactory.create({ name: 'Original', systemPrompt: 'Test prompt' });
      const cloned = AgentFactory.clone(original, 'Cloned');
      expect(cloned.systemPrompt).toBe('Test prompt');
      expect(cloned.configuration.maxContextLength).toBe(original.configuration.maxContextLength);
    });
  });
});

describe('AgentValidator', () => {
  test('validate returns isValid=true for valid agent', () => {
    const agent = AgentFactory.create({ name: 'Valid Agent' });
    const result = AgentValidator.validate(agent);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validate returns errors for agent missing name', () => {
    const agent = { id: 'agent_123', status: 'idle' };
    const result = AgentValidator.validate(agent);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('name'))).toBe(true);
  });

  test('validate returns errors for agent missing id', () => {
    const agent = { name: 'Test', status: 'idle' };
    const result = AgentValidator.validate(agent);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('id'))).toBe(true);
  });

  test('validate returns errors for name too short', () => {
    const agent = { id: 'agent_123', name: 'A', status: 'idle' };
    const result = AgentValidator.validate(agent);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('at least 2'))).toBe(true);
  });

  test('validate returns errors for name too long', () => {
    const agent = { id: 'agent_123', name: 'A'.repeat(101), status: 'idle' };
    const result = AgentValidator.validate(agent);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('less than 100'))).toBe(true);
  });

  test('validate returns errors for invalid type', () => {
    const agent = AgentFactory.create({ name: 'Test Agent' });
    agent.type = 'invalid-type';
    const result = AgentValidator.validate(agent);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid agent type'))).toBe(true);
  });

  test('validate returns errors for invalid status', () => {
    const agent = AgentFactory.create({ name: 'Test Agent' });
    agent.status = 'invalid-status';
    const result = AgentValidator.validate(agent);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid agent status'))).toBe(true);
  });

  test('validate returns warning for unknown model', () => {
    const agent = AgentFactory.create({ name: 'Test Agent' });
    agent.currentModel = 'unknown-model-xyz';
    const result = AgentValidator.validate(agent);
    expect(result.warnings.some(w => w.includes('Unknown AI model'))).toBe(true);
  });

  test('validate returns errors for non-string systemPrompt', () => {
    const agent = AgentFactory.create({ name: 'Test Agent' });
    agent.systemPrompt = 123;
    const result = AgentValidator.validate(agent);
    expect(result.errors.some(e => e.includes('System prompt must be a string'))).toBe(true);
  });

  test('validate returns warning for very long systemPrompt', () => {
    const agent = AgentFactory.create({ name: 'Test Agent' });
    agent.systemPrompt = 'x'.repeat(10001);
    const result = AgentValidator.validate(agent);
    expect(result.warnings.some(w => w.includes('System prompt is very long'))).toBe(true);
  });

  test('validate returns errors for invalid timestamps', () => {
    const agent = AgentFactory.create({ name: 'Test Agent' });
    agent.createdAt = 'not-a-date';
    const result = AgentValidator.validate(agent);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid timestamp'))).toBe(true);
  });

  describe('validateConfiguration', () => {
    test('accepts valid configuration', () => {
      const result = AgentValidator.validateConfiguration({
        maxContextLength: 50000,
        temperature: 0.7,
        maxTokens: 4096,
        timeout: 30000,
        maxRetries: 3,
        enabledTools: ['terminal']
      });
      expect(result.errors).toHaveLength(0);
    });

    test('errors on non-number maxContextLength', () => {
      const result = AgentValidator.validateConfiguration({ maxContextLength: 'big' });
      expect(result.errors.some(e => e.includes('maxContextLength'))).toBe(true);
    });

    test('warns on low maxContextLength', () => {
      const result = AgentValidator.validateConfiguration({ maxContextLength: 500 });
      expect(result.warnings.some(w => w.includes('maxContextLength is very low'))).toBe(true);
    });

    test('errors on non-number temperature', () => {
      const result = AgentValidator.validateConfiguration({ temperature: 'warm' });
      expect(result.errors.some(e => e.includes('temperature must be a number'))).toBe(true);
    });

    test('errors on temperature out of range', () => {
      const result = AgentValidator.validateConfiguration({ temperature: 5 });
      expect(result.errors.some(e => e.includes('temperature must be between'))).toBe(true);
    });

    test('errors on non-number maxTokens', () => {
      const result = AgentValidator.validateConfiguration({ maxTokens: 'many' });
      expect(result.errors.some(e => e.includes('maxTokens'))).toBe(true);
    });

    test('errors on non-number timeout', () => {
      const result = AgentValidator.validateConfiguration({ timeout: 'slow' });
      expect(result.errors.some(e => e.includes('timeout must be a number'))).toBe(true);
    });

    test('warns on low timeout', () => {
      const result = AgentValidator.validateConfiguration({ timeout: 500 });
      expect(result.warnings.some(w => w.includes('timeout is very low'))).toBe(true);
    });

    test('errors on non-number maxRetries', () => {
      const result = AgentValidator.validateConfiguration({ maxRetries: 'three' });
      expect(result.errors.some(e => e.includes('maxRetries'))).toBe(true);
    });

    test('errors on non-array enabledTools', () => {
      const result = AgentValidator.validateConfiguration({ enabledTools: 'terminal' });
      expect(result.errors.some(e => e.includes('enabledTools must be an array'))).toBe(true);
    });
  });

  describe('validateCreationParams', () => {
    test('rejects missing name', () => {
      const result = AgentValidator.validateCreationParams({});
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('name'))).toBe(true);
    });

    test('rejects short name', () => {
      const result = AgentValidator.validateCreationParams({ name: 'A' });
      expect(result.isValid).toBe(false);
    });

    test('rejects invalid type', () => {
      const result = AgentValidator.validateCreationParams({ name: 'Test', type: 'bad-type' });
      expect(result.isValid).toBe(false);
    });

    test('warns on unknown model', () => {
      const result = AgentValidator.validateCreationParams({ name: 'Test', model: 'unknown-xyz' });
      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('Unknown AI model'))).toBe(true);
    });

    test('rejects non-string systemPrompt', () => {
      const result = AgentValidator.validateCreationParams({ name: 'Test', systemPrompt: 123 });
      expect(result.isValid).toBe(false);
    });

    test('rejects non-array enabledTools', () => {
      const result = AgentValidator.validateCreationParams({ name: 'Test', enabledTools: 'terminal' });
      expect(result.isValid).toBe(false);
    });

    test('accepts valid params', () => {
      const result = AgentValidator.validateCreationParams({ name: 'Valid Agent' });
      expect(result.isValid).toBe(true);
    });
  });

  describe('isValidTimestamp', () => {
    test('returns true for valid ISO string', () => {
      expect(AgentValidator.isValidTimestamp('2025-01-01T00:00:00.000Z')).toBe(true);
    });

    test('returns false for non-string', () => {
      expect(AgentValidator.isValidTimestamp(12345)).toBe(false);
    });

    test('returns false for invalid date string', () => {
      expect(AgentValidator.isValidTimestamp('not-a-date')).toBe(false);
    });
  });
});

describe('AgentUtils', () => {
  test('isActive returns false for idle agent', () => {
    const agent = AgentFactory.create({ name: 'Idle Agent' });
    expect(AgentUtils.isActive(agent)).toBe(false);
  });

  test('isActive returns true for active agent', () => {
    const agent = AgentFactory.create({ name: 'Active Agent' });
    agent.status = 'active';
    expect(AgentUtils.isActive(agent)).toBe(true);
  });

  test('isActive returns true for busy agent', () => {
    const agent = AgentFactory.create({ name: 'Busy Agent' });
    agent.status = 'busy';
    expect(AgentUtils.isActive(agent)).toBe(true);
  });

  describe('isPaused', () => {
    test('returns false for non-paused agent', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      expect(AgentUtils.isPaused(agent)).toBe(false);
    });

    test('returns true for paused agent without expiry', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      agent.status = 'paused';
      expect(AgentUtils.isPaused(agent)).toBe(true);
    });

    test('returns true for paused agent with future expiry', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      agent.status = 'paused';
      agent.pausedUntil = new Date(Date.now() + 60000).toISOString();
      expect(AgentUtils.isPaused(agent)).toBe(true);
    });

    test('returns false for paused agent with past expiry', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      agent.status = 'paused';
      agent.pausedUntil = new Date(Date.now() - 60000).toISOString();
      expect(AgentUtils.isPaused(agent)).toBe(false);
    });
  });

  describe('getEffectiveStatus', () => {
    test('returns idle for paused agent with expired pause', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      agent.status = 'paused';
      agent.pausedUntil = new Date(Date.now() - 60000).toISOString();
      expect(AgentUtils.getEffectiveStatus(agent)).toBe('idle');
    });

    test('returns paused for agent with future pause', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      agent.status = 'paused';
      agent.pausedUntil = new Date(Date.now() + 60000).toISOString();
      expect(AgentUtils.getEffectiveStatus(agent)).toBe('paused');
    });

    test('returns actual status for non-paused agent', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      agent.status = 'active';
      expect(AgentUtils.getEffectiveStatus(agent)).toBe('active');
    });
  });

  describe('getTimeUntilPauseExpiry', () => {
    test('returns null for non-paused agent', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      expect(AgentUtils.getTimeUntilPauseExpiry(agent)).toBeNull();
    });

    test('returns null for paused agent without pausedUntil', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      agent.status = 'paused';
      expect(AgentUtils.getTimeUntilPauseExpiry(agent)).toBeNull();
    });

    test('returns positive ms for paused agent with future expiry', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      agent.status = 'paused';
      agent.pausedUntil = new Date(Date.now() + 60000).toISOString();
      const result = AgentUtils.getTimeUntilPauseExpiry(agent);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(60000);
    });
  });

  describe('formatForDisplay', () => {
    test('returns formatted agent data', () => {
      const agent = AgentFactory.create({ name: 'Display Agent' });
      const result = AgentUtils.formatForDisplay(agent);
      expect(result.id).toBe(agent.id);
      expect(result.name).toBe('Display Agent');
      expect(result.type).toBe('user-created');
      expect(result.status).toBe('idle');
      expect(result.model).toBe('anthropic-sonnet');
      expect(result.messageCount).toBe(0);
      expect(result.lastActivity).toBeDefined();
      expect(result.isPaused).toBe(false);
      expect(result.timeUntilPauseExpiry).toBeNull();
    });
  });

  describe('sanitize', () => {
    test('removes cache and sessionData from state', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      agent.state.cache = { key: 'value' };
      agent.state.sessionData = { session: 'data' };
      const result = AgentUtils.sanitize(agent);
      expect(result.state.cache).toBeUndefined();
      expect(result.state.sessionData).toBeUndefined();
    });

    test('truncates long systemPrompt', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      agent.systemPrompt = 'x'.repeat(1000);
      const result = AgentUtils.sanitize(agent);
      expect(result.systemPrompt.length).toBeLessThanOrEqual(503); // 500 + '...'
      expect(result.systemPrompt.endsWith('...')).toBe(true);
    });

    test('preserves short systemPrompt', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      agent.systemPrompt = 'short prompt';
      const result = AgentUtils.sanitize(agent);
      expect(result.systemPrompt).toBe('short prompt');
    });

    test('preserves other agent fields', () => {
      const agent = AgentFactory.create({ name: 'Agent' });
      const result = AgentUtils.sanitize(agent);
      expect(result.id).toBe(agent.id);
      expect(result.name).toBe(agent.name);
    });
  });
});
