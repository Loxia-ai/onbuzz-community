/**
 * WebToolRenderer Component
 *
 * Displays web/browser automation results including screenshots,
 * navigation status, page interaction feedback, and per-action success/failure.
 */

import React, { useMemo } from 'react';
import { usePersistedToggle } from './usePersistedState';
import {
  GlobeAltIcon,
  CursorArrowRaysIcon,
  CameraIcon,
  DocumentTextIcon,
  ChevronDownIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  ArrowPathIcon,
  HandRaisedIcon,
  ArrowsPointingOutIcon,
  LockClosedIcon,
  EyeIcon,
  CodeBracketSquareIcon,
  CommandLineIcon,
  PencilSquareIcon,
  RectangleGroupIcon,
  ChevronUpDownIcon,
} from '@heroicons/react/24/outline';

function parseWebData(parsedData) {
  if (!parsedData) return null;
  const params = parsedData.parameters || parsedData;

  // Parse nested result data from the enriched parsedData flow.
  // Also merge `_result` which ToolContentRenderer sets on the flattened
  // parsedData when a tool result arrives.
  const resultData = parsedData._result || parsedData.data || {};
  const nestedResults = resultData.results || params.results || [];

  // Actions from input params
  const inputActions = params.actions || params.commands || [];

  // Determine the operation performed
  const operation = params.operation || parsedData.operation || resultData.operation || '';

  // Build a unified actions list with result status
  const actions = [];
  if (nestedResults.length > 0) {
    for (const r of nestedResults) {
      actions.push({
        type: r.action || r.type || 'unknown',
        url: r.url,
        selector: r.selector,
        text: r.text,
        value: r.value,
        key: r.key,
        success: r.success,
        error: r.error,
        warning: r.warning,
        httpStatus: r.httpStatus,
        waited: r.waited,
        links: r.links,
        extractedText: r.text,
        // Rich per-action payloads (surfaced by specialized rows below)
        analysis: r.analysis,
        screenshot: r.screenshot,
        consoleLines: r.console || r.consoleLines || r.logs,
        evalResult: r.evalResult || r.returnValue || r.value,
        evalCode: r.code || r.script || r.expression,
        fieldValues: r.fieldValues || r.fields,
        selectedOption: r.selectedOption || r.selected,
        tabList: r.tabs,
        activeTab: r.activeTab,
        authenticated: r.authenticated,
        sessionName: r.sessionName || r.session,
      });
    }
  } else if (inputActions.length > 0) {
    for (const a of inputActions) {
      actions.push({
        type: a.type || a.action || 'navigate',
        url: a.url || a.value,
        selector: a.selector,
        text: a.text || a.value,
        success: undefined // not executed yet
      });
    }
  }

  // If it's a search operation
  const searchResults = resultData.results || params.results || [];
  const isSearch = operation === 'search' || params.query;

  // If it's a fetch operation
  const isFetch = operation === 'fetch';

  const firstAction = actions[0] || params;

  return {
    operation,
    isSearch,
    isFetch,
    query: params.query || resultData.query || '',
    searchEngine: params.engine || resultData.engine || '',
    searchResults: isSearch ? searchResults : [],
    // Overall status
    success: parsedData.success ?? parsedData._status === 'completed',
    _hasResults: parsedData._hasResults,
    overallError: parsedData.error || parsedData._error || resultData.error || params.error || '',
    overallWarning: resultData.warning || params.warning || '',
    httpStatus: resultData.httpStatus || params.httpStatus,
    message: resultData.message || params.message || '',
    // Page context
    pageUrl: resultData.url || params.pageUrl || params.currentUrl || params.url || firstAction.url || '',
    pageTitle: resultData.title || params.pageTitle || params.title || '',
    tabName: resultData.tabName || params.tabName || '',
    // Content
    screenshot: params.screenshot || params.screenshotBase64 || resultData.screenshot || null,
    htmlContent: resultData.html || params.htmlContent || params.html || null,
    fetchedText: resultData.text || null,
    // Actions
    actions,
    actionsExecuted: resultData.actionsExecuted || params.actionsExecuted || 0,
    // Execution info
    executionTime: parsedData._executionTime
  };
}

const ACTION_CONFIG = {
  'navigate':           { icon: GlobeAltIcon,            label: 'Navigate',    color: 'text-blue-500' },
  'click':              { icon: CursorArrowRaysIcon,     label: 'Click',       color: 'text-amber-500' },
  'type':               { icon: DocumentTextIcon,        label: 'Type',        color: 'text-green-500' },
  'fill':               { icon: PencilSquareIcon,        label: 'Fill',        color: 'text-green-500' },
  'screenshot':         { icon: CameraIcon,              label: 'Screenshot',  color: 'text-purple-500' },
  'extract-text':       { icon: DocumentTextIcon,        label: 'Extract',     color: 'text-cyan-500' },
  'extract-links':      { icon: DocumentTextIcon,        label: 'Links',       color: 'text-cyan-500' },
  'get-text':           { icon: DocumentTextIcon,        label: 'Get Text',    color: 'text-cyan-500' },
  'get-source':         { icon: DocumentTextIcon,        label: 'Source',      color: 'text-gray-500' },
  'scroll':             { icon: ChevronDownIcon,         label: 'Scroll',      color: 'text-gray-500' },
  'wait-for':           { icon: ClockIcon,               label: 'Wait For',    color: 'text-yellow-500' },
  'wait':               { icon: ClockIcon,               label: 'Wait',        color: 'text-yellow-500' },
  'delay':              { icon: ClockIcon,               label: 'Delay',       color: 'text-yellow-500' },
  'hover':              { icon: HandRaisedIcon,          label: 'Hover',       color: 'text-indigo-500' },
  'mouse-move':         { icon: ArrowsPointingOutIcon,   label: 'Move',        color: 'text-indigo-500' },
  'press':              { icon: DocumentTextIcon,        label: 'Key Press',   color: 'text-green-500' },
  'submit':             { icon: ArrowPathIcon,           label: 'Submit',      color: 'text-orange-500' },
  'open-tab':           { icon: GlobeAltIcon,            label: 'Open Tab',    color: 'text-blue-500' },
  'close-tab':          { icon: XCircleIcon,             label: 'Close Tab',   color: 'text-red-500' },
  'switch-tab':         { icon: RectangleGroupIcon,      label: 'Switch Tab',  color: 'text-blue-500' },
  'list-tabs':          { icon: RectangleGroupIcon,      label: 'List Tabs',   color: 'text-blue-500' },
  'search':             { icon: MagnifyingGlassIcon,     label: 'Search',      color: 'text-blue-500' },
  // Previously unhandled — now specialised below via renderSpecializedRow.
  'authenticate':       { icon: LockClosedIcon,          label: 'Authenticate',color: 'text-emerald-500' },
  'analyze-screenshot': { icon: EyeIcon,                 label: 'Analyze',     color: 'text-purple-500' },
  'get-console':        { icon: CommandLineIcon,         label: 'Console',     color: 'text-gray-500' },
  'evaluate':           { icon: CodeBracketSquareIcon,   label: 'Evaluate',    color: 'text-fuchsia-500' },
  'get-field-values':   { icon: PencilSquareIcon,        label: 'Field Values',color: 'text-cyan-500' },
  'select':             { icon: ChevronUpDownIcon,       label: 'Select',      color: 'text-green-500' },
};

/* ────────────────────────────────────────────────────────────────────
 * Specialised rows — rendered UNDER the generic ActionRow for actions
 * that carry richer payloads than "success + selector + url". Keeps the
 * step timeline uniform while still giving users the actual data.
 * ──────────────────────────────────────────────────────────────────── */

function ClickTarget({ selector }) {
  if (!selector) return null;
  return (
    <div className="ml-8 mt-0.5 flex items-center gap-1.5 text-[11px]">
      <span className="text-gray-400">target →</span>
      <code className="font-mono bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 truncate max-w-[360px]" title={selector}>
        {selector}
      </code>
    </div>
  );
}

function FormReceiptRow({ action }) {
  const selector = action.selector;
  const value = action.text ?? action.value ?? action.key;
  // Heuristic: treat inputs whose selector mentions password/passwd as masked.
  const looksPassword = /password|passwd|pwd/i.test(selector || '') || /password|passwd|pwd/i.test(action.key || '');
  const display = looksPassword ? '•'.repeat(Math.min(12, String(value || '').length || 8)) : value;
  return (
    <div className="ml-8 mt-0.5 flex items-start gap-2 text-[11px]">
      <code className="font-mono text-gray-600 dark:text-gray-400 truncate max-w-[160px]" title={selector}>
        {selector || action.key || 'input'}
      </code>
      <span className="text-gray-400">→</span>
      <code className={`font-mono break-all flex-1 px-1.5 py-0.5 rounded ${looksPassword ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-200' : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200'}`}>
        {display}
      </code>
      {looksPassword && <span className="text-[10px] text-amber-600 dark:text-amber-400 italic">masked</span>}
    </div>
  );
}

function EvaluateRow({ action }) {
  const code = action.evalCode || action.text;
  const out  = action.evalResult;
  const outText = out === undefined ? null : (typeof out === 'string' ? out : JSON.stringify(out, null, 2));
  return (
    <div className="ml-8 mt-0.5 grid grid-cols-1 md:grid-cols-2 gap-1 text-[11px] font-mono">
      {code && (
        <div className="bg-fuchsia-50 dark:bg-fuchsia-900/20 border border-fuchsia-200 dark:border-fuchsia-800 rounded px-2 py-1 text-fuchsia-900 dark:text-fuchsia-100 whitespace-pre-wrap max-h-32 overflow-auto">
          {code}
        </div>
      )}
      {outText != null && (
        <div className="bg-slate-950 text-slate-100 dark:bg-black dark:text-slate-200 rounded px-2 py-1 whitespace-pre-wrap max-h-32 overflow-auto">
          <span className="text-[10px] uppercase tracking-wider text-fuchsia-400 block mb-0.5">return</span>
          {outText}
        </div>
      )}
    </div>
  );
}

function ScreenshotAnalyzeRow({ action }) {
  const shot = action.screenshot;
  const analysis = action.analysis || action.text || action.extractedText;
  if (!shot && !analysis) return null;
  return (
    <div className="ml-8 mt-0.5 flex items-start gap-2">
      {shot && (
        <img
          src={shot.startsWith('data:') ? shot : `data:image/png;base64,${shot}`}
          alt="screenshot"
          className="w-28 h-20 object-cover rounded border border-purple-200 dark:border-purple-800 shadow-sm"
        />
      )}
      {analysis && (
        <div className="flex-1 text-[11px] text-purple-900 dark:text-purple-100 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded px-2 py-1 italic">
          {analysis.length > 400 ? analysis.slice(0, 400) + '…' : analysis}
        </div>
      )}
    </div>
  );
}

function ConsoleRow({ action }) {
  const lines = action.consoleLines;
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const levelColor = {
    error: 'text-red-400',
    warn:  'text-amber-400',
    warning: 'text-amber-400',
    info:  'text-sky-400',
    log:   'text-gray-300',
    debug: 'text-gray-500',
  };
  return (
    <div className="ml-8 mt-0.5 bg-slate-950 text-slate-100 dark:bg-black rounded max-h-40 overflow-auto text-[11px] font-mono">
      {lines.slice(0, 80).map((l, i) => {
        const level = (l.level || l.type || 'log').toLowerCase();
        const text  = typeof l === 'string' ? l : (l.text || l.message || JSON.stringify(l));
        return (
          <div key={i} className="px-2 py-0.5 flex gap-2 border-b border-slate-800 last:border-b-0">
            <span className={`w-12 text-right shrink-0 ${levelColor[level] || 'text-gray-400'}`}>
              [{level}]
            </span>
            <span className="flex-1 whitespace-pre-wrap break-all">{text}</span>
          </div>
        );
      })}
      {lines.length > 80 && (
        <div className="px-2 py-0.5 text-gray-500 italic">… +{lines.length - 80} more lines</div>
      )}
    </div>
  );
}

function FieldValuesRow({ action }) {
  const fv = action.fieldValues;
  if (!fv) return null;
  const entries = Array.isArray(fv) ? fv.map(f => [f.name || f.selector || '?', f.value]) : Object.entries(fv);
  if (!entries.length) return null;
  return (
    <div className="ml-8 mt-0.5 border-l-2 border-cyan-300 dark:border-cyan-700 pl-2 space-y-0.5 text-[11px] font-mono">
      {entries.map(([k, v], i) => {
        const masked = /password|passwd|pwd/i.test(k || '');
        return (
          <div key={i} className="flex gap-2">
            <span className="text-gray-500 dark:text-gray-400 truncate max-w-[160px]">{k}</span>
            <span className="text-gray-400">=</span>
            <span className={`truncate flex-1 ${masked ? 'text-amber-700 dark:text-amber-300' : 'text-cyan-800 dark:text-cyan-200'}`}>
              {masked ? '•'.repeat(8) : (typeof v === 'string' ? v : JSON.stringify(v))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SelectRow({ action }) {
  if (!action.selectedOption) return null;
  return (
    <div className="ml-8 mt-0.5 flex items-center gap-1.5 text-[11px]">
      <ChevronUpDownIcon className="w-3 h-3 text-green-500" />
      <span className="text-gray-400">selected →</span>
      <code className="font-mono bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 px-1.5 py-0.5 rounded">
        {action.selectedOption}
      </code>
    </div>
  );
}

function AuthRow({ action }) {
  return (
    <div className="ml-8 mt-0.5 inline-flex items-center gap-1.5 text-[11px] bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-100 px-2 py-1 rounded border border-emerald-200 dark:border-emerald-800">
      <LockClosedIcon className="w-3.5 h-3.5" />
      <span>Session stored</span>
      {action.sessionName && (
        <code className="font-mono text-[10px] opacity-80">· {action.sessionName}</code>
      )}
    </div>
  );
}

function TabSwitchRow({ action }) {
  const tabs = action.tabList;
  if (!Array.isArray(tabs) || tabs.length === 0) return null;
  return (
    <div className="ml-8 mt-0.5 flex flex-wrap gap-1">
      {tabs.map((t, i) => {
        const name = typeof t === 'string' ? t : (t.name || t.title || t.url || `tab-${i}`);
        const active = t.active || name === action.activeTab;
        return (
          <span key={i} className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${
            active
              ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/60 dark:text-blue-100 dark:border-blue-700'
              : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
          }`}>
            {active && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
            {name}
          </span>
        );
      })}
    </div>
  );
}

function renderSpecializedRow(action) {
  const t = action.type;
  if (t === 'click' || t === 'hover')                 return <ClickTarget selector={action.selector} />;
  if (t === 'type' || t === 'fill' || t === 'press')  return <FormReceiptRow action={action} />;
  if (t === 'evaluate')                                return <EvaluateRow action={action} />;
  if (t === 'analyze-screenshot')                      return <ScreenshotAnalyzeRow action={action} />;
  if (t === 'get-console')                             return <ConsoleRow action={action} />;
  if (t === 'get-field-values')                        return <FieldValuesRow action={action} />;
  if (t === 'select')                                  return <SelectRow action={action} />;
  if (t === 'authenticate')                            return <AuthRow action={action} />;
  if (t === 'switch-tab' || t === 'list-tabs')         return <TabSwitchRow action={action} />;
  return null;
}

function StatusBadge({ success, error, warning, httpStatus }) {
  if (success === undefined || success === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400">
        <ClockIcon className="w-3 h-3" /> pending
      </span>
    );
  }
  if (success === false) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400 font-medium">
        <XCircleIcon className="w-3.5 h-3.5" />
        {httpStatus ? `HTTP ${httpStatus}` : 'failed'}
      </span>
    );
  }
  if (warning) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
        <ExclamationTriangleIcon className="w-3.5 h-3.5" /> warning
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
      <CheckCircleIcon className="w-3.5 h-3.5" /> ok
    </span>
  );
}

function ActionRow({ action, idx, showIndex }) {
  const actionType = action.type || 'navigate';
  const config = ACTION_CONFIG[actionType] || ACTION_CONFIG['navigate'];
  const ActionIcon = config.icon;
  const failed = action.success === false;

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
      failed ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
    }`}>
      {showIndex && <span className="text-gray-300 dark:text-gray-600 w-4 text-right select-none font-mono">{idx + 1}</span>}
      <ActionIcon className={`w-3.5 h-3.5 ${failed ? 'text-red-500' : config.color} flex-shrink-0`} />
      <span className={`font-medium ${failed ? 'text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-gray-400'}`}>
        {config.label}
      </span>
      <span className="text-gray-500 dark:text-gray-500 truncate flex-1">
        {action.url || action.selector || action.text || action.key || ''}
      </span>
      <StatusBadge success={action.success} error={action.error} warning={action.warning} httpStatus={action.httpStatus} />
    </div>
  );
}

function WebToolRenderer({ toolId, rawContent, parsedData, messageTimestamp, index }) {
  const [showScreenshot, toggleShowScreenshot] = usePersistedToggle('webScreenshot', messageTimestamp, index, false);
  const [contentExpanded, toggleContentExpanded] = usePersistedToggle('webContent', messageTimestamp, index, false);
  const data = useMemo(() => parseWebData(parsedData), [parsedData]);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 text-sm">
        <GlobeAltIcon className="w-4 h-4" />
        <span>Web (unable to parse)</span>
      </div>
    );
  }

  // Input-only state (no results yet)
  if (!data._hasResults && data.success === undefined) {
    return (
      <div className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-200 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>
          </div>
          {data.pageUrl && (
            <div className="flex-1 flex items-center gap-1.5 bg-white dark:bg-gray-700 rounded-md px-2 py-1 text-xs">
              <GlobeAltIcon className="w-3 h-3 text-gray-400" />
              <span className="text-gray-600 dark:text-gray-300 truncate font-mono">{data.pageUrl}</span>
            </div>
          )}
        </div>
        <div className="bg-white dark:bg-gray-900 p-3">
          {data.actions.length > 0 ? (
            <div className="space-y-1">
              {data.actions.map((a, i) => (
                <ActionRow key={i} action={a} idx={i} showIndex={data.actions.length > 1} />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-500 animate-pulse">
              <GlobeAltIcon className="w-4 h-4" />
              <span>{data.isSearch ? `Searching "${data.query}"...` : data.isFetch ? 'Fetching page...' : 'Browsing...'}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Determine overall status for header color
  const isOverallSuccess = data.success !== false;
  const hasWarning = !!data.overallWarning;
  const headerBorderColor = !isOverallSuccess
    ? 'border-red-300 dark:border-red-700'
    : hasWarning
    ? 'border-amber-300 dark:border-amber-700'
    : 'border-gray-300 dark:border-gray-700';
  const outerBorderColor = !isOverallSuccess
    ? 'border-red-200 dark:border-red-800'
    : hasWarning
    ? 'border-amber-200 dark:border-amber-800'
    : 'border-gray-200 dark:border-gray-700';

  return (
    <div className={`my-2 rounded-lg overflow-hidden border ${outerBorderColor} shadow-md`}>
      {/* Browser chrome header */}
      <div className={`flex items-center gap-2 px-3 py-2 bg-gray-200 dark:bg-gray-800 border-b ${headerBorderColor}`}>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>
        </div>
        {data.pageUrl && (
          <div className="flex-1 min-w-0 bg-white dark:bg-gray-700 rounded-md px-2 py-1 text-xs">
            <div className="flex items-center gap-1.5">
              <GlobeAltIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
              <span className="text-gray-600 dark:text-gray-300 truncate font-mono">{data.pageUrl}</span>
            </div>
            {data.pageTitle && (
              <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate pl-4.5 italic" title={data.pageTitle}>
                {data.pageTitle}
              </div>
            )}
          </div>
        )}
        {/* Overall status badge */}
        <StatusBadge success={data.success} error={data.overallError} warning={data.overallWarning} httpStatus={data.httpStatus} />
      </div>

      <div className="bg-white dark:bg-gray-900">
        {/* Overall error banner */}
        {data.overallError && (
          <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
            <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
              <XCircleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{typeof data.overallError === 'string' ? data.overallError : JSON.stringify(data.overallError)}</span>
            </div>
          </div>
        )}

        {/* Overall warning banner */}
        {data.overallWarning && !data.overallError && (
          <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{data.overallWarning}</span>
            </div>
          </div>
        )}

        {/* Search results */}
        {data.isSearch && data.searchResults.length > 0 && (
          <div className="p-2 space-y-1 border-b border-gray-200 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 px-1 mb-1">
              <MagnifyingGlassIcon className="w-3.5 h-3.5 inline mr-1" />
              {data.searchResults.length} result{data.searchResults.length !== 1 ? 's' : ''} for "{data.query}"
            </div>
            {data.searchResults.slice(0, 5).map((r, i) => (
              <div key={i} className="px-2 py-1 text-xs rounded hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <div className="text-blue-600 dark:text-blue-400 font-medium truncate">{r.title || r.url}</div>
                <div className="text-gray-400 font-mono truncate text-[10px]">{r.url}</div>
              </div>
            ))}
            {data.searchResults.length > 5 && (
              <div className="px-2 text-xs text-gray-400">+{data.searchResults.length - 5} more results</div>
            )}
          </div>
        )}

        {/* Fetched text preview */}
        {data.isFetch && data.fetchedText && (
          <div className="border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={toggleContentExpanded}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <DocumentTextIcon className="w-3.5 h-3.5" />
              <span>{contentExpanded ? 'Hide' : 'Show'} Fetched Text ({data.fetchedText.length} chars)</span>
            </button>
            {contentExpanded && (
              <pre className="p-3 text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-800/50">
                {data.fetchedText.slice(0, 3000)}
                {data.fetchedText.length > 3000 && '\n... (truncated)'}
              </pre>
            )}
          </div>
        )}

        {/* Action steps with per-action status */}
        {data.actions.length > 0 && (
          <div className="p-2 space-y-1">
            {data.actions.map((action, idx) => (
              <div key={idx}>
                <ActionRow action={action} idx={idx} showIndex={data.actions.length > 1} />
                {/* Per-action specialised sub-row (target chip, form receipt,
                    console, eval, etc) — richer than the generic ActionRow. */}
                {renderSpecializedRow(action)}
                {/* Per-action error detail */}
                {action.error && (
                  <div className="ml-8 mt-0.5 px-2 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-900/10 rounded">
                    {action.error}
                  </div>
                )}
                {action.warning && (
                  <div className="ml-8 mt-0.5 px-2 py-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-900/10 rounded">
                    ⚠ {action.warning}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Screenshot */}
        {data.screenshot && (
          <div className="border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={toggleShowScreenshot}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <CameraIcon className="w-3.5 h-3.5" />
              <span>{showScreenshot ? 'Hide' : 'Show'} Screenshot</span>
            </button>
            {showScreenshot && (
              <div className="p-2 bg-gray-100 dark:bg-gray-800">
                <img
                  src={data.screenshot.startsWith('data:') ? data.screenshot : `data:image/png;base64,${data.screenshot}`}
                  alt="Page screenshot"
                  className="max-w-full rounded border border-gray-300 dark:border-gray-600 shadow-sm"
                />
              </div>
            )}
          </div>
        )}

        {/* HTML content */}
        {data.htmlContent && (
          <div className="border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={toggleContentExpanded}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <DocumentTextIcon className="w-3.5 h-3.5" />
              <span>{contentExpanded ? 'Hide' : 'Show'} Page Content</span>
            </button>
            {contentExpanded && (
              <pre className="p-3 text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-40 overflow-y-auto bg-gray-50 dark:bg-gray-800/50">
                {data.htmlContent.slice(0, 2000)}
                {data.htmlContent.length > 2000 && '\n... (truncated)'}
              </pre>
            )}
          </div>
        )}

        {/* Status message */}
        {data.message && !data.overallError && (
          <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
            {data.message}
          </div>
        )}

        {/* Footer: tab name, HTTP status, execution time */}
        {(data.tabName || data.httpStatus || data.executionTime) && (
          <div className="px-3 py-1 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3 text-[10px] text-gray-400">
            {data.tabName && <span>Tab: {data.tabName}</span>}
            {data.httpStatus && <span>HTTP {data.httpStatus}</span>}
            {data.executionTime && <span>{(data.executionTime / 1000).toFixed(1)}s</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export default WebToolRenderer;
