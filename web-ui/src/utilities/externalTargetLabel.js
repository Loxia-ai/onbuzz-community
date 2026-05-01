/**
 * externalTargetLabel — turn an external-channel alias (as written by the
 * agent in <external to="…">) into a human-readable target label for the
 * card header in the transcript.
 *
 * Symmetric with the inbound header: inbound renders as
 *   "(Message by alice from Discord > MyGuild > #ops)"
 * and outbound card labels read as
 *   "To Discord > #ops"
 *
 * We don't have the full guild metadata on the frontend from the alias
 * alone — aliases are intentionally short (`discord:#ops`, `telegram:chat-999`).
 * The renderer augments with richer data (guild name, chat title) when the
 * transcript tells us about bridged channels, but the base grammar works
 * from the bare alias.
 *
 * Pure module. No React, no state.
 */

/**
 * @typedef {'discord'|'telegram'|'broadcast'|'other'} TargetPlatform
 *
 * @typedef {Object} ParsedTarget
 * @property {TargetPlatform} platform
 * @property {string}        label     Human label, e.g. "Discord > #ops"
 * @property {string|null}   alias     Original alias (null for broadcast)
 */

/**
 * Parse a single alias string into a descriptor.
 *
 * Alias shapes understood:
 *   'discord:#ops'                  → Discord, channel #ops
 *   'discord:c-12345'               → Discord, channel id c-12345
 *   'discord:guild-1:#ops'          → Discord, channel #ops (guild prefix dropped from label)
 *   'telegram'                      → Telegram, unspecified chat
 *   'telegram:chat-999'             → Telegram, chat 999
 *   '*' or null                     → Broadcast (every bridged channel)
 *   anything else                   → platform 'other', label = raw alias
 *
 * @param {string|null|undefined} alias
 * @returns {ParsedTarget}
 */
export function parseTargetAlias(alias) {
  if (alias == null || alias === '*') {
    return { platform: 'broadcast', label: 'All bridged channels', alias: alias ?? null };
  }
  const raw = String(alias).trim();
  if (raw.length === 0 || raw === '*') {
    return { platform: 'broadcast', label: 'All bridged channels', alias: null };
  }
  const lower = raw.toLowerCase();

  if (lower.startsWith('discord:')) {
    // Strip "discord:" then drop any guild-prefix segment of the form
    // "guild-xxx:" (those aren't legible). What remains is the channel
    // identifier (#name or bare id).
    let rest = raw.slice('discord:'.length);
    rest = rest.replace(/^[^:]*:/, (seg) => /^guild[-_]/i.test(seg) ? '' : seg);
    const channel = rest || '(unknown)';
    return { platform: 'discord', label: `Discord > ${channel}`, alias: raw };
  }

  if (lower.startsWith('telegram:') || lower === 'telegram') {
    if (lower === 'telegram') {
      return { platform: 'telegram', label: 'Telegram', alias: raw };
    }
    const rest = raw.slice('telegram:'.length) || '(unknown)';
    // Friendlier display for chat-<id>: keep the id, just strip the prefix.
    const pretty = rest.replace(/^chat[-_]/i, 'chat ');
    return { platform: 'telegram', label: `Telegram > ${pretty}`, alias: raw };
  }

  return { platform: 'other', label: raw, alias: raw };
}

/**
 * Build the card title for an external block.
 *
 * - null / empty `to` (default/broadcast) → "To all bridged channels"
 * - single alias → "To Discord > #ops"
 * - multiple aliases → "To Discord > #ops, Telegram > chat 999"
 * - ['*'] → "To all bridged channels" (explicit broadcast)
 *
 * @param {string[]|null|undefined} to
 * @returns {{ platform: 'discord'|'telegram'|'broadcast'|'mixed'|'other', label: string, targets: ParsedTarget[] }}
 */
export function describeExternalTarget(to) {
  // null / empty / explicit single wildcard → broadcast
  if (!to || !Array.isArray(to) || to.length === 0 || (to.length === 1 && to[0] === '*')) {
    return {
      platform: 'broadcast',
      label: 'To all bridged channels',
      targets: [{ platform: 'broadcast', label: 'All bridged channels', alias: to?.[0] ?? null }],
    };
  }

  const targets = to.map(parseTargetAlias);
  const platforms = new Set(targets.map(t => t.platform));
  let platform = 'mixed';
  if (platforms.size === 1) {
    platform = targets[0].platform;
  }

  const joined = targets.map(t => t.label).join(', ');
  return { platform, label: `To ${joined}`, targets };
}

export default { parseTargetAlias, describeExternalTarget };
