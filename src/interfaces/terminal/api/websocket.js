/**
 * WebSocket Manager
 * Handles WebSocket connection with auto-reconnect, heartbeat, and message queueing
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import {
  TIMING,
  NETWORK,
  CONNECTION_STATE,
  WS_MESSAGE_TYPE,
  ERROR_MESSAGE,
} from '../config/constants.js';

/**
 * WebSocket Manager Class
 * Manages WebSocket connection lifecycle with robust error handling and reconnection
 */
export class WebSocketManager extends EventEmitter {
  constructor(host = NETWORK.DEFAULT_HOST, port = NETWORK.DEFAULT_PORT, options = {}) {
    super();

    this.host = host;
    this.port = port;
    this.url = `ws://${host}:${port}`;

    // Connection state
    this.ws = null;
    this.state = CONNECTION_STATE.DISCONNECTED;
    this.sessionId = null;

    // Reconnection management
    this.reconnectAttempts = 0;
    this.reconnectDelay = options.reconnectDelay ?? TIMING.WEBSOCKET_RECONNECT_DELAY;
    this.baseReconnectDelay = this.reconnectDelay; // Store base delay for reset
    this.reconnectTimer = null;
    this.shouldReconnect = true;

    // Heartbeat management
    this.heartbeatInterval = options.heartbeatInterval ?? TIMING.WEBSOCKET_PING_INTERVAL;
    this.pingInterval = null;
    this.pongTimeout = null;
    this.lastPongReceived = null;

    // Message queue for offline messages
    this.messageQueue = [];
    this.requestIdCounter = 0;
    this.pendingRequests = new Map();
  }

  /**
   * Connect to WebSocket server
   */
  async connect() {
    if (this.state === CONNECTION_STATE.CONNECTED ||
        this.state === CONNECTION_STATE.CONNECTING) {
      return { success: false, error: 'Already connected or connecting' };
    }

    this.setState(CONNECTION_STATE.CONNECTING);
    this.emit('connecting');

    try {
      this.ws = new WebSocket(this.url);
      this.setupEventHandlers();

      // Wait for connection with timeout
      await this.waitForConnection();

      return { success: true };
    } catch (error) {
      this.handleConnectionError(error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Wait for WebSocket connection to open
   */
  waitForConnection() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, TIMING.WEBSOCKET_CONNECT_TIMEOUT);

      this.ws.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.ws.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Set up WebSocket event handlers
   */
  setupEventHandlers() {
    this.ws.on('open', () => this.handleOpen());
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('close', (code, reason) => this.handleClose(code, reason));
    this.ws.on('error', (error) => this.handleError(error));
  }

  /**
   * Handle WebSocket open event
   */
  handleOpen() {
    this.setState(CONNECTION_STATE.CONNECTED);
    this.reconnectAttempts = 0;
    this.reconnectDelay = this.baseReconnectDelay; // Reset to base delay

    this.emit('connected');

    // Start heartbeat
    this.startHeartbeat();

    // Process queued messages
    this.processMessageQueue();
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());

      // Handle pong responses
      if (message.type === WS_MESSAGE_TYPE.PONG) {
        this.handlePong();
        return;
      }

      // Handle connected welcome message
      if (message.type === WS_MESSAGE_TYPE.CONNECTED) {
        this.emit('welcome', message);
        return;
      }

      // Handle session joined confirmation
      if (message.type === WS_MESSAGE_TYPE.SESSION_JOINED) {
        this.sessionId = message.sessionId;
        this.emit('session_joined', message);
        return;
      }

      // Handle orchestrator responses
      if (message.type === WS_MESSAGE_TYPE.ORCHESTRATOR_RESPONSE) {
        this.handleOrchestratorResponse(message);
        return;
      }

      // Emit all other messages to listeners
      this.emit('message', message);

      // Emit specific message type events
      if (message.type) {
        this.emit(message.type, message);
      }
    } catch (error) {
      this.emit('parse_error', { error, data });
    }
  }

  /**
   * Handle WebSocket close event
   */
  handleClose(code, reason) {
    this.cleanup();

    const reasonString = reason.toString() || 'Unknown reason';
    this.emit('disconnected', { code, reason: reasonString });

    // Attempt reconnection if appropriate
    if (this.shouldReconnect && code !== 1000) {
      this.scheduleReconnect();
    } else {
      this.setState(CONNECTION_STATE.DISCONNECTED);
    }
  }

  /**
   * Handle WebSocket error event
   */
  handleError(error) {
    this.emit('error', error);
  }

  /**
   * Handle connection errors
   */
  handleConnectionError(error) {
    this.setState(CONNECTION_STATE.ERROR);
    this.emit('connection_error', error);

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.setState(CONNECTION_STATE.RECONNECTING);
    this.reconnectAttempts++;

    // Calculate backoff delay with exponential increase
    const delay = Math.min(
      this.reconnectDelay * Math.pow(TIMING.WEBSOCKET_RECONNECT_MULTIPLIER, this.reconnectAttempts - 1),
      TIMING.WEBSOCKET_RECONNECT_MAX_DELAY
    );

    this.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      delay
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Start heartbeat ping/pong
   */
  startHeartbeat() {
    this.stopHeartbeat();

    this.pingInterval = setInterval(() => {
      if (this.state === CONNECTION_STATE.CONNECTED) {
        this.sendPing();
      }
    }, this.heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Send ping message
   */
  sendPing() {
    if (this.state !== CONNECTION_STATE.CONNECTED) {
      return;
    }

    try {
      this.send({ type: WS_MESSAGE_TYPE.PING });

      // Set timeout for pong response
      this.pongTimeout = setTimeout(() => {
        this.handlePongTimeout();
      }, TIMING.WEBSOCKET_PONG_TIMEOUT);
    } catch (error) {
      this.emit('ping_error', error);
    }
  }

  /**
   * Handle pong response
   */
  handlePong() {
    this.lastPongReceived = Date.now();

    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Handle pong timeout (connection likely dead)
   */
  handlePongTimeout() {
    this.emit('heartbeat_timeout');
    this.disconnect();

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Join a session
   */
  joinSession(sessionId) {
    this.sessionId = sessionId;
    this.send({
      type: WS_MESSAGE_TYPE.JOIN_SESSION,
      sessionId,
    });
  }

  /**
   * Send orchestrator request
   */
  sendOrchestratorRequest(action, payload, projectDir) {
    const requestId = this.generateRequestId();

    const message = {
      type: WS_MESSAGE_TYPE.ORCHESTRATOR_REQUEST,
      requestId,
      action,
      payload,
      projectDir,
    };

    return new Promise((resolve, reject) => {
      // Store pending request
      this.pendingRequests.set(requestId, { resolve, reject, timestamp: Date.now() });

      // Send message
      try {
        this.send(message);
      } catch (error) {
        this.pendingRequests.delete(requestId);
        reject(error);
      }

      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, TIMING.HTTP_TIMEOUT);
    });
  }

  /**
   * Handle orchestrator response
   */
  handleOrchestratorResponse(message) {
    const { requestId, response, error } = message;

    if (this.pendingRequests.has(requestId)) {
      const { resolve, reject } = this.pendingRequests.get(requestId);
      this.pendingRequests.delete(requestId);

      if (error) {
        reject(new Error(error));
      } else {
        resolve(response);
      }
    }
  }

  /**
   * Send message
   */
  send(message) {
    if (this.state !== CONNECTION_STATE.CONNECTED) {
      // Queue message if disconnected
      this.messageQueue.push(message);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      this.emit('send_error', error);
      throw error;
    }
  }

  /**
   * Process queued messages
   */
  processMessageQueue() {
    while (this.messageQueue.length > 0 && this.state === CONNECTION_STATE.CONNECTED) {
      const message = this.messageQueue.shift();
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        this.emit('queue_process_error', error);
        // Re-queue message
        this.messageQueue.unshift(message);
        break;
      }
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    this.shouldReconnect = false;
    this.cleanup();

    if (this.ws) {
      try {
        this.ws.close(1000, 'Client disconnect');
      } catch (error) {
        // Ignore close errors
      }
      this.ws = null;
    }

    this.setState(CONNECTION_STATE.DISCONNECTED);
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Remove WebSocket event listeners
    if (this.ws) {
      this.ws.removeAllListeners();
    }
  }

  /**
   * Set connection state
   */
  setState(newState) {
    const oldState = this.state;
    this.state = newState;

    if (oldState !== newState) {
      this.emit('state_change', { oldState, newState });
    }
  }

  /**
   * Generate unique request ID
   */
  generateRequestId() {
    this.requestIdCounter++;
    return `req-${Date.now()}-${this.requestIdCounter}`;
  }

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.state === CONNECTION_STATE.CONNECTED;
  }

  /**
   * Get session ID
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * Get connection stats
   */
  getStats() {
    return {
      state: this.state,
      sessionId: this.sessionId,
      reconnectAttempts: this.reconnectAttempts,
      queuedMessages: this.messageQueue.length,
      pendingRequests: this.pendingRequests.size,
      lastPongReceived: this.lastPongReceived,
    };
  }
}

export default WebSocketManager;
