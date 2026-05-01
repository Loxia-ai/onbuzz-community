/**
 * Tools State Management Hook
 * React hook for managing tools - listing, categorization, execution state, and capabilities
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { API_ENDPOINTS, TOOL_CATEGORY } from '../config/constants.js';

/**
 * Tools state management hook
 * Manages tool listing, categorization, execution tracking, and capabilities
 */
export function useTools(sessionManager, messageRouter, currentAgentId) {
  // Tool state
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Execution state
  const [executingTools, setExecutingTools] = useState(new Set());
  const [toolResults, setToolResults] = useState(new Map());

  // Tool cache
  const toolsCache = useRef(null);
  const toolsCacheTimestamp = useRef(0);
  const CACHE_TTL = 600000; // 10 minutes

  /**
   * Fetch available tools
   */
  const fetchTools = useCallback(async (options = {}) => {
    if (!sessionManager?.isValid()) {
      setError('Invalid session');
      return { success: false, error: 'Invalid session' };
    }

    const { forceRefresh = false } = options;

    // Check cache
    const now = Date.now();
    if (!forceRefresh && toolsCache.current && (now - toolsCacheTimestamp.current) < CACHE_TTL) {
      setTools(toolsCache.current);
      return { success: true, tools: toolsCache.current, cached: true };
    }

    setLoading(true);
    setError(null);

    try {
      const response = await sessionManager.makeRequest('GET', API_ENDPOINTS.TOOLS);

      if (response.success && response.tools) {
        // Cache tools
        toolsCache.current = response.tools;
        toolsCacheTimestamp.current = now;

        setTools(response.tools);
        return { success: true, tools: response.tools };
      }

      throw new Error(response.error || 'Failed to fetch tools');
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, [sessionManager]);

  /**
   * Get tool by name
   */
  const getToolByName = useCallback((toolName) => {
    return tools.find(tool => tool.name === toolName) || null;
  }, [tools]);

  /**
   * Get tools by category
   */
  const getToolsByCategory = useCallback((category) => {
    return tools.filter(tool => tool.category === category);
  }, [tools]);

  /**
   * Get system tools
   */
  const getSystemTools = useCallback(() => {
    return getToolsByCategory(TOOL_CATEGORY.SYSTEM);
  }, [getToolsByCategory]);

  /**
   * Get automation tools
   */
  const getAutomationTools = useCallback(() => {
    return getToolsByCategory(TOOL_CATEGORY.AUTOMATION);
  }, [getToolsByCategory]);

  /**
   * Get analysis tools
   */
  const getAnalysisTools = useCallback(() => {
    return getToolsByCategory(TOOL_CATEGORY.ANALYSIS);
  }, [getToolsByCategory]);

  /**
   * Get utility tools
   */
  const getUtilityTools = useCallback(() => {
    return getToolsByCategory(TOOL_CATEGORY.UTILITY);
  }, [getToolsByCategory]);

  /**
   * Get collaboration tools
   */
  const getCollaborationTools = useCallback(() => {
    return getToolsByCategory(TOOL_CATEGORY.COLLABORATION);
  }, [getToolsByCategory]);

  /**
   * Get AI tools
   */
  const getAITools = useCallback(() => {
    return getToolsByCategory(TOOL_CATEGORY.AI);
  }, [getToolsByCategory]);

  /**
   * Check if tool is available
   */
  const isToolAvailable = useCallback((toolName) => {
    return tools.some(tool => tool.name === toolName);
  }, [tools]);

  /**
   * Check if tool is executing
   */
  const isToolExecuting = useCallback((toolName) => {
    return executingTools.has(toolName);
  }, [executingTools]);

  /**
   * Get tool result
   */
  const getToolResult = useCallback((executionId) => {
    return toolResults.get(executionId) || null;
  }, [toolResults]);

  /**
   * Execute a tool
   */
  const executeTool = useCallback(async (toolName, parameters = {}) => {
    if (!sessionManager?.isValid() || !currentAgentId) {
      throw new Error('Invalid session or no agent selected');
    }

    if (!toolName) {
      throw new Error('Tool name is required');
    }

    // Check if tool exists
    const tool = getToolByName(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    // Mark as executing
    setExecutingTools(prev => new Set(prev).add(toolName));
    setError(null);

    try {
      // Execute via orchestrator
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.ORCHESTRATOR, {
        action: 'execute_tool',
        payload: {
          agentId: currentAgentId,
          toolName,
          parameters,
        },
        sessionId: sessionManager.getSessionId(),
      });

      if (response.success) {
        // Store result
        const executionId = response.executionId || `${toolName}-${Date.now()}`;
        setToolResults(prev => new Map(prev).set(executionId, response.result));

        return {
          success: true,
          executionId,
          result: response.result,
        };
      }

      throw new Error(response.error || 'Failed to execute tool');
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      // Remove from executing set
      setExecutingTools(prev => {
        const next = new Set(prev);
        next.delete(toolName);
        return next;
      });
    }
  }, [sessionManager, currentAgentId, getToolByName]);

  /**
   * Get tool capabilities
   */
  const getToolCapabilities = useCallback(async (toolName) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    if (!toolName) {
      throw new Error('Tool name is required');
    }

    try {
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.ORCHESTRATOR, {
        action: 'get_tool_capabilities',
        payload: { toolName },
        sessionId: sessionManager.getSessionId(),
      });

      if (response.success && response.capabilities) {
        return { success: true, capabilities: response.capabilities };
      }

      throw new Error(response.error || 'Failed to get tool capabilities');
    } catch (err) {
      throw new Error(`Failed to get capabilities for ${toolName}: ${err.message}`);
    }
  }, [sessionManager]);

  /**
   * Enable tool for agent
   */
  const enableTool = useCallback(async (agentId, toolName) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    if (!toolName) {
      throw new Error('Tool name is required');
    }

    try {
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.ORCHESTRATOR, {
        action: 'enable_tool',
        payload: {
          agentId,
          toolName,
        },
        sessionId: sessionManager.getSessionId(),
      });

      if (response.success) {
        return { success: true };
      }

      throw new Error(response.error || 'Failed to enable tool');
    } catch (err) {
      throw new Error(`Failed to enable ${toolName}: ${err.message}`);
    }
  }, [sessionManager]);

  /**
   * Disable tool for agent
   */
  const disableTool = useCallback(async (agentId, toolName) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    if (!toolName) {
      throw new Error('Tool name is required');
    }

    try {
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.ORCHESTRATOR, {
        action: 'disable_tool',
        payload: {
          agentId,
          toolName,
        },
        sessionId: sessionManager.getSessionId(),
      });

      if (response.success) {
        return { success: true };
      }

      throw new Error(response.error || 'Failed to disable tool');
    } catch (err) {
      throw new Error(`Failed to disable ${toolName}: ${err.message}`);
    }
  }, [sessionManager]);

  /**
   * Get enabled tools for agent
   */
  const getEnabledTools = useCallback(async (agentId) => {
    if (!sessionManager?.isValid()) {
      throw new Error('Invalid session');
    }

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    try {
      const response = await sessionManager.makeRequest('POST', API_ENDPOINTS.ORCHESTRATOR, {
        action: 'get_enabled_tools',
        payload: { agentId },
        sessionId: sessionManager.getSessionId(),
      });

      if (response.success && response.tools) {
        return { success: true, tools: response.tools };
      }

      throw new Error(response.error || 'Failed to get enabled tools');
    } catch (err) {
      throw new Error(`Failed to get enabled tools: ${err.message}`);
    }
  }, [sessionManager]);

  /**
   * Get all categories with tool counts
   */
  const getCategoryCounts = useCallback(() => {
    const counts = {};

    for (const category of Object.values(TOOL_CATEGORY)) {
      counts[category] = tools.filter(t => t.category === category).length;
    }

    return counts;
  }, [tools]);

  /**
   * Search tools by name or description
   */
  const searchTools = useCallback((query) => {
    if (!query || query.trim().length === 0) {
      return tools;
    }

    const lowerQuery = query.toLowerCase();
    return tools.filter(tool =>
      tool.name?.toLowerCase().includes(lowerQuery) ||
      tool.description?.toLowerCase().includes(lowerQuery)
    );
  }, [tools]);

  /**
   * Filter tools by multiple criteria
   */
  const filterTools = useCallback((criteria = {}) => {
    let filtered = [...tools];

    if (criteria.category) {
      filtered = filtered.filter(t => t.category === criteria.category);
    }

    if (criteria.enabled !== undefined) {
      filtered = filtered.filter(t => t.enabled === criteria.enabled);
    }

    if (criteria.query) {
      const lowerQuery = criteria.query.toLowerCase();
      filtered = filtered.filter(t =>
        t.name?.toLowerCase().includes(lowerQuery) ||
        t.description?.toLowerCase().includes(lowerQuery)
      );
    }

    return filtered;
  }, [tools]);

  /**
   * Clear tool result
   */
  const clearToolResult = useCallback((executionId) => {
    setToolResults(prev => {
      const next = new Map(prev);
      next.delete(executionId);
      return next;
    });
  }, []);

  /**
   * Clear all tool results
   */
  const clearAllToolResults = useCallback(() => {
    setToolResults(new Map());
  }, []);

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Refresh tool list
   */
  const refresh = useCallback(async () => {
    return fetchTools({ forceRefresh: true });
  }, [fetchTools]);

  // Set up WebSocket listeners for tool events
  useEffect(() => {
    if (!messageRouter) return;

    // Tool execution started
    const handleToolExecutionStarted = (data) => {
      if (data.agentId === currentAgentId && data.toolName) {
        setExecutingTools(prev => new Set(prev).add(data.toolName));
      }
    };

    // Tool execution completed
    const handleToolExecutionCompleted = (data) => {
      if (data.agentId === currentAgentId && data.toolName) {
        setExecutingTools(prev => {
          const next = new Set(prev);
          next.delete(data.toolName);
          return next;
        });

        if (data.executionId && data.result) {
          setToolResults(prev => new Map(prev).set(data.executionId, data.result));
        }
      }
    };

    // Tool enabled/disabled
    const handleToolStateChanged = (data) => {
      if (data.agentId === currentAgentId) {
        // Refresh tool list to get updated enabled state
        refresh();
      }
    };

    messageRouter.on('tool:execution_started', handleToolExecutionStarted);
    messageRouter.on('tool:execution_completed', handleToolExecutionCompleted);
    messageRouter.on('tool:state_changed', handleToolStateChanged);

    return () => {
      messageRouter.off('tool:execution_started', handleToolExecutionStarted);
      messageRouter.off('tool:execution_completed', handleToolExecutionCompleted);
      messageRouter.off('tool:state_changed', handleToolStateChanged);
    };
  }, [messageRouter, currentAgentId, refresh]);

  // Auto-fetch tools on mount
  useEffect(() => {
    if (sessionManager?.isValid() && tools.length === 0) {
      fetchTools();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionManager?.isValid, tools.length]);

  // Return hook interface
  return useMemo(() => ({
    // State
    tools,
    loading,
    error,

    // Execution state
    executingTools: Array.from(executingTools),
    toolResults,

    // Operations
    fetchTools,
    executeTool,
    refresh,

    // Tool queries
    getToolByName,
    getToolsByCategory,
    getSystemTools,
    getAutomationTools,
    getAnalysisTools,
    getUtilityTools,
    getCollaborationTools,
    getAITools,
    isToolAvailable,
    searchTools,
    filterTools,
    getCategoryCounts,

    // Execution queries
    isToolExecuting,
    getToolResult,
    clearToolResult,
    clearAllToolResults,

    // Capabilities
    getToolCapabilities,

    // Tool management
    enableTool,
    disableTool,
    getEnabledTools,

    // Utilities
    clearError,
  }), [
    tools,
    loading,
    error,
    executingTools,
    toolResults,
    fetchTools,
    executeTool,
    refresh,
    getToolByName,
    getToolsByCategory,
    getSystemTools,
    getAutomationTools,
    getAnalysisTools,
    getUtilityTools,
    getCollaborationTools,
    getAITools,
    isToolAvailable,
    searchTools,
    filterTools,
    getCategoryCounts,
    isToolExecuting,
    getToolResult,
    clearToolResult,
    clearAllToolResults,
    getToolCapabilities,
    enableTool,
    disableTool,
    getEnabledTools,
    clearError,
  ]);
}

export default useTools;
