/**
 * Permission helpers for platformControlTool.
 *
 * Each feature has its own permission key on the agent's per-tool config.
 * Today we have one feature: scheduled tasks. Helpers here:
 *
 *   - `getScheduleAccessLevel(toolConfig)` → 'disabled' | 'own' | 'all'
 *   - `checkScheduleAccess(level, callerAgentId, schedule)` → { allow, reason }
 *   - `isOwnTargetAgentSchedule(schedule, agentId)` → bool
 *
 * Pure functions: no I/O, no state. Testable in isolation; the tool just
 * dispatches based on the boolean answers.
 *
 * Invariants enforced here (the actual security boundary):
 *   - Flow-target schedules are NEVER reachable via this tool, regardless
 *     of permission level. Agents do not control flows.
 *   - In 'own' mode, only schedules whose targetType === 'agent' AND
 *     targetId === callerAgentId are reachable.
 *   - 'disabled' is hard-stop for every read AND mutation.
 */

export const SCHEDULE_ACCESS_LEVELS = Object.freeze({
  DISABLED: 'disabled',
  OWN:      'own',
  ALL:      'all',
});

const VALID_LEVELS = new Set(Object.values(SCHEDULE_ACCESS_LEVELS));

/**
 * Resolve the per-agent scheduledTasks permission level.
 *
 * Default 'disabled' — opt-in is explicit. Anything unrecognized
 * collapses to 'disabled' rather than silently granting access.
 *
 * @param {object} toolConfig  agent.toolConfig.platformcontrol (or similar)
 * @returns {'disabled'|'own'|'all'}
 */
export function getScheduleAccessLevel(toolConfig) {
  const level = toolConfig && typeof toolConfig === 'object'
    ? toolConfig.scheduledTasks
    : undefined;
  if (!VALID_LEVELS.has(level)) return SCHEDULE_ACCESS_LEVELS.DISABLED;
  return level;
}

/**
 * True if the schedule targets THIS agent specifically (not a flow,
 * not another agent). The tool relies on this for 'own' mode visibility.
 */
export function isOwnTargetAgentSchedule(schedule, agentId) {
  if (!schedule || typeof schedule !== 'object') return false;
  if (!agentId) return false;
  return schedule.targetType === 'agent' && schedule.targetId === agentId;
}

/**
 * Decide whether this caller may operate on this schedule.
 *
 * Returns:
 *   { allow: true }                 — proceed
 *   { allow: false, reason: '…' }   — denied; reason explains why for the
 *                                     agent's tool-result and our logs
 *
 * The denial reason strings are stable (used in tests and surfaced to
 * agents) — keep wording in sync if you edit them.
 */
export function checkScheduleAccess(level, callerAgentId, schedule) {
  if (level === SCHEDULE_ACCESS_LEVELS.DISABLED) {
    return {
      allow: false,
      reason: 'Scheduled-tasks access is disabled for this agent. Enable it in the platformcontrol tool configurator.',
    };
  }

  // Flow-target schedules are out of scope for this tool, full stop.
  // No level — even 'all' — grants control over flow schedules. Agents
  // are not (currently) entitled to manage flow execution from this surface.
  if (schedule && schedule.targetType === 'flow') {
    return {
      allow: false,
      reason: 'Flow-target schedules are not controllable via this tool. Only agent-target schedules are accessible.',
    };
  }

  if (level === SCHEDULE_ACCESS_LEVELS.ALL) {
    return { allow: true };
  }

  // 'own' mode: only this agent's own agent-target schedules.
  if (level === SCHEDULE_ACCESS_LEVELS.OWN) {
    if (!schedule) {
      // Caller didn't supply a schedule — handler is asking "may I access at all?"
      // In 'own' mode the answer is yes; the per-row filter happens later.
      return { allow: true };
    }
    if (isOwnTargetAgentSchedule(schedule, callerAgentId)) return { allow: true };
    return {
      allow: false,
      reason: 'Out of scope: in "own" mode you can only access schedules that target this agent. ' +
              'Set the platformcontrol tool to "all" for cross-agent access (admin-level permission).',
    };
  }

  // Defensive — should never reach here because getScheduleAccessLevel collapses unknowns.
  return {
    allow: false,
    reason: `Unknown permission level: ${level}`,
  };
}

/**
 * Filter a list of schedules to those reachable by `callerAgentId` at
 * `level`. Flow-target schedules are always excluded.
 */
export function filterAccessibleSchedules(level, callerAgentId, schedules) {
  if (level === SCHEDULE_ACCESS_LEVELS.DISABLED) return [];
  if (!Array.isArray(schedules)) return [];
  // Flow-target schedules are NEVER returned, regardless of level.
  const noFlows = schedules.filter(s => s && s.targetType !== 'flow');
  if (level === SCHEDULE_ACCESS_LEVELS.ALL) return noFlows;
  if (level === SCHEDULE_ACCESS_LEVELS.OWN) {
    return noFlows.filter(s => isOwnTargetAgentSchedule(s, callerAgentId));
  }
  return [];
}

// ─── Agent CRUD permissions ──────────────────────────────────────────

export const AGENT_ACCESS_LEVELS = Object.freeze({
  DISABLED:     'disabled',
  SELF_CREATED: 'self-created',
  ALL:          'all',
});

const VALID_AGENT_LEVELS = new Set(Object.values(AGENT_ACCESS_LEVELS));

/**
 * Resolve the per-agent `agents` permission level. Default `'disabled'`;
 * unknown values collapse to `'disabled'` (no silent grant).
 */
export function getAgentAccessLevel(toolConfig) {
  const v = toolConfig && typeof toolConfig === 'object' ? toolConfig.agents : undefined;
  if (!VALID_AGENT_LEVELS.has(v)) return AGENT_ACCESS_LEVELS.DISABLED;
  return v;
}

/**
 * Per-creator quota. `null` (the default) means unlimited. Negative or
 * non-finite values fall back to unlimited too — easier than throwing
 * at config-load and forcing the user to fix bad input before anything
 * works. The actual cap is enforced in the create-agent path.
 */
export function getMaxAgentsCreated(toolConfig) {
  const v = toolConfig && typeof toolConfig === 'object' ? toolConfig.maxAgentsCreated : undefined;
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return Math.floor(v);
}

/**
 * Decide whether `callerAgentId` may MUTATE `targetAgent` at this
 * permission level. Mutation = create/update/delete/configure.
 *
 * Permission-level rules:
 *   disabled      → never
 *   self-created  → only if targetAgent.createdBy === callerAgentId
 *                   (siblings/unrelated agents are out of scope)
 *   all           → any agent
 *
 * Hard rules layered ON TOP of permission level (always enforced):
 *   - never self
 *   - never an ancestor of caller
 *
 * The hard-rule check needs an `isProtectedFromCaller` predicate (lives
 * in ancestry.js) — passed in to keep this module pure / regex-free /
 * I/O-free. The TOOL is responsible for wiring it up.
 *
 * @returns {{ allow: true } | { allow: false, reason: string }}
 */
export function checkAgentMutationAccess(level, callerAgentId, targetAgent, opts = {}) {
  if (level === AGENT_ACCESS_LEVELS.DISABLED) {
    return { allow: false, reason: 'Agent management is disabled for this caller.' };
  }
  if (!targetAgent || !targetAgent.id) {
    return { allow: false, reason: 'Missing target agent.' };
  }
  // Hard rules first — these win over permission level.
  if (callerAgentId && targetAgent.id === callerAgentId) {
    return { allow: false, reason: 'No-self-modify: an agent cannot modify itself via this tool.' };
  }
  const isProtected = typeof opts.isProtectedFromCaller === 'function'
    ? opts.isProtectedFromCaller
    : null;
  if (isProtected && isProtected(callerAgentId, targetAgent.id)) {
    return {
      allow: false,
      reason: 'Out of scope: descendants cannot modify their ancestors at any level of the chain.',
    };
  }

  if (level === AGENT_ACCESS_LEVELS.ALL) return { allow: true };

  if (level === AGENT_ACCESS_LEVELS.SELF_CREATED) {
    if (targetAgent.createdBy === callerAgentId) return { allow: true };
    return {
      allow: false,
      reason: 'Out of scope: in "self-created" mode you can only modify agents you have created.',
    };
  }

  return { allow: false, reason: `Unknown permission level: ${level}` };
}

/**
 * Filter a list of agents to those reachable for MUTATION by `callerAgentId`
 * at `level`. Read operations should NOT use this filter — the tool
 * exposes lists unrestricted; only mutations are scoped.
 */
export function filterMutableAgents(level, callerAgentId, agents, opts = {}) {
  if (!Array.isArray(agents)) return [];
  return agents.filter(a => checkAgentMutationAccess(level, callerAgentId, a, opts).allow);
}

// ─── Flow CRUD permissions ───────────────────────────────────────────
//
// Flows are user-authored multi-agent pipelines (typed I/O, retry,
// versioned, runnable on schedule). Permission model mirrors agents:
// `disabled` (default), `self-created` (only your own flows), or
// `all` (admin scope). Hard rules layered on top:
//   - flows referencing the caller as a node are still creatable; we
//     don't try to detect "self-trapping" flows here. The executor
//     handles wedged-lock cases via the agent processing lock.
//   - delete cascades the run history + checkpoints + versions (the
//     cascade itself lives in cascadeService.js, not this file).

export const FLOW_ACCESS_LEVELS = Object.freeze({
  DISABLED:     'disabled',
  SELF_CREATED: 'self-created',
  ALL:          'all',
});

const VALID_FLOW_LEVELS = new Set(Object.values(FLOW_ACCESS_LEVELS));

/**
 * Resolve the per-agent `flows` permission level. Default `'disabled'`;
 * unknown values collapse to `'disabled'` (no silent grant).
 */
export function getFlowAccessLevel(toolConfig) {
  const v = toolConfig && typeof toolConfig === 'object' ? toolConfig.flows : undefined;
  if (!VALID_FLOW_LEVELS.has(v)) return FLOW_ACCESS_LEVELS.DISABLED;
  return v;
}

/**
 * Per-creator flow quota. Same semantics as `maxAgentsCreated`:
 * `null` = unlimited; non-finite / negative collapses to unlimited.
 * The actual cap is enforced in the create-flow path.
 */
export function getMaxFlowsCreated(toolConfig) {
  const v = toolConfig && typeof toolConfig === 'object' ? toolConfig.maxFlowsCreated : undefined;
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return Math.floor(v);
}

/**
 * Decide whether `callerAgentId` may MUTATE `targetFlow` at this level.
 * Mutation = create/update/delete/execute/dry-run. Read (list/get) is
 * unrestricted at any non-disabled level — same convention as agent.
 *
 * Permission-level rules:
 *   disabled      → never
 *   self-created  → only when targetFlow.createdBy === callerAgentId
 *   all           → any flow
 *
 * @returns {{ allow: true } | { allow: false, reason: string }}
 */
export function checkFlowMutationAccess(level, callerAgentId, targetFlow) {
  if (level === FLOW_ACCESS_LEVELS.DISABLED) {
    return { allow: false, reason: 'Flow management is disabled for this caller.' };
  }
  if (!targetFlow || !targetFlow.id) {
    return { allow: false, reason: 'Missing target flow.' };
  }
  if (level === FLOW_ACCESS_LEVELS.ALL) return { allow: true };
  if (level === FLOW_ACCESS_LEVELS.SELF_CREATED) {
    if (targetFlow.createdBy === callerAgentId) return { allow: true };
    return {
      allow: false,
      reason: 'Out of scope: in "self-created" mode you can only modify flows you have created.',
    };
  }
  return { allow: false, reason: `Unknown permission level: ${level}` };
}

/**
 * Filter a list of flows to those reachable for MUTATION by `callerAgentId`
 * at `level`. Read endpoints should NOT use this filter — the tool exposes
 * the full list at any non-disabled level.
 */
export function filterMutableFlows(level, callerAgentId, flows) {
  if (!Array.isArray(flows)) return [];
  return flows.filter(f => checkFlowMutationAccess(level, callerAgentId, f).allow);
}

// ─── Privilege clamp on toolConfig ───────────────────────────────────

/**
 * Compare two scheduledTasks levels by power.
 *   disabled < own < all
 */
const SCHEDULE_ORDER = { disabled: 0, own: 1, all: 2 };
const AGENT_ORDER    = { disabled: 0, 'self-created': 1, all: 2 };
const FLOW_ORDER     = { disabled: 0, 'self-created': 1, all: 2 };

function lower(a, b, order) {
  const ai = order[a] ?? 0;
  const bi = order[b] ?? 0;
  return ai <= bi ? a : b;
}

/**
 * Clamp a target agent's desired `toolConfig.platformcontrol.*` so that
 * NO key exceeds the caller's level for that key. Privilege escalation
 * via "spawn child with permissions I don't have" is prevented here.
 *
 * Returns a result describing the clamp: the resulting config plus an
 * array of `{ key, requested, clampedTo }` records of every reduction.
 * The tool surfaces those to the caller so they know what got trimmed.
 *
 * Inputs:
 *   callerCfg   = caller's `agent.toolConfig.platformcontrol`
 *   desiredCfg  = the platformcontrol slice the caller is requesting
 *                 for the target. Anything not present in desiredCfg
 *                 is left untouched on the target — the clamp only
 *                 inspects what the caller is trying to SET.
 */
export function clampToolConfigForChild(callerCfg, desiredCfg) {
  const callerSchedule = getScheduleAccessLevel(callerCfg);
  const callerAgents   = getAgentAccessLevel(callerCfg);
  const callerFlows    = getFlowAccessLevel(callerCfg);
  const callerTeams    = getTeamScope(callerCfg);
  const callerMax      = getMaxAgentsCreated(callerCfg);
  const callerMaxFlows = getMaxFlowsCreated(callerCfg);

  const out = { ...(desiredCfg || {}) };
  const clamps = [];

  // scheduledTasks
  if (desiredCfg && desiredCfg.scheduledTasks !== undefined) {
    const wanted = desiredCfg.scheduledTasks;
    const allowed = lower(wanted, callerSchedule, SCHEDULE_ORDER);
    if (allowed !== wanted) {
      out.scheduledTasks = allowed;
      clamps.push({ key: 'scheduledTasks', requested: wanted, clampedTo: allowed });
    }
  }

  // agents
  if (desiredCfg && desiredCfg.agents !== undefined) {
    const wanted = desiredCfg.agents;
    const allowed = lower(wanted, callerAgents, AGENT_ORDER);
    if (allowed !== wanted) {
      out.agents = allowed;
      clamps.push({ key: 'agents', requested: wanted, clampedTo: allowed });
    }
  }

  // maxAgentsCreated — child cannot exceed caller's quota.
  // Caller-unlimited (null) → child unrestricted from this rule (caller
  // can hand out unlimited if they themselves are unlimited).
  if (desiredCfg && desiredCfg.maxAgentsCreated !== undefined && callerMax !== null) {
    const wanted = desiredCfg.maxAgentsCreated;
    const wantedNum = (wanted == null || typeof wanted !== 'number') ? null : wanted;
    if (wantedNum === null || wantedNum > callerMax) {
      out.maxAgentsCreated = callerMax;
      clamps.push({ key: 'maxAgentsCreated', requested: wanted, clampedTo: callerMax });
    }
  }

  // flows — same shape as agents.
  if (desiredCfg && desiredCfg.flows !== undefined) {
    const wanted = desiredCfg.flows;
    const allowed = lower(wanted, callerFlows, FLOW_ORDER);
    if (allowed !== wanted) {
      out.flows = allowed;
      clamps.push({ key: 'flows', requested: wanted, clampedTo: allowed });
    }
  }

  // maxFlowsCreated — same quota-clamp rule as maxAgentsCreated.
  if (desiredCfg && desiredCfg.maxFlowsCreated !== undefined && callerMaxFlows !== null) {
    const wanted = desiredCfg.maxFlowsCreated;
    const wantedNum = (wanted == null || typeof wanted !== 'number') ? null : wanted;
    if (wantedNum === null || wantedNum > callerMaxFlows) {
      out.maxFlowsCreated = callerMaxFlows;
      clamps.push({ key: 'maxFlowsCreated', requested: wanted, clampedTo: callerMaxFlows });
    }
  }

  // teams scope — child cannot have any flag the caller doesn't have.
  // 'all' is the strongest; if caller doesn't have 'all', the child
  // can't either.
  if (desiredCfg && desiredCfg.teams && typeof desiredCfg.teams === 'object') {
    const desiredTeams = { ...desiredCfg.teams };
    let teamClamped = false;
    const original = { ...desiredTeams };
    for (const k of ['member', 'ownedByMe', 'all']) {
      if (desiredTeams[k] && !callerTeams[k]) {
        desiredTeams[k] = false;
        teamClamped = true;
      }
    }
    if (teamClamped) {
      out.teams = desiredTeams;
      clamps.push({ key: 'teams', requested: original, clampedTo: desiredTeams });
    }
  }

  return { config: out, clamps };
}

// ─── Team scope (multi-select) ───────────────────────────────────────

/**
 * Resolve the team scope object. Default = all-false (effectively
 * disabled). `all` overrides the others when set.
 */
export function getTeamScope(toolConfig) {
  const raw = toolConfig && typeof toolConfig === 'object' ? toolConfig.teams : undefined;
  const def = { member: false, ownedByMe: false, all: false };
  if (!raw || typeof raw !== 'object') return def;
  return {
    member:    !!raw.member,
    ownedByMe: !!raw.ownedByMe,
    all:       !!raw.all,
  };
}

/** Convenience — true if no scope flag is set. */
export function isTeamAccessDisabled(toolConfig) {
  const s = getTeamScope(toolConfig);
  return !s.all && !s.member && !s.ownedByMe;
}

/**
 * Decide whether `callerAgentId` may operate on `team` given scope.
 * Read-only callers should still go through this when scope-filtering
 * a list. The tool's mutation actions call it for each candidate.
 */
export function checkTeamAccess(scope, callerAgentId, team) {
  if (!team) return { allow: false, reason: 'Missing team.' };
  if (scope && scope.all) return { allow: true };

  const isMember = scope?.member && Array.isArray(team.memberAgentIds)
    && team.memberAgentIds.includes(callerAgentId);
  if (isMember) return { allow: true };

  const isOwner = scope?.ownedByMe && team.createdBy === callerAgentId;
  if (isOwner) return { allow: true };

  return {
    allow: false,
    reason: 'Out of scope: this team is not in any of your enabled team scopes (member / ownedByMe / all).',
  };
}

/**
 * Filter a list of teams to those reachable by `callerAgentId` under
 * `scope`. Empty scope → empty list.
 */
export function filterAccessibleTeams(scope, callerAgentId, teams) {
  if (!Array.isArray(teams)) return [];
  if (!scope || (!scope.all && !scope.member && !scope.ownedByMe)) return [];
  return teams.filter(t => checkTeamAccess(scope, callerAgentId, t).allow);
}

export default {
  // schedules (existing)
  SCHEDULE_ACCESS_LEVELS,
  getScheduleAccessLevel,
  isOwnTargetAgentSchedule,
  checkScheduleAccess,
  filterAccessibleSchedules,
  // agents
  AGENT_ACCESS_LEVELS,
  getAgentAccessLevel,
  getMaxAgentsCreated,
  checkAgentMutationAccess,
  filterMutableAgents,
  // teams
  getTeamScope,
  isTeamAccessDisabled,
  checkTeamAccess,
  filterAccessibleTeams,
  // flows
  FLOW_ACCESS_LEVELS,
  getFlowAccessLevel,
  getMaxFlowsCreated,
  checkFlowMutationAccess,
  filterMutableFlows,
  // clamp
  clampToolConfigForChild,
};
