import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock fs and userDataDir before importing service
jest.unstable_mockModule('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockRejectedValue(new Error('ENOENT')),
    writeFile: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.unstable_mockModule('../../utilities/userDataDir.js', () => ({
  getUserDataPaths: () => ({ base: '/mock/data' }),
  ensureUserDataDirs: jest.fn().mockResolvedValue(undefined)
}));

const { DiscordService, DISCORD_STATUS } = await import('../discordService.js');

describe('DiscordService', () => {
  let service;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    service = new DiscordService(logger);
  });

  // --- Constructor & Status ---

  test('constructor creates instance with correct defaults', () => {
    expect(service).toBeInstanceOf(DiscordService);
    expect(service.status).toBe(DISCORD_STATUS.DISCONNECTED);
    expect(service.channelMappings).toEqual({});
    expect(service.client).toBeNull();
  });

  test('getStatus returns disconnected state by default', () => {
    const status = service.getStatus();
    expect(status.status).toBe('disconnected');
    expect(status.connected).toBe(false);
    expect(status.botUsername).toBeNull();
    expect(status.guildCount).toBe(0);
  });

  // --- Dependency Injection ---

  test('setOrchestrator stores reference', () => {
    const mockOrch = { processRequest: jest.fn() };
    service.setOrchestrator(mockOrch);
    expect(service.orchestrator).toBe(mockOrch);
  });

  test('setAgentPool stores reference', () => {
    const mockPool = { getAgent: jest.fn() };
    service.setAgentPool(mockPool);
    expect(service.agentPool).toBe(mockPool);
  });

  test('setFlowExecutor stores reference', () => {
    const mockFE = {};
    service.setFlowExecutor(mockFE);
    expect(service.flowExecutor).toBe(mockFE);
  });

  // --- Channel Mapping CRUD ---

  test('assignAgentToChannel adds agent to empty channel', async () => {
    await service.assignAgentToChannel('guild1:ch1', 'agent-1');
    expect(service.channelMappings['guild1:ch1']).toEqual(['agent-1']);
  });

  test('assignAgentToChannel adds second agent to same channel', async () => {
    await service.assignAgentToChannel('guild1:ch1', 'agent-1');
    await service.assignAgentToChannel('guild1:ch1', 'agent-2');
    expect(service.channelMappings['guild1:ch1']).toEqual(['agent-1', 'agent-2']);
  });

  test('assignAgentToChannel does not duplicate agent', async () => {
    await service.assignAgentToChannel('guild1:ch1', 'agent-1');
    await service.assignAgentToChannel('guild1:ch1', 'agent-1');
    expect(service.channelMappings['guild1:ch1']).toEqual(['agent-1']);
  });

  test('removeAgentFromChannel removes agent', async () => {
    await service.assignAgentToChannel('guild1:ch1', 'agent-1');
    await service.assignAgentToChannel('guild1:ch1', 'agent-2');
    await service.removeAgentFromChannel('guild1:ch1', 'agent-1');
    expect(service.channelMappings['guild1:ch1']).toEqual(['agent-2']);
  });

  test('removeAgentFromChannel cleans up empty channel', async () => {
    await service.assignAgentToChannel('guild1:ch1', 'agent-1');
    await service.removeAgentFromChannel('guild1:ch1', 'agent-1');
    expect(service.channelMappings['guild1:ch1']).toBeUndefined();
  });

  test('removeAgentFromChannel clears sticky agent if removed', async () => {
    await service.assignAgentToChannel('guild1:ch1', 'agent-1');
    service.stickyAgent.set('guild1:ch1', 'agent-1');
    await service.removeAgentFromChannel('guild1:ch1', 'agent-1');
    expect(service.stickyAgent.has('guild1:ch1')).toBe(false);
  });

  test('getChannelMappings returns full state', async () => {
    await service.assignAgentToChannel('g1:c1', 'a1');
    service.knownGuilds = { g1: { name: 'Test Server' } };
    service.knownChannels = { 'g1:c1': { name: 'general', guildName: 'Test Server' } };

    const result = service.getChannelMappings();
    expect(result.mappings).toEqual({ 'g1:c1': ['a1'] });
    expect(result.knownGuilds.g1.name).toBe('Test Server');
    expect(result.knownChannels['g1:c1'].name).toBe('general');
  });

  // --- Message Splitting ---

  test('_splitMessage returns single part for short messages', () => {
    const parts = service._splitMessage('Hello world');
    expect(parts).toEqual(['Hello world']);
  });

  test('_splitMessage splits long messages', () => {
    const longText = 'A'.repeat(3000);
    const parts = service._splitMessage(longText);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('').length).toBe(3000);
    parts.forEach(p => expect(p.length).toBeLessThanOrEqual(1950));
  });

  test('_splitMessage prefers newline split points', () => {
    const text = 'Line 1\n' + 'X'.repeat(1950) + '\nLine 3 with more content';
    const parts = service._splitMessage(text);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[0]).toContain('Line 1');
  });

  // --- Agent Mention Parsing ---

  test('_stripAgentMention removes @name prefix', () => {
    const result = service._stripAgentMention('@TestAgent do something', 'agent-1');
    expect(result).toBe('do something');
  });

  test('_stripAgentMention returns original if no prefix', () => {
    const result = service._stripAgentMention('just a message', 'agent-1');
    expect(result).toBe('just a message');
  });

  // --- Broadcast Interception ---

  test('_interceptBroadcasts chains onto existing wrapper', () => {
    const originalFn = jest.fn();
    const wsManager = { broadcastToSession: originalFn };

    service._interceptBroadcasts(wsManager);

    // Call the wrapped function
    wsManager.broadcastToSession('session1', { type: 'test' });

    // Original should still be called
    expect(originalFn).toHaveBeenCalledWith('session1', { type: 'test' });
  });

  test('_interceptBroadcasts does not double-wrap', () => {
    const originalFn = jest.fn();
    const wsManager = { broadcastToSession: originalFn };

    service._interceptBroadcasts(wsManager);
    const firstWrapper = wsManager.broadcastToSession;

    service._interceptBroadcasts(wsManager); // Second call
    expect(wsManager.broadcastToSession).toBe(firstWrapper); // Should not change
  });

  // --- Disconnect ---

  test('disconnect resets state', async () => {
    service.status = DISCORD_STATUS.CONNECTED;
    service.recentInteractions.set('test', { channelKey: 'g:c', timestamp: Date.now() });
    service.stickyAgent.set('g:c', 'agent-1');

    await service.disconnect();

    expect(service.status).toBe(DISCORD_STATUS.DISCONNECTED);
    expect(service.recentInteractions.size).toBe(0);
    expect(service.stickyAgent.size).toBe(0);
    expect(service.client).toBeNull();
  });

  // --- Available Channels (offline) ---

  test('getAvailableChannels returns cached channels when disconnected', () => {
    service.knownChannels = {
      'g1:c1': { name: 'general', guildId: 'g1', guildName: 'Server' },
      'g1:c2': { name: 'dev', guildId: 'g1', guildName: 'Server' }
    };

    const channels = service.getAvailableChannels();
    expect(channels).toHaveLength(2);
    expect(channels[0].name).toBe('general');
    expect(channels[0].key).toBe('g1:c1');
    expect(channels[1].name).toBe('dev');
  });

  // --- Message Routing (_handleMessage) ---

  describe('_handleMessage', () => {
    const makeMockMessage = (content, guildId = 'g1', channelId = 'c1', authorBot = false) => ({
      content,
      author: { bot: authorBot, id: 'user-123' },
      guild: { id: guildId },
      channel: { id: channelId, sendTyping: jest.fn().mockResolvedValue(undefined), send: jest.fn().mockResolvedValue(undefined) },
      reply: jest.fn().mockResolvedValue(undefined)
    });

    beforeEach(() => {
      service.orchestrator = { processRequest: jest.fn().mockResolvedValue({}) };
      service.agentPool = {
        getAgent: jest.fn().mockImplementation(id => {
          const agents = {
            'agent-1': { id: 'agent-1', name: 'Alpha' },
            'agent-2': { id: 'agent-2', name: 'Beta' }
          };
          return Promise.resolve(agents[id] || null);
        })
      };
    });

    test('ignores bot messages', async () => {
      const msg = makeMockMessage('hello', 'g1', 'c1', true);
      service.channelMappings = { 'g1:c1': ['agent-1'] };
      await service._handleMessage(msg);
      expect(service.orchestrator.processRequest).not.toHaveBeenCalled();
    });

    test('ignores DMs (no guild)', async () => {
      const msg = makeMockMessage('hello');
      msg.guild = null;
      service.channelMappings = { 'g1:c1': ['agent-1'] };
      await service._handleMessage(msg);
      expect(service.orchestrator.processRequest).not.toHaveBeenCalled();
    });

    test('ignores unmapped channels', async () => {
      const msg = makeMockMessage('hello');
      service.channelMappings = {}; // no mapping for g1:c1
      await service._handleMessage(msg);
      expect(service.orchestrator.processRequest).not.toHaveBeenCalled();
    });

    test('ignores empty messages', async () => {
      const msg = makeMockMessage('   ');
      service.channelMappings = { 'g1:c1': ['agent-1'] };
      await service._handleMessage(msg);
      expect(service.orchestrator.processRequest).not.toHaveBeenCalled();
    });

    test('routes directly when single agent mapped', async () => {
      const msg = makeMockMessage('do the thing');
      service.channelMappings = { 'g1:c1': ['agent-1'] };

      await service._handleMessage(msg);

      expect(service.orchestrator.processRequest).toHaveBeenCalledTimes(1);
      const call = service.orchestrator.processRequest.mock.calls[0][0];
      expect(call.payload.agentId).toBe('agent-1');
      expect(call.payload.message).toBe('do the thing');
      expect(call.interface).toBe('discord');
      expect(call.sessionId).toBe('discord-g1-c1');
    });

    test('routes via @mention when multiple agents mapped', async () => {
      const msg = makeMockMessage('@Alpha do something');
      service.channelMappings = { 'g1:c1': ['agent-1', 'agent-2'] };

      await service._handleMessage(msg);

      expect(service.orchestrator.processRequest).toHaveBeenCalledTimes(1);
      const call = service.orchestrator.processRequest.mock.calls[0][0];
      expect(call.payload.agentId).toBe('agent-1');
      expect(call.payload.message).toBe('do something'); // stripped @mention
    });

    test('uses sticky agent when no @mention and multi-agent', async () => {
      const msg = makeMockMessage('follow up question');
      service.channelMappings = { 'g1:c1': ['agent-1', 'agent-2'] };
      service.stickyAgent.set('g1:c1', 'agent-2');

      await service._handleMessage(msg);

      const call = service.orchestrator.processRequest.mock.calls[0][0];
      expect(call.payload.agentId).toBe('agent-2');
    });

    test('prompts user when multi-agent, no @mention, no sticky', async () => {
      const msg = makeMockMessage('who am I talking to');
      service.channelMappings = { 'g1:c1': ['agent-1', 'agent-2'] };

      await service._handleMessage(msg);

      expect(service.orchestrator.processRequest).not.toHaveBeenCalled();
      expect(msg.reply).toHaveBeenCalledTimes(1);
      const replyText = msg.reply.mock.calls[0][0];
      expect(replyText).toContain('Multiple agents');
      expect(replyText).toContain('@Alpha');
      expect(replyText).toContain('@Beta');
    });

    test('updates sticky agent after routing', async () => {
      const msg = makeMockMessage('hello');
      service.channelMappings = { 'g1:c1': ['agent-1'] };

      await service._handleMessage(msg);

      expect(service.stickyAgent.get('g1:c1')).toBe('agent-1');
    });

    test('records recent interaction for response targeting', async () => {
      const msg = makeMockMessage('hello');
      service.channelMappings = { 'g1:c1': ['agent-1'] };

      await service._handleMessage(msg);

      const interaction = service.recentInteractions.get('agent-1:g1:c1');
      expect(interaction).toBeDefined();
      expect(interaction.channelKey).toBe('g1:c1');
      expect(interaction.channelId).toBe('c1');
      expect(interaction.timestamp).toBeGreaterThan(0);
    });
  });

  // --- Agent Mention Resolution ---

  describe('_resolveAgentFromMention', () => {
    beforeEach(() => {
      service.agentPool = {
        getAgent: jest.fn().mockImplementation(id => {
          const agents = {
            'a1': { id: 'a1', name: 'CodeBot' },
            'a2': { id: 'a2', name: 'Analyzer' }
          };
          return Promise.resolve(agents[id] || null);
        })
      };
    });

    test('resolves matching @mention to agent ID', async () => {
      const result = await service._resolveAgentFromMention('@CodeBot fix bug', ['a1', 'a2']);
      expect(result).toBe('a1');
    });

    test('resolves case-insensitively', async () => {
      const result = await service._resolveAgentFromMention('@codebot fix bug', ['a1', 'a2']);
      expect(result).toBe('a1');
    });

    test('returns null when no @mention', async () => {
      const result = await service._resolveAgentFromMention('no mention here', ['a1', 'a2']);
      expect(result).toBeNull();
    });

    test('returns null when @mention does not match any candidate', async () => {
      const result = await service._resolveAgentFromMention('@Unknown do stuff', ['a1', 'a2']);
      expect(result).toBeNull();
    });
  });

  // --- Broadcast Relay (_relayAgentResponse) ---

  describe('_relayAgentResponse', () => {
    const mockChannel = { send: jest.fn().mockResolvedValue(undefined) };

    beforeEach(() => {
      service.status = DISCORD_STATUS.CONNECTED;
      service.client = {
        channels: { fetch: jest.fn().mockResolvedValue(mockChannel) }
      };
      service.agentPool = {
        getAgent: jest.fn().mockResolvedValue({ id: 'a1', name: 'TestAgent' })
      };
      mockChannel.send.mockClear();
    });

    test('relays ONLY the <external> portion to a channel with recent interaction', async () => {
      // The relay is opt-in: content without <external> tags stays local.
      // A full response typically mixes private reasoning with a wrapped
      // reply — the wrapped block is all Discord ever sees.
      service.recentInteractions.set('a1:g1:c1', {
        channelKey: 'g1:c1',
        channelId: 'c1',
        channelName: 'ops',
        guildId: 'g1',
        guildName: 'Acme',
        timestamp: Date.now()
      });

      await service._relayAgentResponse({
        agentId: 'a1',
        content: 'private planning\n<external>Here is my answer</external>\nstill local',
        type: 'stream_complete'
      });

      expect(service.client.channels.fetch).toHaveBeenCalledWith('c1');
      expect(mockChannel.send).toHaveBeenCalled();
      const sentText = mockChannel.send.mock.calls[0][0];
      expect(sentText).toContain('TestAgent');
      expect(sentText).toContain('Here is my answer');
      expect(sentText).not.toContain('private planning');
      expect(sentText).not.toContain('still local');
    });

    test('does NOT relay when no recent interaction for agent', async () => {
      // No interactions recorded for a1
      await service._relayAgentResponse({
        agentId: 'a1',
        content: 'Hello'
      });

      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    test('does NOT relay expired interactions (TTL) — even with an <external> block', async () => {
      service.recentInteractions.set('a1:g1:c1', {
        channelKey: 'g1:c1',
        channelId: 'c1',
        guildId: 'g1',
        timestamp: Date.now() - 31 * 60 * 1000 // 31 minutes ago — expired
      });

      await service._relayAgentResponse({
        agentId: 'a1',
        content: '<external>Hello</external>'
      });

      expect(mockChannel.send).not.toHaveBeenCalled();
      // Should also clean up expired entry
      expect(service.recentInteractions.has('a1:g1:c1')).toBe(false);
    });

    test('relays only to the correct agent channels', async () => {
      // agent-1 has interaction on c1, agent-2 has interaction on c2
      service.recentInteractions.set('a1:g1:c1', {
        channelKey: 'g1:c1', channelId: 'c1', channelName: 'ops', guildId: 'g1', timestamp: Date.now()
      });
      service.recentInteractions.set('a2:g1:c2', {
        channelKey: 'g1:c2', channelId: 'c2', channelName: 'other', guildId: 'g1', timestamp: Date.now()
      });

      await service._relayAgentResponse({ agentId: 'a1', content: '<external>Reply from a1</external>' });

      // Should only fetch c1, not c2
      expect(service.client.channels.fetch).toHaveBeenCalledWith('c1');
      expect(service.client.channels.fetch).not.toHaveBeenCalledWith('c2');
    });

    test('skips user-role messages', async () => {
      service.recentInteractions.set('a1:g1:c1', {
        channelKey: 'g1:c1', channelId: 'c1', guildId: 'g1', timestamp: Date.now()
      });

      await service._relayAgentResponse({ agentId: 'a1', content: 'user input', role: 'user' });
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    test('skips tool-role messages', async () => {
      service.recentInteractions.set('a1:g1:c1', {
        channelKey: 'g1:c1', channelId: 'c1', guildId: 'g1', timestamp: Date.now()
      });

      await service._relayAgentResponse({ agentId: 'a1', content: 'tool output', role: 'tool' });
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    test('skips messages with no content', async () => {
      service.recentInteractions.set('a1:g1:c1', {
        channelKey: 'g1:c1', channelId: 'c1', guildId: 'g1', timestamp: Date.now()
      });

      await service._relayAgentResponse({ agentId: 'a1' }); // no content
      expect(mockChannel.send).not.toHaveBeenCalled();
    });
  });

  // --- Broadcast Event Handling (_handleBroadcastEvent) ---

  describe('_handleBroadcastEvent', () => {
    beforeEach(() => {
      service.status = DISCORD_STATUS.CONNECTED;
      service.client = {
        channels: { fetch: jest.fn().mockResolvedValue({ send: jest.fn().mockResolvedValue(undefined) }) }
      };
      service.agentPool = { getAgent: jest.fn().mockResolvedValue({ id: 'a1', name: 'Bot' }) };
    });

    test('ignores events when disconnected', async () => {
      service.status = DISCORD_STATUS.DISCONNECTED;
      const spy = jest.spyOn(service, '_relayAgentResponse');
      await service._handleBroadcastEvent('s1', { type: 'stream_complete', agentId: 'a1', content: 'hi' });
      expect(spy).not.toHaveBeenCalled();
    });

    test('ignores events with no type', async () => {
      const spy = jest.spyOn(service, '_relayAgentResponse');
      await service._handleBroadcastEvent('s1', {});
      expect(spy).not.toHaveBeenCalled();
    });

    test('forwards stream_complete to _relayAgentResponse', async () => {
      const spy = jest.spyOn(service, '_relayAgentResponse').mockResolvedValue(undefined);
      const msg = { type: 'stream_complete', agentId: 'a1', content: 'result' };
      await service._handleBroadcastEvent('s1', msg);
      expect(spy).toHaveBeenCalledWith(msg);
    });

    test('forwards user_prompt_request to _relayPromptRequest', async () => {
      const spy = jest.spyOn(service, '_relayPromptRequest').mockResolvedValue(undefined);
      const msg = { type: 'user_prompt_request', data: { agentId: 'a1', prompt: 'Need input' } };
      await service._handleBroadcastEvent('s1', msg);
      expect(spy).toHaveBeenCalledWith(msg);
    });

    test('ignores other event types', async () => {
      const relaySpy = jest.spyOn(service, '_relayAgentResponse');
      const promptSpy = jest.spyOn(service, '_relayPromptRequest');
      await service._handleBroadcastEvent('s1', { type: 'message_added', agentId: 'a1' });
      expect(relaySpy).not.toHaveBeenCalled();
      expect(promptSpy).not.toHaveBeenCalled();
    });
  });

  // --- Config Persistence ---

  describe('config persistence', () => {
    test('_loadConfig handles missing file gracefully', async () => {
      // fs.readFile is mocked to reject with ENOENT
      await service._loadConfig();
      expect(service.config).toEqual({});
      expect(service.channelMappings).toEqual({});
    });

    test('_saveConfig persists current state', async () => {
      const { promises: mockFs } = await import('fs');
      service.channelMappings = { 'g1:c1': ['a1'] };
      service.knownGuilds = { g1: { name: 'Server' } };
      service.knownChannels = { 'g1:c1': { name: 'general' } };

      await service._saveConfig();

      expect(mockFs.writeFile).toHaveBeenCalled();
      const writtenJson = JSON.parse(mockFs.writeFile.mock.calls[mockFs.writeFile.mock.calls.length - 1][1]);
      expect(writtenJson.channelMappings).toEqual({ 'g1:c1': ['a1'] });
      expect(writtenJson.knownGuilds.g1.name).toBe('Server');
      expect(writtenJson.updatedAt).toBeDefined();
    });
  });

  // --- Singleton ---

  test('getDiscordService returns singleton', async () => {
    const { getDiscordService } = await import('../discordService.js');
    const s1 = getDiscordService(logger);
    const s2 = getDiscordService(logger);
    expect(s1).toBe(s2);
  });
});
