/**
 * BaseTool - Abstract base class for all tools in the Loxia AI Agents System
 * 
 * Purpose:
 * - Define standardized tool interface
 * - Provide common tool functionality
 * - Handle parameter validation
 * - Manage tool execution lifecycle
 * - Support both sync and async operations
 */

import {
  TOOL_STATUS,
  OPERATION_STATUS,
  ERROR_TYPES,
  SYSTEM_DEFAULTS
} from '../utilities/constants.js';

class BaseTool {
  constructor(config = {}, logger = null) {
    this.id = this.constructor.name.toLowerCase().replace('tool', '');
    this.config = config;
    this.logger = logger;
    
    // Tool capabilities
    this.requiresProject = false;
    this.isAsync = false;
    this.timeout = config.timeout || SYSTEM_DEFAULTS.MAX_TOOL_EXECUTION_TIME;
    this.maxConcurrentOperations = config.maxConcurrentOperations || 1;

    // Built-in delay (ms) after tool execution before agent continues
    // Most tools: 0 (no delay), WebTool: 1000ms (allow browser operations to complete)
    this.builtinDelay = 0;
    
    // Operation tracking
    this.activeOperations = new Map();
    this.operationHistory = [];
    
    // Tool state
    this.isEnabled = config.enabled !== false;
    this.lastUsed = null;
    this.usageCount = 0;
  }

  /**
   * Resolve this tool's effective configuration for a given execution.
   *
   * Precedence (later wins):
   *   1. this.config                    — global defaults (from registerTool)
   *   2. context.toolConfig             — per-agent override from
   *                                       agent.toolConfig[this.id]
   *   3. fallbacks                      — caller-supplied defaults
   *
   * Returns a plain object that tools can read fields off directly, e.g.
   *
   *   const { allowedCommands, blockedCommands } =
   *     this.getEffectiveConfig(context, { allowedCommands: [], blockedCommands: [] });
   *
   * Tools that don't care about per-agent config can keep reading
   * `this.config` as before — this helper is opt-in.
   *
   * @param {object} context  - Tool execution context (from messageProcessor).
   * @param {object} [fallbacks] - Last-resort defaults (optional).
   * @returns {object}
   */
  getEffectiveConfig(context, fallbacks = {}) {
    const perAgent = (context && context.toolConfig && typeof context.toolConfig === 'object' && !Array.isArray(context.toolConfig))
      ? context.toolConfig
      : {};
    return { ...fallbacks, ...(this.config || {}), ...perAgent };
  }

  /**
   * Get tool description for LLM consumption
   * Must be implemented by subclasses
   * @returns {string} Tool description
   */
  getDescription() {
    throw new Error(`Tool ${this.id} must implement getDescription()`);
  }

  /**
   * Get a one-line summary of the tool for compact/layered prompts.
   * Auto-extracts the first non-empty line from getDescription().
   * @returns {string} Brief tool summary
   */
  getSummary() {
    try {
      const desc = this.getDescription();
      const firstLine = desc.split('\n').find(l => l.trim().length > 0);
      return firstLine ? firstLine.trim() : `${this.id} tool`;
    } catch {
      return `${this.id} tool`;
    }
  }

  /**
   * Parse parameters from tool command content
   * Must be implemented by subclasses
   * @param {string} content - Raw tool command content
   * @returns {Object} Parsed parameters object
   */
  parseParameters(content) {
    throw new Error(`Tool ${this.id} must implement parseParameters()`);
  }

  /**
   * Execute tool with parsed parameters
   * Must be implemented by subclasses
   * @param {Object} params - Parsed parameters
   * @param {Object} context - Execution context
   * @returns {Promise<*>} Execution result
   */
  async execute(params, context) {
    throw new Error(`Tool ${this.id} must implement execute()`);
  }

  /**
   * Get tool capabilities metadata
   * @returns {Object} Capabilities object
   */
  getCapabilities() {
    return {
      id: this.id,
      async: this.isAsync,
      requiresProject: this.requiresProject,
      builtinDelay: this.builtinDelay,
      timeout: this.timeout,
      maxConcurrentOperations: this.maxConcurrentOperations,
      enabled: this.isEnabled,
      supportedActions: this.getSupportedActions(),
      parameterSchema: this.getParameterSchema()
    };
  }

  /**
   * Validate tool parameters
   * Can be overridden by subclasses for custom validation
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result with valid flag and error message
   */
  validateParameters(params) {
    try {
      if (!params || typeof params !== 'object') {
        return {
          valid: false,
          error: 'Parameters must be an object'
        };
      }
      
      // Check required parameters
      const requiredParams = this.getRequiredParameters();
      for (const required of requiredParams) {
        if (!(required in params)) {
          return {
            valid: false,
            error: `Missing required parameter: ${required}`
          };
        }
      }
      
      // Validate parameter types
      const typeValidation = this.validateParameterTypes(params);
      if (!typeValidation.valid) {
        return typeValidation;
      }
      
      // Custom validation
      const customValidation = this.customValidateParameters(params);
      if (!customValidation.valid) {
        return customValidation;
      }
      
      return { valid: true };
      
    } catch (error) {
      return {
        valid: false,
        error: `Parameter validation failed: ${error.message}`
      };
    }
  }

  /**
   * Execute tool with full lifecycle management
   * @param {Object} params - Tool parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result with metadata
   */
  async executeWithLifecycle(params, context) {
    const operationId = this.generateOperationId();
    const startTime = Date.now();
    
    // Check if tool is enabled
    if (!this.isEnabled) {
      throw new Error(`Tool ${this.id} is disabled`);
    }
    
    // Check concurrent operation limits
    if (this.activeOperations.size >= this.maxConcurrentOperations) {
      throw new Error(`Tool ${this.id} has reached maximum concurrent operations limit`);
    }
    
    // Validate parameters
    const validation = this.validateParameters(params);
    if (!validation.valid) {
      throw new Error(`Parameter validation failed: ${validation.error}`);
    }
    
    // Create operation record
    const operation = {
      id: operationId,
      toolId: this.id,
      status: TOOL_STATUS.EXECUTING,
      startTime: new Date().toISOString(),
      params,
      context: this.sanitizeContext(context)
    };
    
    this.activeOperations.set(operationId, operation);
    
    try {
      this.logger?.info(`Tool execution started: ${this.id}`, {
        operationId,
        toolId: this.id,
        context: operation.context
      });
      
      // Execute with timeout
      const result = await this.executeWithTimeout(params, context);
      
      // Update operation status
      operation.status = TOOL_STATUS.COMPLETED;
      operation.result = result;
      operation.endTime = new Date().toISOString();
      operation.executionTime = Date.now() - startTime;
      
      // Update tool statistics
      this.lastUsed = new Date().toISOString();
      this.usageCount++;
      
      this.logger?.info(`Tool execution completed: ${this.id}`, {
        operationId,
        executionTime: operation.executionTime,
        success: true
      });
      
      return {
        success: true,
        operationId,
        result,
        executionTime: operation.executionTime,
        toolId: this.id
      };
      
    } catch (error) {
      // Update operation status
      operation.status = TOOL_STATUS.FAILED;
      operation.error = error.message;
      operation.endTime = new Date().toISOString();
      operation.executionTime = Date.now() - startTime;
      
      this.logger?.error(`Tool execution failed: ${this.id}`, {
        operationId,
        error: error.message,
        executionTime: operation.executionTime
      });
      
      throw error;
      
    } finally {
      // Move to history and cleanup
      this.operationHistory.push({ ...operation });
      this.activeOperations.delete(operationId);
      
      // Cleanup old history entries
      this.cleanupHistory();
      
      // Perform tool-specific cleanup
      await this.cleanup(operationId);
    }
  }

  /**
   * Get status of async operation
   * @param {string} operationId - Operation identifier
   * @returns {Promise<Object>} Operation status
   */
  async getStatus(operationId) {
    const operation = this.activeOperations.get(operationId);
    
    if (!operation) {
      // Check history
      const historyEntry = this.operationHistory.find(op => op.id === operationId);
      if (historyEntry) {
        return {
          operationId,
          status: historyEntry.status,
          result: historyEntry.result,
          error: historyEntry.error,
          executionTime: historyEntry.executionTime
        };
      }
      
      return {
        operationId,
        status: OPERATION_STATUS.NOT_FOUND,
        error: 'Operation not found'
      };
    }
    
    return {
      operationId,
      status: operation.status,
      startTime: operation.startTime,
      executionTime: operation.endTime ? 
        new Date(operation.endTime).getTime() - new Date(operation.startTime).getTime() :
        Date.now() - new Date(operation.startTime).getTime()
    };
  }

  /**
   * Resource cleanup after tool execution
   * Can be overridden by subclasses
   * @param {string} operationId - Operation identifier
   * @returns {Promise<void>}
   */
  async cleanup(operationId) {
    // Default implementation - no cleanup needed
  }

  /**
   * Get supported actions for this tool
   * Can be overridden by subclasses
   * @returns {Array<string>} Array of supported action names
   */
  getSupportedActions() {
    return ['execute'];
  }

  /**
   * Get parameter schema for validation
   * Can be overridden by subclasses
   * @returns {Object} Parameter schema
   */
  getParameterSchema() {
    return {
      type: 'object',
      properties: {},
      required: []
    };
  }

  /**
   * Get required parameters
   * Can be overridden by subclasses
   * @returns {Array<string>} Array of required parameter names
   */
  getRequiredParameters() {
    return [];
  }

  /**
   * Validate parameter types
   * Can be overridden by subclasses
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result
   */
  validateParameterTypes(params) {
    // Default implementation - all parameters are valid
    return { valid: true };
  }

  /**
   * Custom parameter validation
   * Can be overridden by subclasses
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result
   */
  customValidateParameters(params) {
    // Default implementation - no custom validation
    return { valid: true };
  }

  /**
   * Execute tool with timeout protection
   * @private
   */
  async executeWithTimeout(params, context) {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${this.timeout}ms`));
      }, this.timeout);
      
      try {
        const result = await this.execute(params, context);
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Generate unique operation ID
   * @private
   */
  generateOperationId() {
    return `${this.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sanitize context for logging
   * @private
   */
  sanitizeContext(context) {
    const sanitized = { ...context };
    
    // Remove sensitive information
    delete sanitized.apiKeys;
    delete sanitized.secrets;
    delete sanitized.passwords;
    
    // Truncate large content
    if (sanitized.content && sanitized.content.length > 500) {
      sanitized.content = sanitized.content.substring(0, 500) + '... [truncated]';
    }
    
    return sanitized;
  }

  /**
   * Cleanup old history entries
   * @private
   */
  cleanupHistory() {
    const maxHistoryEntries = 100;
    if (this.operationHistory.length > maxHistoryEntries) {
      this.operationHistory = this.operationHistory.slice(-maxHistoryEntries);
    }
  }

  /**
   * Get tool usage statistics
   * @returns {Object} Usage statistics
   */
  getUsageStats() {
    return {
      toolId: this.id,
      usageCount: this.usageCount,
      lastUsed: this.lastUsed,
      activeOperations: this.activeOperations.size,
      totalOperations: this.operationHistory.length,
      averageExecutionTime: this.calculateAverageExecutionTime(),
      successRate: this.calculateSuccessRate(),
      isEnabled: this.isEnabled
    };
  }

  /**
   * Calculate average execution time
   * @private
   */
  calculateAverageExecutionTime() {
    const completedOps = this.operationHistory.filter(op => 
      op.status === TOOL_STATUS.COMPLETED && op.executionTime
    );
    
    if (completedOps.length === 0) return 0;
    
    const totalTime = completedOps.reduce((sum, op) => sum + op.executionTime, 0);
    return Math.round(totalTime / completedOps.length);
  }

  /**
   * Calculate success rate
   * @private
   */
  calculateSuccessRate() {
    if (this.operationHistory.length === 0) return 0;
    
    const successfulOps = this.operationHistory.filter(op => 
      op.status === TOOL_STATUS.COMPLETED
    );
    
    return (successfulOps.length / this.operationHistory.length) * 100;
  }

  /**
   * Enable tool
   */
  enable() {
    this.isEnabled = true;
    this.logger?.info(`Tool enabled: ${this.id}`);
  }

  /**
   * Disable tool
   */
  disable() {
    this.isEnabled = false;
    this.logger?.info(`Tool disabled: ${this.id}`);
  }

  /**
   * Reset tool statistics
   */
  resetStats() {
    this.usageCount = 0;
    this.lastUsed = null;
    this.operationHistory = [];
    this.logger?.info(`Tool statistics reset: ${this.id}`);
  }
}

/**
 * ToolsRegistry - Manages registration and discovery of tools
 */
class ToolsRegistry {
  constructor(logger = null) {
    this.logger = logger;
    this.tools = new Map();
    this.toolDescriptions = new Map();
    this.toolSummaries = new Map();
    this.toolCapabilities = new Map();
    this.asyncOperations = new Map();
  }

  /**
   * Register a tool class
   * @param {Class} toolClass - Tool class to register
   * @returns {Promise<void>}
   */
  async registerTool(toolClass) {
    try {
      const tool = new toolClass();

      // Propagate the registry's logger to the tool so the tool's own
      // diagnostic output (`this.logger?.info(...)`, `this.logger?.warn(...)`,
      // etc.) actually reaches the operator's console. Tools extending
      // BaseTool default `this.logger = null` unless the class explicitly
      // passes one to `super()` — and registration never supplied one,
      // which silently swallowed every `this.logger?.…` call in every tool.
      // This made debugging things like "why doesn't the visual-editor
      // tool ever log [VisualEditorTool] lines?" impossible because the
      // logs literally weren't being emitted.
      if (this.logger && !tool.logger) {
        tool.logger = this.logger;
      }

      if (!(tool instanceof BaseTool)) {
        throw new Error(`Tool ${toolClass.name} must extend BaseTool`);
      }
      
      const capabilities = tool.getCapabilities();
      
      // Validate tool implementation
      await this.validateTool(tool);
      
      this.tools.set(tool.id, tool);
      this.toolDescriptions.set(tool.id, tool.getDescription());
      this.toolSummaries.set(tool.id, tool.getSummary());
      this.toolCapabilities.set(tool.id, capabilities);
      
      this.logger?.info(`Tool registered: ${tool.id}`, {
        capabilities: capabilities.supportedActions,
        async: capabilities.async,
        requiresProject: capabilities.requiresProject
      });
      
    } catch (error) {
      this.logger?.error(`Tool registration failed: ${error.message}`, {
        toolClass: toolClass.name
      });
      throw error;
    }
  }

  /**
   * Auto-discover tools in directory
   * @param {string} directory - Directory path to scan
   * @returns {Promise<number>} Number of tools discovered
   */
  async discoverTools(directory) {
    // Implementation would scan directory for tool files
    // For now, return 0
    return 0;
  }

  /**
   * Validate tool implementation
   * @param {BaseTool} tool - Tool instance to validate
   * @returns {Promise<void>}
   */
  async validateTool(tool) {
    // Check required methods
    const requiredMethods = ['getDescription', 'parseParameters', 'execute'];
    
    for (const method of requiredMethods) {
      if (typeof tool[method] !== 'function') {
        throw new Error(`Tool ${tool.id} missing required method: ${method}`);
      }
    }
    
    // Test parameter parsing
    try {
      const testParams = tool.parseParameters('test content');
      if (typeof testParams !== 'object') {
        throw new Error(`Tool ${tool.id} parseParameters must return an object`);
      }
    } catch (error) {
      // Parsing may fail for test content, that's okay
    }
    
    // Validate capabilities
    const capabilities = tool.getCapabilities();
    if (!capabilities || typeof capabilities !== 'object') {
      throw new Error(`Tool ${tool.id} getCapabilities must return an object`);
    }
  }

  /**
   * Get tool by ID
   * @param {string} toolId - Tool identifier
   * @returns {BaseTool|null} Tool instance or null
   */
  getTool(toolId) {
    return this.tools.get(toolId) || null;
  }

  /**
   * Get all tool capabilities for LLM consumption
   * @returns {Object} All tool capabilities
   */
  getToolCapabilities() {
    const capabilities = {};
    
    for (const [toolId, tool] of this.tools.entries()) {
      if (tool.isEnabled) {
        capabilities[toolId] = {
          description: this.toolDescriptions.get(toolId),
          capabilities: this.toolCapabilities.get(toolId),
          usageStats: tool.getUsageStats()
        };
      }
    }
    
    return capabilities;
  }

  /**
   * Execute tool securely with validation
   * @param {string} toolId - Tool identifier
   * @param {Object} params - Tool parameters
   * @param {Object} context - Execution context
   * @returns {Promise<*>} Execution result
   */
  async executeToolSecurely(toolId, params, context) {
    const tool = this.getTool(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }
    
    if (!tool.isEnabled) {
      throw new Error(`Tool is disabled: ${toolId}`);
    }
    
    return await tool.executeWithLifecycle(params, context);
  }

  /**
   * List all registered tools
   * @returns {Array<string>} Array of tool IDs
   */
  listTools() {
    return Array.from(this.tools.keys());
  }

  /**
   * Generate comprehensive tool descriptions for agent system prompts
   * @param {Array<string>} capabilities - Specific tool IDs to include (empty = all)
   * @param {Object} options - Generation options
   * @returns {string} Formatted tool descriptions section
   */
  generateToolDescriptionsForPrompt(capabilities = [], options = {}) {
    const {
      includeExamples = true,
      includeUsageGuidelines = true,
      includeSecurityNotes = true,
      compact = false,
      layered = false
    } = options;

    // Get tools to include — always inject 'help' so agents can query tool docs
    let toolIds = capabilities.length > 0
      ? capabilities.filter(cap => this.tools.has(cap))
      : Array.from(this.tools.keys());

    if (!toolIds.includes('help') && this.tools.has('help')) {
      toolIds.push('help');
    }

    if (toolIds.length === 0) {
      return '';
    }

    let description = '';

    // === LAYERED MODE: Compact index + help tool guidance ===
    if (layered) {
      description += '\n## AVAILABLE TOOLS\n\n';
      description += 'You have access to the following tools. Use the **help** tool to get full documentation before first use of any tool.\n\n';

      for (const toolId of toolIds) {
        const tool = this.tools.get(toolId);
        if (!tool || !tool.isEnabled) continue;
        const summary = this.toolSummaries.get(toolId) || `${toolId} tool`;
        description += `- **${toolId}**: ${summary}\n`;
      }

      // Always include help tool in the list even if not in capabilities
      if (!toolIds.includes('help') && this.tools.has('help')) {
        const helpSummary = this.toolSummaries.get('help') || 'Get full documentation for any tool';
        description += `- **help**: ${helpSummary}\n`;
      }

      description += '\n## HOW TO GET TOOL DOCUMENTATION\n\n';
      description += 'Before using a tool for the first time, retrieve its full documentation:\n\n';
      description += '```json\n';
      description += '{\n';
      description += '  "toolId": "help",\n';
      description += '  "parameters": { "tool": "toolname" }\n';
      description += '}\n';
      description += '```\n\n';
      description += 'To list all available tools with summaries:\n';
      description += '```json\n';
      description += '{\n';
      description += '  "toolId": "help",\n';
      description += '  "parameters": { "list": true }\n';
      description += '}\n';
      description += '```\n\n';

    } else {
      // === STANDARD MODE: Full descriptions ===
      description += '\n## AVAILABLE TOOLS\n\n';
      description += 'You have access to the following tools to perform operations and tasks:\n\n';

      for (const toolId of toolIds) {
        const tool = this.tools.get(toolId);
        if (!tool || !tool.isEnabled) continue;

        try {
          if (compact) {
            // Compact format - just tool name and brief description
            const caps = tool.getCapabilities();
            const actions = caps.supportedActions || ['execute'];
            description += `**${toolId}**: ${actions.join(', ')}\n`;
          } else {
            // Full format - complete tool description
            description += `### ${toolId.toUpperCase()} TOOL\n\n`;
            description += tool.getDescription();
            description += '\n\n---\n\n';
          }
        } catch (error) {
          this.logger?.warn(`Failed to get description for tool: ${toolId}`, {
            error: error.message
          });
        }
      }

      if (compact) {
        description += '\nUse JSON format in markdown code blocks to invoke tools.\n\n';
      }
    }

    // Add comprehensive tool invocation instructions - JSON as the standard format
    description += '## TOOL INVOCATION SYNTAX\n\n';
    description += '**IMPORTANT**: Use JSON format in markdown code blocks to invoke tools:\n\n';
    description += '### Standard Format: JSON in Markdown Code Block\n';
    description += '```\n';
    description += '```json\n';
    description += '{\n';
    description += '  "toolId": "toolname",\n';
    description += '  "parameters": { ... }\n';
    description += '}\n';
    description += '```\n';
    description += '```\n\n';
    description += '**Rules:**\n';
    description += '- Always wrap JSON tool commands in ```json ... ``` blocks\n';
    description += '- Use "toolId" to specify the tool name\n';
    description += '- Use "parameters" object for tool-specific parameters\n';
    description += '- Use "actions" array for tools that support multiple operations\n';
    description += '- **TOOL RESULTS ARE AVAILABLE ONLY AFTER YOUR MESSAGE ENDS**: Tools execute after your entire message is sent. You will NOT see any tool results until your next turn. This means: if the next tool call depends on results from a previous one, they MUST be in separate messages. You may batch independent tool calls in a single message, but never assume or guess the output of a tool — always wait for the actual result in the next turn before proceeding.\n\n';
    description += 'After invoking a tool, WAIT for the actual response. Do NOT generate imaginary responses.\n\n';

    // Add exploration strategy if code-map is available
    if (toolIds.includes('code-map')) {
      description += '## CODE EXPLORATION STRATEGY\n\n';
      description += 'When exploring or understanding code, prefer this efficient workflow over reading entire files:\n\n';
      description += '1. **Discover structure** — Use `file-tree` to see the project layout\n';
      description += '2. **Understand code** — Use `code-map` skeleton to extract signatures, classes, and functions with line numbers\n';
      description += '3. **Zoom in** — Use `code-map` read-range to read only the specific lines you need\n';
      description += '4. **Search** — Use `seek` to find specific terms, then `code-map` read-range to view context around matches\n\n';
      description += 'This avoids wasting context on entire file reads. Reserve `filesystem` read for small files or when you need the complete content.\n';
    }

    return description;
  }

  /**
   * Enhance existing system prompt with tool descriptions
   * @param {string} existingPrompt - Current system prompt
   * @param {Array<string>} capabilities - Agent capabilities
   * @param {Object} options - Enhancement options
   * @returns {string} Enhanced system prompt
   */
  enhanceSystemPrompt(existingPrompt, capabilities = [], options = {}) {
    const toolSection = this.generateToolDescriptionsForPrompt(capabilities, options);

    if (!toolSection.trim()) {
      return existingPrompt || '';
    }

    const prompt = existingPrompt || '';
    
    // If prompt already contains tool section, replace it
    if (prompt.includes('## AVAILABLE TOOLS')) {
      return prompt.replace(
        /## AVAILABLE TOOLS[\s\S]*?(?=##|$)/,
        toolSection + '\n'
      );
    }

    const orientationParagraph = `IMPORTANT: Tools execute only after your full message is sent — you cannot see results mid-message. If a tool call depends on the result of another, put them in separate messages. You may batch independent tool calls in one message. Never guess or fabricate tool output — always wait for actual results before continuing.`;

    // Otherwise, append to the end
    return prompt + (prompt.endsWith('\n') ? '' : '\n') + toolSection + orientationParagraph + '\n';
  }

  /**
   * Get available tools with metadata for web UI
   * @returns {Array} Array of tool information objects
   */
  getAvailableToolsForUI() {
    const tools = [];

    for (const [toolId, tool] of this.tools.entries()) {
      const capabilities = tool.getCapabilities();

      // Extract tool name and description from the tool's description
      const fullDescription = tool.getDescription();
      const firstLine = fullDescription.split('\n').find(line => line.trim().length > 0) || '';
      const toolName = firstLine.replace(/^.*Tool:\s*/i, '').replace(/\s*-.*$/, '').trim();

      tools.push({
        id: toolId, // This is the correct ID to use in capabilities
        name: toolName || toolId.charAt(0).toUpperCase() + toolId.slice(1),
        description: firstLine,
        category: this._getToolCategory(toolId),
        // Heroicon name (outline variant) for the web-UI to render — lets
        // every tool-selection surface share a single icon source without
        // each frontend component maintaining its own map. Frontend falls
        // back to WrenchScrewdriver if the name doesn't resolve.
        iconName: this._getToolIconName(toolId),
        enabled: capabilities.enabled,
        async: capabilities.async,
        requiresProject: capabilities.requiresProject,
        className: tool.constructor.name
      });
    }

    return tools.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get tool category for organization
   * @param {string} toolId - Tool identifier
   * @returns {string} Tool category
   * @private
   */
  _getToolCategory(toolId) {
    const categories = {
      'terminal': 'System',
      'filesystem': 'File Operations',
      'file-content-replace': 'File Operations',
      'seek': 'File Operations',
      'file-tree': 'File Operations',
      'code-map': 'Analysis',
      'pdf': 'File Operations',
      'web': 'Automation',
      'visual-editor': 'Automation',
      'staticanalysis': 'Analysis',
      'clonedetection': 'Analysis',
      'import-analyzer': 'Analysis',
      'dependency-resolver': 'Analysis',
      // Sora replacement (Sora 2 via Azure Foundry) is live again as of
      // April 2026 — the deployment-name mismatch that caused 404s was
      // fixed in services/llmServiceFactory.js and the tool is exposed
      'taskmanager': 'Utility',
      'jobdone': 'Utility',
      'agentdelay': 'Utility',
      'userprompt': 'Utility',
      'memory': 'Knowledge',
      'skills': 'Knowledge',
      'agentcommunication': 'Collaboration',
      'help': 'System',
      'doc': 'File Operations',
      'spreadsheet': 'File Operations',
    };

    return categories[toolId] || 'Other';
  }

  /**
   * Map tool id → Heroicon (outline variant) name. The web-UI uses this
   * to render an icon next to each tool in selector dropdowns without
   * having to maintain its own per-surface icon map. Unknown tools
   * render the generic wrench.
   * @param {string} toolId
   * @returns {string}
   * @private
   */
  _getToolIconName(toolId) {
    const icons = {
      'terminal':             'CommandLine',
      'filesystem':           'FolderOpen',
      'file-content-replace': 'DocumentText',
      'seek':                 'MagnifyingGlassCircle',
      'file-tree':            'ListBullet',
      'code-map':             'MapIcon',
      'pdf':                  'DocumentText',
      'doc':                  'DocumentText',
      'spreadsheet':          'TableCells',
      'staticanalysis':       'CodeBracket',
      'clonedetection':       'DocumentDuplicate',
      'import-analyzer':      'MagnifyingGlass',
      'dependency-resolver':  'ArrowsPointingOut',
      'web':                  'GlobeAlt',
      'visual-editor':        'CursorArrowRays',
      'taskmanager':          'ClipboardDocumentList',
      'jobdone':              'CheckCircle',
      'agentcommunication':   'ChatBubbleLeftRight',
      'agentdelay':           'Clock',
      'memory':               'CircleStack',
      'skills':               'BookOpen',
      'userprompt':           'QuestionMarkCircle',
      'help':                 'QuestionMarkCircle',
    };
    return icons[toolId] || 'WrenchScrewdriver';
  }

  /**
   * Get registry statistics
   * @returns {Object} Registry statistics
   */
  getRegistryStats() {
    const enabledTools = Array.from(this.tools.values()).filter(tool => tool.isEnabled);
    const totalOperations = Array.from(this.tools.values())
      .reduce((sum, tool) => sum + tool.usageCount, 0);
    
    return {
      totalTools: this.tools.size,
      enabledTools: enabledTools.length,
      totalOperations,
      activeOperations: this.asyncOperations.size
    };
  }
}

export { BaseTool, ToolsRegistry };