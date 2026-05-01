/**
 * Permission tests for the AGENTS and TEAMS slices of platformcontrol.
 * Covers:
 *   - getAgentAccessLevel / getMaxAgentsCreated / getTeamScope
 *   - checkAgentMutationAccess (every level × every hard rule)
 *   - filterMutableAgents
 *   - clampToolConfigForChild — privilege escalation prevention
 *   - checkTeamAccess + filterAccessibleTeams
 */
import { describe, test, expect } from '@jest/globals';
import {
  AGENT_ACCESS_LEVELS,
  getAgentAccessLevel,
  getMaxAgentsCreated,
  checkAgentMutationAccess,
  filterMutableAgents,
  clampToolConfigForChild,
  getTeamScope,
  isTeamAccessDisabled,
  checkTeamAccess,
  filterAccessibleTeams,
} from '../platformControl/permissions.js';

const { DISABLED, SELF_CREATED, ALL } = AGENT_ACCESS_LEVELS;

describe('getAgentAccessLevel', () => {
  test('default + unknown values → "disabled"', () => {
    expect(getAgentAccessLevel(undefined)).toBe('disabled');
    expect(getAgentAccessLevel({})).toBe('disabled');
    expect(getAgentAccessLevel({ agents: 'gibberish' })).toBe('disabled');
  });
  test('valid values pass through', () => {
    expect(getAgentAccessLevel({ agents: 'self-created' })).toBe('self-created');
    expect(getAgentAccessLevel({ agents: 'all' })).toBe('all');
  });
});

describe('getMaxAgentsCreated', () => {
  test('null/undefined/missing → null (unlimited)', () => {
    expect(getMaxAgentsCreated(undefined)).toBe(null);
    expect(getMaxAgentsCreated({})).toBe(null);
    expect(getMaxAgentsCreated({ maxAgentsCreated: null })).toBe(null);
  });
  test('positive integer passes through', () => {
    expect(getMaxAgentsCreated({ maxAgentsCreated: 5 })).toBe(5);
    expect(getMaxAgentsCreated({ maxAgentsCreated: 0 })).toBe(0);   // hard zero is allowed
  });
  test('garbage / negative / Infinity → null (treated as unlimited; UI should validate)', () => {
    expect(getMaxAgentsCreated({ maxAgentsCreated: -1 })).toBe(null);
    expect(getMaxAgentsCreated({ maxAgentsCreated: Infinity })).toBe(null);
    expect(getMaxAgentsCreated({ maxAgentsCreated: 'lots' })).toBe(null);
  });
  test('floors fractional', () => {
    expect(getMaxAgentsCreated({ maxAgentsCreated: 3.7 })).toBe(3);
  });
});

describe('checkAgentMutationAccess', () => {
  const target = (over) => ({ id: 't', createdBy: null, ...over });

  test('disabled → never', () => {
    const r = checkAgentMutationAccess(DISABLED, 'caller', target());
    expect(r.allow).toBe(false);
  });

  test('hard rule: self → denied at every level', () => {
    for (const level of [SELF_CREATED, ALL]) {
      const r = checkAgentMutationAccess(level, 'caller', target({ id: 'caller' }));
      expect(r.allow).toBe(false);
      expect(r.reason).toMatch(/itself/);
    }
  });

  test('hard rule: ancestor → denied at every level (when isProtectedFromCaller says so)', () => {
    const isProtectedFromCaller = (callerId, targetId) =>
      callerId === 'child' && targetId === 'parent';
    const r = checkAgentMutationAccess(
      ALL, 'child', target({ id: 'parent' }),
      { isProtectedFromCaller }
    );
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/descendants/);
  });

  test('self-created mode: passes only when target.createdBy === caller', () => {
    expect(
      checkAgentMutationAccess(SELF_CREATED, 'caller', target({ createdBy: 'caller' })).allow
    ).toBe(true);
    expect(
      checkAgentMutationAccess(SELF_CREATED, 'caller', target({ createdBy: 'someone-else' })).allow
    ).toBe(false);
    expect(
      checkAgentMutationAccess(SELF_CREATED, 'caller', target({ createdBy: null })).allow
    ).toBe(false);     // unowned (UI-created) agents are unreachable in self-created mode
  });

  test('all mode: any non-self, non-ancestor target', () => {
    expect(checkAgentMutationAccess(ALL, 'caller', target({ id: 'x' })).allow).toBe(true);
    expect(checkAgentMutationAccess(ALL, 'caller', target({ id: 'y', createdBy: 'someone' })).allow).toBe(true);
  });
});

describe('filterMutableAgents', () => {
  test('keeps only agents the caller may mutate', () => {
    const caller = 'me';
    const agents = [
      { id: 'me' },                                 // self → out (hard)
      { id: 'ancestor' },                           // ancestor → out (hard, via isProtectedFromCaller)
      { id: 'mine', createdBy: 'me' },              // self-created → in
      { id: 'theirs', createdBy: 'someone-else' },  // someone else's → out at self-created
    ];
    const isProtectedFromCaller = (c, t) =>
      c === caller && t === 'ancestor' || c === t;
    const out = filterMutableAgents(SELF_CREATED, caller, agents, { isProtectedFromCaller });
    expect(out.map(a => a.id)).toEqual(['mine']);
  });
});

describe('clampToolConfigForChild — privilege escalation prevention', () => {
  test('child cannot get a higher scheduledTasks level than caller', () => {
    const caller = { scheduledTasks: 'own' };
    const desired = { scheduledTasks: 'all' };
    const { config, clamps } = clampToolConfigForChild(caller, desired);
    expect(config.scheduledTasks).toBe('own');
    expect(clamps).toContainEqual(
      expect.objectContaining({ key: 'scheduledTasks', requested: 'all', clampedTo: 'own' })
    );
  });

  test('child cannot get a higher agents level than caller', () => {
    const caller = { agents: 'self-created' };
    const desired = { agents: 'all' };
    const { config, clamps } = clampToolConfigForChild(caller, desired);
    expect(config.agents).toBe('self-created');
    expect(clamps[0]).toMatchObject({ key: 'agents', clampedTo: 'self-created' });
  });

  test('child can request a LOWER level — no clamp', () => {
    const caller = { scheduledTasks: 'all', agents: 'all' };
    const desired = { scheduledTasks: 'own', agents: 'self-created' };
    const { config, clamps } = clampToolConfigForChild(caller, desired);
    expect(config.scheduledTasks).toBe('own');
    expect(config.agents).toBe('self-created');
    expect(clamps).toEqual([]);
  });

  test('maxAgentsCreated: child unlimited blocked when caller has a quota', () => {
    const caller = { maxAgentsCreated: 5 };
    const desired = { maxAgentsCreated: null };           // unlimited
    const { config, clamps } = clampToolConfigForChild(caller, desired);
    expect(config.maxAgentsCreated).toBe(5);
    expect(clamps[0]).toMatchObject({ key: 'maxAgentsCreated', clampedTo: 5 });
  });

  test('maxAgentsCreated: child quota over caller quota → clamped down', () => {
    const caller = { maxAgentsCreated: 5 };
    const desired = { maxAgentsCreated: 100 };
    const { config } = clampToolConfigForChild(caller, desired);
    expect(config.maxAgentsCreated).toBe(5);
  });

  test('maxAgentsCreated: caller unlimited → child can be anything', () => {
    const caller = {};   // unlimited
    const desired = { maxAgentsCreated: 1000 };
    const { config, clamps } = clampToolConfigForChild(caller, desired);
    expect(config.maxAgentsCreated).toBe(1000);
    expect(clamps).toEqual([]);
  });

  test('teams: child cannot have flags caller lacks', () => {
    const caller  = { teams: { member: true, ownedByMe: false, all: false } };
    const desired = { teams: { member: true, ownedByMe: true,  all: true } };
    const { config, clamps } = clampToolConfigForChild(caller, desired);
    expect(config.teams).toEqual({ member: true, ownedByMe: false, all: false });
    expect(clamps[0]).toMatchObject({ key: 'teams' });
  });

  test('fields not in desired are NOT added to the output (clamp only inspects what caller is setting)', () => {
    // Caller can grant agents:'self-created' (caller is at 'all').
    // Desired only mentions agents — scheduledTasks isn't in the picture.
    // Output should mirror desired's keys exactly: no scheduledTasks added.
    const caller = { scheduledTasks: 'own', agents: 'all' };
    const desired = { agents: 'self-created' };
    const { config, clamps } = clampToolConfigForChild(caller, desired);
    expect(config).toEqual({ agents: 'self-created' });
    expect(config.scheduledTasks).toBeUndefined();
    expect(clamps).toEqual([]);
  });

  test('caller missing a key entirely → that key is treated as the floor (disabled)', () => {
    // Caller has no `agents` key configured. Default = 'disabled'. So if
    // the caller tries to grant any agents level, clamp lowers to disabled.
    const caller = { scheduledTasks: 'own' };           // no agents key
    const desired = { agents: 'self-created' };
    const { config, clamps } = clampToolConfigForChild(caller, desired);
    expect(config.agents).toBe('disabled');
    expect(clamps[0]).toMatchObject({ key: 'agents', clampedTo: 'disabled' });
  });
});

describe('Team scope (multi-select)', () => {
  test('default scope = all-false', () => {
    expect(getTeamScope(undefined)).toEqual({ member: false, ownedByMe: false, all: false });
  });

  test('isTeamAccessDisabled: empty scope → true', () => {
    expect(isTeamAccessDisabled({ teams: { member: false, ownedByMe: false, all: false } })).toBe(true);
    expect(isTeamAccessDisabled({})).toBe(true);
  });
  test('isTeamAccessDisabled: any flag set → false', () => {
    expect(isTeamAccessDisabled({ teams: { member: true } })).toBe(false);
  });

  test('checkTeamAccess: "all" beats everything', () => {
    const team = { id: 't', memberAgentIds: [], createdBy: 'someone' };
    expect(checkTeamAccess({ all: true }, 'me', team).allow).toBe(true);
  });
  test('checkTeamAccess: member flag matches when caller is in members', () => {
    const team = { id: 't', memberAgentIds: ['me', 'other'], createdBy: 'someone' };
    expect(checkTeamAccess({ member: true }, 'me', team).allow).toBe(true);
  });
  test('checkTeamAccess: ownedByMe matches createdBy', () => {
    const team = { id: 't', memberAgentIds: [], createdBy: 'me' };
    expect(checkTeamAccess({ ownedByMe: true }, 'me', team).allow).toBe(true);
  });
  test('checkTeamAccess: no flag matches → denied', () => {
    const team = { id: 't', memberAgentIds: [], createdBy: 'someone' };
    const r = checkTeamAccess({ member: true, ownedByMe: true }, 'me', team);
    expect(r.allow).toBe(false);
  });

  test('filterAccessibleTeams: empty scope → empty list', () => {
    const teams = [{ id: 't', memberAgentIds: ['me'] }];
    expect(filterAccessibleTeams({ all: false, member: false, ownedByMe: false }, 'me', teams)).toEqual([]);
  });
  test('filterAccessibleTeams: member-only keeps only teams with caller in members', () => {
    const teams = [
      { id: 'mine', memberAgentIds: ['me'], createdBy: 'someone' },
      { id: 'theirs', memberAgentIds: ['other'], createdBy: 'someone' },
    ];
    const out = filterAccessibleTeams({ member: true }, 'me', teams);
    expect(out.map(t => t.id)).toEqual(['mine']);
  });
  test('filterAccessibleTeams: union of member + ownedByMe', () => {
    const teams = [
      { id: 'a', memberAgentIds: ['me'], createdBy: 'x' },             // member
      { id: 'b', memberAgentIds: ['other'], createdBy: 'me' },         // owned
      { id: 'c', memberAgentIds: ['other'], createdBy: 'x' },          // neither
    ];
    const out = filterAccessibleTeams({ member: true, ownedByMe: true }, 'me', teams);
    expect(out.map(t => t.id).sort()).toEqual(['a', 'b']);
  });
});

// ─── FLOW permissions (parallel to AGENT permissions above) ────────────
import {
  FLOW_ACCESS_LEVELS,
  getFlowAccessLevel,
  getMaxFlowsCreated,
  checkFlowMutationAccess,
  filterMutableFlows,
} from '../platformControl/permissions.js';

const FL = FLOW_ACCESS_LEVELS;

describe('getFlowAccessLevel', () => {
  test('default + unknown values collapse to "disabled" (no silent grant)', () => {
    expect(getFlowAccessLevel(undefined)).toBe('disabled');
    expect(getFlowAccessLevel(null)).toBe('disabled');
    expect(getFlowAccessLevel({})).toBe('disabled');
    expect(getFlowAccessLevel({ flows: 'gibberish' })).toBe('disabled');
    expect(getFlowAccessLevel({ flows: 'admin' })).toBe('disabled');     // close-but-wrong
    expect(getFlowAccessLevel({ flows: 'own' })).toBe('disabled');        // schedules-key, not flows
  });

  test('valid values pass through', () => {
    expect(getFlowAccessLevel({ flows: 'disabled' })).toBe('disabled');
    expect(getFlowAccessLevel({ flows: 'self-created' })).toBe('self-created');
    expect(getFlowAccessLevel({ flows: 'all' })).toBe('all');
  });

  test('exposed constants match expected level strings', () => {
    expect(FL.DISABLED).toBe('disabled');
    expect(FL.SELF_CREATED).toBe('self-created');
    expect(FL.ALL).toBe('all');
  });
});

describe('getMaxFlowsCreated', () => {
  test('null/undefined/missing → null (unlimited)', () => {
    expect(getMaxFlowsCreated(undefined)).toBe(null);
    expect(getMaxFlowsCreated({})).toBe(null);
    expect(getMaxFlowsCreated({ maxFlowsCreated: null })).toBe(null);
    expect(getMaxFlowsCreated({ maxFlowsCreated: undefined })).toBe(null);
  });

  test('positive integers pass through', () => {
    expect(getMaxFlowsCreated({ maxFlowsCreated: 0 })).toBe(0);
    expect(getMaxFlowsCreated({ maxFlowsCreated: 1 })).toBe(1);
    expect(getMaxFlowsCreated({ maxFlowsCreated: 100 })).toBe(100);
  });

  test('negative / NaN / non-numeric collapse to null (unlimited, lenient)', () => {
    expect(getMaxFlowsCreated({ maxFlowsCreated: -5 })).toBe(null);
    expect(getMaxFlowsCreated({ maxFlowsCreated: NaN })).toBe(null);
    expect(getMaxFlowsCreated({ maxFlowsCreated: Infinity })).toBe(null);
    expect(getMaxFlowsCreated({ maxFlowsCreated: 'two' })).toBe(null);
    expect(getMaxFlowsCreated({ maxFlowsCreated: {} })).toBe(null);
  });

  test('floats are floored', () => {
    expect(getMaxFlowsCreated({ maxFlowsCreated: 3.7 })).toBe(3);
    expect(getMaxFlowsCreated({ maxFlowsCreated: 0.5 })).toBe(0);
  });
});

describe('checkFlowMutationAccess', () => {
  const myFlow    = { id: 'f-mine',  createdBy: 'me' };
  const otherFlow = { id: 'f-other', createdBy: 'someone' };

  test('disabled level → never allow', () => {
    expect(checkFlowMutationAccess(FL.DISABLED, 'me', myFlow).allow).toBe(false);
    expect(checkFlowMutationAccess(FL.DISABLED, 'me', otherFlow).allow).toBe(false);
  });

  test('all level → always allow (any flow)', () => {
    expect(checkFlowMutationAccess(FL.ALL, 'me', myFlow).allow).toBe(true);
    expect(checkFlowMutationAccess(FL.ALL, 'me', otherFlow).allow).toBe(true);
  });

  test('self-created → only flows authored by caller', () => {
    expect(checkFlowMutationAccess(FL.SELF_CREATED, 'me', myFlow).allow).toBe(true);
    const denied = checkFlowMutationAccess(FL.SELF_CREATED, 'me', otherFlow);
    expect(denied.allow).toBe(false);
    expect(denied.reason).toMatch(/self-created/i);
  });

  test('returns reason on denial (so the tool can echo a useful error)', () => {
    const r = checkFlowMutationAccess(FL.DISABLED, 'me', myFlow);
    expect(r.allow).toBe(false);
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThan(0);
  });

  test('rejects missing target flow defensively', () => {
    expect(checkFlowMutationAccess(FL.ALL, 'me', null).allow).toBe(false);
    expect(checkFlowMutationAccess(FL.ALL, 'me', {}).allow).toBe(false);
    expect(checkFlowMutationAccess(FL.ALL, 'me', { id: '' }).allow).toBe(false);
  });

  test('rejects unknown level (no silent grant)', () => {
    const r = checkFlowMutationAccess('admin-everywhere', 'me', myFlow);
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/unknown.*level/i);
  });
});

describe('filterMutableFlows', () => {
  const flows = [
    { id: 'a', createdBy: 'me' },
    { id: 'b', createdBy: 'someone' },
    { id: 'c', createdBy: 'me' },
  ];

  test('disabled → empty list', () => {
    expect(filterMutableFlows(FL.DISABLED, 'me', flows)).toEqual([]);
  });

  test('all → keeps every flow', () => {
    expect(filterMutableFlows(FL.ALL, 'me', flows)).toHaveLength(3);
  });

  test('self-created → only flows authored by caller', () => {
    const r = filterMutableFlows(FL.SELF_CREATED, 'me', flows);
    expect(r.map(f => f.id).sort()).toEqual(['a', 'c']);
  });

  test('non-array input returns empty list', () => {
    expect(filterMutableFlows(FL.ALL, 'me', null)).toEqual([]);
    expect(filterMutableFlows(FL.ALL, 'me', undefined)).toEqual([]);
    expect(filterMutableFlows(FL.ALL, 'me', 'not-an-array')).toEqual([]);
  });
});

describe('clampToolConfigForChild — flows + maxFlowsCreated (privilege escalation guard)', () => {
  test('clamps flow level: child cannot exceed parent (self-created → all attempt)', () => {
    const result = clampToolConfigForChild(
      { flows: 'self-created' },           // caller has only self-created
      { flows: 'all' }                      // tries to spawn child with 'all'
    );
    expect(result.config.flows).toBe('self-created');
    expect(result.clamps).toEqual(expect.arrayContaining([
      { key: 'flows', requested: 'all', clampedTo: 'self-created' },
    ]));
  });

  test('clamps flow level: disabled caller cannot grant any', () => {
    const result = clampToolConfigForChild(
      {},                                   // caller defaults to disabled
      { flows: 'self-created' }
    );
    expect(result.config.flows).toBe('disabled');
  });

  test('does NOT clamp when child requests less than parent has', () => {
    const result = clampToolConfigForChild(
      { flows: 'all' },
      { flows: 'self-created' }
    );
    expect(result.config.flows).toBe('self-created');
    // no clamp record — request was already at-or-below parent.
    expect(result.clamps.find(c => c.key === 'flows')).toBeUndefined();
  });

  test('clamps maxFlowsCreated: child cannot exceed parent quota', () => {
    const result = clampToolConfigForChild(
      { flows: 'all', maxFlowsCreated: 5 },
      { flows: 'all', maxFlowsCreated: 100 }
    );
    expect(result.config.maxFlowsCreated).toBe(5);
    expect(result.clamps).toEqual(expect.arrayContaining([
      { key: 'maxFlowsCreated', requested: 100, clampedTo: 5 },
    ]));
  });

  test('clamps maxFlowsCreated: child requests "unlimited" but parent has limit', () => {
    const result = clampToolConfigForChild(
      { flows: 'all', maxFlowsCreated: 3 },
      { flows: 'all', maxFlowsCreated: null }   // null = unlimited
    );
    expect(result.config.maxFlowsCreated).toBe(3);
  });

  test('caller-unlimited (null max) lets any child max through', () => {
    const result = clampToolConfigForChild(
      { flows: 'all' },                      // no max → unlimited
      { flows: 'all', maxFlowsCreated: 1000 }
    );
    expect(result.config.maxFlowsCreated).toBe(1000);
    expect(result.clamps.find(c => c.key === 'maxFlowsCreated')).toBeUndefined();
  });

  test('flow clamps surface alongside agent clamps (multi-key escalation attempt)', () => {
    const result = clampToolConfigForChild(
      { agents: 'self-created', flows: 'self-created' },
      { agents: 'all', flows: 'all' }
    );
    const keys = result.clamps.map(c => c.key).sort();
    expect(keys).toEqual(['agents', 'flows']);
    expect(result.config.agents).toBe('self-created');
    expect(result.config.flows).toBe('self-created');
  });
});
