/**
 * Module-level state cache for renderer expand/collapse state.
 * Survives React re-mounts that occur when MessageBubble re-renders
 * (e.g., when toolResults arrive via WebSocket).
 *
 * Usage:
 *   const [expanded, setExpanded] = usePersistedToggle('terminal', messageTimestamp, index, false);
 */

import { useState, useCallback } from 'react';

// Global cache: key → value
const _stateCache = new Map();

/**
 * Build a unique cache key from component + message + index.
 */
function buildKey(rendererName, messageTimestamp, index) {
  return `${rendererName}_${messageTimestamp || 'x'}_${index ?? ''}`;
}

/**
 * Hook that persists a boolean toggle across re-mounts.
 * @param {string} rendererName - Renderer identifier (e.g., 'terminal')
 * @param {string} messageTimestamp - Message timestamp for uniqueness
 * @param {number|string} index - Item index within the renderer
 * @param {boolean} defaultValue - Initial value if not cached
 * @returns {[boolean, Function]} [value, toggle]
 */
export function usePersistedToggle(rendererName, messageTimestamp, index, defaultValue = false) {
  const key = buildKey(rendererName, messageTimestamp, index);
  const [value, setValue] = useState(() => _stateCache.has(key) ? _stateCache.get(key) : defaultValue);

  const toggle = useCallback(() => {
    setValue(prev => {
      const next = !prev;
      _stateCache.set(key, next);
      return next;
    });
  }, [key]);

  const set = useCallback((val) => {
    _stateCache.set(key, val);
    setValue(val);
  }, [key]);

  return [value, toggle, set];
}

/**
 * Hook that persists a Set (e.g., which indices are expanded) across re-mounts.
 * @param {string} rendererName
 * @param {string} messageTimestamp
 * @param {Set} defaultValue
 * @returns {[Set, Function, Function]} [set, toggleItem, setAll]
 */
export function usePersistedSet(rendererName, messageTimestamp, defaultValue = new Set()) {
  const key = buildKey(rendererName, messageTimestamp, 'set');
  const [value, setValue] = useState(() => _stateCache.has(key) ? _stateCache.get(key) : defaultValue);

  const toggleItem = useCallback((item) => {
    setValue(prev => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      _stateCache.set(key, next);
      return next;
    });
  }, [key]);

  const setAll = useCallback((newSet) => {
    _stateCache.set(key, newSet);
    setValue(newSet);
  }, [key]);

  return [value, toggleItem, setAll];
}

/**
 * Extract result data from enriched parsedData.
 * Renderers call this to get tool results merged by ToolContentRenderer.
 *
 * @param {object} parsedData - The enriched parsedData from ToolContentRenderer
 * @returns {{ hasResults: boolean, result: object|null, success: boolean|null, error: string|null, executionTime: number|null }}
 */
export function extractResult(parsedData) {
  if (!parsedData) return { hasResults: false, result: null, success: null, error: null, executionTime: null };
  return {
    hasResults: !!parsedData._hasResults,
    result: parsedData._result || null,
    success: parsedData._hasResults ? parsedData.success : null,
    error: parsedData._error || null,
    executionTime: parsedData._executionTime || null
  };
}
