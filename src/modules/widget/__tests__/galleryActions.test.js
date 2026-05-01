/**
 * WidgetTool gallery actions — share / unshare / list / render-from.
 *
 * Tests inject a sandboxed GalleryStore with a temp file path so we
 * never touch the user's real ~/.loxia/widget-gallery.json.
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WidgetTool } from '../widgetTool.js';
import { GalleryStore } from '../galleryStore.js';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const ctx = (overrides = {}) => ({
  agentId: 'a',
  agentName: 'Coder',
  sessionId: 'sess-1',
  toolConfig: { allowCustomCode: true },
  ...overrides,
});

function tempFile() {
  return path.join(os.tmpdir(), `loxia-gallery-actions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
}

let tool, gallery, filePath;

beforeEach(async () => {
  filePath = tempFile();
  gallery = new GalleryStore({ filePath, persistDebounceMs: 0, logger: LOGGER });
  tool = new WidgetTool({}, LOGGER);
  tool.setGalleryStore(gallery);
  // Pre-render a widget for the agent to share.
  await tool.execute(
    { action: 'render', kind: 'webcomponent',
      content: 'class C extends LoxiaElement {}', widgetId: 'calc' },
    ctx()
  );
});

afterEach(async () => {
  await gallery.flush();
  try { await fs.unlink(filePath); } catch { /* ok */ }
});

// ──────────────────────────────────────────────────────────────────────────
// share-to-gallery
// ──────────────────────────────────────────────────────────────────────────

describe('share-to-gallery', () => {
  test('publishes the current widget content as a new gallery template', async () => {
    const r = await tool.execute(
      { action: 'share-to-gallery', widgetId: 'calc', title: 'Loan calc', tags: ['finance'] },
      ctx()
    );
    expect(r.success).toBe(true);
    expect(r.templateId).toMatch(/loan-calc-v1-/);
    expect(r.version).toBe(1);
    expect(r.entry.title).toBe('Loan calc');
    expect(r.entry.tags).toEqual(['finance']);
    expect(r.entry.sharedBy.agentId).toBe('a');
    expect(r.entry.sharedBy.agentName).toBe('Coder');
    // Local widget gets linked
    expect(r.widget.linkedGalleryTemplateId).toBe(r.templateId);
    expect(r.widget.linkedGalleryVersion).toBe(1);
    expect(r.widget.divergedFromGallery).toBe(false);
  });

  test('rejects missing widgetId', async () => {
    const r = await tool.execute({ action: 'share-to-gallery' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/widgetId/);
  });

  test('rejects unknown widget', async () => {
    const r = await tool.execute(
      { action: 'share-to-gallery', widgetId: 'unknown' },
      ctx()
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Widget not found/);
  });

  test('subsequent local renders flip divergedFromGallery=true', async () => {
    await tool.execute(
      { action: 'share-to-gallery', widgetId: 'calc' },
      ctx()
    );
    // Render new content under the same widgetId — it diverges.
    await tool.execute(
      { action: 'render', kind: 'webcomponent',
        content: 'class C extends LoxiaElement { /* edited */ }',
        widgetId: 'calc' },
      ctx()
    );
    const list = await tool.execute({ action: 'list' }, ctx());
    const w = list.widgets.find(w => w.widgetId === 'calc');
    expect(w.linkedGalleryTemplateId).toBeTruthy();
    expect(w.divergedFromGallery).toBe(true);
  });

  test('re-sharing an edited widget creates a NEW template version', async () => {
    const r1 = await tool.execute(
      { action: 'share-to-gallery', widgetId: 'calc', title: 'shared' },
      ctx()
    );
    // Edit and re-share
    await tool.execute(
      { action: 'render', kind: 'webcomponent', content: 'edited', widgetId: 'calc' },
      ctx()
    );
    const r2 = await tool.execute(
      { action: 'share-to-gallery', widgetId: 'calc', title: 'shared' },
      ctx()
    );
    expect(r2.version).toBe(2);
    expect(r2.templateId).not.toBe(r1.templateId);
    // Re-sharing resets divergedFromGallery (we just synced upstream)
    expect(r2.widget.divergedFromGallery).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// unshare-from-gallery
// ──────────────────────────────────────────────────────────────────────────

describe('unshare-from-gallery', () => {
  test('removes the template from the gallery and clears local linkage', async () => {
    const sh = await tool.execute({ action: 'share-to-gallery', widgetId: 'calc' }, ctx());
    const r = await tool.execute(
      { action: 'unshare-from-gallery', templateId: sh.templateId },
      ctx()
    );
    expect(r.success).toBe(true);
    expect(r.removed).toBe(true);
    // Linkage on the local widget is cleared
    const list = await tool.execute({ action: 'list' }, ctx());
    const w = list.widgets.find(w => w.widgetId === 'calc');
    expect(w.linkedGalleryTemplateId).toBeNull();
  });

  test('idempotent on unknown templateId', async () => {
    const r = await tool.execute(
      { action: 'unshare-from-gallery', templateId: 'totally-fake' },
      ctx()
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Template not found/);
  });

  test('rejects missing templateId', async () => {
    const r = await tool.execute({ action: 'unshare-from-gallery' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/templateId/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// list-gallery
// ──────────────────────────────────────────────────────────────────────────

describe('list-gallery', () => {
  test('returns templates with summaries (no content fetched implicitly)', async () => {
    await tool.execute({ action: 'share-to-gallery', widgetId: 'calc', tags: ['finance'] }, ctx());
    const r = await tool.execute({ action: 'list-gallery' }, ctx());
    expect(r.success).toBe(true);
    expect(r.count).toBe(1);
    expect(r.templates[0]).toEqual(expect.objectContaining({
      templateId: expect.any(String),
      version: 1,
      kind: 'webcomponent',
      tags: ['finance'],
      sharedBy: expect.objectContaining({ agentId: 'a' }),
      size: expect.any(Number),
    }));
    // size is the content length — useful for triage
    expect(r.templates[0].size).toBeGreaterThan(0);
  });

  test('filters by tag', async () => {
    await tool.execute({ action: 'share-to-gallery', widgetId: 'calc', title: 'a', tags: ['finance'] }, ctx());
    // Render and share a second widget with a different tag
    await tool.execute(
      { action: 'render', kind: 'html', content: '<p>x</p>', widgetId: 'card' },
      ctx()
    );
    await tool.execute({ action: 'share-to-gallery', widgetId: 'card', title: 'b', tags: ['demo'] }, ctx());
    const finance = await tool.execute({ action: 'list-gallery', tag: 'finance' }, ctx());
    expect(finance.templates.map(t => t.title)).toEqual(['a']);
    const demo = await tool.execute({ action: 'list-gallery', tag: 'demo' }, ctx());
    expect(demo.templates.map(t => t.title)).toEqual(['b']);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// render-from-gallery
// ──────────────────────────────────────────────────────────────────────────

describe('render-from-gallery', () => {
  test('mints a new local widget linked to the source template', async () => {
    const sh = await tool.execute(
      { action: 'share-to-gallery', widgetId: 'calc', title: 'x' },
      ctx()
    );
    // Use a SECOND agent to render — simulates cross-session reuse
    const r = await tool.execute(
      { action: 'render-from-gallery', templateId: sh.templateId, widgetId: 'borrowed' },
      ctx({ agentId: 'b' })
    );
    expect(r.success).toBe(true);
    expect(r.widgetId).toBe('borrowed');
    expect(r.templateId).toBe(sh.templateId);
    expect(r.templateVersion).toBe(1);
    // Linkage is set; not diverged
    expect(r.widget.linkedGalleryTemplateId).toBe(sh.templateId);
    expect(r.widget.linkedGalleryVersion).toBe(1);
    expect(r.widget.divergedFromGallery).toBe(false);
    // Per-agent isolation — the original agent's widget is untouched
    const bList = await tool.execute({ action: 'list' }, ctx({ agentId: 'b' }));
    expect(bList.widgets.map(w => w.widgetId)).toEqual(['borrowed']);
  });

  test('merges custom props over template defaultProps', async () => {
    // Render a widget with default props, share, then render-from with overrides
    await tool.execute(
      { action: 'render', kind: 'webcomponent', content: 'class X extends LoxiaElement {}',
        widgetId: 'calc', props: { rate: 5, term: 12 } },
      ctx()
    );
    const sh = await tool.execute({ action: 'share-to-gallery', widgetId: 'calc' }, ctx());
    const r = await tool.execute(
      { action: 'render-from-gallery', templateId: sh.templateId, props: { rate: 7 } },
      ctx({ agentId: 'b' })
    );
    expect(r.success).toBe(true);
    expect(r.widget.props).toEqual({ rate: 7, term: 12 }); // override merged
  });

  test('rejects unknown templateId', async () => {
    const r = await tool.execute(
      { action: 'render-from-gallery', templateId: 'fake' },
      ctx()
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Template not found/);
  });

  test('disabled-by-default returns disabled:true (does not bypass the toolConfig kill switch)', async () => {
    const sh = await tool.execute({ action: 'share-to-gallery', widgetId: 'calc' }, ctx());
    const r = await tool.execute(
      { action: 'render-from-gallery', templateId: sh.templateId },
      // No toolConfig — defaults to allowCustomCode=false
      { agentId: 'no-perms' }
    );
    expect(r.success).toBe(false);
    expect(r.disabled).toBe(true);
  });

  test('local edits after render-from-gallery flip divergedFromGallery=true', async () => {
    const sh = await tool.execute({ action: 'share-to-gallery', widgetId: 'calc' }, ctx());
    await tool.execute(
      { action: 'render-from-gallery', templateId: sh.templateId, widgetId: 'mine' },
      ctx({ agentId: 'b' })
    );
    // Re-render LOCALLY with new content — should flip diverged
    await tool.execute(
      { action: 'render', kind: 'webcomponent', content: 'edited', widgetId: 'mine' },
      ctx({ agentId: 'b' })
    );
    const list = await tool.execute({ action: 'list' }, ctx({ agentId: 'b' }));
    const w = list.widgets.find(w => w.widgetId === 'mine');
    expect(w.linkedGalleryTemplateId).toBe(sh.templateId);
    expect(w.divergedFromGallery).toBe(true);
  });

  test('bumps the gallery template renderCount', async () => {
    const sh = await tool.execute({ action: 'share-to-gallery', widgetId: 'calc' }, ctx());
    await tool.execute(
      { action: 'render-from-gallery', templateId: sh.templateId },
      ctx({ agentId: 'b' })
    );
    await tool.execute(
      { action: 'render-from-gallery', templateId: sh.templateId },
      ctx({ agentId: 'c' })
    );
    const list = await tool.execute({ action: 'list-gallery' }, ctx());
    expect(list.templates[0].renderCount).toBe(2);
  });
});
