import React from 'react';
import { CheckIcon } from '@heroicons/react/24/outline';
import { useModelsStore } from '../stores/modelsStore.js';

/**
 * ModelSelectorDropdown Component
 * A dropdown menu for quickly changing the agent's language model
 *
 * @param {Object} props
 * @param {string} props.currentModel - The currently selected model ID
 * @param {Function} props.onModelSelect - Callback when a model is selected
 * @param {boolean} props.disabled - Whether the dropdown is disabled
 */
function ModelSelectorDropdown({ currentModel, onModelSelect, disabled = false }) {
  const { getModelsByCategory } = useModelsStore();
  const modelCategories = getModelsByCategory();

  const handleModelClick = (modelName) => {
    if (!disabled && modelName !== currentModel) {
      onModelSelect(modelName);
    }
  };

  return (
    <div className="py-1 max-h-96 overflow-y-auto">
      {Object.entries(modelCategories).map(([categoryKey, category]) => (
        <div key={categoryKey} className="px-3 py-2">
          {/* Category Header */}
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide">
                {category.title}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {category.description}
              </p>
            </div>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              categoryKey === 'platform'
                ? 'bg-loxia-100 text-loxia-700 dark:bg-loxia-900/30 dark:text-loxia-300'
                : categoryKey === 'local'
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
            }`}>
              {category.badge}
            </span>
          </div>

          {/* Models in Category */}
          <div className="space-y-1">
            {category.models.map((model) => {
              const isSelected = currentModel === model.modelName;
              const isDisabled = disabled || (model.requiresKey && !model.available);

              return (
                <button
                  type="button"
                  key={model.id}
                  onClick={() => handleModelClick(model.modelName)}
                  disabled={isDisabled}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    isSelected
                      ? 'bg-loxia-50 dark:bg-loxia-900/20 text-loxia-700 dark:text-loxia-300'
                      : isDisabled
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium truncate">
                          {model.displayName || model.name}
                        </span>
                        {model.features?.supportsVision && (
                          <span className="px-1 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded">
                            Vision
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2 mt-0.5">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {model.provider}
                        </span>
                        {model.features?.maxTokens && (
                          <>
                            <span className="text-xs text-gray-400">•</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {model.features.maxTokens} tokens
                            </span>
                          </>
                        )}
                        {model.pricing && (
                          <>
                            <span className="text-xs text-gray-400">•</span>
                            <span className={`text-xs ${model.local ? 'text-green-600 dark:text-green-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                              {model.local ? 'Free' : `$${model.pricing.input}/${model.pricing.output}`}
                            </span>
                          </>
                        )}
                      </div>
                      {isDisabled && model.requiresKey && (
                        <span className="text-xs text-red-500 dark:text-red-400 mt-1">
                          API key required
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <CheckIcon className="w-5 h-5 text-loxia-600 dark:text-loxia-400 flex-shrink-0 ml-2" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Divider between categories */}
          {categoryKey !== 'local' && (
            <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
          )}
        </div>
      ))}
    </div>
  );
}

export default ModelSelectorDropdown;
