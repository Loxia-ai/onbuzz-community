import React, { useState, useEffect, useCallback } from 'react';
import {
  ClockIcon,
  PlusIcon,
  TrashIcon,
  PencilIcon,
  PlayIcon,
  PauseIcon,
  XMarkIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { useAppStore } from '../stores/appStore.js';
import { api } from '../services/api.js';
import AgentSelector from './Flows/panels/AgentSelector.jsx';
import toast from 'react-hot-toast';

const PRESET_LABELS = {
  'every-minute': 'Every minute',
  'every-5-minutes': 'Every 5 minutes',
  'every-15-minutes': 'Every 15 minutes',
  'every-30-minutes': 'Every 30 minutes',
  'every-hour': 'Every hour',
  'every-6-hours': 'Every 6 hours',
  'every-12-hours': 'Every 12 hours',
  'daily': 'Daily (9 AM)',
  'daily-morning': 'Daily (8 AM)',
  'daily-evening': 'Daily (6 PM)',
  'weekdays': 'Weekdays (9 AM)',
  'weekends': 'Weekends (10 AM)',
  'weekly-monday': 'Weekly (Monday 9 AM)',
  'monthly': 'Monthly (1st, 9 AM)'
};

function SchedulesPage() {
  const { agents } = useAppStore();
  const [schedules, setSchedules] = useState([]);
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);

  const loadSchedules = useCallback(async () => {
    try {
      const result = await api.getSchedules();
      if (result.success) {
        setSchedules(result.schedules || []);
      }
    } catch (err) {
      console.error('Failed to load schedules:', err);
    }
  }, []);

  const loadFlows = useCallback(async () => {
    try {
      const result = await api.getFlows();
      if (result.success) {
        setFlows(result.data || []);
      }
    } catch (err) {
      console.error('Failed to load flows:', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([loadSchedules(), loadFlows()]).finally(() => setLoading(false));
  }, [loadSchedules, loadFlows]);

  // Refresh every 30s
  useEffect(() => {
    const interval = setInterval(loadSchedules, 30000);
    return () => clearInterval(interval);
  }, [loadSchedules]);

  const handleToggle = async (id) => {
    try {
      const result = await api.toggleSchedule(id);
      if (result.success) {
        setSchedules(prev => prev.map(s => s.id === id ? result.schedule : s));
      }
    } catch (err) {
      toast.error('Failed to toggle schedule');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this scheduled task?')) return;
    try {
      await api.deleteSchedule(id);
      setSchedules(prev => prev.filter(s => s.id !== id));
      toast.success('Schedule deleted');
    } catch (err) {
      toast.error('Failed to delete schedule');
    }
  };

  const handleSave = async (config) => {
    try {
      if (editingSchedule) {
        const result = await api.updateSchedule(editingSchedule.id, config);
        if (result.success) {
          setSchedules(prev => prev.map(s => s.id === editingSchedule.id ? result.schedule : s));
          toast.success('Schedule updated');
        }
      } else {
        const result = await api.createSchedule(config);
        if (result.success) {
          setSchedules(prev => [result.schedule, ...prev]);
          toast.success('Schedule created');
        }
      }
      setShowCreateModal(false);
      setEditingSchedule(null);
    } catch (err) {
      toast.error(err.message || 'Failed to save schedule');
    }
  };

  const getTargetName = (schedule) => {
    if (schedule.targetType === 'agent') {
      const agent = agents.find(a => a?.id === schedule.targetId);
      return agent?.name || schedule.targetId;
    }
    const flow = flows.find(f => f?.id === schedule.targetId);
    return flow?.name || schedule.targetId;
  };

  const formatNextRun = (nextRun) => {
    if (!nextRun) return 'N/A';
    const d = new Date(nextRun);
    const now = new Date();
    const diffMs = d - now;

    if (diffMs < 0) return 'Overdue';
    if (diffMs < 60000) return 'Less than a minute';
    if (diffMs < 3600000) return `${Math.round(diffMs / 60000)} min`;
    if (diffMs < 86400000) return `${Math.round(diffMs / 3600000)} hours`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <ArrowPathIcon className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ClockIcon className="w-7 h-7" />
            Scheduled Tasks
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Automate recurring prompts to agents or flow pipelines
          </p>
        </div>
        <button
          onClick={() => { setEditingSchedule(null); setShowCreateModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-loxia-600 text-white rounded-lg hover:bg-loxia-700 transition-colors"
        >
          <PlusIcon className="w-5 h-5" />
          New Schedule
        </button>
      </div>

      {/* Empty state */}
      {schedules.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <ClockIcon className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No scheduled tasks yet</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
            Create a schedule to automatically push prompts to your agents or execute flow pipelines on a recurring basis.
          </p>
          <button
            onClick={() => { setEditingSchedule(null); setShowCreateModal(true); }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-loxia-600 text-white rounded-lg hover:bg-loxia-700 transition-colors"
          >
            <PlusIcon className="w-5 h-5" />
            Create your first schedule
          </button>
        </div>
      )}

      {/* Schedule list */}
      {schedules.length > 0 && (
        <div className="space-y-3">
          {schedules.map(schedule => (
            <div
              key={schedule.id}
              className={`bg-white dark:bg-gray-800 rounded-xl border p-4 transition-all ${
                schedule.enabled
                  ? 'border-gray-200 dark:border-gray-700'
                  : 'border-gray-200 dark:border-gray-700 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
                      {schedule.name}
                    </h3>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      schedule.enabled
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                    }`}>
                      {schedule.enabled ? 'Active' : 'Paused'}
                    </span>
                    {schedule.lastRunStatus === 'error' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        <ExclamationTriangleIcon className="w-3 h-3" />
                        Last run failed
                      </span>
                    )}
                  </div>

                  {schedule.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{schedule.description}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1">
                      <span className="font-medium">Target:</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                        schedule.targetType === 'agent'
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                      }`}>
                        {schedule.targetType === 'agent' ? 'Agent' : 'Flow'}
                      </span>
                      {getTargetName(schedule)}
                    </span>

                    <span>
                      <span className="font-medium">Cron:</span>{' '}
                      <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">
                        {schedule.cronPreset ? PRESET_LABELS[schedule.cronPreset] || schedule.cronPreset : schedule.cronExpression}
                      </code>
                    </span>

                    {schedule.enabled && schedule.nextRun && (
                      <span>
                        <span className="font-medium">Next:</span> {formatNextRun(schedule.nextRun)}
                      </span>
                    )}

                    {schedule.lastRun && (
                      <span>
                        <span className="font-medium">Last:</span>{' '}
                        {new Date(schedule.lastRun).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}

                    <span>
                      <span className="font-medium">Runs:</span> {schedule.runCount}
                    </span>
                  </div>

                  <div className="mt-2 text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/50 rounded px-2 py-1 line-clamp-2">
                    {schedule.prompt}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                  <button
                    onClick={() => handleToggle(schedule.id)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title={schedule.enabled ? 'Pause' : 'Resume'}
                  >
                    {schedule.enabled ? (
                      <PauseIcon className="w-4 h-4 text-gray-500" />
                    ) : (
                      <PlayIcon className="w-4 h-4 text-green-500" />
                    )}
                  </button>
                  <button
                    onClick={() => { setEditingSchedule(schedule); setShowCreateModal(true); }}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="Edit"
                  >
                    <PencilIcon className="w-4 h-4 text-gray-500" />
                  </button>
                  <button
                    onClick={() => handleDelete(schedule.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Delete"
                  >
                    <TrashIcon className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <ScheduleFormModal
          schedule={editingSchedule}
          flows={flows}
          onSave={handleSave}
          onClose={() => { setShowCreateModal(false); setEditingSchedule(null); }}
        />
      )}
    </div>
  );
}

// ========================
// Helpers & constants
// ========================

const FREQUENCY_OPTIONS = [
  { value: 'once', label: 'Once', plural: 'once' },
  { value: 'minute', label: 'Minute', plural: 'minutes' },
  { value: 'hour', label: 'Hour', plural: 'hours' },
  { value: 'day', label: 'Day', plural: 'days' },
  { value: 'week', label: 'Week', plural: 'weeks' },
  { value: 'month', label: 'Month', plural: 'months' },
];

const DAY_LABELS = [
  { key: 0, short: 'S', full: 'Sun' },
  { key: 1, short: 'M', full: 'Mon' },
  { key: 2, short: 'T', full: 'Tue' },
  { key: 3, short: 'W', full: 'Wed' },
  { key: 4, short: 'T', full: 'Thu' },
  { key: 5, short: 'F', full: 'Fri' },
  { key: 6, short: 'S', full: 'Sat' },
];

const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

const END_MODE_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: 'date', label: 'On date' },
  { value: 'count', label: 'After' },
];

// Convert calendar-style recurrence to cron expression
function recurrenceToCron({ frequency, interval, days, hour, minute, monthDay }) {
  const m = minute ?? 0;
  const h = hour ?? 9;

  switch (frequency) {
    case 'once':
      return `${m} ${h} * * *`; // cron runs once via runOnce flag
    case 'minute':
      return interval === 1 ? '* * * * *' : `*/${interval} * * * *`;
    case 'hour':
      return interval === 1 ? `${m} * * * *` : `${m} */${interval} * * *`;
    case 'day':
      return interval === 1 ? `${m} ${h} * * *` : `${m} ${h} */${interval} * *`;
    case 'week': {
      const dowStr = days.length > 0 ? days.sort().join(',') : '*';
      return `${m} ${h} * * ${dowStr}`;
    }
    case 'month':
      return interval === 1
        ? `${m} ${h} ${monthDay || 1} * *`
        : `${m} ${h} ${monthDay || 1} */${interval} *`;
    default:
      return `${m} ${h} * * *`;
  }
}

// Parse cron expression into calendar-style recurrence (best effort)
function cronToRecurrence(cronExpr) {
  const defaults = { frequency: 'day', interval: 1, days: [], hour: 9, minute: 0, monthDay: 1 };
  if (!cronExpr || typeof cronExpr !== 'string') return defaults;
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return defaults;
  const [minP, hourP, domP, , dowP] = parts;
  if (minP.startsWith('*/') && hourP === '*' && domP === '*')
    return { ...defaults, frequency: 'minute', interval: parseInt(minP.slice(2)) || 1 };
  if (minP === '*' && hourP === '*')
    return { ...defaults, frequency: 'minute', interval: 1 };
  const minute = parseInt(minP) || 0;
  if (hourP.startsWith('*/') && domP === '*')
    return { ...defaults, frequency: 'hour', interval: parseInt(hourP.slice(2)) || 1, minute };
  if (hourP === '*' && domP === '*' && dowP === '*')
    return { ...defaults, frequency: 'hour', interval: 1, minute };
  const hour = parseInt(hourP) || 9;
  if (dowP !== '*' && domP === '*') {
    const days = dowP.split(',').flatMap(p => {
      if (p.includes('-')) { const [lo, hi] = p.split('-').map(Number); return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i); }
      return [parseInt(p)];
    }).filter(d => !isNaN(d));
    return { ...defaults, frequency: 'week', interval: 1, days, hour, minute };
  }
  if (domP !== '*' && !domP.startsWith('*/'))
    return { ...defaults, frequency: 'month', interval: 1, monthDay: parseInt(domP) || 1, hour, minute };
  if (domP.startsWith('*/'))
    return { ...defaults, frequency: 'day', interval: parseInt(domP.slice(2)) || 1, hour, minute };
  return { ...defaults, frequency: 'day', interval: 1, hour, minute };
}

// Next N runs preview
function getNextRuns(cronExpr, count = 3) {
  if (!cronExpr || typeof cronExpr !== 'string') return [];
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return [];
  const [minP, hourP, domP, monP, dowP] = parts;
  const runs = [];
  const check = new Date();
  check.setSeconds(0, 0);
  check.setMinutes(check.getMinutes() + 1);
  for (let i = 0; i < 7 * 24 * 60 && runs.length < count; i++) {
    if (matchCron(minP, check.getMinutes()) && matchCron(hourP, check.getHours()) &&
        matchCron(domP, check.getDate()) && matchCron(monP, check.getMonth() + 1) &&
        matchCron(dowP, check.getDay())) {
      runs.push(new Date(check));
    }
    check.setMinutes(check.getMinutes() + 1);
  }
  return runs;
}

function matchCron(field, value) {
  if (field === '*') return true;
  if (field.startsWith('*/')) { const s = parseInt(field.slice(2)); return s > 0 && value % s === 0; }
  if (field.includes(',')) return field.split(',').some(v => matchCron(v, value));
  if (field.includes('-')) { const [lo, hi] = field.split('-').map(Number); return value >= lo && value <= hi; }
  return parseInt(field) === value;
}

function formatRunTime(date) {
  const diff = date - new Date();
  const t = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (diff < 3600000) return `in ${Math.round(diff / 60000)} min`;
  if (diff < 86400000) return `Today ${t}`;
  if (diff < 172800000) return `Tomorrow ${t}`;
  return `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()]} ${t}`;
}

function describeRecurrence({ frequency, interval, days, hour, minute, monthDay, endMode, endDate, maxRuns }) {
  const fmtTime = (h, m) => `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const timeStr = hour != null && !['minute'].includes(frequency) ? ` at ${fmtTime(hour, minute)}` : '';
  let desc;
  switch (frequency) {
    case 'once': desc = `Once${timeStr}`; break;
    case 'minute': desc = interval === 1 ? 'Every minute' : `Every ${interval} minutes`; break;
    case 'hour': desc = interval === 1 ? `Hourly at :${String(minute||0).padStart(2,'0')}` : `Every ${interval} hours`; break;
    case 'day': desc = interval === 1 ? `Daily${timeStr}` : `Every ${interval} days${timeStr}`; break;
    case 'week': {
      const d = (days||[]).map(i => DAY_LABELS[i]?.full).join(', ');
      desc = d ? `${interval > 1 ? `Every ${interval} weeks` : 'Weekly'} on ${d}${timeStr}` : `Weekly${timeStr}`;
      break;
    }
    case 'month': desc = `Monthly on the ${monthDay}${ordSuf(monthDay)}${timeStr}`; break;
    default: desc = 'Custom';
  }
  if (endMode === 'date' && endDate) desc += ` until ${new Date(endDate).toLocaleDateString()}`;
  if (endMode === 'count' && maxRuns) desc += `, ${maxRuns} time${maxRuns > 1 ? 's' : ''}`;
  return desc;
}

function ordSuf(n) { const s = ['th','st','nd','rd']; const v = n % 100; return s[(v-20)%10] || s[v] || s[0]; }

// ========================
// Mini Calendar Component (Apple-inspired)
// ========================

function MiniCalendar({ value, onChange, minDate }) {
  const selected = value ? new Date(value) : null;
  const [viewDate, setViewDate] = useState(() => {
    const d = selected || new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const today = new Date(); today.setHours(0,0,0,0);
  const min = minDate ? new Date(minDate) : null;
  if (min) min.setHours(0,0,0,0);

  const weeks = [];
  let week = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const isSelected = (d) => selected && selected.getFullYear() === year && selected.getMonth() === month && selected.getDate() === d;
  const isToday = (d) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
  const isDisabled = (d) => min && new Date(year, month, d) < min;

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  return (
    <div className="select-none">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={prevMonth} className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{monthNames[month]} {year}</span>
        <button type="button" onClick={nextMonth} className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-gray-400 dark:text-gray-500 py-1">{d}</div>
        ))}
      </div>

      {/* Date grid */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((day, di) => (
            <div key={di} className="flex items-center justify-center py-0.5">
              {day ? (
                <button
                  type="button"
                  disabled={isDisabled(day)}
                  onClick={() => onChange(new Date(year, month, day).toISOString().split('T')[0])}
                  className={`w-8 h-8 rounded-full text-xs font-medium transition-all ${
                    isSelected(day)
                      ? 'bg-loxia-600 text-white shadow-sm'
                      : isToday(day)
                      ? 'bg-loxia-100 dark:bg-loxia-900/30 text-loxia-700 dark:text-loxia-400 font-semibold'
                      : isDisabled(day)
                      ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {day}
                </button>
              ) : <span className="w-8 h-8" />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ========================
// Apple-style grouped row
// ========================

function FormRow({ label, children, last = false }) {
  return (
    <div className={`flex items-center justify-between py-3 ${last ? '' : 'border-b border-gray-100 dark:border-gray-700/50'}`}>
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

// ========================
// Schedule Form Modal
// ========================

function ScheduleFormModal({ schedule, flows, onSave, onClose }) {
  const [name, setName] = useState(schedule?.name || '');
  const [description, setDescription] = useState(schedule?.description || '');
  const [prompt, setPrompt] = useState(schedule?.prompt || '');
  const [targetType, setTargetType] = useState(schedule?.targetType || 'agent');
  const [targetId, setTargetId] = useState(schedule?.targetId || '');
  const [enabled, setEnabled] = useState(schedule?.enabled !== false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState({});

  // Recurrence
  const initR = cronToRecurrence(schedule?.cronExpression || '0 9 * * *');
  const isOnce = schedule?.runOnce;
  const [frequency, setFrequency] = useState(isOnce ? 'once' : initR.frequency);
  const [interval, setRInterval] = useState(initR.interval);
  const [selectedDays, setSelectedDays] = useState(initR.days);
  const [hour, setHour] = useState(initR.hour);
  const [minute, setMinute] = useState(initR.minute);
  const [monthDay, setMonthDay] = useState(initR.monthDay);

  // Start/End
  const [startDate, setStartDate] = useState(schedule?.startDate?.split('T')[0] || '');
  const [endMode, setEndMode] = useState(
    schedule?.maxRuns ? 'count' : schedule?.endDate ? 'date' : 'never'
  );
  const [endDate, setEndDate] = useState(schedule?.endDate?.split('T')[0] || '');
  const [maxRuns, setMaxRuns] = useState(schedule?.maxRuns || 10);

  // Calendar expand states
  const [showStartCal, setShowStartCal] = useState(false);
  const [showEndCal, setShowEndCal] = useState(false);

  // Derived
  const computedCron = recurrenceToCron({ frequency, interval, days: selectedDays, hour, minute, monthDay });
  const nextRuns = frequency === 'once' ? [] : getNextRuns(computedCron, 3);
  const recurrenceDesc = describeRecurrence({ frequency, interval, days: selectedDays, hour, minute, monthDay, endMode, endDate, maxRuns });

  const toggleDay = (d) => setSelectedDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());

  useEffect(() => {
    if (!schedule) {
      // Only auto-select for flows; AgentSelector handles its own selection
      if (targetType === 'flow' && flows?.length > 0) {
        setTargetId(flows[0]?.id || '');
      } else if (targetType === 'agent') {
        setTargetId(''); // AgentSelector will let user pick
      }
    }
  }, [targetType, flows, schedule]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        name, description, prompt, targetType, targetId,
        cronExpression: computedCron,
        enabled,
        runOnce: frequency === 'once',
        startDate: startDate || null,
        endDate: endMode === 'date' && endDate ? endDate : null,
        maxRuns: endMode === 'count' ? maxRuns : null,
      });
    } catch { /* parent handles */ } finally { setSaving(false); }
  };

  const targets = (flows || []).map(f => ({ id: f.id, name: f.name }));

  const nameValid = name.trim().length > 0;
  const targetValid = targetId.length > 0;
  const promptValid = prompt.trim().length > 0;
  const canSubmit = nameValid && targetValid && promptValid && !saving;

  // Apple-style select classes
  const selectCls = 'px-3 py-1.5 bg-gray-100 dark:bg-gray-700 border-0 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-loxia-500 appearance-none cursor-pointer';
  const inputCls = (valid, field) => {
    const base = 'w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-700/60 text-gray-900 dark:text-white text-sm transition-colors focus:ring-2 focus:ring-loxia-500 focus:bg-white dark:focus:bg-gray-700 border-0 outline-none';
    if (touched[field] && !valid) return `${base} ring-1 ring-red-400`;
    return base;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header (Apple-style: centered title, inline actions) ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200/80 dark:border-gray-700/80 flex-shrink-0">
          <button type="button" onClick={onClose} className="text-sm font-medium text-loxia-600 dark:text-loxia-400 hover:text-loxia-700 transition-colors">
            Cancel
          </button>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {schedule ? 'Edit Schedule' : 'New Schedule'}
          </h2>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="text-sm font-semibold text-loxia-600 dark:text-loxia-400 hover:text-loxia-700 disabled:text-gray-300 dark:disabled:text-gray-600 transition-colors"
          >
            {saving ? 'Saving...' : schedule ? 'Save' : 'Add'}
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 space-y-5">

            {/* ── Name & Description (Apple-style stacked inputs) ── */}
            <div className="rounded-xl bg-gray-50 dark:bg-gray-700/40 overflow-hidden">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={() => setTouched(t => ({ ...t, name: true }))}
                placeholder="Task name"
                className="w-full px-4 py-3 bg-transparent text-gray-900 dark:text-white text-sm border-0 border-b border-gray-200/60 dark:border-gray-600/40 focus:ring-0 focus:outline-none placeholder-gray-400"
                autoFocus
              />
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="w-full px-4 py-3 bg-transparent text-gray-900 dark:text-white text-sm border-0 focus:ring-0 focus:outline-none placeholder-gray-400"
              />
            </div>
            {touched.name && !nameValid && (
              <p className="text-xs text-red-500 -mt-3 px-1">Name is required</p>
            )}

            {/* ── Prompt ── */}
            <div>
              <div className="flex items-center justify-between mb-1.5 px-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Prompt</label>
                <span className={`text-[10px] ${prompt.length > 2000 ? 'text-red-500' : 'text-gray-400'}`}>{prompt.length}/2000</span>
              </div>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onBlur={() => setTouched(t => ({ ...t, prompt: true }))}
                placeholder="The instruction to send when triggered..."
                rows={3}
                className={`${inputCls(promptValid, 'prompt')} resize-y min-h-[76px]`}
              />
              {touched.prompt && !promptValid && (
                <p className="text-xs text-red-500 mt-1 px-1">Prompt is required</p>
              )}
            </div>

            {/* ── Target (Apple-style grouped card) ── */}
            <div className="rounded-xl bg-gray-50 dark:bg-gray-700/40 px-4">
              <FormRow label="Target type">
                <div className="flex rounded-lg bg-gray-200/70 dark:bg-gray-600/50 p-0.5">
                  {[
                    { type: 'agent', label: 'Agent' },
                    { type: 'flow', label: 'Flow' }
                  ].map(opt => (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => setTargetType(opt.type)}
                      className={`px-4 py-1 rounded-md text-xs font-medium transition-all ${
                        targetType === opt.type
                          ? 'bg-white dark:bg-gray-500 text-gray-900 dark:text-white shadow-sm'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </FormRow>
              <FormRow label={targetType === 'agent' ? 'Agent' : 'Flow'} last>
                {targetType === 'agent' ? (
                  <AgentSelector
                    value={targetId}
                    onChange={(id) => { setTargetId(id); setTouched(t => ({ ...t, target: true })); }}
                  />
                ) : (
                  <select
                    value={targetId}
                    onChange={e => setTargetId(e.target.value)}
                    onBlur={() => setTouched(t => ({ ...t, target: true }))}
                    className={selectCls}
                  >
                    <option value="">Select...</option>
                    {targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
              </FormRow>
            </div>
            {targetType === 'flow' && targets.length === 0 && (
              <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 px-1 -mt-3">
                <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0" />
                No flows available. Create one first.
              </p>
            )}

            {/* ── Schedule (Apple-style grouped card) ── */}
            <div className="rounded-xl bg-gray-50 dark:bg-gray-700/40 px-4">
              {/* Frequency */}
              <FormRow label="Repeat">
                <select value={frequency} onChange={e => {
                  setFrequency(e.target.value);
                  if (e.target.value === 'week' && selectedDays.length === 0) setSelectedDays([new Date().getDay()]);
                }} className={selectCls}>
                  {FREQUENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FormRow>

              {/* Interval (not for once) */}
              {frequency !== 'once' && (
                <FormRow label="Every">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min={1} max={99} value={interval}
                      onChange={e => setRInterval(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-14 px-2 py-1.5 bg-gray-200/70 dark:bg-gray-600/50 border-0 rounded-lg text-sm text-center font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-loxia-500"
                    />
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {FREQUENCY_OPTIONS.find(o => o.value === frequency)?.plural}
                    </span>
                  </div>
                </FormRow>
              )}

              {/* Day-of-week chips */}
              {frequency === 'week' && (
                <FormRow label="Days" last={frequency === 'week' && !['day','hour','minute'].includes(frequency)}>
                  <div className="flex gap-1">
                    {DAY_LABELS.map(day => (
                      <button
                        type="button" key={day.key}
                        onClick={() => toggleDay(day.key)}
                        title={day.full}
                        className={`w-7 h-7 rounded-full text-[11px] font-semibold transition-all ${
                          selectedDays.includes(day.key)
                            ? 'bg-loxia-600 text-white'
                            : 'bg-gray-200/70 dark:bg-gray-600/50 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                        }`}
                      >{day.short}</button>
                    ))}
                  </div>
                </FormRow>
              )}

              {/* Month day */}
              {frequency === 'month' && (
                <FormRow label="Day of month">
                  <select value={monthDay} onChange={e => setMonthDay(parseInt(e.target.value))} className={selectCls}>
                    {Array.from({length:28},(_,i)=>i+1).map(d => (
                      <option key={d} value={d}>{d}{ordSuf(d)}</option>
                    ))}
                  </select>
                </FormRow>
              )}

              {/* Time — split hour, minute, AM/PM (Apple-style) */}
              {!['minute'].includes(frequency) && (
                <FormRow label="Time" last={!['week'].includes(frequency)}>
                  <div className="flex items-center gap-1">
                    <select
                      value={(hour % 12) || 12}
                      onChange={e => {
                        const h12 = parseInt(e.target.value);
                        setHour(hour < 12 ? (h12 === 12 ? 0 : h12) : (h12 === 12 ? 12 : h12 + 12));
                      }}
                      className={`${selectCls} w-14 text-center`}
                    >
                      {[12,1,2,3,4,5,6,7,8,9,10,11].map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    <span className="text-gray-400 font-medium">:</span>
                    <select value={minute} onChange={e => setMinute(parseInt(e.target.value))} className={`${selectCls} w-14 text-center`}>
                      {MINUTE_OPTIONS.map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
                    </select>
                    <div className="flex rounded-lg bg-gray-200/70 dark:bg-gray-600/50 p-0.5 ml-1">
                      {['AM','PM'].map(p => (
                        <button
                          key={p} type="button"
                          onClick={() => {
                            if (p === 'AM' && hour >= 12) setHour(hour - 12);
                            if (p === 'PM' && hour < 12) setHour(hour + 12);
                          }}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                            (p === 'AM' && hour < 12) || (p === 'PM' && hour >= 12)
                              ? 'bg-white dark:bg-gray-500 text-gray-900 dark:text-white shadow-sm'
                              : 'text-gray-400 dark:text-gray-500'
                          }`}
                        >{p}</button>
                      ))}
                    </div>
                  </div>
                </FormRow>
              )}
            </div>

            {/* ── Start / End dates (Apple-style grouped card) ── */}
            <div className="rounded-xl bg-gray-50 dark:bg-gray-700/40 px-4">
              {/* Start date */}
              <FormRow label="Starts">
                <button
                  type="button"
                  onClick={() => { setShowStartCal(!showStartCal); setShowEndCal(false); }}
                  className={`${selectCls} ${showStartCal ? 'ring-2 ring-loxia-500' : ''}`}
                >
                  {startDate ? new Date(startDate + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Now'}
                </button>
              </FormRow>
              {showStartCal && (
                <div className="pb-3 -mt-1">
                  <MiniCalendar
                    value={startDate}
                    onChange={(d) => { setStartDate(d); setShowStartCal(false); }}
                    minDate={new Date().toISOString().split('T')[0]}
                  />
                  {startDate && (
                    <button type="button" onClick={() => { setStartDate(''); setShowStartCal(false); }} className="text-xs text-loxia-600 dark:text-loxia-400 mt-1">
                      Clear start date
                    </button>
                  )}
                </div>
              )}

              {/* End condition */}
              {frequency !== 'once' && (
                <>
                  <FormRow label="Ends">
                    <select value={endMode} onChange={e => { setEndMode(e.target.value); setShowEndCal(false); }} className={selectCls}>
                      {END_MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </FormRow>

                  {endMode === 'date' && (
                    <>
                      <FormRow label="End date">
                        <button
                          type="button"
                          onClick={() => { setShowEndCal(!showEndCal); setShowStartCal(false); }}
                          className={`${selectCls} ${showEndCal ? 'ring-2 ring-loxia-500' : ''}`}
                        >
                          {endDate ? new Date(endDate + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Select date'}
                        </button>
                      </FormRow>
                      {showEndCal && (
                        <div className="pb-3 -mt-1">
                          <MiniCalendar
                            value={endDate}
                            onChange={(d) => { setEndDate(d); setShowEndCal(false); }}
                            minDate={startDate || new Date().toISOString().split('T')[0]}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {endMode === 'count' && (
                    <FormRow label="Occurrences" last>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number" min={1} max={9999} value={maxRuns}
                          onChange={e => setMaxRuns(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-16 px-2 py-1.5 bg-gray-200/70 dark:bg-gray-600/50 border-0 rounded-lg text-sm text-center font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-loxia-500"
                        />
                        <span className="text-sm text-gray-500 dark:text-gray-400">times</span>
                      </div>
                    </FormRow>
                  )}
                </>
              )}

              {/* Active toggle (last row) */}
              <FormRow label="Active" last>
                <button
                  type="button"
                  onClick={() => setEnabled(!enabled)}
                  className={`relative inline-flex h-[22px] w-[40px] items-center rounded-full transition-colors ${
                    enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  role="switch" aria-checked={enabled}
                >
                  <span className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow transition-transform ${
                    enabled ? 'translate-x-[20px]' : 'translate-x-[2px]'
                  }`} />
                </button>
              </FormRow>
            </div>

            {/* ── Summary preview ── */}
            <div className="px-4 py-3 rounded-xl bg-loxia-50 dark:bg-loxia-900/10">
              <div className="flex items-start gap-2.5">
                <ClockIcon className="w-4 h-4 text-loxia-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-loxia-700 dark:text-loxia-400">{recurrenceDesc}</p>
                  {nextRuns.length > 0 && (
                    <p className="text-xs text-loxia-600/60 dark:text-loxia-400/50 mt-0.5">
                      Next: {nextRuns.map(r => formatRunTime(r)).join('  ·  ')}
                    </p>
                  )}
                </div>
              </div>
            </div>

          </div>
        </form>
      </div>
    </div>
  );
}

export default SchedulesPage;
