import React from 'react';
import {
  XMarkIcon,
  BoltIcon,
  Cog6ToothIcon,
  DocumentDuplicateIcon
} from '@heroicons/react/24/outline';

/**
 * AgentDuplicateOptionsModal - Quick selection for duplication method
 *
 * Options:
 * 1. Quick Clone - Instant copy with empty conversation, auto-generated name
 * 2. Clone & Configure - Opens creation modal with pre-filled settings
 */
function AgentDuplicateOptionsModal({ agent, onClose, onQuickClone, onCloneWithSettings }) {
  if (!agent) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center">
            <DocumentDuplicateIcon className="w-5 h-5 text-loxia-600 dark:text-loxia-400 mr-2" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Clone Pilot
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Create a copy of <strong className="text-gray-900 dark:text-gray-100">{agent.name}</strong>
          </p>

          <div className="space-y-3">
            {/* Quick Clone Option */}
            <button
              onClick={onQuickClone}
              className="w-full flex items-start p-4 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-loxia-400 dark:hover:border-loxia-500 hover:bg-loxia-50 dark:hover:bg-loxia-900/10 transition-all text-left group"
            >
              <div className="flex-shrink-0 w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center mr-3 group-hover:bg-green-200 dark:group-hover:bg-green-900/50 transition-colors">
                <BoltIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  Quick Clone
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Instant copy with fresh conversation. Auto-generated name, same settings.
                </div>
              </div>
            </button>

            {/* Clone & Configure Option */}
            <button
              onClick={onCloneWithSettings}
              className="w-full flex items-start p-4 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-loxia-400 dark:hover:border-loxia-500 hover:bg-loxia-50 dark:hover:bg-loxia-900/10 transition-all text-left group"
            >
              <div className="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mr-3 group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50 transition-colors">
                <Cog6ToothIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  Clone & Configure
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Customize name, model, and settings. Option to keep conversation history.
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="button-secondary text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default AgentDuplicateOptionsModal;
