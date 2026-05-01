/**
 * Message State Management Hook
 * React hook for managing chat messages - sending, receiving, history, and pagination
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { debugLog } from '../utils/debugLogger.js';
import {
  MESSAGE_CONFIG,
  PAGINATION,
  MESSAGE_ROLE,
  WS_MESSAGE_TYPE,
} from '../config/constants.js';

// Funny thinking phrases for loading animation
const THINKING_PHRASES = [
  'Pondering deeply...',
  'Consulting the oracle...',
  'Summoning wisdom...',
  'Brewing thoughts...',
  'Channeling brilliance...',
  'Contemplating existence...',
  'Computing the answer to life...',
  'Thinking really hard...',
  'Engaging neural networks...',
  'Processing cosmic data...',
  'Calibrating response generators...',
  'Warming up the brain cells...',
];

/**
 * Message state management hook
 * Manages message list, sending, receiving, history, and pagination
 */
export function useMessages(sessionManager, messageRouter, currentAgentId) {
  // Message state
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // Pagination state
  const [hasMore, setHasMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);

  // Message cache (per agent)
  const messageCache = useRef(new Map());

  // Current input text
  const [inputText, setInputText] = useState('');

  // Thinking animation state
  const [thinkingPhraseIndex, setThinkingPhraseIndex] = useState(0);
  const thinkingIntervalRef = useRef(null);

  /**
   * Start thinking animation
   */
  const startThinkingAnimation = useCallback(() => {
    // Pick a random starting phrase
    const randomIndex = Math.floor(Math.random() * THINKING_PHRASES.length);
    setThinkingPhraseIndex(randomIndex);

    // Clear any existing interval
    if (thinkingIntervalRef.current) {
      clearInterval(thinkingIntervalRef.current);
    }

    // Cycle through phrases every 2 seconds
    thinkingIntervalRef.current = setInterval(() => {
      setThinkingPhraseIndex(prev => (prev + 1) % THINKING_PHRASES.length);
    }, 2000);
  }, []);

  /**
   * Stop thinking animation
   */
  const stopThinkingAnimation = useCallback(() => {
    if (thinkingIntervalRef.current) {
      clearInterval(thinkingIntervalRef.current);
      thinkingIntervalRef.current = null;
    }
  }, []);

  /**
   * Get messages for current agent from cache
   */
  const getCachedMessages = useCallback(() => {
    if (!currentAgentId) return [];
    return messageCache.current.get(currentAgentId) || [];
  }, [currentAgentId]);

  /**
   * Update cache for current agent
   */
  const updateCache = useCallback((newMessages) => {
    if (!currentAgentId) return;
    messageCache.current.set(currentAgentId, newMessages);
  }, [currentAgentId]);

  /**
   * Fetch message history for current agent
   */
  const fetchMessages = useCallback(async (options = {}) => {
    debugLog('useMessages fetchMessages', 'Called with options:', options);

    if (!sessionManager?.isValid() || !currentAgentId) {
      debugLog('useMessages fetchMessages', 'FAILED: Invalid session or no agent');
      return { success: false, error: 'Invalid session or no agent selected' };
    }

    const {
      page = 0,
      limit = PAGINATION.PAGE_SIZE,
      append = false,
    } = options;

    debugLog('useMessages fetchMessages', `Starting fetch - page: ${page}, limit: ${limit}, append: ${append}`);
    setLoading(true);
    setError(null);

    try {
      debugLog('useMessages fetchMessages', 'Making API request to orchestrator...');

      // Request messages via orchestrator
      const response = await sessionManager.makeRequest('POST', '/api/orchestrator', {
        action: 'get_agent_conversations',
        payload: {
          agentId: currentAgentId,
          offset: page * limit,
          limit,
        },
        sessionId: sessionManager.getSessionId(),
      });

      debugLog('useMessages fetchMessages', 'API response received:', {
        success: response.success,
        hasData: !!response.data,
        hasConversations: !!(response.data?.conversations || response.conversations),
        error: response.error
      });

      if (response.success) {
        // Extract messages from conversations structure (can be in response.data or response directly)
        const responseData = response.data || response;
        const conversations = responseData.conversations || {};
        const fullConversation = conversations.full || {};
        const allMessages = fullConversation.messages || [];

        debugLog('useMessages fetchMessages', `Extracted ${allMessages.length} messages from response`);

        // Apply pagination manually since orchestrator returns full conversation
        const startIndex = page * limit;
        const endIndex = startIndex + limit;
        const newMessages = allMessages.slice(startIndex, endIndex);

        debugLog('useMessages fetchMessages', `After pagination: showing ${newMessages.length} messages (${startIndex} to ${endIndex})`);

        if (append) {
          // Append to existing messages (pagination) - use functional setState
          setMessages(prev => {
            const combined = [...prev, ...newMessages];
            updateCache(combined);
            debugLog('useMessages fetchMessages', `Appended messages, total: ${combined.length}`);
            return combined;
          });
        } else {
          // Replace messages (initial load)
          setMessages(newMessages);
          updateCache(newMessages);
          debugLog('useMessages fetchMessages', `Replaced messages, total: ${newMessages.length}`);
        }

        setTotalMessages(allMessages.length);
        setHasMore(endIndex < allMessages.length);
        setCurrentPage(page);

        debugLog('useMessages fetchMessages', 'Fetch complete - SUCCESS');
        return { success: true, messages: newMessages };
      }

      const errorMsg = response.error || 'Failed to fetch messages';
      debugLog('useMessages fetchMessages', 'Fetch FAILED:', errorMsg);
      throw new Error(errorMsg);
    } catch (err) {
      debugLog('useMessages fetchMessages', 'Exception caught:', err.message);
      debugLog('useMessages fetchMessages', 'Full error:', err.stack);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
      debugLog('useMessages fetchMessages', 'Fetch complete (finally block)');
    }
  }, [sessionManager, currentAgentId, updateCache]);

  /**
   * Send a message to the current agent
   */
  const sendMessage = useCallback(async (content, options = {}) => {
    // DEBUG: Log received parameters
    debugLog('useMessages sendMessage', ' Called with content:', JSON.stringify(content));
    debugLog('useMessages sendMessage', ' content type:', typeof content);
    debugLog('useMessages sendMessage', ' options:', JSON.stringify(options));

    if (!sessionManager?.isValid() || !currentAgentId) {
      debugLog('useMessages sendMessage', ' VALIDATION FAILED: Invalid session or no agent');
      throw new Error('Invalid session or no agent selected');
    }

    if (!content || content.trim().length === 0) {
      debugLog('useMessages sendMessage', ' VALIDATION FAILED: Empty content');
      debugLog('useMessages sendMessage', '   !content:', !content);
      debugLog('useMessages sendMessage', '   trim length:', typeof content === 'string' ? content.trim().length : 'N/A');
      throw new Error('Message content cannot be empty');
    }

    if (content.length > MESSAGE_CONFIG.MAX_MESSAGE_LENGTH) {
      debugLog('useMessages sendMessage', ' VALIDATION FAILED: Content too long');
      throw new Error(`Message too long (max ${MESSAGE_CONFIG.MAX_MESSAGE_LENGTH} characters)`);
    }

    debugLog('useMessages sendMessage', ' All validations PASSED');

    setSending(true);
    setError(null);

    try {
      const {
        role = MESSAGE_ROLE.USER,
        attachments = [],
      } = options;

      debugLog('useMessages sendMessage', ' Prepared payload - agentId:', currentAgentId, 'content:', JSON.stringify(content), 'role:', role);

      // Send message via orchestrator
      const response = await sessionManager.makeRequest('POST', '/api/orchestrator', {
        action: 'send_message',
        payload: {
          agentId: currentAgentId,
          message: content, // Backend expects 'message' not 'content'
          role,
          attachments,
        },
        sessionId: sessionManager.getSessionId(),
      });

      debugLog('useMessages sendMessage', ' API response:', response.success ? 'SUCCESS' : 'FAILED');

      if (response.success) {
        // Clear input
        setInputText('');

        // OPTIMISTIC UPDATE: Add user message to UI immediately
        // Backend doesn't broadcast user messages via WebSocket, only assistant responses
        const userMessage = {
          id: `user-message-${Date.now()}`,
          agentId: currentAgentId,
          role,
          content,
          timestamp: new Date().toISOString(),
        };

        debugLog('useMessages sendMessage', ' Adding user message optimistically:', JSON.stringify(userMessage));
        addMessage(userMessage);

        // Add thinking message
        const thinkingMessage = {
          id: 'thinking-placeholder',
          agentId: currentAgentId,
          role: MESSAGE_ROLE.ASSISTANT,
          content: THINKING_PHRASES[thinkingPhraseIndex],
          timestamp: new Date().toISOString(),
          isThinking: true, // Special flag to identify this as a thinking message
        };

        addMessage(thinkingMessage);
        startThinkingAnimation();

        return { success: true };
      }

      throw new Error(response.error || 'Failed to send message');
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSending(false);
    }
  }, [sessionManager, currentAgentId]);

  /**
   * Add a message to the list (from WebSocket)
   */
  const addMessage = useCallback((message) => {
    debugLog('useMessages addMessage', 'Called with message:', JSON.stringify(message));
    debugLog('useMessages addMessage', 'currentAgentId:', currentAgentId);
    debugLog('useMessages addMessage', 'message.agentId:', message.agentId);

    // Only add if for current agent
    if (message.agentId !== currentAgentId) {
      debugLog('useMessages addMessage', 'BLOCKED: agentId mismatch');
      return;
    }

    debugLog('useMessages addMessage', 'Adding message to state');

    setMessages(prev => {
      // If this is a real assistant message, remove the thinking placeholder
      if (message.role === MESSAGE_ROLE.ASSISTANT && !message.isThinking) {
        stopThinkingAnimation();
        // Remove thinking placeholder
        const withoutThinking = prev.filter(m => m.id !== 'thinking-placeholder');

        // Check for duplicates in the filtered array
        if (withoutThinking.find(m => m.id === message.id)) {
          debugLog('useMessages addMessage', 'BLOCKED: Duplicate message ID');
          return prev;
        }

        const updated = [...withoutThinking, message];
        const trimmed = updated.slice(-MESSAGE_CONFIG.MAX_MESSAGES_DISPLAY);

        debugLog('useMessages addMessage', 'Real AI response added, thinking removed, new count:', trimmed.length);
        updateCache(trimmed);
        return trimmed;
      }

      // Check for duplicates
      if (prev.find(m => m.id === message.id)) {
        debugLog('useMessages addMessage', 'BLOCKED: Duplicate message ID');
        return prev;
      }

      const updated = [...prev, message];

      // Enforce max messages limit
      const trimmed = updated.slice(-MESSAGE_CONFIG.MAX_MESSAGES_DISPLAY);

      debugLog('useMessages addMessage', 'Message added, new count:', trimmed.length);
      updateCache(trimmed);
      return trimmed;
    });

    setTotalMessages(prev => prev + 1);
  }, [currentAgentId, updateCache, stopThinkingAnimation]);

  /**
   * Update a message in the list
   */
  const updateMessage = useCallback((messageId, updates) => {
    setMessages(prev => prev.map(msg =>
      msg.id === messageId ? { ...msg, ...updates } : msg
    ));
  }, []);

  /**
   * Remove a message from the list
   */
  const removeMessage = useCallback((messageId) => {
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
    setTotalMessages(prev => Math.max(0, prev - 1));
  }, []);

  /**
   * Clear all messages
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setTotalMessages(0);
    setHasMore(false);
    setCurrentPage(0);
    if (currentAgentId) {
      updateCache([]);
    }
  }, [currentAgentId, updateCache]);

  /**
   * Load more messages (pagination)
   */
  const loadMore = useCallback(async () => {
    if (!hasMore || loading) {
      return;
    }

    return fetchMessages({
      page: currentPage + 1,
      append: true,
    });
  }, [hasMore, loading, currentPage, fetchMessages]);

  /**
   * Refresh message list
   */
  const refresh = useCallback(async () => {
    return fetchMessages({ page: 0, append: false });
  }, [fetchMessages]);

  /**
   * Get messages by role
   */
  const getMessagesByRole = useCallback((role) => {
    return messages.filter(msg => msg.role === role);
  }, [messages]);

  /**
   * Get user messages
   */
  const getUserMessages = useCallback(() => {
    return getMessagesByRole(MESSAGE_ROLE.USER);
  }, [getMessagesByRole]);

  /**
   * Get assistant messages
   */
  const getAssistantMessages = useCallback(() => {
    return getMessagesByRole(MESSAGE_ROLE.ASSISTANT);
  }, [getMessagesByRole]);

  /**
   * Get latest message
   */
  const getLatestMessage = useCallback(() => {
    return messages[messages.length - 1] || null;
  }, [messages]);

  /**
   * Search messages by content
   */
  const searchMessages = useCallback((query) => {
    if (!query || query.trim().length === 0) {
      return messages;
    }

    const lowerQuery = query.toLowerCase();
    return messages.filter(msg =>
      msg.content?.toLowerCase().includes(lowerQuery)
    );
  }, [messages]);

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Set up WebSocket message listeners
  useEffect(() => {
    if (!messageRouter) return;

    debugLog('useMessages WebSocket', 'Setting up listeners for agent:', currentAgentId);

    // New message added
    const handleMessageAdded = (data) => {
      debugLog('useMessages WebSocket', 'Received agent:message_added event:', JSON.stringify(data));
      debugLog('useMessages WebSocket', 'data.agentId:', data.agentId, 'currentAgentId:', currentAgentId);

      if (data.agentId === currentAgentId) {
        debugLog('useMessages WebSocket', 'Agent ID matches, calling addMessage');
        addMessage(data.message);
      } else {
        debugLog('useMessages WebSocket', 'Agent ID mismatch, ignoring message');
      }
    };

    // Message updated
    const handleMessageUpdated = (data) => {
      debugLog('useMessages WebSocket', 'Received message:updated event:', JSON.stringify(data));

      if (data.agentId === currentAgentId) {
        updateMessage(data.messageId, data.updates);
      }
    };

    messageRouter.on('agent:message_added', handleMessageAdded);
    messageRouter.on('message:updated', handleMessageUpdated);

    debugLog('useMessages WebSocket', 'Listeners registered');

    return () => {
      debugLog('useMessages WebSocket', 'Cleaning up listeners');
      messageRouter.off('agent:message_added', handleMessageAdded);
      messageRouter.off('message:updated', handleMessageUpdated);
    };
  }, [messageRouter, currentAgentId, addMessage, updateMessage]);

  // Update thinking message content when phrase changes
  useEffect(() => {
    setMessages(prev => {
      const thinkingMsg = prev.find(m => m.id === 'thinking-placeholder');
      if (!thinkingMsg) return prev;

      return prev.map(m =>
        m.id === 'thinking-placeholder'
          ? { ...m, content: THINKING_PHRASES[thinkingPhraseIndex] }
          : m
      );
    });
  }, [thinkingPhraseIndex]);

  // Cleanup thinking animation on unmount
  useEffect(() => {
    return () => {
      stopThinkingAnimation();
    };
  }, [stopThinkingAnimation]);

  // Load messages when agent changes
  useEffect(() => {
    debugLog('useMessages', `Agent changed: currentAgentId=${currentAgentId}`);

    if (!currentAgentId) {
      debugLog('useMessages', 'No agent selected, clearing messages');
      setMessages([]);
      return;
    }

    // Check cache first
    const cached = getCachedMessages();
    debugLog('useMessages', `Cache check: found ${cached.length} cached messages`);

    if (cached.length > 0) {
      debugLog('useMessages', `Loading ${cached.length} messages from cache`);
      setMessages(cached);
      setTotalMessages(cached.length);
    } else {
      // Load conversation history from server
      debugLog('useMessages', 'No cache, fetching messages from server...');
      fetchMessages({ page: 0 });
    }
  }, [currentAgentId, getCachedMessages, fetchMessages]);

  // Return hook interface
  return useMemo(() => ({
    // State
    messages,
    loading,
    sending,
    error,

    // Pagination
    hasMore,
    currentPage,
    totalMessages,

    // Input
    inputText,
    setInputText,

    // Operations
    sendMessage,
    fetchMessages,
    loadMore,
    refresh,

    // Message management
    addMessage,
    updateMessage,
    removeMessage,
    clearMessages,

    // Queries
    getMessagesByRole,
    getUserMessages,
    getAssistantMessages,
    getLatestMessage,
    searchMessages,

    // Utilities
    clearError,
  }), [
    messages,
    loading,
    sending,
    error,
    hasMore,
    currentPage,
    totalMessages,
    inputText,
    setInputText,
    sendMessage,
    fetchMessages,
    loadMore,
    refresh,
    addMessage,
    updateMessage,
    removeMessage,
    clearMessages,
    getMessagesByRole,
    getUserMessages,
    getAssistantMessages,
    getLatestMessage,
    searchMessages,
    clearError,
  ]);
}

/**
 * Lightweight hook for message count only
 */
export function useMessageCount(messages) {
  const [userCount, setUserCount] = useState(0);
  const [assistantCount, setAssistantCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    if (!messages) {
      setUserCount(0);
      setAssistantCount(0);
      setTotalCount(0);
      return;
    }

    const user = messages.filter(m => m.role === MESSAGE_ROLE.USER).length;
    const assistant = messages.filter(m => m.role === MESSAGE_ROLE.ASSISTANT).length;

    setUserCount(user);
    setAssistantCount(assistant);
    setTotalCount(messages.length);
  }, [messages]);

  return useMemo(() => ({
    userCount,
    assistantCount,
    totalCount,
  }), [userCount, assistantCount, totalCount]);
}

export default useMessages;
