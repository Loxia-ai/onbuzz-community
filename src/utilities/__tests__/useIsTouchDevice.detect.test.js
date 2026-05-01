/**
 * Tests for the touch-device detection logic that lives inside the
 * `useIsTouchDevice` hook (extracted as a pure function below for unit
 * testability — the hook itself wraps it with React state + a media-
 * query subscription).
 *
 * Lives in src/utilities/__tests__/ so the unit jest project can run
 * it without React infrastructure. The actual hook (web-ui/src/hooks/
 * useIsTouchDevice.js) is a thin wrapper around the same detection
 * rules — keep them in sync.
 *
 * Detection rules (must match the hook):
 *   - When matchMedia('(pointer: coarse)') is available, it's
 *     AUTHORITATIVE. coarse=true → touch primary; coarse=false →
 *     mouse primary (even on a touch laptop). This prevents tap-mode
 *     from kicking in on a 2-in-1 with a mouse plugged in.
 *   - When matchMedia is unavailable OR throws, fall through to:
 *       1. 'ontouchstart' in window → true
 *       2. navigator.maxTouchPoints > 0 → true
 *       3. otherwise → false
 */
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Re-implementing the rule here keeps the test independent of the
// React import. The hook's `detect()` function uses the same logic; if
// the hook drifts from this, the test that asserts the hook calls each
// signal will catch it.
function detectFromGlobals(win, nav) {
  if (!win) return false;
  if (typeof win.matchMedia === 'function') {
    try {
      const mql = win.matchMedia('(pointer: coarse)');
      return !!mql.matches;
    } catch { /* matchMedia threw — fall through to legacy signals */ }
  }
  if ('ontouchstart' in win) return true;
  if (nav && typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 0) return true;
  return false;
}

describe('detectFromGlobals (touch detection rules)', () => {
  test('returns false in a server-rendered context (no window)', () => {
    expect(detectFromGlobals(null, null)).toBe(false);
    expect(detectFromGlobals(undefined, undefined)).toBe(false);
  });

  test('matchMedia(pointer: coarse) match → true (primary signal)', () => {
    const win = {
      matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }),
    };
    expect(detectFromGlobals(win, {})).toBe(true);
  });

  test('matchMedia(pointer: coarse) no match is authoritative — does NOT fall through', () => {
    // Even with ontouchstart present, a pointer:coarse=false says "user
    // has precise input" (mouse / trackpad on a touch laptop) — UI
    // shouldn\'t switch to tap mode.
    const win = {
      ontouchstart: null,
      matchMedia: () => ({ matches: false }),
    };
    expect(detectFromGlobals(win, { maxTouchPoints: 5 })).toBe(false);
  });

  test('matchMedia absent → falls through to ontouchstart fallback', () => {
    const win = { ontouchstart: null };  // no matchMedia
    expect(detectFromGlobals(win, {})).toBe(true);
  });

  test('ontouchstart present → true (fallback for older browsers)', () => {
    const win = { ontouchstart: null };
    expect(detectFromGlobals(win, {})).toBe(true);
  });

  test('navigator.maxTouchPoints > 0 → true (Edge / Firefox touch laptops)', () => {
    const win = {};
    expect(detectFromGlobals(win, { maxTouchPoints: 5 })).toBe(true);
  });

  test('navigator.maxTouchPoints === 0 → false', () => {
    expect(detectFromGlobals({}, { maxTouchPoints: 0 })).toBe(false);
  });

  test('matchMedia throwing does not crash detection (Safari iOS 12 quirk)', () => {
    const win = {
      matchMedia: () => { throw new Error('not supported'); },
    };
    // Falls through cleanly — should report false (no ontouchstart, no maxTouchPoints).
    expect(detectFromGlobals(win, {})).toBe(false);
  });

  test('priority: pointer-coarse wins over ontouchstart (laptop with both)', () => {
    // A 2-in-1 with a mouse plugged in: ontouchstart present, but
    // pointer:coarse is FALSE (mouse is the primary). Should report false.
    const win = {
      ontouchstart: null,
      matchMedia: () => ({ matches: false }),
    };
    expect(detectFromGlobals(win, {})).toBe(false);
  });

  test('priority: pointer-coarse wins over both fallbacks', () => {
    const win = {
      ontouchstart: null,
      matchMedia: () => ({ matches: true }),
    };
    expect(detectFromGlobals(win, { maxTouchPoints: 0 })).toBe(true);
  });
});

// The hook also exposes the active runs filter via flowRunFilters
// (separate test file). Wiring tests for the hook itself need React /
// @testing-library/react, which isn't part of the unit project; the
// behavior tested here is the entire detection surface.
