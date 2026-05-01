/**
 * TerminalRenderer Component
 *
 * Displays terminal commands in a realistic terminal window.
 * Features a dark terminal aesthetic with command prompt styling.
 * Merges tool results (_result) into the display when they arrive.
 */

import React, { useMemo } from 'react';
import {
  CommandLineIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardIcon,
  CheckIcon,
  FolderIcon,
  CheckCircleIcon,
  ExclamationCircleIcon
} from '@heroicons/react/24/outline';
import { usePersistedToggle, extractResult } from './usePersistedState';

/**
 * Get short directory name for prompt
 */
function getShortDir(dir) {
  if (!dir) return '~';
  const parts = dir.split(/[/\\]/);
  return parts[parts.length - 1] || '~';
}

/**
 * Single command display with persisted expand state
 */
function CommandBlock({ action, index, messageTimestamp, isLast, resultAction }) {
  const [expanded, toggleExpanded] = usePersistedToggle('terminal-cmd', messageTimestamp, index, true);
  const [copied, , setCopied] = usePersistedToggle('terminal-copy', messageTimestamp, index, false);

  const command = action.command || '';
  // Merge result data: prefer result output over invocation-only
  const output = resultAction?.output || resultAction?.stdout || action.output || action.stdout || '';
  const error = resultAction?.stderr || resultAction?.error || action.stderr || action.error || '';
  const exitCode = resultAction?.exitCode ?? resultAction?.code ?? action.exitCode ?? action.code;
  const directory = action.directory || action.cwd;
  const type = action.type || 'run-command';

  const hasOutput = output || error;
  const isSuccess = exitCode === 0 || exitCode === undefined;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  // Format based on action type
  const getPromptLine = () => {
    switch (type) {
      case 'change-directory':
        return (
          <div className="flex items-center gap-2">
            <FolderIcon className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-blue-400">cd</span>
            <span className="text-gray-300">{directory}</span>
          </div>
        );
      case 'get-working-directory':
        return (
          <div className="flex items-center gap-2">
            <FolderIcon className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-cyan-400">pwd</span>
          </div>
        );
      case 'list-directory':
        return (
          <div className="flex items-center gap-2">
            <span className="text-yellow-400">ls</span>
            <span className="text-gray-300">{directory || '.'}</span>
          </div>
        );
      case 'create-directory':
        return (
          <div className="flex items-center gap-2">
            <span className="text-green-400">mkdir</span>
            <span className="text-gray-300">{directory}</span>
          </div>
        );
      default:
        return <span className="text-gray-100">{command}</span>;
    }
  };

  return (
    <div className="group">
      {/* Command line */}
      <div
        className="flex items-start gap-2 py-1 hover:bg-white/5 rounded px-2 -mx-2 cursor-pointer"
        onClick={hasOutput ? toggleExpanded : undefined}
      >
        {/* Prompt */}
        <span className="flex-shrink-0 select-none">
          <span className="text-emerald-400 font-semibold">$</span>
        </span>

        {/* Command */}
        <div className="flex-1 font-mono text-sm break-all">
          {getPromptLine()}
        </div>

        {/* Exit code badge */}
        {exitCode !== undefined && (
          <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-mono ${
            exitCode === 0
              ? 'bg-emerald-900/50 text-emerald-400'
              : 'bg-red-900/50 text-red-400'
          }`}>
            {exitCode === 0 ? '✓' : `exit ${exitCode}`}
          </span>
        )}

        {/* Expand/collapse indicator for output */}
        {hasOutput && (
          <span className="flex-shrink-0 text-gray-600">
            {expanded
              ? <ChevronDownIcon className="w-3.5 h-3.5" />
              : <ChevronRightIcon className="w-3.5 h-3.5" />
            }
          </span>
        )}

        {/* Copy button */}
        {command && (
          <button
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-gray-300 transition-opacity"
            title="Copy command"
          >
            {copied ? (
              <CheckIcon className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <ClipboardIcon className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Output — collapsed by default, persisted */}
      {hasOutput && expanded && (
        <div className="pl-5 py-1">
          {output && (
            <pre className="text-xs text-gray-400 whitespace-pre-wrap break-all font-mono max-h-64 overflow-y-auto">
              {output.length > 2000 ? output.slice(0, 2000) + '\n... (truncated)' : output}
            </pre>
          )}
          {error && (
            <pre className="text-xs text-red-400 whitespace-pre-wrap break-all font-mono">
              {error}
            </pre>
          )}
        </div>
      )}

      {/* Collapsed output indicator */}
      {hasOutput && !expanded && (
        <div className="pl-5 py-0.5">
          <span className="text-xs text-gray-600 italic">
            {output ? `${output.split('\n').length} lines` : ''}{error ? ' (has errors)' : ''}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Parse terminal actions from JSON, merging _result data when available
 */
function parseTerminalActions(parsedData) {
  if (!parsedData) return { actions: [], resultActions: [] };

  const { hasResults, result } = extractResult(parsedData);

  // Parse invocation actions
  let actions = [];
  if (parsedData.actions && Array.isArray(parsedData.actions)) {
    actions = parsedData.actions.map(a => ({
      type: a.type || 'run-command',
      command: a.command,
      directory: a.directory,
      output: a.output || a.stdout,
      stderr: a.stderr,
      error: a.error,
      exitCode: a.exitCode ?? a.code,
      cwd: a.cwd
    }));
  } else if (parsedData.parameters?.actions) {
    actions = parsedData.parameters.actions.map(a => ({
      type: a.type || 'run-command',
      command: a.command,
      directory: a.directory,
      output: a.output,
      exitCode: a.exitCode
    }));
  } else if (parsedData.parameters?.command || parsedData.command) {
    const p = parsedData.parameters || parsedData;
    actions = [{
      type: 'run-command',
      command: p.command,
      output: p.output,
      exitCode: p.exitCode
    }];
  }

  // Parse result actions (from tool execution results)
  let resultActions = [];
  if (hasResults && result) {
    if (result.results && Array.isArray(result.results)) {
      resultActions = result.results;
    } else if (result.output || result.stdout) {
      resultActions = [result];
    }
  }

  return { actions, resultActions, hasResults };
}

/**
 * Main component
 */
function TerminalRenderer({ toolId, rawContent, innerContent, parsedData, messageTimestamp }) {
  const [collapsed, toggleCollapsed] = usePersistedToggle('terminal-main', messageTimestamp, 'main', false);
  const { actions, resultActions, hasResults } = useMemo(() => parseTerminalActions(parsedData), [parsedData]);
  const { success, executionTime } = extractResult(parsedData);

  if (actions.length === 0 && resultActions.length === 0) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-900 text-gray-400 text-sm font-mono">
        <CommandLineIcon className="w-4 h-4" />
        <span>Terminal command</span>
      </div>
    );
  }

  // Determine status indicator
  const showStatus = hasResults && success !== null;
  const allSucceeded = success === true || (resultActions.length > 0 && resultActions.every(r => (r.exitCode ?? r.code ?? 0) === 0));

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-gray-700 shadow-lg">
      {/* Terminal title bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          {/* Traffic lights */}
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/80"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/80"></div>
          </div>
          <span className="text-xs text-gray-500 ml-2">Terminal</span>

          {/* Status badge when results are in */}
          {showStatus && (
            <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
              allSucceeded
                ? 'bg-emerald-900/40 text-emerald-400'
                : 'bg-red-900/40 text-red-400'
            }`}>
              {allSucceeded
                ? <CheckCircleIcon className="w-3 h-3" />
                : <ExclamationCircleIcon className="w-3 h-3" />
              }
              {allSucceeded ? 'Done' : 'Error'}
            </span>
          )}

          {/* Execution time */}
          {executionTime && (
            <span className="text-xs text-gray-600">{(executionTime / 1000).toFixed(1)}s</span>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={toggleCollapsed}
          className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
        >
          {collapsed ? (
            <ChevronRightIcon className="w-3.5 h-3.5" />
          ) : (
            <ChevronDownIcon className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Terminal content */}
      {!collapsed && (
        <div className="bg-gray-900 p-3 font-mono text-sm">
          {actions.map((action, idx) => (
            <CommandBlock
              key={idx}
              action={action}
              index={idx}
              messageTimestamp={messageTimestamp}
              isLast={idx === actions.length - 1}
              resultAction={resultActions[idx] || null}
            />
          ))}

          {/* If we have result actions that didn't match invocation actions, show them */}
          {resultActions.length > actions.length && resultActions.slice(actions.length).map((ra, idx) => (
            <CommandBlock
              key={`result-${idx}`}
              action={ra}
              index={actions.length + idx}
              messageTimestamp={messageTimestamp}
              isLast={idx === resultActions.length - actions.length - 1}
              resultAction={null}
            />
          ))}

          {/* Blinking cursor — only show if no results yet (still executing) */}
          {!hasResults && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-emerald-400 font-semibold">$</span>
              <span className="w-2 h-4 bg-gray-400 animate-pulse"></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TerminalRenderer;
