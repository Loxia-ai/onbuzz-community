/**
 * Widget versioning — every render appends a new version to the widget's
 * history; the agent (and the user via the artifacts panel) can list
 * versions, pick a specific one as 'main', or fetch a version's content.
 *
 * Backward compatibility: the widget record's TOP-LEVEL fields
 * (.content, .kind, .props, .phishingHits, .size) mirror the active
 * (main) version. Existing consumers keep reading those fields and
 * see whatever's currently main.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { WidgetTool } from '../widgetTool.js';
import { WIDGET_LIMITS } from '../schema.js';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const ctx = (agentId = 'a') => ({ agentId, toolConfig: { allowCustomCode: true } });

function makeTool() { return new WidgetTool({}, LOGGER); }

async function render(tool, agentId, widgetId, content, kind = 'html') {
  return tool.execute(
    { action: 'render', widgetId, kind, content },
    ctx(agentId)
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shape: render appends; first render seeds versions[0]
// ─────────────────────────────────────────────────────────────────────────

describe('render appends a new version', () => {
  test('first render: versions has length 1, mainVersionId points at it', async () => {
    const tool = makeTool();
    const r = await render(tool, 'a', 'w', '<p>v1</p>');
    expect(r.success).toBe(true);
    expect(r.widget.versions).toHaveLength(1);
    expect(r.widget.mainVersionId).toBe(r.widget.versions[0].versionId);
    expect(r.versionId).toBe(r.widget.versions[0].versionId);
    expect(r.versionCount).toBe(1);
  });

  test('subsequent renders APPEND, not overwrite — versions grows', async () => {
    const tool = makeTool();
    await render(tool, 'a', 'w', '<p>v1</p>');
    await render(tool, 'a', 'w', '<p>v2</p>');
    const r = await render(tool, 'a', 'w', '<p>v3</p>');
    expect(r.widget.versions).toHaveLength(3);
    expect(r.widget.versions.map(v => v.content)).toEqual(['<p>v1</p>', '<p>v2</p>', '<p>v3</p>']);
    // mainVersion follows the latest by default
    expect(r.widget.mainVersionId).toBe(r.widget.versions[2].versionId);
  });

  test('mirrored top-level fields reflect the ACTIVE version after each render', async () => {
    const tool = makeTool();
    await render(tool, 'a', 'w', '<p>old</p>', 'html');
    const r = await render(tool, 'a', 'w', '<p>fresh</p>', 'html');
    expect(r.widget.content).toBe('<p>fresh</p>');
    expect(r.widget.kind).toBe('html');
    // size matches the active version's content length in UTF-8 bytes
    expect(r.widget.size).toBe(Buffer.byteLength('<p>fresh</p>', 'utf8'));
  });

  test('versionCount stays accurate as versions grow', async () => {
    const tool = makeTool();
    for (let i = 0; i < 5; i++) {
      const r = await render(tool, 'a', 'w', `<p>${i}</p>`);
      expect(r.versionCount).toBe(i + 1);
    }
  });

  test('per-version createdAt is recorded; widget.createdAt stays at v1\'s time', async () => {
    const tool = makeTool();
    const r1 = await render(tool, 'a', 'w', '<p>v1</p>');
    const t1 = r1.widget.createdAt;
    // Tiny delay to ensure timestamps differ
    await new Promise(r => setTimeout(r, 5));
    const r2 = await render(tool, 'a', 'w', '<p>v2</p>');
    expect(r2.widget.createdAt).toBe(t1);                     // first-render time, immutable
    expect(r2.widget.versions[0].createdAt).toBe(t1);
    expect(r2.widget.versions[1].createdAt).not.toBe(t1);     // v2 has its own time
    // updatedAt mirrors the ACTIVE version's createdAt — useful as
    // "effective-since" timestamp when set-main is used.
    expect(r2.widget.updatedAt).toBe(r2.widget.versions[1].createdAt);
    // lastRenderedAt is always the newest version's time
    expect(r2.widget.lastRenderedAt).toBe(r2.widget.versions[1].createdAt);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// MAX_VERSIONS_PER_WIDGET cap
// ─────────────────────────────────────────────────────────────────────────

describe('version history cap', () => {
  test('beyond MAX_VERSIONS_PER_WIDGET, oldest is evicted; latest stays', async () => {
    const tool = makeTool();
    const cap = WIDGET_LIMITS.MAX_VERSIONS_PER_WIDGET;
    let r;
    for (let i = 0; i < cap + 3; i++) {
      r = await render(tool, 'a', 'w', `<p>${i}</p>`);
    }
    expect(r.widget.versions).toHaveLength(cap);
    // Oldest evicted, newest still there
    expect(r.widget.versions[0].content).toBe(`<p>3</p>`);
    expect(r.widget.versions[cap - 1].content).toBe(`<p>${cap + 2}</p>`);
  });

  test('eviction never leaves a dangling mainVersionId', async () => {
    const tool = makeTool();
    const cap = WIDGET_LIMITS.MAX_VERSIONS_PER_WIDGET;
    // Fill to cap, then pin v0 as main, then push more — v0 will be evicted
    await render(tool, 'a', 'w', '<p>v0</p>');
    const list1 = await tool.execute({ action: 'list-versions', widgetId: 'w' }, ctx('a'));
    const v0Id = list1.versions[0].versionId;
    for (let i = 1; i < cap; i++) await render(tool, 'a', 'w', `<p>${i}</p>`);
    await tool.execute({ action: 'set-main', widgetId: 'w', versionId: v0Id }, ctx('a'));
    // Push enough more renders to evict v0
    for (let i = 0; i < 3; i++) await render(tool, 'a', 'w', `<p>extra-${i}</p>`);
    const list2 = await tool.execute({ action: 'list-versions', widgetId: 'w' }, ctx('a'));
    // mainVersionId no longer references v0; it now points at oldest remaining
    expect(list2.versions.map(v => v.versionId)).not.toContain(v0Id);
    expect(list2.versions.map(v => v.versionId)).toContain(list2.mainVersionId);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// list-versions
// ─────────────────────────────────────────────────────────────────────────

describe('list-versions', () => {
  test('returns version metadata in chronological order, no content', async () => {
    const tool = makeTool();
    await render(tool, 'a', 'w', '<p>v1</p>');
    await render(tool, 'a', 'w', '<p>v2</p>');
    const r = await tool.execute({ action: 'list-versions', widgetId: 'w' }, ctx('a'));
    expect(r.success).toBe(true);
    expect(r.versions).toHaveLength(2);
    expect(r.versions[0].versionId).toBeTruthy();
    expect(r.versions[0].kind).toBe('html');
    expect(r.versions[0].size).toBeGreaterThan(0);
    // Critical: content is OMITTED so the agent doesn't pay token cost
    // just to enumerate versions
    expect(r.versions[0]).not.toHaveProperty('content');
  });

  test('rejects missing widgetId with a NAMED error', async () => {
    const r = await makeTool().execute({ action: 'list-versions' }, ctx('a'));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/widgetId/);
  });

  test('rejects unknown widget with a NAMED error', async () => {
    const r = await makeTool().execute(
      { action: 'list-versions', widgetId: 'nope' },
      ctx('a')
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Widget not found/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// get-version
// ─────────────────────────────────────────────────────────────────────────

describe('get-version', () => {
  test('returns the requested version with content', async () => {
    const tool = makeTool();
    const r1 = await render(tool, 'a', 'w', '<p>v1</p>');
    const r2 = await render(tool, 'a', 'w', '<p>v2</p>');
    const v1Id = r1.versionId;
    const v2Id = r2.versionId;
    const got = await tool.execute(
      { action: 'get-version', widgetId: 'w', versionId: v1Id },
      ctx('a')
    );
    expect(got.success).toBe(true);
    expect(got.version.content).toBe('<p>v1</p>');
    expect(got.version.versionId).toBe(v1Id);
    // Get the OTHER version too — they're independent snapshots
    const got2 = await tool.execute(
      { action: 'get-version', widgetId: 'w', versionId: v2Id },
      ctx('a')
    );
    expect(got2.version.content).toBe('<p>v2</p>');
  });

  test('rejects unknown versionId with a NAMED error listing what IS available', async () => {
    const tool = makeTool();
    await render(tool, 'a', 'w', '<p>v1</p>');
    const r = await tool.execute(
      { action: 'get-version', widgetId: 'w', versionId: 'fake' },
      ctx('a')
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Version not found/);
    expect(r.error).toMatch(/Available:/);
  });

  test('rejects missing versionId', async () => {
    const tool = makeTool();
    await render(tool, 'a', 'w', '<p>v1</p>');
    const r = await tool.execute(
      { action: 'get-version', widgetId: 'w' },
      ctx('a')
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/versionId is required/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// set-main — promote a version, mirrored fields update accordingly
// ─────────────────────────────────────────────────────────────────────────

describe('set-main', () => {
  test('promoting v1 changes mirrored content + kind back to v1\'s', async () => {
    const tool = makeTool();
    const r1 = await render(tool, 'a', 'w', '<p>v1-content</p>');
    await render(tool, 'a', 'w', '<p>v2-content</p>');
    const v1Id = r1.versionId;
    const r = await tool.execute(
      { action: 'set-main', widgetId: 'w', versionId: v1Id },
      ctx('a')
    );
    expect(r.success).toBe(true);
    expect(r.widget.mainVersionId).toBe(v1Id);
    expect(r.widget.content).toBe('<p>v1-content</p>'); // mirrored to active
    // Mirrored .updatedAt now reflects v1's createdAt (not v2's)
    expect(r.widget.updatedAt).toBe(r.widget.versions[0].createdAt);
    // But lastRenderedAt is still v2's createdAt (v2 was the most-recent
    // RENDER even though v1 is now MAIN)
    expect(r.widget.lastRenderedAt).toBe(r.widget.versions[1].createdAt);
  });

  test('rejects unknown versionId', async () => {
    const tool = makeTool();
    await render(tool, 'a', 'w', '<p>v1</p>');
    const r = await tool.execute(
      { action: 'set-main', widgetId: 'w', versionId: 'nope' },
      ctx('a')
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Version not found/);
  });

  test('after set-main, subsequent list reports the chosen mainVersionId', async () => {
    const tool = makeTool();
    const r1 = await render(tool, 'a', 'w', '<p>v1</p>');
    await render(tool, 'a', 'w', '<p>v2</p>');
    await tool.execute(
      { action: 'set-main', widgetId: 'w', versionId: r1.versionId },
      ctx('a')
    );
    const list = await tool.execute({ action: 'list' }, ctx('a'));
    expect(list.widgets[0].mainVersionId).toBe(r1.versionId);
    expect(list.widgets[0].versionCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Backward compatibility: existing top-level reads keep working
// ─────────────────────────────────────────────────────────────────────────

describe('backward-compat shape (top-level fields mirror main version)', () => {
  test('widget.content / kind / props / phishingHits / size all read off active version', async () => {
    const tool = makeTool();
    const r = await render(tool, 'a', 'w', '<p>password please</p>');
    expect(r.widget.content).toBe('<p>password please</p>');
    expect(r.widget.kind).toBe('html');
    expect(r.widget.props).toEqual({});
    expect(r.widget.phishingHits).toEqual(expect.arrayContaining(['password']));
    expect(r.widget.size).toBe(Buffer.byteLength('<p>password please</p>', 'utf8'));
  });

  test('list response carries new fields (versionCount, mainVersionId, gallery linkage) without breaking shape', async () => {
    const tool = makeTool();
    await render(tool, 'a', 'w', '<p>x</p>');
    const r = await tool.execute({ action: 'list' }, ctx('a'));
    expect(r.widgets[0]).toEqual(expect.objectContaining({
      widgetId: 'w',
      kind: 'html',
      versionCount: 1,
      mainVersionId: expect.any(String),
      // Phase 4 fields default safely
      linkedGalleryTemplateId: null,
      linkedGalleryVersion: null,
      divergedFromGallery: false,
    }));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Per-agent isolation — versions don't leak across agents
// ─────────────────────────────────────────────────────────────────────────

describe('per-agent isolation', () => {
  test('agent-A\'s widgetId "w" does not see agent-B\'s version history', async () => {
    const tool = makeTool();
    await render(tool, 'a', 'w', '<p>a-v1</p>');
    await render(tool, 'a', 'w', '<p>a-v2</p>');
    await render(tool, 'b', 'w', '<p>b-v1</p>');

    const a = await tool.execute({ action: 'list-versions', widgetId: 'w' }, ctx('a'));
    const b = await tool.execute({ action: 'list-versions', widgetId: 'w' }, ctx('b'));
    expect(a.versions).toHaveLength(2);
    expect(b.versions).toHaveLength(1);
  });
});
