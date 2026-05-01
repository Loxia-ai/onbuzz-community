import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  PaperAirplaneIcon,
  PlusIcon,
  PaperClipIcon,
  MicrophoneIcon,
  WrenchScrewdriverIcon,
  SparklesIcon,
  UserIcon,
  CpuChipIcon,
  CodeBracketIcon,
  ShieldCheckIcon,
  BoltIcon,
  FolderOpenIcon,
  ViewfinderCircleIcon,
  PlayIcon,
  CommandLineIcon,
  StopIcon,
  CubeTransparentIcon,
  ArrowDownTrayIcon,
  ArchiveBoxIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline';
import { ListBulletIcon } from '@heroicons/react/24/solid';
import { api } from '../services/api.js';
import { useAppStore } from '../stores/appStore.js';
import { useModelsStore } from '../stores/modelsStore.js';
import {
  AGENT_TEMPLATES,
  AGENT_TEMPLATE_CONFIGS,
  AGENT_MODE_STATES,
  AGENT_MODES,
  resolvePreferredModel
} from '../constants/index.js';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition.js';
import { useAgentActivity } from '../hooks/useAgentActivity.js';
import { useVisualEditor, VIEW_MODES, CONNECTION_STATUS } from '../hooks/useVisualEditor.js';
import MessageBubble from './MessageBubble.jsx';
import VirtualizedMessageList from './VirtualizedMessageList.jsx';
import LoadingSpinner from './LoadingSpinner.jsx';
import ThinkingBubble from './ThinkingBubble.jsx';
import StreamingBubble from './StreamingBubble.jsx';
import HoldToConfirmButton from './HoldToConfirmButton.jsx';
import AgentCreationModal from './AgentCreationModal.jsx';
import AgentModeToggle from './AgentModeToggle.jsx';
import FileAttachmentsPanel from './FileAttachmentsPanel.jsx';
import FileSelectionDialog from './FileSelectionDialog.jsx';
import ModelSelectorDropdown from './ModelSelectorDropdown.jsx';
import ToolsSelectorDropdown from './ToolsSelectorDropdown.jsx';
import CompactionIndicator from './CompactionIndicator.jsx';
import VisualModePanel from './VisualModePanel.jsx';
import VisualContextBar from './VisualContextBar.jsx';
import ArtifactsPanel from './ArtifactsPanel.jsx';
import TaskPanel from './TaskPanel.jsx';
import useArtifactsStore from '../stores/artifactsStore.js';
import TerminalTasksDropdown from './TerminalTasksDropdown.jsx';
import CredentialRequestModal from './CredentialRequestModal.jsx';
import FileExplorerModal from '../modules/fileExplorer/components/FileExplorerModal.jsx';
import UserPromptModal from './UserPromptModal.jsx';
import ModelErrorModal from './ModelErrorModal.jsx';
import toast from 'react-hot-toast';

// Express agent name generator
const EXPRESS_NAMES = ['Swift', 'Bolt', 'Flash', 'Rapid', 'Quick', 'Turbo', 'Dash', 'Spark', 'Blitz', 'Zoom'];
const getExpressAgentName = (prefix) => {
  const randomName = EXPRESS_NAMES[Math.floor(Math.random() * EXPRESS_NAMES.length)];
  const serial = Date.now().toString().slice(-4);
  return `${prefix} ${randomName} ${serial}`;
};

// Map template IDs to expressTemplates keys (used in backend model config)
const EXPRESS_TEMPLATE_KEYS = {
  [AGENT_TEMPLATES.CODING_ASSISTANT]: 'coding',
  [AGENT_TEMPLATES.SECURITY_ARCHITECT]: 'security',
  [AGENT_TEMPLATES.SYSTEM_ANALYST]: 'coding' // Uses same config as coding
};

// Fetch all available tool IDs from backend (single source of truth)
const fetchAllToolIds = async () => {
  try {
    const response = await api.getTools();
    if (response.success && response.tools) {
      return response.tools.map(t => t.id);
    }
  } catch (e) {
    console.warn('Failed to fetch tools for express create:', e.message);
  }
  return null;
};

// Find the best opus model (highest version) from available models
const findBestOpusModel = (availableModels) => {
  const opusModels = (availableModels || []).filter(m =>
    (m.name || '').toLowerCase().includes('opus')
  );
  if (opusModels.length === 0) return null;
  opusModels.sort((a, b) => {
    const extract = (m) => (m.name || '').match(/(\d+)/g)?.map(Number) || [0];
    const aV = extract(a), bV = extract(b);
    for (let i = 0; i < Math.max(aV.length, bV.length); i++) {
      const diff = (bV[i] || 0) - (aV[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  return opusModels[0];
};

// OS detection for keyboard shortcuts
const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

/**
 * Small header chip that shows an agent's current scheduler-applied delay.
 *
 * Driven by `agent.delayEndTime` — set by the scheduler on rate-limit /
 * network-error / API-key-error / builtin-tool-delay paths and broadcast
 * through the `agent_state_updated` WebSocket event. Re-renders every second
 * so the countdown is visible. Renders nothing when no delay is active.
 */
function AgentDelayChip({ agent }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!agent?.delayEndTime) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [agent?.delayEndTime]);

  if (!agent?.delayEndTime) return null;
  const endMs = new Date(agent.delayEndTime).getTime();
  const remaining = endMs - now;
  if (!Number.isFinite(endMs) || remaining <= 0) return null;

  const secs = Math.ceil(remaining / 1000);
  const label = secs >= 60
    ? `${Math.floor(secs / 60)}m ${secs % 60}s`
    : `${secs}s`;

  return (
    <>
      <span className="mx-2">•</span>
      <span
        title={`Scheduler is pausing this agent until ${new Date(endMs).toLocaleTimeString()}`}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 rounded-full font-medium"
      >
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" />
        </svg>
        delayed {label}
      </span>
    </>
  );
}

function Chat() {
  const {
    currentAgent,
    messages,
    isTyping,
    sendMessage,
    clearMessages,
    stopMessageProcessing,
    updateAgent,
    createAgent,
    loading,
    projectDir,
    agentStreamingState,
    pendingCredentialRequest,
    clearPendingCredentialRequest,
    pendingUserPrompt,
    clearPendingUserPrompt,
    pendingModelError
  } = useAppStore();

  // Get models from the models store for express template lookup
  const { models, fetchModels } = useModelsStore();

  // Artifacts panel state (reactive via Zustand subscription)
  const artifactsPanelOpen = useArtifactsStore(s => s.panelOpen);
  const artifactCount = useArtifactsStore(s => s.artifacts.size);

  const [input, setInput] = useState('');
  const [isInputSingleLine, setIsInputSingleLine] = useState(true);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [contextReferences, setContextReferences] = useState([]);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showToolsSelector, setShowToolsSelector] = useState(false);
  const [showTerminalTasks, setShowTerminalTasks] = useState(false);
  const [showFileExplorer, setShowFileExplorer] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const inputRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const attachmentsPanelRef = useRef(null);
  const modelSelectorRef = useRef(null);
  const toolsSelectorRef = useRef(null);
  const terminalTasksRef = useRef(null);

  // Smart scroll state
  const [userScrolledAway, setUserScrolledAway] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const lastMessageCountRef = useRef(0);

  // Speech recognition
  const {
    isSupported: speechSupported,
    isListening,
    transcript,
    error: speechError,
    toggleListening,
    resetTranscript
  } = useSpeechRecognition();

  // Agent activity polling - only poll when not typing and agent exists
  const { isActive: isAgentActive, reason: activityReason } = useAgentActivity(
    currentAgent?.id,
    !isTyping && !!currentAgent // Only poll when we have an agent and not actively typing
  );

  // Debounced thinking bubble visibility - prevents flickering on rapid condition changes
  const [showThinkingBubble, setShowThinkingBubble] = useState(false);
  const thinkingCondition = isTyping || (currentAgent?.mode === AGENT_MODES.AGENT && isAgentActive);

  useEffect(() => {
    if (thinkingCondition) {
      // Show immediately
      setShowThinkingBubble(true);
    } else {
      // Delay hiding by 500ms to prevent flickering
      const timer = setTimeout(() => setShowThinkingBubble(false), 500);
      return () => clearTimeout(timer);
    }
  }, [thinkingCondition]);

  // Visual editor for visual mode
  const {
    isEnabled: visualEditorEnabled,
    viewMode: visualViewMode,
    connectionStatus: visualConnectionStatus,
    visualContext,
    editorUrl,
    appUrl: visualAppUrl,
    error: visualEditorError,
    iframeRef: visualIframeRef,
    interactionMode: visualInteractionMode,
    setInteractionMode: setVisualInteractionMode,
    toggleVisualMode,
    popOutToWindow,
    popInToEmbed,
    clearContext: clearVisualContext,
    scrollToElement,
    setAppUrl: setVisualAppUrl,
    reloadEditor: reloadVisualEditor,
    manualRetry: visualEditorRetry,
    VIEW_MODES: visualModes
  } = useVisualEditor();

  // Reset scroll state when switching agents
  // VirtualizedMessageList handles actual scrolling via initialTopMostItemIndex
  useEffect(() => {
    setUserScrolledAway(false);
    setNewMessageCount(0);
    lastMessageCountRef.current = 0;
  }, [currentAgent?.id]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, [currentAgent]);

  // Fetch artifacts from backend when switching agents
  useEffect(() => {
    if (currentAgent?.id) {
      useArtifactsStore.getState().fetchFromAPI(currentAgent.id);
    }
  }, [currentAgent?.id]);

  // Handle speech recognition transcript
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
    }
  }, [transcript]);

  // Handle speech recognition errors
  useEffect(() => {
    if (speechError) {
      toast.error(speechError);
    }
  }, [speechError]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!input.trim()) return;
    
    if (!currentAgent) {
      toast.error('Please create or select an agent first');
      setShowCreateAgent(true);
      return;
    }

    const messageContent = input.trim();
    setInput('');

    // Reset textarea height and border-radius after clearing input
    if (inputRef.current) {
      inputRef.current.style.height = '40px';
      inputRef.current.style.overflowY = 'hidden';
      inputRef.current.style.borderRadius = '9999px'; // Fully rounded when empty
    }
    setIsInputSingleLine(true); // Reset button positioning

    try {
      await sendMessage(messageContent, contextReferences);
      setContextReferences([]);

      // Clean up voice input state after successful send
      if (isListening) {
        toggleListening();
      }
      resetTranscript();

      // Return focus to input after successful message send
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    } catch (error) {
      toast.error('Failed to send message: ' + error.message);
      setInput(messageContent); // Restore input on error
      // Re-expand textarea for restored content
      if (inputRef.current) {
        const target = inputRef.current;
        target.style.height = 'auto';
        const newHeight = Math.min(Math.max(target.scrollHeight, 40), 200);
        target.style.height = newHeight + 'px';
        target.style.overflowY = target.scrollHeight > 200 ? 'auto' : 'hidden';
        // Update border-radius and button positioning based on content
        const isSingleLine = newHeight <= 40;
        target.style.borderRadius = isSingleLine ? '9999px' : '0.5rem';
        setIsInputSingleLine(isSingleLine);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
      return;
    }
    
    // Keyboard shortcut for voice input: Ctrl/Cmd + Shift + M
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
      e.preventDefault();
      handleVoiceInput();
      return;
    }
    
    // Stop listening if user starts typing manually
    if (isListening && e.key.length === 1) {
      toggleListening();
      resetTranscript();
    }
  };

  const handleCreateAgent = () => {
    setShowCreateAgent(true);
  };

  // Open project directory in file explorer modal
  const handleOpenProjectFolder = () => {
    const dirToOpen = currentAgent?.directoryAccess?.workingDirectory || projectDir;

    if (!dirToOpen) {
      toast.error('No project directory set');
      return;
    }

    // Local: open native OS file explorer. Remote: use built-in FileExplorerModal.
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (isLocal) {
      api.openDirectory(dirToOpen).catch(() => {
        // Fallback to built-in explorer if native open fails
        setShowFileExplorer(true);
      });
    } else {
      setShowFileExplorer(true);
    }
  };

  // Express agent creation - skip the modal
  const [expressCreating, setExpressCreating] = useState(null);

  const handleExpressCreate = async (templateId) => {
    if (loading || expressCreating) return;

    setExpressCreating(templateId);

    try {
      const templateConfig = AGENT_TEMPLATE_CONFIGS[templateId];
      const prefixMap = {
        [AGENT_TEMPLATES.CODING_ASSISTANT]: 'Coder',
        [AGENT_TEMPLATES.SECURITY_ARCHITECT]: 'SecArch',
        [AGENT_TEMPLATES.SYSTEM_ANALYST]: 'Analyst',
        [AGENT_TEMPLATES.TEAM_MANAGER]: 'Manager'
      };
      const prefix = prefixMap[templateId] || 'Agent';
      const name = getExpressAgentName(prefix);
      // Fetch all tools from backend — single source of truth (no hardcoded lists)
      const allToolIds = await fetchAllToolIds();
      const capabilities = allToolIds || [];

      // Ensure models are loaded
      let availableModels = models;
      if (!availableModels || availableModels.length === 0) {
        await fetchModels();
        availableModels = useModelsStore.getState().models;
      }

      // Use the template model resolver (exact match → term scoring → random)
      const modelsList = availableModels.map(m => ({ id: m.name, modelName: m.name, ...m }));
      let selectedModelId = resolvePreferredModel(templateId, modelsList);

      // Final fallback to first available model
      if (!selectedModelId && availableModels?.length > 0) {
        selectedModelId = availableModels[0].name;
      }

      if (!selectedModelId) {
        throw new Error('No models available. Please check your backend connection.');
      }

      // Get default working directory based on OS
      let workingDirectory = null;
      try {
        const sysInfo = await api.getSystemInfo();
        if (sysInfo.success && sysInfo.data?.homedir) {
          const homedir = sysInfo.data.homedir;
          const platform = sysInfo.data.platform;
          // Use platform-appropriate path separator
          const sep = platform === 'win32' ? '\\' : '/';
          workingDirectory = `${homedir}${sep}Loxia`;
        }
      } catch (e) {
        console.warn('Could not get system info for default directory:', e.message);
      }

      await createAgent(
        name,
        selectedModelId,
        templateConfig.prompt,
        {
          dynamicModelRouting: false,
          capabilities,
          directoryAccess: workingDirectory ? {
            workingDirectory,
            readOnlyDirectories: [],
            writeEnabledDirectories: [],
            restrictToProject: false,
            allowSystemAccess: false
          } : null
        }
      );

      toast.success(`${templateConfig.name} "${name}" created!`);
    } catch (error) {
      toast.error(`Failed to create agent: ${error.message}`);
    } finally {
      setExpressCreating(null);
    }
  };

  const handleVoiceInput = () => {
    if (!speechSupported) {
      toast.error('Speech recognition is not supported in this browser');
      return;
    }

    if (isListening) {
      // Stop listening and keep the current transcript
      toggleListening();
    } else {
      // Start listening - clear any existing input first if user wants fresh start
      if (input.trim() && !transcript) {
        // If there's existing text input but no current transcript, ask user
        const shouldContinue = window.confirm(
          'This will replace your current input. Do you want to continue with voice input?'
        );
        if (!shouldContinue) return;
      }

      resetTranscript();
      setInput('');
      toggleListening();
    }
  };

  const handleModelChange = async (modelId) => {
    try {
      await updateAgent(currentAgent.id, { preferredModel: modelId });
      toast.success('Model changed successfully');
      setShowModelSelector(false);
    } catch (error) {
      toast.error(`Failed to change model: ${error.message}`);
    }
  };

  const handleCapabilitiesChange = async (capabilities) => {
    try {
      await updateAgent(currentAgent.id, { capabilities });
      toast.success('Tools updated successfully');
      setShowToolsSelector(false);
    } catch (error) {
      toast.error(`Failed to update tools: ${error.message}`);
    }
  };

  const handleClearChat = async () => {
    try {
      await clearMessages();
      toast.success('Chat history cleared');
    } catch (error) {
      toast.error(`Failed to clear chat: ${error.message}`);
    }
  };

  const handleExportChat = async () => {
    if (!currentAgent) {
      toast.error('No agent selected');
      return;
    }

    try {
      const response = await api.exportAgentConversation(currentAgent.id);
      if (!response.success) {
        throw new Error(response.error || 'Export failed');
      }

      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${currentAgent.name.replace(/[^a-z0-9]/gi, '-')}-conversation-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('Conversation exported');
    } catch (error) {
      toast.error(`Export failed: ${error.message}`);
    }
  };

  // Close model selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target)) {
        setShowModelSelector(false);
      }
    };

    if (showModelSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showModelSelector]);

  // Close tools selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (toolsSelectorRef.current && !toolsSelectorRef.current.contains(event.target)) {
        setShowToolsSelector(false);
      }
    };

    if (showToolsSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showToolsSelector]);

  // Close terminal tasks panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (terminalTasksRef.current && !terminalTasksRef.current.contains(event.target)) {
        setShowTerminalTasks(false);
      }
    };

    if (showTerminalTasks) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showTerminalTasks]);

  if (!currentAgent) {
    return (
      <div className="flex-1 flex flex-col h-full min-h-0">
        {/* Empty State - Centered both horizontally and vertically */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-lg mx-auto">
            <div className="w-16 h-16 bg-loxia-100 dark:bg-loxia-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <CpuChipIcon className="w-8 h-8 text-loxia-600 dark:text-loxia-400" />
            </div>

            <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Ready when you are.
            </h2>

            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Choose a template to get started quickly.
            </p>

            {/* Quick Start Templates - Now first */}
            <div className="mb-8">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 flex items-center justify-center gap-2">
                <BoltIcon className="w-4 h-4" />
                Quick Start Templates
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center flex-wrap">
                {/* Coding Agent - with glowing animation */}
                <button
                  onClick={() => handleExpressCreate(AGENT_TEMPLATES.CODING_ASSISTANT)}
                  disabled={loading || expressCreating}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed animate-glow-blue"
                >
                  {expressCreating === AGENT_TEMPLATES.CODING_ASSISTANT ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <CodeBracketIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  )}
                  <div className="text-left">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Coding Agent
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Full-stack development
                    </div>
                  </div>
                </button>

                {/* System Analyst & Architect */}
                <button
                  onClick={() => handleExpressCreate(AGENT_TEMPLATES.SYSTEM_ANALYST)}
                  disabled={loading || expressCreating}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-teal-400 dark:hover:border-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {expressCreating === AGENT_TEMPLATES.SYSTEM_ANALYST ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <CubeTransparentIcon className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                  )}
                  <div className="text-left">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      System Analyst
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Architecture & planning
                    </div>
                  </div>
                </button>

                {/* Security Architect */}
                <button
                  onClick={() => handleExpressCreate(AGENT_TEMPLATES.SECURITY_ARCHITECT)}
                  disabled={loading || expressCreating}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-purple-400 dark:hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {expressCreating === AGENT_TEMPLATES.SECURITY_ARCHITECT ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <ShieldCheckIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  )}
                  <div className="text-left">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Security Architect
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Vulnerability analysis
                    </div>
                  </div>
                </button>

                {/* Team Manager */}
                <button
                  onClick={() => handleExpressCreate(AGENT_TEMPLATES.TEAM_MANAGER)}
                  disabled={loading || expressCreating}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-amber-400 dark:hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {expressCreating === AGENT_TEMPLATES.TEAM_MANAGER ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <UserGroupIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  )}
                  <div className="text-left">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Team Manager
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Delegation & coordination
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Create Custom Agent - Now at the bottom */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                Or create your own
              </p>
              <button
                onClick={handleCreateAgent}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                disabled={loading || expressCreating}
              >
                <PlusIcon className="w-4 h-4 mr-2" />
                Create Custom Agent
              </button>
            </div>
          </div>
        </div>

        {/* Create Agent Modal */}
        {showCreateAgent && (
          <AgentCreationModal
            onClose={() => setShowCreateAgent(false)}
            onSuccess={() => setShowCreateAgent(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-screen">
      {/* Chat Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 px-4 py-3 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-loxia-600 rounded-full flex items-center justify-center">
              <CpuChipIcon className="w-5 h-5 text-white" />
            </div>
            <div className="ml-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {currentAgent.name}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center">
                <span className="font-mono">{currentAgent.currentModel}</span>
                {currentAgent.dynamicModelRouting && (
                  <span className="ml-2 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-full font-medium">
                    AUTO
                  </span>
                )}
                <span className="mx-2">•</span>
                <span>{messages.length} messages</span>
                <AgentDelayChip agent={currentAgent} />
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            {/* Agent Mode Toggle */}
            <AgentModeToggle
              agent={currentAgent}
              onModeChange={(updatedAgent) => {
                // Update agent in store (this would be handled by the store)
                // The store will be updated via WebSocket or by calling the store method
              }}
            />

            {/* Serve & Edit Button - Asks agent to serve project and enable visual mode */}
            {!visualEditorEnabled && (
              <button
                onClick={() => {
                  if (!currentAgent) {
                    toast.error('Please create or select an agent first');
                    return;
                  }
                  // Send message directly to agent asking it to serve the project
                  const serveMessage = "Please serve the current project so I can visually edit it. Use the visual-editor tool with detect-project first, then either serve-static for HTML projects or start a dev server for framework projects, and finally set the app URL so I can use Visual Mode.";
                  sendMessage(serveMessage);
                  toast.success('Asked agent to serve the project for visual editing');
                }}
                className="flex items-center px-2 py-1.5 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                title="Ask agent to serve the project for visual editing"
              >
                <PlayIcon className="w-4 h-4 mr-1" />
                Serve & Edit
              </button>
            )}

            {/* Artifacts Panel Toggle */}
            <button
              onClick={() => {
                useArtifactsStore.getState().togglePanel();
                setTaskPanelOpen(false);
              }}
              className={`p-2 rounded-lg transition-colors relative ${
                artifactsPanelOpen
                  ? 'bg-loxia-100 text-loxia-700 dark:bg-loxia-900/30 dark:text-loxia-400'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title="Artifacts"
            >
              <ArchiveBoxIcon className="w-5 h-5" />
              {artifactCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 text-[9px] font-bold bg-loxia-600 text-white rounded-full flex items-center justify-center">
                  {artifactCount > 9 ? '9+' : artifactCount}
                </span>
              )}
            </button>

            {/* Task Panel Toggle */}
            <button
              onClick={() => {
                const opening = !taskPanelOpen;
                setTaskPanelOpen(opening);
                if (opening) useArtifactsStore.getState().closePanel();
              }}
              className={`p-2 rounded-lg transition-colors relative ${
                taskPanelOpen
                  ? 'bg-loxia-100 text-loxia-700 dark:bg-loxia-900/30 dark:text-loxia-400'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title="Tasks"
            >
              <ListBulletIcon className="w-5 h-5" />
            </button>

            {/* Visual Mode Toggle */}
            <button
              onClick={toggleVisualMode}
              className={`p-2 rounded-lg transition-colors ${
                visualEditorEnabled
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title={visualEditorEnabled ? 'Close Visual Mode' : 'Open Visual Mode'}
            >
              <ViewfinderCircleIcon className="w-5 h-5" />
            </button>

            <div className="border-l border-gray-300 dark:border-gray-600 h-6"></div>

            <button
              type="button"
              onClick={handleExportChat}
              className="button-secondary text-sm px-3 py-1.5"
              disabled={!currentAgent}
              title="Export conversation (persistent state)"
            >
              <ArrowDownTrayIcon className="w-4 h-4 mr-1 inline" />
              Export
            </button>

            <HoldToConfirmButton
              onConfirm={handleClearChat}
              className="button-secondary text-sm px-3 py-1.5"
              disabled={messages.length === 0}
              title="Hold to clear chat history"
            >
              Clear Chat
            </HoldToConfirmButton>

            <button
              onClick={handleCreateAgent}
              className="button-secondary"
            >
              <PlusIcon className="w-4 h-4 mr-1" />
              New Pilot
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area with Split Layout Support */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages Area */}
          {messages.length === 0 ? (
            <div
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto relative"
            >
              {/* Compaction Indicator Overlay */}
              <CompactionIndicator agentId={currentAgent.id} />

              <div className="flex-1 flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CpuChipIcon className="w-6 h-6 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                    Start a conversation
                  </h3>
                  <p className="text-gray-500 dark:text-gray-400">
                    Ask {currentAgent.name} anything to get started.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 relative">
              {/* Compaction Indicator Overlay - positioned over the message list */}
              <CompactionIndicator agentId={currentAgent.id} />

              <VirtualizedMessageList
                messages={messages}
                userScrolledAway={userScrolledAway}
                setUserScrolledAway={setUserScrolledAway}
                newMessageCount={newMessageCount}
                setNewMessageCount={setNewMessageCount}
                isStreaming={!!agentStreamingState?.get?.(currentAgent.id)?.isStreaming}
                footerContent={
                  <>
                    {/* Streaming Content Display - shows live response as it arrives */}
                    {(() => {
                      const streamingState = agentStreamingState?.get?.(currentAgent.id);
                      if (streamingState?.isStreaming) {
                        return (
                          <StreamingBubble
                            content={streamingState.content}
                            model={streamingState.model}
                            agentName={currentAgent.name}
                            isComplete={false}
                            reasoning={streamingState.reasoning}
                            reasoningTokens={streamingState.reasoningTokens}
                          />
                        );
                      }
                      return null;
                    })()}
                    {/* Unified Thinking Indicator - shown when agent is busy and NOT streaming (debounced to prevent flickering) */}
                    {showThinkingBubble && !agentStreamingState?.get?.(currentAgent.id)?.isStreaming && (
                      <ThinkingBubble agentName={currentAgent.name} />
                    )}
                  </>
                }
              />
            </div>
          )}

          {/* Visual Context Bar - shows when visual context is available */}
          {visualContext && (
            <div className="flex-shrink-0 px-4 pb-2">
              <VisualContextBar
                context={visualContext}
                onClear={clearVisualContext}
                onScrollTo={scrollToElement}
              />
            </div>
          )}

          {/* Input Area */}
          <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            {/* Context References */}
            {contextReferences.length > 0 && (
          <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
            <div className="flex flex-wrap gap-2">
              {contextReferences.map((ref, index) => (
                <div key={index} className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-md px-2 py-1 text-sm">
                  <PaperClipIcon className="w-4 h-4 text-gray-500 mr-1" />
                  <span className="text-gray-700 dark:text-gray-300">{ref.name || ref.path}</span>
                  <button
                    onClick={() => setContextReferences(refs => refs.filter((_, i) => i !== index))}
                    className="ml-1 text-gray-500 hover:text-red-500"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-4">
          {/* Compact Attachments Chip */}
          <div className="mb-2 ml-11">
            <FileAttachmentsPanel
              ref={attachmentsPanelRef}
              agentId={currentAgent?.id}
              onUploadClick={() => setShowFileUpload(true)}
              compact={true}
            />
          </div>
          <div className="flex items-start space-x-3">
            {/* Open Project Folder Button */}
            <button
              type="button"
              onClick={handleOpenProjectFolder}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title={currentAgent?.directoryAccess?.workingDirectory || projectDir || 'Open project folder'}
              disabled={!currentAgent?.directoryAccess?.workingDirectory && !projectDir}
            >
              <FolderOpenIcon className="w-5 h-5" />
            </button>

            {/* Input Container */}
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  // Auto-resize textarea
                  const target = e.target;
                  const minHeight = 40;
                  const maxHeight = 200;
                  // Reset height to auto to get accurate scrollHeight
                  target.style.height = 'auto';
                  // Calculate new height within bounds
                  const newHeight = Math.min(Math.max(target.scrollHeight, minHeight), maxHeight);
                  target.style.height = newHeight + 'px';
                  // Enable scrolling only when at max height
                  target.style.overflowY = target.scrollHeight > maxHeight ? 'auto' : 'hidden';
                  // Dynamic border-radius: fully rounded for single line, rounded-lg for multi-line
                  const isSingleLine = newHeight <= minHeight;
                  target.style.borderRadius = isSingleLine ? '9999px' : '0.5rem';
                  // Track single-line state for button positioning
                  setIsInputSingleLine(isSingleLine);
                }}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${currentAgent.name}...`}
                rows={1}
                className="input-primary resize-none pr-12"
                style={{
                  minHeight: '40px',
                  maxHeight: '200px',
                  overflowY: 'hidden',
                  borderRadius: '9999px', // Start fully rounded
                  paddingTop: '8px',
                  paddingBottom: '8px',
                  boxSizing: 'border-box',
                  lineHeight: '24px' // Center text vertically (40px - 16px padding = 24px)
                }}
                disabled={isTyping && currentAgent?.mode !== AGENT_MODES.AGENT}
              />

              {/* Input Actions - centered when single line, bottom-aligned when multi-line */}
              {/* For 40px textarea with 28px buttons: (40-28)/2 = 6px from top to center */}
              <div
                className="absolute right-2 flex items-center space-x-1 transition-all duration-150"
                style={{
                  top: isInputSingleLine ? '6px' : 'auto',
                  bottom: isInputSingleLine ? 'auto' : '6px'
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowFileUpload(true)}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors"
                  title="Attach file"
                >
                  <PaperClipIcon className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleVoiceInput}
                  className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
                    isListening
                      ? 'text-red-500 bg-red-100 dark:bg-red-900/30 animate-pulse'
                      : speechSupported
                      ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700'
                      : 'text-gray-300 cursor-not-allowed'
                  }`}
                  title={
                    !speechSupported
                      ? 'Voice input not supported'
                      : isListening
                      ? 'Stop voice input'
                      : `Voice input (${isMac ? '⌘' : 'Ctrl'}+Shift+M)`
                  }
                  disabled={!speechSupported || (isTyping && currentAgent?.mode !== AGENT_MODES.AGENT)}
                >
                  <MicrophoneIcon className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Terminal Tasks Button */}
            <div className="relative" ref={terminalTasksRef}>
              <button
                type="button"
                onClick={() => setShowTerminalTasks(!showTerminalTasks)}
                className={`button-secondary w-10 h-10 p-0 ${showTerminalTasks ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
                title="Terminal Tasks"
                disabled={false}
              >
                <CommandLineIcon className="w-5 h-5" />
              </button>

              {/* Terminal Tasks Dropdown */}
              {showTerminalTasks && currentAgent && (
                <div className="absolute bottom-full right-0 mb-2 w-96 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                  <TerminalTasksDropdown
                    agentId={currentAgent.id}
                    disabled={isTyping}
                    onClose={() => setShowTerminalTasks(false)}
                  />
                </div>
              )}
            </div>

            {/* Tools Selector Button */}
            <div className="relative" ref={toolsSelectorRef}>
              <button
                type="button"
                onClick={() => setShowToolsSelector(!showToolsSelector)}
                className={`button-secondary w-10 h-10 p-0 ${showToolsSelector ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
                title="Manage Tools"
                disabled={false}
              >
                <WrenchScrewdriverIcon className="w-5 h-5" />
              </button>

              {/* Tools Selector Dropdown */}
              {showToolsSelector && currentAgent && (
                <div className="absolute bottom-full right-0 mb-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                  <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Manage Tools
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Enable or disable capabilities for this agent
                    </p>
                  </div>
                  <ToolsSelectorDropdown
                    currentCapabilities={currentAgent.capabilities || []}
                    onCapabilitiesChange={handleCapabilitiesChange}
                    disabled={isTyping}
                  />
                </div>
              )}
            </div>

            {/* Model Selector Button */}
            <div className="relative" ref={modelSelectorRef}>
              <button
                type="button"
                onClick={() => setShowModelSelector(!showModelSelector)}
                className={`button-secondary w-10 h-10 p-0 ${showModelSelector ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
                title="Change Model"
                disabled={false}
              >
                <SparklesIcon className="w-5 h-5" />
              </button>

              {/* Model Selector Dropdown */}
              {showModelSelector && currentAgent && (
                <div className="absolute bottom-full right-0 mb-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                  <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Change Model
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Currently using: {currentAgent.currentModel}
                    </p>
                  </div>
                  <ModelSelectorDropdown
                    currentModel={currentAgent.preferredModel || currentAgent.currentModel}
                    onModelSelect={handleModelChange}
                    disabled={isTyping}
                  />
                </div>
              )}
            </div>

            {/* Send/Stop/Proceed Button - Single element for smooth transitions */}
            {(() => {
              const isStop = thinkingCondition && !input.trim();
              const isProceed = !isStop && currentAgent?.mode === AGENT_MODES.CHAT && messages.length > 0 && !input.trim();

              return (
                <button
                  type={isStop || isProceed ? 'button' : 'submit'}
                  disabled={!isStop && !isProceed && !input.trim()}
                  onClick={isStop ? () => {
                    stopMessageProcessing().catch(err => {
                      console.error('Failed to stop:', err);
                      toast.error('Failed to stop processing');
                    });
                  } : isProceed ? () => {
                    sendMessage('Proceed', []).catch(err => {
                      console.error('Failed to send proceed:', err);
                      toast.error('Failed to send message');
                    });
                  } : undefined}
                  className={`button-primary h-10 flex items-center justify-center gap-1.5 transition-all duration-200 ease-in-out overflow-hidden ${
                    isStop
                      ? 'w-10 bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700'
                      : isProceed
                        ? 'w-[100px]'
                        : 'w-10'
                  }`}
                  title={isStop ? 'Stop processing' : isProceed ? "Send 'Proceed' to continue" : 'Send message'}
                >
                  {isStop ? (
                    <StopIcon className="w-5 h-5 flex-shrink-0" />
                  ) : isProceed ? (
                    <>
                      <PlayIcon className="w-5 h-5 flex-shrink-0" />
                      <span className="text-sm font-medium whitespace-nowrap">Proceed</span>
                    </>
                  ) : (
                    <PaperAirplaneIcon className="w-5 h-5 flex-shrink-0" />
                  )}
                </button>
              );
            })()}
          </div>

          {/* Voice Input Status */}
          {isListening && (
            <div className="mt-2 flex items-center text-sm text-red-600 dark:text-red-400">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mr-2"></div>
              Listening... (speak now or click microphone to stop)
            </div>
          )}

        </form>
          </div>
        </div>
        {/* End Chat Content */}

        {/* Artifacts Panel — right side, mutually exclusive with visual editor and task panel */}
        {artifactsPanelOpen && !visualEditorEnabled && !taskPanelOpen && (
          <ArtifactsPanel onClose={() => useArtifactsStore.getState().closePanel()} />
        )}

        {/* Task Panel — right side, mutually exclusive with visual editor and artifacts */}
        {taskPanelOpen && !visualEditorEnabled && !artifactsPanelOpen && (
          <TaskPanel onClose={() => setTaskPanelOpen(false)} />
        )}

        {/* Visual Editor Panel - shown when enabled in embedded mode */}
        {visualEditorEnabled && visualViewMode === VIEW_MODES.EMBEDDED && (
          <VisualModePanel
            editorUrl={editorUrl}
            connectionStatus={visualConnectionStatus}
            error={visualEditorError}
            iframeRef={visualIframeRef}
            onClose={toggleVisualMode}
            onPopOut={popOutToWindow}
            onRetry={visualEditorRetry}
            onReload={reloadVisualEditor}
            appUrl={visualAppUrl}
            onAppUrlChange={setVisualAppUrl}
            interactionMode={visualInteractionMode}
            onInteractionModeChange={setVisualInteractionMode}
          />
        )}

        {/* Visual Editor External Window Control Bar - shown when in separate window mode */}
        {visualEditorEnabled && visualViewMode === VIEW_MODES.SEPARATE && (
          <div className="w-64 flex flex-col border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-600 dark:text-green-400">
                  <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">External Window</span>
              </div>
              <button
                onClick={toggleVisualMode}
                className="p-1 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                title="Close visual editor"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>

            {/* URL Input */}
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Target URL
              </label>
              <form onSubmit={(e) => { e.preventDefault(); setVisualAppUrl(e.target.url.value); }} className="flex flex-col gap-2">
                <input
                  name="url"
                  type="text"
                  defaultValue={visualAppUrl || ''}
                  placeholder="http://localhost:3000"
                  className="w-full px-2 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                >
                  Update URL
                </button>
              </form>
            </div>

            {/* Actions */}
            <div className="p-3 space-y-2">
              <button
                onClick={popInToEmbed}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
                </svg>
                Embed in Side Panel
              </button>
            </div>

            {/* Status */}
            <div className="mt-auto p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span>Open in separate window</span>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* End Main Content Area */}

      {/* Create Agent Modal */}
      {showCreateAgent && (
        <AgentCreationModal
          onClose={() => setShowCreateAgent(false)}
          onSuccess={() => setShowCreateAgent(false)}
        />
      )}

      {/* File Upload Dialog */}
      <FileSelectionDialog
        isOpen={showFileUpload}
        onClose={() => setShowFileUpload(false)}
        agentId={currentAgent?.id}
        onSuccess={() => {
          // Refresh attachments panel to show new file immediately
          if (attachmentsPanelRef.current) {
            attachmentsPanelRef.current.refresh();
          }
          setShowFileUpload(false);
        }}
      />

      {/* File Explorer Modal */}
      <FileExplorerModal
        isOpen={showFileExplorer}
        onClose={() => setShowFileExplorer(false)}
        onSelectPath={() => setShowFileExplorer(false)}
        initialPath={currentAgent?.directoryAccess?.workingDirectory || projectDir}
        title="Browse Project Files"
        directoriesOnly={false}
      />

      {/* Credential Request Modal - shown when agent needs authentication */}
      {pendingCredentialRequest && (
        <CredentialRequestModal
          request={pendingCredentialRequest}
          onClose={clearPendingCredentialRequest}
          onSubmit={(requestId) => {
            console.log('Credentials submitted for request:', requestId);
            clearPendingCredentialRequest();
          }}
        />
      )}

      {/* User Prompt Modal - shown when agent asks user questions */}
      {pendingUserPrompt && (
        <UserPromptModal
          request={pendingUserPrompt}
          onClose={clearPendingUserPrompt}
          onSubmit={(answers) => {
            console.log('User prompt answers submitted:', answers);
            clearPendingUserPrompt();
          }}
        />
      )}

      {/* Model Error Modal - shown when AI model fails with suggestions */}
      {pendingModelError && <ModelErrorModal />}
    </div>
  );
}

export default Chat;