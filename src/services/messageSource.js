/**
 * Message source — provenance metadata for inbound user messages.
 *
 * Attached at the inbound-service boundary (Discord / Telegram inbound),
 * preserved verbatim through the orchestrator -> messageProcessor ->
 * agentPool pipeline, and rendered as a single attribution line prepended
 * to the message content so the agent can see where the message arrived
 * from and decide for itself how to respond.
 *
 * Design notes
 * ------------
 *  - Pure module. No discord.js / node-telegram-bot-api imports. Tests run
 *    without network, DB, or platform-SDK setup.
 *  - Factories are defensive: they accept the full platform message object
 *    and tolerate missing fields rather than throwing. A partial source is
 *    better than no source for the agent to reason about.
 *  - Output is deeply frozen so downstream code can't silently mutate
 *    provenance. Surprising mutation of a source once it's on a queued
 *    message would be a correctness nightmare to debug.
 *  - `alias` is chosen to match the strings advertised by
 *    discordService.getBridgedChannels / telegramService.getBridgedChannels,
 *    so <external to="…"> routing composes with channelFilter's substring
 *    matching without any translation layer.
 *  - `describeSource(src)` returns a human-readable attribution for the
 *    header; `prependSourceHeader(content, src)` is idempotent so replaying
 *    a message through the pipeline never double-prefixes.
 */

/**
 * Exhaustive discriminator for the source kind. Adding a new kind is a
 * deliberate act — downstream consumers (the scheduler's prompt injector,
 * the relay services) switch on this value.
 */
export const MESSAGE_SOURCE_KINDS = Object.freeze({
  DISCORD: 'discord',
  TELEGRAM: 'telegram',
  WEB: 'web',
  API: 'api',
  INTERNAL: 'internal',
});

/**
 * @typedef {Object} MessageSource
 * @property {'discord'|'telegram'|'web'|'api'|'internal'} kind
 * @property {string} alias
 * @property {string} sessionId
 * @property {Object} raw  Kind-specific identifiers (channel ids, user ids, …)
 */

/**
 * Deep-freeze a plain object tree. Keeps the source literal-immutable so
 * any code that treats it as a value-object is safe.
 * @param {any} value
 * @returns {any}
 */
function freezeDeep(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) {
    freezeDeep(value[key]);
  }
  return Object.freeze(value);
}

// ────────────────────────────────────────────────────────────────────────
// Discord
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a MessageSource from a discord.js Message object.
 *
 * Tolerant of missing fields: DMs have no guild, non-threaded channels
 * have no parent, bot-posted messages have no author — each just produces
 * a `null` in the raw payload and is gracefully handled by describeSource.
 *
 * @param {Object} discordMessage  discord.js Message
 * @returns {MessageSource}
 */
export function createDiscordSource(discordMessage) {
  const msg = discordMessage || {};
  const channel = msg.channel || {};
  const guild = msg.guild || null;
  const author = msg.author || {};

  const isThread = typeof channel.isThread === 'function'
    ? !!channel.isThread()
    : false;

  const raw = {
    messageId: msg.id ?? null,
    channelId: channel.id ?? null,
    channelName: channel.name ?? null,
    authorId: author.id ?? null,
    authorName: author.username ?? author.globalName ?? null,
    guildId: guild?.id ?? null,
    guildName: guild?.name ?? null,
    // Thread metadata: threadId/threadName are set only when the message
    // arrived inside a thread. parentChannel* records the channel the
    // thread lives under, so describeSource can render the full path.
    threadId: isThread ? (channel.id ?? null) : null,
    threadName: isThread ? (channel.name ?? null) : null,
    parentChannelId: isThread ? (channel.parentId ?? null) : null,
    parentChannelName: isThread ? (channel.parent?.name ?? null) : null,
  };

  const alias = _computeDiscordAlias(raw);
  const sessionId = `discord-${raw.guildId || 'dm'}-${raw.channelId || 'unknown'}`;

  return freezeDeep({
    kind: MESSAGE_SOURCE_KINDS.DISCORD,
    alias,
    sessionId,
    raw,
  });
}

/**
 * Canonical Discord alias. Format matches discordService.getBridgedChannels
 * output so the agent can round-trip an alias from the bridged-channel list
 * back through `<external to="…">` with no translation.
 *
 * For threads we still alias by the thread's own channel id / name because
 * that's what the relay dispatches to. The parent channel is only used for
 * the human-readable label.
 * @private
 */
function _computeDiscordAlias(raw) {
  if (raw.channelName) return `discord:#${raw.channelName}`;
  if (raw.channelId) return `discord:${raw.channelId}`;
  return 'discord:unknown';
}

// ────────────────────────────────────────────────────────────────────────
// Telegram
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a MessageSource from a node-telegram-bot-api Message object.
 *
 * @param {Object} telegramMessage  node-telegram-bot-api Message
 * @returns {MessageSource}
 */
export function createTelegramSource(telegramMessage) {
  const msg = telegramMessage || {};
  const chat = msg.chat || {};
  const from = msg.from || {};

  const raw = {
    messageId: msg.message_id ?? null,
    chatId: chat.id ?? null,
    chatType: chat.type ?? null,      // 'private' | 'group' | 'supergroup' | 'channel'
    chatTitle: chat.title ?? null,
    userId: from.id ?? null,
    userName: from.username ?? from.first_name ?? null,
  };

  // Telegram's relay service today is single-chat-per-instance and
  // advertises the bare alias `telegram`. For per-chat addressability we
  // emit `telegram:chat-<id>` which matches exactly one owned alias when
  // the service's bridge list grows richer, and still substring-matches
  // `telegram` (the current owned alias) when it doesn't.
  const alias = raw.chatId != null ? `telegram:chat-${raw.chatId}` : 'telegram';
  const sessionId = `telegram-${raw.chatId ?? 'unknown'}`;

  return freezeDeep({
    kind: MESSAGE_SOURCE_KINDS.TELEGRAM,
    alias,
    sessionId,
    raw,
  });
}

// ────────────────────────────────────────────────────────────────────────
// Web / API / Internal  (null-object-ish; produces no header)
// ────────────────────────────────────────────────────────────────────────

/**
 * @param {{ sessionId?: string, userName?: string }} [info]
 * @returns {MessageSource}
 */
export function createWebSource(info = {}) {
  const sessionId = info.sessionId || 'web-unknown';
  return freezeDeep({
    kind: MESSAGE_SOURCE_KINDS.WEB,
    alias: `web:${sessionId}`,
    sessionId,
    raw: { sessionId, userName: info.userName ?? null },
  });
}

/**
 * For scheduler / flow-injected messages where no human channel is behind
 * the send. `describeSource` returns null for internal sources so no
 * header is prepended — the agent sees the raw content as before.
 * @param {string} [reason]
 * @returns {MessageSource}
 */
export function createInternalSource(reason = 'internal') {
  return freezeDeep({
    kind: MESSAGE_SOURCE_KINDS.INTERNAL,
    alias: `internal:${reason}`,
    sessionId: `internal-${reason}`,
    raw: { reason },
  });
}

// ────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────

/**
 * Produce the human-readable attribution sentence for a source, or null
 * when the source is absent / of a kind that doesn't warrant a header
 * (web, api, internal — those interactions don't need to teach the agent
 * where the message came from).
 *
 * Output shape (examples):
 *   Discord guild channel    → "Message by alice from Discord > MyGuild > #ops"
 *   Discord thread           → "Message by alice from Discord > MyGuild > #ops > Deploy thread"
 *   Discord DM               → "Message by alice from Discord > DM"
 *   Telegram group           → "Message by alice from Telegram > Ops Chat"
 *   Telegram private         → "Message by alice from Telegram > DM"
 *
 * @param {MessageSource|null|undefined} source
 * @returns {string|null}
 */
export function describeSource(source) {
  if (!source || typeof source !== 'object') return null;
  const raw = source.raw || {};

  switch (source.kind) {
    case MESSAGE_SOURCE_KINDS.DISCORD: {
      const user = raw.authorName || 'unknown user';
      const parts = ['Discord'];
      // Thread path: Discord > Guild > #parent > ThreadName
      // Flat path:   Discord > Guild > #channel
      // DM path:     Discord > DM
      if (raw.guildName) parts.push(raw.guildName);

      if (raw.parentChannelName || raw.threadName) {
        if (raw.parentChannelName) parts.push(`#${raw.parentChannelName}`);
        if (raw.threadName) parts.push(raw.threadName);
      } else if (raw.channelName) {
        parts.push(`#${raw.channelName}`);
      }

      // No guild and no channel name usually means a DM (or a stripped-down
      // test fixture). Label it as DM rather than leaving a bare "Discord".
      if (parts.length === 1) parts.push('DM');

      return `Message by ${user} from ${parts.join(' > ')}`;
    }

    case MESSAGE_SOURCE_KINDS.TELEGRAM: {
      const user = raw.userName || 'unknown user';
      const parts = ['Telegram'];
      if (raw.chatType === 'private') {
        parts.push('DM');
      } else if (raw.chatTitle) {
        parts.push(raw.chatTitle);
      } else if (raw.chatId != null) {
        parts.push(`chat ${raw.chatId}`);
      } else {
        parts.push('DM');
      }
      return `Message by ${user} from ${parts.join(' > ')}`;
    }

    case MESSAGE_SOURCE_KINDS.WEB:
    case MESSAGE_SOURCE_KINDS.API:
    case MESSAGE_SOURCE_KINDS.INTERNAL:
    default:
      return null;
  }
}

/**
 * Format the header line — a parenthesized describeSource() output — or
 * empty string when the source has no describable shape.
 * @param {MessageSource|null|undefined} source
 * @returns {string}
 */
export function formatSourceHeader(source) {
  const desc = describeSource(source);
  return desc ? `(${desc})` : '';
}

/**
 * Prepend the source attribution header to a user message's content.
 *
 * Idempotent: if the content already begins with the exact header line,
 * nothing is added. This keeps the pipeline safe against re-serialization
 * (state restore, compaction, retry) without baking a "did-we-prefix" flag
 * into the message shape.
 *
 * @param {string} content
 * @param {MessageSource|null|undefined} source
 * @returns {string}
 */
export function prependSourceHeader(content, source) {
  const header = formatSourceHeader(source);
  if (!header) return typeof content === 'string' ? content : String(content ?? '');

  const text = typeof content === 'string' ? content : String(content ?? '');
  if (text.startsWith(header)) return text;
  return `${header}\n${text}`;
}

export default {
  MESSAGE_SOURCE_KINDS,
  createDiscordSource,
  createTelegramSource,
  createWebSource,
  createInternalSource,
  describeSource,
  formatSourceHeader,
  prependSourceHeader,
};
