import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { useAppStore } from '../../stores/appStore.js';
import { useModelsStore } from '../../stores/modelsStore.js';
import LoadingSpinner from '../LoadingSpinner.jsx';
import { getProvider, pickDefaultModel } from './providers.js';

const DEFAULT_AGENT_NAME = 'General Assistant';
const DEFAULT_SYSTEM_PROMPT =
  'You are General Assistant, a helpful AI assistant in OnBuzz. Be concise, accurate, and act with care. Use the available tools when they are useful.';

/**
 * Step 3 — bootstrap the first agent so the user can chat immediately.
 *
 * Cloud providers: pick a balanced default model from the test-connection
 * results, then call createAgent with a "General Assistant" preset.
 *
 * Ollama: enumerate locally-installed models. If none are present we show
 * guidance instead of creating a broken agent — the user pulls a model in
 * Settings and re-runs onboarding from there.
 */
function StepAgent({ providerId, providerModels, onBack, onCreated }) {
  const provider = getProvider(providerId);
  const createAgent = useAppStore((s) => s.createAgent);
  const fetchOllamaModels = useModelsStore((s) => s.fetchOllamaModels);
  const ollamaModels = useModelsStore((s) => s.ollamaModels);
  const fetchModels = useModelsStore((s) => s.fetchModels);

  // Refresh the platform-wide model list once so the new key surfaces
  // available models in the rest of the app immediately.
  useEffect(() => {
    fetchModels().catch(() => {});
    if (provider && !provider.cloud) fetchOllamaModels().catch(() => {});
    // We deliberately run this only when the provider changes — not on
    // every render. The store calls themselves are idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  // Effective list of model identifiers we can pick from.
  // Cloud: from the providers.js connection-test result.
  // Ollama: from the local daemon (already prefixed with `ollama-` server-side).
  const effectiveModels = useMemo(() => {
    if (!provider) return [];
    if (provider.cloud) return providerModels || [];
    return (ollamaModels || []).map((m) => m.name).filter(Boolean);
  }, [provider, providerModels, ollamaModels]);

  const [selectedModel, setSelectedModel] = useState(() =>
    pickDefaultModel(providerId, providerModels || []),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!provider) return;
    if (provider.cloud) {
      setSelectedModel((prev) => prev || pickDefaultModel(providerId, providerModels || []));
    } else {
      setSelectedModel((prev) => prev || effectiveModels[0] || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, providerModels, effectiveModels.length]);

  if (!provider) return null;

  const noOllamaModels = !provider.cloud && effectiveModels.length === 0;

  const handleCreate = async () => {
    setError(null);
    if (!selectedModel) {
      setError('No model available. Pick a different provider, or install a model and try again.');
      return;
    }
    setCreating(true);
    try {
      const agent = await createAgent(DEFAULT_AGENT_NAME, selectedModel, DEFAULT_SYSTEM_PROMPT, {
        capabilities: [],
      });
      onCreated(agent);
    } catch (err) {
      setError(err?.message || 'Failed to create agent.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
        Create your first agent to start chatting. You can add more agents later from the Agents page.
      </p>

      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <div className="flex items-center mb-2">
            <div className="w-8 h-8 rounded-md bg-loxia-600 flex items-center justify-center mr-3">
              <SparklesIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {DEFAULT_AGENT_NAME}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Helpful, concise assistant
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Provider: <span className="font-medium text-gray-700 dark:text-gray-300">{provider.label}</span>
          </p>
        </div>

        {noOllamaModels ? (
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm flex items-start gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">No local Ollama models found.</div>
              <div className="text-xs mt-1">
                Pull a model from your terminal first — for example{' '}
                <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40">
                  ollama pull llama3.1
                </code>{' '}
                — then return here. You can also pull models from Settings → Ollama.
              </div>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Model
            </label>
            <select
              value={selectedModel || ''}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="input-primary w-full"
            >
              {effectiveModels.length === 0 && provider.cloud && (
                <option value={provider.defaultModel || ''}>
                  {provider.defaultModel || 'Default'}
                </option>
              )}
              {effectiveModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {provider.cloud && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                We picked a balanced default. Switch any time from the agent's settings.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="button-secondary"
          disabled={creating}
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleCreate}
          className="button-primary disabled:opacity-50"
          disabled={creating || noOllamaModels || !selectedModel}
        >
          {creating ? (
            <span className="inline-flex items-center">
              <LoadingSpinner size="sm" className="mr-2" />
              Creating agent...
            </span>
          ) : (
            <span className="inline-flex items-center">
              <CheckCircleIcon className="w-5 h-5 mr-2" />
              Create agent and start chatting
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

export default StepAgent;
