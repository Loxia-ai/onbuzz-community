import { describe, test, expect } from '@jest/globals';
import {
  AGENT_STATUS,
  TOOL_STATUS,
  HTTP_STATUS,
  SYSTEM_DEFAULTS,
  ERROR_TYPES
} from '../constants.js';

describe('constants', () => {
  test('AGENT_STATUS has ACTIVE, IDLE, BUSY, SUSPENDED, PAUSED', () => {
    expect(AGENT_STATUS.ACTIVE).toBe('active');
    expect(AGENT_STATUS.IDLE).toBe('idle');
    expect(AGENT_STATUS.BUSY).toBe('busy');
    expect(AGENT_STATUS.SUSPENDED).toBe('suspended');
    expect(AGENT_STATUS.PAUSED).toBe('paused');
  });

  test('TOOL_STATUS has PENDING, EXECUTING, COMPLETED, FAILED', () => {
    expect(TOOL_STATUS.PENDING).toBe('pending');
    expect(TOOL_STATUS.EXECUTING).toBe('executing');
    expect(TOOL_STATUS.COMPLETED).toBe('completed');
    expect(TOOL_STATUS.FAILED).toBe('failed');
  });

  test('HTTP_STATUS has standard codes (200, 400, 401, 404, 500)', () => {
    expect(HTTP_STATUS.OK).toBe(200);
    expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
    expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
    expect(HTTP_STATUS.NOT_FOUND).toBe(404);
    expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toBe(500);
  });

  test('SYSTEM_DEFAULTS.MAX_AGENTS_PER_PROJECT is a positive number', () => {
    expect(typeof SYSTEM_DEFAULTS.MAX_AGENTS_PER_PROJECT).toBe('number');
    expect(SYSTEM_DEFAULTS.MAX_AGENTS_PER_PROJECT).toBeGreaterThan(0);
  });

  test('ERROR_TYPES has expected error types', () => {
    expect(ERROR_TYPES.FILE_NOT_FOUND).toBe('FILE_NOT_FOUND');
    expect(ERROR_TYPES.PERMISSION_DENIED).toBe('PERMISSION_DENIED');
    expect(ERROR_TYPES.OPERATION_TIMEOUT).toBe('OPERATION_TIMEOUT');
    expect(ERROR_TYPES.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
    expect(ERROR_TYPES.AUTHENTICATION_FAILED).toBe('AUTHENTICATION_FAILED');
    expect(ERROR_TYPES.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');
    expect(ERROR_TYPES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ERROR_TYPES.CONFIGURATION_ERROR).toBe('CONFIGURATION_ERROR');
  });
});
