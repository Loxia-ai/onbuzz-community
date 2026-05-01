/**
 * platformControlTool — end-to-end action tests against a stubbed
 * ScheduleService. The tool is the dispatcher; the security boundary
 * lives in permissions.js (covered separately). These tests pin the
 * dispatch behavior:
 *
 *   - disabled / no service → tool returns disabled or unavailable shape
 *   - 'own' mode → can list/CRUD only own; cannot probe others (404'd)
 *   - 'all' mode → full access
 *   - 'self' resolves to context.agentId
 *   - schedule-self-resume converts a future ISO into a one-shot cron
 *   - flow-target schedules are unreachable at any level
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { PlatformControlTool } from '../platformControlTool.js';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

function makeStubService(initial = []) {
  const map = new Map(initial.map(s => [s.id, s]));
  return {
    listSchedules: jest.fn(() => Array.from(map.values())),
    getSchedule:   jest.fn((id) => map.get(id) || null),
    createSchedule: jest.fn(async (cfg) => {
      const id = `sched-${map.size + 1}`;
      const sched = {
        id, ...cfg,
        nextRun: '2099-01-01T00:00:00Z',
        runCount: 0, createdAt: '2026-04-26T00:00:00Z', updatedAt: '2026-04-26T00:00:00Z',
      };
      map.set(id, sched);
      return sched;
    }),
    updateSchedule: jest.fn(async (id, updates) => {
      const sched = map.get(id);
      if (!sched) throw new Error(`Schedule not found: ${id}`);
      Object.assign(sched, updates, { updatedAt: '2026-04-26T00:00:00Z' });
      return sched;
    }),
    deleteSchedule: jest.fn(async (id) => {
      if (!map.has(id)) throw new Error(`Schedule not found: ${id}`);
      map.delete(id);
    }),
    _executeSchedule: jest.fn(async () => undefined),
    _store: map,
  };
}

function ctx({ agentId = 'agent-self', level } = {}) {
  return {
    agentId,
    toolConfig: level !== undefined ? { scheduledTasks: level } : {},
  };
}

const ownSched = (over = {}) => ({
  id: 's-own', name: 'own', targetType: 'agent', targetId: 'agent-self',
  cronExpression: '0 9 * * *', enabled: true, prompt: 'do thing', ...over,
});
const otherSched = (over = {}) => ({
  id: 's-other', name: 'other', targetType: 'agent', targetId: 'agent-other',
  cronExpression: '0 9 * * *', enabled: true, prompt: 'do thing', ...over,
});
const flowSched = (over = {}) => ({
  id: 's-flow', name: 'flow', targetType: 'flow', targetId: 'flow-1',
  cronExpression: '0 9 * * *', enabled: true, prompt: 'do thing', ...over,
});

describe('disabled (default)', () => {
  let tool, svc;
  beforeEach(() => { tool = new PlatformControlTool({}, LOGGER); svc = makeStubService(); tool.setScheduleService(svc); });

  test('list-schedules → success: false, disabled: true', async () => {
    const r = await tool.execute({ action: 'list-schedules' }, ctx());
    expect(r).toMatchObject({ success: false, disabled: true });
  });
  test('create-schedule → success: false, disabled: true (regardless of params)', async () => {
    const r = await tool.execute({ action: 'create-schedule', name: 'x' }, ctx());
    expect(r).toMatchObject({ success: false, disabled: true });
  });
  test('schedule-self-resume → disabled', async () => {
    const r = await tool.execute({ action: 'schedule-self-resume', runAt: '2099-01-01T00:00:00Z', prompt: 'x' }, ctx());
    expect(r).toMatchObject({ success: false, disabled: true });
  });
  test('list-capabilities IS allowed even when disabled (so agent can self-discover)', async () => {
    const r = await tool.execute({ action: 'list-capabilities' }, ctx());
    expect(r.success).toBe(true);
    expect(r.capabilities.scheduledTasks.level).toBe('disabled');
    expect(r.capabilities.scheduledTasks.canMutateOwn).toBe(false);
  });
});

describe('no ScheduleService injected', () => {
  test('any feature action → success: false (excluding capabilities)', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    // service NOT set — schedulable actions must report unavailable
    const r = await tool.execute({ action: 'list-schedules' }, ctx({ level: 'own' }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/ScheduleService is not available/);
  });
});

describe('own mode', () => {
  let tool, svc;
  beforeEach(() => {
    tool = new PlatformControlTool({}, LOGGER);
    svc = makeStubService([ownSched(), otherSched(), flowSched()]);
    tool.setScheduleService(svc);
  });

  test('list-schedules returns only own agent-target schedules; flows excluded', async () => {
    const r = await tool.execute({ action: 'list-schedules' }, ctx({ level: 'own' }));
    expect(r.success).toBe(true);
    expect(r.scope).toBe('own');
    expect(r.schedules.map(s => s.id)).toEqual(['s-own']);
    expect(r.count).toBe(1);
  });

  test('get-schedule on own → returns it', async () => {
    const r = await tool.execute({ action: 'get-schedule', scheduleId: 's-own' }, ctx({ level: 'own' }));
    expect(r.success).toBe(true);
    expect(r.schedule.id).toBe('s-own');
  });

  test('get-schedule on another agent\'s schedule → 404 shape (cannot probe)', async () => {
    const r = await tool.execute({ action: 'get-schedule', scheduleId: 's-other' }, ctx({ level: 'own' }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  test('get-schedule on flow → 404 shape (flows out of scope)', async () => {
    const r = await tool.execute({ action: 'get-schedule', scheduleId: 's-flow' }, ctx({ level: 'own' }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  test('create-schedule defaults targetAgentId to self', async () => {
    const r = await tool.execute({
      action: 'create-schedule',
      name: 'mine', prompt: 'go', cronExpression: '0 9 * * *',
    }, ctx({ level: 'own' }));
    expect(r.success).toBe(true);
    expect(svc.createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'agent', targetId: 'agent-self',
    }));
  });

  test('create-schedule with explicit "self" works', async () => {
    const r = await tool.execute({
      action: 'create-schedule',
      name: 'mine', prompt: 'go', cronExpression: '0 9 * * *',
      targetAgentId: 'self',
    }, ctx({ level: 'own' }));
    expect(r.success).toBe(true);
    expect(svc.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'agent-self' }));
  });

  test('create-schedule with another agent\'s id is REJECTED', async () => {
    const r = await tool.execute({
      action: 'create-schedule',
      name: 'sneaky', prompt: 'go', cronExpression: '0 9 * * *',
      targetAgentId: 'agent-other',
    }, ctx({ level: 'own' }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Out of scope/i);
    expect(svc.createSchedule).not.toHaveBeenCalled();
  });

  test('update-schedule on own works', async () => {
    const r = await tool.execute({
      action: 'update-schedule', scheduleId: 's-own', name: 'renamed',
    }, ctx({ level: 'own' }));
    expect(r.success).toBe(true);
    expect(svc.updateSchedule).toHaveBeenCalledWith('s-own', expect.objectContaining({ name: 'renamed' }));
  });

  test('update-schedule on another agent\'s → 404', async () => {
    const r = await tool.execute({
      action: 'update-schedule', scheduleId: 's-other', name: 'x',
    }, ctx({ level: 'own' }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
    expect(svc.updateSchedule).not.toHaveBeenCalled();
  });

  test('update-schedule cannot reassign own→other in own mode', async () => {
    const r = await tool.execute({
      action: 'update-schedule', scheduleId: 's-own', targetAgentId: 'agent-other',
    }, ctx({ level: 'own' }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Out of scope/i);
  });

  test('delete-schedule on own works', async () => {
    const r = await tool.execute({ action: 'delete-schedule', scheduleId: 's-own' }, ctx({ level: 'own' }));
    expect(r.success).toBe(true);
    expect(svc.deleteSchedule).toHaveBeenCalledWith('s-own');
  });

  test('delete-schedule on another\'s → 404', async () => {
    const r = await tool.execute({ action: 'delete-schedule', scheduleId: 's-other' }, ctx({ level: 'own' }));
    expect(r.success).toBe(false);
    expect(svc.deleteSchedule).not.toHaveBeenCalled();
  });

  test('toggle-schedule flips by default', async () => {
    const r = await tool.execute({ action: 'toggle-schedule', scheduleId: 's-own' }, ctx({ level: 'own' }));
    expect(r.success).toBe(true);
    expect(r.enabled).toBe(false);   // was true → flipped to false
  });
  test('toggle-schedule with explicit enabled sets it', async () => {
    const r = await tool.execute({ action: 'toggle-schedule', scheduleId: 's-own', enabled: false }, ctx({ level: 'own' }));
    expect(r.enabled).toBe(false);
  });

  test('trigger-schedule on own fires _executeSchedule', async () => {
    const r = await tool.execute({ action: 'trigger-schedule', scheduleId: 's-own' }, ctx({ level: 'own' }));
    expect(r.success).toBe(true);
    expect(svc._executeSchedule).toHaveBeenCalled();
  });

  test('trigger-schedule on another\'s → 404, no exec', async () => {
    const r = await tool.execute({ action: 'trigger-schedule', scheduleId: 's-other' }, ctx({ level: 'own' }));
    expect(r.success).toBe(false);
    expect(svc._executeSchedule).not.toHaveBeenCalled();
  });
});

describe('all mode', () => {
  let tool, svc;
  beforeEach(() => {
    tool = new PlatformControlTool({}, LOGGER);
    svc = makeStubService([ownSched(), otherSched(), flowSched()]);
    tool.setScheduleService(svc);
  });

  test('list-schedules returns all agent-target schedules; flows still excluded', async () => {
    const r = await tool.execute({ action: 'list-schedules' }, ctx({ level: 'all' }));
    expect(r.scope).toBe('all');
    expect(r.schedules.map(s => s.id).sort()).toEqual(['s-other', 's-own']);
  });

  test('get-schedule on another agent\'s → success', async () => {
    const r = await tool.execute({ action: 'get-schedule', scheduleId: 's-other' }, ctx({ level: 'all' }));
    expect(r.success).toBe(true);
    expect(r.schedule.id).toBe('s-other');
  });

  test('get-schedule on flow → STILL 404 (flows out of scope at every level)', async () => {
    const r = await tool.execute({ action: 'get-schedule', scheduleId: 's-flow' }, ctx({ level: 'all' }));
    expect(r.success).toBe(false);
  });

  test('create-schedule for another agent works in all mode', async () => {
    const r = await tool.execute({
      action: 'create-schedule', name: 'cross', prompt: 'go',
      cronExpression: '0 9 * * *', targetAgentId: 'agent-other',
    }, ctx({ level: 'all' }));
    expect(r.success).toBe(true);
    expect(svc.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'agent-other' }));
  });

  test('update-schedule can reassign target in all mode', async () => {
    const r = await tool.execute({
      action: 'update-schedule', scheduleId: 's-own', targetAgentId: 'agent-other',
    }, ctx({ level: 'all' }));
    expect(r.success).toBe(true);
    expect(svc.updateSchedule).toHaveBeenCalledWith('s-own', expect.objectContaining({ targetId: 'agent-other' }));
  });
});

describe('schedule-self-resume', () => {
  let tool, svc;
  beforeEach(() => {
    tool = new PlatformControlTool({}, LOGGER);
    svc = makeStubService();
    tool.setScheduleService(svc);
  });

  test('future ISO → creates one-shot agent-target schedule for caller', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000); // +1 hour
    const r = await tool.execute({
      action: 'schedule-self-resume',
      runAt: future.toISOString(),
      prompt: 'wake up and check email',
    }, ctx({ level: 'own' }));
    expect(r.success).toBe(true);
    expect(svc.createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'agent',
      targetId:   'agent-self',
      runOnce:    true,
      enabled:    true,
      prompt:     'wake up and check email',
    }));
    expect(r.cronExpression).toMatch(/^\d+ \d+ \d+ \d+ \*$/);
  });

  test('past ISO is rejected', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const r = await tool.execute({
      action: 'schedule-self-resume', runAt: past, prompt: 'too late',
    }, ctx({ level: 'own' }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/future/);
    expect(svc.createSchedule).not.toHaveBeenCalled();
  });

  test('invalid ISO is rejected', async () => {
    const r = await tool.execute({
      action: 'schedule-self-resume', runAt: 'not-a-date', prompt: 'x',
    }, ctx({ level: 'own' }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/valid datetime/);
  });

  test('missing prompt rejected', async () => {
    const r = await tool.execute({
      action: 'schedule-self-resume', runAt: new Date(Date.now() + 3600_000).toISOString(),
    }, ctx({ level: 'own' }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/prompt/);
  });

  test('default name is generated when omitted', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await tool.execute({
      action: 'schedule-self-resume', runAt: future, prompt: 'go',
    }, ctx({ level: 'own' }));
    expect(svc.createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringMatching(/^Self-resume @/),
    }));
  });

  test('explicit name passes through', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await tool.execute({
      action: 'schedule-self-resume', runAt: future, prompt: 'go', name: 'My wake-up',
    }, ctx({ level: 'own' }));
    expect(svc.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ name: 'My wake-up' }));
  });
});

describe('list-presets + list-capabilities', () => {
  test('list-presets returns the canonical set', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    tool.setScheduleService(makeStubService());
    const r = await tool.execute({ action: 'list-presets' }, ctx({ level: 'own' }));
    expect(r.success).toBe(true);
    expect(r.presets).toEqual(expect.arrayContaining(['daily', 'every-hour', 'weekdays']));
  });
  test('list-capabilities reports own mode correctly', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    tool.setScheduleService(makeStubService());
    const r = await tool.execute({ action: 'list-capabilities' }, ctx({ level: 'own' }));
    expect(r.capabilities.scheduledTasks).toMatchObject({
      level: 'own', canListOwn: true, canListAll: false, canMutateOwn: true, canMutateAll: false,
    });
  });
  test('list-capabilities reports all mode correctly', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    tool.setScheduleService(makeStubService());
    const r = await tool.execute({ action: 'list-capabilities' }, ctx({ level: 'all' }));
    expect(r.capabilities.scheduledTasks).toMatchObject({
      level: 'all', canListAll: true, canMutateAll: true,
    });
  });
});

describe('unknown action', () => {
  test('returns informative error listing supported actions', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    tool.setScheduleService(makeStubService());
    const r = await tool.execute({ action: 'teleport' }, ctx({ level: 'own' }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown action: teleport/);
    expect(r.error).toMatch(/list-schedules/);
  });
});

describe('getSupportedActions', () => {
  test('includes every documented action', () => {
    const tool = new PlatformControlTool({}, LOGGER);
    const actions = tool.getSupportedActions();
    expect(actions).toEqual(expect.arrayContaining([
      'list-capabilities', 'list-schedules', 'get-schedule', 'create-schedule',
      'update-schedule', 'delete-schedule', 'toggle-schedule', 'trigger-schedule',
      'list-presets', 'schedule-self-resume',
    ]));
  });
});
