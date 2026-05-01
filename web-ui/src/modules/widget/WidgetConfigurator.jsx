/**
 * WidgetConfigurator — per-agent toolConfig UI for the widget tool.
 * Registered in toolConfig/registry.js under key 'widget'.
 *
 * Fields:
 *   - allowCustomCode: boolean
 *       Master switch. When off, the widget tool returns
 *       { disabled: true } on every render. Default: off.
 *
 *   - interactiveMode: 'static-only' | 'allow-scripts'
 *       When set to 'static-only', jsx-mode widgets are silently
 *       downgraded to html-mode at the renderer (scripts stripped).
 *       Lets a cautious user keep layouts but kill scripts.
 *       Default: 'allow-scripts' (full mode).
 */

import React from 'react';

function WidgetConfigurator({ value, onChange, disabled }) {
  const cfg = value || {};
  const allowCustomCode = cfg.allowCustomCode === true; // strict default-off

  const set = (patch) => onChange({ ...cfg, ...patch });
  const clearField = (key) => {
    const { [key]: _removed, ...rest } = cfg;
    onChange(rest);
  };

  return (
    <div className="space-y-4" data-testid="widget-configurator">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={allowCustomCode}
          disabled={disabled}
          onChange={(e) => set({ allowCustomCode: e.target.checked })}
          className="mt-0.5 h-4 w-4 text-loxia-600 focus:ring-loxia-500 border-gray-300 rounded"
        />
        <div>
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Allow custom widgets
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Let this agent render arbitrary HTML/JS components inline in the chat.
            Code runs in a sandboxed iframe with null origin — cannot access cookies,
            network, or parent page. Recommended off unless you trust the agent's
            source.
          </p>
        </div>
      </label>

      <div>
        <label htmlFor="widget-mode" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Interactive mode
        </label>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
          <code>allow-scripts</code> lets widgets respond to clicks and input.
          <code>static-only</code> downgrades interactive widgets to HTML+CSS (no JS).
        </p>
        <select
          id="widget-mode"
          value={cfg.interactiveMode || ''}
          disabled={disabled || !allowCustomCode}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) clearField('interactiveMode');
            else set({ interactiveMode: v });
          }}
          className="w-44 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-loxia-500 disabled:opacity-50"
        >
          <option value="">(default: allow-scripts)</option>
          <option value="allow-scripts">allow-scripts (interactive)</option>
          <option value="static-only">static-only (strip scripts)</option>
        </select>
      </div>

      <div className="text-[11px] text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3">
        <strong className="text-gray-700 dark:text-gray-300">Tip:</strong> users still see a
        confirmation modal the first time this agent renders a widget, even with
        this toggle on. That's a separate UX gate — this toggle is the tool-level
        kill switch.
      </div>
    </div>
  );
}

export default WidgetConfigurator;
