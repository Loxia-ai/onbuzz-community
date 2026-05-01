/**
 * useConsent Hook - Manages user consent for analytics data collection
 *
 * Consent Levels:
 * - 'none': No data collection (Clarity not loaded)
 * - 'basic': Basic analytics only (clicks, scrolls, heatmaps) - all text masked
 * - 'full': Full analytics including text content
 */

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';

const CONSENT_STORAGE_KEY = 'loxia-analytics-consent';
const CONSENT_DIALOG_KEY = 'loxia-consent-dialog-open';

// Consent level constants
export const CONSENT_LEVELS = {
  NONE: 'none',
  BASIC: 'basic',
  FULL: 'full'
};

// Global listeners for dialog state synchronization
let dialogListeners = [];
let dialogOpen = false;

const subscribeDialog = (listener) => {
  dialogListeners.push(listener);
  return () => {
    dialogListeners = dialogListeners.filter(l => l !== listener);
  };
};

const getDialogSnapshot = () => dialogOpen;

const setDialogOpen = (open) => {
  dialogOpen = open;
  dialogListeners.forEach(listener => listener());
};

/**
 * Get stored consent from localStorage
 */
const getStoredConsent = () => {
  try {
    const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        level: parsed.level || CONSENT_LEVELS.NONE,
        timestamp: parsed.timestamp || null,
        hasConsented: parsed.hasConsented || false
      };
    }
  } catch (error) {
    console.error('Failed to parse stored consent:', error);
  }
  return {
    level: CONSENT_LEVELS.NONE,
    timestamp: null,
    hasConsented: false
  };
};

/**
 * Save consent to localStorage
 */
const saveConsent = (level) => {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
      level,
      timestamp: new Date().toISOString(),
      hasConsented: true
    }));
  } catch (error) {
    console.error('Failed to save consent:', error);
  }
};

/**
 * useConsent Hook
 * @returns {Object} Consent state and actions
 */
export function useConsent() {
  const [consent, setConsent] = useState(() => getStoredConsent());

  // Use sync external store for dialog state to share across components
  const showConsentDialog = useSyncExternalStore(subscribeDialog, getDialogSnapshot);

  // Check if consent dialog should be shown on mount
  useEffect(() => {
    const stored = getStoredConsent();
    if (!stored.hasConsented) {
      setDialogOpen(true);
    }
  }, []);

  // Listen for storage changes (for cross-tab sync and updates from other components)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === CONSENT_STORAGE_KEY) {
        setConsent(getStoredConsent());
      }
    };

    // Also listen for custom events for same-tab updates
    const handleConsentUpdate = () => {
      setConsent(getStoredConsent());
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('consent-updated', handleConsentUpdate);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('consent-updated', handleConsentUpdate);
    };
  }, []);

  /**
   * Update consent level
   */
  const updateConsent = useCallback((level) => {
    saveConsent(level);
    const newConsent = {
      level,
      timestamp: new Date().toISOString(),
      hasConsented: true
    };
    setConsent(newConsent);
    setDialogOpen(false);
    // Dispatch custom event for same-tab updates
    window.dispatchEvent(new CustomEvent('consent-updated'));
  }, []);

  /**
   * Open consent dialog (for settings)
   */
  const openConsentDialog = useCallback(() => {
    setDialogOpen(true);
  }, []);

  /**
   * Close consent dialog without changing consent
   */
  const closeConsentDialog = useCallback(() => {
    setDialogOpen(false);
  }, []);

  /**
   * Reset consent (for testing/debugging)
   */
  const resetConsent = useCallback(() => {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
    setConsent({
      level: CONSENT_LEVELS.NONE,
      timestamp: null,
      hasConsented: false
    });
    setDialogOpen(true);
  }, []);

  return {
    // State
    consentLevel: consent.level,
    hasConsented: consent.hasConsented,
    consentTimestamp: consent.timestamp,
    showConsentDialog,

    // Actions
    updateConsent,
    openConsentDialog,
    closeConsentDialog,
    resetConsent,

    // Helpers
    isBasicOrHigher: consent.level === CONSENT_LEVELS.BASIC || consent.level === CONSENT_LEVELS.FULL,
    isFullConsent: consent.level === CONSENT_LEVELS.FULL
  };
}

export default useConsent;
