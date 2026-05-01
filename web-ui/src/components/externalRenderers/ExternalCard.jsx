/**
 * ExternalCard — shared chrome for every external-block render.
 *
 * Provides the outer panel + header row (icon + target label + optional
 * "drafting" indicator). The body is a slot so each platform renderer
 * can style message content natively (Discord markdown flavor, Telegram
 * quote style, etc.).
 *
 * Props:
 *   icon       : React element — small SVG or glyph for the header
 *   accentClass: Tailwind class for the left border accent stripe
 *   bodyClass  : Tailwind classes for the body slot (bg, text color)
 *   label      : target descriptor, e.g. "To Discord > #ops"
 *   streaming  : when true, show the "✎ drafting…" header pill + pulse border
 *   children   : message body (usually ReactMarkdown render)
 */

import React from 'react';

function ExternalCard({ icon, accentClass, bodyClass, label, streaming = false, children }) {
  return (
    <div
      className={[
        'my-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm',
        // Left-accent stripe hints the target platform at a glance.
        'relative',
        streaming ? 'animate-[pulse_2.5s_ease-in-out_infinite]' : '',
      ].join(' ')}
    >
      {/* Left accent stripe */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentClass}`} aria-hidden="true" />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700 pl-4">
        <span className="shrink-0">{icon}</span>
        <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
          {label}
        </span>
        {streaming && (
          <span className="ml-auto text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 shrink-0">
            ✎ drafting…
          </span>
        )}
      </div>

      {/* Body */}
      <div className={`px-4 py-2 pl-4 text-sm ${bodyClass}`}>
        {children}
      </div>
    </div>
  );
}

export default ExternalCard;
