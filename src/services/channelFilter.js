/**
 * Channel filter — parses `<external to="alias">…</external>` blocks out of
 * agent content so Discord / Telegram relays know what (and where) to send.
 *
 * Philosophy:
 *   - Default is local. Nothing reaches an external channel unless the agent
 *     explicitly wraps it in `<external>` tags. The local operator's web UI
 *     continues to receive the raw WS broadcast unfiltered.
 *   - Content inside `<external>` is relayed VERBATIM. Code, markdown, tool
 *     JSON, task lists — all pass through. The agent decides; the filter
 *     doesn't second-guess content shape.
 *   - Granular routing via `to="alias"`:
 *       <external>…</external>                   default  → broadcast to every bridged channel
 *       <external to="*">…</external>            explicit → broadcast to every bridged channel
 *       <external to="discord:#ops">…</external>          → that specific channel only
 *       <external to="discord:#ops,telegram">…</external> → both listed channels
 *
 * API-path agnostic: runs on the fully-assembled assistant content emitted
 * on the `stream_complete` WS broadcast. Both Responses API and Chat
 * Completions converge on the same canonical content shape before that
 * broadcast fires, so this filter is one pure function with no
 * provider-specific branch.
 */

// Matches `<external>…</external>` or `<external to="…">…</external>` (case-insensitive).
// The `to` attribute may be single- or double-quoted. Captured groups:
//   1: the raw contents of the `to` attribute (or undefined)
//   2: block body
const EXTERNAL_TAG_RE =
  /<external(?:\s+to\s*=\s*(?:"([^"]*)"|'([^']*)'))?>([\s\S]*?)<\/external>/gi;

/**
 * Parse every `<external>` block out of an agent content string.
 *
 * @param {string} content Raw assistant content.
 * @returns {{ blocks: Array<{ to: string[]|null, text: string }> }}
 *          `to === null`   → default routing (broadcast to every bridged
 *                             channel the relaying service owns).
 *          `to === ['*']`  → explicit broadcast (same as null).
 *          `to === ['discord:#ops', 'telegram']` → specific aliases.
 *          Callers (Discord / Telegram services) match their own aliases
 *          against each block's `to` and send the `text` to matching
 *          channels. `text` is the verbatim block contents with leading
 *          and trailing whitespace trimmed — no other transformation.
 */
export function filterContentForExternalRelay(content) {
  if (typeof content !== 'string' || content.length === 0) return { blocks: [] };

  const blocks = [];
  let m;
  EXTERNAL_TAG_RE.lastIndex = 0;
  while ((m = EXTERNAL_TAG_RE.exec(content)) !== null) {
    const rawTo = m[1] ?? m[2] ?? null;
    const body = (m[3] ?? '').replace(/^\s+|\s+$/g, '');
    if (body.length === 0) continue;

    let to = null;
    if (rawTo !== null && rawTo.trim().length > 0) {
      to = rawTo.split(',').map(s => s.trim()).filter(Boolean);
      if (to.length === 0) to = null;
    }
    blocks.push({ to, text: body });
  }
  return { blocks };
}

/**
 * Given a parsed block and the list of aliases a relay service owns,
 * return the subset of aliases that should receive this block.
 *
 * A block with `to === null` or `to === ['*']` matches every owned alias.
 * Otherwise the block's `to` list is matched case-insensitively against
 * the service's aliases, with substring fallback so a block addressed to
 * `discord:#ops` matches an owned alias `discord:guild-123:#ops` (useful
 * because Discord aliases can carry guild prefixes the agent may omit).
 *
 * @param {{to: string[]|null, text: string}} block
 * @param {string[]} ownedAliases  Aliases this relay service handles.
 * @returns {string[]} Subset of `ownedAliases` that should receive the block.
 */
export function resolveBlockTargets(block, ownedAliases) {
  if (!Array.isArray(ownedAliases) || ownedAliases.length === 0) return [];
  if (!block.to || (block.to.length === 1 && block.to[0] === '*')) {
    return [...ownedAliases];
  }
  const wanted = block.to.map(s => s.toLowerCase());
  const matched = new Set();
  for (const owned of ownedAliases) {
    const ownedLc = String(owned).toLowerCase();
    for (const w of wanted) {
      if (ownedLc === w || ownedLc.endsWith(w) || ownedLc.includes(w)) {
        matched.add(owned);
        break;
      }
    }
  }
  return [...matched];
}

/**
 * System-prompt paragraph listing the currently bridged channels and
 * explaining the `<external to="…">` addressing scheme. The scheduler
 * appends this once per turn, only when at least one channel is bridged.
 *
 * @param {Array<{alias:string, label?:string}>} channels
 *        List of bridged channels the agent can address. `alias` is the
 *        handle the agent uses in `to=`; `label` is a human-readable
 *        description surfaced alongside the alias in the prompt.
 * @returns {string} Guidance paragraph (empty string when channels is empty).
 */
export function getExternalChannelPromptGuidance(channels = []) {
  if (!Array.isArray(channels) || channels.length === 0) return '';

  const list = channels.map(c => {
    const alias = String(c?.alias || '').trim();
    if (!alias) return null;
    const label = String(c?.label || '').trim();
    return label ? `  - \`${alias}\` — ${label}` : `  - \`${alias}\``;
  }).filter(Boolean).join('\n');

  if (!list) return '';

  return (
    `\n\n## OUTPUT ROUTING\n` +
    `This agent is bridged to external messaging channels. NOTHING you write is forwarded by default — your full response stays local for the operator, who sees everything unfiltered via the web UI.\n\n` +
    `To send content to an external channel, wrap it in \`<external>…</external>\` tags. Content inside the tags is relayed verbatim (markdown, code blocks, tool summaries, task lists — whatever you write there is what the channel sees). Content outside the tags is never forwarded.\n\n` +
    `Bridged channels you can address:\n${list}\n\n` +
    `Addressing:\n` +
    `  - \`<external>…</external>\` — broadcast to every bridged channel above.\n` +
    `  - \`<external to="alias">…</external>\` — send only to that alias.\n` +
    `  - \`<external to="aliasA,aliasB">…</external>\` — send to multiple specific aliases (comma-separated).\n` +
    `  - \`<external to="*">…</external>\` — same as default (explicit broadcast).\n\n` +
    `You can use multiple \`<external>\` blocks per response; each is delivered independently to its targets. Content with no \`<external>\` wrapper is never forwarded — perfect for private reasoning, tool calls, and inter-agent messages.`
  );
}

export default { filterContentForExternalRelay, resolveBlockTargets, getExternalChannelPromptGuidance };
