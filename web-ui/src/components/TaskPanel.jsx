import React, { useMemo } from 'react';
import { XMarkIcon, CheckCircleIcon, ClockIcon, ExclamationCircleIcon, PauseCircleIcon } from '@heroicons/react/24/outline';
import { ListBulletIcon } from '@heroicons/react/24/solid';
import { useAppStore } from '../stores/appStore.js';

const STATUS_CONFIG = {
  pending: { color: 'text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700', label: 'Pending', icon: ClockIcon },
  in_progress: { color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-900/30', label: 'In Progress', icon: null, pulse: true },
  completed: { color: 'text-green-500', bg: 'bg-green-100 dark:bg-green-900/30', label: 'Done', icon: CheckCircleIcon },
  blocked: { color: 'text-red-500', bg: 'bg-red-100 dark:bg-red-900/30', label: 'Blocked', icon: ExclamationCircleIcon },
  cancelled: { color: 'text-gray-300', bg: 'bg-gray-50 dark:bg-gray-800', label: 'Cancelled', icon: PauseCircleIcon }
};

const PRIORITY_CONFIG = {
  urgent: 'bg-red-500 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-400 text-gray-800',
  low: 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
};

function TaskItem({ task }) {
  const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
  const StatusIcon = config.icon;

  return (
    <div className={`px-3 py-2 border-l-2 ${
      task.status === 'in_progress' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/10' :
      task.status === 'completed' ? 'border-green-500' :
      task.status === 'blocked' ? 'border-red-500' :
      'border-transparent'
    }`}>
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 w-4 h-4 flex-shrink-0 ${config.color} ${config.pulse ? 'animate-pulse' : ''}`}>
          {StatusIcon ? <StatusIcon className="w-4 h-4" /> : (
            <div className="w-3 h-3 mt-0.5 rounded-full bg-blue-500 animate-pulse" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm ${task.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>
            {task.title || task.name || task.description || 'Untitled task'}
          </div>
          {task.priority && task.priority !== 'normal' && (
            <span className={`inline-block mt-0.5 px-1.5 py-0 text-[10px] font-medium rounded ${PRIORITY_CONFIG[task.priority] || ''}`}>
              {task.priority}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TaskPanel({ onClose }) {
  const currentAgent = useAppStore(s => s.currentAgent);
  const messages = useAppStore(s => s.messages);

  // Extract tasks from the latest taskmanager tool results in messages
  const tasks = useMemo(() => {
    if (!messages || messages.length === 0) return [];

    // Walk backwards through messages to find the latest taskmanager result.
    // Every taskmanager action now returns the full current task list at
    // `result.tasks` (see src/tools/taskManagerTool.js envelope), so the
    // first taskmanager result we hit walking back is authoritative —
    // including an empty array, which means the agent cleared/cancelled
    // all tasks. Falling through to an older non-empty result would show
    // stale data.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.toolResults) {
        for (const tr of msg.toolResults) {
          if (tr.toolId === 'taskmanager' && tr.status === 'completed' && tr.result) {
            const result = tr.result;
            const taskList = result.tasks ?? result.data?.tasks ?? result.result?.tasks;
            if (Array.isArray(taskList)) return taskList;
          }
        }
      }
    }
    return [];
  }, [messages]);

  const counts = useMemo(() => {
    const c = { total: tasks.length, completed: 0, inProgress: 0, pending: 0, blocked: 0 };
    tasks.forEach(t => {
      if (t.status === 'completed') c.completed++;
      else if (t.status === 'in_progress') c.inProgress++;
      else if (t.status === 'blocked') c.blocked++;
      else c.pending++;
    });
    return c;
  }, [tasks]);

  return (
    <div className="flex flex-col h-full w-[320px] border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <ListBulletIcon className="w-4 h-4 text-loxia-600 dark:text-loxia-400" />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Tasks</span>
          {tasks.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full">
              {counts.completed}/{counts.total}
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
          <XMarkIcon className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Progress bar */}
      {tasks.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div
              className="bg-green-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${(counts.completed / counts.total) * 100}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-400">
            {counts.inProgress > 0 && <span className="text-blue-500">{counts.inProgress} active</span>}
            {counts.blocked > 0 && <span className="text-red-500">{counts.blocked} blocked</span>}
            {counts.pending > 0 && <span>{counts.pending} pending</span>}
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <ListBulletIcon className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-sm text-gray-400 text-center">No tasks yet. The agent will create tasks as it works.</p>
          </div>
        ) : (
          tasks.map((task, i) => <TaskItem key={task.id || i} task={task} />)
        )}
      </div>
    </div>
  );
}
