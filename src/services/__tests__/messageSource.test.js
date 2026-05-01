/**
 * Tests for messageSource — the pure provenance module.
 *
 * Scope: exhaustive factory + describeSource coverage. These are the
 * contract tests for the shape that every other piece of the
 * source-awareness feature relies on, so the surface is probed widely:
 * happy paths, every DM / group / thread variant, missing-field
 * degradation, frozen-object invariants, and idempotency of the header
 * prepender.
 */

import { describe, test, expect } from '@jest/globals';
import {
  MESSAGE_SOURCE_KINDS,
  createDiscordSource,
  createTelegramSource,
  createWebSource,
  createInternalSource,
  describeSource,
  formatSourceHeader,
  prependSourceHeader,
} from '../messageSource.js';

// ────────────────────────────────────────────────────────────────────────
// Discord factory
// ────────────────────────────────────────────────────────────────────────

describe('createDiscordSource', () => {
  test('guild channel message produces full canonical alias + raw payload', () => {
    const dm = {
      id: 'msg-1',
      author: { id: 'user-1', username: 'alice' },
      guild: { id: 'g-1', name: 'MyGuild' },
      channel: {
        id: 'c-1',
        name: 'ops',
        isThread: () => false,
      },
    };

    const src = createDiscordSource(dm);

    expect(src.kind).toBe('discord');
    expect(src.alias).toBe('discord:#ops');
    expect(src.sessionId).toBe('discord-g-1-c-1');
    expect(src.raw).toEqual({
      messageId: 'msg-1',
      channelId: 'c-1',
      channelName: 'ops',
      authorId: 'user-1',
      authorName: 'alice',
      guildId: 'g-1',
      guildName: 'MyGuild',
      threadId: null,
      threadName: null,
      parentChannelId: null,
      parentChannelName: null,
    });
  });

  test('thread message captures thread AND parent channel metadata', () => {
    const dm = {
      id: 'msg-2',
      author: { id: 'user-1', username: 'alice' },
      guild: { id: 'g-1', name: 'MyGuild' },
      channel: {
        id: 't-1',
        name: 'deploy-thread',
        parentId: 'c-1',
        parent: { name: 'ops' },
        isThread: () => true,
      },
    };

    const src = createDiscordSource(dm);

    expect(src.alias).toBe('discord:#deploy-thread');
    expect(src.raw.threadId).toBe('t-1');
    expect(src.raw.threadName).toBe('deploy-thread');
    expect(src.raw.parentChannelId).toBe('c-1');
    expect(src.raw.parentChannelName).toBe('ops');
  });

  test('DM (no guild) produces alias from channel id when no name', () => {
    const dm = {
      id: 'msg-3',
      author: { id: 'user-1', username: 'alice' },
      channel: { id: 'dm-channel-99', isThread: () => false },
      // no guild
    };

    const src = createDiscordSource(dm);
    expect(src.alias).toBe('discord:dm-channel-99');
    expect(src.raw.guildId).toBeNull();
    expect(src.raw.guildName).toBeNull();
    expect(src.sessionId).toBe('discord-dm-dm-channel-99');
  });

  test('prefers author.username, falls back to globalName', () => {
    const dm = {
      id: 'm',
      author: { id: 'u', globalName: 'AliceDisplay' },
      channel: { id: 'c', name: 'general', isThread: () => false },
    };
    expect(createDiscordSource(dm).raw.authorName).toBe('AliceDisplay');
  });

  test('missing channel.isThread method is treated as not-a-thread', () => {
    const dm = {
      id: 'm',
      author: { id: 'u', username: 'alice' },
      channel: { id: 'c', name: 'general' },  // no isThread
    };
    const src = createDiscordSource(dm);
    expect(src.raw.threadId).toBeNull();
    expect(src.raw.parentChannelId).toBeNull();
  });

  test('completely empty input produces an alias-of-last-resort, does not throw', () => {
    const src = createDiscordSource({});
    expect(src.kind).toBe('discord');
    expect(src.alias).toBe('discord:unknown');
    expect(src.raw.messageId).toBeNull();
    expect(src.raw.authorName).toBeNull();
  });

  test('null / undefined input does not throw and returns a discord-kind source', () => {
    expect(() => createDiscordSource(null)).not.toThrow();
    expect(() => createDiscordSource(undefined)).not.toThrow();
    expect(createDiscordSource(null).kind).toBe('discord');
  });

  test('output is deeply frozen', () => {
    const src = createDiscordSource({
      id: 'm', author: { username: 'a' },
      channel: { id: 'c', name: 'n', isThread: () => false },
      guild: { id: 'g', name: 'G' },
    });
    expect(Object.isFrozen(src)).toBe(true);
    expect(Object.isFrozen(src.raw)).toBe(true);
    // Attempt to mutate silently fails in non-strict mode, throws in strict.
    // Either way the value stays put.
    try { src.raw.channelName = 'hacked'; } catch {}
    expect(src.raw.channelName).toBe('n');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Telegram factory
// ────────────────────────────────────────────────────────────────────────

describe('createTelegramSource', () => {
  test('group chat captures title + user name, alias is per-chat', () => {
    const msg = {
      message_id: 42,
      chat: { id: -100123, type: 'supergroup', title: 'Ops Chat' },
      from: { id: 7, username: 'alice' },
    };
    const src = createTelegramSource(msg);
    expect(src.kind).toBe('telegram');
    expect(src.alias).toBe('telegram:chat--100123');
    expect(src.raw.chatTitle).toBe('Ops Chat');
    expect(src.raw.userName).toBe('alice');
    expect(src.sessionId).toBe('telegram--100123');
  });

  test('private chat uses from.first_name when no username', () => {
    const msg = {
      message_id: 1,
      chat: { id: 99, type: 'private' },
      from: { id: 7, first_name: 'Alice' },
    };
    const src = createTelegramSource(msg);
    expect(src.raw.userName).toBe('Alice');
    expect(src.raw.chatType).toBe('private');
  });

  test('missing chat id falls back to bare telegram alias', () => {
    const src = createTelegramSource({ from: { username: 'a' } });
    expect(src.alias).toBe('telegram');
  });

  test('output is deeply frozen', () => {
    const src = createTelegramSource({
      message_id: 1, chat: { id: 1, type: 'private' }, from: { username: 'u' },
    });
    expect(Object.isFrozen(src)).toBe(true);
    expect(Object.isFrozen(src.raw)).toBe(true);
  });

  test('null input does not throw', () => {
    expect(() => createTelegramSource(null)).not.toThrow();
    expect(createTelegramSource(null).kind).toBe('telegram');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Web / Internal factories
// ────────────────────────────────────────────────────────────────────────

describe('createWebSource / createInternalSource', () => {
  test('web source carries sessionId through', () => {
    const src = createWebSource({ sessionId: 'web-session-abc', userName: 'op' });
    expect(src.kind).toBe('web');
    expect(src.alias).toBe('web:web-session-abc');
    expect(src.sessionId).toBe('web-session-abc');
  });

  test('web source tolerates missing info', () => {
    const src = createWebSource();
    expect(src.sessionId).toBe('web-unknown');
  });

  test('internal source is frozen and has a traceable reason', () => {
    const src = createInternalSource('scheduler-tick');
    expect(src.kind).toBe('internal');
    expect(src.raw.reason).toBe('scheduler-tick');
    expect(Object.isFrozen(src)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// describeSource
// ────────────────────────────────────────────────────────────────────────

describe('describeSource', () => {
  test('Discord guild channel', () => {
    const src = createDiscordSource({
      author: { username: 'alice' },
      guild: { name: 'MyGuild' },
      channel: { id: 'c', name: 'ops', isThread: () => false },
    });
    expect(describeSource(src)).toBe('Message by alice from Discord > MyGuild > #ops');
  });

  test('Discord thread shows parent + thread name', () => {
    const src = createDiscordSource({
      author: { username: 'alice' },
      guild: { name: 'MyGuild' },
      channel: {
        id: 't', name: 'deploy-thread',
        parentId: 'c', parent: { name: 'ops' },
        isThread: () => true,
      },
    });
    expect(describeSource(src)).toBe(
      'Message by alice from Discord > MyGuild > #ops > deploy-thread'
    );
  });

  test('Discord DM — no guild, no channel name', () => {
    const src = createDiscordSource({
      author: { username: 'alice' },
      channel: { id: 'dm-99', isThread: () => false },
    });
    expect(describeSource(src)).toBe('Message by alice from Discord > DM');
  });

  test('Discord unknown user falls back gracefully', () => {
    const src = createDiscordSource({
      channel: { id: 'c', name: 'general', isThread: () => false },
    });
    expect(describeSource(src)).toBe('Message by unknown user from Discord > #general');
  });

  test('Telegram group chat', () => {
    const src = createTelegramSource({
      chat: { id: -100, type: 'supergroup', title: 'Ops Chat' },
      from: { username: 'alice' },
    });
    expect(describeSource(src)).toBe('Message by alice from Telegram > Ops Chat');
  });

  test('Telegram private chat', () => {
    const src = createTelegramSource({
      chat: { id: 1, type: 'private' },
      from: { username: 'alice' },
    });
    expect(describeSource(src)).toBe('Message by alice from Telegram > DM');
  });

  test('Telegram group with no title falls back to chat id', () => {
    const src = createTelegramSource({
      chat: { id: 777, type: 'group' },
      from: { username: 'alice' },
    });
    expect(describeSource(src)).toBe('Message by alice from Telegram > chat 777');
  });

  test('returns null for web / api / internal kinds', () => {
    expect(describeSource(createWebSource({ sessionId: 'x' }))).toBeNull();
    expect(describeSource(createInternalSource('tick'))).toBeNull();
  });

  test('returns null for null / undefined / non-object', () => {
    expect(describeSource(null)).toBeNull();
    expect(describeSource(undefined)).toBeNull();
    expect(describeSource('not-a-source')).toBeNull();
    expect(describeSource(42)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// formatSourceHeader / prependSourceHeader (idempotency)
// ────────────────────────────────────────────────────────────────────────

describe('formatSourceHeader', () => {
  test('wraps describeSource output in parentheses', () => {
    const src = createDiscordSource({
      author: { username: 'alice' },
      guild: { name: 'G' },
      channel: { id: 'c', name: 'ops', isThread: () => false },
    });
    expect(formatSourceHeader(src)).toBe('(Message by alice from Discord > G > #ops)');
  });

  test('returns empty string for no-header sources', () => {
    expect(formatSourceHeader(null)).toBe('');
    expect(formatSourceHeader(createInternalSource())).toBe('');
    expect(formatSourceHeader(createWebSource({ sessionId: 's' }))).toBe('');
  });
});

describe('prependSourceHeader', () => {
  const discordSrc = createDiscordSource({
    author: { username: 'alice' },
    guild: { name: 'G' },
    channel: { id: 'c', name: 'ops', isThread: () => false },
  });

  test('prepends header + newline to content', () => {
    const out = prependSourceHeader('hi is anyone there?', discordSrc);
    expect(out).toBe('(Message by alice from Discord > G > #ops)\nhi is anyone there?');
  });

  test('is idempotent — calling twice does not duplicate the header', () => {
    const once = prependSourceHeader('hello', discordSrc);
    const twice = prependSourceHeader(once, discordSrc);
    expect(twice).toBe(once);
  });

  test('leaves content unchanged when source has no header', () => {
    expect(prependSourceHeader('hello', null)).toBe('hello');
    expect(prependSourceHeader('hello', createInternalSource())).toBe('hello');
    expect(prependSourceHeader('hello', createWebSource())).toBe('hello');
  });

  test('coerces non-string content to string safely', () => {
    expect(prependSourceHeader(undefined, null)).toBe('');
    expect(prependSourceHeader(null, null)).toBe('');
    expect(prependSourceHeader(42, null)).toBe('42');
  });

  test('preserves surrounding whitespace in content', () => {
    const out = prependSourceHeader('\n  indented\n', discordSrc);
    expect(out.endsWith('\n  indented\n')).toBe(true);
    expect(out.startsWith('(Message by alice')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Discriminator surface
// ────────────────────────────────────────────────────────────────────────

describe('MESSAGE_SOURCE_KINDS', () => {
  test('is frozen and contains expected keys', () => {
    expect(Object.isFrozen(MESSAGE_SOURCE_KINDS)).toBe(true);
    expect(MESSAGE_SOURCE_KINDS).toEqual({
      DISCORD: 'discord',
      TELEGRAM: 'telegram',
      WEB: 'web',
      API: 'api',
      INTERNAL: 'internal',
    });
  });
});
