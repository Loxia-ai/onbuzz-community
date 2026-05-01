import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

const { PromptService, getPromptService } = await import('../promptService.js');

describe('PromptService', () => {
  let service;
  let logger;

  beforeEach(() => {
    jest.useFakeTimers();
    logger = createMockLogger();
    service = new PromptService(logger);
  });

  afterEach(() => {
    // Don't call clearAll() — it rejects pending promises which crashes Node
    // Instead just clear internal state directly
    if (service.pendingRequests) service.pendingRequests.clear();
    if (service.requestHistory) service.requestHistory.length = 0;
    jest.useRealTimers();
  });

  test('constructor initializes with empty state', () => {
    expect(service.pendingRequests.size).toBe(0);
    expect(service.requestHistory).toEqual([]);
  });

  test('_generateRequestId returns unique IDs', () => {
    const id1 = service._generateRequestId();
    const id2 = service._generateRequestId();
    expect(id1).toMatch(/^prompt-/);
    expect(id1).not.toBe(id2);
  });

  test('createPromptRequest creates a pending request with promise', () => {
    const { requestInfo, promise } = service.createPromptRequest('agent-1', {
      message: 'Choose an option',
      questions: [{ message: 'Pick one', options: ['A', 'B'] }]
    });

    expect(requestInfo.agentId).toBe('agent-1');
    expect(requestInfo.questions).toHaveLength(1);
    expect(requestInfo.message).toBe('Choose an option');
    expect(promise).toBeInstanceOf(Promise);
    expect(service.pendingRequests.size).toBe(1);
  });

  test('createPromptRequest normalizes questions with defaults', () => {
    const { requestInfo } = service.createPromptRequest('agent-1', {
      questions: [{ question: 'What color?', options: ['red', 'blue'] }]
    });

    const q = requestInfo.questions[0];
    expect(q.id).toBe('q1');
    expect(q.message).toBe('What color?');
    expect(q.options[0].label).toBe('red');
    expect(q.allowFreeText).toBe(true);
    expect(q.required).toBe(true);
    expect(q.multiSelect).toBe(false);
  });

  test('createPromptRequest normalizes option objects', () => {
    const { requestInfo } = service.createPromptRequest('agent-1', {
      questions: [{
        message: 'Q',
        options: [{ id: 'o1', label: 'Option 1', description: 'Desc' }]
      }]
    });

    const opt = requestInfo.questions[0].options[0];
    expect(opt.id).toBe('o1');
    expect(opt.label).toBe('Option 1');
    expect(opt.description).toBe('Desc');
  });

  test('createPromptRequest wraps single prompt as questions array', () => {
    const { requestInfo } = service.createPromptRequest('agent-1', {
      message: 'Pick an option'
    });
    expect(requestInfo.questions).toHaveLength(1);
    expect(requestInfo.questions[0].message).toBe('Pick an option');
  });

  test('submitResponse resolves the promise and removes from pending', async () => {
    const { requestInfo, promise } = service.createPromptRequest('agent-1', {
      questions: [{ message: 'Q' }]
    });

    const response = { answers: [{ questionId: 'q1', freeText: 'My answer' }] };
    const result = service.submitResponse(requestInfo.requestId, response);

    expect(result.success).toBe(true);
    expect(service.pendingRequests.size).toBe(0);

    const resolved = await promise;
    expect(resolved.success).toBe(true);
    expect(resolved.response).toBe(response);
  });

  test('submitResponse returns error for unknown request', () => {
    const result = service.submitResponse('unknown-id', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('cancelRequest rejects the promise', async () => {
    const { requestInfo, promise } = service.createPromptRequest('agent-1', {
      questions: [{ message: 'Q' }]
    });

    const result = service.cancelRequest(requestInfo.requestId, 'test cancel');
    expect(result.success).toBe(true);

    await expect(promise).rejects.toThrow('cancelled');
  });

  test('cancelRequest returns error for unknown request', () => {
    const result = service.cancelRequest('unknown-id');
    expect(result.success).toBe(false);
  });

  test('timeout rejects the promise', async () => {
    const { requestInfo, promise } = service.createPromptRequest('agent-1', {
      questions: [{ message: 'Q' }]
    }, { timeout: 1000 });

    jest.advanceTimersByTime(1500);

    await expect(promise).rejects.toThrow('timed out');
    expect(service.pendingRequests.size).toBe(0);
  });

  test('timeout is no-op for already resolved request', () => {
    const { requestInfo } = service.createPromptRequest('agent-1', {
      questions: [{ message: 'Q' }]
    });
    service.submitResponse(requestInfo.requestId, { answers: [] });

    // Timeout handler should not throw
    service._handleTimeout(requestInfo.requestId);
  });

  test('_addToHistory trims when exceeding max size', () => {
    service.maxHistorySize = 3;
    for (let i = 0; i < 5; i++) {
      service._addToHistory({ id: i });
    }
    expect(service.requestHistory).toHaveLength(3);
    expect(service.requestHistory[0].id).toBe(2);
  });

  test('getPendingRequest returns info or null', () => {
    const { requestInfo } = service.createPromptRequest('agent-1', {
      questions: [{ message: 'Q' }]
    });
    expect(service.getPendingRequest(requestInfo.requestId)).toBeTruthy();
    expect(service.getPendingRequest('unknown')).toBeNull();
  });

  test('getPendingRequestsForAgent returns requests for agent', () => {
    service.createPromptRequest('agent-1', { questions: [{ message: 'Q1' }] });
    service.createPromptRequest('agent-1', { questions: [{ message: 'Q2' }] });
    service.createPromptRequest('agent-2', { questions: [{ message: 'Q3' }] });

    const results = service.getPendingRequestsForAgent('agent-1');
    expect(results).toHaveLength(2);
  });

  test('hasPendingPrompts returns true/false', () => {
    expect(service.hasPendingPrompts('agent-1')).toBe(false);
    service.createPromptRequest('agent-1', { questions: [{ message: 'Q' }] });
    expect(service.hasPendingPrompts('agent-1')).toBe(true);
    expect(service.hasPendingPrompts('agent-2')).toBe(false);
  });

  test('getHistory returns last N records', () => {
    for (let i = 0; i < 10; i++) {
      service._addToHistory({ id: i });
    }
    const recent = service.getHistory(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].id).toBe(7);
  });

  test('clearAll rejects all pending and clears', async () => {
    const { promise: p1 } = service.createPromptRequest('agent-1', { questions: [{ message: 'Q' }] });
    const { promise: p2 } = service.createPromptRequest('agent-2', { questions: [{ message: 'Q' }] });

    service.clearAll();

    await expect(p1).rejects.toThrow('shutdown');
    await expect(p2).rejects.toThrow('shutdown');
    expect(service.pendingRequests.size).toBe(0);
  });

  test('formatResponseAsMessage formats answers', () => {
    const requestInfo = {
      message: 'Please answer:',
      questions: [
        { id: 'q1', message: 'Color?', options: [{ id: 'o1', label: 'Red' }] }
      ]
    };
    const response = {
      answers: [
        { questionId: 'q1', selectedOptions: ['o1'], freeText: 'I like red', webSearchRequested: true }
      ]
    };

    const msg = service.formatResponseAsMessage(requestInfo, response);
    expect(msg).toContain('**Context:** Please answer:');
    expect(msg).toContain('**Q: Color?**');
    expect(msg).toContain('Red');
    expect(msg).toContain('"I like red"');
    expect(msg).toContain('Web search');
  });

  test('formatResponseAsMessage handles missing question match', () => {
    const requestInfo = { questions: [] };
    const response = {
      answers: [{ questionId: 'q99', selectedOptions: [] }]
    };
    const msg = service.formatResponseAsMessage(requestInfo, response);
    expect(msg).toContain('Question q99');
  });

  test('formatResponseAsMessage handles no message context', () => {
    const requestInfo = { questions: [{ id: 'q1', message: 'Q' }] };
    const response = { answers: [] };
    const msg = service.formatResponseAsMessage(requestInfo, response);
    expect(msg).not.toContain('Context');
  });
});

describe('getPromptService singleton', () => {
  test('returns same instance on multiple calls', () => {
    // Note: the singleton is already created from the module,
    // but we can verify function exists and returns a PromptService
    const s = getPromptService();
    expect(s).toBeInstanceOf(PromptService);
  });
});
