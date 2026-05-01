/**
 * ExternalBlockRenderer — dispatcher for <external> segments.
 *
 * Given a parsed block (from utilities/parseExternalBlocks.js), picks the
 * platform-specific card renderer (Discord / Telegram / Broadcast) based
 * on the target alias(es) via utilities/externalTargetLabel.js.
 *
 * Also handles the streaming variant: when `streaming` is true the card
 * shows a skeleton / "drafting…" state and the body reflects whatever
 * partial text has arrived so far.
 *
 * Props:
 *   to        : string[] | null   The parsed `to=` attribute list.
 *   text      : string            Block body (possibly empty while streaming).
 *   streaming : boolean           True when block hasn't closed yet.
 */

import React, { useMemo } from 'react';
import { describeExternalTarget } from '../../utilities/externalTargetLabel.js';
import DiscordBlock from './DiscordBlock.jsx';
import TelegramBlock from './TelegramBlock.jsx';
import BroadcastBlock from './BroadcastBlock.jsx';

function ExternalBlockRenderer({ to, text, streaming = false }) {
  const descriptor = useMemo(() => describeExternalTarget(to), [to]);

  const common = { label: descriptor.label, text, streaming };

  switch (descriptor.platform) {
    case 'discord':
      return <DiscordBlock {...common} />;
    case 'telegram':
      return <TelegramBlock {...common} />;
    case 'broadcast':
    case 'mixed':
    case 'other':
    default:
      return <BroadcastBlock {...common} />;
  }
}

export default ExternalBlockRenderer;
