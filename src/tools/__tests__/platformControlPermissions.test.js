/**
 * Tests for the permission helper used by platformControlTool.
 *
 * The helper is the actual security boundary — every (level × scenario)
 * combination is pinned here so a future edit can't quietly widen access.
 */

import { describe, test, expect } from '@jest/globals';
import {
  SCHEDULE_ACCESS_LEVELS,
  getScheduleAccessLevel,
  isOwnTargetAgentSchedule,
  checkScheduleAccess,
  filterAccessibleSchedules,
} from '../platformControl/permissions.js';

const { DISABLED, OWN, ALL } = SCHEDULE_ACCESS_LEVELS;

const ownSchedule = (over = {}) => ({
  id: 's1', targetType: 'agent', targetId: 'agent-self', enabled: true, ...over,
});
const otherSchedule = (over = {}) => ({
  id: 's2', targetType: 'agent', targetId: 'agent-other', enabled: true, ...over,
});
const flowSchedule = (over = {}) => ({
  id: 's3', targetType: 'flow',  targetId: 'flow-1',     enabled: true, ...over,
});

describe('getScheduleAccessLevel', () => {
  test('absent config → disabled', () => {
    expect(getScheduleAccessLevel(undefined)).toBe('disabled');
    expect(getScheduleAccessLevel(null)).toBe('disabled');
    expect(getScheduleAccessLevel({})).toBe('disabled');
  });
  test('valid values pass through', () => {
    expect(getScheduleAccessLevel({ scheduledTasks: 'disabled' })).toBe('disabled');
    expect(getScheduleAccessLevel({ scheduledTasks: 'own' })).toBe('own');
    expect(getScheduleAccessLevel({ scheduledTasks: 'all' })).toBe('all');
  });
  test('unknown values collapse to disabled — no silent grant', () => {
    expect(getScheduleAccessLevel({ scheduledTasks: 'admin' })).toBe('disabled');
    expect(getScheduleAccessLevel({ scheduledTasks: '' })).toBe('disabled');
    expect(getScheduleAccessLevel({ scheduledTasks: 42 })).toBe('disabled');
  });
});

describe('isOwnTargetAgentSchedule', () => {
  test('matches agent-target schedule with same id', () => {
    expect(isOwnTargetAgentSchedule(ownSchedule(), 'agent-self')).toBe(true);
  });
  test('rejects different agent id', () => {
    expect(isOwnTargetAgentSchedule(otherSchedule(), 'agent-self')).toBe(false);
  });
  test('rejects flow-target even when ids match coincidentally', () => {
    expect(isOwnTargetAgentSchedule({ targetType: 'flow', targetId: 'agent-self' }, 'agent-self')).toBe(false);
  });
  test('defensive: nullish inputs', () => {
    expect(isOwnTargetAgentSchedule(null, 'a')).toBe(false);
    expect(isOwnTargetAgentSchedule(ownSchedule(), null)).toBe(false);
    expect(isOwnTargetAgentSchedule(ownSchedule(), '')).toBe(false);
  });
});

describe('checkScheduleAccess', () => {
  test('disabled denies everything', () => {
    expect(checkScheduleAccess(DISABLED, 'agent-self', ownSchedule()).allow).toBe(false);
    expect(checkScheduleAccess(DISABLED, 'agent-self', otherSchedule()).allow).toBe(false);
    expect(checkScheduleAccess(DISABLED, 'agent-self', flowSchedule()).allow).toBe(false);
    expect(checkScheduleAccess(DISABLED, 'agent-self', null).allow).toBe(false);
  });

  test('flow schedules denied at every level (security invariant)', () => {
    for (const level of [OWN, ALL]) {
      const r = checkScheduleAccess(level, 'agent-self', flowSchedule());
      expect(r.allow).toBe(false);
      expect(r.reason).toMatch(/Flow-target schedules/);
    }
  });

  test('own mode: own agent-target schedule allowed', () => {
    expect(checkScheduleAccess(OWN, 'agent-self', ownSchedule()).allow).toBe(true);
  });

  test('own mode: another agent\'s schedule denied', () => {
    const r = checkScheduleAccess(OWN, 'agent-self', otherSchedule());
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/Out of scope/);
  });

  test('own mode: null schedule (asking permission to access at all) → allowed', () => {
    expect(checkScheduleAccess(OWN, 'agent-self', null).allow).toBe(true);
  });

  test('all mode: own + other agent-target schedules allowed', () => {
    expect(checkScheduleAccess(ALL, 'agent-self', ownSchedule()).allow).toBe(true);
    expect(checkScheduleAccess(ALL, 'agent-self', otherSchedule()).allow).toBe(true);
  });

  test('all mode: flow schedule still denied (per-feature invariant)', () => {
    expect(checkScheduleAccess(ALL, 'agent-self', flowSchedule()).allow).toBe(false);
  });

  test('unknown level (defensive) → denied', () => {
    const r = checkScheduleAccess('weird', 'a', ownSchedule());
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/Unknown permission level/);
  });
});

describe('filterAccessibleSchedules', () => {
  const all = [ownSchedule(), otherSchedule(), flowSchedule()];

  test('disabled → empty', () => {
    expect(filterAccessibleSchedules(DISABLED, 'agent-self', all)).toEqual([]);
  });
  test('own → only own agent-target schedules', () => {
    const out = filterAccessibleSchedules(OWN, 'agent-self', all);
    expect(out.map(s => s.id)).toEqual(['s1']);
  });
  test('all → all agent-target schedules; flows excluded', () => {
    const out = filterAccessibleSchedules(ALL, 'agent-self', all);
    expect(out.map(s => s.id).sort()).toEqual(['s1', 's2']);
  });
  test('non-array → empty', () => {
    expect(filterAccessibleSchedules(ALL, 'a', null)).toEqual([]);
    expect(filterAccessibleSchedules(ALL, 'a', undefined)).toEqual([]);
  });
});
