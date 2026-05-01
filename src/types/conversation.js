/**
 * Conversation Data Model - Type definitions and validation for conversations
 * 
 * Purpose:
 * - Define the structure and properties of conversations
 * - Provide validation functions for conversation data
 * - Handle conversation lifecycle and state management
 */

import { CONVERSATION_STATUS, MESSAGE_ROLES } from '../utilities/constants.js';

/**
 * Conversation data model
 * @typedef {Object} Conversation
 * @property {string} id - Unique conversation identifier
 * @property {string} title - Human-readable conversation title
 * @property {string} agentId - ID of the associated agent
 * @property {string} status - Conversation status (active, archived, suspended)
 * @property {Message[]} messages - Array of conversation messages
 * @property {ConversationMetadata} metadata - Conversation metadata
 * @property {ConversationSettings} settings - Conversation-specific settings
 * @property {ConversationContext} context - Current conversation context
 * @property {string} createdAt - ISO timestamp of creation
 * @property {string} updatedAt - ISO timestamp of last update
 * @property {string} lastMessageAt - ISO timestamp of last message
 * @property {number} messageCount - Total number of messages
 * @property {number} tokenCount - Total tokens used in conversation
 * @property {number} cost - Total cost of conversation (USD)
 * @property {string[]} participants - List of participant IDs
 * @property {Object} summary - Conversation summary data
 */

/**
 * Message data model
 * @typedef {Object} Message
 * @property {string} id - Unique message identifier
 * @property {string} conversationId - ID of parent conversation
 * @property {string} role - Message role (user, assistant, system)
 * @property {string} content - Message content
 * @property {string} agentId - ID of agent (for assistant messages)
 * @property {string} userId - ID of user (for user messages)
 * @property {MessageMetadata} metadata - Message metadata
 * @property {ContextReference[]} contextReferences - Referenced context items
 * @property {ToolExecution[]} toolExecutions - Tool executions in this message
 * @property {TokenUsage} tokenUsage - Token usage for this message
 * @property {string} createdAt - ISO timestamp of creation
 * @property {string} [editedAt] - ISO timestamp of last edit
 * @property {string} [parentMessageId] - ID of parent message (for edits/branches)
 * @property {boolean} isEdited - Whether message has been edited
 * @property {Object} flags - Message flags and annotations
 */

/**
 * Conversation metadata
 * @typedef {Object} ConversationMetadata
 * @property {string[]} tags - Conversation tags
 * @property {string} category - Conversation category
 * @property {string} description - Conversation description
 * @property {boolean} isBookmarked - Whether conversation is bookmarked
 * @property {number} priority - Conversation priority (1-5)
 * @property {string} language - Primary language of conversation
 * @property {Object} customFields - Custom metadata fields
 * @property {string[]} relatedConversations - IDs of related conversations
 */

/**
 * Conversation settings
 * @typedef {Object} ConversationSettings
 * @property {boolean} persistHistory - Whether to persist conversation history
 * @property {number} maxMessages - Maximum number of messages to keep
 * @property {boolean} autoSummarize - Whether to auto-generate summaries
 * @property {number} summarizeThreshold - Message count threshold for summarization
 * @property {boolean} enableContextReferences - Whether context references are enabled
 * @property {number} maxContextReferences - Maximum context references per message
 * @property {Object} notificationSettings - Notification preferences
 * @property {Object} privacySettings - Privacy and sharing settings
 */

/**
 * Conversation context
 * @typedef {Object} ConversationContext
 * @property {string} currentTopic - Current conversation topic
 * @property {string[]} mentionedEntities - Entities mentioned in conversation
 * @property {Object} variables - Context variables and their values
 * @property {string[]} activeTools - Currently active/relevant tools
 * @property {Object} workingMemory - Short-term memory for conversation
 * @property {Object} preferences - User preferences relevant to conversation
 * @property {string} phase - Current conversation phase
 * @property {Object} goals - Conversation goals and objectives
 */

/**
 * Message metadata
 * @typedef {Object} MessageMetadata
 * @property {string} model - AI model used (for assistant messages)
 * @property {number} temperature - Generation temperature used
 * @property {number} responseTime - Time taken to generate response (ms)
 * @property {string} ipAddress - IP address of sender (if applicable)
 * @property {string} userAgent - User agent string (if applicable)
 * @property {Object} modelParameters - Model-specific parameters used
 * @property {string} generationId - Unique generation identifier
 * @property {Object} annotations - Message annotations and labels
 */

/**
 * Token usage information
 * @typedef {Object} TokenUsage
 * @property {number} promptTokens - Tokens used in prompt
 * @property {number} completionTokens - Tokens used in completion
 * @property {number} totalTokens - Total tokens used
 * @property {number} cost - Cost of token usage (USD)
 * @property {string} model - Model used for generation
 * @property {Object} breakdown - Detailed token usage breakdown
 */

/**
 * Context reference in messages
 * @typedef {Object} ContextReference
 * @property {string} id - Unique reference identifier
 * @property {string} type - Reference type (file, component, selection, directory)
 * @property {string} path - Path or identifier of referenced item
 * @property {string} name - Human-readable name
 * @property {string} [content] - Referenced content (if applicable)
 * @property {number} [startLine] - Start line (for selections)
 * @property {number} [endLine] - End line (for selections)
 * @property {Object} metadata - Reference metadata
 */

/**
 * Tool execution information
 * @typedef {Object} ToolExecution
 * @property {string} id - Unique execution identifier
 * @property {string} toolId - Tool identifier
 * @property {string} status - Execution status (pending, executing, completed, failed)
 * @property {Object} input - Tool input parameters
 * @property {Object} [output] - Tool output (if completed)
 * @property {string} [error] - Error message (if failed)
 * @property {number} executionTime - Execution time in milliseconds
 * @property {string} startedAt - ISO timestamp when execution started
 * @property {string} [completedAt] - ISO timestamp when execution completed
 */

/**
 * Conversation validation functions
 */
export class ConversationValidator {
  /**
   * Validate conversation data structure
   * @param {Object} conversation - Conversation data to validate
   * @returns {Object} Validation result
   */
  static validate(conversation) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!conversation.id || typeof conversation.id !== 'string') {
      errors.push('Conversation ID is required and must be a string');
    }

    if (!conversation.agentId || typeof conversation.agentId !== 'string') {
      errors.push('Agent ID is required and must be a string');
    }

    if (!conversation.title || typeof conversation.title !== 'string') {
      errors.push('Conversation title is required and must be a string');
    }

    if (conversation.title && conversation.title.length > 200) {
      warnings.push('Conversation title is very long (>200 characters)');
    }

    // Status validation
    if (conversation.status && !Object.values(CONVERSATION_STATUS).includes(conversation.status)) {
      errors.push(`Invalid conversation status: ${conversation.status}`);
    }

    // Messages validation
    if (conversation.messages && !Array.isArray(conversation.messages)) {
      errors.push('Messages must be an array');
    }

    if (conversation.messages) {
      conversation.messages.forEach((message, index) => {
        const messageValidation = this.validateMessage(message);
        messageValidation.errors.forEach(error => {
          errors.push(`Message ${index}: ${error}`);
        });
        messageValidation.warnings.forEach(warning => {
          warnings.push(`Message ${index}: ${warning}`);
        });
      });
    }

    // Numeric validations
    if (conversation.messageCount !== undefined && typeof conversation.messageCount !== 'number') {
      errors.push('Message count must be a number');
    }

    if (conversation.tokenCount !== undefined && typeof conversation.tokenCount !== 'number') {
      errors.push('Token count must be a number');
    }

    if (conversation.cost !== undefined && typeof conversation.cost !== 'number') {
      errors.push('Cost must be a number');
    }

    // Participants validation
    if (conversation.participants && !Array.isArray(conversation.participants)) {
      errors.push('Participants must be an array');
    }

    // Timestamp validation
    const timestampFields = ['createdAt', 'updatedAt', 'lastMessageAt'];
    timestampFields.forEach(field => {
      if (conversation[field] && !this.isValidTimestamp(conversation[field])) {
        errors.push(`Invalid timestamp for ${field}: ${conversation[field]}`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate message data structure
   * @param {Object} message - Message data to validate
   * @returns {Object} Validation result
   */
  static validateMessage(message) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!message.id || typeof message.id !== 'string') {
      errors.push('Message ID is required and must be a string');
    }

    if (!message.conversationId || typeof message.conversationId !== 'string') {
      errors.push('Conversation ID is required and must be a string');
    }

    if (!message.role || typeof message.role !== 'string') {
      errors.push('Message role is required and must be a string');
    }

    if (message.role && !Object.values(MESSAGE_ROLES).includes(message.role)) {
      errors.push(`Invalid message role: ${message.role}`);
    }

    if (!message.content || typeof message.content !== 'string') {
      errors.push('Message content is required and must be a string');
    }

    if (message.content && message.content.length > 100000) {
      warnings.push('Message content is very long (>100000 characters)');
    }

    // Role-specific validations
    if (message.role === MESSAGE_ROLES.ASSISTANT && !message.agentId) {
      errors.push('Assistant messages must have an agentId');
    }

    if (message.role === MESSAGE_ROLES.USER && !message.userId) {
      warnings.push('User messages should have a userId');
    }

    // Context references validation
    if (message.contextReferences && !Array.isArray(message.contextReferences)) {
      errors.push('Context references must be an array');
    }

    // Tool executions validation
    if (message.toolExecutions && !Array.isArray(message.toolExecutions)) {
      errors.push('Tool executions must be an array');
    }

    // Token usage validation
    if (message.tokenUsage) {
      const tokenValidation = this.validateTokenUsage(message.tokenUsage);
      errors.push(...tokenValidation.errors);
      warnings.push(...tokenValidation.warnings);
    }

    // Timestamp validation
    if (message.createdAt && !this.isValidTimestamp(message.createdAt)) {
      errors.push(`Invalid createdAt timestamp: ${message.createdAt}`);
    }

    if (message.editedAt && !this.isValidTimestamp(message.editedAt)) {
      errors.push(`Invalid editedAt timestamp: ${message.editedAt}`);
    }

    return { errors, warnings };
  }

  /**
   * Validate token usage data
   * @param {Object} tokenUsage - Token usage to validate
   * @returns {Object} Validation result
   */
  static validateTokenUsage(tokenUsage) {
    const errors = [];
    const warnings = [];

    if (typeof tokenUsage.totalTokens !== 'number' || tokenUsage.totalTokens < 0) {
      errors.push('Total tokens must be a non-negative number');
    }

    if (tokenUsage.promptTokens !== undefined && (typeof tokenUsage.promptTokens !== 'number' || tokenUsage.promptTokens < 0)) {
      errors.push('Prompt tokens must be a non-negative number');
    }

    if (tokenUsage.completionTokens !== undefined && (typeof tokenUsage.completionTokens !== 'number' || tokenUsage.completionTokens < 0)) {
      errors.push('Completion tokens must be a non-negative number');
    }

    if (tokenUsage.cost !== undefined && (typeof tokenUsage.cost !== 'number' || tokenUsage.cost < 0)) {
      errors.push('Cost must be a non-negative number');
    }

    if (tokenUsage.promptTokens && tokenUsage.completionTokens) {
      const calculatedTotal = tokenUsage.promptTokens + tokenUsage.completionTokens;
      if (Math.abs(calculatedTotal - tokenUsage.totalTokens) > 1) {
        warnings.push('Total tokens does not match sum of prompt and completion tokens');
      }
    }

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
 * Conversation factory functions
 */
export class ConversationFactory {
  /**
   * Create a new conversation
   * @param {string} agentId - Agent ID
   * @param {string} title - Conversation title
   * @param {Object} options - Additional options
   * @returns {Conversation} New conversation object
   */
  static create(agentId, title, options = {}) {
    const now = new Date().toISOString();
    const conversationId = this.generateConversationId();

    return {
      id: conversationId,
      title: title || 'New Conversation',
      agentId,
      status: CONVERSATION_STATUS.ACTIVE,
      messages: [],
      metadata: this.createDefaultMetadata(options.metadata),
      settings: this.createDefaultSettings(options.settings),
      context: this.createDefaultContext(),
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      messageCount: 0,
      tokenCount: 0,
      cost: 0,
      participants: [agentId, ...(options.participants || [])],
      summary: {}
    };
  }

  /**
   * Create a new message
   * @param {string} conversationId - Conversation ID
   * @param {string} role - Message role
   * @param {string} content - Message content
   * @param {Object} options - Additional options
   * @returns {Message} New message object
   */
  static createMessage(conversationId, role, content, options = {}) {
    const now = new Date().toISOString();
    const messageId = this.generateMessageId();

    return {
      id: messageId,
      conversationId,
      role,
      content,
      agentId: options.agentId || null,
      userId: options.userId || null,
      metadata: options.metadata || {},
      contextReferences: options.contextReferences || [],
      toolExecutions: options.toolExecutions || [],
      tokenUsage: options.tokenUsage || null,
      createdAt: now,
      editedAt: null,
      parentMessageId: options.parentMessageId || null,
      isEdited: false,
      flags: options.flags || {}
    };
  }

  /**
   * Create default conversation metadata
   * @param {Object} overrides - Metadata overrides
   * @returns {ConversationMetadata} Default metadata
   */
  static createDefaultMetadata(overrides = {}) {
    return {
      tags: [],
      category: 'general',
      description: '',
      isBookmarked: false,
      priority: 3,
      language: 'en',
      customFields: {},
      relatedConversations: [],
      ...overrides
    };
  }

  /**
   * Create default conversation settings
   * @param {Object} overrides - Settings overrides
   * @returns {ConversationSettings} Default settings
   */
  static createDefaultSettings(overrides = {}) {
    return {
      persistHistory: true,
      maxMessages: 1000,
      autoSummarize: true,
      summarizeThreshold: 50,
      enableContextReferences: true,
      maxContextReferences: 10,
      notificationSettings: {
        newMessage: true,
        agentResponse: true,
        toolExecution: false
      },
      privacySettings: {
        shareHistory: false,
        allowAnalytics: true
      },
      ...overrides
    };
  }

  /**
   * Create default conversation context
   * @returns {ConversationContext} Default context
   */
  static createDefaultContext() {
    return {
      currentTopic: null,
      mentionedEntities: [],
      variables: {},
      activeTools: [],
      workingMemory: {},
      preferences: {},
      phase: 'initial',
      goals: {}
    };
  }

  /**
   * Generate unique conversation ID
   * @returns {string} Unique conversation ID
   */
  static generateConversationId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `conv_${timestamp}_${random}`;
  }

  /**
   * Generate unique message ID
   * @returns {string} Unique message ID
   */
  static generateMessageId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `msg_${timestamp}_${random}`;
  }
}

/**
 * Conversation utility functions
 */
export class ConversationUtils {
  /**
   * Calculate conversation statistics
   * @param {Conversation} conversation - Conversation to analyze
   * @returns {Object} Conversation statistics
   */
  static getStatistics(conversation) {
    const messages = conversation.messages || [];
    const userMessages = messages.filter(m => m.role === MESSAGE_ROLES.USER);
    const assistantMessages = messages.filter(m => m.role === MESSAGE_ROLES.ASSISTANT);
    const systemMessages = messages.filter(m => m.role === MESSAGE_ROLES.SYSTEM);

    const totalTokens = messages.reduce((sum, m) => sum + (m.tokenUsage?.totalTokens || 0), 0);
    const totalCost = messages.reduce((sum, m) => sum + (m.tokenUsage?.cost || 0), 0);

    const toolExecutions = messages.reduce((sum, m) => sum + (m.toolExecutions?.length || 0), 0);
    const contextReferences = messages.reduce((sum, m) => sum + (m.contextReferences?.length || 0), 0);

    return {
      totalMessages: messages.length,
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      systemMessages: systemMessages.length,
      totalTokens,
      totalCost,
      toolExecutions,
      contextReferences,
      averageMessageLength: messages.length > 0 
        ? messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length 
        : 0,
      conversationDuration: this.getConversationDuration(conversation)
    };
  }

  /**
   * Get conversation duration in milliseconds
   * @param {Conversation} conversation - Conversation to analyze
   * @returns {number} Duration in milliseconds
   */
  static getConversationDuration(conversation) {
    if (!conversation.messages || conversation.messages.length === 0) {
      return 0;
    }

    const firstMessage = conversation.messages[0];
    const lastMessage = conversation.messages[conversation.messages.length - 1];

    const startTime = new Date(firstMessage.createdAt);
    const endTime = new Date(lastMessage.createdAt);

    return endTime.getTime() - startTime.getTime();
  }

  /**
   * Generate conversation summary
   * @param {Conversation} conversation - Conversation to summarize
   * @returns {Object} Conversation summary
   */
  static generateSummary(conversation) {
    const stats = this.getStatistics(conversation);
    const messages = conversation.messages || [];

    // Extract key topics and entities
    const topics = this.extractTopics(messages);
    const entities = this.extractEntities(messages);

    // Get recent activity
    const recentMessages = messages.slice(-10);
    const lastActivity = conversation.lastMessageAt || conversation.updatedAt;

    return {
      title: conversation.title,
      messageCount: stats.totalMessages,
      duration: stats.conversationDuration,
      participants: conversation.participants.length,
      topics: topics.slice(0, 5), // Top 5 topics
      entities: entities.slice(0, 10), // Top 10 entities
      lastActivity,
      recentActivity: recentMessages.map(m => ({
        role: m.role,
        timestamp: m.createdAt,
        preview: m.content.substring(0, 100) + (m.content.length > 100 ? '...' : '')
      })),
      stats
    };
  }

  /**
   * Extract topics from conversation messages
   * @param {Message[]} messages - Messages to analyze
   * @returns {string[]} Extracted topics
   */
  static extractTopics(messages) {
    // Simple topic extraction based on keywords
    // In a real implementation, this would use more sophisticated NLP
    const topicKeywords = new Map();
    
    messages.forEach(message => {
      const words = message.content.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 3 && !this.isStopWord(word));
      
      words.forEach(word => {
        topicKeywords.set(word, (topicKeywords.get(word) || 0) + 1);
      });
    });

    return Array.from(topicKeywords.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word);
  }

  /**
   * Extract entities from conversation messages
   * @param {Message[]} messages - Messages to analyze
   * @returns {string[]} Extracted entities
   */
  static extractEntities(messages) {
    // Simple entity extraction
    // In a real implementation, this would use NER
    const entities = new Set();
    
    messages.forEach(message => {
      // Extract capitalized words (potential proper nouns)
      const capitalizedWords = message.content.match(/\b[A-Z][a-z]+\b/g) || [];
      capitalizedWords.forEach(word => entities.add(word));
      
      // Extract file paths
      const filePaths = message.content.match(/\b[\w\/\-\.]+\.\w+\b/g) || [];
      filePaths.forEach(path => entities.add(path));
    });

    return Array.from(entities);
  }

  /**
   * Check if word is a stop word
   * @param {string} word - Word to check
   * @returns {boolean} True if stop word
   */
  static isStopWord(word) {
    const stopWords = new Set([
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before',
      'after', 'above', 'below', 'over', 'under', 'again', 'further',
      'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
      'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other',
      'some', 'such', 'only', 'own', 'same', 'so', 'than', 'too',
      'very', 'can', 'will', 'just', 'should', 'now'
    ]);
    
    return stopWords.has(word.toLowerCase());
  }

  /**
   * Format conversation for export
   * @param {Conversation} conversation - Conversation to format
   * @param {string} format - Export format ('json', 'markdown', 'plain')
   * @returns {string} Formatted conversation
   */
  static formatForExport(conversation, format = 'json') {
    switch (format) {
      case 'markdown':
        return this.formatAsMarkdown(conversation);
      case 'plain':
        return this.formatAsPlainText(conversation);
      case 'json':
      default:
        return JSON.stringify(conversation, null, 2);
    }
  }

  /**
   * Format conversation as markdown
   * @param {Conversation} conversation - Conversation to format
   * @returns {string} Markdown formatted conversation
   */
  static formatAsMarkdown(conversation) {
    let markdown = `# ${conversation.title}\n\n`;
    markdown += `**Created:** ${new Date(conversation.createdAt).toLocaleString()}\n`;
    markdown += `**Agent:** ${conversation.agentId}\n`;
    markdown += `**Messages:** ${conversation.messageCount}\n\n`;
    
    conversation.messages.forEach(message => {
      const timestamp = new Date(message.createdAt).toLocaleTimeString();
      const role = message.role.charAt(0).toUpperCase() + message.role.slice(1);
      
      markdown += `## ${role} (${timestamp})\n\n`;
      markdown += `${message.content}\n\n`;
      
      if (message.contextReferences && message.contextReferences.length > 0) {
        markdown += `**Context References:**\n`;
        message.contextReferences.forEach(ref => {
          markdown += `- ${ref.name} (${ref.type})\n`;
        });
        markdown += '\n';
      }
    });
    
    return markdown;
  }

  /**
   * Format conversation as plain text
   * @param {Conversation} conversation - Conversation to format
   * @returns {string} Plain text formatted conversation
   */
  static formatAsPlainText(conversation) {
    let text = `Conversation: ${conversation.title}\n`;
    text += `Created: ${new Date(conversation.createdAt).toLocaleString()}\n`;
    text += `Agent: ${conversation.agentId}\n`;
    text += `Messages: ${conversation.messageCount}\n\n`;
    
    text += '-'.repeat(50) + '\n\n';
    
    conversation.messages.forEach(message => {
      const timestamp = new Date(message.createdAt).toLocaleTimeString();
      const role = message.role.toUpperCase();
      
      text += `[${timestamp}] ${role}:\n`;
      text += `${message.content}\n\n`;
    });
    
    return text;
  }
}

export default {
  ConversationValidator,
  ConversationFactory,
  ConversationUtils
};