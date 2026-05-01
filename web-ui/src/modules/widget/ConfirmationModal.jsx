/**
 * ConfirmationModal — asks the user whether this agent should be allowed
 * to render custom widgets. Two decision scopes:
 *
 *   "once"   — remember nothing, allow this render only
 *   "always" — persist per-agent via `localStorage` under
 *              `loxia-widget-allow-<agentId>`
 *   "block"  — persist a deny so this agent can't ask again until the
 *              user clears it from settings
 *
 * If the content triggers the phishing scanner, the modal copy escalates
 * and the "always" button becomes red-tinted (user has to think twice).
 *
 * Self-contained: no store dependencies, no global modal stack. Mounted
 * by WidgetRenderer only when needed and unmounted after the decision.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { ExclamationTriangleIcon, XMarkIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

function ConfirmationModal({ agentName, agentId, kind, content, phishingHits, onDecide, onClose }) {
  const hasPhishing = phishingHits && phishingHits.length > 0;

  // PORTAL: chat messages use CSS transform/filter for animations, which
  // create new stacking contexts. A z-[9999] INSIDE that context only
  // beats its siblings — global chrome painted later still sits on top and
  // swallows mouse clicks (tab focus still works since keyboard nav ignores
  // stacking). Rendering into document.body escapes every parent stacking
  // context so pointer events resolve against the modal as intended.
  const modal = (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="relative max-w-lg w-full bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            hasPhishing
              ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-300'
              : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300'
          }`}>
            <ExclamationTriangleIcon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {hasPhishing
                ? 'This widget asks for sensitive information'
                : `Allow ${agentName || 'this agent'} to render custom UI?`}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              <span className="font-mono">{agentId}</span> · kind: {kind}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close">
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 text-sm text-gray-700 dark:text-gray-300">
          {hasPhishing ? (
            <div className="p-3 rounded border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-200 text-xs space-y-1">
              <div><strong>⚠ Phishing-shape detected.</strong> The widget content mentions:</div>
              <ul className="list-disc pl-5 font-mono">
                {phishingHits.map(h => <li key={h}>{h}</li>)}
              </ul>
              <div>Loxia never asks for passwords or credit-card numbers in-chat. If this widget is asking, <strong>block it</strong>.</div>
            </div>
          ) : (
            <p>
              The widget runs in a sandboxed iframe with a null origin — it cannot access your cookies,
              make network requests, or touch the page around it. But rendering unknown code is always
              a trade-off; review the source first if you're not sure.
            </p>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              Preview source ({content?.length || 0} chars)
            </summary>
            <pre className="mt-2 p-2 bg-gray-50 dark:bg-gray-950 rounded overflow-auto max-h-48 whitespace-pre-wrap font-mono text-[11px]">
              {content?.slice(0, 4000)}{(content?.length || 0) > 4000 ? '\n…(truncated)…' : ''}
            </pre>
          </details>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <button
            type="button"
            onClick={() => onDecide('block')}
            className="px-3 py-1.5 text-sm text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded"
          >
            Block
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => onDecide('once')}
            className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            Allow once
          </button>
          <button
            type="button"
            onClick={() => onDecide('always')}
            className={`inline-flex items-center gap-1 px-4 py-1.5 text-sm font-medium rounded text-white ${
              hasPhishing
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-loxia-600 hover:bg-loxia-700'
            }`}
          >
            <ShieldCheckIcon className="w-4 h-4" />
            Always allow
          </button>
        </div>
      </div>
    </div>
  );

  // Render into document.body so no ancestor stacking context can hide us.
  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}

export default ConfirmationModal;

// ── decision persistence helpers (exported for WidgetRenderer + tests) ──

const LS_PREFIX = 'loxia-widget-allow-';

export function getStoredDecision(agentId) {
  try { return localStorage.getItem(LS_PREFIX + agentId); }
  catch { return null; }
}
export function storeDecision(agentId, decision) {
  try {
    if (decision === 'once') return; // don't persist
    localStorage.setItem(LS_PREFIX + agentId, decision);
  } catch {}
}
export function clearDecision(agentId) {
  try { localStorage.removeItem(LS_PREFIX + agentId); } catch {}
}
