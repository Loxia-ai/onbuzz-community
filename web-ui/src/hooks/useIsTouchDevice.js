/**
 * useIsTouchDevice — returns true when the runtime appears to be a
 * touch-primary device (phones, tablets, touch-screen laptops in
 * tablet mode). Used by the Flows UI to swap drag-from-palette for
 * tap-to-add, swap hover-revealed buttons for always-visible ones,
 * and bump tap targets to ≥44px.
 *
 * Detection priority:
 *   1. CSS media query `(pointer: coarse)` — the canonical signal for
 *      "primary input is a finger." A laptop with a touch screen but
 *      a mouse plugged in registers as `(pointer: fine)`, which is
 *      what we want — the user has precise input available.
 *   2. `'ontouchstart' in window` — fallback for older browsers that
 *      don't expose the pointer media query.
 *
 * The hook re-evaluates on the media-query change event so resizing
 * a Chromebook into tablet mode (or rotating a 2-in-1) updates live.
 */
import { useState, useEffect } from 'react';

function detect() {
  if (typeof window === 'undefined') return false;
  // Primary signal: pointer-coarse media query — when the browser
  // exposes it, this is authoritative. Coarse=true → finger-primary;
  // coarse=false → mouse/trackpad-primary (even on a touch laptop with
  // a finger AND a mouse, where the user has precise input available).
  // Only fall through to legacy signals when matchMedia is unavailable
  // OR threw, since coarse=false means "we have a mouse, don't switch
  // the UI to tap-mode."
  if (typeof window.matchMedia === 'function') {
    try {
      const mql = window.matchMedia('(pointer: coarse)');
      return !!mql.matches;
    } catch { /* matchMedia threw — fall through to legacy signals */ }
  }
  // Legacy fallbacks for browsers without the pointer media query.
  if ('ontouchstart' in window) return true;
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
  return false;
}

export function useIsTouchDevice() {
  const [isTouch, setIsTouch] = useState(detect());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mql;
    try {
      mql = window.matchMedia('(pointer: coarse)');
    } catch {
      return;
    }
    const handler = () => setIsTouch(detect());
    // `addEventListener('change', ...)` is the modern API; older Safari
    // needs `addListener`. Support both so this hook works back to iOS 12.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    }
  }, []);

  return isTouch;
}

export default useIsTouchDevice;
