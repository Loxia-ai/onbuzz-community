/**
 * AIService - Manages communication with Azure backend API, model routing, rate limiting
 * 
 * Purpose:
 * - Backend API communication
 * - Model selection and routing
 * - Rate limiting enforcement
 * - Conversation compactization
 * - Token usage tracking
 * - Request/response transformation
 */

import {
  MODELS,
  MODEL_PROVIDERS,
  HTTP_STATUS,
  ERROR_TYPES,
  SYSTEM_DEFAULTS,
  COMPACTION_CONFIG
} from '../utilities/constants.js';
import { ProviderRegistry } from './providers/index.js';

/**
 * Pull the reasoning-token count out of a usage object, checking every
 * provider shape we've seen in the fleet:
 *   - OpenAI:      usage.completion_tokens_details.reasoning_tokens
 *   - Some Azure:  usage.reasoning_tokens (flattened)
 *   - Claude:      usage.output_tokens_details.reasoning_tokens
 * Returns null when no reasoning tokens are reported (non-reasoning model,
 * or provider hasn't populated the field).
 *
 * Surfaced even for models that don't expose reasoning content text
 * (OpenAI o-series, gpt-5-*-reasoning variants): the count alone is useful
 * — it tells the operator "the model spent N tokens thinking" which
 * explains slow turns and signal "depth of deliberation" at a glance.
 *
 * @param {Object|null|undefined} usage
 * @returns {number|null}
 * @private
 */
/**
 * Parse the SSE stream emitted by autopilot-backend's `/llm/chat` route
 * into a final response object. This is the CLI half of the backend ↔
 * CLI wire contract (backend emission is tested in autopilot-backend's
 * `routes/__tests__/llm.chat.reasoning.test.js`).
 *
 * Accepts anything that returns chunks matching the ReadableStream
 * default-reader protocol: an object with `.read()` returning
 * `{ done, value: Uint8Array }`. Production callers pass
 * `response.body.getReader()`; tests pass a fake reader constructed over
 * a fixed set of byte chunks.
 *
 * Event shapes understood (must match backend's emission):
 *   { type: 'start',           ...metadata }              → ignored
 *   { type: 'chunk',           content: string }          → accumulated into `content`
 *   { type: 'reasoning_chunk', content: string }          → accumulated into `reasoning`
 *   { type: 'done',            content, reasoning?, usage, model, finishReason } → finalizes
 *   { type: 'error',           error, code }              → throws
 *
 * Callbacks (all optional) fire progressively:
 *   onChunk(content)           — on each text chunk
 *   onReasoningChunk(content)  — on each reasoning chunk
 *
 * @param {{ read(): Promise<{done: boolean, value: Uint8Array|undefined}> }} reader
 * @param {Object} [opts]
 * @param {Function} [opts.onChunk]
 * @param {Function} [opts.onReasoningChunk]
 * @param {string}   [opts.fallbackModel]  Used when the final `done` event lacks `model`.
 * @returns {Promise<{
 *   content: string, reasoning: string, reasoningTokens: number|null,
 *   usage: Object|null, model: string, finishReason: string
 * }>}
 */
export async function _parseSSEResponseStream(reader, opts = {}) {
  const { onChunk, onReasoningChunk, fallbackModel = null } = opts;
  const decoder = new TextDecoder();
  let fullContent = '';
  let fullReasoning = '';
  let finalData = null;
  let lineBuffer = '';

  const processLine = (line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith('data: ')) return;
    const data = trimmedLine.slice(6).trim();
    if (data === '[DONE]' || data.length === 0) return;

    let parsed;
    try { parsed = JSON.parse(data); }
    catch { return; /* malformed SSE chunk — skip defensively */ }

    if (parsed.type === 'chunk' && parsed.content) {
      fullContent += parsed.content;
      if (onChunk) onChunk(parsed.content);
    } else if (parsed.type === 'reasoning_chunk' && parsed.content) {
      fullReasoning += parsed.content;
      if (onReasoningChunk) onReasoningChunk(parsed.content);
    } else if (parsed.type === 'done') {
      finalData = {
        content: parsed.content || fullContent,
        // Prefer the streamed accumulation; fall back to a batched `reasoning`
        // field on the done event (rare but supported).
        reasoning: fullReasoning || parsed.reasoning || '',
        reasoningTokens: _extractReasoningTokens(parsed.usage),
        usage: parsed.usage,
        model: parsed.model || fallbackModel,
        finishReason: parsed.finishReason || 'stop',
      };
    } else if (parsed.type === 'error') {
      const error = new Error(parsed.error);
      error.code = parsed.code;
      throw error;
    }
    // Unknown event types (e.g. 'start') are silently ignored — forward
    // compat for future backend event additions.
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuffer += decoder.decode(value, { stream: true });
    const parts = lineBuffer.split('\n');
    lineBuffer = parts.pop() || ''; // last fragment may be incomplete
    for (const line of parts) processLine(line);
  }
  // Flush any trailing unterminated line (streams that end without \n).
  if (lineBuffer.trim().length > 0) processLine(lineBuffer);

  if (finalData) return finalData;
  // Stream ended without a `done` event — return what we accumulated.
  return {
    content: fullContent,
    reasoning: fullReasoning,
    reasoningTokens: null,
    usage: null,
    model: fallbackModel,
    finishReason: 'stop',
  };
}

export function _extractReasoningTokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const candidates = [
    usage.reasoning_tokens,
    usage.completion_tokens_details?.reasoning_tokens,
    usage.output_tokens_details?.reasoning_tokens,
    usage.completionTokensDetails?.reasoningTokens,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return null;
}

class AIService {
  constructor(config, logger, budgetService, errorHandler) {
    this.config = config;
    this.logger = logger;
    this.budgetService = budgetService;
    this.errorHandler = errorHandler;
    
    this.timeout = config.backend?.timeout || 270000; // 4.5 minutes for LLM responses (no auto-retry)

    // Provider registry — built lazily on first use after the apiKeyManager
    // is wired in (so we have access to the user's vendor keys).
    this._providerRegistry = null;
    
    // Rate limiting
    this.rateLimiters = new Map();
    this.requestQueue = new Map();
    
    // Circuit breaker
    this.circuitBreaker = {
      failures: 0,
      lastFailureTime: null,
      isOpen: false,
      threshold: 5,
      timeout: 30000 // 30 seconds
    };
    
    // Model specifications
    this.modelSpecs = this._initializeModelSpecs();
    
    // Conversation managers for multi-model support
    this.conversationManagers = new Map();

    // API Key Manager reference (will be set by LoxiaSystem)
    this.apiKeyManager = null;

    // Agent Pool reference (will be set by LoxiaSystem)
    this.agentPool = null;

    // Active requests tracking for abort support
    // Maps agentId -> { controller: AbortController, requestId: string, startTime: Date }
    this.activeRequests = new Map();

    // Track user-initiated aborts (separate from timeout aborts)
    // Set contains agentIds that were aborted by user action
    this.userAbortedRequests = new Set();

    // Model reliability tracking (in-memory, global across agents)
    // Maps modelId -> { successCount: number, failureCount: number, lastSuccess: Date|null, lastFailure: Date|null }
    this.modelReliability = new Map();
  }

  /**
   * Get the provider registry (lazy init).
   * Built from the active config + apiKeyManager so vendor keys are
   * picked up after Settings updates them.
   * @returns {import('./providers/index.js').ProviderRegistry}
   */
  getProviderRegistry() {
    if (!this._providerRegistry) this._providerRegistry = this._buildProviderRegistry();
    return this._providerRegistry;
  }

  /**
   * Force a rebuild of the provider registry — call this after the
   * apiKeyManager's keys change so new keys take effect.
   */
  invalidateProviderRegistry() {
    this._providerRegistry = null;
  }

  /** @private */
  _buildProviderRegistry() {
    const vendorKeys = this.apiKeyManager?.keys?.vendorKeys || {};
    const customEndpoints = this.apiKeyManager?.keys?.customEndpoints || [];
    return new ProviderRegistry({
      openai:    { apiKey: vendorKeys.openai,    timeout: this.timeout },
      anthropic: { apiKey: vendorKeys.anthropic, timeout: this.timeout },
      gemini:    { apiKey: vendorKeys.gemini,    timeout: this.timeout },
      xai:       { apiKey: vendorKeys.xai,       timeout: this.timeout },
      ollama:    {
        ollamaHost:    this.config.ollama?.host || this.config.ollamaHost,
        ollamaEnabled: this.config.ollama?.enabled !== false,
        timeout:       this.timeout,
      },
      customEndpoints,
      defaultProvider: this.config.defaultProvider || null,
    }, this.logger);
  }

  /**
   * Record a successful model response
   * @param {string} model - Model name
   */
  recordModelSuccess(model) {
    const existing = this.modelReliability.get(model) || { successCount: 0, failureCount: 0, lastSuccess: null, lastFailure: null };
    existing.successCount++;
    existing.lastSuccess = new Date();
    this.modelReliability.set(model, existing);
    this.logger?.debug(`Model success recorded: ${model}`, { successCount: existing.successCount });
  }

  /**
   * Record a model failure
   * @param {string} model - Model name
   * @param {string} errorType - Type of error that occurred
   */
  recordModelFailure(model, errorType = 'unknown') {
    const existing = this.modelReliability.get(model) || { successCount: 0, failureCount: 0, lastSuccess: null, lastFailure: null };
    existing.failureCount++;
    existing.lastFailure = new Date();
    existing.lastErrorType = errorType;
    this.modelReliability.set(model, existing);
    this.logger?.debug(`Model failure recorded: ${model}`, { failureCount: existing.failureCount, errorType });
  }

  /**
   * Get reliability info for a model
   * @param {string} model - Model name
   * @returns {Object} Reliability info with verified status
   */
  getModelReliability(model) {
    const info = this.modelReliability.get(model);
    if (!info) {
      return { verified: false, successCount: 0, failureCount: 0 };
    }
    return {
      verified: info.successCount > 0,
      successCount: info.successCount,
      failureCount: info.failureCount,
      lastSuccess: info.lastSuccess,
      lastFailure: info.lastFailure,
      lastErrorType: info.lastErrorType
    };
  }

  /**
   * Get all model reliability data
   * @returns {Object} Map of model -> reliability info
   */
  getAllModelReliability() {
    const result = {};
    for (const [model, info] of this.modelReliability.entries()) {
      result[model] = {
        verified: info.successCount > 0,
        successCount: info.successCount,
        failureCount: info.failureCount
      };
    }
    return result;
  }

  /**
   * Set models service reference (for model suggestions)
   * @param {ModelsService} modelsService - Models service instance
   */
  setModelsService(modelsService) {
    this.modelsService = modelsService;
  }

  /**
   * Check if an error is model-related (should trigger model suggestion modal)
   * @param {Error} error - The error to check
   * @returns {boolean} True if error is model-related
   */
  isModelRelatedError(error) {
    const modelErrorPatterns = [
      /model.*not found/i,
      /model.*unavailable/i,
      /model.*does not exist/i,
      /invalid.*model/i,
      /unsupported.*model/i,
      /quota.*exceeded/i,
      /rate.*limit/i,
      /context.*length.*exceeded/i,
      /token.*limit/i,
      /maximum.*context/i,
      /capacity/i,
      /overloaded/i,
      /503/,
      /429/
    ];

    const errorMessage = error.message || '';
    const errorCode = error.code || error.status;

    // Check status codes
    if ([429, 503, 404].includes(errorCode)) {
      return true;
    }

    // Check error message patterns
    return modelErrorPatterns.some(pattern => pattern.test(errorMessage));
  }

  /**
   * Classify the type of model error
   * @param {Error} error - The error to classify
   * @returns {string} Error type
   */
  classifyModelError(error) {
    const message = (error.message || '').toLowerCase();
    const code = error.code || error.status;

    if (code === 404 || message.includes('not found') || message.includes('does not exist')) {
      return 'model_not_found';
    }
    if (code === 429 || message.includes('rate limit') || message.includes('quota')) {
      return 'rate_limit';
    }
    if (message.includes('context') || message.includes('token limit') || message.includes('maximum')) {
      return 'context_exceeded';
    }
    if (code === 503 || message.includes('overload') || message.includes('capacity')) {
      return 'model_overloaded';
    }
    if (code === 401 || code === 403) {
      return 'auth_error';
    }
    return 'unknown';
  }

  /**
   * Get model suggestions with reliability info
   * @param {string} failedModel - The model that failed
   * @param {Error} error - The error that occurred
   * @returns {Object} Suggestions object with models and reliability info
   */
  getModelSuggestions(failedModel, error) {
    const suggestions = [];
    const allModels = this.modelsService?.getModels() || [];

    for (const model of allModels) {
      if (model.name === failedModel) continue; // Skip the failed model

      const reliability = this.getModelReliability(model.name);
      suggestions.push({
        name: model.name,
        displayName: model.displayName || model.name,
        provider: model.provider,
        contextWindow: model.contextWindow,
        verified: reliability.verified,
        successCount: reliability.successCount,
        failureCount: reliability.failureCount
      });
    }

    // Sort: verified models first, then by success count
    suggestions.sort((a, b) => {
      if (a.verified !== b.verified) return b.verified ? 1 : -1;
      return b.successCount - a.successCount;
    });

    return {
      failedModel,
      errorType: this.classifyModelError(error),
      errorMessage: error.message,
      suggestions // All available models (sorted by reliability)
    };
  }

  /**
   * Send message to backend API
   * @param {string} model - Target model name
   * @param {string|Array} messages - Message content or conversation history
   * @param {Object} options - Additional options (agentId, systemPrompt, etc.)
   * @returns {Promise<Object>} API response with content and metadata
   */
  async sendMessage(model, messages, options = {}) {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      if (this._isCircuitBreakerOpen(model) && !options.skipCircuitBreaker) {
        throw new Error('Service temporarily unavailable - circuit breaker is open');
      }

      await this._checkRateLimit(model);
      const formattedMessages = this._formatMessagesForModel(messages, model, options);

      const provider = this.getProviderRegistry().resolve({
        model,
        provider: options.provider,
      });

      const apiKey = provider.id === 'ollama'
        ? null
        : (this.apiKeyManager?.keys?.vendorKeys?.[provider.id] || provider.config?.apiKey || null);

      this.logger.info(`Sending message to model: ${model}`, {
        requestId,
        provider: provider.id,
        agentId: options.agentId,
        messageCount: Array.isArray(messages) ? messages.length : 1,
      });

      const response = await provider.sendMessage({
        model,
        messages:     formattedMessages,
        systemPrompt: options.systemPrompt,
        apiKey,
        options: {
          max_tokens:  Math.min(options.maxTokens ?? options.max_tokens ?? this.modelSpecs[model]?.maxTokens ?? COMPACTION_CONFIG.MAX_OUTPUT_TOKENS, COMPACTION_CONFIG.MAX_OUTPUT_TOKENS),
          temperature: options.temperature ?? 0.7,
          tools:       Array.isArray(options.tools) ? options.tools : undefined,
        },
        metadata: { requestId, agentId: options.agentId },
      });

      if (response.usage) {
        await this.trackUsage(options.agentId, model, {
          prompt_tokens:     response.usage.prompt_tokens     || 0,
          completion_tokens: response.usage.completion_tokens || 0,
          total_tokens:      response.usage.total_tokens      || 0,
        });
      }

      this._resetCircuitBreaker(model);
      this.recordModelSuccess(model);

      return {
        content:         response.content,
        reasoning:       response.reasoning || '',
        reasoningTokens: response.reasoningTokens,
        model:           response.model || model,
        tokenUsage:      response.usage,
        requestId,
        finishReason:    response.finishReason || 'stop',
        toolCalls:       response.toolCalls,
      };

    } catch (error) {
      if (!options.skipCircuitBreaker) this._recordFailure(model);
      this.recordModelFailure(model, error.code || error.status || 'unknown');

      this.logger.error(`AI service request failed: ${error.message}`, {
        requestId,
        model,
        agentId: options.agentId,
        error: error.stack,
      });

      await this.handleHttpError(error, { requestId, model, agentId: options.agentId });
      throw error;
    }
  }

  /**
   * Send message to backend API with streaming response
   * @param {string} model - Target model name
   * @param {string|Array} messages - Message content or conversation history
   * @param {Object} options - Additional options (agentId, systemPrompt, etc.)
   * @param {Function} options.onChunk - Callback for each text chunk
   * @param {Function} options.onDone - Callback when stream completes
   * @param {Function} options.onError - Callback for errors
   * @returns {Promise<Object>} Final response with content and metadata
   */
  async sendMessageStream(model, messages, options = {}) {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const { onChunk, onReasoningChunk, onDone, onError } = options;

    try {
      if (this._isCircuitBreakerOpen(model)) {
        throw new Error('Service temporarily unavailable - circuit breaker is open');
      }

      await this._checkRateLimit(model);
      const formattedMessages = this._formatMessagesForModel(messages, model, options);

      const provider = this.getProviderRegistry().resolve({
        model,
        provider: options.provider,
      });

      const apiKey = provider.id === 'ollama'
        ? null
        : (this.apiKeyManager?.keys?.vendorKeys?.[provider.id] || provider.config?.apiKey || null);

      // Track active request for abort support
      const controller = new AbortController();
      const agentId = options.agentId;
      if (agentId) {
        this.activeRequests.set(agentId, {
          controller,
          requestId,
          startTime: new Date(),
          type:      'streaming',
        });
      }

      this.logger.info(`Sending streaming message to model: ${model}`, {
        requestId,
        provider: provider.id,
        agentId,
        messageCount: Array.isArray(messages) ? messages.length : 1,
        toolCount: options.tools?.length || 0,
      });

      const response = await provider.sendMessageStream({
        model,
        messages:     formattedMessages,
        systemPrompt: options.systemPrompt,
        apiKey,
        options: {
          max_tokens:  Math.min(options.maxTokens ?? options.max_tokens ?? this.modelSpecs[model]?.maxTokens ?? COMPACTION_CONFIG.MAX_OUTPUT_TOKENS, COMPACTION_CONFIG.MAX_OUTPUT_TOKENS),
          temperature: options.temperature ?? 0.7,
          stream:      true,
          tools:       Array.isArray(options.tools) ? options.tools : undefined,
        },
        metadata: { requestId, agentId },
      }, { onChunk, onReasoningChunk, onDone, onError });

      if (agentId) this.activeRequests.delete(agentId);

      if (response.usage) {
        await this.trackUsage(agentId, model, {
          prompt_tokens:     response.usage.prompt_tokens     || 0,
          completion_tokens: response.usage.completion_tokens || 0,
          total_tokens:      response.usage.total_tokens      || 0,
        });
      }

      this._resetCircuitBreaker(model);
      this.recordModelSuccess(model);

      return {
        content:         response.content || '',
        reasoning:       response.reasoning || '',
        reasoningTokens: response.reasoningTokens,
        model:           response.model || model,
        tokenUsage:      response.usage,
        requestId,
        finishReason:    response.finishReason || 'stop',
        toolCalls:       response.toolCalls,
      };

    } catch (error) {
      this._recordFailure(model);
      this.recordModelFailure(model, error.code || error.status || 'unknown');
      if (options.agentId) this.activeRequests.delete(options.agentId);

      this.logger.error(`AI streaming service request failed: ${error.message}`, {
        requestId,
        model,
        agentId: options.agentId,
        error:   error.stack,
      });

      if (onError) onError(error);
      throw error;
    }
  }


  /**
   * Compactize conversation for specific model context window
   * @param {Array} messages - Message history
   * @param {string} targetModel - Target model name
   * @returns {Promise<Array>} Compactized messages
   */
  async compactizeConversation(messages, targetModel) {
    const modelSpec = this.modelSpecs[targetModel];
    if (!modelSpec) {
      throw new Error(`Unknown model: ${targetModel}`);
    }
    
    const maxTokens = modelSpec.contextWindow * 0.8; // Use 80% of context window
    let currentTokens = 0;
    const compactizedMessages = [];
    
    // Estimate tokens for each message
    const messagesWithTokens = await Promise.all(
      messages.map(async (msg) => ({
        ...msg,
        estimatedTokens: await this._estimateTokens(msg.content, targetModel)
      }))
    );
    
    // Start from the most recent messages
    const reversedMessages = [...messagesWithTokens].reverse();
    
    for (const message of reversedMessages) {
      if (currentTokens + message.estimatedTokens > maxTokens) {
        // If we've exceeded the limit, summarize older messages
        if (compactizedMessages.length === 0) {
          // If even the latest message is too long, truncate it
          const truncatedContent = await this._truncateMessage(message.content, maxTokens);
          compactizedMessages.unshift({
            ...message,
            content: truncatedContent,
            estimatedTokens: maxTokens
          });
        }
        break;
      }
      
      compactizedMessages.unshift(message);
      currentTokens += message.estimatedTokens;
    }
    
    // If we have remaining older messages, create a summary
    const remainingMessages = messagesWithTokens.slice(0, -compactizedMessages.length);
    if (remainingMessages.length > 0) {
      const summary = await this._summarizeMessages(remainingMessages, targetModel);
      compactizedMessages.unshift({
        role: 'system',
        content: `Previous conversation summary: ${summary}`,
        timestamp: remainingMessages[0].timestamp,
        type: 'summary',
        estimatedTokens: await this._estimateTokens(summary, targetModel)
      });
    }
    
    this.logger.info(`Conversation compactized for model: ${targetModel}`, {
      originalMessages: messages.length,
      compactizedMessages: compactizedMessages.length,
      estimatedTokens: currentTokens,
      maxTokens
    });
    
    return compactizedMessages;
  }

  /**
   * Track token usage and costs
   * @param {number} tokens - Number of tokens used
   * @param {number} cost - Cost in dollars
   * @returns {Promise<void>}
   */
  async trackUsage(agentId, model, tokenUsage, cost) {
    try {
      if (this.budgetService) {
        this.budgetService.trackUsage(agentId, model, tokenUsage);
      }
    } catch (error) {
      this.logger.error(`Usage tracking failed: ${error.message}`);
    }
  }

  /**
   * Handle HTTP errors with comprehensive error handling
   * @param {Error} error - Error object
   * @param {Object} context - Request context
   * @returns {Promise<void>}
   */
  async handleHttpError(error, context) {
    // If error already has timeout flags, re-throw it directly to preserve them
    if (error.isTimeout || error.shouldReturnToChat) {
      throw error;
    }

    const errorType = this.errorHandler?.classifyError?.(error, context);

    switch (error.status || error.code) {
      case HTTP_STATUS.BAD_REQUEST:
        this.logger.error('Bad request to AI service', { context, error: error.message });
        throw new Error(`Invalid request: ${error.message}`);
        
      case HTTP_STATUS.UNAUTHORIZED:
        this.logger.error('Authentication failed with AI service', { context });
        throw new Error('Authentication failed - check API credentials');
        
      case HTTP_STATUS.FORBIDDEN:
        this.logger.error('Access forbidden to AI service', { context });
        throw new Error('Access forbidden - insufficient permissions');
        
      case HTTP_STATUS.NOT_FOUND:
        this.logger.error('AI service endpoint not found', { context });
        throw new Error('Service endpoint not found');
        
      case HTTP_STATUS.TOO_MANY_REQUESTS:
        this.logger.warn('Rate limit exceeded', { context });
        await this._handleRateLimit(context);
        throw new Error('Rate limit exceeded - request queued for retry');
        
      case HTTP_STATUS.INTERNAL_SERVER_ERROR:
      case HTTP_STATUS.BAD_GATEWAY:
      case HTTP_STATUS.SERVICE_UNAVAILABLE:
      case HTTP_STATUS.GATEWAY_TIMEOUT:
        this.logger.error('AI service unavailable', { context, status: error.status });
        await this._handleServiceUnavailable(context);
        throw new Error('AI service temporarily unavailable');
        
      default:
        this.logger.error('Unknown AI service error', { context, error: error.message });
        throw new Error(`AI service error: ${error.message}`);
    }
  }

  /**
   * Set API key manager instance
   * @param {ApiKeyManager} apiKeyManager - API key manager instance
   */
  setApiKeyManager(apiKeyManager) {
    this.apiKeyManager = apiKeyManager;
    this.invalidateProviderRegistry();
    this.logger?.info('API key manager set for AI service', {
      hasManager: !!apiKeyManager,
    });
  }

  /**
   * Set agent pool reference
   * @param {Object} agentPool - Agent pool instance
   */
  setAgentPool(agentPool) {
    this.agentPool = agentPool;

    this.logger?.info('Agent pool set for AI service', {
      hasAgentPool: !!agentPool
    });
  }

  /**
   * Abort an active request for a specific agent
   * Used when user clicks "Stop" to immediately cancel streaming
   * @param {string} agentId - Agent ID whose request should be aborted
   * @param {string} partialContent - Optional partial content received before abort
   * @returns {boolean} True if request was found and aborted
   */
  abortRequest(agentId, partialContent = '') {
    const activeRequest = this.activeRequests.get(agentId);

    if (!activeRequest) {
      this.logger?.debug(`No active request found for agent: ${agentId}`);
      return false;
    }

    const { controller, requestId, startTime, type } = activeRequest;
    const duration = Date.now() - startTime.getTime();

    this.logger?.info(`Aborting ${type} request for agent: ${agentId}`, {
      requestId,
      durationMs: duration
    });

    // Mark this as a user-initiated abort BEFORE triggering abort
    // This allows catch blocks to distinguish user abort from timeout
    this.userAbortedRequests.add(agentId);

    // Trigger the abort
    controller.abort();

    // Clean up active request tracking (but keep userAbortedRequests for catch block)
    this.activeRequests.delete(agentId);

    this.logger?.info(`Successfully aborted request for agent: ${agentId}`, {
      requestId,
      durationMs: duration
    });

    return true;
  }

  /**
   * Check if an agent has an active request
   * @param {string} agentId - Agent ID to check
   * @returns {Object|null} Active request info or null
   */
  getActiveRequest(agentId) {
    const request = this.activeRequests.get(agentId);
    if (!request) return null;

    return {
      requestId: request.requestId,
      type: request.type,
      startTime: request.startTime,
      durationMs: Date.now() - request.startTime.getTime()
    };
  }

  /**
   * Get count of all active requests
   * @returns {number} Number of active requests
   */
  getActiveRequestCount() {
    return this.activeRequests.size;
  }


  /**
   * Check service health for circuit breaker
   * @returns {Promise<boolean>} Service health status
   */
  async checkServiceHealth() {
    try {
      const response = await this._makeAPIRequest('/health', {}, 'health-check');
      return response.status === 'healthy';
    } catch (error) {
      return false;
    }
  }

  /**
   * Switch agent to different model
   * @param {string} agentId - Agent identifier
   * @param {string} newModel - New model name
   * @returns {Promise<Object>} Switch result
   */
  async switchAgentModel(agentId, newModel) {
    try {
      if (!this._isValidModel(newModel)) {
        throw new Error(`Invalid model: ${newModel}`);
      }
      
      // Get conversation manager for agent
      let conversationManager = this.conversationManagers.get(agentId);
      if (!conversationManager) {
        // Create new conversation manager if it doesn't exist
        conversationManager = new ConversationManager(agentId, this.logger);
        this.conversationManagers.set(agentId, conversationManager);
      }
      
      // Switch model and return conversation
      const modelConversation = await conversationManager.switchModel(newModel);
      
      // CRITICAL FIX: Update agent's currentModel field in AgentPool
      const agent = await this.agentPool?.getAgent(agentId);
      if (agent) {
        agent.currentModel = newModel;
        await this.agentPool.persistAgentState(agentId);
      }
      
      this.logger.info(`Agent model switched: ${agentId}`, {
        newModel,
        messageCount: modelConversation.messages.length
      });
      
      return {
        success: true,
        agentId,
        newModel,
        conversation: modelConversation
      };
      
    } catch (error) {
      this.logger.error(`Model switch failed: ${error.message}`, { agentId, newModel });
      throw error;
    }
  }

  /**
   * Initialize model specifications
   * @private
   */
  _initializeModelSpecs() {
    const baseSpecs = {
      // Anthropic Claude models
      [MODELS.ANTHROPIC_SONNET]: {
        provider: MODEL_PROVIDERS.ANTHROPIC,
        contextWindow: 200000,
        maxTokens: 8192,  // Increased from 4096
        costPer1kTokens: 0.015
      },
      [MODELS.ANTHROPIC_HAIKU]: {
        provider: MODEL_PROVIDERS.ANTHROPIC,
        contextWindow: 200000,
        maxTokens: 8192,  // Increased from 4096
        costPer1kTokens: 0.0025
      },

      // OpenAI models
      [MODELS.GPT_4]: {
        provider: MODEL_PROVIDERS.OPENAI,
        contextWindow: 128000,
        maxTokens: 8192,  // Increased from 4096
        costPer1kTokens: 0.03
      },
      [MODELS.GPT_4_MINI]: {
        provider: MODEL_PROVIDERS.OPENAI,
        contextWindow: 128000,
        maxTokens: 16384,
        costPer1kTokens: 0.0015
      },
      'gpt-4o': {
        provider: MODEL_PROVIDERS.OPENAI,
        contextWindow: 128000,
        maxTokens: 8192,
        costPer1kTokens: 0.03
      },
      'gpt-4o-mini': {
        provider: MODEL_PROVIDERS.OPENAI,
        contextWindow: 128000,
        maxTokens: 16384,
        costPer1kTokens: 0.0015
      },
      'gpt-4-turbo': {
        provider: MODEL_PROVIDERS.OPENAI,
        contextWindow: 128000,
        maxTokens: 8192,
        costPer1kTokens: 0.03
      },
      'gpt-3.5-turbo': {
        provider: MODEL_PROVIDERS.OPENAI,
        contextWindow: 16384,
        maxTokens: 4096,
        costPer1kTokens: 0.001
      },
      [MODELS.GPT_5_1_CODEX_MINI]: {
        provider: MODEL_PROVIDERS.OPENAI,
        contextWindow: 400000,
        maxTokens: 8192,
        costPer1kTokens: 0.002
      },

      // DeepSeek models
      [MODELS.DEEPSEEK_R1]: {
        provider: MODEL_PROVIDERS.DEEPSEEK,
        contextWindow: 128000,
        maxTokens: 8192,
        costPer1kTokens: 0.002
      },

      // Phi models
      [MODELS.PHI_4]: {
        provider: MODEL_PROVIDERS.PHI,
        contextWindow: 16384,
        maxTokens: 4096,  // Increased from 2048
        costPer1kTokens: 0.001
      },
      [MODELS.PHI_4_REASONING]: {
        provider: MODEL_PROVIDERS.PHI,
        contextWindow: 32000,
        maxTokens: 4096,
        costPer1kTokens: 0.001
      },

      // Azure AI Foundry models
      'azure-ai-grok3': {
        provider: 'AZURE',
        contextWindow: 128000,
        maxTokens: 8192,  // Increased from 4096
        costPer1kTokens: 0.01
      },
      'azure-ai-deepseek-r1': {
        provider: 'AZURE',
        contextWindow: 128000,
        maxTokens: 8192,
        costPer1kTokens: 0.002
      },
      'azure-openai-gpt-5': {
        provider: 'AZURE',
        contextWindow: 128000,
        maxTokens: 8192,
        costPer1kTokens: 0.03
      },
      'azure-openai-gpt-4': {
        provider: 'AZURE',
        contextWindow: 128000,
        maxTokens: 8192,
        costPer1kTokens: 0.03
      },
      'azure-openai-gpt-4o': {
        provider: 'AZURE',
        contextWindow: 128000,
        maxTokens: 8192,
        costPer1kTokens: 0.03
      },

      // Router model
      'autopilot-model-router': {
        provider: 'AZURE',
        contextWindow: 16384,
        maxTokens: 2048,
        costPer1kTokens: 0.001
      }
    };

    // No need for prefixed models anymore - just return clean base specs
    return baseSpecs;
  }

  /**
   * Format messages for specific model
   * @private
   */
  _formatMessagesForModel(messages, model, options) {
    // Get model spec or use default
    const modelSpec = this.modelSpecs[model] || { provider: 'AZURE' };
    
    let formattedMessages;
    
    if (typeof messages === 'string') {
      // Single message
      formattedMessages = [{
        role: 'user',
        content: messages
      }];
    } else {
      // Message array
      formattedMessages = messages.map(msg => this._formatSingleMessage(msg, model));
    }
    
    // Apply provider-specific formatting
    switch (modelSpec.provider) {
      case MODEL_PROVIDERS.ANTHROPIC:
        return this._formatForAnthropic(formattedMessages);
      case MODEL_PROVIDERS.OPENAI:
        return this._formatForOpenAI(formattedMessages);
      case MODEL_PROVIDERS.AZURE:
        return this._formatForAzure(formattedMessages);
      default:
        return formattedMessages;
    }
  }

  /**
   * Format single message for model
   * @private
   */
  _formatSingleMessage(message, model) {
    return {
      role: message.role || 'user',
      content: message.content,
      timestamp: message.timestamp
    };
  }

  /**
   * Format messages for Anthropic models
   * @private
   */
  _formatForAnthropic(messages) {
    return messages.map(msg => {
      if (msg.role === 'system') {
        return {
          role: 'user',
          content: `System: ${msg.content}`
        };
      }
      return msg;
    });
  }

  /**
   * Format messages for OpenAI models
   * @private
   */
  _formatForOpenAI(messages) {
    // OpenAI supports system role natively
    return messages;
  }

  /**
   * Format messages for Azure models
   * @private
   */
  _formatForAzure(messages) {
    // Azure may have specific formatting requirements
    return messages.map(msg => ({
      ...msg,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }));
  }

  /**
   * Check if model is valid
   * @private
   */
  _isValidModel(model) {
    this.logger.debug('Validating model', { model, modelType: typeof model });
    
    // Check if model exists in our specs directly
    if (this.modelSpecs[model] !== undefined) {
      return true;
    }
    
    this.logger.warn('Model validation failed', { 
      model,
      availableModels: Object.keys(this.modelSpecs)
    });
    
    return false;
  }

  /**
   * Check model health status
   * @private
   */
  async _checkModelHealth(model) {
    // Implementation would check model-specific health endpoints
    // For now, return true (assuming all models are healthy)
    return true;
  }

  /**
   * Estimate tokens for content
   * @private
   */
  async _estimateTokens(content, model) {
    // Rough estimation: 1 token ≈ 4 characters for most models
    return Math.ceil(content.length / 4);
  }

  /**
   * Truncate message to fit token limit
   * @private
   */
  async _truncateMessage(content, maxTokens) {
    const maxChars = maxTokens * 4; // Rough estimation
    if (content.length <= maxChars) {
      return content;
    }
    
    return content.substring(0, maxChars - 20) + '\n... [message truncated]';
  }

  /**
   * Summarize messages for compactization
   * @private
   */
  async _summarizeMessages(messages, model) {
    const combinedContent = messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');
    
    // This would use the AI service to create a summary
    // For now, return a simple truncated version
    const maxLength = 500;
    if (combinedContent.length <= maxLength) {
      return combinedContent;
    }
    
    return combinedContent.substring(0, maxLength) + '... [conversation summary truncated]';
  }



  /**
   * Check rate limits
   * @private
   */
  async _checkRateLimit(model) {
    // Implementation would check model-specific rate limits
    // For now, just add a small delay
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Handle rate limit exceeded
   * @private
   */
  async _handleRateLimit(context) {
    const delay = 60000; // 1 minute delay for rate limits
    this.logger.info(`Rate limit exceeded, waiting ${delay}ms`, context);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Handle service unavailable
   * @private
   */
  async _handleServiceUnavailable(context) {
    this._recordFailure(context?.model);
    const delay = 30000; // 30 second delay for service issues
    this.logger.info(`Service unavailable, waiting ${delay}ms`, context);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Resolve a circuit-breaker bucket for a given model. The bucket is
   * keyed by **provider id**, not by model — failures on `gpt-5-pro`
   * shouldn't trip the breaker for `gpt-4o`, but cascading failures
   * across an entire provider (auth issue, vendor outage) still should.
   *
   * Falls back to a 'default' bucket when we can't resolve the model
   * (e.g. dispatcher hasn't matched it yet).
   * @private
   */
  _circuitBreakerBucket(model) {
    if (!this._providerCircuitBreakers) this._providerCircuitBreakers = new Map();
    let key = 'default';
    try {
      const p = this.getProviderRegistry().resolve({ model });
      if (p?.id) key = p.id;
    } catch { /* fall through */ }
    if (!this._providerCircuitBreakers.has(key)) {
      this._providerCircuitBreakers.set(key, {
        failures:        0,
        lastFailureTime: null,
        isOpen:          false,
        threshold:       this.circuitBreaker.threshold,
        timeout:         this.circuitBreaker.timeout,
      });
    }
    return { key, breaker: this._providerCircuitBreakers.get(key) };
  }

  /**
   * Check if circuit breaker is open for the given model's provider.
   * Auto-resets after the timeout window.
   * @private
   */
  _isCircuitBreakerOpen(model = null) {
    const { breaker } = this._circuitBreakerBucket(model);
    if (!breaker.isOpen) return false;
    const elapsed = Date.now() - (breaker.lastFailureTime || 0);
    if (elapsed > breaker.timeout) {
      breaker.isOpen = false;
      breaker.failures = 0;
      return false;
    }
    return true;
  }

  /**
   * Record failure for the model's provider-specific breaker.
   * @private
   */
  _recordFailure(model = null) {
    const { key, breaker } = this._circuitBreakerBucket(model);
    breaker.failures++;
    breaker.lastFailureTime = Date.now();
    if (breaker.failures >= breaker.threshold) {
      breaker.isOpen = true;
      this.logger?.warn(`Circuit breaker opened for provider "${key}" after ${breaker.failures} failures`);
    }
  }

  /**
   * Reset circuit breaker for the model's provider on success.
   * @private
   */
  _resetCircuitBreaker(model = null) {
    const { key, breaker } = this._circuitBreakerBucket(model);
    if (breaker.failures > 0 || breaker.isOpen) {
      breaker.failures = 0;
      breaker.isOpen = false;
      this.logger?.info(`Circuit breaker reset for provider "${key}"`);
    }
  }

  /**
   * Extract vendor name from model name
   * @param {string} model - Model name
   * @returns {string|null} Vendor name
   * @private
   */
  _getVendorFromModel(model) {
    if (!model) return null;
    
    const modelName = model.toLowerCase();
    
    if (modelName.includes('anthropic') || modelName.includes('claude')) {
      return 'anthropic';
    } else if (modelName.includes('openai') || modelName.includes('gpt')) {
      return 'openai';
    } else if (modelName.includes('deepseek')) {
      return 'deepseek';
    } else if (modelName.includes('phi')) {
      return 'microsoft';
    } else if (modelName.startsWith('ollama-')) {
      return 'ollama';
    }

    return null;
  }


  /**
   * Get available Ollama models (for model discovery).
   * Delegates to the Ollama provider in the registry.
   */
  async getOllamaModels() {
    const ollama = this.getProviderRegistry().get('ollama');
    if (!ollama) return [];
    return ollama.listModels();
  }
}

/**
 * ConversationManager - Handles multi-model conversation state
 */
class ConversationManager {
  constructor(agentId, logger) {
    this.agentId = agentId;
    this.logger = logger;
    this.conversations = new Map();
  }

  async switchModel(newModel) {
    // Implementation would handle model switching logic
    // For now, return empty conversation
    return {
      messages: [],
      model: newModel,
      lastUpdated: new Date().toISOString()
    };
  }
}

export default AIService;
