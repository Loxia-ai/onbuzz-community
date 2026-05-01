/**
 * UserPromptRenderer
 *
 * The agent paused to ask the user a question. The render is a
 * "service desk receipt" — perforated edges, monospaced fields, a
 * carbon-copy REPLIED stamp when the user has answered.
 *
 * Each question is a form row with:
 *   - a field label
 *   - chips for option choices (multi-select if configured)
 *   - a free-text affordance if allowed
 *   - the user's eventual answer rendered on the carbon copy below
 */

import React, { useMemo } from 'react';
import {
  QuestionMarkCircleIcon,
  CheckBadgeIcon,
  ClockIcon,
  GlobeAltIcon,
  PencilSquareIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { extractResult } from './usePersistedState';

function Perforation({ top }) {
  return (
    <div className={`flex h-3 w-full ${top ? '-mb-1.5' : '-mt-1.5'}`}>
      {Array.from({ length: 40 }).map((_, i) => (
        <div key={i} className="flex-1 border-t-2 border-dashed border-slate-300 dark:border-slate-700" />
      ))}
    </div>
  );
}

function OptionChip({ label, selected, color = 'slate' }) {
  const palette = {
    slate:   selected ? 'bg-slate-700 text-white border-slate-700' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600',
    emerald: selected ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border font-mono ${palette[color]} ${selected ? 'shadow-sm' : ''}`}>
      {selected && <CheckBadgeIcon className="w-3 h-3" />}
      {label}
    </span>
  );
}

function normaliseAnswer(resp, qId) {
  if (!resp || typeof resp !== 'object') return null;
  // tool returns { q<id>: string | string[] }
  const candidate =
    resp[`q${qId}`] ??
    resp[qId] ??
    resp[String(qId)];
  if (candidate == null) return null;
  return Array.isArray(candidate) ? candidate : [candidate];
}

function QuestionRow({ q, index, answers }) {
  const qId = q.id ?? index;
  const answer = answers ? normaliseAnswer(answers, qId) : null;
  const answered = !!answer && answer.length > 0;

  return (
    <div className="py-2 border-b border-dashed border-slate-300 dark:border-slate-700 last:border-b-0">
      <div className="flex items-start gap-2">
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400 mt-0.5 shrink-0">
          Q{index + 1}.
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-slate-900 dark:text-slate-100 leading-snug">
            {q.message}
            {q.required && <span className="text-rose-500 ml-1">*</span>}
          </div>

          {/* flags */}
          {(q.allowFreeText || q.allowWebSearch || q.multiSelect) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {q.allowFreeText && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <PencilSquareIcon className="w-3 h-3" /> free-text
                </span>
              )}
              {q.allowWebSearch && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <GlobeAltIcon className="w-3 h-3" /> web
                </span>
              )}
              {q.multiSelect && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  ⊞ multi-select
                </span>
              )}
            </div>
          )}

          {/* options */}
          {Array.isArray(q.options) && q.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {q.options.map((opt, i) => {
                const label = typeof opt === 'string' ? opt : (opt.label || opt.value || String(opt));
                const picked = answered && answer.some(a => String(a) === String(label));
                return <OptionChip key={i} label={label} selected={picked} color={picked ? 'emerald' : 'slate'} />;
              })}
            </div>
          )}

          {/* carbon-copy answer */}
          {answered && (
            <div className="mt-2 bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-mono">answer</div>
              <div className="text-sm text-slate-900 dark:text-slate-100 whitespace-pre-wrap">
                {answer.length > 1 ? answer.join(', ') : answer[0]}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RepliedStamp({ size = 'lg' }) {
  const s = size === 'lg' ? 'text-4xl' : 'text-2xl';
  return (
    <div className="pointer-events-none absolute top-4 right-6 rotate-[-14deg] select-none opacity-80">
      <div className={`${s} font-black tracking-[0.2em] text-emerald-600/80 dark:text-emerald-400/80 border-[3px] border-emerald-600/80 dark:border-emerald-400/80 px-3 py-1 rounded`}>
        REPLIED
      </div>
    </div>
  );
}

function parseUserPromptInvocation(parsedData) {
  if (!parsedData) return null;
  return {
    action: parsedData.action || 'prompt',
    message: parsedData.message,
    questions: parsedData.questions || [],
    requestId: parsedData.requestId,
  };
}

function UserPromptRenderer({ parsedData }) {
  const inv = useMemo(() => parseUserPromptInvocation(parsedData), [parsedData]);
  const { hasResults, result, success, error } = extractResult(parsedData);

  if (!inv) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 text-sm">
        <QuestionMarkCircleIcon className="w-4 h-4" />
        <span>User prompt (no input parsed)</span>
      </div>
    );
  }

  const answers = result?.response;
  const formattedResponse = result?.formattedResponse;
  const requestId = result?.requestId || inv.requestId;
  const awaiting = !hasResults && !error;

  return (
    <div className="my-2 relative">
      <Perforation top />
      <div className="border-x border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-inner relative">
        {/* Header — receipt title */}
        <div className="px-4 py-3 border-b-2 border-double border-slate-400 dark:border-slate-600 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
            <ChatBubbleLeftRightIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Agent ⇢ User · Prompt Form
            </div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate font-mono">
              {inv.questions.length === 1
                ? '1 question'
                : `${inv.questions.length} questions`}
              {requestId && <span className="text-slate-500 ml-2 text-xs font-normal">· {String(requestId).slice(-8)}</span>}
            </div>
          </div>
          {awaiting && (
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs">
              <ClockIcon className="w-4 h-4 animate-pulse" />
              <span>awaiting reply</span>
            </div>
          )}
        </div>

        {/* Optional message preamble */}
        {inv.message && (
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 text-sm text-slate-800 dark:text-slate-200 italic border-b border-dashed border-slate-300 dark:border-slate-700">
            {inv.message}
          </div>
        )}

        {/* Form rows */}
        <div className="px-4 py-1">
          {inv.questions.length === 0 && (
            <div className="py-4 text-center italic text-slate-500 text-sm">
              (no questions in this prompt)
            </div>
          )}
          {inv.questions.map((q, i) => (
            <QuestionRow key={q.id ?? i} q={q} index={i} answers={answers} />
          ))}
        </div>

        {/* Footer */}
        {error && (
          <div className="px-4 py-2 border-t border-dashed border-slate-300 dark:border-slate-700 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 text-sm">
            {error}
          </div>
        )}
        {hasResults && success && formattedResponse && inv.questions.length > 1 && (
          <div className="px-4 py-2 border-t border-dashed border-slate-300 dark:border-slate-700 bg-emerald-50 dark:bg-emerald-900/20">
            <div className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-1">Consolidated response</div>
            <div className="text-sm text-emerald-900 dark:text-emerald-100 whitespace-pre-wrap font-mono">
              {formattedResponse}
            </div>
          </div>
        )}

        {hasResults && success && <RepliedStamp size={inv.questions.length > 1 ? 'lg' : 'sm'} />}
      </div>
      <Perforation />
    </div>
  );
}

export default UserPromptRenderer;
