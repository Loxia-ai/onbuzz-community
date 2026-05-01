/**
 * Agent Control State Management Hook
 * React hook for managing agent mode, model selection, and configuration
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { API_ENDPOINTS, AGENT_MODE, MODEL_CATEGORY } from '../config/constants.js';

/**
 * Agent control state management hook
 * Manages mode switching, model selection, and agent configuration
 */
export function useAgentControl(sessionManager, messageRouter, currentAgent) {
  // Mode state
  const [currentMode, setCurrentMode] = useState(AGENT_MODE.CHAT);
  const [modeLoading, setModeLoading] = useState(false);
  const [modeError, setModeError] = useState(null);

  // Model state
  const [currentModel, setCurrentModel] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);

  // Configuration state
  const [config, setConfig] = useState({});
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState(null);

  // Model cache
  const modelsCache = useRef(null);
  const modelsCacheTimestamp = useRef(0);
  const CACHE_TTL = 300000; // 5 minutes

  /**
   * Fetch available LLM models
   */
  const fetchModels = useCallback(async (options = {}) => {
    if (!sessionManager?.isValid()) {
      setModelsError('Invalid session');
      return { success: false, error: 'Invalid session' };
    }

    const { forceRefresh = false } = options;

    // Check cache
    const now = Date.now();
    if (!forceRefresh && modelsCache.current && (now - modelsCacheTimestamp.current) < CACHE_TTL) {
      setAvailableModels(modelsCache.current);
      return { success: true, models: modelsCache.current, cached: true };
    }

    setModelsLoading(true);
    setModelsError(null);

    try {
      const response = await sessionManager.makeRequest('GET', API_ENDPOINTS.LLM_MODELS);

      if (response.success && response.models) {
        // Cache models
        modelsCache.current = response.models;
        modelsCacheTimestamp.current = now;

        setAvailableModels(response.models);
        return { success: true, models: response.models };
      }

      throw new Error(response.error || 'Failed to fetch models');
    } catch (err) {
      setModelsError(err.message);
      return { success: false, error: err.message };
    } finally {
      setModelsLoading(false);
    }
  }, [sessionManager]);

  /**
   * Set agent model via orchestrator
   */
  const setModel = useCallback(async (agentId, modelId) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    if (!modelId) {
      throw new Error('Model ID is required');
    }

    setModelsLoading(true);
    setModelsError(null);

    try {
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.ORCHESTRATOR, {
        action: 'set_agent_model',
        payload: {
          agentId,
          modelId,
        },
        sessionId: sessionManager.getSessionId(),
      });

      if (response.success) {
        setCurrentModel(modelId);
        return { success: true, modelId };
      }

      throw new Error(response.error || 'Failed to set model');
    } catch (err) {
      setModelsError(err.message);
      throw err;
    } finally {
      setModelsLoading(false);
    }
  }, [sessionManager]);

  /**
   * Get agent current model
   */
  const getModel = useCallback(async (agentId) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    try {
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.ORCHESTRATOR, {
        action: 'get_agent_model',
        payload: { agentId },
        sessionId: sessionManager.getSessionId(),
      });

      if (response.success && response.modelId) {
        setCurrentModel(response.modelId);
        return { success: true, modelId: response.modelId };
      }

      throw new Error(response.error || 'Failed to get model');
    } catch (err) {
      throw new Error(`Failed to get model for agent ${agentId}: ${err.message}`);
    }
  }, [sessionManager]);

  /**
   * Switch agent mode (CHAT <-> AGENT)
   */
  const switchMode = useCallback(async (agentId, newMode) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    // Validate mode
    if (newMode !== AGENT_MODE.CHAT && newMode !== AGENT_MODE.AGENT) {
      throw new Error(`Invalid mode: ${newMode}. Must be CHAT or AGENT`);
    }

    setModeLoading(true);
    setModeError(null);

    try {
      const endpoint = API_ENDPOINTS.AGENTS_MODE_SET.replace(':agentId', agentId);
      const response = await sessionManager.makeRequest('POST', endpoint, { mode: newMode });

      if (response.success) {
        setCurrentMode(newMode);
        return { success: true, mode: newMode };
      }

      throw new Error(response.error || 'Failed to switch mode');
    } catch (err) {
      setModeError(err.message);
      throw err;
    } finally {
      setModeLoading(false);
    }
  }, [sessionManager]);

  /**
   * Toggle mode between CHAT and AGENT
   */
  const toggleMode = useCallback(async (agentId) => {
    const newMode = currentMode === AGENT_MODE.CHAT ? AGENT_MODE.AGENT : AGENT_MODE.CHAT;
    return switchMode(agentId, newMode);
  }, [currentMode, switchMode]);

  /**
   * Get agent current mode
   */
  const getMode = useCallback(async (agentId) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    setModeLoading(true);
    setModeError(null);

    try {
      const endpoint = API_ENDPOINTS.AGENTS_MODE_GET.replace(':agentId', agentId);
      const response = await sessionManager.makeRequest('GET', endpoint);

      if (response.success && response.mode) {
        setCurrentMode(response.mode);
        return { success: true, mode: response.mode };
      }

      throw new Error(response.error || 'Failed to get mode');
    } catch (err) {
      setModeError(err.message);
      throw err;
    } finally {
      setModeLoading(false);
    }
  }, [sessionManager]);

  /**
   * Update agent configuration
   */
  const updateConfig = useCallback(async (agentId, updates) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    setConfigLoading(true);
    setConfigError(null);

    try {
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.ORCHESTRATOR, {
        action: 'update_agent_config',
        payload: {
          agentId,
          config: updates,
        },
        sessionId: sessionManager.getSessionId(),
      });

      if (response.success) {
        setConfig(prev => ({ ...prev, ...updates }));
        return { success: true, config: updates };
      }

      throw new Error(response.error || 'Failed to update config');
    } catch (err) {
      setConfigError(err.message);
      throw err;
    } finally {
      setConfigLoading(false);
    }
  }, [sessionManager]);

  /**
   * Get agent configuration
   */
  const getConfig = useCallback(async (agentId) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    setConfigLoading(true);
    setConfigError(null);

    try {
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.ORCHESTRATOR, {
        action: 'get_agent_config',
        payload: { agentId },
        sessionId: sessionManager.getSessionId(),
      });

      if (response.success && response.config) {
        setConfig(response.config);
        return { success: true, config: response.config };
      }

      throw new Error(response.error || 'Failed to get config');
    } catch (err) {
      setConfigError(err.message);
      throw err;
    } finally {
      setConfigLoading(false);
    }
  }, [sessionManager]);

  /**
   * Get models by category
   */
  const getModelsByCategory = useCallback((category) => {
    return availableModels.filter(model => model.category === category);
  }, [availableModels]);

  /**
   * Get Anthropic models
   */
  const getAnthropicModels = useCallback(() => {
    return getModelsByCategory(MODEL_CATEGORY.ANTHROPIC);
  }, [getModelsByCategory]);

  /**
   * Get OpenAI models
   */
  const getOpenAIModels = useCallback(() => {
    return getModelsByCategory(MODEL_CATEGORY.OPENAI);
  }, [getModelsByCategory]);

  /**
   * Get model by ID
   */
  const getModelById = useCallback((modelId) => {
    return availableModels.find(model => model.id === modelId) || null;
  }, [availableModels]);

  /**
   * Check if model is available
   */
  const isModelAvailable = useCallback((modelId) => {
    return availableModels.some(model => model.id === modelId);
  }, [availableModels]);

  /**
   * Clear errors
   */
  const clearModeError = useCallback(() => {
    setModeError(null);
  }, []);

  const clearModelsError = useCallback(() => {
    setModelsError(null);
  }, []);

  const clearConfigError = useCallback(() => {
    setConfigError(null);
  }, []);

  const clearAllErrors = useCallback(() => {
    setModeError(null);
    setModelsError(null);
    setConfigError(null);
  }, []);

  // Set up WebSocket message listeners for mode changes
  useEffect(() => {
    if (!messageRouter) return;

    // Agent mode changed
    const handleModeChanged = (data) => {
      if (data.agentId === currentAgent?.agentId && data.mode) {
        setCurrentMode(data.mode);
      }
    };

    // Model changed
    const handleModelChanged = (data) => {
      if (data.agentId === currentAgent?.agentId && data.modelId) {
        setCurrentModel(data.modelId);
      }
    };

    messageRouter.on('agent:mode_changed', handleModeChanged);
    messageRouter.on('agent:model_changed', handleModelChanged);

    return () => {
      messageRouter.off('agent:mode_changed', handleModeChanged);
      messageRouter.off('agent:model_changed', handleModelChanged);
    };
  }, [messageRouter, currentAgent]);

  // Load mode and model when current agent changes
  useEffect(() => {
    if (!currentAgent?.agentId) {
      setCurrentMode(AGENT_MODE.CHAT);
      setCurrentModel(null);
      setConfig({});
      return;
    }

    // Fetch mode
    getMode(currentAgent.agentId).catch(() => {
      // Ignore error, will use default
    });

    // Fetch model
    getModel(currentAgent.agentId).catch(() => {
      // Ignore error, will use default
    });

    // Fetch config
    getConfig(currentAgent.agentId).catch(() => {
      // Ignore error, will use default
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAgent?.agentId]);

  // Auto-fetch models on mount
  useEffect(() => {
    if (sessionManager?.isValid() && availableModels.length === 0) {
      fetchModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionManager?.isValid, availableModels.length]);

  // Return hook interface
  return useMemo(() => ({
    // Mode state
    currentMode,
    modeLoading,
    modeError,

    // Model state
    currentModel,
    availableModels,
    modelsLoading,
    modelsError,

    // Configuration state
    config,
    configLoading,
    configError,

    // Mode operations
    switchMode,
    toggleMode,
    getMode,

    // Model operations
    setModel,
    getModel,
    fetchModels,

    // Configuration operations
    updateConfig,
    getConfig,

    // Model queries
    getModelsByCategory,
    getAnthropicModels,
    getOpenAIModels,
    getModelById,
    isModelAvailable,

    // Utilities
    clearModeError,
    clearModelsError,
    clearConfigError,
    clearAllErrors,
  }), [
    currentMode,
    modeLoading,
    modeError,
    currentModel,
    availableModels,
    modelsLoading,
    modelsError,
    config,
    configLoading,
    configError,
    switchMode,
    toggleMode,
    getMode,
    setModel,
    getModel,
    fetchModels,
    updateConfig,
    getConfig,
    getModelsByCategory,
    getAnthropicModels,
    getOpenAIModels,
    getModelById,
    isModelAvailable,
    clearModeError,
    clearModelsError,
    clearConfigError,
    clearAllErrors,
  ]);
}

export default useAgentControl;
