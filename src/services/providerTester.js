/**
 * Provider connection tester.
 *
 * Verifies that a freshly-supplied API key can list models from the
 * provider's REST endpoint. Used by POST /api/providers/test (called by
 * the onboarding wizard) so we never leak keys to a third-party service
 * from the browser, and so CORS quirks per provider don't leak into the
 * frontend.
 *
 * Returns a stable shape:
 *   { ok: true,  models: string[] }
 *   { ok: false, message: string }
 *
 * The caller is responsible for HTTP framing — this module never throws
 * for predictable failures (bad key, network down, 4xx). It only throws
 * for genuinely unexpected programmer errors (e.g. unknown provider id
 * passed in).
 */

const TIMEOUT_MS = 10_000;

const PROVIDER_LABELS = {
  openai:    'OpenAI',
  anthropic: 'Anthropic',
  gemini:    'Gemini',
  xai:       'xAI',
  ollama:    'Ollama',
};

const CLOUD_PROVIDERS = {
  openai: {
    url:     () => 'https://api.openai.com/v1/models',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  xai: {
    url:     () => 'https://api.x.ai/v1/models',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    url: () => 'https://api.anthropic.com/v1/models',
    headers: (key) => ({
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
    }),
  },
  gemini: {
    url:     (key) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    headers: () => ({}),
  },
};

function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function extractModels(body) {
  if (Array.isArray(body?.data)) {
    return body.data.map((m) => m.id || m.name).filter(Boolean);
  }
  if (Array.isArray(body?.models)) {
    // Gemini returns { models: [{ name: "models/gemini-1.5-flash" }] };
    // strip the "models/" prefix so the frontend gets bare ids.
    return body.models.map((m) => (m.name || '').replace(/^models\//, '')).filter(Boolean);
  }
  return [];
}

async function testCloudProvider(provider, apiKey) {
  const config = CLOUD_PROVIDERS[provider];
  if (!config) return { ok: false, message: `Unknown provider: ${provider}` };

  const label = PROVIDER_LABELS[provider] || provider;
  const url = config.url(apiKey);
  const headers = config.headers(apiKey);

  let response;
  try {
    response = await fetchWithTimeout(url, { headers });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, message: `${label} did not respond in time. Try again.` };
    }
    return { ok: false, message: 'We could not reach this provider. Check your network and try again.' };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: `${label} rejected the key. Check the key and try again.` };
    }
    if (response.status === 429) {
      return { ok: false, message: `${label} is rate-limiting this key. Wait a moment and try again.` };
    }
    return { ok: false, message: `${label} responded with ${response.status}.` };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: 'Provider returned an unexpected response.' };
  }
  return { ok: true, models: extractModels(body) };
}

async function testOllama(host) {
  const base = (host || 'http://localhost:11434').replace(/\/+$/, '');
  let response;
  try {
    response = await fetchWithTimeout(`${base}/api/tags`);
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, message: 'Ollama did not respond in time.' };
    }
    return { ok: false, message: 'We could not reach Ollama. Make sure it is running on this machine.' };
  }
  if (!response.ok) {
    return { ok: false, message: `Ollama responded with ${response.status}.` };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: 'Ollama returned an unexpected response.' };
  }
  const models = Array.isArray(body?.models)
    ? body.models.map((m) => m.name).filter(Boolean)
    : [];
  return { ok: true, models };
}

/**
 * @param {{ provider: string, apiKey?: string, host?: string }} params
 * @returns {Promise<{ ok: boolean, models?: string[], message?: string }>}
 */
export async function testProviderConnection({ provider, apiKey, host }) {
  if (!provider || typeof provider !== 'string') {
    return { ok: false, message: 'Provider is required.' };
  }
  if (provider === 'ollama') {
    return testOllama(host);
  }
  if (!CLOUD_PROVIDERS[provider]) {
    return { ok: false, message: `Unknown provider: ${provider}` };
  }
  const trimmed = (apiKey || '').trim();
  if (!trimmed) {
    return { ok: false, message: 'Enter an API key first.' };
  }
  return testCloudProvider(provider, trimmed);
}
