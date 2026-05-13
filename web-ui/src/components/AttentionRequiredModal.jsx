import React, { useState, useEffect } from 'react';
import {
  ExclamationCircleIcon,
  ShieldCheckIcon,
  KeyIcon,
  CheckCircleIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';
import { ISSUE_TYPES } from '../hooks/useAttentionRequired.js';
import { CONSENT_LEVELS } from '../hooks/useConsent.js';
import { api } from '../services/api.js';
import { useAppStore } from '../stores/appStore.js';
import { useModelsStore } from '../stores/modelsStore.js';
import { skipProviderKey } from '../utils/providerKeySkip.js';
import toast from 'react-hot-toast';

const SETTINGS_STORAGE_KEY = 'loxia-settings';
const CONSENT_STORAGE_KEY = 'loxia-analytics-consent';

/**
 * AttentionRequiredModal - Unified modal for all startup issues
 *
 * Shows issues that need user attention before fully using the system.
 * Currently handles: Privacy consent, API key configuration
 */
const PROVIDERS = [
  { id: 'openai',    label: 'OpenAI',        placeholder: 'sk-...' },
  { id: 'anthropic', label: 'Anthropic',     placeholder: 'sk-ant-...' },
  { id: 'gemini',    label: 'Google Gemini', placeholder: 'AIza...' },
  { id: 'xai',       label: 'xAI',           placeholder: 'xai-...' },
];

function AttentionRequiredModal({ issues, onResolve, onClose }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [providerId, setProviderId] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const sessionId = useAppStore((state) => state.sessionId);
  // Read at modal open. Used to tailor the skip toast — Ollama users get
  // a confirmation that local models are available; everyone else gets a
  // gentle "limited mode" note. Stored in modelsStore by the rest of the
  // app, so we don't need to refetch here.
  const ollamaAvailable = useModelsStore((state) => state.ollamaAvailable);

  // Load existing key for the currently-selected provider, if any.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const existing = parsed.apiKeys?.[providerId];
        setApiKey(existing && typeof existing === 'string' ? existing : '');
      } else {
        setApiKey('');
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }, [providerId]);

  // Reset currentStep when issues array changes to prevent out-of-bounds access
  // When an issue is resolved, the parent removes it from the array, so we need
  // to ensure currentStep stays valid (the next issue becomes index 0)
  useEffect(() => {
    if (currentStep >= issues.length && issues.length > 0) {
      setCurrentStep(0);
    }
  }, [issues, currentStep]);

  const currentIssue = issues[currentStep];
  const allResolved = issues.length === 0;

  // Handle privacy consent
  const handleConsentChoice = (level) => {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
        level,
        timestamp: new Date().toISOString(),
        hasConsented: true
      }));
      window.dispatchEvent(new CustomEvent('consent-updated'));
      onResolve(ISSUE_TYPES.PRIVACY_CONSENT);
      // Note: Don't increment currentStep here. When onResolve is called,
      // the parent removes this issue from the array, so the next issue
      // naturally becomes index 0. The useEffect above handles this.
    } catch (error) {
      console.error('Failed to save consent:', error);
    }
  };

  // Skip path — same persistent flag the onboarding wizard sets, so the
  // user is never asked twice. Falling back to Ollama works as long as
  // the user starts the daemon; if it isn't running, the app still
  // functions but model calls will fail until they add a key from
  // Settings. We don't gate the skip on Ollama availability — that's
  // the user's call.
  const handleSkipApiKey = () => {
    skipProviderKey();
    if (ollamaAvailable) {
      toast.success('We will not ask again. Local Ollama models are available.');
    } else {
      toast('We will not ask again. Add a key any time from Settings.', {
        icon: 'ℹ️',
      });
    }
    onResolve(ISSUE_TYPES.API_KEY_MISSING);
  };

  // Handle API key save — writes the key under the selected provider.
  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      toast.error('Please enter an API key');
      return;
    }

    try {
      const existingSettings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
      const newSettings = {
        ...existingSettings,
        apiKeys: {
          ...existingSettings.apiKeys,
          [providerId]: apiKey.trim(),
        },
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));

      // Also persist to the backend session.
      await api.setApiKeys(sessionId || null, {
        vendorKeys: { [providerId]: apiKey.trim() },
      });

      window.dispatchEvent(new CustomEvent('apikey-updated'));
      window.dispatchEvent(new CustomEvent('settings-updated'));
      onResolve(ISSUE_TYPES.API_KEY_MISSING);
      toast.success(`${PROVIDERS.find(p => p.id === providerId)?.label || providerId} key saved`);
    } catch (error) {
      console.error('Failed to save API key:', error);
      toast.error('Failed to save API key');
    }
  };

  // Consent options
  const consentOptions = [
    {
      level: CONSENT_LEVELS.NONE,
      title: 'Decline All',
      description: 'No analytics data collected',
      icon: ShieldCheckIcon,
      iconBg: 'bg-gray-100 dark:bg-gray-700',
      iconColor: 'text-gray-600 dark:text-gray-400'
    },
    {
      level: CONSENT_LEVELS.BASIC,
      title: 'Basic Analytics',
      description: 'Interaction data only, text masked',
      icon: ChartBarIcon,
      iconBg: 'bg-blue-100 dark:bg-blue-900/30',
      iconColor: 'text-blue-600 dark:text-blue-400'
    },
    {
      level: CONSENT_LEVELS.FULL,
      title: 'Full Analytics',
      description: 'Complete usage data',
      icon: ChatBubbleLeftRightIcon,
      iconBg: 'bg-loxia-100 dark:bg-loxia-900/30',
      iconColor: 'text-loxia-600 dark:text-loxia-400',
      recommended: true
    }
  ];

  // If all issues resolved, show success and close
  if (allResolved) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6 text-center">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircleIcon className="w-10 h-10 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            All Set!
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            You're ready to use OnBuzz Community
          </p>
          <button onClick={onClose} className="button-primary w-full">
            Get Started
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center">
            <ExclamationCircleIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="ml-3 flex-1">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Some things require your attention
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Please complete the following before continuing
            </p>
          </div>
        </div>

        {/* Progress Indicator */}
        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-2">
            {issues.map((issue, index) => (
              <React.Fragment key={issue.type}>
                <div className={`flex items-center ${index === currentStep ? 'text-loxia-600 dark:text-loxia-400' : 'text-gray-400'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                    index < currentStep
                      ? 'bg-green-500 text-white'
                      : index === currentStep
                        ? 'bg-loxia-600 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                  }`}>
                    {index < currentStep ? (
                      <CheckIcon className="w-4 h-4" />
                    ) : (
                      index + 1
                    )}
                  </div>
                  <span className={`ml-2 text-sm font-medium ${
                    index === currentStep ? 'text-gray-900 dark:text-gray-100' : ''
                  }`}>
                    {issue.title}
                  </span>
                </div>
                {index < issues.length - 1 && (
                  <ArrowRightIcon className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Privacy Consent Section */}
          {currentIssue?.type === ISSUE_TYPES.PRIVACY_CONSENT && (
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                We use Microsoft Clarity to understand how you interact with our interface.
                Choose your preferred level of data sharing below.
              </p>

              <div className="space-y-3">
                {consentOptions.map((option) => {
                  const IconComponent = option.icon;
                  return (
                    <button
                      key={option.level}
                      onClick={() => handleConsentChoice(option.level)}
                      className={`relative w-full p-4 rounded-lg border-2 text-left transition-colors hover:border-loxia-400 ${
                        option.recommended
                          ? 'border-loxia-300 dark:border-loxia-700 bg-loxia-50/50 dark:bg-loxia-900/10'
                          : 'border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      {option.recommended && (
                        <span className="absolute -top-2 right-4 px-2 py-0.5 text-xs font-medium bg-loxia-600 text-white rounded-full">
                          Recommended
                        </span>
                      )}
                      <div className="flex items-center">
                        <div className={`w-10 h-10 ${option.iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                          <IconComponent className={`w-5 h-5 ${option.iconColor}`} />
                        </div>
                        <div className="ml-4">
                          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                            {option.title}
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {option.description}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  You can change your preferences anytime in Settings. API keys and sensitive data are never collected.
                </p>
              </div>
            </div>
          )}

          {/* API Key Section */}
          {currentIssue?.type === ISSUE_TYPES.API_KEY_MISSING && (
            <div>
              <div className="flex items-start mb-6">
                <div className="w-10 h-10 bg-loxia-100 dark:bg-loxia-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                  <KeyIcon className="w-6 h-6 text-loxia-600 dark:text-loxia-400" />
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Add a provider key
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    OnBuzz Community talks to providers directly — your key stays on this machine.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Provider
                  </label>
                  <select
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                    className="input-primary w-full"
                  >
                    {PROVIDERS.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && apiKey.trim()) {
                          handleSaveApiKey();
                        }
                      }}
                      placeholder={PROVIDERS.find(p => p.id === providerId)?.placeholder || ''}
                      className="input-primary pr-10 w-full"
                      data-clarity-mask="always"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    >
                      {showApiKey ? (
                        <EyeSlashIcon className="w-4 h-4 text-gray-400" />
                      ) : (
                        <EyeIcon className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                    Don't have one?
                  </h4>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Generate a key from the provider's dashboard, or skip this and run an Ollama model locally — see Settings.
                  </p>
                </div>

                <div className="space-y-2">
                  <button
                    onClick={handleSaveApiKey}
                    disabled={!apiKey.trim()}
                    className="button-primary w-full disabled:opacity-50"
                  >
                    Save key & continue
                  </button>
                  {/* Skip path mirrors the onboarding wizard — same
                      persistent flag, so anyone who skipped during
                      onboarding never sees this dialog at all, and anyone
                      who skips here is not prompted again. Continuation
                      is always enabled (no disabled state). */}
                  <button
                    onClick={handleSkipApiKey}
                    className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:underline py-1.5"
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {currentStep + 1} of {issues.length} items require attention
          </p>
        </div>
      </div>
    </div>
  );
}

export default AttentionRequiredModal;
