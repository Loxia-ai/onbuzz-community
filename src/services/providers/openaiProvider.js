/**
 * OpenAI provider adapter — covers OpenAI proper plus any
 * OpenAI-compatible endpoint (Azure OpenAI, OpenRouter, Together,
 * Fireworks, Groq, vLLM, LiteLLM, etc.) by parameterizing baseUrl.
 *
 * Wire format: standard `/v1/chat/completions` with SSE streaming
 * (`stream: true`). Reasoning tokens surfaced via
 * `usage.completion_tokens_details.reasoning_tokens`. Tool calls
 * surfaced via `choices[].message.tool_calls` (non-stream) or
 * `choices[].delta.tool_calls` deltas (stream).
 */

import BaseProvider from './baseProvider.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// Model-name regex that routes to this provider when no explicit
// provider is set. Covers:
//   - gpt-*           (gpt-3.5-turbo, gpt-4o, gpt-4.1, gpt-5, ...)
//   - chatgpt-*       (chatgpt-4o-latest)
//   - o1, o3, o4 + suffixed variants (o1, o1-mini, o3, o3-mini, o4-mini)
// Bare `o1` / `o3` / `o4` need to match too — vendor `/v1/models` lists
// them without a hyphen, and a previous prefix-only matcher returned
// "No provider matched" for those names.
// Custom-endpoint users with non-standard model names should pass
// `provider: 'openai'` explicitly.
const OPENAI_MODEL_RE = /^(gpt-|chatgpt-|o[1-9](-|$))/;

export default class OpenAIProvider extends BaseProvider {
  constructor(config = {}, logger = console) {
    super(config, logger);
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  get id() { return 'openai'; }
  get displayName() { return this.config.displayName || 'OpenAI'; }

  matchesModel(model) {
    if (typeof model !== 'string') return false;
    return OPENAI_MODEL_RE.test(model);
  }

  /**
   * Single classifier for OpenAI reasoning-mode models. They share
   * a set of API constraints relative to chat models:
   *   - Reject `temperature` (forced to 1.0 internally)
   *   - Renamed `max_tokens` → `max_completion_tokens`
   *
   * Coverage:
   *   - o-series:  o1*, o3*, o4*  (and any future o[5-9]-*)
   *   - gpt-5.x:   gpt-5, gpt-5-mini, gpt-5-nano, gpt-5-pro, gpt-5-codex,
   *                gpt-5.1, gpt-5.2, ..., dated variants — EXCEPT
   *                `*-chat-latest` which is the chat-mode entry point.
   *
   * Subclasses (xAI etc.) override for vendor-specific variants.
   */
  _isOpenAIReasoningModel(model) {
    if (typeof model !== 'string') return false;
    if (/^o[1-9](-|$)/.test(model)) return true;
    // Original gpt-5-chat-latest is the only exception — accepts
    // `max_tokens` and `temperature`. Everything else in gpt-5.x
    // (including gpt-5.1-chat-latest, gpt-5.2-chat-latest, ...) was
    // moved to reasoning-mode constraints by OpenAI.
    if (model === 'gpt-5-chat-latest') return false;
    if (/^gpt-5/.test(model)) return true;
    return false;
  }

  /** Whether the given model accepts the `temperature` parameter. */
  _modelSupportsTemperature(model) {
    return !this._isOpenAIReasoningModel(model);
  }

  /** Field name for the output-token cap on the request body. */
  _maxTokensField(model) {
    return this._isOpenAIReasoningModel(model) ? 'max_completion_tokens' : 'max_tokens';
  }

  /** Build the request body in OpenAI Chat Completions shape. */
  _buildBody(request) {
    const messages = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    for (const m of (request.messages || [])) {
      messages.push(m);
    }

    const body = {
      model:    request.model,
      messages,
      stream:   !!request.options?.stream,
    };
    if (request.options?.max_tokens != null) {
      // o-series renamed `max_tokens` → `max_completion_tokens`. Pick the
      // field name the model expects.
      body[this._maxTokensField(request.model)] = request.options.max_tokens;
    }
    if (request.options?.temperature != null && this._modelSupportsTemperature(request.model)) {
      body.temperature = request.options.temperature;
    }
    if (Array.isArray(request.options?.tools) && request.options.tools.length > 0) {
      // OpenAI Chat Completions tool format:
      //   { type: 'function', function: { name, description, parameters } }
      //
      // The CLI ships its tool catalog in OpenAI's *Responses API* shape
      // (`{ type: 'function', name, description, parameters }` — no
      // `function` wrapper), because the legacy backend forwarded the
      // schemas verbatim to the Responses API. The Chat Completions API
      // we call here requires the wrapped form, so we normalize:
      //
      //   - Already wrapped (has `t.function`)        → pass through
      //   - Responses shape (top-level name/etc.)     → wrap into `function`
      body.tools = request.options.tools.map(t => {
        if (t && t.function) return t;
        return {
          type: 'function',
          function: {
            name:        t.name,
            description: t.description,
            parameters:  t.parameters || { type: 'object', properties: {} },
          },
        };
      });
    }
    if (body.stream) {
      // Ask for usage on the final chunk so we can capture token counts.
      body.stream_options = { include_usage: true };
    }
    return body;
  }

  _headers(apiKey) {
    return {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey || this.config.apiKey || ''}`,
      'Accept':        'application/json',
    };
  }

  async sendMessage(request) {
    const url = `${this.baseUrl}/chat/completions`;
    const body = this._buildBody({ ...request, options: { ...(request.options || {}), stream: false } });
    const res = await this._fetchWithTimeout(url, {
      method:  'POST',
      headers: this._headers(request.apiKey),
      body:    JSON.stringify(body),
    });
    if (!res.ok) throw await this._httpError(res, this.id);
    const data = await res.json();
    return this._fromNonStreamingResponse(data, request.model);
  }

  async sendMessageStream(request, handlers = {}) {
    const url = `${this.baseUrl}/chat/completions`;
    const body = this._buildBody({ ...request, options: { ...(request.options || {}), stream: true } });
    const res = await this._fetchWithTimeout(url, {
      method:  'POST',
      headers: { ...this._headers(request.apiKey), 'Accept': 'text/event-stream' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) throw await this._httpError(res, this.id);

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/event-stream')) {
      // Fallback: provider returned non-streaming body
      const data = await res.json();
      const final = this._fromNonStreamingResponse(data, request.model);
      handlers.onDone?.(final);
      return final;
    }

    const final = await this._parseSSEStream(res.body, handlers, request.model);
    handlers.onDone?.(final);
    return final;
  }

  /**
   * Parse OpenAI Chat Completions streaming SSE.
   * Events are JSON objects under `data: ` lines, with `[DONE]` terminator.
   */
  async _parseSSEStream(stream, handlers, fallbackModel) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';
    let content = '';
    let reasoning = '';
    let usage = null;
    let model = fallbackModel;
    let finishReason = 'stop';
    const toolCalls = new Map(); // index -> { id, name, arguments }

    const processEvent = (raw) => {
      const line = raw.trim();
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      let evt;
      try { evt = JSON.parse(data); } catch { return; }

      if (evt.usage) usage = evt.usage;
      if (evt.model) model = evt.model;

      const delta = evt.choices?.[0]?.delta;
      const finish = evt.choices?.[0]?.finish_reason;
      if (finish) finishReason = finish;
      if (!delta) return;

      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        handlers.onChunk?.(delta.content);
      }
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        handlers.onReasoningChunk?.(delta.reasoning_content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls.has(idx)) toolCalls.set(idx, { id: tc.id || `call_${idx}`, name: '', arguments: '' });
          const slot = toolCalls.get(idx);
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.arguments += tc.function.arguments;
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const parts = lineBuffer.split('\n');
      lineBuffer = parts.pop() || '';
      for (const p of parts) processEvent(p);
    }
    if (lineBuffer.trim()) processEvent(lineBuffer);

    return {
      content,
      reasoning,
      reasoningTokens: this._extractReasoningTokens(usage),
      usage,
      model,
      finishReason,
      toolCalls: toolCalls.size > 0 ? Array.from(toolCalls.values()) : undefined,
    };
  }

  _fromNonStreamingResponse(data, fallbackModel) {
    const msg = data.choices?.[0]?.message || {};
    const reasoning =
      (typeof msg.reasoning_content === 'string' && msg.reasoning_content) ||
      (typeof msg.reasoning === 'string' && msg.reasoning) ||
      '';
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls.map(tc => ({
      id:        tc.id,
      name:      tc.function?.name || tc.name,
      arguments: tc.function?.arguments || tc.arguments,
    })) : undefined;

    return {
      content:         msg.content || '',
      reasoning,
      reasoningTokens: this._extractReasoningTokens(data.usage),
      usage:           data.usage || null,
      model:           data.model || fallbackModel,
      finishReason:    data.choices?.[0]?.finish_reason || 'stop',
      toolCalls,
    };
  }

  _extractReasoningTokens(usage) {
    if (!usage) return null;
    const candidates = [
      usage.reasoning_tokens,
      usage.completion_tokens_details?.reasoning_tokens,
      usage.completionTokensDetails?.reasoningTokens,
    ];
    for (const c of candidates) if (Number.isFinite(c)) return c;
    return null;
  }

  /**
   * Classify a model id by its likely capability against /v1/chat/completions.
   * OpenAI's /v1/models lists everything (TTS, embeddings, image, realtime,
   * audio, deep-research, computer-use, transcribe, moderation, ...) that
   * we can't usefully target with a chat completion. The picker shows
   * `chat: true` only.
   */
  static _classifyOpenAIModel(id) {
    if (typeof id !== 'string') return { chat: false };
    const NON_CHAT = [
      /\btts\b/i, /^tts-/i, /-tts(-|$)/i,
      /\baudio\b/i, /\brealtime\b/i,
      /\btranscribe\b/i, /\bwhisper\b/i,
      /\bdall-e\b/i, /\bgpt-image\b/i, /\bchatgpt-image\b/i, /\bsora\b/i,
      /\bembed\b/i, /\btext-embedding\b/i,
      /\bmoderation\b/i,
      /\bcomputer-use\b/i, /\bdeep-research\b/i, /\brobotics\b/i,
      /\bbabbage\b/i, /\bdavinci\b/i, /-instruct(-|$)/i,
      /\bsearch-preview\b/i, /\bsearch-api\b/i,
    ];
    if (NON_CHAT.some(re => re.test(id))) return { chat: false };

    // Responses-API-only models. OpenAI's "pro" reasoning variants
    // (gpt-5-pro, gpt-5.2-pro, gpt-5.4-pro, gpt-5.5-pro, o1-pro, o3-pro)
    // and the codex CLI-agent models are served exclusively by
    // /v1/responses, not /v1/chat/completions. Calling them on chat
    // returns:
    //   "This model is only supported in v1/responses and not in v1/chat/completions."
    // Until we add a Responses-API adapter we filter them out of the
    // chat picker. (Setting chat=false keeps them in the raw catalog
    // without /api/llm/models?chat=true so debuggers can still inspect.)
    const RESPONSES_ONLY = [
      /^gpt-5(\.[0-9]+)?-pro(-|$)/i,
      /^o[1-9]-pro(-|$)/i,
      /^gpt-5(\.[0-9]+)?-codex(-|$)/i,
    ];
    if (RESPONSES_ONLY.some(re => re.test(id))) {
      return { chat: false, responsesOnly: true };
    }

    return {
      chat:           true,
      reasoning:      /^o[1-9](-|$)/.test(id) || /^gpt-5/.test(id) && !/-chat-latest(-|$)/.test(id),
      supportsTools:  true,
      supportsVision: /^gpt-4(o|-|\.|1|5)|^o[3-9]/i.test(id),
    };
  }

  async listModels() {
    if (!this.config.apiKey) return [];
    try {
      const res = await this._fetchWithTimeout(`${this.baseUrl}/models`, {
        headers: this._headers(this.config.apiKey),
      }, 10_000);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map(m => {
        const c = OpenAIProvider._classifyOpenAIModel(m.id);
        return {
          name:           m.id,
          displayName:    m.id,
          provider:       this.id,
          contextWindow:  null,
          supportsTools:  c.supportsTools !== false,
          supportsVision: !!c.supportsVision,
          chat:           c.chat,
          reasoning:      !!c.reasoning,
        };
      });
    } catch (e) {
      this.logger?.debug?.(`${this.id} listModels failed`, { error: e.message });
      return [];
    }
  }

  async isAvailable() {
    if (!this.config.apiKey) return false;
    try {
      const res = await this._fetchWithTimeout(`${this.baseUrl}/models`, {
        headers: this._headers(this.config.apiKey),
      }, 5000);
      return res.ok;
    } catch {
      return false;
    }
  }
}
