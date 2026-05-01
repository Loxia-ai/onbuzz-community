/**
 * ModelRouterService - Uses PHI-4 to make intelligent model routing decisions
 * 
 * Purpose:
 * - Analyze incoming messages and conversation context
 * - Use PHI-4 to determine optimal model for each message
 * - Provide fallback to previous model on errors
 * - Consider benchmark data and recent message history
 */

import { MODEL_ROUTER_CONFIG, HTTP_STATUS, MODELS } from '../utilities/constants.js';

class ModelRouterService {
  constructor(config, logger, benchmarkService, aiService) {
    this.config = config;
    this.logger = logger;
    this.benchmarkService = benchmarkService;
    this.aiService = aiService;
    
    this.routerModel = MODEL_ROUTER_CONFIG.ROUTER_MODEL;
    this.contextMessagesCount = MODEL_ROUTER_CONFIG.CONTEXT_MESSAGES_COUNT;
    this.requestTimeout = MODEL_ROUTER_CONFIG.REQUEST_TIMEOUT;
  }

  /**
   * Route message to optimal model using autopilot-model-router analysis
   * @param {Object} message - Current message to route
   * @param {Array} recentMessages - Recent conversation history
   * @param {string} currentModel - Current model being used
   * @param {Array} availableModels - Models available for routing
   * @param {Object} context - Message context with API keys
   * @returns {Promise<string>} Selected model name
   */
  async routeMessage(message, recentMessages = [], currentModel = '', availableModels = [], context = {}) {
    try {
      this.logger.debug('Starting model routing analysis', {
        messageLength: message.content?.length || 0,
        recentMessagesCount: recentMessages.length,
        currentModel,
        availableModelsCount: availableModels.length
      });

      // Build context for autopilot-model-router
      const routingContext = this._buildRoutingContext(
        message, 
        recentMessages, 
        currentModel, 
        availableModels
      );

      // Get benchmark data
      const benchmarkTable = this.benchmarkService.getBenchmarkTable();

      // Create routing prompt for autopilot-model-router
      const routingPrompt = this._createRoutingPrompt(routingContext, benchmarkTable, context.routingStrategy);

      // Send to autopilot-model-router for analysis
      const routingDecision = await this._askForRouting(routingPrompt, context);

      // Validate and return model selection
      const selectedModel = this._validateModelSelection(routingDecision, availableModels, currentModel);

      this.logger.info('Model routing completed', {
        selectedModel,
        previousModel: currentModel,
        changed: selectedModel !== currentModel,
        reasoning: routingDecision.reasoning?.substring(0, 100) || 'No reasoning provided'
      });

      // Return full routing result object for AgentScheduler
      return {
        selectedModel,
        previousModel: currentModel,
        changed: selectedModel !== currentModel,
        reasoning: routingDecision.reasoning || 'No reasoning provided'
      };

    } catch (error) {
      this.logger.error('Model routing failed, falling back to current model', {
        error: error.message,
        currentModel
      });

      // Fallback to current model on any error
      const fallbackModel = currentModel || availableModels[0] || MODELS.ANTHROPIC_SONNET;
      return {
        selectedModel: fallbackModel,
        previousModel: currentModel,
        changed: false,
        reasoning: 'Routing failed, using fallback model'
      };
    }
  }

  /**
   * Build routing context from message and conversation history
   * @private
   */
  _buildRoutingContext(message, recentMessages, currentModel, availableModels) {
    // Get recent messages (configurable count)
    const contextMessages = recentMessages
      .slice(-this.contextMessagesCount)
      .map(msg => ({
        role: msg.role,
        content: msg.content?.substring(0, 500) || '', // Limit content length
        timestamp: msg.timestamp
      }));

    return {
      currentMessage: {
        content: message.content?.substring(0, 1000) || '', // Limit current message
        role: message.role || 'user',
        hasContextReferences: !!(message.contextReferences?.length),
        contextTypes: message.contextReferences?.map(ref => ref.type) || []
      },
      recentMessages: contextMessages,
      currentModel,
      availableModels: availableModels.map(model => {
        const name = typeof model === 'string' ? model : (model.id || model.name);
        const pricing = typeof model === 'object' ? model.pricing : null;
        return {
          name,
          isCurrentModel: name === currentModel,
          ...(pricing && { pricing })
        };
      }),
      messageCount: recentMessages.length + 1,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create routing prompt for autopilot-model-router
   * @private
   */
  _createRoutingPrompt(context, benchmarkTable, routingStrategy) {
    const maxLen = MODEL_ROUTER_CONFIG.MAX_ROUTING_STRATEGY_LENGTH;
    const strategySection = routingStrategy?.trim()
      ? `\n## Agent-Specific Routing Strategy\n${routingStrategy.trim().substring(0, maxLen)}\n\nApply the above strategy when making your routing decision. It takes priority over the generic criteria.\n`
      : '';

    return `You are a model routing assistant. Your job is to analyze a conversation and select the optimal AI model for the next response.

## Current Situation
- **Current Model**: ${context.currentModel || 'None'}
- **Message Count**: ${context.messageCount}
- **Available Models**:
${context.availableModels.map(m => {
  const pricingInfo = m.pricing
    ? ` (input: $${m.pricing.input}/1K tokens, output: $${m.pricing.output}/1K tokens)`
    : '';
  return `  - ${m.name}${m.isCurrentModel ? ' [current]' : ''}${pricingInfo}`;
}).join('\n')}

## Recent Conversation Context
${this._formatRecentMessages(context.recentMessages)}

## Current Message to Route
**Role**: ${context.currentMessage.role}
**Content**: ${context.currentMessage.content}
**Has Context References**: ${context.currentMessage.hasContextReferences}
${context.currentMessage.contextTypes.length > 0 ? `**Context Types**: ${context.currentMessage.contextTypes.join(', ')}` : ''}

## Model Benchmark Data
${this._formatBenchmarkData(benchmarkTable)}

## Routing Decision
Analyze the current message and conversation context to select the best model. Consider:

1. **Task Type**: Infer from conversation content - is this coding, analysis, creative writing, or a quick task?
2. **Complexity**: Does it require deep reasoning or is it straightforward?
3. **Context**: Are there code files or technical references?
4. **Conversation Flow**: What has been discussed recently to understand the overall task?
5. **Efficiency**: Balance performance with cost/speed needs
${strategySection}
Respond with JSON only:
{
  "selectedModel": "model-name",
  "taskType": "coding|analysis|creative|quick-tasks",
  "confidence": 0.85,
  "reasoning": "Brief explanation of why this model was chosen",
  "factors": ["factor1", "factor2", "factor3"]
}`;
  }

  /**
   * Format recent messages for prompt
   * @private
   */
  _formatRecentMessages(messages) {
    if (!messages.length) {
      return 'No recent messages available.';
    }

    return messages.map((msg, i) => 
      `${i + 1}. **${msg.role}**: ${msg.content}`
    ).join('\n');
  }

  /**
   * Format benchmark data for prompt
   * @private
   */
  _formatBenchmarkData(benchmarkText) {
    // Benchmark text is provided as-is from backend, no processing needed
    if (!benchmarkText) {
      return 'No benchmark data available.';
    }
    return benchmarkText;
  }

  /**
   * Send routing request to autopilot-model-router
   * @private
   */
  async _askForRouting(prompt, context = {}) {
    try {
      // Use AI service to send request to autopilot-model-router
      const response = await this.aiService.sendMessage(
        this.routerModel,
        prompt,
        {
          agentId: 'model-router',
          systemPrompt: 'You are a model routing expert. Analyze conversations and select optimal AI models. Always respond with valid JSON only.',
          temperature: 0.3, // Low temperature for consistent routing decisions
          maxTokens: 500,
          timeout: this.requestTimeout,
          sessionId: context.sessionId,
          apiKey: context.apiKey || this.config.apiKey,
          customApiKeys: context.customApiKeys,
        }
      );

      if (!response.content) {
        throw new Error('No response content from autopilot-model-router');
      }

      // Parse JSON response
      const routingDecision = this._parseRoutingResponse(response.content);

      return routingDecision;

    } catch (error) {
      this.logger.error('autopilot-model-router routing request failed', { 
        error: error.message,
        routerModel: this.routerModel
      });
      throw error;
    }
  }

  /**
   * Parse autopilot-model-router routing response
   * @private
   */
  _parseRoutingResponse(content) {
    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in autopilot-model-router response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (!parsed.selectedModel) {
        throw new Error('Missing selectedModel in autopilot-model-router response');
      }

      return {
        selectedModel: parsed.selectedModel,
        taskType: parsed.taskType || 'unknown',
        confidence: parsed.confidence || 0.5,
        reasoning: parsed.reasoning || 'No reasoning provided',
        factors: parsed.factors || []
      };

    } catch (error) {
      this.logger.warn('Failed to parse autopilot-model-router routing response', { 
        error: error.message,
        content: content.substring(0, 200)
      });
      
      // Return default response on parse error
      return {
        selectedModel: null,
        taskType: 'unknown',
        confidence: 0.0,
        reasoning: 'Failed to parse routing response',
        factors: ['parsing-error']
      };
    }
  }

  /**
   * Validate model selection against available models
   * @private
   */
  _validateModelSelection(routingDecision, availableModels, currentModel) {
    const { selectedModel } = routingDecision;

    // If no model selected or parsing failed, use current model
    if (!selectedModel) {
      this.logger.debug('No model selected by router, using current model');
      return currentModel;
    }

    // Check if selected model is available (supports both string arrays and object arrays)
    const modelNames = availableModels.map(m => typeof m === 'string' ? m : (m.id || m.name));
    if (!modelNames.includes(selectedModel)) {
      this.logger.warn('Router selected unavailable model, using current model', {
        selectedModel,
        availableModels: modelNames
      });
      return currentModel;
    }

    // Model is valid
    return selectedModel;
  }

  /**
   * Get router service status
   */
  getStatus() {
    return {
      routerModel: this.routerModel,
      contextMessagesCount: this.contextMessagesCount,
      requestTimeout: this.requestTimeout,
      benchmarkServiceStatus: this.benchmarkService.getStatus(),
      isAvailable: true
    };
  }

  /**
   * Test router with sample data
   */
  async testRouter() {
    try {
      const testMessage = {
        content: 'Can you help me debug this JavaScript function?',
        role: 'user'
      };

      const testResult = await this.routeMessage(
        testMessage,
        [],
        MODELS.ANTHROPIC_SONNET,
        [MODELS.ANTHROPIC_SONNET, MODELS.GPT_4, MODELS.GPT_5_1_CODEX_MINI, MODELS.DEEPSEEK_R1],
        { apiKey: 'test-key' } // Mock context for testing
      );

      this.logger.info('Router test completed', { selectedModel: testResult });
      return { success: true, selectedModel: testResult };

    } catch (error) {
      this.logger.error('Router test failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }
}

export default ModelRouterService;