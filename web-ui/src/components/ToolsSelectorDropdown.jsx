import React, { useState } from 'react';
import { CheckIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import ToolIcon from './ToolIcon';
import { useAvailableTools } from '../hooks/useAvailableTools';
import ToolConfigModal from './toolConfig/ToolConfigModal.jsx';
import { hasConfigurator } from './toolConfig/registry.js';

/**
 * ToolsSelectorDropdown Component
 * A dropdown menu for quickly enabling/disabling agent capabilities/tools.
 *
 * Tool catalogue comes from `GET /api/tools` via useAvailableTools — the
 * SAME source the Agent Edit Modal uses. Previously this component
 * maintained its own hardcoded inline array that silently drifted from
 * the backend registry (video-gen went missing, new tools didn't appear,
 * categories diverged). Now any tool the backend registers shows up here
 * automatically.
 *
 * @param {Object} props
 * @param {Array<string>} props.currentCapabilities
 * @param {Function} props.onCapabilitiesChange
 * @param {boolean} props.disabled
 */
function ToolsSelectorDropdown({
  currentCapabilities,
  onCapabilitiesChange,
  disabled = false,
  // Optional per-tool configuration. Parents that want to support it
  // pass a { [toolId]: object } map and an onChange. If toolConfig is
  // not provided, ⚙ buttons are hidden so the component still works
  // for callers that only care about on/off toggles (legacy Chat.jsx
  // call site passes neither).
  toolConfig,
  onToolConfigChange,
}) {
  const { tools, byCategory, categories, loading, error } = useAvailableTools({
    sortBy: 'category-then-name',
  });
  const configEnabled = !!(toolConfig !== undefined && typeof onToolConfigChange === 'function');
  const [configuringTool, setConfiguringTool] = useState(null);

  const handleToggle = (capabilityId) => {
    if (disabled) return;
    const isEnabled = currentCapabilities.includes(capabilityId);
    const newCapabilities = isEnabled
      ? currentCapabilities.filter(id => id !== capabilityId)
      : [...currentCapabilities, capabilityId];
    onCapabilitiesChange(newCapabilities);
  };

  const handleSelectAll = () => {
    if (disabled) return;
    onCapabilitiesChange(tools.map(t => t.id));
  };

  const handleDeselectAll = () => {
    if (disabled) return;
    onCapabilitiesChange([]);
  };

  if (loading) {
    return (
      <div className="py-6 text-center text-xs text-gray-500 dark:text-gray-400">
        Loading tools…
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-4 px-3 text-xs text-red-600 dark:text-red-400">
        Failed to load tools: {error}
      </div>
    );
  }

  return (
    <div className="py-1 max-h-96 overflow-y-auto">
      {/* Header with Select All / Deselect All */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          {currentCapabilities.length} / {tools.length} enabled
        </span>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={disabled}
            className="text-xs text-loxia-600 dark:text-loxia-400 hover:text-loxia-700 dark:hover:text-loxia-300 disabled:opacity-50"
          >
            Select All
          </button>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <button
            type="button"
            onClick={handleDeselectAll}
            disabled={disabled}
            className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Capabilities grouped by category */}
      {categories.map((category, catIdx) => (
        <div key={category} className="px-3 py-2">
          <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-2">
            {category}
          </h3>

          <div className="space-y-1">
            {byCategory[category].map((capability) => {
              const isEnabled = currentCapabilities.includes(capability.id);

              return (
                <button
                  type="button"
                  key={capability.id}
                  onClick={() => handleToggle(capability.id)}
                  disabled={disabled}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    disabled
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0 mr-3">
                      <ToolIcon
                        iconName={capability.iconName}
                        toolId={capability.id}
                        className={`w-4 h-4 flex-shrink-0 ${
                          isEnabled ? 'text-loxia-600 dark:text-loxia-400' : 'text-gray-400 dark:text-gray-500'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className={`text-sm font-medium ${
                            isEnabled
                              ? 'text-gray-900 dark:text-gray-100'
                              : 'text-gray-500 dark:text-gray-400'
                          }`}>
                            {capability.name}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                          {capability.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1">
                      {/* Configure (⚙) — only shown when parent opts into
                          per-tool config AND the tool is enabled AND a
                          configurator is registered for this tool. Clicking
                          does NOT toggle the tool; stopPropagation prevents
                          the outer button's toggle. */}
                      {configEnabled && isEnabled && hasConfigurator(capability.id) && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); setConfiguringTool(capability); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              setConfiguringTool(capability);
                            }
                          }}
                          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400"
                          title={`Configure ${capability.name}`}
                          aria-label={`Configure ${capability.name}`}
                        >
                          <Cog6ToothIcon className="w-4 h-4" />
                        </span>
                      )}
                      {isEnabled ? (
                        <div className="w-5 h-5 bg-loxia-600 dark:bg-loxia-500 rounded flex items-center justify-center">
                          <CheckIcon className="w-4 h-4 text-white" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded"></div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {catIdx < categories.length - 1 && (
            <div className="border-t border-gray-200 dark:border-gray-700 mt-2" />
          )}
        </div>
      ))}

      {/* Per-tool config modal — opens when the user clicks the ⚙. Only
          reachable when the parent opted into per-tool config. */}
      {configuringTool && (
        <ToolConfigModal
          tool={configuringTool}
          value={(toolConfig && toolConfig[configuringTool.id]) || null}
          onClose={() => setConfiguringTool(null)}
          onSave={(newValue) => {
            onToolConfigChange(configuringTool.id, newValue);
          }}
        />
      )}
    </div>
  );
}

export default ToolsSelectorDropdown;
