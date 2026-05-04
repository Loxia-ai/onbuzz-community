/**
 * Provider catalogue for the first-run onboarding flow.
 *
 * Each entry has just enough metadata for the wizard to:
 *   - render a tile (label, blurb, cost hint)
 *   - pick a sensible default model when creating the first agent
 *
 * The actual connection test now lives on the backend at
 * POST /api/providers/test (see services/providerTester.js). Keeping the
 * provider list here means the wizard can render and select without
 * waiting on a network call.
 */

export const PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT models for general assistance, coding, and reasoning.',
    placeholder: 'sk-...',
    costHint: 'Paid by token',
    cloud: true,
    // Friendly default — modern, balanced, widely available on most accounts.
    defaultModel: 'gpt-4o-mini',
    fallbackModelHints: ['gpt-4o-mini', 'gpt-4o', 'gpt-4', 'gpt-3.5'],
    keyHelpUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models — strong reasoning and writing.',
    placeholder: 'sk-ant-...',
    costHint: 'Paid by token',
    cloud: true,
    defaultModel: 'claude-3-5-haiku-latest',
    fallbackModelHints: ['claude-3-5-haiku', 'claude-3-haiku', 'claude-3-5-sonnet', 'claude'],
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'Gemini models with long context windows.',
    placeholder: 'AIza...',
    costHint: 'Paid by token',
    cloud: true,
    defaultModel: 'gemini-1.5-flash',
    fallbackModelHints: ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5', 'gemini'],
    keyHelpUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'xai',
    label: 'xAI',
    description: 'Grok models from xAI.',
    placeholder: 'xai-...',
    costHint: 'Paid by token',
    cloud: true,
    defaultModel: 'grok-2-mini',
    fallbackModelHints: ['grok-2-mini', 'grok-2', 'grok'],
    keyHelpUrl: 'https://console.x.ai/',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    description: 'Run open-source models locally on this machine.',
    placeholder: '',
    costHint: 'Local & free',
    cloud: false,
    defaultModel: null,
    fallbackModelHints: [],
    keyHelpUrl: 'https://ollama.com/download',
  },
];

export const getProvider = (id) => PROVIDERS.find((p) => p.id === id);

/**
 * Pick a default model for a cloud provider given the list of models the
 * provider returned. Falls back through fallbackModelHints (substring
 * match) so renames/version bumps still resolve, then to the provider's
 * defaultModel string, then to the first available model.
 */
export function pickDefaultModel(providerId, availableModels) {
  const provider = getProvider(providerId);
  if (!provider) return null;
  const list = Array.isArray(availableModels) ? availableModels : [];
  for (const hint of provider.fallbackModelHints || []) {
    const needle = hint.toLowerCase();
    const match = list.find((m) => (m || '').toLowerCase().includes(needle));
    if (match) return match;
  }
  if (provider.defaultModel && list.some((m) => m === provider.defaultModel)) {
    return provider.defaultModel;
  }
  return list[0] || provider.defaultModel || null;
}
