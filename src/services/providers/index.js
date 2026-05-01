/**
 * Provider registry + dispatcher.
 *
 * The registry holds one instance per supported provider, keyed by id.
 * Each instance is configured at construction time with the user's
 * vendor-specific key (or local Ollama host). Resolution order for a
 * request:
 *   1. If the request carries an explicit `provider` field, use that.
 *   2. Else, scan registered providers and pick the first whose
 *      `matchesModel(model)` returns true.
 *   3. Else, fall back to the configured `defaultProvider` (typically
 *      OpenAI for cloud-like models).
 *
 * The registry is a thin convenience layer; consumers can also construct
 * provider instances directly and call them.
 */

import BaseProvider     from './baseProvider.js';
import OllamaProvider    from './ollamaProvider.js';
import OpenAIProvider    from './openaiProvider.js';
import AnthropicProvider from './anthropicProvider.js';
import GeminiProvider    from './geminiProvider.js';
import XAIProvider       from './xaiProvider.js';

export const PROVIDER_IDS = Object.freeze({
  ollama:    'ollama',
  openai:    'openai',
  anthropic: 'anthropic',
  gemini:    'gemini',
  xai:       'xai',
});

/**
 * Provider registry. Construct with the user's resolved keys/hosts.
 *
 * @example
 *   const registry = new ProviderRegistry({
 *     openai:    { apiKey: 'sk-…' },
 *     anthropic: { apiKey: 'sk-ant-…' },
 *     gemini:    { apiKey: '…' },
 *     xai:       { apiKey: 'xai-…' },
 *     ollama:    { ollamaHost: 'http://127.0.0.1:11434' },
 *     customEndpoints: [
 *       { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-…' }
 *     ],
 *     defaultProvider: 'openai',
 *   }, logger);
 */
export class ProviderRegistry {
  constructor(config = {}, logger = console) {
    this.logger = logger;
    this.config = config;
    this.providers = new Map();
    this.defaultProvider = config.defaultProvider || null;

    // Always register Ollama (local, free, no key needed)
    this.register(new OllamaProvider(config.ollama || {}, logger));

    // Cloud providers — registered regardless of key presence so the
    // dispatcher can match by model prefix even when the user hasn't
    // entered a key yet (the actual call will then 401 with a clear
    // error message instead of "no provider matched").
    this.register(new OpenAIProvider(config.openai || {}, logger));
    this.register(new AnthropicProvider(config.anthropic || {}, logger));
    this.register(new GeminiProvider(config.gemini || {}, logger));
    this.register(new XAIProvider(config.xai || {}, logger));

    // Custom OpenAI-compatible endpoints (OpenRouter, Together, etc.)
    for (const ep of (config.customEndpoints || [])) {
      const id = ep.id || `custom-${this.providers.size}`;
      const provider = new OpenAIProvider({
        apiKey:      ep.apiKey,
        baseUrl:     ep.baseUrl,
        displayName: ep.name || id,
      }, logger);
      // Override id so it's distinguishable from the OpenAI default.
      Object.defineProperty(provider, 'id', { value: id, configurable: true });
      this.register(provider);
    }
  }

  register(provider) {
    if (!provider || !provider.id) throw new Error('Provider must have an id');
    this.providers.set(provider.id, provider);
  }

  get(id) { return this.providers.get(id); }
  has(id) { return this.providers.has(id); }
  list()  { return Array.from(this.providers.values()); }

  /**
   * Resolve a provider for a request.
   * @param {object} request - { provider?, model }
   * @returns {BaseProvider}
   */
  resolve(request) {
    if (request.provider && this.providers.has(request.provider)) {
      return this.providers.get(request.provider);
    }
    for (const p of this.providers.values()) {
      try {
        if (p.matchesModel(request.model)) return p;
      } catch { /* skip broken matchers */ }
    }
    if (this.defaultProvider && this.providers.has(this.defaultProvider)) {
      return this.providers.get(this.defaultProvider);
    }
    throw new Error(
      `No provider matched model "${request.model}". ` +
      `Configure a provider key in Settings, or pass an explicit \`provider\` field.`
    );
  }

  /**
   * Aggregate models across all providers. Skips providers that aren't
   * available (no key, daemon offline). Failures from one provider don't
   * fail the aggregate.
   */
  async listAllModels() {
    const out = [];
    for (const p of this.providers.values()) {
      try {
        const models = await p.listModels();
        for (const m of models) out.push(m);
      } catch (e) {
        this.logger?.debug?.(`listModels failed for ${p.id}`, { error: e.message });
      }
    }
    return out;
  }
}

export {
  BaseProvider,
  OllamaProvider,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  XAIProvider,
};
