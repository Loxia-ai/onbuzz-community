/**
 * End-to-end integration tests for the external-channel relay path.
 *
 * Simulates a full `stream_complete` WebSocket broadcast hitting both
 * DiscordService and TelegramService, with a mock send surface attached
 * to each, and verifies:
 *   - Only content inside <external>…</external> reaches the mock send.
 *   - Blocks route to the correct channels via alias matching.
 *   - Substring/case-insensitive alias resolution works end-to-end.
 *   - Default (no-to) blocks broadcast to every bridge owned by the service.
 *   - Content outside <external> never leaves the process.
 *   - Cross-service isolation: a block addressed to `telegram` is NOT
 *     forwarded by Discord, and vice-versa.
 *
 * We mock:
 *   - `fs` (both services write config; mocks short-circuit it)
 *   - `utilities/userDataDir.js` (avoids touching real disk paths)
 *   - The discord.js `channels.fetch` / `channel.send` surface on the
 *     Discord client used for outbound message relay.
 *
 * What's intentionally real:
 *   - The channel filter and alias resolver (the unit under test).
 *   - The relay functions themselves, including message splitting,
 *     interaction lookup, and session targeting.
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

jest.unstable_mockModule('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockRejectedValue(new Error('ENOENT')),
    writeFile: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.unstable_mockModule('../../utilities/userDataDir.js', () => ({
  getUserDataPaths: () => ({ base: '/mock/data' }),
  ensureUserDataDirs: jest.fn().mockResolvedValue(undefined),
}));

const { DiscordService, DISCORD_STATUS } = await import('../discordService.js');
const { TelegramService, TELEGRAM_STATUS } = await import('../telegramService.js');

// ───────────────────────── Discord relay harness ─────────────────────────

/**
 * Stand up a DiscordService wired with mock channel/send surfaces so the
 * real relay code path can run end-to-end. Seeds `recentInteractions`
 * with two bridged channels for the given agent (#ops and #general).
 */
function makeDiscordHarness({ agentId = 'agent-x', extraChannels = [] } = {}) {
  const logger = createMockLogger();
  const service = new DiscordService(logger);
  service.status = DISCORD_STATUS.CONNECTED;

  // Mock an agent pool so relay can resolve agent name.
  service.setAgentPool({
    getAgent: jest.fn().mockResolvedValue({ id: agentId, name: 'Agent X' }),
  });

  // Mock Discord client surface: `channels.fetch(id) → { send(text) }`.
  const sends = []; // flat log of every channel.send call, in order
  const makeChannel = (channelId) => ({
    send: jest.fn(async (text) => {
      sends.push({ channelId, text });
    }),
  });
  service.client = {
    channels: {
      fetch: jest.fn(async (channelId) => makeChannel(channelId)),
    },
  };

  // Seed two bridged channels in the same guild.
  const channels = [
    {
      key: 'guild-1:chan-ops',
      interaction: {
        channelKey: 'guild-1:chan-ops',
        channelId: 'chan-ops',
        channelName: 'ops',
        guildId: 'guild-1',
        guildName: 'Acme',
        timestamp: Date.now(),
      },
    },
    {
      key: 'guild-1:chan-general',
      interaction: {
        channelKey: 'guild-1:chan-general',
        channelId: 'chan-general',
        channelName: 'general',
        guildId: 'guild-1',
        guildName: 'Acme',
        timestamp: Date.now(),
      },
    },
    ...extraChannels,
  ];
  for (const { key, interaction } of channels) {
    service.recentInteractions.set(`${agentId}:${key}`, interaction);
  }

  return { service, sends, agentId };
}

describe('Discord relay — end-to-end via _handleBroadcastEvent', () => {
  let harness;

  beforeEach(() => {
    harness = makeDiscordHarness();
  });

  test('stream_complete with no <external> → nothing sent', async () => {
    await harness.service._handleBroadcastEvent('session-1', {
      type: 'stream_complete',
      data: { agentId: harness.agentId, content: 'private planning\nno tags at all' },
    });
    expect(harness.sends).toEqual([]);
  });

  test('role=user is skipped (safety for non-assistant relays)', async () => {
    await harness.service._handleBroadcastEvent('session-1', {
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        role: 'user',
        content: '<external>this should never leak</external>',
      },
    });
    expect(harness.sends).toEqual([]);
  });

  test('default <external> block broadcasts to every bridged Discord channel', async () => {
    await harness.service._handleBroadcastEvent('session-1', {
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: '<external>broadcast line</external>',
      },
    });
    const channelIds = harness.sends.map(s => s.channelId).sort();
    expect(channelIds).toEqual(['chan-general', 'chan-ops'].sort());
    // Every send includes the agent header prefix plus the content.
    for (const s of harness.sends) {
      expect(s.text).toContain('Agent X');
      expect(s.text).toContain('broadcast line');
    }
  });

  test('targeted block with substring alias → only matching channel', async () => {
    await harness.service._handleBroadcastEvent('session-1', {
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: '<external to="#ops">ops only</external>',
      },
    });
    expect(harness.sends).toHaveLength(1);
    expect(harness.sends[0].channelId).toBe('chan-ops');
    expect(harness.sends[0].text).toContain('ops only');
  });

  test('multi-alias to= sends to each matching channel once', async () => {
    await harness.service._handleBroadcastEvent('session-1', {
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: '<external to="#ops,#general">both</external>',
      },
    });
    const ids = harness.sends.map(s => s.channelId).sort();
    expect(ids).toEqual(['chan-general', 'chan-ops'].sort());
  });

  test('content OUTSIDE <external> never leaves the service', async () => {
    const content =
      'internal planning that must stay local\n' +
      '```json\n{"toolId":"terminal","parameters":{}}\n```\n' +
      '<external to="#ops">only this</external>';
    await harness.service._handleBroadcastEvent('session-1', {
      type: 'stream_complete',
      data: { agentId: harness.agentId, content },
    });
    expect(harness.sends).toHaveLength(1);
    expect(harness.sends[0].text).toContain('only this');
    expect(harness.sends[0].text).not.toContain('internal planning');
    expect(harness.sends[0].text).not.toContain('terminal');
    expect(harness.sends[0].text).not.toContain('toolId');
  });

  test('content INSIDE <external> is verbatim — code blocks preserved', async () => {
    const codeBlock = '```js\nconst x = 1;\n```';
    await harness.service._handleBroadcastEvent('session-1', {
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: `<external to="#ops">Here:\n${codeBlock}</external>`,
      },
    });
    expect(harness.sends).toHaveLength(1);
    expect(harness.sends[0].text).toContain(codeBlock);
  });

  test('content INSIDE <external> is verbatim — tool JSON preserved if the agent chose to include it', async () => {
    // Key correctness claim: the filter does NOT second-guess content
    // shape. If the agent wraps a task summary (including raw tool JSON)
    // in <external>, that's the agent's call, and Discord sees it.
    const tool = '```json\n{"toolId":"taskmanager","parameters":{}}\n```';
    await harness.service._handleBroadcastEvent('session-1', {
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: `<external to="#ops">Status:\n${tool}</external>`,
      },
    });
    expect(harness.sends).toHaveLength(1);
    expect(harness.sends[0].text).toContain('toolId');
    expect(harness.sends[0].text).toContain('taskmanager');
  });

  test('to="*" behaves the same as default (broadcast)', async () => {
    await harness.service._handleBroadcastEvent('session-1', {
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: '<external to="*">star</external>',
      },
    });
    expect(harness.sends.map(s => s.channelId).sort())
      .toEqual(['chan-general', 'chan-ops'].sort());
  });

  test('no bridged channels for this agent → nothing sent', async () => {
    // Clear interactions so the agent has no bridges.
    harness.service.recentInteractions.clear();
    await harness.service._handleBroadcastEvent('session-1', {
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: '<external>anywhere?</external>',
      },
    });
    expect(harness.sends).toEqual([]);
  });

  test('cross-service isolation: block addressed to telegram → Discord ignores it', async () => {
    await harness.service._handleBroadcastEvent('session-1', {
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: '<external to="telegram">not for discord</external>',
      },
    });
    expect(harness.sends).toEqual([]);
  });

  test('multiple <external> blocks each routed independently', async () => {
    const content =
      '<external to="#ops">for ops</external>\n' +
      '<external to="#general">for general</external>\n' +
      '<external>for everyone</external>';
    await harness.service._handleBroadcastEvent('session-1', {
      type: 'stream_complete',
      data: { agentId: harness.agentId, content },
    });
    // ops: 1 targeted + 1 broadcast = 2 sends
    // general: 1 targeted + 1 broadcast = 2 sends
    const perChannel = harness.sends.reduce((acc, s) => {
      acc[s.channelId] = (acc[s.channelId] || []);
      acc[s.channelId].push(s.text);
      return acc;
    }, {});
    expect(perChannel['chan-ops']).toHaveLength(2);
    expect(perChannel['chan-general']).toHaveLength(2);
    expect(perChannel['chan-ops'].some(t => t.includes('for ops'))).toBe(true);
    expect(perChannel['chan-ops'].some(t => t.includes('for everyone'))).toBe(true);
    expect(perChannel['chan-general'].some(t => t.includes('for general'))).toBe(true);
    expect(perChannel['chan-general'].some(t => t.includes('for everyone'))).toBe(true);
  });

  test('getBridgedChannels exposes the alias list with labels', () => {
    const bridged = harness.service.getBridgedChannels(harness.agentId);
    expect(bridged).toEqual(expect.arrayContaining([
      expect.objectContaining({ alias: 'discord:#ops', label: expect.stringContaining('ops') }),
      expect.objectContaining({ alias: 'discord:#general' }),
    ]));
  });

  test('isAgentBridged returns false for unknown agent, true for seeded agent', () => {
    expect(harness.service.isAgentBridged(harness.agentId)).toBe(true);
    expect(harness.service.isAgentBridged('other-agent')).toBe(false);
  });

  test('isAgentBridged returns false when service disconnected', () => {
    harness.service.status = DISCORD_STATUS.DISCONNECTED;
    expect(harness.service.isAgentBridged(harness.agentId)).toBe(false);
  });
});

// ───────────────────────── Telegram relay harness ─────────────────────────

/**
 * TelegramService only sends when `bot.sendMessage` resolves; we stub the
 * minimal surface (sendMessage) and mark the agent as active. The filter
 * + alias wiring we exercise is the same code path Discord uses, via
 * a separate service implementation.
 */
function makeTelegramHarness({ agentId = 'agent-y', chatId = 42 } = {}) {
  const logger = createMockLogger();
  const service = new TelegramService(logger);
  service.status = TELEGRAM_STATUS.CONNECTED;
  service.chatId = chatId;
  service.activeAgentIds.add(agentId);
  // The event handler short-circuits on `!this.bot`; populate a stub so the
  // relay pipeline runs. Our `_send` override is the real interception point.
  service.bot = { sendMessage: jest.fn() };
  service.setAgentPool({
    getAgent: jest.fn().mockResolvedValue({ id: agentId, name: 'Agent Y' }),
  });

  // Intercept the real underlying `_send` to avoid hitting node-telegram-bot-api.
  const sends = [];
  service._send = jest.fn(async (chatIdArg, text) => {
    sends.push({ chatId: chatIdArg, text });
  });

  return { service, sends, agentId, chatId };
}

describe('Telegram relay — end-to-end via _handleBroadcastEvent', () => {
  let harness;

  beforeEach(() => {
    harness = makeTelegramHarness();
  });

  test('no <external> block → nothing sent', async () => {
    await harness.service._handleBroadcastEvent({
      type: 'stream_complete',
      data: { agentId: harness.agentId, content: 'plain reasoning only' },
    });
    expect(harness.sends).toEqual([]);
  });

  test('default <external> relays to the chat', async () => {
    await harness.service._handleBroadcastEvent({
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: '<external>hi from agent</external>',
      },
    });
    expect(harness.sends).toHaveLength(1);
    expect(harness.sends[0].chatId).toBe(harness.chatId);
    expect(harness.sends[0].text).toContain('hi from agent');
  });

  test('to="telegram" routes correctly', async () => {
    await harness.service._handleBroadcastEvent({
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: '<external to="telegram">direct</external>',
      },
    });
    expect(harness.sends).toHaveLength(1);
  });

  test('to="discord:#ops" is NOT relayed by Telegram (cross-service isolation)', async () => {
    await harness.service._handleBroadcastEvent({
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: '<external to="discord:#ops">wrong channel</external>',
      },
    });
    expect(harness.sends).toEqual([]);
  });

  test('broadcast (default) reaches Telegram exactly once per block', async () => {
    const content =
      '<external>A</external>\n' +
      '<external>B</external>\n' +
      '<external to="telegram">C</external>';
    await harness.service._handleBroadcastEvent({
      type: 'stream_complete',
      data: { agentId: harness.agentId, content },
    });
    expect(harness.sends).toHaveLength(3);
    expect(harness.sends.map(s => s.text).join('|')).toMatch(/A.*B.*C/s);
  });

  test('agent not in activeAgentIds → nothing sent', async () => {
    harness.service.activeAgentIds.clear();
    await harness.service._handleBroadcastEvent({
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: '<external>quiet please</external>',
      },
    });
    expect(harness.sends).toEqual([]);
  });

  test('service disconnected → nothing sent even with <external>', async () => {
    harness.service.status = TELEGRAM_STATUS.DISCONNECTED;
    await harness.service._handleBroadcastEvent({
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content: '<external>anyone?</external>',
      },
    });
    expect(harness.sends).toEqual([]);
  });

  test('content outside <external> never leaves the service', async () => {
    await harness.service._handleBroadcastEvent({
      type: 'stream_complete',
      data: {
        agentId: harness.agentId,
        content:
          'private thought chain\n' +
          '```json\n{"toolId":"memory","parameters":{}}\n```\n' +
          '<external>only this part</external>',
      },
    });
    expect(harness.sends).toHaveLength(1);
    expect(harness.sends[0].text).toContain('only this part');
    expect(harness.sends[0].text).not.toContain('private thought');
    expect(harness.sends[0].text).not.toContain('memory');
  });

  test('getBridgedChannels returns the telegram alias when bridged, empty otherwise', () => {
    expect(harness.service.getBridgedChannels(harness.agentId))
      .toEqual([{ alias: 'telegram', label: 'Telegram chat' }]);
    expect(harness.service.getBridgedChannels('other-agent')).toEqual([]);
  });
});

// ─────────────────── Cross-service: one broadcast, two services ───────────────────

describe('Cross-service isolation: a single agent response splits across platforms', () => {
  test('Discord takes its blocks, Telegram takes its own, neither overreaches', async () => {
    const agentId = 'agent-split';

    const discord = makeDiscordHarness({ agentId });
    const telegram = makeTelegramHarness({ agentId, chatId: 77 });

    // Representative content shape matching what stream_complete carries
    // for either Responses API or Chat Completions after the bridge.
    const content =
      'Private reasoning the operator sees.\n' +
      '**Calling taskmanager**\n' +
      '```json\n{"toolId":"taskmanager","parameters":{"actions":[{"type":"complete","taskId":"t-1"}]}}\n```\n\n' +
      '<external to="discord:#ops">\n' +
      '**Deploy finished.** 42 tests passed.\n' +
      '```bash\nnpm test\n```\n' +
      '</external>\n\n' +
      '<external to="telegram">✅ deploy ok</external>\n\n' +
      '<external>general broadcast for every bridge</external>';

    const broadcast = { type: 'stream_complete', data: { agentId, content } };
    await Promise.all([
      discord.service._handleBroadcastEvent('session-1', broadcast),
      telegram.service._handleBroadcastEvent(broadcast),
    ]);

    // Discord should receive:
    //   - the #ops block once (to discord:#ops only)
    //   - the general broadcast twice (once per bridged Discord channel)
    // ... and NEVER the telegram-only block.
    const opsSends = discord.sends.filter(s => s.channelId === 'chan-ops');
    const genSends = discord.sends.filter(s => s.channelId === 'chan-general');
    expect(opsSends.some(s => s.text.includes('Deploy finished'))).toBe(true);
    expect(opsSends.some(s => s.text.includes('general broadcast'))).toBe(true);
    expect(genSends.some(s => s.text.includes('general broadcast'))).toBe(true);
    // Crucial isolation checks:
    expect(discord.sends.some(s => /deploy ok/i.test(s.text))).toBe(false);
    expect(discord.sends.some(s => /Private reasoning/i.test(s.text))).toBe(false);
    expect(discord.sends.some(s => /Calling taskmanager/i.test(s.text))).toBe(false);

    // Telegram should receive:
    //   - its own block
    //   - the general broadcast (once)
    // ... and NEVER the discord-specific block or internal content.
    expect(telegram.sends.some(s => /deploy ok/i.test(s.text))).toBe(true);
    expect(telegram.sends.some(s => /general broadcast/i.test(s.text))).toBe(true);
    expect(telegram.sends.some(s => /Deploy finished/i.test(s.text))).toBe(false);
    expect(telegram.sends.some(s => /Private reasoning/i.test(s.text))).toBe(false);
    expect(telegram.sends.some(s => /taskmanager/i.test(s.text))).toBe(false);
  });
});
