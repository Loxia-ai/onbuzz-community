/**
 * BaseProvider — contract every LLM provider adapter implements.
 *
 * Providers translate the OnBuzz-internal request shape into a vendor's
 * native HTTP API and stream the response back through the canonical
 * AIService callbacks. Each adapter owns one vendor's auth, request
 * shaping, SSE parsing, tool-call format, and reasoning-token surfacing.
 *
 * Canonical request shape (passed in `request`):
 *   {
 *     model:        string,                 // model id understood by the provider
 *     messages:     Array<{role, content}>, // chat history (role: system|user|assistant|tool)
 *     systemPrompt: string?,                // optional, hoisted to system message
 *     options: {
 *       max_tokens:  number?,
 *       temperature: number?,
 *       stream:      boolean,
 *       tools:       Array<openai-style tool schema>?
 *     },
 *     metadata:     { requestId, agentId },
 *     apiKey:       string                  // vendor key
 *   }
 *
 * Canonical streaming callbacks (passed in `streamHandlers`):
 *   {
 *     onChunk:          (text) => void,           // text chunk
 *     onReasoningChunk: (text) => void,           // reasoning text chunk (optional)
 *     onDone:           (final) => void,          // final response object
 *     onError:          (Error) => void
 *   }
 *
 * Canonical final response shape (returned from sendMessageStream/sendMessage,
 * also passed to onDone):
 *   {
 *     content:         string,
 *     reasoning:       string,                       // empty if not surfaced
 *     reasoningTokens: number|null,
 *     usage:           { prompt_tokens, completion_tokens, total_tokens }|null,
 *     model:           string,                       // echoed from provider
 *     finishReason:    'stop'|'length'|'tool_calls'|'error',
 *     toolCalls:       Array<{id, name, arguments}>? // when the model emitted tool calls
 *   }
 *
 * Thrown errors should be plain Error subclasses with `.status` (HTTP code)
 * and `.code` (vendor-or-internal error code) set when known.
 */

export default class BaseProvider {
  /**
   * @param {object} config - { apiKey, baseUrl?, timeout?, ...providerSpecific }
   * @param {object} logger
   */
  constructor(config = {}, logger = console) {
    this.config  = config;
    this.logger  = logger;
    this.timeout = config.timeout || 270_000;
  }

  /** Provider id, e.g. 'openai' / 'anthropic' / 'gemini' / 'xai' / 'ollama'. */
  get id() { throw new Error('BaseProvider.id must be overridden'); }

  /** Human-readable provider name. */
  get displayName() { return this.id; }

  /**
   * Match a model name against this provider. Used by the dispatcher to
   * route a request without an explicit `provider` field.
   * @param {string} model
   * @returns {boolean}
   */
  matchesModel(_model) { return false; }

  /**
   * Make a single non-streaming chat request.
   * @param {object} request
   * @returns {Promise<object>} canonical final response
   */
  async sendMessage(_request) {
    throw new Error(`${this.id}: sendMessage not implemented`);
  }

  /**
   * Make a streaming chat request. Calls onChunk/onReasoningChunk/onDone/onError
   * as data arrives. Resolves with the final canonical response when the
   * stream completes (or the same object as passed to onDone).
   * @param {object} request
   * @param {object} streamHandlers
   * @returns {Promise<object>} canonical final response
   */
  async sendMessageStream(_request, _streamHandlers) {
    throw new Error(`${this.id}: sendMessageStream not implemented`);
  }

  /**
   * List models this provider can serve. Used to populate the unified
   * model catalog. Returns canonical model shape:
   *   { name, displayName, provider, contextWindow, supportsTools, supportsVision }
   * @returns {Promise<Array<object>>}
   */
  async listModels() { return []; }

  /**
   * Quick reachability check. Default impl returns true.
   * @returns {Promise<boolean>}
   */
  async isAvailable() { return true; }

  // ---------- Helpers shared across HTTP-based providers ----------

  /**
   * Run fetch with an AbortController-driven timeout. Caller handles JSON.
   * @protected
   */
  async _fetchWithTimeout(url, options = {}, timeoutMs = this.timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Common error shape: throw an Error with .status and .body for callers
   * to inspect. Used by all HTTP providers on non-2xx.
   * @protected
   */
  async _httpError(response, providerName = this.id) {
    let body = '';
    try { body = await response.text(); } catch { /* ignore */ }
    const err = new Error(`${providerName} HTTP ${response.status}: ${response.statusText}${body ? ` — ${body.slice(0, 500)}` : ''}`);
    err.status = response.status;
    err.body   = body;
    return err;
  }
}
