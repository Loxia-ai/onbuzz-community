/**
 * Provider catalogue for the first-run onboarding flow.
 *
 * Each entry has just enough metadata for the wizard to:
 *   - render a tile (label, blurb, cost hint)
 *   - validate a key by calling the provider's `/v1/models` endpoint
 *     directly from the browser
 *   - pick a sensible default model when creating the first agent
 *
 * Cloud providers all support browser-side CORS for `/v1/models` (Anthropic
 * needs an extra opt-in header). Ollama is local — we hit the user's daemon
 * on localhost:11434 by default.
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
 * Test a cloud-provider key by listing models. Returns
 *   { ok: true, models: [...] }   on success
 *   { ok: false, message: '...' } on a meaningful failure
 *
 * Network errors (fetch threw) are surfaced with a friendly message rather
 * than the raw browser error so the wizard can show useful copy.
 */
export async function testCloudProvider(providerId, apiKey) {
  const key = (apiKey || '').trim();
  if (!key) return { ok: false, message: 'Enter an API key first.' };

  try {
    if (providerId === 'openai') {
      return await fetchOpenAICompatible('https://api.openai.com/v1/models', key);
    }
    if (providerId === 'xai') {
      return await fetchOpenAICompatible('https://api.x.ai/v1/models', key);
    }
    if (providerId === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      return parseModelsResponse(res, 'Anthropic');
    }
    if (providerId === 'gemini') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      );
      const parsed = await parseModelsResponse(res, 'Gemini');
      // Gemini wraps models in { models: [{ name: 'models/gemini-...' }] }
      if (parsed.ok && Array.isArray(parsed.models)) {
        parsed.models = parsed.models.map((m) => (m.name || '').replace(/^models\//, ''));
      }
      return parsed;
    }
    return { ok: false, message: `Unknown provider: ${providerId}` };
  } catch (err) {
    return {
      ok: false,
      message: 'We could not reach this provider. Check your network and try again.',
      error: err?.message,
    };
  }
}

async function fetchOpenAICompatible(url, key) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return parseModelsResponse(res, 'Provider');
}

async function parseModelsResponse(res, providerLabel) {
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `${providerLabel} rejected the key. Check the key and try again.` };
    }
    if (res.status === 429) {
      return { ok: false, message: `${providerLabel} is rate-limiting this key. Wait a moment and try again.` };
    }
    return { ok: false, message: `${providerLabel} responded with ${res.status}.` };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, message: 'Provider returned an unexpected response.' };
  }
  // OpenAI / xAI shape: { data: [{ id }] }
  // Anthropic shape:    { data: [{ id }] }
  // Gemini shape:       { models: [{ name }] }
  const models = Array.isArray(body?.data)
    ? body.data.map((m) => m.id || m.name).filter(Boolean)
    : Array.isArray(body?.models)
      ? body.models
      : [];
  return { ok: true, models };
}

/**
 * Test the local Ollama daemon at the given host. Returns
 *   { ok: true, models: ['llama3.1', ...] }   when reachable
 *   { ok: false, message: '...' }             otherwise
 *
 * Used by the Ollama branch of step 2 — no API key needed.
 */
export async function testOllama(host) {
  const base = (host || 'http://localhost:11434').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) {
      return { ok: false, message: `Ollama responded with ${res.status}.` };
    }
    const body = await res.json();
    const models = Array.isArray(body?.models) ? body.models.map((m) => m.name).filter(Boolean) : [];
    return { ok: true, models };
  } catch {
    return {
      ok: false,
      message: 'We could not reach Ollama. Make sure it is running on this machine.',
    };
  }
}

/**
 * Pick a default model for a cloud provider given the list of models the
 * provider returned. Falls back through fallbackModelHints (substring match)
 * so renames/version bumps still resolve, then to the provider's
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
