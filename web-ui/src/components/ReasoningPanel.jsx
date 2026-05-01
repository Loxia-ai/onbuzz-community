/**
 * ReasoningPanel — collapsible "thinking" surface for messages produced
 * by reasoning-capable models.
 *
 * What it shows:
 *   - Always a small pill header: "🧠 Thought for N tokens · show"
 *     (or "click to expand" when no token count is known).
 *   - When expanded: a muted monospace-ish panel containing the chain of
 *     thought the model produced alongside the visible answer. The actual
 *     answer renders in the parent bubble unchanged.
 *
 * When NOT to render: both `reasoning` is empty AND `reasoningTokens` is
 * falsy/null. A reasoning-capable model that skipped thinking on this
 * turn (or a non-reasoning model) produces no panel.
 *
 * Provenance:
 *   - DeepSeek-R1 / xAI reasoning / Kimi thinking → `reasoning` has text.
 *   - OpenAI o-series / gpt-5-*-reasoning       → typically `reasoningTokens`
 *     only (text content is opaque by provider policy).
 *   - Claude thinking mode                       → `reasoning` has text, or
 *     '[redacted thinking block]' when encrypted.
 *
 * Default state is COLLAPSED — reasoning can be long, and most operators
 * only want to inspect it occasionally. State is local to the component
 * (resets on mount), not stashed in the store.
 */

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

/**
 * @param {Object} props
 * @param {string} [props.reasoning]            Chain-of-thought text. Empty/omitted → no expandable body.
 * @param {number} [props.reasoningTokens]      Count of reasoning tokens the model spent. Null → unknown.
 * @param {boolean} [props.streaming]           When true, renders a pulsing "thinking…" indicator even
 *                                              if no reasoning content has arrived yet.
 * @param {boolean} [props.defaultOpen=false]   Override collapse state for specific contexts (e.g. tests).
 */
function ReasoningPanel({ reasoning = '', reasoningTokens = null, streaming = false, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  const hasText = typeof reasoning === 'string' && reasoning.length > 0;
  const hasCount = typeof reasoningTokens === 'number' && reasoningTokens > 0;

  // Render nothing when there's genuinely nothing to show. A streaming
  // reasoning-model with no chunks yet still qualifies (caller passes
  // streaming=true explicitly), so we render a pulse in that case.
  if (!hasText && !hasCount && !streaming) return null;

  // Header label — three cases:
  //   - Streaming & nothing yet: "🧠 thinking…"
  //   - Have count (with or without text): "🧠 Thought for 4,217 tokens"
  //   - Have text but no count: "🧠 Thinking trace"
  let label;
  if (streaming && !hasText && !hasCount) {
    label = '🧠 thinking…';
  } else if (hasCount) {
    const formatted = reasoningTokens.toLocaleString();
    label = `🧠 Thought for ${formatted} token${reasoningTokens === 1 ? '' : 's'}`;
  } else {
    label = '🧠 Thinking trace';
  }

  // Expandable when there's text to show. Count-only or streaming-only
  // renders as a read-only pill.
  const expandable = hasText;

  return (
    <div
      data-testid="reasoning-panel"
      className={[
        'my-2 rounded-md border text-xs overflow-hidden',
        'border-purple-200 dark:border-purple-800/50',
        'bg-purple-50/40 dark:bg-purple-950/20',
        streaming ? 'animate-[pulse_2.5s_ease-in-out_infinite]' : '',
      ].join(' ')}
    >
      <button
        type="button"
        disabled={!expandable}
        onClick={() => expandable && setOpen(o => !o)}
        className={[
          'w-full flex items-center gap-2 px-2.5 py-1 text-left',
          'text-purple-700 dark:text-purple-300',
          expandable ? 'hover:bg-purple-100/40 dark:hover:bg-purple-900/20 cursor-pointer' : 'cursor-default',
          'transition-colors',
        ].join(' ')}
        aria-expanded={expandable ? open : undefined}
        aria-label={expandable ? (open ? 'Collapse thinking trace' : 'Expand thinking trace') : undefined}
      >
        {expandable && (
          open
            ? <ChevronDownIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            : <ChevronRightIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="font-medium">{label}</span>
        {expandable && !open && (
          <span className="ml-auto text-[10px] uppercase tracking-wider opacity-60">show</span>
        )}
        {streaming && (
          <span className="ml-auto text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400">
            live
          </span>
        )}
      </button>

      {expandable && open && (
        <div
          data-testid="reasoning-panel-body"
          className={[
            'px-3 py-2 border-t border-purple-200 dark:border-purple-800/50',
            'text-gray-700 dark:text-gray-300',
            'prose prose-xs dark:prose-invert max-w-none',
            // Monospace-leaning to signal "inner thoughts, not prose".
            '[&_p]:my-1 [&_p]:font-mono [&_p]:text-[11px] [&_p]:leading-relaxed',
          ].join(' ')}
        >
          <ReactMarkdown>{reasoning}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

export default ReasoningPanel;
