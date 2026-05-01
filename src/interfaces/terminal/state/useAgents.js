/**
 * Agent State Management Hook
 * React hook for managing agents - listing, creation, deletion, switching, and mode control
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { API_ENDPOINTS, AGENT_MODE, AGENT_STATUS } from '../config/constants.js';

/**
 * Agent state management hook
 * Manages agent list, current agent, and agent operations
 */
export function useAgents(sessionManager, messageRouter) {
  // Agent state
  const [agents, setAgents] = useState([]);
  const [currentAgentId, setCurrentAgentId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Cache for agent metadata
  const metadataCache = useRef(new Map());

  /**
   * Get current agent object
   */
  const currentAgent = agents.find(agent => agent.agentId === currentAgentId) || null;

  /**
   * Fetch available agents from server
   */
  const fetchAgents = useCallback(async () => {
    if (!sessionManager?.isValid()) {
      setError('Invalid session');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await sessionManager.makeRequest('GET', API_ENDPOINTS.AGENTS_AVAILABLE);

      if (response.success && response.agents) {
        setAgents(response.agents);

        // If no current agent and agents exist, select first LOADED agent
        // (archived agents need to be imported first)
        if (!currentAgentId && response.agents.length > 0) {
          const loadedAgent = response.agents.find(a => a.isLoaded);
          if (loadedAgent) {
            setCurrentAgentId(loadedAgent.agentId);
          }
          // If no loaded agents, don't auto-select - user needs to create or import one
        }

        return { success: true, agents: response.agents };
      }

      throw new Error(response.error || 'Failed to fetch agents');
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, [sessionManager, currentAgentId]);

  /**
   * Get agent metadata by ID
   */
  const getAgentMetadata = useCallback(async (agentId) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    // Check cache first
    if (metadataCache.current.has(agentId)) {
      return metadataCache.current.get(agentId);
    }

    try {
      const endpoint = API_ENDPOINTS.AGENTS_METADATA.replace(':agentId', agentId);
      const response = await sessionManager.makeRequest('GET', endpoint);

      if (response.success && response.metadata) {
        // Cache metadata
        metadataCache.current.set(agentId, response.metadata);
        return response.metadata;
      }

      throw new Error(response.error || 'Failed to get agent metadata');
    } catch (err) {
      throw new Error(`Failed to get metadata for agent ${agentId}: ${err.message}`);
    }
  }, [sessionManager]);

  /**
   * Create a new agent via orchestrator
   */
  const createAgent = useCallback(async (agentConfig) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    setLoading(true);
    setError(null);

    try {
      // Send create agent request via orchestrator
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.ORCHESTRATOR, {
        action: 'create_agent',
        payload: agentConfig,
        sessionId: sessionManager.getSessionId(),
      });

      console.log('[DEBUG useAgents.createAgent] Backend response:', JSON.stringify(response, null, 2));
      console.log('[DEBUG useAgents.createAgent] response.success:', response.success);
      console.log('[DEBUG useAgents.createAgent] response.data:', response.data);
      console.log('[DEBUG useAgents.createAgent] response.error:', response.error);

      // Backend returns agent in "data" field, not "agent" field
      const agent = response.data || response.agent;

      if (response.success && agent) {
        // Add new agent to list
        setAgents(prev => [...prev, agent]);

        // Optionally switch to new agent
        if (agentConfig.switchTo !== false) {
          setCurrentAgentId(agent.agentId);
        }

        return { success: true, agent: agent };
      }

      throw new Error(response.error || 'Failed to create agent');
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [sessionManager]);

  /**
   * Delete an agent
   */
  const deleteAgent = useCallback(async (agentId) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    setLoading(true);
    setError(null);

    try {
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.ORCHESTRATOR, {
        action: 'delete_agent',
        payload: { agentId },
        sessionId: sessionManager.getSessionId(),
      });

      if (response.success) {
        // Remove agent from list
        setAgents(prev => prev.filter(agent => agent.agentId !== agentId));

        // If deleted agent was current, switch to another
        if (currentAgentId === agentId) {
          const remainingAgents = agents.filter(agent => agent.agentId !== agentId);
          setCurrentAgentId(remainingAgents.length > 0 ? remainingAgents[0].agentId : null);
        }

        // Clear metadata cache
        metadataCache.current.delete(agentId);

        return { success: true };
      }

      throw new Error(response.error || 'Failed to delete agent');
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [sessionManager, currentAgentId, agents]);

  /**
   * Switch to a different agent
   * Auto-imports archived agents if needed
   */
  const switchAgent = useCallback(async (agentId) => {
    const agent = agents.find(a => a.agentId === agentId);
    if (!agent) {
      setError(`Agent ${agentId} not found`);
      return { success: false, error: 'Agent not found' };
    }

    // If agent is not loaded (archived), import it first
    if (!agent.isLoaded && agent.canImport) {
      try {
        setLoading(true);
        const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.AGENTS_IMPORT, { agentId });

        if (response.success && response.agent) {
          // Update the agent in our list to mark as loaded
          setAgents(prev => prev.map(a =>
            a.agentId === agentId ? { ...a, ...response.agent, isLoaded: true, canImport: false } : a
          ));
        } else {
          setError(response.error || 'Failed to import agent');
          return { success: false, error: response.error || 'Failed to import agent' };
        }
      } catch (err) {
        setError(`Failed to import agent: ${err.message}`);
        return { success: false, error: err.message };
      } finally {
        setLoading(false);
      }
    }

    setCurrentAgentId(agentId);
    setError(null);

    return { success: true, agent };
  }, [agents, sessionManager]);

  /**
   * Get agent mode (CHAT or AGENT)
   */
  const getAgentMode = useCallback(async (agentId) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    try {
      const endpoint = API_ENDPOINTS.AGENTS_MODE_GET.replace(':agentId', agentId);
      const response = await sessionManager.makeRequest('GET', endpoint);

      if (response.success) {
        return { success: true, mode: response.mode };
      }

      throw new Error(response.error || 'Failed to get agent mode');
    } catch (err) {
      throw new Error(`Failed to get mode for agent ${agentId}: ${err.message}`);
    }
  }, [sessionManager]);

  /**
   * Set agent mode (CHAT or AGENT)
   */
  const setAgentMode = useCallback(async (agentId, mode) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    // Validate mode
    if (mode !== AGENT_MODE.CHAT && mode !== AGENT_MODE.AGENT) {
      throw new Error(`Invalid mode: ${mode}. Must be CHAT or AGENT`);
    }

    setLoading(true);
    setError(null);

    try {
      const endpoint = API_ENDPOINTS.AGENTS_MODE_SET.replace(':agentId', agentId);
      const response = await sessionManager.makeRequest('POST', endpoint, { mode });

      if (response.success) {
        // Update agent in list
        setAgents(prev => prev.map(agent =>
          agent.agentId === agentId ? { ...agent, mode } : agent
        ));

        return { success: true, mode: response.mode };
      }

      throw new Error(response.error || 'Failed to set agent mode');
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [sessionManager]);

  /**
   * Stop agent execution
   */
  const stopAgent = useCallback(async (agentId) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    setLoading(true);
    setError(null);

    try {
      const endpoint = API_ENDPOINTS.AGENTS_STOP.replace(':agentId', agentId);
      const response = await sessionManager.makeRequest('POST', endpoint);

      if (response.success) {
        return { success: true };
      }

      throw new Error(response.error || 'Failed to stop agent');
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [sessionManager]);

  /**
   * Import an agent
   */
  const importAgent = useCallback(async (importData) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    setLoading(true);
    setError(null);

    try {
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.AGENTS_IMPORT, importData);

      if (response.success && response.agent) {
        // Add imported agent to list
        setAgents(prev => [...prev, response.agent]);

        return { success: true, agent: response.agent };
      }

      throw new Error(response.error || 'Failed to import agent');
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [sessionManager]);

  /**
   * Update agent configuration via orchestrator
   */
  const updateAgentConfig = useCallback(async (agentId, updates) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    setLoading(true);
    setError(null);

    try {
      // Send update agent request via orchestrator
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.ORCHESTRATOR, {
        action: 'update_agent',
        payload: { agentId, updates },
        sessionId: sessionManager.getSessionId(),
      });

      if (response.success && response.data) {
        // Update agent in local list
        setAgents(prev => prev.map(agent =>
          agent.agentId === agentId ? { ...agent, ...updates } : agent
        ));

        // Clear metadata cache for this agent
        metadataCache.current.delete(agentId);

        return { success: true, agent: response.data };
      }

      throw new Error(response.error || 'Failed to update agent');
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [sessionManager]);

  /**
   * Update agent in list (from WebSocket events)
   */
  const updateAgent = useCallback((agentId, updates) => {
    setAgents(prev => prev.map(agent =>
      agent.agentId === agentId ? { ...agent, ...updates } : agent
    ));
  }, []);

  /**
   * Get agent by ID
   */
  const getAgent = useCallback((agentId) => {
    return agents.find(agent => agent.agentId === agentId) || null;
  }, [agents]);

  /**
   * Get agents by status
   */
  const getAgentsByStatus = useCallback((status) => {
    return agents.filter(agent => agent.status === status);
  }, [agents]);

  /**
   * Get active agents
   */
  const getActiveAgents = useCallback(() => {
    return getAgentsByStatus(AGENT_STATUS.ACTIVE);
  }, [getAgentsByStatus]);

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Refresh agent list
   */
  const refresh = useCallback(async () => {
    return fetchAgents();
  }, [fetchAgents]);

  // Set up WebSocket message listeners for agent events
  useEffect(() => {
    if (!messageRouter) return;

    // Agent mode changed
    const handleModeChanged = (message) => {
      if (message.agentId && message.mode) {
        updateAgent(message.agentId, { mode: message.mode });
      }
    };

    // Agent imported
    const handleAgentImported = (agent) => {
      setAgents(prev => {
        // Check if already exists
        if (prev.find(a => a.agentId === agent.agentId)) {
          return prev;
        }
        return [...prev, agent];
      });
    };

    // Agent error
    const handleAgentError = (message) => {
      if (message.agentId) {
        updateAgent(message.agentId, { status: AGENT_STATUS.ERROR, error: message.error });
      }
    };

    messageRouter.on('agent:mode_changed', handleModeChanged);
    messageRouter.on('agent:imported', handleAgentImported);
    messageRouter.on('agent:error', handleAgentError);

    return () => {
      messageRouter.off('agent:mode_changed', handleModeChanged);
      messageRouter.off('agent:imported', handleAgentImported);
      messageRouter.off('agent:error', handleAgentError);
    };
  }, [messageRouter, updateAgent]);

  // Auto-fetch agents on mount
  useEffect(() => {
    if (sessionManager?.isValid()) {
      fetchAgents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionManager?.isValid]);

  // Return hook interface
  return useMemo(() => ({
    // State
    agents,
    currentAgent,
    currentAgentId,
    loading,
    error,

    // Operations
    fetchAgents,
    createAgent,
    deleteAgent,
    switchAgent,
    importAgent,
    stopAgent,
    updateAgentConfig,

    // Mode control
    getAgentMode,
    setAgentMode,

    // Metadata
    getAgentMetadata,

    // Helpers
    getAgent,
    getAgentsByStatus,
    getActiveAgents,
    updateAgent,

    // Utilities
    clearError,
    refresh,
  }), [
    agents,
    currentAgent,
    currentAgentId,
    loading,
    error,
    fetchAgents,
    createAgent,
    deleteAgent,
    switchAgent,
    importAgent,
    stopAgent,
    updateAgentConfig,
    getAgentMode,
    setAgentMode,
    getAgentMetadata,
    getAgent,
    getAgentsByStatus,
    getActiveAgents,
    updateAgent,
    clearError,
    refresh,
  ]);
}

export default useAgents;
