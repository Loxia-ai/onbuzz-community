import React, { useEffect, useRef, useState } from 'react';
import {
  EyeIcon,
  EyeSlashIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../services/api.js';
import { useAppStore } from '../../stores/appStore.js';
import LoadingSpinner from '../LoadingSpinner.jsx';
import { getProvider } from './providers.js';

const SETTINGS_STORAGE_KEY = 'loxia-settings';
const OLLAMA_SETTINGS_KEY = 'loxia-ollama-settings';

/**
 * Step 2 — collect and verify the connection for the chosen provider.
 *
 * Cloud providers: input field + "Test connection" that calls the backend
 * (POST /api/providers/test) which in turn hits the provider's models
 * endpoint server-side. Successful tests persist the key locally
 * (loxia-settings) and to the backend session (api.setApiKeys), then
 * forward the model list to the parent so step 3 can pick a default.
 *
 * Ollama: no key field — just a host input + reachability check that
 * lists installed models.
 *
 * Stale-response guard: each test bumps a request id and the resolved
 * promise only updates state if the id still matches. Prevents an in-
 * flight bad-key test from clobbering a fresh good-key result if the
 * user typed quickly.
 */
function StepConnect({ providerId, onBack, onConnected, onSkip }) {
  const provider = getProvider(providerId);
  const sessionId = useAppStore((s) => s.sessionId);

  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [host, setHost] = useState('http://localhost:11434');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // { ok, message, models? }
  const [saving, setSaving] = useState(false);

  const testRequestId = useRef(0);

  // Pre-fill any existing key/host so the user doesn't re-type. Reset the
  // result when the provider changes — a passing OpenAI test must not
  // unlock Continue after the user goes back and switches to Anthropic.
  useEffect(() => {
    if (!provider) return;
    setResult(null);
    setTesting(false);
    testRequestId.current += 1; // invalidate any in-flight request
    try {
      if (provider.cloud) {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const existing = parsed?.apiKeys?.[provider.id];
          setApiKey(typeof existing === 'string' ? existing : '');
        } else {
          setApiKey('');
        }
      } else {
        const raw = localStorage.getItem(OLLAMA_SETTINGS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.host) setHost(parsed.host);
        }
      }
    } catch {
      /* ignore parse errors — defaults are fine */
    }
  }, [provider]);

  if (!provider) return null;

  const handleTest = async () => {
    const myId = ++testRequestId.current;
    setTesting(true);
    setResult(null);
    let r;
    try {
      r = await api.testProviderConnection({
        provider: provider.id,
        apiKey: provider.cloud ? apiKey : undefined,
        host: provider.cloud ? undefined : host,
      });
    } catch (err) {
      r = {
        ok: false,
        message: err?.message || 'Provider test failed. Check the connection and try again.',
      };
    }
    // Drop stale responses — only the most recent test wins.
    if (myId !== testRequestId.current) return;
    setResult(r);
    setTesting(false);
  };

  // After a successful test, persist the connection and hand off to step 3.
  // Persistence:
  //   - Cloud → loxia-settings (used by AttentionRequiredModal et al.)
  //              + backend session via api.setApiKeys
  //   - Ollama → loxia-ollama-settings + backend via api.updateOllamaSettings
  const handleSaveAndContinue = async () => {
    if (!result?.ok || saving) return;
    setSaving(true);
    try {
      if (provider.cloud) {
        const trimmed = apiKey.trim();
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        const existing = raw ? JSON.parse(raw) : {};
        const next = {
          ...existing,
          apiKeys: { ...(existing.apiKeys || {}), [provider.id]: trimmed },
        };
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
        try {
          await api.setApiKeys(sessionId || null, { vendorKeys: { [provider.id]: trimmed } });
        } catch (err) {
          // Non-fatal: the local copy is saved, the agent step can still
          // proceed via the backend's localStorage rehydrate path.
          console.warn('Backend key sync failed (continuing):', err);
        }
        window.dispatchEvent(new CustomEvent('apikey-updated'));
        window.dispatchEvent(new CustomEvent('settings-updated'));
      } else {
        localStorage.setItem(
          OLLAMA_SETTINGS_KEY,
          JSON.stringify({ host: host.trim(), enabled: true }),
        );
        try {
          await api.updateOllamaSettings({ host: host.trim(), enabled: true });
        } catch (err) {
          console.warn('Ollama settings sync failed (continuing):', err);
        }
      }
      onConnected({ providerId: provider.id, models: result.models || [] });
    } finally {
      setSaving(false);
    }
  };

  // Editing the key/host invalidates the prior result so Continue can't
  // be clicked against stale evidence.
  const handleKeyChange = (value) => {
    setApiKey(value);
    if (result) setResult(null);
  };
  const handleHostChange = (value) => {
    setHost(value);
    if (result) setResult(null);
  };

  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
        {provider.cloud
          ? 'Your key is stored locally and used only to contact the provider.'
          : 'OnBuzz will connect to Ollama on this machine. No API key required.'}
      </p>

      {provider.cloud ? (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {provider.label} API key
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => handleKeyChange(e.target.value)}
              placeholder={provider.placeholder}
              className="input-primary pr-10 w-full"
              data-clarity-mask="always"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
              aria-label={showApiKey ? 'Hide key' : 'Show key'}
            >
              {showApiKey ? (
                <EyeSlashIcon className="w-4 h-4 text-gray-400" />
              ) : (
                <EyeIcon className="w-4 h-4 text-gray-400" />
              )}
            </button>
          </div>
          {provider.keyHelpUrl && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Need a key?{' '}
              <a
                href={provider.keyHelpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-loxia-600 dark:text-loxia-400 hover:underline"
              >
                Open the {provider.label} dashboard
              </a>
              .
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Ollama host
          </label>
          <input
            type="text"
            value={host}
            onChange={(e) => handleHostChange(e.target.value)}
            placeholder="http://localhost:11434"
            className="input-primary w-full"
            autoFocus
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Default works for most setups. Install Ollama from{' '}
            <a
              href={provider.keyHelpUrl}
              target="_blank"
              rel="noreferrer"
              className="text-loxia-600 dark:text-loxia-400 hover:underline"
            >
              ollama.com
            </a>{' '}
            if you have not already.
          </p>
        </div>
      )}

      <div className="mt-4">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || (provider.cloud && !apiKey.trim())}
          className="button-secondary disabled:opacity-50"
        >
          {testing ? (
            <span className="inline-flex items-center">
              <LoadingSpinner size="sm" className="mr-2" />
              Testing...
            </span>
          ) : (
            'Test connection'
          )}
        </button>
      </div>

      {result && (
        <div
          className={`mt-4 flex items-start gap-2 p-3 rounded-lg text-sm ${
            result.ok
              ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200'
              : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200'
          }`}
        >
          {result.ok ? (
            <CheckCircleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          ) : (
            <ExclamationCircleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          )}
          <div>
            {result.ok ? (
              <>
                <div className="font-medium">Connection test passed.</div>
                <div className="text-xs opacity-80">
                  {Array.isArray(result.models) && result.models.length > 0
                    ? `${result.models.length} model${result.models.length === 1 ? '' : 's'} available.`
                    : 'No models reported — you can still continue.'}
                </div>
              </>
            ) : (
              <div>{result.message || 'We could not reach this provider. Check the key and try again.'}</div>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button type="button" onClick={onBack} className="button-secondary" disabled={saving}>
          Back
        </button>

        <div className="flex items-center gap-3">
          {/* Skip is only offered for cloud providers. Ollama already
              skips key entry by definition, so adding a "Skip" link there
              would be confusing. The link routes to onSkip() — the parent
              wizard advances to step 3, which decides what to actually do
              (use Ollama if available, or finish without an agent). */}
          {provider.cloud && onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={saving || testing}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:underline disabled:opacity-50"
            >
              Skip for now
            </button>
          )}

          <button
            type="button"
            onClick={handleSaveAndContinue}
            disabled={!result?.ok || saving || testing}
            className="button-primary disabled:opacity-50"
          >
            {saving ? (
              <span className="inline-flex items-center">
                <LoadingSpinner size="sm" className="mr-2" />
                Saving...
              </span>
            ) : (
              'Continue'
            )}
          </button>
        </div>
      </div>

      {/* One-line nudge under the action row so the skip is discoverable
          but doesn't compete visually with the primary path. */}
      {provider.cloud && onSkip && (
        <p className="mt-2 text-right text-xs text-gray-400 dark:text-gray-500">
          You can add a key later in Settings.
        </p>
      )}
    </div>
  );
}

export default StepConnect;
