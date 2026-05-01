/**
 * SkillsRenderer
 *
 * Skills are persistent capability packs — instructions + bundled files.
 * The renderer frames them as a grimoire: parchment card with a gold-
 * embossed title strip, an illuminated drop-cap for the skill's first
 * letter, section tabs down the side for `sections`, and a bundled-files
 * strip along the bottom (each file as a wax-seal chip).
 *
 * Actions covered:
 *   list / describe / read / read-section / read-file /
 *   create / update / delete / import
 */

import React, { useMemo } from 'react';
import {
  BookOpenIcon,
  SparklesIcon,
  DocumentTextIcon,
  PlusCircleIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowDownOnSquareStackIcon,
  ListBulletIcon,
  FolderOpenIcon,
  HashtagIcon,
} from '@heroicons/react/24/outline';
import { extractResult } from './usePersistedState';

const ACTION_META = {
  list:           { label: 'Grimoire · Index',        Icon: ListBulletIcon,           accent: 'indigo' },
  describe:       { label: 'Grimoire · Chapter Card', Icon: BookOpenIcon,             accent: 'violet' },
  read:           { label: 'Grimoire · Full Chapter', Icon: BookOpenIcon,             accent: 'violet' },
  'read-section': { label: 'Grimoire · Passage',      Icon: DocumentTextIcon,          accent: 'sky' },
  'read-file':    { label: 'Grimoire · Appendix',     Icon: FolderOpenIcon,            accent: 'sky' },
  create:         { label: 'Grimoire · New Chapter',  Icon: PlusCircleIcon,            accent: 'emerald' },
  update:         { label: 'Grimoire · Amendment',    Icon: PencilSquareIcon,          accent: 'amber' },
  delete:         { label: 'Grimoire · Excised',      Icon: TrashIcon,                 accent: 'rose' },
  import:         { label: 'Grimoire · Inscribed',    Icon: ArrowDownOnSquareStackIcon, accent: 'emerald' },
};

function accentClasses(a) {
  return {
    indigo:  { pill: 'from-indigo-600 to-purple-600',   tint: 'text-indigo-200', edge: 'border-indigo-300/60 dark:border-indigo-900/50' },
    violet:  { pill: 'from-violet-600 to-fuchsia-600',  tint: 'text-violet-200', edge: 'border-violet-300/60 dark:border-violet-900/50' },
    sky:     { pill: 'from-sky-600 to-cyan-600',        tint: 'text-sky-100',    edge: 'border-sky-300/60 dark:border-sky-900/50' },
    emerald: { pill: 'from-emerald-600 to-teal-600',    tint: 'text-emerald-100',edge: 'border-emerald-300/60 dark:border-emerald-900/50' },
    amber:   { pill: 'from-amber-600 to-orange-600',    tint: 'text-amber-100',  edge: 'border-amber-300/60 dark:border-amber-900/50' },
    rose:    { pill: 'from-rose-600 to-pink-600',       tint: 'text-rose-100',   edge: 'border-rose-300/60 dark:border-rose-900/50' },
  }[a] || { pill: 'from-indigo-600 to-purple-600', tint: 'text-indigo-100', edge: 'border-indigo-300/60 dark:border-indigo-900/50' };
}

function DropCap({ letter, color = 'indigo' }) {
  return (
    <div className={`relative w-14 h-14 flex items-center justify-center rounded-md bg-gradient-to-br ${
      color === 'emerald' ? 'from-emerald-500 to-teal-600'
      : color === 'amber' ? 'from-amber-500 to-orange-600'
      : color === 'rose'  ? 'from-rose-500 to-pink-600'
      : color === 'violet'? 'from-violet-500 to-fuchsia-600'
      : 'from-indigo-500 to-purple-600'
    } shadow-inner text-white text-3xl font-serif font-bold select-none`}>
      {(letter || '?').toUpperCase()}
      <SparklesIcon className="absolute -top-1 -right-1 w-3.5 h-3.5 text-yellow-200/90" />
    </div>
  );
}

function WaxSeal({ label, title }) {
  const short = (label || '').split(/[\\/]/).pop();
  return (
    <span
      title={title || label}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800 text-[11px] font-mono max-w-[180px]"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
      <span className="truncate">{short}</span>
    </span>
  );
}

function SectionTab({ heading, lineRange }) {
  return (
    <div className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-r-full border-y border-r border-indigo-200/60 dark:border-indigo-900/50 bg-white/60 dark:bg-indigo-950/20 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors">
      <HashtagIcon className="w-3.5 h-3.5 text-indigo-500" />
      <span className="text-sm text-indigo-950 dark:text-indigo-100 truncate">{heading}</span>
      {lineRange && (
        <span className="ml-auto text-[10px] font-mono text-indigo-700/60 dark:text-indigo-300/60">
          {Array.isArray(lineRange) ? `${lineRange[0]}–${lineRange[1]}` : lineRange}
        </span>
      )}
    </div>
  );
}

function parseSkillsInvocation(parsedData) {
  if (!parsedData) return null;
  return {
    action: parsedData.action,
    name:   parsedData.name,
    section:parsedData.section,
    file:   parsedData.file,
    source: parsedData.source,
    description: parsedData.description,
    content: parsedData.content,
    files:   parsedData.files,
  };
}

function SkillsRenderer({ parsedData }) {
  const inv = useMemo(() => parseSkillsInvocation(parsedData), [parsedData]);
  const { hasResults, result, success, error } = extractResult(parsedData);

  if (!inv) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 text-sm">
        <BookOpenIcon className="w-4 h-4" />
        <span>Skills (no input parsed)</span>
      </div>
    );
  }

  const action = inv.action || 'read';
  const meta   = ACTION_META[action] || ACTION_META.read;
  const a      = accentClasses(meta.accent);
  const Icon   = meta.Icon;

  const payload = result?.result || result;
  const name    = inv.name || payload?.name || payload?.skill?.name;

  return (
    <div className={`my-2 rounded-lg overflow-hidden border ${a.edge} shadow-md bg-[#fdfbf4] dark:bg-gradient-to-br dark:from-indigo-950/70 dark:to-purple-950/50`}>
      {/* embossed title strip */}
      <div className={`px-4 py-3 bg-gradient-to-r ${a.pill} text-white flex items-center gap-3 relative overflow-hidden`}>
        {/* subtle filigree */}
        <div className="absolute inset-0 opacity-20 pointer-events-none"
             style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(255,255,255,0.6) 0, transparent 30%), radial-gradient(circle at 80% 50%, rgba(255,255,255,0.4) 0, transparent 30%)' }} />
        <Icon className="w-5 h-5 relative" />
        <div className="relative flex-1 min-w-0">
          <div className={`text-[10px] uppercase tracking-[0.2em] ${a.tint}`}>{meta.label}</div>
          <div className="text-base font-serif font-semibold truncate">
            {name || <span className="italic opacity-80">(all skills)</span>}
            {inv.section && <span className="text-sm font-normal italic opacity-80"> · {inv.section}</span>}
            {inv.file && <span className="text-sm font-normal italic opacity-80 font-mono"> · {inv.file}</span>}
          </div>
        </div>
        {hasResults && (
          <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${success ? 'bg-emerald-500/30 text-emerald-50' : 'bg-rose-500/30 text-rose-50'}`}>
            {success ? 'ok' : 'failed'}
          </span>
        )}
      </div>

      {/* parchment body */}
      <div className="p-4 space-y-3" style={{
        backgroundImage: 'repeating-linear-gradient(180deg, transparent 0, transparent 27px, rgba(99,102,241,0.05) 28px)',
      }}>
        {error && (
          <div className="px-3 py-2 text-sm bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-200 border border-rose-200 dark:border-rose-800 rounded">
            {error}
          </div>
        )}

        {/* LIST — index page */}
        {action === 'list' && Array.isArray(payload) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {payload.length === 0 && (
              <div className="col-span-2 text-center text-indigo-700/60 dark:text-indigo-300/60 italic py-4">
                No skills in the grimoire yet.
              </div>
            )}
            {payload.map((s) => (
              <div key={s.name} className="flex items-start gap-3 p-2 rounded-md border border-indigo-200/60 dark:border-indigo-900/40 bg-white/60 dark:bg-indigo-950/20">
                <DropCap letter={s.name?.[0]} color="indigo" />
                <div className="flex-1 min-w-0">
                  <div className="font-serif font-semibold text-indigo-950 dark:text-indigo-100 truncate">{s.name}</div>
                  {s.description && (
                    <div className="text-xs text-indigo-800/80 dark:text-indigo-200/80 line-clamp-2 mt-0.5">{s.description}</div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-indigo-700/70 dark:text-indigo-300/70 font-mono">
                    {s.lineCount != null && <span>{s.lineCount} lines</span>}
                    {s.fileCount != null && <span>{s.fileCount} files</span>}
                    {Array.isArray(s.sections) && s.sections.length > 0 && <span>{s.sections.length} sections</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* DESCRIBE — chapter card */}
        {action === 'describe' && payload && !Array.isArray(payload) && (
          <div className="flex gap-4">
            <DropCap letter={name?.[0]} color="violet" />
            <div className="flex-1 min-w-0">
              {payload.description && (
                <p className="text-sm text-indigo-950 dark:text-indigo-100 font-serif italic mb-3">
                  {payload.description}
                </p>
              )}
              {Array.isArray(payload.sections) && payload.sections.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-indigo-700/70 dark:text-indigo-300/70 mb-1">Sections</div>
                  {payload.sections.map((sec, i) => (
                    <SectionTab key={i} heading={sec.heading} lineRange={sec.lineRange} />
                  ))}
                </div>
              )}
              {Array.isArray(payload.files) && payload.files.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-wider text-indigo-700/70 dark:text-indigo-300/70 mb-1">Bundled files</div>
                  <div className="flex flex-wrap gap-1.5">
                    {payload.files.map((f, i) => (
                      <WaxSeal key={i} label={typeof f === 'string' ? f : f.path || f.name} />
                    ))}
                  </div>
                </div>
              )}
              {payload.size != null && (
                <div className="mt-2 text-[11px] font-mono text-indigo-700/60 dark:text-indigo-300/60">
                  {payload.size} bytes
                </div>
              )}
            </div>
          </div>
        )}

        {/* READ / READ-SECTION / READ-FILE — content body */}
        {(action === 'read' || action === 'read-section' || action === 'read-file') && payload?.content && (
          <div className="relative">
            <div className="rounded-md border border-indigo-200/60 dark:border-indigo-900/50 bg-white/70 dark:bg-indigo-950/30 max-h-[520px] overflow-auto">
              <pre className="whitespace-pre-wrap font-mono text-sm text-indigo-950 dark:text-indigo-100 p-4 leading-relaxed">
                {payload.content}
              </pre>
            </div>
            {Array.isArray(payload.files) && payload.files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-indigo-700/70 dark:text-indigo-300/70 self-center mr-1">Appendix:</span>
                {payload.files.map((f, i) => (
                  <WaxSeal key={i} label={typeof f === 'string' ? f : f.path || f.name} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* CREATE / UPDATE / IMPORT — confirmation stamp */}
        {(action === 'create' || action === 'update' || action === 'import') && (
          <div className="flex items-center gap-3 text-sm text-indigo-950 dark:text-indigo-100">
            <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 border-2 border-emerald-400 dark:border-emerald-600 flex items-center justify-center">
              <SparklesIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div className="flex-1">
              <div className="font-serif font-semibold">
                {action === 'create' ? 'New chapter inscribed' :
                 action === 'import' ? 'Chapter imported' : 'Chapter amended'}
              </div>
              <div className="text-xs text-indigo-800/70 dark:text-indigo-200/70 font-mono">
                {name}
                {inv.source && <> · from <span className="italic">{inv.source}</span></>}
              </div>
            </div>
          </div>
        )}

        {/* DELETE */}
        {action === 'delete' && (
          <div className="flex items-center gap-3 text-sm text-rose-900 dark:text-rose-100">
            <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/40 border-2 border-rose-400 dark:border-rose-600 flex items-center justify-center">
              <TrashIcon className="w-5 h-5 text-rose-600 dark:text-rose-300" />
            </div>
            <div>
              <div className="font-serif font-semibold">Chapter excised</div>
              <div className="text-xs text-rose-700/70 dark:text-rose-300/70 font-mono">{name}</div>
            </div>
          </div>
        )}

        {/* Executing placeholder */}
        {!hasResults && (
          <div className="flex items-center gap-2 text-xs text-indigo-700/70 dark:text-indigo-300/70 italic">
            <SparklesIcon className="w-3.5 h-3.5 animate-pulse" />
            <span>Consulting the grimoire…</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default SkillsRenderer;
