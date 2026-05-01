/**
 * ToolConfigModal — shell that hosts a per-tool configurator.
 *
 * The actual form fields live in tool-specific configurator components
 * (see toolConfig/registry.js). This file is layout-only: header with
 * tool name + description, body slot for the configurator, footer with
 * "Reset to defaults" / "Save" buttons.
 *
 * Props:
 *   tool:           { id, name, description, iconName } | null
 *                   When null or tool has no configurator, the modal
 *                   shows a "no configurable settings" empty state.
 *   value:          object | null   — current value for this tool's config
 *   onClose:        () => void
 *   onSave:         (newValue | null) => void
 *                   newValue = object (apply), null = reset (use defaults)
 */

import React, { useState, useEffect } from 'react';
import { XMarkIcon, ArrowPathIcon, CheckIcon, AdjustmentsHorizontalIcon } from '@heroicons/react/24/outline';
import ToolIcon from '../ToolIcon.jsx';
import { getConfigurator } from './registry.js';

function ToolConfigModal({ tool, value, onClose, onSave }) {
  const Configurator = tool ? getConfigurator(tool.id) : null;

  // Local draft state — committed on Save. Reset to incoming `value`
  // whenever the modal is re-opened for a different tool (or with new
  // props).
  const [draft, setDraft] = useState(value ?? null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(value ?? null); }, [tool?.id, value]);

  if (!tool) return null;

  const handleReset = () => {
    // Null signals "remove this tool's entry from agent.toolConfig" so
    // the tool falls back to its global defaults.
    onSave(null);
    onClose();
  };

  const handleSave = () => {
    setSaving(true);
    try {
      onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Configure ${tool.name}`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-loxia-50 to-indigo-50 dark:from-loxia-900/30 dark:to-indigo-900/30">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-loxia-500 to-indigo-600 text-white flex items-center justify-center shadow-sm">
            <ToolIcon iconName={tool.iconName} toolId={tool.id} className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              <AdjustmentsHorizontalIcon className="w-3 h-3" />
              <span>Tool configuration</span>
            </div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
              {tool.name}
              <span className="ml-2 text-xs font-mono text-gray-500 dark:text-gray-400">· {tool.id}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tool.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 italic">
              {tool.description}
            </p>
          )}
          {Configurator ? (
            <Configurator value={draft} onChange={setDraft} disabled={saving} />
          ) : (
            <EmptyConfigurator toolId={tool.id} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          {Configurator && (
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
              title="Clear per-agent settings and fall back to global defaults"
            >
              <ArrowPathIcon className="w-3.5 h-3.5" />
              Reset to defaults
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !Configurator}
            className="inline-flex items-center gap-1 px-4 py-1.5 text-sm font-medium text-white bg-loxia-600 hover:bg-loxia-700 disabled:opacity-50 rounded"
          >
            <CheckIcon className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyConfigurator({ toolId }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
      <AdjustmentsHorizontalIcon className="w-10 h-10 text-gray-300 dark:text-gray-600" />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No configurable settings for <code className="font-mono">{toolId}</code>.
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        This tool uses global defaults.
      </p>
    </div>
  );
}

export default ToolConfigModal;
