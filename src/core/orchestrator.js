/**
 * Orchestrator - Central coordination hub for Loxia AI Agents System
 * 
 * Purpose: 
 * - Unified request/response handling for all interfaces (CLI, Web, VSCode)
 * - Agent lifecycle management
 * - Session management
 * - Error handling and response formatting
 * - Interface-agnostic communication protocol
 */

import {
  INTERFACE_TYPES,
  AGENT_TYPES,
  AGENT_STATUS,
  MESSAGE_MODES,
  ORCHESTRATOR_ACTIONS,
  SYSTEM_DEFAULTS
} from '../utilities/constants.js';

class Orchestrator {
  constructor(config, logger, agentPool, messageProcessor, aiService, stateManager) {
    this.config = config;
    this.logger = logger;
    this.agentPool = agentPool;
    this.messageProcessor = messageProcessor;
    this.aiService = aiService;
    this.stateManager = stateManager;
    
    this.activeSessions = new Map();
    this.requestHandlers = new Map();
    
    this._initializeRequestHandlers();
  }

  /**
   * Main entry point for all requests from client interfaces
   * @param {Object} request - Request object with interface, sessionId, action, payload, projectDir, user
   * @returns {Promise<Object>} Response object with success, data, error, metadata
   */
  async processRequest(request) {
    const startTime = Date.now();
    
    try {
      this._validateRequest(request);
      
      const handler = this.requestHandlers.get(request.action);
      if (!handler) {
        this.logger.error(`Unknown action received: ${request.action}`, {
          availableActions: Array.from(this.requestHandlers.keys()),
          requestAction: request.action,
          actionType: typeof request.action
        });
        throw new Error(`Unknown action: ${request.action}`);
      }
      
      // Ensure session exists
      await this._ensureSession(request.sessionId, request.projectDir);
      
      // Execute request handler
      const result = await handler.call(this, request);
      
      // Generate response metadata
      const metadata = {
        timestamp: new Date().toISOString(),
        executionTime: Date.now() - startTime,
        sessionId: request.sessionId,
        interface: request.interface
      };
      
      return {
        success: true,
        data: result,
        error: null,
        metadata
      };
      
    } catch (error) {
      this.logger.error(`Request processing failed: ${error.message}`, {
        request: this._sanitizeRequestForLogging(request),
        error: error.stack
      });
      
      return {
        success: false,
        data: null,
        error: error.message,
        metadata: {
          timestamp: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          sessionId: request.sessionId,
          interface: request.interface
        }
      };
    }
  }

  /**
   * Create a new agent with specified configuration
   * @param {string} systemPrompt - Agent's system prompt
   * @param {string} model - Preferred LLM model
   * @param {Object} options - Additional agent configuration
   * @returns {Promise<Object>} Created agent object
   */
  async createAgent(systemPrompt, model, options = {}) {
    const agentConfig = {
      name: options.name || `Agent-${Date.now()}`,
      type: options.type || AGENT_TYPES.USER_CREATED,
      systemPrompt,
      preferredModel: model,
      capabilities: options.capabilities || [],
      ...options
    };
    
    const agent = await this.agentPool.createAgent(agentConfig);
    
    this.logger.info(`Agent created: ${agent.id}`, {
      agentId: agent.id,
      name: agent.name,
      model: agent.preferredModel
    });
    
    return agent;
  }

  /**
   * Route message to specified agent
   * @param {string} agentId - Target agent ID
   * @param {string} message - Message content
   * @param {Object} context - Message context (projectDir, contextReferences, etc.)
   * @returns {Promise<Object>} Agent response
   */
  async routeToAgent(agentId, message, context = {}) {
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // NOTE: We deliberately do NOT short-circuit on agent.status === PAUSED
    // here. A user message is an explicit "act now" signal and must
    // override any pause/delay state. agentPool.addUserMessage() calls
    // _wakeAgentForMessage() which resumes paused agents, clears
    // scheduler-enforced delayEndTime, and clears pausedUntil — so by
    // the time the message lands in the queue the agent is back to
    // active status. Rejecting here would silently drop user intent
    // (the symptom was: "agent is paused" toast, no processing, the
    // agent happily napping while the user waits). See
    // src/core/__tests__/orchestratorUserMessageOverridesPause.test.js
    // for the regression guard.

    // Process message through message processor (NEW ARCHITECTURE: just queues message)
    const result = await this.messageProcessor.processMessage(agentId, message, context);
    
    // NEW ARCHITECTURE: MessageProcessor just queues messages, actual processing happens in AgentScheduler
    // Return immediate queuing confirmation to UI
    if (result.success) {
      const response = {
        success: true,
        data: {
          message: `Message queued for agent processing`,
          agentId: result.agentId,
          queuedAt: result.queuedAt,
          status: 'queued',
          // Legacy fields for backward compatibility
          toolResults: [],
          agentRedirects: [],
          currentModel: agent.currentModel
        },
        processingId: `queued-${Date.now()}`
      };
      
      this.logger.info(`Message queued for agent: ${agentId}`, {
        agentName: agent.name,
        messageLength: message.length,
        sessionId: context.sessionId
      });
      
      return response;
    } else {
      return result; // Return error response as-is
    }
  }

  /**
   * Get current session state
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object>} Session state object
   */
  async getSessionState(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    
    const agents = await this.agentPool.listActiveAgents();
    const projectState = await this.stateManager.getProjectState(session.projectDir);
    
    return {
      sessionId,
      projectDir: session.projectDir,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      agents: agents, // Return full agent objects since listActiveAgents already filters appropriately
      projectState
    };
  }

  /**
   * Shutdown orchestrator and cleanup resources
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.logger.info('Shutting down orchestrator...');
    
    // Save all agent states
    const agents = await this.agentPool.listActiveAgents();
    for (const agent of agents) {
      await this.stateManager.persistAgentState(agent.id);
    }
    
    // Clear active sessions
    this.activeSessions.clear();
    
    this.logger.info('Orchestrator shutdown complete');
  }

  /**
   * Initialize request handlers for different actions
   * @private
   */
  _initializeRequestHandlers() {
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.CREATE_AGENT, this._handleCreateAgent.bind(this));
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.UPDATE_AGENT, this._handleUpdateAgent.bind(this));
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.DELETE_AGENT, this._handleDeleteAgent.bind(this));
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.UNLOAD_AGENT, this._handleUnloadAgent.bind(this));
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.SEND_MESSAGE, this._handleSendMessage.bind(this));
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.LIST_AGENTS, this._handleListAgents.bind(this));
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.RESUME_SESSION, this._handleResumeSession.bind(this));
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.GET_SESSION_STATE, this._handleGetSessionState.bind(this));
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.PAUSE_AGENT, this._handlePauseAgent.bind(this));
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.RESUME_AGENT, this._handleResumeAgent.bind(this));
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.SWITCH_MODEL, this._handleSwitchModel.bind(this));
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.GET_AGENT_STATUS, this._handleGetAgentStatus.bind(this));
    this.requestHandlers.set(ORCHESTRATOR_ACTIONS.GET_AGENT_CONVERSATIONS, this._handleGetAgentConversations.bind(this));
  }

  /**
   * Handle create agent requests
   * @private
   */
  async _handleCreateAgent(request) {
    const { name, systemPrompt, model, capabilities, dynamicModelRouting, directoryAccess } = request.payload;

    this.logger.info('Creating agent with payload', {
      name,
      model,
      dynamicModelRouting,
      capabilities,
      directoryAccess: directoryAccess ? {
        workingDirectory:        directoryAccess.workingDirectory,
        readOnlyDirectories:     directoryAccess.readOnlyDirectories?.length || 0,
        writeEnabledDirectories: directoryAccess.writeEnabledDirectories?.length || 0,
        restrictToProject:       directoryAccess.restrictToProject,
      } : null,
    });

    return await this.createAgent(systemPrompt, model, {
      name,
      capabilities,
      dynamicModelRouting,
      directoryAccess,
      sessionId:  request.sessionId,
      projectDir: request.projectDir,
    });
  }

  /**
   * Handle update agent requests
   * @private
   */
  async _handleUpdateAgent(request) {
    const { agentId, updates } = request.payload;
    
    if (!agentId) {
      throw new Error('Agent ID is required for update');
    }
    
    if (!updates || typeof updates !== 'object') {
      throw new Error('Updates object is required');
    }
    
    // Get agent before update to ensure it exists
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    this.logger.info('Updating agent with payload', {
      agentId,
      updates,
      agentName: agent.name
    });
    
    // Update the agent through the agent pool
    // Include sessionId in updates to maintain API key context
    const updatesWithSession = {
      ...updates,
      sessionId: request.sessionId // Ensure current session context is preserved
    };
    const updatedAgent = await this.agentPool.updateAgent(agentId, updatesWithSession);
    
    this.logger.info(`Agent updated: ${agentId}`, {
      agentName: updatedAgent.name,
      newMode: updatedAgent.mode,
      sessionId: request.sessionId
    });
    
    return updatedAgent;
  }

  /**
   * Handle delete agent requests
   * @private
   */
  async _handleDeleteAgent(request) {
    const { agentId } = request.payload;
    
    if (!agentId) {
      throw new Error('Agent ID is required for deletion');
    }
    
    // Get agent before deletion to return info
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    // Delete the agent
    const result = await this.agentPool.deleteAgent(agentId);
    
    this.logger.info(`Agent deleted: ${agentId}`, {
      agentName: agent.name,
      sessionId: request.sessionId
    });
    
    return {
      success: true,
      deletedAgent: {
        id: agent.id,
        name: agent.name
      },
      ...result
    };
  }

  /**
   * Handle unload agent requests (remove from memory, keep files)
   * @private
   */
  async _handleUnloadAgent(request) {
    const { agentId } = request.payload;

    if (!agentId) {
      throw new Error('Agent ID is required for unloading');
    }

    // Get agent before unloading to return info
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Unload the agent (preserves files)
    const result = await this.agentPool.unloadAgent(agentId);

    this.logger.info(`Agent unloaded: ${agentId}`, {
      agentName: agent.name,
      sessionId: request.sessionId
    });

    return {
      success: true,
      unloadedAgent: {
        id: agent.id,
        name: agent.name
      },
      ...result
    };
  }

  /**
   * Handle send message requests
   * @private
   */
  async _handleSendMessage(request) {
    const { agentId, message, mode, contextReferences, apiKey, customApiKeys, streamingEnabled, source } = request.payload;

    const context = {
      projectDir: request.projectDir,
      sessionId: request.sessionId,
      interface: request.interface,
      mode: mode || MESSAGE_MODES.CHAT,
      contextReferences: contextReferences || [],
      apiKey: apiKey, // Pass Loxia API key through context
      customApiKeys: customApiKeys || {}, // Pass custom API keys through context
      streamingEnabled: streamingEnabled !== false, // Default to true if not specified
      // Provenance metadata from the inbound adapter (Discord/Telegram/…).
      // Preserved verbatim by messageProcessor and agentPool so the agent
      // can see where the message came from. See services/messageSource.js.
      source: source || null,
    };

    return await this.routeToAgent(agentId, message, context);
  }

  /**
   * Handle list agents requests
   * @private
   */
  async _handleListAgents(request) {
    return await this.agentPool.listActiveAgents();
  }

  /**
   * Handle resume session requests
   * @private
   */
  async _handleResumeSession(request) {
    const { projectDir } = request.payload;
    
    const resumedState = await this.stateManager.resumeProject(projectDir);
    
    // Restore agents to agent pool
    for (const agent of resumedState.agents) {
      await this.agentPool.restoreAgent(agent);
    }
    
    return resumedState;
  }

  /**
   * Handle get session state requests
   * @private
   */
  async _handleGetSessionState(request) {
    return await this.getSessionState(request.sessionId);
  }

  /**
   * Handle pause agent requests
   * @private
   */
  async _handlePauseAgent(request) {
    const { agentId, duration, reason } = request.payload;
    
    return await this.agentPool.pauseAgent(agentId, duration, reason);
  }

  /**
   * Handle resume agent requests
   * @private
   */
  async _handleResumeAgent(request) {
    const { agentId } = request.payload;
    
    return await this.agentPool.resumeAgent(agentId);
  }

  /**
   * Handle switch model requests
   * @private
   */
  async _handleSwitchModel(request) {
    const { agentId, newModel } = request.payload;
    
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    // Switch model via AI service conversation manager
    return await this.aiService.switchAgentModel(agentId, newModel);
  }

  /**
   * Handle get agent status requests
   * @private
   */
  async _handleGetAgentStatus(request) {
    const { agentId } = request.payload;
    
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    return {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      mode: agent.mode,
      currentModel: agent.currentModel,
      lastActivity: agent.lastActivity,
      isPaused: agent.status === 'paused',
      pausedUntil: agent.pausedUntil
    };
  }

  /**
   * Handle get agent conversations requests
   * @private
   */
  async _handleGetAgentConversations(request) {
    const { agentId } = request.payload;

    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    return {
      agentId: agent.id,
      conversations: agent.conversations,
      messageCount: agent.conversations?.full?.messages?.length || 0
    };
  }

  /**
   * Validate request format
   * @private
   */
  _validateRequest(request) {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid request format');
    }
    
    const requiredFields = ['interface', 'sessionId', 'action', 'payload'];
    for (const field of requiredFields) {
      if (!(field in request)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    const validInterfaces = Object.values(INTERFACE_TYPES);
    if (!validInterfaces.includes(request.interface)) {
      throw new Error(`Invalid interface: ${request.interface}`);
    }
  }

  /**
   * Ensure session exists, create if needed
   * @private
   */
  async _ensureSession(sessionId, projectDir) {
    if (!this.activeSessions.has(sessionId)) {
      const session = {
        id: sessionId,
        projectDir: projectDir || process.cwd(),
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      };
      
      this.activeSessions.set(sessionId, session);
      this.logger.info(`Session created: ${sessionId}`, { projectDir: session.projectDir });
    } else {
      // Update last activity
      const session = this.activeSessions.get(sessionId);
      session.lastActivity = new Date().toISOString();
    }
  }

  /**
   * Sanitize request for logging (remove sensitive data)
   * @private
   */
  _sanitizeRequestForLogging(request) {
    const sanitized = { ...request };
    
    // Remove potentially sensitive user data
    if (sanitized.user) {
      sanitized.user = { id: sanitized.user.id };
    }
    
    // Truncate large message content
    if (sanitized.payload && sanitized.payload.message && sanitized.payload.message.length > 500) {
      sanitized.payload.message = sanitized.payload.message.substring(0, 500) + '... [truncated]';
    }
    
    return sanitized;
  }
}

export default Orchestrator;