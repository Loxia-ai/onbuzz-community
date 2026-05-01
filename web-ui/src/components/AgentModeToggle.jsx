import React, { useState } from 'react';
import { AGENT_MODES } from '../constants/index.js';
import { api } from '../services/api.js';
import { useAppStore } from '../stores/appStore.js';

/**
 * AgentModeToggle - Segmented control for Guided Chat/Autopilot mode
 *
 * A pill-shaped toggle with both options visible and a sliding indicator.
 * Reflects server-side mode changes via agent prop from store.
 */
const AgentModeToggle = ({ agent, onModeChange }) => {
  const sessionId = useAppStore((state) => state.sessionId);
  const [isUpdating, setIsUpdating] = useState(false);

  // Read directly from agent prop
  const currentMode = agent?.mode || AGENT_MODES.CHAT;
  const isAgentMode = currentMode === AGENT_MODES.AGENT;

  const handleModeSelect = async (mode) => {
    if (!agent || isUpdating || currentMode === mode) return;

    setIsUpdating(true);

    try {
      const response = await api.setAgentMode(agent.id, mode, false, sessionId);
      if (response.success && response.agent && onModeChange) {
        onModeChange(response.agent);
      }
    } catch (error) {
      console.error('Failed to update agent mode:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div
      className="relative flex items-center bg-gray-100 dark:bg-gray-700 rounded-full p-0.5"
      title={isAgentMode
        ? 'Autopilot Mode: AI works autonomously with tools'
        : 'Guided Chat Mode: Direct conversation only'
      }
    >
      {/* Sliding indicator */}
      <div
        className={`absolute h-[calc(100%-4px)] w-[calc(50%-2px)] rounded-full transition-all duration-200 ease-out ${
          isAgentMode
            ? 'translate-x-[calc(100%+2px)] bg-green-500 dark:bg-green-600'
            : 'translate-x-0 bg-white dark:bg-gray-600 shadow-sm'
        }`}
      />

      {/* Chat option */}
      <button
        onClick={() => handleModeSelect(AGENT_MODES.CHAT)}
        disabled={isUpdating}
        className={`relative z-10 px-3 py-1 text-xs font-medium rounded-full transition-colors duration-200 ${
          !isAgentMode
            ? 'text-gray-900 dark:text-gray-100'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
        } ${isUpdating ? 'opacity-50 cursor-wait' : ''}`}
      >
        Guided Chat
      </button>

      {/* Autopilot option */}
      <button
        onClick={() => handleModeSelect(AGENT_MODES.AGENT)}
        disabled={isUpdating}
        className={`relative z-10 px-3 py-1 text-xs font-medium rounded-full transition-colors duration-200 ${
          isAgentMode
            ? 'text-white'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
        } ${isUpdating ? 'opacity-50 cursor-wait' : ''}`}
      >
        Autopilot
      </button>
    </div>
  );
};

export default AgentModeToggle;
