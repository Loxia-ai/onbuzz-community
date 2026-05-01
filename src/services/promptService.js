/**
 * Prompt Service
 *
 * Purpose:
 * - Manage user prompt requests from agents
 * - Handle async request/response flow with Promise-based waiting
 * - Track pending prompts with timeout management
 *
 * Pattern: Similar to CredentialVault's pending request mechanism
 */

// Default timeout for user prompts (5 minutes)
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

class PromptService {
  constructor(logger = null) {
    this.logger = logger;

    // Pending prompt requests: requestId -> { resolve, reject, timeout, agentId, questions }
    this.pendingRequests = new Map();

    // Request history for debugging
    this.requestHistory = [];
    this.maxHistorySize = 100;
  }

  /**
   * Generate a unique request ID
   * @returns {string}
   */
  _generateRequestId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `prompt-${timestamp}-${random}`;
  }

  /**
   * Create a user prompt request that pauses the agent
   * @param {string} agentId - The agent making the request
   * @param {Object} promptData - The prompt configuration
   * @param {Object} options - Additional options
   * @returns {Object} { requestInfo, promise }
   */
  createPromptRequest(agentId, promptData, options = {}) {
    const requestId = this._generateRequestId();
    const timeoutMs = options.timeout || DEFAULT_TIMEOUT_MS;
    const timeoutAt = new Date(Date.now() + timeoutMs);

    // Validate and normalize questions
    const questions = this._normalizeQuestions(promptData.questions || [promptData]);

    // Create request info
    const requestInfo = {
      requestId,
      agentId,
      questions,
      message: promptData.message || null,
      createdAt: new Date().toISOString(),
      timeoutAt: timeoutAt.toISOString(),
      timeoutMs
    };

    // Create promise for async waiting
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    // Set timeout
    const timeoutHandle = setTimeout(() => {
      this._handleTimeout(requestId);
    }, timeoutMs);

    // Store pending request
    this.pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout: timeoutHandle,
      agentId,
      requestInfo,
      createdAt: Date.now()
    });

    this.logger?.info('[PromptService] Prompt request created', {
      requestId,
      agentId,
      questionCount: questions.length,
      timeoutMs
    });

    return { requestInfo, promise };
  }

  /**
   * Normalize questions into standard format
   * @param {Array} questions
   * @returns {Array}
   */
  _normalizeQuestions(questions) {
    return questions.map((q, index) => ({
      id: q.id || `q${index + 1}`,
      message: q.message || q.question || q.text || '',
      options: (q.options || []).map((opt, i) => {
        if (typeof opt === 'string') {
          return { id: `opt${i + 1}`, label: opt };
        }
        return {
          id: opt.id || `opt${i + 1}`,
          label: opt.label || opt.text || opt,
          description: opt.description || null
        };
      }),
      allowFreeText: q.allowFreeText !== false,
      allowWebSearch: q.allowWebSearch !== false,
      required: q.required !== false,
      multiSelect: q.multiSelect || false
    }));
  }

  /**
   * Submit user response to a prompt request
   * @param {string} requestId
   * @param {Object} response - { answers: [{questionId, selectedOptions, freeText}] }
   * @returns {Object}
   */
  submitResponse(requestId, response) {
    const request = this.pendingRequests.get(requestId);

    if (!request) {
      this.logger?.warn('[PromptService] Response submitted for unknown request', { requestId });
      return {
        success: false,
        error: 'Request not found or already completed'
      };
    }

    // Clear timeout
    clearTimeout(request.timeout);

    // Remove from pending
    this.pendingRequests.delete(requestId);

    // Add to history
    this._addToHistory({
      ...request.requestInfo,
      status: 'completed',
      response,
      completedAt: new Date().toISOString()
    });

    // Resolve the promise
    request.resolve({
      success: true,
      requestId,
      agentId: request.agentId,
      response
    });

    this.logger?.info('[PromptService] Response submitted', {
      requestId,
      agentId: request.agentId,
      answerCount: response.answers?.length
    });

    return {
      success: true,
      requestId
    };
  }

  /**
   * Cancel a pending prompt request
   * @param {string} requestId
   * @param {string} reason
   * @returns {Object}
   */
  cancelRequest(requestId, reason = 'User cancelled') {
    const request = this.pendingRequests.get(requestId);

    if (!request) {
      return {
        success: false,
        error: 'Request not found or already completed'
      };
    }

    // Clear timeout
    clearTimeout(request.timeout);

    // Remove from pending
    this.pendingRequests.delete(requestId);

    // Add to history
    this._addToHistory({
      ...request.requestInfo,
      status: 'cancelled',
      reason,
      completedAt: new Date().toISOString()
    });

    // Reject the promise
    request.reject(new Error(`Prompt cancelled: ${reason}`));

    this.logger?.info('[PromptService] Request cancelled', {
      requestId,
      agentId: request.agentId,
      reason
    });

    return {
      success: true,
      requestId
    };
  }

  /**
   * Handle request timeout
   * @param {string} requestId
   */
  _handleTimeout(requestId) {
    const request = this.pendingRequests.get(requestId);

    if (!request) return;

    // Remove from pending
    this.pendingRequests.delete(requestId);

    // Add to history
    this._addToHistory({
      ...request.requestInfo,
      status: 'timeout',
      completedAt: new Date().toISOString()
    });

    // Reject the promise
    request.reject(new Error('Prompt request timed out'));

    this.logger?.warn('[PromptService] Request timed out', {
      requestId,
      agentId: request.agentId
    });
  }

  /**
   * Add to request history
   * @param {Object} record
   */
  _addToHistory(record) {
    this.requestHistory.push(record);

    // Trim history if needed
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory = this.requestHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get pending request info
   * @param {string} requestId
   * @returns {Object|null}
   */
  getPendingRequest(requestId) {
    const request = this.pendingRequests.get(requestId);
    return request ? request.requestInfo : null;
  }

  /**
   * Get all pending requests for an agent
   * @param {string} agentId
   * @returns {Array}
   */
  getPendingRequestsForAgent(agentId) {
    const results = [];
    for (const [id, request] of this.pendingRequests) {
      if (request.agentId === agentId) {
        results.push(request.requestInfo);
      }
    }
    return results;
  }

  /**
   * Check if agent has pending prompts
   * @param {string} agentId
   * @returns {boolean}
   */
  hasPendingPrompts(agentId) {
    for (const [id, request] of this.pendingRequests) {
      if (request.agentId === agentId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get request history
   * @param {number} limit
   * @returns {Array}
   */
  getHistory(limit = 20) {
    return this.requestHistory.slice(-limit);
  }

  /**
   * Extend timeout for a pending request
   * @param {string} requestId
   * @param {number} additionalMs - Milliseconds to add
   * @returns {Object}
   */
  extendTimeout(requestId, additionalMs) {
    const request = this.pendingRequests.get(requestId);
    if (!request) return { success: false, error: 'Request not found' };

    const currentTimeout = new Date(request.requestInfo.timeoutAt).getTime();
    request.requestInfo.timeoutAt = new Date(currentTimeout + additionalMs).toISOString();

    // Reset the timeout handle
    clearTimeout(request.timeout);
    const newRemainingMs = new Date(request.requestInfo.timeoutAt).getTime() - Date.now();
    request.timeout = setTimeout(() => {
      this._handleTimeout(requestId);
    }, Math.max(0, newRemainingMs));

    this.logger?.info('[PromptService] Timeout extended', {
      requestId,
      additionalMs,
      newTimeoutAt: request.requestInfo.timeoutAt
    });

    return { success: true, newTimeoutAt: request.requestInfo.timeoutAt };
  }

  /**
   * Stop timeout for a pending request (no expiration)
   * @param {string} requestId
   * @returns {Object}
   */
  stopTimeout(requestId) {
    const request = this.pendingRequests.get(requestId);
    if (!request) return { success: false, error: 'Request not found' };

    clearTimeout(request.timeout);
    request.requestInfo.timeoutAt = null;

    this.logger?.info('[PromptService] Timeout stopped', { requestId });

    return { success: true };
  }

  /**
   * Clear all pending requests (for shutdown)
   */
  clearAll() {
    for (const [requestId, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Service shutdown'));
    }
    this.pendingRequests.clear();
    this.logger?.info('[PromptService] All pending requests cleared');
  }

  /**
   * Format response as a well-rendered message
   * @param {Object} requestInfo
   * @param {Object} response
   * @returns {string}
   */
  formatResponseAsMessage(requestInfo, response) {
    const lines = [];

    if (requestInfo.message) {
      lines.push(`**Context:** ${requestInfo.message}`);
      lines.push('');
    }

    for (const answer of (response.answers || [])) {
      const question = requestInfo.questions.find(q => q.id === answer.questionId);
      const questionText = question?.message || `Question ${answer.questionId}`;

      lines.push(`**Q: ${questionText}**`);

      if (answer.selectedOptions && answer.selectedOptions.length > 0) {
        const optionLabels = answer.selectedOptions.map(optId => {
          const opt = question?.options?.find(o => o.id === optId);
          return opt?.label || optId;
        });
        lines.push(`→ ${optionLabels.join(', ')}`);
      }

      if (answer.freeText) {
        lines.push(`→ "${answer.freeText}"`);
      }

      if (answer.webSearchRequested) {
        lines.push(`→ *Web search suggested for this question*`);
      }

      lines.push('');
    }

    return lines.join('\n').trim();
  }
}

// Export singleton instance
let instance = null;

export function getPromptService(logger = null) {
  if (!instance) {
    instance = new PromptService(logger);
  }
  return instance;
}

export { PromptService };
export default PromptService;
