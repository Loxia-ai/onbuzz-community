/**
 * useOnboarding - first-run detection for the onboarding wizard.
 *
 * Single source of truth: `loxia-onboarding-complete` in localStorage.
 *
 * Visibility rule (one expression, no extra state):
 *   shouldShow = !flag && noAgents && noProvider && initialized && !dismissed
 *
 * Inputs:
 *   - flag             — read from localStorage on every render (cheap)
 *   - noAgents         — appStore.agents.length === 0
 *   - noProvider       — no vendor key in loxia-settings
 *   - initialized      — appStore.initialized (don't flash before session boots)
 *   - dismissed        — local component state, only meaningful for the
 *                        current page lifetime (resets on reload)
 *
 * `agents` and `apiKey-updated` events drive recomputation through
 * Zustand's reactivity and a single `storage`+custom-event listener that
 * forces a re-render. We deliberately avoid mirroring the flag into
 * React state — that's where bugs hide.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useAppStore } from '../stores/appStore.js';

const SETTINGS_STORAGE_KEY = 'loxia-settings';
const ONBOARDING_DONE_KEY = 'loxia-onboarding-complete';

const hasAnyProviderKey = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const keys = parsed.apiKeys || {};
    return ['openai', 'anthropic', 'gemini', 'xai'].some(
      (v) => typeof keys[v] === 'string' && keys[v].trim().length > 0,
    );
  } catch {
    return false;
  }
};

const isOnboardingComplete = () => {
  try {
    return localStorage.getItem(ONBOARDING_DONE_KEY) === 'true';
  } catch {
    return false;
  }
};

// useSyncExternalStore lets us treat localStorage as a reactive source
// without mirroring its value into useState. The subscribe function wires
// in cross-tab `storage` events plus the same-tab custom events that
// other onboarding components dispatch when they write keys.
const subscribeStorage = (callback) => {
  const events = ['storage', 'apikey-updated', 'settings-updated', 'onboarding-completed'];
  events.forEach((e) => window.addEventListener(e, callback));
  return () => events.forEach((e) => window.removeEventListener(e, callback));
};

// Tick-based snapshot — useSyncExternalStore needs referentially stable
// values for "no change". An incrementing counter is the simplest way to
// say "re-render and re-read localStorage" without mirroring values.
let storageTick = 0;
const getStorageSnapshot = () => storageTick;
const bumpStorageTick = () => {
  storageTick += 1;
};

if (typeof window !== 'undefined') {
  ['storage', 'apikey-updated', 'settings-updated', 'onboarding-completed'].forEach((e) =>
    window.addEventListener(e, bumpStorageTick),
  );
}

export function useOnboarding() {
  const initialized = useAppStore((s) => s.initialized);
  const agents = useAppStore((s) => s.agents);

  // Re-renders when storage events fire. The actual values are read
  // synchronously below — no mirrored state to drift.
  useSyncExternalStore(subscribeStorage, getStorageSnapshot, getStorageSnapshot);

  // Per-session "I don't want to see this right now" flag. Reload clears it.
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  const shouldShow =
    initialized &&
    !dismissedThisSession &&
    !isOnboardingComplete() &&
    (!Array.isArray(agents) || agents.length === 0) &&
    !hasAnyProviderKey();

  const completeOnboarding = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_DONE_KEY, 'true');
    } catch (err) {
      console.error('Failed to persist onboarding completion:', err);
    }
    window.dispatchEvent(new CustomEvent('onboarding-completed'));
  }, []);

  // Skip without marking complete — onboarding will reappear next launch
  // unless the user has since added a key or created an agent. This is the
  // graceful escape hatch when the modal is in the way.
  const dismissOnboarding = useCallback(() => {
    setDismissedThisSession(true);
  }, []);

  // Reset the dismissal once onboarding is genuinely complete so an
  // explicit re-open later isn't blocked by a stale flag.
  useEffect(() => {
    if (isOnboardingComplete() && dismissedThisSession) {
      setDismissedThisSession(false);
    }
  }, [dismissedThisSession]);

  return {
    shouldShow,
    completeOnboarding,
    dismissOnboarding,
    isComplete: isOnboardingComplete(),
  };
}

export default useOnboarding;
