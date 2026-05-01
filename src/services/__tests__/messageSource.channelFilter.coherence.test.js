/**
 * Cross-module coherence: the aliases emitted by messageSource factories
 * must compose correctly with channelFilter.resolveBlockTargets.
 *
 * This is the single test that catches "we renamed the alias format on one
 * side of the fence and forgot the other side" — the exact kind of quiet
 * drift that turns source-awareness back into a ghost feature.
 *
 * The agent's contract is:
 *   1. Read an attribution header like "(Message by alice from Discord > G > #ops)".
 *   2. Look up the corresponding alias in the bridged-channels list it was given.
 *   3. Write <external to="<alias>">…</external>.
 *   4. The relay resolves that back to the concrete channel and sends the reply.
 *
 * Step 2 resolves to messageSource's alias output. Step 4 resolves through
 * channelFilter.resolveBlockTargets. These tests assert the two agree.
 */

import { describe, test, expect } from '@jest/globals';
import {
  createDiscordSource,
  createTelegramSource,
} from '../messageSource.js';
import { resolveBlockTargets } from '../channelFilter.js';

describe('messageSource ↔ channelFilter alias coherence', () => {
  test('Discord guild alias resolves when the agent addresses it verbatim', () => {
    const src = createDiscordSource({
      author: { username: 'alice' },
      guild: { name: 'MyGuild' },
      channel: { id: 'c1', name: 'ops', isThread: () => false },
    });

    // The relay advertises bridged aliases in the same shape messageSource
    // produces (both use `discord:#<name>`). Lock it in.
    const ownedAliases = [src.alias];
    const block = { to: [src.alias], text: 'reply' };

    expect(resolveBlockTargets(block, ownedAliases)).toEqual([src.alias]);
  });

  test('agent can use shorthand (#ops) and it still resolves via substring match', () => {
    const src = createDiscordSource({
      author: { username: 'alice' },
      guild: { name: 'MyGuild' },
      channel: { id: 'c1', name: 'ops', isThread: () => false },
    });
    // Agent sees "#ops" in the header path, writes a short `to="#ops"`.
    // channelFilter's substring match should still find the canonical alias.
    const block = { to: ['#ops'], text: 'reply' };
    expect(resolveBlockTargets(block, [src.alias])).toEqual([src.alias]);
  });

  test('guild-prefixed owned alias matches when agent addresses via channel shorthand', () => {
    // The relay may advertise a guild-qualified alias (`discord:guild-123:#ops`)
    // while the agent, reading the header path "Discord > MyGuild > #ops",
    // writes the natural short form `to="#ops"`. channelFilter's endsWith
    // path is what makes this pair compose — this locks that in.
    const ownedAliases = ['discord:guild-123:#ops'];
    const block = { to: ['#ops'], text: 'reply' };
    expect(resolveBlockTargets(block, ownedAliases)).toEqual(ownedAliases);
  });

  test('Telegram per-chat alias routes when owned alias set advertises it', () => {
    const src = createTelegramSource({
      message_id: 1,
      chat: { id: 999, type: 'supergroup', title: 'Ops' },
      from: { username: 'alice' },
    });
    const ownedAliases = [src.alias, 'telegram'];
    const block = { to: [src.alias], text: 'reply' };
    expect(resolveBlockTargets(block, ownedAliases)).toContain(src.alias);
  });

  test('Telegram per-chat source alias DOES NOT wildcard-match bare owned "telegram"', () => {
    // Regression guard on a tempting mistake. channelFilter matches "owned
    // contains wanted", not the reverse. If the relay owns only 'telegram',
    // an agent addressing `to="telegram:chat-999"` will NOT be routed there
    // — by design. The agent is expected to use the alias advertised in its
    // bridged-channel list (the system-prompt contract), not to invent
    // narrower aliases from the header. Locking this in prevents accidental
    // bidirectional-substring loosening of channelFilter later.
    const src = createTelegramSource({
      message_id: 1,
      chat: { id: 999, type: 'supergroup', title: 'Ops' },
      from: { username: 'alice' },
    });
    const ownedAliases = ['telegram'];
    const block = { to: [src.alias], text: 'reply' };
    expect(resolveBlockTargets(block, ownedAliases)).toEqual([]);
  });

  test('default block (no to=) still broadcasts to every owned alias', () => {
    // Regression guard: adding source-awareness must not change the meaning
    // of an unaddressed <external> block. It remains "broadcast to every
    // bridged channel," exactly as before.
    const block = { to: null, text: 'broadcast' };
    const owned = ['discord:#ops', 'telegram'];
    expect(resolveBlockTargets(block, owned).sort()).toEqual(owned.sort());
  });
});
