/**
 * PlatformControlRenderer — visualization for the platformcontrol tool.
 *
 * The tool's actions all revolve around scheduled tasks today, so the
 * visualization is built around a "flight plan" metaphor: each schedule
 * is an event on the agent's future timeline, with cron expressions
 * decoded into human-friendly cadences and next-run countdowns rendered
 * relative to wall-clock time.
 *
 * Sub-views by action:
 *   - list-schedules        → 24h time-strip with marker per upcoming run +
 *                             schedule cards stacked below
 *   - get-schedule          → single full schedule card
 *   - create/update         → "Schedule armed" card with countdown
 *   - schedule-self-resume  → distinctive "Self-resume armed" card with a
 *                             prominent runAt countdown — this is the use
 *                             case the tool was designed for
 *   - toggle                → minimal flip indicator
 *   - delete                → minimal removed banner
 *   - trigger               → "Fired now" pulse
 *   - list-presets          → preset chip cloud
 *   - list-capabilities     → permission-level shield card
 *
 * Failure / disabled / unknown shapes fall through to a compact error row.
 *
 * Design choices:
 *   - One file: keeps everything in this renderer's scope discoverable.
 *   - Cron decoder is local + best-effort: recognizes the backend presets
 *     and a handful of common shapes; falls back to the raw expression.
 *   - Time strip is purely SVG, no charting lib — small enough to inline.
 *   - Countdowns auto-update every 30 s (cheap; one effect per renderer).
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
  ClockIcon,
  CalendarDaysIcon,
  BoltIcon,
  PlusCircleIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowPathIcon,
  PowerIcon,
  ListBulletIcon,
  ShieldCheckIcon,
  LockClosedIcon,
  UserCircleIcon,
  GlobeAltIcon,
  ArrowUturnLeftIcon,
  Squares2X2Icon,
  CommandLineIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { extractResult } from './usePersistedState';

// ── helpers ──────────────────────────────────────────────────────────

const PRESET_HUMAN = {
  '* * * * *':       'Every minute',
  '*/5 * * * *':     'Every 5 minutes',
  '*/15 * * * *':    'Every 15 minutes',
  '*/30 * * * *':    'Every 30 minutes',
  '0 * * * *':       'Every hour, on the hour',
  '0 */6 * * *':     'Every 6 hours',
  '0 */12 * * *':    'Every 12 hours',
  '0 9 * * *':       'Daily at 9:00 AM',
  '0 8 * * *':       'Daily at 8:00 AM',
  '0 18 * * *':      'Daily at 6:00 PM',
  '0 9 * * 1-5':     'Weekdays at 9:00 AM',
  '0 10 * * 0,6':    'Weekends at 10:00 AM',
  '0 9 * * 1':       'Mondays at 9:00 AM',
  '0 9 1 * *':       'Monthly on the 1st at 9:00 AM',
};

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/**
 * Best-effort cron → English. Returns the raw cron if we can't
 * confidently decode it. Local function: no external dependency,
 * tuned to the presets the backend ships.
 */
function decodeCron(cron) {
  if (typeof cron !== 'string') return '';
  const trimmed = cron.trim();
  if (PRESET_HUMAN[trimmed]) return PRESET_HUMAN[trimmed];

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return trimmed;
  const [m, h, dom, mo, dow] = parts;

  const isExact = (s) => /^\d+$/.test(s);
  const isAny = (s) => s === '*';

  // One-shot pattern: "M H D Mo *" with all four time fields exact
  // (this is what schedule-self-resume produces).
  if (isExact(m) && isExact(h) && isExact(dom) && isExact(mo) && isAny(dow)) {
    return `Once at ${pad2(h)}:${pad2(m)} on ${pad2(dom)}/${pad2(mo)}`;
  }

  // Daily at H:M
  if (isExact(m) && isExact(h) && isAny(dom) && isAny(mo) && isAny(dow)) {
    return `Daily at ${pad2(h)}:${pad2(m)}`;
  }

  // Specific day(s) of week at H:M
  if (isExact(m) && isExact(h) && isAny(dom) && isAny(mo) && !isAny(dow)) {
    return `${dowList(dow)} at ${pad2(h)}:${pad2(m)}`;
  }

  // Every N minutes
  const everyNMin = m.match(/^\*\/(\d+)$/);
  if (everyNMin && isAny(h) && isAny(dom) && isAny(mo) && isAny(dow)) {
    return `Every ${everyNMin[1]} minutes`;
  }

  return trimmed;
}
function pad2(s) { return String(s).padStart(2, '0'); }
function dowList(spec) {
  // Accepts "1-5", "0,6", "1", etc.
  const out = [];
  for (const part of spec.split(',')) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a; i <= b; i++) out.push(DAY_NAMES[i % 7]);
    } else {
      out.push(DAY_NAMES[Number(part) % 7]);
    }
  }
  return out.join('/');
}

function relativeFromNow(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const ms = t - Date.now();
  const abs = Math.abs(ms);
  const sec = Math.round(abs / 1000);
  if (sec < 60)            return ms > 0 ? `in ${sec}s`            : `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60)            return ms > 0 ? `in ${min}m`            : `${min}m ago`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24)             return ms > 0 ? `in ${hr}h ${remMin}m`  : `${hr}h ${remMin}m ago`;
  const days = Math.floor(hr / 24);
  const remHr = hr % 24;
  return ms > 0 ? `in ${days}d ${remHr}h` : `${days}d ${remHr}h ago`;
}

function formatAbsolute(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Re-render every ~30s so the relative countdowns refresh.
 * One effect per renderer instance — cheap.
 */
function useTickEvery(ms) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

// ── reusable bits ────────────────────────────────────────────────────

function PermissionChip({ scope }) {
  // scope: 'disabled' | 'own' | 'all' | undefined (during loading)
  if (!scope) return null;
  const map = {
    disabled: { Icon: LockClosedIcon, label: 'disabled', cls: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
    own:      { Icon: UserCircleIcon, label: 'own only',  cls: 'bg-loxia-100 text-loxia-700 dark:bg-loxia-900/30 dark:text-loxia-300' },
    all:      { Icon: GlobeAltIcon,   label: 'all agents', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  };
  const cfg = map[scope];
  if (!cfg) return null;
  const { Icon } = cfg;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${cfg.cls}`}
      title={`Permission scope: ${cfg.label}`}
      data-testid="pc-scope-chip"
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function TargetChip({ targetId, isSelf }) {
  if (!targetId) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${
        isSelf
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      }`}
      title={isSelf ? 'Targets THIS agent' : `Targets agent: ${targetId}`}
    >
      {isSelf ? '⟲ self' : `→ ${targetId.length > 20 ? targetId.slice(0, 17) + '…' : targetId}`}
    </span>
  );
}

function ScheduleCard({ schedule, currentAgentId, dense = false }) {
  if (!schedule) return null;
  const isSelf = schedule.targetType === 'agent' && schedule.targetId === currentAgentId;
  const human = decodeCron(schedule.cronExpression);
  const next = relativeFromNow(schedule.nextRun);
  const enabled = schedule.enabled !== false;

  return (
    <div
      className={`rounded-lg border ${enabled ? 'border-loxia-200 dark:border-loxia-800' : 'border-gray-200 dark:border-gray-700'} bg-white dark:bg-gray-900 ${dense ? 'p-2' : 'p-3'}`}
      data-testid="pc-schedule-card"
    >
      <div className="flex items-start gap-2">
        <CalendarDaysIcon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${enabled ? 'text-loxia-500' : 'text-gray-400'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-sm font-medium truncate ${enabled ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 line-through'}`}>
              {schedule.name || schedule.id}
            </span>
            {!enabled && <span className="text-[10px] text-gray-400 italic">paused</span>}
            {schedule.runOnce && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">one-shot</span>}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
            <span className="font-mono">{schedule.cronExpression}</span>
            <span className="ml-1">· {human}</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <TargetChip targetId={schedule.targetId} isSelf={isSelf} />
            {schedule.nextRun && enabled && (
              <span className="text-[10px] text-gray-500 dark:text-gray-400" title={schedule.nextRun}>
                next: <span className="font-medium text-gray-700 dark:text-gray-200">{next}</span> · {formatAbsolute(schedule.nextRun)}
              </span>
            )}
            {typeof schedule.runCount === 'number' && schedule.runCount > 0 && (
              <span className="text-[10px] text-gray-400">↻ {schedule.runCount}</span>
            )}
          </div>
          {!dense && schedule.prompt && (
            <details className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-400">
              <summary className="cursor-pointer select-none">prompt</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono p-2 bg-gray-50 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-700">{schedule.prompt}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Horizontal 24h time strip showing where each schedule's nextRun falls
 * relative to NOW. Pure SVG, ~24 lines. Markers cluster nicely; hover
 * surfaces schedule names.
 */
function TimeStrip({ schedules, currentAgentId }) {
  const now = Date.now();
  const horizon = 24 * 60 * 60 * 1000;
  const events = (schedules || [])
    .filter(s => s && s.nextRun && s.enabled !== false)
    .map(s => {
      const t = Date.parse(s.nextRun);
      return Number.isNaN(t) ? null : { schedule: s, t, offset: t - now };
    })
    .filter(Boolean)
    .filter(e => e.offset >= 0 && e.offset <= horizon);

  if (events.length === 0) {
    return (
      <div className="text-[11px] text-gray-400 italic px-2 py-1">
        No upcoming runs in the next 24h.
      </div>
    );
  }

  // Hour ticks
  const hourTicks = Array.from({ length: 5 }, (_, i) => i * 6); // 0,6,12,18,24

  return (
    <div className="px-2 py-2 bg-gray-50 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-700" data-testid="pc-time-strip">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
        Next 24 hours · {events.length} upcoming run{events.length === 1 ? '' : 's'}
      </div>
      <svg viewBox="0 0 240 28" className="w-full h-7">
        {/* base line */}
        <line x1="0" y1="20" x2="240" y2="20" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />
        {/* hour ticks */}
        {hourTicks.map((h, i) => (
          <g key={h}>
            <line x1={i * 60} y1="18" x2={i * 60} y2="22" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" />
            <text x={i * 60} y="9" textAnchor="middle" fontSize="6" fill="currentColor" fillOpacity="0.5">+{h}h</text>
          </g>
        ))}
        {/* events */}
        {events.map((e, i) => {
          const x = (e.offset / horizon) * 240;
          const isSelf = e.schedule.targetType === 'agent' && e.schedule.targetId === currentAgentId;
          const fill = isSelf ? '#10b981' : '#6366f1';   // emerald / indigo
          return (
            <g key={e.schedule.id || i}>
              <circle cx={x} cy="20" r="3" fill={fill}>
                <title>
                  {(e.schedule.name || e.schedule.id) + ' — ' + relativeFromNow(e.schedule.nextRun) + ' (' + decodeCron(e.schedule.cronExpression) + ')'}
                </title>
              </circle>
              {e.schedule.runOnce && (
                <circle cx={x} cy="20" r="5" fill="none" stroke={fill} strokeOpacity="0.5" strokeWidth="1">
                  <title>One-shot</title>
                </circle>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── action header ────────────────────────────────────────────────────

const ACTION_VISUAL = {
  'list-schedules':       { Icon: ListBulletIcon,    label: 'Schedules',                 cls: 'text-indigo-600 dark:text-indigo-400' },
  'get-schedule':         { Icon: CalendarDaysIcon,  label: 'Schedule',                  cls: 'text-indigo-600 dark:text-indigo-400' },
  'create-schedule':      { Icon: PlusCircleIcon,    label: 'Schedule armed',            cls: 'text-emerald-600 dark:text-emerald-400' },
  'update-schedule':      { Icon: PencilSquareIcon,  label: 'Schedule updated',          cls: 'text-blue-600 dark:text-blue-400' },
  'delete-schedule':      { Icon: TrashIcon,         label: 'Schedule removed',          cls: 'text-rose-600 dark:text-rose-400' },
  'toggle-schedule':      { Icon: PowerIcon,         label: 'Schedule toggled',          cls: 'text-amber-600 dark:text-amber-400' },
  'trigger-schedule':     { Icon: BoltIcon,          label: 'Schedule fired',            cls: 'text-yellow-600 dark:text-yellow-400' },
  'list-presets':         { Icon: Squares2X2Icon,    label: 'Cron presets',              cls: 'text-gray-600 dark:text-gray-300' },
  'list-capabilities':    { Icon: ShieldCheckIcon,   label: 'Permission scope',          cls: 'text-gray-600 dark:text-gray-300' },
  'schedule-self-resume': { Icon: ArrowUturnLeftIcon,label: 'Self-resume armed',         cls: 'text-emerald-600 dark:text-emerald-400' },
  // Agents
  'list-agents':          { Icon: ListBulletIcon,    label: 'Agents',                    cls: 'text-indigo-600 dark:text-indigo-400' },
  'create-agent':         { Icon: PlusCircleIcon,    label: 'Agent created',             cls: 'text-emerald-600 dark:text-emerald-400' },
  'update-agent':         { Icon: PencilSquareIcon,  label: 'Agent reconfigured',        cls: 'text-blue-600 dark:text-blue-400' },
  'delete-agent':         { Icon: TrashIcon,         label: 'Agent deleted (cascaded)',  cls: 'text-rose-600 dark:text-rose-400' },
  // Teams
  'list-teams':           { Icon: ListBulletIcon,    label: 'Teams',                     cls: 'text-indigo-600 dark:text-indigo-400' },
  'create-team':          { Icon: PlusCircleIcon,    label: 'Team created',              cls: 'text-emerald-600 dark:text-emerald-400' },
  'update-team':          { Icon: PencilSquareIcon,  label: 'Team updated',              cls: 'text-blue-600 dark:text-blue-400' },
  'delete-team':          { Icon: TrashIcon,         label: 'Team deleted',              cls: 'text-rose-600 dark:text-rose-400' },
  'add-team-member':      { Icon: PlusCircleIcon,    label: 'Member added to team',      cls: 'text-emerald-600 dark:text-emerald-400' },
  'remove-team-member':   { Icon: ArrowUturnLeftIcon,label: 'Member removed from team',  cls: 'text-amber-600 dark:text-amber-400' },
  '_default':             { Icon: CommandLineIcon,   label: 'Platform control',          cls: 'text-gray-600 dark:text-gray-300' },
};

function ActionHeader({ action, scope }) {
  const v = ACTION_VISUAL[action] || ACTION_VISUAL._default;
  const { Icon } = v;
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800/50 dark:to-gray-900">
      <Icon className={`w-4 h-4 ${v.cls}`} />
      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{v.label}</span>
      <span className="text-[10px] text-gray-400 font-mono">platformcontrol</span>
      <div className="flex-1" />
      <PermissionChip scope={scope} />
    </div>
  );
}

// ── action-specific bodies ───────────────────────────────────────────

// ── Agent + team sub-views ───────────────────────────────────────────

function AgentCard({ agent, callerAgentId, dense = false }) {
  if (!agent) return null;
  const isSelf  = agent.id === callerAgentId;
  const isMine  = agent.createdBy === callerAgentId;
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ${dense ? 'p-2' : 'p-3'}`}
      data-testid="pc-agent-card"
    >
      <div className="flex items-start gap-2">
        <UserCircleIcon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isMine ? 'text-emerald-500' : 'text-gray-400'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {agent.name || agent.id}
            </span>
            {isSelf && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                this is you
              </span>
            )}
            {isMine && !isSelf && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                created by you
              </span>
            )}
            {agent.status && (
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{agent.status}</span>
            )}
          </div>
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 font-mono truncate">
            {agent.id}
          </div>
          {!dense && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[10px] text-gray-500 dark:text-gray-400">
              {agent.currentModel && <span>model: <span className="font-mono">{agent.currentModel}</span></span>}
              {Array.isArray(agent.capabilities) && agent.capabilities.length > 0 && (
                <span>· {agent.capabilities.length} tool{agent.capabilities.length === 1 ? '' : 's'}</span>
              )}
              {agent.createdBy && (
                <span title={`createdBy: ${agent.createdBy}`}>
                  · parent: <span className="font-mono">{agent.createdBy.slice(0, 18)}{agent.createdBy.length > 18 ? '…' : ''}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ListAgentsView({ result, callerAgentId }) {
  const agents = Array.isArray(result?.agents) ? result.agents : [];
  if (agents.length === 0) {
    return <div className="p-4 text-center text-xs text-gray-400 italic">No agents.</div>;
  }
  return (
    <div className="p-3 space-y-1.5" data-testid="pc-agent-list">
      {agents.map(a => <AgentCard key={a.id} agent={a} callerAgentId={callerAgentId} dense />)}
    </div>
  );
}

function SingleAgentView({ result, callerAgentId, label }) {
  const agent = result?.agent;
  if (!agent) return null;
  return (
    <div className="p-3 space-y-2">
      <AgentCard agent={agent} callerAgentId={callerAgentId} />
      {/* Privilege clamps surfaced from the tool result */}
      {Array.isArray(result?.clamps) && result.clamps.length > 0 && (
        <div className="px-3 py-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20" data-testid="pc-clamp-notice">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-1">
            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
            Permissions clamped (you cannot grant more than you have)
          </div>
          <ul className="text-[10px] text-amber-800 dark:text-amber-300 list-disc pl-4 space-y-0.5">
            {result.clamps.map((c, i) => (
              <li key={i}>
                <span className="font-mono">{c.key}</span>: {JSON.stringify(c.requested)} → {JSON.stringify(c.clampedTo)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {label && <div className="text-[11px] text-gray-500">{label}</div>}
    </div>
  );
}

function DeleteAgentView({ result }) {
  const r = result?.report || {};
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <TrashIcon className="w-4 h-4 text-rose-500" />
        <span className="text-gray-700 dark:text-gray-200">
          Removed agent <span className="font-mono">{result?.agentId}</span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]" data-testid="pc-cascade-report">
        <div className="px-2 py-1 rounded bg-gray-50 dark:bg-gray-800/50">
          <span className="text-gray-500">Schedules deleted:</span>{' '}
          <span className="font-mono">{r.schedulesDeleted ?? 0}</span>
        </div>
        <div className="px-2 py-1 rounded bg-gray-50 dark:bg-gray-800/50">
          <span className="text-gray-500">Memories cleaned:</span>{' '}
          <span className="font-mono">{r.memoriesCleaned ? 'yes' : 'no'}</span>
        </div>
        <div className="px-2 py-1 rounded bg-gray-50 dark:bg-gray-800/50 col-span-2">
          <span className="text-gray-500">Teams left:</span>{' '}
          <span className="font-mono">{Array.isArray(r.teamsLeft) ? r.teamsLeft.join(', ') || 'none' : 'none'}</span>
        </div>
      </div>
      {Array.isArray(r.errors) && r.errors.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-rose-600">{r.errors.length} step error{r.errors.length === 1 ? '' : 's'}</summary>
          <ul className="mt-1 list-disc pl-4 text-rose-700 dark:text-rose-400">
            {r.errors.map((e, i) => <li key={i}><span className="font-mono">{e.step}</span>: {e.error}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function TeamCard({ team, callerAgentId, dense = false }) {
  if (!team) return null;
  const isOwner   = team.createdBy === callerAgentId;
  const isMember  = Array.isArray(team.memberAgentIds) && team.memberAgentIds.includes(callerAgentId);
  const memberCount = Array.isArray(team.memberAgentIds) ? team.memberAgentIds.length : 0;
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ${dense ? 'p-2' : 'p-3'}`}
      data-testid="pc-team-card"
    >
      <div className="flex items-start gap-2">
        <Squares2X2Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: team.color || '#6366f1' }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{team.name || team.id}</span>
            {isOwner && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                you own this
              </span>
            )}
            {isMember && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-loxia-100 text-loxia-700 dark:bg-loxia-900/30 dark:text-loxia-300">
                you're a member
              </span>
            )}
          </div>
          {team.description && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">{team.description}</div>
          )}
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 font-mono truncate">
            {team.id} · {memberCount} member{memberCount === 1 ? '' : 's'}
          </div>
        </div>
      </div>
    </div>
  );
}

function ListTeamsView({ result, callerAgentId }) {
  const teams = Array.isArray(result?.teams) ? result.teams : [];
  if (teams.length === 0) {
    return <div className="p-4 text-center text-xs text-gray-400 italic">No teams in scope.</div>;
  }
  return (
    <div className="p-3 space-y-1.5" data-testid="pc-team-list">
      {teams.map(t => <TeamCard key={t.id} team={t} callerAgentId={callerAgentId} dense />)}
    </div>
  );
}

function SingleTeamView({ result, callerAgentId }) {
  return (
    <div className="p-3">
      <TeamCard team={result?.team} callerAgentId={callerAgentId} />
    </div>
  );
}

function TeamMemberChangeView({ result, callerAgentId, action }) {
  const team = result?.team;
  const agentId = result?.agentId;
  const isSelf = agentId === callerAgentId;
  const verb = action === 'remove-team-member'
    ? (isSelf ? 'left team' : 'removed from team')
    : (isSelf ? 'joined team' : 'added to team');
  return (
    <div className="p-3 space-y-2">
      <div className="text-sm text-gray-700 dark:text-gray-200">
        <span className="font-mono">{agentId}</span> {verb}{' '}
        <span className="font-mono">{team?.id}</span>
      </div>
      {team && <TeamCard team={team} callerAgentId={callerAgentId} dense />}
    </div>
  );
}

function CapabilitiesView({ result }) {
  // Extended view — shows all three feature slices when present.
  const cap = result?.capabilities || {};
  const sched  = cap.scheduledTasks;
  const agents = cap.agents;
  const teams  = cap.teams;
  return (
    <div className="p-4 space-y-3" data-testid="pc-capabilities">
      {sched && <FeatureLevelRow title="Scheduled tasks" level={sched.level} notes={sched.notes} />}
      {agents && (
        <FeatureLevelRow
          title="Agents"
          level={agents.level}
          notes={agents.notes}
          extra={agents.maxAgentsCreated != null ? `quota: ${agents.maxAgentsCreated}` : 'quota: unlimited'}
        />
      )}
      {teams && (
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
            <Squares2X2Icon className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Teams</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {teams.disabled ? 'disabled' : (
                <>
                  scope:{' '}
                  {teams.scope?.all && <span className="font-mono mr-1">all</span>}
                  {teams.scope?.member && <span className="font-mono mr-1">member</span>}
                  {teams.scope?.ownedByMe && <span className="font-mono mr-1">ownedByMe</span>}
                </>
              )}
            </div>
            {Array.isArray(teams.notes) && teams.notes.length > 0 && (
              <ul className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 list-disc pl-4 space-y-0.5">
                {teams.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FeatureLevelRow({ title, level, notes, extra }) {
  // Existing single-level shape used by both scheduledTasks and agents.
  if (!level) return null;
  const Icon = level === 'all' ? GlobeAltIcon : level === 'disabled' ? LockClosedIcon : UserCircleIcon;
  const tone = level === 'all' ? 'amber' : level === 'disabled' ? 'gray' : 'loxia';
  return (
    <div className="flex items-start gap-3">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center bg-${tone}-100 dark:bg-${tone}-900/30`}>
        <Icon className={`w-5 h-5 text-${tone}-600 dark:text-${tone}-400`} />
      </div>
      <div className="flex-1">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          level: <span className="font-mono">{level}</span>
          {extra && <span className="ml-2">· {extra}</span>}
        </div>
        {Array.isArray(notes) && notes.length > 0 && (
          <ul className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 list-disc pl-4 space-y-0.5">
            {notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

function ListSchedulesView({ result, currentAgentId }) {
  const schedules = Array.isArray(result?.schedules) ? result.schedules : [];
  if (schedules.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-gray-400 italic">
        No schedules in scope.
      </div>
    );
  }
  // Sort by nextRun ascending; disabled last.
  const sorted = [...schedules].sort((a, b) => {
    if ((a.enabled !== false) !== (b.enabled !== false)) return a.enabled !== false ? -1 : 1;
    const at = a.nextRun ? Date.parse(a.nextRun) : Infinity;
    const bt = b.nextRun ? Date.parse(b.nextRun) : Infinity;
    return at - bt;
  });
  return (
    <div className="p-3 space-y-2">
      <TimeStrip schedules={sorted} currentAgentId={currentAgentId} />
      <div className="space-y-1.5">
        {sorted.map(s => <ScheduleCard key={s.id} schedule={s} currentAgentId={currentAgentId} dense />)}
      </div>
    </div>
  );
}

function SingleScheduleView({ result, currentAgentId }) {
  const schedule = result?.schedule;
  if (!schedule) return null;
  return (
    <div className="p-3">
      <ScheduleCard schedule={schedule} currentAgentId={currentAgentId} />
    </div>
  );
}

function SelfResumeView({ result, currentAgentId }) {
  const schedule = result?.schedule;
  const runAt = result?.runAt || schedule?.nextRun;
  const cron = result?.cronExpression || schedule?.cronExpression;
  return (
    <div className="p-4 bg-gradient-to-br from-emerald-50/50 to-white dark:from-emerald-900/10 dark:to-gray-900">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-emerald-100 dark:bg-emerald-900/30 relative">
          <ArrowUturnLeftIcon className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white dark:bg-gray-900 flex items-center justify-center">
            <ClockIcon className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            I'll come back to this {relativeFromNow(runAt) || 'shortly'}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {formatAbsolute(runAt)} · cron <span className="font-mono">{cron}</span>
          </div>
        </div>
      </div>
      {schedule && <ScheduleCard schedule={schedule} currentAgentId={currentAgentId} />}
    </div>
  );
}

function PresetsView({ result }) {
  const presets = Array.isArray(result?.presets) ? result.presets : [];
  return (
    <div className="p-3">
      <div className="flex flex-wrap gap-1.5">
        {presets.map(p => (
          <span key={p}
            className="text-[11px] px-2 py-0.5 rounded font-mono bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            title={PRESET_HUMAN[(/* allow lookup by name OR cron */ p)] || ''}>
            {p}
          </span>
        ))}
      </div>
      {result?.note && (
        <div className="text-[11px] text-gray-500 mt-2">{result.note}</div>
      )}
    </div>
  );
}

function ToggleView({ result }) {
  const { scheduleId, enabled } = result || {};
  return (
    <div className="p-3 flex items-center gap-2 text-sm">
      <PowerIcon className={`w-4 h-4 ${enabled ? 'text-emerald-600' : 'text-gray-400'}`} />
      <span className="text-gray-700 dark:text-gray-200">
        Schedule <span className="font-mono">{scheduleId}</span> is now{' '}
        <span className={enabled ? 'text-emerald-700 dark:text-emerald-300 font-medium' : 'text-gray-500'}>
          {enabled ? 'enabled' : 'disabled'}
        </span>
      </span>
    </div>
  );
}

function DeleteView({ result }) {
  return (
    <div className="p-3 flex items-center gap-2 text-sm">
      <TrashIcon className="w-4 h-4 text-rose-500" />
      <span className="text-gray-600 dark:text-gray-300">
        Removed schedule <span className="font-mono">{result?.scheduleId}</span>
      </span>
    </div>
  );
}

function TriggerView({ result }) {
  return (
    <div className="p-3 flex items-center gap-2 text-sm">
      <BoltIcon className="w-4 h-4 text-yellow-500 animate-pulse" />
      <span className="text-gray-700 dark:text-gray-200">
        Fired schedule <span className="font-mono">{result?.scheduleId}</span> ad-hoc
      </span>
    </div>
  );
}

function ErrorView({ error, disabled }) {
  return (
    <div className="p-3 flex items-start gap-2 text-xs">
      <ExclamationTriangleIcon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${disabled ? 'text-gray-400' : 'text-rose-500'}`} />
      <div className={`${disabled ? 'text-gray-500' : 'text-rose-700 dark:text-rose-300'}`}>
        {error || 'Action failed'}
      </div>
    </div>
  );
}

// ── main renderer ────────────────────────────────────────────────────

function PlatformControlRenderer({ parsedData, agentId: propAgentId }) {
  // 30-second tick keeps relative-time labels fresh.
  useTickEvery(30_000);

  const action = parsedData?.action || parsedData?.parameters?.action;
  const { hasResults, result, error } = useMemo(() => extractResult(parsedData), [parsedData]);

  // The agent-id used to label "self" targets. For chat-rendered messages,
  // parsedData carries the originating agentId via the top-level prop.
  const currentAgentId = propAgentId || result?.agent?.id || null;

  // Pending (no result yet): show a "Awaiting…" stub. Same skeleton shape
  // so the layout doesn't jump when the result arrives.
  if (!hasResults) {
    return (
      <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900" data-testid="pc-pending">
        <ActionHeader action={action} />
        <div className="p-3 text-xs text-gray-400 italic">Awaiting result…</div>
      </div>
    );
  }

  // Result arrived. Determine the scope chip to show: from list-schedules
  // (result.scope) or list-capabilities (result.capabilities.scheduledTasks.level).
  const scope = result?.scope
              || result?.capabilities?.scheduledTasks?.level
              || null;

  // Errors: a single compact body with the message. Don't lose the scope
  // chip — it's actionable info ("oh I'm 'disabled', let me ask the user
  // to enable").
  if (result?.success === false || error) {
    return (
      <div className="my-2 rounded-lg border border-rose-200 dark:border-rose-800 overflow-hidden bg-white dark:bg-gray-900" data-testid="pc-error">
        <ActionHeader action={action} scope={scope} />
        <ErrorView error={error || result?.error} disabled={!!result?.disabled} />
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900" data-testid="pc-renderer">
      <ActionHeader action={action} scope={scope} />
      {action === 'list-schedules'        && <ListSchedulesView result={result} currentAgentId={currentAgentId} />}
      {action === 'get-schedule'          && <SingleScheduleView result={result} currentAgentId={currentAgentId} />}
      {(action === 'create-schedule'
        || action === 'update-schedule')  && <SingleScheduleView result={result} currentAgentId={currentAgentId} />}
      {action === 'delete-schedule'       && <DeleteView result={result} />}
      {action === 'toggle-schedule'       && <ToggleView result={result} />}
      {action === 'trigger-schedule'      && <TriggerView result={result} />}
      {action === 'list-presets'          && <PresetsView result={result} />}
      {action === 'list-capabilities'     && <CapabilitiesView result={result} />}
      {action === 'schedule-self-resume'  && <SelfResumeView result={result} currentAgentId={currentAgentId} />}
      {/* Agents */}
      {action === 'list-agents'           && <ListAgentsView result={result} callerAgentId={currentAgentId} />}
      {action === 'create-agent'          && <SingleAgentView result={result} callerAgentId={currentAgentId} />}
      {action === 'update-agent'          && <SingleAgentView result={result} callerAgentId={currentAgentId} />}
      {action === 'delete-agent'          && <DeleteAgentView result={result} />}
      {/* Teams */}
      {action === 'list-teams'            && <ListTeamsView result={result} callerAgentId={currentAgentId} />}
      {action === 'create-team'           && <SingleTeamView result={result} callerAgentId={currentAgentId} />}
      {action === 'update-team'           && <SingleTeamView result={result} callerAgentId={currentAgentId} />}
      {action === 'delete-team'           && (
        <div className="p-3 flex items-center gap-2 text-sm" data-testid="pc-team-deleted">
          <TrashIcon className="w-4 h-4 text-rose-500" />
          <span className="text-gray-600 dark:text-gray-300">
            Removed team <span className="font-mono">{result?.teamId}</span>
          </span>
        </div>
      )}
      {(action === 'add-team-member'
        || action === 'remove-team-member') && (
        <TeamMemberChangeView result={result} callerAgentId={currentAgentId} action={action} />
      )}
      {/* Unknown action: dump the raw result as a small JSON details block.
          Keeps the renderer non-fatal if the backend grows new actions
          before this file does. */}
      {!ACTION_VISUAL[action] && (
        <details className="p-3 text-xs">
          <summary className="cursor-pointer text-gray-500">Raw result</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono p-2 bg-gray-50 dark:bg-gray-800/50 rounded">{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export default PlatformControlRenderer;
export { decodeCron, relativeFromNow };
