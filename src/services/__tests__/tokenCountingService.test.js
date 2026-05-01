import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';
import TokenCountingService from '../tokenCountingService.js';

describe('TokenCountingService', () => {
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  test('constructor creates instance', () => {
    const service = new TokenCountingService(logger);
    expect(service).toBeInstanceOf(TokenCountingService);
    expect(service.logger).toBe(logger);
  });

  test('getModelContextWindow returns positive number for known model', () => {
    const service = new TokenCountingService(logger);
    // Use a fallback model name that exists in the hardcoded map
    const contextWindow = service.getModelContextWindow('gpt-4');
    expect(typeof contextWindow).toBe('number');
    expect(contextWindow).toBeGreaterThan(0);
  });

  test('shouldTriggerCompaction returns true when near limit', () => {
    const service = new TokenCountingService(logger);
    // currentTokens + maxOutputTokens >= threshold * contextWindow
    // 90000 + 8192 = 98192 >= 0.7 * 128000 = 89600 => true
    const result = service.shouldTriggerCompaction(90000, 8192, 128000);
    expect(result).toBe(true);
  });

  test('shouldTriggerCompaction returns false when well under limit', () => {
    const service = new TokenCountingService(logger);
    // 10000 + 8192 = 18192 < 0.7 * 128000 = 89600 => false
    const result = service.shouldTriggerCompaction(10000, 8192, 128000);
    expect(result).toBe(false);
  });

  test('calculateTargetTokenCount returns positive number', () => {
    const service = new TokenCountingService(logger);
    const target = service.calculateTargetTokenCount(128000);
    expect(typeof target).toBe('number');
    expect(target).toBeGreaterThan(0);
    expect(target).toBeLessThanOrEqual(128000);
  });
});
