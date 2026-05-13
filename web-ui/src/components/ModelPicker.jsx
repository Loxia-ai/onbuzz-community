/**
 * ModelPicker — shared model-selection UI used by AgentCreationModal and
 * AgentEditModal. Renders a search input and a grid of selectable model
 * cards grouped by category, with a provider chip on every row.
 *
 * The picker owns:
 *   - search/filter state (substring match across model name, id,
 *     provider id, and provider label)
 *   - loading + error rendering for useModelsStore
 *   - "no results" empty state
 *
 * The picker does NOT own:
 *   - the form value — controlled via `value` / `onChange`
 *   - any modal chrome, accordion, or tab routing — that belongs to the
 *     parent (the creation modal still wraps this in a collapsible panel)
 */

import React, { useMemo, useState } from 'react';
import { MagnifyingGlassIcon, XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useModelsStore } from '../stores/modelsStore.js';
import LoadingSpinner from './LoadingSpinner.jsx';
import { providerLabel, providerBadgeClass, FEATURE_BADGE_CLASS, cleanDisplayName } from '../utilities/providerBadge.js';

function modelMatchesQuery(model, q) {
  if (!q) return true;
  const haystacks = [
    cleanDisplayName(model.displayName || model.name),
    model.id || '',
    model.provider || '',
    providerLabel(model.provider),
  ];
  return haystacks.some(s => s.toLowerCase().includes(q));
}

function ModelPicker({ value, onChange, disabled = false, idPrefix = 'model-picker' }) {
  // Subscribe to `models` so this component re-renders when the store
  // hydrates after an async fetch. `getModelsByCategory` is a stable
  // action reference — including only it in the memo deps would let the
  // picker cache an empty list forever if it mounted before models loaded.
  const { models, getModelsByCategory, loading, error } = useModelsStore();
  const [search, setSearch] = useState('');

  const q = search.trim().toLowerCase();

  // Categories whose models all filter out are hidden so the user
  // doesn't see empty group headers while searching.
  const visibleCategories = useMemo(() => {
    const categories = getModelsByCategory();
    return Object.entries(categories || {})
      .map(([key, cat]) => ({
        key,
        title: (cat.title || '').replace(' (Platform)', '').replace(' (Direct)', ''),
        badge: cat.badge,
        models: (cat.models || []).filter(m => modelMatchesQuery(m, q)),
      }))
      .filter(c => c.models.length > 0);
    // `models` is the load-bearing dep — see comment above the destructure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, q]);

  const totalShown = visibleCategories.reduce((n, c) => n + c.models.length, 0);

  return (
    <div className="space-y-3" data-testid="model-picker">
      {/* Search */}
      <div className="relative">
        <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by model or provider (e.g. claude, openai, gpt-4)"
          disabled={disabled}
          aria-label="Search models"
          className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-loxia-500 disabled:opacity-50"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            disabled={disabled}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-50"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Loading from useModelsStore */}
      {loading && (
        <div className="flex items-center justify-center py-4">
          <LoadingSpinner size="sm" />
          <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
            Loading models...
          </span>
        </div>
      )}

      {/* Error from useModelsStore */}
      {error && (
        <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <div className="flex items-center text-xs">
            <ExclamationTriangleIcon className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mr-2 flex-shrink-0" />
            <span className="text-yellow-800 dark:text-yellow-200">
              Using fallback models. Some may not be available.
            </span>
          </div>
        </div>
      )}

      {/* Empty state — both for "no models loaded" and "no search hits" */}
      {!loading && totalShown === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
          {q ? `No models match "${search}".` : 'No models available.'}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleCategories.map((cat) => (
            <div key={cat.key}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {cat.title}
                </h3>
                {cat.badge && (
                  <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                    cat.key === 'cloud'
                      ? 'bg-loxia-100 text-loxia-700 dark:bg-loxia-900/30 dark:text-loxia-300'
                      : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  }`}>
                    {cat.badge}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 items-stretch">
                {cat.models.map((model) => {
                  const isUnavailable = model.requiresKey && !model.available;
                  const isDisabled = disabled || isUnavailable;
                  const isSelected = value === model.id;
                  const displayName = cleanDisplayName(model.displayName || model.name);
                  const inputId = `${idPrefix}-${model.id}`;

                  return (
                    <label
                      key={model.id}
                      htmlFor={inputId}
                      className={`relative ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                      tabIndex={isDisabled ? -1 : 0}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && !isDisabled) {
                          e.preventDefault();
                          onChange(model.id);
                        }
                      }}
                    >
                      <input
                        id={inputId}
                        type="radio"
                        name={idPrefix}
                        value={model.id}
                        checked={isSelected}
                        onChange={(e) => onChange(e.target.value)}
                        className="sr-only"
                        disabled={isDisabled}
                      />
                      <div
                        className={`h-full p-2 rounded-lg border text-center transition-all flex flex-col justify-center ${
                          isSelected
                            ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/20 ring-1 ring-loxia-500'
                            : isDisabled
                            ? 'border-gray-200 dark:border-gray-700 opacity-40'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          <span
                            className={`text-sm font-medium ${
                              isSelected
                                ? 'text-loxia-700 dark:text-loxia-300'
                                : 'text-gray-900 dark:text-gray-100'
                            }`}
                          >
                            {displayName}
                          </span>
                          <span className={providerBadgeClass(model.provider)}>
                            {providerLabel(model.provider)}
                          </span>
                          {model.features?.supportsVision && (
                            <span className={FEATURE_BADGE_CLASS}>
                              Vision
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 min-h-[14px]">
                          {isUnavailable ? (
                            <span className="text-red-500 dark:text-red-400">Key required</span>
                          ) : model.pricing ? (
                            <span>${model.pricing.input}/${model.pricing.output}</span>
                          ) : (
                            <span>&nbsp;</span>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ModelPicker;
