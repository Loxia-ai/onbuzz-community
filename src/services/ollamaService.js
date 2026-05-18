/**
 * @file ollamaService.js
 * @description Ollama integration service for local/offline LLM inference.
 * Wraps the ollama-js library to provide chat, streaming, and model discovery
 * capabilities that integrate with the existing AI service architecture.
 *
 * Ollama models are free to use (no billing) and run entirely offline.
 */

import { Ollama } from 'ollama';

const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
const MODEL_CACHE_TTL = 60_000; // 1 minute cache for model list
const HEALTH_CHECK_TIMEOUT = 3000; // 3 second timeout for health check
const OLLAMA_MODEL_PREFIX = 'ollama-';

/**
 * OllamaService - Local LLM inference via Ollama
 */
class OllamaService {
  constructor(config = {}, logger = null) {
    this.logger = logger;
    this.host = config.ollamaHost || DEFAULT_OLLAMA_HOST;
    this.client = new Ollama({ host: this.host });
    this.enabled = config.ollamaEnabled !== false; // Enabled by default

    // Model cache
    this._modelCache = null;
    this._modelCacheTime = 0;

    // Connection state
    this._isAvailable = null; // null = unknown
    this._lastHealthCheck = 0;
  }

  /**
   * Update Ollama host URL
   */
  setHost(host) {
    this.host = host || DEFAULT_OLLAMA_HOST;
    this.client = new Ollama({ host: this.host });
    this._isAvailable = null;
    this._modelCache = null;
    this.logger?.info(`[Ollama] Host updated to ${this.host}`);
  }

  /**
   * Check if Ollama server is reachable
   */
  async isAvailable() {
    // Cache health check for 10 seconds
    if (this._isAvailable !== null && Date.now() - this._lastHealthCheck < 10_000) {
      return this._isAvailable;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
      const response = await fetch(`${this.host}/api/version`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      this._isAvailable = response.ok;
    } catch {
      this._isAvailable = false;
    }

    this._lastHealthCheck = Date.now();
    return this._isAvailable;
  }

  /**
   * List available local models from Ollama
   * @returns {Array<Object>} Model list with normalized specs
   */
  async listModels() {
    // Return cached if fresh
    if (this._modelCache && Date.now() - this._modelCacheTime < MODEL_CACHE_TTL) {
      return this._modelCache;
    }

    if (!this.enabled) return [];

    try {
      const available = await this.isAvailable();
      if (!available) return [];

      const response = await this.client.list();
      const models = (response.models || []).map(m => this._normalizeModel(m));

      this._modelCache = models;
      this._modelCacheTime = Date.now();

      this.logger?.info(`[Ollama] Discovered ${models.length} local models`);
      return models;
    } catch (err) {
      this.logger?.warn(`[Ollama] Failed to list models: ${err.message}`);
      return this._modelCache || [];
    }
  }

  /**
   * Normalize Ollama model info to match platform model schema
   * @private
   */
  _normalizeModel(ollamaModel) {
    const name = ollamaModel.name; // e.g. "llama3.1:8b", "codellama:13b"
    const modelId = OLLAMA_MODEL_PREFIX + name.replace(/[:/]/g, '-'); // ollama-llama3.1-8b
    const details = ollamaModel.details || {};
    const sizeGB = ollamaModel.size ? (ollamaModel.size / 1e9).toFixed(1) : '?';

    // Estimate context window from parameter size and quantization
    const paramSize = details.parameter_size || '';
    const contextWindow = this._estimateContextWindow(paramSize, name);

    return {
      name: modelId,
      ollamaName: name, // Original name for API calls
      displayName: `${name} (${sizeGB}GB)`,
      provider: 'ollama',
      type: 'chat',
      api_type: ['chat'],
      contextWindow,
      maxTokens: Math.min(4096, Math.floor(contextWindow * 0.25)),
      pricing: { input: 0, output: 0 }, // Free - local inference
      deprecated: false,
      available: true,
      local: true,
      offline: true,
      details: {
        family: details.family || null,
        parameterSize: paramSize,
        quantization: details.quantization_level || null,
        format: details.format || null,
        sizeBytes: ollamaModel.size || 0
      }
    };
  }

  /**
   * Estimate context window based on model info
   * @private
   */
  _estimateContextWindow(paramSize, name) {
    // Known models with specific context windows
    const nameLower = name.toLowerCase();
    if (nameLower.includes('llama3') || nameLower.includes('llama-3')) return 128000;
    if (nameLower.includes('llama2') || nameLower.includes('llama-2')) return 4096;
    if (nameLower.includes('mistral')) return 32768;
    if (nameLower.includes('mixtral')) return 32768;
    if (nameLower.includes('phi')) return 16384;
    if (nameLower.includes('gemma2') || nameLower.includes('gemma-2')) return 8192;
    if (nameLower.includes('qwen')) return 32768;
    if (nameLower.includes('deepseek')) return 128000;
    if (nameLower.includes('codellama')) return 16384;
    if (nameLower.includes('command-r')) return 128000;

    // Default based on parameter size
    const sizeMatch = paramSize.match(/([\d.]+)/);
    if (sizeMatch) {
      const params = parseFloat(sizeMatch[1]);
      if (params >= 70) return 8192;
      if (params >= 13) return 8192;
      return 4096;
    }

    return 4096; // Conservative default
  }

  /**
   * Send a chat completion request to Ollama
   * @param {string} modelId - Normalized model ID (ollama-xxx)
   * @param {Array} messages - Conversation messages [{role, content}]
   * @param {Object} options - Options (temperature, maxTokens, systemPrompt)
   * @returns {Object} Response matching AIService format
   */
  async sendMessage(modelId, messages, options = {}) {
    const ollamaName = this._resolveModelName(modelId);

    // Build message array with system prompt
    const ollamaMessages = [];
    if (options.systemPrompt) {
      ollamaMessages.push({ role: 'system', content: options.systemPrompt });
    }

    for (const msg of messages) {
      ollamaMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : (msg.role === 'system' ? 'system' : 'user'),
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      });
    }

    const startTime = Date.now();

    try {
      const response = await this.client.chat({
        model: ollamaName,
        messages: ollamaMessages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens || 4096,
        }
      });

      const duration = Date.now() - startTime;

      // Estimate token counts from Ollama's eval metrics
      const promptTokens = response.prompt_eval_count || this._estimateTokens(ollamaMessages);
      const completionTokens = response.eval_count || this._estimateTokens([{ content: response.message?.content || '' }]);

      this.logger?.info(`[Ollama] ${ollamaName} responded in ${duration}ms (${promptTokens}+${completionTokens} tokens)`);

      return {
        choices: [{
          message: { content: response.message?.content || '' },
          finish_reason: response.done ? 'stop' : 'length'
        }],
        model: modelId,
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens
        }
      };
    } catch (err) {
      this.logger?.error(`[Ollama] Chat error for ${ollamaName}: ${err.message}`);
      throw new Error(`Ollama error (${ollamaName}): ${err.message}`);
    }
  }

  /**
   * Send a streaming chat request to Ollama
   * @param {string} modelId - Normalized model ID
   * @param {Array} messages - Conversation messages
   * @param {Object} options - Options including onChunk, onDone, onError callbacks
   * @returns {Object} Final response with content and metadata
   */
  async sendMessageStream(modelId, messages, options = {}) {
    const ollamaName = this._resolveModelName(modelId);
    const { onChunk, onDone, onError } = options;

    // Build message array
    const ollamaMessages = [];
    if (options.systemPrompt) {
      ollamaMessages.push({ role: 'system', content: options.systemPrompt });
    }

    for (const msg of messages) {
      ollamaMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : (msg.role === 'system' ? 'system' : 'user'),
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      });
    }

    const startTime = Date.now();
    let fullContent = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let chunkCount = 0;
    let finishReason = 'stop';
    let toolCalls = null;

    // Low-noise lifecycle marker — helps spot stalls between request and
    // first chunk (the symptom of a missing model, daemon hang, or
    // socket-level wedge). Pair with the "stream complete" log below.
    this.logger?.info(`[Ollama] stream start ${ollamaName}`, {
      messages:  ollamaMessages.length,
      maxTokens: options.maxTokens || 4096,
    });

    try {
      const stream = await this.client.chat({
        model: ollamaName,
        messages: ollamaMessages,
        stream: true,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens || 4096,
        }
      });

      if (!stream) {
        throw new Error(`Ollama returned no stream for model "${ollamaName}". The model may not be loaded or available.`);
      }

      for await (const chunk of stream) {
        chunkCount += 1;
        const content = chunk.message?.content || '';
        if (content) {
          fullContent += content;
          if (onChunk) {
            onChunk({ content, type: 'chunk' });
          }
        }

        // Final chunk has eval counts and (when the model called functions)
        // the OpenAI-shaped tool_calls array on chunk.message.
        if (chunk.done) {
          promptTokens = chunk.prompt_eval_count || this._estimateTokens(ollamaMessages);
          completionTokens = chunk.eval_count || this._estimateTokens([{ content: fullContent }]);
          if (chunk.done_reason) finishReason = chunk.done_reason;
          if (Array.isArray(chunk.message?.tool_calls) && chunk.message.tool_calls.length > 0) {
            toolCalls = chunk.message.tool_calls;
          }
        }
      }

      const duration = Date.now() - startTime;
      const usage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      };

      this.logger?.info(`[Ollama] stream complete ${ollamaName}`, {
        durationMs:    duration,
        chunkCount,
        contentLength: fullContent.length,
        finishReason,
        toolCalls:     toolCalls ? toolCalls.length : 0,
        totalTokens:   usage.total_tokens,
      });

      const result = {
        content: fullContent,
        model: modelId,
        tokenUsage: usage,
        finishReason,
        ...(toolCalls ? { toolCalls } : {}),
      };

      if (onDone) {
        onDone(result);
      }

      return result;
    } catch (err) {
      this.logger?.error(`[Ollama] stream failed for ${ollamaName}`, {
        message:       err.message,
        chunkCount,
        contentLength: fullContent.length,
        elapsedMs:     Date.now() - startTime,
      });
      if (onError) {
        onError(err);
      }
      throw new Error(`Ollama streaming error (${ollamaName}): ${err.message}`);
    }
  }

  /**
   * Resolve normalized model ID back to Ollama model name
   * @private
   */
  _resolveModelName(modelId) {
    // If it has the prefix, strip it and restore colons
    if (modelId.startsWith(OLLAMA_MODEL_PREFIX)) {
      const stripped = modelId.slice(OLLAMA_MODEL_PREFIX.length);
      // Restore the last dash to colon for tag separator (e.g., llama3.1-8b → llama3.1:8b)
      // Use cached model list for accurate mapping
      if (this._modelCache) {
        const cached = this._modelCache.find(m => m.name === modelId);
        if (cached) return cached.ollamaName;
      }
      // Fallback: restore last dash before a version-like segment to colon
      return stripped.replace(/-(\d+[bgBG]?)$/, ':$1')
                     .replace(/-latest$/, ':latest');
    }
    return modelId;
  }

  /**
   * Estimate token count from messages (fallback when Ollama doesn't report)
   * @private
   */
  _estimateTokens(messages) {
    let chars = 0;
    for (const msg of messages) {
      const content = msg.content || '';
      chars += typeof content === 'string' ? content.length : JSON.stringify(content).length;
    }
    return Math.ceil(chars / 3.5); // ~3.5 chars per token average
  }

  /**
   * Check if a model ID is an Ollama model
   * @param {string} modelId - Model identifier
   * @returns {boolean}
   */
  static isOllamaModel(modelId) {
    return typeof modelId === 'string' && modelId.startsWith(OLLAMA_MODEL_PREFIX);
  }

  /**
   * Pull a model from Ollama registry
   * @param {string} modelName - Model to pull (e.g., "llama3.1:8b")
   * @param {Function} onProgress - Progress callback
   */
  async pullModel(modelName, onProgress = null) {
    this.logger?.info(`[Ollama] Pulling model: ${modelName}`);

    try {
      const stream = await this.client.pull({ model: modelName, stream: true });

      if (!stream) {
        throw new Error(`Ollama returned no stream when pulling "${modelName}". Check that Ollama is running.`);
      }

      for await (const progress of stream) {
        if (onProgress) {
          onProgress({
            status: progress.status,
            total: progress.total,
            completed: progress.completed,
            percent: progress.total ? Math.round((progress.completed / progress.total) * 100) : null
          });
        }
      }

      // Invalidate model cache
      this._modelCache = null;
      this.logger?.info(`[Ollama] Successfully pulled ${modelName}`);
      return { success: true, model: modelName };
    } catch (err) {
      this.logger?.error(`[Ollama] Pull failed for ${modelName}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Delete a model from Ollama
   * @param {string} modelName - Model to delete
   */
  async deleteModel(modelName) {
    try {
      await this.client.delete({ model: modelName });
      this._modelCache = null;
      this.logger?.info(`[Ollama] Deleted model: ${modelName}`);
      return { success: true };
    } catch (err) {
      this.logger?.error(`[Ollama] Delete failed for ${modelName}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get model info from Ollama
   * @param {string} modelName - Model name
   */
  async getModelInfo(modelName) {
    try {
      const info = await this.client.show({ model: modelName });
      return {
        success: true,
        info: {
          name: modelName,
          license: info.license,
          modelfile: info.modelfile,
          parameters: info.parameters,
          template: info.template,
          details: info.details
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

// Singleton
let instance = null;

export function getOllamaService(config = {}, logger = null) {
  if (!instance) {
    instance = new OllamaService(config, logger);
  }
  return instance;
}

export { OllamaService, OLLAMA_MODEL_PREFIX };
export default OllamaService;
