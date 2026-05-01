/**
 * Unit tests for channelFilter.js
 *
 * Exercises the pure-function surface: parsing `<external>` blocks out of
 * raw agent content, resolving block targets against a set of owned
 * aliases, and generating the system-prompt guidance paragraph.
 *
 * The filter is API-path agnostic (runs on post-bridge content equivalent
 * for both Responses API and Chat Completions), so nothing here mocks
 * model providers — we only feed it representative content shapes.
 */

import { describe, test, expect } from '@jest/globals';
import {
  filterContentForExternalRelay,
  resolveBlockTargets,
  getExternalChannelPromptGuidance,
} from '../channelFilter.js';

// ───────────────────────── filterContentForExternalRelay ─────────────────────────

describe('filterContentForExternalRelay()', () => {
  test('no <external> tags → empty blocks (nothing relayed)', () => {
    expect(filterContentForExternalRelay('plain text only').blocks).toEqual([]);
    expect(filterContentForExternalRelay('').blocks).toEqual([]);
    expect(filterContentForExternalRelay(null).blocks).toEqual([]);
    expect(filterContentForExternalRelay(undefined).blocks).toEqual([]);
  });

  test('single default-routed block (no to=) → to: null', () => {
    const { blocks } = filterContentForExternalRelay('<external>hello</external>');
    expect(blocks).toEqual([{ to: null, text: 'hello' }]);
  });

  test('block with single alias in to=', () => {
    const { blocks } = filterContentForExternalRelay(
      '<external to="discord:#ops">only ops</external>'
    );
    expect(blocks).toEqual([{ to: ['discord:#ops'], text: 'only ops' }]);
  });

  test('block with multiple aliases (comma-separated, spaces tolerated)', () => {
    const { blocks } = filterContentForExternalRelay(
      '<external to="discord:#ops, telegram, discord:#general">multi</external>'
    );
    expect(blocks).toEqual([
      { to: ['discord:#ops', 'telegram', 'discord:#general'], text: 'multi' },
    ]);
  });

  test('to="*" preserved as explicit broadcast marker', () => {
    const { blocks } = filterContentForExternalRelay('<external to="*">yo</external>');
    expect(blocks).toEqual([{ to: ['*'], text: 'yo' }]);
  });

  test('empty to= is treated as default (null)', () => {
    expect(filterContentForExternalRelay('<external to="">yo</external>').blocks)
      .toEqual([{ to: null, text: 'yo' }]);
    expect(filterContentForExternalRelay('<external to="   ">yo</external>').blocks)
      .toEqual([{ to: null, text: 'yo' }]);
  });

  test('single and double quotes both accepted for to=', () => {
    expect(filterContentForExternalRelay(`<external to='telegram'>x</external>`).blocks)
      .toEqual([{ to: ['telegram'], text: 'x' }]);
    expect(filterContentForExternalRelay(`<external to="telegram">x</external>`).blocks)
      .toEqual([{ to: ['telegram'], text: 'x' }]);
  });

  test('case-insensitive tag matching (both opening and closing)', () => {
    expect(filterContentForExternalRelay('<EXTERNAL>hi</EXTERNAL>').blocks)
      .toEqual([{ to: null, text: 'hi' }]);
    expect(filterContentForExternalRelay('<External To="telegram">hi</External>').blocks)
      .toEqual([{ to: ['telegram'], text: 'hi' }]);
  });

  test('multiple blocks parsed in document order', () => {
    const { blocks } = filterContentForExternalRelay(
      '<external>A</external>middle<external to="x">B</external>tail<external>C</external>'
    );
    expect(blocks).toEqual([
      { to: null, text: 'A' },
      { to: ['x'], text: 'B' },
      { to: null, text: 'C' },
    ]);
  });

  test('content outside <external> is never captured', () => {
    const content = 'private planning\n<external>public</external>\nmore private';
    expect(filterContentForExternalRelay(content).blocks)
      .toEqual([{ to: null, text: 'public' }]);
  });

  test('CONTENT VERBATIM — code blocks preserved inside <external>', () => {
    const content = '<external>```js\nconst x = 1;\n```</external>';
    expect(filterContentForExternalRelay(content).blocks).toEqual([
      { to: null, text: '```js\nconst x = 1;\n```' },
    ]);
  });

  test('CONTENT VERBATIM — tool-call JSON blocks preserved inside <external>', () => {
    // Critical: the filter must NOT strip tool JSON just because it looks
    // like internal bookkeeping. If the agent put it inside <external>,
    // the agent wants it published (e.g., a task summary).
    const tool = '```json\n{"toolId":"taskmanager","parameters":{}}\n```';
    const { blocks } = filterContentForExternalRelay(`<external>${tool}</external>`);
    expect(blocks[0].text).toBe(tool);
  });

  test('CONTENT VERBATIM — "Calling X" bridge preamble preserved if wrapped', () => {
    // Bridge emits header-only (no em-dash param preview — see
    // toolCallBridge.js DESIGN NOTE).
    const txt = '**Calling terminal**\n\nsee below';
    const { blocks } = filterContentForExternalRelay(`<external>${txt}</external>`);
    expect(blocks[0].text).toBe(txt);
  });

  test('empty or whitespace-only block is dropped', () => {
    expect(filterContentForExternalRelay('<external></external>').blocks).toEqual([]);
    expect(filterContentForExternalRelay('<external>   \n\n</external>').blocks).toEqual([]);
  });

  test('leading/trailing whitespace in block body is trimmed', () => {
    const { blocks } = filterContentForExternalRelay('<external>\n\n  hi \n\n</external>');
    expect(blocks).toEqual([{ to: null, text: 'hi' }]);
  });

  test('unclosed <external> tag is ignored (no runaway capture)', () => {
    // Non-greedy regex stops at first </external> it finds; an unclosed
    // opener produces no blocks rather than swallowing the rest of the turn.
    expect(filterContentForExternalRelay('<external>open forever').blocks).toEqual([]);
  });

  test('mixed API-path content: prose + bridge preamble + tool JSON + <external> reply', () => {
    // Representative of what `stream_complete` carries on either API path
    // after the bridge has converted native tool calls to inline blocks.
    const content =
      "Thinking through this…\n\n" +
      "**Calling taskmanager**\n\n" +
      "```json\n{\"toolId\":\"taskmanager\",\"parameters\":{\"actions\":[{\"type\":\"create\",\"title\":\"foo\"}]}}\n```\n\n" +
      "<external to=\"discord:#ops\">\n" +
      "Created a task for you: **foo**. I'll post back when it's done.\n" +
      "</external>\n\n" +
      "<external to=\"telegram\">Done ✅</external>";
    const { blocks } = filterContentForExternalRelay(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      to: ['discord:#ops'],
      text: "Created a task for you: **foo**. I'll post back when it's done.",
    });
    expect(blocks[1]).toEqual({ to: ['telegram'], text: 'Done ✅' });
  });
});

// ────────────────────────────── resolveBlockTargets ──────────────────────────────

describe('resolveBlockTargets()', () => {
  const owned = ['discord:#ops', 'discord:#general', 'telegram'];

  test('no owned aliases → always empty', () => {
    expect(resolveBlockTargets({ to: null }, [])).toEqual([]);
    expect(resolveBlockTargets({ to: ['*'] }, [])).toEqual([]);
    expect(resolveBlockTargets({ to: ['telegram'] }, [])).toEqual([]);
  });

  test('to=null → broadcast to every owned alias', () => {
    expect(resolveBlockTargets({ to: null }, owned).sort()).toEqual([...owned].sort());
  });

  test('to=["*"] → broadcast to every owned alias (same as null)', () => {
    expect(resolveBlockTargets({ to: ['*'] }, owned).sort()).toEqual([...owned].sort());
  });

  test('exact alias match (case-insensitive)', () => {
    expect(resolveBlockTargets({ to: ['telegram'] }, owned)).toEqual(['telegram']);
    expect(resolveBlockTargets({ to: ['TELEGRAM'] }, owned)).toEqual(['telegram']);
    expect(resolveBlockTargets({ to: ['Discord:#Ops'] }, owned)).toEqual(['discord:#ops']);
  });

  test('substring match (short form → canonical alias)', () => {
    // Agent wrote `#ops` — matches owned `discord:#ops`.
    expect(resolveBlockTargets({ to: ['#ops'] }, owned)).toEqual(['discord:#ops']);
    // Agent wrote `ops` — also matches.
    expect(resolveBlockTargets({ to: ['ops'] }, owned)).toEqual(['discord:#ops']);
  });

  test('multiple targets in to= resolve additively', () => {
    const r = resolveBlockTargets({ to: ['#ops', 'telegram'] }, owned).sort();
    expect(r).toEqual(['discord:#ops', 'telegram'].sort());
  });

  test('unknown alias → empty match (block silently skipped by caller)', () => {
    expect(resolveBlockTargets({ to: ['slack:#ops'] }, owned)).toEqual([]);
    expect(resolveBlockTargets({ to: ['nonexistent'] }, owned)).toEqual([]);
  });

  test('duplicate matches are deduped', () => {
    // Substring matching could theoretically match the same owned alias
    // twice — ensure the return value is a set.
    expect(resolveBlockTargets({ to: ['ops', '#ops', 'discord:#ops'] }, owned))
      .toEqual(['discord:#ops']);
  });
});

// ─────────────────────── getExternalChannelPromptGuidance ────────────────────────

describe('getExternalChannelPromptGuidance()', () => {
  test('empty channel list → empty string (no prompt pollution)', () => {
    expect(getExternalChannelPromptGuidance([])).toBe('');
    expect(getExternalChannelPromptGuidance(null)).toBe('');
    expect(getExternalChannelPromptGuidance(undefined)).toBe('');
  });

  test('single channel → guidance includes alias and label', () => {
    const out = getExternalChannelPromptGuidance([
      { alias: 'telegram', label: 'Telegram chat' },
    ]);
    expect(out).toContain('OUTPUT ROUTING');
    expect(out).toContain('`telegram`');
    expect(out).toContain('Telegram chat');
    expect(out).toContain('<external>');
    expect(out).toContain('<external to="alias">');
  });

  test('multiple channels listed in given order', () => {
    const out = getExternalChannelPromptGuidance([
      { alias: 'discord:#ops', label: 'Discord channel #ops in Acme' },
      { alias: 'discord:#general', label: 'Discord channel #general in Acme' },
      { alias: 'telegram', label: 'Telegram chat' },
    ]);
    const opsIdx = out.indexOf('`discord:#ops`');
    const genIdx = out.indexOf('`discord:#general`');
    const telIdx = out.indexOf('`telegram`');
    expect(opsIdx).toBeGreaterThan(-1);
    expect(genIdx).toBeGreaterThan(opsIdx);
    expect(telIdx).toBeGreaterThan(genIdx);
  });

  test('documents the addressing matrix (default / specific / multi / broadcast)', () => {
    const out = getExternalChannelPromptGuidance([{ alias: 'telegram', label: 't' }]);
    expect(out).toContain('broadcast to every bridged channel');
    expect(out).toContain('<external to="alias">');
    expect(out).toContain('<external to="aliasA,aliasB">');
    expect(out).toContain('<external to="*">');
  });

  test('explicitly states that default (no <external>) means local-only', () => {
    const out = getExternalChannelPromptGuidance([{ alias: 'telegram', label: 't' }]);
    expect(out).toMatch(/stays local|never forwarded|NOTHING you write is forwarded/i);
  });

  test('channel entry without a label still renders alias', () => {
    const out = getExternalChannelPromptGuidance([{ alias: 'telegram' }]);
    expect(out).toContain('`telegram`');
  });

  test('ignores entries with missing / empty aliases', () => {
    const out = getExternalChannelPromptGuidance([
      { alias: '', label: 'dropped' },
      { alias: '   ', label: 'dropped' },
      { alias: 'telegram', label: 'kept' },
    ]);
    expect(out).toContain('`telegram`');
    expect(out).not.toContain('dropped');
  });
});
