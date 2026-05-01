/**
 * Ollama provider — wraps the existing OllamaService with the
 * BaseProvider contract. The wrapped service handles all of:
 *   - HTTP to /api/chat on the local Ollama daemon
 *   - Streaming chunk emission via Node async iterators
 *   - Model discovery from /api/tags
 *
 * This adapter is the canonical wire-format translator. Tool calling
 * support depends on the underlying model — newer Ollama builds (≥0.4.x)
 * surface OpenAI-style tool calls in `message.tool_calls`. We pass them
 * through unchanged.
 *
 * Note: Ollama runs locally and uses no API key. The OnBuzz model id
 * carries an `ollama-` prefix to disambiguate from cloud-provider models
 * with the same family name.
 */

import BaseProvider from './baseProvider.js';
import { getOllamaService, OLLAMA_MODEL_PREFIX } from '../ollamaService.js';

export default class OllamaProvider extends BaseProvider {
  constructor(config = {}, logger = console) {
    super(config, logger);
    this._service = getOllamaService(config, logger);
  }

  get id() { return 'ollama'; }
  get displayName() { return 'Ollama (local)'; }

  matchesModel(model) {
    return typeof model === 'string' && model.startsWith(OLLAMA_MODEL_PREFIX);
  }

  setHost(host) { this._service.setHost(host); }

  async sendMessage(request) {
    const messages = (request.messages || []).map(m => ({ role: m.role, content: m.content }));
    const raw = await this._service.sendMessage(request.model, messages, {
      systemPrompt: request.systemPrompt,
      temperature:  request.options?.temperature,
      maxTokens:    request.options?.max_tokens,
    });
    // Translate ollamaService's OpenAI-shaped response into canonical shape.
    const choice = raw.choices?.[0] || {};
    const msg = choice.message || {};
    return {
      content:         msg.content || '',
      reasoning:       '',
      reasoningTokens: null,
      usage:           raw.usage || null,
      model:           raw.model || request.model,
      finishReason:    choice.finish_reason || 'stop',
      toolCalls:       Array.isArray(msg.tool_calls) ? msg.tool_calls.map(tc => ({
        id:        tc.id || `call_${tc.function?.name || ''}`,
        name:      tc.function?.name || tc.name,
        arguments: typeof tc.function?.arguments === 'string'
                     ? tc.function.arguments
                     : JSON.stringify(tc.function?.arguments || tc.arguments || {}),
      })) : undefined,
    };
  }

  async sendMessageStream(request, handlers = {}) {
    const messages = (request.messages || []).map(m => ({ role: m.role, content: m.content }));
    const raw = await this._service.sendMessageStream(request.model, messages, {
      systemPrompt:     request.systemPrompt,
      temperature:      request.options?.temperature,
      maxTokens:        request.options?.max_tokens,
      onChunk:          handlers.onChunk,
      onReasoningChunk: handlers.onReasoningChunk,
      // Note: ollamaService delivers a final response object as the resolved value;
      // we translate it after the await rather than via onDone (its onDone signature
      // differs across versions).
    });
    const choice = raw.choices?.[0] || {};
    const msg = choice.message || {};
    const final = {
      content:         msg.content || '',
      reasoning:       '',
      reasoningTokens: null,
      usage:           raw.usage || null,
      model:           raw.model || request.model,
      finishReason:    choice.finish_reason || 'stop',
      toolCalls:       Array.isArray(msg.tool_calls) ? msg.tool_calls.map(tc => ({
        id:        tc.id || `call_${tc.function?.name || ''}`,
        name:      tc.function?.name || tc.name,
        arguments: typeof tc.function?.arguments === 'string'
                     ? tc.function.arguments
                     : JSON.stringify(tc.function?.arguments || tc.arguments || {}),
      })) : undefined,
    };
    handlers.onDone?.(final);
    return final;
  }

  async listModels() {
    const local = await this._service.listModels();
    return local.map(m => ({
      name:           m.name,
      displayName:    m.displayName,
      provider:       this.id,
      contextWindow:  m.contextWindow,
      supportsTools:  true,
      supportsVision: m.details?.family === 'llava',
    }));
  }

  async isAvailable() { return this._service.isAvailable(); }
}
