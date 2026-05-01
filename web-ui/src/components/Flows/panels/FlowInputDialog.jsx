import React, { useState, useRef, useEffect } from 'react';
import {
  XMarkIcon,
  PlayIcon,
  DocumentTextIcon,
  UserCircleIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { api } from '../../../services/api.js';

/**
 * FlowInputDialog - Modal for entering initial input when running a flow
 */
function FlowInputDialog({ flow, onRun, onCancel }) {
  const [userInput, setUserInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [agentStatus, setAgentStatus] = useState([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const textareaRef = useRef(null);

  // Fetch agent status on mount
  useEffect(() => {
    const fetchAgentStatus = async () => {
      try {
        const response = await api.getFlowAgentStatus(flow.id);
        if (response.success) {
          setAgentStatus(response.data || []);
        }
      } catch (error) {
        console.error('Failed to fetch agent status:', error);
      } finally {
        setLoadingAgents(false);
      }
    };

    fetchAgentStatus();
  }, [flow.id]);

  // Focus textarea on mount
  useEffect(() => {
    if (!loadingAgents) {
      textareaRef.current?.focus();
    }
  }, [loadingAgents]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!userInput.trim()) return;

    setIsSubmitting(true);
    try {
      await onRun(userInput.trim());
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e) => {
    // Ctrl/Cmd + Enter to submit
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(e);
    }
    // Escape to cancel
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  const unloadedAgents = agentStatus.filter(a => !a.isLoaded);
  const missingAgents = agentStatus.filter(a => a.notFound);
  const hasAgents = agentStatus.length > 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <DocumentTextIcon className="w-5 h-5 text-loxia-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Run Flow: {flow.name}
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-4">
            {/* Agent Status Section */}
            {hasAgents && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <UserCircleIcon className="w-4 h-4" />
                  Agents in this flow
                </div>

                {loadingAgents ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <ArrowPathIcon className="w-4 h-4 animate-spin" />
                    Checking agents...
                  </div>
                ) : (
                  <div className="space-y-1">
                    {agentStatus.map(agent => (
                      <div
                        key={agent.agentId}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                      >
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {agent.name}
                        </span>
                        {agent.notFound ? (
                          <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                            Not Found
                          </span>
                        ) : agent.isLoaded ? (
                          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <CheckCircleIcon className="w-3.5 h-3.5" />
                            Loaded
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                            <ArrowPathIcon className="w-3.5 h-3.5" />
                            Will load
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Warning for unloaded agents */}
                {unloadedAgents.length > 0 && !loadingAgents && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg">
                    {unloadedAgents.length} agent(s) will be automatically loaded from disk when the flow starts.
                  </p>
                )}

                {/* Error for missing agents */}
                {missingAgents.length > 0 && (
                  <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                    {missingAgents.length} agent(s) could not be found. The flow may fail.
                  </p>
                )}
              </div>
            )}

            {/* Input Section */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Enter your input
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                This will be passed to the flow as <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">{'{{userInput}}'}</code>
              </p>
              <textarea
                ref={textareaRef}
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your input here..."
                rows={6}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-loxia-500 focus:border-transparent resize-none"
              />
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                Press <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">Ctrl+Enter</kbd> to run
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!userInput.trim() || isSubmitting || missingAgents.length > 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PlayIcon className="w-4 h-4" />
              {isSubmitting ? 'Starting...' : 'Run Flow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default FlowInputDialog;
