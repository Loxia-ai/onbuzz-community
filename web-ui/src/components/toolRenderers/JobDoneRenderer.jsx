/**
 * JobDoneRenderer Component
 *
 * A terminal-state ribbon for `jobdone`:
 * - Success → tri-colour champagne banner with a CSS confetti burst that
 *   fires once (persisted via usePersistedToggle so the same message
 *   doesn't re-fire every render).
 * - Failure → amber warning ribbon.
 * - Expandable details drawer on both paths.
 */

import React, { useEffect } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SparklesIcon,
  TrophyIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';
import { usePersistedToggle } from './usePersistedState';

/* ------------------------------------------------------------------ */
/*  Confetti — pure CSS, one-shot                                       */
/* ------------------------------------------------------------------ */

const CONFETTI_COLORS = ['#fde047', '#86efac', '#7dd3fc', '#f0abfc', '#fca5a5', '#c4b5fd'];
const CONFETTI_COUNT  = 32;

function Confetti() {
  // generate positions once per mount — stable during animation
  const pieces = React.useMemo(
    () => Array.from({ length: CONFETTI_COUNT }).map((_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.3,
      duration: 1.1 + Math.random() * 0.9,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 6 + Math.round(Math.random() * 6),
      rot: Math.round(Math.random() * 360),
    })),
    []
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>{`
        @keyframes jd-confetti-fall {
          0%   { transform: translate3d(0,-20%,0) rotate(0deg); opacity: 0; }
          10%  { opacity: 1; }
          100% { transform: translate3d(var(--dx), 180%, 0) rotate(var(--rot)); opacity: 0; }
        }
      `}</style>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute top-0 rounded-sm"
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size * 0.4}px`,
            backgroundColor: p.color,
            ['--dx']: `${(p.left - 50) * 0.6}%`,
            ['--rot']: `${p.rot}deg`,
            animation: `jd-confetti-fall ${p.duration}s ${p.delay}s cubic-bezier(.2,.4,.3,1) forwards`,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  parsing                                                             */
/* ------------------------------------------------------------------ */

function parseJobDone(parsedData) {
  if (!parsedData) return null;
  if (parsedData.actions?.length > 0) {
    const action = parsedData.actions[0];
    return {
      summary: action.summary || 'Task completed',
      success: action.success !== false,
      details: action.details,
    };
  }
  if (parsedData.summary) {
    return {
      summary: parsedData.summary,
      success: parsedData.success !== false,
      details: parsedData.details,
    };
  }
  if (parsedData.parameters) {
    return {
      summary: parsedData.parameters.summary || 'Task completed',
      success: parsedData.parameters.success !== false,
      details: parsedData.parameters.details,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Main                                                                */
/* ------------------------------------------------------------------ */

function JobDoneRenderer({ parsedData, messageTimestamp, index }) {
  const data = parseJobDone(parsedData);
  const [showDetails, toggleDetails] = usePersistedToggle('jobdone-details', messageTimestamp, index, false);
  // confettiSpent flips to true once the burst animation has played.
  const [confettiSpent, , setConfettiSpent] = usePersistedToggle('jobdone-confetti', messageTimestamp, index, false);

  useEffect(() => {
    if (!data?.success || confettiSpent) return;
    // Matches longest confetti duration + headroom.
    const t = setTimeout(() => setConfettiSpent(true), 2200);
    return () => clearTimeout(t);
  }, [data?.success, confettiSpent, setConfettiSpent]);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 my-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300">
        <CheckCircleIcon className="w-5 h-5" />
        <span className="text-sm font-medium">Task completed</span>
      </div>
    );
  }

  const { summary, success, details } = data;

  if (success) {
    return (
      <div className="my-2 rounded-lg overflow-hidden border border-emerald-200 dark:border-emerald-800 shadow-md relative">
        {/* Champagne banner */}
        <div className="relative flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500 text-white overflow-hidden">
          {!confettiSpent && <Confetti />}
          <div className="relative shrink-0">
            <TrophyIcon className="w-9 h-9 text-yellow-200 drop-shadow" />
            <SparklesIcon className="w-4 h-4 absolute -top-1 -right-1 text-yellow-100 animate-pulse" />
          </div>
          <div className="relative flex-1 min-w-0">
            <div className="font-bold text-lg tracking-wide">Done!</div>
            <div className="text-sm text-emerald-50/95 truncate">{summary}</div>
          </div>
          <CheckCircleSolidIcon className="relative w-6 h-6 text-emerald-50/80 shrink-0 hidden sm:block" />
        </div>

        {/* Details drawer */}
        {details && (
          <div className="bg-emerald-50 dark:bg-emerald-900/20">
            <button
              onClick={toggleDetails}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
            >
              {showDetails
                ? <ChevronDownIcon className="w-4 h-4" />
                : <ChevronRightIcon className="w-4 h-4" />}
              <span>Details</span>
            </button>
            {showDetails && (
              <div className="px-4 pb-3 text-sm text-emerald-800 dark:text-emerald-200 whitespace-pre-wrap">
                {details}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-amber-200 dark:border-amber-800">
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white">
        <ExclamationTriangleIcon className="w-7 h-7" />
        <div className="flex-1">
          <div className="font-semibold">Stopped</div>
          <div className="text-sm text-amber-100">{summary}</div>
        </div>
      </div>
      {details && (
        <div className="bg-amber-50 dark:bg-amber-900/20">
          <button
            onClick={toggleDetails}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
          >
            {showDetails
              ? <ChevronDownIcon className="w-4 h-4" />
              : <ChevronRightIcon className="w-4 h-4" />}
            <span>Details</span>
          </button>
          {showDetails && (
            <div className="px-4 pb-3 text-sm text-amber-800 dark:text-amber-200 whitespace-pre-wrap">
              {details}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default JobDoneRenderer;
