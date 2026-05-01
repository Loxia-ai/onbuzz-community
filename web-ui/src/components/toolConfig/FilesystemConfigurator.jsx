/**
 * FilesystemConfigurator — per-agent configuration for the `filesystem` tool.
 *
 * Fields (all optional):
 *   - allowedExtensions:  string[]  — e.g. ['.js', '.ts']
 *   - blockedExtensions:  string[]  — e.g. ['.exe', '.dll']
 *   - maxFileSize:        number    — bytes (shown in MB in the UI)
 *
 * Leaving a field blank means "use global default". Backend merges via
 * BaseTool#getEffectiveConfig → per-agent wins over globals.
 */

import React from 'react';
import StringListEditor from './StringListEditor.jsx';

const MB = 1024 * 1024;

function FilesystemConfigurator({ value, onChange, disabled }) {
  const cfg = value || {};
  const set = (patch) => onChange({ ...cfg, ...patch });

  return (
    <div className="space-y-4" data-testid="filesystem-configurator">
      <StringListEditor
        label="Allowed extensions"
        hint='If non-empty, only files with these extensions can be read/written (e.g. ".js", ".ts").'
        values={cfg.allowedExtensions}
        onChange={(v) => set({ allowedExtensions: v })}
        disabled={disabled}
        placeholder="e.g. .js"
      />
      <StringListEditor
        label="Blocked extensions"
        hint="Files with these extensions are blocked (takes precedence over allow list)."
        values={cfg.blockedExtensions}
        onChange={(v) => set({ blockedExtensions: v })}
        disabled={disabled}
        placeholder="e.g. .exe"
      />
      <div>
        <label htmlFor="fs-max-file-size" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Max file size (MB)
        </label>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
          Maximum size of any single file the agent may read or write. Leave blank for the global default.
        </p>
        <input
          id="fs-max-file-size"
          type="number"
          min="0.1"
          step="0.1"
          value={cfg.maxFileSize != null ? (cfg.maxFileSize / MB).toFixed(2).replace(/\.?0+$/, '') : ''}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              const { maxFileSize, ...rest } = cfg;
              onChange(rest);
            } else {
              const mb = Number(raw);
              if (Number.isFinite(mb) && mb > 0) {
                set({ maxFileSize: Math.round(mb * MB) });
              }
            }
          }}
          className="w-32 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-loxia-500 disabled:opacity-50"
        />
      </div>
    </div>
  );
}

export default FilesystemConfigurator;
