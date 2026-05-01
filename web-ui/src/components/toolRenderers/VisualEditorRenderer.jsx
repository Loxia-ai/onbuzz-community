/**
 * VisualEditorRenderer
 *
 * The visual-editor tool has three classes of action — a one-size-fits-all
 * status pill was hiding the actual output of 9 of the 13 actions. The
 * renderer now picks one of three layouts depending on what the action is
 * conceptually doing:
 *
 *   1. SERVER/SESSION (get-context, get-status, clear-context, start-server,
 *      serve-static, detect-project) — a little server-console card with
 *      host:port + framework badge + detected-files list.
 *
 *   2. NAVIGATION (set-app-url, open-editor, reload, set-mode) — a mini
 *      browser frame showing the app URL in a fake URL bar, mode chip
 *      for select/edit/preview.
 *
 *   3. DOM MANIPULATION (highlight, scroll-to, get-source) — a
 *      "selector-picker" card with a proportional faux-viewport SVG
 *      drawing the targeted element's bounding box, the CSS selector in
 *      monospace, and a reveal-source expander for get-source.
 *
 * In all three classes the chrome is consistent — same indigo header with
 * action label + status chip — so the renderer still reads as one coherent
 * tool even across layouts.
 */

import React, { useMemo, useState } from 'react';
import {
  EyeIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ArrowTopRightOnSquareIcon,
  MagnifyingGlassIcon,
  GlobeAltIcon,
  ServerIcon,
  CursorArrowRaysIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  ArrowsUpDownIcon,
  CodeBracketIcon,
  TrashIcon,
  PencilSquareIcon,
  CommandLineIcon,
  SwatchIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';

/* ------------------------------------------------------------------ */
/*  Action class taxonomy                                               */
/* ------------------------------------------------------------------ */

const SERVER_ACTIONS = new Set([
  'get-context', 'get-status', 'clear-context',
  'start-server', 'serve-static', 'detect-project',
]);
const NAV_ACTIONS = new Set([
  'set-app-url', 'open-editor', 'reload', 'set-mode',
]);
const DOM_ACTIONS = new Set([
  'highlight', 'scroll-to', 'get-source',
]);

const ACTION_META = {
  'get-context':    { Icon: EyeIcon,              label: 'Context snapshot' },
  'get-status':     { Icon: ServerIcon,           label: 'Server status' },
  'clear-context':  { Icon: TrashIcon,            label: 'Clear context' },
  'start-server':   { Icon: BoltIcon,             label: 'Start server' },
  'serve-static':   { Icon: ServerIcon,           label: 'Serve static' },
  'detect-project': { Icon: MagnifyingGlassIcon,  label: 'Detect project' },
  'set-app-url':    { Icon: GlobeAltIcon,         label: 'Set app URL' },
  'open-editor':    { Icon: PencilSquareIcon,     label: 'Open editor' },
  'reload':         { Icon: ArrowPathIcon,        label: 'Reload' },
  'set-mode':       { Icon: SwatchIcon,           label: 'Set mode' },
  'highlight':      { Icon: CursorArrowRaysIcon,  label: 'Highlight' },
  'scroll-to':      { Icon: ArrowsUpDownIcon,     label: 'Scroll to' },
  'get-source':     { Icon: CodeBracketIcon,      label: 'Read source' },
};

/* ------------------------------------------------------------------ */
/*  Small presentational bits                                           */
/* ------------------------------------------------------------------ */

function StatusChip({ hasResult, failed }) {
  if (!hasResult) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        running…
      </span>
    );
  }
  if (failed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
        <ExclamationCircleIcon className="w-3.5 h-3.5" /> failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
      <CheckCircleIcon className="w-3.5 h-3.5" /> ok
    </span>
  );
}

function Pill({ label, value, color = 'indigo' }) {
  const palette = {
    indigo:  'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    amber:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    sky:     'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
    rose:    'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
    slate:   'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded ${palette[color]}`}>
      {label && <span className="uppercase tracking-wider opacity-60">{label}</span>}
      <span>{value}</span>
    </span>
  );
}

function Shell({ action, hasResult, failed, children }) {
  const meta = ACTION_META[action] || { Icon: EyeIcon, label: action || 'visual-editor' };
  const Icon = meta.Icon;
  return (
    <div className="my-2 rounded-lg border border-indigo-200 dark:border-indigo-900/50 bg-white dark:bg-indigo-950/10 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/60 dark:to-purple-950/60 border-b border-indigo-200/60 dark:border-indigo-900/50">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-sm">
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-indigo-700/70 dark:text-indigo-300/70">
            Visual Editor
          </div>
          <div className="text-sm font-medium text-indigo-950 dark:text-indigo-100 truncate">
            {meta.label} <span className="text-xs font-mono text-indigo-700/60 dark:text-indigo-300/60">· {action}</span>
          </div>
        </div>
        <StatusChip hasResult={hasResult} failed={failed} />
      </div>
      <div className="p-3">
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Layout 1 — Server / session card                                    */
/* ------------------------------------------------------------------ */

function ServerLayout({ action, params, result }) {
  // Common projections — tools emit variants across actions
  const port      = result?.port ?? params?.port;
  const host      = result?.host ?? 'localhost';
  const pid       = result?.pid;
  const framework = result?.framework || result?.context?.framework;
  const dir       = result?.directory || result?.workingDirectory || params?.directory;
  const files     = result?.files || result?.context?.files || result?.detectedFiles;
  const running   = result?.running ?? result?.isRunning;
  const editorUrl = result?.editorUrl;
  const appUrl    = result?.appUrl;
  const uptime    = result?.uptime;
  const cleared   = action === 'clear-context' && result?.success !== false;

  if (cleared) {
    return (
      <div className="flex items-center gap-2 text-sm text-indigo-900 dark:text-indigo-100">
        <TrashIcon className="w-4 h-4 text-indigo-500" />
        <span>Context cleared.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Server address line — monospaced like a terminal status */}
      <div className="flex flex-wrap items-center gap-1.5">
        {port != null && <Pill label="host" value={`${host}:${port}`} color="emerald" />}
        {running === true && <Pill value="running" color="emerald" />}
        {running === false && <Pill value="stopped" color="rose" />}
        {framework && <Pill label="framework" value={framework} color="sky" />}
        {pid && <Pill label="pid" value={pid} color="slate" />}
        {typeof uptime === 'number' && <Pill label="up" value={`${Math.round(uptime)}s`} color="slate" />}
      </div>

      {dir && (
        <div className="flex items-center gap-1.5 text-xs text-indigo-900/70 dark:text-indigo-100/70 font-mono truncate">
          <ServerIcon className="w-3.5 h-3.5 shrink-0 opacity-60" />
          <span className="truncate" title={dir}>{dir}</span>
        </div>
      )}

      {(editorUrl || appUrl) && (
        <div className="flex flex-wrap items-center gap-3 text-xs pt-1">
          {editorUrl && (
            <a href={editorUrl} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline">
              Open editor <ArrowTopRightOnSquareIcon className="w-3 h-3" />
            </a>
          )}
          {appUrl && <span className="text-indigo-700/60 dark:text-indigo-300/60 font-mono truncate max-w-[320px]">{appUrl}</span>}
        </div>
      )}

      {Array.isArray(files) && files.length > 0 && (
        <DetectedFiles files={files} />
      )}

      {result?.message && (
        <div className="text-xs text-indigo-800/80 dark:text-indigo-200/80 italic">
          {result.message}
        </div>
      )}
    </div>
  );
}

function DetectedFiles({ files }) {
  const [open, setOpen] = useState(false);
  const visible = open ? files : files.slice(0, 4);
  return (
    <div className="border-t border-indigo-200/40 dark:border-indigo-900/30 pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1 text-[11px] uppercase tracking-wider text-indigo-700/70 dark:text-indigo-300/70 hover:text-indigo-900 dark:hover:text-indigo-100"
      >
        {open ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}
        Detected files ({files.length})
      </button>
      <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-indigo-900/80 dark:text-indigo-100/80">
        {visible.map((f, i) => {
          const path = typeof f === 'string' ? f : (f.path || f.name || JSON.stringify(f));
          return <li key={i} className="truncate pl-4" title={path}>{path}</li>;
        })}
      </ul>
      {!open && files.length > 4 && (
        <div className="pl-4 text-[11px] text-indigo-700/50 dark:text-indigo-300/50 italic">
          +{files.length - 4} more…
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Layout 2 — Mini browser frame                                       */
/* ------------------------------------------------------------------ */

const MODE_STYLES = {
  select:  { label: 'SELECT',  color: 'bg-sky-500' },
  edit:    { label: 'EDIT',    color: 'bg-emerald-500' },
  preview: { label: 'PREVIEW', color: 'bg-indigo-500' },
};

function NavLayout({ action, params, result }) {
  const appUrl = result?.appUrl || params?.url || params?.appUrl || '';
  const editorUrl = result?.editorUrl;
  const mode = result?.mode || params?.mode;
  const modeMeta = mode && MODE_STYLES[String(mode).toLowerCase()];

  return (
    <div>
      {/* mini browser frame */}
      <div className="rounded-md border border-indigo-200/60 dark:border-indigo-900/50 overflow-hidden bg-white dark:bg-slate-900">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-100 dark:bg-slate-800 border-b border-indigo-200/60 dark:border-indigo-900/50">
          <div className="flex gap-1">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            <span className="w-2 h-2 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-1 bg-white dark:bg-slate-900 rounded px-2 py-0.5 text-[11px] font-mono text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-700">
            <GlobeAltIcon className="w-3 h-3 text-gray-400 shrink-0" />
            <span className="truncate">{appUrl || <span className="italic opacity-60">(no URL set)</span>}</span>
          </div>
          {modeMeta && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider text-white ${modeMeta.color}`}>
              {modeMeta.label}
            </span>
          )}
        </div>
        {/* Body — action-specific fake viewport */}
        <div className="h-24 relative bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">
          {action === 'reload' ? (
            <div className="flex items-center gap-2">
              <ArrowPathIcon className="w-5 h-5 animate-spin" style={{ animationDuration: '1.4s' }} />
              <span>Reloaded</span>
            </div>
          ) : action === 'open-editor' ? (
            <div className="flex items-center gap-2">
              <PencilSquareIcon className="w-5 h-5" />
              <span>Editor attached</span>
            </div>
          ) : action === 'set-mode' ? (
            <div className="flex items-center gap-2">
              <SwatchIcon className="w-5 h-5" />
              <span>Mode → {modeMeta?.label.toLowerCase() || mode || '?'}</span>
            </div>
          ) : (
            <span className="italic">{appUrl ? 'App URL set' : '—'}</span>
          )}
        </div>
      </div>

      {/* CTA row */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {editorUrl && (
          <a href={editorUrl} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline">
            Open editor <ArrowTopRightOnSquareIcon className="w-3 h-3" />
          </a>
        )}
        {appUrl && (
          <a href={appUrl} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:underline">
            Open app <ArrowTopRightOnSquareIcon className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Layout 3 — DOM selector-picker card                                 */
/* ------------------------------------------------------------------ */

function DOMLayout({ action, params, result }) {
  const selector = params?.selector || result?.selector;
  const bbox     = result?.boundingBox || result?.rect || result?.bbox; // {x,y,width,height}
  const tagName  = result?.tagName || result?.element?.tagName;
  const classes  = result?.classes || result?.element?.classes || [];
  const source   = result?.source || result?.html || result?.outerHTML;
  const scrolled = action === 'scroll-to' && result?.scrolled !== false;

  // Assume a canonical viewport if the tool only sends back the bbox —
  // use bbox.viewport if provided, else 1280×720.
  const vw = result?.viewport?.width ?? 1280;
  const vh = result?.viewport?.height ?? 720;

  return (
    <div className="space-y-2">
      {/* selector chip */}
      {selector && (
        <div className="flex items-center gap-2">
          <CursorArrowRaysIcon className="w-4 h-4 text-indigo-500 shrink-0" />
          <code className="text-xs font-mono bg-slate-100 dark:bg-slate-800 text-indigo-900 dark:text-indigo-100 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 truncate">
            {selector}
          </code>
          {tagName && <Pill label="tag" value={tagName.toLowerCase()} color="sky" />}
        </div>
      )}

      {/* faux viewport with highlighted bbox */}
      {bbox && typeof bbox.x === 'number' && typeof bbox.width === 'number' && (
        <ViewportSketch vw={vw} vh={vh} bbox={bbox} scrolled={scrolled} />
      )}

      {/* classes */}
      {classes?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {classes.map((c, i) => (
            <span key={i} className="text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1 rounded">
              .{c}
            </span>
          ))}
        </div>
      )}

      {/* source expander */}
      {source && <SourceExpander source={source} />}
    </div>
  );
}

function ViewportSketch({ vw, vh, bbox, scrolled }) {
  // project bbox into a 280×160 svg proportionally
  const W = 280, H = 160;
  const scale = Math.min(W / vw, H / vh);
  const ox = (W - vw * scale) / 2;
  const oy = (H - vh * scale) / 2;
  const rx = ox + bbox.x * scale;
  const ry = oy + bbox.y * scale;
  const rw = Math.max(2, bbox.width * scale);
  const rh = Math.max(2, bbox.height * scale);

  return (
    <div className="border border-indigo-200/60 dark:border-indigo-900/50 rounded-md bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[160px]">
        {/* viewport rect */}
        <rect x={ox} y={oy} width={vw * scale} height={vh * scale}
              fill="rgba(99,102,241,0.05)" stroke="rgb(99,102,241)" strokeOpacity="0.3" strokeDasharray="4 2" />
        {/* highlighted element */}
        <rect x={rx} y={ry} width={rw} height={rh}
              fill="rgba(16,185,129,0.25)" stroke="rgb(16,185,129)" strokeWidth="1.5">
          <animate attributeName="fill-opacity" values="0.12;0.32;0.12" dur="1.8s" repeatCount="indefinite" />
        </rect>
        {/* scroll-to arrow */}
        {scrolled && (
          <g transform={`translate(${rx + rw / 2}, ${ry - 10})`}>
            <path d="M0,-6 L-4,-1 L-1.5,-1 L-1.5,4 L1.5,4 L1.5,-1 L4,-1 Z" fill="rgb(16,185,129)" />
          </g>
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] font-mono text-indigo-700/60 dark:text-indigo-300/60">
        <span>viewport {vw}×{vh}</span>
        <span>bbox {Math.round(bbox.x)},{Math.round(bbox.y)} {Math.round(bbox.width)}×{Math.round(bbox.height)}</span>
      </div>
    </div>
  );
}

function SourceExpander({ source }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-indigo-200/40 dark:border-indigo-900/30 pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1 text-[11px] uppercase tracking-wider text-indigo-700/70 dark:text-indigo-300/70 hover:text-indigo-900 dark:hover:text-indigo-100"
      >
        {open ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}
        <CodeBracketIcon className="w-3.5 h-3.5" />
        Source <span className="opacity-60 normal-case">({source.length} chars)</span>
      </button>
      {open && (
        <pre className="mt-1 text-[11px] font-mono bg-slate-950 text-slate-100 dark:bg-black dark:text-slate-200 p-2 rounded overflow-x-auto max-h-64 whitespace-pre-wrap">
          {source.length > 4000 ? source.slice(0, 4000) + '\n… (truncated)' : source}
        </pre>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main renderer                                                        */
/* ------------------------------------------------------------------ */

function VisualEditorRenderer({ parsedData }) {
  const action = parsedData?.action || 'visual-editor';
  const hasResult = !!parsedData?._hasResults;
  const result = parsedData?._result || null;
  const failed = hasResult && (parsedData?._status === 'failed' || result?.success === false);

  // parameters were flattened onto parsedData by ToolContentRenderer
  const params = parsedData;

  const layoutClass = useMemo(() => {
    if (SERVER_ACTIONS.has(action)) return 'server';
    if (NAV_ACTIONS.has(action))    return 'nav';
    if (DOM_ACTIONS.has(action))    return 'dom';
    return 'unknown';
  }, [action]);

  return (
    <Shell action={action} hasResult={hasResult} failed={failed}>
      {failed && (result?.error || parsedData?._error) && (
        <div className="mb-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded px-2 py-1 break-words">
          {result?.error || parsedData?._error}
        </div>
      )}
      {!hasResult && (
        <div className="text-xs text-indigo-700/70 dark:text-indigo-300/70 italic flex items-center gap-1.5">
          <CommandLineIcon className="w-3.5 h-3.5" />
          <span>Waiting for result…</span>
        </div>
      )}
      {hasResult && layoutClass === 'server' && (
        <ServerLayout action={action} params={params} result={result || {}} />
      )}
      {hasResult && layoutClass === 'nav' && (
        <NavLayout action={action} params={params} result={result || {}} />
      )}
      {hasResult && layoutClass === 'dom' && (
        <DOMLayout action={action} params={params} result={result || {}} />
      )}
      {hasResult && layoutClass === 'unknown' && result && (
        <pre className="text-xs font-mono bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 p-2 rounded overflow-x-auto whitespace-pre-wrap">
          {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
        </pre>
      )}
    </Shell>
  );
}

export default VisualEditorRenderer;
