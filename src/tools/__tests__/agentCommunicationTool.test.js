import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock fs (promises) and crypto BEFORE importing the tool
const fsMock = {
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue('{}'),
  writeFile: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 100 }),
  copyFile: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined)
};

jest.unstable_mockModule('fs', () => ({
  default: { promises: fsMock },
  promises: fsMock
}));

// randomBytes is consumed by _generateMessageId / _generateConversationId
// as `msg-${Date.now()}-${randomBytes(4).toString('hex')}`. A constant
// 'mockrandom' caused two IDs generated in the same millisecond to
// collide, which made `rejects reply when conversation depth limit
// reached` flake: reply1.messageId could equal sendResult.messageId, so
// the "second" reply was actually replying to the original message and
// the depth counter never advanced. An incrementing counter keeps each
// generated id distinct while still being fully deterministic per run.
let __mockRandomBytesCounter = 0;
jest.unstable_mockModule('crypto', () => ({
  default: {
    randomUUID: jest.fn(() => 'mock-crypto-uuid'),
    randomBytes: jest.fn(() => ({
      toString: () => `mockrandom${++__mockRandomBytesCounter}`,
    })),
  },
}));

const { default: AgentCommunicationTool } = await import('../agentCommunicationTool.js');

/**
 * Helper: builds a tool, agent pool, and context for tests.
 */
function createTestSetup() {
  const logger = createMockLogger();
  const tool = new AgentCommunicationTool({ storageDir: '/tmp/msg-test' });
  tool.logger = logger;

  const senderAgent = {
    id: 'agent-sender',
    name: 'Sender Agent',
    type: 'developer',
    capabilities: ['code'],
    status: 'active',
    isPaused: false,
    conversations: { full: { messages: [], lastUpdated: '' } },
    currentModel: null
  };

  const recipientAgent = {
    id: 'agent-recipient',
    name: 'Recipient Agent',
    type: 'reviewer',
    capabilities: ['review'],
    status: 'active',
    isPaused: false,
    conversations: { full: { messages: [], lastUpdated: '' } },
    currentModel: null
  };

  const agents = new Map();
  agents.set('agent-sender', senderAgent);
  agents.set('agent-recipient', recipientAgent);

  const agentPool = {
    getAgent: jest.fn((id) => Promise.resolve(agents.get(id) || null)),
    listActiveAgents: jest.fn().mockResolvedValue([senderAgent, recipientAgent]),
    notifyAgent: jest.fn().mockResolvedValue(undefined),
    persistAgentState: jest.fn().mockResolvedValue(undefined),
    updateAgent: jest.fn().mockResolvedValue(undefined),
    addInterAgentMessage: jest.fn().mockResolvedValue(undefined)
  };

  const context = {
    agentId: 'agent-sender',
    agentPool,
    projectDir: '/tmp/test'
  };

  return { tool, senderAgent, recipientAgent, agentPool, context, logger };
}

describe('AgentCommunicationTool', () => {
  // ── constructor ─────────────────────────────────────────────────
  describe('constructor', () => {
    test('initializes with default config values', () => {
      const tool = new AgentCommunicationTool();
      expect(tool.config.maxConversationDepth).toBe(10);
      expect(tool.config.maxRecipientsPerMessage).toBe(3);
      expect(tool.messages).toBeInstanceOf(Map);
      expect(tool.conversations).toBeInstanceOf(Map);
    });

    test('accepts custom config overrides', () => {
      const tool = new AgentCommunicationTool({ maxConversationDepth: 5 });
      expect(tool.config.maxConversationDepth).toBe(5);
    });
  });

  // ── getDescription ──────────────────────────────────────────────
  describe('getDescription', () => {
    test('returns description with action list', () => {
      const tool = new AgentCommunicationTool();
      const desc = tool.getDescription();
      expect(desc).toContain('get-available-agents');
      expect(desc).toContain('send-message');
      expect(desc).toContain('reply-to-message');
    });
  });

  // ── parseParameters ─────────────────────────────────────────────
  describe('parseParameters', () => {
    test('parses object with actions array', () => {
      const tool = new AgentCommunicationTool();
      const result = tool.parseParameters({
        actions: [{ type: 'get-available-agents' }]
      });
      expect(result.action).toBe('get-available-agents');
    });

    test('parses object with action field', () => {
      const tool = new AgentCommunicationTool();
      const result = tool.parseParameters({ action: 'send-message', subject: 'Hi' });
      expect(result.action).toBe('send-message');
    });

    test('parses JSON string', () => {
      const tool = new AgentCommunicationTool();
      const result = tool.parseParameters('{"action": "get-available-agents"}');
      expect(result.action).toBe('get-available-agents');
    });

    test('parses XML-style content', () => {
      const tool = new AgentCommunicationTool();
      const result = tool.parseParameters('<action>send-message</action><subject>Hello</subject>');
      expect(result.action).toBe('send-message');
      expect(result.subject).toBe('Hello');
    });

    test('returns empty object for null input', () => {
      const tool = new AgentCommunicationTool();
      const result = tool.parseParameters(null);
      expect(result).toEqual({});
    });
  });

  // ── execute - missing action ────────────────────────────────────
  describe('execute - missing params', () => {
    test('throws when action is missing', async () => {
      const { tool, context } = createTestSetup();
      await expect(tool.execute({}, context)).rejects.toThrow('Action parameter is required');
    });

    test('throws when agentId is missing from context', async () => {
      const { tool } = createTestSetup();
      await expect(tool.execute({ action: 'get-available-agents' }, {}))
        .rejects.toThrow('Agent ID is required');
    });

    test('throws for unknown action', async () => {
      const { tool, context } = createTestSetup();
      await expect(tool.execute({ action: 'teleport' }, context))
        .rejects.toThrow('Unknown action');
    });
  });

  // ── get-available-agents ────────────────────────────────────────
  describe('execute - get-available-agents', () => {
    test('returns list excluding requesting agent', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'get-available-agents' }, context);
      expect(result.success).toBe(true);
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].id).toBe('agent-recipient');
    });

    test('includes message stats for each agent', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'get-available-agents' }, context);
      expect(result.agents[0].messageStats).toBeDefined();
    });

    test('returns error when agentPool missing', async () => {
      const { tool } = createTestSetup();
      const result = await tool.execute(
        { action: 'get-available-agents' },
        { agentId: 'agent-sender', agentPool: null }
      );
      // Should catch internally and return success: false
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ── send-message ────────────────────────────────────────────────
  describe('execute - send-message', () => {
    test('sends message to recipient successfully', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'Review code',
        message: 'Please review the auth module'
      }, context);
      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.conversationId).toBeDefined();
      expect(result.recipients).toContain('agent-recipient');
    });

    test('errors when subject is missing', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        message: 'No subject'
      }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Subject and message are required');
    });

    test('errors when message is missing', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'No body'
      }, context);
      expect(result.success).toBe(false);
    });

    test('errors when no recipient provided', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        action: 'send-message',
        subject: 'Test',
        message: 'Hello'
      }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('At least one recipient');
    });

    test('returns suggestions when recipient not found', async () => {
      const { tool, context, agentPool } = createTestSetup();
      // Mock _canSendMessage to allow (bypass delay check)
      tool._canSendMessage = jest.fn().mockResolvedValue({ allowed: true });
      const result = await tool.execute({
        action: 'send-message',
        recipient: 'agent-nonexistent',
        subject: 'Test',
        message: 'Hello'
      }, context);
      expect(result.success).toBe(false);
      expect(result.suggestion).toBeDefined();
    });

    test('updates message counts after sending', async () => {
      const { tool, context } = createTestSetup();
      await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'Test',
        message: 'Content'
      }, context);
      const senderStats = tool.agentMessageCounts.get('agent-sender');
      expect(senderStats.sent).toBe(1);
    });

    test('honors documented requiresReply camelCase field', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'FYI',
        message: 'No reply needed',
        requiresReply: false
      }, context);

      expect(result.success).toBe(true);
      expect(tool.messages.get(result.messageId).requiresReply).toBe(false);
    });
  });

  // ── reply-to-message ────────────────────────────────────────────
  describe('execute - reply-to-message', () => {
    test('replies to an existing message', async () => {
      const { tool, context } = createTestSetup();
      // Send initial message
      const sendResult = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'Question',
        message: 'What is the status?'
      }, context);
      const msgId = sendResult.messageId;

      // Reply as recipient
      const replyResult = await tool.execute({
        action: 'reply-to-message',
        'message-id': msgId,
        message: 'All good!'
      }, { agentId: 'agent-recipient', agentPool: context.agentPool });
      expect(replyResult.success).toBe(true);
      expect(replyResult.depth).toBe(1);
    });

    test('accepts documented messageId camelCase field', async () => {
      const { tool, context } = createTestSetup();
      const sendResult = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'Question',
        message: 'What is the status?'
      }, context);

      const replyResult = await tool.execute({
        action: 'reply-to-message',
        messageId: sendResult.messageId,
        message: 'All good!'
      }, { agentId: 'agent-recipient', agentPool: context.agentPool });

      expect(replyResult.success).toBe(true);
      expect(replyResult.depth).toBe(1);
    });

    test('accepts documented ccRecipients and markResolved camelCase fields', async () => {
      const { tool, context } = createTestSetup();
      const sendResult = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'Question',
        message: 'What is the status?'
      }, context);

      const replyResult = await tool.execute({
        action: 'reply-to-message',
        messageId: sendResult.messageId,
        message: 'Done',
        ccRecipients: ['agent-observer'],
        markResolved: true
      }, { agentId: 'agent-recipient', agentPool: context.agentPool });

      expect(replyResult.success).toBe(true);
      expect(replyResult.recipients).toEqual(
        expect.arrayContaining(['agent-sender', 'agent-observer'])
      );
      expect(replyResult.conversationStatus).toBe('resolved');
      expect(tool.messages.get(replyResult.messageId).requiresReply).toBe(false);
    });

    test('errors when original message ID missing', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        action: 'reply-to-message',
        message: 'Reply without ID'
      }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Original message ID and reply content are required');
    });

    test('errors when original message not found', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        action: 'reply-to-message',
        'message-id': 'msg-nonexistent',
        message: 'Reply'
      }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Original message not found');
    });

    test('errors when sender is not a participant', async () => {
      const { tool, context, agentPool } = createTestSetup();
      // Send message between sender and recipient
      const sendResult = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'Private',
        message: 'Secret'
      }, context);

      // Try to reply as an outsider
      const outsider = {
        id: 'agent-outsider', name: 'Outsider', conversations: { full: { messages: [] } }
      };
      agentPool.getAgent.mockImplementation((id) => {
        if (id === 'agent-outsider') return Promise.resolve(outsider);
        if (id === 'agent-sender') return Promise.resolve(context.agentPool);
        return Promise.resolve(null);
      });

      const result = await tool.execute({
        action: 'reply-to-message',
        'message-id': sendResult.messageId,
        message: 'Eavesdrop'
      }, { agentId: 'agent-outsider', agentPool });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not a participant');
    });

    test('rejects reply when conversation depth limit reached', async () => {
      const { tool, context } = createTestSetup();
      tool.config.maxConversationDepth = 1;

      const sendResult = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'Deep',
        message: 'Start'
      }, context);

      // First reply (depth 1) - should succeed
      const reply1 = await tool.execute({
        action: 'reply-to-message',
        'message-id': sendResult.messageId,
        message: 'Reply 1'
      }, { agentId: 'agent-recipient', agentPool: context.agentPool });
      expect(reply1.success).toBe(true);

      // Second reply (depth 2) should fail at depth limit 1
      const reply2 = await tool.execute({
        action: 'reply-to-message',
        'message-id': reply1.messageId,
        message: 'Reply 2'
      }, context);
      expect(reply2.success).toBe(false);
      expect(reply2.error).toContain('depth limit');
    });
  });

  // ── get-unreplied-messages ──────────────────────────────────────
  describe('execute - get-unreplied-messages', () => {
    test('returns unreplied messages for agent', async () => {
      const { tool, context } = createTestSetup();
      // Send message requiring reply
      await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'Need reply',
        message: 'Please respond',
        'requires-reply': true
      }, context);

      const result = await tool.execute(
        { action: 'get-unreplied-messages' },
        { agentId: 'agent-recipient', agentPool: context.agentPool }
      );
      expect(result.success).toBe(true);
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].subject).toBe('Need reply');
    });

    test('returns empty list when no messages', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute(
        { action: 'get-unreplied-messages' },
        { agentId: 'agent-recipient', agentPool: context.agentPool }
      );
      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(0);
    });

    test('accepts documented includeLowPriority and maxAgeHours camelCase fields', async () => {
      const { tool, context } = createTestSetup();
      const sendResult = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'Old low priority',
        message: 'Please respond eventually',
        priority: 'low',
        requiresReply: true
      }, context);

      const thirtyHoursAgo = new Date(Date.now() - 30 * 3600000).toISOString();
      tool.messages.get(sendResult.messageId).timestamp = thirtyHoursAgo;

      const result = await tool.execute(
        {
          action: 'get-unreplied-messages',
          includeLowPriority: true,
          maxAgeHours: 48
        },
        { agentId: 'agent-recipient', agentPool: context.agentPool }
      );

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].subject).toBe('Old low priority');
    });
  });

  // ── mark-conversation-ended ─────────────────────────────────────
  describe('execute - mark-conversation-ended', () => {
    test('ends a conversation successfully', async () => {
      const { tool, context } = createTestSetup();
      const sendResult = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'End me',
        message: 'Done'
      }, context);

      const result = await tool.execute({
        action: 'mark-conversation-ended',
        'conversation-id': sendResult.conversationId,
        reason: 'Work complete'
      }, context);
      expect(result.success).toBe(true);
      expect(result.status).toBe('ended');
    });

    test('accepts documented conversationId camelCase field', async () => {
      const { tool, context } = createTestSetup();
      const sendResult = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'End me',
        message: 'Done'
      }, context);

      const result = await tool.execute({
        action: 'mark-conversation-ended',
        conversationId: sendResult.conversationId,
        reason: 'Work complete'
      }, context);

      expect(result.success).toBe(true);
      expect(result.status).toBe('ended');
    });

    test('errors when conversation-id is missing', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute(
        { action: 'mark-conversation-ended' }, context
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Conversation ID is required');
    });

    test('errors for non-existent conversation', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        action: 'mark-conversation-ended',
        'conversation-id': 'conv-nope'
      }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Conversation not found');
    });

    test('errors when agent is not a participant', async () => {
      const { tool, context, agentPool } = createTestSetup();
      const sendResult = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'Private',
        message: 'Content'
      }, context);

      const result = await tool.execute({
        action: 'mark-conversation-ended',
        'conversation-id': sendResult.conversationId
      }, { agentId: 'agent-outsider', agentPool });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not a participant');
    });
  });

  // ── helper methods ──────────────────────────────────────────────
  describe('_parseRecipients', () => {
    test('parses single recipient string', () => {
      const tool = new AgentCommunicationTool();
      const result = tool._parseRecipients('agent-1', null);
      expect(result).toEqual(['agent-1']);
    });

    test('parses JSON array of recipients', () => {
      const tool = new AgentCommunicationTool();
      const result = tool._parseRecipients(null, '["agent-1", "agent-2"]');
      expect(result).toEqual(['agent-1', 'agent-2']);
    });

    test('handles array recipients directly', () => {
      const tool = new AgentCommunicationTool();
      const result = tool._parseRecipients(null, ['agent-1', 'agent-2']);
      expect(result).toEqual(['agent-1', 'agent-2']);
    });

    test('deduplicates recipients', () => {
      const tool = new AgentCommunicationTool();
      const result = tool._parseRecipients('agent-1', ['agent-1', 'agent-2']);
      expect(result).toEqual(['agent-1', 'agent-2']);
    });

    test('handles non-JSON string as single recipient', () => {
      const tool = new AgentCommunicationTool();
      const result = tool._parseRecipients(null, 'plain-id');
      expect(result).toEqual(['plain-id']);
    });
  });

  describe('_processAttachments', () => {
    test('returns empty array for null/undefined', async () => {
      const tool = new AgentCommunicationTool();
      expect(await tool._processAttachments(null, 'agent-1')).toEqual([]);
      expect(await tool._processAttachments(undefined, 'agent-1')).toEqual([]);
    });
  });

  // ─── Team affiliation in get-available-agents ─────────────────────────

  describe('team affiliation', () => {
    function createTeamSetup(senderMeta, agentsMeta) {
      const tool = new AgentCommunicationTool({ storageDir: '/tmp/msg-test' });
      tool.logger = createMockLogger();

      const sender = {
        id: 'agent-mgr', name: 'Manager', type: 'manager', capabilities: [],
        status: 'active', isPaused: false, metadata: senderMeta
      };
      const allAgents = [sender, ...agentsMeta.map((meta, i) => ({
        id: `agent-${i}`, name: `Agent ${i}`, type: 'worker', capabilities: ['code'],
        status: 'active', isPaused: false, metadata: meta
      }))];
      const agentPool = {
        listActiveAgents: jest.fn().mockResolvedValue(allAgents),
        getAgent: jest.fn(id => Promise.resolve(allAgents.find(a => a.id === id)))
      };
      return { tool, agentPool, context: { agentPool, agentId: 'agent-mgr' } };
    }

    test('sameTeam is true when agents share a team (new format)', async () => {
      const { tool, context } = createTeamSetup(
        { teams: [{ id: 'team-a', name: 'Alpha', role: 'manager' }] },
        [{ teams: [{ id: 'team-a', name: 'Alpha', role: 'member' }] }]
      );
      const result = await tool.getAvailableAgents('agent-mgr', {}, context);
      expect(result.success).toBe(true);
      expect(result.agents[0].sameTeam).toBe(true);
      expect(result.agents[0].sharedTeams).toContain('team-a');
    });

    test('sameTeam is false when agents are on different teams', async () => {
      const { tool, context } = createTeamSetup(
        { teams: [{ id: 'team-a', name: 'Alpha', role: 'manager' }] },
        [{ teams: [{ id: 'team-b', name: 'Beta', role: 'member' }] }]
      );
      const result = await tool.getAvailableAgents('agent-mgr', {}, context);
      expect(result.agents[0].sameTeam).toBe(false);
      expect(result.agents[0].sharedTeams).toEqual([]);
    });

    test('sameTeam works with legacy single teamId format', async () => {
      const { tool, context } = createTeamSetup(
        { teamId: 'team-x', teamName: 'X Team', teamRole: 'manager' },
        [{ teamId: 'team-x', teamName: 'X Team', teamRole: 'member' }]
      );
      const result = await tool.getAvailableAgents('agent-mgr', {}, context);
      expect(result.agents[0].sameTeam).toBe(true);
      expect(result.agents[0].sharedTeams).toContain('team-x');
    });

    test('agent with no team metadata has sameTeam=false and empty teams', async () => {
      const { tool, context } = createTeamSetup(
        { teams: [{ id: 'team-a', name: 'Alpha', role: 'manager' }] },
        [{}] // no team metadata
      );
      const result = await tool.getAvailableAgents('agent-mgr', {}, context);
      expect(result.agents[0].sameTeam).toBe(false);
      expect(result.agents[0].teams).toEqual([]);
      expect(result.agents[0].sharedTeams).toEqual([]);
    });

    test('multi-team agent shares subset of teams', async () => {
      const { tool, context } = createTeamSetup(
        { teams: [{ id: 'team-a', role: 'manager' }, { id: 'team-b', role: 'manager' }] },
        [{ teams: [{ id: 'team-b', role: 'member' }, { id: 'team-c', role: 'member' }] }]
      );
      const result = await tool.getAvailableAgents('agent-mgr', {}, context);
      expect(result.agents[0].sameTeam).toBe(true);
      expect(result.agents[0].sharedTeams).toEqual(['team-b']);
      expect(result.agents[0].teams).toHaveLength(2);
    });

    test('yourTeams reflects the requesting agent teams', async () => {
      const { tool, context } = createTeamSetup(
        { teams: [{ id: 'team-a', name: 'Alpha', role: 'manager' }, { id: 'team-b', name: 'Beta', role: 'member' }] },
        [{}]
      );
      const result = await tool.getAvailableAgents('agent-mgr', {}, context);
      expect(result.yourTeams).toHaveLength(2);
      expect(result.yourTeams[0].id).toBe('team-a');
      expect(result.yourTeams[1].id).toBe('team-b');
    });

    test('yourTeams is null when requesting agent has no teams', async () => {
      const { tool, context } = createTeamSetup({}, [{}]);
      const result = await tool.getAvailableAgents('agent-mgr', {}, context);
      expect(result.yourTeams).toBeNull();
    });

    test('teamRole is exposed in teams array', async () => {
      const { tool, context } = createTeamSetup(
        { teams: [{ id: 'team-a', name: 'Alpha', role: 'manager' }] },
        [{ teams: [{ id: 'team-a', name: 'Alpha', role: 'member' }] }]
      );
      const result = await tool.getAvailableAgents('agent-mgr', {}, context);
      expect(result.agents[0].teams[0].role).toBe('member');
      expect(result.yourTeams[0].role).toBe('manager');
    });
  });

  // Per-agent toolConfig overrides (agent.toolConfig.agentcommunication).
  // Effective limits resolve via BaseTool#getEffectiveConfig at each
  // check-point in the tool.
  describe('per-agent toolConfig overrides', () => {
    test('per-agent maxRecipientsPerMessage overrides global default', async () => {
      const { tool, context } = createTestSetup();
      // Global default = 3; per-agent override = 1 → sending to 2 must fail.
      const result = await tool.sendMessage('agent-sender', {
        recipients: ['agent-recipient', 'agent-other'],
        subject: 's',
        message: 'm',
      }, { ...context, toolConfig: { maxRecipientsPerMessage: 1 } });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Maximum 1 recipients allowed/);
    });

    test('global default still applies when no per-agent override', async () => {
      const { tool, context } = createTestSetup();
      // Global default = 3; 4 recipients fails without any override.
      const result = await tool.sendMessage('agent-sender', {
        recipients: ['a', 'b', 'c', 'd'],
        subject: 's',
        message: 'm',
      }, context);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Maximum 3 recipients allowed/);
    });

    test('per-agent maxAttachmentsPerMessage overrides global default', async () => {
      const { tool, context } = createTestSetup();
      const atts = [
        { path: '/a.txt' },
        { path: '/b.txt' },
        { path: '/c.txt' },
      ];
      await expect(
        tool._processAttachments(atts, 'agent-sender', { ...context, toolConfig: { maxAttachmentsPerMessage: 2 } })
      ).rejects.toThrow(/Maximum 2 attachments allowed/);
    });

    test('per-agent maxAttachmentSize overrides global default', async () => {
      const { tool, context } = createTestSetup();
      // Stat returns size 100; override to 10 → too large. The tool's
      // per-attachment try/catch swallows the error and just skips the
      // attachment, so the emitted array is empty. We also assert the
      // error was logged as proof the size gate actually fired.
      fsMock.stat.mockResolvedValue({ size: 100 });
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const out = await tool._processAttachments([{ path: '/big.txt' }], 'agent-sender', {
        ...context,
        toolConfig: { maxAttachmentSize: 10 },
      });
      expect(out).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Failed to process attachment/),
        expect.objectContaining({ message: expect.stringMatching(/exceeds size limit/) })
      );
      errorSpy.mockRestore();
    });

    test('per-agent maxAttachmentSize ALLOWS attachments within limit', async () => {
      const { tool, context } = createTestSetup();
      fsMock.stat.mockResolvedValue({ size: 50 });
      const out = await tool._processAttachments([{ path: '/small.txt' }], 'agent-sender', {
        ...context,
        toolConfig: { maxAttachmentSize: 1024 },
      });
      expect(out).toHaveLength(1);
    });

    test('per-agent maxConversationDepth caps reply chain', async () => {
      // Start a fresh conversation with a per-agent cap of 1: the first
      // reply goes through, the second hits the limit. Mirrors the
      // existing "rejects reply when conversation depth limit reached"
      // test but drives the cap from context.toolConfig instead of
      // mutating tool.config.
      const { tool, context } = createTestSetup();

      const sendResult = await tool.execute({
        action: 'send-message',
        recipient: 'agent-recipient',
        subject: 'Deep',
        message: 'Start',
      }, { ...context, toolConfig: { maxConversationDepth: 1 } });
      expect(sendResult.success).toBe(true);

      // First reply (depth 1) — should succeed even under the cap.
      const reply1 = await tool.execute({
        action: 'reply-to-message',
        'message-id': sendResult.messageId,
        message: 'Reply 1',
      }, { agentId: 'agent-recipient', agentPool: context.agentPool, toolConfig: { maxConversationDepth: 1 } });
      expect(reply1.success).toBe(true);

      // Second reply — depth now 1, cap is 1, must fail.
      const reply2 = await tool.execute({
        action: 'reply-to-message',
        'message-id': reply1.messageId,
        message: 'Reply 2',
      }, { ...context, toolConfig: { maxConversationDepth: 1 } });
      expect(reply2.success).toBe(false);
      expect(reply2.error).toMatch(/depth limit reached \(1\)/);
    });

    test('_processAttachments with no context uses global config (backward compat)', async () => {
      const { tool } = createTestSetup();
      // Global = 5; 4 atts → ok (stat mocked to size 100, global max = 10MB).
      fsMock.stat.mockResolvedValue({ size: 100 });
      const atts = [{ path: '/a.txt' }, { path: '/b.txt' }];
      const out = await tool._processAttachments(atts, 'agent-sender');
      expect(Array.isArray(out)).toBe(true);
    });
  });
});
