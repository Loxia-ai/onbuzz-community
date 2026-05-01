import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock constants before importing the module under test
const ERROR_TYPES = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  OPERATION_TIMEOUT: 'OPERATION_TIMEOUT',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR'
};

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
};

jest.unstable_mockModule('../../utilities/constants.js', () => ({
  ERROR_TYPES,
  HTTP_STATUS,
  AGENT_STATUS: {}
}));

const { ErrorHandler } = await import('../errorHandler.js');

describe('ErrorHandler', () => {
  let handler;
  let logger;

  beforeEach(() => {
    jest.useFakeTimers();
    logger = createMockLogger();
    handler = new ErrorHandler(createMockConfig(), logger);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // --- classifyError ---

  test('classifyError returns FILE_NOT_FOUND for ENOENT errors', () => {
    const error = new Error('File missing');
    error.code = 'ENOENT';
    const info = handler.classifyError(error);
    expect(info.type).toBe(ERROR_TYPES.FILE_NOT_FOUND);
    expect(info.message).toBe('File missing');
    expect(info.id).toMatch(/^err_/);
    expect(info.timestamp).toBeDefined();
  });

  test('classifyError returns PERMISSION_DENIED for EACCES errors', () => {
    const error = new Error('Access denied');
    error.code = 'EACCES';
    const info = handler.classifyError(error);
    expect(info.type).toBe(ERROR_TYPES.PERMISSION_DENIED);
  });

  test('classifyError returns AUTHENTICATION_FAILED for 401 status', () => {
    const error = new Error('Unauthorized');
    error.status = HTTP_STATUS.UNAUTHORIZED;
    const info = handler.classifyError(error);
    expect(info.type).toBe(ERROR_TYPES.AUTHENTICATION_FAILED);
  });

  test('classifyError returns RATE_LIMIT_EXCEEDED for 429 status', () => {
    const error = new Error('Rate limit');
    error.status = HTTP_STATUS.TOO_MANY_REQUESTS;
    const info = handler.classifyError(error);
    expect(info.type).toBe(ERROR_TYPES.RATE_LIMIT_EXCEEDED);
  });

  test('classifyError returns OPERATION_TIMEOUT for timeout message', () => {
    const error = new Error('Request timed out');
    const info = handler.classifyError(error);
    expect(info.type).toBe(ERROR_TYPES.OPERATION_TIMEOUT);
  });

  test('classifyError returns VALIDATION_ERROR for validation message', () => {
    const error = new Error('Input validation failed');
    const info = handler.classifyError(error);
    expect(info.type).toBe(ERROR_TYPES.VALIDATION_ERROR);
  });

  test('classifyError returns CONFIGURATION_ERROR for config message', () => {
    const error = new Error('Bad configuration');
    const info = handler.classifyError(error);
    expect(info.type).toBe(ERROR_TYPES.CONFIGURATION_ERROR);
  });

  test('classifyError uses context.operation for additional classification', () => {
    const error = new Error('Something generic');
    const info = handler.classifyError(error, { operation: 'api_request' });
    expect(info.type).toBe(ERROR_TYPES.RATE_LIMIT_EXCEEDED);
  });

  test('classifyError sets agentId, toolId, operationId from context', () => {
    const error = new Error('fail');
    const info = handler.classifyError(error, { agentId: 'a1', toolId: 't1', operationId: 'op1' });
    expect(info.agentId).toBe('a1');
    expect(info.toolId).toBe('t1');
    expect(info.operationId).toBe('op1');
  });

  test('classifyError returns UNKNOWN_ERROR for unrecognizable errors', () => {
    const error = new Error('something completely random with no keywords');
    const info = handler.classifyError(error);
    expect(info.type).toBe(ERROR_TYPES.UNKNOWN_ERROR);
  });

  // --- determineSeverity ---

  test('determineSeverity returns critical for authentication errors', () => {
    const error = new Error('Auth');
    error.status = HTTP_STATUS.UNAUTHORIZED;
    expect(handler.determineSeverity(error, {})).toBe('critical');
  });

  test('determineSeverity returns high for rate limit errors', () => {
    const error = new Error('Rate limit');
    error.status = HTTP_STATUS.TOO_MANY_REQUESTS;
    expect(handler.determineSeverity(error, {})).toBe('high');
  });

  test('determineSeverity returns high when retryCount >= 3', () => {
    const error = new Error('generic random error no keywords');
    expect(handler.determineSeverity(error, { retryCount: 3 })).toBe('high');
  });

  test('determineSeverity returns medium for agent communication', () => {
    const error = new Error('something random no keywords');
    expect(handler.determineSeverity(error, { agentId: 'a1', operation: 'agent_communication' })).toBe('medium');
  });

  test('determineSeverity returns low for generic low-priority errors', () => {
    const error = new Error('some problem');
    error.code = 'ENOENT';
    expect(handler.determineSeverity(error, {})).toBe('low');
  });

  // --- isRecoverable ---

  test('isRecoverable returns false for AUTHENTICATION_FAILED', () => {
    const info = handler.classifyError(Object.assign(new Error('auth'), { status: HTTP_STATUS.UNAUTHORIZED }));
    expect(info.recoverable).toBe(false);
  });

  test('isRecoverable returns false when retryCount >= maxRetries', () => {
    const info = { type: ERROR_TYPES.FILE_NOT_FOUND, retryCount: 5, maxRetries: 2, severity: 'low' };
    expect(handler.isRecoverable(info)).toBe(false);
  });

  test('isRecoverable returns true for transient recoverable errors', () => {
    const info = { type: ERROR_TYPES.OPERATION_TIMEOUT, retryCount: 0, maxRetries: 3, severity: 'high' };
    expect(handler.isRecoverable(info)).toBe(true);
  });

  // --- calculateRetryDelay ---

  test('calculateRetryDelay returns increasing delays with exponential backoff', () => {
    const delay0 = handler.calculateRetryDelay({ retryCount: 0 });
    // Base delay = 1000 * 2^0 + jitter(0-1000) = 1000-2000
    expect(delay0).toBeGreaterThanOrEqual(1000);
    expect(delay0).toBeLessThanOrEqual(2000);
  });

  test('calculateRetryDelay caps at 30000ms', () => {
    const delay = handler.calculateRetryDelay({ retryCount: 20 });
    expect(delay).toBeLessThanOrEqual(30000);
  });

  // --- subscribe / notifySubscribers ---

  test('subscribe registers a callback and unsubscribe removes it', () => {
    const cb = jest.fn();
    const unsub = handler.subscribe(cb);
    handler.notifySubscribers({ id: 'err1' }, { success: true });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ id: 'err1' }, { success: true });

    unsub();
    handler.notifySubscribers({ id: 'err2' }, { success: false });
    expect(cb).toHaveBeenCalledTimes(1); // not called again
  });

  test('notifySubscribers logs error if callback throws', () => {
    handler.subscribe(() => { throw new Error('boom'); });
    handler.notifySubscribers({}, {});
    expect(logger.error).toHaveBeenCalledWith('Error subscriber callback failed', expect.any(Object));
  });

  // --- getErrorStats / clearErrorStats / updateErrorStats ---

  test('getErrorStats returns accumulated stats with type and agent counts', () => {
    handler.updateErrorStats({ type: ERROR_TYPES.FILE_NOT_FOUND, agentId: 'a1' });
    handler.updateErrorStats({ type: ERROR_TYPES.FILE_NOT_FOUND });
    handler.updateErrorStats({ type: ERROR_TYPES.OPERATION_TIMEOUT, agentId: 'a1' });
    const stats = handler.getErrorStats();
    expect(stats.totalErrors).toBe(3);
    expect(stats.errorsByType[ERROR_TYPES.FILE_NOT_FOUND]).toBe(2);
    expect(stats.errorsByType[ERROR_TYPES.OPERATION_TIMEOUT]).toBe(1);
    expect(stats.errorsByAgent['a1']).toBe(2);
  });

  test('clearErrorStats resets all counters and empties queue', () => {
    handler.updateErrorStats({ type: ERROR_TYPES.FILE_NOT_FOUND });
    handler.errorQueue.push({ test: true });
    handler.clearErrorStats();
    const stats = handler.getErrorStats();
    expect(stats.totalErrors).toBe(0);
    expect(stats.queueLength).toBe(0);
    expect(stats.recoveryAttempts).toBe(0);
    expect(stats.successfulRecoveries).toBe(0);
    expect(stats.criticalErrors).toBe(0);
  });

  test('getErrorStats computes recoverySuccessRate correctly', () => {
    handler.errorStats.recoveryAttempts = 10;
    handler.errorStats.successfulRecoveries = 7;
    const stats = handler.getErrorStats();
    expect(stats.recoverySuccessRate).toBeCloseTo(0.7);
  });

  // --- handleError full pipeline ---

  test('handleError classifies, processes, updates stats and notifies subscribers', async () => {
    const cb = jest.fn();
    handler.subscribe(cb);

    const error = new Error('Request timed out');
    const result = await handler.handleError(error, { retryCount: 0 });

    expect(result).toBeDefined();
    expect(result.errorType).toBe(ERROR_TYPES.OPERATION_TIMEOUT);
    expect(result.severity).toBe('high');
    expect(result.errorId).toMatch(/^err_/);
    expect(cb).toHaveBeenCalledTimes(1);

    const stats = handler.getErrorStats();
    expect(stats.totalErrors).toBe(1);
  });

  test('handleError returns fallback result when internal processing throws', async () => {
    handler.processError = jest.fn().mockRejectedValue(new Error('processing failed'));

    const result = await handler.handleError(new Error('test'), {});
    expect(result.success).toBe(false);
    expect(result.severity).toBe('critical');
  });

  // --- shouldRetry ---

  test('shouldRetry returns false when recovery succeeded', () => {
    const info = { recoverable: true, retryCount: 0, maxRetries: 3 };
    expect(handler.shouldRetry(info, { success: true })).toBe(false);
  });

  test('shouldRetry returns true when recoverable and recovery failed', () => {
    const info = { recoverable: true, retryCount: 0, maxRetries: 3 };
    expect(handler.shouldRetry(info, { success: false })).toBe(true);
  });

  test('shouldRetry returns false when not recoverable', () => {
    const info = { recoverable: false, retryCount: 0, maxRetries: 3 };
    expect(handler.shouldRetry(info, null)).toBe(false);
  });

  // --- getMaxRetries ---

  test('getMaxRetries returns 5 for RATE_LIMIT_EXCEEDED', () => {
    const error = new Error('rate');
    error.status = HTTP_STATUS.TOO_MANY_REQUESTS;
    expect(handler.getMaxRetries(error, {})).toBe(5);
  });

  test('getMaxRetries returns 3 for OPERATION_TIMEOUT', () => {
    const error = new Error('request timed out');
    expect(handler.getMaxRetries(error, {})).toBe(3);
  });

  // --- handleCriticalError / processError ---

  test('processError handles critical error by calling handleCriticalError', async () => {
    const error = new Error('auth fail');
    error.status = HTTP_STATUS.UNAUTHORIZED;
    const errorInfo = handler.classifyError(error);
    // severity should be critical
    expect(errorInfo.severity).toBe('critical');

    const spy = jest.spyOn(handler, 'handleCriticalError');
    await handler.processError(errorInfo);
    expect(spy).toHaveBeenCalledWith(errorInfo);
  });

  test('processError returns failure result when internal error occurs', async () => {
    const errorInfo = {
      id: 'err_test', type: ERROR_TYPES.FILE_NOT_FOUND, severity: 'low',
      message: 'test', recoverable: true, retryCount: 0, maxRetries: 3
    };
    // Force logError to throw
    handler.logError = jest.fn().mockRejectedValue(new Error('log broken'));
    const result = await handler.processError(errorInfo);
    expect(result.success).toBe(false);
    expect(result.severity).toBe('critical');
  });
});
