/**
 * StringListEditor — text input + "Add" button that emits an array of
 * strings. Shared across per-tool configurators (terminal, filesystem,
 * web, agentcommunication). Input trims, dedupes, and lets Enter submit.
 *
 * Props:
 *   label:       string    — field label
 *   hint:        string    — helper text (optional)
 *   values:      string[]  — current values (falsy → treated as empty)
 *   onChange:    (string[]) => void — emits the new full array
 *   disabled:    boolean
 *   placeholder: string
 */

import React from 'react';

function StringListEditor({ label, hint, values, onChange, disabled, placeholder }) {
  const [input, setInput] = React.useState('');
  const list = Array.isArray(values) ? values : [];

  const handleAdd = () => {
    const v = input.trim();
    if (!v || list.includes(v)) { setInput(''); return; }
    onChange([...list, v]);
    setInput('');
  };
  const handleRemove = (v) => onChange(list.filter(x => x !== v));

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      {hint && <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">{hint}</p>}
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={input}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
          }}
          className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-loxia-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || !input.trim()}
          className="px-3 py-1 text-xs font-medium text-loxia-700 dark:text-loxia-300 bg-loxia-50 dark:bg-loxia-900/30 hover:bg-loxia-100 dark:hover:bg-loxia-900/50 rounded disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {list.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {list.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs font-mono text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700"
            >
              {v}
              <button
                type="button"
                onClick={() => handleRemove(v)}
                disabled={disabled}
                className="ml-1 text-gray-400 hover:text-red-500 disabled:opacity-50"
                aria-label={`Remove ${v}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] italic text-gray-400">(none)</p>
      )}
    </div>
  );
}

export default StringListEditor;
