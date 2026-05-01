/**
 * AsyncToolManager - Manage long-running tool operations and status monitoring
 * 
 * Purpose:
 * - Track async tool operations across the system
 * - Provide status monitoring and updates
 * - Handle operation timeouts and cleanup
 * - Coordinate between tools and message processor
 * - Enable operation cancellation and recovery
 */

import EventEmitter from 'events';
import {
  TOOL_STATUS,
  SYSTEM_DEFAULTS
} from '../utilities/constants.js';

class AsyncToolManager extends EventEmitter {
  constructor(config = {}, logger = null) {
    super();
    
    this.config = config;
    this.logger = logger;
    
    // Active operations tracking
    this.operations = new Map();
    
    // Operation history for debugging
    this.operationHistory = [];
    
    // Configuration
    this.maxConcurrentOperations = config.maxConcurrentOperations || 10;
    this.defaultTimeout = config.defaultTimeout || 300000; // 5 minutes
    this.cleanupInterval = config.cleanupInterval || 60000; // 1 minute
    this.maxHistorySize = config.maxHistorySize || 1000;
    
    // Status monitoring
    this.monitoringInterval = null;
    this.isShuttingDown = false;
    
    // Start monitoring
    this.startMonitoring();
    
    // Bind event handlers
    this.on('operation:started', this.handleOperationStarted.bind(this));
    this.on('operation:completed', this.handleOperationCompleted.bind(this));
    this.on('operation:failed', this.handleOperationFailed.bind(this));
    this.on('operation:timeout', this.handleOperationTimeout.bind(this));
  }

  /**
   * Start a new async operation
   * @param {string} toolId - Tool identifier
   * @param {string} agentId - Agent identifier
   * @param {Object} parameters - Operation parameters
   * @param {Object} context - Execution context
   * @returns {Promise<string>} Operation ID
   */
  async startOperation(toolId, agentId, parameters, context = {}) {
    if (this.operations.size >= this.maxConcurrentOperations) {
      throw new Error(`Maximum concurrent operations reached (${this.maxConcurrentOperations})`);
    }
    
    const operationId = this.generateOperationId();
    const operation = {
      id: operationId,
      toolId,
      agentId,
      parameters,
      context,
      status: TOOL_STATUS.PENDING,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      timeout: context.timeout || this.defaultTimeout,
      result: null,
      error: null,
      progress: null,
      retryCount: 0,
      maxRetries: context.maxRetries || 0
    };
    
    this.operations.set(operationId, operation);
    
    this.logger?.info(`Async operation started: ${operationId}`, {
      toolId,
      agentId,
      parametersCount: Object.keys(parameters).length,
      timeout: operation.timeout
    });
    
    // Set timeout
    this.setOperationTimeout(operationId);
    
    // Emit event
    this.emit('operation:started', operation);
    
    return operationId;
  }

  /**
   * Update operation status
   * @param {string} operationId - Operation identifier
   * @param {string} status - New status
   * @param {Object} data - Additional data (result, error, progress)
   * @returns {boolean} Success status
   */
  updateOperation(operationId, status, data = {}) {
    const operation = this.operations.get(operationId);
    if (!operation) {
      this.logger?.warn(`Attempted to update unknown operation: ${operationId}`);
      return false;
    }
    
    const previousStatus = operation.status;
    operation.status = status;
    
    // Update timestamps
    if (status === TOOL_STATUS.EXECUTING && !operation.startedAt) {
      operation.startedAt = new Date().toISOString();
    }
    
    if (status === TOOL_STATUS.COMPLETED || status === TOOL_STATUS.FAILED) {
      operation.completedAt = new Date().toISOString();
    }
    
    // Update data
    if (data.result !== undefined) operation.result = data.result;
    if (data.error !== undefined) operation.error = data.error;
    if (data.progress !== undefined) operation.progress = data.progress;
    
    this.logger?.debug(`Operation status updated: ${operationId}`, {
      previousStatus,
      newStatus: status,
      hasResult: !!data.result,
      hasError: !!data.error,
      progress: data.progress
    });
    
    // Emit appropriate events
    switch (status) {
      case TOOL_STATUS.COMPLETED:
        this.emit('operation:completed', operation);
        break;
      case TOOL_STATUS.FAILED:
        this.emit('operation:failed', operation);
        break;
      case TOOL_STATUS.EXECUTING:
        this.emit('operation:progress', operation);
        break;
    }
    
    return true;
  }

  /**
   * Get operation status
   * @param {string} operationId - Operation identifier
   * @returns {Object|null} Operation details or null if not found
   */
  getOperation(operationId) {
    const operation = this.operations.get(operationId);
    if (!operation) return null;
    
    return {
      id: operation.id,
      toolId: operation.toolId,
      agentId: operation.agentId,
      status: operation.status,
      createdAt: operation.createdAt,
      startedAt: operation.startedAt,
      completedAt: operation.completedAt,
      result: operation.result,
      error: operation.error,
      progress: operation.progress,
      retryCount: operation.retryCount,
      executionTime: this.calculateExecutionTime(operation)
    };
  }

  /**
   * Get all operations for an agent
   * @param {string} agentId - Agent identifier
   * @returns {Array<Object>} Array of operation details
   */
  getAgentOperations(agentId) {
    const operations = [];
    
    for (const operation of this.operations.values()) {
      if (operation.agentId === agentId) {
        operations.push(this.getOperation(operation.id));
      }
    }
    
    return operations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Cancel an operation
   * @param {string} operationId - Operation identifier
   * @param {string} reason - Cancellation reason
   * @returns {boolean} Success status
   */
  async cancelOperation(operationId, reason = 'Operation cancelled') {
    const operation = this.operations.get(operationId);
    if (!operation) return false;
    
    if (operation.status === TOOL_STATUS.COMPLETED || operation.status === TOOL_STATUS.FAILED) {
      this.logger?.warn(`Cannot cancel completed/failed operation: ${operationId}`);
      return false;
    }
    
    // Update status
    this.updateOperation(operationId, TOOL_STATUS.CANCELLED, {
      error: reason
    });
    
    // Clear timeout
    this.clearOperationTimeout(operationId);
    
    // Emit cancellation event
    this.emit('operation:cancelled', operation);
    
    // Move to history and cleanup
    await this.cleanupOperation(operationId);
    
    this.logger?.info(`Operation cancelled: ${operationId}`, { reason });
    
    return true;
  }

  /**
   * Retry a failed operation
   * @param {string} operationId - Operation identifier
   * @returns {Promise<boolean>} Success status
   */
  async retryOperation(operationId) {
    const operation = this.operations.get(operationId);
    if (!operation) return false;
    
    if (operation.status !== TOOL_STATUS.FAILED) {
      this.logger?.warn(`Cannot retry non-failed operation: ${operationId}`);
      return false;
    }
    
    if (operation.retryCount >= operation.maxRetries) {
      this.logger?.warn(`Maximum retries exceeded for operation: ${operationId}`);
      return false;
    }
    
    // Reset operation state
    operation.retryCount++;
    operation.status = TOOL_STATUS.PENDING;
    operation.startedAt = null;
    operation.completedAt = null;
    operation.error = null;
    operation.result = null;
    
    // Reset timeout
    this.setOperationTimeout(operationId);
    
    this.logger?.info(`Operation retry initiated: ${operationId}`, {
      retryCount: operation.retryCount,
      maxRetries: operation.maxRetries
    });
    
    this.emit('operation:retry', operation);
    
    return true;
  }

  /**
   * Get system-wide operation statistics
   * @returns {Object} Operation statistics
   */
  getStatistics() {
    const stats = {
      total: this.operations.size,
      byStatus: {},
      byTool: {},
      byAgent: {},
      averageExecutionTime: 0,
      oldestOperation: null,
      newestOperation: null
    };
    
    let totalExecutionTime = 0;
    let executionCount = 0;
    let oldestTime = null;
    let newestTime = null;
    
    for (const operation of this.operations.values()) {
      // Count by status
      stats.byStatus[operation.status] = (stats.byStatus[operation.status] || 0) + 1;
      
      // Count by tool
      stats.byTool[operation.toolId] = (stats.byTool[operation.toolId] || 0) + 1;
      
      // Count by agent
      stats.byAgent[operation.agentId] = (stats.byAgent[operation.agentId] || 0) + 1;
      
      // Calculate execution time
      const execTime = this.calculateExecutionTime(operation);
      if (execTime > 0) {
        totalExecutionTime += execTime;
        executionCount++;
      }
      
      // Track oldest/newest
      const createdTime = new Date(operation.createdAt).getTime();
      if (!oldestTime || createdTime < oldestTime) {
        oldestTime = createdTime;
        stats.oldestOperation = operation.id;
      }
      if (!newestTime || createdTime > newestTime) {
        newestTime = createdTime;
        stats.newestOperation = operation.id;
      }
    }
    
    stats.averageExecutionTime = executionCount > 0 ? Math.round(totalExecutionTime / executionCount) : 0;
    
    return stats;
  }

  /**
   * Clean up completed operations
   * @param {number} maxAge - Maximum age in milliseconds (default: 1 hour)
   * @returns {number} Number of operations cleaned up
   */
  async cleanupCompletedOperations(maxAge = 3600000) {
    const cutoffTime = Date.now() - maxAge;
    const toCleanup = [];
    
    for (const operation of this.operations.values()) {
      if ((operation.status === TOOL_STATUS.COMPLETED || operation.status === TOOL_STATUS.FAILED || operation.status === TOOL_STATUS.CANCELLED) &&
          new Date(operation.completedAt).getTime() < cutoffTime) {
        toCleanup.push(operation.id);
      }
    }
    
    for (const operationId of toCleanup) {
      await this.cleanupOperation(operationId);
    }
    
    this.logger?.debug(`Cleaned up ${toCleanup.length} completed operations`);
    
    return toCleanup.length;
  }

  /**
   * Start monitoring operations
   * @private
   */
  startMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    this.monitoringInterval = setInterval(() => {
      this.checkOperationTimeouts();
      this.cleanupCompletedOperations();
    }, this.cleanupInterval);
    
    this.logger?.info('Async tool manager monitoring started');
  }

  /**
   * Stop monitoring operations
   * @private
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    this.logger?.info('Async tool manager monitoring stopped');
  }

  /**
   * Check for operation timeouts
   * @private
   */
  checkOperationTimeouts() {
    const now = Date.now();
    
    for (const operation of this.operations.values()) {
      if (operation.status === TOOL_STATUS.EXECUTING || operation.status === TOOL_STATUS.PENDING) {
        const createdTime = new Date(operation.createdAt).getTime();
        if (now - createdTime > operation.timeout) {
          this.handleOperationTimeout(operation);
        }
      }
    }
  }

  /**
   * Set timeout for operation
   * @private
   */
  setOperationTimeout(operationId) {
    const operation = this.operations.get(operationId);
    if (!operation) return;
    
    operation.timeoutHandle = setTimeout(() => {
      this.handleOperationTimeout(operation);
    }, operation.timeout);
  }

  /**
   * Clear timeout for operation
   * @private
   */
  clearOperationTimeout(operationId) {
    const operation = this.operations.get(operationId);
    if (operation && operation.timeoutHandle) {
      clearTimeout(operation.timeoutHandle);
      delete operation.timeoutHandle;
    }
  }

  /**
   * Generate unique operation ID
   * @private
   */
  generateOperationId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `op-${timestamp}-${random}`;
  }

  /**
   * Calculate execution time for operation
   * @private
   */
  calculateExecutionTime(operation) {
    if (!operation.startedAt) return 0;
    
    const endTime = operation.completedAt 
      ? new Date(operation.completedAt).getTime()
      : Date.now();
    
    return endTime - new Date(operation.startedAt).getTime();
  }

  /**
   * Move operation to history and remove from active
   * @private
   */
  async cleanupOperation(operationId) {
    const operation = this.operations.get(operationId);
    if (!operation) return;
    
    // Clear timeout
    this.clearOperationTimeout(operationId);
    
    // Add to history
    this.operationHistory.push({
      ...operation,
      executionTime: this.calculateExecutionTime(operation),
      cleanedUpAt: new Date().toISOString()
    });
    
    // Trim history if needed
    if (this.operationHistory.length > this.maxHistorySize) {
      this.operationHistory = this.operationHistory.slice(-this.maxHistorySize);
    }
    
    // Remove from active operations
    this.operations.delete(operationId);
    
    this.emit('operation:cleanup', { operationId, toolId: operation.toolId });
  }

  /**
   * Event handler for operation started
   * @private
   */
  handleOperationStarted(operation) {
    this.logger?.debug(`Operation started: ${operation.id}`, {
      toolId: operation.toolId,
      agentId: operation.agentId
    });
  }

  /**
   * Event handler for operation completed
   * @private
   */
  async handleOperationCompleted(operation) {
    this.logger?.info(`Operation completed: ${operation.id}`, {
      toolId: operation.toolId,
      agentId: operation.agentId,
      executionTime: this.calculateExecutionTime(operation)
    });
    
    // Schedule cleanup
    setTimeout(() => this.cleanupOperation(operation.id), 30000); // 30 seconds
  }

  /**
   * Event handler for operation failed
   * @private
   */
  async handleOperationFailed(operation) {
    this.logger?.error(`Operation failed: ${operation.id}`, {
      toolId: operation.toolId,
      agentId: operation.agentId,
      error: operation.error,
      executionTime: this.calculateExecutionTime(operation),
      retryCount: operation.retryCount
    });
    
    // Attempt retry if allowed
    if (operation.retryCount < operation.maxRetries) {
      setTimeout(() => this.retryOperation(operation.id), 5000); // 5 second delay
    } else {
      // Schedule cleanup
      setTimeout(() => this.cleanupOperation(operation.id), 60000); // 1 minute
    }
  }

  /**
   * Event handler for operation timeout
   * @private
   */
  async handleOperationTimeout(operation) {
    this.logger?.warn(`Operation timed out: ${operation.id}`, {
      toolId: operation.toolId,
      agentId: operation.agentId,
      timeout: operation.timeout,
      executionTime: this.calculateExecutionTime(operation)
    });
    
    this.updateOperation(operation.id, TOOL_STATUS.TIMEOUT, {
      error: `Operation timed out after ${operation.timeout}ms`
    });
    
    this.emit('operation:timeout', operation);
    
    // Schedule cleanup
    setTimeout(() => this.cleanupOperation(operation.id), 30000); // 30 seconds
  }

  /**
   * Graceful shutdown
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.isShuttingDown = true;
    
    this.logger?.info('Shutting down async tool manager...');
    
    // Stop monitoring
    this.stopMonitoring();
    
    // Cancel all pending/executing operations
    const activeOperations = [];
    for (const operation of this.operations.values()) {
      if (operation.status === TOOL_STATUS.PENDING || operation.status === TOOL_STATUS.EXECUTING) {
        activeOperations.push(operation.id);
      }
    }
    
    for (const operationId of activeOperations) {
      await this.cancelOperation(operationId, 'System shutdown');
    }
    
    // Clear all remaining operations
    this.operations.clear();
    
    this.logger?.info(`Async tool manager shutdown complete. Cancelled ${activeOperations.length} operations.`);
  }

  /**
   * Get operation history
   * @param {Object} filters - Filtering options
   * @returns {Array<Object>} Filtered operation history
   */
  getOperationHistory(filters = {}) {
    let history = [...this.operationHistory];
    
    if (filters.agentId) {
      history = history.filter(op => op.agentId === filters.agentId);
    }
    
    if (filters.toolId) {
      history = history.filter(op => op.toolId === filters.toolId);
    }
    
    if (filters.status) {
      history = history.filter(op => op.status === filters.status);
    }
    
    if (filters.limit) {
      history = history.slice(-filters.limit);
    }
    
    return history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

export default AsyncToolManager;