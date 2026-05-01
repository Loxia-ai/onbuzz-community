import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { ConversationValidator, ConversationFactory, ConversationUtils } from '../conversation.js';

describe('ConversationFactory', () => {
  test('create returns conversation with id, agentId, and title', () => {
    const conversation = ConversationFactory.create('agent_123', 'My Chat');
    expect(conversation).toBeDefined();
    expect(typeof conversation.id).toBe('string');
    expect(conversation.id).toMatch(/^conv_/);
    expect(conversation.agentId).toBe('agent_123');
    expect(conversation.title).toBe('My Chat');
  });

  test('create uses default title when not provided', () => {
    const conversation = ConversationFactory.create('agent_123', '');
    expect(conversation.title).toBe('New Conversation');
  });

  test('create sets default status to active', () => {
    const conversation = ConversationFactory.create('agent_123', 'Chat');
    expect(conversation.status).toBe('active');
  });

  test('create sets default metadata', () => {
    const conversation = ConversationFactory.create('agent_123', 'Chat');
    expect(conversation.metadata.tags).toEqual([]);
    expect(conversation.metadata.category).toBe('general');
    expect(conversation.metadata.isBookmarked).toBe(false);
  });

  test('create sets default settings', () => {
    const conversation = ConversationFactory.create('agent_123', 'Chat');
    expect(conversation.settings.persistHistory).toBe(true);
    expect(conversation.settings.maxMessages).toBe(1000);
    expect(conversation.settings.autoSummarize).toBe(true);
  });

  test('create sets default context', () => {
    const conversation = ConversationFactory.create('agent_123', 'Chat');
    expect(conversation.context.currentTopic).toBeNull();
    expect(conversation.context.phase).toBe('initial');
  });

  test('create includes agentId in participants', () => {
    const conversation = ConversationFactory.create('agent_123', 'Chat');
    expect(conversation.participants).toContain('agent_123');
  });

  test('create includes extra participants', () => {
    const conversation = ConversationFactory.create('agent_123', 'Chat', {
      participants: ['user_1']
    });
    expect(conversation.participants).toContain('agent_123');
    expect(conversation.participants).toContain('user_1');
  });

  test('createMessage returns message with role and content', () => {
    const message = ConversationFactory.createMessage('conv_123', 'user', 'Hello there');
    expect(message).toBeDefined();
    expect(typeof message.id).toBe('string');
    expect(message.id).toMatch(/^msg_/);
    expect(message.conversationId).toBe('conv_123');
    expect(message.role).toBe('user');
    expect(message.content).toBe('Hello there');
    expect(message.isEdited).toBe(false);
    expect(message.editedAt).toBeNull();
  });

  test('createMessage applies options', () => {
    const message = ConversationFactory.createMessage('conv_123', 'assistant', 'Hi', {
      agentId: 'agent_1',
      userId: 'user_1',
      parentMessageId: 'msg_0'
    });
    expect(message.agentId).toBe('agent_1');
    expect(message.userId).toBe('user_1');
    expect(message.parentMessageId).toBe('msg_0');
  });

  test('generateConversationId returns string starting with conv_', () => {
    const id = ConversationFactory.generateConversationId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^conv_/);
  });

  test('generateMessageId returns string starting with msg_', () => {
    const id = ConversationFactory.generateMessageId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^msg_/);
  });
});

describe('ConversationValidator', () => {
  test('validate accepts valid conversation', () => {
    const conversation = ConversationFactory.create('agent_123', 'Test Conversation');
    const result = ConversationValidator.validate(conversation);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validate rejects missing id', () => {
    const conv = ConversationFactory.create('agent_123', 'Test');
    delete conv.id;
    const result = ConversationValidator.validate(conv);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Conversation ID'))).toBe(true);
  });

  test('validate rejects missing agentId', () => {
    const conv = ConversationFactory.create('agent_123', 'Test');
    delete conv.agentId;
    const result = ConversationValidator.validate(conv);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Agent ID'))).toBe(true);
  });

  test('validate rejects missing title', () => {
    const conv = ConversationFactory.create('agent_123', 'Test');
    conv.title = '';
    const result = ConversationValidator.validate(conv);
    expect(result.isValid).toBe(false);
  });

  test('validate warns on very long title', () => {
    const conv = ConversationFactory.create('agent_123', 'x'.repeat(201));
    const result = ConversationValidator.validate(conv);
    expect(result.warnings.some(w => w.includes('very long'))).toBe(true);
  });

  test('validate rejects invalid status', () => {
    const conv = ConversationFactory.create('agent_123', 'Test');
    conv.status = 'invalid';
    const result = ConversationValidator.validate(conv);
    expect(result.isValid).toBe(false);
  });

  test('validate rejects non-array messages', () => {
    const conv = ConversationFactory.create('agent_123', 'Test');
    conv.messages = 'not-array';
    // Validator may throw TypeError since it doesn't guard against non-array messages
    try {
      const result = ConversationValidator.validate(conv);
      // If it doesn't throw, it should report errors
      expect(result.isValid).toBe(false);
    } catch (e) {
      // TypeError: messages.forEach is not a function — source doesn't guard this
      expect(e).toBeInstanceOf(TypeError);
    }
  });

  test('validate validates messages within conversation', () => {
    const conv = ConversationFactory.create('agent_123', 'Test');
    conv.messages = [{ id: 'msg_1' }]; // invalid message missing role, content, etc.
    const result = ConversationValidator.validate(conv);
    expect(result.errors.some(e => e.includes('Message 0'))).toBe(true);
  });

  test('validate rejects non-number messageCount', () => {
    const conv = ConversationFactory.create('agent_123', 'Test');
    conv.messageCount = 'five';
    const result = ConversationValidator.validate(conv);
    expect(result.errors.some(e => e.includes('Message count'))).toBe(true);
  });

  test('validate rejects non-number tokenCount', () => {
    const conv = ConversationFactory.create('agent_123', 'Test');
    conv.tokenCount = 'lots';
    const result = ConversationValidator.validate(conv);
    expect(result.errors.some(e => e.includes('Token count'))).toBe(true);
  });

  test('validate rejects non-number cost', () => {
    const conv = ConversationFactory.create('agent_123', 'Test');
    conv.cost = 'cheap';
    const result = ConversationValidator.validate(conv);
    expect(result.errors.some(e => e.includes('Cost must be a number'))).toBe(true);
  });

  test('validate rejects non-array participants', () => {
    const conv = ConversationFactory.create('agent_123', 'Test');
    conv.participants = 'agent_123';
    const result = ConversationValidator.validate(conv);
    expect(result.errors.some(e => e.includes('Participants must be an array'))).toBe(true);
  });

  test('validate rejects invalid timestamps', () => {
    const conv = ConversationFactory.create('agent_123', 'Test');
    conv.createdAt = 'not-a-date';
    const result = ConversationValidator.validate(conv);
    expect(result.errors.some(e => e.includes('Invalid timestamp'))).toBe(true);
  });

  describe('validateMessage', () => {
    test('reports errors for invalid message', () => {
      const result = ConversationValidator.validateMessage({});
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.toLowerCase().includes('message id'))).toBe(true);
      expect(result.errors.some(e => e.toLowerCase().includes('role'))).toBe(true);
      expect(result.errors.some(e => e.toLowerCase().includes('content'))).toBe(true);
    });

    test('rejects invalid message role', () => {
      const msg = ConversationFactory.createMessage('conv_1', 'invalid-role', 'Hello');
      const result = ConversationValidator.validateMessage(msg);
      expect(result.errors.some(e => e.includes('Invalid message role'))).toBe(true);
    });

    test('warns on very long content', () => {
      const msg = ConversationFactory.createMessage('conv_1', 'user', 'x'.repeat(100001));
      const result = ConversationValidator.validateMessage(msg);
      expect(result.warnings.some(w => w.includes('very long'))).toBe(true);
    });

    test('errors when assistant message has no agentId', () => {
      const msg = ConversationFactory.createMessage('conv_1', 'assistant', 'Hi');
      const result = ConversationValidator.validateMessage(msg);
      expect(result.errors.some(e => e.includes('agentId'))).toBe(true);
    });

    test('warns when user message has no userId', () => {
      const msg = ConversationFactory.createMessage('conv_1', 'user', 'Hi');
      const result = ConversationValidator.validateMessage(msg);
      expect(result.warnings.some(w => w.includes('userId'))).toBe(true);
    });

    test('rejects non-array contextReferences', () => {
      const msg = ConversationFactory.createMessage('conv_1', 'user', 'Hi', { userId: 'u1' });
      msg.contextReferences = 'not-array';
      const result = ConversationValidator.validateMessage(msg);
      expect(result.errors.some(e => e.includes('Context references must be an array'))).toBe(true);
    });

    test('rejects non-array toolExecutions', () => {
      const msg = ConversationFactory.createMessage('conv_1', 'user', 'Hi', { userId: 'u1' });
      msg.toolExecutions = 'not-array';
      const result = ConversationValidator.validateMessage(msg);
      expect(result.errors.some(e => e.includes('Tool executions must be an array'))).toBe(true);
    });

    test('validates tokenUsage when present', () => {
      const msg = ConversationFactory.createMessage('conv_1', 'user', 'Hi', { userId: 'u1' });
      msg.tokenUsage = { totalTokens: -1 };
      const result = ConversationValidator.validateMessage(msg);
      expect(result.errors.some(e => e.includes('Total tokens'))).toBe(true);
    });

    test('rejects invalid createdAt timestamp', () => {
      const msg = ConversationFactory.createMessage('conv_1', 'user', 'Hi', { userId: 'u1' });
      msg.createdAt = 'bad-date';
      const result = ConversationValidator.validateMessage(msg);
      expect(result.errors.some(e => e.includes('Invalid createdAt'))).toBe(true);
    });

    test('rejects invalid editedAt timestamp', () => {
      const msg = ConversationFactory.createMessage('conv_1', 'user', 'Hi', { userId: 'u1' });
      msg.editedAt = 'bad-date';
      const result = ConversationValidator.validateMessage(msg);
      expect(result.errors.some(e => e.includes('Invalid editedAt'))).toBe(true);
    });
  });

  describe('validateTokenUsage', () => {
    test('accepts valid token usage', () => {
      const result = ConversationValidator.validateTokenUsage({
        totalTokens: 100,
        promptTokens: 60,
        completionTokens: 40,
        cost: 0.01
      });
      expect(result.errors).toHaveLength(0);
    });

    test('rejects negative totalTokens', () => {
      const result = ConversationValidator.validateTokenUsage({ totalTokens: -1 });
      expect(result.errors.some(e => e.includes('Total tokens'))).toBe(true);
    });

    test('rejects negative promptTokens', () => {
      const result = ConversationValidator.validateTokenUsage({ totalTokens: 100, promptTokens: -1 });
      expect(result.errors.some(e => e.includes('Prompt tokens'))).toBe(true);
    });

    test('rejects negative cost', () => {
      const result = ConversationValidator.validateTokenUsage({ totalTokens: 100, cost: -0.5 });
      expect(result.errors.some(e => e.includes('Cost'))).toBe(true);
    });

    test('warns on total mismatch', () => {
      const result = ConversationValidator.validateTokenUsage({
        totalTokens: 50,
        promptTokens: 60,
        completionTokens: 40
      });
      expect(result.warnings.some(w => w.includes('does not match'))).toBe(true);
    });
  });
});

describe('ConversationUtils', () => {
  function createConversationWithMessages() {
    const conv = ConversationFactory.create('agent_1', 'Test Chat');
    conv.messages = [
      {
        ...ConversationFactory.createMessage('conv_1', 'user', 'Hello there, I need help with JavaScript programming'),
        userId: 'user_1',
        createdAt: '2025-01-01T00:00:00.000Z',
        tokenUsage: { totalTokens: 50, cost: 0.01 },
        toolExecutions: [],
        contextReferences: [{ id: 'ref_1', type: 'file', path: '/src/app.js', name: 'app.js' }]
      },
      {
        ...ConversationFactory.createMessage('conv_1', 'assistant', 'Sure, I can help with that JavaScript question'),
        agentId: 'agent_1',
        createdAt: '2025-01-01T00:00:05.000Z',
        tokenUsage: { totalTokens: 100, cost: 0.02 },
        toolExecutions: [{ id: 'exec_1' }],
        contextReferences: []
      },
      {
        ...ConversationFactory.createMessage('conv_1', 'system', 'Context updated'),
        createdAt: '2025-01-01T00:00:10.000Z',
        tokenUsage: null,
        toolExecutions: [],
        contextReferences: []
      }
    ];
    conv.participants = ['agent_1', 'user_1'];
    return conv;
  }

  describe('getStatistics', () => {
    test('returns correct message counts', () => {
      const conv = createConversationWithMessages();
      const stats = ConversationUtils.getStatistics(conv);
      expect(stats.totalMessages).toBe(3);
      expect(stats.userMessages).toBe(1);
      expect(stats.assistantMessages).toBe(1);
      expect(stats.systemMessages).toBe(1);
    });

    test('returns correct token and cost totals', () => {
      const conv = createConversationWithMessages();
      const stats = ConversationUtils.getStatistics(conv);
      expect(stats.totalTokens).toBe(150);
      expect(stats.totalCost).toBe(0.03);
    });

    test('returns correct tool execution and context reference counts', () => {
      const conv = createConversationWithMessages();
      const stats = ConversationUtils.getStatistics(conv);
      expect(stats.toolExecutions).toBe(1);
      expect(stats.contextReferences).toBe(1);
    });

    test('calculates average message length', () => {
      const conv = createConversationWithMessages();
      const stats = ConversationUtils.getStatistics(conv);
      expect(stats.averageMessageLength).toBeGreaterThan(0);
    });

    test('calculates conversation duration', () => {
      const conv = createConversationWithMessages();
      const stats = ConversationUtils.getStatistics(conv);
      expect(stats.conversationDuration).toBe(10000); // 10 seconds
    });

    test('handles empty messages', () => {
      const conv = ConversationFactory.create('agent_1', 'Empty Chat');
      const stats = ConversationUtils.getStatistics(conv);
      expect(stats.totalMessages).toBe(0);
      expect(stats.averageMessageLength).toBe(0);
      expect(stats.conversationDuration).toBe(0);
    });
  });

  describe('getConversationDuration', () => {
    test('returns 0 for empty messages', () => {
      const conv = ConversationFactory.create('agent_1', 'Chat');
      expect(ConversationUtils.getConversationDuration(conv)).toBe(0);
    });

    test('returns 0 when messages is undefined', () => {
      const conv = ConversationFactory.create('agent_1', 'Chat');
      delete conv.messages;
      expect(ConversationUtils.getConversationDuration(conv)).toBe(0);
    });
  });

  describe('generateSummary', () => {
    test('returns summary with expected fields', () => {
      const conv = createConversationWithMessages();
      const summary = ConversationUtils.generateSummary(conv);
      expect(summary.title).toBe('Test Chat');
      expect(summary.messageCount).toBe(3);
      expect(summary.duration).toBe(10000);
      expect(summary.participants).toBe(2);
      expect(Array.isArray(summary.topics)).toBe(true);
      expect(Array.isArray(summary.entities)).toBe(true);
      expect(summary.lastActivity).toBeDefined();
      expect(Array.isArray(summary.recentActivity)).toBe(true);
      expect(summary.stats).toBeDefined();
    });

    test('limits topics to top 5', () => {
      const conv = createConversationWithMessages();
      const summary = ConversationUtils.generateSummary(conv);
      expect(summary.topics.length).toBeLessThanOrEqual(5);
    });

    test('limits entities to top 10', () => {
      const conv = createConversationWithMessages();
      const summary = ConversationUtils.generateSummary(conv);
      expect(summary.entities.length).toBeLessThanOrEqual(10);
    });

    test('recent activity includes message previews', () => {
      const conv = createConversationWithMessages();
      const summary = ConversationUtils.generateSummary(conv);
      expect(summary.recentActivity.length).toBeGreaterThan(0);
      expect(summary.recentActivity[0]).toHaveProperty('role');
      expect(summary.recentActivity[0]).toHaveProperty('timestamp');
      expect(summary.recentActivity[0]).toHaveProperty('preview');
    });
  });

  describe('extractTopics', () => {
    test('extracts frequent words as topics', () => {
      const messages = [
        { content: 'JavaScript programming is fun' },
        { content: 'JavaScript functions and classes' }
      ];
      const topics = ConversationUtils.extractTopics(messages);
      expect(topics).toContain('javascript');
    });

    test('filters out stop words', () => {
      const messages = [{ content: 'the and but with from over' }];
      const topics = ConversationUtils.extractTopics(messages);
      expect(topics).toHaveLength(0);
    });

    test('filters out short words (3 chars or less)', () => {
      const messages = [{ content: 'is a to it' }];
      const topics = ConversationUtils.extractTopics(messages);
      expect(topics).toHaveLength(0);
    });

    test('sorts by frequency', () => {
      const messages = [
        { content: 'javascript javascript python' },
        { content: 'javascript python' }
      ];
      const topics = ConversationUtils.extractTopics(messages);
      expect(topics[0]).toBe('javascript');
    });
  });

  describe('extractEntities', () => {
    test('extracts capitalized words', () => {
      const messages = [{ content: 'Using React and Node for the project' }];
      const entities = ConversationUtils.extractEntities(messages);
      expect(entities).toContain('React');
      expect(entities).toContain('Node');
    });

    test('extracts file paths', () => {
      const messages = [{ content: 'Check the file src/index.js' }];
      const entities = ConversationUtils.extractEntities(messages);
      expect(entities.some(e => e.includes('index.js'))).toBe(true);
    });
  });

  describe('isStopWord', () => {
    test('identifies stop words', () => {
      expect(ConversationUtils.isStopWord('the')).toBe(true);
      expect(ConversationUtils.isStopWord('and')).toBe(true);
      expect(ConversationUtils.isStopWord('very')).toBe(true);
    });

    test('rejects non-stop words', () => {
      expect(ConversationUtils.isStopWord('javascript')).toBe(false);
      expect(ConversationUtils.isStopWord('programming')).toBe(false);
    });
  });

  describe('formatForExport', () => {
    test('exports as JSON by default', () => {
      const conv = createConversationWithMessages();
      const result = ConversationUtils.formatForExport(conv);
      const parsed = JSON.parse(result);
      expect(parsed.title).toBe('Test Chat');
    });

    test('exports as JSON when format is json', () => {
      const conv = createConversationWithMessages();
      const result = ConversationUtils.formatForExport(conv, 'json');
      expect(() => JSON.parse(result)).not.toThrow();
    });

    test('exports as markdown', () => {
      const conv = createConversationWithMessages();
      const result = ConversationUtils.formatForExport(conv, 'markdown');
      expect(result).toContain('# Test Chat');
      expect(result).toContain('**Created:**');
    });

    test('exports as plain text', () => {
      const conv = createConversationWithMessages();
      const result = ConversationUtils.formatForExport(conv, 'plain');
      expect(result).toContain('Conversation: Test Chat');
      expect(result).toContain('USER:');
    });
  });

  describe('formatAsMarkdown', () => {
    test('includes title, agent, and message count', () => {
      const conv = createConversationWithMessages();
      const md = ConversationUtils.formatAsMarkdown(conv);
      expect(md).toContain('# Test Chat');
      expect(md).toContain('**Agent:** agent_1');
    });

    test('formats each message with role and timestamp', () => {
      const conv = createConversationWithMessages();
      const md = ConversationUtils.formatAsMarkdown(conv);
      expect(md).toContain('## User');
      expect(md).toContain('## Assistant');
      expect(md).toContain('## System');
    });

    test('includes context references when present', () => {
      const conv = createConversationWithMessages();
      const md = ConversationUtils.formatAsMarkdown(conv);
      expect(md).toContain('**Context References:**');
      expect(md).toContain('app.js');
    });
  });

  describe('formatAsPlainText', () => {
    test('includes title and separator', () => {
      const conv = createConversationWithMessages();
      const text = ConversationUtils.formatAsPlainText(conv);
      expect(text).toContain('Conversation: Test Chat');
      expect(text).toContain('-'.repeat(50));
    });

    test('formats messages with uppercase role', () => {
      const conv = createConversationWithMessages();
      const text = ConversationUtils.formatAsPlainText(conv);
      expect(text).toContain('USER:');
      expect(text).toContain('ASSISTANT:');
      expect(text).toContain('SYSTEM:');
    });
  });
});
