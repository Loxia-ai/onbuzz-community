import React from 'react';
import {
  XMarkIcon,
  ShieldCheckIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  CheckIcon
} from '@heroicons/react/24/outline';
import { CONSENT_LEVELS } from '../hooks/useConsent.js';

/**
 * ConsentDialog - GDPR-compliant analytics consent modal
 *
 * Two-level consent:
 * - Basic: Interface usage (clicks, scrolls, heatmaps) with all text masked
 * - Full: Everything including actual text content
 */
function ConsentDialog({ onConsent, currentLevel, onClose, canClose = false }) {
  const consentOptions = [
    {
      level: CONSENT_LEVELS.NONE,
      title: 'Decline All',
      description: 'No analytics data will be collected. Your usage remains completely private.',
      icon: ShieldCheckIcon,
      iconBg: 'bg-gray-100 dark:bg-gray-700',
      iconColor: 'text-gray-600 dark:text-gray-400',
      buttonClass: 'button-secondary'
    },
    {
      level: CONSENT_LEVELS.BASIC,
      title: 'Basic Analytics',
      description: 'Help us improve by sharing interaction data (clicks, scrolls, navigation). All text inputs are masked and never collected.',
      icon: ChartBarIcon,
      iconBg: 'bg-blue-100 dark:bg-blue-900/30',
      iconColor: 'text-blue-600 dark:text-blue-400',
      buttonClass: 'button-secondary border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20',
      features: [
        'Click and scroll patterns',
        'Navigation flow',
        'Session recordings (text masked)',
        'Heatmaps'
      ]
    },
    {
      level: CONSENT_LEVELS.FULL,
      title: 'Full Analytics',
      description: 'Share complete usage data including text inputs to help us understand how you use the interface and improve your experience.',
      icon: ChatBubbleLeftRightIcon,
      iconBg: 'bg-loxia-100 dark:bg-loxia-900/30',
      iconColor: 'text-loxia-600 dark:text-loxia-400',
      buttonClass: 'button-primary',
      features: [
        'Everything in Basic Analytics',
        'Text input content',
        'Full session recordings',
        'Detailed interaction data'
      ],
      recommended: true
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-loxia-600 rounded-lg flex items-center justify-center">
              <ShieldCheckIcon className="w-6 h-6 text-white" />
            </div>
            <div className="ml-3">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Privacy & Analytics
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Help us improve OnBuzz Community
              </p>
            </div>
          </div>

          {canClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg"
            >
              <XMarkIcon className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
            We use Microsoft Clarity to understand how you interact with our interface.
            This helps us identify issues and improve the user experience.
            Choose your preferred level of data sharing below.
          </p>

          <div className="space-y-4">
            {consentOptions.map((option) => {
              const IconComponent = option.icon;
              const isSelected = currentLevel === option.level;

              return (
                <div
                  key={option.level}
                  className={`relative p-4 rounded-lg border-2 transition-colors ${
                    isSelected
                      ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {option.recommended && (
                    <span className="absolute -top-2 right-4 px-2 py-0.5 text-xs font-medium bg-loxia-600 text-white rounded-full">
                      Recommended
                    </span>
                  )}

                  <div className="flex items-start">
                    <div className={`w-10 h-10 ${option.iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                      <IconComponent className={`w-5 h-5 ${option.iconColor}`} />
                    </div>

                    <div className="ml-4 flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                          {option.title}
                        </h3>
                        {isSelected && (
                          <CheckIcon className="w-5 h-5 text-loxia-600" />
                        )}
                      </div>

                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        {option.description}
                      </p>

                      {option.features && (
                        <ul className="mt-3 space-y-1">
                          {option.features.map((feature, index) => (
                            <li key={index} className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                              <CheckIcon className="w-3.5 h-3.5 text-green-500 mr-2 flex-shrink-0" />
                              {feature}
                            </li>
                          ))}
                        </ul>
                      )}

                      <button
                        onClick={() => onConsent(option.level)}
                        className={`mt-4 w-full ${option.buttonClass} text-sm py-2`}
                      >
                        {isSelected ? 'Currently Selected' : `Choose ${option.title}`}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Privacy Notice */}
          <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              Your Privacy Matters
            </h4>
            <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <li>• Data is processed by Microsoft Clarity in accordance with their privacy policy</li>
              <li>• No data is sold to third parties</li>
              <li>• You can change your preferences anytime in Settings</li>
              <li>• API keys and sensitive credentials are never collected</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-b-lg">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            OnBuzz Community is open-source under the Apache-2.0 license. No telemetry; your data stays on your machine.
          </p>
        </div>
      </div>
    </div>
  );
}

export default ConsentDialog;
