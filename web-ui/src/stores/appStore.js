import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { api } from '../services/api.js';
import { useModelsStore } from './modelsStore.js';
import { PLATFORM_MODELS, AGENT_MODES, AGENT_MODE_STATES } from '../constants/index.js';
import toast from 'react-hot-toast';
import { processVisualEditorOpenMessage } from '../utilities/visualEditorMessage.js';
import { sanitizeApiKeyValue, sanitizeApiKeysObject, isPlaceholderApiKey } from '../utils/apiKeyPlaceholders.js';
// artifactsStore is accessed via window.__artifactsStore for cross-store calls

/**
 * Predicate: is this persisted `role: 'user'` message actually an internal
 * tool-result-like injection that should NOT appear in the chat feed?
 *
 * The scheduler emits THREE such variants (all role:'user' because the LLM
 * API requires alternating user/assistant turns and tool results are
 * conventionally user messages):
 *
 *   1. type: 'tool-result'               — "[Tool Results — …]"
 *   2. type: 'task-boundary'             — "[Previous Task — Final Tool Results] …"
 *   3. type: 'consolidated-input' whose content STARTS with "[Tool Results"
 *      — happens when the scheduler merged tool-results + user-text into
 *      one user message (but with no actual user text — so it's effectively
 *      just tool-results).
 *
 * All three are semantically tool results, not user speech. The UI should
 * render them inline on the corresponding assistant turn (toolResults[]),
 * not as standalone user bubbles.
 *
 * Keep this predicate in one place — both the live-feed hydration and the
 * session-restore path use it, and missing a case here causes "[Previous
 * Task — Final Tool Results] …" to appear as a spooky user message after
 * a chat reload.
 */
function isInternalToolResultMessage(msg) {
  if (!msg) return false;
  // Preferred signal: explicit flag set by the scheduler or widget route.
  // Forward-compatible — new injection kinds should set this and the UI
  // picks them up automatically without needing to learn their `type`.
  // Covers: widget-error-feedback (async re-activation messages), future
  // system-level feedback injections, etc.
  if (msg.isToolResultInjection === true) return true;
  if (msg.type === 'tool-result') return true;
  if (msg.type === 'task-boundary') return true;
  if (msg.type === 'widget-error-feedback') return true;
  if (msg.type === 'consolidated-input' && typeof msg.content === 'string' && (
    msg.content.startsWith('[Tool Results') ||
    msg.content.startsWith('[Previous Task') ||
    msg.content.startsWith('[Widget render error')
  )) return true;
  return false;
}

// Exported for unit-testing.
export const __test__ = { isInternalToolResultMessage };

/**
 * Deduplicated toast helper - prevents duplicate toasts with the same message
 * Uses message hash as toast ID so react-hot-toast won't show duplicates
 */
const dedupeToast = {
  error: (message, options = {}) => {
    // Create a simple hash from the message for the ID
    const id = 'err-' + message.slice(0, 50).replace(/[^a-z0-9]/gi, '');
    toast.error(message, { ...options, id });
  },
  success: (message, options = {}) => {
    const id = 'suc-' + message.slice(0, 50).replace(/[^a-z0-9]/gi, '');
    toast.success(message, { ...options, id });
  }
};

/**
 * Stream chunk batching — collects rapid WebSocket chunks and flushes
 * to Zustand state at ~12 updates/sec instead of 50-100, dramatically
 * reducing React re-renders during streaming.
 */
const _streamChunkBuffers = new Map(); // agentId -> string[]
let _streamFlushTimer = null;
const STREAM_FLUSH_INTERVAL = 80; // ms (~12 flushes/sec)

function _flushStreamChunks(set) {
  if (_streamFlushTimer) {
    clearTimeout(_streamFlushTimer);
    _streamFlushTimer = null;
  }
  if (_streamChunkBuffers.size === 0) return;

  set(state => {
    const newStreamingState = new Map(state.agentStreamingState || new Map());
    for (const [agentId, chunks] of _streamChunkBuffers) {
      const combined = chunks.join('');
      const currentState = newStreamingState.get(agentId) || { content: '' };
      newStreamingState.set(agentId, {
        ...currentState,
        content: currentState.content + combined,
        lastChunkTime: Date.now()
      });
    }
    _streamChunkBuffers.clear();
    return { agentStreamingState: newStreamingState };
  });
}

export const useAppStore = create(
  subscribeWithSelector((set, get) => ({
    // Application state
    initialized: false,
    loading: false,
    error: null,
    
    // Session state
    sessionId: null,
    projectDir: null,
    
    // Agents state
    agents: [],
    currentAgent: null,

    // Global modal flags. Lifting agent modals (create/edit/import/team)
    // up here lets them open from any route — the keyboard-shortcut
    // dispatcher in Layout reads/writes these without caring about which
    // page is mounted. Components inside <GlobalAgentModals /> render
    // the actual modal UI.
    //
    //   editAgent:    null | <agent object>     ← agent to edit
    //   importAgent:  boolean                   ← import dialog
    //   createAgent:  boolean                   ← create-pilot dialog
    //   createTeam:   boolean                   ← create-team dialog
    modals: {
      editAgent: null,
      importAgent: false,
      createAgent: false,
      createTeam: false,
    },

    // Teams state
    teams: [],
    teamsLoading: false,
    
    // Messages state - now per agent
    messages: [],
    agentMessages: new Map(), // agentId -> messages[]
    isTyping: false, // Deprecated: use agentTypingStatus for per-agent typing state
    agentTypingStatus: new Map(), // agentId -> boolean (per-agent typing status)
    agentStreamingState: new Map(), // agentId -> { isStreaming, messageId, content, model, startTime }
    pendingUserMessages: new Map(), // agentId -> userMessage[] — messages held until AI response arrives

    // Agent communications
    agentCommunications: [], // Inter-agent messages for display
    
    // UI state
    sidebarOpen: true,
    darkMode: false,
    theme: 'light', // 'light' | 'dark' | 'dracula' | 'redteam'
    
    // WebSocket state
    connected: false,
    connectionId: null,
    webSocketSend: null, // Function to send WebSocket messages, set by useWebSocket hook

    // Compaction state (per agent)
    agentCompactionStatus: new Map(), // agentId -> { status, stats, timestamp }

    // Visual editor state (triggered by agent's open-editor action)
    visualEditorOpenRequest: null, // { agentId, appUrl, editorUrl, timestamp }
    visualEditorToolUsed: null,    // timestamp — set when visual-editor tool executes, triggers auto-open

    // Credential request state (triggered by webTool authenticate action)
    pendingCredentialRequest: null, // { requestId, siteId, siteName, agentId, agentName, fields, loginUrl, timeout }

    // User prompt request state (triggered by userPromptTool)
    pendingUserPrompt: null, // { requestId, agentId, agentName, message, questions, timeoutAt }

    // Model error state (triggered when AI model fails)
    pendingModelError: null, // { agentId, agentName, model, errorType, errorMessage, suggestions: [...] }

    // Track which agents have had their history loaded (to avoid repeated fetches)
    agentHistoryLoaded: new Set(), // agentId -> boolean (has history been fetched for this agent?)

    // Streaming settings
    streamingEnabled: true, // Global streaming preference - enabled by default

    // Version state (currentVersion fetched from backend /api/health)
    versionInfo: {
      currentVersion: null, // Will be fetched from backend
      latestVersion: null,
      isUpToDate: null,
      updateAvailable: false,
      updateCommand: 'npm i -g onbuzz-community@latest',
      lastChecked: null,
      checking: false,
      error: null
    },

    // Actions
    /**
     * Open a global modal. Names match the keys in `state.modals`. The
     * payload is the value the modal flag is set to (an object for
     * editAgent, `true` for the boolean flags). Lifting the modal state
     * to the store lets keyboard shortcuts in Layout open them from any
     * route, not just /agents.
     *
     * Examples:
     *   openModal('createAgent')             → modals.createAgent = true
     *   openModal('editAgent', currentAgent) → modals.editAgent = currentAgent
     *   openModal('importAgent')             → modals.importAgent = true
     */
    openModal: (name, payload) => {
      const value = (name === 'editAgent') ? (payload || null) : true;
      set(state => ({ modals: { ...state.modals, [name]: value } }));
    },

    closeModal: (name) => {
      const reset = (name === 'editAgent') ? null : false;
      set(state => ({ modals: { ...state.modals, [name]: reset } }));
    },

    initialize: async () => {
      // Don't reinitialize if already initialized with a valid session
      const currentState = get();
      if (currentState.initialized && currentState.sessionId) {
        console.log('App already initialized with session:', currentState.sessionId);
        return;
      }
      
      set({ loading: true, error: null });
      
      try {
        // Create session
        const sessionResponse = await api.createSession();
        if (!sessionResponse.success) {
          throw new Error('Failed to create session');
        }
        
        const { session } = sessionResponse;
        
        // Get initial system status
        const statusResponse = await api.getStatus(session.id);
        
        set({
          initialized: true,
          sessionId: session.id,
          projectDir: session.projectDir,
          agents: statusResponse.success ? statusResponse.data.agents : [],
          loading: false
        });

        // Fetch teams (non-blocking)
        get().fetchTeams().catch(err => console.warn('Failed to fetch teams on init:', err));

        // Restore conversation history for all agents
        await get().restoreConversationHistory();
        
        // Load theme preference (with migration from old dark mode key)
        const savedTheme = localStorage.getItem('loxia-theme');
        const legacyDarkMode = localStorage.getItem('loxia-dark-mode');
        let theme = 'light';
        if (savedTheme) {
          theme = savedTheme;
        } else if (legacyDarkMode === 'true') {
          theme = 'dark';
        }
        const isDark = theme === 'dark' || theme === 'redteam' || theme === 'dracula';
        set({ theme, darkMode: isDark });
        document.documentElement.classList.remove('dark', 'theme-redteam', 'theme-dracula');
        if (isDark) document.documentElement.classList.add('dark');
        if (theme === 'redteam') document.documentElement.classList.add('theme-redteam');
        if (theme === 'dracula') document.documentElement.classList.add('theme-dracula');
        // Persist the new key format
        localStorage.setItem('loxia-theme', theme);

        // Load streaming preference (default to true if not set)
        const savedStreaming = localStorage.getItem('loxia-streaming-enabled');
        const streamingEnabled = savedStreaming === null ? true : savedStreaming === 'true';
        set({ streamingEnabled });

        // Fetch version from backend
        try {
          const healthResponse = await api.health();
          if (healthResponse.version) {
            set({
              versionInfo: {
                ...get().versionInfo,
                currentVersion: healthResponse.version
              }
            });
          }
        } catch (versionError) {
          console.warn('Failed to fetch version from backend:', versionError);
        }

        // Auto-restore API keys from localStorage if available
        await get().restoreApiKeysFromStorage();

      } catch (error) {
        console.error('Initialization failed:', error);
        set({ 
          error: error.message, 
          loading: false,
          initialized: false 
        });
      }
    },

    createAgent: async (name, modelId = PLATFORM_MODELS.LOXIA_ANTHROPIC_SONNET, systemPrompt = null, options = {}) => {
      const { sessionId, projectDir } = get();
      if (!sessionId) throw new Error('No active session');
      
      set({ loading: true });
      
      try {
        // Extract model configuration from modelId
        const modelConfig = get().getModelConfigById(modelId);
        if (!modelConfig) {
          throw new Error(`Unknown model: ${modelId}`);
        }
        
        const defaultPrompt = systemPrompt || 
          `You are ${name}, an AI assistant in the OnBuzz Community system. You can help with coding, analysis, and various tasks using the available tools.`;
        
        const response = await api.createAgent(sessionId, {
          name,
          systemPrompt: defaultPrompt,
          model: modelConfig.modelName,
          dynamicModelRouting: options.dynamicModelRouting || false,
          capabilities: options.capabilities || [], // No default capabilities - all tools are optional
          directoryAccess: options.directoryAccess || null, // Pass directory access configuration from UI
          // Forward per-tool config only when explicitly provided so the
          // backend default (empty object) isn't overwritten for callers
          // that don't set it.
          ...(options.toolConfig ? { toolConfig: options.toolConfig } : {}),
          ...(options.skills ? { skills: options.skills } : {}),
          ...(options.routingStrategy ? { routingStrategy: options.routingStrategy } : {}),
        }, projectDir);
        
        if (!response.success) {
          throw new Error(response.error);
        }
        
        const newAgent = response.data;
        
        set(state => {
          // Save current agent's messages before switching to new agent
          let updatedAgentMessages = state.agentMessages;
          if (state.currentAgent) {
            updatedAgentMessages = new Map(state.agentMessages).set(state.currentAgent.id, state.messages);
          }
          
          return {
            agents: [...state.agents, newAgent],
            currentAgent: newAgent,
            messages: [], // Clear messages for new agent
            agentMessages: updatedAgentMessages,
            loading: false
          };
        });
        
        return newAgent;
        
      } catch (error) {
        set({ error: error.message, loading: false });
        throw error;
      }
    },

    switchAgent: async (agentId) => {
      const { agents, agentMessages, agentTypingStatus, agentHistoryLoaded, currentAgent, sessionId, projectDir } = get();

      // Save current agent's messages if there is a current agent
      let updatedAgentMessages = agentMessages;
      if (currentAgent && currentAgent.id !== agentId) {
        const currentMessages = get().messages;
        updatedAgentMessages = new Map(agentMessages).set(currentAgent.id, currentMessages);
        set(state => ({
          agentMessages: updatedAgentMessages
        }));
      }

      // Get the typing status for the target agent
      const targetAgentTyping = agentTypingStatus.get(agentId) || false;

      // Check if we have cached messages for this agent
      let agentSpecificMessages = updatedAgentMessages.get(agentId) || [];

      // Only fetch from backend ONCE per agent (first time viewed in this session)
      if (!agentHistoryLoaded.has(agentId) && sessionId) {
        try {
          const convResponse = await api.getAgentConversations(sessionId, agentId, projectDir);
          if (convResponse.success && convResponse.data.conversations?.full?.messages) {
            // Filter and clean messages for UI display
            agentSpecificMessages = convResponse.data.conversations.full.messages
              .filter(msg => {
                // Exclude internal messages that shouldn't appear in chat UI
                if (msg.type === 'scheduler-prompt') return false;
                // Tool results, task-boundary drains, and tool-only
                // consolidated inputs: all are internal injections that
                // render inline with the originating assistant turn via
                // toolResults[], not as standalone user bubbles.
                if (isInternalToolResultMessage(msg)) return false;
                return true;
              })
              .map(msg => {
                // Clean up historical message data
                let cleanedMsg = { ...msg };

                // IMPORTANT: Clear pendingToolExecution for historical messages
                // These are already complete - showing "Executing tools..." is misleading
                if (cleanedMsg.pendingToolExecution) {
                  cleanedMsg.pendingToolExecution = false;
                }

                // Strip internal context sections from message content (legacy data cleanup)
                if (cleanedMsg.content && typeof cleanedMsg.content === 'string') {
                  let cleanContent = cleanedMsg.content;
                  // Remove "[Previous Tool Results]..." section
                  if (cleanContent.includes('[Previous Tool Results]')) {
                    cleanContent = cleanContent.split('[Previous Tool Results]')[0].trim();
                  }
                  // Remove "[Agent Messages]..." section
                  if (cleanContent.includes('[Agent Messages]')) {
                    cleanContent = cleanContent.split('[Agent Messages]')[0].trim();
                  }
                  // Remove processing notes
                  if (cleanContent.includes('Note: Use the agentcommunication tool')) {
                    cleanContent = cleanContent.split('Note: Use the agentcommunication tool')[0].trim();
                  }
                  // If nothing left after stripping, skip this message
                  if (!cleanContent) return null;
                  // Update content if changed
                  if (cleanContent !== cleanedMsg.content) {
                    cleanedMsg.content = cleanContent;
                  }
                }
                return cleanedMsg;
              })
              .filter(Boolean); // Remove nulls from stripped empty messages
            // Update the cache
            updatedAgentMessages = new Map(updatedAgentMessages).set(agentId, agentSpecificMessages);
          }
          // Mark this agent's history as loaded (even if empty, to prevent repeated fetches)
          const newHistoryLoaded = new Set(agentHistoryLoaded);
          newHistoryLoaded.add(agentId);
          set({ agentMessages: updatedAgentMessages, agentHistoryLoaded: newHistoryLoaded });
        } catch (error) {
          console.warn('Failed to fetch agent conversations from backend:', error);
          // Still mark as loaded to prevent repeated failed fetches
          const newHistoryLoaded = new Set(agentHistoryLoaded);
          newHistoryLoaded.add(agentId);
          set({ agentHistoryLoaded: newHistoryLoaded });
        }
      }

      // Set state immediately with local data (no waiting for backend)
      const localAgent = agents.find(a => a.id === agentId);
      if (localAgent) {
        set({
          currentAgent: localAgent,
          messages: agentSpecificMessages,
          isTyping: targetAgentTyping
        });
      }

      // Fetch fresh agent status in background (non-blocking) and update if different
      api.getAgentStatus(sessionId, { agentId }, projectDir)
        .then(response => {
          if (response.success && response.data) {
            const freshAgentData = response.data;
            // Only update if this agent is still the current one
            const currentState = get();
            if (currentState.currentAgent?.id !== agentId) return;

            const localAgentNow = currentState.agents.find(a => a.id === agentId);
            if (!localAgentNow) return;

            // Check if anything actually changed
            const hasChanges =
              freshAgentData.mode !== localAgentNow.mode ||
              freshAgentData.modeState !== localAgentNow.modeState ||
              freshAgentData.status !== localAgentNow.status ||
              freshAgentData.currentModel !== localAgentNow.currentModel;

            if (hasChanges) {
              const updatedAgent = {
                ...localAgentNow,
                mode: freshAgentData.mode || localAgentNow.mode,
                modeState: freshAgentData.modeState || localAgentNow.modeState,
                status: freshAgentData.status || localAgentNow.status,
                currentModel: freshAgentData.currentModel || localAgentNow.currentModel,
                lastActivity: freshAgentData.lastActivity || localAgentNow.lastActivity
              };

              set(state => ({
                agents: state.agents.map(a => a.id === agentId ? updatedAgent : a),
                currentAgent: state.currentAgent?.id === agentId ? updatedAgent : state.currentAgent
              }));
            }
          }
        })
        .catch(error => {
          console.warn('Background agent status fetch failed:', error);
        });
    },

    sendMessage: async (content, contextReferences = []) => {
      const { sessionId, currentAgent, projectDir, streamingEnabled } = get();

      if (!sessionId || !currentAgent) {
        throw new Error('No active session or agent');
      }

      const agentId = currentAgent.id;

      // Helper to set typing status for specific agent
      const setAgentTyping = (isTyping) => {
        set(state => {
          const newTypingStatus = new Map(state.agentTypingStatus);
          newTypingStatus.set(agentId, isTyping);
          return {
            agentTypingStatus: newTypingStatus,
            // Also update legacy isTyping for current agent
            isTyping: state.currentAgent?.id === agentId ? isTyping : state.isTyping
          };
        });
      };

      // Check if AI is currently generating a response for this agent.
      // If so, defer adding the user message to UI until the AI response arrives,
      // guaranteeing correct causal ordering: [R_x(AI response), M_y(user message)].
      const streamState = get().agentStreamingState?.get(agentId);
      const isAgentGenerating = streamState?.isStreaming ||
        get().agentTypingStatus?.get(agentId);

      const userMessage = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        contextReferences
      };

      if (isAgentGenerating) {
        // AI is generating — queue this message but show it in UI with pending indicator.
        // It will be flushed (isPending removed) after the in-flight AI response arrives.
        const pendingMessage = { ...userMessage, isPending: true };
        set(state => {
          const newPending = new Map(state.pendingUserMessages);
          const existing = newPending.get(agentId) || [];
          newPending.set(agentId, [...existing, pendingMessage]);
          return {
            pendingUserMessages: newPending,
            messages: [...state.messages, pendingMessage]
          };
        });
        console.log('⏳ User message queued — shown with pending indicator while waiting for AI response');
      } else {
        // No AI response in-flight — add user message to UI immediately
        set(state => {
          const newTypingStatus = new Map(state.agentTypingStatus);
          newTypingStatus.set(agentId, true);
          return {
            messages: [...state.messages, userMessage],
            agentTypingStatus: newTypingStatus,
            isTyping: true
          };
        });
      }

      try {
        const response = await api.sendMessage(sessionId, {
          agentId: currentAgent.id,
          message: content,
          mode: AGENT_MODES.CHAT,
          contextReferences,
          streamingEnabled
        }, projectDir);

        if (!response.success) {
          // For failed responses, the error details are in the response object directly
          throw new Error(response.error || 'API request failed');
        }


        // Check if response.data exists (only for successful responses)
        if (!response.data) {
          console.error('Response data is undefined:', response);
          throw new Error('Invalid response: missing data');
        }

        // NEW ARCHITECTURE: Check if this is just a queuing confirmation
        if (response.data.data?.status === 'queued') {
          console.log('Message queued for processing, waiting for WebSocket response');
          // Don't add any message - the real response will come via WebSocket
          // Keep typing status true - it will be set to false when WebSocket response arrives
          return;
        }

        // LEGACY: Only add assistant message if we got an actual AI response (not just queuing confirmation)
        if (!response.data.data || !response.data.data.message || !response.data.data.message.content) {
          console.log('No AI response in HTTP reply, waiting for WebSocket');
          // Keep typing status true - it will be set to false when WebSocket response arrives
          return;
        }

        // Add assistant message (only for legacy synchronous responses)
        const assistantMessage = {
          id: response.data.data.message.id || `msg-${Date.now()}`,
          role: 'assistant',
          content: response.data.data.message.content || '',
          timestamp: response.data.data.message.timestamp || new Date().toISOString(),
          toolResults: response.data.data.toolResults || [],
          agentRedirects: response.data.data.agentRedirects || [],
          tokenUsage: response.data.data.message.tokenUsage || null
        };

        // Update agent's current model if it changed (for dynamic routing)
        const newCurrentModel = response.data.data.currentModel;

        set(state => {
          const newTypingStatus = new Map(state.agentTypingStatus);
          newTypingStatus.set(agentId, false);

          const updatedState = {
            messages: [...state.messages, assistantMessage],
            agentTypingStatus: newTypingStatus,
            isTyping: false
          };

          // Update current agent's model if it changed
          if (newCurrentModel && state.currentAgent && newCurrentModel !== state.currentAgent.currentModel) {
            updatedState.currentAgent = {
              ...state.currentAgent,
              currentModel: newCurrentModel
            };

            // Also update the agent in the agents array
            updatedState.agents = state.agents.map(agent =>
              agent.id === state.currentAgent.id
                ? { ...agent, currentModel: newCurrentModel }
                : agent
            );
          }

          return updatedState;
        });

        return assistantMessage;

      } catch (error) {
        setAgentTyping(false);
        set({ error: error.message });
        throw error;
      }
    },

    updateAgent: async (agentId, updates) => {
      const { sessionId, projectDir, agents: currentAgents } = get();
      if (!sessionId) throw new Error('No active session');

      console.log('updateAgent called:', { agentId, updates, currentAgentsCount: currentAgents.length });

      set({ loading: true });

      try {
        const response = await api.updateAgent(sessionId, agentId, updates, projectDir);

        if (!response.success) {
          throw new Error(response.error);
        }

        // Orchestrator returns agent directly in response.data, not response.data.agent
        const updatedAgent = response.data;
        console.log('Agent update response:', updatedAgent);

        set(state => {
          // Update agent in agents array
          const updatedAgents = state.agents.map(agent =>
            agent.id === agentId ? updatedAgent : agent
          );

          // Update current agent if it's the one being updated
          const updatedCurrentAgent = state.currentAgent?.id === agentId
            ? updatedAgent
            : state.currentAgent;

          console.log('State after agent update:', {
            beforeCount: state.agents.length,
            afterCount: updatedAgents.length,
            updatedAgentId: agentId,
            agentIds: updatedAgents.map(a => a.id)
          });

          return {
            agents: updatedAgents,
            currentAgent: updatedCurrentAgent,
            loading: false
          };
        });

        return updatedAgent;

      } catch (error) {
        console.error('updateAgent error:', error);
        set({ error: error.message, loading: false });
        throw error;
      }
    },

    pauseAgent: async (agentId, duration = 60, reason = 'Manual pause') => {
      const { sessionId, projectDir } = get();
      
      try {
        const response = await api.pauseAgent(sessionId, {
          agentId,
          duration,
          reason
        }, projectDir);
        
        if (!response.success) {
          throw new Error(response.error);
        }
        
        // Update agent status
        set(state => ({
          agents: state.agents.map(agent =>
            agent.id === agentId
              ? { ...agent, status: 'paused', pausedUntil: response.data.pausedUntil }
              : agent
          )
        }));
        
        return response.data;
        
      } catch (error) {
        set({ error: error.message });
        throw error;
      }
    },

    resumeAgent: async (agentId) => {
      const { sessionId, projectDir } = get();
      
      try {
        const response = await api.resumeAgent(sessionId, { agentId }, projectDir);
        
        if (!response.success) {
          throw new Error(response.error);
        }
        
        // Update agent status
        set(state => ({
          agents: state.agents.map(agent =>
            agent.id === agentId
              ? { ...agent, status: 'active', pausedUntil: null }
              : agent
          )
        }));
        
        return response.data;
        
      } catch (error) {
        set({ error: error.message });
        throw error;
      }
    },

    deleteAgent: async (agentId) => {
      const { sessionId, projectDir, currentAgent } = get();

      try {
        const response = await api.deleteAgent(sessionId, { agentId }, projectDir);

        if (!response.success) {
          throw new Error(response.error);
        }

        // Broadcast visual editor cleanup for this agent
        try {
          const channel = new BroadcastChannel('loxia-visual-editor');
          channel.postMessage({
            type: 'editor-closed',
            agentId,
            reason: 'agent_deleted'
          });
          channel.close();
        } catch (error) {
          console.warn('Failed to broadcast visual editor cleanup:', error);
        }

        // Remove agent from state
        set(state => {
          const newAgents = state.agents.filter(agent => agent.id !== agentId);
          const newAgentMessages = new Map(state.agentMessages);
          newAgentMessages.delete(agentId);
          
          // If this was the current agent, clear current agent and messages
          const newState = {
            agents: newAgents,
            agentMessages: newAgentMessages
          };
          
          if (currentAgent && currentAgent.id === agentId) {
            newState.currentAgent = null;
            newState.messages = [];
          }
          
          return newState;
        });
        
        return response.data || response;

      } catch (error) {
        set({ error: error.message });
        throw error;
      }
    },

    unloadAgent: async (agentId) => {
      const { sessionId, projectDir, currentAgent } = get();

      try {
        const response = await api.unloadAgent(sessionId, { agentId }, projectDir);

        if (!response.success) {
          throw new Error(response.error);
        }

        // Broadcast visual editor cleanup for this agent
        try {
          const channel = new BroadcastChannel('loxia-visual-editor');
          channel.postMessage({
            type: 'editor-closed',
            agentId,
            reason: 'agent_unloaded'
          });
          channel.close();
        } catch (error) {
          console.warn('Failed to broadcast visual editor cleanup:', error);
        }

        // Remove agent from state (same as delete, but files remain on disk)
        set(state => {
          const newAgents = state.agents.filter(agent => agent.id !== agentId);
          const newAgentMessages = new Map(state.agentMessages);
          newAgentMessages.delete(agentId);
          const newHistoryLoaded = new Set(state.agentHistoryLoaded);
          newHistoryLoaded.delete(agentId);

          // If this was the current agent, clear current agent and messages
          const newState = {
            agents: newAgents,
            agentMessages: newAgentMessages,
            agentHistoryLoaded: newHistoryLoaded
          };

          if (currentAgent && currentAgent.id === agentId) {
            newState.currentAgent = null;
            newState.messages = [];
          }

          return newState;
        });

        return response.data || response;

      } catch (error) {
        set({ error: error.message });
        throw error;
      }
    },

    duplicateAgent: async (agentId, options = {}) => {
      const { sessionId } = get();
      const { newName, keepConversation = false } = options;

      try {
        set({ loading: true });

        const response = await api.duplicateAgent(agentId, {
          newName,
          keepConversation,
          sessionId
        });

        if (!response.success) {
          throw new Error(response.error);
        }

        const newAgent = response.agent;

        // Add the new agent to state
        set(state => ({
          agents: [...state.agents, newAgent],
          loading: false
        }));

        return newAgent;

      } catch (error) {
        set({ error: error.message, loading: false });
        throw error;
      }
    },

    // ==================== TEAM ACTIONS ====================

    fetchTeams: async () => {
      try {
        set({ teamsLoading: true });
        const response = await api.getTeams();
        if (response.success) {
          set({ teams: response.data, teamsLoading: false });
        } else {
          throw new Error(response.error);
        }
      } catch (error) {
        console.error('Failed to fetch teams:', error);
        set({ teamsLoading: false });
      }
    },

    createTeam: async (teamData) => {
      try {
        const response = await api.createTeam(teamData);
        if (!response.success) {
          throw new Error(response.error);
        }

        const newTeam = response.data;
        set(state => ({
          teams: [...state.teams, newTeam]
        }));

        return newTeam;
      } catch (error) {
        console.error('Failed to create team:', error);
        throw error;
      }
    },

    updateTeam: async (teamId, updates) => {
      try {
        const response = await api.updateTeam(teamId, updates);
        if (!response.success) {
          throw new Error(response.error);
        }

        const updatedTeam = response.data;
        set(state => ({
          teams: state.teams.map(team =>
            team.id === teamId ? updatedTeam : team
          )
        }));

        return updatedTeam;
      } catch (error) {
        console.error('Failed to update team:', error);
        throw error;
      }
    },

    deleteTeam: async (teamId) => {
      try {
        const response = await api.deleteTeam(teamId);
        if (!response.success) {
          throw new Error(response.error);
        }

        set(state => ({
          teams: state.teams.filter(team => team.id !== teamId)
        }));

        return true;
      } catch (error) {
        console.error('Failed to delete team:', error);
        throw error;
      }
    },

    loadTeam: async (teamId) => {
      try {
        set({ loading: true });
        const response = await api.loadTeam(teamId);
        if (!response.success) {
          throw new Error(response.error);
        }

        // Add newly loaded agents to state
        const { agents } = get();
        const existingIds = new Set(agents.map(a => a.id));
        const newAgents = response.loadResults
          .filter(r => r.status === 'loaded' && r.agent)
          .map(r => r.agent)
          .filter(a => !existingIds.has(a.id));

        if (newAgents.length > 0) {
          set(state => ({
            agents: [...state.agents, ...newAgents]
          }));
        }

        set({ loading: false });
        return response;
      } catch (error) {
        set({ loading: false });
        console.error('Failed to load team:', error);
        throw error;
      }
    },

    addAgentToTeam: async (teamId, agentId) => {
      try {
        const response = await api.addAgentToTeam(teamId, agentId);
        if (!response.success) {
          throw new Error(response.error);
        }

        const updatedTeam = response.data;
        set(state => ({
          teams: state.teams.map(team =>
            team.id === teamId ? updatedTeam : team
          )
        }));

        return updatedTeam;
      } catch (error) {
        console.error('Failed to add agent to team:', error);
        throw error;
      }
    },

    removeAgentFromTeam: async (teamId, agentId) => {
      try {
        const response = await api.removeAgentFromTeam(teamId, agentId);
        if (!response.success) {
          throw new Error(response.error);
        }

        const updatedTeam = response.data;
        set(state => ({
          teams: state.teams.map(team =>
            team.id === teamId ? updatedTeam : team
          )
        }));

        return updatedTeam;
      } catch (error) {
        console.error('Failed to remove agent from team:', error);
        throw error;
      }
    },

    // Get teams that contain a specific agent
    getAgentTeams: (agentId) => {
      const { teams } = get();
      return teams.filter(team => team.memberAgentIds.includes(agentId));
    },

    // Get agents not in any team
    getUnassignedAgents: () => {
      const { agents, teams } = get();
      const assignedIds = new Set(teams.flatMap(t => t.memberAgentIds || []));
      return agents.filter(a => !assignedIds.has(a.id));
    },

    // ==================== END TEAM ACTIONS ====================

    refreshAgents: async () => {
      const { sessionId, projectDir } = get();
      
      try {
        const response = await api.listAgents(sessionId, projectDir);
        
        if (response.success) {
          set({ agents: response.data });
        }
        
      } catch (error) {
        console.error('Failed to refresh agents:', error);
      }
    },

    toggleSidebar: () => {
      set(state => ({ sidebarOpen: !state.sidebarOpen }));
    },

    toggleDarkMode: () => {
      // Cycle through: light → dark → dracula → redteam → light.
      // Dracula slots between plain dark and the red-team accent so
      // the common path (light ↔ dark) stays a single tap, while
      // power-users can reach the accent themes with one more cycle.
      set(state => {
        const cycle = { light: 'dark', dark: 'dracula', dracula: 'redteam', redteam: 'light' };
        const newTheme = cycle[state.theme] || 'light';
        const isDark = newTheme === 'dark' || newTheme === 'redteam' || newTheme === 'dracula';
        localStorage.setItem('loxia-theme', newTheme);
        document.documentElement.classList.remove('dark', 'theme-redteam', 'theme-dracula');
        if (isDark) document.documentElement.classList.add('dark');
        if (newTheme === 'redteam') document.documentElement.classList.add('theme-redteam');
        if (newTheme === 'dracula') document.documentElement.classList.add('theme-dracula');
        return { darkMode: isDark, theme: newTheme };
      });
    },

    setDarkMode: (isDark) => {
      const newTheme = isDark ? 'dark' : 'light';
      localStorage.setItem('loxia-theme', newTheme);
      document.documentElement.classList.remove('dark', 'theme-redteam', 'theme-dracula');
      if (isDark) document.documentElement.classList.add('dark');
      set({ darkMode: isDark, theme: newTheme });
    },

    /** Explicit theme setter — used by Settings when the user picks
     *  a theme directly rather than cycling. */
    setTheme: (theme) => {
      const accepted = ['light', 'dark', 'dracula', 'redteam'];
      if (!accepted.includes(theme)) return;
      const isDark = theme === 'dark' || theme === 'redteam' || theme === 'dracula';
      localStorage.setItem('loxia-theme', theme);
      document.documentElement.classList.remove('dark', 'theme-redteam', 'theme-dracula');
      if (isDark) document.documentElement.classList.add('dark');
      if (theme === 'redteam') document.documentElement.classList.add('theme-redteam');
      if (theme === 'dracula') document.documentElement.classList.add('theme-dracula');
      set({ darkMode: isDark, theme });
    },

    setTheme: (themeName) => {
      const isDark = themeName === 'dark' || themeName === 'redteam';
      localStorage.setItem('loxia-theme', themeName);
      document.documentElement.classList.remove('dark', 'theme-redteam');
      if (isDark) document.documentElement.classList.add('dark');
      if (themeName === 'redteam') document.documentElement.classList.add('theme-redteam');
      set({ darkMode: isDark, theme: themeName });
    },

    setStreamingEnabled: (enabled) => {
      localStorage.setItem('loxia-streaming-enabled', enabled.toString());
      set({ streamingEnabled: enabled });
    },

    setWebSocketConnection: (connected, connectionId = null) => {
      set({ connected, connectionId });
    },

    /**
     * Update an existing message with tool execution results
     * Called when async tool execution completes
     */
    updateMessageWithToolResults: (agentId, messageId, toolData) => {
      const { currentAgent, agentMessages } = get();

      console.log('🔧 Updating message with tool results:', {
        agentId,
        messageId,
        toolCount: toolData.toolResults?.length || 0,
        hasError: !!toolData.error
      });

      // Function to update a message in an array
      const updateMessage = (messages) => {
        return messages.map(msg => {
          if (msg.id === messageId) {
            return {
              ...msg,
              pendingToolExecution: false,
              toolExecutions: toolData.toolExecutions || [],
              toolResults: toolData.toolResults || [],
              hasToolExecutions: (toolData.toolExecutions?.length || 0) > 0,
              toolExecutionError: toolData.error
            };
          }
          return msg;
        });
      };

      // Update the current visible messages if this is the current agent
      if (currentAgent?.id === agentId) {
        set(state => ({
          messages: updateMessage(state.messages)
        }));
      }

      // Also update the agentMessages Map
      const agentMsgs = agentMessages.get(agentId);
      if (agentMsgs) {
        const updatedMsgs = updateMessage(agentMsgs);
        set(state => {
          const newAgentMessages = new Map(state.agentMessages);
          newAgentMessages.set(agentId, updatedMsgs);
          return { agentMessages: newAgentMessages };
        });
      }

      // Artifacts are now tracked by the backend and pushed via WebSocket 'artifacts_updated'
    },

    handleAutonomousUpdate: (data) => {
      // Handle both formats: {agentId, type, ...} and {agentId, message, ...}
      const agentId = data.agentId;
      const type = data.type || (data.message ? 'message_added' : 'unknown');
      const { currentAgent, agents, agentMessages } = get();

      console.log('🔍 handleAutonomousUpdate called:', {
        incomingAgentId: agentId,
        currentAgentId: currentAgent?.id,
        updateType: type,
        hasMessage: !!data.message,
        agentMatch: currentAgent?.id === agentId,
        isCurrentlyVisible: currentAgent?.id === agentId
      });

      // NEW BEHAVIOR: Always process messages for all agents
      // Add to appropriate agent's message store
      // Only render if it's the currently selected agent
      const incomingAgent = agents.find(a => a.id === agentId);

      if (!incomingAgent) {
        console.warn('⚠️ Received message for unknown agent:', agentId);
        // Still process it - agent might not be in local list yet
      }

      const isCurrentlyVisible = currentAgent?.id === agentId;

      console.log('✅ Processing autonomous update:', {
        agentId,
        type,
        isCurrentlyVisible,
        agentMode: incomingAgent?.mode
      });
      
      switch (type) {
        case 'execution_started':
          console.log('🤖 Autonomous execution started:', data);
          break;
          
        case 'iteration_started':
          console.log(`🔄 Iteration ${data.iteration} started`);
          break;
          
        case 'message_added':
          // NEW BEHAVIOR: Add message to appropriate agent's store
          // If it's the currently visible agent, update visible messages
          // If it's a different agent, update agentMessages Map
          if (data.message) {
            console.log('🔍 Message being added:', {
              agentId,
              isCurrentlyVisible,
              id: data.message.id,
              role: data.message.role,
              contentLength: data.message.content?.length,
              contentPreview: data.message.content?.substring(0, 100),
              hasToolResults: !!data.message.toolResults,
              toolResultsCount: data.message.toolResults?.length || 0,
              timestamp: new Date().toISOString()
            });

            const formattedMessage = {
              ...data.message,
              // Ensure UI-friendly format including tool results
              role: data.message.role,
              content: data.message.content,
              timestamp: data.message.timestamp,
              toolResults: data.message.toolResults,
              toolExecutions: data.message.toolExecutions,
              hasToolExecutions: data.message.hasToolExecutions,
              tokenUsage: data.message.tokenUsage,
              iteration: data.message.iteration,
              autonomous: data.message.autonomous
            };

            set(state => {
              const updatedState = {};

              // If this message is for the currently visible agent, update visible messages
              if (isCurrentlyVisible) {
                let newMessages = [...state.messages, formattedMessage];

                // After adding an assistant message, flush any pending user messages
                // by removing the isPending flag from messages already shown in UI.
                if (formattedMessage.role === 'assistant') {
                  const pending = state.pendingUserMessages.get(agentId);
                  if (pending?.length > 0) {
                    const pendingIds = new Set(pending.map(m => m.id));
                    newMessages = newMessages.map(m =>
                      pendingIds.has(m.id) ? { ...m, isPending: false } : m
                    );
                    const newPending = new Map(state.pendingUserMessages);
                    newPending.delete(agentId);
                    updatedState.pendingUserMessages = newPending;
                    console.log('✅ Flushed', pending.length, 'pending user message(s) after AI response');
                  }
                  updatedState.isTyping = false;
                }

                updatedState.messages = newMessages;
                console.log('✅ Added to visible messages - new count:', newMessages.length);
              } else {
                // Message is for a different agent - store in agentMessages Map
                const existingMessages = state.agentMessages.get(agentId) || [];
                const updatedAgentMessages = new Map(state.agentMessages);
                updatedAgentMessages.set(agentId, [...existingMessages, formattedMessage]);
                updatedState.agentMessages = updatedAgentMessages;
                console.log('✅ Added to agentMessages Map for agent:', agentId, '- new count:', existingMessages.length + 1);
              }

              // ALWAYS update agentMessages for the current agent too
              // (Task Board and other views read from agentMessages, not messages)
              if (isCurrentlyVisible) {
                const existingAgentMsgs = state.agentMessages.get(agentId) || [];
                const updatedAgentMessages = updatedState.agentMessages
                  ? updatedState.agentMessages
                  : new Map(state.agentMessages);
                updatedAgentMessages.set(agentId, [...existingAgentMsgs, formattedMessage]);
                updatedState.agentMessages = updatedAgentMessages;
              }

              // Artifacts are tracked by the backend and pushed via WebSocket 'artifacts_updated'

              // Update per-agent typing status when assistant response arrives
              if (formattedMessage.role === 'assistant') {
                const newTypingStatus = new Map(state.agentTypingStatus);
                newTypingStatus.set(agentId, false);
                updatedState.agentTypingStatus = newTypingStatus;
              }

              // Update agent's current model if it changed (from dynamic routing)
              if (data.agentCurrentModel && agentId) {
                console.log('🔄 Updating agent model from WebSocket:', {
                  agentId,
                  newModel: data.agentCurrentModel,
                  currentAgentId: state.currentAgent?.id,
                  currentModel: state.currentAgent?.currentModel
                });

                // Update the agent in the agents array
                updatedState.agents = state.agents.map(agent =>
                  agent.id === agentId
                    ? { ...agent, currentModel: data.agentCurrentModel }
                    : agent
                );

                // Update current agent if it's the same one
                if (state.currentAgent?.id === agentId) {
                  updatedState.currentAgent = {
                    ...state.currentAgent,
                    currentModel: data.agentCurrentModel
                  };
                }
              }

              return updatedState;
            });
          }
          break;
          
          
        case 'execution_completed':
          console.log('✅ Autonomous execution completed:', data);
          // Update agent state
          set(state => ({
            agents: state.agents.map(agent =>
              agent.id === agentId
                ? { ...agent, modeState: AGENT_MODE_STATES.IDLE }
                : agent
            ),
            currentAgent: state.currentAgent?.id === agentId
              ? { ...state.currentAgent, modeState: AGENT_MODE_STATES.IDLE }
              : state.currentAgent
          }));
          break;
          
        case 'execution_stopped':
          console.log('🛑 Autonomous execution stopped:', data);
          // Update agent state (both mode and modeState) and reset isTyping
          set(state => {
            console.log('🛑 Updating agent state for stop:', {
              agentId,
              currentAgentId: state.currentAgent?.id,
              newMode: data.mode || 'chat',
              newModeState: data.modeState || AGENT_MODE_STATES.STOPPED
            });

            // Reset isTyping when current agent's execution is stopped
            const shouldResetTyping = state.currentAgent?.id === agentId;

            // Also reset agentTypingStatus for this agent
            const newTypingStatus = new Map(state.agentTypingStatus);
            newTypingStatus.set(agentId, false);

            return {
              agents: state.agents.map(agent =>
                agent.id === agentId
                  ? {
                      ...agent,
                      mode: data.mode || 'chat', // Update mode to chat
                      modeState: data.modeState || AGENT_MODE_STATES.STOPPED
                    }
                  : agent
              ),
              currentAgent: state.currentAgent?.id === agentId
                ? {
                    ...state.currentAgent,
                    mode: data.mode || 'chat', // Update mode to chat
                    modeState: data.modeState || AGENT_MODE_STATES.STOPPED
                  }
                : state.currentAgent,
              // Reset typing state for current agent
              isTyping: shouldResetTyping ? false : state.isTyping,
              agentTypingStatus: newTypingStatus
            };
          });
          break;
          
        case 'execution_max_iterations':
          console.log('⚠️ Max iterations reached:', data);
          // Update agent state
          set(state => ({
            agents: state.agents.map(agent =>
              agent.id === agentId
                ? { ...agent, modeState: AGENT_MODE_STATES.IDLE }
                : agent
            ),
            currentAgent: state.currentAgent?.id === agentId
              ? { ...state.currentAgent, modeState: AGENT_MODE_STATES.IDLE }
              : state.currentAgent
          }));
          break;
          
        default:
          console.log('Unknown autonomous update type:', type, data);
      }
    },

    handleWebSocketMessage: (message) => {
      // Handle different message formats gracefully
      if (!message || typeof message !== 'object') {
        console.log('Invalid WebSocket message format:', message);
        return;
      }

      const { type, data, action } = message;
      
      // Enhanced logging for autonomous updates
      if (type === 'autonomous_update') {
        console.log('📨 Received autonomous_update WebSocket message:', {
          type,
          agentId: data?.agentId,
          updateType: data?.type,
          hasMessage: !!data?.message,
          messageDetails: data?.message ? {
            id: data.message.id,
            role: data.message.role,
            contentLength: data.message.content?.length,
            hasToolResults: !!data.message.toolResults,
            autonomous: data.message.autonomous
          } : undefined,
          fullData: data
        });
      }
      
      // Handle messages with type/data structure
      if (type && data) {
        switch (type) {
          case 'message_added':
            // Handle real-time message updates from AgentScheduler
            console.log('📩 Received message_added:', data);
            get().handleAutonomousUpdate(data);
            break;
            
          case 'autonomous_update':
            // Handle real-time autonomous execution updates
            get().handleAutonomousUpdate(data);
            break;
            
          case 'orchestrator_response':
            // Handle real-time orchestrator updates
            if (data.action === 'list_agents') {
              set({ agents: data.response?.data || [] });
            }
            break;
            
          case 'state-file-recovery': {
            // Backend recovered an agent's state or conversations file
            // (missing → recreated, empty → recreated, corrupt → repaired
            // or salvaged). Surface as a toast so the operator sees what
            // was salvaged. The backend chose `data.level` (info/warn/error)
            // based on severity.
            const msg = data.recovery?.message
              || `${data.recovery?.label || 'A state file'} was auto-recovered.`;
            const detail = data.agentName ? `${msg} (${data.agentName})` : msg;
            if (data.level === 'error') {
              toast.error(detail, { duration: 8000 });
            } else if (data.level === 'warning') {
              toast(detail, { icon: '⚠️', duration: 6000 });
            } else {
              toast(detail, { icon: '🛠', duration: 4000 });
            }
            break;
          }

          case 'agent_status_update':
            // Update specific agent status
            if (data.agentId) {
              set(state => ({
                agents: state.agents.map(agent =>
                  agent.id === data.agentId
                    ? { ...agent, ...(data.updates || {}) }
                    : agent
                )
              }));
            }
            break;
            
          case 'tool_execution_update':
            // Handle tool execution updates (legacy)
            console.log('Tool execution update:', data);
            break;

          case 'tool_execution_complete':
            // Handle async tool execution completion - update existing message with results
            console.log('🔧 Tool execution complete:', data);
            if (data.agentId && data.responseMessageId) {
              get().updateMessageWithToolResults(data.agentId, data.responseMessageId, data);
            }
            // Auto-open visual editor when visual-editor tool is used
            if (data.agentId === get().currentAgent?.id && data.toolResults) {
              const hasVisualEditorResult = data.toolResults.some(r => r.toolId === 'visual-editor');
              if (hasVisualEditorResult) {
                set({ visualEditorToolUsed: Date.now() });
              }
            }
            break;

          case 'widget_changed':
            // Backend pushes after every widget mutation (render, set-main,
            // share, unshare, apply-upgrade, destroy). Keeps the artifacts
            // panel summary cache in sync without depending on chat-feed
            // messages — the feed is lazily virtualized and old tool-result
            // messages may not be mounted, so feed-only observation misses
            // widgets and their version/share state.
            if (data?.agentId && data?.changeType && window.__widgetArtifactsStore) {
              const store = window.__widgetArtifactsStore.getState();
              if (data.changeType === 'destroyed') {
                store.removeSummary(data.agentId, data.widgetId);
              } else if (data.summary) {
                store.upsertSummary(data.agentId, data.summary);
              }
            }
            break;

          case 'artifacts_updated':
            // Filesystem artifacts pushed from backend — load into artifacts store
            console.log('📦 Artifacts update received:', {
              agentId: data?.agentId,
              artifactCount: data?.artifacts ? Object.keys(data.artifacts).length : 0,
              hasStore: !!window.__artifactsStore
            });
            if (data.agentId && data.artifacts) {
              const { currentAgent } = get();
              if (currentAgent?.id === data.agentId && window.__artifactsStore) {
                window.__artifactsStore.getState().loadFromBackend(data.artifacts, data.workingDirectory);
                console.log('📦 Artifacts loaded into store:', window.__artifactsStore.getState().artifacts.size);
              } else {
                console.log('📦 Skipped artifacts: currentAgent=', currentAgent?.id, 'incoming=', data.agentId);
              }
            }
            break;

          case 'stream_start':
            // Handle streaming response start
            console.log('📡 Stream start:', data);
            if (data.agentId) {
              // Clear any stale buffered chunks from a previous stream
              _streamChunkBuffers.delete(data.agentId);
              set(state => {
                const newStreamingState = new Map(state.agentStreamingState || new Map());
                newStreamingState.set(data.agentId, {
                  isStreaming: true,
                  messageId: data.messageId,
                  content: '',
                  model: data.model,
                  startTime: data.timestamp
                });
                return { agentStreamingState: newStreamingState };
              });
            }
            break;

          case 'stream_chunk':
            // Buffer chunks and flush at intervals (~12/sec) instead of
            // updating state on every token (50-100/sec)
            if (data.agentId && data.content) {
              // Normalize: some providers send objects {content, type} instead of strings
              const chunkStr = typeof data.content === 'string'
                ? data.content
                : (data.content?.content || data.content?.text || String(data.content));
              if (!_streamChunkBuffers.has(data.agentId)) {
                _streamChunkBuffers.set(data.agentId, []);
              }
              _streamChunkBuffers.get(data.agentId).push(chunkStr);

              if (!_streamFlushTimer) {
                _streamFlushTimer = setTimeout(() => {
                  _streamFlushTimer = null;
                  _flushStreamChunks(set);
                }, STREAM_FLUSH_INTERVAL);
              }
            }
            break;

          case 'stream_complete':
            // Handle streaming response completion
            console.log('✅ Stream complete:', data);
            if (data.agentId) {
              // Discard buffered chunks — stream_complete carries final content
              _streamChunkBuffers.delete(data.agentId);
              if (_streamChunkBuffers.size === 0 && _streamFlushTimer) {
                clearTimeout(_streamFlushTimer);
                _streamFlushTimer = null;
              }
              set(state => {
                const newStreamingState = new Map(state.agentStreamingState || new Map());
                // Reasoning / thinking from reasoning-capable models
                // (DeepSeek-R1, Kimi thinking, xAI reasoning, Claude
                // thinking, Responses-API o-series). Carried through from
                // the backend's stream_complete event. See
                // autopilot-backend/routes/llm.js + autopilot-cli-v10's
                // aiService + agentScheduler. `reasoning` may be an empty
                // string when content isn't exposed but a token count is
                // (OpenAI o-series opaque reasoning); the UI renders the
                // token-count pill alone in that case.
                newStreamingState.set(data.agentId, {
                  isStreaming: false,
                  messageId: data.messageId,
                  content: data.content,
                  reasoning: data.reasoning || '',
                  reasoningTokens: typeof data.reasoningTokens === 'number' ? data.reasoningTokens : null,
                  model: data.model,
                  usage: data.usage,
                  finishReason: data.finishReason,
                  endTime: data.timestamp
                });
                return { agentStreamingState: newStreamingState };
              });
            }
            break;

          case 'stream_error':
            // Handle streaming response error
            console.error('❌ Stream error:', data);
            if (data.agentId) {
              // Discard buffered chunks on error
              _streamChunkBuffers.delete(data.agentId);
              if (_streamChunkBuffers.size === 0 && _streamFlushTimer) {
                clearTimeout(_streamFlushTimer);
                _streamFlushTimer = null;
              }
              set(state => {
                const newStreamingState = new Map(state.agentStreamingState || new Map());
                newStreamingState.set(data.agentId, {
                  isStreaming: false,
                  error: data.error,
                  messageId: data.messageId,
                  endTime: data.timestamp
                });
                const updatedState = { agentStreamingState: newStreamingState };

                // Flush any pending user messages since the AI response won't arrive
                const pending = state.pendingUserMessages.get(data.agentId);
                if (pending?.length > 0) {
                  const pendingIds = new Set(pending.map(m => m.id));
                  updatedState.messages = state.messages.map(m =>
                    pendingIds.has(m.id) ? { ...m, isPending: false } : m
                  );
                  const newPending = new Map(state.pendingUserMessages);
                  newPending.delete(data.agentId);
                  updatedState.pendingUserMessages = newPending;
                  console.log('⚠️ Flushed', pending.length, 'pending user message(s) after stream error');
                }

                return updatedState;
              });
              // Show error toast (deduplicated to prevent spam)
              dedupeToast.error(`Streaming error: ${data.error}`);
            }
            break;

          case 'stream_aborted':
            // Handle streaming aborted (user clicked stop)
            console.log('🛑 Stream aborted:', data);
            if (data.agentId) {
              // Discard buffered chunks on abort
              _streamChunkBuffers.delete(data.agentId);
              if (_streamChunkBuffers.size === 0 && _streamFlushTimer) {
                clearTimeout(_streamFlushTimer);
                _streamFlushTimer = null;
              }
              set(state => {
                const newStreamingState = new Map(state.agentStreamingState || new Map());
                // Clear streaming state - discard any partial content
                newStreamingState.set(data.agentId, {
                  isStreaming: false,
                  aborted: true,
                  reason: data.reason,
                  messageId: data.messageId,
                  endTime: data.timestamp
                });
                const updatedState = { agentStreamingState: newStreamingState };

                // Flush any pending user messages since the stream was aborted
                const pending = state.pendingUserMessages.get(data.agentId);
                if (pending?.length > 0) {
                  const pendingIds = new Set(pending.map(m => m.id));
                  updatedState.messages = state.messages.map(m =>
                    pendingIds.has(m.id) ? { ...m, isPending: false } : m
                  );
                  const newPending = new Map(state.pendingUserMessages);
                  newPending.delete(data.agentId);
                  updatedState.pendingUserMessages = newPending;
                  console.log('🛑 Flushed', pending.length, 'pending user message(s) after stream abort');
                }

                return updatedState;
              });
            }
            break;

          case 'model_error':
            // Handle model-related errors with suggestions for switching
            console.error('⚠️ Model error:', data);
            if (data.agentId && data.modelSuggestions) {
              // Discard buffered chunks on model error
              _streamChunkBuffers.delete(data.agentId);
              if (_streamChunkBuffers.size === 0 && _streamFlushTimer) {
                clearTimeout(_streamFlushTimer);
                _streamFlushTimer = null;
              }
              // Get agent name for display
              const errorAgent = get().agents.find(a => a.id === data.agentId);

              // Find the last user message so we can resend it after model switch
              const currentMessages = get().messages;
              const lastUserMessage = [...currentMessages].reverse().find(m => m.role === 'user');

              // Clear streaming state AND reset typing state
              set(state => {
                const newStreamingState = new Map(state.agentStreamingState || new Map());
                newStreamingState.set(data.agentId, {
                  isStreaming: false,
                  error: data.error,
                  messageId: data.messageId,
                  endTime: data.timestamp
                });

                const newTypingStatus = new Map(state.agentTypingStatus);
                newTypingStatus.set(data.agentId, false);

                const errorUpdatedState = {
                  agentStreamingState: newStreamingState,
                  agentTypingStatus: newTypingStatus,
                  isTyping: state.currentAgent?.id === data.agentId ? false : state.isTyping,
                  pendingModelError: {
                    agentId: data.agentId,
                    agentName: errorAgent?.name || 'Agent',
                    model: data.model,
                    errorType: data.modelSuggestions.errorType,
                    errorMessage: data.modelSuggestions.errorMessage || data.error,
                    suggestions: data.modelSuggestions.suggestions || [],
                    timestamp: data.timestamp,
                    failedUserMessage: lastUserMessage?.content || null,
                    failedContextReferences: lastUserMessage?.contextReferences || []
                  }
                };

                // Flush any pending user messages since the model errored
                const pendingMsgs = state.pendingUserMessages.get(data.agentId);
                if (pendingMsgs?.length > 0) {
                  const pendingIds = new Set(pendingMsgs.map(m => m.id));
                  errorUpdatedState.messages = state.messages.map(m =>
                    pendingIds.has(m.id) ? { ...m, isPending: false } : m
                  );
                  const newPending = new Map(state.pendingUserMessages);
                  newPending.delete(data.agentId);
                  errorUpdatedState.pendingUserMessages = newPending;
                }

                return errorUpdatedState;
              });
            } else {
              // Fallback to regular error toast if no suggestions (deduplicated)
              dedupeToast.error(`Model error: ${data.error}`);
            }
            break;

          case 'compaction_event':
            // Handle conversation compaction updates
            console.log('📦 Compaction event:', data);

            // Handle models exhausted notification
            if (data.type === 'compaction_models_exhausted') {
              console.warn('⚠️ All compaction models exhausted:', data);
              toast.error(
                data.message || 'Conversation compaction failed: All AI models are currently unavailable. Using simplified compaction.',
                { duration: 6000 }
              );
            }

            if (data.agentId) {
              const compactionState = {
                status: data.status,
                timestamp: data.timestamp || new Date().toISOString(),
                stats: {
                  originalTokens: data.originalTokens,
                  compactedTokens: data.compactedTokens,
                  reductionPercent: data.reductionPercent,
                  strategy: data.strategy,
                  executionTime: data.executionTime,
                  currentTokens: data.currentTokens,
                  contextWindow: data.contextWindow,
                  targetTokens: data.targetTokens,
                  model: data.model
                },
                error: data.error,
                modelsExhausted: data.type === 'compaction_models_exhausted'
              };

              set(state => {
                const newMap = new Map(state.agentCompactionStatus);
                newMap.set(data.agentId, compactionState);
                return { agentCompactionStatus: newMap };
              });

              // Auto-clear stale compaction status after terminal states
              // Prevents indicator from reappearing when navigating between agents
              if (data.status === 'completed' || data.status === 'failed') {
                setTimeout(() => {
                  set(state => {
                    const newMap = new Map(state.agentCompactionStatus);
                    newMap.delete(data.agentId);
                    return { agentCompactionStatus: newMap };
                  });
                }, 5000); // 5s = display time + fade + buffer
              }
            }
            break;

          case 'imageGenerated':
            // Handle image generation completion
            console.log('🖼️ Image generated:', data);

            if (data.success && data.agentId) {
              // Create a message to display the image in chat
              const imageMessage = {
                id: `image-${data.jobId || Date.now()}`,
                role: 'assistant',
                content: `Image generated: ${data.prompt}`,
                timestamp: data.timestamp || new Date().toISOString(),
                imageUrl: data.imageUrl,
                type: 'image-result',
                autonomous: true
              };

              // Add to current agent's messages if it matches
              if (data.agentId === get().currentAgent?.id) {
                set(state => ({
                  messages: [...state.messages, imageMessage]
                }));
              }
            } else if (!data.success) {
              // Handle error
              console.error('❌ Image generation failed:', data.error);

              const errorMessage = {
                id: `image-error-${data.jobId || Date.now()}`,
                role: 'system',
                content: `Image generation failed: ${data.error || 'Unknown error'}`,
                timestamp: data.timestamp || new Date().toISOString(),
                type: 'error'
              };

              if (data.agentId === get().currentAgent?.id) {
                set(state => ({
                  messages: [...state.messages, errorMessage]
                }));
              }
            }
            break;

          case 'agent_state_updated':
            // Canonical state broadcast from scheduler — mirrors whatever the
            // backend just mutated on the agent (mode, delayEndTime,
            // awaitingUserInput, stopRequested). Merge these into our agent
            // record so the UI stays honest when the scheduler forces the
            // agent back to CHAT or applies a rate-limit/network/builtin
            // delay. Minimal payload: only updates fields the event carried.
            if (data.agentId) {
              set(state => {
                const patch = {};
                if (data.mode !== undefined) patch.mode = data.mode;
                if (data.delayEndTime !== undefined) patch.delayEndTime = data.delayEndTime;
                if (data.awaitingUserInput !== undefined) patch.awaitingUserInput = data.awaitingUserInput;
                if (data.stopRequested !== undefined) patch.stopRequested = data.stopRequested;
                const newTypingStatus = new Map(state.agentTypingStatus);
                if (patch.mode === 'chat') newTypingStatus.set(data.agentId, false);
                return {
                  agents: state.agents.map(a => a.id === data.agentId ? { ...a, ...patch } : a),
                  currentAgent: state.currentAgent?.id === data.agentId
                    ? { ...state.currentAgent, ...patch }
                    : state.currentAgent,
                  agentTypingStatus: newTypingStatus,
                  isTyping: state.currentAgent?.id === data.agentId && patch.mode === 'chat'
                    ? false
                    : state.isTyping,
                };
              });
            }
            break;

          case 'agent_mode_changed':
            // Update agent mode in state
            if (data.agentId) {
              set(state => {
                // Clear typing status when mode changes to chat (e.g., after jobdone)
                const newTypingStatus = new Map(state.agentTypingStatus);
                if (data.mode === 'chat') {
                  newTypingStatus.set(data.agentId, false);
                }

                return {
                  agents: state.agents.map(agent =>
                    agent.id === data.agentId
                      ? {
                          ...agent,
                          mode: data.mode,
                          modeState: data.modeState || agent.modeState
                        }
                      : agent
                  ),
                  currentAgent: state.currentAgent?.id === data.agentId
                    ? {
                        ...state.currentAgent,
                        mode: data.mode,
                        modeState: data.modeState || state.currentAgent.modeState
                      }
                    : state.currentAgent,
                  agentTypingStatus: newTypingStatus,
                  // Clear legacy isTyping if this is the current agent
                  isTyping: state.currentAgent?.id === data.agentId && data.mode === 'chat'
                    ? false
                    : state.isTyping
                };
              });
            }
            break;

          case 'agent_timeout':
            // Handle AI service timeout - agent returned to chat mode
            console.warn('⏱️ Agent timeout:', data);

            // Show toast notification (deduplicated)
            dedupeToast.error('Request timed out. Try again when ready.');

            // Update agent to chat mode and clear typing status
            if (data.agentId) {
              set(state => {
                const newTypingStatus = new Map(state.agentTypingStatus);
                newTypingStatus.set(data.agentId, false);

                return {
                  agents: state.agents.map(agent =>
                    agent.id === data.agentId
                      ? { ...agent, mode: AGENT_MODES.CHAT, modeState: AGENT_MODE_STATES.IDLE }
                      : agent
                  ),
                  currentAgent: state.currentAgent?.id === data.agentId
                    ? { ...state.currentAgent, mode: AGENT_MODES.CHAT, modeState: AGENT_MODE_STATES.IDLE }
                    : state.currentAgent,
                  agentTypingStatus: newTypingStatus,
                  isTyping: state.currentAgent?.id === data.agentId ? false : state.isTyping
                };
              });
            }
            break;

          case 'agent_error':
            // Handle agent errors (including timeouts from scheduler)
            console.warn('❌ Agent error:', data);

            // Determine if it's a timeout error and show appropriate message (deduplicated)
            const isTimeoutError = data.error?.toLowerCase().includes('timeout');
            dedupeToast.error(
              isTimeoutError
                ? 'Request timed out. Try again when ready.'
                : (data.error || 'An error occurred')
            );

            // Update agent state and clear typing status
            if (data.agentId) {
              set(state => {
                const newTypingStatus = new Map(state.agentTypingStatus);
                newTypingStatus.set(data.agentId, false);

                return {
                  agents: state.agents.map(agent =>
                    agent.id === data.agentId
                      ? { ...agent, modeState: AGENT_MODE_STATES.IDLE }
                      : agent
                  ),
                  currentAgent: state.currentAgent?.id === data.agentId
                    ? { ...state.currentAgent, modeState: AGENT_MODE_STATES.IDLE }
                    : state.currentAgent,
                  agentTypingStatus: newTypingStatus,
                  isTyping: state.currentAgent?.id === data.agentId ? false : state.isTyping
                };
              });
            }
            break;

          case 'autonomous_update':
            // Handle real-time autonomous execution updates
            get().handleAutonomousUpdate(data);
            break;
            
          case 'agent_execution_stopped':
            // Handle agent execution stop
            if (data.agentId) {
              set(state => ({
                agents: state.agents.map(agent =>
                  agent.id === data.agentId
                    ? { ...agent, modeState: AGENT_MODE_STATES.STOPPED }
                    : agent
                ),
                currentAgent: state.currentAgent?.id === data.agentId
                  ? { ...state.currentAgent, modeState: AGENT_MODE_STATES.STOPPED }
                  : state.currentAgent
              }));
            }
            break;

          case 'visual_editor_cleanup':
            // Handle visual editor cleanup from backend (agent deleted/unloaded)
            console.log('🎯 Visual editor cleanup event:', data);
            if (data.agentId) {
              // Broadcast to close any open visual editor windows for this agent
              try {
                const channel = new BroadcastChannel('loxia-visual-editor');
                channel.postMessage({
                  type: 'editor-closed',
                  agentId: data.agentId,
                  reason: data.reason || 'agent_cleanup'
                });
                channel.close();
              } catch (error) {
                console.warn('Failed to broadcast visual editor cleanup:', error);
              }
            }
            break;

          case 'visual_editor_open': {
            // Delegates to a pure helper in utilities/visualEditorMessage.js
            // so the tricky decision logic (validate + always-stash) can be
            // regression-tested without instantiating the Zustand store.
            // See that file for the detailed rationale; in brief: stash
            // unconditionally, because the per-agent hook only applies the
            // request when the user lands on the matching agent, and the
            // previous "only stash if currentAgent matches" gate silently
            // dropped any broadcast that arrived while the user was
            // elsewhere.
            console.log('🎯 Visual editor open request:', data);
            const decision = processVisualEditorOpenMessage(data);
            if (decision.action === 'stash') {
              set({ visualEditorOpenRequest: decision.request });
              const currentAgentId = get().currentAgent?.id;
              if (decision.request.agentId !== currentAgentId) {
                console.log(
                  '🎯 Visual editor request stashed for later — current agent differs',
                  { requestAgentId: decision.request.agentId, currentAgentId }
                );
              }
            } else {
              console.warn('🎯 Visual editor open request ignored:', decision.reason, data);
            }
            break;
          }

          case 'credential_request':
            // Handle credential request from webTool authenticate action
            console.log('🔑 Credential request received:', data);
            if (data.requestId && data.siteId) {
              // Get agent name for display
              const requestingAgent = get().agents.find(a => a.id === data.agentId);
              set({
                pendingCredentialRequest: {
                  requestId: data.requestId,
                  siteId: data.siteId,
                  siteName: data.siteName || data.siteId,
                  agentId: data.agentId,
                  agentName: requestingAgent?.name || 'Unknown Agent',
                  fields: data.fields || ['username', 'password'],
                  loginUrl: data.loginUrl,
                  timeout: data.timeout // Timestamp when request expires
                }
              });
            }
            break;

          case 'credential_result':
            // Handle credential authentication result
            console.log('🔑 Credential result:', data);
            // Clear pending request if it matches
            if (data.requestId === get().pendingCredentialRequest?.requestId) {
              set({ pendingCredentialRequest: null });
            }
            // Show toast based on result
            if (data.success) {
              toast.success(`Successfully authenticated to ${data.siteName || data.siteId}`);
            } else {
              toast.error(`Authentication failed: ${data.error || 'Unknown error'}`);
            }
            break;

          case 'credential_timeout':
            // Handle credential request timeout
            console.log('🔑 Credential request timed out:', data);
            if (data.requestId === get().pendingCredentialRequest?.requestId) {
              set({ pendingCredentialRequest: null });
              toast.error('Credential request timed out');
            }
            break;

          case 'user_prompt_request':
            // Handle user prompt request from userPromptTool
            console.log('❓ User prompt request received:', data);
            if (data.requestId && data.questions) {
              // Get agent name for display
              const promptingAgent = get().agents.find(a => a.id === data.agentId);
              set({
                pendingUserPrompt: {
                  requestId: data.requestId,
                  agentId: data.agentId,
                  agentName: promptingAgent?.name || 'Agent',
                  message: data.message,
                  questions: data.questions,
                  timeoutAt: data.timeoutAt
                }
              });
            }
            break;

          case 'user_prompt_result':
            // Handle user prompt result
            console.log('❓ User prompt result:', data);
            if (data.requestId === get().pendingUserPrompt?.requestId) {
              set({ pendingUserPrompt: null });
            }
            break;

          case 'user_prompt_cancelled':
            // Handle user prompt cancellation
            console.log('❓ User prompt cancelled:', data);
            if (data.requestId === get().pendingUserPrompt?.requestId) {
              set({ pendingUserPrompt: null });
            }
            break;

          case 'agent_awaiting_input':
            // Handle agent waiting for user input notification
            console.log('⏳ Agent awaiting input:', data);
            // Could show a notification or update agent status in UI
            break;

          case 'agent_input_complete':
            // Handle agent input complete notification
            console.log('✅ Agent input complete:', data);
            // Could update agent status in UI
            break;

          // Flow events - forwarded to flowsStore
          case 'flow-created':
          case 'flow-updated':
          case 'flow-deleted':
          case 'flow-run-started':
          case 'flow-run-updated':
          case 'flow-run-stopped':
          case 'flow-run-completed':
          case 'flow-run-failed':
          case 'flow-node-complete':
          case 'flow_update': // FlowExecutor uses underscore format
          case 'flow_run_started':
          case 'flow_run_completed':
          case 'flow_run_failed':
          case 'flow_run_stopped':
          case 'flow_node_started':
          case 'flow_node_completed':
          case 'flow_node_failed':
          case 'flow_node_progress': // Real-time progress during agent execution
            // Forward to flowsStore for handling
            // Flow events have properties at top level (flow, run, flowId), not inside data
            console.log('🔄 Flow event:', type, message);
            try {
              // Dynamic import to avoid circular dependencies
              import('./flowsStore.js').then(({ useFlowsStore }) => {
                useFlowsStore.getState().handleFlowEvent(message);
              });
            } catch (e) {
              console.warn('Failed to handle flow event:', e);
            }
            break;

          case 'ollama_pull_progress':
          case 'ollama_pull_complete':
          case 'ollama_pull_error':
            // Forward Ollama pull events to Settings via custom DOM event
            window.dispatchEvent(new CustomEvent('ollama-pull', { detail: { type, ...data } }));
            break;

          default:
            console.log('Unknown WebSocket message type:', type, data);
        }
      }
      // Handle imageGenerated messages (properties at top level, no 'data' wrapper)
      else if (type === 'imageGenerated') {
        console.log('🖼️ Image generated:', message);

        if (message.success && message.agentId) {
          // Build message content with warnings if applicable
          let content = `Image generated: ${message.prompt}`;

          if (message.isTemporary) {
            content += '\n\n⚠️ **Warning:** Image is using a temporary URL (expires in ~1 hour). Failed to save to disk.';
            if (message.downloadError) {
              content += `\n**Error:** ${message.downloadError}`;
            }
          }

          // Create a message to display the image in chat
          const imageMessage = {
            id: `image-${message.jobId || Date.now()}`,
            role: 'assistant',
            content,
            timestamp: message.timestamp || new Date().toISOString(),
            imageUrl: message.imageUrl,
            type: 'image-result',
            autonomous: true,
            isTemporary: message.isTemporary || false,
            savedToDisk: message.savedToDisk !== false // Default to true if not specified
          };

          // Add to current agent's messages if it matches
          if (message.agentId === get().currentAgent?.id) {
            set(state => ({
              messages: [...state.messages, imageMessage]
            }));
          }
        } else if (!message.success) {
          // Handle error
          console.error('❌ Image generation failed:', message.error);

          const errorMessage = {
            id: `image-error-${message.jobId || Date.now()}`,
            role: 'system',
            content: `Image generation failed: ${message.error || 'Unknown error'}`,
            timestamp: message.timestamp || new Date().toISOString(),
            type: 'error'
          };

          if (message.agentId === get().currentAgent?.id) {
            set(state => ({
              messages: [...state.messages, errorMessage]
            }));
          }
        }
      }
      // Handle videoJobStatus messages (progress updates during generation)
      else if (type === 'videoJobStatus') {
        console.log('🎬 Video job status:', message);

        // Create a status update message
        if (message.agentId === get().currentAgent?.id) {
          const statusMessage = {
            id: `video-status-${message.jobId || Date.now()}`,
            role: 'system',
            content: `Video generation ${message.status}: ${message.message || ''}`,
            timestamp: message.timestamp || new Date().toISOString(),
            type: 'video-status',
            status: message.status
          };

          // Only add if status is significant (not just polling updates)
          if (message.status === 'processing' || message.status === 'failed') {
            set(state => ({
              messages: [...state.messages, statusMessage]
            }));
          }
        }
      }
      // Handle videoGenerated messages (completion)
      else if (type === 'videoGenerated') {
        console.log('🎬 Video generated:', message);

        if (message.success && message.agentId) {
          // Build message content with warnings if applicable
          let content = `Video generated: ${message.prompt}`;
          content += `\n\n📹 Duration: ${message.duration}s | Resolution: ${message.width}x${message.height}`;

          if (message.isTemporary) {
            content += '\n\n⚠️ **Warning:** Video is using a temporary URL (expires in ~24 hours). Failed to save to disk.';
          }

          // Create a message to display the video in chat
          const videoMessage = {
            id: `video-${message.jobId || Date.now()}`,
            role: 'assistant',
            content,
            timestamp: message.timestamp || new Date().toISOString(),
            videoUrl: message.videoUrl,
            type: 'video-result',
            autonomous: true,
            isTemporary: message.isTemporary || false,
            savedToDisk: message.savedToDisk !== false,
            width: message.width,
            height: message.height,
            duration: message.duration
          };

          // Add to current agent's messages if it matches
          if (message.agentId === get().currentAgent?.id) {
            set(state => ({
              messages: [...state.messages, videoMessage]
            }));
          }
        } else if (!message.success) {
          // Handle error
          console.error('❌ Video generation failed:', message.error);

          const errorMessage = {
            id: `video-error-${message.jobId || Date.now()}`,
            role: 'system',
            content: `Video generation failed: ${message.error || 'Unknown error'}`,
            timestamp: message.timestamp || new Date().toISOString(),
            type: 'error'
          };

          if (message.agentId === get().currentAgent?.id) {
            set(state => ({
              messages: [...state.messages, errorMessage]
            }));
          }
        }
      }
      // Handle direct autonomous update messages
      else if (type && ['message_added', 'iteration_started', 'execution_started', 'execution_completed', 'execution_stopped', 'execution_max_iterations'].includes(type)) {
        console.log('🔄 Processing direct autonomous update:', type, message);
        get().handleAutonomousUpdate(message);
      }
      // Handle messages with direct action structure
      else if (action) {
        switch (action) {
          case 'session_created':
            console.log('Session created:', message);
            break;
            
          case 'agent_updated':
            if (message.agentId && message.agent) {
              console.log('Agent updated via WebSocket:', message.agentId);
              set(state => {
                const updatedAgents = state.agents.map(agent =>
                  agent.id === message.agentId
                    ? { ...agent, ...message.agent }
                    : agent
                );

                // Also update currentAgent if it matches
                const updatedCurrentAgent = state.currentAgent?.id === message.agentId
                  ? { ...state.currentAgent, ...message.agent }
                  : state.currentAgent;

                console.log('Agents after update:', updatedAgents.length, 'agents');

                return {
                  agents: updatedAgents,
                  currentAgent: updatedCurrentAgent
                };
              });
            }
            break;

          case 'agent-loaded':
          case 'agent-imported':
            // Agent was loaded (e.g., from flow execution or team load)
            // Refresh the agents list so sidebar updates
            console.log(`Agent loaded/imported via WebSocket:`, message.agent?.id || message.agent?.name);
            get().refreshAgents();
            break;
            
          case 'agent-communication':
            // Handle inter-agent communication messages
            const commData = message.data;
            if (commData) {
              // Add the inter-agent message to the conversation
              const agentCommMessage = {
                id: `agent-comm-${commData.messageId}`,
                role: 'system',
                content: `📨 **Agent Communication**\n**From:** ${commData.sender.name}\n**To:** ${commData.recipients.map(r => r.name).join(', ')}\n**Subject:** ${commData.subject}\n**Message:** ${commData.content}`,
                timestamp: commData.timestamp,
                metadata: {
                  type: 'agent-communication',
                  eventType: commData.eventType,
                  priority: commData.priority,
                  requiresReply: commData.requiresReply,
                  conversationId: commData.conversationId,
                  depth: commData.metadata?.depth || 0
                }
              };
              
              set(state => ({
                messages: [...state.messages, agentCommMessage]
              }));
              
              // Store in a separate agent communications list for dedicated UI
              set(state => ({
                agentCommunications: [
                  ...(state.agentCommunications || []),
                  commData
                ]
              }));
            }
            break;
            
          default:
            console.log('Unknown WebSocket action:', action, message);
        }
      }
      // Handle other message formats
      else {
        console.log('WebSocket message (no type/action):', message);
      }
    },

    clearError: () => {
      set({ error: null });
    },

    clearVisualEditorRequest: () => {
      set({ visualEditorOpenRequest: null });
    },

    clearPendingCredentialRequest: () => {
      set({ pendingCredentialRequest: null });
    },

    clearPendingUserPrompt: () => {
      set({ pendingUserPrompt: null });
    },

    clearPendingModelError: () => {
      set({ pendingModelError: null });
    },

    // Handle switching to a suggested model after an error
    handleModelErrorSwitch: async (newModel) => {
      const { pendingModelError, updateAgent, sendMessage } = get();
      if (!pendingModelError) return;

      const failedMessage = pendingModelError.failedUserMessage;
      const failedRefs = pendingModelError.failedContextReferences || [];

      try {
        // Update the agent's model
        await updateAgent(pendingModelError.agentId, {
          preferredModel: newModel,
          currentModel: newModel
        });

        toast.success(`Switched to ${newModel}`);

        // Clear the error modal
        set({ pendingModelError: null });

        // Resend the failed message with the new model
        if (failedMessage) {
          console.log('🔄 Resending failed message with new model:', newModel);
          // Remove the duplicate user message that sendMessage will re-add
          // since the original user message is already in the messages array
          set(state => ({
            messages: state.messages.filter(m =>
              !(m.role === 'user' && m.content === failedMessage && m === state.messages[state.messages.length - 1])
            )
          }));
          await sendMessage(failedMessage, failedRefs);
        }
      } catch (error) {
        console.error('Failed to switch model:', error);
        toast.error(`Failed to switch model: ${error.message}`);
      }
    },

    clearMessages: async () => {
      const { currentAgent } = get();
      if (!currentAgent) {
        // Clear all messages if no current agent
        set({ messages: [], agentMessages: new Map() });
        return;
      }

      try {
        // Call backend API to clear conversation history
        const response = await api.clearConversation(currentAgent.id);
        console.log('✅ Conversation cleared on backend:', response);

        // Clear local state
        set(state => ({
          messages: [],
          agentMessages: new Map(state.agentMessages).set(currentAgent.id, [])
        }));

      } catch (error) {
        console.error('Failed to clear conversation:', error);
        // Still clear local state even if backend fails
        set(state => ({
          messages: [],
          agentMessages: new Map(state.agentMessages).set(currentAgent.id, [])
        }));
        throw error;
      }
    },

    // Stop message processing - stops any active agent execution
    stopMessageProcessing: async () => {
      const { currentAgent } = get();
      if (!currentAgent) {
        console.warn('No current agent to stop');
        return;
      }

      try {
        console.log('🛑 Stopping message processing for agent:', currentAgent.id);

        // Immediately reset isTyping for responsive UI BEFORE the API call
        set(state => {
          const newTypingStatus = new Map(state.agentTypingStatus);
          newTypingStatus.set(currentAgent.id, false);
          return {
            isTyping: false,
            agentTypingStatus: newTypingStatus
          };
        });

        const response = await api.stopAgentExecution(currentAgent.id);
        console.log('🛑 Stop response:', response);

        return response;
      } catch (error) {
        console.error('Failed to stop message processing:', error);
        // Still reset typing state even if API call fails
        set({ isTyping: false });
        throw error;
      }
    },

    clearAllMessages: () => {
      set({ messages: [], agentMessages: new Map() });
    },

    // Restore conversation history from backend
    restoreConversationHistory: async () => {
      try {
        const { sessionId, agents, projectDir } = get();
        if (!sessionId || !agents || agents.length === 0) return;

        const restoredAgentMessages = new Map();
        
        // Restore conversation history for each agent
        for (const agent of agents) {
          try {
            const response = await api.getAgentConversations(sessionId, agent.id, projectDir);
            if (response.success && response.data.conversations?.full?.messages) {
              // Clean up historical messages - filter internal messages and clear stale flags
              const cleanedMessages = response.data.conversations.full.messages
                .filter(msg => {
                  if (msg.type === 'scheduler-prompt') return false;
                  if (isInternalToolResultMessage(msg)) return false;
                  return true;
                })
                .map(msg => {
                  if (msg.pendingToolExecution) {
                    return { ...msg, pendingToolExecution: false };
                  }
                  return msg;
                });
              restoredAgentMessages.set(agent.id, cleanedMessages);
            }
          } catch (error) {
            console.warn(`Failed to restore conversations for agent ${agent.id}:`, error);
          }
        }

        // Update state with restored conversations
        set(state => ({
          agentMessages: restoredAgentMessages
        }));

        // Restore current agent and its messages if saved in localStorage
        const savedCurrentAgentId = localStorage.getItem('loxia-current-agent');
        if (savedCurrentAgentId) {
          const currentAgent = agents.find(a => a.id === savedCurrentAgentId);
          if (currentAgent) {
            const currentMessages = restoredAgentMessages.get(savedCurrentAgentId) || [];
            set({
              currentAgent,
              messages: currentMessages
            });
          }
        }

        console.log('Conversation history restored for', agents.length, 'agents');
      } catch (error) {
        console.error('Failed to restore conversation history:', error);
      }
    },

    // Utility actions
    getAgentById: (agentId) => {
      const { agents } = get();
      return agents.find(agent => agent.id === agentId);
    },

    getAgentStatus: (agent) => {
      if (!agent) return 'unknown';
      
      if (agent.status === 'paused' && agent.pausedUntil) {
        const pausedUntil = new Date(agent.pausedUntil);
        if (new Date() < pausedUntil) {
          return 'paused';
        }
      }
      
      return agent.status || 'idle';
    },

    // Settings management
    updateSettings: async (newSettings) => {
      try {
        const { sessionId } = get();

        // Defense-in-depth: strip any placeholder strings from incoming
        // settings before persisting. Real API keys never look like
        // bullet strings or "server-managed" sentinels, so silently
        // dropping them avoids overwriting good keys with display values.
        const sanitizedSettings = {
          ...newSettings,
          apiKeys: newSettings.apiKeys ? sanitizeApiKeysObject(newSettings.apiKeys) : newSettings.apiKeys,
        };

        // Save complete settings to localStorage for persistence (including API keys)
        localStorage.setItem('loxia-settings', JSON.stringify(sanitizedSettings));

        // Update app state based on relevant settings
        if (sanitizedSettings.theme) {
          const isDark = sanitizedSettings.theme === 'dark' ||
            (sanitizedSettings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

          set({ darkMode: isDark });

          if (isDark) {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        }

        // Send API keys to backend persistence. Only send fields the
        // user actually populated — empty values would clobber the
        // stored key with an empty string.
        if (sanitizedSettings.apiKeys) {
          const payload = { vendorKeys: {} };
          for (const vendor of ['openai', 'anthropic', 'gemini', 'xai']) {
            const v = sanitizedSettings.apiKeys[vendor];
            if (v && typeof v === 'string' && v.trim().length > 0) {
              payload.vendorKeys[vendor] = v;
            }
          }
          await api.setApiKeys(sessionId || null, payload);
        }

        return { success: true };
      } catch (error) {
        console.error('Failed to update settings:', error);
        throw error;
      }
    },

    // Auto-restore vendor API keys from localStorage on app startup,
    // forwarding them to the local backend so the AIService can use
    // them immediately. Empty / missing keys are skipped — they don't
    // overwrite anything backend-side.
    restoreApiKeysFromStorage: async () => {
      try {
        const { sessionId } = get();
        const savedSettings = localStorage.getItem('loxia-settings');
        if (!savedSettings) return;

        const parsedSettings = JSON.parse(savedSettings);
        if (!parsedSettings.apiKeys) return;

        const vendorKeys = {};
        for (const v of ['openai', 'anthropic', 'gemini', 'xai']) {
          const k = parsedSettings.apiKeys[v];
          if (typeof k === 'string' && k.trim().length > 0) vendorKeys[v] = k.trim();
        }
        if (Object.keys(vendorKeys).length === 0) return;

        await api.setApiKeys(sessionId || null, { vendorKeys });
        console.log('✅ Vendor API keys restored:', Object.keys(vendorKeys));
      } catch (error) {
        console.error('Failed to auto-restore API keys from localStorage:', error);
      }
    },

    // Version checking
    checkForUpdates: async () => {
      const currentVersion = get().versionInfo.currentVersion;

      // Skip if current version not yet loaded from backend
      if (!currentVersion) {
        return { success: false, error: 'Version not yet loaded' };
      }

      // Set checking state - use functional form to get fresh state
      set((state) => ({
        versionInfo: {
          ...state.versionInfo,
          checking: true,
          error: null
        }
      }));

      try {
        const result = await api.checkForUpdates(currentVersion);

        // Use functional form to get fresh state after async operation
        set((state) => ({
          versionInfo: {
            ...state.versionInfo,
            latestVersion: result.latestVersion,
            isUpToDate: result.isUpToDate,
            updateAvailable: result.updateAvailable,
            updateCommand: result.updateCommand || state.versionInfo.updateCommand,
            lastChecked: result.checkedAt,
            checking: false,
            error: result.success ? null : result.error
          }
        }));

        return result;
      } catch (error) {
        console.error('Version check failed:', error);
        // Use functional form to get fresh state
        set((state) => ({
          versionInfo: {
            ...state.versionInfo,
            checking: false,
            error: error.message
          }
        }));
        return { success: false, error: error.message };
      }
    },

    exportData: async () => {
      try {
        const { agents, agentMessages, sessionId, versionInfo } = get();
        const settings = JSON.parse(localStorage.getItem('loxia-settings') || '{}');

        const exportData = {
          version: versionInfo.currentVersion,
          exportDate: new Date().toISOString(),
          agents,
          conversations: Object.fromEntries(agentMessages),
          settings: {
            ...settings,
            // Don't export API keys for security
            apiKeys: undefined
          },
          sessionId
        };
        
        return exportData;
      } catch (error) {
        console.error('Failed to export data:', error);
        throw error;
      }
    },

    importData: async (data) => {
      try {
        if (data.agents) {
          set({ agents: data.agents });
        }
        
        if (data.conversations) {
          // Clean up imported messages - clear pendingToolExecution flags
          const cleanedConversations = new Map();
          for (const [agentId, messages] of Object.entries(data.conversations)) {
            const cleanedMessages = Array.isArray(messages)
              ? messages.map(msg => msg.pendingToolExecution ? { ...msg, pendingToolExecution: false } : msg)
              : messages;
            cleanedConversations.set(agentId, cleanedMessages);
          }
          set({ agentMessages: cleanedConversations });
        }
        
        if (data.settings) {
          localStorage.setItem('loxia-settings', JSON.stringify(data.settings));
        }
        
        return { success: true };
      } catch (error) {
        console.error('Failed to import data:', error);
        throw error;
      }
    },

    clearAllData: async () => {
      try {
        // Clear app state
        set({
          agents: [],
          currentAgent: null,
          messages: [],
          agentMessages: new Map(),
          sessionId: null
        });
        
        // Clear localStorage
        localStorage.removeItem('loxia-settings');
        localStorage.removeItem('loxia-current-agent');
        localStorage.removeItem('loxia-session-id');
        localStorage.removeItem('loxia-dark-mode');
        
        return { success: true };
      } catch (error) {
        console.error('Failed to clear data:', error);
        throw error;
      }
    },

    // Get model configuration by ID — searches the cloud + local
    // categories surfaced by modelsStore. Works against both the catalog
    // id (e.g. "gpt-4o") and the modelName field for loose coupling.
    getModelConfigById: (modelId) => {
      const categories = useModelsStore.getState().getModelsByCategory();

      const cloudModel = categories.cloud?.models.find(m => m.id === modelId)
        || categories.cloud?.models.find(m => m.modelName === modelId);
      if (cloudModel) {
        return { modelName: cloudModel.modelName, displayName: cloudModel.displayName };
      }

      const localModel = categories.local?.models.find(m => m.id === modelId)
        || categories.local?.models.find(m => m.modelName === modelId);
      if (localModel) {
        return { modelName: localModel.modelName, displayName: localModel.displayName };
      }

      return null;
    },

  }))
);

// Subscribe to agent changes and save current agent
useAppStore.subscribe(
  (state) => state.currentAgent,
  (currentAgent) => {
    if (currentAgent) {
      localStorage.setItem('loxia-current-agent', currentAgent.id);
    }
  }
);

// Subscribe to session changes and save session
useAppStore.subscribe(
  (state) => state.sessionId,
  (sessionId) => {
    if (sessionId) {
      localStorage.setItem('loxia-session-id', sessionId);
    }
  }
);