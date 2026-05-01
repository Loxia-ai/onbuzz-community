/**
 * AgentCommunicationTool - Enables inter-agent communication with safety mechanisms
 * 
 * Purpose:
 * - Allow agents to discover and communicate with other active agents
 * - Manage message threads with reply tracking
 * - Prevent conversation loops and exponential message growth
 * - Support file attachments for rich communication
 * 
 * Design Principles:
 * - Loosely coupled with system components
 * - Message persistence for async communication
 * - Conversation limits to prevent runaway threads
 * - Agent lifecycle awareness
 */

import { BaseTool } from './baseTool.js';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

class AgentCommunicationTool extends BaseTool {
  constructor(config = {}) {
    super('agentcommunication', 'Agent Communication', 'communication');
    
    // Configuration with safety defaults
    this.config = {
      maxConversationDepth: config.maxConversationDepth || 10,
      maxRecipientsPerMessage: config.maxRecipientsPerMessage || 3,
      maxAttachmentSize: config.maxAttachmentSize || 10 * 1024 * 1024, // 10MB
      maxAttachmentsPerMessage: config.maxAttachmentsPerMessage || 5,
      conversationTimeout: config.conversationTimeout || 3600000, // 1 hour
      messageRetentionPeriod: config.messageRetentionPeriod || 86400000, // 24 hours
      enableBroadcast: config.enableBroadcast || false,
      storageDir: config.storageDir || '.loxia-messages'
    };
    
    // Message storage - in production, this would be a database
    this.messages = new Map(); // messageId -> message object

    // Shared helper for every check-point to resolve effective limits
    // from global defaults + per-agent overrides (agent.toolConfig.agentcommunication).
    // See BaseTool#getEffectiveConfig — per-agent fields win.
    this._limits = (context) => this.getEffectiveConfig(context || {}, this.config);
    this.conversations = new Map(); // conversationId -> conversation metadata
    this.agentInboxes = new Map(); // agentId -> Set of messageIds
    this.agentConversations = new Map(); // agentId -> Set of conversationIds
    
    // Safety tracking
    this.conversationDepths = new Map(); // conversationId -> current depth
    this.lastActivityTimes = new Map(); // conversationId -> timestamp
    this.agentMessageCounts = new Map(); // agentId -> { sent: number, received: number }
    
    // Initialize storage directory
    this._initializeStorage();
  }

  /**
   * Get tool description for agent system prompts
   */
  getDescription() {
    return `
Agent Communication Tool: Enables communication between active agents.

USAGE:
\`\`\`json
{
  "toolId": "agentcommunication",
  "actions": [{"type": "action-name", ...params}]
}
\`\`\`

ACTIONS:
- get-available-agents: List active agents
- send-message: Send message (recipient, subject, message, priority, requiresReply)
- reply-to-message: Reply to message (messageId, message)
- get-unreplied-messages: Get pending messages
- mark-conversation-ended: End conversation (conversationId, reason)

requiresReply PARAMETER (send-message):
- Defaults to true. Set to false ONLY for fire-and-forget notifications where you do NOT need a response.
- When true, the recipient agent will be explicitly instructed to reply back to you.
- When false, the recipient will handle the message but is not expected to reply.

EXAMPLES:

Get available agents:
\`\`\`json
{"toolId": "agentcommunication", "actions": [{"type": "get-available-agents"}]}
\`\`\`

Send a message:
\`\`\`json
{
  "toolId": "agentcommunication",
  "actions": [{
    "type": "send-message",
    "recipient": "agent-fullstack-developer-1234567890123",
    "subject": "Code review needed",
    "message": "Please review the authentication module",
    "priority": "normal",
    "requiresReply": true
  }]
}
\`\`\`

Reply to a message:
\`\`\`json
{
  "toolId": "agentcommunication",
  "actions": [{
    "type": "reply-to-message",
    "messageId": "msg-789",
    "message": "Review complete. All issues addressed."
  }]
}
\`\`\`

IMPORTANT: Use full agent ID from get-available-agents as recipient.

LIMITS:
- Max ${this.config.maxConversationDepth} replies per thread
- Max ${this.config.maxRecipientsPerMessage} recipients per message
- Conversations expire after ${this.config.conversationTimeout / 60000} minutes
`.trim();
  }

  /**
   * Parse tool parameters from command content
   */
  parseParameters(content) {
    // Handle JSON format (for direct tool calls)
    if (typeof content === 'object' && content !== null) {
      // If it's already an object, extract the parameters
      if (content.actions && Array.isArray(content.actions) && content.actions.length > 0) {
        // Handle format: {"actions": [{"type": "get-available-agents", ...}]}
        const action = content.actions[0];
        return {
          action: action.type,
          ...action
        };
      } else if (content.action || content.type) {
        // Handle format: {"action": "get-available-agents", ...}
        return {
          action: content.action || content.type,
          ...content
        };
      }
      return content;
    }
    
    // Handle string content (could be JSON string or XML)
    if (typeof content === 'string') {
      // Try parsing as JSON first
      if (content.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(content);
          return this.parseParameters(parsed); // Recursive call to handle the parsed object
        } catch (error) {
          // Not valid JSON, continue to XML parsing
        }
      }
      
      // Parse XML-style commands for agent communication
      const parameters = {};
      
      // Extract action parameter
      const actionMatch = content.match(/<action[^>]*>([^<]+)<\/action>/);
      if (actionMatch) {
        parameters.action = actionMatch[1].trim();
      }
      
      // Extract other parameters like recipient, subject, message, etc.
      const tags = [
        'recipient', 'recipients', 'subject', 'message', 'attachments', 
        'priority', 'requires-reply', 'message-id', 'cc-recipients', 
        'include-low-priority', 'conversation-id', 'reason', 'mark-resolved'
      ];
      
      for (const tag of tags) {
        const regex = new RegExp(`<${tag.replace('-', '\\-')}[^>]*>(.*?)<\\/${tag.replace('-', '\\-')}>`, 's');
        const match = content.match(regex);
        if (match) {
          let value = match[1].trim();
          // Try to parse JSON values
          if (value.startsWith('[') || value.startsWith('{') || value === 'true' || value === 'false') {
            try {
              value = JSON.parse(value);
            } catch {
              // Keep as string if JSON parsing fails
            }
          }
          // Convert kebab-case to camelCase for parameter names
          const paramName = tag.replace(/-(.)/g, (_, char) => char.toUpperCase());
          parameters[paramName] = value;
        }
      }
      
      // Extract attributes from action tag if present
      const actionWithAttribs = content.match(/<action([^>]*)>([^<]+)<\/action>/);
      if (actionWithAttribs && actionWithAttribs[1]) {
        // Parse attributes like priority="high", requires-reply="true"
        const attribMatches = actionWithAttribs[1].matchAll(/([\w-]+)=["']([^"']+)["']/g);
        for (const match of attribMatches) {
          const key = match[1].replace(/-(.)/g, (_, char) => char.toUpperCase()); // Convert kebab-case to camelCase
          parameters[key] = match[2];
        }
      }
      
      return parameters;
    }
    
    // Fallback
    return content || {};
  }

  /**
   * Execute the tool action
   */
  async execute(parameters = {}, context = {}) {
    const { action } = parameters;
    
    if (!action) {
      throw new Error('Action parameter is required');
    }
    
    // Validate requesting agent exists
    const requestingAgentId = context.agentId;
    if (!requestingAgentId) {
      throw new Error('Agent ID is required in context');
    }
    
    // Route to appropriate action handler
    switch (action.toLowerCase()) {
      case 'get-available-agents':
        return await this.getAvailableAgents(requestingAgentId, parameters, context);
        
      case 'send-message':
        return await this.sendMessage(requestingAgentId, parameters, context);
        
      case 'reply-to-message':
        return await this.replyToMessage(requestingAgentId, parameters, context);
        
      case 'get-unreplied-messages':
        return await this.getUnrepliedMessages(requestingAgentId, parameters, context);
        
      case 'mark-conversation-ended':
        return await this.markConversationEnded(requestingAgentId, parameters, context);
        
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * Get list of available agents
   */
  async getAvailableAgents(requestingAgentId, parameters, context) {
    try {
      // Get agent pool from context
      const agentPool = context.agentPool;
      if (!agentPool) {
        throw new Error('Agent pool not available in context');
      }
      
      // Get all active agents
      const agents = await agentPool.listActiveAgents();

      // Normalize teams metadata to array format
      // Supports: metadata.teams = [{id, name, role}], or legacy metadata.teamId (string)
      const normalizeTeams = (metadata) => {
        if (!metadata) return [];
        // New format: teams array
        if (Array.isArray(metadata.teams)) return metadata.teams;
        // Legacy format: single teamId string
        if (metadata.teamId) {
          return [{ id: metadata.teamId, name: metadata.teamName || null, role: metadata.teamRole || null }];
        }
        return [];
      };

      // Resolve the requesting agent's teams
      const requestingAgent = agents.find(a => a.id === requestingAgentId);
      const myTeams = normalizeTeams(requestingAgent?.metadata);
      const myTeamIds = new Set(myTeams.map(t => t.id));

      // Filter out requesting agent and format response
      const availableAgents = agents
        .filter(agent => agent.id !== requestingAgentId && !agent.isPaused)
        .map(agent => {
          const agentTeams = normalizeTeams(agent.metadata);
          const agentTeamIds = agentTeams.map(t => t.id);
          // Teams shared with the requesting agent
          const sharedTeamIds = agentTeamIds.filter(id => myTeamIds.has(id));

          return {
            id: agent.id,
            name: agent.name,
            type: agent.type,
            capabilities: agent.capabilities,
            status: agent.status,
            // Multi-team affiliation
            teams: agentTeams, // [{id, name, role}, ...]
            // Relationship to the requesting agent
            sameTeam: sharedTeamIds.length > 0,
            sharedTeams: sharedTeamIds, // which team IDs are shared
            messageStats: this.agentMessageCounts.get(agent.id) || { sent: 0, received: 0 },
            activeConversations: (this.agentConversations.get(agent.id) || new Set()).size
          };
        });

      return {
        success: true,
        agents: availableAgents,
        totalActive: availableAgents.length,
        // The requesting agent's own team context
        yourTeams: myTeams.length > 0 ? myTeams : null,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send a message to another agent
   */
  async sendMessage(senderAgentId, parameters, context) {
    try {
      const {
        recipient,
        recipients, // Support both single and multiple
        subject,
        message,
        attachments,
        priority = 'normal',
        'requires-reply': requiresReply = true
      } = parameters;
      
      // Validate required fields
      if (!subject || !message) {
        throw new Error('Subject and message are required');
      }
      
      // Determine recipients
      const recipientList = this._parseRecipients(recipient, recipients);
      if (recipientList.length === 0) {
        throw new Error('At least one recipient is required');
      }
      
      // Validate recipient count — effective limit from per-agent config.
      const _sendLimits = this._limits(context);
      if (recipientList.length > _sendLimits.maxRecipientsPerMessage) {
        throw new Error(`Maximum ${_sendLimits.maxRecipientsPerMessage} recipients allowed`);
      }

      // Get agent pool and sender agent
      const agentPool = context.agentPool;
      const senderAgent = await agentPool.getAgent(senderAgentId);
      if (!senderAgent) {
        throw new Error('Sender agent not found');
      }
      
      // CRITICAL: Check if sender can send messages to recipients
      const blockedRecipients = [];
      for (const recipientId of recipientList) {
        const canSend = await this._canSendMessage(senderAgent, recipientId, context);
        if (!canSend.allowed) {
          blockedRecipients.push({
            recipientId,
            reason: canSend.reason,
            waitUntil: canSend.waitUntil
          });
        }
      }
      
      // If any recipients are blocked, apply delay and return
      if (blockedRecipients.length > 0) {
        const earliestAllowedTime = Math.max(...blockedRecipients.map(b => b.waitUntil || 0));
        const delayUntil = new Date(earliestAllowedTime);
        
        // Apply delay using existing infrastructure
        await agentPool.updateAgent(senderAgentId, {
          delayEndTime: delayUntil.toISOString()
        });
        
        const delaySeconds = Math.ceil((earliestAllowedTime - Date.now()) / 1000);
        
        return {
          success: true,
          delayed: true,
          delayUntil: delayUntil.toISOString(),
          delaySeconds,
          message: `Waiting ${delaySeconds}s before next message. Recipients need time to respond.`,
          blockedRecipients: blockedRecipients.map(b => ({
            recipientId: b.recipientId,
            reason: b.reason
          }))
        };
      }
      
      // Validate recipients exist and get their names
      const recipientAgents = {};
      const invalidRecipients = [];
      
      for (const recipientId of recipientList) {
        const agent = await agentPool.getAgent(recipientId);
        if (!agent) {
          invalidRecipients.push(recipientId);
        } else {
          recipientAgents[recipientId] = agent.name;
        }
      }
      
      // If any recipients are invalid, provide helpful error with suggestions
      if (invalidRecipients.length > 0) {
        const availableAgents = await agentPool.listActiveAgents();
        const suggestions = availableAgents
          .filter(agent => agent.id !== senderAgentId && !agent.isPaused)
          .map(agent => `- ${agent.name} (ID: ${agent.id})`)
          .join('\n');
        
        return {
          success: false,
          error: `Recipient agent(s) not found: ${invalidRecipients.join(', ')}`,
          suggestion: `Available agents you can message:\n${suggestions}`,
          availableAgents: availableAgents.map(agent => ({
            id: agent.id,
            name: agent.name,
            capabilities: agent.capabilities
          }))
        };
      }
      
      // Get sender agent name
      const senderName = senderAgent ? senderAgent.name : senderAgentId;
      
      // Process attachments if provided
      const processedAttachments = await this._processAttachments(attachments, senderAgentId, context);
      
      // Create message object
      const messageId = this._generateMessageId();
      const conversationId = this._generateConversationId();
      const timestamp = new Date().toISOString();
      
      const messageObj = {
        id: messageId,
        conversationId,
        sender: senderAgentId,
        senderName,
        recipients: recipientList,
        recipientNames: recipientAgents,
        subject,
        content: message,
        attachments: processedAttachments,
        priority,
        requiresReply,
        timestamp,
        status: 'sent',
        replies: [],
        metadata: {
          depth: 0,
          isRoot: true
        }
      };
      
      // Store message
      this.messages.set(messageId, messageObj);
      
      // Initialize conversation
      this.conversations.set(conversationId, {
        id: conversationId,
        rootMessageId: messageId,
        participants: [senderAgentId, ...recipientList],
        startTime: timestamp,
        lastActivity: timestamp,
        status: 'active',
        messageCount: 1
      });
      
      // Update inboxes
      for (const recipientId of recipientList) {
        if (!this.agentInboxes.has(recipientId)) {
          this.agentInboxes.set(recipientId, new Set());
        }
        this.agentInboxes.get(recipientId).add(messageId);
        
        // Track conversations
        if (!this.agentConversations.has(recipientId)) {
          this.agentConversations.set(recipientId, new Set());
        }
        this.agentConversations.get(recipientId).add(conversationId);
      }
      
      // Track sender's conversation
      if (!this.agentConversations.has(senderAgentId)) {
        this.agentConversations.set(senderAgentId, new Set());
      }
      this.agentConversations.get(senderAgentId).add(conversationId);
      
      // Update message counts
      this._updateMessageCounts(senderAgentId, 'sent');
      for (const recipientId of recipientList) {
        this._updateMessageCounts(recipientId, 'received');
      }
      
      // CRITICAL: Update inter-agent conversation tracking
      for (const recipientId of recipientList) {
        await this._updateConversationTracking(senderAgentId, recipientId, 'sent', context);
      }
      
      // Notify recipients through agent pool
      await this._notifyRecipients(messageObj, context);
      
      // Broadcast to WebSocket for UI visibility
      await this._broadcastToUI(messageObj, 'agent-message-sent', context);
      
      return {
        success: true,
        messageId,
        conversationId,
        recipients: recipientList,
        timestamp,
        message: 'Message sent successfully'
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Reply to an existing message
   */
  async replyToMessage(senderAgentId, parameters, context) {
    try {
      const {
        'message-id': originalMessageId,
        message,
        'cc-recipients': ccRecipients,
        attachments,
        'mark-resolved': markResolved = false
      } = parameters;
      
      // Validate required fields
      if (!originalMessageId || !message) {
        throw new Error('Original message ID and reply content are required');
      }
      
      // Get original message
      const originalMessage = this.messages.get(originalMessageId);
      if (!originalMessage) {
        throw new Error(`Original message not found: ${originalMessageId}`);
      }
      
      // Verify sender was a recipient or sender of original message
      const isParticipant = originalMessage.sender === senderAgentId || 
                          originalMessage.recipients.includes(senderAgentId);
      if (!isParticipant) {
        throw new Error('You are not a participant in this conversation');
      }
      
      // Check conversation depth to prevent infinite loops
      const conversation = this.conversations.get(originalMessage.conversationId);
      const currentDepth = this._getConversationDepth(originalMessage.conversationId);
      const _replyLimits = this._limits(context);

      if (currentDepth >= _replyLimits.maxConversationDepth) {
        return {
          success: false,
          error: `Conversation depth limit reached (${_replyLimits.maxConversationDepth}). Please start a new conversation.`,
          suggestion: 'Consider marking this conversation as ended and starting fresh if needed.'
        };
      }
      
      // Determine reply recipients
      let replyRecipients = [originalMessage.sender];
      if (originalMessage.sender === senderAgentId) {
        // If replying to own message, reply to original recipients
        replyRecipients = originalMessage.recipients;
      }
      
      // Add CC recipients if specified
      if (ccRecipients) {
        const ccList = this._parseRecipients(null, ccRecipients);
        replyRecipients = [...new Set([...replyRecipients, ...ccList])];
      }
      
      // Remove sender from recipients
      replyRecipients = replyRecipients.filter(id => id !== senderAgentId);
      
      // Validate recipient count — effective limit from per-agent config.
      if (replyRecipients.length > _replyLimits.maxRecipientsPerMessage) {
        throw new Error(`Maximum ${_replyLimits.maxRecipientsPerMessage} recipients allowed`);
      }
      
      // Get agent names
      const agentPool = context.agentPool;
      const senderAgent = await agentPool.getAgent(senderAgentId);
      const senderName = senderAgent ? senderAgent.name : senderAgentId;
      
      const recipientAgents = {};
      for (const recipientId of replyRecipients) {
        const agent = await agentPool.getAgent(recipientId);
        if (agent) {
          recipientAgents[recipientId] = agent.name;
        }
      }
      
      // Process attachments
      const processedAttachments = await this._processAttachments(attachments, senderAgentId, context);
      
      // Create reply message
      const replyMessageId = this._generateMessageId();
      const timestamp = new Date().toISOString();
      
      const replyMessage = {
        id: replyMessageId,
        conversationId: originalMessage.conversationId,
        sender: senderAgentId,
        senderName,
        recipients: replyRecipients,
        recipientNames: recipientAgents,
        subject: `Re: ${originalMessage.subject}`,
        content: message,
        attachments: processedAttachments,
        priority: originalMessage.priority,
        requiresReply: !markResolved,
        timestamp,
        status: 'sent',
        replies: [],
        metadata: {
          depth: currentDepth + 1,
          isRoot: false,
          inReplyTo: originalMessageId
        }
      };
      
      // Store reply
      this.messages.set(replyMessageId, replyMessage);
      originalMessage.replies.push(replyMessageId);
      
      // Update conversation
      conversation.lastActivity = timestamp;
      conversation.messageCount++;
      if (markResolved) {
        conversation.status = 'resolved';
      }
      
      // Update inboxes
      for (const recipientId of replyRecipients) {
        if (!this.agentInboxes.has(recipientId)) {
          this.agentInboxes.set(recipientId, new Set());
        }
        this.agentInboxes.get(recipientId).add(replyMessageId);
      }
      
      // Update message counts
      this._updateMessageCounts(senderAgentId, 'sent');
      for (const recipientId of replyRecipients) {
        this._updateMessageCounts(recipientId, 'received');
      }
      
      // CRITICAL: Update inter-agent conversation tracking for replies
      for (const recipientId of replyRecipients) {
        await this._updateConversationTracking(senderAgentId, recipientId, 'replied', context);
      }
      
      // Notify recipients
      await this._notifyRecipients(replyMessage, context);
      
      // Broadcast to WebSocket for UI visibility
      await this._broadcastToUI(replyMessage, 'agent-message-reply', context);
      
      return {
        success: true,
        messageId: replyMessageId,
        conversationId: originalMessage.conversationId,
        recipients: replyRecipients,
        depth: currentDepth + 1,
        timestamp,
        conversationStatus: conversation.status
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get unreplied messages for an agent
   */
  async getUnrepliedMessages(agentId, parameters, context) {
    try {
      const {
        'include-low-priority': includeLowPriority = false,
        'max-age-hours': maxAgeHours = 24
      } = parameters;
      
      const inbox = this.agentInboxes.get(agentId) || new Set();
      const unrepliedMessages = [];
      const maxAge = Date.now() - (maxAgeHours * 3600000);
      
      for (const messageId of inbox) {
        const message = this.messages.get(messageId);
        if (!message) continue;
        
        // Skip old messages
        if (new Date(message.timestamp).getTime() < maxAge) continue;
        
        // Skip low priority if not requested
        if (message.priority === 'low' && !includeLowPriority) continue;
        
        // Check if message requires reply and hasn't been replied to by this agent
        if (message.requiresReply) {
          const hasReplied = this._hasAgentReplied(agentId, message);
          if (!hasReplied) {
            const conversation = this.conversations.get(message.conversationId);
            unrepliedMessages.push({
              messageId: message.id,
              conversationId: message.conversationId,
              sender: message.sender,
              subject: message.subject,
              preview: message.content.substring(0, 100) + '...',
              priority: message.priority,
              timestamp: message.timestamp,
              hasAttachments: message.attachments.length > 0,
              conversationStatus: conversation?.status || 'unknown',
              depth: message.metadata.depth
            });
          }
        }
      }
      
      // Sort by priority and timestamp
      unrepliedMessages.sort((a, b) => {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      
      return {
        success: true,
        messages: unrepliedMessages,
        total: unrepliedMessages.length,
        inbox: {
          total: inbox.size,
          activeConversations: (this.agentConversations.get(agentId) || new Set()).size
        }
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Mark a conversation as ended
   */
  async markConversationEnded(agentId, parameters, context) {
    try {
      const {
        'conversation-id': conversationId,
        reason = 'Conversation ended by agent'
      } = parameters;
      
      if (!conversationId) {
        throw new Error('Conversation ID is required');
      }
      
      const conversation = this.conversations.get(conversationId);
      if (!conversation) {
        throw new Error(`Conversation not found: ${conversationId}`);
      }
      
      // Verify agent is a participant
      if (!conversation.participants.includes(agentId)) {
        throw new Error('You are not a participant in this conversation');
      }
      
      // Update conversation status
      conversation.status = 'ended';
      conversation.endTime = new Date().toISOString();
      conversation.endReason = reason;
      conversation.endedBy = agentId;
      
      // Remove from active conversations for all participants
      for (const participantId of conversation.participants) {
        const agentConvs = this.agentConversations.get(participantId);
        if (agentConvs) {
          agentConvs.delete(conversationId);
        }
      }
      
      return {
        success: true,
        conversationId,
        status: 'ended',
        reason,
        timestamp: conversation.endTime
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Initialize storage directory
   * @private
   */
  async _initializeStorage() {
    try {
      await fs.mkdir(this.config.storageDir, { recursive: true });
      const attachmentsDir = path.join(this.config.storageDir, 'attachments');
      await fs.mkdir(attachmentsDir, { recursive: true });
    } catch (error) {
      console.error('Failed to initialize message storage:', error);
    }
  }

  /**
   * Parse recipients from parameters
   * @private
   */
  _parseRecipients(recipient, recipients) {
    let recipientList = [];
    
    if (recipient) {
      recipientList.push(recipient);
    }
    
    if (recipients) {
      if (typeof recipients === 'string') {
        try {
          const parsed = JSON.parse(recipients);
          recipientList = [...recipientList, ...(Array.isArray(parsed) ? parsed : [parsed])];
        } catch {
          recipientList.push(recipients);
        }
      } else if (Array.isArray(recipients)) {
        recipientList = [...recipientList, ...recipients];
      }
    }
    
    // Remove duplicates
    return [...new Set(recipientList)];
  }

  /**
   * Process and validate attachments
   * @private
   */
  async _processAttachments(attachments, agentId, context = {}) {
    if (!attachments) return [];

    let attachmentList = [];
    if (typeof attachments === 'string') {
      try {
        attachmentList = JSON.parse(attachments);
      } catch {
        return [];
      }
    } else {
      attachmentList = attachments;
    }

    if (!Array.isArray(attachmentList)) {
      attachmentList = [attachmentList];
    }

    // Effective limits merge global defaults with per-agent overrides.
    // When context is missing (legacy callers), falls back to this.config.
    const _attLimits = this._limits(context);

    // Validate attachment count
    if (attachmentList.length > _attLimits.maxAttachmentsPerMessage) {
      throw new Error(`Maximum ${_attLimits.maxAttachmentsPerMessage} attachments allowed`);
    }

    const processedAttachments = [];

    for (const attachment of attachmentList) {
      if (!attachment.path) continue;

      try {
        // Check file exists and size
        const stats = await fs.stat(attachment.path);
        if (stats.size > _attLimits.maxAttachmentSize) {
          throw new Error(`Attachment exceeds size limit: ${attachment.path}`);
        }
        
        // Copy to storage
        const attachmentId = this._generateAttachmentId();
        const ext = path.extname(attachment.path);
        const storagePath = path.join(this.config.storageDir, 'attachments', `${attachmentId}${ext}`);
        
        await fs.copyFile(attachment.path, storagePath);
        
        processedAttachments.push({
          id: attachmentId,
          originalPath: attachment.path,
          storagePath,
          type: attachment.type || 'file',
          size: stats.size,
          name: path.basename(attachment.path)
        });
        
      } catch (error) {
        console.error(`Failed to process attachment: ${attachment.path}`, error);
      }
    }
    
    return processedAttachments;
  }

  /**
   * Notify recipients of new message
   * @private
   */
  async _notifyRecipients(message, context) {
    const agentPool = context.agentPool;
    if (!agentPool) return;
    
    for (const recipientId of message.recipients) {
      try {
        // Send both a notification AND inject message into conversation
        
        // 1. Standard notification (for system awareness)
        await agentPool.notifyAgent(recipientId, {
          type: 'agent-communication',
          from: message.sender,
          conversationId: message.conversationId,
          content: `📨 New message from ${message.senderName}: "${message.subject}"`,
          messageId: message.id,
          priority: message.priority,
          requiresResponse: message.requiresReply
        });
        
        // 2. Inject the actual message content directly into recipient's conversation
        const recipient = await agentPool.getAgent(recipientId);
        if (recipient) {
          const messageContent = `📨 **Inter-Agent Message**
**From:** ${message.senderName} (${message.sender})
**Subject:** ${message.subject}
**Priority:** ${message.priority}
**Requires Reply:** ${message.requiresReply ? 'Yes' : 'No'}

**Message:**
${message.content}

${message.attachments.length > 0 ? `**Attachments:** ${message.attachments.length} file(s)` : ''}

*You can reply using the agentcommunication tool with action="reply-to-message" and message-id="${message.id}"*`;

          const directMessage = {
            id: `agent-comm-${message.id}`,
            conversationId: message.conversationId,
            agentId: message.sender,
            content: messageContent,
            role: 'system', // System message so it's clearly visible
            timestamp: message.timestamp,
            type: 'agent-communication',
            metadata: {
              originalMessageId: message.id,
              fromAgent: message.sender,
              requiresResponse: message.requiresReply,
              priority: message.priority
            }
          };
          
          // Add to full conversation
          recipient.conversations.full.messages.push(directMessage);
          recipient.conversations.full.lastUpdated = new Date().toISOString();
          
          // Add to current model conversation if active
          if (recipient.currentModel && recipient.conversations[recipient.currentModel]) {
            recipient.conversations[recipient.currentModel].messages.push(directMessage);
            recipient.conversations[recipient.currentModel].lastUpdated = new Date().toISOString();
          }
          
          // Persist the updated state
          await agentPool.persistAgentState(recipientId);
          
          // Queue message using new architecture
          console.log(`📬 Queueing inter-agent message for scheduler processing`, {
            recipientId,
            sender: message.sender,
            subject: message.subject,
            hasSessionId: !!context.sessionId
          });
          
          await agentPool.addInterAgentMessage(recipientId, {
            id: message.id,
            messageId: message.id,
            sender: message.sender,
            senderName: message.senderName,
            subject: message.subject,
            content: message.content,
            attachments: message.attachments,
            priority: message.priority,
            requiresReply: message.requiresReply,
            conversationId: message.conversationId,
            sessionId: context.sessionId,
            timestamp: new Date().toISOString()
          });
          
          console.log(`Direct message injected and queued for processing: ${recipientId}`, {
            messageId: message.id,
            fromAgent: message.sender,
            subject: message.subject,
            priority: message.priority
          });
        }
        
      } catch (error) {
        console.error(`Failed to notify agent ${recipientId}:`, error);
      }
    }
  }

  /**
   * Check if agent has replied to a message
   * @private
   */
  _hasAgentReplied(agentId, message) {
    for (const replyId of message.replies) {
      const reply = this.messages.get(replyId);
      if (reply && reply.sender === agentId) {
        return true;
      }
      // Recursively check nested replies
      if (reply && this._hasAgentReplied(agentId, reply)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get conversation depth
   * @private
   */
  _getConversationDepth(conversationId) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return 0;
    
    let maxDepth = 0;
    const rootMessage = this.messages.get(conversation.rootMessageId);
    if (rootMessage) {
      maxDepth = this._getMessageDepth(rootMessage);
    }
    
    return maxDepth;
  }

  /**
   * Get message depth recursively
   * @private
   */
  _getMessageDepth(message, currentDepth = 0) {
    if (message.replies.length === 0) {
      return currentDepth;
    }
    
    let maxDepth = currentDepth;
    for (const replyId of message.replies) {
      const reply = this.messages.get(replyId);
      if (reply) {
        const depth = this._getMessageDepth(reply, currentDepth + 1);
        maxDepth = Math.max(maxDepth, depth);
      }
    }
    
    return maxDepth;
  }

  /**
   * Update message counts for agent
   * @private
   */
  _updateMessageCounts(agentId, type) {
    if (!this.agentMessageCounts.has(agentId)) {
      this.agentMessageCounts.set(agentId, { sent: 0, received: 0 });
    }
    
    const counts = this.agentMessageCounts.get(agentId);
    if (type === 'sent') {
      counts.sent++;
    } else {
      counts.received++;
    }
  }

  /**
   * Generate unique message ID
   * @private
   */
  _generateMessageId() {
    return `msg-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Generate unique conversation ID
   * @private
   */
  _generateConversationId() {
    return `conv-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Generate unique attachment ID
   * @private
   */
  _generateAttachmentId() {
    return `att-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Cleanup old messages and conversations
   * Called periodically to prevent memory growth
   */
  async cleanup() {
    const now = Date.now();
    const retentionCutoff = now - this.config.messageRetentionPeriod;
    
    // Clean up old messages
    for (const [messageId, message] of this.messages.entries()) {
      const messageTime = new Date(message.timestamp).getTime();
      if (messageTime < retentionCutoff) {
        // Clean up attachments
        for (const attachment of message.attachments) {
          try {
            await fs.unlink(attachment.storagePath);
          } catch (error) {
            // Ignore errors for missing files
          }
        }
        
        // Remove from inboxes
        for (const [agentId, inbox] of this.agentInboxes.entries()) {
          inbox.delete(messageId);
        }
        
        this.messages.delete(messageId);
      }
    }
    
    // Clean up old conversations
    for (const [conversationId, conversation] of this.conversations.entries()) {
      const lastActivity = new Date(conversation.lastActivity).getTime();
      if (lastActivity < retentionCutoff || conversation.status === 'ended') {
        // Remove from agent conversations
        for (const [agentId, convs] of this.agentConversations.entries()) {
          convs.delete(conversationId);
        }
        
        this.conversations.delete(conversationId);
      }
    }
  }

  /**
   * Broadcast message to WebSocket for UI visibility
   * @private
   */
  async _broadcastToUI(message, eventType, context) {
    try {
      // Build a formatted message for UI display
      const uiMessage = {
        type: 'agent-communication',
        eventType,
        timestamp: message.timestamp,
        messageId: message.id,
        conversationId: message.conversationId,
        sender: {
          id: message.sender,
          name: message.senderName
        },
        recipients: Object.entries(message.recipientNames || {}).map(([id, name]) => ({
          id,
          name
        })),
        subject: message.subject,
        content: message.content,
        priority: message.priority,
        requiresReply: message.requiresReply,
        hasAttachments: message.attachments && message.attachments.length > 0,
        attachmentCount: message.attachments ? message.attachments.length : 0,
        metadata: message.metadata
      };

      // Try multiple broadcast methods
      // Method 1: Through agentPool if available
      if (context.agentPool && context.agentPool.messageProcessor) {
        const messageProcessor = context.agentPool.messageProcessor;
        if (messageProcessor && messageProcessor.orchestrator && messageProcessor.orchestrator.webServer) {
          // Use broadcastToSession - it will fallback to all connections if session not found
          messageProcessor.orchestrator.webServer.broadcastToSession(context.sessionId || 'web-session', {
            type: 'agent-communication',
            action: 'agent-communication',
            data: uiMessage
          });
          return;
        }
      }
      
      // Method 2: Direct orchestrator access
      if (context.orchestrator && context.orchestrator.webServer) {
        context.orchestrator.webServer.broadcastToSession(context.sessionId || 'web-session', {
          type: 'agent-communication',
          action: 'agent-communication',
          data: uiMessage
        });
        return;
      }
      
      // Method 3: Through global reference (if set during initialization)
      if (global.loxiaWebServer) {
        global.loxiaWebServer.broadcastToSession(context.sessionId || 'web-session', {
          type: 'agent-communication',
          action: 'agent-communication',
          data: uiMessage
        });
      }
    } catch (error) {
      // Don't fail the operation if broadcast fails
      console.error('Failed to broadcast agent message to UI:', error);
    }
  }
  
  /**
   * Check if sender can send message to recipient
   * @private
   */
  async _canSendMessage(senderAgent, recipientId, context) {
    const agentPool = context.agentPool;

    // Ensure interAgentTracking is a Map (defensive - may be plain object from JSON)
    if (!senderAgent.interAgentTracking || !(senderAgent.interAgentTracking instanceof Map)) {
      if (senderAgent.interAgentTracking && typeof senderAgent.interAgentTracking === 'object') {
        senderAgent.interAgentTracking = new Map(Object.entries(senderAgent.interAgentTracking));
      } else {
        senderAgent.interAgentTracking = new Map();
      }
    }

    const tracking = senderAgent.interAgentTracking;

    // Initialize tracking for this recipient if needed
    if (!tracking.has(recipientId)) {
      tracking.set(recipientId, {
        lastSent: null,
        lastReceived: null,
        lastType: null
      });
    }
    
    const recipientTracking = tracking.get(recipientId);
    const now = Date.now();
    const MIN_INTERVAL = 60 * 1000; // 1 minute
    
    // Rule 1: Always allow if recipient has replied since our last message
    if (recipientTracking.lastType === 'received' || 
        (recipientTracking.lastReceived && recipientTracking.lastReceived > recipientTracking.lastSent)) {
      return { allowed: true };
    }
    
    // Rule 2: Allow if minimum time has passed since last send
    if (recipientTracking.lastSent) {
      const timeSinceLastSend = now - recipientTracking.lastSent;
      if (timeSinceLastSend >= MIN_INTERVAL) {
        return { allowed: true };
      }
      
      // Calculate when next send is allowed
      const nextAllowedTime = recipientTracking.lastSent + MIN_INTERVAL;
      return {
        allowed: false,
        reason: `Must wait ${Math.ceil((nextAllowedTime - now) / 1000)}s since last message`,
        waitUntil: nextAllowedTime
      };
    }
    
    // Rule 3: First message to this recipient is always allowed
    return { allowed: true };
  }
  
  /**
   * Update conversation tracking after message sent/received
   * @private
   */
  async _updateConversationTracking(senderAgentId, recipientId, action, context) {
    const agentPool = context.agentPool;
    const senderAgent = await agentPool.getAgent(senderAgentId);
    if (!senderAgent) return;

    const now = Date.now();

    // Ensure sender's interAgentTracking is a Map
    if (!senderAgent.interAgentTracking || !(senderAgent.interAgentTracking instanceof Map)) {
      if (senderAgent.interAgentTracking && typeof senderAgent.interAgentTracking === 'object') {
        senderAgent.interAgentTracking = new Map(Object.entries(senderAgent.interAgentTracking));
      } else {
        senderAgent.interAgentTracking = new Map();
      }
    }

    // Update sender's tracking
    if (!senderAgent.interAgentTracking.has(recipientId)) {
      senderAgent.interAgentTracking.set(recipientId, {
        lastSent: null,
        lastReceived: null,
        lastType: null
      });
    }

    const tracking = senderAgent.interAgentTracking.get(recipientId);

    if (action === 'sent') {
      tracking.lastSent = now;
      tracking.lastType = 'sent';
    } else if (action === 'replied') {
      tracking.lastSent = now;
      tracking.lastType = 'sent'; // Reply is still a send action
    }

    // Update recipient's tracking (they received a message)
    const recipientAgent = await agentPool.getAgent(recipientId);
    if (recipientAgent) {
      // Ensure recipient's interAgentTracking is a Map
      if (!recipientAgent.interAgentTracking || !(recipientAgent.interAgentTracking instanceof Map)) {
        if (recipientAgent.interAgentTracking && typeof recipientAgent.interAgentTracking === 'object') {
          recipientAgent.interAgentTracking = new Map(Object.entries(recipientAgent.interAgentTracking));
        } else {
          recipientAgent.interAgentTracking = new Map();
        }
      }

      if (!recipientAgent.interAgentTracking.has(senderAgentId)) {
        recipientAgent.interAgentTracking.set(senderAgentId, {
          lastSent: null,
          lastReceived: null,
          lastType: null
        });
      }

      const recipientTracking = recipientAgent.interAgentTracking.get(senderAgentId);
      recipientTracking.lastReceived = now;
      recipientTracking.lastType = 'received';

      // Persist recipient agent state
      await agentPool.persistAgentState(recipientId);
    }

    // Persist sender agent state
    await agentPool.persistAgentState(senderAgentId);
  }

  /**
   * Set message processor for broadcasting
   * Called during tool initialization
   */
  setMessageProcessor(messageProcessor) {
    this.messageProcessor = messageProcessor;
  }
}

export default AgentCommunicationTool;