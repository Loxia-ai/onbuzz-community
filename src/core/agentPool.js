/**
 * AgentPool - Manages the lifecycle, state, and communication of all active agents
 * 
 * Purpose:
 * - Agent creation and destruction
 * - Agent notification and routing
 * - Multi-agent conversation coordination
 * - Agent state persistence and recovery
 * - Agent activity management
 */

import {
  AGENT_TYPES,
  AGENT_STATUS,
  AGENT_MODES,
  MESSAGE_ROLES,
  MESSAGE_TYPES,
  INTER_AGENT_MESSAGE,
  MODEL_FORMAT_VERSIONS,
  SYSTEM_DEFAULTS
} from '../utilities/constants.js';
import DirectoryAccessManager from '../utilities/directoryAccessManager.js';
import { getVisualEditorBridge } from '../services/visualEditorBridge.js';

class AgentPool {
  constructor(config, logger, stateManager, contextManager, toolsRegistry = null) {
    this.config = config;
    this.logger = logger;
    this.stateManager = stateManager;
    this.contextManager = contextManager;
    this.toolsRegistry = toolsRegistry;
    
    // Agent registry - maps agent ID to agent object
    this.agents = new Map();
    
    // Agent directory for discovery
    this.agentDirectory = new Map();
    
    // Paused agents tracking
    this.pausedAgents = new Map();
    
    // Agent notification queue
    this.notificationQueue = new Map();
    
    this.maxAgentsPerProject = config.system?.maxAgentsPerProject || SYSTEM_DEFAULTS.MAX_AGENTS_PER_PROJECT;
    
    // MessageProcessor reference for triggering responses (set via setMessageProcessor)
    this.messageProcessor = null;
      
    // Initialize directory access manager
    this.directoryAccessManager = new DirectoryAccessManager(config, logger);
  }

  /**
   * Create a new agent with specified configuration
   * @param {Object} config - Agent configuration
   * @param {string} config.name - Agent name
   * @param {string} config.type - Agent type ('user-created', 'system-agent', 'agent-engineer')
   * @param {string} config.systemPrompt - Agent's system prompt
   * @param {string} config.preferredModel - Preferred LLM model
   * @param {Array} config.capabilities - Available tools/capabilities
   * @param {Object} config.directoryAccess - Directory access configuration
   * @param {string} config.projectDir - Project directory for default access setup
   * @returns {Promise<Object>} Created agent object
   */
  async createAgent(config) {
    // Check agent limit
    if (this.agents.size >= this.maxAgentsPerProject) {
      throw new Error(`Maximum agents per project exceeded (${this.maxAgentsPerProject})`);
    }
    
    const agentId = this._generateAgentId(config.name);
    const now = new Date().toISOString();
    
    // Enhance system prompt with tool descriptions if available
    let enhancedSystemPrompt = config.systemPrompt;
    if (this.toolsRegistry && config.capabilities && config.capabilities.length > 0) {
      try {
        enhancedSystemPrompt = this.toolsRegistry.enhanceSystemPrompt(
          config.systemPrompt,
          config.capabilities,
          {
            compact: config.compactToolDescriptions || false,
            layered: config.layeredToolDescriptions || false,
            includeExamples: config.includeToolExamples !== false,
            includeUsageGuidelines: config.includeUsageGuidelines !== false,
            includeSecurityNotes: config.includeSecurityNotes !== false
          }
        );
        
        this.logger?.info(`System prompt enhanced with tool descriptions`, {
          agentId,
          capabilities: config.capabilities,
          originalLength: config.systemPrompt?.length || 0,
          enhancedLength: enhancedSystemPrompt?.length || 0
        });
      } catch (error) {
        this.logger?.error(`Failed to enhance system prompt with tools`, {
          agentId,
          error: error.message,
          capabilities: config.capabilities
        });
        // Fall back to original prompt
        enhancedSystemPrompt = config.systemPrompt;
      }
    }

    // Inject assigned skills index into system prompt
    if (config.skills && config.skills.length > 0) {
      try {
        const { getSkillsService } = await import('../services/skillsService.js');
        const skillsService = getSkillsService(this.logger);
        await skillsService.initialize();
        const summaries = await skillsService.getSkillSummaries(config.skills);
        if (summaries.length > 0) {
          enhancedSystemPrompt += '\n\n## ASSIGNED SKILLS\n\n';
          enhancedSystemPrompt += 'Use the skills tool to browse and load skill content. Use "describe" to see sections, "read-section" to load specific parts.\n\n';
          for (const s of summaries) {
            const sections = s.sections?.length ? `\n    Sections: ${s.sections.map(h => h.replace(/^#+\s*/, '')).join(', ')}` : '';
            enhancedSystemPrompt += `- **${s.name}** (${s.lineCount} lines): ${s.description}${sections}\n`;
          }
        }
      } catch (error) {
        this.logger?.warn('Failed to inject skills index into system prompt', { error: error.message });
      }
    }

    // Setup directory access configuration
    let directoryAccess;

    console.log('AgentPool DEBUG: createAgent - config.directoryAccess:', config.directoryAccess ? 'EXISTS' : 'NULL/UNDEFINED');
    if (config.directoryAccess) {
      console.log('AgentPool DEBUG: createAgent - directoryAccess from config:', JSON.stringify(config.directoryAccess, null, 2));
    }
    console.log('AgentPool DEBUG: createAgent - config.projectDir:', config.projectDir);
    
    if (config.directoryAccess) {
      // Validate provided directory access configuration
      const validation = this.directoryAccessManager.validateAccessConfiguration(config.directoryAccess);
      console.log('AgentPool DEBUG: createAgent - validation result:', validation);
      if (!validation.valid) {
        throw new Error(`Invalid directory access configuration: ${validation.errors.join(', ')}`);
      }
      directoryAccess = config.directoryAccess;
      console.log('AgentPool DEBUG: createAgent - Using provided directoryAccess');
    } else {
      // Create default directory access based on project directory
      const projectDir = config.projectDir || process.cwd();
      directoryAccess = DirectoryAccessManager.createProjectDefaults(projectDir);
      console.log('AgentPool DEBUG: createAgent - Created default directoryAccess for projectDir:', projectDir);
      console.log('AgentPool DEBUG: createAgent - Default directoryAccess:', JSON.stringify(directoryAccess, null, 2));
    }

    const agent = {
      id: agentId,
      type: config.type || AGENT_TYPES.USER_CREATED,
      name: config.name || `Agent-${Date.now()}`,
      systemPrompt: enhancedSystemPrompt,
      originalSystemPrompt: config.systemPrompt, // Store original for reference
      preferredModel: config.preferredModel,
      status: AGENT_STATUS.ACTIVE,
      capabilities: config.capabilities || [],
      directoryAccess: directoryAccess, // Directory access configuration
      // Per-tool configuration — keyed by tool id (e.g., 'terminal',
      // 'filesystem'). When a tool is instantiated for this agent, the
      // object under toolConfig[toolId] is merged into the tool's
      // constructor config. Previously tools were constructed from global
      // defaults only, so there was no way to set per-agent knobs like
      // terminal allowed-commands, filesystem size limits, web stealth
      // level, etc. See ToolManager integration in step 2.
      toolConfig: (config.toolConfig && typeof config.toolConfig === 'object' && !Array.isArray(config.toolConfig))
        ? { ...config.toolConfig }
        : {},
      conversations: {
        full: {
          messages: [],
          lastUpdated: now
        }
      },
      currentModel: config.preferredModel,
      dynamicModelRouting: config.dynamicModelRouting || false,
      routingStrategy: config.routingStrategy || '',
      skills: config.skills || [],


      // Agent Mode Configuration
      mode: config.mode || AGENT_MODES.CHAT,
      currentTask: null, // Current autonomous task being executed
      taskStartTime: null,
      maxIterations: config.maxIterations || 10, // Safety limit for autonomous loops
      iterationCount: 0,
      stopRequested: false,
      delayEndTime: null, // When agent delay expires (for agentDelay tool)
      ttl: null, // Time-to-live: processing cycles remaining (null = no TTL, number = cycles left)

      // Message Queues for scheduler processing
      messageQueues: {
        toolResults: [],      // Tool execution results waiting to be processed
        interAgentMessages: [], // Messages from other agents
        userMessages: []      // Messages from users
      },
      
      createdAt: now,
      lastActivity: now,
      pausedUntil: null,
      // Used by platformControlTool for ancestry checks. null = created
      // via the UI / no parent agent. Set to <agentId> when an agent
      // creates another via the platformcontrol tool.
      createdBy: typeof config.createdBy === 'string' ? config.createdBy : null,
      metadata: config.metadata || {},
      
      // CRITICAL: Store sessionId for API key resolution
      sessionId: config.sessionId,
      
      // Inter-agent conversation tracking to prevent spam
      interAgentTracking: new Map(), // recipientId -> { lastSent, lastReceived, lastType }
      
      // Task Management System for agent-mode autonomous operation
      taskList: {
        tasks: [],  // Array of task objects
        lastUpdated: now
      },
      
      // Incoming messages tracking (for unprocessed messages)
      incomingMessages: []
    };

    this.logger.info(`Agent created with routing config`, {
      agentId,
      dynamicModelRouting: agent.dynamicModelRouting,
      preferredModel: agent.preferredModel,
    });
    
    // Initialize model-specific conversation with dual storage structure
    if (config.preferredModel) {
      agent.conversations[config.preferredModel] = {
        // Dual storage for compactization support
        messages: [],                    // Original messages - never modified
        compactizedMessages: null,       // Working copy - null until first compaction

        // Compactization metadata
        lastCompactization: null,        // Timestamp of last compaction
        compactizationCount: 0,          // Number of times compacted
        compactizationStrategy: null,    // 'summarization', 'truncation', 'aggressive'
        originalTokenCount: 0,           // Token count before last compaction
        compactedTokenCount: 0,          // Token count after last compaction

        // Backward compatibility
        tokenCount: 0,                   // Current effective token count
        lastUpdated: now,
        formatVersion: this._getModelFormatVersion(config.preferredModel)
      };
    }
    
    // Add to registry and directory
    this.agents.set(agentId, agent);
    this._updateAgentDirectory(agent);

    // Persist agent state (use wrapper that resolves agent object from ID)
    await this.persistAgentState(agentId);
    
    this.logger.info(`Agent created: ${agentId}`, {
      agentId,
      name: agent.name,
      type: agent.type,
      model: agent.preferredModel
    });
    
    return agent;
  }

  /**
   * Retrieve agent instance by ID
   * @param {string} agentId - Agent identifier
   * @returns {Promise<Object|null>} Agent object or null if not found
   */
  async getAgent(agentId, enrichWithSchedulerStatus = false) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // Optionally enrich with scheduler status for UI
    if (enrichWithSchedulerStatus && this.scheduler) {
      agent.inScheduler = this.scheduler.isAgentInScheduler(agentId);
    }

    return agent;
  }

  /**
   * Update an existing agent's configuration
   * @param {string} agentId - Agent identifier
   * @param {Object} updates - Updates to apply to the agent
   * @returns {Promise<Object>} Updated agent object
   */
  async updateAgent(agentId, updates) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.logger.info(`Updating agent: ${agentId}`, {
      updates,
      currentName: agent.name
    });

    // Validate directory access configuration if being updated
    if (updates.directoryAccess) {
      const validation = this.directoryAccessManager.validateAccessConfiguration(updates.directoryAccess);
      if (!validation.valid) {
        throw new Error(`Invalid directory access configuration: ${validation.errors.join(', ')}`);
      }

      this.logger.info(`Directory access validation passed for agent: ${agentId}`, {
        workingDirectory: updates.directoryAccess.workingDirectory,
        readOnlyDirs: updates.directoryAccess.readOnlyDirectories?.length || 0,
        writeEnabledDirs: updates.directoryAccess.writeEnabledDirectories?.length || 0
      });
    }

    // Validate per-tool config if being updated. Must be a plain object
    // keyed by tool id; each value is an object of config overrides that
    // will be merged into the tool's constructor config at instantiation.
    // We don't validate individual tool schemas here — that happens at
    // tool construction time where the tool knows its own shape.
    if (updates.toolConfig !== undefined) {
      if (updates.toolConfig === null
          || typeof updates.toolConfig !== 'object'
          || Array.isArray(updates.toolConfig)) {
        throw new Error('Invalid toolConfig: must be a plain object keyed by tool id');
      }
      for (const [toolId, cfg] of Object.entries(updates.toolConfig)) {
        if (cfg !== null && (typeof cfg !== 'object' || Array.isArray(cfg))) {
          throw new Error(`Invalid toolConfig.${toolId}: must be an object or null`);
        }
      }
    }

    // If originalSystemPrompt is being updated (user edited the raw prompt), store it
    // and use it as the base for enhancement. Otherwise use the existing originalSystemPrompt.
    if (updates.originalSystemPrompt !== undefined) {
      // User explicitly set a new base prompt — store it
      this.logger.info(`Original system prompt updated by user`, {
        agentId,
        oldLength: (agent.originalSystemPrompt || '').length,
        newLength: updates.originalSystemPrompt.length
      });
    }

    // If capabilities or system prompt are being updated, regenerate the enhanced system prompt
    if ((updates.capabilities || updates.originalSystemPrompt !== undefined) && this.toolsRegistry) {
      try {
        // Priority: new user prompt > existing original prompt > existing system prompt
        const baseSystemPrompt = updates.originalSystemPrompt !== undefined
          ? updates.originalSystemPrompt
          : (agent.originalSystemPrompt || agent.systemPrompt || '');
        const capabilities = updates.capabilities || agent.capabilities || [];

        const enhancedSystemPrompt = this.toolsRegistry.enhanceSystemPrompt(
          baseSystemPrompt,
          capabilities,
          {
            compact: agent.compactToolDescriptions || false,
            includeExamples: agent.includeToolExamples !== false,
            includeUsageGuidelines: agent.includeUsageGuidelines !== false,
            includeSecurityNotes: agent.includeSecurityNotes !== false
          }
        );

        updates.systemPrompt = enhancedSystemPrompt;
        // Always keep originalSystemPrompt in sync with what the user wrote
        if (updates.originalSystemPrompt === undefined) {
          updates.originalSystemPrompt = baseSystemPrompt;
        }

        this.logger.info(`System prompt regenerated with updated capabilities`, {
          agentId,
          oldCapabilities: agent.capabilities,
          newCapabilities: capabilities,
          originalLength: baseSystemPrompt?.length || 0,
          enhancedLength: enhancedSystemPrompt?.length || 0
        });
      } catch (error) {
        this.logger.error(`Failed to regenerate system prompt with updated capabilities`, {
          agentId,
          error: error.message,
          capabilities: updates.capabilities
        });
        // Continue with update even if enhancement fails
      }
    }

    // Create updated agent object with new values
    const updatedAgent = {
      ...agent,
      ...updates,
      id: agentId, // Ensure ID cannot be changed
      lastModified: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    };

    // CRITICAL FIX: When preferredModel changes, also update currentModel
    // This ensures the UI immediately reflects the model change
    if (updates.preferredModel && updates.preferredModel !== agent.preferredModel) {
      const oldModel = agent.preferredModel;
      const newModel = updates.preferredModel;

      updatedAgent.currentModel = newModel;

      // CRITICAL FIX: Initialize conversation for new model if it doesn't exist
      if (!updatedAgent.conversations[newModel]) {
        updatedAgent.conversations[newModel] = this._createEmptyConversation(newModel);
        this.logger.info(`Created conversation for new model: ${newModel}`, { agentId });
      }

      // Copy conversation history from old model to new model
      // This preserves context when switching models
      if (oldModel && updatedAgent.conversations[oldModel]) {
        const oldConversation = updatedAgent.conversations[oldModel];
        const newConversation = updatedAgent.conversations[newModel];

        // Copy messages if new conversation is empty
        if (newConversation.messages.length === 0 && oldConversation.messages.length > 0) {
          // Copy original messages
          newConversation.messages = [...oldConversation.messages];

          // Copy compacted messages if they exist
          if (oldConversation.compactizedMessages) {
            newConversation.compactizedMessages = [...oldConversation.compactizedMessages];
            newConversation.lastCompactization = oldConversation.lastCompactization;
            newConversation.compactizationCount = oldConversation.compactizationCount;
            newConversation.compactizationStrategy = oldConversation.compactizationStrategy;
            newConversation.originalTokenCount = oldConversation.originalTokenCount;
            newConversation.compactedTokenCount = oldConversation.compactedTokenCount;
            // CRITICAL: Copy the sync watermark too — without this, getMessagesForAI
            // cannot sync new messages to compactizedMessages after a model switch,
            // causing the AI to only see the compacted summary and repeat itself endlessly.
            newConversation.originalMessageCountAtCompaction = oldConversation.originalMessageCountAtCompaction;
          }

          newConversation.lastUpdated = new Date().toISOString();

          this.logger.info(`Copied conversation history from ${oldModel} to ${newModel}`, {
            agentId,
            messageCount: newConversation.messages.length,
            hasCompacted: !!newConversation.compactizedMessages
          });
        }
      }

      this.logger.info(`Model changed via UI - updating both preferredModel and currentModel`, {
        agentId,
        oldModel,
        newModel,
        conversationCopied: oldModel && updatedAgent.conversations[oldModel]?.messages.length > 0
      });
    }

    // Update agent in registry
    this.agents.set(agentId, updatedAgent);
    
    // Log the actual update for debugging
    this.logger.info(`Agent updated in registry with mode: ${updatedAgent.mode}`, {
      agentId,
      beforeMode: agent.mode,
      afterMode: updatedAgent.mode,
      allUpdates: Object.keys(updates)
    });

    // Update agent directory
    this._updateAgentDirectory(updatedAgent);

    // Persist the updated agent state
    await this.stateManager.persistAgentState(updatedAgent);

    // Record the mode transition (both directions) into the scheduler's
    // per-agent history. This is where UI-toggle and programmatic
    // update_agent flips land — internal scheduler flips go through
    // scheduler._transitionMode directly. Both feed the same ring buffer
    // and the same /scheduler visualizer row.
    if (updates.mode !== undefined && agent.mode !== updates.mode && this.scheduler?.recordModeTransition) {
      this.scheduler.recordModeTransition(agentId, agent.mode, updates.mode, 'user-toggle');
    }

    // CRITICAL: If agent was switched to AGENT mode, add it to scheduler
    if (updates.mode === AGENT_MODES.AGENT && this.scheduler) {
      // CRITICAL FIX: Use the session ID from updates first, then agent's sessionId
      // Register session with scheduler for API key resolution
      // NOTE: The scheduler now uses AgentActivityService to determine which agents
      // should be active, so we just register the session here
      const sessionId = updates.sessionId || updatedAgent.sessionId;

      if (!sessionId) {
        this.logger.warn(`Agent ${agentId} switching to AGENT mode but has no sessionId - this will cause API key resolution issues`);
      }

      this.logger.info(`Registering agent session with scheduler (switched to AGENT mode): ${agentId}`, {
        agentName: updatedAgent.name,
        sessionId: sessionId,
        hasSessionId: !!sessionId
      });

      await this.scheduler.addAgent(agentId, {
        sessionId: sessionId,
        triggeredBy: 'mode-change-to-agent'
      });
    }

    // If agent was switched from AGENT to CHAT mode, clean up session tracking
    // NOTE: The agent will automatically become inactive in the next scheduler cycle
    // based on AgentActivityService.shouldAgentBeActive() returning false
    if (agent.mode === AGENT_MODES.AGENT && updates.mode === AGENT_MODES.CHAT && this.scheduler) {
      this.logger.info(`Agent mode changed to CHAT - will become inactive: ${agentId}`);
      this.scheduler.removeAgent(agentId, 'mode-change-to-chat');
    }

    this.logger.info(`Agent updated successfully: ${agentId}`, {
      newName: updatedAgent.name,
      changes: Object.keys(updates)
    });

    return updatedAgent;
  }

  /**
   * Agent notification from Message Processor for inter-agent communication
   * @param {string} agentId - Target agent ID
   * @param {Object} message - Message object with agent redirect
   * @returns {Promise<boolean>} Success status
   */
  async notifyAgent(agentId, message) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      this.logger.warn(`Agent notification failed - agent not found: ${agentId}`);
      return false;
    }
    
    // Check if agent is paused
    if (this._isAgentPaused(agent)) {
      this.logger.info(`Agent notification queued - agent is paused: ${agentId}`);
      this._queueNotification(agentId, message);
      return true;
    }
    
    // Add notification to agent's conversation
    const notificationMessage = {
      id: `msg-${Date.now()}`,
      conversationId: message.conversationId,
      agentId: message.from, // sender agent ID
      content: message.content,
      role: MESSAGE_ROLES.SYSTEM,
      timestamp: new Date().toISOString(),
      type: MESSAGE_TYPES.AGENT_NOTIFICATION,
      fromAgent: message.from,
      context: message.context,
      urgent: message.urgent || false,
      requiresResponse: message.requiresResponse || false
    };
    
    // Add to full conversation
    agent.conversations.full.messages.push(notificationMessage);
    agent.conversations.full.lastUpdated = new Date().toISOString();
    
    // Add to current model conversation
    if (agent.currentModel && agent.conversations[agent.currentModel]) {
      const formattedMessage = this._formatMessageForModel(notificationMessage, agent.currentModel);
      agent.conversations[agent.currentModel].messages.push(formattedMessage);
      agent.conversations[agent.currentModel].lastUpdated = new Date().toISOString();
    }
    
    // Update agent activity
    agent.lastActivity = new Date().toISOString();
    await this.persistAgentState(agentId);
    
    this.logger.info(`Agent notified: ${agentId}`, {
      fromAgent: message.from,
      urgent: message.urgent,
      requiresResponse: message.requiresResponse
    });
    
    return true;
  }

  /**
   * Get all agents (returns full agent objects)
   * @returns {Promise<Array>} List of all agent objects
   */
  async getAllAgents() {
    const agents = Array.from(this.agents.values());
    
    // Update pause status for all agents
    for (const agent of agents) {
      this._updateAgentPauseStatus(agent);
    }
    
    return agents;
  }

  /**
   * List all active agents with their current status
   * @returns {Promise<Array>} Array of agent objects
   */
  async listActiveAgents() {
    const agents = Array.from(this.agents.values());
    
    // Update pause status for all agents
    for (const agent of agents) {
      this._updateAgentPauseStatus(agent);
    }
    
    return agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      status: agent.status,
      mode: agent.mode,
      systemPrompt: agent.systemPrompt,
      originalSystemPrompt: agent.originalSystemPrompt,
      preferredModel: agent.preferredModel,
      currentModel: agent.currentModel,
      dynamicModelRouting: agent.dynamicModelRouting,
      routingStrategy: agent.routingStrategy || '',
      skills: agent.skills || [],
      capabilities: agent.capabilities,
      directoryAccess: agent.directoryAccess,
      toolConfig: agent.toolConfig || {},
      lastActivity: agent.lastActivity,
      isPaused: this._isAgentPaused(agent),
      pausedUntil: agent.pausedUntil,
      messageCount: agent.conversations.full.messages.length,
      createdAt: agent.createdAt,
      // First user message snippet for card preview (2 lines max)
      firstUserMessage: this._getFirstUserMessageSnippet(agent)
    }));
  }

  /**
   * Persist agent state to storage
   * @param {string} agentId - Agent identifier
   * @returns {Promise<void>}
   */
  async persistAgentState(agentId) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    await this.stateManager.persistAgentState(agent);
  }

  /**
   * Resume agent from persisted state
   * @param {Object} agentData - Persisted agent data
   * @returns {Promise<Object>} Restored agent object
   */
  async resumeAgent(agentData) {
    const agent = {
      ...agentData,
      status: agentData.status === 'paused' && this._isPauseExpired(agentData) ? 'active' : agentData.status
    };

    // RECOVERY: If agent was paused awaiting user input (e.g., credentials),
    // the promise is now lost due to server/UI restart. Resume the agent.
    if (agent.awaitingUserInput) {
      this.logger.warn(`Agent ${agent.id} was awaiting user input (${agent.awaitingUserInput.type}) - recovering from interrupted state`, {
        inputType: agent.awaitingUserInput.type,
        siteId: agent.awaitingUserInput.siteId,
        startedAt: agent.awaitingUserInput.startedAt
      });

      // Clear the awaiting flag and resume agent
      delete agent.awaitingUserInput;
      agent.status = AGENT_STATUS.ACTIVE;

      // Add a system message to the agent's queue so it knows what happened
      if (!agent.messageQueues) {
        agent.messageQueues = { toolResults: [], interAgentMessages: [], userMessages: [] };
      }
      agent.messageQueues.toolResults.push({
        id: `recovery-${Date.now()}`,
        toolId: 'system-recovery',
        status: 'info',
        result: {
          message: 'Agent was waiting for user input (credentials) when the session was interrupted. The credential request has been cancelled. Please retry the authentication if needed.',
          recoveredFrom: 'awaitingUserInput',
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });
    }

    // Validate conversations structure
    if (!agent.conversations || !agent.conversations.full) {
      agent.conversations = {
        full: {
          messages: [],
          lastUpdated: new Date().toISOString()
        }
      };
    }

    // CRITICAL: Restore interAgentTracking as a Map (it comes as plain object from JSON)
    if (!agent.interAgentTracking || !(agent.interAgentTracking instanceof Map)) {
      // Convert plain object to Map, or create empty Map
      if (agent.interAgentTracking && typeof agent.interAgentTracking === 'object') {
        agent.interAgentTracking = new Map(Object.entries(agent.interAgentTracking));
      } else {
        agent.interAgentTracking = new Map();
      }
    }

    // Add to registry and directory
    this.agents.set(agent.id, agent);
    this._updateAgentDirectory(agent);

    // CRITICAL: Migrate conversation structure to ensure new fields exist
    // This handles agents persisted before the originalMessageCountAtCompaction fix
    await this.migrateConversationStructure(agent.id);

    // Process any queued notifications
    await this._processQueuedNotifications(agent.id);

    this.logger.info(`Agent resumed: ${agent.id}`, {
      name: agent.name,
      status: agent.status,
      messageCount: agent.conversations.full.messages.length
    });

    return agent;
  }

  /**
   * Pause agent for specified duration
   * @param {string} agentId - Agent identifier
   * @param {number|Date} duration - Pause duration in seconds or Date object
   * @param {string} reason - Reason for pause
   * @returns {Promise<Object>} Pause confirmation
   */
  async pauseAgent(agentId, duration, reason = 'Agent pause requested') {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    let pauseUntil;
    if (duration instanceof Date) {
      pauseUntil = duration;
    } else {
      // Duration in seconds
      const maxPauseDuration = this.config.system?.maxPauseDuration || 300;
      const pauseSeconds = Math.min(duration, maxPauseDuration);
      pauseUntil = new Date(Date.now() + pauseSeconds * 1000);
    }
    
    agent.status = AGENT_STATUS.PAUSED;
    agent.pausedUntil = pauseUntil.toISOString();
    agent.lastActivity = new Date().toISOString();
    
    // Add to paused agents tracking
    this.pausedAgents.set(agentId, {
      agentId,
      pausedAt: new Date().toISOString(),
      pausedUntil: pauseUntil.toISOString(),
      reason,
      originalStatus: AGENT_STATUS.ACTIVE
    });
    
    await this.persistAgentState(agentId);
    
    this.logger.info(`Agent paused: ${agentId}`, {
      pausedUntil: pauseUntil.toISOString(),
      reason,
      durationSeconds: Math.round((pauseUntil.getTime() - Date.now()) / 1000)
    });
    
    return {
      success: true,
      agentId,
      pausedUntil: pauseUntil.toISOString(),
      reason,
      message: `Agent paused until ${pauseUntil.toISOString()}`
    };
  }

  /**
   * Resume paused agent
   * @param {string} agentId - Agent identifier
   * @returns {Promise<Object>} Resume confirmation
   */
  async resumeAgent(agentId) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    if (agent.status !== AGENT_STATUS.PAUSED) {
      return {
        success: true,
        message: `Agent ${agentId} is not paused`
      };
    }
    
    agent.status = AGENT_STATUS.ACTIVE;
    agent.pausedUntil = null;
    agent.lastActivity = new Date().toISOString();
    
    // Remove from paused agents tracking
    this.pausedAgents.delete(agentId);
    
    // Process any queued notifications
    await this._processQueuedNotifications(agentId);
    
    await this.persistAgentState(agentId);
    
    this.logger.info(`Agent resumed: ${agentId}`);
    
    return {
      success: true,
      agentId,
      message: `Agent ${agentId} resumed successfully`
    };
  }

  /**
   * Restore agent from saved state
   * @param {Object} agentState - Saved agent state
   * @returns {Promise<Object>} Restored agent
   */
  async restoreAgent(agentState) {
    return await this.resumeAgent(agentState);
  }

  /**
   * Get agent discovery directory
   * @returns {Array} Array of agent info for discovery
   */
  getAgentDirectory() {
    return Array.from(this.agentDirectory.values());
  }

  /**
   * List all active agents
   * @returns {Array} Array of active agents
   */

  /**
   * Delete an agent and clean up its resources
   * @param {string} agentId - Agent identifier
   * @returns {Promise<Object>} Deletion result
   */
  async deleteAgent(agentId) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Clean up file attachments with reference counting
    if (this.fileAttachmentService) {
      try {
        await this.fileAttachmentService.deleteAgentAttachments(agentId);
        this.logger.info(`File attachments cleaned up for agent: ${agentId}`);
      } catch (error) {
        this.logger.warn(`Failed to clean up file attachments for agent: ${error.message}`, { agentId });
        // Continue with agent deletion even if attachment cleanup fails
      }
    }

    // Clean up visual editor instance
    try {
      const visualEditorBridge = getVisualEditorBridge();
      if (visualEditorBridge.hasInstance(agentId)) {
        await visualEditorBridge.stopInstance(agentId);
        this.logger.info(`Visual editor instance cleaned up for agent: ${agentId}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to clean up visual editor for agent: ${error.message}`, { agentId });
    }

    // Kill any running terminal processes for this agent
    try {
      const terminalTool = this.toolsRegistry?.getTool?.('terminal');
      if (terminalTool && typeof terminalTool.cleanupAgent === 'function') {
        await terminalTool.cleanupAgent(agentId);
        this.logger.info(`Terminal processes cleaned up for agent: ${agentId}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to clean up terminal processes for agent: ${error.message}`, { agentId });
    }

    // Clean up agent resources
    this.agents.delete(agentId);
    this.agentDirectory.delete(agentId);
    this.pausedAgents.delete(agentId);
    this.notificationQueue.delete(agentId);
    
    // Clean up persistent state
    try {
      await this.stateManager.deleteAgentState(agentId);
    } catch (error) {
      this.logger.warn(`Failed to delete agent persistent state: ${error.message}`, { agentId });
    }
    
    this.logger.info(`Agent deleted: ${agentId}`, {
      agentName: agent.name,
      totalAgents: this.agents.size
    });
    
    return {
      success: true,
      agentId,
      remainingAgents: this.agents.size
    };
  }

  /**
   * Unload an agent from server memory without deleting persistent files
   * Agent can be reloaded later using the Load Agent feature
   * @param {string} agentId - Agent identifier
   * @returns {Promise<Object>} Unload result
   */
  async unloadAgent(agentId) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const agentName = agent.name;

    // Persist current state before unloading (so it can be reloaded later)
    try {
      await this.persistAgentState(agentId);
      this.logger.info(`Agent state persisted before unload: ${agentId}`);
    } catch (error) {
      this.logger.warn(`Failed to persist agent state before unload: ${error.message}`, { agentId });
    }

    // Clean up visual editor instance
    try {
      const visualEditorBridge = getVisualEditorBridge();
      if (visualEditorBridge.hasInstance(agentId)) {
        await visualEditorBridge.stopInstance(agentId);
        this.logger.info(`Visual editor instance cleaned up for unloaded agent: ${agentId}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to clean up visual editor for unloaded agent: ${error.message}`, { agentId });
    }

    // Remove from memory only (keep persistent files)
    this.agents.delete(agentId);
    this.agentDirectory.delete(agentId);
    this.pausedAgents.delete(agentId);
    this.notificationQueue.delete(agentId);

    // Remove from scheduler if present
    if (this.scheduler) {
      this.scheduler.removeAgent(agentId, 'unloaded');
    }

    this.logger.info(`Agent unloaded from memory: ${agentId}`, {
      agentName,
      totalAgents: this.agents.size,
      note: 'Persistent files preserved for future reload'
    });

    return {
      success: true,
      agentId,
      agentName,
      remainingAgents: this.agents.size,
      message: `Agent "${agentName}" unloaded. Use Load Agent to reload it.`
    };
  }

  /**
   * Clear all conversation history for an agent
   * Resets the agent to a fresh state while keeping configuration
   * @param {string} agentId - Agent identifier
   * @returns {Promise<Object>} Clear result
   */
  async clearConversation(agentId) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const previousMessageCount = agent.conversations?.full?.messages?.length || 0;

    // Reset full conversation
    agent.conversations.full = {
      messages: [],
      lastUpdated: new Date().toISOString()
    };

    // Reset model-specific conversations
    for (const key of Object.keys(agent.conversations)) {
      if (key !== 'full') {
        agent.conversations[key] = {
          messages: [],
          compactizedMessages: null,
          lastUpdated: new Date().toISOString(),
          compactionState: {
            isCompacted: false,
            lastCompactionTime: null,
            originalMessageCount: 0,
            compactedMessageCount: 0
          }
        };
      }
    }

    // Clear message queues
    if (agent.messageQueues) {
      agent.messageQueues = {
        toolResults: [],
        interAgentMessages: [],
        userMessages: []
      };
    }

    // Clear task list
    if (agent.taskList) {
      agent.taskList = {
        tasks: [],
        lastUpdated: new Date().toISOString()
      };
    }

    agent.currentTask = null;
    agent.taskStartTime = null;
    agent.iterationCount = 0;

    // Persist the cleared state
    await this.persistAgentState(agentId);

    this.logger.info(`Conversation cleared for agent: ${agentId}`, {
      agentName: agent.name,
      previousMessageCount
    });

    return {
      success: true,
      agentId,
      previousMessageCount,
      message: `Cleared ${previousMessageCount} messages`
    };
  }

  /**
   * Generate unique agent ID
   * @private
   */
  _generateAgentId(name) {
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const timestamp = Date.now();
    return `agent-${sanitizedName}-${timestamp}`;
  }

  /**
   * Update agent directory for discovery
   * @private
   */
  _updateAgentDirectory(agent) {
    this.agentDirectory.set(agent.id, {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      capabilities: agent.capabilities,
      status: agent.status,
      description: this._generateAgentDescription(agent)
    });
  }

  /**
   * Generate agent description for directory
   * @private
   */
  _generateAgentDescription(agent) {
    let description = `${agent.name} (${agent.type})`;
    
    if (agent.capabilities.length > 0) {
      description += ` - Capabilities: ${agent.capabilities.join(', ')}`;
    }
    
    return description;
  }

  /**
   * Check if agent is currently paused
   * @private
   */
  _isAgentPaused(agent) {
    if (agent.status !== AGENT_STATUS.PAUSED || !agent.pausedUntil) {
      return false;
    }
    
    return new Date() < new Date(agent.pausedUntil);
  }

  /**
   * Get first user message snippet for card preview
   * @private
   */
  _getFirstUserMessageSnippet(agent) {
    const messages = agent.conversations?.full?.messages;
    if (!messages || messages.length === 0) return null;

    // Find first user message — include consolidated-input since that's how
    // user messages are stored after queue processing. Skip task-boundary.
    const firstUser = messages.find(m =>
      m.role === 'user' && m.content &&
      m.type !== 'task-boundary'
    );
    if (!firstUser) return null;

    // Handle both string and array content formats
    const text = typeof firstUser.content === 'string'
      ? firstUser.content
      : Array.isArray(firstUser.content)
        ? firstUser.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
        : null;
    if (!text) return null;

    // Take first 2 non-empty lines, cap at 120 chars
    const lines = text.split('\n').filter(l => l.trim());
    const snippet = lines.slice(0, 2).join('\n');
    return snippet.length > 120 ? snippet.slice(0, 117) + '...' : snippet;
  }

  /**
   * Check if pause duration has expired
   * @private
   */
  _isPauseExpired(agent) {
    if (!agent.pausedUntil) return true;
    return new Date() >= new Date(agent.pausedUntil);
  }

  /**
   * Update agent pause status
   * @private
   */
  _updateAgentPauseStatus(agent) {
    if (agent.status === AGENT_STATUS.PAUSED && this._isPauseExpired(agent)) {
      agent.status = AGENT_STATUS.ACTIVE;
      agent.pausedUntil = null;
      this.pausedAgents.delete(agent.id);
    }
  }

  /**
   * Queue notification for paused agent
   * @private
   */
  _queueNotification(agentId, message) {
    if (!this.notificationQueue.has(agentId)) {
      this.notificationQueue.set(agentId, []);
    }
    
    this.notificationQueue.get(agentId).push({
      ...message,
      queuedAt: new Date().toISOString()
    });
  }

  /**
   * Process queued notifications for agent
   * @private
   */
  async _processQueuedNotifications(agentId) {
    const notifications = this.notificationQueue.get(agentId);
    if (!notifications || notifications.length === 0) {
      return;
    }
    
    this.logger.info(`Processing ${notifications.length} queued notifications for agent: ${agentId}`);
    
    for (const notification of notifications) {
      await this.notifyAgent(agentId, notification);
    }
    
    // Clear queue
    this.notificationQueue.delete(agentId);
  }

  /**
   * Format message for specific model
   * @private
   */
  _formatMessageForModel(message, targetModel) {
    // This would be implemented with model-specific formatting logic
    // For now, return the message as-is
    return { ...message };
  }

  /**
   * Get model format version
   * @private
   */
  _getModelFormatVersion(model) {
    return MODEL_FORMAT_VERSIONS[model] || MODEL_FORMAT_VERSIONS.DEFAULT;
  }

  /**
   * Refresh tool descriptions for an existing agent
   * @param {string} agentId - Agent identifier
   * @param {Object} options - Refresh options
   * @returns {Promise<boolean>} Success status
   */
  async refreshAgentToolDescriptions(agentId, options = {}) {
    const agent = await this.getAgent(agentId);
    if (!agent || !this.toolsRegistry) {
      return false;
    }

    try {
      // Use original prompt if available, otherwise current prompt
      const basePrompt = agent.originalSystemPrompt || agent.systemPrompt;
      
      // Enhance with current tool capabilities
      const enhancedPrompt = this.toolsRegistry.enhanceSystemPrompt(
        basePrompt,
        agent.capabilities,
        {
          compact: options.compact || false,
          includeExamples: options.includeExamples !== false,
          includeUsageGuidelines: options.includeUsageGuidelines !== false,
          includeSecurityNotes: options.includeSecurityNotes !== false
        }
      );

      // Update agent's system prompt
      agent.systemPrompt = enhancedPrompt;
      agent.lastActivity = new Date().toISOString();

      // Persist changes
      await this.persistAgentState(agentId);

      this.logger?.info(`Agent tool descriptions refreshed: ${agentId}`, {
        capabilities: agent.capabilities,
        promptLength: enhancedPrompt.length
      });

      return true;

    } catch (error) {
      this.logger?.error(`Failed to refresh tool descriptions for agent: ${agentId}`, {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Set or update tools registry for the agent pool
   * @param {ToolsRegistry} toolsRegistry - Tools registry instance
   */
  setToolsRegistry(toolsRegistry) {
    this.toolsRegistry = toolsRegistry;
    
    this.logger?.info('Tools registry updated for agent pool', {
      hasRegistry: !!toolsRegistry
    });
  }

  /**
   * Bulk refresh tool descriptions for all agents
   * @param {Object} options - Refresh options
   * @returns {Promise<Object>} Results summary
   */
  async bulkRefreshToolDescriptions(options = {}) {
    const results = {
      total: this.agents.size,
      successful: 0,
      failed: 0,
      skipped: 0
    };

    for (const [agentId, agent] of this.agents.entries()) {
      if (!agent.capabilities || agent.capabilities.length === 0) {
        results.skipped++;
        continue;
      }

      const success = await this.refreshAgentToolDescriptions(agentId, options);
      if (success) {
        results.successful++;
      } else {
        results.failed++;
      }
    }

    this.logger?.info('Bulk tool descriptions refresh completed', results);
    return results;
  }

  /**
   * Set MessageProcessor reference for triggering responses
   * @param {MessageProcessor} messageProcessor - MessageProcessor instance
   */
  setMessageProcessor(messageProcessor) {
    this.messageProcessor = messageProcessor;
  }

  /**
   * Set AgentScheduler reference for managing agent modes
   * @param {AgentScheduler} scheduler - AgentScheduler instance
   */
  setScheduler(scheduler) {
    this.scheduler = scheduler;

    this.logger?.info('AgentScheduler reference set for agent pool', {
      hasScheduler: !!scheduler
    });
  }

  /**
   * Set FileAttachmentService reference for cleaning up attachments
   * @param {FileAttachmentService} fileAttachmentService - FileAttachmentService instance
   */
  setFileAttachmentService(fileAttachmentService) {
    this.fileAttachmentService = fileAttachmentService;

    this.logger?.info('FileAttachmentService reference set for agent pool', {
      hasService: !!fileAttachmentService
    });
  }

  // OLD INTER-AGENT MESSAGE QUEUE SYSTEM REMOVED
  // Now using the new messageQueues system with AgentScheduler
  // Inter-agent messages are queued via addInterAgentMessage() method

  /**
   * Wake an agent out of any paused/delayed state because a message has
   * arrived for it. Shared by addUserMessage / addInterAgentMessage /
   * addToolResult — every inbound path MUST route through this to avoid
   * the "silent queue into a delayed agent" bug where the recipient never
   * wakes up and the message sits until the scheduler back-off naturally
   * expires.
   *
   * Rationale: delays/pauses are "leave this agent alone" signals set by
   * the scheduler on error back-off or by the agentDelayTool for timed
   * waits. Any caller going to the trouble of actually addressing the
   * agent is an explicit "act now" signal that overrides the wait.
   *
   * @param {Object} agent - Agent object (already fetched)
   * @param {string} reason - Source label for logs (e.g. 'user-message',
   *   'inter-agent-message', 'tool-result')
   * @returns {Promise<{wasPaused:boolean, hadDelay:boolean, hadPausedUntil:boolean}>}
   * @private
   */
  async _wakeAgentForMessage(agent, reason) {
    const info = { wasPaused: false, hadDelay: false, hadPausedUntil: false };
    if (!agent) return info;

    // Auto-resume explicitly paused agent.
    if (agent.status === AGENT_STATUS.PAUSED) {
      info.wasPaused = true;
      this.logger.info(`Auto-resuming paused agent ${agent.id} due to ${reason}`);
      await this.resumeAgent(agent.id);
    }

    // Clear scheduler-enforced delay (rate-limit back-off, api-key delay,
    // builtin webTool delay, etc.). Only clear if actually in the future;
    // stale past values don't matter but shouldn't trigger a broadcast.
    if (agent.delayEndTime && new Date(agent.delayEndTime).getTime() > Date.now()) {
      info.hadDelay = true;
      agent.delayEndTime = null;
      this.logger.info(`Cleared scheduler delay for agent ${agent.id} — ${reason} takes precedence`);
    }

    // Defensive: if pausedUntil is set but status isn't PAUSED (shouldn't
    // happen but protects against state drift), clear it too.
    if (agent.pausedUntil && new Date(agent.pausedUntil).getTime() > Date.now()) {
      info.hadPausedUntil = true;
      agent.pausedUntil = null;
    }

    return info;
  }

  /**
   * Broadcast a delay-clear to the WS so the UI's delay chip disappears
   * immediately instead of waiting for the next scheduler tick.
   * @private
   */
  async _broadcastWake(agentId, reason) {
    if (!this.scheduler?.broadcastAgentStateUpdate) return;
    try {
      await this.scheduler.broadcastAgentStateUpdate(agentId, reason);
    } catch (err) {
      this.logger.warn(`Failed to broadcast wake for ${agentId}: ${err.message}`);
    }
  }

  /**
   * Add message to agent's user message queue
   * @param {string} agentId - Agent ID
   * @param {Object} message - User message to queue
   * @returns {Promise<void>}
   */
  async addUserMessage(agentId, message) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Any inbound message — user, inter-agent, or tool-result — takes
    // precedence over scheduler back-off and manual pauses. See
    // _wakeAgentForMessage for the rationale.
    const wakeInfo = await this._wakeAgentForMessage(agent, 'user-message');

    const queuedMessage = {
      ...message,
      id: message.id || `user-msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      queuedAt: new Date().toISOString(),
      timestamp: message.timestamp || new Date().toISOString()
    };

    agent.messageQueues.userMessages.push(queuedMessage);

    // Auto-create a task for AGENT mode agents so the scheduler picks them up.
    // Scheduling condition is purely task-based: has pending tasks AND in agent mode.
    if (agent.mode === AGENT_MODES.AGENT) {
      this._autoCreateTaskForMessage(agent, queuedMessage, 'user', 'high');
    }

    await this.persistAgentState(agentId);

    // If we cleared a delay, surface it on the WS so the delay chip in the
    // chat header disappears without waiting for the next scheduler cycle.
    if (wakeInfo.hadDelay) {
      await this._broadcastWake(agentId, 'user-message-clears-delay');
    }

    this.logger.info(`User message queued for agent: ${agentId}`, {
      messageId: queuedMessage.id,
      queueSize: agent.messageQueues.userMessages.length
    });
  }

  /**
   * Add message to agent's inter-agent message queue
   * @param {string} agentId - Agent ID
   * @param {Object} message - Inter-agent message to queue
   * @returns {Promise<void>}
   */
  async addInterAgentMessage(agentId, message) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // An inter-agent ping from another agent is an explicit "act now"
    // signal and must override any scheduler back-off or manual pause
    // on the recipient. See _wakeAgentForMessage.
    const wakeInfo = await this._wakeAgentForMessage(agent, 'inter-agent-message');

    const queuedMessage = {
      ...message,
      id: message.id || message.messageId || `inter-agent-msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      queuedAt: new Date().toISOString(),
      timestamp: message.timestamp || new Date().toISOString()
    };

    agent.messageQueues.interAgentMessages.push(queuedMessage);

    // Auto-create a task for AGENT mode agents so the scheduler picks them up.
    if (agent.mode === AGENT_MODES.AGENT) {
      const senderName = message.senderName || message.sender || 'Unknown Agent';
      this._autoCreateTaskForMessage(agent, queuedMessage, `inter-agent from ${senderName}`, 'medium');
    }

    await this.persistAgentState(agentId);

    // CRITICAL: Register recipient with scheduler so it has a sessionId for API key resolution.
    // Inter-agent messages carry the sender's sessionId — reuse it for the recipient.
    if (this.scheduler && message.sessionId) {
      await this.scheduler.addAgent(agentId, {
        sessionId: message.sessionId,
        triggeredBy: 'inter-agent-message'
      });
    }

    if (wakeInfo.hadDelay) {
      await this._broadcastWake(agentId, 'inter-agent-message-clears-delay');
    }

    this.logger.info(`Inter-agent message queued for agent: ${agentId}`, {
      messageId: queuedMessage.id,
      sender: message.sender || message.senderName,
      queueSize: agent.messageQueues.interAgentMessages.length,
      sessionRegistered: !!(this.scheduler && message.sessionId)
    });
  }

  /**
   * Add tool result to agent's tool results queue
   * @param {string} agentId - Agent ID
   * @param {Object} toolResult - Tool result to queue
   * @returns {Promise<void>}
   */
  async addToolResult(agentId, toolResult) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Tool results are "external async work finished — continue."
    // If the agent is delayed or paused when a result arrives (e.g. a
    // long image/video render completes while an unrelated rate-limit
    // back-off is still in effect) we wake it so the result can be
    // consumed immediately instead of sitting until the back-off expires.
    const wakeInfo = await this._wakeAgentForMessage(agent, 'tool-result');

    const queuedResult = {
      ...toolResult,
      id: toolResult.id || `tool-result-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      queuedAt: new Date().toISOString(),
      timestamp: toolResult.timestamp || new Date().toISOString()
    };

    agent.messageQueues.toolResults.push(queuedResult);
    await this.persistAgentState(agentId);

    if (wakeInfo.hadDelay) {
      await this._broadcastWake(agentId, 'tool-result-clears-delay');
    }

    this.logger.debug(`Tool result queued for agent: ${agentId}`, {
      toolId: toolResult.toolId,
      status: toolResult.status,
      queueSize: agent.messageQueues.toolResults.length
    });
  }

  /**
   * Auto-create a task from an incoming message for AGENT mode agents.
   * This ensures the scheduler (which uses pending tasks as the sole activation
   * condition for AGENT mode) picks up the agent for processing.
   * @param {Object} agent - Agent object
   * @param {Object} message - The queued message
   * @param {string} source - Source label (e.g. 'user', 'inter-agent from AgentX')
   * @param {string} priority - Task priority ('high', 'medium', 'low')
   * @private
   */
  _autoCreateTaskForMessage(agent, message, source, priority) {
    if (!agent.taskList) {
      agent.taskList = { tasks: [], lastUpdated: new Date().toISOString() };
    }

    const content = message.content || '';
    const titleContent = content.trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    const firstSentence = titleContent.split(/[.!?]/)[0].trim();
    const title = firstSentence.length > 50
      ? firstSentence.substring(0, 47) + '...'
      : firstSentence || 'Process message';

    const isInterAgent = source.startsWith('inter-agent');
    const requiresReply = isInterAgent && message.requiresReply === true;
    const taskTitle = isInterAgent
      ? (requiresReply
          ? `Handle and reply to ${source}: ${title}`
          : `Handle ${source}: ${title}`)
      : `Process ${source} request: ${title}`;
    const taskDescription = isInterAgent
      ? (requiresReply
          ? `Handle ${source} message and reply using the agentcommunication tool with action="reply-to-message": "${content.length > 200 ? content.substring(0, 197) + '...' : content}"`
          : `Handle ${source} message: "${content.length > 200 ? content.substring(0, 197) + '...' : content}"`)
      : `Handle ${source} message: "${content.length > 200 ? content.substring(0, 197) + '...' : content}"`;

    const task = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: taskTitle,
      description: taskDescription,
      status: 'pending',
      priority,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'auto-created',
      messageId: message.id
    };

    agent.taskList.tasks.push(task);
    agent.taskList.lastUpdated = new Date().toISOString();

    this.logger.info(`Auto-created task for ${source} message`, {
      agentId: agent.id,
      taskId: task.id,
      title: task.title
    });
  }

  /**
   * Clear all message queues for an agent
   * @param {string} agentId - Agent ID
   * @returns {Promise<void>}
   */
  async clearAgentQueues(agentId) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    agent.messageQueues.toolResults = [];
    agent.messageQueues.interAgentMessages = [];
    agent.messageQueues.userMessages = [];

    await this.persistAgentState(agentId);

    this.logger.info(`Message queues cleared for agent: ${agentId}`);
  }

  /**
   * Get total queued messages count for an agent
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} Queue counts by type
   */
  async getQueueCounts(agentId) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      return { toolResults: 0, interAgentMessages: 0, userMessages: 0, total: 0 };
    }

    const counts = {
      toolResults: agent.messageQueues.toolResults.length,
      interAgentMessages: agent.messageQueues.interAgentMessages.length,
      userMessages: agent.messageQueues.userMessages.length
    };

    counts.total = counts.toolResults + counts.interAgentMessages + counts.userMessages;

    return counts;
  }

  /**
   * Get messages for AI request - returns compacted if available, otherwise original
   * CRITICAL FIX: Ensures compacted messages stay in sync with new messages after compaction
   * This is the primary method that should be used when preparing messages for AI service
   * @param {string} agentId - Agent ID
   * @param {string} modelId - Model ID
   * @returns {Promise<Array>} Messages array to send to AI
   */
  async getMessagesForAI(agentId, modelId) {
    const ENABLE_COMPACT_DEBUG = process.env.COMPACT_DEBUG === 'true';

    // Helper: Remove trailing empty messages from array (cleans up malformed conversations)
    const cleanTrailingEmptyMessages = (messages) => {
      if (!messages || messages.length === 0) return messages;

      let cleaned = [...messages];
      let removedCount = 0;

      // Remove trailing empty messages
      while (cleaned.length > 0) {
        const lastMsg = cleaned[cleaned.length - 1];
        const content = lastMsg?.content;
        const isEmpty = !content || (typeof content === 'string' && !content.trim());

        if (isEmpty) {
          cleaned.pop();
          removedCount++;
        } else {
          break;
        }
      }

      if (removedCount > 0) {
        this.logger?.warn(`Removed ${removedCount} trailing empty message(s) from conversation`, {
          agentId,
          modelId,
          originalLength: messages.length,
          cleanedLength: cleaned.length
        });
      }

      return cleaned;
    };

    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const conversation = agent.conversations[modelId];
    if (!conversation) {
      this.logger.warn(`No conversation found for model: ${modelId}`, { agentId });
      return [];
    }

    // If no compacted messages exist, return original (cleaned)
    if (!conversation.compactizedMessages) {
      this.logger.debug('Retrieved messages for AI (no compaction)', {
        agentId,
        modelId,
        messageCount: conversation.messages.length
      });

      if (ENABLE_COMPACT_DEBUG) {
        console.log('[GET-MESSAGES-FOR-AI]', {
          agentId,
          modelId,
          returnedArray: 'originalMessages',
          messageCount: conversation.messages.length,
          reason: 'No compacted messages exist'
        });
      }

      return cleanTrailingEmptyMessages(conversation.messages);
    }

    // CRITICAL FIX: Only sync messages added AFTER compaction
    // We track originalMessageCountAtCompaction to know which messages are truly new
    // vs which ones were already included in the compaction (sandwich strategy)
    const compactedLength = conversation.compactizedMessages.length;
    const originalLength = conversation.messages.length;
    // SAFETY: If watermark is null/undefined (bug, migration, or cleared state),
    // fall back to compactedLength — NOT originalLength. Using originalLength silently
    // drops all unsynced messages because (originalLength > originalLength) is always false.
    // Using compactedLength ensures any messages beyond what's in the compacted array get synced.
    const originalCountAtCompaction = conversation.originalMessageCountAtCompaction ?? compactedLength;

    // Only sync if NEW messages were added after compaction
    // (i.e., current original length > original length when compaction happened)
    if (originalLength > originalCountAtCompaction) {
      // New messages exist that weren't present during compaction
      const newMessageCount = originalLength - originalCountAtCompaction;
      const newMessages = conversation.messages.slice(-newMessageCount);

      this.logger.info('Syncing truly new messages after compaction', {
        agentId,
        modelId,
        compactedLength,
        originalLength,
        originalCountAtCompaction,
        newMessageCount,
        newMessageRoles: newMessages.map(m => m.role)
      });

      // Append only the truly new messages to compacted array
      conversation.compactizedMessages.push(...newMessages);

      // Update the tracking to include newly synced messages
      conversation.originalMessageCountAtCompaction = originalLength;

      // Persist the update
      await this.persistAgentState(agentId);
    } else if (originalLength > compactedLength) {
      // Length mismatch but no new messages - this is expected with sandwich compaction
      // The compacted version has fewer messages due to summarization, not missing messages
      this.logger.debug('Compacted messages shorter than original (expected with sandwich compaction)', {
        agentId,
        modelId,
        compactedLength,
        originalLength,
        originalCountAtCompaction,
        note: 'No sync needed - compaction reduces message count'
      });
    }

    this.logger.debug('Retrieved messages for AI (compacted + synced)', {
      agentId,
      modelId,
      messageCount: conversation.compactizedMessages.length,
      wasResynced: originalLength > compactedLength
    });

    if (ENABLE_COMPACT_DEBUG) {
      console.log('[GET-MESSAGES-FOR-AI]', {
        agentId,
        modelId,
        returnedArray: 'compactizedMessages',
        messageCount: conversation.compactizedMessages.length,
        originalMessageCount: conversation.messages.length,
        wasSynced: originalLength > compactedLength,
        syncedMessageCount: originalLength > compactedLength ? originalLength - compactedLength : 0,
        reason: 'Compacted messages exist, returning compacted version'
      });
    }

    return cleanTrailingEmptyMessages(conversation.compactizedMessages);
  }

  /**
   * Add message to conversation (stores in original messages array)
   * @param {string} agentId - Agent ID
   * @param {string} modelId - Model ID
   * @param {Object} message - Message object to add
   * @returns {Promise<void>}
   */
  async addMessageToConversation(agentId, modelId, message) {
    const ENABLE_COMPACT_DEBUG = process.env.COMPACT_DEBUG === 'true';

    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Ensure model conversation exists
    if (!agent.conversations[modelId]) {
      agent.conversations[modelId] = this._createEmptyConversation(modelId);
    }

    const conversation = agent.conversations[modelId];

    // GUARD: Skip empty messages - they should never be added to history
    const messageContent = message.content;
    if (!messageContent || (typeof messageContent === 'string' && !messageContent.trim())) {
      this.logger?.warn(`Skipping empty message for agent ${agentId}`, {
        role: message.role,
        modelId,
        hasContent: !!messageContent
      });
      return; // Don't add empty messages
    }

    const originalLengthBefore = conversation.messages.length;
    const compactedLengthBefore = conversation.compactizedMessages?.length || 0;

    // Always add to original messages (never modify original)
    conversation.messages.push({
      ...message,
      timestamp: message.timestamp || new Date().toISOString()
    });

    // If compacted version exists, also add to it (append new messages after compaction)
    if (conversation.compactizedMessages) {
      conversation.compactizedMessages.push({
        ...message,
        timestamp: message.timestamp || new Date().toISOString()
      });
    }

    conversation.lastUpdated = new Date().toISOString();

    if (ENABLE_COMPACT_DEBUG) {
      console.log('[ADD-MESSAGE-TO-CONVERSATION]', {
        agentId,
        modelId,
        role: message.role,
        hasCompactedVersion: !!conversation.compactizedMessages,
        originalMessages: {
          before: originalLengthBefore,
          after: conversation.messages.length,
          added: 1
        },
        compactizedMessages: conversation.compactizedMessages ? {
          before: compactedLengthBefore,
          after: conversation.compactizedMessages.length,
          added: 1
        } : null,
        behavior: conversation.compactizedMessages ? 'Added to BOTH arrays' : 'Added to original only'
      });
    }

    await this.persistAgentState(agentId);

    this.logger.debug('Message added to conversation', {
      agentId,
      modelId,
      role: message.role,
      hasCompacted: !!conversation.compactizedMessages
    });
  }

  /**
   * Sync pending messages from conversation.messages to compactizedMessages.
   * The scheduler's addMessageToConversation only pushes to conversation.messages,
   * NOT to compactizedMessages. This method syncs any pending messages that haven't
   * been pushed to compactizedMessages yet.
   *
   * MUST be called before compaction reads compactizedMessages, otherwise compaction
   * will process a stale snapshot and the watermark will mark unsynced messages as
   * "already compacted", permanently losing them.
   *
   * @param {string} agentId - Agent ID
   * @param {string} modelId - Model ID
   * @returns {Promise<{synced: number}>} Number of messages synced
   */
  async syncPendingMessages(agentId, modelId) {
    const agent = await this.getAgent(agentId);
    if (!agent) return { synced: 0 };

    const conversation = agent.conversations[modelId];
    if (!conversation || !conversation.compactizedMessages) return { synced: 0 };

    const originalLength = conversation.messages.length;
    const compactedLength = conversation.compactizedMessages.length;
    // SAFETY: Use ?? compactedLength instead of || originalLength to prevent silent message loss
    // when watermark is null (see getMessagesForAI for detailed explanation)
    const originalCountAtCompaction = conversation.originalMessageCountAtCompaction ?? compactedLength;

    if (originalLength > originalCountAtCompaction) {
      const newCount = originalLength - originalCountAtCompaction;
      const newMessages = conversation.messages.slice(-newCount);
      conversation.compactizedMessages.push(...newMessages);
      conversation.originalMessageCountAtCompaction = originalLength;

      this.logger.info('Pre-compaction sync: pushed pending messages to compactizedMessages', {
        agentId,
        modelId,
        synced: newCount,
        newMessageRoles: newMessages.map(m => m.role),
        compactizedMessagesLength: conversation.compactizedMessages.length,
        watermarkWasNull: conversation.originalMessageCountAtCompaction === null
      });

      return { synced: newCount };
    }

    return { synced: 0 };
  }

  /**
   * Update compacted messages after compactization
   * @param {string} agentId - Agent ID
   * @param {string} modelId - Model ID
   * @param {Object} compactionResult - Compaction result with messages and metadata
   * @param {number} [preCompactionMessageCount] - Message count recorded BEFORE compaction started.
   *   If provided, used as the watermark instead of current messages.length. This prevents
   *   messages added DURING compaction from being silently lost.
   * @returns {Promise<void>}
   */
  async updateCompactedMessages(agentId, modelId, compactionResult, preCompactionMessageCount) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Ensure model conversation exists (important for model switching scenarios)
    if (!agent.conversations[modelId]) {
      agent.conversations[modelId] = this._createEmptyConversation(modelId);
      this.logger.debug(`Created conversation for model switching: ${modelId}`);
    }

    const conversation = agent.conversations[modelId];

    // Update compacted messages
    conversation.compactizedMessages = compactionResult.compactedMessages;

    // CRITICAL: Use the pre-compaction watermark if provided, NOT current messages.length.
    // If we use current messages.length, any messages added DURING compaction (e.g., user
    // messages arriving via WebSocket while the summarization API call is in flight) would
    // be marked as "already compacted" even though they weren't in the compaction input.
    // Using the pre-compaction count ensures those messages are detected as "new" by
    // getMessagesForAI's sync logic and properly appended to the compacted array.
    conversation.originalMessageCountAtCompaction = preCompactionMessageCount || conversation.messages.length;

    // Update metadata
    conversation.lastCompactization = new Date().toISOString();
    conversation.compactizationCount += 1;
    conversation.compactizationStrategy = compactionResult.strategy;
    conversation.originalTokenCount = compactionResult.originalTokenCount;
    conversation.compactedTokenCount = compactionResult.compactedTokenCount;
    conversation.tokenCount = compactionResult.compactedTokenCount;
    conversation.lastUpdated = new Date().toISOString();

    await this.persistAgentState(agentId);

    this.logger.info('Compacted messages updated', {
      agentId,
      modelId,
      strategy: compactionResult.strategy,
      originalTokens: compactionResult.originalTokenCount,
      compactedTokens: compactionResult.compactedTokenCount,
      reductionPercent: compactionResult.reductionPercent,
      compactizationCount: conversation.compactizationCount
    });
  }

  /**
   * Clear compacted messages and revert to original
   * Useful for debugging or if compaction needs to be redone
   * @param {string} agentId - Agent ID
   * @param {string} modelId - Model ID
   * @returns {Promise<void>}
   */
  async clearCompactedMessages(agentId, modelId) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const conversation = agent.conversations[modelId];
    if (!conversation) {
      return;
    }

    conversation.compactizedMessages = null;
    conversation.lastCompactization = null;
    conversation.compactizationCount = 0;
    conversation.compactizationStrategy = null;
    conversation.originalTokenCount = 0;
    conversation.compactedTokenCount = 0;
    conversation.tokenCount = 0;
    conversation.originalMessageCountAtCompaction = null;

    await this.persistAgentState(agentId);

    this.logger.info('Compacted messages cleared', { agentId, modelId });
  }

  /**
   * Get compaction metadata for a conversation
   * @param {string} agentId - Agent ID
   * @param {string} modelId - Model ID
   * @returns {Promise<Object|null>} Compaction metadata or null if no compaction
   */
  async getCompactionMetadata(agentId, modelId) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      return null;
    }

    const conversation = agent.conversations[modelId];
    if (!conversation) {
      return null;
    }

    // Return metadata whether compacted or not
    const isCompacted = !!conversation.compactizedMessages;

    return {
      isCompacted,
      lastCompactization: conversation.lastCompactization || null,
      compactizationCount: conversation.compactizationCount || 0,
      strategy: conversation.compactizationStrategy || null,
      originalTokenCount: conversation.originalTokenCount || 0,
      compactedTokenCount: conversation.compactedTokenCount || 0,
      reductionPercent: conversation.originalTokenCount > 0
        ? ((conversation.originalTokenCount - conversation.compactedTokenCount) / conversation.originalTokenCount) * 100
        : 0,
      originalMessages: conversation.messages || [],
      compactedMessages: conversation.compactizedMessages || null,
      originalMessageCount: conversation.messages?.length || 0,
      compactedMessageCount: conversation.compactizedMessages?.length || 0
    };
  }

  /**
   * Migrate existing agent conversations to dual storage structure
   * Ensures backward compatibility with existing agents
   * @param {string} agentId - Agent ID
   * @returns {Promise<boolean>} True if migration was needed and performed
   */
  async migrateConversationStructure(agentId) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      return false;
    }

    let migrated = false;

    // Check each conversation for migration needs
    for (const [modelId, conversation] of Object.entries(agent.conversations)) {
      if (modelId === 'full') continue; // Skip full conversation

      // Check if conversation needs migration (missing new fields)
      if (conversation.compactizedMessages === undefined) {
        // Add new fields
        conversation.compactizedMessages = null;
        conversation.lastCompactization = null;
        conversation.compactizationCount = 0;
        conversation.compactizationStrategy = null;
        conversation.originalTokenCount = 0;
        conversation.compactedTokenCount = 0;
        conversation.originalMessageCountAtCompaction = null;

        migrated = true;

        this.logger.info('Migrated conversation structure', {
          agentId,
          modelId,
          messageCount: conversation.messages?.length || 0
        });
      }

      // CRITICAL: Migrate existing compacted conversations that don't have the new tracking field
      // This prevents the sync bug from re-adding messages already included in compaction
      if (conversation.compactizedMessages && conversation.originalMessageCountAtCompaction === undefined) {
        // Set to current original length to prevent any sync from running
        // This is safe because any truly new messages would have been added to both arrays
        conversation.originalMessageCountAtCompaction = conversation.messages?.length || 0;
        migrated = true;

        this.logger.info('Migrated compaction tracking field', {
          agentId,
          modelId,
          originalMessageCountAtCompaction: conversation.originalMessageCountAtCompaction,
          compactedMessageCount: conversation.compactizedMessages.length
        });
      }
    }

    if (migrated) {
      await this.persistAgentState(agentId);
    }

    return migrated;
  }

  /**
   * Create empty conversation structure with all required fields
   * @private
   * @param {string} modelId - Model ID
   * @returns {Object} Empty conversation structure
   */
  _createEmptyConversation(modelId) {
    return {
      messages: [],
      compactizedMessages: null,
      lastCompactization: null,
      compactizationCount: 0,
      compactizationStrategy: null,
      originalTokenCount: 0,
      compactedTokenCount: 0,
      tokenCount: 0,
      originalMessageCountAtCompaction: null, // Tracks original length at compaction time
      lastUpdated: new Date().toISOString(),
      formatVersion: this._getModelFormatVersion(modelId)
    };
  }
}

export default AgentPool;