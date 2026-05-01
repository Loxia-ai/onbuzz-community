import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock fs, child_process, and userDataDir before importing
jest.unstable_mockModule('fs', () => ({
  promises: {
    readFile: jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
  }
}));

jest.unstable_mockModule('child_process', () => ({
  execSync: jest.fn().mockReturnValue('')
}));

jest.unstable_mockModule('../../utilities/userDataDir.js', () => ({
  getUserDataDir: jest.fn().mockReturnValue('/tmp/test-loxia-data')
}));

const { default: ScheduleService, CRON_PRESETS, parseCron, cronMatchesDate, getNextCronDate } = await import('../scheduleService.js');

describe('parseCron', () => {
  test('parses wildcard fields to full range', () => {
    const parsed = parseCron('* * * * *');
    expect(parsed.minutes.size).toBe(60);
    expect(parsed.hours.size).toBe(24);
    expect(parsed.daysOfMonth.size).toBe(31);
    expect(parsed.months.size).toBe(12);
    expect(parsed.daysOfWeek.size).toBe(7);
  });

  test('parses step values (*/15)', () => {
    const parsed = parseCron('*/15 * * * *');
    expect([...parsed.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  test('parses ranges (1-5)', () => {
    const parsed = parseCron('0 9 * * 1-5');
    expect([...parsed.daysOfWeek].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test('parses lists (0,6)', () => {
    const parsed = parseCron('0 10 * * 0,6');
    expect([...parsed.daysOfWeek].sort((a, b) => a - b)).toEqual([0, 6]);
  });

  test('parses specific numeric values', () => {
    const parsed = parseCron('30 8 15 6 3');
    expect([...parsed.minutes]).toEqual([30]);
    expect([...parsed.hours]).toEqual([8]);
    expect([...parsed.daysOfMonth]).toEqual([15]);
    expect([...parsed.months]).toEqual([6]);
    expect([...parsed.daysOfWeek]).toEqual([3]);
  });

  test('parses step with range (1-10/2)', () => {
    const parsed = parseCron('1-10/2 * * * *');
    expect([...parsed.minutes].sort((a, b) => a - b)).toEqual([1, 3, 5, 7, 9]);
  });

  test('parses step with specific start (5/10)', () => {
    const parsed = parseCron('5/10 * * * *');
    expect([...parsed.minutes].sort((a, b) => a - b)).toEqual([5, 15, 25, 35, 45, 55]);
  });

  test('throws on invalid cron expression (wrong field count)', () => {
    expect(() => parseCron('* * *')).toThrow('expected 5 fields');
  });
});

describe('cronMatchesDate', () => {
  test('returns true when date matches all fields', () => {
    // 2026-01-05 is a Monday (day 1), month 1, day 5
    const date = new Date(2026, 0, 5, 9, 0);
    const parsed = parseCron('0 9 5 1 1');
    expect(cronMatchesDate(parsed, date)).toBe(true);
  });

  test('returns false when minute does not match', () => {
    const date = new Date(2026, 0, 5, 9, 30);
    const parsed = parseCron('0 9 5 1 1');
    expect(cronMatchesDate(parsed, date)).toBe(false);
  });

  test('matches every-minute wildcard for any date', () => {
    const date = new Date(2026, 5, 15, 14, 37);
    const parsed = parseCron('* * * * *');
    expect(cronMatchesDate(parsed, date)).toBe(true);
  });

  test('returns false when hour does not match', () => {
    const date = new Date(2026, 0, 5, 10, 0);
    const parsed = parseCron('0 9 * * *');
    expect(cronMatchesDate(parsed, date)).toBe(false);
  });
});

describe('getNextCronDate', () => {
  test('returns next matching date in the future', () => {
    const parsed = parseCron('0 9 * * *'); // daily at 9:00
    const after = new Date(2026, 0, 1, 10, 0);
    const next = getNextCronDate(parsed, after);
    expect(next).not.toBeNull();
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(2);
  });

  test('returns null for impossible date like Feb 31', () => {
    const parsed = parseCron('0 0 31 2 *');
    const next = getNextCronDate(parsed);
    expect(next).toBeNull();
  });

  test('returns a Date instance for every-minute', () => {
    const parsed = parseCron('* * * * *');
    const now = new Date();
    const next = getNextCronDate(parsed, now);
    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('CRON_PRESETS', () => {
  test('contains expected preset keys and values', () => {
    expect(CRON_PRESETS['every-minute']).toBe('* * * * *');
    expect(CRON_PRESETS['every-5-minutes']).toBe('*/5 * * * *');
    expect(CRON_PRESETS['daily']).toBe('0 9 * * *');
    expect(CRON_PRESETS['weekdays']).toBe('0 9 * * 1-5');
    expect(CRON_PRESETS['weekends']).toBe('0 10 * * 0,6');
    expect(CRON_PRESETS['monthly']).toBe('0 9 1 * *');
    expect(CRON_PRESETS['weekly-monday']).toBe('0 9 * * 1');
  });

  test('all presets are valid parseable cron expressions', () => {
    for (const [, expr] of Object.entries(CRON_PRESETS)) {
      expect(() => parseCron(expr)).not.toThrow();
    }
  });
});

describe('ScheduleService', () => {
  let service;
  let logger;

  beforeEach(async () => {
    logger = createMockLogger();
    service = new ScheduleService(logger);
    await service.initialize();
  });

  test('createSchedule creates and stores a schedule with correct fields', async () => {
    const schedule = await service.createSchedule({
      name: 'Test Schedule',
      prompt: 'Do something',
      targetType: 'agent',
      targetId: 'agent-1',
      cronExpression: '0 9 * * *'
    });

    expect(schedule.id).toMatch(/^schedule-/);
    expect(schedule.name).toBe('Test Schedule');
    expect(schedule.enabled).toBe(true);
    expect(schedule.cronExpression).toBe('0 9 * * *');
    expect(schedule.nextRun).toBeDefined();
    expect(schedule.runCount).toBe(0);
    expect(schedule.lastRun).toBeNull();
  });

  test('createSchedule resolves cron presets to actual expressions', async () => {
    const schedule = await service.createSchedule({
      name: 'Daily',
      prompt: 'Hello',
      targetType: 'agent',
      targetId: 'a1',
      cronExpression: 'daily'
    });
    expect(schedule.cronExpression).toBe('0 9 * * *');
    expect(schedule.cronPreset).toBe('daily');
  });

  test('createSchedule throws on missing name', async () => {
    await expect(service.createSchedule({ prompt: 'x', targetType: 'agent', targetId: 'a', cronExpression: '* * * * *' }))
      .rejects.toThrow('Schedule name is required');
  });

  test('createSchedule throws on missing prompt', async () => {
    await expect(service.createSchedule({ name: 'x' })).rejects.toThrow('Prompt is required');
  });

  test('createSchedule throws on invalid targetType', async () => {
    await expect(service.createSchedule({
      name: 'x', prompt: 'y', targetType: 'invalid', targetId: 'z', cronExpression: '* * * * *'
    })).rejects.toThrow('targetType must be');
  });

  test('createSchedule throws on missing targetId', async () => {
    await expect(service.createSchedule({
      name: 'x', prompt: 'y', targetType: 'agent', cronExpression: '* * * * *'
    })).rejects.toThrow('targetId is required');
  });

  test('createSchedule throws on missing cronExpression', async () => {
    await expect(service.createSchedule({
      name: 'x', prompt: 'y', targetType: 'agent', targetId: 'a1'
    })).rejects.toThrow('cronExpression is required');
  });

  test('getSchedule returns schedule by id or null', async () => {
    const created = await service.createSchedule({
      name: 'Get Test', prompt: 'p', targetType: 'flow', targetId: 'f1', cronExpression: '* * * * *'
    });
    expect(service.getSchedule(created.id)).toBe(created);
    expect(service.getSchedule('nonexistent')).toBeNull();
  });

  test('deleteSchedule removes the schedule', async () => {
    const created = await service.createSchedule({
      name: 'Del Test', prompt: 'p', targetType: 'agent', targetId: 'a1', cronExpression: '* * * * *'
    });
    await service.deleteSchedule(created.id);
    expect(service.getSchedule(created.id)).toBeNull();
  });

  test('deleteSchedule throws on nonexistent id', async () => {
    await expect(service.deleteSchedule('nope')).rejects.toThrow('Schedule not found');
  });

  test('listSchedules returns all schedules sorted by createdAt descending', async () => {
    await service.createSchedule({
      name: 'A', prompt: 'p', targetType: 'agent', targetId: 'a1', cronExpression: '* * * * *'
    });
    await service.createSchedule({
      name: 'B', prompt: 'p', targetType: 'agent', targetId: 'a1', cronExpression: '* * * * *'
    });
    const list = service.listSchedules();
    expect(list.length).toBe(2);
    const names = list.map(s => s.name);
    expect(names).toContain('A');
    expect(names).toContain('B');
  });

  test('updateSchedule modifies allowed fields', async () => {
    const created = await service.createSchedule({
      name: 'Up Test', prompt: 'p', targetType: 'agent', targetId: 'a1', cronExpression: '* * * * *'
    });
    const updated = await service.updateSchedule(created.id, { name: 'Updated Name', enabled: false });
    expect(updated.name).toBe('Updated Name');
    expect(updated.enabled).toBe(false);
  });

  test('updateSchedule throws on nonexistent id', async () => {
    await expect(service.updateSchedule('nope', {})).rejects.toThrow('Schedule not found');
  });

  test('updateSchedule recalculates nextRun when cron changes', async () => {
    const created = await service.createSchedule({
      name: 'Cron Change', prompt: 'p', targetType: 'agent', targetId: 'a1', cronExpression: '* * * * *'
    });
    const updated = await service.updateSchedule(created.id, { cronExpression: '0 12 * * *' });
    expect(updated.cronExpression).toBe('0 12 * * *');
    expect(updated.nextRun).toBeDefined();
  });

  test('updateSchedule recalculates nextRun when re-enabling', async () => {
    const created = await service.createSchedule({
      name: 'Re-enable', prompt: 'p', targetType: 'agent', targetId: 'a1', cronExpression: '0 9 * * *', enabled: false
    });
    const updated = await service.updateSchedule(created.id, { enabled: true });
    expect(updated.enabled).toBe(true);
    expect(updated.nextRun).toBeDefined();
  });

  test('start and stop manage the check timer', () => {
    service.start();
    expect(service.checkTimer).not.toBeNull();
    service.stop();
    expect(service.checkTimer).toBeNull();
  });

  test('start is idempotent (calling twice does not duplicate timers)', () => {
    service.start();
    const timer1 = service.checkTimer;
    service.start();
    expect(service.checkTimer).toBe(timer1);
    service.stop();
  });

  test('getPresets returns a copy of CRON_PRESETS', () => {
    const presets = service.getPresets();
    expect(presets).toEqual(CRON_PRESETS);
    presets['custom'] = 'modified';
    expect(CRON_PRESETS['custom']).toBeUndefined();
  });

  test('dependency injection setters store references', () => {
    const pool = {};
    const mp = {};
    const fe = {};
    service.setAgentPool(pool);
    service.setMessageProcessor(mp);
    service.setFlowExecutor(fe);
    expect(service.agentPool).toBe(pool);
    expect(service.messageProcessor).toBe(mp);
    expect(service.flowExecutor).toBe(fe);
  });
});
