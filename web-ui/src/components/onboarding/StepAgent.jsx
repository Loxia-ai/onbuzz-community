import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { useAppStore } from '../../stores/appStore.js';
import { useModelsStore } from '../../stores/modelsStore.js';
import LoadingSpinner from '../LoadingSpinner.jsx';
import { getProvider, pickDefaultModel } from './providers.js';

// Tiny, fast Ollama model that's friendly to first-time installs. Used as
// the suggested `ollama pull` target in the empty-state guidance.
const SUGGESTED_OLLAMA_MODEL = 'qwen2.5:1.5b';

const DEFAULT_AGENT_NAME = 'General Assistant';
const DEFAULT_SYSTEM_PROMPT =
  'You are General Assistant, a helpful AI assistant in OnBuzz. Be concise, accurate, and act with care. Use the available tools when they are useful.';

/**
 * Step 3 — bootstrap the first agent so the user can chat immediately.
 *
 * Three branches, in priority order:
 *
 * 1. **Cloud, key verified** (default path).
 *    Picks a balanced default model from step 2's connection-test result
 *    and creates a "General Assistant" agent on that provider.
 *
 * 2. **Ollama** (either chosen directly OR fallback when the user
 *    skipped a cloud key, IF the daemon is reachable + has models).
 *    Picks a local model and creates the agent against it. Empty model
 *    list shows pull guidance + "I installed a model" refresh.
 *
 * 3. **Skipped + no Ollama models / no Ollama daemon**.
 *    Shows a clear warning and offers a "Finish without an agent" exit.
 *    Onboarding completes — the existing AttentionRequiredModal will
 *    surface the "Provider key missing" reminder, and the user can add a
 *    key later from Settings.
 *
 * The `connectionSkipped` prop is the key signal: it switches us from
 * "cloud agent creation" to "fall back to Ollama or finish gracefully".
 */
function StepAgent({ providerId, providerModels, connectionSkipped, onBack, onCreated }) {
  const provider = getProvider(providerId);
  const createAgent = useAppStore((s) => s.createAgent);
  const fetchOllamaModels = useModelsStore((s) => s.fetchOllamaModels);
  const ollamaModels = useModelsStore((s) => s.ollamaModels);
  const ollamaAvailable = useModelsStore((s) => s.ollamaAvailable);
  const fetchModels = useModelsStore((s) => s.fetchModels);

  // True whenever we should be sourcing the model list from Ollama:
  // either the user picked Ollama directly, or they skipped a cloud key
  // and we're falling back to local.
  const usingOllama = connectionSkipped || (provider && !provider.cloud);

  // Ollama probe state — needed when usingOllama is true so the UI can
  // distinguish "still checking" from "definitely not running". We rely
  // on the modelsStore for the actual data and just track the
  // first-resolution timing locally.
  const [ollamaCheckDone, setOllamaCheckDone] = useState(false);

  // Always refresh the platform-wide model list — keeps the rest of the
  // app's model dropdowns in sync with whatever just happened in step 2.
  // Re-probe Ollama whenever we're going to source models from there.
  useEffect(() => {
    fetchModels().catch(() => {});
    if (usingOllama) {
      setOllamaCheckDone(false);
      fetchOllamaModels()
        .catch(() => {})
        .finally(() => setOllamaCheckDone(true));
    } else {
      setOllamaCheckDone(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, connectionSkipped]);

  // Effective list of model identifiers we can pick from.
  const effectiveModels = useMemo(() => {
    if (!provider) return [];
    if (usingOllama) return (ollamaModels || []).map((m) => m.name).filter(Boolean);
    return providerModels || [];
  }, [provider, usingOllama, providerModels, ollamaModels]);

  const [selectedModel, setSelectedModel] = useState(() =>
    pickDefaultModel(providerId, providerModels || []),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [refreshingOllama, setRefreshingOllama] = useState(false);

  // Keep selectedModel in sync with whatever effective source is now
  // active. Switching from cloud → Ollama (skip path) needs to clear an
  // OpenAI model id that's no longer valid.
  useEffect(() => {
    if (!provider) return;
    if (usingOllama) {
      setSelectedModel((prev) =>
        prev && effectiveModels.includes(prev) ? prev : effectiveModels[0] || null,
      );
    } else {
      setSelectedModel((prev) => {
        const stillValid = prev && (providerModels || []).includes(prev);
        return stillValid ? prev : pickDefaultModel(providerId, providerModels || []);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, usingOllama, providerModels, effectiveModels.length]);

  if (!provider) return null;

  // Three resolved UI states drive the rest of the render.
  const ollamaProbing = usingOllama && !ollamaCheckDone;
  const noOllamaModels = usingOllama && ollamaCheckDone && effectiveModels.length === 0;
  // "Limited mode" = the user skipped a cloud key AND we have no Ollama
  // models to fall back on (whether the daemon is unreachable OR running
  // empty). In limited mode the wizard offers a clean finish-without-
  // agent exit so the skip path never dead-ends.
  const limitedMode = connectionSkipped && noOllamaModels;

  const handleRefreshOllama = async () => {
    setRefreshingOllama(true);
    try {
      await fetchOllamaModels();
    } finally {
      setRefreshingOllama(false);
      setOllamaCheckDone(true);
    }
  };

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

  // Limited-mode exit: complete onboarding without creating an agent. The
  // user lands on chat with the existing "Provider key missing" reminder
  // shown by AttentionRequiredModal — they can add a key from Settings
  // when they're ready. This is the no-dead-end safety net.
  const handleFinishWithoutAgent = () => {
    onCreated(null);
  };

  // Provider line shown in the agent card. When the cloud key was
  // skipped and we're falling back to Ollama, surface that explicitly so
  // the user understands what they're about to create.
  const providerLine = connectionSkipped
    ? usingOllama && !noOllamaModels
      ? `Ollama (skipped ${provider.label})`
      : `Skipped ${provider.label}`
    : provider.label;

  const headline = connectionSkipped
    ? noOllamaModels
      ? `You skipped adding a ${provider.label} key.`
      : `Using Ollama since you skipped the ${provider.label} key.`
    : 'Create your first agent to start chatting. You can add more agents later from the Agents page.';

  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">{headline}</p>

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
            Provider: <span className="font-medium text-gray-700 dark:text-gray-300">{providerLine}</span>
          </p>
        </div>

        {/* Skip-path banner — shown only when the cloud key was skipped
            AND we're successfully falling back to Ollama. Reassures the
            user about what's happening. */}
        {connectionSkipped && usingOllama && !noOllamaModels && !ollamaProbing && (
          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 text-sm flex items-start gap-2">
            <InformationCircleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Falling back to local Ollama.</div>
              <div className="text-xs mt-0.5 opacity-80">
                You can add a {provider.label} key later in Settings.
              </div>
            </div>
          </div>
        )}

        {ollamaProbing ? (
          <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <LoadingSpinner size="sm" />
            Checking for local Ollama models…
          </div>
        ) : limitedMode ? (
          /* Skip path with no Ollama path. Two sub-cases:
             - Ollama unavailable → warning, no pull command (it would
               just confuse — the daemon isn't there to receive it).
             - Ollama running empty → pull guidance so the user has an
               immediate way out if they want one.
             Either way, the primary action below is "Finish without an
             agent" so the user never gets stuck. */
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm">
            <div className="flex items-start gap-2">
              <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium">
                  {ollamaAvailable
                    ? 'No local models found.'
                    : 'No agent can be created yet.'}
                </div>
                <div className="text-xs mt-1">
                  {ollamaAvailable
                    ? 'Install one to chat locally, or finish setup and add a provider key later from Settings.'
                    : 'Ollama is not running and no provider key was added. Finish setup now and either start Ollama or add a key from Settings whenever you are ready.'}
                </div>
                {ollamaAvailable && (
                  <pre className="mt-2 px-2 py-1.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 text-xs font-mono overflow-x-auto">
                    ollama pull {SUGGESTED_OLLAMA_MODEL}
                  </pre>
                )}
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={handleRefreshOllama}
                disabled={refreshingOllama}
                className="inline-flex items-center px-3 py-1.5 rounded-md bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-100 text-xs font-medium disabled:opacity-50"
              >
                {refreshingOllama ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-1.5" />
                    {ollamaAvailable ? 'Refreshing…' : 'Re-checking…'}
                  </>
                ) : (
                  <>
                    <ArrowPathIcon className="w-3.5 h-3.5 mr-1.5" />
                    {ollamaAvailable ? 'I installed a model' : 'Re-check Ollama'}
                  </>
                )}
              </button>
            </div>
          </div>
        ) : noOllamaModels ? (
          /* Ollama is reachable (or chosen directly) but no models installed. */
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm">
            <div className="flex items-start gap-2">
              <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium">No local models found.</div>
                <div className="text-xs mt-1">Run this in your terminal, then click refresh:</div>
                <pre className="mt-2 px-2 py-1.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 text-xs font-mono overflow-x-auto">
                  ollama pull {SUGGESTED_OLLAMA_MODEL}
                </pre>
                <p className="text-xs mt-2 opacity-80">
                  You can also pull models from Settings → Ollama.
                </p>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={handleRefreshOllama}
                disabled={refreshingOllama}
                className="inline-flex items-center px-3 py-1.5 rounded-md bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-100 text-xs font-medium disabled:opacity-50"
              >
                {refreshingOllama ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-1.5" />
                    Refreshing...
                  </>
                ) : (
                  <>
                    <ArrowPathIcon className="w-3.5 h-3.5 mr-1.5" />
                    I installed a model
                  </>
                )}
              </button>
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
              {effectiveModels.length === 0 && provider.cloud && !connectionSkipped && (
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
            {provider.cloud && !connectionSkipped && (
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

        {/* Primary action depends on state:
            - limited mode → "Finish without an agent" (always enabled)
            - empty Ollama (not skipped) → button disabled until refresh
            - everything else → "Create agent and start chatting" */}
        {limitedMode ? (
          <button
            type="button"
            onClick={handleFinishWithoutAgent}
            className="button-primary"
          >
            Finish without an agent
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCreate}
            className="button-primary disabled:opacity-50"
            disabled={creating || ollamaProbing || noOllamaModels || !selectedModel}
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
        )}
      </div>
    </div>
  );
}

export default StepAgent;
