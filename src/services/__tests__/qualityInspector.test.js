import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

// Mock logger since qualityInspector imports { logger } which doesn't exist as named export
jest.unstable_mockModule('../../utilities/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  Logger: jest.fn(),
  createLogger: jest.fn()
}));

const { QualityInspector } = await import('../qualityInspector.js');

describe('QualityInspector', () => {
  let inspector;
  let mockOrchestrator;

  beforeEach(() => {
    mockOrchestrator = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      sendSystemMessage: jest.fn().mockResolvedValue(undefined),
      pauseAgent: jest.fn().mockResolvedValue(undefined)
    };
    inspector = new QualityInspector(mockOrchestrator);
  });

  afterEach(() => {
    inspector.stop();
  });

  test('constructor creates instance', () => {
    expect(inspector).toBeDefined();
    expect(inspector.isRunning).toBe(false);
  });

  test('start begins monitoring', () => {
    inspector.start();
    expect(inspector.isRunning).toBe(true);
  });

  test('stop stops monitoring', () => {
    inspector.start();
    expect(inspector.isRunning).toBe(true);
    inspector.stop();
    expect(inspector.isRunning).toBe(false);
  });

  test('recordActivity stores activity for agent', () => {
    inspector.start();
    inspector.recordActivity('agent-1', { type: 'command', content: 'ls' });

    const data = inspector.monitoringData.get('agent-1');
    expect(data).toBeDefined();
    expect(data.activityHistory.length).toBe(1);
    expect(data.messageCount).toBe(1);
  });

  test('recordActivity does nothing when not running', () => {
    inspector.recordActivity('agent-1', { type: 'command', content: 'ls' });
    expect(inspector.monitoringData.has('agent-1')).toBe(false);
  });

  test('getMetrics returns metrics object', () => {
    const metrics = inspector.getMetrics();
    expect(metrics).toHaveProperty('totalInterventions');
    expect(metrics).toHaveProperty('isRunning');
    expect(typeof metrics.agentsMonitored).toBe('number');
  });

  test('generateOptimizationSuggestion returns string for slow_response', () => {
    const suggestion = inspector.generateOptimizationSuggestion({ type: 'slow_response' });
    expect(typeof suggestion).toBe('string');
    expect(suggestion.length).toBeGreaterThan(0);
  });

  test('recordActivity caps history at 100', () => {
    inspector.start();
    for (let i = 0; i < 120; i++) {
      inspector.recordActivity('agent-1', { type: 'command', content: `cmd-${i}` });
    }
    const data = inspector.monitoringData.get('agent-1');
    expect(data.activityHistory.length).toBeLessThanOrEqual(100);
    expect(data.messageCount).toBe(120);
  });

  test('getAgentReport returns null for unmonitored agent', () => {
    const report = inspector.getAgentReport('nonexistent');
    expect(report).toBeNull();
  });

  test('getAgentReport returns report for monitored agent', () => {
    inspector.start();
    inspector.recordActivity('agent-1', { type: 'command', content: 'ls' });
    const report = inspector.getAgentReport('agent-1');
    expect(report).not.toBeNull();
    expect(report.agentId).toBe('agent-1');
    expect(report.messageCount).toBe(1);
  });
});
