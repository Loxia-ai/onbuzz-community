/**
 * HelpRenderer
 *
 * Renders the help tool's output as a command-palette card —
 * the kind users recognize from ⌘K overlays. Two main surfaces:
 *
 *   - list-tools → palette with one row per tool, id in mono, summary below,
 *                  plus a fake ⏎ affordance; grouping by rough category.
 *   - get-description → tool-card with supported actions as keyboard-style chips.
 */

import React, { useMemo } from 'react';
import {
  MagnifyingGlassIcon,
  CommandLineIcon,
  ChevronRightIcon,
  BoltIcon,
  BookOpenIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { extractResult } from './usePersistedState';

/* rough category taxonomy for grouping in list view */
function categorize(id) {
  if (/file|tree|content|doc|pdf|spreadsheet/.test(id))   return '📁 files & docs';
  if (/task|jobdone|help/.test(id))                        return '📋 workflow';
  if (/agent|user/.test(id))                               return '🤝 agents & humans';
  if (/memory|skills/.test(id))                            return '🧠 memory & skills';
  if (/visual/.test(id))                                   return '🎨 visual editor';
  if (/web/.test(id))                                      return '🌐 external';
  if (/terminal|clone|static|code-map|import|dependency|seek/.test(id)) return '⚙️ code ops';
  return '✨ other';
}

function KbdChip({ label }) {
  return (
    <kbd className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-gradient-to-b from-slate-50 to-slate-200 dark:from-slate-700 dark:to-slate-800 text-[10px] font-mono text-slate-700 dark:text-slate-200 shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)]">
      {label}
    </kbd>
  );
}

function parseHelpInvocation(parsedData) {
  if (!parsedData) return null;
  return {
    action: parsedData.action,
    tool:   parsedData.tool || parsedData.toolId,
    list:   parsedData.list,
  };
}

function ToolRow({ tool, summary }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800/60 group cursor-default">
      <div className="w-7 h-7 rounded bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-sm">
        <WrenchScrewdriverIcon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono">
          {tool}
        </div>
        {summary && (
          <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
            {summary}
          </div>
        )}
      </div>
      <ChevronRightIcon className="w-4 h-4 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      <KbdChip label="⏎" />
    </div>
  );
}

function HelpRenderer({ parsedData }) {
  const inv = useMemo(() => parseHelpInvocation(parsedData), [parsedData]);
  const { hasResults, result, success, error } = extractResult(parsedData);

  if (!inv) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 text-sm">
        <BookOpenIcon className="w-4 h-4" />
        <span>Help (no input parsed)</span>
      </div>
    );
  }

  const action = inv.action || (inv.tool ? 'get-description' : 'list-tools');

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-700 shadow-xl bg-white dark:bg-slate-900">
      {/* Palette search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-b from-white to-slate-50 dark:from-slate-800 dark:to-slate-900">
        <MagnifyingGlassIcon className="w-4 h-4 text-slate-400" />
        <div className="flex-1 text-sm font-mono text-slate-700 dark:text-slate-200">
          {action === 'list-tools'
            ? '> tools'
            : `> tool ${inv.tool || ''}`}
        </div>
        <KbdChip label="esc" />
      </div>

      <div className="p-2">
        {error && (
          <div className="px-3 py-2 text-sm bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-200 rounded">
            {error}
          </div>
        )}

        {/* LIST-TOOLS */}
        {action === 'list-tools' && Array.isArray(result?.tools) && (() => {
          const groups = {};
          for (const t of result.tools) {
            const cat = categorize(t.id);
            (groups[cat] = groups[cat] || []).push(t);
          }
          const ordered = Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
          return (
            <div className="space-y-3">
              {ordered.map(([cat, items]) => (
                <div key={cat}>
                  <div className="px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {cat}
                  </div>
                  <div className="space-y-0.5">
                    {items.map((t) => (
                      <ToolRow key={t.id} tool={t.id} summary={t.summary} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* GET-DESCRIPTION */}
        {action === 'get-description' && result && (
          <div className="px-3 py-2 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow">
                <BoltIcon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono">
                  {result.toolId || inv.tool}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Tool
                </div>
              </div>
            </div>

            {result.description && (
              <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                {result.description}
              </div>
            )}

            {Array.isArray(result.supportedActions) && result.supportedActions.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Supported actions
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {result.supportedActions.map((a) => (
                    <KbdChip key={a} label={a} />
                  ))}
                </div>
              </div>
            )}

            {result.output && (
              <details className="mt-2">
                <summary className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1">
                  <CommandLineIcon className="w-3.5 h-3.5" /> Raw output
                </summary>
                <pre className="mt-1 text-xs font-mono bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded p-2 overflow-auto whitespace-pre-wrap">
                  {result.output}
                </pre>
              </details>
            )}
          </div>
        )}

        {!hasResults && !error && (
          <div className="px-3 py-6 text-center text-xs italic text-slate-500">
            Loading palette…
          </div>
        )}
      </div>
    </div>
  );
}

export default HelpRenderer;
