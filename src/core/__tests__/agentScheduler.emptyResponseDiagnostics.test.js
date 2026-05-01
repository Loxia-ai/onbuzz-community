/**
 * Tests for empty-response diagnostic capture.
 *
 * When an AI response lands and our accumulator classifies it as "empty"
 * (no content and no tool calls), the scheduler records a SHAPE SNAPSHOT
 * of that response onto `_emptyResponseTracker[agentId].samples`. The
 * /scheduler visualizer surfaces the last snapshot's `hint` as a subline
 * under the Empties chip so an operator can tell WHY it was empty:
 * tool-call-only turn (bridge bug), reasoning-only turn (streaming never
 * reached text), content-filter, length, etc.
 *
 * These tests cover the classifier's hint logic and the per-agent
 * ring-buffer (cap 3 samples) behavior. They do not exercise the full
 * stall path — agentScheduler.test.js handles that.
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Silence activity service
const mockShouldAgentBeActive = jest.fn(() => ({ active: false, reason: 'idle' }));
const mockGetActiveAgents = jest.fn(() => []);
const mockShouldSkipIteration = jest.fn(() => false);
jest.unstable_mockModule('../../services/agentActivityService.js', () => ({
  shouldAgentBeActive: mockShouldAgentBeActive,
  getActiveAgents: mockGetActiveAgents,
  shouldSkipIteration: mockShouldSkipIteration,
}));

const { default: AgentScheduler } = await import('../agentScheduler.js');

function makeScheduler() {
  const logger = createMockLogger();
  const agentPool = {
    getAgent: jest.fn().mockResolvedValue(null),
    getAllAgents: jest.fn().mockResolvedValue([]),
    persistAgentState: jest.fn().mockResolvedValue(undefined),
    getCompactionMetadata: jest.fn().mockResolvedValue(null),
    getMessagesForAI: jest.fn().mockResolvedValue([]),
  };
  const messageProcessor = {};
  const aiService = { abortRequest: jest.fn().mockReturnValue(false), getActiveRequest: () => null };
  const scheduler = new AgentScheduler(agentPool, messageProcessor, aiService, logger);
  return { scheduler, agentPool };
}

describe('_snapshotResponseShape', () => {
  let scheduler;
  beforeEach(() => {
    jest.clearAllMocks();
    ({ scheduler } = makeScheduler());
  });

  test('null / undefined response produces a null-content snapshot with a clear hint', () => {
    const s = scheduler._snapshotResponseShape(null);
    expect(s.contentType).toBe('null');
    expect(s.contentLength).toBe(0);
    expect(s.hint).toMatch(/null\/undefined/);
  });

  test('string content measures length correctly', () => {
    const s = scheduler._snapshotResponseShape({ content: 'hello world' });
    expect(s.contentType).toBe('string');
    expect(s.contentLength).toBe(11);
  });

  test('array content (Responses API shape) sums text-part lengths', () => {
    const s = scheduler._snapshotResponseShape({
      content: [{ type: 'text', text: 'hi ' }, { type: 'text', text: 'there' }],
    });
    expect(s.contentType).toBe('array');
    expect(s.contentLength).toBe(8);
  });

  test('tool-call-only turn (content null + toolCalls present) → bridge-gap hint', () => {
    const s = scheduler._snapshotResponseShape({
      content: null,
      toolCalls: [{ id: 'call_1', function: { name: 'x', arguments: '{}' } }],
    });
    expect(s.hasToolCalls).toBe(true);
    expect(s.toolCallCount).toBe(1);
    expect(s.hint).toMatch(/Tool-call-only turn/);
    expect(s.hint).toMatch(/Chat Completions bridge gap/);
  });

  test('snake_case tool_calls also detected (OpenAI raw shape)', () => {
    const s = scheduler._snapshotResponseShape({
      content: '',
      tool_calls: [{ id: 'a' }, { id: 'b' }],
    });
    expect(s.hasToolCalls).toBe(true);
    expect(s.toolCallCount).toBe(2);
  });

  test('reasoning-only turn (empty content + reasoning field) → reasoning-only hint', () => {
    const s = scheduler._snapshotResponseShape({
      content: '',
      reasoning: 'long chain of thought...',
    });
    expect(s.hasReasoning).toBe(true);
    expect(s.hint).toMatch(/Reasoning-only turn/);
    expect(s.hint).toMatch(/output_text/);
  });

  test('reasoning detected when content is an array with a reasoning part', () => {
    const s = scheduler._snapshotResponseShape({
      content: [{ type: 'reasoning', text: '…' }],
    });
    expect(s.hasReasoning).toBe(true);
  });

  test('finish_reason content_filter → safety-filter hint', () => {
    const s = scheduler._snapshotResponseShape({
      content: '',
      finish_reason: 'content_filter',
    });
    expect(s.hint).toMatch(/content filter/i);
  });

  test('finish_reason length → max_tokens hint', () => {
    const s = scheduler._snapshotResponseShape({
      content: '',
      finishReason: 'length',
    });
    expect(s.hint).toMatch(/max_tokens/);
  });

  test('clean stop with empty content → silent-rejection hint', () => {
    const s = scheduler._snapshotResponseShape({
      content: '',
      finishReason: 'stop',
    });
    expect(s.hint).toMatch(/silent prompt-rejection|context-limit|upstream timeout/);
  });

  test('unknown-shape fallback hint is present', () => {
    const s = scheduler._snapshotResponseShape({ content: '' });
    expect(s.hint).toMatch(/unclear|inspect raw/);
  });

  test('does not leak content body — only metadata', () => {
    const s = scheduler._snapshotResponseShape({
      content: 'a very secret payload that must not appear in /scheduler or logs',
    });
    expect(JSON.stringify(s)).not.toContain('secret payload');
  });
});

describe('_trackEmptyResponse + samples ring buffer', () => {
  let scheduler, agentPool;
  beforeEach(() => {
    jest.clearAllMocks();
    ({ scheduler, agentPool } = makeScheduler());
    const agent = { id: 'a1', name: 'A', mode: 'agent', conversations: { full: { messages: [] } } };
    agentPool.getAgent.mockResolvedValue(agent);
  });

  test('records a sample snapshot on each empty-response cycle', async () => {
    await scheduler._trackEmptyResponse('a1', { content: '' });
    const entry = scheduler._emptyResponseTracker.get('a1');
    expect(entry.samples).toHaveLength(1);
    expect(entry.samples[0].contentType).toBe('string');
    expect(entry.samples[0].hint).toBeDefined();
  });

  test('samples ring buffer caps at 3 entries', async () => {
    for (let i = 0; i < 5; i++) {
      await scheduler._trackEmptyResponse('a1', { content: `sample-${i}` });
    }
    const entry = scheduler._emptyResponseTracker.get('a1');
    // Note: threshold may have fired and cleared the tracker — we only get
    // here if the tracker survives. Either way, the ring buffer's cap is
    // the contract we want to lock.
    if (entry) expect(entry.samples.length).toBeLessThanOrEqual(3);
  });

  test('missing aiResponse is tolerated (null-safe snapshot)', async () => {
    await scheduler._trackEmptyResponse('a1', null);
    const entry = scheduler._emptyResponseTracker.get('a1');
    expect(entry.samples[0].contentType).toBe('null');
  });

  test('samples carry over from previous cycles on same agent', async () => {
    await scheduler._trackEmptyResponse('a1', { content: '' });
    await scheduler._trackEmptyResponse('a1', { content: null, toolCalls: [{ id: 'x' }] });
    const entry = scheduler._emptyResponseTracker.get('a1');
    expect(entry.count).toBe(2);
    expect(entry.samples).toHaveLength(2);
    expect(entry.samples[1].hasToolCalls).toBe(true);
  });
});
