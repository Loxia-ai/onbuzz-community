import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock constants to avoid loading the full module
jest.unstable_mockModule('../../utilities/constants.js', () => ({
  BUDGET_LIMITS: { DAILY: 10, WEEKLY: 50, MONTHLY: 200 },
  USAGE_ALERTS: { THRESHOLDS: [50, 75, 90, 100], COOLDOWN_PERIOD: 3600000 }
}));

const { BudgetService } = await import('../budgetService.js');

describe('BudgetService', () => {
  let service;
  let mockLogger;
  let mockConfig;
  let mockModelsService;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = createMockLogger();
    mockConfig = createMockConfig();
    mockConfig.budgets = { daily: 10, weekly: 50, monthly: 200 };

    mockModelsService = {
      getModels: jest.fn().mockReturnValue([
        {
          name: 'gpt-4',
          pricing: { input: 0.03, output: 0.06 }
        },
        {
          name: 'claude-3-haiku',
          pricing: { input: 0.00025, output: 0.00125 }
        }
      ])
    };

    service = new BudgetService(mockConfig, mockLogger, mockModelsService);
  });

  // ───── Cost Calculation ─────

  describe('calculateCost', () => {
    test('returns 0 for zero tokens', () => {
      const cost = service.calculateCost('gpt-4', {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      });

      expect(cost).toBe(0);
    });

    test('returns positive number for non-zero tokens', () => {
      const cost = service.calculateCost('gpt-4', {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500
      });

      expect(cost).toBeGreaterThan(0);
    });

    test('uses model-specific pricing when available', () => {
      // gpt-4 pricing: input 0.03/1K, output 0.06/1K
      const cost = service.calculateCost('gpt-4', {
        prompt_tokens: 1000,
        completion_tokens: 1000,
        total_tokens: 2000
      });

      // Expected: (1000 * 0.03/1000) + (1000 * 0.06/1000) = 0.03 + 0.06 = 0.09
      expect(cost).toBeCloseTo(0.09, 5);
    });

    test('uses default pricing (returns 0) for unknown models', () => {
      const cost = service.calculateCost('unknown-model-xyz', {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500
      });

      // No pricing found -> returns 0
      expect(cost).toBe(0);
    });
  });

  // ───── Usage Tracking ─────

  describe('trackUsage', () => {
    test('increments daily usage', () => {
      service.trackUsage('agent-1', 'gpt-4', {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150
      });

      const dayKey = service.getDayKey(new Date());
      const dailyUsage = service.usage.daily.get(dayKey);

      expect(dailyUsage).toBeDefined();
      expect(dailyUsage.tokens).toBe(150);
      expect(dailyUsage.requests).toBe(1);
    });

    test('tracks per-agent usage', () => {
      service.trackUsage('agent-1', 'gpt-4', {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150
      });

      const dayKey = service.getDayKey(new Date());
      const dailyUsage = service.usage.daily.get(dayKey);

      expect(dailyUsage.byAgent['agent-1']).toBeDefined();
      expect(dailyUsage.byAgent['agent-1'].tokens).toBe(150);
      expect(dailyUsage.byAgent['agent-1'].requests).toBe(1);
    });

    test('tracks per-model usage', () => {
      service.trackUsage('agent-1', 'claude-3-haiku', {
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300
      });

      const dayKey = service.getDayKey(new Date());
      const dailyUsage = service.usage.daily.get(dayKey);

      expect(dailyUsage.byModel['claude-3-haiku']).toBeDefined();
      expect(dailyUsage.byModel['claude-3-haiku'].tokens).toBe(300);
    });

    test('multiple calls accumulate correctly', () => {
      service.trackUsage('agent-1', 'gpt-4', {
        prompt_tokens: 100, completion_tokens: 50, total_tokens: 150
      });
      service.trackUsage('agent-2', 'gpt-4', {
        prompt_tokens: 200, completion_tokens: 100, total_tokens: 300
      });
      service.trackUsage('agent-1', 'gpt-4', {
        prompt_tokens: 50, completion_tokens: 25, total_tokens: 75
      });

      expect(service.usage.total.tokens).toBe(525);
      expect(service.usage.total.requests).toBe(3);

      const dayKey = service.getDayKey(new Date());
      const dailyUsage = service.usage.daily.get(dayKey);
      expect(dailyUsage.tokens).toBe(525);
      expect(dailyUsage.requests).toBe(3);

      // agent-1 should have accumulated across two calls
      expect(dailyUsage.byAgent['agent-1'].tokens).toBe(225);
      expect(dailyUsage.byAgent['agent-1'].requests).toBe(2);
    });
  });

  // ───── Budget Checking ─────

  describe('budget checking', () => {
    test('isWithinBudget returns true when under limit', () => {
      // No usage tracked yet, so well under limit
      expect(service.isWithinBudget('daily')).toBe(true);
    });

    test('isWithinBudget returns false when over daily limit', () => {
      // Force daily usage above the $10 limit
      const dayKey = service.getDayKey(new Date());
      service.usage.daily.set(dayKey, {
        cost: 15,
        tokens: 100000,
        requests: 50,
        byAgent: {},
        byModel: {}
      });

      expect(service.isWithinBudget('daily')).toBe(false);
    });

    test('getRemainingBudget decreases after usage', () => {
      const before = service.getRemainingBudget();
      expect(before.daily).toBe(10);

      // Track some usage that has cost
      service.trackUsage('agent-1', 'gpt-4', {
        prompt_tokens: 1000,
        completion_tokens: 1000,
        total_tokens: 2000
      });

      const after = service.getRemainingBudget();
      expect(after.daily).toBeLessThan(before.daily);
    });

    test('setBudgets with custom values overrides defaults', () => {
      service.setBudgets({ daily: 25, weekly: 100, monthly: 500 });

      expect(service.budgets.daily).toBe(25);
      expect(service.budgets.weekly).toBe(100);
      expect(service.budgets.monthly).toBe(500);

      // Remaining budget should reflect new limits
      const remaining = service.getRemainingBudget();
      expect(remaining.daily).toBe(25);
      expect(remaining.weekly).toBe(100);
      expect(remaining.monthly).toBe(500);
    });
  });
});
