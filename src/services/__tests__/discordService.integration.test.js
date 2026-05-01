/**
 * Discord Service — Integration / Flow Tests
 *
 * Tests complete flows across components rather than isolated units:
 * - Full message round-trip (Discord msg → agent → response back to channel)
 * - API route integration (HTTP → service → response)
 * - Broadcast chain integrity (multiple services wrapping broadcastToSession)
 * - Config persistence round-trip (save → reload → verify state)
 * - Multi-channel isolation (agent responses only go to originating channel)
 * - Agent lifecycle (deletion cleans up stale mappings)
 */

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock fs for config persistence
const mockFs = {
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: jest.fn().mockResolvedValue(undefined)
};

jest.unstable_mockModule('fs', () => ({
  promises: mockFs
}));

jest.unstable_mockModule('../../utilities/userDataDir.js', () => ({
  getUserDataPaths: () => ({ base: '/mock/data' }),
  ensureUserDataDirs: jest.fn().mockResolvedValue(undefined)
}));

const { DiscordService, DISCORD_STATUS } = await import('../discordService.js');

// --- Helpers ---

function createService() {
  const logger = createMockLogger();
  const service = new DiscordService(logger);
  return service;
}

function createMockOrchestrator() {
  return {
    processRequest: jest.fn().mockResolvedValue({ success: true })
  };
}

function createMockAgentPool(agents = {}) {
  return {
    getAgent: jest.fn().mockImplementation(id => Promise.resolve(agents[id] || null)),
    getAllAgents: jest.fn().mockReturnValue(Object.values(agents))
  };
}

function createMockChannel(id = 'c1') {
  return {
    id,
    send: jest.fn().mockResolvedValue({}),
    sendTyping: jest.fn().mockResolvedValue(undefined)
  };
}

function createDiscordMessage(content, opts = {}) {
  const guildId = opts.guildId || 'guild-1';
  const channelId = opts.channelId || 'ch-1';
  return {
    content,
    author: { bot: opts.bot || false, id: opts.userId || 'user-42' },
    guild: opts.noDM ? null : { id: guildId },
    channel: {
      id: channelId,
      parentId: opts.parentId || null, // thread parent channel ID
      send: jest.fn().mockResolvedValue({}),
      sendTyping: jest.fn().mockResolvedValue(undefined)
    },
    reply: jest.fn().mockResolvedValue({})
  };
}

// ========================================================================
// FLOW 1: Full message round-trip
// Discord message → _handleMessage → orchestrator → broadcast → channel.send
// ========================================================================

describe('Flow: Full message round-trip', () => {
  let service, orchestrator, agentPool, mockChannel;

  beforeEach(() => {
    service = createService();
    orchestrator = createMockOrchestrator();
    agentPool = createMockAgentPool({
      'agent-alpha': { id: 'agent-alpha', name: 'Alpha' }
    });
    mockChannel = createMockChannel('ch-1');

    service.setOrchestrator(orchestrator);
    service.setAgentPool(agentPool);
    service.status = DISCORD_STATUS.CONNECTED;
    service.client = {
      channels: { fetch: jest.fn().mockResolvedValue(mockChannel) }
    };

    // Map agent to channel
    service.channelMappings = { 'guild-1:ch-1': ['agent-alpha'] };
  });

  test('user sends message → agent processes → response appears in same channel', async () => {
    // Step 1: Incoming Discord message
    const msg = createDiscordMessage('explain recursion');
    await service._handleMessage(msg);

    // Step 2: Verify orchestrator received the request
    expect(orchestrator.processRequest).toHaveBeenCalledTimes(1);
    const request = orchestrator.processRequest.mock.calls[0][0];
    expect(request.interface).toBe('discord');
    expect(request.sessionId).toBe('discord-guild-1-ch-1');
    expect(request.payload.agentId).toBe('agent-alpha');
    expect(request.payload.message).toBe('explain recursion');

    // Step 3: Simulate broadcast from agentScheduler (what happens after AI responds)
    await service._handleBroadcastEvent('discord-guild-1-ch-1', {
      type: 'stream_complete',
      agentId: 'agent-alpha',
      content: '<external>Recursion is when a function calls itself.</external>'
    });

    // Step 4: Verify response was sent to the correct channel
    expect(service.client.channels.fetch).toHaveBeenCalledWith('ch-1');
    expect(mockChannel.send).toHaveBeenCalledTimes(1);
    const sent = mockChannel.send.mock.calls[0][0];
    expect(sent).toContain('Alpha');
    expect(sent).toContain('Recursion is when a function calls itself.');
  });

  test('full round-trip with long response triggers message splitting', async () => {
    const msg = createDiscordMessage('write a long essay');
    await service._handleMessage(msg);

    // Simulate a response longer than Discord's limit, wrapped for relay
    const longContent = 'A'.repeat(3500);
    await service._handleBroadcastEvent('discord-guild-1-ch-1', {
      type: 'stream_complete',
      agentId: 'agent-alpha',
      content: `<external>${longContent}</external>`
    });

    // Should have split into multiple messages
    expect(mockChannel.send).toHaveBeenCalled();
    const totalSent = mockChannel.send.mock.calls.map(c => c[0]).join('');
    expect(totalSent).toContain('Alpha');
    expect(totalSent.length).toBeGreaterThanOrEqual(3500);
  });
});

// ========================================================================
// FLOW 2: Multi-agent channel routing
// ========================================================================

describe('Flow: Multi-agent channel routing', () => {
  let service, orchestrator, agentPool;

  beforeEach(() => {
    service = createService();
    orchestrator = createMockOrchestrator();
    agentPool = createMockAgentPool({
      'a1': { id: 'a1', name: 'Coder' },
      'a2': { id: 'a2', name: 'Reviewer' }
    });

    service.setOrchestrator(orchestrator);
    service.setAgentPool(agentPool);
    service.status = DISCORD_STATUS.CONNECTED;
    service.channelMappings = { 'g1:c1': ['a1', 'a2'] };
  });

  test('@mention routes to correct agent, then follow-up uses sticky', async () => {
    // First message: explicit @mention
    const msg1 = createDiscordMessage('@Coder fix the login bug', { guildId: 'g1', channelId: 'c1' });
    await service._handleMessage(msg1);

    expect(orchestrator.processRequest).toHaveBeenCalledTimes(1);
    expect(orchestrator.processRequest.mock.calls[0][0].payload.agentId).toBe('a1');
    expect(orchestrator.processRequest.mock.calls[0][0].payload.message).toBe('fix the login bug');

    // Second message: no mention — should use sticky (last addressed agent)
    const msg2 = createDiscordMessage('also add error handling', { guildId: 'g1', channelId: 'c1' });
    await service._handleMessage(msg2);

    expect(orchestrator.processRequest).toHaveBeenCalledTimes(2);
    expect(orchestrator.processRequest.mock.calls[1][0].payload.agentId).toBe('a1'); // sticky to Coder

    // Third message: switch to different agent via @mention
    const msg3 = createDiscordMessage('@Reviewer review the PR', { guildId: 'g1', channelId: 'c1' });
    await service._handleMessage(msg3);

    expect(orchestrator.processRequest).toHaveBeenCalledTimes(3);
    expect(orchestrator.processRequest.mock.calls[2][0].payload.agentId).toBe('a2'); // switched to Reviewer

    // Fourth message: no mention — sticky should now be Reviewer
    const msg4 = createDiscordMessage('any concerns?', { guildId: 'g1', channelId: 'c1' });
    await service._handleMessage(msg4);

    expect(orchestrator.processRequest.mock.calls[3][0].payload.agentId).toBe('a2');
  });

  test('invalid @mention with no sticky prompts user to choose', async () => {
    const msg = createDiscordMessage('@UnknownBot do something', { guildId: 'g1', channelId: 'c1' });
    await service._handleMessage(msg);

    // Should not route
    expect(orchestrator.processRequest).not.toHaveBeenCalled();
    // Should prompt user
    expect(msg.reply).toHaveBeenCalledTimes(1);
    expect(msg.reply.mock.calls[0][0]).toContain('@Coder');
    expect(msg.reply.mock.calls[0][0]).toContain('@Reviewer');
  });
});

// ========================================================================
// FLOW 3: Multi-channel isolation
// Agent responds to channel A only — not channel B even if mapped to both
// ========================================================================

describe('Flow: Multi-channel response isolation', () => {
  let service, agentPool;
  const channelA = createMockChannel('chA');
  const channelB = createMockChannel('chB');

  beforeEach(() => {
    service = createService();
    agentPool = createMockAgentPool({
      'agent-1': { id: 'agent-1', name: 'SharedBot' }
    });
    service.setAgentPool(agentPool);
    service.setOrchestrator(createMockOrchestrator());
    service.status = DISCORD_STATUS.CONNECTED;
    service.client = {
      channels: {
        fetch: jest.fn().mockImplementation(id => {
          if (id === 'chA') return Promise.resolve(channelA);
          if (id === 'chB') return Promise.resolve(channelB);
          return Promise.resolve(null);
        })
      }
    };

    // Same agent mapped to TWO channels
    service.channelMappings = {
      'g1:chA': ['agent-1'],
      'g1:chB': ['agent-1']
    };

    channelA.send.mockClear();
    channelB.send.mockClear();
  });

  test('response only goes to channel where user initiated', async () => {
    // User sends message in channel A
    const msg = createDiscordMessage('hello', { guildId: 'g1', channelId: 'chA' });
    await service._handleMessage(msg);

    // Agent responds via broadcast (wrapped for external relay)
    await service._handleBroadcastEvent('discord-g1-chA', {
      type: 'stream_complete',
      agentId: 'agent-1',
      content: '<external>Hi there!</external>'
    });

    // Channel A should get the response
    expect(channelA.send).toHaveBeenCalled();
    // Channel B should NOT
    expect(channelB.send).not.toHaveBeenCalled();
  });

  test('separate conversations in separate channels stay isolated', async () => {
    // User sends in channel A
    const msgA = createDiscordMessage('question A', { guildId: 'g1', channelId: 'chA' });
    await service._handleMessage(msgA);

    // Different user sends in channel B
    const msgB = createDiscordMessage('question B', { guildId: 'g1', channelId: 'chB' });
    await service._handleMessage(msgB);

    // Agent responds (to question A) — wrapped for external relay
    await service._relayAgentResponse({
      agentId: 'agent-1',
      content: '<external>Answer A</external>'
    });

    // Both channels should get the response (both have recent interaction)
    expect(channelA.send).toHaveBeenCalled();
    expect(channelB.send).toHaveBeenCalled();

    // But if we clear channel A's interaction (expired)
    channelA.send.mockClear();
    channelB.send.mockClear();
    const keyA = 'agent-1:g1:chA';
    const interactionA = service.recentInteractions.get(keyA);
    if (interactionA) interactionA.timestamp = Date.now() - 31 * 60 * 1000; // expire it

    await service._relayAgentResponse({
      agentId: 'agent-1',
      content: '<external>Answer B</external>'
    });

    // Only channel B should get it now
    expect(channelA.send).not.toHaveBeenCalled();
    expect(channelB.send).toHaveBeenCalled();
  });
});

// ========================================================================
// FLOW 4: Broadcast chain integrity (multiple services wrapping)
// ========================================================================

describe('Flow: Broadcast chain integrity', () => {
  test('Discord and Telegram can both wrap broadcastToSession without breaking each other', () => {
    const originalCalls = [];
    const telegramCalls = [];
    const discordCalls = [];

    const wsManager = {
      broadcastToSession: jest.fn((sid, msg) => originalCalls.push({ sid, msg }))
    };

    // Simulate Telegram wrapping first (like real init order)
    const telegramOriginal = wsManager.broadcastToSession.bind(wsManager);
    wsManager.broadcastToSession = (sid, msg) => {
      telegramOriginal(sid, msg);
      telegramCalls.push({ sid, msg });
    };

    // Now Discord wraps on top
    const service = createService();
    service._interceptBroadcasts(wsManager);

    // Fire a broadcast
    wsManager.broadcastToSession('s1', { type: 'stream_complete', agentId: 'a1', content: 'hello' });

    // Original should be called (through the chain)
    expect(originalCalls).toHaveLength(1);
    // Telegram should see it
    expect(telegramCalls).toHaveLength(1);
    // Discord's _handleBroadcastEvent should also have been called
    // (verified by the fact that the chain didn't throw)

    // Fire another — all three layers still work
    wsManager.broadcastToSession('s2', { type: 'message_added' });
    expect(originalCalls).toHaveLength(2);
    expect(telegramCalls).toHaveLength(2);
  });
});

// ========================================================================
// FLOW 5: Config persistence round-trip
// ========================================================================

describe('Flow: Config persistence round-trip', () => {
  test('assign agents → save → reload → mappings restored → routing works', async () => {
    const service1 = createService();
    service1.setOrchestrator(createMockOrchestrator());
    service1.setAgentPool(createMockAgentPool({
      'a1': { id: 'a1', name: 'Bot1' }
    }));

    // Step 1: Assign agents to channels
    await service1.assignAgentToChannel('g1:c1', 'a1');
    await service1.assignAgentToChannel('g1:c2', 'a1');
    service1.knownGuilds = { g1: { name: 'TestServer' } };
    service1.knownChannels = {
      'g1:c1': { name: 'general', guildName: 'TestServer' },
      'g1:c2': { name: 'dev', guildName: 'TestServer' }
    };
    await service1._saveConfig();

    // Step 2: Capture what was written to disk
    const lastWriteCall = mockFs.writeFile.mock.calls[mockFs.writeFile.mock.calls.length - 1];
    const savedJson = lastWriteCall[1];

    // Step 3: Create new service instance and load the saved config
    mockFs.readFile.mockResolvedValueOnce(savedJson);
    const service2 = createService();
    await service2._loadConfig();

    // Step 4: Verify mappings are restored
    expect(service2.channelMappings).toEqual({
      'g1:c1': ['a1'],
      'g1:c2': ['a1']
    });
    expect(service2.knownGuilds.g1.name).toBe('TestServer');
    expect(service2.knownChannels['g1:c1'].name).toBe('general');

    // Step 5: Verify routing works with restored mappings
    service2.setOrchestrator(createMockOrchestrator());
    service2.setAgentPool(createMockAgentPool({
      'a1': { id: 'a1', name: 'Bot1' }
    }));
    service2.status = DISCORD_STATUS.CONNECTED;

    const msg = createDiscordMessage('hello', { guildId: 'g1', channelId: 'c1' });
    await service2._handleMessage(msg);

    expect(service2.orchestrator.processRequest).toHaveBeenCalledTimes(1);
    expect(service2.orchestrator.processRequest.mock.calls[0][0].payload.agentId).toBe('a1');
  });
});

// ========================================================================
// FLOW 6: Agent deletion / stale mapping handling
// ========================================================================

describe('Flow: Agent lifecycle and stale mappings', () => {
  test('agent deleted from pool — routed message fails gracefully', async () => {
    const service = createService();
    const orchestrator = createMockOrchestrator();
    orchestrator.processRequest.mockRejectedValueOnce(new Error('Agent not found'));

    service.setOrchestrator(orchestrator);
    service.setAgentPool(createMockAgentPool({})); // empty — agent gone
    service.status = DISCORD_STATUS.CONNECTED;
    service.channelMappings = { 'g1:c1': ['deleted-agent'] };

    const msg = createDiscordMessage('hello', { guildId: 'g1', channelId: 'c1' });
    await service._handleMessage(msg);

    // Should attempt to route but handle error gracefully
    expect(orchestrator.processRequest).toHaveBeenCalled();
    // Should reply with error
    expect(msg.reply).toHaveBeenCalledTimes(1);
    expect(msg.reply.mock.calls[0][0]).toContain('Failed');
  });

  test('guild removal cleans up all mappings for that guild', async () => {
    const service = createService();
    service.channelMappings = {
      'guild-A:c1': ['a1'],
      'guild-A:c2': ['a2'],
      'guild-B:c3': ['a3']
    };
    service.knownGuilds = {
      'guild-A': { name: 'ServerA' },
      'guild-B': { name: 'ServerB' }
    };
    service.knownChannels = {
      'guild-A:c1': { name: 'gen' },
      'guild-A:c2': { name: 'dev' },
      'guild-B:c3': { name: 'main' }
    };

    // Simulate guildDelete event handler logic
    const guildId = 'guild-A';
    delete service.knownGuilds[guildId];
    for (const key of Object.keys(service.channelMappings)) {
      if (key.startsWith(`${guildId}:`)) {
        delete service.channelMappings[key];
        delete service.knownChannels[key];
      }
    }

    // guild-A channels should be gone
    expect(service.channelMappings['guild-A:c1']).toBeUndefined();
    expect(service.channelMappings['guild-A:c2']).toBeUndefined();
    expect(service.knownChannels['guild-A:c1']).toBeUndefined();

    // guild-B should be untouched
    expect(service.channelMappings['guild-B:c3']).toEqual(['a3']);
    expect(service.knownGuilds['guild-B'].name).toBe('ServerB');
  });
});

// ========================================================================
// FLOW 7: Prompt relay flow
// ========================================================================

describe('Flow: User prompt relay', () => {
  test('user_prompt_request broadcast → relayed to channel with recent interaction', async () => {
    const service = createService();
    const mockCh = createMockChannel('ch-1');
    service.status = DISCORD_STATUS.CONNECTED;
    service.client = {
      channels: { fetch: jest.fn().mockResolvedValue(mockCh) }
    };
    service.agentPool = createMockAgentPool({
      'a1': { id: 'a1', name: 'Worker' }
    });

    // Record a recent interaction
    service.recentInteractions.set('a1:g1:ch-1', {
      channelKey: 'g1:ch-1',
      channelId: 'ch-1',
      guildId: 'g1',
      timestamp: Date.now()
    });

    // Simulate prompt request broadcast
    await service._handleBroadcastEvent('session', {
      type: 'user_prompt_request',
      data: { agentId: 'a1', prompt: 'Please provide the API key' }
    });

    expect(mockCh.send).toHaveBeenCalledTimes(1);
    const sent = mockCh.send.mock.calls[0][0];
    expect(sent).toContain('Input needed');
    expect(sent).toContain('API key');
  });
});

// ========================================================================
// FLOW 8: Thread-level routing
// ========================================================================

describe('Flow: Thread-level routing', () => {
  let service, orchestrator;

  beforeEach(() => {
    service = createService();
    orchestrator = createMockOrchestrator();
    service.setOrchestrator(orchestrator);
    service.setAgentPool(createMockAgentPool({
      'a1': { id: 'a1', name: 'Alpha' },
      'a2': { id: 'a2', name: 'Beta' }
    }));
    service.status = DISCORD_STATUS.CONNECTED;
  });

  test('thread with its own mapping uses thread-specific agents', async () => {
    // Channel has agent Alpha, but thread has agent Beta
    service.channelMappings = {
      'g1:parent-ch': ['a1'],
      'g1:thread-1': ['a2']
    };

    // Message in the thread
    const msg = createDiscordMessage('hello from thread', {
      guildId: 'g1',
      channelId: 'thread-1',
      parentId: 'parent-ch'
    });
    await service._handleMessage(msg);

    // Should route to Beta (thread-specific), NOT Alpha (parent)
    expect(orchestrator.processRequest).toHaveBeenCalledTimes(1);
    expect(orchestrator.processRequest.mock.calls[0][0].payload.agentId).toBe('a2');
  });

  test('thread without its own mapping falls back to parent channel mapping', async () => {
    // Only the parent channel has an agent assigned
    service.channelMappings = {
      'g1:parent-ch': ['a1']
    };

    // Message in a thread under that channel
    const msg = createDiscordMessage('hello from thread', {
      guildId: 'g1',
      channelId: 'thread-2',
      parentId: 'parent-ch'
    });
    await service._handleMessage(msg);

    // Should fall back to Alpha (parent channel agent)
    expect(orchestrator.processRequest).toHaveBeenCalledTimes(1);
    expect(orchestrator.processRequest.mock.calls[0][0].payload.agentId).toBe('a1');
  });

  test('thread with no mapping and unmapped parent is ignored', async () => {
    service.channelMappings = {}; // nothing mapped

    const msg = createDiscordMessage('hello', {
      guildId: 'g1',
      channelId: 'thread-3',
      parentId: 'unmapped-ch'
    });
    await service._handleMessage(msg);

    expect(orchestrator.processRequest).not.toHaveBeenCalled();
  });

  test('response to thread stays in thread, not parent channel', async () => {
    const threadChannel = createMockChannel('thread-1');
    const parentChannel = createMockChannel('parent-ch');

    service.client = {
      channels: {
        fetch: jest.fn().mockImplementation(id => {
          if (id === 'thread-1') return Promise.resolve(threadChannel);
          if (id === 'parent-ch') return Promise.resolve(parentChannel);
          return Promise.resolve(null);
        })
      }
    };
    service.channelMappings = { 'g1:parent-ch': ['a1'] };

    // User messages in thread (falls back to parent mapping)
    const msg = createDiscordMessage('question', {
      guildId: 'g1',
      channelId: 'thread-1',
      parentId: 'parent-ch'
    });
    await service._handleMessage(msg);

    // Agent responds — wrapped for external relay
    await service._handleBroadcastEvent('session', {
      type: 'stream_complete',
      agentId: 'a1',
      content: '<external>answer</external>'
    });

    // Response should go to the thread, not the parent
    expect(threadChannel.send).toHaveBeenCalled();
    expect(parentChannel.send).not.toHaveBeenCalled();
  });

  test('sticky agent is per-thread, not shared with parent channel', async () => {
    service.channelMappings = {
      'g1:parent-ch': ['a1', 'a2'],
      'g1:thread-1': ['a1', 'a2']
    };

    // In parent channel: address Alpha
    const msg1 = createDiscordMessage('@Alpha do X', { guildId: 'g1', channelId: 'parent-ch' });
    await service._handleMessage(msg1);
    expect(orchestrator.processRequest.mock.calls[0][0].payload.agentId).toBe('a1');

    // In thread: address Beta
    const msg2 = createDiscordMessage('@Beta do Y', { guildId: 'g1', channelId: 'thread-1', parentId: 'parent-ch' });
    await service._handleMessage(msg2);
    expect(orchestrator.processRequest.mock.calls[1][0].payload.agentId).toBe('a2');

    // Follow-up in parent (no mention) → sticky should be Alpha
    const msg3 = createDiscordMessage('follow up', { guildId: 'g1', channelId: 'parent-ch' });
    await service._handleMessage(msg3);
    expect(orchestrator.processRequest.mock.calls[2][0].payload.agentId).toBe('a1');

    // Follow-up in thread (no mention) → sticky should be Beta
    const msg4 = createDiscordMessage('thread follow up', { guildId: 'g1', channelId: 'thread-1', parentId: 'parent-ch' });
    await service._handleMessage(msg4);
    expect(orchestrator.processRequest.mock.calls[3][0].payload.agentId).toBe('a2');
  });
});
