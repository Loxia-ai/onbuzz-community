/**
 * PlatformControlConfigurator — per-agent toolConfig UI for platformcontrol.
 *
 * Today the tool has one feature (scheduledTasks) with a 3-level permission.
 * As we add features (agent spawning, lifecycle, …) we'll add more sections
 * here, each independently configurable.
 *
 * Default everywhere is "disabled" — opt-in is explicit.
 *
 * Shape of `value`:
 *   { scheduledTasks?: 'disabled' | 'own' | 'all' }
 */

import React from 'react';

const SCHEDULE_LEVELS = [
  {
    id: 'disabled',
    title: 'Disabled',
    body: 'Agent cannot list, create, or modify scheduled tasks.',
  },
  {
    id: 'own',
    title: 'Own schedules only',
    body: 'Agent can list, create, and modify schedules that target THIS agent. ' +
          'Use this for self-scheduling: agents planning future work or one-shot wake-up calls.',
  },
  {
    id: 'all',
    title: 'All agents (admin)',
    body: 'Agent can list, create, and modify schedules for ANY agent. ' +
          'Reserved for orchestrator / admin agents — gives broad cross-agent control.',
  },
];

const AGENT_LEVELS = [
  {
    id: 'disabled',
    title: 'Disabled',
    body: 'Agent cannot create, modify, or delete agents.',
  },
  {
    id: 'self-created',
    title: 'Create + manage agents YOU created',
    body: 'Agent can create new agents and manage only the ones it created. Hard rules ' +
          'always apply: cannot modify itself or any of its ancestors. Child permissions ' +
          'are clamped to the caller\'s level.',
  },
  {
    id: 'all',
    title: 'Manage all agents (admin)',
    body: 'Agent can create and manage any agent — except itself and its ancestors. ' +
          'Reserved for orchestrator / admin agents.',
  },
];

const TEAM_SCOPE_OPTIONS = [
  {
    id: 'member',
    title: 'Teams I am a member of',
    body: 'Read, edit, and (importantly) leave teams that include this agent.',
  },
  {
    id: 'ownedByMe',
    title: 'Teams I created',
    body: 'Manage teams this agent created via the platformcontrol tool.',
  },
  {
    id: 'all',
    title: 'All teams (admin)',
    body: 'Full access to every team. Overrides the other two when checked.',
  },
];

function PlatformControlConfigurator({ value, onChange, disabled }) {
  const cfg = value || {};
  // Default 'disabled' — matches the backend permission helper's default.
  const scheduledTasks = cfg.scheduledTasks || 'disabled';
  const agentsLevel    = cfg.agents || 'disabled';
  const teams          = cfg.teams || { member: false, ownedByMe: false, all: false };
  // null = unlimited; we represent it in the input as empty string.
  const maxAgentsCreated = (cfg.maxAgentsCreated == null) ? '' : cfg.maxAgentsCreated;

  const set = (patch) => onChange({ ...cfg, ...patch });

  return (
    <div className="space-y-6" data-testid="platformcontrol-configurator">
      {/* ── Scheduled tasks ─────────────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
          Scheduled tasks
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Controls whether the agent can read/manage scheduled tasks. Flow-target schedules are
          never reachable from this tool, regardless of level.
        </p>
        <div className="space-y-2">
          {SCHEDULE_LEVELS.map(opt => (
            <label
              key={opt.id}
              className={`flex items-start gap-3 px-3 py-2 rounded border cursor-pointer transition-colors ${
                scheduledTasks === opt.id
                  ? 'border-loxia-500 bg-loxia-50/40 dark:bg-loxia-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="platformcontrol-scheduledTasks"
                value={opt.id}
                checked={scheduledTasks === opt.id}
                disabled={disabled}
                onChange={() => set({ scheduledTasks: opt.id })}
                className="mt-0.5"
                data-testid={`scheduledTasks-${opt.id}`}
              />
              <div className="flex-1">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {opt.title}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {opt.body}
                </div>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* ── Agents (CRUD) ───────────────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
          Agents
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Lets the agent create / configure / delete other agents. Hard rules always apply
          — no self-modify, no ancestor-modify — and child permissions are clamped so an
          agent cannot grant another agent more privilege than it has itself.
        </p>
        <div className="space-y-2">
          {AGENT_LEVELS.map(opt => (
            <label
              key={opt.id}
              className={`flex items-start gap-3 px-3 py-2 rounded border cursor-pointer transition-colors ${
                agentsLevel === opt.id
                  ? 'border-loxia-500 bg-loxia-50/40 dark:bg-loxia-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="platformcontrol-agents"
                value={opt.id}
                checked={agentsLevel === opt.id}
                disabled={disabled}
                onChange={() => set({ agents: opt.id })}
                className="mt-0.5"
                data-testid={`agents-${opt.id}`}
              />
              <div className="flex-1">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {opt.title}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {opt.body}
                </div>
              </div>
            </label>
          ))}
        </div>
        {/* Per-creator quota */}
        {agentsLevel !== 'disabled' && (
          <div className="mt-3 px-3 py-2 rounded bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
            <label className="flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-300">
              <span className="font-medium">Max agents this agent can create:</span>
              <input
                type="number"
                min="0"
                value={maxAgentsCreated}
                disabled={disabled}
                placeholder="unlimited"
                onChange={(e) => {
                  const v = e.target.value;
                  set({ maxAgentsCreated: v === '' ? null : Number(v) });
                }}
                className="w-24 px-2 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                data-testid="agents-maxAgentsCreated"
              />
              <span className="text-gray-400">(leave empty for unlimited)</span>
            </label>
          </div>
        )}
      </section>

      {/* ── Teams (multi-select scope) ──────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
          Teams
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Multi-select scope — which teams this agent can act on. With no boxes checked,
          team management is disabled. Leaving a team you're a member of is always
          permitted within scope.
        </p>
        <div className="space-y-2">
          {TEAM_SCOPE_OPTIONS.map(opt => (
            <label
              key={opt.id}
              className={`flex items-start gap-3 px-3 py-2 rounded border cursor-pointer transition-colors ${
                teams[opt.id]
                  ? 'border-loxia-500 bg-loxia-50/40 dark:bg-loxia-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input
                type="checkbox"
                checked={!!teams[opt.id]}
                disabled={disabled}
                onChange={(e) => set({ teams: { ...teams, [opt.id]: e.target.checked } })}
                className="mt-0.5"
                data-testid={`teams-${opt.id}`}
              />
              <div className="flex-1">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {opt.title}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {opt.body}
                </div>
              </div>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

export default PlatformControlConfigurator;
