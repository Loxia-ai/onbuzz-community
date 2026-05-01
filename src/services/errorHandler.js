import { ERROR_TYPES, HTTP_STATUS, AGENT_STATUS } from '../utilities/constants.js';

/**
 * Comprehensive error handling service for the Loxia AI Agents System
 * Provides error classification, recovery strategies, and monitoring
 */
export class ErrorHandler {
  constructor(config, logger) {
    this.config = config || {};
    this.logger = logger;
    this.errorStats = {
      totalErrors: 0,
      errorsByType: new Map(),
      errorsByAgent: new Map(),
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      criticalErrors: 0
    };

    this.recoveryStrategies = new Map();
    this.errorSubscribers = new Set();
    this.errorQueue = [];
    this.isProcessingQueue = false;

    this.initializeRecoveryStrategies();
    this.setupErrorProcessing();
  }

  /**
   * Handle an error with appropriate classification and recovery
   * @param {Error|Object} error - Error object or error data
   * @param {Object} context - Error context information
   * @returns {Object} Error handling result
   */
  async handleError(error, context = {}) {
    try {
      const errorInfo = this.classifyError(error, context);
      const handlingResult = await this.processError(errorInfo);
      
      this.updateErrorStats(errorInfo);
      this.notifySubscribers(errorInfo, handlingResult);

      return handlingResult;

    } catch (handlingError) {
      this.logger.error('Error handling failed', { 
        originalError: error.message,
        handlingError: handlingError.message 
      });
      
      return {
        success: false,
        error: handlingError,
        recovery: null,
        severity: 'critical'
      };
    }
  }

  /**
   * Classify error by type, severity, and context
   * @param {Error|Object} error - Error to classify
   * @param {Object} context - Error context
   * @returns {Object} Classified error information
   */
  classifyError(error, context = {}) {
    const errorInfo = {
      id: this.generateErrorId(),
      timestamp: new Date().toISOString(),
      message: error.message || error.toString(),
      stack: error.stack || null,
      code: error.code || null,
      type: this.determineErrorType(error, context),
      severity: this.determineSeverity(error, context),
      context: { ...context },
      recoverable: true,
      retryCount: context.retryCount || 0,
      maxRetries: this.getMaxRetries(error, context)
    };

    // Additional classification based on context
    if (context.agentId) {
      errorInfo.agentId = context.agentId;
    }

    if (context.toolId) {
      errorInfo.toolId = context.toolId;
    }

    if (context.operationId) {
      errorInfo.operationId = context.operationId;
    }

    // Determine if error is recoverable
    errorInfo.recoverable = this.isRecoverable(errorInfo);

    return errorInfo;
  }

  /**
   * Process error with appropriate recovery strategy
   * @param {Object} errorInfo - Classified error information
   * @returns {Object} Processing result
   */
  async processError(errorInfo) {
    try {
      this.logger.error('Processing error', {
        errorId: errorInfo.id,
        type: errorInfo.type,
        severity: errorInfo.severity,
        agentId: errorInfo.agentId,
        message: errorInfo.message
      });

      // Check if this is a critical error requiring immediate attention
      if (errorInfo.severity === 'critical') {
        await this.handleCriticalError(errorInfo);
      }

      // Attempt recovery if error is recoverable
      let recoveryResult = null;
      if (errorInfo.recoverable && errorInfo.retryCount < errorInfo.maxRetries) {
        recoveryResult = await this.attemptRecovery(errorInfo);
      }

      // Log error for monitoring and analysis
      await this.logError(errorInfo, recoveryResult);

      return {
        success: recoveryResult?.success || false,
        errorId: errorInfo.id,
        errorType: errorInfo.type,
        severity: errorInfo.severity,
        recovery: recoveryResult,
        shouldRetry: this.shouldRetry(errorInfo, recoveryResult),
        retryDelay: this.calculateRetryDelay(errorInfo)
      };

    } catch (processingError) {
      this.logger.error('Error processing failed', { 
        errorId: errorInfo.id,
        processingError: processingError.message 
      });

      return {
        success: false,
        errorId: errorInfo.id,
        errorType: errorInfo.type,
        severity: 'critical',
        recovery: null,
        shouldRetry: false
      };
    }
  }

  /**
   * Attempt to recover from an error using appropriate strategy
   * @param {Object} errorInfo - Error information
   * @returns {Object} Recovery result
   */
  async attemptRecovery(errorInfo) {
    try {
      this.errorStats.recoveryAttempts++;

      const strategy = this.recoveryStrategies.get(errorInfo.type) || 
                      this.recoveryStrategies.get('default');

      if (!strategy) {
        this.logger.warn('No recovery strategy found', { errorType: errorInfo.type });
        return { success: false, reason: 'No recovery strategy available' };
      }

      this.logger.info('Attempting error recovery', {
        errorId: errorInfo.id,
        errorType: errorInfo.type,
        strategy: strategy.name,
        retryCount: errorInfo.retryCount
      });

      const recoveryResult = await strategy.recover(errorInfo);

      if (recoveryResult.success) {
        this.errorStats.successfulRecoveries++;
        this.logger.info('Error recovery successful', {
          errorId: errorInfo.id,
          strategy: strategy.name
        });
      } else {
        this.logger.warn('Error recovery failed', {
          errorId: errorInfo.id,
          strategy: strategy.name,
          reason: recoveryResult.reason
        });
      }

      return recoveryResult;

    } catch (recoveryError) {
      this.logger.error('Recovery attempt failed', {
        errorId: errorInfo.id,
        recoveryError: recoveryError.message
      });

      return {
        success: false,
        reason: `Recovery attempt failed: ${recoveryError.message}`
      };
    }
  }

  /**
   * Handle critical errors that require immediate attention
   * @param {Object} errorInfo - Critical error information
   */
  async handleCriticalError(errorInfo) {
    try {
      this.errorStats.criticalErrors++;

      this.logger.error('Critical error detected', {
        errorId: errorInfo.id,
        message: errorInfo.message,
        context: errorInfo.context
      });

      // Emit critical error event
      if (typeof process !== 'undefined' && process.emit) {
        process.emit('criticalError', errorInfo);
      }

      // Take immediate protective actions based on error type
      switch (errorInfo.type) {
        case ERROR_TYPES.AUTHENTICATION_FAILED:
          await this.handleAuthenticationFailure(errorInfo);
          break;
        
        case ERROR_TYPES.RATE_LIMIT_EXCEEDED:
          await this.handleRateLimitExceeded(errorInfo);
          break;
        
        case ERROR_TYPES.OPERATION_TIMEOUT:
          await this.handleOperationTimeout(errorInfo);
          break;
        
        default:
          await this.handleGenericCriticalError(errorInfo);
      }

    } catch (criticalHandlingError) {
      this.logger.error('Critical error handling failed', {
        errorId: errorInfo.id,
        handlingError: criticalHandlingError.message
      });
    }
  }

  /**
   * Determine error type based on error and context
   * @param {Error|Object} error - Error object
   * @param {Object} context - Error context
   * @returns {string} Error type
   */
  determineErrorType(error, context) {
    // Check error code or HTTP status
    if (error.code === 'ENOENT' || error.status === HTTP_STATUS.NOT_FOUND) {
      return ERROR_TYPES.FILE_NOT_FOUND;
    }

    if (error.code === 'EACCES' || error.status === HTTP_STATUS.FORBIDDEN) {
      return ERROR_TYPES.PERMISSION_DENIED;
    }

    if (error.status === HTTP_STATUS.UNAUTHORIZED) {
      return ERROR_TYPES.AUTHENTICATION_FAILED;
    }

    if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return ERROR_TYPES.RATE_LIMIT_EXCEEDED;
    }

    // Check error message patterns
    const message = error.message?.toLowerCase() || '';
    
    if (message.includes('timeout') || message.includes('timed out')) {
      return ERROR_TYPES.OPERATION_TIMEOUT;
    }

    if (message.includes('validation') || message.includes('invalid')) {
      return ERROR_TYPES.VALIDATION_ERROR;
    }

    if (message.includes('config') || message.includes('configuration')) {
      return ERROR_TYPES.CONFIGURATION_ERROR;
    }

    // Check context for additional clues
    if (context.operation === 'file_operation') {
      return ERROR_TYPES.FILE_NOT_FOUND;
    }

    if (context.operation === 'api_request') {
      return ERROR_TYPES.RATE_LIMIT_EXCEEDED;
    }

    return ERROR_TYPES.UNKNOWN_ERROR;
  }

  /**
   * Determine error severity
   * @param {Error|Object} error - Error object
   * @param {Object} context - Error context
   * @returns {string} Error severity
   */
  determineSeverity(error, context) {
    const criticalTypes = [
      ERROR_TYPES.AUTHENTICATION_FAILED,
      ERROR_TYPES.CONFIGURATION_ERROR
    ];

    const highTypes = [
      ERROR_TYPES.RATE_LIMIT_EXCEEDED,
      ERROR_TYPES.OPERATION_TIMEOUT,
      ERROR_TYPES.PERMISSION_DENIED
    ];

    const errorType = this.determineErrorType(error, context);

    if (criticalTypes.includes(errorType)) {
      return 'critical';
    }

    if (highTypes.includes(errorType)) {
      return 'high';
    }

    // Check retry count
    const retryCount = (context && context.retryCount) || 0;
    if (retryCount >= 3) {
      return 'high';
    }

    // Check if error is affecting agent operation
    if (context && context.agentId && context.operation === 'agent_communication') {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Check if error is recoverable
   * @param {Object} errorInfo - Error information
   * @returns {boolean} True if recoverable
   */
  isRecoverable(errorInfo) {
    const nonRecoverableTypes = [
      ERROR_TYPES.AUTHENTICATION_FAILED,
      ERROR_TYPES.CONFIGURATION_ERROR
    ];

    if (nonRecoverableTypes.includes(errorInfo.type)) {
      return false;
    }

    // Not recoverable if max retries exceeded
    if (errorInfo.retryCount >= errorInfo.maxRetries) {
      return false;
    }

    // Not recoverable if critical severity
    if (errorInfo.severity === 'critical') {
      return false;
    }

    return true;
  }

  /**
   * Get maximum retry attempts for error type
   * @param {Error|Object} error - Error object
   * @param {Object} context - Error context
   * @returns {number} Maximum retries
   */
  getMaxRetries(error, context) {
    const errorType = this.determineErrorType(error, context);

    const retryLimits = {
      [ERROR_TYPES.RATE_LIMIT_EXCEEDED]: 5,
      [ERROR_TYPES.OPERATION_TIMEOUT]: 3,
      [ERROR_TYPES.FILE_NOT_FOUND]: 2,
      [ERROR_TYPES.PERMISSION_DENIED]: 1,
      [ERROR_TYPES.VALIDATION_ERROR]: 2,
      [ERROR_TYPES.UNKNOWN_ERROR]: 3
    };

    return retryLimits[errorType] || 3;
  }

  /**
   * Determine if error should be retried
   * @param {Object} errorInfo - Error information
   * @param {Object} recoveryResult - Recovery result
   * @returns {boolean} True if should retry
   */
  shouldRetry(errorInfo, recoveryResult) {
    if (!errorInfo.recoverable) {
      return false;
    }

    if (errorInfo.retryCount >= errorInfo.maxRetries) {
      return false;
    }

    if (recoveryResult && recoveryResult.success) {
      return false; // Recovery succeeded, no need to retry
    }

    return true;
  }

  /**
   * Calculate retry delay based on error information
   * @param {Object} errorInfo - Error information
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(errorInfo) {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    
    // Exponential backoff with jitter
    const exponentialDelay = baseDelay * Math.pow(2, errorInfo.retryCount);
    const jitter = Math.random() * 1000; // Random jitter up to 1 second
    
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  /**
   * Initialize recovery strategies for different error types
   */
  initializeRecoveryStrategies() {
    // File not found recovery
    this.recoveryStrategies.set(ERROR_TYPES.FILE_NOT_FOUND, {
      name: 'file_not_found_recovery',
      recover: async (errorInfo) => {
        if (errorInfo.context.filePath) {
          // Try to check if file exists in different location
          // or create directory structure if needed
          return { 
            success: false, 
            reason: 'File recovery not implemented yet',
            suggestion: 'Check file path and permissions'
          };
        }
        return { success: false, reason: 'No file path provided' };
      }
    });

    // Rate limit recovery
    this.recoveryStrategies.set(ERROR_TYPES.RATE_LIMIT_EXCEEDED, {
      name: 'rate_limit_recovery',
      recover: async (errorInfo) => {
        const waitTime = this.calculateRateLimitWait(errorInfo);
        this.logger.info('Waiting for rate limit recovery', { waitTime });
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        return { 
          success: true, 
          action: 'waited_for_rate_limit',
          waitTime
        };
      }
    });

    // Operation timeout recovery
    this.recoveryStrategies.set(ERROR_TYPES.OPERATION_TIMEOUT, {
      name: 'timeout_recovery',
      recover: async (errorInfo) => {
        // Try to increase timeout for next attempt
        if (errorInfo.context.timeout) {
          const newTimeout = Math.min(errorInfo.context.timeout * 1.5, 300000); // Max 5 minutes
          return {
            success: true,
            action: 'increased_timeout',
            newTimeout
          };
        }
        
        return { success: false, reason: 'Cannot adjust timeout' };
      }
    });

    // Permission denied recovery
    this.recoveryStrategies.set(ERROR_TYPES.PERMISSION_DENIED, {
      name: 'permission_recovery',
      recover: async (errorInfo) => {
        return { 
          success: false, 
          reason: 'Permission errors require manual intervention',
          suggestion: 'Check file/directory permissions'
        };
      }
    });

    // Validation error recovery
    this.recoveryStrategies.set(ERROR_TYPES.VALIDATION_ERROR, {
      name: 'validation_recovery',
      recover: async (errorInfo) => {
        // Try to clean/sanitize input data
        if (errorInfo.context.inputData) {
          return {
            success: true,
            action: 'data_sanitization',
            suggestion: 'Input data was sanitized for retry'
          };
        }
        
        return { success: false, reason: 'No input data to sanitize' };
      }
    });

    // Default recovery strategy
    this.recoveryStrategies.set('default', {
      name: 'default_recovery',
      recover: async (errorInfo) => {
        // Generic recovery: wait and retry
        const delay = this.calculateRetryDelay(errorInfo);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return {
          success: true,
          action: 'delay_retry',
          delay
        };
      }
    });
  }

  /**
   * Handle authentication failure
   * @param {Object} errorInfo - Error information
   */
  async handleAuthenticationFailure(errorInfo) {
    this.logger.error('Authentication failure detected', { errorId: errorInfo.id });
    
    // Could trigger token refresh, re-authentication, etc.
    if (errorInfo.agentId) {
      // Pause agent until authentication is resolved
      // await this.orchestrator.pauseAgent(errorInfo.agentId, 300, 'Authentication failure');
    }
  }

  /**
   * Handle rate limit exceeded
   * @param {Object} errorInfo - Error information
   */
  async handleRateLimitExceeded(errorInfo) {
    const waitTime = this.calculateRateLimitWait(errorInfo);
    
    this.logger.warn('Rate limit exceeded, implementing backoff', {
      errorId: errorInfo.id,
      waitTime,
      agentId: errorInfo.agentId
    });

    if (errorInfo.agentId) {
      // Pause agent temporarily
      // await this.orchestrator.pauseAgent(errorInfo.agentId, waitTime / 1000, 'Rate limit exceeded');
    }
  }

  /**
   * Handle operation timeout
   * @param {Object} errorInfo - Error information
   */
  async handleOperationTimeout(errorInfo) {
    this.logger.error('Operation timeout detected', {
      errorId: errorInfo.id,
      operation: errorInfo.context.operation,
      timeout: errorInfo.context.timeout
    });

    // Could cancel ongoing operations, adjust timeouts, etc.
  }

  /**
   * Handle generic critical error
   * @param {Object} errorInfo - Error information
   */
  async handleGenericCriticalError(errorInfo) {
    this.logger.error('Generic critical error', {
      errorId: errorInfo.id,
      type: errorInfo.type,
      message: errorInfo.message
    });

    // Generic protective measures
    if (errorInfo.agentId) {
      // Could pause agent for safety
      this.logger.warn('Considering agent pause due to critical error', {
        agentId: errorInfo.agentId
      });
    }
  }

  /**
   * Calculate wait time for rate limit recovery
   * @param {Object} errorInfo - Error information
   * @returns {number} Wait time in milliseconds
   */
  calculateRateLimitWait(errorInfo) {
    const baseWait = 60000; // 1 minute
    const retryMultiplier = Math.pow(2, errorInfo.retryCount);
    const maxWait = 300000; // 5 minutes
    
    return Math.min(baseWait * retryMultiplier, maxWait);
  }

  /**
   * Log error for monitoring and analysis
   * @param {Object} errorInfo - Error information
   * @param {Object} recoveryResult - Recovery result
   */
  async logError(errorInfo, recoveryResult) {
    try {
      const logEntry = {
        errorId: errorInfo.id,
        timestamp: errorInfo.timestamp,
        type: errorInfo.type,
        severity: errorInfo.severity,
        message: errorInfo.message,
        agentId: errorInfo.agentId,
        toolId: errorInfo.toolId,
        operationId: errorInfo.operationId,
        retryCount: errorInfo.retryCount,
        recoveryAttempted: !!recoveryResult,
        recoverySuccess: recoveryResult?.success || false,
        recoveryAction: recoveryResult?.action || null
      };

      // Store in error queue for batch processing
      this.errorQueue.push(logEntry);

      // Process queue if not already processing
      if (!this.isProcessingQueue) {
        this.processErrorQueue();
      }

    } catch (loggingError) {
      this.logger.error('Error logging failed', { 
        errorId: errorInfo.id,
        loggingError: loggingError.message 
      });
    }
  }

  /**
   * Process error queue for batch operations
   */
  async processErrorQueue() {
    if (this.isProcessingQueue || this.errorQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      while (this.errorQueue.length > 0) {
        const batch = this.errorQueue.splice(0, 10); // Process 10 at a time
        
        // Here you would typically save to database, send to monitoring service, etc.
        this.logger.debug('Processing error batch', { batchSize: batch.length });
        
        // Simulate async processing
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (processingError) {
      this.logger.error('Error queue processing failed', { error: processingError.message });
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Setup error processing infrastructure
   */
  setupErrorProcessing() {
    // Setup periodic queue processing
    setInterval(() => {
      if (this.errorQueue.length > 0) {
        this.processErrorQueue();
      }
    }, 5000); // Process every 5 seconds

    // Setup global error handlers
    if (typeof process !== 'undefined') {
      process.on('uncaughtException', (error) => {
        this.handleError(error, { 
          type: 'uncaught_exception',
          severity: 'critical'
        });
      });

      process.on('unhandledRejection', (reason, promise) => {
        this.handleError(new Error(`Unhandled Rejection: ${reason}`), {
          type: 'unhandled_rejection',
          severity: 'high',
          promise: promise.toString()
        });
      });
    }
  }

  /**
   * Update error statistics
   * @param {Object} errorInfo - Error information
   */
  updateErrorStats(errorInfo) {
    this.errorStats.totalErrors++;

    // Update error type statistics
    if (!this.errorStats.errorsByType.has(errorInfo.type)) {
      this.errorStats.errorsByType.set(errorInfo.type, 0);
    }
    this.errorStats.errorsByType.set(
      errorInfo.type,
      this.errorStats.errorsByType.get(errorInfo.type) + 1
    );

    // Update agent error statistics
    if (errorInfo.agentId) {
      if (!this.errorStats.errorsByAgent.has(errorInfo.agentId)) {
        this.errorStats.errorsByAgent.set(errorInfo.agentId, 0);
      }
      this.errorStats.errorsByAgent.set(
        errorInfo.agentId,
        this.errorStats.errorsByAgent.get(errorInfo.agentId) + 1
      );
    }
  }

  /**
   * Subscribe to error notifications
   * @param {Function} callback - Callback function
   */
  subscribe(callback) {
    this.errorSubscribers.add(callback);
    return () => this.errorSubscribers.delete(callback);
  }

  /**
   * Notify error subscribers
   * @param {Object} errorInfo - Error information
   * @param {Object} handlingResult - Handling result
   */
  notifySubscribers(errorInfo, handlingResult) {
    this.errorSubscribers.forEach(callback => {
      try {
        callback(errorInfo, handlingResult);
      } catch (callbackError) {
        this.logger.error('Error subscriber callback failed', { 
          error: callbackError.message 
        });
      }
    });
  }

  /**
   * Generate unique error ID
   * @returns {string} Error ID
   */
  generateErrorId() {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  getErrorStats() {
    return {
      totalErrors: this.errorStats.totalErrors,
      errorsByType: Object.fromEntries(this.errorStats.errorsByType),
      errorsByAgent: Object.fromEntries(this.errorStats.errorsByAgent),
      recoveryAttempts: this.errorStats.recoveryAttempts,
      successfulRecoveries: this.errorStats.successfulRecoveries,
      recoverySuccessRate: this.errorStats.recoveryAttempts > 0 
        ? this.errorStats.successfulRecoveries / this.errorStats.recoveryAttempts 
        : 0,
      criticalErrors: this.errorStats.criticalErrors,
      queueLength: this.errorQueue.length
    };
  }

  /**
   * Clear error statistics (for testing or reset)
   */
  clearErrorStats() {
    this.errorStats = {
      totalErrors: 0,
      errorsByType: new Map(),
      errorsByAgent: new Map(),
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      criticalErrors: 0
    };
    this.errorQueue = [];
  }
}

export default ErrorHandler;