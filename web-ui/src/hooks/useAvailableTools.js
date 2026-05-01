/**
 * useAvailableTools — single source of truth for the tool catalogue.
 *
 * Background: the web-UI previously had THREE places declaring the list
 * of tools an agent could be granted:
 *   - ToolsSelectorDropdown.jsx  (inline array, 26 entries)
 *   - AgentCreationModal.jsx     (separate inline array, near-duplicate)
 *   - AgentEditModal.jsx         (dynamic, via GET /api/tools)
 * They drifted. `video-gen` was live on the backend but absent from the
 * first two; new tools added in the backend didn't show up in the
 * selector dropdown; categories and copy diverged.
 *
 * This hook fetches `/api/tools` ONCE per page load (module-level cache
 * + in-flight dedupe) and returns the canonical list. All selector
 * surfaces consume it, so adding a tool on the backend automatically
 * lights it up everywhere.
 *
 * Shape per tool (from `baseTool.js#getAvailableToolsForUI`):
 *   { id, name, description, category, iconName, enabled, async,
 *     requiresProject, className }
 *
 * Options:
 *   sortBy — 'name' (default) or 'category-then-name'. The selector
 *     dropdown wants category grouping; other surfaces may prefer
 *     alphabetical.
 */

import { useEffect, useState, useMemo } from 'react';
import { api } from '../services/api';

// Module-level cache — the tool list doesn't change between renders so
// fetching once per page load is plenty. Reset on hard refresh.
let _cache = null;           // { tools: [...] }
let _inflight = null;        // Promise dedupe

async function fetchToolsOnce() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const response = await api.getTools();
    if (!response?.success || !Array.isArray(response.tools)) {
      throw new Error('Failed to load tools from server');
    }
    _cache = { tools: response.tools };
    return _cache;
  })();
  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}

/**
 * Invalidate the cache. Useful in tests and for a future "refresh tools"
 * affordance. Not currently called by production code.
 */
export function _resetAvailableToolsCache() {
  _cache = null;
  _inflight = null;
}

export function useAvailableTools({ sortBy = 'name' } = {}) {
  const [state, setState] = useState(() =>
    _cache
      ? { tools: _cache.tools, loading: false, error: null }
      : { tools: [], loading: true, error: null }
  );

  useEffect(() => {
    let cancelled = false;
    if (_cache) {
      // already have data; keep state in sync (covers the case where an
      // earlier caller primed the cache between the initial state and
      // first effect run).
      setState({ tools: _cache.tools, loading: false, error: null });
      return () => { cancelled = true; };
    }
    setState(s => ({ ...s, loading: true, error: null }));
    fetchToolsOnce()
      .then(({ tools }) => {
        if (!cancelled) setState({ tools, loading: false, error: null });
      })
      .catch(err => {
        if (!cancelled) setState({ tools: [], loading: false, error: err.message || String(err) });
      });
    return () => { cancelled = true; };
  }, []);

  // Derive the view the caller actually wants (filtered + sorted +
  // grouped-by-category). Memoised so consumers can include this hook
  // inside render paths without triggering spurious re-renders.
  const view = useMemo(() => {
    let tools = state.tools;

    if (sortBy === 'category-then-name') {
      tools = [...tools].sort((a, b) => {
        const c = (a.category || 'Other').localeCompare(b.category || 'Other');
        if (c !== 0) return c;
        return a.name.localeCompare(b.name);
      });
    } else {
      tools = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    }

    const byCategory = {};
    for (const t of tools) {
      const cat = t.category || 'Other';
      (byCategory[cat] = byCategory[cat] || []).push(t);
    }

    return { tools, byCategory, categories: Object.keys(byCategory) };
  }, [state.tools, sortBy]);

  return {
    tools: view.tools,
    byCategory: view.byCategory,
    categories: view.categories,
    loading: state.loading,
    error: state.error,
  };
}

export default useAvailableTools;
