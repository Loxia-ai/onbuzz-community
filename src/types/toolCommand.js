/**
 * Tool Command Data Model - Type definitions and validation for tool executions
 * 
 * Purpose:
 * - Define the structure and properties of tool commands and executions
 * - Provide validation functions for tool command data
 * - Handle tool execution lifecycle and state management
 */

import { TOOL_STATUS, TOOL_NAMES, OPERATION_STATUS } from '../utilities/constants.js';

/**
 * Tool Command data model
 * @typedef {Object} ToolCommand
 * @property {string} id - Unique command identifier
 * @property {string} toolId - Tool identifier (e.g., 'terminal', 'filesys')
 * @property {string} command - Command to execute
 * @property {Object} parameters - Command parameters
 * @property {string} status - Execution status (pending, executing, completed, failed)
 * @property {string} agentId - ID of agent executing the command
 * @property {string} conversationId - ID of parent conversation
 * @property {string} messageId - ID of parent message
 * @property {ToolExecution} execution - Execution details
 * @property {ToolMetadata} metadata - Command metadata
 * @property {string} createdAt - ISO timestamp of creation
 * @property {string} [startedAt] - ISO timestamp when execution started
 * @property {string} [completedAt] - ISO timestamp when execution completed
 * @property {number} priority - Command priority (1-5)
 * @property {number} timeout - Timeout in milliseconds
 * @property {number} retryCount - Number of retry attempts
 * @property {number} maxRetries - Maximum retry attempts allowed
 */

/**
 * Tool Execution details
 * @typedef {Object} ToolExecution
 * @property {string} executionId - Unique execution identifier
 * @property {Object} input - Input parameters provided to tool
 * @property {Object} [output] - Tool execution output
 * @property {string} [error] - Error message if execution failed
 * @property {string} [errorCode] - Error code for programmatic handling
 * @property {number} executionTime - Time taken for execution (ms)
 * @property {number} memoryUsage - Memory usage during execution (bytes)
 * @property {number} cpuUsage - CPU usage percentage
 * @property {Object} metrics - Execution metrics and performance data
 * @property {ExecutionLog[]} logs - Execution logs and output
 * @property {Object} environment - Execution environment information
 * @property {string} [workingDirectory] - Working directory for execution
 * @property {Object} [environmentVariables] - Environment variables used
 */  

/**
 * Tool Metadata
 * @typedef {Object} ToolMetadata
 * @property {string} toolVersion - Version of the tool used
 * @property {string[]} capabilities - Tool capabilities used
 * @property {Object} configuration - Tool-specific configuration
 * @property {boolean} requiresAuth - Whether tool requires authentication
 * @property {string[]} dependencies - Tool dependencies
 * @property {Object} constraints - Execution constraints
 * @property {string[]} tags - Metadata tags
 * @property {Object} customFields - Custom metadata fields
 */

/**
 * Execution Log entry
 * @typedef {Object} ExecutionLog
 * @property {string} id - Log entry identifier
 * @property {string} level - Log level (debug, info, warn, error)
 * @property {string} message - Log message
 * @property {string} timestamp - ISO timestamp
 * @property {Object} [data] - Additional log data
 * @property {string} [source] - Log source component
 */

/**
 * Tool Definition
 * @typedef {Object} ToolDefinition
 * @property {string} id - Tool identifier
 * @property {string} name - Human-readable tool name
 * @property {string} description - Tool description
 * @property {string} version - Tool version
 * @property {ToolCapability[]} capabilities - Tool capabilities
 * @property {ParameterSchema} parameterSchema - Parameter validation schema
 * @property {Object} configuration - Default configuration
 * @property {string[]} requiredPermissions - Required permissions
 * @property {Object} constraints - Tool constraints and limits
 * @property {boolean} isAsync - Whether tool executes asynchronously
 * @property {number} defaultTimeout - Default timeout in milliseconds
 */

/**
 * Tool Capability
 * @typedef {Object} ToolCapability
 * @property {string} id - Capability identifier
 * @property {string} name - Capability name
 * @property {string} description - Capability description
 * @property {string[]} commands - Supported commands
 * @property {Object} parameters - Capability-specific parameters
 * @property {Object} constraints - Capability constraints
 */

/**
 * Parameter Schema
 * @typedef {Object} ParameterSchema
 * @property {Object} properties - Parameter definitions
 * @property {string[]} required - Required parameter names
 * @property {Object} additionalProperties - Additional property settings
 * @property {Object} examples - Example parameter sets
 */

/**
 * Tool Command validation functions
 */
export class ToolCommandValidator {
  /**
   * Validate tool command data structure
   * @param {Object} command - Tool command to validate
   * @returns {Object} Validation result
   */
  static validate(command) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!command.id || typeof command.id !== 'string') {
      errors.push('Command ID is required and must be a string');
    }

    if (!command.toolId || typeof command.toolId !== 'string') {
      errors.push('Tool ID is required and must be a string');
    }

    if (!command.command || typeof command.command !== 'string') {
      errors.push('Command is required and must be a string');
    }

    if (!command.agentId || typeof command.agentId !== 'string') {
      errors.push('Agent ID is required and must be a string');
    }

    // Tool ID validation
    if (command.toolId && !Object.values(TOOL_NAMES).includes(command.toolId) && !command.toolId.startsWith('custom_')) {
      warnings.push(`Unknown tool ID: ${command.toolId}`);
    }

    // Status validation
    if (command.status && !Object.values(TOOL_STATUS).includes(command.status)) {
      errors.push(`Invalid tool status: ${command.status}`);
    }

    // Parameters validation
    if (command.parameters && typeof command.parameters !== 'object') {
      errors.push('Parameters must be an object');
    }

    // Priority validation
    if (command.priority !== undefined) {
      if (typeof command.priority !== 'number' || command.priority < 1 || command.priority > 5) {
        errors.push('Priority must be a number between 1 and 5');
      }
    }

    // Timeout validation
    if (command.timeout !== undefined) {
      if (typeof command.timeout !== 'number' || command.timeout < 0) {
        errors.push('Timeout must be a non-negative number');
      }
      
      if (command.timeout > 3600000) { // 1 hour
        warnings.push('Timeout is very long (>1 hour)');
      }
    }

    // Retry validation
    if (command.retryCount !== undefined && typeof command.retryCount !== 'number') {
      errors.push('Retry count must be a number');
    }

    if (command.maxRetries !== undefined && typeof command.maxRetries !== 'number') {
      errors.push('Max retries must be a number');
    }

    if (command.retryCount && command.maxRetries && command.retryCount > command.maxRetries) {
      warnings.push('Retry count exceeds max retries');
    }

    // Execution validation
    if (command.execution) {
      const executionValidation = this.validateExecution(command.execution);
      errors.push(...executionValidation.errors);
      warnings.push(...executionValidation.warnings);
    }

    // Timestamp validation
    const timestampFields = ['createdAt', 'startedAt', 'completedAt'];
    timestampFields.forEach(field => {
      if (command[field] && !this.isValidTimestamp(command[field])) {
        errors.push(`Invalid timestamp for ${field}: ${command[field]}`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate tool execution data
   * @param {Object} execution - Execution data to validate
   * @returns {Object} Validation result
   */
  static validateExecution(execution) {
    const errors = [];
    const warnings = [];

    if (!execution.executionId || typeof execution.executionId !== 'string') {
      errors.push('Execution ID is required and must be a string');
    }

    if (!execution.input || typeof execution.input !== 'object') {
      errors.push('Execution input is required and must be an object');
    }

    if (execution.executionTime !== undefined) {
      if (typeof execution.executionTime !== 'number' || execution.executionTime < 0) {
        errors.push('Execution time must be a non-negative number');
      }
    }

    if (execution.memoryUsage !== undefined) {
      if (typeof execution.memoryUsage !== 'number' || execution.memoryUsage < 0) {
        errors.push('Memory usage must be a non-negative number');
      }
    }

    if (execution.cpuUsage !== undefined) {
      if (typeof execution.cpuUsage !== 'number' || execution.cpuUsage < 0 || execution.cpuUsage > 100) {
        errors.push('CPU usage must be a number between 0 and 100');
      }
    }

    if (execution.logs && !Array.isArray(execution.logs)) {
      errors.push('Execution logs must be an array');
    }

    if (execution.logs) {
      execution.logs.forEach((log, index) => {
        if (!log.level || !log.message || !log.timestamp) {
          errors.push(`Log entry ${index} missing required fields`);
        }
      });
    }

    return { errors, warnings };
  }

  /**
   * Validate tool definition
   * @param {Object} toolDef - Tool definition to validate
   * @returns {Object} Validation result
   */
  static validateToolDefinition(toolDef) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!toolDef.id || typeof toolDef.id !== 'string') {
      errors.push('Tool ID is required and must be a string');
    }

    if (!toolDef.name || typeof toolDef.name !== 'string') {
      errors.push('Tool name is required and must be a string');
    }

    if (!toolDef.description || typeof toolDef.description !== 'string') {
      errors.push('Tool description is required and must be a string');
    }

    if (!toolDef.version || typeof toolDef.version !== 'string') {
      errors.push('Tool version is required and must be a string');
    }

    // Capabilities validation
    if (!toolDef.capabilities || !Array.isArray(toolDef.capabilities)) {
      errors.push('Tool capabilities are required and must be an array');
    }

    if (toolDef.capabilities && toolDef.capabilities.length === 0) {
      warnings.push('Tool has no capabilities defined');
    }

    // Parameter schema validation
    if (toolDef.parameterSchema && typeof toolDef.parameterSchema !== 'object') {
      errors.push('Parameter schema must be an object');
    }

    // Timeout validation
    if (toolDef.defaultTimeout !== undefined) {
      if (typeof toolDef.defaultTimeout !== 'number' || toolDef.defaultTimeout <= 0) {
        errors.push('Default timeout must be a positive number');
      }
    }

    return { errors, warnings };
  }

  /**
   * Validate command parameters against tool definition
   * @param {Object} parameters - Parameters to validate
   * @param {ParameterSchema} schema - Parameter schema
   * @returns {Object} Validation result
   */
  static validateParameters(parameters, schema) {
    const errors = [];
    const warnings = [];

    if (!schema || !schema.properties) {
      return { errors: [], warnings: ['No parameter schema provided'] };
    }

    // Check required parameters
    if (schema.required) {
      schema.required.forEach(paramName => {
        if (!(paramName in parameters)) {
          errors.push(`Required parameter missing: ${paramName}`);
        }
      });
    }

    // Validate parameter types and constraints
    Object.entries(parameters).forEach(([paramName, paramValue]) => {
      const paramDef = schema.properties[paramName];
      
      if (!paramDef) {
        if (!schema.additionalProperties) {
          warnings.push(`Unknown parameter: ${paramName}`);
        }
        return;
      }

      // Type validation
      if (paramDef.type) {
        const actualType = Array.isArray(paramValue) ? 'array' : typeof paramValue;
        if (actualType !== paramDef.type) {
          errors.push(`Parameter ${paramName} must be of type ${paramDef.type}, got ${actualType}`);
        }
      }

      // Range validation for numbers
      if (paramDef.type === 'number') {
        if (paramDef.minimum !== undefined && paramValue < paramDef.minimum) {
          errors.push(`Parameter ${paramName} must be >= ${paramDef.minimum}`);
        }
        if (paramDef.maximum !== undefined && paramValue > paramDef.maximum) {
          errors.push(`Parameter ${paramName} must be <= ${paramDef.maximum}`);
        }
      }

      // Length validation for strings
      if (paramDef.type === 'string') {
        if (paramDef.minLength !== undefined && paramValue.length < paramDef.minLength) {
          errors.push(`Parameter ${paramName} must be at least ${paramDef.minLength} characters`);
        }
        if (paramDef.maxLength !== undefined && paramValue.length > paramDef.maxLength) {
          errors.push(`Parameter ${paramName} must be at most ${paramDef.maxLength} characters`);
        }
      }

      // Enum validation
      if (paramDef.enum && !paramDef.enum.includes(paramValue)) {
        errors.push(`Parameter ${paramName} must be one of: ${paramDef.enum.join(', ')}`);
      }
    });

    return { errors, warnings };
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
 * Tool Command factory functions
 */
export class ToolCommandFactory {
  /**
   * Create a new tool command
   * @param {string} toolId - Tool identifier
   * @param {string} command - Command to execute
   * @param {Object} parameters - Command parameters
   * @param {Object} options - Additional options
   * @returns {ToolCommand} New tool command object
   */
  static create(toolId, command, parameters, options = {}) {
    const now = new Date().toISOString();
    const commandId = this.generateCommandId();
    const executionId = this.generateExecutionId();

    return {
      id: commandId,
      toolId,
      command,
      parameters: parameters || {},
      status: TOOL_STATUS.PENDING,
      agentId: options.agentId || '',
      conversationId: options.conversationId || '',
      messageId: options.messageId || '',
      execution: {
        executionId,
        input: { command, parameters },
        output: null,
        error: null,
        errorCode: null,
        executionTime: 0,
        memoryUsage: 0,
        cpuUsage: 0,
        metrics: {},
        logs: [],
        environment: options.environment || {},
        workingDirectory: options.workingDirectory || null,
        environmentVariables: options.environmentVariables || {}
      },
      metadata: this.createDefaultMetadata(options.metadata),
      createdAt: now,
      startedAt: null,
      completedAt: null,
      priority: options.priority || 3,
      timeout: options.timeout || 30000,
      retryCount: 0,
      maxRetries: options.maxRetries || 3
    };
  }

  /**
   * Create execution log entry
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} data - Additional log data
   * @returns {ExecutionLog} Log entry
   */
  static createLogEntry(level, message, data = null) {
    return {
      id: this.generateLogId(),
      level,
      message,
      timestamp: new Date().toISOString(),
      data,
      source: 'tool-execution'
    };
  }

  /**
   * Create default tool metadata
   * @param {Object} overrides - Metadata overrides
   * @returns {ToolMetadata} Default metadata
   */
  static createDefaultMetadata(overrides = {}) {
    return {
      toolVersion: '1.0.0',
      capabilities: [],
      configuration: {},
      requiresAuth: false,
      dependencies: [],
      constraints: {},
      tags: [],
      customFields: {},
      ...overrides
    };
  }

  /**
   * Generate unique command ID
   * @returns {string} Unique command ID
   */
  static generateCommandId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `cmd_${timestamp}_${random}`;
  }

  /**
   * Generate unique execution ID
   * @returns {string} Unique execution ID
   */
  static generateExecutionId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `exec_${timestamp}_${random}`;
  }

  /**
   * Generate unique log ID
   * @returns {string} Unique log ID
   */
  static generateLogId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 6);
    return `log_${timestamp}_${random}`;
  }
}

/**
 * Tool Command utility functions
 */
export class ToolCommandUtils {
  /**
   * Check if command is still pending
   * @param {ToolCommand} command - Command to check
   * @returns {boolean} True if pending
   */
  static isPending(command) {
    return command.status === TOOL_STATUS.PENDING;
  }

  /**
   * Check if command is currently executing
   * @param {ToolCommand} command - Command to check
   * @returns {boolean} True if executing
   */
  static isExecuting(command) {
    return command.status === TOOL_STATUS.EXECUTING;
  }

  /**
   * Check if command has completed successfully
   * @param {ToolCommand} command - Command to check
   * @returns {boolean} True if completed
   */
  static isCompleted(command) {
    return command.status === TOOL_STATUS.COMPLETED;
  }

  /**
   * Check if command has failed
   * @param {ToolCommand} command - Command to check
   * @returns {boolean} True if failed
   */
  static isFailed(command) {
    return command.status === TOOL_STATUS.FAILED;
  }

  /**
   * Check if command has timed out
   * @param {ToolCommand} command - Command to check
   * @returns {boolean} True if timed out
   */
  static isTimedOut(command) {
    if (!command.startedAt || command.status !== TOOL_STATUS.EXECUTING) {
      return false;
    }

    const startTime = new Date(command.startedAt);
    const now = new Date();
    const elapsed = now.getTime() - startTime.getTime();

    return elapsed > command.timeout;
  }

  /**
   * Calculate command execution time
   * @param {ToolCommand} command - Command to analyze
   * @returns {number|null} Execution time in milliseconds, null if not applicable
   */
  static getExecutionTime(command) {
    if (!command.startedAt) return null;

    const endTime = command.completedAt ? new Date(command.completedAt) : new Date();
    const startTime = new Date(command.startedAt);

    return endTime.getTime() - startTime.getTime();
  }

  /**
   * Get command progress information
   * @param {ToolCommand} command - Command to analyze
   * @returns {Object} Progress information
   */
  static getProgress(command) {
    const executionTime = this.getExecutionTime(command);
    const isTimedOut = this.isTimedOut(command);

    let progressPercentage = 0;
    if (command.status === TOOL_STATUS.COMPLETED) {
      progressPercentage = 100;
    } else if (command.status === TOOL_STATUS.EXECUTING && executionTime) {
      // Estimate progress based on execution time vs timeout
      progressPercentage = Math.min(95, (executionTime / command.timeout) * 100);
    }

    return {
      status: command.status,
      percentage: Math.round(progressPercentage),
      executionTime,
      isTimedOut,
      remainingTime: command.status === TOOL_STATUS.EXECUTING && executionTime 
        ? Math.max(0, command.timeout - executionTime)
        : null
    };
  }

  /**
   * Extract key metrics from command execution
   * @param {ToolCommand} command - Command to analyze
   * @returns {Object} Execution metrics
   */
  static getMetrics(command) {
    const execution = command.execution || {};
    const progress = this.getProgress(command);

    return {
      executionTime: execution.executionTime || progress.executionTime || 0,
      memoryUsage: execution.memoryUsage || 0,
      cpuUsage: execution.cpuUsage || 0,
      status: command.status,
      retryCount: command.retryCount,
      priority: command.priority,
      logEntries: execution.logs ? execution.logs.length : 0,
      hasError: !!execution.error,
      errorCode: execution.errorCode || null
    };
  }

  /**
   * Format command for display
   * @param {ToolCommand} command - Command to format
   * @returns {Object} Formatted command data
   */
  static formatForDisplay(command) {
    const progress = this.getProgress(command);
    const metrics = this.getMetrics(command);

    return {
      id: command.id,
      toolId: command.toolId,
      command: command.command,
      status: command.status,
      progress: progress.percentage,
      executionTime: metrics.executionTime,
      createdAt: command.createdAt,
      startedAt: command.startedAt,
      completedAt: command.completedAt,
      hasError: metrics.hasError,
      retryCount: command.retryCount
    };
  }

  /**
   * Sanitize command for API responses
   * @param {ToolCommand} command - Command to sanitize
   * @returns {Object} Sanitized command data
   */
  static sanitize(command) {
    const sanitized = { ...command };

    // Remove sensitive execution data
    if (sanitized.execution) {
      delete sanitized.execution.environmentVariables;
      delete sanitized.execution.environment;
      
      // Truncate long logs
      if (sanitized.execution.logs && sanitized.execution.logs.length > 10) {
        sanitized.execution.logs = sanitized.execution.logs.slice(-10);
      }
    }

    // Remove sensitive parameters
    if (sanitized.parameters) {
      const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];
      Object.keys(sanitized.parameters).forEach(key => {
        if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
          sanitized.parameters[key] = '[REDACTED]';
        }
      });
    }

    return sanitized;
  }

  /**
   * Create command summary for reporting
   * @param {ToolCommand[]} commands - Commands to summarize
   * @returns {Object} Command summary
   */
  static summarizeCommands(commands) {
    const summary = {
      total: commands.length,
      byStatus: {},
      byTool: {},
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      successRate: 0,
      mostUsedTools: [],
      recentCommands: []
    };

    // Count by status
    Object.values(TOOL_STATUS).forEach(status => {
      summary.byStatus[status] = commands.filter(cmd => cmd.status === status).length;
    });

    // Count by tool
    commands.forEach(command => {
      summary.byTool[command.toolId] = (summary.byTool[command.toolId] || 0) + 1;
      
      const executionTime = this.getExecutionTime(command) || 0;
      summary.totalExecutionTime += executionTime;
    });

    // Calculate averages and rates
    if (commands.length > 0) {
      summary.averageExecutionTime = summary.totalExecutionTime / commands.length;
      const successfulCommands = summary.byStatus[TOOL_STATUS.COMPLETED] || 0;
      summary.successRate = (successfulCommands / commands.length) * 100;
    }

    // Most used tools
    summary.mostUsedTools = Object.entries(summary.byTool)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([toolId, count]) => ({ toolId, count }));

    // Recent commands
    summary.recentCommands = commands
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10)
      .map(cmd => this.formatForDisplay(cmd));

    return summary;
  }
}

export default {
  ToolCommandValidator,
  ToolCommandFactory,
  ToolCommandUtils
};