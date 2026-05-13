import React from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { PROVIDERS } from './providers.js';

/**
 * Step 1 — pick the model provider OnBuzz should talk to.
 *
 * Stateless tile picker. The selected provider id is hoisted into the
 * parent OnboardingFlow so subsequent steps can read it.
 */
function StepProvider({ selectedProviderId, onSelect, onContinue }) {
  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
        Choose how OnBuzz will connect to a model. You can change this later in Settings.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PROVIDERS.map((provider) => {
          const isSelected = selectedProviderId === provider.id;
          const isLocal = !provider.cloud;
          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => onSelect(provider.id)}
              className={`relative text-left p-4 rounded-lg border-2 transition-colors ${
                isSelected
                  ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-loxia-300 dark:hover:border-loxia-700'
              }`}
            >
              {isSelected && (
                <CheckCircleIcon className="absolute top-3 right-3 w-5 h-5 text-loxia-600 dark:text-loxia-400" />
              )}
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {provider.label}
                </h3>
                <span
                  className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full ${
                    isLocal
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  }`}
                >
                  {provider.costHint}
                </span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {provider.description}
              </p>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          disabled={!selectedProviderId}
          className="button-primary disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export default StepProvider;
