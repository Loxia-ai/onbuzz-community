import React, { useEffect, useCallback } from 'react';
import { XMarkIcon, KeyIcon } from '@heroicons/react/24/outline';
import { getShortcutsByCategory, isMac } from '../utils/keyboardShortcuts.js';

function HelpModal({ isOpen, onClose }) {
  const shortcutsByCategory = getShortcutsByCategory();

  // Close on Escape key
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  // Category order for display
  const categoryOrder = ['Chat', 'Navigation', 'Squadron', 'General'];

  // Sort categories
  const sortedCategories = Object.keys(shortcutsByCategory).sort((a, b) => {
    const indexA = categoryOrder.indexOf(a);
    const indexB = categoryOrder.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Help
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
            {/* Keyboard Shortcuts Section */}
            <div className="mb-6">
              <div className="flex items-center mb-4">
                <KeyIcon className="w-5 h-5 text-loxia-600 dark:text-loxia-400 mr-2" />
                <h3 className="text-md font-semibold text-gray-900 dark:text-gray-100">
                  Keyboard Shortcuts
                </h3>
              </div>

              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                {isMac ? 'Using Mac keyboard layout' : 'Using Windows/Linux keyboard layout'}
              </p>

              {sortedCategories.map((category) => (
                <div key={category} className="mb-4">
                  <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
                    {category}
                  </h4>
                  <div className="space-y-2">
                    {shortcutsByCategory[category].map((shortcut) => (
                      <div
                        key={shortcut.id}
                        className="flex items-center justify-between py-1.5"
                      >
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {shortcut.description}
                        </span>
                        <kbd className="inline-flex items-center px-2 py-1 text-xs font-mono font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                          {shortcut.displayKeys}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Additional Help */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-md font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Quick Tips
              </h3>
              <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li className="flex items-start">
                  <span className="text-loxia-500 mr-2">-</span>
                  <span>Use the sidebar to switch between Chat, Agents, and Settings</span>
                </li>
                <li className="flex items-start">
                  <span className="text-loxia-500 mr-2">-</span>
                  <span>Click the agent dropdown in the top bar to quickly switch agents</span>
                </li>
                <li className="flex items-start">
                  <span className="text-loxia-500 mr-2">-</span>
                  <span>Attach files using the paperclip icon or drag and drop</span>
                </li>
                <li className="flex items-start">
                  <span className="text-loxia-500 mr-2">-</span>
                  <span>Toggle between Chat and Agent modes using the mode switch</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              Press <kbd className="px-1 py-0.5 text-xs font-mono bg-gray-200 dark:bg-gray-700 rounded">Esc</kbd> to close
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HelpModal;
