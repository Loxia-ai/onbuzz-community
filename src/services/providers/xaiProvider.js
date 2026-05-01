/**
 * xAI provider — extends OpenAIProvider since the xAI API is
 * OpenAI-compatible at api.x.ai/v1.
 *
 * The only deltas from the OpenAI adapter are:
 *   - Default baseUrl points at api.x.ai/v1
 *   - matchesModel routes Grok models (grok-*) here
 *   - displayName is "xAI"
 *
 * Reasoning tokens for Grok-reasoning variants are surfaced via the same
 * `usage.completion_tokens_details.reasoning_tokens` field (same as
 * OpenAI o-series) so no extra translation is needed.
 */

import OpenAIProvider from './openaiProvider.js';

const DEFAULT_BASE_URL = 'https://api.x.ai/v1';

export default class XAIProvider extends OpenAIProvider {
  constructor(config = {}, logger = console) {
    super({ ...config, baseUrl: config.baseUrl || DEFAULT_BASE_URL }, logger);
  }

  get id() { return 'xai'; }
  get displayName() { return 'xAI'; }

  matchesModel(model) {
    return typeof model === 'string' && model.startsWith('grok-');
  }
}
