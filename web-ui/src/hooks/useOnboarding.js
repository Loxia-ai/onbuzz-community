/**
 * useOnboarding - first-run detection for the onboarding wizard.
 *
 * The wizard is shown when ALL of the following hold:
 *   - the user has not completed onboarding before
 *     (loxia-onboarding-complete flag in localStorage)
 *   - no agent exists in the current session
 *   - no provider key is configured (none of openai/anthropic/gemini/xai)
 *
 * Once completed it is never shown again on this machine — the flag is the
 * source of truth, not the agent/key state. That means a user who later
 * deletes their key gets the existing "Provider key missing" reminder, not
 * the full wizard again.
 */

import { useCallback, useEffect, useState } from 'react';
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

export function useOnboarding() {
  const initialized = useAppStore((s) => s.initialized);
  const agents = useAppStore((s) => s.agents);

  const [shouldShow, setShouldShow] = useState(false);
  const [forcedOpen, setForcedOpen] = useState(false);

  const recompute = useCallback(() => {
    if (!initialized) {
      setShouldShow(false);
      return;
    }
    if (forcedOpen) {
      setShouldShow(true);
      return;
    }
    if (isOnboardingComplete()) {
      setShouldShow(false);
      return;
    }
    const noAgents = !Array.isArray(agents) || agents.length === 0;
    const noKey = !hasAnyProviderKey();
    setShouldShow(noAgents && noKey);
  }, [initialized, agents, forcedOpen]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const onUpdate = () => recompute();
    window.addEventListener('storage', onUpdate);
    window.addEventListener('apikey-updated', onUpdate);
    window.addEventListener('settings-updated', onUpdate);
    window.addEventListener('onboarding-completed', onUpdate);
    return () => {
      window.removeEventListener('storage', onUpdate);
      window.removeEventListener('apikey-updated', onUpdate);
      window.removeEventListener('settings-updated', onUpdate);
      window.removeEventListener('onboarding-completed', onUpdate);
    };
  }, [recompute]);

  const completeOnboarding = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_DONE_KEY, 'true');
    } catch (err) {
      console.error('Failed to persist onboarding completion:', err);
    }
    setForcedOpen(false);
    setShouldShow(false);
    window.dispatchEvent(new CustomEvent('onboarding-completed'));
  }, []);

  // Allow the user to re-open onboarding manually (e.g. from Settings).
  const openOnboarding = useCallback(() => {
    setForcedOpen(true);
    setShouldShow(true);
  }, []);

  // Skip without marking complete — onboarding will reappear next launch
  // unless the user has since added a key or created an agent. This is the
  // graceful escape hatch when the modal is in the way.
  const dismissOnboarding = useCallback(() => {
    setForcedOpen(false);
    setShouldShow(false);
  }, []);

  return {
    shouldShow,
    completeOnboarding,
    openOnboarding,
    dismissOnboarding,
    isComplete: isOnboardingComplete(),
  };
}

export default useOnboarding;
