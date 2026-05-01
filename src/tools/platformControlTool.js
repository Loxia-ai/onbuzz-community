/**
 * PlatformControlTool — agent-facing control over OnBuzz platform features.
 *
 * Designed as a single tool that grows by ADDING sub-features (each with
 * its own permission key) rather than spawning new tools. Today's surface:
 *   - Scheduled tasks (CRUD + trigger + self-resume convenience)
 *
 * Permission model — per-agent, per-feature, three levels:
 *   - 'disabled' (default): the agent cannot use the feature
 *   - 'own':                only this agent's own agent-target schedules
 *   - 'all':                all agent-target schedules (admin scope)
 *
 * Flow-target schedules are NEVER reachable here, regardless of level —
 * agents do not (currently) control flows. See permissions.js for the
 * security boundary; THIS file just dispatches actions.
 *
 * Per-agent config shape:
 *   agent.toolConfig.platformcontrol = {
 *     scheduledTasks: 'disabled' | 'own' | 'all',   // default 'disabled'
 *     // future features get their own keys here
 *   }
 */

import { BaseTool } from './baseTool.js';
import {
  SCHEDULE_ACCESS_LEVELS,
  getScheduleAccessLevel,
  checkScheduleAccess,
  filterAccessibleSchedules,
  AGENT_ACCESS_LEVELS,
  getAgentAccessLevel,
  getMaxAgentsCreated,
  checkAgentMutationAccess,
  clampToolConfigForChild,
  getTeamScope,
  isTeamAccessDisabled,
  checkTeamAccess,
  filterAccessibleTeams,
  FLOW_ACCESS_LEVELS,
  getFlowAccessLevel,
  getMaxFlowsCreated,
  checkFlowMutationAccess,
} from './platformControl/permissions.js';
import { isProtectedFromCaller, makeAgentLookup } from './platformControl/ancestry.js';
import { cascadeDeleteAgent, cascadeDeleteTeam } from './platformControl/cascadeService.js';

const SUPPORTED_ACTIONS = [
  'list-capabilities',
  // Scheduled tasks
  'list-schedules',
  'get-schedule',
  'create-schedule',
  'update-schedule',
  'delete-schedule',
  'toggle-schedule',
  'trigger-schedule',
  'list-presets',
  // Convenience: one-shot self-resume schedule (TODO: rethink — currently
  // a thin wrapper around create-schedule with runOnce + cron derived from
  // a future ISO datetime. May become a first-class `wakeAt` primitive
  // once we see how agents actually use it.)
  'schedule-self-resume',
  // Agent CRUD
  'list-agents',
  'create-agent',
  'update-agent',
  'delete-agent',
  // Team CRUD + membership
  'list-teams',
  'create-team',
  'update-team',
  'delete-team',
  'add-team-member',
  'remove-team-member',
  // Flow CRUD + execution. Permission key: `flows`. Mirrors agents.
  'list-flows',
  'get-flow',
  'create-flow',
  'update-flow',
  'delete-flow',
  'execute-flow',
  'dry-run-flow',
];

/**
 * Convert an ISO datetime in the FUTURE into a one-shot cron expression.
 * Cron resolution is one minute, so we round down to the matching minute.
 * Returns the cron string and a normalized ISO so the caller can echo it.
 *
 * Throws on invalid input or past times — this is user-visible feedback,
 * not a silent fallback.
 */
function isoToOneShotCron(runAt) {
  if (typeof runAt !== 'string' || !runAt.trim()) {
    throw new Error('runAt must be an ISO datetime string');
  }
  const d = new Date(runAt);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`runAt is not a valid datetime: "${runAt}"`);
  }
  // Round down to the minute — cron resolution.
  d.setSeconds(0, 0);
  if (d.getTime() <= Date.now()) {
    throw new Error('runAt must be at least one minute in the future');
  }
  const cron = `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`;
  return { cron, normalizedIso: d.toISOString() };
}

class PlatformControlTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);
    this.id = 'platformcontrol';
    this.requiresProject = false;
    this.isAsync = false;

    /** @type {object|null} */ this.scheduleService = null;
    /** @type {object|null} */ this.agentPool       = null;
    /** @type {object|null} */ this.stateManager    = null;
    /** @type {object|null} */ this.memoryService   = null;
    /** @type {object|null} */ this.flowExecutor    = null;
  }

  /** Injected from src/index.js after ScheduleService is initialized. */
  setScheduleService(scheduleService) {
    this.scheduleService = scheduleService;
    this.logger?.info?.(`[platformcontrol] ScheduleService ${scheduleService ? 'attached' : 'detached'}`);
  }

  /** Injected — needed for agent CRUD + ancestry walks. */
  setAgentPool(agentPool) {
    this.agentPool = agentPool;
    this.logger?.info?.(`[platformcontrol] AgentPool ${agentPool ? 'attached' : 'detached'}`);
  }

  /** Injected — needed for team CRUD + membership cascade cleanup. */
  setStateManager(stateManager) {
    this.stateManager = stateManager;
    this.logger?.info?.(`[platformcontrol] StateManager ${stateManager ? 'attached' : 'detached'}`);
  }

  /** Injected — needed for memory cleanup on agent deletion. */
  setMemoryService(memoryService) {
    this.memoryService = memoryService;
    this.logger?.info?.(`[platformcontrol] MemoryService ${memoryService ? 'attached' : 'detached'}`);
  }

  /** Injected — needed for execute-flow / dry-run-flow actions. */
  setFlowExecutor(flowExecutor) {
    this.flowExecutor = flowExecutor;
    this.logger?.info?.(`[platformcontrol] FlowExecutor ${flowExecutor ? 'attached' : 'detached'}`);
  }

  getDescription() {
    return `
Platform Control Tool: control OnBuzz platform features (scheduled tasks today; more later).

Per-agent permission, default DISABLED. Configure in the tool configurator.

ACTIONS — scheduled tasks:
  list-schedules                                       — list schedules in scope
  get-schedule       { scheduleId }                    — fetch one schedule
  create-schedule    { name, prompt, cronExpression,
                       targetAgentId?, enabled?,
                       runOnce?, maxRuns?,
                       startDate?, endDate?, description? }
                                                       — create. targetAgentId defaults to self in 'own' mode.
                                                         Pass 'self' to explicitly target this agent.
  update-schedule    { scheduleId, ...updates }        — patch fields (name, prompt, cron, enabled, etc.)
  delete-schedule    { scheduleId }                    — remove
  toggle-schedule    { scheduleId, enabled? }          — flip enabled (or set if provided)
  trigger-schedule   { scheduleId }                    — fire NOW, out of band
  list-presets                                         — read-only list of cron presets
  schedule-self-resume { runAt, prompt, name? }        — one-shot schedule that wakes THIS agent
                                                         at runAt (ISO datetime, future, minute-resolution)
                                                         with the given prompt. TODO: under review.

ACTIONS — agents (per-agent permission: 'disabled' | 'self-created' | 'all'; default 'disabled'):
  list-agents                                          — list all agents (read is unrestricted at any non-disabled level)
  create-agent     { name, systemPrompt,
                     description?, model?, capabilities?,
                     skills?, toolConfig?,
                     directoryAccess? }                — create a new agent. createdBy is set to YOU automatically.
                                                         Per-creator quota (maxAgentsCreated, default unlimited)
                                                         applies. Child's toolConfig.platformcontrol.* is CLAMPED
                                                         to your level (no privilege escalation).
  update-agent     { agentId, ...fields }              — patch fields. Same clamp rule on toolConfig.
                                                         Hard rules: cannot target self; cannot target ancestors.
  delete-agent     { agentId }                         — cascade-delete: schedules, memories, team memberships,
                                                         then the agent itself.

ACTIONS — teams (per-agent multi-select scope: member / ownedByMe / all; default all-false = disabled):
  list-teams                                           — list teams reachable in your scope
  create-team      { name, description?, color? }      — create. createdBy is set to YOU automatically.
  update-team      { teamId, name?, description?, color? }
  delete-team      { teamId }                          — removes the team; member assignments die with it.
  add-team-member  { teamId, agentId }                 — add an agent to a team. agentId='self' adds caller.
  remove-team-member { teamId, agentId }               — remove an agent. agentId='self' = leave the team.

ACTIONS — flows (per-agent permission: 'disabled' | 'self-created' | 'all'; default 'disabled'):
  list-flows                                           — list all flows reachable in your scope (read is unrestricted at any non-disabled level)
  get-flow         { flowId }                          — fetch a flow's full definition (nodes + edges + variables)
  create-flow      { name, description?, nodes, edges?, variables? }
                                                       — create a new flow. Definition must pass schema validation.
                                                         createdBy is set to YOU automatically.
                                                         Per-creator quota (maxFlowsCreated, default unlimited) applies.
  update-flow      { flowId, ...fields }               — patch a flow you have permission to mutate.
                                                         The full re-validated definition is required when changing nodes/edges.
  delete-flow      { flowId }                          — cascade-delete: run history + checkpoints + version snapshots.
  execute-flow     { flowId, input? }                  — kick off a run. Returns runId for polling.
  dry-run-flow     { flowId } OR { flow }              — lint-only check without execution; surfaces structural issues
                                                         (orphaned nodes, missing required fields, etc.) before live runs.

  list-capabilities                                    — what permission level + scope this agent has

EXAMPLES:

# Wake me up tomorrow at 9am with a check-in prompt
{
  "toolId": "platformcontrol",
  "action": "schedule-self-resume",
  "runAt": "2026-04-27T09:00:00Z",
  "prompt": "Resume task: review yesterday's PR comments and respond.",
  "name": "Morning PR review"
}

# Recurring agent-self schedule
{
  "toolId": "platformcontrol",
  "action": "create-schedule",
  "name": "Hourly health check",
  "prompt": "Run smoke tests and report status.",
  "cronExpression": "0 * * * *",
  "targetAgentId": "self"
}

# List my own schedules
{ "toolId": "platformcontrol", "action": "list-schedules" }

NOTES:
- Flow schedules are NEVER reachable from this tool, regardless of permission level.
- 'self' is a sugar for the calling agent's id; explicit ids work too.
- cronExpression accepts the standard 5-field cron OR a preset name (call list-presets).
`;
  }

  getSupportedActions() { return [...SUPPORTED_ACTIONS]; }

  async execute(params, context = {}) {
    if (!params || typeof params !== 'object') {
      return { success: false, error: 'params must be an object' };
    }
    const action = params.action || 'list-capabilities';
    const callerAgentId = context?.agentId || null;

    const cfg = this.getEffectiveConfig(context, {});
    const level = getScheduleAccessLevel(cfg);

    // list-capabilities is always allowed — agent needs to discover its
    // own permissions even when scheduledTasks is 'disabled'.
    if (action === 'list-capabilities') {
      return this._listCapabilities(level, cfg);
    }

    // Per-feature gating: each action's permission lives in its own slice
    // of toolConfig.platformcontrol. Schedule actions get scheduleLevel
    // gating; agent / team actions handle their own gates inside their
    // handlers (which need the full cfg anyway for the privilege clamp).
    const isScheduleAction = action.includes('schedule') || action === 'list-presets';
    if (isScheduleAction) {
      if (level === SCHEDULE_ACCESS_LEVELS.DISABLED) {
        return {
          success: false,
          disabled: true,
          error: 'Scheduled-tasks access is disabled for this agent. Enable it in the platformcontrol tool configurator.',
        };
      }
      if (!this.scheduleService) {
        return { success: false, error: 'ScheduleService is not available on this server.' };
      }
    }

    // IMPORTANT: `await` inside the try so async-handler rejections are
    // caught here. Without await, a `return this._createSchedule(...)`
    // hands an un-awaited Promise back; rejections propagate past this
    // try/catch and surface as raw exceptions to the caller.
    try {
      switch (action) {
        case 'list-schedules':       return await this._listSchedules(level, callerAgentId);
        case 'get-schedule':         return await this._getSchedule(level, callerAgentId, params);
        case 'create-schedule':      return await this._createSchedule(level, callerAgentId, params);
        case 'update-schedule':      return await this._updateSchedule(level, callerAgentId, params);
        case 'delete-schedule':      return await this._deleteSchedule(level, callerAgentId, params);
        case 'toggle-schedule':      return await this._toggleSchedule(level, callerAgentId, params);
        case 'trigger-schedule':     return await this._triggerSchedule(level, callerAgentId, params);
        case 'list-presets':         return await this._listPresets();
        case 'schedule-self-resume': return await this._scheduleSelfResume(level, callerAgentId, params);
        // Agent CRUD
        case 'list-agents':          return await this._listAgents(cfg, callerAgentId);
        case 'create-agent':         return await this._createAgent(cfg, callerAgentId, params);
        case 'update-agent':         return await this._updateAgent(cfg, callerAgentId, params);
        case 'delete-agent':         return await this._deleteAgent(cfg, callerAgentId, params);
        // Team CRUD + membership
        case 'list-teams':           return await this._listTeams(cfg, callerAgentId);
        case 'create-team':          return await this._createTeam(cfg, callerAgentId, params);
        case 'update-team':          return await this._updateTeam(cfg, callerAgentId, params);
        case 'delete-team':          return await this._deleteTeam(cfg, callerAgentId, params);
        case 'add-team-member':      return await this._addTeamMember(cfg, callerAgentId, params);
        case 'remove-team-member':   return await this._removeTeamMember(cfg, callerAgentId, params);
        // Flow CRUD + execution
        case 'list-flows':           return await this._listFlows(cfg, callerAgentId);
        case 'get-flow':             return await this._getFlow(cfg, callerAgentId, params);
        case 'create-flow':          return await this._createFlow(cfg, callerAgentId, params);
        case 'update-flow':          return await this._updateFlow(cfg, callerAgentId, params);
        case 'delete-flow':          return await this._deleteFlow(cfg, callerAgentId, params);
        case 'execute-flow':         return await this._executeFlow(cfg, callerAgentId, params);
        case 'dry-run-flow':         return await this._dryRunFlow(cfg, callerAgentId, params);
        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Supported: ${SUPPORTED_ACTIONS.join(', ')}`,
          };
      }
    } catch (err) {
      this.logger?.error?.('[platformcontrol] action failed', { action, error: err?.message });
      return { success: false, error: err?.message || 'unknown error' };
    }
  }

  _listCapabilities(level, fullCfg) {
    const agentLevel = getAgentAccessLevel(fullCfg);
    const teamScope = getTeamScope(fullCfg);
    const teamsDisabled = isTeamAccessDisabled(fullCfg);
    return {
      success: true,
      action: 'list-capabilities',
      capabilities: {
        scheduledTasks: {
          level,
          canListOwn:    level !== SCHEDULE_ACCESS_LEVELS.DISABLED,
          canListAll:    level === SCHEDULE_ACCESS_LEVELS.ALL,
          canMutateOwn:  level !== SCHEDULE_ACCESS_LEVELS.DISABLED,
          canMutateAll:  level === SCHEDULE_ACCESS_LEVELS.ALL,
          notes: [
            'Flow-target schedules are not reachable from this tool.',
            'Default level is "disabled". Configure via the platformcontrol tool configurator.',
          ],
        },
        agents: {
          level: agentLevel,
          maxAgentsCreated: getMaxAgentsCreated(fullCfg),
          canList:        agentLevel !== AGENT_ACCESS_LEVELS.DISABLED,
          canCreate:      agentLevel !== AGENT_ACCESS_LEVELS.DISABLED,
          canMutateSelfCreated: agentLevel !== AGENT_ACCESS_LEVELS.DISABLED,
          canMutateAll:   agentLevel === AGENT_ACCESS_LEVELS.ALL,
          notes: [
            'Hard rule: an agent cannot modify itself or any of its ancestors.',
            'When configuring another agent\'s toolConfig, child permissions are clamped to your level.',
            'maxAgentsCreated null = unlimited; counted only against agents YOU created via this tool.',
          ],
        },
        teams: {
          scope: teamScope,
          disabled: teamsDisabled,
          notes: [
            'Multi-select scope: you can act on teams you are a member of, teams you created, or all (each independently).',
            'Leaving a team you\'re a member of is allowed.',
          ],
        },
        flows: {
          level: getFlowAccessLevel(fullCfg),
          maxFlowsCreated: getMaxFlowsCreated(fullCfg),
          canList:        getFlowAccessLevel(fullCfg) !== FLOW_ACCESS_LEVELS.DISABLED,
          canCreate:      getFlowAccessLevel(fullCfg) !== FLOW_ACCESS_LEVELS.DISABLED,
          canMutateSelfCreated: getFlowAccessLevel(fullCfg) !== FLOW_ACCESS_LEVELS.DISABLED,
          canMutateAll:   getFlowAccessLevel(fullCfg) === FLOW_ACCESS_LEVELS.ALL,
          notes: [
            'Permission key: flows. Default level is "disabled".',
            'Flow definitions are validated against the v2 schema before save — invalid flows are rejected with detailed errors.',
            'delete-flow cascades through run history, checkpoints, and version snapshots.',
            'execute-flow respects existing flow permission levels — at "self-created" level you can only run flows you created.',
          ],
        },
      },
    };
  }

  _listSchedules(level, callerAgentId) {
    const all = this.scheduleService.listSchedules();
    const accessible = filterAccessibleSchedules(level, callerAgentId, all);
    return {
      success: true,
      action: 'list-schedules',
      count: accessible.length,
      schedules: accessible,
      scope: level,
    };
  }

  _getSchedule(level, callerAgentId, params) {
    const id = params?.scheduleId;
    if (!id) return { success: false, error: 'scheduleId is required' };
    const schedule = this.scheduleService.getSchedule(id);
    if (!schedule) return { success: false, error: `Schedule not found: ${id}` };
    const access = checkScheduleAccess(level, callerAgentId, schedule);
    if (!access.allow) {
      // Surface as not-found rather than scope-denied so 'own' agents
      // cannot probe for the existence of other agents' schedules by id.
      return { success: false, error: `Schedule not found: ${id}` };
    }
    return { success: true, action: 'get-schedule', schedule };
  }

  /**
   * Resolve `targetAgentId` from the create/self-resume params:
   *   - 'self' → callerAgentId
   *   - undefined → callerAgentId (default to self)
   *   - any string → the explicit id
   *
   * In 'own' mode we then assert the resolved id MUST equal callerAgentId.
   */
  _resolveTargetAgentId(level, callerAgentId, raw) {
    if (raw === 'self' || raw === undefined || raw === null || raw === '') return callerAgentId;
    if (typeof raw !== 'string') {
      throw new Error('targetAgentId must be a string (or "self")');
    }
    if (level === SCHEDULE_ACCESS_LEVELS.OWN && raw !== callerAgentId) {
      throw new Error(
        `Out of scope: 'own' mode requires targetAgentId === this agent's id ("${callerAgentId}"). ` +
        `Set the platformcontrol tool to 'all' for cross-agent scheduling.`
      );
    }
    return raw;
  }

  async _createSchedule(level, callerAgentId, params) {
    const targetAgentId = this._resolveTargetAgentId(level, callerAgentId, params?.targetAgentId);
    const built = {
      name:           params?.name,
      prompt:         params?.prompt,
      targetType:     'agent',                       // tool only ever creates agent-target schedules
      targetId:       targetAgentId,
      cronExpression: params?.cronExpression,
      enabled:        params?.enabled !== false,    // default true
      description:    params?.description || '',
      startDate:      params?.startDate || null,
      endDate:        params?.endDate || null,
      maxRuns:        params?.maxRuns ?? null,
      runOnce:        !!params?.runOnce,
    };
    const schedule = await this.scheduleService.createSchedule(built);
    return { success: true, action: 'create-schedule', schedule };
  }

  async _updateSchedule(level, callerAgentId, params) {
    const id = params?.scheduleId;
    if (!id) return { success: false, error: 'scheduleId is required' };
    const existing = this.scheduleService.getSchedule(id);
    if (!existing) return { success: false, error: `Schedule not found: ${id}` };
    const access = checkScheduleAccess(level, callerAgentId, existing);
    if (!access.allow) return { success: false, error: `Schedule not found: ${id}` };

    // 'own' mode cannot reassign a schedule to a different target.
    if (params?.targetAgentId !== undefined && params.targetAgentId !== null) {
      const desired = this._resolveTargetAgentId(level, callerAgentId, params.targetAgentId);
      if (level === SCHEDULE_ACCESS_LEVELS.OWN && desired !== callerAgentId) {
        return {
          success: false,
          error: `Out of scope: 'own' mode cannot reassign schedule "${id}" to another agent.`,
        };
      }
    }

    const updates = {};
    const PASS = ['name', 'description', 'prompt', 'cronExpression', 'enabled', 'startDate', 'endDate', 'maxRuns', 'runOnce'];
    for (const k of PASS) if (params[k] !== undefined) updates[k] = params[k];
    if (params?.targetAgentId !== undefined && params.targetAgentId !== null) {
      updates.targetId = this._resolveTargetAgentId(level, callerAgentId, params.targetAgentId);
    }
    const schedule = await this.scheduleService.updateSchedule(id, updates);
    return { success: true, action: 'update-schedule', schedule };
  }

  async _deleteSchedule(level, callerAgentId, params) {
    const id = params?.scheduleId;
    if (!id) return { success: false, error: 'scheduleId is required' };
    const existing = this.scheduleService.getSchedule(id);
    if (!existing) return { success: false, error: `Schedule not found: ${id}` };
    const access = checkScheduleAccess(level, callerAgentId, existing);
    if (!access.allow) return { success: false, error: `Schedule not found: ${id}` };
    await this.scheduleService.deleteSchedule(id);
    return { success: true, action: 'delete-schedule', scheduleId: id };
  }

  async _toggleSchedule(level, callerAgentId, params) {
    const id = params?.scheduleId;
    if (!id) return { success: false, error: 'scheduleId is required' };
    const existing = this.scheduleService.getSchedule(id);
    if (!existing) return { success: false, error: `Schedule not found: ${id}` };
    const access = checkScheduleAccess(level, callerAgentId, existing);
    if (!access.allow) return { success: false, error: `Schedule not found: ${id}` };

    const next = typeof params?.enabled === 'boolean' ? params.enabled : !existing.enabled;
    const schedule = await this.scheduleService.updateSchedule(id, { enabled: next });
    return { success: true, action: 'toggle-schedule', scheduleId: id, enabled: schedule.enabled };
  }

  async _triggerSchedule(level, callerAgentId, params) {
    const id = params?.scheduleId;
    if (!id) return { success: false, error: 'scheduleId is required' };
    const existing = this.scheduleService.getSchedule(id);
    if (!existing) return { success: false, error: `Schedule not found: ${id}` };
    const access = checkScheduleAccess(level, callerAgentId, existing);
    if (!access.allow) return { success: false, error: `Schedule not found: ${id}` };

    // ScheduleService doesn't expose a public "trigger now" API yet; the
    // closest is _executeSchedule which is internal. Use the private path
    // when available; otherwise mark this action as not-implemented so the
    // agent gets clear feedback rather than a silent stub.
    if (typeof this.scheduleService._executeSchedule === 'function') {
      // Fire-and-forget — execution may take a while, the agent shouldn't block.
      this.scheduleService._executeSchedule(existing).catch(err => {
        this.logger?.warn?.('[platformcontrol] trigger-schedule execution failed', {
          scheduleId: id, error: err?.message,
        });
      });
      return { success: true, action: 'trigger-schedule', scheduleId: id, triggered: true };
    }
    return {
      success: false,
      error: 'trigger-schedule is not supported on this version of ScheduleService.',
    };
  }

  _listPresets() {
    // Presets live in scheduleService; expose via a stable surface.
    // CRON_PRESETS isn't exported, so we surface the names plus a note
    // pointing to scheduleService.listSchedules's cronPreset field.
    // (TODO: export presets from scheduleService and read them here.)
    return {
      success: true,
      action: 'list-presets',
      presets: [
        'every-minute', 'every-5-minutes', 'every-15-minutes', 'every-30-minutes',
        'every-hour', 'every-6-hours', 'every-12-hours',
        'daily', 'daily-morning', 'daily-evening',
        'weekdays', 'weekends', 'weekly-monday', 'monthly',
      ],
      note: 'Pass a preset name as cronExpression OR a raw 5-field cron string.',
    };
  }

  async _scheduleSelfResume(level, callerAgentId, params) {
    // TODO: rethink ergonomics. Currently a thin wrapper around
    // create-schedule with runOnce + cron derived from a future ISO
    // datetime. May become a first-class wake-at primitive after we
    // see how agents actually plan around it.
    if (!callerAgentId) {
      return { success: false, error: 'callerAgentId is required (no context.agentId)' };
    }
    const { runAt, prompt, name } = params || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return { success: false, error: 'prompt (non-empty string) is required' };
    }
    let cron, normalizedIso;
    try {
      ({ cron, normalizedIso } = isoToOneShotCron(runAt));
    } catch (err) {
      return { success: false, error: err.message };
    }
    const schedule = await this.scheduleService.createSchedule({
      name: name || `Self-resume @ ${normalizedIso}`,
      description: 'One-shot self-resume created via platformcontrol.schedule-self-resume',
      prompt,
      targetType: 'agent',
      targetId: callerAgentId,
      cronExpression: cron,
      runOnce: true,
      enabled: true,
    });
    return {
      success: true,
      action: 'schedule-self-resume',
      runAt: normalizedIso,
      cronExpression: cron,
      schedule,
    };
  }

  // ─── Agent + team helpers ─────────────────────────────────────────

  /**
   * Snapshot all agents into a Map keyed by id, used to build the
   * `getAgent` lookup the ancestry walker needs. Done once per action
   * so a single call doesn't hit the agent pool repeatedly.
   *
   * Returns a tuple { agents, getAgent, isProtectedFromCaller }.
   * isProtectedFromCaller is curried with the lookup so it can be
   * passed into checkAgentMutationAccess as opts.isProtectedFromCaller.
   */
  async _agentSnapshot(callerAgentId) {
    if (!this.agentPool || typeof this.agentPool.getAllAgents !== 'function') {
      return { agents: [], getAgent: () => null, isProtectedFromCaller: () => false };
    }
    const all = await this.agentPool.getAllAgents();
    // Normalize to array (getAllAgents may return a Map).
    const arr = (all instanceof Map) ? Array.from(all.values()) : Array.isArray(all) ? all : [];
    const getAgent = makeAgentLookup(arr);
    const protect = (callerId, targetId) => isProtectedFromCaller(callerId, targetId, getAgent);
    return { agents: arr, getAgent, isProtectedFromCaller: protect };
  }

  /** Project an agent into the safe summary shape we expose to other agents. */
  _projectAgent(a) {
    if (!a) return null;
    return {
      id: a.id,
      name: a.name,
      mode: a.mode,
      status: a.status,
      currentModel: a.currentModel,
      preferredModel: a.preferredModel || null,
      capabilities: Array.isArray(a.capabilities) ? a.capabilities.slice() : [],
      skills: Array.isArray(a.skills) ? a.skills.slice() : [],
      createdBy: a.createdBy || null,
      createdAt: a.createdAt || null,
    };
  }

  // ─── Agent CRUD ───────────────────────────────────────────────────

  async _listAgents(cfg, callerAgentId) {
    const level = getAgentAccessLevel(cfg);
    if (level === AGENT_ACCESS_LEVELS.DISABLED) {
      return { success: false, disabled: true, error: 'Agent management is disabled for this caller.' };
    }
    if (!this.agentPool) return { success: false, error: 'AgentPool unavailable.' };
    const { agents } = await this._agentSnapshot(callerAgentId);
    // Read is unrestricted at any non-disabled level — agents need to
    // enumerate to make decisions. Mutations are gated separately.
    const list = agents.map(a => this._projectAgent(a));
    return { success: true, action: 'list-agents', count: list.length, agents: list, scope: level };
  }

  async _createAgent(cfg, callerAgentId, params) {
    const level = getAgentAccessLevel(cfg);
    if (level === AGENT_ACCESS_LEVELS.DISABLED) {
      return { success: false, disabled: true, error: 'Agent management is disabled for this caller.' };
    }
    if (!this.agentPool || typeof this.agentPool.createAgent !== 'function') {
      return { success: false, error: 'AgentPool unavailable.' };
    }
    const { name, systemPrompt, model } = params || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { success: false, error: 'name (non-empty string) is required' };
    }
    if (!systemPrompt || typeof systemPrompt !== 'string') {
      return { success: false, error: 'systemPrompt (string) is required' };
    }

    // Per-creator quota — count alive agents whose createdBy === caller.
    const max = getMaxAgentsCreated(cfg);
    if (max !== null) {
      const { agents } = await this._agentSnapshot(callerAgentId);
      const owned = agents.filter(a => a.createdBy === callerAgentId).length;
      if (owned >= max) {
        return {
          success: false,
          error: `Per-creator agent quota exhausted (${owned}/${max}). Delete one of your created agents or ask the user to raise maxAgentsCreated.`,
        };
      }
    }

    // Privilege clamp on the requested toolConfig.platformcontrol.
    let pcSliceClamps = [];
    let nextToolConfig = (params.toolConfig && typeof params.toolConfig === 'object') ? { ...params.toolConfig } : {};
    if (nextToolConfig.platformcontrol && typeof nextToolConfig.platformcontrol === 'object') {
      const callerPc = (cfg && typeof cfg === 'object') ? cfg : {};
      const { config: clampedPc, clamps } = clampToolConfigForChild(callerPc, nextToolConfig.platformcontrol);
      nextToolConfig.platformcontrol = clampedPc;
      pcSliceClamps = clamps;
    }

    const newConfig = {
      name: name.trim(),
      description: typeof params.description === 'string' ? params.description : '',
      systemPrompt,
      model: model || undefined,
      preferredModel: params.preferredModel || model || undefined,
      capabilities: Array.isArray(params.capabilities) ? params.capabilities.slice() : [],
      skills: Array.isArray(params.skills) ? params.skills.slice() : [],
      toolConfig: nextToolConfig,
      directoryAccess: params.directoryAccess || undefined,
      // KEY: tag the new agent's parent so ancestry rules apply forever after.
      createdBy: callerAgentId,
    };

    const created = await this.agentPool.createAgent(newConfig);
    return {
      success: true,
      action: 'create-agent',
      agent: this._projectAgent(created),
      clamps: pcSliceClamps,
    };
  }

  async _updateAgent(cfg, callerAgentId, params) {
    const level = getAgentAccessLevel(cfg);
    if (level === AGENT_ACCESS_LEVELS.DISABLED) {
      return { success: false, disabled: true, error: 'Agent management is disabled for this caller.' };
    }
    if (!this.agentPool) return { success: false, error: 'AgentPool unavailable.' };
    const targetId = params?.agentId;
    if (!targetId) return { success: false, error: 'agentId is required' };

    const { agents, isProtectedFromCaller: protect } = await this._agentSnapshot(callerAgentId);
    const target = agents.find(a => a.id === targetId);
    if (!target) return { success: false, error: `Agent not found: ${targetId}` };

    const access = checkAgentMutationAccess(level, callerAgentId, target, {
      isProtectedFromCaller: protect,
    });
    if (!access.allow) {
      return { success: false, error: access.reason };
    }

    // Build the updates patch — everything the user UI accepts, with the
    // privilege clamp applied to toolConfig.platformcontrol.
    const updates = {};
    const PASS_THROUGH = ['name', 'description', 'systemPrompt', 'model', 'preferredModel',
      'capabilities', 'skills', 'directoryAccess'];
    for (const k of PASS_THROUGH) if (params[k] !== undefined) updates[k] = params[k];

    let pcSliceClamps = [];
    if (params.toolConfig && typeof params.toolConfig === 'object') {
      const next = { ...params.toolConfig };
      if (next.platformcontrol && typeof next.platformcontrol === 'object') {
        const callerPc = (cfg && typeof cfg === 'object') ? cfg : {};
        const { config: clampedPc, clamps } = clampToolConfigForChild(callerPc, next.platformcontrol);
        next.platformcontrol = clampedPc;
        pcSliceClamps = clamps;
      }
      updates.toolConfig = next;
    }

    const updated = await this.agentPool.updateAgent(targetId, updates);
    return {
      success: true,
      action: 'update-agent',
      agent: this._projectAgent(updated || target),
      clamps: pcSliceClamps,
    };
  }

  async _deleteAgent(cfg, callerAgentId, params) {
    const level = getAgentAccessLevel(cfg);
    if (level === AGENT_ACCESS_LEVELS.DISABLED) {
      return { success: false, disabled: true, error: 'Agent management is disabled for this caller.' };
    }
    if (!this.agentPool) return { success: false, error: 'AgentPool unavailable.' };
    const targetId = params?.agentId;
    if (!targetId) return { success: false, error: 'agentId is required' };

    const { agents, isProtectedFromCaller: protect } = await this._agentSnapshot(callerAgentId);
    const target = agents.find(a => a.id === targetId);
    if (!target) return { success: false, error: `Agent not found: ${targetId}` };

    const access = checkAgentMutationAccess(level, callerAgentId, target, {
      isProtectedFromCaller: protect,
    });
    if (!access.allow) return { success: false, error: access.reason };

    const report = await cascadeDeleteAgent({
      agentId: targetId,
      scheduleService: this.scheduleService,
      memoryService:   this.memoryService,
      stateManager:    this.stateManager,
      agentPool:       this.agentPool,
      logger:          this.logger,
    });
    return {
      success: report.agentDeleted,
      action: 'delete-agent',
      agentId: targetId,
      report,
    };
  }

  // ─── Team CRUD + membership ───────────────────────────────────────

  async _listTeams(cfg, callerAgentId) {
    if (isTeamAccessDisabled(cfg)) {
      return { success: false, disabled: true, error: 'Team management is disabled for this caller.' };
    }
    if (!this.stateManager || typeof this.stateManager.getAllTeams !== 'function') {
      return { success: false, error: 'StateManager unavailable.' };
    }
    const all = await this.stateManager.getAllTeams();
    const scope = getTeamScope(cfg);
    // Per the design: read is unrestricted within scope (not unlimited
    // like agents). The agent only sees teams it's reachable for —
    // listing teams it can never act on adds noise without value.
    const accessible = filterAccessibleTeams(scope, callerAgentId, all);
    return { success: true, action: 'list-teams', count: accessible.length, teams: accessible, scope };
  }

  async _createTeam(cfg, callerAgentId, params) {
    if (isTeamAccessDisabled(cfg)) {
      return { success: false, disabled: true, error: 'Team management is disabled for this caller.' };
    }
    if (!this.stateManager || typeof this.stateManager.createTeam !== 'function') {
      return { success: false, error: 'StateManager unavailable.' };
    }
    const { name, description, color } = params || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { success: false, error: 'name (non-empty string) is required' };
    }
    const team = await this.stateManager.createTeam({
      name: name.trim(),
      description: description || '',
      color,
      createdBy: callerAgentId,
    });
    return { success: true, action: 'create-team', team };
  }

  /**
   * Verify scope access on an EXISTING team. Returns the team or an
   * error result — the caller propagates either.
   */
  async _resolveTeamForAccess(cfg, callerAgentId, teamId) {
    if (!teamId) return { error: 'teamId is required' };
    const team = await this.stateManager.getTeam(teamId);
    if (!team) return { error: `Team not found: ${teamId}` };
    const scope = getTeamScope(cfg);
    const access = checkTeamAccess(scope, callerAgentId, team);
    if (!access.allow) return { error: `Team not found: ${teamId}` };  // hide existence
    return { team };
  }

  async _updateTeam(cfg, callerAgentId, params) {
    if (isTeamAccessDisabled(cfg)) {
      return { success: false, disabled: true, error: 'Team management is disabled for this caller.' };
    }
    const got = await this._resolveTeamForAccess(cfg, callerAgentId, params?.teamId);
    if (got.error) return { success: false, error: got.error };
    const updates = {};
    for (const k of ['name', 'description', 'color']) {
      if (params[k] !== undefined) updates[k] = params[k];
    }
    const updated = await this.stateManager.updateTeam(params.teamId, updates);
    return { success: true, action: 'update-team', team: updated };
  }

  async _deleteTeam(cfg, callerAgentId, params) {
    if (isTeamAccessDisabled(cfg)) {
      return { success: false, disabled: true, error: 'Team management is disabled for this caller.' };
    }
    const got = await this._resolveTeamForAccess(cfg, callerAgentId, params?.teamId);
    if (got.error) return { success: false, error: got.error };
    const report = await cascadeDeleteTeam({
      teamId: params.teamId,
      stateManager: this.stateManager,
      logger: this.logger,
    });
    return { success: report.teamDeleted, action: 'delete-team', teamId: params.teamId, report };
  }

  /**
   * Adding a member is a team mutation. Self-add is allowed iff the
   * caller's scope already covers the team (e.g. 'all', 'ownedByMe').
   * The hard rules apply to AGENT mutations — adding agentX to a team
   * is a TEAM mutation, not an agent mutation, so no ancestor check.
   */
  async _addTeamMember(cfg, callerAgentId, params) {
    if (isTeamAccessDisabled(cfg)) {
      return { success: false, disabled: true, error: 'Team management is disabled for this caller.' };
    }
    const got = await this._resolveTeamForAccess(cfg, callerAgentId, params?.teamId);
    if (got.error) return { success: false, error: got.error };
    const agentId = params?.agentId === 'self' ? callerAgentId : params?.agentId;
    if (!agentId) return { success: false, error: 'agentId is required' };
    const team = await this.stateManager.addAgentToTeam(params.teamId, agentId);
    return { success: true, action: 'add-team-member', teamId: params.teamId, agentId, team };
  }

  /**
   * Removing a member is a team mutation. SPECIAL CASE: if the agent
   * is removing ITSELF (leaving), allow it as long as the team is
   * within scope — leaving a team is not self-modification of the
   * agent record, it's modification of the team's member list.
   * If the agent has 'member' scope and is leaving, the team IS in
   * scope by definition, so this just works.
   */
  async _removeTeamMember(cfg, callerAgentId, params) {
    if (isTeamAccessDisabled(cfg)) {
      return { success: false, disabled: true, error: 'Team management is disabled for this caller.' };
    }
    const got = await this._resolveTeamForAccess(cfg, callerAgentId, params?.teamId);
    if (got.error) return { success: false, error: got.error };
    const agentId = params?.agentId === 'self' ? callerAgentId : params?.agentId;
    if (!agentId) return { success: false, error: 'agentId is required' };
    const team = await this.stateManager.removeAgentFromTeam(params.teamId, agentId);
    return { success: true, action: 'remove-team-member', teamId: params.teamId, agentId, team };
  }

  // ─── Flow CRUD + execution ─────────────────────────────────────────
  //
  // Permission key: `flows`. Default 'disabled'. Same shape as agents:
  // 'self-created' = only flows you authored, 'all' = admin scope.
  // Read endpoints (list/get) are unrestricted at any non-disabled
  // level so an agent can browse what's available before deciding which
  // to run; mutations (create/update/delete/execute/dry-run) all go
  // through `checkFlowMutationAccess`.

  /** Resolve the project dir the same way every other path here does. */
  _flowProjectDir() {
    return this.stateManager?.config?.project?.directory
        || this.stateManager?.config?.projectDir
        || process.cwd();
  }

  async _listFlows(cfg, callerAgentId) {
    const level = getFlowAccessLevel(cfg);
    if (level === FLOW_ACCESS_LEVELS.DISABLED) {
      return { success: false, disabled: true, error: 'Flow management is disabled for this caller.' };
    }
    if (!this.stateManager) {
      return { success: false, error: 'StateManager not available.' };
    }
    const all = await this.stateManager.getAllFlows(this._flowProjectDir());
    // List is unrestricted at any non-disabled level — agents can see
    // what they could run / what the platform offers. Mutability is
    // surfaced per-row so the LLM knows what it can act on.
    const list = (all || []).map(f => ({
      id: f.id,
      name: f.name,
      description: f.description || '',
      version: f.version,
      createdBy: f.createdBy || null,
      nodeCount: Array.isArray(f.nodes) ? f.nodes.length : 0,
      mutable: checkFlowMutationAccess(level, callerAgentId, f).allow,
    }));
    return { success: true, action: 'list-flows', count: list.length, flows: list, scope: level };
  }

  async _getFlow(cfg, callerAgentId, params) {
    const level = getFlowAccessLevel(cfg);
    if (level === FLOW_ACCESS_LEVELS.DISABLED) {
      return { success: false, disabled: true, error: 'Flow management is disabled for this caller.' };
    }
    if (!params?.flowId) return { success: false, error: 'flowId is required' };
    const flow = await this.stateManager.getFlow(params.flowId, this._flowProjectDir());
    if (!flow) return { success: false, error: `Flow not found: ${params.flowId}` };
    return {
      success: true, action: 'get-flow', flow,
      mutable: checkFlowMutationAccess(level, callerAgentId, flow).allow,
    };
  }

  async _createFlow(cfg, callerAgentId, params) {
    const level = getFlowAccessLevel(cfg);
    if (level === FLOW_ACCESS_LEVELS.DISABLED) {
      return { success: false, disabled: true, error: 'Flow management is disabled for this caller.' };
    }
    if (!params?.name || typeof params.name !== 'string') {
      return { success: false, error: 'name is required' };
    }
    if (!Array.isArray(params.nodes) || params.nodes.length === 0) {
      return { success: false, error: 'nodes array is required (must have at least one node)' };
    }
    // Quota enforcement — count flows the caller has authored so far.
    const max = getMaxFlowsCreated(cfg);
    if (max !== null) {
      const owned = (await this.stateManager.getAllFlows(this._flowProjectDir()))
        .filter(f => f.createdBy === callerAgentId);
      if (owned.length >= max) {
        return {
          success: false,
          error: `maxFlowsCreated quota reached: you have created ${owned.length} of ${max} allowed flows.`,
        };
      }
    }
    // Schema validation runs inside stateManager.createFlow already
    // (via the route layer); we additionally call validate here so an
    // invalid create returns a clean structured error rather than going
    // through the route. Defensive — duplicate guard, no harm.
    const created = await this.stateManager.createFlow({
      name:        params.name,
      description: params.description || '',
      nodes:       params.nodes,
      edges:       params.edges || [],
      variables:   params.variables || {},
      // Stamp the caller as the author so self-created scope can find it.
      createdBy:   callerAgentId,
    }, this._flowProjectDir());
    return { success: true, action: 'create-flow', flow: created };
  }

  async _updateFlow(cfg, callerAgentId, params) {
    const level = getFlowAccessLevel(cfg);
    if (level === FLOW_ACCESS_LEVELS.DISABLED) {
      return { success: false, disabled: true, error: 'Flow management is disabled for this caller.' };
    }
    if (!params?.flowId) return { success: false, error: 'flowId is required' };
    const target = await this.stateManager.getFlow(params.flowId, this._flowProjectDir());
    if (!target) return { success: false, error: `Flow not found: ${params.flowId}` };
    const access = checkFlowMutationAccess(level, callerAgentId, target);
    if (!access.allow) return { success: false, error: access.reason };
    // Strip identity-level fields the caller shouldn't be able to spoof.
    const { id: _id, createdBy: _cb, version: _v, ...patch } = params;
    const updated = await this.stateManager.updateFlow(params.flowId, patch, this._flowProjectDir());
    return { success: true, action: 'update-flow', flow: updated };
  }

  async _deleteFlow(cfg, callerAgentId, params) {
    const level = getFlowAccessLevel(cfg);
    if (level === FLOW_ACCESS_LEVELS.DISABLED) {
      return { success: false, disabled: true, error: 'Flow management is disabled for this caller.' };
    }
    if (!params?.flowId) return { success: false, error: 'flowId is required' };
    const target = await this.stateManager.getFlow(params.flowId, this._flowProjectDir());
    if (!target) return { success: false, error: `Flow not found: ${params.flowId}` };
    const access = checkFlowMutationAccess(level, callerAgentId, target);
    if (!access.allow) return { success: false, error: access.reason };
    await this.stateManager.deleteFlow(params.flowId, this._flowProjectDir());
    return { success: true, action: 'delete-flow', flowId: params.flowId };
  }

  async _executeFlow(cfg, callerAgentId, params) {
    const level = getFlowAccessLevel(cfg);
    if (level === FLOW_ACCESS_LEVELS.DISABLED) {
      return { success: false, disabled: true, error: 'Flow management is disabled for this caller.' };
    }
    if (!params?.flowId) return { success: false, error: 'flowId is required' };
    if (!this.flowExecutor) return { success: false, error: 'FlowExecutor not available on this server.' };
    const target = await this.stateManager.getFlow(params.flowId, this._flowProjectDir());
    if (!target) return { success: false, error: `Flow not found: ${params.flowId}` };
    // Execute counts as a mutation (it consumes credits + writes run history).
    const access = checkFlowMutationAccess(level, callerAgentId, target);
    if (!access.allow) return { success: false, error: access.reason };
    const run = await this.flowExecutor.executeFlow(params.flowId, params.input || {}, {
      projectDir: this._flowProjectDir(),
      // Tag the run with the agent that triggered it so audit trails
      // attribute correctly when an agent kicks a flow off via the tool.
      triggeredBy: { kind: 'agent', agentId: callerAgentId },
    });
    return { success: true, action: 'execute-flow', runId: run?.runId || run?.id || null, status: run?.status || 'queued' };
  }

  async _dryRunFlow(cfg, callerAgentId, params) {
    const level = getFlowAccessLevel(cfg);
    if (level === FLOW_ACCESS_LEVELS.DISABLED) {
      return { success: false, disabled: true, error: 'Flow management is disabled for this caller.' };
    }
    // Dry-run accepts EITHER an existing flowId OR an inline flow def
    // (so an agent can lint a draft before saving).
    let flow;
    if (params?.flowId) {
      flow = await this.stateManager.getFlow(params.flowId, this._flowProjectDir());
      if (!flow) return { success: false, error: `Flow not found: ${params.flowId}` };
    } else if (params?.flow && typeof params.flow === 'object') {
      flow = params.flow;
    } else {
      return { success: false, error: 'Pass either { flowId } or { flow: {...} }' };
    }
    if (!this.flowExecutor || typeof this.flowExecutor.dryRun !== 'function') {
      return { success: false, error: 'FlowExecutor.dryRun not available on this server.' };
    }
    const report = await this.flowExecutor.dryRun(flow);
    return { success: true, action: 'dry-run-flow', report };
  }
}

export default PlatformControlTool;
export { PlatformControlTool };
