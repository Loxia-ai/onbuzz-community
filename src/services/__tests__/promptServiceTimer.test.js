/**
 * PromptService – Timer control methods (extendTimeout / stopTimeout)
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

import { PromptService } from '../promptService.js';

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeService() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
  return new PromptService(logger);
}

function createPendingRequest(service, agentId = 'agent-1', timeoutMs = 60_000) {
  return service.createPromptRequest(agentId, {
    message: 'Pick an option',
    questions: [{ id: 'q1', message: 'Color?', options: ['red', 'blue'] }]
  }, { timeout: timeoutMs });
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('PromptService – extendTimeout / stopTimeout', () => {
  let service;
  /** Track promises so we can clean up unhandled rejections */
  let pendingPromises;

  beforeEach(() => {
    jest.useFakeTimers();
    service = makeService();
    pendingPromises = [];
  });

  afterEach(() => {
    // Silence unhandled rejections from leftover pending promises
    for (const p of pendingPromises) {
      p.catch(() => {});
    }
    service.clearAll();
    jest.useRealTimers();
  });

  // ── extendTimeout ─────────────────────────────────────────────────────

  test('extendTimeout increases timeoutAt by additionalMs', () => {
    const { requestInfo, promise } = createPendingRequest(service, 'agent-1', 60_000);
    pendingPromises.push(promise);

    const originalTimeout = new Date(requestInfo.timeoutAt).getTime();
    service.extendTimeout(requestInfo.requestId, 30_000);

    const updated = service.getPendingRequest(requestInfo.requestId);
    const newTimeout = new Date(updated.timeoutAt).getTime();
    expect(newTimeout).toBe(originalTimeout + 30_000);
  });

  test('extendTimeout returns success with new timeoutAt', () => {
    const { requestInfo, promise } = createPendingRequest(service);
    pendingPromises.push(promise);

    const result = service.extendTimeout(requestInfo.requestId, 10_000);
    expect(result.success).toBe(true);
    expect(result.newTimeoutAt).toBeDefined();
  });

  test('extendTimeout returns error for unknown requestId', () => {
    const result = service.extendTimeout('nonexistent-id', 10_000);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  // ── stopTimeout ───────────────────────────────────────────────────────

  test('stopTimeout sets timeoutAt to null', () => {
    const { requestInfo, promise } = createPendingRequest(service);
    pendingPromises.push(promise);

    service.stopTimeout(requestInfo.requestId);

    const updated = service.getPendingRequest(requestInfo.requestId);
    expect(updated.timeoutAt).toBeNull();
  });

  test('stopTimeout returns success', () => {
    const { requestInfo, promise } = createPendingRequest(service);
    pendingPromises.push(promise);

    const result = service.stopTimeout(requestInfo.requestId);
    expect(result.success).toBe(true);
  });

  test('stopTimeout returns error for unknown requestId', () => {
    const result = service.stopTimeout('nonexistent-id');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  // ── Behavioral integration ────────────────────────────────────────────

  test('after stopTimeout, the request does not time out', async () => {
    const { requestInfo, promise } = createPendingRequest(service, 'agent-1', 5_000);

    service.stopTimeout(requestInfo.requestId);

    // Advance past the original timeout
    jest.advanceTimersByTime(10_000);

    // Request should still be pending (not rejected)
    const pending = service.getPendingRequest(requestInfo.requestId);
    expect(pending).not.toBeNull();

    // Clean up: submit a response so the promise resolves
    service.submitResponse(requestInfo.requestId, { answers: [] });
    const result = await promise;
    expect(result.success).toBe(true);
  });

  test('after extendTimeout, the new timeout is respected', async () => {
    const { requestInfo, promise } = createPendingRequest(service, 'agent-1', 5_000);
    pendingPromises.push(promise);

    // Extend by another 10 seconds (total ~15s from creation)
    service.extendTimeout(requestInfo.requestId, 10_000);

    // Advance past original timeout but before new one
    jest.advanceTimersByTime(6_000);
    const stillPending = service.getPendingRequest(requestInfo.requestId);
    expect(stillPending).not.toBeNull();

    // Advance past the extended timeout
    jest.advanceTimersByTime(10_000);
    const gone = service.getPendingRequest(requestInfo.requestId);
    expect(gone).toBeNull();

    // Promise should have been rejected with timeout
    await expect(promise).rejects.toThrow('timed out');
  });

  // ── Additional coverage ───────────────────────────────────────────────

  test('extendTimeout with 0 additionalMs does not change timeoutAt', () => {
    const { requestInfo, promise } = createPendingRequest(service, 'agent-1', 60_000);
    pendingPromises.push(promise);

    const originalTimeoutAt = requestInfo.timeoutAt;
    service.extendTimeout(requestInfo.requestId, 0);

    const updated = service.getPendingRequest(requestInfo.requestId);
    expect(updated.timeoutAt).toBe(originalTimeoutAt);
  });

  test('extendTimeout called multiple times accumulates correctly', () => {
    const { requestInfo, promise } = createPendingRequest(service, 'agent-1', 60_000);
    pendingPromises.push(promise);

    const originalTimeout = new Date(requestInfo.timeoutAt).getTime();

    service.extendTimeout(requestInfo.requestId, 60_000);
    service.extendTimeout(requestInfo.requestId, 60_000);

    const updated = service.getPendingRequest(requestInfo.requestId);
    const newTimeout = new Date(updated.timeoutAt).getTime();
    expect(newTimeout).toBe(originalTimeout + 120_000);
  });

  test('stopTimeout on already-stopped request is idempotent', () => {
    const { requestInfo, promise } = createPendingRequest(service);
    pendingPromises.push(promise);

    const firstResult = service.stopTimeout(requestInfo.requestId);
    expect(firstResult.success).toBe(true);

    // Second call should also succeed without error
    const secondResult = service.stopTimeout(requestInfo.requestId);
    expect(secondResult.success).toBe(true);

    // timeoutAt should still be null
    const updated = service.getPendingRequest(requestInfo.requestId);
    expect(updated.timeoutAt).toBeNull();
  });

  test('extendTimeout after stopTimeout re-arms the timeout', async () => {
    const { requestInfo, promise } = createPendingRequest(service, 'agent-1', 5_000);
    pendingPromises.push(promise);

    // Stop the timeout (timeoutAt becomes null)
    service.stopTimeout(requestInfo.requestId);
    const afterStop = service.getPendingRequest(requestInfo.requestId);
    expect(afterStop.timeoutAt).toBeNull();

    // Extend from null: null + additionalMs results in a new timeoutAt
    // The code does: new Date(null + 10_000) => new Date(10_000) => epoch + 10s
    // Then newRemainingMs = that date - Date.now()
    const result = service.extendTimeout(requestInfo.requestId, 10_000);
    expect(result.success).toBe(true);

    // After extending, timeoutAt should no longer be null
    const afterExtend = service.getPendingRequest(requestInfo.requestId);
    expect(afterExtend.timeoutAt).not.toBeNull();
    expect(afterExtend.timeoutAt).toBeDefined();
  });

  test('multiple concurrent requests — extending one does not affect others', () => {
    const req1 = createPendingRequest(service, 'agent-1', 60_000);
    const req2 = createPendingRequest(service, 'agent-2', 60_000);
    pendingPromises.push(req1.promise, req2.promise);

    // Capture original timeouts before any mutations (requestInfo is a live reference)
    const req1OriginalMs = new Date(req1.requestInfo.timeoutAt).getTime();
    const req2OriginalTimeout = req2.requestInfo.timeoutAt;

    // Extend only req1
    service.extendTimeout(req1.requestInfo.requestId, 30_000);

    // req2 should be unchanged
    const req2Updated = service.getPendingRequest(req2.requestInfo.requestId);
    expect(req2Updated.timeoutAt).toBe(req2OriginalTimeout);

    // req1 should be changed
    const req1Updated = service.getPendingRequest(req1.requestInfo.requestId);
    expect(new Date(req1Updated.timeoutAt).getTime()).toBe(req1OriginalMs + 30_000);
  });

  test('extendTimeout preserves all other request fields (questions, agentId, etc.)', () => {
    const { requestInfo, promise } = createPendingRequest(service, 'agent-special', 60_000);
    pendingPromises.push(promise);

    // Capture original field values before mutation
    const originalAgentId = requestInfo.agentId;
    const originalQuestions = JSON.parse(JSON.stringify(requestInfo.questions));
    const originalMessage = requestInfo.message;
    const originalCreatedAt = requestInfo.createdAt;
    const originalTimeoutAt = requestInfo.timeoutAt;

    service.extendTimeout(requestInfo.requestId, 30_000);

    const updated = service.getPendingRequest(requestInfo.requestId);
    expect(updated.agentId).toBe(originalAgentId);
    expect(updated.questions).toEqual(originalQuestions);
    expect(updated.message).toBe(originalMessage);
    expect(updated.createdAt).toBe(originalCreatedAt);
    // timeoutAt should have changed from its original value
    expect(new Date(updated.timeoutAt).getTime()).toBe(
      new Date(originalTimeoutAt).getTime() + 30_000
    );
  });
});
