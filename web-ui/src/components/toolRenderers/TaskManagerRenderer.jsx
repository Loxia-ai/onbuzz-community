/**
 * TaskManagerRenderer Component
 *
 * Specialized renderer for TaskManager tool invocations.
 * Clean, focused TODO list display.
 */

import React, { useState, useMemo } from 'react';
import {
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  PlayIcon,
  PauseIcon,
  ChevronDownIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline';
import {
  CheckCircleIcon as CheckCircleSolidIcon
} from '@heroicons/react/24/solid';

/**
 * Status icons and colors
 */
const STATUS_CONFIG = {
  pending: {
    icon: ClockIcon,
    color: 'text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-800'
  },
  in_progress: {
    icon: PlayIcon,
    color: 'text-loxia-500',
    bg: 'bg-loxia-50 dark:bg-loxia-900/30',
    pulse: true
  },
  blocked: {
    icon: PauseIcon,
    color: 'text-task-blocked',
    bg: 'bg-task-blocked-bg dark:bg-task-blocked-bg'
  },
  completed: {
    icon: CheckCircleSolidIcon,
    color: 'text-task-completed',
    bg: 'bg-task-completed-bg dark:bg-task-completed-bg',
    strike: true
  },
  cancelled: {
    icon: XCircleIcon,
    color: 'text-loxia-400',
    bg: 'bg-loxia-50 dark:bg-loxia-900/30',
    strike: true,
    dim: true
  }
};

/**
 * Priority colors
 */
const PRIORITY_COLORS = {
  urgent: 'text-red-600 dark:text-red-400',
  high: 'text-orange-600 dark:text-orange-400',
  medium: 'text-yellow-600 dark:text-yellow-400',
  low: 'text-gray-500 dark:text-gray-400'
};

/**
 * Single task row
 */
function TaskRow({ task }) {
  const status = task.status?.toLowerCase() || 'pending';
  const priority = task.priority?.toLowerCase() || 'medium';
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <div className={`flex items-center gap-3 py-2 px-3 rounded-md ${config.bg} ${config.dim ? 'opacity-50' : ''}`}>
      <Icon className={`w-4 h-4 flex-shrink-0 ${config.color} ${config.pulse ? 'animate-pulse' : ''}`} />
      <span className={`flex-1 text-sm ${config.strike ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>
        {task.title || 'Untitled'}
      </span>
      {priority !== 'medium' && (
        <span className={`text-xs font-medium ${PRIORITY_COLORS[priority]}`}>
          {priority}
        </span>
      )}
    </div>
  );
}

/**
 * Parse tasks from JSON
 */
function parseTasks(parsedData) {
  if (!parsedData) return { action: null, tasks: [] };

  let action = null;
  let tasks = [];

  if (parsedData.actions?.length > 0) {
    const first = parsedData.actions[0];
    action = first.type || first.action;

    if (first.tasks) {
      tasks = first.tasks.map((t, i) => ({
        id: t.taskId || t.id || i,
        title: t.title || t.name || 'Untitled',
        status: t.status || 'pending',
        priority: t.priority || 'medium'
      }));
    } else if (first.title) {
      tasks = [{
        id: first.taskId || first.id || 0,
        title: first.title,
        status: first.status || (action === 'complete' ? 'completed' : action === 'cancel' ? 'cancelled' : 'pending'),
        priority: first.priority || 'medium'
      }];
    }
  }

  // Pull tasks from the tool's RESULT payload when the input doesn't carry
  // them — e.g. `list` actions have no tasks on input, but the result includes
  // the full current task list. Works for any action whose result returns
  // `{ result: { tasks: [...] } }` or `{ tasks: [...] }` directly.
  if (tasks.length === 0 && parsedData._result) {
    const r = parsedData._result;
    const resultTasks = Array.isArray(r.tasks)
      ? r.tasks
      : (r.result && Array.isArray(r.result.tasks) ? r.result.tasks : null);
    if (resultTasks && resultTasks.length > 0) {
      tasks = resultTasks.map((t, i) => ({
        id: t.taskId || t.id || i,
        title: t.title || t.name || 'Untitled',
        status: t.status || 'pending',
        priority: t.priority || 'medium'
      }));
    }
  }

  return { action, tasks };
}

/**
 * Main component
 */
function TaskManagerRenderer({ toolId, rawContent, innerContent, parsedData }) {
  const [expanded, setExpanded] = useState(true);
  const { action, tasks } = useMemo(() => parseTasks(parsedData), [parsedData]);

  if (tasks.length === 0) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-50 dark:bg-gray-800/50 text-sm text-gray-500">
        <ClockIcon className="w-4 h-4" />
        <span>Task list {action || 'operation'}</span>
      </div>
    );
  }

  // Count by status
  const completed = tasks.filter(t => t.status === 'completed').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;

  return (
    <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDownIcon className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRightIcon className="w-4 h-4 text-gray-400" />
          )}
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Tasks
          </span>
          <span className="text-xs text-gray-500">
            {completed}/{tasks.length}
          </span>
        </div>

        {/* Mini progress */}
        <div className="flex items-center gap-2">
          {inProgress > 0 && (
            <span className="flex items-center gap-1 text-xs text-loxia-500">
              <span className="w-1.5 h-1.5 rounded-full bg-loxia-500 animate-pulse"></span>
              {inProgress} active
            </span>
          )}
          <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-task-completed transition-all"
              style={{ width: `${(completed / tasks.length) * 100}%` }}
            />
          </div>
        </div>
      </button>

      {/* Task list */}
      {expanded && (
        <div className="p-2 space-y-1 bg-white dark:bg-gray-900">
          {tasks.map((task, idx) => (
            <TaskRow key={task.id || idx} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

export default TaskManagerRenderer;
