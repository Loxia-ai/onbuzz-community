import React, { useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';

/**
 * CompactionIndicator - Displays conversation compaction status as a centered overlay
 *
 * Shows real-time feedback when the system compacts conversation history
 * to handle long-running agent tasks. Appears as a semi-transparent overlay
 * in the center of the chat view for maximum visibility.
 *
 * Statuses:
 * - starting: Compaction initiated
 * - in-progress: Compaction executing
 * - completed: Success with statistics
 * - failed: Error occurred
 */
export function CompactionIndicator({ agentId }) {
  const agentCompactionStatus = useAppStore(state => state.agentCompactionStatus);
  const [show, setShow] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  const compactionState = agentCompactionStatus.get(agentId);

  // Auto-hide completed/failed states after 4 seconds
  useEffect(() => {
    if (compactionState && (compactionState.status === 'completed' || compactionState.status === 'failed')) {
      setShow(true);
      setFadeOut(false);

      const timer = setTimeout(() => {
        setFadeOut(true);
        setTimeout(() => setShow(false), 400);
      }, 4000);

      return () => clearTimeout(timer);
    } else if (compactionState && (compactionState.status === 'starting' || compactionState.status === 'in-progress' || compactionState.status === 'retrying')) {
      setShow(true);
      setFadeOut(false);
    }
  }, [compactionState]);

  if (!compactionState || !show) {
    return null;
  }

  const { status, stats, error } = compactionState;

  const getStatusConfig = () => {
    switch (status) {
      case 'starting':
        return {
          icon: (
            <svg className="w-8 h-8 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          ),
          gradientFrom: 'from-blue-500/90',
          gradientTo: 'to-indigo-600/90',
          title: 'Compacting Conversation',
          message: 'Optimizing history to continue...'
        };

      case 'in-progress':
        return {
          icon: (
            <svg className="w-8 h-8 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          ),
          gradientFrom: 'from-blue-500/90',
          gradientTo: 'to-indigo-600/90',
          title: 'Compaction In Progress',
          message: stats?.strategy
            ? `Using ${stats.strategy} strategy...`
            : 'Processing conversation...'
        };

      case 'retrying':
        return {
          icon: (
            <svg className="w-8 h-8 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          ),
          gradientFrom: 'from-amber-500/90',
          gradientTo: 'to-orange-600/90',
          title: 'Compaction In Progress',
          message: compactionState.message || 'Taking longer than usual, hold on...'
        };

      case 'completed':
        return {
          icon: (
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ),
          gradientFrom: 'from-emerald-500/90',
          gradientTo: 'to-green-600/90',
          title: 'Compaction Complete',
          message: stats?.reductionPercent
            ? `Reduced by ${stats.reductionPercent.toFixed(0)}%`
            : 'Conversation optimized'
        };

      case 'failed':
        return {
          icon: (
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ),
          gradientFrom: 'from-red-500/90',
          gradientTo: 'to-rose-600/90',
          title: 'Compaction Failed',
          message: error || 'Unable to compact'
        };

      default:
        return null;
    }
  };

  const config = getStatusConfig();
  if (!config) return null;

  const isInProgress = status === 'starting' || status === 'in-progress' || status === 'retrying';

  return (
    <div
      className={`
        absolute inset-0 z-40 flex items-center justify-center
        pointer-events-none
        transition-all duration-400 ease-out
        ${fadeOut ? 'opacity-0' : 'opacity-100'}
      `}
    >
      {/* Semi-transparent backdrop */}
      <div
        className={`
          absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-[2px]
          transition-opacity duration-400
          ${fadeOut ? 'opacity-0' : 'opacity-100'}
        `}
      />

      {/* Indicator card */}
      <div
        className={`
          relative
          bg-gradient-to-br ${config.gradientFrom} ${config.gradientTo}
          text-white
          rounded-2xl
          px-8 py-6
          shadow-2xl
          transform transition-all duration-400 ease-out
          ${fadeOut ? 'scale-90 opacity-0' : 'scale-100 opacity-100'}
          min-w-[280px] max-w-[360px]
        `}
      >
        {/* Glow effect */}
        <div className="absolute inset-0 rounded-2xl bg-white/10 blur-xl -z-10" />

        <div className="flex flex-col items-center text-center gap-4">
          {/* Icon */}
          <div className="p-3 bg-white/20 rounded-full">
            {config.icon}
          </div>

          {/* Content */}
          <div>
            <h4 className="font-semibold text-lg mb-1">
              {config.title}
            </h4>
            <p className="text-sm text-white/80">
              {config.message}
            </p>
          </div>

          {/* Progress dots for in-progress states */}
          {isInProgress && (
            <div className="flex space-x-2 mt-1">
              <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '200ms' }} />
              <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '400ms' }} />
            </div>
          )}

          {/* Token reduction stats for completed */}
          {status === 'completed' && stats && stats.originalTokens && (
            <div className="text-xs text-white/70 bg-white/10 rounded-lg px-3 py-2 mt-1">
              {stats.originalTokens.toLocaleString()} → {stats.compactedTokens?.toLocaleString()} tokens
            </div>
          )}

          {/* Context usage bar for starting */}
          {status === 'starting' && stats && stats.currentTokens && stats.contextWindow && (
            <div className="w-full mt-1">
              <div className="flex justify-between text-xs text-white/70 mb-1">
                <span>Context usage</span>
                <span>{((stats.currentTokens / stats.contextWindow) * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full bg-white/20 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-white/70 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min((stats.currentTokens / stats.contextWindow) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CompactionIndicator;
