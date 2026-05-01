/**
 * TerminalConfigurator — per-agent configuration for the `terminal` tool.
 *
 * Fields (all optional):
 *   - allowedCommands:  string[]  — if non-empty, only commands matching
 *                                   any pattern can run.
 *   - blockedCommands:  string[]  — any match blocks the command.
 *   - maxBackgroundCommandsPerAgent: number — hard cap per agent.
 *
 * A null `value` means "no overrides — use global defaults". An empty
 * object means "explicit per-agent config, all fields default". Tests
 * lock the exact shape produced by this form.
 *
 * The backend merges these into terminal tool config at execute time
 * via BaseTool#getEffectiveConfig(context) → per-agent wins over globals.
 */

import React from 'react';
import StringListEditor from './StringListEditor.jsx';

function TerminalConfigurator({ value, onChange, disabled }) {
  // Treat null as "empty override object" locally — the modal's onSave
  // will still send null if the user never touched anything and they
  // click Reset, because Reset fires a direct `onSave(null)` on the
  // parent bypassing this draft.
  const cfg = value || {};

  const set = (patch) => onChange({ ...cfg, ...patch });

  return (
    <div className="space-y-4" data-testid="terminal-configurator">
      <StringListEditor
        label="Allowed commands"
        hint='If non-empty, only commands matching any pattern are allowed (e.g. "git", "npm run *").'
        values={cfg.allowedCommands}
        onChange={(v) => set({ allowedCommands: v })}
        disabled={disabled}
        placeholder="e.g. git"
      />
      <StringListEditor
        label="Blocked commands"
        hint="Commands matching any pattern are blocked (takes precedence over allow list)."
        values={cfg.blockedCommands}
        onChange={(v) => set({ blockedCommands: v })}
        disabled={disabled}
        placeholder="e.g. rm -rf"
      />
      <div>
        <label htmlFor="terminal-max-bg" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Max concurrent background commands
        </label>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
          Leave blank to use the global default.
        </p>
        <input
          id="terminal-max-bg"
          type="number"
          min="1"
          max="50"
          value={cfg.maxBackgroundCommandsPerAgent ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              const { maxBackgroundCommandsPerAgent, ...rest } = cfg;
              onChange(rest);
            } else {
              const n = Number(raw);
              if (Number.isFinite(n) && n >= 1) set({ maxBackgroundCommandsPerAgent: n });
            }
          }}
          className="w-32 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-loxia-500 disabled:opacity-50"
        />
      </div>
    </div>
  );
}

export default TerminalConfigurator;
