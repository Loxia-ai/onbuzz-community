/**
 * Agent Data Model - Type definitions and validation for AI agents
 * 
 * Purpose:
 * - Define the structure and properties of AI agents
 * - Provide validation functions for agent data
 * - Ensure data integrity and consistency
 */

import { AGENT_STATUS, AGENT_TYPES, MODELS } from '../utilities/constants.js';

/**
 * Agent data model
 * @typedef {Object} Agent
 * @property {string} id - Unique agent identifier
 * @property {string} name - Human-readable agent name
 * @property {string} type - Agent type (user-created, system-agent, agent-engineer)
 * @property {string} status - Current agent status (active, idle, busy, suspended, paused)
 * @property {string} currentModel - AI model being used
 * @property {string} systemPrompt - System prompt defining agent behavior
 * @property {AgentConfiguration} configuration - Agent configuration settings
 * @property {AgentMetrics} metrics - Performance and usage metrics
 * @property {AgentState} state - Current agent state information
 * @property {string} createdAt - ISO timestamp of creation
 * @property {string} updatedAt - ISO timestamp of last update
 * @property {string} lastActivity - ISO timestamp of last activity
 * @property {string|null} pausedUntil - ISO timestamp when pause expires (null if not paused)
 * @property {string|null} pauseReason - Reason for current pause (null if not paused)
 * @property {Object} metadata - Additional metadata and tags
 */

/**
 * Agent configuration settings
 * @typedef {Object} AgentConfiguration
 * @property {number} maxContextLength - Maximum context length in tokens
 * @property {number} temperature - Sampling temperature (0.0-1.0)
 * @property {number} maxTokens - Maximum tokens per response
 * @property {number} timeout - Request timeout in milliseconds
 * @property {boolean} persistConversations - Whether to persist conversation history
 * @property {string[]} enabledTools - List of enabled tool names
 * @property {Object} toolConfigurations - Tool-specific configurations
 * @property {boolean} autoRetry - Whether to automatically retry failed requests
 * @property {number} maxRetries - Maximum number of retry attempts
 * @property {Object} customSettings - Custom configuration properties
 */

/**
 * Agent performance and usage metrics
 * @typedef {Object} AgentMetrics
 * @property {number} totalMessages - Total messages processed
 * @property {number} totalTokensUsed - Total tokens consumed
 * @property {number} totalCost - Total cost incurred (USD)
 * @property {number} averageResponseTime - Average response time in milliseconds
 * @property {number} successRate - Success rate (0.0-1.0)
 * @property {number} errorCount - Total number of errors
 * @property {number} toolExecutions - Number of tool executions
 * @property {number} conversationsStarted - Number of conversations initiated
 * @property {Object} dailyUsage - Daily usage statistics
 * @property {Object} weeklyUsage - Weekly usage statistics
 * @property {Object} monthlyUsage - Monthly usage statistics
 * @property {string} lastMetricsUpdate - ISO timestamp of last metrics update
 */

/**
 * Agent state information
 * @typedef {Object} AgentState
 * @property {string} currentConversationId - ID of current active conversation
 * @property {number} messageCount - Number of messages in current conversation
 * @property {Object} context - Current conversation context
 * @property {string[]} activeTools - Currently executing tools
 * @property {Object} pendingOperations - Pending asynchronous operations
 * @property {Object} cache - Cached data and responses
 * @property {boolean} isProcessing - Whether agent is currently processing
 * @property {string|null} lastError - Last error encountered (null if none)
 * @property {Object} sessionData - Session-specific data
 */

/**
 * Agent creation parameters
 * @typedef {Object} AgentCreationParams
 * @property {string} name - Agent name (required)
 * @property {string} [type=user-created] - Agent type
 * @property {string} [model=anthropic-sonnet] - AI model to use
 * @property {string} [systemPrompt=''] - System prompt
 * @property {Partial<AgentConfiguration>} [configuration] - Initial configuration
 * @property {Object} [metadata] - Initial metadata
 * @property {string[]} [enabledTools] - Initial enabled tools
 */

/**
 * Agent update parameters
 * @typedef {Object} AgentUpdateParams
 * @property {string} [name] - New agent name
 * @property {string} [systemPrompt] - New system prompt
 * @property {string} [currentModel] - New AI model
 * @property {Partial<AgentConfiguration>} [configuration] - Configuration updates
 * @property {Object} [metadata] - Metadata updates
 * @property {string[]} [enabledTools] - Updated enabled tools list
 */

/**
 * Agent validation functions
 */
export class AgentValidator {
  /**
   * Validate agent data structure
   * @param {Object} agent - Agent data to validate
   * @returns {Object} Validation result
   */
  static validate(agent) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!agent.id || typeof agent.id !== 'string') {
      errors.push('Agent ID is required and must be a string');
    }

    if (!agent.name || typeof agent.name !== 'string') {
      errors.push('Agent name is required and must be a string');
    }

    if (agent.name && agent.name.length < 2) {
      errors.push('Agent name must be at least 2 characters long');
    }

    if (agent.name && agent.name.length > 100) {
      errors.push('Agent name must be less than 100 characters');
    }

    // Type validation
    if (agent.type && !Object.values(AGENT_TYPES).includes(agent.type)) {
      errors.push(`Invalid agent type: ${agent.type}`);
    }

    // Status validation
    if (agent.status && !Object.values(AGENT_STATUS).includes(agent.status)) {
      errors.push(`Invalid agent status: ${agent.status}`);
    }

    // Model validation
    if (agent.currentModel && !Object.values(MODELS).includes(agent.currentModel)) {
      warnings.push(`Unknown AI model: ${agent.currentModel}`);
    }

    // System prompt validation
    if (agent.systemPrompt && typeof agent.systemPrompt !== 'string') {
      errors.push('System prompt must be a string');
    }

    if (agent.systemPrompt && agent.systemPrompt.length > 10000) {
      warnings.push('System prompt is very long (>10000 characters)');
    }

    // Configuration validation
    if (agent.configuration) {
      const configValidation = this.validateConfiguration(agent.configuration);
      errors.push(...configValidation.errors);
      warnings.push(...configValidation.warnings);
    }

    // Timestamp validation
    const timestampFields = ['createdAt', 'updatedAt', 'lastActivity', 'pausedUntil'];
    timestampFields.forEach(field => {
      if (agent[field] && !this.isValidTimestamp(agent[field])) {
        errors.push(`Invalid timestamp for ${field}: ${agent[field]}`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate agent configuration
   * @param {Object} configuration - Configuration to validate
   * @returns {Object} Validation result
   */
  static validateConfiguration(configuration) {
    const errors = [];
    const warnings = [];

    if (configuration.maxContextLength && typeof configuration.maxContextLength !== 'number') {
      errors.push('maxContextLength must be a number');
    }

    if (configuration.maxContextLength && configuration.maxContextLength < 1000) {
      warnings.push('maxContextLength is very low (<1000)');
    }

    if (configuration.temperature !== undefined) {
      if (typeof configuration.temperature !== 'number') {
        errors.push('temperature must be a number');
      } else if (configuration.temperature < 0 || configuration.temperature > 2) {
        errors.push('temperature must be between 0 and 2');
      }
    }

    if (configuration.maxTokens && typeof configuration.maxTokens !== 'number') {
      errors.push('maxTokens must be a number');
    }

    if (configuration.timeout && typeof configuration.timeout !== 'number') {
      errors.push('timeout must be a number');
    }

    if (configuration.timeout && configuration.timeout < 1000) {
      warnings.push('timeout is very low (<1000ms)');
    }

    if (configuration.maxRetries && typeof configuration.maxRetries !== 'number') {
      errors.push('maxRetries must be a number');
    }

    if (configuration.enabledTools && !Array.isArray(configuration.enabledTools)) {
      errors.push('enabledTools must be an array');
    }

    return { errors, warnings };
  }

  /**
   * Validate agent creation parameters
   * @param {Object} params - Creation parameters to validate
   * @returns {Object} Validation result
   */
  static validateCreationParams(params) {
    const errors = [];
    const warnings = [];

    if (!params.name || typeof params.name !== 'string') {
      errors.push('Agent name is required and must be a string');
    }

    if (params.name && params.name.length < 2) {
      errors.push('Agent name must be at least 2 characters long');
    }

    if (params.type && !Object.values(AGENT_TYPES).includes(params.type)) {
      errors.push(`Invalid agent type: ${params.type}`);
    }

    if (params.model && !Object.values(MODELS).includes(params.model)) {
      warnings.push(`Unknown AI model: ${params.model}`);
    }

    if (params.systemPrompt && typeof params.systemPrompt !== 'string') {
      errors.push('System prompt must be a string');
    }

    if (params.enabledTools && !Array.isArray(params.enabledTools)) {
      errors.push('enabledTools must be an array');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Check if a timestamp is valid ISO string
   * @param {string} timestamp - Timestamp to validate
   * @returns {boolean} True if valid
   */
  static isValidTimestamp(timestamp) {
    if (typeof timestamp !== 'string') return false;
    const date = new Date(timestamp);
    return date instanceof Date && !isNaN(date.getTime());
  }
}

/**
 * Agent factory functions
 */
export class AgentFactory {
  /**
   * Create a new agent with default values
   * @param {AgentCreationParams} params - Creation parameters
   * @returns {Agent} New agent object
   */
  static create(params) {
    // Validate parameters
    const validation = AgentValidator.validateCreationParams(params);
    if (!validation.isValid) {
      throw new Error(`Invalid agent parameters: ${validation.errors.join(', ')}`);
    }

    const now = new Date().toISOString();
    const agentId = this.generateAgentId();

    return {
      id: agentId,
      name: params.name,
      type: params.type || AGENT_TYPES.USER_CREATED,
      status: AGENT_STATUS.IDLE,
      currentModel: params.model || MODELS.ANTHROPIC_SONNET,
      systemPrompt: params.systemPrompt || '',
      configuration: this.createDefaultConfiguration(params.configuration),
      metrics: this.createDefaultMetrics(),
      state: this.createDefaultState(),
      createdAt: now,
      updatedAt: now,
      lastActivity: now,
      pausedUntil: null,
      pauseReason: null,
      metadata: params.metadata || {}
    };
  }

  /**
   * Create default agent configuration
   * @param {Partial<AgentConfiguration>} overrides - Configuration overrides
   * @returns {AgentConfiguration} Default configuration
   */
  static createDefaultConfiguration(overrides = {}) {
    return {
      maxContextLength: 50000,
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 30000,
      persistConversations: true,
      enabledTools: ['terminal', 'filesys', 'editor'],
      toolConfigurations: {},
      autoRetry: true,
      maxRetries: 3,
      customSettings: {},
      ...overrides
    };
  }

  /**
   * Create default agent metrics
   * @returns {AgentMetrics} Default metrics
   */
  static createDefaultMetrics() {
    const now = new Date().toISOString();
    
    return {
      totalMessages: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      averageResponseTime: 0,
      successRate: 1.0,
      errorCount: 0,
      toolExecutions: 0,
      conversationsStarted: 0,
      dailyUsage: { tokens: 0, cost: 0, messages: 0 },
      weeklyUsage: { tokens: 0, cost: 0, messages: 0 },
      monthlyUsage: { tokens: 0, cost: 0, messages: 0 },
      lastMetricsUpdate: now
    };
  }

  /**
   * Create default agent state
   * @returns {AgentState} Default state
   */
  static createDefaultState() {
    return {
      currentConversationId: null,
      messageCount: 0,
      context: {},
      activeTools: [],
      pendingOperations: {},
      cache: {},
      isProcessing: false,
      lastError: null,
      sessionData: {}
    };
  }

  /**
   * Generate unique agent ID
   * @returns {string} Unique agent ID
   */
  static generateAgentId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `agent_${timestamp}_${random}`;
  }

  /**
   * Clone an existing agent with new ID
   * @param {Agent} agent - Agent to clone
   * @param {string} newName - Name for cloned agent
   * @returns {Agent} Cloned agent
   */
  static clone(agent, newName) {
    const cloned = { ...agent };
    const now = new Date().toISOString();
    
    cloned.id = this.generateAgentId();
    cloned.name = newName;
    cloned.status = AGENT_STATUS.IDLE;
    cloned.createdAt = now;
    cloned.updatedAt = now;
    cloned.lastActivity = now;
    cloned.pausedUntil = null;
    cloned.pauseReason = null;
    
    // Reset metrics and state
    cloned.metrics = this.createDefaultMetrics();
    cloned.state = this.createDefaultState();
    
    return cloned;
  }
}

/**
 * Agent utility functions
 */
export class AgentUtils {
  /**
   * Check if agent is currently active
   * @param {Agent} agent - Agent to check
   * @returns {boolean} True if active
   */
  static isActive(agent) {
    return agent.status === AGENT_STATUS.ACTIVE || agent.status === AGENT_STATUS.BUSY;
  }

  /**
   * Check if agent is paused
   * @param {Agent} agent - Agent to check
   * @returns {boolean} True if paused
   */
  static isPaused(agent) {
    if (agent.status !== AGENT_STATUS.PAUSED) return false;
    
    if (agent.pausedUntil) {
      const pauseExpiry = new Date(agent.pausedUntil);
      return new Date() < pauseExpiry;
    }
    
    return true;
  }

  /**
   * Get agent's effective status considering pause expiry
   * @param {Agent} agent - Agent to check
   * @returns {string} Effective status
   */
  static getEffectiveStatus(agent) {
    if (agent.status === AGENT_STATUS.PAUSED && agent.pausedUntil) {
      const pauseExpiry = new Date(agent.pausedUntil);
      if (new Date() >= pauseExpiry) {
        return AGENT_STATUS.IDLE; // Pause has expired
      }
    }
    
    return agent.status;
  }

  /**
   * Calculate time until pause expires
   * @param {Agent} agent - Agent to check
   * @returns {number|null} Milliseconds until pause expires, null if not paused
   */
  static getTimeUntilPauseExpiry(agent) {
    if (!this.isPaused(agent) || !agent.pausedUntil) {
      return null;
    }
    
    const pauseExpiry = new Date(agent.pausedUntil);
    const now = new Date();
    
    return Math.max(0, pauseExpiry.getTime() - now.getTime());
  }

  /**
   * Format agent for display
   * @param {Agent} agent - Agent to format
   * @returns {Object} Formatted agent data
   */
  static formatForDisplay(agent) {
    return {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      status: this.getEffectiveStatus(agent),
      model: agent.currentModel,
      messageCount: agent.metrics.totalMessages,
      lastActivity: agent.lastActivity,
      isPaused: this.isPaused(agent),
      timeUntilPauseExpiry: this.getTimeUntilPauseExpiry(agent)
    };
  }

  /**
   * Sanitize agent data for API responses
   * @param {Agent} agent - Agent to sanitize
   * @returns {Object} Sanitized agent data
   */
  static sanitize(agent) {
    const sanitized = { ...agent };
    
    // Remove sensitive or internal data
    delete sanitized.state.cache;
    delete sanitized.state.sessionData;
    
    // Truncate long system prompt for API responses
    if (sanitized.systemPrompt && sanitized.systemPrompt.length > 500) {
      sanitized.systemPrompt = sanitized.systemPrompt.substring(0, 500) + '...';
    }
    
    return sanitized;
  }
}

export default {
  AgentValidator,
  AgentFactory,
  AgentUtils
};