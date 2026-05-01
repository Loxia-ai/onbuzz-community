/**
 * Tests for the WidgetTool event bus (`widget-changed`).
 *
 * The bus is what powers the WebSocket `widget_changed` push that keeps
 * the frontend artifacts panel in sync regardless of chat-feed
 * virtualization. Each mutation must emit exactly one event with the
 * expected changeType and a summary that matches the artifacts panel
 * shape (same as `_list` rows).
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { WidgetTool } from '../widgetTool.js';
import { GalleryStore } from '../galleryStore.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const ctx = (agentId = 'agent-a', overrides = {}) =>
  ({ agentId, toolConfig: { allowCustomCode: true }, ...overrides });

function makeTool() { return new WidgetTool({}, LOGGER); }

function recorder(tool) {
  const events = [];
  tool.events.on('widget-changed', e => events.push(e));
  return events;
}

describe('WidgetTool.events — basic shape', () => {
  test('events bus is an EventEmitter with on/emit', () => {
    const tool = makeTool();
    expect(typeof tool.events.on).toBe('function');
    expect(typeof tool.events.emit).toBe('function');
  });

  test('summary shape matches _list row shape (key fields)', async () => {
    const tool = makeTool();
    const events = recorder(tool);
    await tool.execute({ action: 'render', kind: 'html', content: '<div>x</div>', widgetId: 'w1' }, ctx());
    const list = (await tool.execute({ action: 'list' }, ctx())).widgets[0];
    expect(events).toHaveLength(1);
    const summary = events[0].summary;
    // Same keys + values as the artifacts panel cares about.
    for (const k of ['widgetId', 'kind', 'createdAt', 'updatedAt', 'lastRenderedAt',
                     'size', 'phishingHits', 'versionCount', 'mainVersionId',
                     'linkedGalleryTemplateId', 'linkedGalleryVersion', 'divergedFromGallery']) {
      expect(summary[k]).toEqual(list[k]);
    }
  });
});

describe('emits per mutation type', () => {
  test('render → "rendered" with agentId, widgetId, summary', async () => {
    const tool = makeTool();
    const events = recorder(tool);
    await tool.execute({ action: 'render', kind: 'html', content: '<i>hi</i>', widgetId: 'w1' }, ctx('a1'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agentId: 'a1', widgetId: 'w1', changeType: 'rendered',
      summary: expect.objectContaining({ widgetId: 'w1', versionCount: 1 }),
    });
  });

  test('a second render bumps versionCount in the emitted summary', async () => {
    const tool = makeTool();
    const events = recorder(tool);
    await tool.execute({ action: 'render', kind: 'html', content: '<i>v1</i>', widgetId: 'w1' }, ctx());
    await tool.execute({ action: 'render', kind: 'html', content: '<i>v2</i>', widgetId: 'w1' }, ctx());
    expect(events).toHaveLength(2);
    expect(events[0].summary.versionCount).toBe(1);
    expect(events[1].summary.versionCount).toBe(2);
    expect(events[1].changeType).toBe('rendered');
  });

  test('update → "updated"', async () => {
    const tool = makeTool();
    await tool.execute({ action: 'render', kind: 'jsx', content: 'loxia.render(()=>h("div"));', widgetId: 'w1' }, ctx());
    const events = recorder(tool);
    await tool.execute({ action: 'update', widgetId: 'w1', props: { x: 1 } }, ctx());
    expect(events).toHaveLength(1);
    expect(events[0].changeType).toBe('updated');
    expect(events[0].widgetId).toBe('w1');
  });

  test('destroy → "destroyed" with summary=null', async () => {
    const tool = makeTool();
    await tool.execute({ action: 'render', kind: 'html', content: '<i/>', widgetId: 'w1' }, ctx());
    const events = recorder(tool);
    await tool.execute({ action: 'destroy', widgetId: 'w1' }, ctx());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ changeType: 'destroyed', widgetId: 'w1', summary: null });
  });

  test('set-main → "main-set"', async () => {
    const tool = makeTool();
    await tool.execute({ action: 'render', kind: 'html', content: '<i>v1</i>', widgetId: 'w1' }, ctx());
    await tool.execute({ action: 'render', kind: 'html', content: '<i>v2</i>', widgetId: 'w1' }, ctx());
    const w = tool._widgetsByAgent.get('agent-a').get('w1');
    const olderVersionId = w.versions[0].versionId;
    const events = recorder(tool);
    await tool.execute({ action: 'set-main', widgetId: 'w1', versionId: olderVersionId }, ctx());
    expect(events).toHaveLength(1);
    expect(events[0].changeType).toBe('main-set');
    expect(events[0].summary.mainVersionId).toBe(olderVersionId);
  });
});

describe('gallery mutations also emit', () => {
  let tmp, galleryFile;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'widget-events-'));
    galleryFile = path.join(tmp, 'g.json');
  });

  test('share-to-gallery → "shared" with templateId in extra fields', async () => {
    const tool = makeTool();
    tool.setGalleryStore(new GalleryStore({ filePath: galleryFile, logger: LOGGER, debounceMs: 0 }));
    await tool.execute({ action: 'render', kind: 'html', content: '<i/>', widgetId: 'w1' }, ctx());
    const events = recorder(tool);
    const r = await tool.execute({ action: 'share-to-gallery', widgetId: 'w1', title: 'Hello' }, ctx());
    expect(r.success).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      changeType: 'shared',
      widgetId: 'w1',
      templateId: r.templateId,
      templateVersion: r.version,
      summary: expect.objectContaining({ linkedGalleryTemplateId: r.templateId }),
    });
  });

  test('unshare-from-gallery → "unshared" for each affected widget', async () => {
    const tool = makeTool();
    tool.setGalleryStore(new GalleryStore({ filePath: galleryFile, logger: LOGGER, debounceMs: 0 }));
    await tool.execute({ action: 'render', kind: 'html', content: '<i/>', widgetId: 'w1' }, ctx());
    const shared = await tool.execute({ action: 'share-to-gallery', widgetId: 'w1' }, ctx());
    const events = recorder(tool);
    await tool.execute({ action: 'unshare-from-gallery', templateId: shared.templateId }, ctx());
    const unshare = events.find(e => e.changeType === 'unshared');
    expect(unshare).toBeTruthy();
    expect(unshare.widgetId).toBe('w1');
    expect(unshare.templateId).toBe(shared.templateId);
    expect(unshare.summary.linkedGalleryTemplateId).toBeNull();
  });
});

describe('listener errors do not break the tool call', () => {
  test('a throwing listener is swallowed; mutation still succeeds', async () => {
    const tool = makeTool();
    tool.events.on('widget-changed', () => { throw new Error('boom'); });
    const r = await tool.execute({ action: 'render', kind: 'html', content: '<i/>', widgetId: 'w1' }, ctx());
    expect(r.success).toBe(true);
    expect(r.widgetId).toBe('w1');
  });
});

describe('multiple subscribers receive the same event', () => {
  test('two listeners both fire for one mutation', async () => {
    const tool = makeTool();
    const a = []; const b = [];
    tool.events.on('widget-changed', e => a.push(e));
    tool.events.on('widget-changed', e => b.push(e));
    await tool.execute({ action: 'render', kind: 'html', content: '<i/>', widgetId: 'w1' }, ctx());
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toEqual(b[0]);
  });
});
