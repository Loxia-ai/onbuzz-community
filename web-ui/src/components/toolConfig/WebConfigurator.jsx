/**
 * WebConfigurator — per-agent configuration for the `web` tool.
 *
 * Fields (all optional):
 *   - defaultStealthLevel: 'standard' | 'maximum' — used when caller
 *                          doesn't specify stealthLevel in the invocation.
 *   - allowedDomains:      string[]  — if non-empty, navigate/fetch/search
 *                                     URLs must host-match one of these.
 *   - blockedDomains:      string[]  — URLs whose host ends with any of
 *                                     these are refused (precedence over
 *                                     allow).
 *
 * Backend merges via BaseTool#getEffectiveConfig at execute time.
 */

import React from 'react';
import StringListEditor from './StringListEditor.jsx';

function WebConfigurator({ value, onChange, disabled }) {
  const cfg = value || {};
  const set = (patch) => onChange({ ...cfg, ...patch });

  return (
    <div className="space-y-4" data-testid="web-configurator">
      <div>
        <label htmlFor="web-stealth" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Default stealth level
        </label>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
          Applied when a tool call doesn't specify <code className="font-mono">stealthLevel</code>. Maximum =
          visible browser window with persistent cookies; standard = headless.
        </p>
        <select
          id="web-stealth"
          value={cfg.defaultStealthLevel || ''}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              const { defaultStealthLevel, ...rest } = cfg;
              onChange(rest);
            } else {
              set({ defaultStealthLevel: v });
            }
          }}
          className="w-40 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-loxia-500 disabled:opacity-50"
        >
          <option value="">(global default)</option>
          <option value="standard">standard</option>
          <option value="maximum">maximum</option>
        </select>
      </div>

      <StringListEditor
        label="Allowed domains"
        hint='If non-empty, navigate/fetch/search URLs must host-match one of these (e.g. "github.com", "docs.example.com"). Matches exact host or subdomain.'
        values={cfg.allowedDomains}
        onChange={(v) => set({ allowedDomains: v })}
        disabled={disabled}
        placeholder="e.g. github.com"
      />

      <StringListEditor
        label="Blocked domains"
        hint="URLs hosted on these domains are refused (takes precedence over allow list)."
        values={cfg.blockedDomains}
        onChange={(v) => set({ blockedDomains: v })}
        disabled={disabled}
        placeholder="e.g. ads.example"
      />
    </div>
  );
}

export default WebConfigurator;
