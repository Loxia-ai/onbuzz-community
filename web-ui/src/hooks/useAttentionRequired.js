/**
 * useAttentionRequired Hook
 *
 * Tracks issues that require user attention before fully using the system.
 *
 * Current issues tracked:
 * - Privacy consent (analytics data collection)
 * - Provider key missing (any of: openai/anthropic/gemini/xai vendor keys
 *   stored locally, OR a reachable Ollama daemon for local-only use)
 */

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';

const SETTINGS_STORAGE_KEY = 'loxia-settings';
const CONSENT_STORAGE_KEY = 'loxia-analytics-consent';

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
 * Check whether at least one provider is usable.
 * "Usable" means the user has stored a vendor key for any of openai /
 * anthropic / gemini / xai. Ollama doesn't appear here because we
 * can't reliably probe the local daemon from a synchronous check;
 * if the user has zero vendor keys, the modal nudges them to set
 * one — they can dismiss it and use Ollama anyway.
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

  if (!checkApiKeyConfigured()) {
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
    window.addEventListener('attention-modal-opened', handleModalOpened);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('consent-updated', handleUpdate);
      window.removeEventListener('settings-updated', handleUpdate);
      window.removeEventListener('apikey-updated', handleUpdate);
      window.removeEventListener('attention-modal-opened', handleModalOpened);
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
    hasApiKey: checkApiKeyConfigured(),

    // Actions
    openModal,
    closeModal,
    resolveIssue,
    refreshIssues
  };
}

export default useAttentionRequired;
