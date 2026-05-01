/**
 * Message Router
 * Routes incoming WebSocket messages to appropriate handlers
 * Provides a clean separation between WebSocket transport and message handling
 */

import { EventEmitter } from 'events';
import { WS_MESSAGE_TYPE } from '../config/constants.js';

/**
 * Message Router Class
 * Routes WebSocket messages to registered handlers
 */
export class MessageRouter extends EventEmitter {
  constructor(websocketManager) {
    super();

    this.ws = websocketManager;
    this.handlers = new Map();
    this.middleware = [];

    // Set up WebSocket message listener
    this.ws.on('message', (message) => this.route(message));

    // Register default handlers
    this.registerDefaultHandlers();
  }

  /**
   * Register default message handlers
   */
  registerDefaultHandlers() {
    // Agent-related messages
    this.registerHandler(WS_MESSAGE_TYPE.MESSAGE_ADDED, (message) => {
      this.emit('agent:message_added', message.data);
    });

    this.registerHandler(WS_MESSAGE_TYPE.AGENT_MODE_CHANGED, (message) => {
      this.emit('agent:mode_changed', message);
    });

    this.registerHandler(WS_MESSAGE_TYPE.EXECUTION_STOPPED, (message) => {
      this.emit('agent:execution_stopped', message.data);
    });

    this.registerHandler(WS_MESSAGE_TYPE.AGENT_ERROR, (message) => {
      this.emit('agent:error', message);
    });

    this.registerHandler(WS_MESSAGE_TYPE.AGENT_WARNING, (message) => {
      this.emit('agent:warning', message);
    });

    this.registerHandler(WS_MESSAGE_TYPE.AGENT_IMPORTED, (message) => {
      this.emit('agent:imported', message.agent);
    });

    this.registerHandler(WS_MESSAGE_TYPE.AGENT_COMMUNICATION, (message) => {
      this.emit('agent:communication', message.data);
    });

    // Conversation compaction
    this.registerHandler(WS_MESSAGE_TYPE.COMPACTION_EVENT, (message) => {
      this.emit('conversation:compaction', message.data);
    });

    // Image generation
    this.registerHandler(WS_MESSAGE_TYPE.IMAGE_RESULT, (message) => {
      this.emit('image:result', message.data);
    });

    this.registerHandler(WS_MESSAGE_TYPE.IMAGE_GENERATED, (message) => {
      this.emit('image:generated', message.data);
    });

    // Error messages
    this.registerHandler(WS_MESSAGE_TYPE.ERROR, (message) => {
      this.emit('error', message);
    });
  }

  /**
   * Route incoming message to appropriate handler
   */
  async route(message) {
    // Run through middleware first
    let processedMessage = message;

    for (const middleware of this.middleware) {
      try {
        processedMessage = await middleware(processedMessage);

        // If middleware returns null/undefined, stop processing
        if (!processedMessage) {
          return;
        }
      } catch (error) {
        this.emit('middleware_error', { error, message });
        return;
      }
    }

    // Get message type
    const messageType = processedMessage.type;

    if (!messageType) {
      this.emit('invalid_message', processedMessage);
      return;
    }

    // Call registered handler if exists
    if (this.handlers.has(messageType)) {
      const handler = this.handlers.get(messageType);

      try {
        await handler(processedMessage);
      } catch (error) {
        this.emit('handler_error', { error, message: processedMessage, messageType });
      }
    }

    // Always emit the raw message type event for flexibility
    this.emit(`message:${messageType}`, processedMessage);

    // Emit generic message event
    this.emit('message', processedMessage);
  }

  /**
   * Register a message handler for specific message type
   */
  registerHandler(messageType, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    this.handlers.set(messageType, handler);
  }

  /**
   * Unregister a message handler
   */
  unregisterHandler(messageType) {
    this.handlers.delete(messageType);
  }

  /**
   * Add middleware function
   * Middleware can transform messages or filter them
   */
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new Error('Middleware must be a function');
    }

    this.middleware.push(middleware);
  }

  /**
   * Remove middleware function
   */
  removeMiddleware(middleware) {
    const index = this.middleware.indexOf(middleware);
    if (index > -1) {
      this.middleware.splice(index, 1);
    }
  }

  /**
   * Clear all middleware
   */
  clearMiddleware() {
    this.middleware = [];
  }

  /**
   * Get all registered message types
   */
  getRegisteredTypes() {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if handler exists for message type
   */
  hasHandler(messageType) {
    return this.handlers.has(messageType);
  }

  /**
   * Remove all handlers
   */
  clearHandlers() {
    this.handlers.clear();
  }

  /**
   * Reset router (clear handlers and middleware)
   */
  reset() {
    this.clearHandlers();
    this.clearMiddleware();
    this.registerDefaultHandlers();
  }
}

/**
 * Logging middleware - logs all messages
 */
export function loggingMiddleware(logFunction = console.log) {
  return (message) => {
    logFunction('[MessageRouter]', message.type, message);
    return message;
  };
}

/**
 * Filter middleware - filters messages by type
 */
export function filterMiddleware(allowedTypes) {
  return (message) => {
    if (allowedTypes.includes(message.type)) {
      return message;
    }
    return null; // Stop processing
  };
}

/**
 * Transform middleware - transforms message structure
 */
export function transformMiddleware(transformer) {
  return async (message) => {
    return await transformer(message);
  };
}

/**
 * Timestamp middleware - adds received timestamp
 */
export function timestampMiddleware() {
  return (message) => {
    return {
      ...message,
      receivedAt: new Date().toISOString(),
    };
  };
}

/**
 * Validation middleware - validates message structure
 */
export function validationMiddleware(validator) {
  return (message) => {
    if (validator(message)) {
      return message;
    }
    throw new Error('Message validation failed');
  };
}

export default MessageRouter;
