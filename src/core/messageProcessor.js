/**
 * MessageProcessor - Processes messages from agents, extracts tool commands, executes tools
 * 
 * NEW ARCHITECTURE:
 * - Only handles message queuing and tool execution
 * - No scheduling or autonomous loops (handled by AgentScheduler)
 * - Clean separation of concerns
 */

import { AGENT_MODES } from '../utilities/constants.js';
import TagParser from '../utilities/tagParser.js';
import { TOOL_IDS, COMMAND_FORMATS } from '../utilities/toolConstants.js';
import { getVisualEditorBridge } from '../services/visualEditorBridge.js';
import { VisualEditorTool } from '../tools/visualEditorTool.js';
import { prependSourceHeader } from '../services/messageSource.js';

class MessageProcessor {
  constructor(config, logger, toolsRegistry, agentPool, contextManager, aiService, modelRouterService = null, modelsService = null) {
    this.config = config;
    this.logger = logger;
    this.toolsRegistry = toolsRegistry;
    this.agentPool = agentPool;
    this.contextManager = contextManager;
    this.aiService = aiService;
    this.modelRouterService = modelRouterService;
    this.modelsService = modelsService;
    
    // Active async operations tracking
    this.asyncOperations = new Map();
    
    // Tool execution history
    this.executionHistory = new Map();
    
    // Operation ID counter
    this.operationCounter = 0;
    
    // WebSocket manager for real-time updates
    this.webSocketManager = null;
    
    // AgentScheduler reference
    this.scheduler = null;
    
    // Orchestrator reference (for backward compatibility)
    this.orchestrator = null;
    
    // Initialize TagParser for comprehensive tool command extraction
    this.tagParser = new TagParser();
  }

  /**
   * Set WebSocket manager for real-time UI updates
   * @param {Object} webSocketManager - WebSocket manager instance
   */
  setWebSocketManager(webSocketManager) {
    this.webSocketManager = webSocketManager;
    this.logger?.info('WebSocket manager set for MessageProcessor', {
      hasManager: !!webSocketManager
    });
  }

  /**
   * Set AgentScheduler reference
   * @param {AgentScheduler} scheduler - AgentScheduler instance
   */
  setScheduler(scheduler) {
    this.scheduler = scheduler;
    this.logger?.info('AgentScheduler set for MessageProcessor', {
      hasScheduler: !!scheduler
    });
  }

  /**
   * Main message processing entry point - NEW ARCHITECTURE
   * Simply queues messages for scheduler processing
   * @param {string} agentId - Target agent ID
   * @param {string} message - Message content
   * @param {Object} context - Message context
   * @returns {Promise<Object>} Queuing result
   */
  async processMessage(agentId, message, context = {}) {
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const messageString = typeof message === 'string' ? message : (message ? JSON.stringify(message) : '');
    this.logger.info(`Queueing message for agent: ${agentId}`, {
      messageLength: messageString.length,
      messageType: typeof message,
      isInterAgentMessage: context.isInterAgentMessage,
      contextMessageType: context.messageType || 'user'
    });

    // Determine message type and queue appropriately
    if (context.isInterAgentMessage) {
      // Inter-agent message
      await this.agentPool.addInterAgentMessage(agentId, {
        content: message,
        sender: context.originalSender,
        senderName: context.senderName,
        subject: context.subject || 'Inter-agent message',
        timestamp: new Date().toISOString(),
        sessionId: context.sessionId,
        requiresReply: context.requiresReply || false
      });
    } else {
      // User message
      // Phase 4: Inject visual context if available
      let enhancedMessage = message;
      let visualContextInjected = false;

      try {
        const bridge = getVisualEditorBridge();
        if (bridge.isEnabled() && bridge.hasInstance(agentId)) {
          const visualContext = bridge.getVisualContext(agentId);
          if (visualContext) {
            enhancedMessage = VisualEditorTool.injectContextIntoMessage(message, visualContext);
            visualContextInjected = true;

            this.logger.info(`Visual context injected for agent: ${agentId}`, {
              selector: visualContext.selector,
              sourceFile: visualContext.sourceHint?.file
            });

            // Clear context after injection (configurable)
            if (this.config.visualEditor?.clearContextAfterInjection !== false) {
              bridge.clearVisualContext(agentId);
            }
          }
        }
      } catch (err) {
        // Visual context injection is optional - don't fail the message
        this.logger.warn?.(`Failed to inject visual context: ${err.message}`);
      }

      // Prepend the source attribution header when the message arrived from
      // an external channel (Discord / Telegram). The header is plain text
      // of the form "(Message by alice from Discord > MyGuild > #ops)" and
      // becomes part of the persisted content, so the agent sees it in its
      // LLM context and the operator sees it in the web-UI transcript. The
      // operation is idempotent — re-serialization (state restore, replay)
      // won't double-prefix. Sources of kind web/api/internal produce no
      // header and leave the content untouched. See services/messageSource.js.
      if (context.source) {
        enhancedMessage = prependSourceHeader(enhancedMessage, context.source);
      }

      await this.agentPool.addUserMessage(agentId, {
        content: enhancedMessage,
        role: 'user',
        timestamp: new Date().toISOString(),
        contextReferences: context.contextReferences || [],
        sessionId: context.sessionId,
        visualContextInjected,
        streamingEnabled: context.streamingEnabled !== false, // Pass streaming preference from context
        // Preserve the structured source on the queued message too, so any
        // downstream consumer (logs, analytics, relay) can reason about
        // provenance without re-parsing the inline header.
        source: context.source || null,
        // Flow execution context (if this message is part of a flow)
        isFlowExecution: context.isFlowExecution || false,
        flowRunId: context.flowRunId,
        flowNodeId: context.flowNodeId,
        flowMetadata: context.flowMetadata,
        previousAgentData: context.previousAgentData,
        // v2: typed I/O contract for this node — { inputs, outputs }.
        // Forwarded to the scheduler so the system prompt can advertise
        // the exact named/typed payload the agent must produce.
        nodeContract: context.nodeContract
      });
    }

    // Register session with scheduler for API key resolution
    // NOTE: The scheduler uses AgentActivityService to determine which agents
    // should be active based on their message queues - we just register the session here
    if (this.scheduler) {
      await this.scheduler.addAgent(agentId, {
        triggeredBy: context.isInterAgentMessage ? 'inter-agent-message' : 'user-message',
        sessionId: context.sessionId
      });
    }

    return {
      success: true,
      message: 'Message queued for processing',
      agentId: agentId,
      queuedAt: new Date().toISOString()
    };
  }

  /**
   * Unwrap TagParser format parameters
   * TagParser wraps XML parameters in {value, attributes} objects
   * This method unwraps them to direct values for tool consumption
   * @param {Object} params - Parameters to unwrap
   * @returns {Object} Unwrapped parameters
   */
  unwrapParameters(params) {
    if (!params || typeof params !== 'object') {
      return params;
    }

    // Handle arrays - recursively unwrap each element
    if (Array.isArray(params)) {
      return params.map(item => this.unwrapParameters(item));
    }

    // Check if this is a wrapped value: {value: "...", attributes: {}}
    if ('value' in params && 'attributes' in params && Object.keys(params).length === 2) {
      // This is a wrapped value, return just the value (recursively unwrapped)
      return this.unwrapParameters(params.value);
    }

    // Regular object - unwrap each property recursively
    const unwrapped = {};
    for (const [key, value] of Object.entries(params)) {
      if (value && typeof value === 'object') {
        if ('value' in value && 'attributes' in value && Object.keys(value).length === 2) {
          // TagParser wrapped format: {value: "...", attributes: {}}
          unwrapped[key] = this.unwrapParameters(value.value);

          // Also preserve attributes if tool needs them
          if (value.attributes && Object.keys(value.attributes).length > 0) {
            unwrapped[`${key}_attributes`] = value.attributes;
          }
        } else {
          // Recursively unwrap nested objects/arrays
          unwrapped[key] = this.unwrapParameters(value);
        }
      } else {
        // Primitive value - keep as-is
        unwrapped[key] = value;
      }
    }

    return unwrapped;
  }

  /**
   * Extract tool commands from message content
   * Supports multiple formats: XML, JSON, and simple bracket notation
   * @param {string} message - Message containing tool commands
   * @returns {Promise<Array>} Array of tool commands
   */
  async extractToolCommands(message) {
    const commands = [];
    
    // Use TagParser to extract XML and JSON format commands
    const tagParserCommands = this.tagParser.extractToolCommands(message);
    
    // Process TagParser commands and normalize them
    for (const cmd of tagParserCommands) {
      const normalized = this.tagParser.normalizeToolCommand(cmd);
      commands.push({
        toolId: normalized.toolId,
        content: JSON.stringify(normalized.parameters), // Convert parameters to JSON string for tool execution
        parameters: normalized.parameters,
        type: normalized.type,
        isAsync: normalized.parameters?.async === true,
        raw: normalized.rawContent,
        position: cmd.position || {}
      });
    }
    
    // Also check for simple bracket notation [tool id="..."] for backward compatibility
    const toolPattern = /\[tool\s+id="([^"]+)"(?:\s+async="(true|false)")?\]([\s\S]*?)\[\/tool\]/gi;
    
    console.log('MessageProcessor DEBUG: checking bracket pattern on message length:', message.length);
    
    let match;
    while ((match = toolPattern.exec(message)) !== null) {
      const [fullMatch, toolId, isAsync, content] = match;
      
      console.log('MessageProcessor DEBUG: bracket pattern matched:', {
        toolId: toolId.trim(),
        contentLength: content.trim().length,
        contentPreview: content.trim().substring(0, 100)
      });
      
      // Check if this command was already extracted by TagParser
      const alreadyExtracted = commands.some(cmd => 
        cmd.raw === fullMatch || (cmd.position.start === match.index && cmd.position.end === match.index + fullMatch.length)
      );
      
      if (!alreadyExtracted) {
        console.log('MessageProcessor DEBUG: adding bracket command (not already extracted by TagParser)');
        
        const trimmedContent = content.trim();
        
        // Check if the content inside brackets contains XML tags
        const hasXmlTags = /<[^>]+>/g.test(trimmedContent);
        
        if (hasXmlTags) {
          console.log('MessageProcessor DEBUG: detected XML content inside brackets, parsing with TagParser');
          
          // Decode HTML entities before parsing XML
          const decodedXmlContent = this.tagParser.decodeHtmlEntities(trimmedContent);
          console.log('MessageProcessor DEBUG: HTML decoding changed content:', trimmedContent !== decodedXmlContent);
          
          // Parse the XML content using TagParser
          try {
            const xmlParameters = this.tagParser.parseXMLParameters(decodedXmlContent);
            
            console.log('MessageProcessor DEBUG: XML parameters extracted:', Object.keys(xmlParameters));
            
            // Check if we got valid parameters
            if (!xmlParameters || typeof xmlParameters !== 'object') {
              throw new Error('Invalid XML parameters returned');
            }
            
            // Create a temporary XML command structure for normalization
            const xmlCommand = {
              type: COMMAND_FORMATS.XML,
              toolId: toolId.trim(),
              parameters: xmlParameters,
              rawContent: decodedXmlContent
            };
            
            // Normalize it to get the actions array
            const normalized = this.tagParser.normalizeToolCommand(xmlCommand);
            
            console.log('MessageProcessor DEBUG: normalized XML command:', {
              toolId: normalized.toolId,
              hasActions: !!normalized.parameters.actions,
              actionsLength: normalized.parameters.actions?.length || 0
            });
            
            // Add the properly parsed command
            commands.push({
              toolId: normalized.toolId,
              content: JSON.stringify(normalized.parameters),
              parameters: normalized.parameters,
              type: COMMAND_FORMATS.XML, // Mark as XML since we parsed it
              isAsync: isAsync === 'true',
              raw: fullMatch,
              position: {
                start: match.index,
                end: match.index + fullMatch.length
              }
            });
            
          } catch (error) {
            console.log('MessageProcessor DEBUG: XML parsing failed:', error.message);
            console.log('MessageProcessor DEBUG: falling back to raw bracket format');
            
            // Fall back to treating it as a simple bracket command
            commands.push({
              toolId: toolId.trim(),
              content: trimmedContent,
              type: COMMAND_FORMATS.BRACKET,
              isAsync: isAsync === 'true',
              raw: fullMatch,
              position: {
                start: match.index,
                end: match.index + fullMatch.length
              }
            });
          }
        } else {
          console.log('MessageProcessor DEBUG: no XML detected, treating as simple bracket command');
          
          // Simple bracket command without XML content
          commands.push({
            toolId: toolId.trim(),
            content: trimmedContent,
            type: COMMAND_FORMATS.BRACKET,
            isAsync: isAsync === 'true',
            raw: fullMatch,
            position: {
              start: match.index,
              end: match.index + fullMatch.length
            }
          });
        }
      } else {
        console.log('MessageProcessor DEBUG: bracket command already extracted by TagParser, skipping');
      }
    }
    
    // Extract agent redirects as well (for inter-agent communication)
    const redirects = this.tagParser.extractAgentRedirects(message);
    for (const redirect of redirects) {
      commands.push({
        toolId: TOOL_IDS.AGENT_COMMUNICATION,
        content: JSON.stringify({
          to: redirect.to,
          message: redirect.content,
          urgent: redirect.urgent,
          requiresResponse: redirect.requiresResponse,
          context: redirect.context
        }),
        type: COMMAND_FORMATS.REDIRECT,
        isAsync: false,
        raw: redirect.rawMatch,
        position: {}
      });
    }
    
    this.logger.debug(`Extracted ${commands.length} tool commands from message`, {
      formats: commands.map(c => c.type),
      tools: commands.map(c => c.toolId)
    });
    
    return commands;
  }

  /**
   * Execute tool commands
   * @param {Array} commands - Array of tool commands
   * @param {Object} context - Execution context
   * @returns {Promise<Array>} Array of execution results
   */
  async executeTools(commands, context) {
    const results = [];
    
    for (const command of commands) {
      try {
        const tool = this.toolsRegistry.getTool(command.toolId);
        
        if (!tool) {
          results.push({
            toolId: command.toolId,
            status: 'failed',
            error: `Tool not found: ${command.toolId}`,
            timestamp: new Date().toISOString()
          });
          continue;
        }
        
        this.logger.info(`Executing tool: ${command.toolId}`, {
          agentId: context.agentId,
          isAsync: command.isAsync
        });
        
        let result;
        let toolInput = command.parameters; // Hoisted for artifact tracking access
        if (command.isAsync) {
          result = await this.executeAsyncTool(command, tool, context);
        } else {
          // Synchronous tool execution
          // If we have parameters object, use it. Otherwise parse the content.

          if (!toolInput && command.content) {
            // Content is a string, need to parse it using tool's parseParameters method
            if (typeof tool.parseParameters === 'function') {
              try {
                toolInput = tool.parseParameters(command.content);
                this.logger?.debug(`Parsed parameters for tool: ${command.toolId}`, {
                  parsedKeys: Object.keys(toolInput)
                });
              } catch (error) {
                this.logger?.warn(`Failed to parse parameters for tool: ${command.toolId}`, {
                  error: error.message
                });
                // Fall back to raw content
                toolInput = command.content;
              }
            } else {
              // Tool doesn't have parseParameters, use raw content
              toolInput = command.content;
            }
          }

          // CRITICAL FIX: Unwrap TagParser format before tool execution
          // TagParser wraps XML parameters in {value, attributes} objects
          // This unwrapping makes all tools work consistently
          if (toolInput && typeof toolInput === 'object') {
            toolInput = this.unwrapParameters(toolInput);
          }

          // Pass truncation info to tool for partial execution handling.
          // Re-derive projectDir from directoryAccess in case a previous tool
          // (e.g. terminal change-directory) updated the working directory.
          //
          // toolConfig is this tool's slice of the agent's per-tool config
          // (from agent.toolConfig[toolId]) — null when the agent didn't
          // override anything for this tool, in which case the tool uses
          // its global defaults. Tools that want to support per-agent
          // config read `context.toolConfig` and merge it with their own
          // defaults; tools that ignore it get the same behaviour as
          // before.
          const perToolConfig = (context.agentToolConfig && command.toolId)
            ? context.agentToolConfig[command.toolId] || null
            : null;

          const toolContext = {
            ...context,
            projectDir: context.directoryAccess?.workingDirectory || context.projectDir,
            toolConfig: perToolConfig,
            wasRepaired: command.wasRepaired || false,
            wasTruncated: command.wasTruncated || false
          };

          const toolResult = await tool.execute(toolInput, toolContext);

          // Mark result as partial if input was truncated
          const isPartial = command.wasTruncated || false;

          result = {
            toolId: command.toolId,
            status: isPartial ? 'partial' : 'completed',
            result: toolResult,
            timestamp: new Date().toISOString(),
            ...(isPartial && {
              warning: 'Tool executed with truncated input - AI response exceeded token limit',
              wasTruncated: true
            })
          };
        }
        
        results.push(result);

        // ── Artifact tracking (fire-and-forget) ─────────────────────
        // After successful filesystem writes, persist artifact metadata
        // on the agent object so the UI can display version history.
        // Non-blocking: uses .catch() to avoid disrupting the tool pipeline.
        if (result.status === 'completed' && command.toolId === TOOL_IDS.FILESYSTEM) {
          this._trackArtifacts({ ...command, parameters: toolInput }, result, context)
            .catch(e => this.logger?.warn?.('[Artifacts] tracking failed:', e.message));
        }

        // Store in execution history
        const historyKey = `${context.agentId}-${Date.now()}`;
        this.executionHistory.set(historyKey, {
          ...result,
          agentId: context.agentId,
          sessionId: context.sessionId
        });
        
      } catch (error) {
        this.logger.error(`Tool execution failed: ${command.toolId}`, {
          error: error.message,
          agentId: context.agentId
        });
        
        results.push({
          toolId: command.toolId,
          status: 'failed',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    return results;
  }

  /**
   * Track filesystem write/append operations as artifacts on the agent.
   * Persists lightweight metadata (path, size, timestamp) and the content
   * so the UI can show version history without re-parsing message content.
   *
   * The agent.artifacts map is persisted via the normal persistAgentState flow
   * that already runs after tool execution in AgentScheduler.
   *
   * @param {Object} command - Tool command with parameters
   * @param {Object} result - Execution result
   * @param {Object} context - Execution context (agentId, projectDir)
   * @private
   */
  async _trackArtifacts(command, result, context) {
    try {
      const agent = await this.agentPool?.getAgent?.(context.agentId);
      if (!agent) {
        console.log('[Artifacts] No agent found for', context.agentId);
        return;
      }

      // Initialize artifacts map if needed: { [filePath]: { versions: [...] } }
      if (!agent.artifacts) agent.artifacts = {};

      const toolResult = result.result;
      if (!toolResult?.success) {
        console.log('[Artifacts] Tool result not successful:', { success: toolResult?.success, keys: Object.keys(toolResult || {}) });
        return;
      }

      // Get the actions from the command parameters
      // The AI may send actions at different levels depending on format:
      //   { parameters: { actions: [...] } }  — parsed format
      //   { actions: [...] }                   — top-level format (common)
      //   { parameters: { type: 'write', ... } } — single action
      const params = command.parameters || {};
      const actions = params.actions || command.actions || (params.type ? [params] : []);
      console.log('[Artifacts] Processing', actions.length, 'actions. Param keys:', Object.keys(params), 'cmd keys:', Object.keys(command));
      const resultActions = toolResult.actions || [toolResult];

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const actionResult = resultActions[i] || {};
        const type = action.type || action.action;

        console.log(`[Artifacts] Action[${i}]:`, { type, filePath: action.filePath || action['file-path'], hasContent: !!action.content, contentLen: action.content?.length, actionKeys: Object.keys(action) });

        if ((type === 'write' || type === 'append') && actionResult.success !== false) {
          // AI uses various field names: filePath, file-path, outputPath, path
          const rawPath = action.filePath || action['file-path'] || action.outputPath || action.path;
          const content = action.content;
          if (!rawPath || !content) {
            console.log('[Artifacts] Skipped: missing filePath or content', { filePath: !!rawPath, content: !!content, actionKeys: Object.keys(action) });
            continue;
          }

          // Use the resolved absolute path as key (prevents collisions for same-name files in different dirs)
          // Fall back to raw path if fullPath not available
          const absolutePath = actionResult.fullPath || rawPath;
          const artifactKey = absolutePath.replace(/\\/g, '/');

          // Relative display path (strip working directory prefix)
          const wd = (context.projectDir || '').replace(/\\/g, '/');
          const displayPath = wd && artifactKey.startsWith(wd + '/')
            ? artifactKey.slice(wd.length + 1)
            : artifactKey;

          const version = {
            id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            content,
            timestamp: result.timestamp || new Date().toISOString(),
            action: type,
            size: Buffer.byteLength(content, 'utf8'),
            fullPath: absolutePath,
          };

          if (!agent.artifacts[artifactKey]) {
            agent.artifacts[artifactKey] = { displayPath, versions: [] };
          }

          // Deduplicate: skip if content identical to latest
          const versions = agent.artifacts[artifactKey].versions;
          const latest = versions[versions.length - 1];
          if (latest && latest.content === content) continue;

          versions.push(version);
          console.log('[Artifacts] Tracked:', displayPath, 'v' + versions.length, '(' + version.size + ' bytes)');

          // Cap at 50 versions per file to keep state reasonable
          if (versions.length > 50) {
            versions.splice(0, versions.length - 50);
          }
        }
      }
    } catch (e) {
      this.logger?.warn?.('Artifact tracking failed (non-fatal):', e.message);
    }
  }

  /**
   * Execute async tool
   * @param {Object} command - Tool command
   * @param {Object} tool - Tool instance
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Async operation reference
   */
  async executeAsyncTool(command, tool, context) {
    const operationId = `async-${Date.now()}-${this.operationCounter++}`;
    
    // Create async operation entry
    const operation = {
      id: operationId,
      toolId: command.toolId,
      agentId: context.agentId,
      status: 'pending',
      startTime: new Date().toISOString(),
      context: context
    };
    
    this.asyncOperations.set(operationId, operation);

    // Start async execution
    // If we have parameters object, use it. Otherwise parse the content.
    let toolInput = command.parameters;

    if (!toolInput && command.content) {
      // Content is a string, need to parse it using tool's parseParameters method
      if (typeof tool.parseParameters === 'function') {
        try {
          toolInput = tool.parseParameters(command.content);
        } catch (error) {
          this.logger?.warn(`Failed to parse parameters for async tool: ${command.toolId}`, {
            error: error.message
          });
          // Fall back to raw content
          toolInput = command.content;
        }
      } else {
        // Tool doesn't have parseParameters, use raw content
        toolInput = command.content;
      }
    }

    // CRITICAL FIX: Unwrap TagParser format before tool execution
    // TagParser wraps XML parameters in {value, attributes} objects
    // This unwrapping makes all tools work consistently
    if (toolInput && typeof toolInput === 'object') {
      toolInput = this.unwrapParameters(toolInput);
    }

    tool.execute(toolInput, context)
      .then(result => {
        operation.status = 'completed';
        operation.result = result;
        operation.endTime = new Date().toISOString();
        this.notifyAgentOfToolCompletion(operation);
      })
      .catch(error => {
        operation.status = 'failed';
        operation.error = error.message;
        operation.endTime = new Date().toISOString();
        this.notifyAgentOfToolCompletion(operation);
      });
    
    // Start monitoring
    this.monitorAsyncOperation(operationId);
    
    return {
      toolId: command.toolId,
      status: 'async-pending',
      operationId: operationId,
      message: `Async tool started with operation ID: ${operationId}`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Monitor async operation
   * @param {string} operationId - Operation ID to monitor
   */
  async monitorAsyncOperation(operationId) {
    const checkInterval = 5000; // 5 seconds
    const maxChecks = 120; // 10 minutes max
    let checks = 0;
    
    const monitor = setInterval(() => {
      const operation = this.asyncOperations.get(operationId);
      
      if (!operation) {
        clearInterval(monitor);
        return;
      }
      
      checks++;
      
      if (operation.status !== 'pending' || checks >= maxChecks) {
        clearInterval(monitor);
        
        if (checks >= maxChecks) {
          operation.status = 'timeout';
          operation.error = 'Operation timed out';
          operation.endTime = new Date().toISOString();
          this.notifyAgentOfToolCompletion(operation);
        }
      }
    }, checkInterval);
  }

  /**
   * Notify agent of tool completion
   * @param {Object} operation - Completed operation
   */
  async notifyAgentOfToolCompletion(operation) {
    if (!operation.agentId) return;
    
    try {
      // Queue tool result for the agent
      await this.agentPool.addToolResult(operation.agentId, {
        toolId: operation.toolId,
        status: operation.status,
        result: operation.result,
        error: operation.error,
        executionTime: operation.endTime ? 
          new Date(operation.endTime) - new Date(operation.startTime) : null,
        timestamp: operation.endTime || new Date().toISOString()
      });
      
      // Ensure session is registered for agent (tool results added to queue
      // will cause agent to become active via AgentActivityService)
      if (this.scheduler) {
        await this.scheduler.addAgent(operation.agentId, {
          triggeredBy: 'tool-completion',
          sessionId: operation.context?.sessionId
        });
      }
      
      this.logger.info(`Agent notified of tool completion: ${operation.agentId}`, {
        toolId: operation.toolId,
        status: operation.status
      });
      
    } catch (error) {
      this.logger.error(`Failed to notify agent of tool completion`, {
        agentId: operation.agentId,
        toolId: operation.toolId,
        error: error.message
      });
    }
  }

  /**
   * Get tool status
   * @param {string} operationId - Operation ID
   * @returns {Promise<Object>} Operation status
   */
  async getToolStatus(operationId) {
    const operation = this.asyncOperations.get(operationId);
    
    if (!operation) {
      return {
        status: 'not-found',
        error: `Operation not found: ${operationId}`
      };
    }
    
    return {
      id: operation.id,
      toolId: operation.toolId,
      status: operation.status,
      result: operation.result,
      error: operation.error,
      startTime: operation.startTime,
      endTime: operation.endTime
    };
  }

  /**
   * Extract and execute tools from content
   * Called by AgentScheduler after getting AI response
   * @param {string} content - Content containing tool commands
   * @param {string} agentId - Agent ID
   * @param {Object} context - Execution context
   * @returns {Promise<Array>} Tool execution results
   */
  async extractAndExecuteTools(content, agentId, context) {
    try {
      // Extract tool commands
      const commands = await this.extractToolCommands(content);
      
      if (commands.length === 0) {
        return [];
      }
      
      // Get agent to include its directoryAccess configuration
      const agent = await this.agentPool.getAgent(agentId);

      // Execute tools with agent context including sessionId and directoryAccess
      const toolContext = {
        ...context,
        agentId,
        sessionId: context.sessionId, // Ensure sessionId is explicitly available for tools
        directoryAccess: agent?.directoryAccess, // Include agent's directory access configuration
        projectDir: agent?.directoryAccess?.workingDirectory || agent?.projectDir || context.projectDir, // Extract project directory from directoryAccess
        // Per-agent tool configuration — keyed by tool id. Tools can read
        // their own slice via `context.toolConfig` (injected per-tool in
        // executeTools below) or inspect the full map here if they need
        // cross-tool state. See agentPool.js for the schema contract.
        agentToolConfig: (agent && agent.toolConfig) ? agent.toolConfig : {},
        agentPool: this.agentPool,
        contextManager: this.contextManager,
        aiService: this.aiService,
        messageProcessor: this,
        orchestrator: this.orchestrator
      };
      
      const results = await this.executeTools(commands, toolContext);
      
      this.logger.info(`Executed ${results.length} tools for agent: ${agentId}`, {
        tools: results.map(r => ({ toolId: r.toolId, status: r.status }))
      });
      
      return results;
      
    } catch (error) {
      this.logger.error(`Tool extraction/execution failed for agent: ${agentId}`, {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Stop autonomous execution for an agent
   * Proxy method to AgentScheduler
   * @param {string} agentId - Agent ID to stop
   * @returns {Promise<Object>} Result with agent state
   */
  async stopAutonomousExecution(agentId) {
    if (!this.scheduler) {
      return {
        success: false,
        error: 'Scheduler not available'
      };
    }
    
    return await this.scheduler.stopAgentExecution(agentId);
  }

  /**
   * Inject tool results into conversation
   * @param {string} agentId - Agent ID
   * @param {Array} toolResults - Tool execution results
   * @returns {Promise<void>}
   */
  async injectToolResultsIntoConversation(agentId, toolResults) {
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) return;

    for (const result of toolResults) {
      const toolMessage = {
        id: `tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'system',
        content: this.formatToolResultForAgent(result),
        timestamp: new Date().toISOString(),
        type: 'tool-result',
        toolId: result.toolId,
        status: result.status
      };

      // Add to conversation history
      agent.conversations.full.messages.push(toolMessage);
      
      // Also add to current model conversation if exists
      if (agent.currentModel && agent.conversations[agent.currentModel]) {
        agent.conversations[agent.currentModel].messages.push(toolMessage);
      }
    }

    // Update last activity
    agent.conversations.full.lastUpdated = new Date().toISOString();
    if (agent.currentModel && agent.conversations[agent.currentModel]) {
      agent.conversations[agent.currentModel].lastUpdated = new Date().toISOString();
    }

    await this.agentPool.persistAgentState(agentId);
  }

  /**
   * Format tool result for agent consumption
   * @param {Object} result - Tool execution result
   * @returns {string} Formatted result
   */
  formatToolResultForAgent(result) {
    if (result.status === 'completed') {
      if (typeof result.result === 'object') {
        return `Tool ${result.toolId} completed successfully:\n${JSON.stringify(result.result, null, 2)}`;
      }
      return `Tool ${result.toolId} completed successfully:\n${result.result}`;
    } else if (result.status === 'failed') {
      return `Tool ${result.toolId} failed: ${result.error || 'Unknown error'}`;
    } else if (result.status === 'async-pending') {
      return `Tool ${result.toolId} is running asynchronously (Operation ID: ${result.operationId})`;
    }
    return `Tool ${result.toolId} status: ${result.status}`;
  }
}

export default MessageProcessor;