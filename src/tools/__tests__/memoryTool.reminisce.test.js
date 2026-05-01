/**
 * Integration tests for the memoryTool `reminisce` action.
 *
 * Exercises the full path: tool.execute({action: 'reminisce', ...}) →
 * _executeReminisce → agentPool.getAgent → conversationQuery.<mode> →
 * shaped result. The per-mode semantics are unit-tested exhaustively in
 * services/__tests__/conversationQuery.test.js; these tests focus on the
 * wiring: action validation, context requirements, agent fetching, and
 * error paths.
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

jest.unstable_mockModule('../../services/memoryService.js', () => ({
  getMemoryService: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
  })),
}));

const { default: MemoryTool } = await import('../memoryTool.js');

function makeMessages(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `msg_${String(i).padStart(4, '0')}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i}${i === 5 ? ' contains special keyword' : ''}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    tokenUsage: { totalTokens: 10 },
    toolExecutions: i === 7 ? [{ toolId: 'terminal', input: 'ls -la' }] : [],
  }));
}

function makeSetup({ messages = null, agentExists = true } = {}) {
  const tool = new MemoryTool({}, createMockLogger());
  const agent = agentExists ? {
    id: 'agent-1',
    conversations: messages ? { full: { messages } } : { full: { messages: makeMessages(20) } },
  } : null;
  const agentPool = {
    getAgent: jest.fn().mockResolvedValue(agent),
  };
  const context = { agentId: 'agent-1', agentPool };
  return { tool, agent, agentPool, context };
}

describe('memoryTool reminisce — wiring', () => {
  let tool, context, agentPool;
  beforeEach(() => {
    ({ tool, context, agentPool } = makeSetup());
  });

  test('overview mode returns archive stats + timeline', async () => {
    const out = await tool.execute({ action: 'reminisce', mode: 'overview' }, context);
    expect(out.success).toBe(true);
    expect(out.mode).toBe('overview');
    expect(out.result.totalMessages).toBe(20);
    expect(out.result.timeline.length).toBeGreaterThan(0);
    expect(out.result.timeline[0].messageId).toBe('msg_0000');
  });

  test('range mode paginates', async () => {
    const out = await tool.execute(
      { action: 'reminisce', mode: 'range', offset: 5, limit: 3 },
      context
    );
    expect(out.success).toBe(true);
    expect(out.result.messages.length).toBe(3);
    expect(out.result.messages[0].messageId).toBe('msg_0005');
  });

  test('search finds matches in content', async () => {
    const out = await tool.execute(
      { action: 'reminisce', mode: 'search', query: 'special keyword' },
      context
    );
    expect(out.success).toBe(true);
    expect(out.result.matches.length).toBeGreaterThan(0);
    expect(out.result.matches[0].messageId).toBe('msg_0005');
  });

  test('around resolves a bookmarked messageId', async () => {
    const out = await tool.execute(
      { action: 'reminisce', mode: 'around', messageId: 'msg_0010', before: 2, after: 2 },
      context
    );
    expect(out.success).toBe(true);
    expect(out.result.targetFound).toBe(true);
    expect(out.result.messages.map(m => m.messageId)).toContain('msg_0010');
  });

  test('byTool lists tool calls', async () => {
    const out = await tool.execute(
      { action: 'reminisce', mode: 'byTool' },
      context
    );
    expect(out.success).toBe(true);
    expect(out.result.toolCalls.length).toBe(1);
    expect(out.result.toolCalls[0].toolId).toBe('terminal');
    expect(out.result.toolCalls[0].messageId).toBe('msg_0007');
  });

  test('read returns the whole message when no window is specified', async () => {
    const out = await tool.execute(
      { action: 'reminisce', mode: 'read', messageId: 'msg_0005' },
      context
    );
    expect(out.success).toBe(true);
    expect(out.result.targetFound).toBe(true);
    expect(out.result.message.messageId).toBe('msg_0005');
    expect(out.result.message.contentWindow.kind).toBe('full');
    expect(out.result.message.content).toContain('special keyword');
  });

  test('read with lineFrom/lineTo returns a line slice', async () => {
    // Replace msg_0005 with a multi-line message so the slice is meaningful.
    const bigContent = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const localMessages = makeMessages(20);
    localMessages[5] = { ...localMessages[5], content: bigContent };
    const local = makeSetup({ messages: localMessages });

    const out = await local.tool.execute(
      { action: 'reminisce', mode: 'read', messageId: 'msg_0005',
        lineFrom: 10, lineTo: 14 },
      local.context
    );
    expect(out.result.message.contentWindow.kind).toBe('lines');
    expect(out.result.message.contentWindow.totalLines).toBe(50);
    const lines = out.result.message.content.split('\n');
    expect(lines).toEqual(['line 10', 'line 11', 'line 12', 'line 13', 'line 14']);
  });

  test('read with contentFrom/contentTo returns a char slice', async () => {
    const localMessages = makeMessages(20);
    localMessages[5] = { ...localMessages[5], content: 'abcdefghijklmnopqrstuvwxyz' };
    const local = makeSetup({ messages: localMessages });

    const out = await local.tool.execute(
      { action: 'reminisce', mode: 'read', messageId: 'msg_0005',
        contentFrom: 5, contentTo: 10 },
      local.context
    );
    expect(out.result.message.contentWindow.kind).toBe('chars');
    expect(out.result.message.content).toBe('fghij');
  });

  test('read with unknown messageId returns targetFound=false (not a crash)', async () => {
    const out = await tool.execute(
      { action: 'reminisce', mode: 'read', messageId: 'msg_hallucinated' },
      context
    );
    expect(out.success).toBe(true);
    expect(out.result.targetFound).toBe(false);
    expect(out.result.message).toBeNull();
  });

  test('read surfaces hasReasoning + reasoningTokens but omits text by default', async () => {
    const localMessages = makeMessages(20);
    localMessages[5] = {
      ...localMessages[5],
      reasoning: 'Chain of thought: first I need to analyze...',
      reasoningTokens: 512,
    };
    const local = makeSetup({ messages: localMessages });
    const out = await local.tool.execute(
      { action: 'reminisce', mode: 'read', messageId: 'msg_0005' },
      local.context
    );
    expect(out.result.message.hasReasoning).toBe(true);
    expect(out.result.message.reasoningTokens).toBe(512);
    expect(out.result.message.reasoning).toBeUndefined();
  });

  test('read with includeReasoning=true returns the reasoning text', async () => {
    const localMessages = makeMessages(20);
    const thought = 'Step 1: analyze. Step 2: decide. Step 3: act.';
    localMessages[5] = {
      ...localMessages[5],
      reasoning: thought,
      reasoningTokens: 200,
    };
    const local = makeSetup({ messages: localMessages });
    const out = await local.tool.execute(
      { action: 'reminisce', mode: 'read', messageId: 'msg_0005', includeReasoning: true },
      local.context
    );
    expect(out.result.message.reasoning).toBe(thought);
  });
});

describe('memoryTool reminisce — error paths', () => {
  test('invalid mode returns a clean error', async () => {
    const { tool, context } = makeSetup();
    const out = await tool.execute({ action: 'reminisce', mode: 'bogus' }, context);
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/mode must be one of/);
  });

  test('missing mode returns a clean error (not a crash)', async () => {
    const { tool, context } = makeSetup();
    const out = await tool.execute({ action: 'reminisce' }, context);
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/mode must be one of/);
  });

  test('missing agentPool in context returns a clean error', async () => {
    const { tool } = makeSetup();
    const out = await tool.execute(
      { action: 'reminisce', mode: 'overview' },
      { agentId: 'agent-1' /* no agentPool */ }
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/agentPool/);
  });

  test('agent not found returns a clean error', async () => {
    const { tool, context } = makeSetup({ agentExists: false });
    const out = await tool.execute({ action: 'reminisce', mode: 'overview' }, context);
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/not found/);
  });

  test('agent with no conversation archive returns success with empty flag', async () => {
    const tool = new MemoryTool({}, createMockLogger());
    const agentPool = {
      getAgent: jest.fn().mockResolvedValue({ id: 'a', conversations: {} }),
    };
    const out = await tool.execute(
      { action: 'reminisce', mode: 'overview' },
      { agentId: 'a', agentPool }
    );
    expect(out.success).toBe(true);
    expect(out.result.empty).toBe(true);
  });
});

describe('memoryTool reminisce — archive durability through compaction', () => {
  /*
   * Contract test: even after compaction writes to conversations[model],
   * reminisce must still serve the pre-compaction messages from
   * conversations.full. This simulates the durability invariant that the
   * whole feature rests on.
   */
  test('reads conversations.full even when per-model compacted views exist', async () => {
    const fullMessages = makeMessages(10);
    const compactedMessages = [
      { id: 'compacted_1', role: 'system', content: '[summary of 10 messages]',
        createdAt: new Date().toISOString(), tokenUsage: { totalTokens: 200 } },
    ];
    const agent = {
      id: 'a',
      conversations: {
        full: { messages: fullMessages },
        'gpt-5': { messages: compactedMessages },       // compacted view
        'claude-opus': { messages: compactedMessages }, // another compacted view
      },
    };
    const tool = new MemoryTool({}, createMockLogger());
    const context = { agentId: 'a', agentPool: { getAgent: () => Promise.resolve(agent) } };

    const out = await tool.execute({ action: 'reminisce', mode: 'overview' }, context);
    expect(out.success).toBe(true);
    // totalMessages reflects the FULL archive, not the compacted view.
    expect(out.result.totalMessages).toBe(10);
    // A messageId from the original archive must still resolve via around.
    const aroundOut = await tool.execute(
      { action: 'reminisce', mode: 'around', messageId: 'msg_0005', before: 1, after: 1 },
      context
    );
    expect(aroundOut.result.targetFound).toBe(true);
    expect(aroundOut.result.messages.some(m => m.messageId === 'msg_0005')).toBe(true);
  });

  test('bookmark stability across simulated conversation growth', async () => {
    // An agent bookmarks msg_0005 in turn 1. Conversation grows to 200
    // messages over many turns. reminisce still resolves the bookmark.
    const messages = makeMessages(20);
    const bookmark = 'msg_0005';
    const agent = { id: 'a', conversations: { full: { messages } } };
    const tool = new MemoryTool({}, createMockLogger());
    const context = { agentId: 'a', agentPool: { getAgent: () => Promise.resolve(agent) } };

    // Simulate archive growth: append 180 more messages.
    for (let i = 20; i < 200; i++) {
      messages.push({
        id: `msg_${String(i).padStart(4, '0')}`,
        role: 'assistant',
        content: `later message ${i}`,
        createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, i)).toISOString(),
        tokenUsage: { totalTokens: 10 },
        toolExecutions: [],
      });
    }

    const out = await tool.execute(
      { action: 'reminisce', mode: 'around', messageId: bookmark, before: 2, after: 2 },
      context
    );
    expect(out.result.targetFound).toBe(true);
    expect(out.result.center).toBe(bookmark);
  });
});

describe('memoryTool — reminisce registered as a valid action', () => {
  test('getSupportedActions includes reminisce', () => {
    const tool = new MemoryTool({}, createMockLogger());
    expect(tool.getSupportedActions()).toContain('reminisce');
  });

  test('customValidateParameters accepts action=reminisce without error', () => {
    const tool = new MemoryTool({}, createMockLogger());
    const result = tool.customValidateParameters({ action: 'reminisce' });
    expect(result.valid).toBe(true);
  });

  test('getParameterSchema enum includes reminisce', () => {
    const tool = new MemoryTool({}, createMockLogger());
    const schema = tool.getParameterSchema();
    expect(schema.properties.action.enum).toContain('reminisce');
  });

  test('getParameterSchema advertises every reminisce-specific parameter', () => {
    // Without this, the model invoking memory via OpenAI function calling
    // can't know what fields are legal for action=reminisce and will either
    // omit them or hallucinate wrong names. Locked tight.
    const schema = new MemoryTool({}, createMockLogger()).getParameterSchema();
    const props = schema.properties;
    const required = [
      'mode', 'messageId',
      'from', 'to', 'offset', 'limit', 'maxResults', 'role', 'cursor', 'toolId',
      'before', 'after',
      'lineFrom', 'lineTo', 'contentFrom', 'contentTo',
      'detail',
    ];
    for (const field of required) {
      expect(props[field]).toBeDefined();
      expect(typeof props[field].description).toBe('string');
    }
    // mode enum must carry all six sub-modes
    expect(props.mode.enum).toEqual(
      expect.arrayContaining(['overview', 'range', 'search', 'around', 'byTool', 'read'])
    );
  });

  test('getDescription teaches the agent about reminisce + pointer stability', () => {
    const desc = new MemoryTool({}, createMockLogger()).getDescription();
    expect(desc).toMatch(/REMINISCE/i);
    expect(desc).toMatch(/messageId/);
    // All six sub-modes should be present by name.
    expect(desc).toMatch(/overview/);
    expect(desc).toMatch(/search/);
    expect(desc).toMatch(/around/);
    expect(desc).toMatch(/byTool/);
    expect(desc).toMatch(/\bread\b/);
    // Documents that search scope excludes tool results.
    expect(desc).toMatch(/does NOT match tool results|tool-call arguments/i);
    // Around explicitly documents its unit = messages.
    expect(desc).toMatch(/count MESSAGES/);
    // Read documents sub-message granularity — lines AND chars.
    expect(desc).toMatch(/lineFrom/);
    expect(desc).toMatch(/contentFrom/);
  });
});
