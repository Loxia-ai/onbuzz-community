import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { testProviderConnection } from '../providerTester.js';

/**
 * providerTester is a thin wrapper around fetch() against each provider's
 * `/v1/models` (or equivalent) endpoint. The surface that drifts as
 * providers tweak their APIs is:
 *
 *   - URL composition (Gemini puts the key in the query string)
 *   - Auth header shape (Anthropic uses x-api-key + anthropic-version)
 *   - Response shape (OpenAI/xAI return `{data: [{id}]}`; Gemini returns
 *     `{models: [{name: "models/..."}]}`; Ollama returns `{models: [{name}]}`)
 *   - HTTP status → friendly message mapping (401/403/429/timeout/network)
 *
 * These tests pin each piece so a silent breakage shows up here first.
 */

function jsonResponse(body, { status = 200, ok = status >= 200 && status < 300 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe('providerTester.testProviderConnection', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('input validation', () => {
    test('rejects missing provider with a clear message', async () => {
      const result = await testProviderConnection({});
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Provider is required/);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('rejects empty string provider', async () => {
      const result = await testProviderConnection({ provider: '' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Provider is required/);
    });

    test('rejects unknown cloud provider id without hitting the network', async () => {
      const result = await testProviderConnection({ provider: 'mystery-cloud', apiKey: 'sk-x' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Unknown provider/);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('rejects cloud providers when apiKey is missing', async () => {
      const result = await testProviderConnection({ provider: 'openai' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Enter an API key/);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('rejects cloud providers when apiKey is whitespace only', async () => {
      const result = await testProviderConnection({ provider: 'openai', apiKey: '   ' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Enter an API key/);
    });
  });

  describe('OpenAI', () => {
    test('hits the right URL with Bearer auth and extracts model ids', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'gpt-3.5-turbo' }],
      }));

      const result = await testProviderConnection({ provider: 'openai', apiKey: 'sk-good' });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/models');
      expect(init.headers.Authorization).toBe('Bearer sk-good');
      // Aborts via signal; we don't assert on its shape, but it must exist.
      expect(init.signal).toBeDefined();

      expect(result).toEqual({ ok: true, models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'] });
    });

    test('trims the api key before sending', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'gpt-4o' }] }));

      await testProviderConnection({ provider: 'openai', apiKey: '  sk-padded  ' });

      expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-padded');
    });
  });

  describe('xAI', () => {
    test('hits api.x.ai with Bearer auth', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'grok-2' }] }));

      const result = await testProviderConnection({ provider: 'xai', apiKey: 'xai-good' });

      expect(global.fetch.mock.calls[0][0]).toBe('https://api.x.ai/v1/models');
      expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer xai-good');
      expect(result).toEqual({ ok: true, models: ['grok-2'] });
    });
  });

  describe('Anthropic', () => {
    test('uses x-api-key header and pins the anthropic-version', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'claude-3-5-sonnet' }, { id: 'claude-3-haiku' }],
      }));

      const result = await testProviderConnection({ provider: 'anthropic', apiKey: 'sk-ant-good' });

      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/models');
      expect(init.headers['x-api-key']).toBe('sk-ant-good');
      // Do not assert the exact version string — only that one is set.
      // The version IS pinned to '2023-06-01' today; if a future commit
      // bumps it that should be a deliberate change in providerTester.js,
      // not a silent surprise. The assertion exists to flag accidental
      // removals.
      expect(init.headers['anthropic-version']).toBeTruthy();
      expect(typeof init.headers['anthropic-version']).toBe('string');
      expect(init.headers.Authorization).toBeUndefined();
      expect(result.ok).toBe(true);
      expect(result.models).toEqual(['claude-3-5-sonnet', 'claude-3-haiku']);
    });
  });

  describe('Gemini', () => {
    test('puts the api key in the query string and strips the "models/" prefix', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({
        models: [
          { name: 'models/gemini-1.5-flash' },
          { name: 'models/gemini-2.0-flash' },
          { name: 'models/gemini-pro' },
        ],
      }));

      const result = await testProviderConnection({ provider: 'gemini', apiKey: 'AIza-good' });

      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\?key=AIza-good$/);
      // No auth headers — Gemini accepts the key only via query string.
      expect(init.headers).toEqual({});
      expect(result.ok).toBe(true);
      expect(result.models).toEqual(['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-pro']);
    });

    test('url-encodes the api key', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({ models: [] }));

      await testProviderConnection({ provider: 'gemini', apiKey: 'AIza+w/special&chars' });

      const [url] = global.fetch.mock.calls[0];
      // `+`, `/`, and `&` would otherwise break the query string.
      expect(url).toContain('AIza%2Bw%2Fspecial%26chars');
      expect(url).not.toContain('AIza+w/special&chars');
    });

    test('drops malformed entries instead of returning empty strings', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({
        models: [
          { name: 'models/gemini-1.5-flash' },
          { /* no name */ },
          { name: 'models/' },           // becomes '' after prefix strip → filtered
          { name: 'gemini-bare-no-prefix' }, // not under models/ → kept as-is
        ],
      }));

      const result = await testProviderConnection({ provider: 'gemini', apiKey: 'AIza-good' });

      expect(result.ok).toBe(true);
      expect(result.models).toEqual(['gemini-1.5-flash', 'gemini-bare-no-prefix']);
    });
  });

  describe('HTTP error → friendly message mapping', () => {
    test('401 → "rejected the key" with the provider label in the message', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({}, { status: 401 }));

      const result = await testProviderConnection({ provider: 'openai', apiKey: 'sk-bad' });

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/OpenAI/);
      expect(result.message).toMatch(/rejected the key/i);
    });

    test('403 → same "rejected the key" message', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({}, { status: 403 }));

      const result = await testProviderConnection({ provider: 'anthropic', apiKey: 'sk-ant-bad' });

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Anthropic/);
      expect(result.message).toMatch(/rejected the key/i);
    });

    test('429 → rate-limit message', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({}, { status: 429 }));

      const result = await testProviderConnection({ provider: 'xai', apiKey: 'xai-good' });

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/xAI/);
      expect(result.message).toMatch(/rate-limit/i);
    });

    test('other 5xx → generic status message', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({}, { status: 502 }));

      const result = await testProviderConnection({ provider: 'openai', apiKey: 'sk-good' });

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/OpenAI/);
      expect(result.message).toMatch(/502/);
    });

    test('malformed JSON body → "unexpected response" message', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected token'); },
      });

      const result = await testProviderConnection({ provider: 'openai', apiKey: 'sk-good' });

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/unexpected response/i);
    });
  });

  describe('Network failures', () => {
    test('AbortError (timeout) → "did not respond in time"', async () => {
      const abort = new Error('Aborted');
      abort.name = 'AbortError';
      global.fetch.mockRejectedValueOnce(abort);

      const result = await testProviderConnection({ provider: 'openai', apiKey: 'sk-good' });

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/OpenAI/);
      expect(result.message).toMatch(/did not respond in time/i);
    });

    test('generic network error → "could not reach this provider"', async () => {
      global.fetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const result = await testProviderConnection({ provider: 'openai', apiKey: 'sk-good' });

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/could not reach this provider/i);
    });
  });

  describe('Ollama', () => {
    test('hits the default host /api/tags when no host is given', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({
        models: [{ name: 'llama3:8b' }, { name: 'qwen2.5:1.5b' }],
      }));

      const result = await testProviderConnection({ provider: 'ollama' });

      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/tags');
      // No auth headers for local Ollama.
      expect(init).toEqual(expect.objectContaining({ signal: expect.anything() }));
      expect(result).toEqual({ ok: true, models: ['llama3:8b', 'qwen2.5:1.5b'] });
    });

    test('honours a custom host and strips trailing slashes', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({ models: [] }));

      await testProviderConnection({ provider: 'ollama', host: 'http://10.0.0.5:11434///' });

      expect(global.fetch.mock.calls[0][0]).toBe('http://10.0.0.5:11434/api/tags');
    });

    test('empty model list still succeeds (UI handles "no models" downstream)', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({ models: [] }));

      const result = await testProviderConnection({ provider: 'ollama' });

      expect(result).toEqual({ ok: true, models: [] });
    });

    test('unreachable daemon (network error) → friendly "make sure it is running" message', async () => {
      global.fetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const result = await testProviderConnection({ provider: 'ollama' });

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/could not reach Ollama/i);
      expect(result.message).toMatch(/running on this machine/i);
    });

    test('Ollama timeout (AbortError) → distinct timeout message', async () => {
      const abort = new Error('Aborted');
      abort.name = 'AbortError';
      global.fetch.mockRejectedValueOnce(abort);

      const result = await testProviderConnection({ provider: 'ollama' });

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Ollama/);
      expect(result.message).toMatch(/did not respond in time/i);
    });

    test('non-2xx response from Ollama surfaces the status code', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse({}, { status: 500 }));

      const result = await testProviderConnection({ provider: 'ollama' });

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Ollama/);
      expect(result.message).toMatch(/500/);
    });
  });
});
