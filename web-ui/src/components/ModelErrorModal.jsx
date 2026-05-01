import React, { useState } from 'react';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XMarkIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { useAppStore } from '../stores/appStore.js';

/**
 * Error type to user-friendly message mapping
 */
const ERROR_MESSAGES = {
  model_not_found: 'The selected model is not available',
  rate_limit: 'Rate limit exceeded for this model',
  context_exceeded: 'Message too long for this model\'s context window',
  model_overloaded: 'Model is currently overloaded',
  auth_error: 'Authentication error with model provider',
  unknown: 'An error occurred with this model'
};

/**
 * Modal that appears when a model error occurs, suggesting alternative models
 */
function ModelErrorModal() {
  const {
    pendingModelError,
    clearPendingModelError,
    handleModelErrorSwitch
  } = useAppStore();

  const [selectedModel, setSelectedModel] = useState(null);
  const [isSwitching, setIsSwitching] = useState(false);

  if (!pendingModelError) return null;

  const {
    agentName,
    model,
    errorType,
    errorMessage,
    suggestions
  } = pendingModelError;

  const handleSwitch = async () => {
    if (!selectedModel) return;

    setIsSwitching(true);
    try {
      await handleModelErrorSwitch(selectedModel);
    } finally {
      setIsSwitching(false);
    }
  };

  const handleDismiss = () => {
    clearPendingModelError();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-amber-50 dark:bg-amber-900/30 px-6 py-4 border-b border-amber-200 dark:border-amber-800">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-800 rounded-full">
                <ExclamationTriangleIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Model Error
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {agentName}
                </p>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="p-1 hover:bg-amber-200 dark:hover:bg-amber-700 rounded-full transition-colors"
            >
              <XMarkIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {/* Error details */}
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              {ERROR_MESSAGES[errorType] || ERROR_MESSAGES.unknown}
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              Model: {model}
            </p>
            {errorMessage && errorMessage !== ERROR_MESSAGES[errorType] && (
              <p className="text-xs text-red-500 dark:text-red-500 mt-1 truncate">
                {errorMessage}
              </p>
            )}
          </div>

          {/* Suggestions */}
          {suggestions && suggestions.length > 0 ? (
            <>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Switch to an alternative model:
              </p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.name}
                    onClick={() => setSelectedModel(suggestion.name)}
                    className={`w-full p-3 rounded-lg border text-left transition-all ${
                      selectedModel === suggestion.name
                        ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/30'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {suggestion.displayName || suggestion.name}
                        </span>
                        {suggestion.provider && (
                          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                            {suggestion.provider}
                          </span>
                        )}
                      </div>
                      {suggestion.verified && (
                        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                          <CheckCircleIcon className="w-3 h-3" />
                          Verified
                        </span>
                      )}
                    </div>
                    {suggestion.contextWindow && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Context: {(suggestion.contextWindow / 1000).toFixed(0)}K tokens
                      </p>
                    )}
                    {suggestion.failureCount > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        {suggestion.failureCount} recent error{suggestion.failureCount > 1 ? 's' : ''}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No alternative models available.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={handleDismiss}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            Dismiss
          </button>
          {suggestions && suggestions.length > 0 && (
            <button
              onClick={handleSwitch}
              disabled={!selectedModel || isSwitching}
              className="px-4 py-2 text-sm font-medium text-white bg-loxia-600 hover:bg-loxia-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
            >
              {isSwitching && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
              {isSwitching ? 'Switching & Resending...' : 'Switch & Resend'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ModelErrorModal;
