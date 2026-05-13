/**
 * Provider-key skip — shared between the onboarding wizard and the
 * post-onboarding AttentionRequiredModal.
 *
 * The user can defer adding a vendor API key in two places:
 *   - During onboarding step 2 ("Skip for now")
 *   - From the AttentionRequiredModal that surfaces after the wizard
 *
 * Both paths flip the same persistent flag so the user is never asked
 * twice. The flag is intentionally simple (string "true" in
 * localStorage) — adding a real key later naturally supersedes it
 * because useAttentionRequired's checkApiKeyConfigured() returns true
 * the moment loxia-settings.apiKeys has any non-empty vendor entry.
 *
 * Why a shared module instead of two near-identical handlers?
 *   - One key name, one event name, one place to maintain.
 *   - Future tweaks (e.g. clearing the skip when the user removes their
 *     last key, or wiring a "Restore reminder" toggle in Settings) only
 *     need to touch this file.
 */

const SKIP_KEY = 'loxia-provider-key-skipped';

// Custom DOM event so listeners (the attention hook) can recompute
// without importing this module — same pattern the rest of the
// onboarding code uses.
const SKIP_EVENT = 'provider-key-skipped';

export function isProviderKeySkipped() {
  try {
    return localStorage.getItem(SKIP_KEY) === 'true';
  } catch {
    return false;
  }
}

export function skipProviderKey() {
  try {
    localStorage.setItem(SKIP_KEY, 'true');
  } catch (err) {
    console.error('Failed to persist provider-key skip:', err);
  }
  // Two events: the new dedicated one for explicit skip listeners, and
  // the long-standing apikey-updated channel so the existing attention
  // hook recomputes its issue list without a second listener.
  window.dispatchEvent(new CustomEvent(SKIP_EVENT));
  window.dispatchEvent(new CustomEvent('apikey-updated'));
}

export function clearProviderKeySkip() {
  try {
    localStorage.removeItem(SKIP_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(SKIP_EVENT));
  window.dispatchEvent(new CustomEvent('apikey-updated'));
}

export const PROVIDER_KEY_SKIP_EVENT = SKIP_EVENT;
