/**
 * MessageProcessor — source-header injection.
 *
 * Contract:
 *   When a user message arrives carrying a `context.source` produced by
 *   services/messageSource.js (Discord / Telegram ingress), the message
 *   content queued on the agent is prefixed with a parenthesized
 *   attribution line:
 *
 *       (Message by alice from Discord > MyGuild > #ops)
 *       hi is anyone there?
 *
 *   The source object itself is also preserved on the queued message for
 *   downstream consumers (relays, logs). Re-invocation with a message that
 *   already carries the header is idempotent.
 *
 * These tests mock agentPool but exercise the real prependSourceHeader +
 * createDiscordSource / createTelegramSource paths so the contract is
 * verified end-to-end through the processMessage boundary.
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig, createMockAiService } from '../../__test-utils__/mockFactories.js';

jest.unstable_mockModule('../../services/visualEditorBridge.js', () => ({
  getVisualEditorBridge: jest.fn(() => ({
    isEnabled: () => false,
    hasInstance: () => false,
  })),
  InstanceStatus: { IDLE: 'idle', RUNNING: 'running', ERROR: 'error' },
}));

jest.unstable_mockModule('../../utilities/tagParser.js', () => ({
  default: jest.fn().mockImplementation(() => ({
    extractToolCommands: jest.fn().mockReturnValue([]),
    normalizeToolCommand: jest.fn((c) => c),
    extractAgentRedirects: jest.fn().mockReturnValue([]),
    parseXMLParameters: jest.fn().mockReturnValue({}),
    decodeHtmlEntities: jest.fn((s) => s),
  })),
}));

jest.unstable_mockModule('../../tools/visualEditorTool.js', () => ({
  VisualEditorTool: { injectContextIntoMessage: jest.fn((msg) => msg) },
}));

// Import the REAL messageSource factories — this is intentional. The
// integration value of these tests is the end-to-end contract between the
// source module and the processor.
const { createDiscordSource, createTelegramSource, createWebSource } =
  await import('../../services/messageSource.js');
const { default: MessageProcessor } = await import('../messageProcessor.js');

function makeMP() {
  const config = createMockConfig();
  const logger = createMockLogger();
  const agentPool = {
    getAgent: jest.fn().mockResolvedValue({
      id: 'agent-1',
      name: 'TestAgent',
      mode: 'chat',
      conversations: { full: { messages: [] } },
      messageQueues: { userMessages: [], interAgentMessages: [], toolResults: [] },
    }),
    addUserMessage: jest.fn().mockResolvedValue(undefined),
    addInterAgentMessage: jest.fn().mockResolvedValue(undefined),
  };
  const contextManager = { getContext: jest.fn() };
  const mp = new MessageProcessor(
    config, logger, { getTool: jest.fn() }, agentPool, contextManager, createMockAiService()
  );
  return { mp, agentPool };
}

describe('MessageProcessor — source header injection', () => {
  let mp, agentPool;
  beforeEach(() => {
    jest.clearAllMocks();
    ({ mp, agentPool } = makeMP());
  });

  test('Discord guild message → content prefixed with attribution line', async () => {
    const source = createDiscordSource({
      id: 'm1',
      author: { id: 'u1', username: 'alice' },
      guild: { id: 'g1', name: 'MyGuild' },
      channel: { id: 'c1', name: 'ops', isThread: () => false },
    });

    await mp.processMessage('agent-1', 'hi is anyone there?', {
      sessionId: 'discord-g1-c1',
      source,
    });

    expect(agentPool.addUserMessage).toHaveBeenCalledTimes(1);
    const [, queued] = agentPool.addUserMessage.mock.calls[0];
    expect(queued.content).toBe(
      '(Message by alice from Discord > MyGuild > #ops)\nhi is anyone there?'
    );
    // Source is also preserved structurally for downstream consumers.
    expect(queued.source).toBe(source);
    expect(queued.role).toBe('user');
  });

  test('Telegram private message → Telegram > DM attribution', async () => {
    const source = createTelegramSource({
      message_id: 1,
      chat: { id: 42, type: 'private' },
      from: { id: 7, username: 'alice' },
    });

    await mp.processMessage('agent-1', 'status?', {
      sessionId: 'telegram-42',
      source,
    });

    const [, queued] = agentPool.addUserMessage.mock.calls[0];
    expect(queued.content).toBe('(Message by alice from Telegram > DM)\nstatus?');
    expect(queued.source).toBe(source);
  });

  test('Discord thread message → parent + thread path in header', async () => {
    const source = createDiscordSource({
      id: 'm2',
      author: { username: 'alice' },
      guild: { id: 'g', name: 'MyGuild' },
      channel: {
        id: 't1', name: 'deploy-thread',
        parentId: 'c1', parent: { name: 'ops' },
        isThread: () => true,
      },
    });

    await mp.processMessage('agent-1', 'deploy status?', { sessionId: 's', source });

    const [, queued] = agentPool.addUserMessage.mock.calls[0];
    expect(queued.content).toBe(
      '(Message by alice from Discord > MyGuild > #ops > deploy-thread)\ndeploy status?'
    );
  });

  test('no source on context → content passes through untouched', async () => {
    await mp.processMessage('agent-1', 'raw input', { sessionId: 's' });
    const [, queued] = agentPool.addUserMessage.mock.calls[0];
    expect(queued.content).toBe('raw input');
    expect(queued.source).toBeNull();
  });

  test('web source → no header (web UI interactions stay clean)', async () => {
    const source = createWebSource({ sessionId: 'web-1', userName: 'operator' });
    await mp.processMessage('agent-1', 'hello', { sessionId: 'web-1', source });

    const [, queued] = agentPool.addUserMessage.mock.calls[0];
    expect(queued.content).toBe('hello');
    expect(queued.source).toBe(source);  // structurally preserved even when no header rendered
  });

  test('idempotency — re-processing a message that already has the header does not double-prefix', async () => {
    const source = createDiscordSource({
      author: { username: 'alice' },
      guild: { name: 'MyGuild' },
      channel: { id: 'c', name: 'ops', isThread: () => false },
    });

    // First call — fresh content gets prefixed.
    await mp.processMessage('agent-1', 'hi', { source });
    const firstContent = agentPool.addUserMessage.mock.calls[0][1].content;
    expect(firstContent.startsWith('(Message by alice')).toBe(true);

    // Second call — pass the ALREADY-prefixed content back through (as
    // would happen on replay / state-restore paths). The header must not
    // be duplicated.
    jest.clearAllMocks();
    ({ mp, agentPool } = makeMP());
    await mp.processMessage('agent-1', firstContent, { source });
    const secondContent = agentPool.addUserMessage.mock.calls[0][1].content;
    expect(secondContent).toBe(firstContent);
    // i.e. not "(Message by alice ...)\n(Message by alice ...)\nhi"
    const headerCount = (secondContent.match(/\(Message by alice/g) || []).length;
    expect(headerCount).toBe(1);
  });

  test('unknown user fallback keeps the header well-formed', async () => {
    const source = createDiscordSource({
      // no author
      guild: { name: 'G' },
      channel: { id: 'c', name: 'general', isThread: () => false },
    });
    await mp.processMessage('agent-1', 'ping', { source });
    const [, queued] = agentPool.addUserMessage.mock.calls[0];
    expect(queued.content).toBe(
      '(Message by unknown user from Discord > G > #general)\nping'
    );
  });
});
