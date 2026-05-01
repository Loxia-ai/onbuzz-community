/**
 * Google Gemini provider — generativelanguage.googleapis.com.
 *
 * Wire format: `/v1beta/models/{model}:generateContent` (sync) or
 * `:streamGenerateContent?alt=sse` (streaming SSE). Auth via `?key=`
 * query param OR `x-goog-api-key` header.
 *
 * Translation specifics:
 *   - Roles map: `assistant` → `model`; `user` stays `user`; `system`
 *     hoisted to top-level `systemInstruction.parts[].text`.
 *   - Content shape is `parts: [{text}]` not a single string.
 *   - Tools: `tools: [{functionDeclarations: [{name, description, parameters}]}]`.
 *     Tool calls come back as `parts: [{functionCall: {name, args}}]`.
 *   - Reasoning ("thinking") tokens: in v1beta, available via
 *     `usageMetadata.thoughtsTokenCount` for thinking-capable models.
 */

import BaseProvider from './baseProvider.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

export default class GeminiProvider extends BaseProvider {
  constructor(config = {}, logger = console) {
    super(config, logger);
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  get id() { return 'gemini'; }
  get displayName() { return 'Google Gemini'; }

  matchesModel(model) {
    if (typeof model !== 'string') return false;
    // Google's Generative Language API serves both Gemini and Gemma
    // models on the same `/v1beta/models/{model}:generateContent`
    // endpoint, so route both prefixes here.
    return model.startsWith('gemini-')        || model.startsWith('models/gemini-')
        || model.startsWith('gemma-')         || model.startsWith('models/gemma-');
  }

  _normalizeModel(model) {
    return model.startsWith('models/') ? model.slice('models/'.length) : model;
  }

  _buildBody(request) {
    const contents = [];
    let systemInstruction = null;

    if (request.systemPrompt) {
      systemInstruction = { parts: [{ text: request.systemPrompt }] };
    }

    for (const m of (request.messages || [])) {
      if (m.role === 'system') {
        const txt = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        systemInstruction = systemInstruction || { parts: [] };
        systemInstruction.parts.push({ text: txt });
        continue;
      }
      const role = m.role === 'assistant' ? 'model' : 'user';
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      contents.push({ role, parts: [{ text }] });
    }

    const body = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    const cfg = {};
    if (request.options?.max_tokens   != null) cfg.maxOutputTokens = request.options.max_tokens;
    if (request.options?.temperature  != null) cfg.temperature     = request.options.temperature;
    if (Object.keys(cfg).length) body.generationConfig = cfg;

    if (Array.isArray(request.options?.tools) && request.options.tools.length > 0) {
      const decls = request.options.tools.map(t => {
        const fn = t.function || t;
        return {
          name:        fn.name,
          description: fn.description,
          parameters:  fn.parameters || fn.input_schema || { type: 'object', properties: {} },
        };
      });
      body.tools = [{ functionDeclarations: decls }];
    }

    return body;
  }

  _headers(apiKey) {
    return {
      'Content-Type':   'application/json',
      'x-goog-api-key': apiKey || this.config.apiKey || '',
    };
  }

  async sendMessage(request) {
    const model = this._normalizeModel(request.model);
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await this._fetchWithTimeout(url, {
      method:  'POST',
      headers: this._headers(request.apiKey),
      body:    JSON.stringify(this._buildBody(request)),
    });
    if (!res.ok) throw await this._httpError(res, this.id);
    const data = await res.json();
    return this._fromNonStreamingResponse(data, request.model);
  }

  async sendMessageStream(request, handlers = {}) {
    const model = this._normalizeModel(request.model);
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const res = await this._fetchWithTimeout(url, {
      method:  'POST',
      headers: { ...this._headers(request.apiKey), 'Accept': 'text/event-stream' },
      body:    JSON.stringify(this._buildBody(request)),
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
    let usageMetadata = null;
    let model = fallbackModel;
    let finishReason = 'stop';
    const toolCalls = [];

    const processEvent = (raw) => {
      const line = raw.trim();
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data) return;
      let evt;
      try { evt = JSON.parse(data); } catch { return; }

      if (evt.usageMetadata) usageMetadata = evt.usageMetadata;
      if (evt.modelVersion) model = evt.modelVersion;

      const cand = evt.candidates?.[0];
      if (!cand) return;
      if (cand.finishReason) finishReason = this._mapFinishReason(cand.finishReason);

      for (const part of (cand.content?.parts || [])) {
        if (part.thought === true && typeof part.text === 'string' && part.text) {
          reasoning += part.text;
          handlers.onReasoningChunk?.(part.text);
        } else if (typeof part.text === 'string' && part.text) {
          content += part.text;
          handlers.onChunk?.(part.text);
        } else if (part.functionCall) {
          toolCalls.push({
            id:        `call_${toolCalls.length}`,
            name:      part.functionCall.name,
            arguments: typeof part.functionCall.args === 'string'
                         ? part.functionCall.args
                         : JSON.stringify(part.functionCall.args || {}),
          });
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
      reasoningTokens: usageMetadata?.thoughtsTokenCount ?? null,
      usage:           this._normalizeUsage(usageMetadata),
      model,
      finishReason,
      toolCalls:       toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  _fromNonStreamingResponse(data, fallbackModel) {
    let content = '';
    let reasoning = '';
    const toolCalls = [];
    const cand = data.candidates?.[0];
    for (const part of (cand?.content?.parts || [])) {
      if (part.thought === true && typeof part.text === 'string') reasoning += part.text;
      else if (typeof part.text === 'string') content += part.text;
      else if (part.functionCall) {
        toolCalls.push({
          id:        `call_${toolCalls.length}`,
          name:      part.functionCall.name,
          arguments: typeof part.functionCall.args === 'string'
                       ? part.functionCall.args
                       : JSON.stringify(part.functionCall.args || {}),
        });
      }
    }
    return {
      content,
      reasoning,
      reasoningTokens: data.usageMetadata?.thoughtsTokenCount ?? null,
      usage:           this._normalizeUsage(data.usageMetadata),
      model:           data.modelVersion || fallbackModel,
      finishReason:    this._mapFinishReason(cand?.finishReason || 'STOP'),
      toolCalls:       toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  _mapFinishReason(r) {
    if (r === 'STOP' || r === 'END_TURN') return 'stop';
    if (r === 'MAX_TOKENS') return 'length';
    if (r === 'SAFETY' || r === 'RECITATION') return 'content_filter';
    return (r || 'stop').toLowerCase();
  }

  _normalizeUsage(u) {
    if (!u) return null;
    return {
      prompt_tokens:     u.promptTokenCount,
      completion_tokens: u.candidatesTokenCount,
      total_tokens:      u.totalTokenCount,
    };
  }

  async isAvailable() { return !!this.config.apiKey; }

  /**
   * Classify a Google Gen-Lang model by chat-completion suitability.
   * The `/v1beta/models` list mixes Gemini chat models with TTS,
   * image generation, audio (Lyria), robotics, computer-use, etc.
   * We tag chat=true for entries that:
   *   - support `generateContent` AND
   *   - aren't named for a non-chat modality (tts, image, audio, robotics…)
   */
  static _classifyGeminiModel(id) {
    if (typeof id !== 'string') return { chat: false };
    const NON_CHAT = [
      /\btts\b/i, /-tts(-|$)/i,
      /\bimage\b/i, /\bnano-banana\b/i,
      /\blyria\b/i,
      /\brobotics\b/i,
      /\bcomputer-use\b/i,
      /\bdeep-research\b/i,
    ];
    if (NON_CHAT.some(re => re.test(id))) return { chat: false };
    return {
      chat:           true,
      supportsTools:  true,
      // 2.x and 3.x have native vision; 1.5 had it; gemma is text-only.
      supportsVision: /^gemini-/.test(id) && !/^gemma-/.test(id),
    };
  }

  async listModels() {
    if (!this.config.apiKey) return [];
    try {
      const res = await this._fetchWithTimeout(`${this.baseUrl}/v1beta/models`, {
        headers: this._headers(this.config.apiKey),
      }, 10_000);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || [])
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => {
          const name = this._normalizeModel(m.name);
          const c = GeminiProvider._classifyGeminiModel(name);
          return {
            name,
            displayName:    m.displayName || name,
            provider:       this.id,
            contextWindow:  m.inputTokenLimit || null,
            supportsTools:  c.supportsTools !== false,
            supportsVision: !!c.supportsVision,
            chat:           c.chat,
          };
        });
    } catch (e) {
      this.logger?.debug?.('gemini listModels failed', { error: e.message });
      return [];
    }
  }
}
