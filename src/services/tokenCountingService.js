/**
 * TokenCountingService - Token counting for conversation compactization
 *
 * Purpose:
 * - Provide token counting using AI response metadata (prompt_tokens/completion_tokens)
 * - Fall back to character-based estimation when no response data exists
 * - Determine when conversation compactization should be triggered
 * - Context window management (values from backend)
 * - Compaction trigger detection
 *
 * Token Counting Strategy:
 * - The most recent assistant message's tokenUsage.prompt_tokens tells us exactly
 *   how many tokens the model counted for the entire conversation (system prompt +
 *   all messages up to that point). We add completion_tokens for the response itself.
 * - For messages added after the last AI response, we use character-based estimation.
 * - For the very first message (no AI response yet), we use pure estimation.
 */

import {
  MODELS,
  COMPACTION_CONFIG,
} from '../utilities/constants.js';

class TokenCountingService {
  constructor(logger, modelsService = null) {
    this.logger = logger;
    this.modelsService = modelsService;

    this.logger?.info('TokenCountingService initialized', {
      strategy: 'response-data-based with char estimation fallback'
    });
  }

  /**
   * Get current token count for a conversation using AI response metadata.
   *
   * The most recent assistant message's tokenUsage.prompt_tokens tells us
   * exactly how many tokens the model counted for the entire conversation
   * (system prompt + all messages up to that point). We add completion_tokens
   * for the response itself, then estimate tokens for any messages added
   * since that last response.
   *
   * For the very first message (no AI response yet), falls back to
   * character-based estimation.
   *
   * @param {Array} messages - Conversation messages array
   * @param {string} model - Model name (for context window lookup only)
   * @param {string|null} systemPrompt - System prompt text
   * @returns {number} Current token count
   */
  getConversationTokenCount(messages, model, systemPrompt = null) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return systemPrompt ? this._estimateTokens(systemPrompt) : 0;
    }

    // Walk backward to find the last assistant message with tokenUsage
    let lastResponseIndex = -1;
    let baseTokenCount = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      // Support both field name conventions:
      // - prompt_tokens/completion_tokens (OpenAI convention, normalized by scheduler)
      // - input_tokens/output_tokens (Anthropic/Azure convention, raw from backend)
      const promptTokens = msg.tokenUsage?.prompt_tokens || msg.tokenUsage?.input_tokens;
      if (msg.role === 'assistant' && promptTokens) {
        lastResponseIndex = i;
        // prompt_tokens = system prompt + all prior messages (what the model saw as input)
        // completion_tokens = the response itself
        const completionTokens = msg.tokenUsage.completion_tokens || msg.tokenUsage.output_tokens || 0;
        baseTokenCount = promptTokens + completionTokens;
        break;
      }
    }

    if (lastResponseIndex === -1) {
      // No AI response yet — pure estimation
      return this._estimateAllTokens(messages, systemPrompt);
    }

    // Estimate tokens for messages added AFTER the last AI response
    let additionalTokens = 0;
    for (let i = lastResponseIndex + 1; i < messages.length; i++) {
      additionalTokens += this._estimateMessageTokens(messages[i]);
    }

    const total = baseTokenCount + additionalTokens;

    this.logger?.debug('Token count from response data', {
      model,
      baseTokenCount,
      lastResponseIndex,
      messagesAfterResponse: messages.length - lastResponseIndex - 1,
      additionalTokens,
      total
    });

    return total;
  }

  /**
   * Get context window size for a model
   * @param {string} model - Model name
   * @returns {number} Context window size in tokens
   */
  getModelContextWindow(model) {
    // Try dynamic lookup from modelsService first (single source of truth from backend)
    if (this.modelsService) {
      try {
        const models = this.modelsService.getModels();
        const modelInfo = models.find(m => m.name === model);
        if (modelInfo?.contextWindow) {
          return modelInfo.contextWindow;
        }
      } catch (error) {
        this.logger?.debug('Failed to get context window from modelsService, using fallback', {
          model,
          error: error.message
        });
      }
    }

    // Fallback to base model values (for bootstrap/offline/unknown models)
    const fallbackContextWindows = {
      [MODELS.ANTHROPIC_OPUS]: 200000,
      [MODELS.ANTHROPIC_SONNET]: 200000,
      [MODELS.ANTHROPIC_HAIKU]: 200000,
      [MODELS.GPT_4]: 128000,
      [MODELS.GPT_4_MINI]: 128000,
      [MODELS.GPT_5_1_CODEX_MINI]: 400000,
      [MODELS.DEEPSEEK_R1]: 128000,
      [MODELS.PHI_4]: 16384,
      [MODELS.PHI_4_REASONING]: 32000,
      ...Object.fromEntries(
        (COMPACTION_CONFIG.COMPACTION_MODELS || []).map(m => [m, 128000])
      ),
      'autopilot-model-router': 16384,
    };

    const contextWindow = fallbackContextWindows[model];

    if (!contextWindow) {
      this.logger?.warn('Unknown model context window, using default', {
        model,
        defaultWindow: 128000
      });
      return 128000;
    }

    return contextWindow;
  }

  /**
   * Get maximum output tokens for a model
   * @param {string} model - Model name
   * @returns {number} Maximum output tokens
   */
  getModelMaxOutputTokens(model) {
    // Try dynamic lookup from modelsService first
    if (this.modelsService) {
      try {
        const models = this.modelsService.getModels();
        const modelInfo = models.find(m => m.name === model);
        if (modelInfo?.maxTokens) {
          return Math.min(modelInfo.maxTokens, COMPACTION_CONFIG.MAX_OUTPUT_TOKENS);
        }
      } catch (error) {
        this.logger?.debug('Failed to get max output tokens from modelsService, using fallback', {
          model,
          error: error.message
        });
      }
    }

    // Fallback to base model values
    const fallbackMaxOutputTokens = {
      [MODELS.ANTHROPIC_OPUS]: 8192,
      [MODELS.ANTHROPIC_SONNET]: 8192,
      [MODELS.ANTHROPIC_HAIKU]: 8192,
      [MODELS.GPT_4]: 8192,
      [MODELS.GPT_4_MINI]: 16384,
      [MODELS.GPT_5_1_CODEX_MINI]: 8192,
      [MODELS.DEEPSEEK_R1]: 8192,
      [MODELS.PHI_4]: 4096,
      [MODELS.PHI_4_REASONING]: 4096,
      ...Object.fromEntries(
        (COMPACTION_CONFIG.COMPACTION_MODELS || []).map(m => [m, 8192])
      ),
      'autopilot-model-router': 2048,
    };

    return Math.min(fallbackMaxOutputTokens[model] || 8192, COMPACTION_CONFIG.MAX_OUTPUT_TOKENS);
  }

  /**
   * Determine if compaction should be triggered
   * @param {number} currentTokens - Current conversation token count (K)
   * @param {number} maxOutputTokens - Max tokens model can output (X)
   * @param {number} contextWindow - Model's context window size (C)
   * @param {number} threshold - Trigger threshold (default 0.7 = 70%)
   * @returns {boolean} True if compaction should be triggered
   */
  shouldTriggerCompaction(currentTokens, maxOutputTokens, contextWindow, threshold = COMPACTION_CONFIG.DEFAULT_THRESHOLD) {
    // Validate threshold
    if (threshold < COMPACTION_CONFIG.MIN_THRESHOLD || threshold > COMPACTION_CONFIG.MAX_THRESHOLD) {
      this.logger?.warn('Invalid compaction threshold, using default', {
        provided: threshold,
        default: COMPACTION_CONFIG.DEFAULT_THRESHOLD
      });
      threshold = COMPACTION_CONFIG.DEFAULT_THRESHOLD;
    }

    // Calculate: K + X >= threshold * C
    const requiredTokens = currentTokens + maxOutputTokens;
    const thresholdTokens = threshold * contextWindow;
    const shouldTrigger = requiredTokens >= thresholdTokens;

    this.logger?.info(`Compaction check: K=${currentTokens}, X=${maxOutputTokens}, K+X=${requiredTokens}, C=${contextWindow}, threshold=${threshold}, CompactionNeeded=${shouldTrigger}`);

    return shouldTrigger;
  }

  /**
   * Calculate how many tokens to target after compaction
   * @param {number} contextWindow - Model's context window size
   * @param {number} targetThreshold - Target threshold after compaction (default 85%)
   * @returns {number} Target token count after compaction
   */
  calculateTargetTokenCount(contextWindow, targetThreshold = COMPACTION_CONFIG.MAX_ACCEPTABLE_TOKEN_COUNT_AFTER) {
    return Math.floor(contextWindow * targetThreshold);
  }

  /**
   * Validate that compaction achieved sufficient reduction
   * @param {number} originalTokens - Token count before compaction
   * @param {number} compactedTokens - Token count after compaction
   * @param {number} contextWindow - Model's context window
   * @returns {Object} Validation result { valid, reductionPercent, exceedsTarget }
   */
  validateCompaction(originalTokens, compactedTokens, contextWindow) {
    const reductionPercent = ((originalTokens - compactedTokens) / originalTokens) * 100;
    const targetTokens = this.calculateTargetTokenCount(contextWindow);
    const exceedsTarget = compactedTokens > targetTokens;
    const sufficientReduction = reductionPercent >= COMPACTION_CONFIG.MIN_REDUCTION_PERCENTAGE;

    const valid = !exceedsTarget && sufficientReduction;

    this.logger?.info('Compaction validation', {
      originalTokens,
      compactedTokens,
      reductionPercent: reductionPercent.toFixed(2),
      targetTokens,
      exceedsTarget,
      sufficientReduction,
      valid
    });

    return {
      valid,
      reductionPercent,
      exceedsTarget,
      sufficientReduction,
      targetTokens,
      compactedTokens,
      originalTokens
    };
  }

  /**
   * Estimate all tokens using character-based approximation.
   * Used only when no AI response data exists (first message).
   * @private
   */
  _estimateAllTokens(messages, systemPrompt = null) {
    let total = 0;
    if (systemPrompt) {
      total += this._estimateTokens(systemPrompt);
    }
    for (const msg of messages) {
      total += this._estimateMessageTokens(msg);
    }
    return total;
  }

  /**
   * Estimate tokens for a single message.
   * @private
   */
  _estimateMessageTokens(message) {
    if (!message?.content) return 0;
    const content = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);
    return this._estimateTokens(content) + 5; // 5 tokens for role/formatting overhead
  }

  /**
   * Fast token estimation (character-based)
   * @private
   */
  _estimateTokens(text) {
    if (!text || typeof text !== 'string') {
      return 0;
    }
    return Math.ceil(text.length / COMPACTION_CONFIG.CHARS_PER_TOKEN_ESTIMATE);
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    this.logger?.info('TokenCountingService cleaned up');
  }
}

export default TokenCountingService;
