/**
 * Cascade-on-delete tests. The service is modular: every external
 * dependency is injected so the tests can pin "step ran / step failed
 * doesn't abort later steps / strict mode aborts on first failure /
 * report shape is stable".
 */
import { describe, test, expect, jest } from '@jest/globals';
import { cascadeDeleteAgent, cascadeDeleteTeam } from '../platformControl/cascadeService.js';

function makeServices(overrides = {}) {
  const scheduleService = {
    listSchedules: jest.fn(() => [
      { id: 's1', targetType: 'agent',  targetId: 'victim' },
      { id: 's2', targetType: 'agent',  targetId: 'someone-else' },
      { id: 's3', targetType: 'flow',   targetId: 'victim' },     // flow-target with same id — must not delete
    ]),
    deleteSchedule: jest.fn(async () => undefined),
    ...overrides.scheduleService,
  };
  const memoryService = {
    deleteMemoryFile: jest.fn(async () => true),
    ...overrides.memoryService,
  };
  const stateManager = {
    getAllTeams: jest.fn(async () => [
      { id: 'team-a', memberAgentIds: ['victim', 'other'] },
      { id: 'team-b', memberAgentIds: ['other'] },
    ]),
    removeAgentFromTeam: jest.fn(async () => undefined),
    deleteTeam: jest.fn(async () => true),
    ...overrides.stateManager,
  };
  const agentPool = {
    deleteAgent: jest.fn(async () => ({ success: true })),
    ...overrides.agentPool,
  };
  return { scheduleService, memoryService, stateManager, agentPool };
}

describe('cascadeDeleteAgent — happy path', () => {
  test('runs all four steps in order and reports counts', async () => {
    const svcs = makeServices();
    const report = await cascadeDeleteAgent({ agentId: 'victim', ...svcs });

    // schedules: only the agent-target ones for THIS agent
    expect(svcs.scheduleService.deleteSchedule).toHaveBeenCalledTimes(1);
    expect(svcs.scheduleService.deleteSchedule).toHaveBeenCalledWith('s1');
    expect(report.schedulesDeleted).toBe(1);

    // memories
    expect(svcs.memoryService.deleteMemoryFile).toHaveBeenCalledWith('victim');
    expect(report.memoriesCleaned).toBe(true);

    // teams: only the one containing 'victim'
    expect(svcs.stateManager.removeAgentFromTeam).toHaveBeenCalledTimes(1);
    expect(svcs.stateManager.removeAgentFromTeam).toHaveBeenCalledWith('team-a', 'victim');
    expect(report.teamsLeft).toEqual(['team-a']);

    // agentPool last
    expect(svcs.agentPool.deleteAgent).toHaveBeenCalledWith('victim');
    expect(report.agentDeleted).toBe(true);
    expect(report.errors).toEqual([]);
  });

  test('flow-target schedules with the same id are NOT deleted', async () => {
    const svcs = makeServices();
    await cascadeDeleteAgent({ agentId: 'victim', ...svcs });
    const calls = svcs.scheduleService.deleteSchedule.mock.calls.map(c => c[0]);
    expect(calls).toEqual(['s1']);   // not s3 (flow)
  });
});

describe('cascadeDeleteAgent — failure isolation (default = non-strict)', () => {
  test('schedule-delete failure does not block memories / teams / agent', async () => {
    const svcs = makeServices({
      scheduleService: {
        listSchedules: jest.fn(() => [{ id: 's1', targetType: 'agent', targetId: 'victim' }]),
        deleteSchedule: jest.fn(async () => { throw new Error('schedule boom'); }),
      },
    });
    const report = await cascadeDeleteAgent({ agentId: 'victim', ...svcs });
    expect(report.errors).toEqual([{ step: 'schedules', error: 'schedule boom' }]);
    // Later steps still ran
    expect(svcs.memoryService.deleteMemoryFile).toHaveBeenCalled();
    expect(svcs.stateManager.removeAgentFromTeam).toHaveBeenCalled();
    expect(svcs.agentPool.deleteAgent).toHaveBeenCalled();
    expect(report.agentDeleted).toBe(true);
  });

  test('memory failure isolated', async () => {
    const svcs = makeServices({
      memoryService: { deleteMemoryFile: jest.fn(async () => { throw new Error('disk full'); }) },
    });
    const report = await cascadeDeleteAgent({ agentId: 'victim', ...svcs });
    expect(report.errors[0]).toMatchObject({ step: 'memories', error: 'disk full' });
    expect(report.memoriesCleaned).toBe(false);
    expect(report.agentDeleted).toBe(true);    // later steps still ran
  });

  test('team failure isolated', async () => {
    const svcs = makeServices({
      stateManager: {
        getAllTeams: jest.fn(async () => [{ id: 't', memberAgentIds: ['victim'] }]),
        removeAgentFromTeam: jest.fn(async () => { throw new Error('team boom'); }),
      },
    });
    const report = await cascadeDeleteAgent({ agentId: 'victim', ...svcs });
    expect(report.errors[0]).toMatchObject({ step: 'teams' });
    expect(report.teamsLeft).toEqual([]);     // we got the error before pushing
    expect(report.agentDeleted).toBe(true);
  });

  test('agentPool failure recorded; report still returned', async () => {
    const svcs = makeServices({
      agentPool: { deleteAgent: jest.fn(async () => { throw new Error('pool boom'); }) },
    });
    const report = await cascadeDeleteAgent({ agentId: 'victim', ...svcs });
    expect(report.agentDeleted).toBe(false);
    expect(report.errors[0]).toMatchObject({ step: 'agentPool' });
  });
});

describe('cascadeDeleteAgent — strict mode', () => {
  test('first failure throws and skips later steps', async () => {
    const svcs = makeServices({
      scheduleService: {
        listSchedules: jest.fn(() => [{ id: 's1', targetType: 'agent', targetId: 'victim' }]),
        deleteSchedule: jest.fn(async () => { throw new Error('boom'); }),
      },
    });
    await expect(
      cascadeDeleteAgent({ agentId: 'victim', ...svcs, strict: true })
    ).rejects.toThrow('boom');
    // memories / teams / agentPool NOT called
    expect(svcs.memoryService.deleteMemoryFile).not.toHaveBeenCalled();
    expect(svcs.stateManager.removeAgentFromTeam).not.toHaveBeenCalled();
    expect(svcs.agentPool.deleteAgent).not.toHaveBeenCalled();
  });
});

describe('cascadeDeleteAgent — defensive', () => {
  test('throws if agentId is missing', async () => {
    await expect(cascadeDeleteAgent({ agentId: '', ...makeServices() })).rejects.toThrow(/agentId is required/);
  });

  test('missing optional services → step recorded as no-op', async () => {
    const report = await cascadeDeleteAgent({
      agentId: 'victim',
      scheduleService: null,
      memoryService: null,
      stateManager: null,
      agentPool: { deleteAgent: jest.fn(async () => undefined) },
    });
    expect(report.schedulesDeleted).toBe(0);
    expect(report.memoriesCleaned).toBe(false);
    expect(report.teamsLeft).toEqual([]);
    expect(report.agentDeleted).toBe(true);
  });
});

describe('cascadeDeleteTeam', () => {
  test('happy path — calls deleteTeam', async () => {
    const svcs = makeServices();
    const report = await cascadeDeleteTeam({ teamId: 'team-a', stateManager: svcs.stateManager });
    expect(svcs.stateManager.deleteTeam).toHaveBeenCalledWith('team-a');
    expect(report.teamDeleted).toBe(true);
  });
  test('rethrows on failure', async () => {
    await expect(cascadeDeleteTeam({
      teamId: 'team-a',
      stateManager: { deleteTeam: async () => { throw new Error('nope'); } },
    })).rejects.toThrow('nope');
  });
  test('throws if teamId missing', async () => {
    await expect(cascadeDeleteTeam({ teamId: '', stateManager: {} })).rejects.toThrow(/teamId is required/);
  });
});
