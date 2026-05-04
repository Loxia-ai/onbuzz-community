import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRightIcon,
  CheckIcon,
  XMarkIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import StepProvider from './StepProvider.jsx';
import StepConnect from './StepConnect.jsx';
import StepAgent from './StepAgent.jsx';
import { brand } from '../../config/brand.js';

const STEPS = [
  { id: 'provider', title: 'Provider' },
  { id: 'connect', title: 'Connect' },
  { id: 'agent', title: 'First agent' },
];

/**
 * OnboardingFlow — the 3-step first-run wizard.
 *
 * Mounted by App.jsx when useOnboarding decides the user is fresh. Owns
 * the inter-step state (selected provider, model list returned by the
 * connection test) and persists completion via the onComplete callback.
 *
 * The wizard is a focus-trapping modal rather than a route so it overlays
 * cleanly regardless of where the user landed (deep link, refresh, etc.)
 * and so the existing AttentionRequiredModal can stay out of the way.
 */
function OnboardingFlow({ onComplete, onSkip }) {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [providerId, setProviderId] = useState(null);
  const [providerModels, setProviderModels] = useState([]);
  // True when the user advances from step 2 without verifying a key
  // (cloud providers only). Step 3 reads this and falls back to Ollama
  // — or, if Ollama is also unreachable, offers a finish-without-agent
  // exit so the user is never stuck.
  const [connectionSkipped, setConnectionSkipped] = useState(false);

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  // When the user picks a different provider on step 1, drop any models
  // collected from a previous test — those belonged to the old provider.
  // Also clear the skipped flag so each new provider gets a fresh chance.
  const handleSelectProvider = (pid) => {
    if (pid !== providerId) {
      setProviderModels([]);
      setConnectionSkipped(false);
    }
    setProviderId(pid);
  };

  const handleConnected = ({ providerId: pid, models }) => {
    setProviderId(pid);
    setProviderModels(models || []);
    setConnectionSkipped(false);
    goNext();
  };

  const handleSkipConnection = () => {
    setProviderModels([]);
    setConnectionSkipped(true);
    goNext();
  };

  const handleAgentCreated = () => {
    onComplete?.();
    navigate('/');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="w-10 h-10 bg-loxia-600 rounded-lg flex items-center justify-center">
            <SparklesIcon className="w-6 h-6 text-white" />
          </div>
          <div className="ml-3 flex-1">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Welcome to {brand.fullProductName}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Three quick steps to your first chat.
            </p>
          </div>
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg"
              aria-label="Skip onboarding"
              title="Skip for now"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Progress */}
        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-2">
            {STEPS.map((step, index) => {
              const done = index < stepIndex;
              const active = index === stepIndex;
              return (
                <React.Fragment key={step.id}>
                  <div className="flex items-center">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                        done
                          ? 'bg-green-500 text-white'
                          : active
                            ? 'bg-loxia-600 text-white'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                      }`}
                    >
                      {done ? <CheckIcon className="w-4 h-4" /> : index + 1}
                    </div>
                    <span
                      className={`ml-2 text-sm font-medium ${
                        active
                          ? 'text-gray-900 dark:text-gray-100'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>
                  {index < STEPS.length - 1 && (
                    <ArrowRightIcon className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {stepIndex === 0 && (
            <StepProvider
              selectedProviderId={providerId}
              onSelect={handleSelectProvider}
              onContinue={goNext}
            />
          )}
          {stepIndex === 1 && providerId && (
            <StepConnect
              providerId={providerId}
              onBack={goBack}
              onConnected={handleConnected}
              onSkip={handleSkipConnection}
            />
          )}
          {stepIndex === 2 && providerId && (
            <StepAgent
              providerId={providerId}
              providerModels={providerModels}
              connectionSkipped={connectionSkipped}
              onBack={goBack}
              onCreated={handleAgentCreated}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Step {stepIndex + 1} of {STEPS.length}
          </p>
        </div>
      </div>
    </div>
  );
}

export default OnboardingFlow;
