/**
 * useAttentionRequired Hook
 *
 * Tracks issues that require user attention before fully using the system.
 *
 * Current issues tracked:
 * - Privacy consent (analytics data collection)
 * - Provider key missing — fired only when ALL of the following are true:
 *     a. no vendor key for openai/anthropic/gemini/xai
 *     b. user has not explicitly skipped (loxia-provider-key-skipped)
 *     c. Ollama is not a usable provider — i.e. either disabled in
 *        loxia-ollama-settings, OR the local daemon is unreachable, OR
 *        no models are installed yet.
 *   So a user who chose Ollama during onboarding and has at least one
 *   local model never sees this reminder.
 */

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { isProviderKeySkipped, PROVIDER_KEY_SKIP_EVENT } from '../utils/providerKeySkip.js';
import { useModelsStore } from '../stores/modelsStore.js';

const SETTINGS_STORAGE_KEY = 'loxia-settings';
const CONSENT_STORAGE_KEY = 'loxia-analytics-consent';
const OLLAMA_SETTINGS_KEY = 'loxia-ollama-settings';

// Issue types
export const ISSUE_TYPES = {
  PRIVACY_CONSENT: 'privacy_consent',
  API_KEY_MISSING: 'api_key_missing'
};

// Global listeners for modal state synchronization
let modalListeners = [];
let modalOpen = false;

const subscribeModal = (listener) => {
  modalListeners.push(listener);
  return () => {
    modalListeners = modalListeners.filter(l => l !== listener);
  };
};

const getModalSnapshot = () => modalOpen;

const setModalOpen = (open) => {
  modalOpen = open;
  modalListeners.forEach(listener => listener());
};

/**
 * Check if privacy consent has been given
 */
const checkPrivacyConsent = () => {
  try {
    const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.hasConsented === true;
    }
  } catch (error) {
    console.error('Failed to check consent:', error);
  }
  return false;
};

/**
 * Has the user stored a cloud vendor key for any of openai / anthropic /
 * gemini / xai?
 */
const checkApiKeyConfigured = () => {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!stored) return false;
    const parsed = JSON.parse(stored);
    const keys = parsed.apiKeys || {};
    return ['openai', 'anthropic', 'gemini', 'xai'].some(
      v => typeof keys[v] === 'string' && keys[v].trim().length > 0
    );
  } catch (error) {
    console.error('Failed to check API key:', error);
  }
  return false;
};

/**
 * Is Ollama a *usable* provider right now?
 *
 *   - Enabled in loxia-ollama-settings (default true if never saved).
 *   - The local daemon is reachable (modelsStore.ollamaAvailable).
 *   - At least one model is installed (modelsStore.ollamaModels.length).
 *
 * Reads from zustand synchronously — fine because modelsStore eagerly
 * runs `fetchModels()` at module load, and we subscribe to changes
 * below so the issue list re-evaluates as state arrives.
 *
 * Returns false during the very first render before fetchModels()
 * resolves; the early-load flash is suppressed in getIssues() via the
 * `lastFetched` gate.
 */
const checkOllamaUsable = () => {
  let enabled = true; // Default: enabled if the user never opened Settings.
  try {
    const raw = localStorage.getItem(OLLAMA_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.enabled === false) enabled = false;
    }
  } catch (error) {
    console.error('Failed to read ollama settings:', error);
  }
  if (!enabled) return false;

  const { ollamaAvailable, ollamaModels } = useModelsStore.getState();
  return !!ollamaAvailable && Array.isArray(ollamaModels) && ollamaModels.length > 0;
};

/**
 * Get all current issues that need attention
 */
const getIssues = () => {
  const issues = [];

  if (!checkPrivacyConsent()) {
    issues.push({
      type: ISSUE_TYPES.PRIVACY_CONSENT,
      title: 'Privacy & Analytics',
      description: 'Choose your analytics preferences',
      priority: 1
    });
  }

  // The "Provider Key Required" reminder is suppressed when:
  //   1. Any cloud vendor key is configured, OR
  //   2. The user explicitly chose Skip-for-now (in onboarding or in
  //      this very modal — the persistent flag covers both), OR
  //   3. Ollama is a usable local provider (enabled + reachable + has
  //      at least one model). This is what makes the Ollama happy path
  //      stop showing the modal.
  //
  // We also suppress during the brief initial-fetch window, before
  // modelsStore has had a chance to probe Ollama. Without this gate
  // the modal would flash open then auto-close on first render for
  // every Ollama-only user.
  const modelsLoaded = useModelsStore.getState().lastFetched !== null;
  const providerSatisfied =
    checkApiKeyConfigured() || isProviderKeySkipped() || checkOllamaUsable();
  if (!providerSatisfied && modelsLoaded) {
    issues.push({
      type: ISSUE_TYPES.API_KEY_MISSING,
      title: 'Provider Key Required',
      description: 'Add a key for OpenAI, Anthropic, Gemini, or xAI — or run Ollama locally',
      priority: 2,
    });
  }

  // Sort by priority
  return issues.sort((a, b) => a.priority - b.priority);
};

/**
 * useAttentionRequired Hook
 * @returns {Object} Attention required state and actions
 */
export function useAttentionRequired() {
  const [issues, setIssues] = useState(() => getIssues());

  // Use sync external store for modal state to share across components
  const showModal = useSyncExternalStore(subscribeModal, getModalSnapshot);

  // Refresh issues when storage changes
  const refreshIssues = useCallback(() => {
    const newIssues = getIssues();
    setIssues(newIssues);
    return newIssues;
  }, []);

  // Check on mount if modal should be shown
  useEffect(() => {
    const currentIssues = refreshIssues();
    if (currentIssues.length > 0) {
      setModalOpen(true);
    }
  }, [refreshIssues]);

  // Listen for storage changes
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === SETTINGS_STORAGE_KEY || e.key === CONSENT_STORAGE_KEY) {
        refreshIssues();
      }
    };

    // Listen for custom events for same-tab updates
    const handleUpdate = () => {
      const newIssues = refreshIssues();
      // Auto-close modal if all issues resolved
      if (newIssues.length === 0 && modalOpen) {
        setModalOpen(false);
      }
    };

    // When modal is opened from another component, refresh issues
    const handleModalOpened = () => {
      refreshIssues();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('consent-updated', handleUpdate);
    window.addEventListener('settings-updated', handleUpdate);
    window.addEventListener('apikey-updated', handleUpdate);
    window.addEventListener(PROVIDER_KEY_SKIP_EVENT, handleUpdate);
    window.addEventListener('attention-modal-opened', handleModalOpened);

    // Subscribe to modelsStore so the Provider Key Required issue
    // disappears the moment Ollama becomes usable (e.g. after
    // onboarding's StepAgent calls fetchOllamaModels). Watching only
    // the fields we care about avoids needless re-evaluations.
    const unsubscribeModels = useModelsStore.subscribe(
      (state) => ({
        available: state.ollamaAvailable,
        modelCount: Array.isArray(state.ollamaModels) ? state.ollamaModels.length : 0,
        lastFetched: state.lastFetched,
      }),
      () => handleUpdate(),
      {
        equalityFn: (a, b) =>
          a.available === b.available &&
          a.modelCount === b.modelCount &&
          a.lastFetched === b.lastFetched,
      },
    );

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('consent-updated', handleUpdate);
      window.removeEventListener('settings-updated', handleUpdate);
      window.removeEventListener('apikey-updated', handleUpdate);
      window.removeEventListener(PROVIDER_KEY_SKIP_EVENT, handleUpdate);
      window.removeEventListener('attention-modal-opened', handleModalOpened);
      unsubscribeModels();
    };
  }, [refreshIssues]);

  /**
   * Open the attention required modal
   */
  const openModal = useCallback(() => {
    refreshIssues();
    setModalOpen(true);
    // Dispatch event so all hook instances refresh their issues
    window.dispatchEvent(new CustomEvent('attention-modal-opened'));
  }, [refreshIssues]);

  /**
   * Close the modal (only if all issues are resolved)
   */
  const closeModal = useCallback((force = false) => {
    const currentIssues = refreshIssues();
    if (force || currentIssues.length === 0) {
      setModalOpen(false);
    }
  }, [refreshIssues]);

  /**
   * Mark an issue as resolved and refresh
   */
  const resolveIssue = useCallback((issueType) => {
    // Dispatch event based on issue type
    if (issueType === ISSUE_TYPES.PRIVACY_CONSENT) {
      window.dispatchEvent(new CustomEvent('consent-updated'));
    } else if (issueType === ISSUE_TYPES.API_KEY_MISSING) {
      window.dispatchEvent(new CustomEvent('apikey-updated'));
    }

    const newIssues = refreshIssues();
    if (newIssues.length === 0) {
      setModalOpen(false);
    }
  }, [refreshIssues]);

  return {
    // State
    issues,
    hasIssues: issues.length > 0,
    showModal,

    // Specific checks
    hasPrivacyConsent: checkPrivacyConsent(),
    // True if a cloud vendor key is set. Narrower than hasProvider —
    // kept for callers that genuinely care about "do we have a paid
    // remote model available" vs "is any provider usable at all".
    hasApiKey: checkApiKeyConfigured(),
    // True if any provider is usable: a cloud key, OR a usable Ollama
    // (enabled + reachable + has a model), OR the user explicitly
    // skipped. This is what the sidebar warning should key off — the
    // user doesn't care about "key missing" if Ollama is fine.
    hasProvider:
      checkApiKeyConfigured() || checkOllamaUsable() || isProviderKeySkipped(),

    // Actions
    openModal,
    closeModal,
    resolveIssue,
    refreshIssues
  };
}

export default useAttentionRequired;
