import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isProviderKeySkipped,
  skipProviderKey,
  clearProviderKeySkip,
  PROVIDER_KEY_SKIP_EVENT,
} from '../providerKeySkip.js';

/**
 * The skip flag is the contract between the onboarding wizard and the
 * post-onboarding AttentionRequiredModal: set it once, both paths agree
 * to stop nagging.
 *
 * What we pin here:
 *   - The exact localStorage key (other code reads it directly).
 *   - The two dispatched event names (other modules listen for them).
 *   - Idempotence of skip + clear.
 *   - Read/write failures (storage exceptions) don't crash callers.
 */

const SKIP_KEY = 'loxia-provider-key-skipped';

describe('providerKeySkip', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('isProviderKeySkipped', () => {
    it('returns false when the flag has never been set', () => {
      expect(isProviderKeySkipped()).toBe(false);
    });

    it('returns true once skipProviderKey() has been called', () => {
      skipProviderKey();
      expect(isProviderKeySkipped()).toBe(true);
    });

    it('only treats the literal string "true" as set (not "false", not "1")', () => {
      localStorage.setItem(SKIP_KEY, 'false');
      expect(isProviderKeySkipped()).toBe(false);

      localStorage.setItem(SKIP_KEY, '1');
      expect(isProviderKeySkipped()).toBe(false);

      localStorage.setItem(SKIP_KEY, 'true');
      expect(isProviderKeySkipped()).toBe(true);
    });

    it('returns false when localStorage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(isProviderKeySkipped()).toBe(false);
    });
  });

  describe('skipProviderKey', () => {
    it('writes "true" to the expected localStorage key', () => {
      skipProviderKey();
      expect(localStorage.getItem(SKIP_KEY)).toBe('true');
    });

    it('dispatches the dedicated skip event', () => {
      const handler = vi.fn();
      window.addEventListener(PROVIDER_KEY_SKIP_EVENT, handler);
      skipProviderKey();
      expect(handler).toHaveBeenCalledTimes(1);
      window.removeEventListener(PROVIDER_KEY_SKIP_EVENT, handler);
    });

    it('also dispatches apikey-updated for the existing attention hook', () => {
      // useAttentionRequired listens on the long-standing apikey-updated
      // channel — skipProviderKey must fire it so the issue list
      // recomputes without a second listener.
      const handler = vi.fn();
      window.addEventListener('apikey-updated', handler);
      skipProviderKey();
      expect(handler).toHaveBeenCalledTimes(1);
      window.removeEventListener('apikey-updated', handler);
    });

    it('is idempotent — calling twice still leaves the flag set and fires events both times', () => {
      const handler = vi.fn();
      window.addEventListener(PROVIDER_KEY_SKIP_EVENT, handler);

      skipProviderKey();
      skipProviderKey();

      expect(localStorage.getItem(SKIP_KEY)).toBe('true');
      expect(handler).toHaveBeenCalledTimes(2);
      window.removeEventListener(PROVIDER_KEY_SKIP_EVENT, handler);
    });

    it('still dispatches events even if localStorage write throws (graceful degradation)', () => {
      // Mock storage failure: the function logs but should not throw,
      // and should still notify listeners so the UI updates from the
      // in-memory state.
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const handler = vi.fn();
      window.addEventListener(PROVIDER_KEY_SKIP_EVENT, handler);
      expect(() => skipProviderKey()).not.toThrow();
      expect(handler).toHaveBeenCalledTimes(1);
      window.removeEventListener(PROVIDER_KEY_SKIP_EVENT, handler);
    });
  });

  describe('clearProviderKeySkip', () => {
    it('removes the flag', () => {
      skipProviderKey();
      expect(isProviderKeySkipped()).toBe(true);

      clearProviderKeySkip();
      expect(isProviderKeySkipped()).toBe(false);
      expect(localStorage.getItem(SKIP_KEY)).toBeNull();
    });

    it('dispatches both events on clear (so listeners re-evaluate)', () => {
      const skipHandler = vi.fn();
      const apiKeyHandler = vi.fn();
      window.addEventListener(PROVIDER_KEY_SKIP_EVENT, skipHandler);
      window.addEventListener('apikey-updated', apiKeyHandler);

      clearProviderKeySkip();

      expect(skipHandler).toHaveBeenCalledTimes(1);
      expect(apiKeyHandler).toHaveBeenCalledTimes(1);

      window.removeEventListener(PROVIDER_KEY_SKIP_EVENT, skipHandler);
      window.removeEventListener('apikey-updated', apiKeyHandler);
    });

    it('no-ops cleanly when the flag was never set', () => {
      expect(() => clearProviderKeySkip()).not.toThrow();
      expect(isProviderKeySkipped()).toBe(false);
    });

    it('survives localStorage exceptions silently', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('lockfile busy');
      });
      expect(() => clearProviderKeySkip()).not.toThrow();
    });
  });

  describe('PROVIDER_KEY_SKIP_EVENT', () => {
    it('exports the event name as a string', () => {
      // Other modules (useAttentionRequired in particular) listen on
      // this exact string. Pin it so a rename can't happen silently.
      expect(typeof PROVIDER_KEY_SKIP_EVENT).toBe('string');
      expect(PROVIDER_KEY_SKIP_EVENT).toBe('provider-key-skipped');
    });
  });
});
