/**
 * Main Layout Component
 * Integrates all state management hooks and renders the complete UI
 */

import React, { useState, useEffect } from 'react';
import { Box, useInput, useStdout } from 'ink';
import { debugLog } from '../utils/debugLogger.js';

// Import state management hooks
import { SessionManager } from '../api/session.js';
import { WebSocketManager } from '../api/websocket.js';
import { MessageRouter } from '../api/messageRouter.js';
import { useConnection } from '../state/useConnection.js';
import { useAgents } from '../state/useAgents.js';
import { useMessages } from '../state/useMessages.js';
import { useAgentControl } from '../state/useAgentControl.js';
import { useTools } from '../state/useTools.js';

// Import settings storage utility
import { loadSettings, saveSettings, hasLoxiaApiKey } from '../utils/settingsStorage.js';

// Import child components
import Header from './Header.js';
import StatusBar from './StatusBar.js';
import MessageList from './MessageList.js';
import InputBox from './InputBox.js';

// Import Phase 10 advanced components
import AgentSwitcher from './AgentSwitcher.js';
import AgentCreator from './AgentCreator.js';
import AgentEditor from './AgentEditor.js';
import SettingsPanel from './SettingsPanel.js';
import SearchPanel from './SearchPanel.js';
import HelpPanel from './HelpPanel.js';
import ErrorPanel from './ErrorPanel.js';

/**
 * Main Layout Component
 */
export function Layout({ host = 'localhost', port = 8080 }) {
  // Get terminal dimensions for responsive layout
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24; // Default to 24 rows if not available
  const terminalWidth = stdout?.columns || 80; // Default to 80 columns if not available

  // Calculate compact mode: hide header/statusbar if terminal is too small
  // Minimum comfortable height: 15 rows (3 for input, 12+ for messages)
  const compactMode = terminalHeight < 15;

  // Phase 10: Settings state - Load from persistent storage (must load before creating managers)
  const [settings, setSettings] = useState(() => loadSettings());

  // Initialize managers (with settings)
  const [sessionManager] = useState(() => new SessionManager(host, port));
  const [wsManager] = useState(() => new WebSocketManager(host, port, {
    reconnectDelay: settings.reconnectDelay,
    heartbeatInterval: settings.heartbeatInterval,
  }));
  const [messageRouter] = useState(() => new MessageRouter(wsManager));

  // Current agent state
  const [currentAgent, setCurrentAgent] = useState(null);

  // Phase 10: Overlay state
  const [activeOverlay, setActiveOverlay] = useState(null); // 'switcher', 'creator', 'editor', 'settings', 'search', 'help', 'errors'

  // Agent being edited
  const [agentToEdit, setAgentToEdit] = useState(null);

  // Error tracking state
  const [errors, setErrors] = useState([]);

  // Add error to the error log
  const addError = (type, message, stack) => {
    const error = {
      timestamp: Date.now(),
      type: type || 'ERROR',
      message: message || 'Unknown error',
      stack: stack || '',
    };

    setErrors(prev => {
      // Keep max 50 errors
      const newErrors = [error, ...prev].slice(0, 50);
      return newErrors;
    });
  };

  // Clear all errors
  const clearErrors = () => {
    setErrors([]);
  };

  // Dismiss a single error
  const dismissError = (index) => {
    setErrors(prev => prev.filter((_, i) => i !== index));
  };

  // Set up global error listeners
  useEffect(() => {
    const handleError = (error) => {
      addError('UNCAUGHT EXCEPTION', error.message, error.stack);
    };

    const handleRejection = (reason) => {
      const message = reason?.message || String(reason);
      const stack = reason?.stack || '';
      addError('UNHANDLED REJECTION', message, stack);
    };

    // Capture console.error calls (suppress output to prevent UI corruption)
    const originalConsoleError = console.error;
    console.error = (...args) => {
      const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
      addError('CONSOLE ERROR', message);
      // DON'T call original console.error to prevent errors appearing above UI
    };

    process.on('uncaughtException', handleError);
    process.on('unhandledRejection', handleRejection);

    return () => {
      process.removeListener('uncaughtException', handleError);
      process.removeListener('unhandledRejection', handleRejection);
      console.error = originalConsoleError;
    };
  }, []);

  // Connection state
  const connection = useConnection(sessionManager, wsManager);

  // Agent management
  const agents = useAgents(sessionManager, messageRouter);

  // Messages management
  const messages = useMessages(sessionManager, messageRouter, currentAgent?.agentId);

  // Agent control (mode, model)
  const agentControl = useAgentControl(sessionManager, messageRouter, currentAgent);

  // Tools management
  const tools = useTools(sessionManager, messageRouter, currentAgent?.agentId);

  // Initialize connection on mount
  useEffect(() => {
    connection.connect();

    return () => {
      connection.disconnect();
    };
  }, []);

  // Load agents when connected
  useEffect(() => {
    if (connection.isConnected && agents.agents.length === 0) {
      agents.fetchAgents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.isConnected, agents.agents.length]);

  // Set current agent when agents are loaded
  useEffect(() => {
    if (agents.agents.length > 0 && !currentAgent) {
      setCurrentAgent(agents.agents[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents.agents.length, currentAgent]);

  // Onboarding: Auto-show settings if no Loxia API key is configured
  useEffect(() => {
    if (!hasLoxiaApiKey()) {
      // Delay slightly to allow UI to initialize
      const timer = setTimeout(() => {
        setActiveOverlay('settings');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  // Register API keys with SessionManager on connection
  useEffect(() => {
    const registerApiKeys = async () => {
      if (connection.isConnected && settings.apiKeys) {
        try {
          await sessionManager.setApiKeys({
            openai:    settings.apiKeys.openai,
            anthropic: settings.apiKeys.anthropic,
            gemini:    settings.apiKeys.gemini,
            xai:       settings.apiKeys.xai,
          });
        } catch (error) {
          // Silently fail - user will see errors when making requests
          addError('API KEY ERROR', `Failed to register API keys on startup: ${error.message}`);
        }
      }
    };

    registerApiKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.isConnected]);

  // Keyboard shortcuts - only enable if raw mode is supported
  const isRawModeSupported = process.stdin.isTTY && typeof process.stdin.setRawMode === 'function';

  useInput((char, key) => {
    // Skip if raw mode is not supported
    if (!isRawModeSupported) {
      return;
    }

    // Don't handle shortcuts if an overlay is active (overlays handle their own input)
    if (activeOverlay) {
      return;
    }

    // Phase 10: Advanced feature shortcuts
    // Ctrl+S - Agent Switcher
    if (key.ctrl && char === 's') {
      setActiveOverlay('switcher');
    }
    // Ctrl+N - New Agent Creator
    else if (key.ctrl && char === 'n') {
      setActiveOverlay('creator');
    }
    // Alt+S - Settings Panel (changed from Ctrl+, to avoid Windows settings conflict)
    else if (key.meta && char === 's') {
      setActiveOverlay('settings');
    }
    // Ctrl+F - Search Panel
    else if (key.ctrl && char === 'f') {
      setActiveOverlay('search');
    }
    // Ctrl+E - Error Panel
    else if (key.ctrl && char === 'e') {
      setActiveOverlay('errors');
    }
    // Alt+H - Help Panel (Ctrl+H conflicts with backspace, F1 doesn't work in remote terminals)
    else if (key.meta && char === 'h') {
      setActiveOverlay('help');
    }

    // Phase 9: Existing shortcuts
    // Ctrl+R - Refresh/Reconnect
    else if (key.ctrl && char === 'r') {
      if (connection.isConnected) {
        connection.reconnect();
      } else {
        connection.connect();
      }
    }
    // Ctrl+L - Clear messages
    else if (key.ctrl && char === 'l') {
      messages.clearMessages();
    }
    // Ctrl+A - Reload agents
    else if (key.ctrl && char === 'a') {
      agents.fetchAgents();
    }
    // Ctrl+T - Reload tools
    else if (key.ctrl && char === 't') {
      if (currentAgent) {
        tools.fetchTools();
      }
    }
  }, { isActive: isRawModeSupported });

  // Send message handler
  const handleSendMessage = async (content) => {
    // DEBUG: Log received content
    debugLog('Layout handleSendMessage', ' Called with content:', JSON.stringify(content));
    debugLog('Layout handleSendMessage', ' content type:', typeof content);
    debugLog('Layout handleSendMessage', ' content value:', content);

    // Defensive validation: ensure content is a non-empty string
    if (typeof content !== 'string' || !content || content.trim().length === 0) {
      debugLog('Layout handleSendMessage', ' VALIDATION FAILED - content is invalid');
      debugLog('Layout handleSendMessage', '   typeof content:', typeof content);
      debugLog('Layout handleSendMessage', '   !content:', !content);
      debugLog('Layout handleSendMessage', '   trim length:', typeof content === 'string' ? content.trim().length : 'N/A');
      addError('MESSAGE ERROR', 'Cannot send message: content is empty or invalid');
      return;
    }

    debugLog('Layout handleSendMessage', ' Validation PASSED, currentAgent:', currentAgent?.name);

    if (!currentAgent) {
      debugLog('Layout handleSendMessage', ' BLOCKED: No current agent');
      return;
    }

    try {
      debugLog('Layout handleSendMessage', ' Calling messages.sendMessage with:', JSON.stringify(content));
      await messages.sendMessage(content);
      debugLog('Layout handleSendMessage', ' messages.sendMessage completed successfully');
    } catch (error) {
      // Add to error panel instead of console
      debugLog('Layout handleSendMessage', ' ERROR:', error.message);
      addError('MESSAGE ERROR', `Failed to send message: ${error.message}`, error.stack);
    }
  };

  // Handle errors from MessageList
  const handleMessageError = (errorMessage) => {
    addError('MESSAGE ERROR', errorMessage);
  };

  // Agent switching handler
  const handleSwitchAgent = async (agent) => {
    if (!agent) return;

    setActiveOverlay(null);

    // Check if agent is loaded - if not, use switchAgent to load it first
    if (!agent.isLoaded) {
      try {
        const result = await agents.switchAgent(agent.agentId);
        if (result.success) {
          // Get the updated agent after import
          const updatedAgent = agents.agents.find(a => a.agentId === agent.agentId) || agent;
          setCurrentAgent({ ...updatedAgent, isLoaded: true });
        } else {
          addError('AGENT ERROR', `Failed to load agent: ${result.error || 'Unknown error'}`);
        }
      } catch (err) {
        addError('AGENT ERROR', `Failed to load agent: ${err.message}`);
      }
    } else {
      setCurrentAgent(agent);
    }
  };

  // Agent editing handler
  const handleEditAgent = (agent) => {
    if (agent) {
      setAgentToEdit(agent);
      setActiveOverlay('editor');
    }
  };

  // Agent save handler (from editor)
  const handleSaveAgent = async (agentId, updates) => {
    try {
      // Call useAgents hook's updateAgentConfig method
      await agents.updateAgentConfig(agentId, updates);

      // Update currentAgent if it was the one being edited
      if (currentAgent?.agentId === agentId) {
        setCurrentAgent({ ...currentAgent, ...updates });
      }

      // Refresh agent list to ensure consistency
      await agents.fetchAgents();

      // Close editor overlay
      setActiveOverlay(null);
      setAgentToEdit(null);
    } catch (error) {
      // Re-throw to let AgentEditor handle the error display
      throw error;
    }
  };

  // Agent deletion handler
  const handleDeleteAgent = async (agent) => {
    try {
      // Call useAgents hook's deleteAgent method
      await agents.deleteAgent(agent.agentId);

      // If the deleted agent was current, update currentAgent to the new current one from agents hook
      if (currentAgent?.agentId === agent.agentId) {
        // useAgents already switched to another agent, just update local state
        const remainingAgents = agents.agents.filter(a => a.agentId !== agent.agentId);
        if (remainingAgents.length > 0) {
          setCurrentAgent(remainingAgents[0]);
        } else {
          setCurrentAgent(null);
        }
      }

      // Refresh agent list to ensure consistency
      await agents.fetchAgents();
    } catch (error) {
      addError('AGENT DELETION ERROR', `Failed to delete agent: ${error.message}`, error.stack);
    }
  };

  // Phase 10: Overlay handlers
  const handleCreateAgent = async (formData) => {
    console.log('[DEBUG handleCreateAgent] Called with formData:', formData);
    try {
      console.log('[DEBUG handleCreateAgent] Calling agents.createAgent...');
      // Create agent using useAgents hook
      const result = await agents.createAgent({
        name: formData.name,
        model: formData.model,
        mode: formData.mode || 'AGENT',
        systemPrompt: formData.systemPrompt || '',
        dynamicModelRouting: formData.dynamicModelRouting !== undefined ? formData.dynamicModelRouting : true, // User choice or default to enabled
        capabilities: formData.capabilities || [], // User-selected capabilities
        switchTo: true, // Automatically switch to newly created agent
      });

      console.log('[DEBUG handleCreateAgent] Result:', result);
      console.log('[DEBUG handleCreateAgent] result.success:', result.success, 'result.agent:', result.agent);

      if (result.success && result.agent) {
        // Agent was created and added to the list automatically by useAgents hook
        // The hook also set it as current agent (switchTo: true)
        console.log('[DEBUG handleCreateAgent] SUCCESS! Setting current agent and closing overlay');
        setCurrentAgent(result.agent);
        setActiveOverlay(null);
        console.log('[DEBUG handleCreateAgent] setActiveOverlay(null) called');
      } else {
        console.log('[DEBUG handleCreateAgent] FAILED! result.success or result.agent is falsy');
        addError('AGENT CREATION ERROR', 'Failed to create agent: Unknown error');
        // Close overlay anyway so user isn't stuck - they can see error in error panel (Ctrl+E)
        setActiveOverlay(null);
      }
    } catch (error) {
      console.log('[DEBUG handleCreateAgent] EXCEPTION:', error.message, error.stack);
      addError('AGENT CREATION ERROR', `Failed to create agent: ${error.message}`, error.stack);
      // Close overlay anyway so user isn't stuck - they can see error in error panel (Ctrl+E)
      setActiveOverlay(null);
    }
  };

  const handleSaveSettings = async (newSettings) => {
    try {
      // Persist settings to disk
      const success = saveSettings(newSettings);
      if (!success) {
        addError('SETTINGS ERROR', 'Failed to save settings to disk');
        return;
      }

      // Update local state
      setSettings(newSettings);

      // Register API keys with SessionManager if provided
      if (newSettings.apiKeys) {
        try {
          await sessionManager.setApiKeys({
            openai:    newSettings.apiKeys.openai,
            anthropic: newSettings.apiKeys.anthropic,
            gemini:    newSettings.apiKeys.gemini,
            xai:       newSettings.apiKeys.xai,
          });
        } catch (error) {
          // API key registration failed, but settings were saved
          addError('API KEY ERROR', `Settings saved but failed to register API keys: ${error.message}`);
        }
      }

      // Close settings overlay
      setActiveOverlay(null);
    } catch (error) {
      addError('SETTINGS ERROR', `Failed to save settings: ${error.message}`, error.stack);
    }
  };

  const handleSelectMessage = (message) => {
    // Scroll to or highlight the selected message
    console.log('Selected message:', message.id);
    setActiveOverlay(null);
  };

  const handleCloseOverlay = () => {
    setActiveOverlay(null);
    setAgentToEdit(null); // Clear agent to edit when closing
  };

  // Conditional rendering: if overlay is active, render ONLY the overlay
  // This is the Ink-native way to handle modals (no absolute positioning support)
  if (activeOverlay === 'switcher') {
    return React.createElement(AgentSwitcher, {
      agents: agents.agents,
      currentAgentId: currentAgent?.agentId,
      onSelect: handleSwitchAgent,
      onClose: handleCloseOverlay,
      onDelete: handleDeleteAgent, // Pass delete handler
      onEdit: handleEditAgent, // Pass edit handler
      terminalHeight, // Pass terminal dimensions for fullscreen rendering
      terminalWidth,
    });
  }

  if (activeOverlay === 'editor') {
    return React.createElement(AgentEditor, {
      agent: agentToEdit,
      onSave: handleSaveAgent,
      onClose: handleCloseOverlay,
      availableModels: ['anthropic-sonnet', 'anthropic-haiku', 'gpt-4', 'gpt-4-mini', 'gpt-5.1-codex-mini', 'deepseek-r1', 'phi-4', 'phi-4-reasoning'],
      terminalHeight, // Pass terminal dimensions for fullscreen rendering
      terminalWidth,
    });
  }

  if (activeOverlay === 'creator') {
    return React.createElement(AgentCreator, {
      sessionManager,
      onCancel: handleCloseOverlay,
      onCreate: handleCreateAgent,
      terminalHeight, // Pass terminal dimensions for fullscreen rendering
      terminalWidth,
    });
  }

  if (activeOverlay === 'settings') {
    return React.createElement(SettingsPanel, {
      settings,
      onSave: handleSaveSettings,
      onCancel: handleCloseOverlay,
      terminalHeight, // Pass terminal dimensions for fullscreen rendering
      terminalWidth,
    });
  }

  if (activeOverlay === 'search') {
    return React.createElement(SearchPanel, {
      messages: messages.messages,
      onSelect: handleSelectMessage,
      onClose: handleCloseOverlay,
      terminalHeight, // Pass terminal dimensions for fullscreen rendering
      terminalWidth,
    });
  }

  if (activeOverlay === 'help') {
    return React.createElement(HelpPanel, {
      onClose: handleCloseOverlay,
      terminalHeight, // Pass terminal dimensions for fullscreen rendering
      terminalWidth,
    });
  }

  if (activeOverlay === 'errors') {
    return React.createElement(ErrorPanel, {
      errors,
      onClose: handleCloseOverlay,
      onClear: clearErrors,
      onDismiss: dismissError,
      terminalHeight, // Pass terminal dimensions for fullscreen rendering
      terminalWidth,
    });
  }

  // Default: render normal UI layout (responsive based on terminal height)
  return React.createElement(
    Box,
    { flexDirection: 'column', minHeight: terminalHeight, maxHeight: terminalHeight },
    // Header (hidden in compact mode)
    !compactMode && React.createElement(Header, {
      currentAgent,
      connectionStatus: connection.connectionStatus,
      isConnected: connection.isConnected,
    }),

    // Main content area (message list) - fills remaining space
    React.createElement(MessageList, {
      messages: messages.messages,
      loading: messages.loading,
      error: messages.error,
      onError: handleMessageError,
      compactMode, // Pass compact mode flag
      currentAgent, // Pass current agent for compact mode display
      isConnected: connection.isConnected, // Pass connection status for compact mode
      terminalHeight, // Pass terminal height for scroll calculation
      terminalWidth, // Pass terminal width for responsive rendering
      showTimestamps: settings.showTimestamps, // Pass showTimestamps setting
      colorScheme: settings.colorScheme, // Pass colorScheme setting
    }),

    // Input box
    React.createElement(InputBox, {
      onSubmit: handleSendMessage,
      disabled: !connection.isConnected || !currentAgent,
      placeholder: currentAgent
        ? `Message ${currentAgent.name}...`
        : 'No agent selected',
    }),

    // Status bar (hidden in compact mode)
    !compactMode && React.createElement(StatusBar, {
      connectionStatus: connection.connectionStatus,
      connectionUptime: connection.connectionUptime,
      currentAgent,
      currentMode: agentControl.currentMode,
      messageCount: messages.messages.length,
      activeAgentCount: agents.agents.filter(a => a.isLoaded).length,
      totalAgentCount: agents.agents.length,
      toolCount: tools.tools.length,
      errorCount: errors.length,
    })
  );
}

export default Layout;
