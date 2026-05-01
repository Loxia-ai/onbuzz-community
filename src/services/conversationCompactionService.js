/**
 * ConversationCompactionService - Intelligent conversation compactization
 *
 * Purpose:
 * - Compress long conversations while preserving critical information
 * - AI-based summarization with sandwich approach (beginning + summary + end)
 * - Multi-pass compaction (up to 3 passes) when a single pass isn't enough
 * - Model switching support via best-existing-conversation selection
 * - Compaction model validation against live model catalog
 *
 * Strategy:
 * - Summarization only (sandwich approach):
 *   Keep beginning messages + AI summary of middle + end messages
 *   Middle segment always >= 50% of total messages
 *   Multi-pass: if result is still too large, re-summarize up to MAX_COMPACTION_PASSES times
 *
 * Model Switch Behavior:
 * - Instead of truncation, find the best existing compacted conversation
 *   from another model and summarize that for the target model
 */

import {
  COMPACTION_CONFIG,
  COMPACTION_STRATEGIES,
} from '../utilities/constants.js';

class ConversationCompactionService {
  constructor(tokenCountingService, aiService, logger) {
    this.tokenCountingService = tokenCountingService;
    this.aiService = aiService;
    this.logger = logger;

    // Models service for runtime validation (injected after construction)
    this.modelsService = null;

    // Round-robin index for compaction model selection
    this.compactionModelIndex = 0;

    // Summary generation prompt template
    this.summaryPromptTemplate = this._createSummaryPromptTemplate();
  }

  /**
   * Inject models service for runtime model validation
   * @param {ModelsService} modelsService - Models service instance
   */
  setModelsService(modelsService) {
    this.modelsService = modelsService;
    this.logger.info('ModelsService injected into compaction service');
  }

  /**
   * Get validated compaction models — filters COMPACTION_MODELS against live catalog
   * @returns {string[]} Array of model names that are both recommended and available
   * @private
   */
  _getValidatedCompactionModels() {
    const recommendedModels = COMPACTION_CONFIG.COMPACTION_MODELS || [];

    if (!this.modelsService) {
      this.logger.debug('No modelsService available, using all recommended compaction models');
      return recommendedModels;
    }

    try {
      const availableNames = this.modelsService.getAvailableModelNames();
      if (!availableNames || availableNames.length === 0) {
        this.logger.warn('ModelsService returned no models, using all recommended compaction models');
        return recommendedModels;
      }

      const availableSet = new Set(availableNames);
      const validated = recommendedModels.filter(m => availableSet.has(m));

      if (validated.length > 0) {
        this.logger.debug('Compaction models validated against live catalog', {
          recommended: recommendedModels.length,
          available: validated.length,
          validated
        });
        return validated;
      }

      // No recommended models match — pick the available model with the largest context window
      this.logger.warn('No recommended compaction models found in catalog, selecting largest-context available model');
      const models = this.modelsService.getModels();
      const chatModels = models.filter(m => m.type === 'chat' || !m.type);

      if (chatModels.length === 0) {
        this.logger.error('No chat models available at all, falling back to recommended list');
        return recommendedModels;
      }

      // Sort by context window descending
      chatModels.sort((a, b) => (b.contextWindow || 0) - (a.contextWindow || 0));
      const fallbackModel = chatModels[0].name;

      this.logger.info('Using fallback compaction model from catalog', {
        model: fallbackModel,
        contextWindow: chatModels[0].contextWindow
      });
      return [fallbackModel];

    } catch (error) {
      this.logger.warn('Failed to validate compaction models against catalog', {
        error: error.message
      });
      return recommendedModels;
    }
  }

  /**
   * Get next compaction model using round-robin from validated models
   * @param {string[]} models - Validated model list
   * @param {number} offset - Offset from current index
   * @returns {string} Model name
   * @private
   */
  _getNextCompactionModel(models, offset = 0) {
    if (!models || models.length === 0) {
      throw new Error('No compaction models available');
    }
    const index = (this.compactionModelIndex + offset) % models.length;
    return models[index];
  }

  /**
   * Advance the round-robin index
   * @private
   */
  _advanceCompactionModelIndex() {
    const models = COMPACTION_CONFIG.COMPACTION_MODELS || [];
    if (models.length > 0) {
      this.compactionModelIndex = (this.compactionModelIndex + 1) % models.length;
    }
  }

  /**
   * Main compaction entry point
   * @param {Array} messages - Original messages array
   * @param {string} currentModel - Current model being used
   * @param {string} targetModel - Target model (may differ if switching)
   * @param {Object} options - Compaction options
   * @param {Map} [options.compactedConversations] - Map of modelId → compactedMessages (for model switch)
   * @returns {Promise<Object>} Compaction result with messages and metadata
   */
  async compactConversation(messages, currentModel, targetModel, options = {}) {
    const startTime = Date.now();

    try {
      // Validate inputs
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('Messages array is required and cannot be empty');
      }

      // Split oversized messages into smaller chunks before compaction.
      // This increases message count so the sandwich strategy can push
      // oversized content into the summarizable middle segment.
      const splitResult = this._splitOversizedMessages(messages);
      let wasSplit = splitResult.wasSplit;

      const minMessages = options.emergency ? 4 : COMPACTION_CONFIG.MIN_MESSAGES_FOR_COMPACTION;

      if (splitResult.messages.length < minMessages) {
        this.logger.warn('Too few messages for compaction', {
          messageCount: splitResult.messages.length,
          originalCount: messages.length,
          minimum: minMessages,
          emergency: !!options.emergency
        });

        return {
          compactedMessages: messages,
          strategy: 'none',
          originalTokenCount: 0,
          compactedTokenCount: 0,
          reductionPercent: 0,
          skipped: true,
          reason: 'Too few messages'
        };
      }

      // Determine if model switch and pick best starting conversation
      const isModelSwitch = currentModel !== targetModel;
      let messagesToCompact = splitResult.messages;

      if (isModelSwitch && options.compactedConversations) {
        const bestConversation = this._findBestConversationForModelSwitch(
          options.compactedConversations,
          targetModel
        );
        if (bestConversation) {
          // Split the best conversation too (it may contain oversized messages)
          const bestSplit = this._splitOversizedMessages(bestConversation);
          messagesToCompact = bestSplit.messages;
          wasSplit = wasSplit || bestSplit.wasSplit;
          this.logger.info('Using best existing conversation for model switch', {
            originalMessages: messages.length,
            bestConversationMessages: bestConversation.length,
            currentModel,
            targetModel
          });
        }
      }

      this.logger.info('Starting conversation compaction', {
        messageCount: messagesToCompact.length,
        currentModel,
        targetModel,
        strategy: COMPACTION_STRATEGIES.SUMMARIZATION,
        isModelSwitch
      });

      // Execute multi-pass summarization
      const result = await this._compactWithMultiPassSummarization(
        messagesToCompact,
        targetModel,
        { ...options, wasSplit }
      );

      // Add execution metadata
      const executionTime = Date.now() - startTime;
      result.executionTime = executionTime;
      result.timestamp = new Date().toISOString();

      this.logger.info('Compaction completed successfully', {
        strategy: result.strategy,
        originalMessages: messagesToCompact.length,
        compactedMessages: result.compactedMessages.length,
        originalTokens: result.originalTokenCount,
        compactedTokens: result.compactedTokenCount,
        reductionPercent: result.reductionPercent.toFixed(2),
        passes: result.passes,
        executionTime: `${executionTime}ms`
      });

      return result;

    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.logger.error('Compaction failed', {
        error: error.message,
        messageCount: messages.length,
        currentModel,
        targetModel,
        executionTime: `${executionTime}ms`
      });

      throw error;
    }
  }

  /**
   * Find the best existing compacted conversation for model switching.
   * Prefers the conversation from a model whose context window is the largest
   * C where C < targetModel's context window.
   * Falls back to the shortest compacted conversation.
   *
   * @param {Map} compactedConversations - Map of modelId → compactedMessages
   * @param {string} targetModel - Target model name
   * @returns {Array|null} Best conversation messages, or null
   * @private
   */
  _findBestConversationForModelSwitch(compactedConversations, targetModel) {
    if (!compactedConversations || compactedConversations.size === 0) {
      return null;
    }

    const targetContextWindow = this.tokenCountingService.getModelContextWindow(targetModel);

    // Collect candidates: conversations that have messages
    const candidates = [];
    for (const [modelId, msgs] of compactedConversations) {
      if (Array.isArray(msgs) && msgs.length > 0) {
        const contextWindow = this.tokenCountingService.getModelContextWindow(modelId);
        candidates.push({ modelId, messages: msgs, contextWindow });
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Prefer: largest context window that is < targetModel's context window
    // (these conversations were already compacted to fit a smaller window, so they'll fit the target)
    const smallerCandidates = candidates
      .filter(c => c.contextWindow < targetContextWindow)
      .sort((a, b) => b.contextWindow - a.contextWindow);

    if (smallerCandidates.length > 0) {
      const best = smallerCandidates[0];
      this.logger.debug('Best conversation for model switch: largest smaller context', {
        selectedModel: best.modelId,
        selectedContextWindow: best.contextWindow,
        targetContextWindow,
        messageCount: best.messages.length
      });
      return best.messages;
    }

    // Fallback: shortest conversation (fewest messages)
    candidates.sort((a, b) => a.messages.length - b.messages.length);
    const shortest = candidates[0];
    this.logger.debug('Best conversation for model switch: shortest', {
      selectedModel: shortest.modelId,
      messageCount: shortest.messages.length
    });
    return shortest.messages;
  }

  /**
   * Multi-pass summarization: runs up to MAX_COMPACTION_PASSES passes.
   * After each pass, checks if the result fits within the compaction threshold.
   * If it fits, returns immediately; otherwise re-compacts the compacted result.
   *
   * @param {Array} messages - Messages to compact
   * @param {string} model - Target model name
   * @param {Object} options - Compaction options
   * @returns {Promise<Object>} Compaction result
   * @private
   */
  async _compactWithMultiPassSummarization(messages, model, options) {
    const maxPasses = COMPACTION_CONFIG.MAX_COMPACTION_PASSES;
    const contextWindow = this.tokenCountingService.getModelContextWindow(model);
    const maxOutputTokens = this.tokenCountingService.getModelMaxOutputTokens(model);
    const threshold = COMPACTION_CONFIG.DEFAULT_THRESHOLD;
    const wasSplit = options.wasSplit || false;

    let currentMessages = messages;
    let result = null;

    for (let pass = 1; pass <= maxPasses; pass++) {
      this.logger.info(`Compaction pass ${pass}/${maxPasses}`, {
        inputMessages: currentMessages.length,
        model,
        contextWindow,
        wasSplit
      });

      result = await this._executeSingleSummarizationPass(currentMessages, model, options, pass);

      // Check if result fits within threshold
      const compactedTokens = this.tokenCountingService.getConversationTokenCount(
        result.compactedMessages,
        model
      );
      result.compactedTokenCount = compactedTokens;

      const fitsWithinThreshold = !this.tokenCountingService.shouldTriggerCompaction(
        compactedTokens,
        maxOutputTokens,
        contextWindow,
        threshold
      );

      this.logger.info(`Compaction pass ${pass} result`, {
        compactedMessages: result.compactedMessages.length,
        compactedTokens,
        fitsWithinThreshold,
        contextWindow,
        threshold
      });

      if (fitsWithinThreshold) {
        result.passes = pass;
        return result;
      }

      // If not the last pass, use compacted result as input for next pass
      // Split any oversized messages that survived compaction
      if (pass < maxPasses) {
        const reSplit = this._splitOversizedMessages(result.compactedMessages);
        currentMessages = reSplit.messages;
      }
    }

    // Best effort after all passes
    this.logger.warn('Compaction did not fit within threshold after all passes', {
      passes: maxPasses,
      finalTokens: result.compactedTokenCount,
      contextWindow,
      threshold
    });
    result.passes = maxPasses;
    return result;
  }

  /**
   * Execute a single summarization pass (sandwich approach).
   * Preserves beginning + AI summary of middle + end.
   *
   * @param {Array} messages - Messages to compact
   * @param {string} model - Target model name
   * @param {Object} options - Compaction options
   * @param {number} passNumber - Current pass number (1-based)
   * @returns {Promise<Object>} Compaction result
   * @private
   */
  async _executeSingleSummarizationPass(messages, model, options, passNumber) {
    const strategy = COMPACTION_STRATEGIES.SUMMARIZATION;

    // Estimate original token count
    const originalTokenCount = this.tokenCountingService.getConversationTokenCount(
      messages,
      model
    );

    // Identify segments (message-count-based)
    // When oversized messages were split, use a small end segment so
    // most chunks land in the middle for summarization
    const segments = this._identifySegments(messages, { wasSplit: options.wasSplit });

    this.logger.info(`Pass ${passNumber}: segments identified`, {
      summarizedMessages: segments.middle.length,
      keptMessages: segments.end.length,
      totalMessages: messages.length
    });

    // Generate summary of middle segment
    let summary;
    try {
      summary = await this._generateSummary(
        segments.middle,
        model,
        {
          ...options,
          middleStartIndex: segments.middleStartIndex,
          middleEndIndex: segments.middleEndIndex,
          passNumber
        }
      );
    } catch (error) {
      if (error.code === 'ALL_MODELS_EXHAUSTED') {
        // All AI models failed — use structural fallback
        this.logger.warn('All summarization models exhausted, using structural fallback compaction');
        const fallbackResult = this._performFallbackCompaction(messages);

        const compactedTokenCount = this.tokenCountingService.getConversationTokenCount(
          fallbackResult.compactedMessages,
          model
        );

        const reductionPercent = originalTokenCount > 0
          ? ((originalTokenCount - compactedTokenCount) / originalTokenCount) * 100
          : 0;

        return {
          compactedMessages: fallbackResult.compactedMessages,
          strategy: 'structural_fallback',
          originalTokenCount,
          compactedTokenCount,
          reductionPercent,
          segments: {
            beginningCount: segments.beginning.length,
            middleCount: segments.middle.length,
            endCount: segments.end.length,
            summaryInserted: true,
            fallback: true
          }
        };
      }
      throw error;
    }

    // Construct compacted conversation
    const compactedMessages = [
      ...segments.beginning,
      summary,
      ...segments.end
    ];

    // Count tokens in compacted conversation
    const compactedTokenCount = this.tokenCountingService.getConversationTokenCount(
      compactedMessages,
      model
    );

    // Calculate reduction
    const reductionPercent = originalTokenCount > 0
      ? ((originalTokenCount - compactedTokenCount) / originalTokenCount) * 100
      : 0;

    return {
      compactedMessages,
      strategy,
      originalTokenCount,
      compactedTokenCount,
      reductionPercent,
      segments: {
        beginningCount: segments.beginning.length,
        middleCount: segments.middle.length,
        endCount: segments.end.length,
        summaryInserted: true
      }
    };
  }

  /**
   * Calculate the maximum characters the summarizer can handle in a single call.
   * Uses the largest available compaction model's context window minus overhead.
   *
   * @returns {number} Maximum characters per summarization call
   * @private
   */
  _calculateSummarizerCapacity() {
    const models = this._getValidatedCompactionModels();
    const contextWindows = { ...(COMPACTION_CONFIG.MODEL_CONTEXT_WINDOWS || {}) };

    // Augment with live data from modelsService if available
    if (this.modelsService) {
      try {
        const allModels = this.modelsService.getModels();
        for (const m of allModels) {
          if (m.contextWindow) {
            contextWindows[m.name] = m.contextWindow;
          }
        }
      } catch (e) { /* use static fallback */ }
    }

    const largestContext = Math.max(...models.map(m => contextWindows[m] || 128000));

    const usableTokens = largestContext
      - (COMPACTION_CONFIG.SUMMARIZER_SYSTEM_PROMPT_OVERHEAD || 500)
      - (COMPACTION_CONFIG.SUMMARIZER_TEMPLATE_OVERHEAD || 800)
      - (COMPACTION_CONFIG.MAX_SUMMARY_TOKENS || 8000)
      - (COMPACTION_CONFIG.SUMMARIZER_SAFETY_MARGIN || 5000);

    const effectiveTokens = Math.max(10000, usableTokens);
    return effectiveTokens * (COMPACTION_CONFIG.CHARS_PER_TOKEN_ESTIMATE || 3);
  }

  /**
   * Identify conversation segments using token-budget sizing.
   * The middle segment starts at the 15% char mark and extends forward
   * until hitting either the summarizer's capacity or 35% of total chars.
   * This guarantees the middle always fits within the summarizer's context window.
   *
   * @param {Array} messages - Messages array
   * @param {Object} [options] - Segmentation options
   * @param {boolean} [options.wasSplit] - Whether oversized messages were split (unused in new logic)
   * @returns {Object} { beginning, middle, end, middleStartIndex, middleEndIndex }
   * @private
   */
  _identifySegments(messages, options = {}) {
    const totalMessages = messages.length;

    // Edge case: very small conversations — summarize all but last message
    if (totalMessages <= 4) {
      return {
        beginning: [],
        middle: messages.slice(0, Math.max(1, totalMessages - 1)),
        end: messages.slice(-1),
        middleStartIndex: 0,
        middleEndIndex: Math.max(0, totalMessages - 2)
      };
    }

    // Calculate char length of each message
    const msgChars = messages.map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      return content.length;
    });
    const totalChars = msgChars.reduce((sum, c) => sum + c, 0);

    // Get summarizer capacity (max chars it can handle in one call)
    const summarizerCapacity = this._calculateSummarizerCapacity();

    // Walk BACKWARD from end to determine tail (kept verbatim)
    // Recent messages are more relevant for continuation than old ones
    const tailBudget = totalChars * COMPACTION_CONFIG.TAIL_PRESERVE_PERCENTAGE;
    let tailChars = 0;
    let keepStartIdx = totalMessages;
    for (let i = totalMessages - 1; i >= 0; i--) {
      if (tailChars + msgChars[i] > tailBudget && i < totalMessages - 1) {
        break;
      }
      tailChars += msgChars[i];
      keepStartIdx = i;
    }
    // Ensure at least 1 message in the summarize segment
    keepStartIdx = Math.max(1, keepStartIdx);

    // Old segment: M[0..keepStartIdx-1] — to be summarized
    // Cap by summarizer capacity (if too large, only summarize what fits this pass)
    let oldChars = 0;
    let summarizeEndIdx = keepStartIdx;
    for (let i = 0; i < keepStartIdx; i++) {
      if (oldChars + msgChars[i] > summarizerCapacity && i > 0) {
        summarizeEndIdx = i;
        break;
      }
      oldChars += msgChars[i];
    }

    const middle = messages.slice(0, summarizeEndIdx);  // summarized
    const end = messages.slice(summarizeEndIdx);         // kept verbatim

    this.logger.info('Segment identification (tail-preserving)', {
      totalMessages,
      totalChars,
      summarizerCapacity,
      middleCount: middle.length,
      middleChars: oldChars,
      endCount: end.length,
      tailBudget,
      keepStartIdx,
      summarizeEndIdx
    });

    return {
      beginning: [],
      middle: middle.length > 0 ? middle : [messages[0]],
      end: end.length > 0 ? end : [messages[messages.length - 1]],
      middleStartIndex: 0,
      middleEndIndex: summarizeEndIdx - 1
    };
  }

  /**
   * Generate AI summary of middle segment using validated compaction models
   * @private
   */
  async _generateSummary(middleMessages, model, options = {}) {
    if (middleMessages.length === 0) {
      return {
        role: 'system',
        content: `${COMPACTION_CONFIG.COMPACTION_SUMMARY_PREFIX} No messages to summarize.`,
        type: 'summary',
        timestamp: new Date().toISOString()
      };
    }

    // Format middle messages for summarization
    let middleContent = middleMessages
      .map(msg => `${msg.role}: ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`)
      .join('\n\n');

    // Estimate input tokens
    const estimatedInputTokens = Math.ceil(middleContent.length / COMPACTION_CONFIG.CHARS_PER_TOKEN_ESTIMATE);

    // Get validated compaction models
    const models = this._getValidatedCompactionModels();

    // Get context windows for smart selection
    const contextWindows = COMPACTION_CONFIG.MODEL_CONTEXT_WINDOWS || {};

    // If modelsService available, augment context windows with live data
    if (this.modelsService) {
      try {
        const allModels = this.modelsService.getModels();
        for (const m of allModels) {
          if (m.contextWindow) {
            contextWindows[m.name] = m.contextWindow;
          }
        }
      } catch (e) {
        // Ignore — use static fallback
      }
    }

    // Find the largest context window available among compaction models
    const largestContextWindow = Math.max(
      ...models.map(m => contextWindows[m] || 128000)
    );
    const maxInputTokens = largestContextWindow - 10000;

    // Middle is now sized by _identifySegments to fit within the summarizer's capacity.
    // No truncation needed — the segment is guaranteed to be within budget.
    if (estimatedInputTokens > maxInputTokens) {
      this.logger.info('Middle segment exceeds single model but sized to fit summarizer capacity', {
        estimatedInputTokens,
        maxInputTokens,
        largestContextWindow,
        middleChars: middleContent.length
      });
    }

    // Build summary prompt
    const summaryPrompt = this.summaryPromptTemplate
      .replace('{middle_segment}', middleContent);

    // Estimate tokens for model selection
    const finalEstimatedTokens = Math.ceil(middleContent.length / COMPACTION_CONFIG.CHARS_PER_TOKEN_ESTIMATE);

    // Filter to models with sufficient context
    const requiredContext = finalEstimatedTokens + 10000;
    const capableModels = models.filter(m => {
      const modelContext = contextWindows[m] || 128000;
      return modelContext >= requiredContext;
    });

    const selectedModels = capableModels.length > 0 ? capableModels : models;

    this.logger.info('Compaction model selection', {
      finalEstimatedTokens,
      requiredContext,
      validatedModelsCount: models.length,
      capableModelsCount: capableModels.length,
      selectedModels
    });

    const modelsAttempted = [];
    let lastError = null;

    for (let attempt = 0; attempt < selectedModels.length; attempt++) {
      const compactionModel = selectedModels[attempt];
      modelsAttempted.push(compactionModel);

      try {
        this.logger.info('Generating summary', {
          compactionModel,
          attempt: attempt + 1,
          totalModels: selectedModels.length,
          middleMessageCount: middleMessages.length,
          passNumber: options.passNumber || 1
        });

        // Call AI service (skipCircuitBreaker prevents compaction failures from blocking the agent)
        const response = await this.aiService.sendMessage(
          compactionModel,
          summaryPrompt,
          {
            systemPrompt: 'You are a conversation summarization expert. Your goal is to compress conversations while preserving critical information for continued interaction.',
            maxTokens: COMPACTION_CONFIG.MAX_SUMMARY_TOKENS,
            temperature: 0.3,
            sessionId: options.sessionId,
            skipCircuitBreaker: true
          }
        );

        const summaryContent = response.content.trim();

        // Build index range string
        const indexRange = (options.middleStartIndex !== undefined && options.middleEndIndex !== undefined)
          ? `original messages ${options.middleStartIndex}-${options.middleEndIndex}`
          : `${middleMessages.length} messages`;

        this.logger.info('Summary generated successfully', {
          compactionModel,
          attempt: attempt + 1,
          originalLength: middleContent.length,
          summaryLength: summaryContent.length,
          compressionRatio: (summaryContent.length / middleContent.length * 100).toFixed(2) + '%',
          indexRange,
          passNumber: options.passNumber || 1
        });

        // Advance round-robin index
        this._advanceCompactionModelIndex();

        return {
          role: 'system',
          content: `${COMPACTION_CONFIG.COMPACTION_SUMMARY_PREFIX} - ${indexRange}]\n\n${summaryContent}\n\n${COMPACTION_CONFIG.COMPACTION_SUMMARY_SUFFIX}`,
          type: 'summary',
          timestamp: new Date().toISOString(),
          metadata: {
            originalMessageCount: middleMessages.length,
            originalStartIndex: options.middleStartIndex,
            originalEndIndex: options.middleEndIndex,
            compactionModel,
            passNumber: options.passNumber || 1
          }
        };

      } catch (error) {
        lastError = error;
        const isRateLimit = error.message?.includes('429') || error.message?.includes('rate limit');

        this.logger.warn('Summary generation failed, trying next model', {
          compactionModel,
          attempt: attempt + 1,
          remainingModels: selectedModels.length - attempt - 1,
          isRateLimit,
          error: error.message
        });

        // Notify user that compaction is taking longer (only if more models to try)
        if (attempt < selectedModels.length - 1 && options.onRetryAttempt) {
          options.onRetryAttempt({
            type: 'compaction_retry',
            message: 'Compaction is taking longer than usual, hold on we\'ll be right there',
            failedModel: compactionModel,
            nextModel: selectedModels[attempt + 1],
            attempt: attempt + 1,
            totalModels: selectedModels.length
          });
        }
      }
    }

    // All recommended models failed — try one last-resort random model with sufficient context
    if (this.modelsService) {
      try {
        const allModels = this.modelsService.getModels();
        const suitableModels = allModels
          .filter(m => (m.type === 'chat' || !m.type) && !modelsAttempted.includes(m.name))
          .filter(m => (m.contextWindow || 128000) >= requiredContext)
          .sort(() => Math.random() - 0.5);

        if (suitableModels.length > 0) {
          const lastResort = suitableModels[0].name;
          modelsAttempted.push(lastResort);

          this.logger.info('Trying last-resort random model for compaction', { lastResort, requiredContext });

          if (options.onRetryAttempt) {
            options.onRetryAttempt({
              type: 'compaction_retry',
              message: 'Compaction is taking longer than usual, hold on we\'ll be right there',
              failedModel: modelsAttempted[modelsAttempted.length - 2],
              nextModel: lastResort,
              attempt: modelsAttempted.length,
              totalModels: modelsAttempted.length
            });
          }

          const response = await this.aiService.sendMessage(
            lastResort,
            summaryPrompt,
            {
              systemPrompt: 'You are a conversation summarization expert. Your goal is to compress conversations while preserving critical information for continued interaction.',
              maxTokens: COMPACTION_CONFIG.MAX_SUMMARY_TOKENS,
              temperature: 0.3,
              sessionId: options.sessionId,
              skipCircuitBreaker: true
            }
          );

          const summaryContent = response.content.trim();
          const indexRange = (options.middleStartIndex !== undefined && options.middleEndIndex !== undefined)
            ? `original messages ${options.middleStartIndex}-${options.middleEndIndex}`
            : `${middleMessages.length} messages`;

          this.logger.info('Last-resort model succeeded for compaction', { lastResort, summaryLength: summaryContent.length });
          this._advanceCompactionModelIndex();

          return {
            role: 'system',
            content: `${COMPACTION_CONFIG.COMPACTION_SUMMARY_PREFIX} - ${indexRange}]\n\n${summaryContent}\n\n${COMPACTION_CONFIG.COMPACTION_SUMMARY_SUFFIX}`,
            type: 'summary',
            timestamp: new Date().toISOString(),
            metadata: {
              originalMessageCount: middleMessages.length,
              originalStartIndex: options.middleStartIndex,
              originalEndIndex: options.middleEndIndex,
              compactionModel: lastResort,
              passNumber: options.passNumber || 1,
              lastResort: true
            }
          };
        }
      } catch (lastResortError) {
        this.logger.warn('Last-resort model also failed', { error: lastResortError.message });
        lastError = lastResortError;
      }
    }

    // ALL models exhausted (including last-resort) — now show error to user
    const errorDetails = {
      modelsAttempted,
      lastError: lastError?.message,
      middleMessageCount: middleMessages.length,
      isRateLimitIssue: lastError?.message?.includes('429') || lastError?.message?.includes('rate limit')
    };

    this.logger.error('All compaction models exhausted (including last-resort)', errorDetails);

    if (options.onAllModelsExhausted) {
      options.onAllModelsExhausted({
        type: 'compaction_models_exhausted',
        message: `Conversation compaction failed: All ${modelsAttempted.length} models are currently unavailable. ${errorDetails.isRateLimitIssue ? 'Rate limits may be in effect.' : ''} Using structural fallback compaction.`,
        models: modelsAttempted,
        error: lastError?.message
      });
    }

    this._advanceCompactionModelIndex();

    const exhaustedError = new Error('ALL_MODELS_EXHAUSTED');
    exhaustedError.code = 'ALL_MODELS_EXHAUSTED';
    exhaustedError.details = errorDetails;
    throw exhaustedError;
  }

  /**
   * Perform structural fallback compaction when all AI models are unavailable.
   * No AI call required - pure structural transformation:
   * 1. Remove all system messages (except the first/main one)
   * 2. Remove tool results
   * 3. Keep beginning + end of remaining messages
   * 4. Replace middle with a short paragraph
   * @param {Array} allMessages - The full original messages array
   * @returns {Object} { compactedMessages, metadata }
   * @private
   */
  _performFallbackCompaction(allMessages) {
    // 1. Identify the main system message
    const mainSystemMsg = allMessages.find(m => m.role === 'system' && m.type !== 'summary');

    // 2. Filter out system messages (except main) and tool results
    const filteredMessages = allMessages.filter(m => {
      if (m === mainSystemMsg) return true;
      if (m.role === 'system') return false;
      if (m.type === 'tool_result' || m.type === 'tool-result' || m.role === 'tool') return false;
      return true;
    });

    const removedSystemCount = allMessages.filter(m => m.role === 'system' && m !== mainSystemMsg).length;
    const removedToolCount = allMessages.filter(m => m.type === 'tool_result' || m.type === 'tool-result' || m.role === 'tool').length;

    // 3. Apply sandwich using segment identification
    const segments = this._identifySegments(filteredMessages);

    // 4. Build replacement paragraph for middle section
    const middleSummary = this._buildFallbackMiddleParagraph(segments.middle, {
      removedSystemCount,
      removedToolCount,
      totalOriginalMessages: allMessages.length
    });

    // 5. Create the summary message
    const summaryMessage = {
      role: 'system',
      content: `${COMPACTION_CONFIG.COMPACTION_SUMMARY_PREFIX} - structural fallback]\n\n${middleSummary}\n\n${COMPACTION_CONFIG.COMPACTION_SUMMARY_SUFFIX}`,
      type: 'summary',
      timestamp: new Date().toISOString(),
      metadata: {
        fallback: true,
        structural: true,
        removedSystemMessages: removedSystemCount,
        removedToolResults: removedToolCount,
        middleMessagesCompacted: segments.middle.length
      }
    };

    // 6. Reconstruct conversation
    const compactedMessages = [
      ...segments.beginning,
      summaryMessage,
      ...segments.end
    ];

    this.logger.info('Structural fallback compaction performed', {
      originalMessages: allMessages.length,
      afterFiltering: filteredMessages.length,
      removedSystemMessages: removedSystemCount,
      removedToolResults: removedToolCount,
      beginningKept: segments.beginning.length,
      middleCompacted: segments.middle.length,
      endKept: segments.end.length,
      finalMessages: compactedMessages.length
    });

    return {
      compactedMessages,
      metadata: {
        strategy: 'structural_fallback',
        removedSystemMessages: removedSystemCount,
        removedToolResults: removedToolCount,
        middleMessagesCompacted: segments.middle.length
      }
    };
  }

  /**
   * Build a short paragraph summarizing the middle section for fallback compaction
   * @private
   */
  _buildFallbackMiddleParagraph(middleMessages, stats) {
    const userMsgs = middleMessages.filter(m => m.role === 'user');
    const assistantMsgs = middleMessages.filter(m => m.role === 'assistant');

    // Extract file paths mentioned in messages
    const filePathRegex = /(?:\/[\w.-]+)+\.\w+|(?:[A-Za-z]:)?(?:\\[\w.-]+)+\.\w+|(?:src|lib|test|config|public|dist|build|node_modules)\/[\w./\-]+/g;
    const filePaths = new Set();
    for (const msg of middleMessages) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      const matches = content.match(filePathRegex);
      if (matches) {
        matches.forEach(p => filePaths.add(p));
      }
    }

    const parts = [];
    parts.push(`[${middleMessages.length} messages compacted (${userMsgs.length} user, ${assistantMsgs.length} assistant).`);

    if (stats.removedSystemCount > 0 || stats.removedToolCount > 0) {
      parts.push(`Additionally removed: ${stats.removedSystemCount} system messages, ${stats.removedToolCount} tool results.`);
    }

    if (filePaths.size > 0) {
      const fileList = Array.from(filePaths).slice(0, 20).join(', ');
      parts.push(`Files referenced: ${fileList}${filePaths.size > 20 ? ` and ${filePaths.size - 20} more` : ''}.`);
    }

    parts.push('Summary generation was unavailable - content structurally compacted for context management.]');

    return parts.join(' ');
  }

  /**
   * Split oversized messages into smaller chunks for effective compaction.
   * When a single message exceeds OVERSIZED_MESSAGE_THRESHOLD, it gets split
   * into chunks of MAX_CHUNK_SIZE, increasing message count so the sandwich
   * strategy can push the content into the summarizable middle segment.
   *
   * @param {Array} messages - Messages array
   * @returns {Array} Messages with oversized ones split into chunks
   * @private
   */
  _splitOversizedMessages(messages) {
    const threshold = COMPACTION_CONFIG.OVERSIZED_MESSAGE_THRESHOLD;
    const maxChunk = COMPACTION_CONFIG.MAX_CHUNK_SIZE;

    let splitCount = 0;
    const result = [];

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : '';

      if (content.length <= threshold) {
        result.push(msg);
        continue;
      }

      // Split this message
      splitCount++;
      const chunks = this._splitContentIntoChunks(content, maxChunk);

      this.logger.info('Splitting oversized message for compaction', {
        role: msg.role,
        type: msg.type || 'none',
        originalChars: content.length,
        chunks: chunks.length
      });

      for (let i = 0; i < chunks.length; i++) {
        const chunkMsg = {
          ...msg,
          content: `[Part ${i + 1}/${chunks.length}${i === 0 ? ' — oversized message split for compaction' : ' — continued'}]\n${chunks[i]}`,
          _splitMetadata: {
            originalLength: content.length,
            chunkIndex: i,
            totalChunks: chunks.length
          }
        };
        // Give each chunk a unique ID to avoid conflicts
        if (msg.id) {
          chunkMsg.id = `${msg.id}-chunk-${i + 1}`;
        }
        result.push(chunkMsg);
      }
    }

    if (splitCount > 0) {
      this.logger.info('Oversized message splitting complete', {
        originalCount: messages.length,
        newCount: result.length,
        added: result.length - messages.length,
        messagesSplit: splitCount
      });
    }

    return { messages: result, wasSplit: splitCount > 0 };
  }

  /**
   * Split content into chunks, respecting natural boundaries.
   * Priority: double newlines > single newlines > hard cut at maxChunk.
   *
   * @param {string} content - Content to split
   * @param {number} maxChunk - Maximum chunk size in chars
   * @returns {string[]} Array of content chunks
   * @private
   */
  _splitContentIntoChunks(content, maxChunk) {
    if (content.length <= maxChunk) return [content];

    const chunks = [];
    let remaining = content;

    while (remaining.length > maxChunk) {
      let splitAt = -1;

      // Try double newline within the chunk range
      const searchRange = remaining.substring(0, maxChunk);
      const lastDoubleNL = searchRange.lastIndexOf('\n\n');
      if (lastDoubleNL > maxChunk * 0.3) {
        splitAt = lastDoubleNL + 2;
      }

      // Fallback: single newline
      if (splitAt === -1) {
        const lastNL = searchRange.lastIndexOf('\n');
        if (lastNL > maxChunk * 0.3) {
          splitAt = lastNL + 1;
        }
      }

      // Fallback: sentence boundary (". " — common in prose, rare in code)
      if (splitAt === -1) {
        const lastSentence = searchRange.lastIndexOf('. ');
        if (lastSentence > maxChunk * 0.3) {
          splitAt = lastSentence + 2;
        }
      }

      // Fallback: hard cut (e.g. minified code with no newlines)
      // TODO: Consider splitting at last space or semicolon before maxChunk
      //       to avoid breaking mid-token/mid-word in minified code
      if (splitAt === -1) {
        splitAt = maxChunk;
      }

      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt);
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks;
  }

  /**
   * Create summary prompt template with preservation guidelines
   * @private
   */
  _createSummaryPromptTemplate() {
    return `You are compacting a conversation to preserve critical information while reducing token count.

CONTEXT: You are summarizing the EARLIEST portion of a conversation. The most recent messages are preserved separately. Your summary should capture what was accomplished, key decisions, and any information still relevant for continuation. Focus on outcomes over process.

PRESERVATION GUIDELINES:

HIGH PRIORITY (Always Preserve):
- User requests and goals: What the user asked for, their stated preferences, and desired outcomes — these drive all ongoing work
- Current task and next steps: What the agent is actively working on and what remains to be done
- Recent achievements and current status: What was accomplished, what state the work is in now
- Files created or modified successfully: Full file paths that were written, created, or changed
- Meaningful tool invocations and their outcomes: Tool calls that produced important results or side effects
- Future reference value: Information likely to be referenced again
- Decisions and reasoning: WHY things were decided, not just what
- API signatures and interfaces: Function definitions, method calls
- Active dependencies: Information that ongoing work relies on
- Error patterns and solutions: What failed and how it was fixed
- Key facts and data: Specific numbers, names, configurations

MEDIUM PRIORITY (Compress Intelligently):
- Code blocks: Keep function signatures + brief description, compress implementation details
- Working solutions: Essence and outcome, not every implementation step
- Failed attempts: Brief mention of what didn't work and why, skip detailed troubleshooting
- Repetitive content: Consolidate similar examples or explanations

LOW PRIORITY (Heavily Compress/Remove):
- Completed calculations: Keep results, skip intermediate steps
- Verbose explanations: Summarize well-known concepts
- Debug output: Skip terminal logs and error messages that served their purpose
- Trial-and-error sequences: Skip multiple failed attempts with no lasting value
- Acknowledgments and pleasantries: Skip "thank you", "sure", "okay" type exchanges

CONVERSATION SEGMENT TO SUMMARIZE:
{middle_segment}

TASK: Create a concise summary that preserves logical flow and critical information. Focus on:
1. Key decisions and their reasoning
2. Important facts, data, and configurations
3. Active context needed for continuation
4. Problem-solving outcomes (skip the debugging process)
5. Dependencies and interfaces that code/work relies on

Someone reading this should understand the conversation progression and have all information needed for effective continuation.

OUTPUT: Provide ONLY the summary text without preamble, explanation, or meta-commentary.`;
  }
}

export default ConversationCompactionService;
