/**
 * Tool-level tests for the agent + team CRUD additions to platformcontrol.
 *
 * Stubs the four injected services (agentPool, stateManager,
 * scheduleService, memoryService). Pins:
 *   - Permission level gating per action
 *   - Hard rules: no-self, no-ancestor
 *   - Privilege clamp on create/update agent's toolConfig.platformcontrol
 *   - Per-creator quota (maxAgentsCreated)
 *   - createdBy tagging on new agents and teams
 *   - Cascade orchestration on delete-agent / delete-team
 *   - Team scope filtering for list/update/delete
 *   - Self-leave on remove-team-member
 *   - Self-add on add-team-member
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { PlatformControlTool } from '../platformControlTool.js';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

// ── stubs ────────────────────────────────────────────────────────────

function makeAgentPool(initial = []) {
  const map = new Map(initial.map(a => [a.id, a]));
  return {
    getAllAgents: jest.fn(async () => Array.from(map.values())),
    getAgent:     jest.fn(async (id) => map.get(id) || null),
    createAgent:  jest.fn(async (cfg) => {
      const id = `agent-${map.size + 1}`;
      const a = { id, ...cfg, status: 'active', mode: 'CHAT' };
      map.set(id, a);
      return a;
    }),
    updateAgent:  jest.fn(async (id, updates) => {
      const a = map.get(id);
      if (!a) throw new Error(`Agent not found: ${id}`);
      Object.assign(a, updates);
      return a;
    }),
    deleteAgent:  jest.fn(async (id) => {
      if (!map.has(id)) throw new Error(`Agent not found: ${id}`);
      map.delete(id);
      return { success: true };
    }),
    _store: map,
  };
}

function makeScheduleService() {
  return {
    listSchedules: jest.fn(() => []),
    getSchedule:   jest.fn(() => null),
    createSchedule: jest.fn(async () => ({})),
    updateSchedule: jest.fn(async () => ({})),
    deleteSchedule: jest.fn(async () => undefined),
    _executeSchedule: jest.fn(async () => undefined),
  };
}

function makeMemoryService() {
  return { deleteMemoryFile: jest.fn(async () => true) };
}

function makeStateManager(initialTeams = []) {
  const teams = new Map(initialTeams.map(t => [t.id, t]));
  return {
    getAllTeams: jest.fn(async () => Array.from(teams.values())),
    getTeam:     jest.fn(async (id) => teams.get(id) || null),
    createTeam:  jest.fn(async (cfg) => {
      const id = `team-${teams.size + 1}`;
      const t = { id, memberAgentIds: [], ...cfg };
      teams.set(id, t);
      return t;
    }),
    updateTeam:  jest.fn(async (id, updates) => {
      const t = teams.get(id);
      if (!t) throw new Error(`Team not found: ${id}`);
      Object.assign(t, updates);
      return t;
    }),
    deleteTeam:  jest.fn(async (id) => { if (!teams.has(id)) throw new Error('not found'); teams.delete(id); return true; }),
    addAgentToTeam: jest.fn(async (teamId, agentId) => {
      const t = teams.get(teamId); if (!t) throw new Error('not found');
      if (!t.memberAgentIds.includes(agentId)) t.memberAgentIds.push(agentId);
      return t;
    }),
    removeAgentFromTeam: jest.fn(async (teamId, agentId) => {
      const t = teams.get(teamId); if (!t) throw new Error('not found');
      const i = t.memberAgentIds.indexOf(agentId);
      if (i >= 0) t.memberAgentIds.splice(i, 1);
      return t;
    }),
    _teams: teams,
  };
}

const ctx = ({ agentId = 'caller', cfg = {} } = {}) => ({
  agentId,
  toolConfig: cfg,
});

// ── Agent CRUD ──────────────────────────────────────────────────────

describe('agent permission gating', () => {
  let tool, agentPool;
  beforeEach(() => {
    tool = new PlatformControlTool({}, LOGGER);
    agentPool = makeAgentPool([
      { id: 'caller' },
      { id: 'mine', createdBy: 'caller' },
      { id: 'other', createdBy: 'someone-else' },
    ]);
    tool.setAgentPool(agentPool);
    tool.setScheduleService(makeScheduleService());
    tool.setStateManager(makeStateManager());
    tool.setMemoryService(makeMemoryService());
  });

  test('disabled mode → list-agents 403-shape', async () => {
    const r = await tool.execute({ action: 'list-agents' }, ctx());
    expect(r).toMatchObject({ success: false, disabled: true });
  });

  test('self-created mode → list-agents OK (read is unrestricted)', async () => {
    const r = await tool.execute({ action: 'list-agents' }, ctx({ cfg: { agents: 'self-created' } }));
    expect(r.success).toBe(true);
    expect(r.agents.length).toBe(3);   // all agents — read is unrestricted
  });

  test('self-created mode + delete-agent on a non-self-created → out of scope', async () => {
    const r = await tool.execute({ action: 'delete-agent', agentId: 'other' }, ctx({ cfg: { agents: 'self-created' } }));
    expect(r.success).toBe(false);
    expect(agentPool.deleteAgent).not.toHaveBeenCalled();
  });

  test('self-created mode + delete-agent on agent I created → success', async () => {
    const r = await tool.execute({ action: 'delete-agent', agentId: 'mine' }, ctx({ cfg: { agents: 'self-created' } }));
    expect(r.success).toBe(true);
    expect(agentPool.deleteAgent).toHaveBeenCalledWith('mine');
  });

  test('all mode + delete-agent on someone else\'s → success', async () => {
    const r = await tool.execute({ action: 'delete-agent', agentId: 'other' }, ctx({ cfg: { agents: 'all' } }));
    expect(r.success).toBe(true);
    expect(agentPool.deleteAgent).toHaveBeenCalledWith('other');
  });
});

describe('hard rules — self + ancestor', () => {
  let tool, agentPool;
  beforeEach(() => {
    tool = new PlatformControlTool({}, LOGGER);
    // Chain: gp → p → caller. caller created child.
    agentPool = makeAgentPool([
      { id: 'gp' },
      { id: 'p',     createdBy: 'gp' },
      { id: 'caller', createdBy: 'p' },
      { id: 'child', createdBy: 'caller' },
    ]);
    tool.setAgentPool(agentPool);
    tool.setStateManager(makeStateManager());
  });

  test('cannot delete self even at "all" level', async () => {
    const r = await tool.execute({ action: 'delete-agent', agentId: 'caller' }, ctx({ cfg: { agents: 'all' } }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/itself/);
    expect(agentPool.deleteAgent).not.toHaveBeenCalled();
  });

  test('cannot update self', async () => {
    const r = await tool.execute({ action: 'update-agent', agentId: 'caller', name: 'new' }, ctx({ cfg: { agents: 'all' } }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/itself/);
  });

  test('cannot delete a parent (direct ancestor) even at "all"', async () => {
    const r = await tool.execute({ action: 'delete-agent', agentId: 'p' }, ctx({ cfg: { agents: 'all' } }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/descendants/);
  });

  test('cannot delete a grandparent (transitive ancestor)', async () => {
    const r = await tool.execute({ action: 'delete-agent', agentId: 'gp' }, ctx({ cfg: { agents: 'all' } }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/descendants/);
  });

  test('CAN delete an agent I created (descendant)', async () => {
    const r = await tool.execute({ action: 'delete-agent', agentId: 'child' }, ctx({ cfg: { agents: 'all' } }));
    expect(r.success).toBe(true);
  });
});

describe('create-agent', () => {
  let tool, agentPool;
  beforeEach(() => {
    tool = new PlatformControlTool({}, LOGGER);
    agentPool = makeAgentPool([{ id: 'caller' }]);
    tool.setAgentPool(agentPool);
    tool.setStateManager(makeStateManager());
  });

  test('tags createdBy with the caller automatically', async () => {
    const r = await tool.execute({
      action: 'create-agent', name: 'New', systemPrompt: 'You are helpful',
    }, ctx({ cfg: { agents: 'all' } }));
    expect(r.success).toBe(true);
    expect(agentPool.createAgent).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: 'caller',
      name: 'New',
    }));
  });

  test('rejects missing name / systemPrompt', async () => {
    const r1 = await tool.execute({ action: 'create-agent', systemPrompt: 'x' }, ctx({ cfg: { agents: 'all' } }));
    expect(r1.success).toBe(false);
    const r2 = await tool.execute({ action: 'create-agent', name: 'x' }, ctx({ cfg: { agents: 'all' } }));
    expect(r2.success).toBe(false);
  });

  test('clamps child toolConfig.platformcontrol that exceeds caller', async () => {
    const r = await tool.execute({
      action: 'create-agent', name: 'Sneaky', systemPrompt: 'x',
      toolConfig: { platformcontrol: { agents: 'all', scheduledTasks: 'all' } },
    }, ctx({ cfg: { agents: 'self-created', scheduledTasks: 'own' } }));
    expect(r.success).toBe(true);
    expect(agentPool.createAgent).toHaveBeenCalledWith(expect.objectContaining({
      toolConfig: expect.objectContaining({
        platformcontrol: { agents: 'self-created', scheduledTasks: 'own' },
      }),
    }));
    // Clamp report surfaced in result so the agent knows what was lowered
    expect(r.clamps.length).toBeGreaterThan(0);
  });

  test('honors maxAgentsCreated quota', async () => {
    // Pre-load agentPool with one agent the caller already created.
    agentPool = makeAgentPool([
      { id: 'caller' },
      { id: 'a1', createdBy: 'caller' },
    ]);
    tool.setAgentPool(agentPool);
    const r = await tool.execute({
      action: 'create-agent', name: 'Two', systemPrompt: 'x',
    }, ctx({ cfg: { agents: 'all', maxAgentsCreated: 1 } }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/quota/);
    expect(agentPool.createAgent).not.toHaveBeenCalled();
  });

  test('null maxAgentsCreated → unlimited', async () => {
    const r = await tool.execute({
      action: 'create-agent', name: 'Free', systemPrompt: 'x',
    }, ctx({ cfg: { agents: 'all', maxAgentsCreated: null } }));
    expect(r.success).toBe(true);
  });
});

// ─── Quota lifecycle ─────────────────────────────────────────────────
// These nail down behaviors that the simple "deny when at quota" test
// doesn't: that delete frees a slot, that 0 blocks even the first
// creation, and that quota is per-creator (so a child's spawning of a
// grandchild doesn't count against the parent).

describe('quota lifecycle', () => {
  test('delete frees a slot — agent at quota=1 can create after deleting their child', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    const agentPool = makeAgentPool([
      { id: 'caller' },
      { id: 'firstborn', createdBy: 'caller' },
    ]);
    tool.setAgentPool(agentPool);
    tool.setStateManager(makeStateManager());
    tool.setMemoryService(makeMemoryService());
    tool.setScheduleService(makeScheduleService());

    // At quota: second create is denied.
    const denied = await tool.execute({
      action: 'create-agent', name: 'Two', systemPrompt: 'x',
    }, ctx({ cfg: { agents: 'all', maxAgentsCreated: 1 } }));
    expect(denied.success).toBe(false);
    expect(denied.error).toMatch(/quota/i);

    // Delete the firstborn — slot frees.
    const deleted = await tool.execute({
      action: 'delete-agent', agentId: 'firstborn',
    }, ctx({ cfg: { agents: 'all', maxAgentsCreated: 1 } }));
    expect(deleted.success).toBe(true);

    // Now the same caller can create one more.
    const allowed = await tool.execute({
      action: 'create-agent', name: 'Replacement', systemPrompt: 'x',
    }, ctx({ cfg: { agents: 'all', maxAgentsCreated: 1 } }));
    expect(allowed.success).toBe(true);
    expect(agentPool.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Replacement', createdBy: 'caller' })
    );
  });

  test('quota=0 blocks the FIRST creation, not just subsequent ones', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    const agentPool = makeAgentPool([{ id: 'caller' }]);
    tool.setAgentPool(agentPool);

    const r = await tool.execute({
      action: 'create-agent', name: 'Forbidden', systemPrompt: 'x',
    }, ctx({ cfg: { agents: 'all', maxAgentsCreated: 0 } }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/quota/i);
    expect(agentPool.createAgent).not.toHaveBeenCalled();
  });

  test('quota counts only THIS caller\'s creations, not transitive grandchildren', async () => {
    // Topology: caller → child → grandchild.
    // Caller's quota is 2 — already at 1 (the child). Should still be
    // able to create one more, because the grandchild's createdBy is
    // 'child', not 'caller'.
    const tool = new PlatformControlTool({}, LOGGER);
    const agentPool = makeAgentPool([
      { id: 'caller' },
      { id: 'child',      createdBy: 'caller' },
      { id: 'grandchild', createdBy: 'child' },     // not counted against caller
    ]);
    tool.setAgentPool(agentPool);

    const r = await tool.execute({
      action: 'create-agent', name: 'AnotherChild', systemPrompt: 'x',
    }, ctx({ cfg: { agents: 'all', maxAgentsCreated: 2 } }));
    expect(r.success).toBe(true);
  });

  test('quota counts only agents created via THIS tool — UI-created agents (createdBy=null) don\'t count', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    const agentPool = makeAgentPool([
      { id: 'caller' },
      { id: 'ui-1', createdBy: null },        // UI-created, not by anyone
      { id: 'ui-2', createdBy: null },
      { id: 'ui-3', createdBy: null },
      // caller has created NONE
    ]);
    tool.setAgentPool(agentPool);

    const r = await tool.execute({
      action: 'create-agent', name: 'First', systemPrompt: 'x',
    }, ctx({ cfg: { agents: 'all', maxAgentsCreated: 1 } }));
    // 3 unrelated agents in pool, but caller hasn't created any → can create.
    expect(r.success).toBe(true);
  });

  test('siblings\' creations do NOT consume my quota', async () => {
    // Scenario: A and B are both created by parent P (siblings).
    // A's quota is 1; A has created none yet. B has created lots,
    // but those don't count against A.
    const tool = new PlatformControlTool({}, LOGGER);
    const agentPool = makeAgentPool([
      { id: 'P' },
      { id: 'A', createdBy: 'P' },
      { id: 'B', createdBy: 'P' },
      { id: 'B-child-1', createdBy: 'B' },
      { id: 'B-child-2', createdBy: 'B' },
      { id: 'B-child-3', createdBy: 'B' },
    ]);
    tool.setAgentPool(agentPool);

    const r = await tool.execute({
      action: 'create-agent', name: 'A-firstborn', systemPrompt: 'x',
    }, ctx({ agentId: 'A', cfg: { agents: 'all', maxAgentsCreated: 1 } }));
    expect(r.success).toBe(true);
  });

  test('quota at exactly the limit denies; one below allows', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    const agentPool = makeAgentPool([
      { id: 'caller' },
      { id: 'a', createdBy: 'caller' },
      { id: 'b', createdBy: 'caller' },
    ]);
    tool.setAgentPool(agentPool);

    const atLimit = await tool.execute({
      action: 'create-agent', name: 'Third', systemPrompt: 'x',
    }, ctx({ cfg: { agents: 'all', maxAgentsCreated: 2 } }));
    expect(atLimit.success).toBe(false);

    // Bumping the quota by 1 lets the same call through.
    const oneMore = await tool.execute({
      action: 'create-agent', name: 'Third', systemPrompt: 'x',
    }, ctx({ cfg: { agents: 'all', maxAgentsCreated: 3 } }));
    expect(oneMore.success).toBe(true);
  });

  test('after maxing out, deleting a non-self-created agent does NOT free a slot', async () => {
    // Defensive: caller hits quota=1 because they made 'mine'.
    // They CAN delete an unrelated agent (in 'all' mode), but that
    // doesn't free their slot — the slot tracks their own creations.
    const tool = new PlatformControlTool({}, LOGGER);
    const agentPool = makeAgentPool([
      { id: 'caller' },
      { id: 'mine',       createdBy: 'caller' },
      { id: 'unrelated',  createdBy: null },
    ]);
    tool.setAgentPool(agentPool);
    tool.setStateManager(makeStateManager());
    tool.setMemoryService(makeMemoryService());
    tool.setScheduleService(makeScheduleService());

    // Delete the unrelated agent.
    const del = await tool.execute({
      action: 'delete-agent', agentId: 'unrelated',
    }, ctx({ cfg: { agents: 'all', maxAgentsCreated: 1 } }));
    expect(del.success).toBe(true);

    // 'mine' still alive → still at quota → second create denied.
    const create = await tool.execute({
      action: 'create-agent', name: 'Sneak', systemPrompt: 'x',
    }, ctx({ cfg: { agents: 'all', maxAgentsCreated: 1 } }));
    expect(create.success).toBe(false);
    expect(create.error).toMatch(/quota/i);
  });
});

describe('update-agent — privilege clamp on toolConfig.platformcontrol', () => {
  test('child target cannot be granted higher schedule level than caller via update', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    const agentPool = makeAgentPool([
      { id: 'caller' },
      { id: 'child', createdBy: 'caller', toolConfig: {} },
    ]);
    tool.setAgentPool(agentPool);
    tool.setStateManager(makeStateManager());

    const r = await tool.execute({
      action: 'update-agent', agentId: 'child',
      toolConfig: { platformcontrol: { scheduledTasks: 'all' } },
    }, ctx({ cfg: { agents: 'all', scheduledTasks: 'own' } }));
    expect(r.success).toBe(true);
    expect(agentPool.updateAgent).toHaveBeenCalledWith('child', expect.objectContaining({
      toolConfig: { platformcontrol: { scheduledTasks: 'own' } },
    }));
    expect(r.clamps[0]).toMatchObject({ key: 'scheduledTasks', clampedTo: 'own' });
  });
});

describe('delete-agent → cascade orchestration', () => {
  test('runs cascade and reports schedules + teams + agent cleanup', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    const agentPool = makeAgentPool([
      { id: 'caller' },
      { id: 'victim', createdBy: 'caller' },
    ]);
    const scheduleService = {
      listSchedules: jest.fn(() => [
        { id: 's1', targetType: 'agent', targetId: 'victim' },
      ]),
      deleteSchedule: jest.fn(async () => undefined),
    };
    const memoryService = makeMemoryService();
    const stateManager = makeStateManager([
      { id: 'team-x', memberAgentIds: ['victim', 'other'] },
    ]);
    tool.setAgentPool(agentPool);
    tool.setScheduleService(scheduleService);
    tool.setMemoryService(memoryService);
    tool.setStateManager(stateManager);

    const r = await tool.execute({ action: 'delete-agent', agentId: 'victim' }, ctx({ cfg: { agents: 'all' } }));
    expect(r.success).toBe(true);
    expect(r.report).toMatchObject({
      schedulesDeleted: 1,
      memoriesCleaned: true,
      teamsLeft: ['team-x'],
      agentDeleted: true,
    });
    expect(scheduleService.deleteSchedule).toHaveBeenCalledWith('s1');
    expect(memoryService.deleteMemoryFile).toHaveBeenCalledWith('victim');
    expect(stateManager.removeAgentFromTeam).toHaveBeenCalledWith('team-x', 'victim');
    expect(agentPool.deleteAgent).toHaveBeenCalledWith('victim');
  });
});

// ── Team CRUD + membership ──────────────────────────────────────────

describe('teams permission gating', () => {
  test('all-flags-false → disabled', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    tool.setStateManager(makeStateManager());
    const r = await tool.execute({ action: 'list-teams' }, ctx({ cfg: { teams: { member: false, ownedByMe: false, all: false } } }));
    expect(r.success).toBe(false);
    expect(r.disabled).toBe(true);
  });

  test('member scope → list returns only teams where caller is in members', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    tool.setStateManager(makeStateManager([
      { id: 'mine',  memberAgentIds: ['caller'], createdBy: 'someone' },
      { id: 'other', memberAgentIds: ['x'],      createdBy: 'someone' },
    ]));
    const r = await tool.execute({ action: 'list-teams' }, ctx({ cfg: { teams: { member: true } } }));
    expect(r.success).toBe(true);
    expect(r.teams.map(t => t.id)).toEqual(['mine']);
  });

  test('ownedByMe scope → list returns only teams I created', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    tool.setStateManager(makeStateManager([
      { id: 'mine',  memberAgentIds: [], createdBy: 'caller' },
      { id: 'other', memberAgentIds: [], createdBy: 'someone' },
    ]));
    const r = await tool.execute({ action: 'list-teams' }, ctx({ cfg: { teams: { ownedByMe: true } } }));
    expect(r.teams.map(t => t.id)).toEqual(['mine']);
  });

  test('member+ownedByMe → union', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    tool.setStateManager(makeStateManager([
      { id: 'a', memberAgentIds: ['caller'], createdBy: 'someone' },     // member
      { id: 'b', memberAgentIds: ['x'],      createdBy: 'caller' },      // owner
      { id: 'c', memberAgentIds: ['x'],      createdBy: 'someone' },     // neither
    ]));
    const r = await tool.execute({ action: 'list-teams' }, ctx({ cfg: { teams: { member: true, ownedByMe: true } } }));
    expect(r.teams.map(t => t.id).sort()).toEqual(['a', 'b']);
  });

  test('all scope → all teams', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    tool.setStateManager(makeStateManager([
      { id: 'a', memberAgentIds: [], createdBy: 'someone' },
      { id: 'b', memberAgentIds: [], createdBy: 'someone' },
    ]));
    const r = await tool.execute({ action: 'list-teams' }, ctx({ cfg: { teams: { all: true } } }));
    expect(r.teams.length).toBe(2);
  });
});

describe('team mutations', () => {
  let tool, stateManager;
  beforeEach(() => {
    tool = new PlatformControlTool({}, LOGGER);
    stateManager = makeStateManager([
      { id: 'mine', memberAgentIds: ['caller'], createdBy: 'caller' },
      { id: 'other', memberAgentIds: [],          createdBy: 'someone' },
    ]);
    tool.setStateManager(stateManager);
  });

  test('create-team tags createdBy = caller', async () => {
    const r = await tool.execute({ action: 'create-team', name: 'New' }, ctx({ cfg: { teams: { all: true } } }));
    expect(r.success).toBe(true);
    expect(stateManager.createTeam).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New', createdBy: 'caller',
    }));
  });

  test('update-team allowed in scope, hidden as 404 out of scope', async () => {
    const inScope = await tool.execute({ action: 'update-team', teamId: 'mine', name: 'Renamed' },
      ctx({ cfg: { teams: { ownedByMe: true } } }));
    expect(inScope.success).toBe(true);

    const outOfScope = await tool.execute({ action: 'update-team', teamId: 'other', name: 'X' },
      ctx({ cfg: { teams: { ownedByMe: true } } }));
    expect(outOfScope.success).toBe(false);
    expect(outOfScope.error).toMatch(/not found/);
  });

  test('delete-team in scope → cascade calls deleteTeam', async () => {
    const r = await tool.execute({ action: 'delete-team', teamId: 'mine' },
      ctx({ cfg: { teams: { ownedByMe: true } } }));
    expect(r.success).toBe(true);
    expect(stateManager.deleteTeam).toHaveBeenCalledWith('mine');
  });

  test('add-team-member with agentId="self" adds caller', async () => {
    const r = await tool.execute({
      action: 'add-team-member', teamId: 'other', agentId: 'self',
    }, ctx({ cfg: { teams: { all: true } } }));
    expect(r.success).toBe(true);
    expect(stateManager.addAgentToTeam).toHaveBeenCalledWith('other', 'caller');
  });

  test('remove-team-member with agentId="self" leaves the team (allowed)', async () => {
    // Caller is member of 'mine'. They can leave it via 'member' scope.
    const r = await tool.execute({
      action: 'remove-team-member', teamId: 'mine', agentId: 'self',
    }, ctx({ cfg: { teams: { member: true } } }));
    expect(r.success).toBe(true);
    expect(stateManager.removeAgentFromTeam).toHaveBeenCalledWith('mine', 'caller');
  });
});

// ── list-capabilities reflects all three feature slices ─────────────

describe('list-capabilities', () => {
  test('reports schedule + agents + teams scopes', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    tool.setAgentPool(makeAgentPool());
    tool.setStateManager(makeStateManager());
    tool.setScheduleService(makeScheduleService());
    const r = await tool.execute({ action: 'list-capabilities' }, ctx({
      cfg: {
        scheduledTasks: 'own',
        agents: 'self-created',
        maxAgentsCreated: 5,
        teams: { member: true, ownedByMe: true, all: false },
      },
    }));
    expect(r.success).toBe(true);
    expect(r.capabilities.scheduledTasks.level).toBe('own');
    expect(r.capabilities.agents.level).toBe('self-created');
    expect(r.capabilities.agents.maxAgentsCreated).toBe(5);
    expect(r.capabilities.teams.scope).toEqual({ member: true, ownedByMe: true, all: false });
    expect(r.capabilities.teams.disabled).toBe(false);
  });

  test('disabled across the board → all features show disabled', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    const r = await tool.execute({ action: 'list-capabilities' }, ctx({}));
    expect(r.capabilities.scheduledTasks.level).toBe('disabled');
    expect(r.capabilities.agents.level).toBe('disabled');
    expect(r.capabilities.teams.disabled).toBe(true);
  });
});
