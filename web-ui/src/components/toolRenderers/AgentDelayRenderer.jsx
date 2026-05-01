/**
 * AgentDelayRenderer Component
 *
 * Displays agent delay/pause operations with a clock visualization.
 * Shows duration countdown, reason for delay, and resume time.
 * Includes "Skip Delay" button to cancel the delay early.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ClockIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  ArrowPathIcon,
  ForwardIcon
} from '@heroicons/react/24/outline';
import { api } from '../../services/api.js';
import { useAppStore } from '../../stores/appStore.js';

/**
 * Format duration in human readable form
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';

  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
}

/**
 * Format time for display (HH:MM:SS or HH:MM)
 */
function formatTime(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Circular progress indicator
 */
function CircularProgress({ progress, size = 80, strokeWidth = 6 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-gray-200 dark:text-gray-700"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-amber-500 transition-all duration-1000"
      />
    </svg>
  );
}

/**
 * Countdown timer with live updates
 */
function CountdownTimer({ pausedUntil, duration }) {
  const [remaining, setRemaining] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (!pausedUntil) {
      setRemaining(duration || 0);
      return;
    }

    const endTime = new Date(pausedUntil).getTime();

    const updateRemaining = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.ceil((endTime - now) / 1000));
      setRemaining(diff);
      setIsComplete(diff === 0);
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);

    return () => clearInterval(interval);
  }, [pausedUntil, duration]);

  const progress = duration > 0 ? ((duration - remaining) / duration) * 100 : 0;

  return (
    <div className="flex flex-col items-center">
      {/* Circular progress with time inside */}
      <div className="relative">
        <CircularProgress progress={progress} size={100} strokeWidth={8} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {isComplete ? (
            <PlayCircleIcon className="w-8 h-8 text-emerald-500" />
          ) : (
            <>
              <span className="text-2xl font-bold text-gray-800 dark:text-gray-100 tabular-nums">
                {remaining}
              </span>
              <span className="text-xs text-gray-500">seconds</span>
            </>
          )}
        </div>
      </div>

      {/* Status text */}
      <div className="mt-3 text-center">
        {isComplete ? (
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Resumed
          </span>
        ) : (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {formatDuration(remaining)} remaining
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Reason badge with icon
 */
function ReasonBadge({ reason }) {
  // Detect reason type for icon
  const getReasonIcon = () => {
    const r = (reason || '').toLowerCase();
    if (r.includes('install') || r.includes('npm') || r.includes('yarn')) {
      return '📦';
    }
    if (r.includes('build') || r.includes('compil')) {
      return '🔨';
    }
    if (r.includes('start') || r.includes('server') || r.includes('service')) {
      return '🚀';
    }
    if (r.includes('database') || r.includes('db')) {
      return '🗄️';
    }
    if (r.includes('docker') || r.includes('container')) {
      return '🐳';
    }
    if (r.includes('test')) {
      return '🧪';
    }
    if (r.includes('deploy')) {
      return '☁️';
    }
    if (r.includes('wait') || r.includes('reply') || r.includes('response')) {
      return '⏳';
    }
    return '⏸️';
  };

  if (!reason) return null;

  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
      <span className="text-lg flex-shrink-0">{getReasonIcon()}</span>
      <span className="text-sm text-amber-800 dark:text-amber-200">
        {reason}
      </span>
    </div>
  );
}

/**
 * Parse delay data from JSON
 */
function parseDelayData(parsedData) {
  if (!parsedData) return null;

  // From actions array
  if (parsedData.actions && Array.isArray(parsedData.actions) && parsedData.actions.length > 0) {
    const action = parsedData.actions[0];
    return {
      duration: action.duration || action.pauseDuration || action['pause-duration'],
      reason: action.reason,
      pausedUntil: action.pausedUntil,
      resumeTime: action.resumeTime
    };
  }

  // From parameters
  if (parsedData.parameters) {
    const p = parsedData.parameters;
    return {
      duration: p.duration || p.pauseDuration || p['pause-duration'],
      reason: p.reason,
      pausedUntil: p.pausedUntil,
      resumeTime: p.resumeTime
    };
  }

  // Direct format (tool invocation or result)
  return {
    duration: parsedData.duration || parsedData.pauseDuration || parsedData['pause-duration'],
    reason: parsedData.reason,
    pausedUntil: parsedData.pausedUntil,
    resumeTime: parsedData.resumeTime,
    success: parsedData.success,
    message: parsedData.message
  };
}

/**
 * Module-level cache for skip state so it survives component re-mounts.
 * Keyed by agentId + messageTimestamp to be unique per delay invocation.
 */
const _skippedDelays = new Set();

function getSkipKey(agentId, messageTimestamp) {
  return `${agentId || 'unknown'}_${messageTimestamp || ''}`;
}

/**
 * Main component
 */
function AgentDelayRenderer({ toolId, rawContent, innerContent, parsedData, messageTimestamp, agentId: propAgentId }) {
  const { sessionId, projectDir, currentAgent } = useAppStore();
  const [isSkipping, setIsSkipping] = useState(false);

  const data = useMemo(() => parseDelayData(parsedData), [parsedData]);

  // Get agent ID from props or current agent
  const effectiveAgentId = propAgentId || currentAgent?.id;
  const skipKey = getSkipKey(effectiveAgentId, messageTimestamp);

  const [localSkipped, setLocalSkipped] = useState(() => _skippedDelays.has(skipKey));

  // Determine if delay was already completed/skipped from result data, agent status, or timer elapsed
  const resultIndicatesComplete = parsedData?._hasResults || parsedData?.success !== undefined;
  const agentIsActive = currentAgent?.status === 'active' || currentAgent?.status === 'idle';
  const skipped = localSkipped || resultIndicatesComplete || agentIsActive;

  // Calculate pausedUntil from message timestamp if not provided
  const calculatedPausedUntil = useMemo(() => {
    if (data?.pausedUntil) {
      return data.pausedUntil;
    }
    // Calculate from message timestamp + duration
    if (messageTimestamp && data?.duration) {
      const startTime = new Date(messageTimestamp).getTime();
      const endTime = startTime + (data.duration * 1000);
      return new Date(endTime).toISOString();
    }
    return null;
  }, [data?.pausedUntil, data?.duration, messageTimestamp]);

  // Handle skip delay
  const handleSkipDelay = useCallback(async () => {
    if (!effectiveAgentId || !sessionId) {
      console.warn('Cannot skip delay: missing agentId or sessionId');
      return;
    }

    setIsSkipping(true);
    try {
      const response = await api.resumeAgent(sessionId, { agentId: effectiveAgentId }, projectDir);
      if (response.success) {
        _skippedDelays.add(skipKey);
        setLocalSkipped(true);
        console.log('✅ Delay skipped successfully');
      } else {
        console.error('Failed to skip delay:', response.error);
      }
    } catch (error) {
      console.error('Error skipping delay:', error);
    } finally {
      setIsSkipping(false);
    }
  }, [effectiveAgentId, sessionId, projectDir, skipKey]);

  if (!data || !data.duration) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-50 dark:bg-gray-800/50 text-sm text-gray-500">
        <PauseCircleIcon className="w-4 h-4" />
        <span>Agent delay</span>
      </div>
    );
  }

  const { duration, reason } = data;

  return (
    <div className="my-2 rounded-lg border border-amber-200 dark:border-amber-800 overflow-hidden bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-100 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
        <PauseCircleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
          {skipped ? 'Delay Skipped' : 'Agent Paused'}
        </span>
        <span className="text-xs text-amber-600 dark:text-amber-400 ml-auto">
          {formatDuration(duration)} delay
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start gap-6">
          {/* Countdown timer */}
          <div className="flex-shrink-0">
            <CountdownTimer
              pausedUntil={skipped ? new Date().toISOString() : calculatedPausedUntil}
              duration={duration}
            />
          </div>

          {/* Details */}
          <div className="flex-1 space-y-3">
            {/* Reason */}
            <ReasonBadge reason={reason} />

            {/* Resume time */}
            {calculatedPausedUntil && !skipped && (
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <ClockIcon className="w-4 h-4" />
                <span>Resumes at:</span>
                <span className="font-mono font-medium text-gray-800 dark:text-gray-200">
                  {formatTime(calculatedPausedUntil)}
                </span>
              </div>
            )}

            {/* Duration info */}
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <div className="flex items-center gap-1">
                <ArrowPathIcon className="w-3.5 h-3.5" />
                <span>Duration: {formatDuration(duration)}</span>
              </div>
            </div>

            {/* Skip Delay Button */}
            {!skipped && (
              <button
                onClick={handleSkipDelay}
                disabled={isSkipping}
                className="flex items-center gap-2 px-3 py-1.5 mt-2 text-sm font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-300 dark:border-amber-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ForwardIcon className="w-4 h-4" />
                {isSkipping ? 'Skipping...' : 'Skip Delay'}
              </button>
            )}

            {/* Skipped confirmation */}
            {skipped && (
              <div className="flex items-center gap-2 px-3 py-1.5 mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg">
                <PlayCircleIcon className="w-4 h-4" />
                <span>Delay skipped - Agent resumed</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AgentDelayRenderer;
