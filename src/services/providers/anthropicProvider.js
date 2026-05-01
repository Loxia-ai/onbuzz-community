/**
 * Anthropic provider — direct API to api.anthropic.com.
 *
 * Wire format: `/v1/messages` with `x-api-key` header. Streams use SSE
 * with event types: `message_start`, `content_block_start`,
 * `content_block_delta` (deltas can be `text_delta` or `thinking_delta`),
 * `content_block_stop`, `message_delta` (carries usage + stop_reason),
 * `message_stop`. Tool calls surface as content blocks of type
 * `tool_use` with input streamed as `input_json_delta` chunks.
 *
 * Translation specifics:
 *   - `system` is a TOP-LEVEL field, not a message role.
 *   - Tool schemas: { name, description, input_schema } (no `function` wrap).
 *   - Reasoning tokens via `usage.cache_read_input_tokens` are NOT
 *     reasoning — Anthropic does not currently expose reasoning token
 *     counts; we leave the field null when unset.
 */

import BaseProvider from './baseProvider.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

export default class AnthropicProvider extends BaseProvider {
  constructor(config = {}, logger = console) {
    super(config, logger);
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  get id() { return 'anthropic'; }
  get displayName() { return 'Anthropic'; }

  matchesModel(model) {
    return typeof model === 'string' && model.startsWith('claude-');
  }

  /**
   * Whether the given model accepts the `temperature` parameter.
   *
   * Anthropic's reasoning-capable models (Opus 4.7+) reject `temperature`
   * with a 400 — they force temperature=1.0 internally because extended
   * thinking is always on. Sending it returns:
   *   `temperature is deprecated for this model`
   *
   * The check is by-name (no API to query capabilities). Add new
   * reasoning models here as Anthropic releases them.
   */
  _modelSupportsTemperature(model) {
    if (typeof model !== 'string') return true;
    // Opus 4.7 and newer have extended thinking baked in — no temperature.
    if (/^claude-opus-4-[7-9]/.test(model)) return false;
    if (/^claude-opus-[5-9]/.test(model))   return false;
    return true;
  }

  _buildBody(request) {
    // Anthropic requires alternating user/assistant. We strip system from
    // messages and pass it as top-level. We also coalesce same-role
    // adjacent messages defensively.
    const system = request.systemPrompt || null;
    const messages = (request.messages || [])
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content }));

    const body = {
      model:      request.model,
      max_tokens: request.options?.max_tokens ?? 4096,
      messages,
      stream:     !!request.options?.stream,
    };
    if (system) body.system = system;
    if (request.options?.temperature != null && this._modelSupportsTemperature(request.model)) {
      body.temperature = request.options.temperature;
    }
    if (Array.isArray(request.options?.tools) && request.options.tools.length > 0) {
      // Translate openai-style {type:'function', function:{name,description,parameters}}
      // into anthropic shape {name, description, input_schema}.
      body.tools = request.options.tools.map(t => {
        const fn = t.function || t;
        return {
          name:         fn.name,
          description:  fn.description,
          input_schema: fn.parameters || fn.input_schema || { type: 'object', properties: {} },
        };
      });
    }
    return body;
  }

  _headers(apiKey) {
    return {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey || this.config.apiKey || '',
      'anthropic-version': ANTHROPIC_VERSION,
      'Accept':            'application/json',
    };
  }

  async sendMessage(request) {
    const url = `${this.baseUrl}/v1/messages`;
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
    const url = `${this.baseUrl}/v1/messages`;
    const body = this._buildBody({ ...request, options: { ...(request.options || {}), stream: true } });
    const res = await this._fetchWithTimeout(url, {
      method:  'POST',
      headers: { ...this._headers(request.apiKey), 'Accept': 'text/event-stream' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) throw await this._httpError(res, this.id);

    const final = await this._parseSSEStream(res.body, handlers, request.model);
    handlers.onDone?.(final);
    return final;
  }

  async _parseSSEStream(stream, handlers, fallbackModel) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';
    let content = '';
    let reasoning = '';
    let usage = null;
    let model = fallbackModel;
    let stopReason = 'stop';
    // toolCalls tracked by content_block index
    const toolCalls = new Map(); // idx -> { id, name, arguments }

    const processEvent = (raw) => {
      const line = raw.trim();
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data) return;
      let evt;
      try { evt = JSON.parse(data); } catch { return; }

      if (evt.type === 'message_start') {
        if (evt.message?.model) model = evt.message.model;
        if (evt.message?.usage) usage = { ...(usage || {}), ...evt.message.usage };
        return;
      }
      if (evt.type === 'content_block_start') {
        const idx = evt.index;
        const block = evt.content_block;
        if (block?.type === 'tool_use') {
          toolCalls.set(idx, { id: block.id || `call_${idx}`, name: block.name || '', arguments: '' });
        }
        return;
      }
      if (evt.type === 'content_block_delta') {
        const idx = evt.index;
        const d = evt.delta;
        if (d?.type === 'text_delta' && d.text) {
          content += d.text;
          handlers.onChunk?.(d.text);
        } else if (d?.type === 'thinking_delta' && d.thinking) {
          reasoning += d.thinking;
          handlers.onReasoningChunk?.(d.thinking);
        } else if (d?.type === 'input_json_delta' && d.partial_json && toolCalls.has(idx)) {
          toolCalls.get(idx).arguments += d.partial_json;
        }
        return;
      }
      if (evt.type === 'message_delta') {
        if (evt.delta?.stop_reason) stopReason = this._mapStopReason(evt.delta.stop_reason);
        if (evt.usage) usage = { ...(usage || {}), ...evt.usage };
        return;
      }
      if (evt.type === 'error') {
        const err = new Error(evt.error?.message || 'Anthropic stream error');
        err.code = evt.error?.type;
        throw err;
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
      reasoningTokens: null, // Anthropic doesn't surface reasoning token count
      usage:           this._normalizeUsage(usage),
      model,
      finishReason:    stopReason,
      toolCalls:       toolCalls.size > 0 ? Array.from(toolCalls.values()) : undefined,
    };
  }

  _fromNonStreamingResponse(data, fallbackModel) {
    let content = '';
    let reasoning = '';
    const toolCalls = [];
    for (const block of (data.content || [])) {
      if (block.type === 'text') content += block.text || '';
      else if (block.type === 'thinking') reasoning += block.thinking || '';
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id:        block.id,
          name:      block.name,
          arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
        });
      }
    }
    return {
      content,
      reasoning,
      reasoningTokens: null,
      usage:           this._normalizeUsage(data.usage),
      model:           data.model || fallbackModel,
      finishReason:    this._mapStopReason(data.stop_reason || 'end_turn'),
      toolCalls:       toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  _mapStopReason(reason) {
    if (reason === 'end_turn') return 'stop';
    if (reason === 'max_tokens') return 'length';
    if (reason === 'tool_use') return 'tool_calls';
    if (reason === 'stop_sequence') return 'stop';
    return reason || 'stop';
  }

  _normalizeUsage(u) {
    if (!u) return null;
    return {
      prompt_tokens:     u.input_tokens,
      completion_tokens: u.output_tokens,
      total_tokens:      (u.input_tokens || 0) + (u.output_tokens || 0),
    };
  }

  async isAvailable() {
    return !!this.config.apiKey;
  }

  async listModels() { return []; /* Anthropic has no public list endpoint; manifest fills these in. */ }
}
