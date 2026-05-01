import React, { useState, useRef, useEffect } from 'react';
import { XMarkIcon, ShareIcon, SparklesIcon, DocumentPlusIcon } from '@heroicons/react/24/outline';
import { STARTER_TEMPLATES } from '../../utils/flowTemplates.js';

/**
 * Modal for creating a new flow.
 *
 * Two-step UX: pick a starting point (blank canvas OR one of the typed
 * v2 starter templates) → name it → create. Templates pre-populate
 * nodes, edges, and typed inputs/outputs so the user starts from a
 * working multi-agent pipeline rather than an empty canvas.
 */
function FlowCreationModal({ onClose, onCreate }) {
  // Step 1 = pick starting point, Step 2 = name + describe
  const [step, setStep] = useState(1);
  // 'blank' or template key
  const [selectedKey, setSelectedKey] = useState('blank');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const nameInputRef = useRef(null);

  // Focus name input when entering step 2
  useEffect(() => {
    if (step === 2) nameInputRef.current?.focus();
  }, [step]);

  const handlePickTemplate = (key) => {
    setSelectedKey(key);
    if (key !== 'blank') {
      const tpl = STARTER_TEMPLATES.find(t => t.key === key);
      if (tpl) {
        // Pre-populate name + description from the template; user can edit
        setName(tpl.label);
        setDescription(tpl.description);
      }
    } else {
      setName('');
      setDescription('');
    }
    setStep(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Flow name is required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const tpl = selectedKey !== 'blank' ? STARTER_TEMPLATES.find(t => t.key === selectedKey) : null;
      await onCreate({
        name: name.trim(),
        description: description.trim(),
        nodes:     tpl ? tpl.flow.nodes     : [],
        edges:     tpl ? tpl.flow.edges     : [],
        variables: tpl ? (tpl.flow.variables || {}) : {},
        // Stamp v2 if template is v2 so the editor knows to render typed I/O
        ...(tpl?.flow?.schemaVersion ? { schemaVersion: tpl.flow.schemaVersion } : {}),
      });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full mx-4 animate-fadeInScale ${step === 1 ? 'max-w-3xl' : 'max-w-md'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-loxia-100 dark:bg-loxia-900/50 rounded-lg flex items-center justify-center">
              <ShareIcon className="w-5 h-5 text-loxia-600 dark:text-loxia-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {step === 1 ? 'Start a New Flow' : 'Name Your Flow'}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {step === 1
                  ? 'Pick a template or start from scratch'
                  : 'Give it a name and short description'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Step 1: template picker */}
        {step === 1 && (
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Blank canvas card */}
              <button
                type="button"
                onClick={() => handlePickTemplate('blank')}
                className="text-left p-4 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-loxia-500 dark:hover:border-loxia-400 hover:bg-loxia-50 dark:hover:bg-loxia-900/10 transition-colors group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <DocumentPlusIcon className="w-5 h-5 text-gray-400 group-hover:text-loxia-500" />
                  <span className="font-semibold text-gray-900 dark:text-gray-100">Blank canvas</span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Start from scratch. Add nodes and edges yourself.
                </p>
              </button>

              {/* Template cards */}
              {STARTER_TEMPLATES.map(tpl => (
                <button
                  key={tpl.key}
                  type="button"
                  onClick={() => handlePickTemplate(tpl.key)}
                  className="text-left p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-loxia-500 dark:hover:border-loxia-400 hover:bg-loxia-50 dark:hover:bg-loxia-900/10 transition-colors group"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <SparklesIcon className="w-5 h-5 text-loxia-500" />
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{tpl.label}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-loxia-600 dark:text-loxia-400 bg-loxia-100 dark:bg-loxia-900/30 px-1.5 py-0.5 rounded">
                      {tpl.flow.nodes.length} nodes
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-3">
                    {tpl.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: name + description */}
        {step === 2 && (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {selectedKey !== 'blank' && (
              <div className="flex items-center gap-2 px-3 py-2 bg-loxia-50 dark:bg-loxia-900/20 border border-loxia-200 dark:border-loxia-800 rounded-lg text-sm text-loxia-700 dark:text-loxia-300">
                <SparklesIcon className="w-4 h-4" />
                <span>Starting from <strong>{STARTER_TEMPLATES.find(t => t.key === selectedKey)?.label}</strong></span>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="ml-auto text-xs underline hover:no-underline"
                >
                  Change
                </button>
              </div>
            )}

            <div>
              <label htmlFor="flow-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Flow Name <span className="text-red-500">*</span>
              </label>
              <input
                ref={nameInputRef}
                id="flow-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Code Review Pipeline"
                className="input-primary"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="flow-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                id="flow-description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Describe what this flow does..."
                rows={3}
                className="input-primary resize-none"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                disabled={loading}
              >
                ← Back
              </button>
              <div className="flex items-center space-x-3">
                <button type="button" onClick={onClose} className="button-secondary" disabled={loading}>
                  Cancel
                </button>
                <button type="submit" className="button-primary" disabled={loading || !name.trim()}>
                  {loading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Creating...
                    </>
                  ) : (
                    'Create Flow'
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default FlowCreationModal;
