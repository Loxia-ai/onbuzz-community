/**
 * Unit tests for externalTargetLabel — alias → human label mapping.
 *
 * Coverage matters here because the card header is what the operator reads
 * to verify "the right reply is going to the right place at a glance." A
 * wrong label is worse than no label.
 */

import { parseTargetAlias, describeExternalTarget } from '../externalTargetLabel.js';

describe('parseTargetAlias', () => {
  test('bare #channel Discord alias', () => {
    expect(parseTargetAlias('discord:#ops')).toEqual({
      platform: 'discord',
      label: 'Discord > #ops',
      alias: 'discord:#ops',
    });
  });

  test('Discord channel id (no #)', () => {
    expect(parseTargetAlias('discord:c-12345')).toEqual({
      platform: 'discord',
      label: 'Discord > c-12345',
      alias: 'discord:c-12345',
    });
  });

  test('Discord alias with guild prefix drops the guild from the label', () => {
    expect(parseTargetAlias('discord:guild-999:#ops')).toEqual({
      platform: 'discord',
      label: 'Discord > #ops',
      alias: 'discord:guild-999:#ops',
    });
  });

  test('bare "telegram" alias', () => {
    expect(parseTargetAlias('telegram')).toEqual({
      platform: 'telegram',
      label: 'Telegram',
      alias: 'telegram',
    });
  });

  test('telegram:chat-999 becomes "Telegram > chat 999"', () => {
    expect(parseTargetAlias('telegram:chat-999')).toEqual({
      platform: 'telegram',
      label: 'Telegram > chat 999',
      alias: 'telegram:chat-999',
    });
  });

  test('null / "*" / empty → broadcast descriptor', () => {
    expect(parseTargetAlias(null).platform).toBe('broadcast');
    expect(parseTargetAlias('*').platform).toBe('broadcast');
    expect(parseTargetAlias('').platform).toBe('broadcast');
    expect(parseTargetAlias(undefined).platform).toBe('broadcast');
  });

  test('unknown alias shape → platform "other", label = raw alias', () => {
    expect(parseTargetAlias('slack:#eng')).toEqual({
      platform: 'other',
      label: 'slack:#eng',
      alias: 'slack:#eng',
    });
  });

  test('case-insensitive platform detection', () => {
    expect(parseTargetAlias('DISCORD:#Ops').platform).toBe('discord');
    expect(parseTargetAlias('Telegram:Chat-1').platform).toBe('telegram');
  });
});

describe('describeExternalTarget', () => {
  test('null / undefined / empty array → broadcast label', () => {
    expect(describeExternalTarget(null).label).toBe('To all bridged channels');
    expect(describeExternalTarget(undefined).label).toBe('To all bridged channels');
    expect(describeExternalTarget([]).label).toBe('To all bridged channels');
    expect(describeExternalTarget(null).platform).toBe('broadcast');
  });

  test('explicit single wildcard ["*"] → broadcast', () => {
    const out = describeExternalTarget(['*']);
    expect(out.platform).toBe('broadcast');
    expect(out.label).toBe('To all bridged channels');
  });

  test('single Discord alias', () => {
    const out = describeExternalTarget(['discord:#ops']);
    expect(out.platform).toBe('discord');
    expect(out.label).toBe('To Discord > #ops');
    expect(out.targets).toHaveLength(1);
  });

  test('single Telegram alias', () => {
    const out = describeExternalTarget(['telegram:chat-42']);
    expect(out.platform).toBe('telegram');
    expect(out.label).toBe('To Telegram > chat 42');
  });

  test('multiple aliases of same platform collapse under that platform', () => {
    const out = describeExternalTarget(['discord:#ops', 'discord:#alerts']);
    expect(out.platform).toBe('discord');
    expect(out.label).toBe('To Discord > #ops, Discord > #alerts');
  });

  test('mixed-platform fan-out → platform "mixed"', () => {
    const out = describeExternalTarget(['discord:#ops', 'telegram:chat-1']);
    expect(out.platform).toBe('mixed');
    expect(out.label).toBe('To Discord > #ops, Telegram > chat 1');
  });
});
