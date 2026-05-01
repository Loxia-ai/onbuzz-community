/**
 * Widget naming/renaming — optional human-friendly display name.
 *
 * Contract:
 *   - widgetId is the stable identifier; name is purely cosmetic.
 *   - Names are NOT unique — two widgets can share a name; that's fine.
 *   - render { name?: string } sets the name on FIRST render only;
 *     re-renders don't accidentally rename. Use rename action to change.
 *   - rename { widgetId, name } sets/changes the name.
 *   - rename { widgetId, name: null } (or '') clears the name.
 *   - Whitespace is trimmed; control chars rejected; max 80 chars.
 *   - Emits widget-changed with changeType: 'renamed' (and previousName).
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { WidgetTool } from '../widgetTool.js';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const ctx = (agentId = 'a') => ({ agentId, toolConfig: { allowCustomCode: true } });

let tool;
beforeEach(() => { tool = new WidgetTool({}, LOGGER); });

describe('render — optional name', () => {
  test('render with name sets the name on the widget record', async () => {
    const r = await tool.execute({
      action: 'render', kind: 'html', content: '<p/>', widgetId: 'w1', name: 'My Calculator',
    }, ctx());
    expect(r.success).toBe(true);
    expect(r.widget.name).toBe('My Calculator');
  });

  test('render without name → widget.name is undefined/null', async () => {
    const r = await tool.execute({
      action: 'render', kind: 'html', content: '<p/>', widgetId: 'w1',
    }, ctx());
    expect(r.widget.name == null).toBe(true);
  });

  test('re-render does NOT overwrite an existing name (use rename for that)', async () => {
    await tool.execute({ action: 'render', kind: 'html', content: '<p/>', widgetId: 'w1', name: 'Original' }, ctx());
    const r = await tool.execute({ action: 'render', kind: 'html', content: '<p>v2</p>', widgetId: 'w1', name: 'Different' }, ctx());
    expect(r.widget.name).toBe('Original');
  });

  test('render with surrounding whitespace → name is trimmed before storage', async () => {
    const r = await tool.execute({
      action: 'render', kind: 'html', content: '<p/>', widgetId: 'w1', name: '  Habit Tracker  ',
    }, ctx());
    expect(r.widget.name).toBe('Habit Tracker');
  });

  test('name validation: rejects empty string', async () => {
    const r = await tool.execute({
      action: 'render', kind: 'html', content: '<p/>', name: '   ',
    }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/non-empty/);
  });

  test('name validation: rejects non-string', async () => {
    const r = await tool.execute({
      action: 'render', kind: 'html', content: '<p/>', name: 42,
    }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/string/);
  });

  test('name validation: rejects > 80 chars', async () => {
    const long = 'x'.repeat(81);
    const r = await tool.execute({ action: 'render', kind: 'html', content: '<p/>', name: long }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/exceeds 80/);
  });

  test('name validation: 80 chars exactly is OK', async () => {
    const exactly80 = 'x'.repeat(80);
    const r = await tool.execute({ action: 'render', kind: 'html', content: '<p/>', name: exactly80 }, ctx());
    expect(r.success).toBe(true);
    expect(r.widget.name).toBe(exactly80);
  });

  test('name validation: rejects control characters', async () => {
    const r = await tool.execute({
      action: 'render', kind: 'html', content: '<p/>', name: 'My\x00Widget',
    }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/control characters/);
  });
});

describe('rename action', () => {
  beforeEach(async () => {
    await tool.execute({ action: 'render', kind: 'html', content: '<p/>', widgetId: 'w1' }, ctx());
  });

  test('renames an existing widget', async () => {
    const r = await tool.execute({ action: 'rename', widgetId: 'w1', name: 'Calculator' }, ctx());
    expect(r.success).toBe(true);
    expect(r.name).toBe('Calculator');
    expect(r.previousName).toBeNull();
    expect(r.widget.name).toBe('Calculator');
  });

  test('renaming again replaces the name; previousName reports the old', async () => {
    await tool.execute({ action: 'rename', widgetId: 'w1', name: 'First' }, ctx());
    const r = await tool.execute({ action: 'rename', widgetId: 'w1', name: 'Second' }, ctx());
    expect(r.previousName).toBe('First');
    expect(r.name).toBe('Second');
  });

  test('rename with null clears the name', async () => {
    await tool.execute({ action: 'rename', widgetId: 'w1', name: 'Temp' }, ctx());
    const r = await tool.execute({ action: 'rename', widgetId: 'w1', name: null }, ctx());
    expect(r.success).toBe(true);
    expect(r.name).toBeNull();
    expect(r.previousName).toBe('Temp');
  });

  test('rename with empty string clears the name', async () => {
    await tool.execute({ action: 'rename', widgetId: 'w1', name: 'Temp' }, ctx());
    const r = await tool.execute({ action: 'rename', widgetId: 'w1', name: '' }, ctx());
    expect(r.name).toBeNull();
  });

  test('renaming a non-existent widget returns an error', async () => {
    const r = await tool.execute({ action: 'rename', widgetId: 'never-existed', name: 'X' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Widget not found/);
  });

  test('rename trims whitespace', async () => {
    const r = await tool.execute({ action: 'rename', widgetId: 'w1', name: '  Spaced Name  ' }, ctx());
    expect(r.name).toBe('Spaced Name');
  });

  test('rename validation errors propagate (control chars, too-long, etc.)', async () => {
    const r = await tool.execute({
      action: 'rename', widgetId: 'w1', name: 'x'.repeat(81),
    }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/exceeds 80/);
  });
});

describe('event bus emits "renamed" change', () => {
  test('renaming fires widget-changed with changeType "renamed" and previousName', async () => {
    await tool.execute({ action: 'render', kind: 'html', content: '<p/>', widgetId: 'w1', name: 'Old' }, ctx());
    const events = [];
    tool.events.on('widget-changed', e => events.push(e));
    await tool.execute({ action: 'rename', widgetId: 'w1', name: 'New' }, ctx());
    const renamed = events.find(e => e.changeType === 'renamed');
    expect(renamed).toBeDefined();
    expect(renamed.summary.name).toBe('New');
    expect(renamed.previousName).toBe('Old');
    expect(renamed.widgetId).toBe('w1');
  });

  test('renamed emission also fires when name is cleared (new=null, previous=set)', async () => {
    await tool.execute({ action: 'render', kind: 'html', content: '<p/>', widgetId: 'w1', name: 'Old' }, ctx());
    const events = [];
    tool.events.on('widget-changed', e => events.push(e));
    await tool.execute({ action: 'rename', widgetId: 'w1', name: null }, ctx());
    const renamed = events.find(e => e.changeType === 'renamed');
    expect(renamed.summary.name).toBeNull();
    expect(renamed.previousName).toBe('Old');
  });
});

describe('summary + list expose the name', () => {
  test('name appears on the rendered widget summary', async () => {
    await tool.execute({ action: 'render', kind: 'html', content: '<p/>', widgetId: 'w1', name: 'Foo' }, ctx());
    const summary = tool._buildSummary(tool._widgetsByAgent.get('a').get('w1'));
    expect(summary.name).toBe('Foo');
  });

  test('list includes name field for every widget (null when not set)', async () => {
    await tool.execute({ action: 'render', kind: 'html', content: '<p/>', widgetId: 'a', name: 'Alpha' }, ctx());
    await tool.execute({ action: 'render', kind: 'html', content: '<p/>', widgetId: 'b' }, ctx());
    const r = await tool.execute({ action: 'list' }, ctx());
    const a = r.widgets.find(w => w.widgetId === 'a');
    const b = r.widgets.find(w => w.widgetId === 'b');
    expect(a.name).toBe('Alpha');
    expect(b.name).toBeNull();
  });
});

describe('non-uniqueness — two widgets can share a name', () => {
  test('two widgets with the same name coexist (widgetId is the unique key)', async () => {
    await tool.execute({ action: 'render', kind: 'html', content: '<p/>', widgetId: 'w1', name: 'Twin' }, ctx());
    const r = await tool.execute({ action: 'render', kind: 'html', content: '<p/>', widgetId: 'w2', name: 'Twin' }, ctx());
    expect(r.success).toBe(true);
    expect(r.widget.name).toBe('Twin');
    const list = await tool.execute({ action: 'list' }, ctx());
    const named = list.widgets.filter(w => w.name === 'Twin');
    expect(named).toHaveLength(2);
  });
});

describe('rename appears in supported actions', () => {
  test('rename listed in getSupportedActions', () => {
    expect(tool.getSupportedActions()).toContain('rename');
  });
});
