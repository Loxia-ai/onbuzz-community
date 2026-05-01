/**
 * Visual Editor Bridge Service
 *
 * Manages visual editor instances per agent, enabling users to interact
 * with their web applications visually and give the AI agent pointers
 * to code parts of interest.
 *
 * Key responsibilities:
 * - Instance registry (one editor per agent)
 * - Visual context storage (element selections)
 * - Lifecycle management (create/stop/cleanup)
 * - Multi-instance coordination
 * - WebSocket connection to visual editor (Phase 3)
 *
 * @see VISUAL-EDITOR-INTEGRATION-PLAN.md for full architecture
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { getVisualEditorPort } from './visualEditorServer.js';

// Configuration defaults - port can be configured via config file, env var, or fallback
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_INSTANCES = 3;
const DEFAULT_RECONNECT_INTERVAL_MS = 3000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Get the WebSocket URL for the visual editor (computed at runtime)
 * Uses getVisualEditorPort which respects config file and env var settings
 */
function getVisualEditorWsUrl() {
  const port = getVisualEditorPort();
  return `ws://localhost:${port}/ws`;
}

/**
 * WebSocket message types from visual editor
 */
export const MessageTypes = {
  // Incoming from editor
  ELEMENT_SELECTED: 'element-selected',
  FILE_CHANGED: 'file-changed',
  EDITOR_READY: 'editor-ready',
  ERROR: 'error',
  PONG: 'pong',

  // Outgoing to editor
  HIGHLIGHT: 'highlight',
  SCROLL_TO: 'scroll-to',
  RELOAD: 'reload',
  SET_MODE: 'set-mode',
  PING: 'ping',
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe'
};

/**
 * Instance status enum
 */
export const InstanceStatus = {
  INITIALIZED: 'initialized',
  CONNECTING: 'connecting',
  READY: 'ready',
  ERROR: 'error',
  STOPPED: 'stopped'
};

/**
 * Visual Editor Bridge Service
 * Manages visual editor instances and coordinates communication
 */
class VisualEditorBridge extends EventEmitter {
  /**
   * @param {Object} config - Configuration options
   * @param {number} config.maxInstances - Maximum concurrent editors (default: 3)
   * @param {number} config.idleTimeoutMs - Idle timeout in ms (default: 10 min)
   * @param {string} config.visualEditorUrl - WebSocket URL for visual editor
   * @param {number} config.reconnectIntervalMs - Reconnection interval
   * @param {number} config.maxReconnectAttempts - Max reconnection attempts
   * @param {Object} config.logger - Logger instance
   */
  constructor(config = {}) {
    super();

    // Instance registry: agentId → InstanceRecord
    this.instances = new Map();

    // Configuration
    this.maxInstances = config.maxInstances || DEFAULT_MAX_INSTANCES;
    this.idleTimeoutMs = config.idleTimeoutMs || DEFAULT_IDLE_TIMEOUT_MS;
    this.visualEditorUrl = config.visualEditorUrl || getVisualEditorWsUrl();
    this.reconnectIntervalMs = config.reconnectIntervalMs || DEFAULT_RECONNECT_INTERVAL_MS;
    this.maxReconnectAttempts = config.maxReconnectAttempts || DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.logger = config.logger || console;
    this.enabled = config.enabled !== false;

    // Cleanup interval for orphaned instances
    this.cleanupInterval = null;
    if (this.enabled) {
      this.cleanupInterval = setInterval(() => this._cleanupIdle(), 60000);
    }

    this.logger.info?.('[VisualEditorBridge] Initialized', {
      maxInstances: this.maxInstances,
      idleTimeoutMs: this.idleTimeoutMs,
      visualEditorUrl: this.visualEditorUrl,
      enabled: this.enabled
    }) || this.logger.log('[VisualEditorBridge] Initialized');
  }

  /**
   * Check if bridge is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Get or create instance for agent
   * @param {string} agentId - Agent identifier
   * @param {Object} options - Instance options
   * @param {string} options.projectRoot - Project root directory
   * @param {string} options.appUrl - User's app URL to proxy
   * @returns {Object} Instance record
   * @throws {Error} If max instances reached
   */
  async getInstance(agentId, options = {}) {
    if (!agentId) {
      throw new Error('agentId is required');
    }

    // Return existing instance
    if (this.instances.has(agentId)) {
      const instance = this.instances.get(agentId);
      instance.lastActivity = Date.now();
      this._resetIdleTimer(agentId);

      // Update options if provided
      if (options.projectRoot) instance.projectRoot = options.projectRoot;
      if (options.appUrl) instance.appUrl = options.appUrl;

      return instance;
    }

    // Check instance limit
    if (this.instances.size >= this.maxInstances) {
      // Try to evict oldest idle instance
      const evicted = this._evictOldestIdle();
      if (!evicted) {
        throw new Error(
          `Maximum visual editor instances (${this.maxInstances}) reached. ` +
          `Stop an existing editor first.`
        );
      }
    }

    // Create new instance record
    const instance = {
      agentId,
      projectRoot: options.projectRoot || null,
      appUrl: options.appUrl || null,
      status: InstanceStatus.INITIALIZED,
      wsConnection: null,
      editorUrl: null,
      lastActivity: Date.now(),
      createdAt: Date.now(),
      uiSubscribers: new Set(),
      visualContext: null,
      idleTimer: null,
      error: null,
      // WebSocket connection state (Phase 3)
      reconnectAttempts: 0,
      reconnectTimer: null,
      pingInterval: null,
      lastPong: null,
      isConnecting: false
    };

    this.instances.set(agentId, instance);
    this._resetIdleTimer(agentId);

    this.logger.info?.(`[VisualEditorBridge] Created instance for agent: ${agentId}`, {
      projectRoot: instance.projectRoot,
      appUrl: instance.appUrl
    }) || this.logger.log(`[VisualEditorBridge] Created instance: ${agentId}`);

    this.emit('instance-created', { agentId, instance: this._sanitizeInstance(instance) });

    return instance;
  }

  /**
   * Check if instance exists for agent
   * @param {string} agentId - Agent identifier
   * @returns {boolean}
   */
  hasInstance(agentId) {
    return this.instances.has(agentId);
  }

  /**
   * Store visual context (element selection) for agent
   * @param {string} agentId - Agent identifier
   * @param {Object} elementReference - Element reference from visual editor
   * @returns {boolean} Success
   */
  setVisualContext(agentId, elementReference) {
    const instance = this.instances.get(agentId);
    if (!instance) {
      this.logger.warn?.(`[VisualEditorBridge] No instance for agent: ${agentId}`) ||
        this.logger.log(`[VisualEditorBridge] No instance: ${agentId}`);
      return false;
    }

    instance.visualContext = {
      ...elementReference,
      receivedAt: new Date().toISOString()
    };
    instance.lastActivity = Date.now();
    this._resetIdleTimer(agentId);

    this.logger.info?.(`[VisualEditorBridge] Visual context set for agent: ${agentId}`, {
      selector: elementReference.selector,
      sourceFile: elementReference.sourceHint?.file
    }) || this.logger.log(`[VisualEditorBridge] Context set: ${agentId}`);

    this.emit('visual-context-updated', {
      agentId,
      context: instance.visualContext
    });

    return true;
  }

  /**
   * Get visual context for agent
   * @param {string} agentId - Agent identifier
   * @returns {Object|null} Visual context or null
   */
  getVisualContext(agentId) {
    const instance = this.instances.get(agentId);
    return instance?.visualContext || null;
  }

  /**
   * Clear visual context for agent
   * @param {string} agentId - Agent identifier
   * @returns {boolean} Success
   */
  clearVisualContext(agentId) {
    const instance = this.instances.get(agentId);
    if (instance && instance.visualContext) {
      instance.visualContext = null;
      this.emit('visual-context-cleared', { agentId });
      return true;
    }
    return false;
  }

  /**
   * Get instance status
   * @param {string} agentId - Agent identifier
   * @returns {Object} Status object
   */
  getStatus(agentId) {
    const instance = this.instances.get(agentId);
    if (!instance) {
      return {
        exists: false,
        agentId
      };
    }

    return {
      exists: true,
      agentId: instance.agentId,
      status: instance.status,
      projectRoot: instance.projectRoot,
      appUrl: instance.appUrl,
      editorUrl: instance.editorUrl,
      hasVisualContext: !!instance.visualContext,
      visualContext: instance.visualContext,
      subscriberCount: instance.uiSubscribers.size,
      createdAt: instance.createdAt,
      lastActivity: instance.lastActivity,
      idleMs: Date.now() - instance.lastActivity,
      error: instance.error
    };
  }

  /**
   * Update instance status
   * @param {string} agentId - Agent identifier
   * @param {string} status - New status
   * @param {Object} extra - Additional fields to update
   * @returns {boolean} Success
   */
  updateStatus(agentId, status, extra = {}) {
    const instance = this.instances.get(agentId);
    if (!instance) {
      return false;
    }

    instance.status = status;
    instance.lastActivity = Date.now();

    if (extra.editorUrl) instance.editorUrl = extra.editorUrl;
    if (extra.wsConnection) instance.wsConnection = extra.wsConnection;
    if (extra.error) instance.error = extra.error;

    this.emit('instance-status-changed', {
      agentId,
      status,
      ...extra
    });

    return true;
  }

  /**
   * Add UI subscriber to instance
   * @param {string} agentId - Agent identifier
   * @param {string} connectionId - UI connection identifier
   * @returns {boolean} Success
   */
  addSubscriber(agentId, connectionId) {
    const instance = this.instances.get(agentId);
    if (!instance) {
      return false;
    }

    instance.uiSubscribers.add(connectionId);
    instance.lastActivity = Date.now();
    return true;
  }

  /**
   * Remove UI subscriber from instance
   * @param {string} agentId - Agent identifier
   * @param {string} connectionId - UI connection identifier
   * @returns {boolean} Success
   */
  removeSubscriber(agentId, connectionId) {
    const instance = this.instances.get(agentId);
    if (!instance) {
      return false;
    }

    return instance.uiSubscribers.delete(connectionId);
  }

  /**
   * Stop and remove instance for agent
   * @param {string} agentId - Agent identifier
   * @returns {boolean} Success
   */
  async stopInstance(agentId) {
    const instance = this.instances.get(agentId);
    if (!instance) {
      return false;
    }

    // Mark as stopped to prevent reconnection attempts
    instance.status = InstanceStatus.STOPPED;

    // Clear idle timer
    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer);
      instance.idleTimer = null;
    }

    // Cleanup WebSocket connection (including ping interval and reconnect timer)
    this._cleanupConnection(agentId);

    // Remove from registry
    this.instances.delete(agentId);

    this.logger.info?.(`[VisualEditorBridge] Stopped instance for agent: ${agentId}`) ||
      this.logger.log(`[VisualEditorBridge] Stopped: ${agentId}`);

    this.emit('instance-stopped', { agentId });

    return true;
  }

  /**
   * Handle agent deletion - cleanup instance
   * @param {string} agentId - Agent identifier
   * @returns {boolean} Success
   */
  onAgentDeleted(agentId) {
    this.logger.info?.(`[VisualEditorBridge] Agent deleted, cleaning up: ${agentId}`);
    return this.stopInstance(agentId);
  }

  /**
   * Handle agent unload - cleanup instance
   * @param {string} agentId - Agent identifier
   * @returns {boolean} Success
   */
  onAgentUnloaded(agentId) {
    this.logger.info?.(`[VisualEditorBridge] Agent unloaded, cleaning up: ${agentId}`);
    return this.stopInstance(agentId);
  }

  /**
   * Check if project is used by another agent
   * @param {string} agentId - Current agent identifier
   * @param {string} projectRoot - Project root to check
   * @returns {Object} Collision info
   */
  checkProjectCollision(agentId, projectRoot) {
    if (!projectRoot) {
      return { collision: false };
    }

    for (const [otherId, instance] of this.instances) {
      if (otherId !== agentId && instance.projectRoot === projectRoot) {
        return {
          collision: true,
          otherAgentId: otherId,
          message: `Project "${projectRoot}" is already being edited by agent "${otherId}"`
        };
      }
    }
    return { collision: false };
  }

  /**
   * List all instances
   * @returns {Array} Array of instance info objects
   */
  listInstances() {
    return Array.from(this.instances.entries()).map(([agentId, instance]) => ({
      agentId,
      status: instance.status,
      projectRoot: instance.projectRoot,
      appUrl: instance.appUrl,
      hasContext: !!instance.visualContext,
      subscriberCount: instance.uiSubscribers.size,
      createdAt: instance.createdAt,
      lastActivity: instance.lastActivity,
      idleMs: Date.now() - instance.lastActivity
    }));
  }

  /**
   * Get count of active instances
   * @returns {number}
   */
  getInstanceCount() {
    return this.instances.size;
  }

  /**
   * Touch instance to reset idle timer
   * @param {string} agentId - Agent identifier
   */
  touchInstance(agentId) {
    const instance = this.instances.get(agentId);
    if (instance) {
      instance.lastActivity = Date.now();
      this._resetIdleTimer(agentId);
    }
  }

  // === WebSocket Methods (Phase 3) ===

  /**
   * Connect to visual editor WebSocket
   * @param {string} agentId - Agent identifier
   * @param {Object} options - Connection options
   * @param {string} options.editorUrl - Override editor URL
   * @returns {Promise<boolean>} Connection success
   */
  async connectToEditor(agentId, options = {}) {
    const instance = this.instances.get(agentId);
    if (!instance) {
      throw new Error(`No instance for agent: ${agentId}`);
    }

    // Already connected or connecting
    if (instance.wsConnection?.readyState === WebSocket.OPEN) {
      return true;
    }

    if (instance.isConnecting) {
      return false;
    }

    instance.isConnecting = true;
    instance.status = InstanceStatus.CONNECTING;
    this.emit('instance-status-changed', { agentId, status: InstanceStatus.CONNECTING });

    const editorUrl = options.editorUrl || this.visualEditorUrl;

    return new Promise((resolve) => {
      try {
        this.logger.info?.(`[VisualEditorBridge] Connecting to editor for agent: ${agentId}`, {
          url: editorUrl
        });

        const ws = new WebSocket(editorUrl);

        ws.on('open', () => {
          instance.wsConnection = ws;
          instance.status = InstanceStatus.READY;
          instance.editorUrl = editorUrl;
          instance.isConnecting = false;
          instance.reconnectAttempts = 0;
          instance.error = null;
          instance.lastActivity = Date.now();

          this.logger.info?.(`[VisualEditorBridge] Connected to editor for agent: ${agentId}`);

          // Start heartbeat
          this._startPingInterval(agentId);

          // Subscribe to editor events for this agent
          this.sendCommand(agentId, MessageTypes.SUBSCRIBE, {
            agentId,
            projectRoot: instance.projectRoot,
            appUrl: instance.appUrl
          });

          this.emit('editor-connected', { agentId, editorUrl });
          this.emit('instance-status-changed', { agentId, status: InstanceStatus.READY });

          resolve(true);
        });

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this._handleEditorMessage(agentId, message);
          } catch (err) {
            this.logger.warn?.(`[VisualEditorBridge] Invalid message from editor: ${err.message}`);
          }
        });

        ws.on('close', (code, reason) => {
          this.logger.info?.(`[VisualEditorBridge] Editor connection closed for agent: ${agentId}`, {
            code,
            reason: reason?.toString()
          });

          this._cleanupConnection(agentId);

          // Schedule reconnect if instance still exists and wasn't manually stopped
          if (this.instances.has(agentId) && instance.status !== InstanceStatus.STOPPED) {
            this._scheduleReconnect(agentId);
          }
        });

        ws.on('error', (error) => {
          this.logger.error?.(`[VisualEditorBridge] Editor connection error for agent: ${agentId}`, {
            error: error.message
          });

          instance.error = error.message;
          instance.isConnecting = false;

          if (instance.status === InstanceStatus.CONNECTING) {
            instance.status = InstanceStatus.ERROR;
            this.emit('instance-status-changed', { agentId, status: InstanceStatus.ERROR, error: error.message });
          }

          this.emit('editor-error', { agentId, error: error.message });
          resolve(false);
        });

      } catch (error) {
        instance.isConnecting = false;
        instance.status = InstanceStatus.ERROR;
        instance.error = error.message;
        this.logger.error?.(`[VisualEditorBridge] Failed to create WebSocket: ${error.message}`);
        resolve(false);
      }
    });
  }

  /**
   * Disconnect from visual editor
   * @param {string} agentId - Agent identifier
   * @returns {boolean} Success
   */
  disconnectFromEditor(agentId) {
    const instance = this.instances.get(agentId);
    if (!instance) {
      return false;
    }

    // Send unsubscribe before closing
    if (instance.wsConnection?.readyState === WebSocket.OPEN) {
      this.sendCommand(agentId, MessageTypes.UNSUBSCRIBE, { agentId });
    }

    this._cleanupConnection(agentId);

    this.logger.info?.(`[VisualEditorBridge] Disconnected from editor for agent: ${agentId}`);
    this.emit('editor-disconnected', { agentId });

    return true;
  }

  /**
   * Send command to visual editor
   * @param {string} agentId - Agent identifier
   * @param {string} type - Message type
   * @param {Object} data - Message data
   * @returns {boolean} Success
   */
  sendCommand(agentId, type, data = {}) {
    const instance = this.instances.get(agentId);
    if (!instance?.wsConnection || instance.wsConnection.readyState !== WebSocket.OPEN) {
      this.logger.warn?.(`[VisualEditorBridge] Cannot send command - not connected: ${agentId}`);
      return false;
    }

    try {
      const message = JSON.stringify({
        type,
        agentId,
        timestamp: Date.now(),
        ...data
      });

      instance.wsConnection.send(message);
      instance.lastActivity = Date.now();
      this._resetIdleTimer(agentId);

      this.logger.debug?.(`[VisualEditorBridge] Sent command: ${type} for agent: ${agentId}`);
      return true;

    } catch (error) {
      this.logger.error?.(`[VisualEditorBridge] Failed to send command: ${error.message}`);
      return false;
    }
  }

  /**
   * Highlight element in visual editor preview
   * @param {string} agentId - Agent identifier
   * @param {string} selector - CSS selector to highlight
   * @param {number} durationMs - Highlight duration (default: 2000ms)
   * @returns {boolean} Success
   */
  highlightElement(agentId, selector, durationMs = 2000) {
    return this.sendCommand(agentId, MessageTypes.HIGHLIGHT, {
      selector,
      duration: durationMs
    });
  }

  /**
   * Scroll to element in visual editor preview
   * @param {string} agentId - Agent identifier
   * @param {string} selector - CSS selector to scroll to
   * @returns {boolean} Success
   */
  scrollToElement(agentId, selector) {
    return this.sendCommand(agentId, MessageTypes.SCROLL_TO, { selector });
  }

  /**
   * Reload the visual editor preview
   * @param {string} agentId - Agent identifier
   * @returns {boolean} Success
   */
  reloadPreview(agentId) {
    return this.sendCommand(agentId, MessageTypes.RELOAD, {});
  }

  /**
   * Set visual editor mode
   * @param {string} agentId - Agent identifier
   * @param {string} mode - Mode ('edit' or 'preview')
   * @returns {boolean} Success
   */
  setEditorMode(agentId, mode) {
    if (!['edit', 'preview'].includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Must be 'edit' or 'preview'`);
    }
    return this.sendCommand(agentId, MessageTypes.SET_MODE, { mode });
  }

  /**
   * Check if instance is connected to editor
   * @param {string} agentId - Agent identifier
   * @returns {boolean}
   */
  isConnected(agentId) {
    const instance = this.instances.get(agentId);
    return instance?.wsConnection?.readyState === WebSocket.OPEN;
  }

  // === Private methods ===

  /**
   * Reset idle timer for instance
   * @private
   */
  _resetIdleTimer(agentId) {
    const instance = this.instances.get(agentId);
    if (!instance) return;

    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer);
    }

    instance.idleTimer = setTimeout(() => {
      this.logger.info?.(`[VisualEditorBridge] Idle timeout for agent: ${agentId}`);
      this.stopInstance(agentId);
    }, this.idleTimeoutMs);
  }

  /**
   * Evict the oldest idle instance to make room
   * @private
   * @returns {boolean} Whether an instance was evicted
   */
  _evictOldestIdle() {
    let oldest = null;
    let oldestTime = Infinity;

    // First pass: prefer instances without active subscribers
    for (const [agentId, instance] of this.instances) {
      const hasSubscribers = instance.uiSubscribers.size > 0;

      if (!hasSubscribers && instance.lastActivity < oldestTime) {
        oldest = agentId;
        oldestTime = instance.lastActivity;
      }
    }

    // Second pass: if no instance without subscribers, evict oldest overall
    if (!oldest) {
      oldestTime = Infinity;
      for (const [agentId, instance] of this.instances) {
        if (instance.lastActivity < oldestTime) {
          oldest = agentId;
          oldestTime = instance.lastActivity;
        }
      }
    }

    if (oldest) {
      this.logger.info?.(`[VisualEditorBridge] Evicting idle instance: ${oldest}`);
      this.stopInstance(oldest);
      return true;
    }

    return false;
  }

  /**
   * Cleanup idle instances (called periodically)
   * @private
   */
  _cleanupIdle() {
    const now = Date.now();
    const toCleanup = [];

    for (const [agentId, instance] of this.instances) {
      if (now - instance.lastActivity > this.idleTimeoutMs) {
        toCleanup.push(agentId);
      }
    }

    for (const agentId of toCleanup) {
      this.logger.info?.(`[VisualEditorBridge] Cleanup idle instance: ${agentId}`);
      this.stopInstance(agentId);
    }
  }

  /**
   * Sanitize instance for external exposure (remove internals)
   * @private
   */
  _sanitizeInstance(instance) {
    return {
      agentId: instance.agentId,
      status: instance.status,
      projectRoot: instance.projectRoot,
      appUrl: instance.appUrl,
      editorUrl: instance.editorUrl,
      hasVisualContext: !!instance.visualContext,
      subscriberCount: instance.uiSubscribers.size,
      createdAt: instance.createdAt,
      lastActivity: instance.lastActivity,
      isConnected: instance.wsConnection?.readyState === WebSocket.OPEN
    };
  }

  /**
   * Handle incoming message from visual editor
   * @private
   */
  _handleEditorMessage(agentId, message) {
    const instance = this.instances.get(agentId);
    if (!instance) return;

    instance.lastActivity = Date.now();
    this._resetIdleTimer(agentId);

    const { type } = message;

    switch (type) {
      case MessageTypes.ELEMENT_SELECTED:
        // User selected an element in the visual editor
        this.logger.info?.(`[VisualEditorBridge] Element selected for agent: ${agentId}`, {
          selector: message.selector,
          sourceFile: message.sourceHint?.file
        });

        // Store visual context
        this.setVisualContext(agentId, {
          selector: message.selector,
          tagName: message.tagName,
          text: message.text,
          attributes: message.attributes,
          boundingRect: message.boundingRect,
          sourceHint: message.sourceHint
        });

        // Emit event for UI subscribers
        this.emit('element-selected', {
          agentId,
          element: message
        });
        break;

      case MessageTypes.FILE_CHANGED:
        // File changed in the project
        this.logger.info?.(`[VisualEditorBridge] File changed for agent: ${agentId}`, {
          file: message.file,
          type: message.changeType
        });

        this.emit('file-changed', {
          agentId,
          file: message.file,
          changeType: message.changeType
        });
        break;

      case MessageTypes.EDITOR_READY:
        // Editor is ready and connected
        this.logger.info?.(`[VisualEditorBridge] Editor ready for agent: ${agentId}`);
        this.emit('editor-ready', { agentId });
        break;

      case MessageTypes.PONG:
        // Heartbeat response
        instance.lastPong = Date.now();
        break;

      case MessageTypes.ERROR:
        // Error from editor
        this.logger.error?.(`[VisualEditorBridge] Editor error for agent: ${agentId}`, {
          error: message.error
        });

        instance.error = message.error;
        this.emit('editor-error', {
          agentId,
          error: message.error
        });
        break;

      default:
        this.logger.debug?.(`[VisualEditorBridge] Unknown message type: ${type}`);
    }
  }

  /**
   * Cleanup WebSocket connection resources
   * @private
   */
  _cleanupConnection(agentId) {
    const instance = this.instances.get(agentId);
    if (!instance) return;

    // Stop ping interval
    if (instance.pingInterval) {
      clearInterval(instance.pingInterval);
      instance.pingInterval = null;
    }

    // Cancel reconnect timer
    if (instance.reconnectTimer) {
      clearTimeout(instance.reconnectTimer);
      instance.reconnectTimer = null;
    }

    // Close WebSocket
    if (instance.wsConnection) {
      try {
        instance.wsConnection.close();
      } catch (err) {
        // Ignore
      }
      instance.wsConnection = null;
    }

    instance.isConnecting = false;
    instance.lastPong = null;
  }

  /**
   * Schedule reconnection with exponential backoff
   * @private
   */
  _scheduleReconnect(agentId) {
    const instance = this.instances.get(agentId);
    if (!instance) return;

    if (instance.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error?.(`[VisualEditorBridge] Max reconnect attempts reached for agent: ${agentId}`);
      instance.status = InstanceStatus.ERROR;
      instance.error = 'Max reconnection attempts reached';
      this.emit('instance-status-changed', {
        agentId,
        status: InstanceStatus.ERROR,
        error: instance.error
      });
      return;
    }

    instance.reconnectAttempts++;

    // Exponential backoff: base * 2^attempts (capped at 30s)
    const delay = Math.min(
      this.reconnectIntervalMs * Math.pow(2, instance.reconnectAttempts - 1),
      30000
    );

    this.logger.info?.(`[VisualEditorBridge] Scheduling reconnect for agent: ${agentId}`, {
      attempt: instance.reconnectAttempts,
      delayMs: delay
    });

    instance.reconnectTimer = setTimeout(() => {
      if (this.instances.has(agentId)) {
        this.connectToEditor(agentId).catch(err => {
          this.logger.error?.(`[VisualEditorBridge] Reconnect failed: ${err.message}`);
        });
      }
    }, delay);
  }

  /**
   * Start ping/pong heartbeat interval
   * @private
   */
  _startPingInterval(agentId) {
    const instance = this.instances.get(agentId);
    if (!instance) return;

    // Clear existing interval
    if (instance.pingInterval) {
      clearInterval(instance.pingInterval);
    }

    // Ping every 30 seconds
    instance.pingInterval = setInterval(() => {
      if (instance.wsConnection?.readyState === WebSocket.OPEN) {
        // Check if last pong was too long ago (60s timeout)
        if (instance.lastPong && Date.now() - instance.lastPong > 60000) {
          this.logger.warn?.(`[VisualEditorBridge] Ping timeout for agent: ${agentId}`);
          this._cleanupConnection(agentId);
          this._scheduleReconnect(agentId);
          return;
        }

        this.sendCommand(agentId, MessageTypes.PING, {});
      }
    }, 30000);
  }

  /**
   * Graceful shutdown - stop all instances
   */
  async shutdown() {
    this.logger.info?.('[VisualEditorBridge] Shutting down...');

    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Stop all instances
    const stopPromises = [];
    for (const agentId of this.instances.keys()) {
      stopPromises.push(this.stopInstance(agentId));
    }

    await Promise.all(stopPromises);

    this.logger.info?.('[VisualEditorBridge] Shutdown complete');
    this.emit('shutdown');
  }
}

// Export singleton factory
let bridgeInstance = null;

/**
 * Get or create the bridge singleton
 * @param {Object} config - Configuration (only used on first call)
 * @returns {VisualEditorBridge}
 */
export function getVisualEditorBridge(config = {}) {
  if (!bridgeInstance) {
    bridgeInstance = new VisualEditorBridge(config);
  }
  return bridgeInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetVisualEditorBridge() {
  if (bridgeInstance) {
    bridgeInstance.shutdown();
    bridgeInstance = null;
  }
}

export default VisualEditorBridge;
