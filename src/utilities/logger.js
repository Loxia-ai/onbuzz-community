/**
 * Logger - Centralized logging system for the Loxia AI Agents System
 * 
 * Purpose:
 * - Structured logging with different levels
 * - Agent activity logging
 * - Tool execution logging
 * - System event logging
 * - Log output management (console, file)
 */

import { promises as fs } from 'fs';
import path from 'path';

import {
  SYSTEM_VERSION
} from './constants.js';

/**
 * Back-reference keys that appear inside tool-execute `context` objects
 * and form cycles (AgentPool ⇄ MessageProcessor ⇄ Orchestrator etc.).
 * Replaced with a '[ref:XYZ]' sentinel when they turn up in log metadata
 * so a careless `logger.error('...', { context })` doesn't crash the
 * process with "Converting circular structure to JSON".
 *
 * Kept here as a flat set so the per-call replacer stays O(1).
 */
const _LOG_CYCLE_KEYS = new Set([
  'agentPool', 'messageProcessor', 'orchestrator',
  'contextManager', 'aiService', 'toolsRegistry',
  'webServer', 'stateManager', 'scheduler',
  'webSocketManager', 'flowExecutor',
]);

/**
 * JSON.stringify with a defensive replacer:
 *   1. Known back-reference fields → '[ref:Foo]' (no serialisation)
 *   2. Seen-set catches any other cycle that slips through
 *
 * Defence-in-depth for the "logger crashes if anyone passes a
 * context-shaped object" class of bug. Callers should still pluck
 * their own metadata — this is the safety net, not the main guard.
 */
function _safeStringify(obj) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(obj, (key, value) => {
      if (_LOG_CYCLE_KEYS.has(key) && value && typeof value === 'object') {
        const ctor = value.constructor?.name || 'Object';
        return `[ref:${ctor}]`;
      }
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[circular]';
        seen.add(value);
      }
      return value;
    });
  } catch (err) {
    return `[unserialisable: ${err.message}]`;
  }
}

class Logger {
  constructor(config = {}) {
    this.config = config;
    
    // Log levels in order of severity
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
    
    this.currentLevel = this.levels[config.level || 'info'];
    this.outputs = config.outputs || ['console'];
    this.logFile = config.logFile || null;
    this.maxFileSize = config.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = config.maxFiles || 5;
    
    // Log formatting
    this.enableColors = config.colors !== false;
    this.includeTimestamp = config.timestamp !== false;
    this.includeLevel = config.includeLevel !== false;
    
    // Color codes for console output
    this.colors = {
      error: '\x1b[31m', // Red
      warn: '\x1b[33m',  // Yellow
      info: '\x1b[36m',  // Cyan
      debug: '\x1b[90m', // Gray
      reset: '\x1b[0m'
    };
    
    this.initialized = false;
  }

  /**
   * Initialize logger
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      // Create log directory if file output is enabled
      if (this.outputs.includes('file') && this.logFile) {
        const logDir = path.dirname(this.logFile);
        await fs.mkdir(logDir, { recursive: true });
      }
      
      this.initialized = true;
      this.info('Logger initialized', {
        level: Object.keys(this.levels)[this.currentLevel],
        outputs: this.outputs,
        logFile: this.logFile
      });
      
    } catch (error) {
      console.error('Logger initialization failed:', error.message);
    }
  }

  /**
   * Log error message
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   */
  error(message, meta = {}) {
    this.log('error', message, meta);
  }

  /**
   * Log warning message
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   */
  warn(message, meta = {}) {
    this.log('warn', message, meta);
  }

  /**
   * Log info message
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   */
  info(message, meta = {}) {
    this.log('info', message, meta);
  }

  /**
   * Log debug message
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   */
  debug(message, meta = {}) {
    this.log('debug', message, meta);
  }

  /**
   * Log agent activity
   * @param {string} agentId - Agent identifier
   * @param {string} action - Action performed
   * @param {Object} details - Action details
   */
  logAgentActivity(agentId, action, details = {}) {
    this.info(`[AGENT:${agentId}] ${action}`, {
      category: 'agent-activity',
      agentId,
      action,
      ...details
    });
  }

  /**
   * Log tool execution
   * @param {string} toolId - Tool identifier
   * @param {string} operationId - Operation identifier
   * @param {string} status - Execution status
   * @param {number} duration - Execution duration in ms
   * @param {Object} details - Additional details
   */
  logToolExecution(toolId, operationId, status, duration, details = {}) {
    const level = status === 'failed' ? 'error' : 'info';
    this[level](`[TOOL:${toolId}] Operation ${operationId} ${status} (${duration}ms)`, {
      category: 'tool-execution',
      toolId,
      operationId,
      status,
      duration,
      ...details
    });
  }

  /**
   * Log system event
   * @param {string} event - Event name
   * @param {Object} context - Event context
   */
  logSystemEvent(event, context = {}) {
    this.info(`[SYSTEM] ${event}`, {
      category: 'system-event',
      event,
      ...context
    });
  }

  /**
   * Log API request/response
   * @param {string} method - HTTP method
   * @param {string} url - Request URL
   * @param {number} status - Response status
   * @param {number} duration - Request duration in ms
   * @param {Object} details - Additional details
   */
  logApiRequest(method, url, status, duration, details = {}) {
    const level = status >= 400 ? 'error' : 'info';
    this[level](`[API] ${method} ${url} ${status} (${duration}ms)`, {
      category: 'api-request',
      method,
      url,
      status,
      duration,
      ...details
    });
  }

  /**
   * Log with specified level
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   */
  log(level, message, meta = {}) {
    // Check if level is enabled
    if (this.levels[level] > this.currentLevel) {
      return;
    }
    
    const logEntry = this.createLogEntry(level, message, meta);
    
    // Output to configured destinations
    for (const output of this.outputs) {
      switch (output) {
        case 'console':
          this.outputToConsole(logEntry);
          break;
        case 'file':
          this.outputToFile(logEntry);
          break;
      }
    }
  }

  /**
   * Create structured log entry
   * @private
   */
  createLogEntry(level, message, meta) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      version: SYSTEM_VERSION,
      ...meta
    };
    
    // Add process information
    entry.pid = process.pid;
    
    // Add memory usage for debug level
    if (level === 'debug') {
      const memUsage = process.memoryUsage();
      entry.memory = {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
      };
    }
    
    return entry;
  }

  /**
   * Output log entry to console
   * @private
   */
  outputToConsole(entry) {
    let output = '';
    
    // Add timestamp
    if (this.includeTimestamp) {
      const timestamp = new Date(entry.timestamp).toLocaleTimeString();
      output += `[${timestamp}] `;
    }
    
    // Add level with color
    if (this.includeLevel) {
      const levelStr = entry.level.padEnd(5);
      if (this.enableColors && process.stdout.isTTY) {
        const color = this.colors[entry.level.toLowerCase()] || '';
        output += `${color}${levelStr}${this.colors.reset} `;
      } else {
        output += `${levelStr} `;
      }
    }
    
    // Add message
    output += entry.message;

    // Add metadata if present
    const { timestamp, level, message, version, pid, ...metadata } = entry;
    if (Object.keys(metadata).length > 0) {
      output += ` ${_safeStringify(metadata)}`;
    }

    // Output based on level
    if (entry.level === 'ERROR') {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  /**
   * Output log entry to file
   * @private
   */
  async outputToFile(entry) {
    if (!this.logFile) return;

    try {
      // Check file size and rotate if needed
      await this.rotateLogFileIfNeeded();

      const logLine = _safeStringify(entry) + '\n';
      await fs.appendFile(this.logFile, logLine, 'utf8');

    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  /**
   * Rotate log file if it exceeds max size
   * @private
   */
  async rotateLogFileIfNeeded() {
    try {
      const stats = await fs.stat(this.logFile);
      
      if (stats.size >= this.maxFileSize) {
        await this.rotateLogFiles();
      }
      
    } catch (error) {
      // File doesn't exist yet, that's ok
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Rotate log files
   * @private
   */
  async rotateLogFiles() {
    const dir = path.dirname(this.logFile);
    const basename = path.basename(this.logFile, path.extname(this.logFile));
    const ext = path.extname(this.logFile);
    
    // Rotate existing files
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const oldFile = path.join(dir, `${basename}.${i}${ext}`);
      const newFile = path.join(dir, `${basename}.${i + 1}${ext}`);
      
      try {
        await fs.rename(oldFile, newFile);
      } catch (error) {
        // File doesn't exist, continue
        if (error.code !== 'ENOENT') {
          console.error(`Failed to rotate log file ${oldFile}:`, error.message);
        }
      }
    }
    
    // Move current file to .1
    const rotatedFile = path.join(dir, `${basename}.1${ext}`);
    try {
      await fs.rename(this.logFile, rotatedFile);
    } catch (error) {
      console.error(`Failed to rotate current log file:`, error.message);
    }
  }

  /**
   * Set log level
   * @param {string} level - New log level
   */
  setLevel(level) {
    if (level in this.levels) {
      this.currentLevel = this.levels[level];
      this.info(`Log level changed to: ${level}`);
    } else {
      this.warn(`Invalid log level: ${level}. Valid levels: ${Object.keys(this.levels).join(', ')}`);
    }
  }

  /**
   * Add output destination
   * @param {string} output - Output destination ('console' or 'file')
   */
  addOutput(output) {
    if (!this.outputs.includes(output)) {
      this.outputs.push(output);
      this.info(`Added log output: ${output}`);
    }
  }

  /**
   * Remove output destination
   * @param {string} output - Output destination to remove
   */
  removeOutput(output) {
    const index = this.outputs.indexOf(output);
    if (index > -1) {
      this.outputs.splice(index, 1);
      this.info(`Removed log output: ${output}`);
    }
  }

  /**
   * Create child logger with additional context
   * @param {Object} context - Additional context to include in all logs
   * @returns {Logger} Child logger instance
   */
  child(context) {
    const childLogger = Object.create(this);
    childLogger.childContext = { ...this.childContext, ...context };
    return childLogger;
  }

  /**
   * Flush any pending log entries
   * @returns {Promise<void>}
   */
  async flush() {
    // File system writes are typically immediate, but this provides
    // a hook for more complex logging backends
    return Promise.resolve();
  }

  /**
   * Close logger and cleanup resources
   * @returns {Promise<void>}
   */
  async close() {
    await this.flush();
    this.info('Logger closed');
  }
}

/**
 * Create a logger instance with specified configuration
 * @param {Object} config - Logger configuration
 * @returns {Logger} Logger instance
 */
function createLogger(config = {}) {
  const logger = new Logger(config);
  
  // Auto-initialize if not explicitly disabled
  if (config.autoInit !== false) {
    setImmediate(() => logger.initialize());
  }
  
  return logger;
}

export { Logger, createLogger };