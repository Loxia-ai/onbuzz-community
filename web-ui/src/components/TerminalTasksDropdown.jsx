import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  CommandLineIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  PauseCircleIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import { api } from '../services/api.js';
import { TERMINAL_CONFIG } from '../utilities/constants.js';

/**
 * Format elapsed time in human-readable format
 */
function formatElapsedTime(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Get state display info (color, icon, label)
 */
function getStateInfo(state) {
  switch (state) {
    case 'running':
      return {
        color: 'text-blue-500',
        bgColor: 'bg-blue-100 dark:bg-blue-900/30',
        Icon: ClockIcon,
        label: 'Running',
        pulse: true
      };
    case 'waiting_for_input':
      return {
        color: 'text-amber-500',
        bgColor: 'bg-amber-100 dark:bg-amber-900/30',
        Icon: PauseCircleIcon,
        label: 'Waiting for Input',
        pulse: true
      };
    case 'completed':
      return {
        color: 'text-green-500',
        bgColor: 'bg-green-100 dark:bg-green-900/30',
        Icon: CheckCircleIcon,
        label: 'Completed',
        pulse: false
      };
    case 'failed':
      return {
        color: 'text-amber-600',
        bgColor: 'bg-amber-100 dark:bg-amber-900/30',
        Icon: ExclamationCircleIcon,
        label: 'Non Zero Exit',
        pulse: false
      };
    default:
      return {
        color: 'text-gray-500',
        bgColor: 'bg-gray-100 dark:bg-gray-900/30',
        Icon: CommandLineIcon,
        label: state,
        pulse: false
      };
  }
}

/**
 * Truncate command for display
 */
function truncateCommand(command, maxLength = 50) {
  if (!command) return '';
  if (command.length <= maxLength) return command;
  return command.substring(0, maxLength - 3) + '...';
}

/**
 * TerminalTasksDropdown Component
 * Shows running terminal tasks for the current agent
 */
function TerminalTasksDropdown({ agentId, disabled = false, onClose }) {
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState({ running: 0, waiting_for_input: 0, completed: 0, failed: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedTask, setExpandedTask] = useState(null);
  const [taskOutput, setTaskOutput] = useState(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshIntervalRef = useRef(null);

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    if (!agentId) return;

    try {
      const result = await api.getTerminalTasks(agentId, true);
      if (result.success) {
        setTasks(result.tasks || []);
        setSummary(result.summary || { running: 0, waiting_for_input: 0, completed: 0, failed: 0, total: 0 });
        setError(null);
      } else {
        setError(result.error || 'Failed to fetch tasks');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Initial fetch
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Auto-refresh - always active when enabled, but faster when tasks are running
  useEffect(() => {
    if (autoRefresh) {
      const hasActiveTasks = summary.running > 0 || summary.waiting_for_input > 0;
      const interval = hasActiveTasks
        ? TERMINAL_CONFIG.POLLING_INTERVAL_MS
        : TERMINAL_CONFIG.IDLE_POLLING_INTERVAL_MS;
      refreshIntervalRef.current = setInterval(fetchTasks, interval);
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [autoRefresh, summary.running, summary.waiting_for_input, fetchTasks]);

  // Fetch task output when expanded
  const handleExpandTask = useCallback(async (task) => {
    if (expandedTask === task.commandId) {
      setExpandedTask(null);
      setTaskOutput(null);
      return;
    }

    setExpandedTask(task.commandId);
    setLoadingOutput(true);

    try {
      const result = await api.getTerminalTaskOutput(agentId, task.commandId, { tailLines: TERMINAL_CONFIG.EXPANDED_VIEW_TAIL_LINES });
      if (result.success) {
        setTaskOutput(result);
      } else {
        setTaskOutput({ error: result.error });
      }
    } catch (err) {
      setTaskOutput({ error: err.message });
    } finally {
      setLoadingOutput(false);
    }
  }, [agentId, expandedTask]);

  // Render task item
  const renderTask = (task, index) => {
    const stateInfo = getStateInfo(task.state);
    const isExpanded = expandedTask === task.commandId;
    const isRecent = index < TERMINAL_CONFIG.RECENT_HIGHLIGHT_COUNT;
    const isCompleted = task.state === TERMINAL_CONFIG.STATES.COMPLETED || task.state === TERMINAL_CONFIG.STATES.FAILED;

    return (
      <div
        key={task.commandId}
        className={`border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${
          isRecent && isCompleted ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
        }`}
      >
        {/* Task Header */}
        <button
          type="button"
          onClick={() => handleExpandTask(task)}
          className={`w-full px-3 py-2 flex items-start gap-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left ${
            isRecent && isCompleted ? 'border-l-2 border-blue-400 dark:border-blue-500' : ''
          }`}
        >
          {/* Expand Icon */}
          <div className="mt-0.5">
            {isExpanded ? (
              <ChevronDownIcon className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 text-gray-400" />
            )}
          </div>

          {/* State Icon */}
          <div className={`mt-0.5 ${stateInfo.color}`}>
            <stateInfo.Icon className={`w-4 h-4 ${stateInfo.pulse ? 'animate-pulse' : ''}`} />
          </div>

          {/* Task Info */}
          <div className="flex-1 min-w-0">
            <div className="font-mono text-xs text-gray-900 dark:text-gray-100 truncate">
              {truncateCommand(task.command, 60)}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs px-1.5 py-0.5 rounded ${stateInfo.bgColor} ${stateInfo.color}`}>
                {stateInfo.label}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {formatElapsedTime(task.elapsedMs)}
              </span>
              {task.pid && (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  PID: {task.pid}
                </span>
              )}
            </div>
          </div>
        </button>

        {/* Expanded Output */}
        {isExpanded && (
          <div className="px-3 pb-2">
            {loadingOutput ? (
              <div className="bg-gray-900 rounded p-2 text-xs text-gray-400">
                Loading output...
              </div>
            ) : taskOutput?.error ? (
              <div className="bg-red-50 dark:bg-red-900/20 rounded p-2 text-xs text-red-600 dark:text-red-400">
                {taskOutput.error}
              </div>
            ) : taskOutput ? (
              <div className="bg-gray-900 rounded overflow-hidden">
                {/* Output header */}
                <div className="px-2 py-1 bg-gray-800 text-xs text-gray-400 flex justify-between">
                  <span>Output ({taskOutput.totalStdoutSize} bytes)</span>
                  <span className="text-gray-500">{task.workingDirectory}</span>
                </div>
                {/* Stdout */}
                <pre className="p-2 text-xs text-green-400 font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                  {taskOutput.stdout || '(no output yet)'}
                </pre>
                {/* Stderr if any */}
                {taskOutput.stderr && (
                  <>
                    <div className="px-2 py-1 bg-gray-800 text-xs text-red-400">
                      Stderr ({taskOutput.totalStderrSize} bytes)
                    </div>
                    <pre className="p-2 text-xs text-red-400 font-mono overflow-x-auto max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
                      {taskOutput.stderr}
                    </pre>
                  </>
                )}
                {/* Prompt indicator */}
                {taskOutput.promptDetected && (
                  <div className="px-2 py-1 bg-amber-900/30 text-xs text-amber-400">
                    Waiting for input: {taskOutput.promptDetected.description}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  const activeCount = summary.running + summary.waiting_for_input;

  return (
    <div className="py-1 max-h-[32rem] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <CommandLineIcon className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Terminal Tasks
          </span>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">
              {activeCount} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Auto-refresh toggle */}
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-1 rounded transition-colors ${
              autoRefresh
                ? 'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          >
            <ArrowPathIcon className={`w-4 h-4 ${autoRefresh && activeCount > 0 ? 'animate-spin' : ''}`} />
          </button>
          {/* Manual refresh */}
          <button
            type="button"
            onClick={fetchTasks}
            disabled={loading}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {summary.total > 0 && (
        <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3 text-xs">
            {summary.running > 0 && (
              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                {summary.running} running
              </span>
            )}
            {summary.waiting_for_input > 0 && (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                {summary.waiting_for_input} waiting
              </span>
            )}
            {summary.completed > 0 && (
              <span className="text-green-600 dark:text-green-400">
                {summary.completed} completed
              </span>
            )}
            {summary.failed > 0 && (
              <span className="text-red-600 dark:text-red-400">
                {summary.failed} failed
              </span>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && tasks.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            <ArrowPathIcon className="w-5 h-5 mx-auto mb-2 animate-spin" />
            Loading tasks...
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-center">
            <ExclamationCircleIcon className="w-8 h-8 mx-auto mb-2 text-red-400" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button
              type="button"
              onClick={fetchTasks}
              className="mt-2 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              Try again
            </button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            <CommandLineIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No terminal tasks</p>
            <p className="text-xs mt-1 text-gray-400">
              Tasks will appear here when the agent runs terminal commands
            </p>
          </div>
        ) : (
          <div>
            {tasks.map((task, index) => renderTask(task, index))}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Click a task to view its output
        </p>
      </div>
    </div>
  );
}

export default TerminalTasksDropdown;
