/**
 * BroadcastBlock — renders an unaddressed or wildcard external block
 * (broadcast to every bridged channel). Also used as the fallback for
 * aliases we don't recognize (platform 'other' / 'mixed').
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { MegaphoneIcon } from '@heroicons/react/24/outline';
import ExternalCard from './ExternalCard.jsx';

const BROADCAST_ACCENT = 'bg-amber-500';

function BroadcastBlock({ label, text, streaming = false }) {
  return (
    <ExternalCard
      icon={<MegaphoneIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
      accentClass={BROADCAST_ACCENT}
      bodyClass="bg-amber-50 dark:bg-amber-900/10 text-gray-900 dark:text-amber-100"
      label={label}
      streaming={streaming}
    >
      {text
        ? <div className="prose prose-sm dark:prose-invert max-w-none"><ReactMarkdown>{text}</ReactMarkdown></div>
        : <div className="italic text-gray-400 dark:text-gray-500">…</div>
      }
    </ExternalCard>
  );
}

export default BroadcastBlock;
