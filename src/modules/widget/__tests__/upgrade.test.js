/**
 * check-upgrade / apply-upgrade — the upstream-tracking flow that lets
 * gallery consumers see "v2 available" badges and pull updates into
 * their local widget without manual re-render.
 *
 * Frozen-at-share-time + opt-in upgrade: rendering from the gallery
 * creates a local copy linked to the source templateId. When the
 * source agent re-shares (creating a new template version), consumers
 * get hasUpgrade=true on check-upgrade. apply-upgrade pulls the new
 * content as a NEW local version — old versions stay in history so
 * the user can rollback via set-main.
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WidgetTool } from '../widgetTool.js';
import { GalleryStore } from '../galleryStore.js';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const ctx = (overrides = {}) => ({
  agentId: 'sharer',
  agentName: 'Sharer',
  toolConfig: { allowCustomCode: true },
  ...overrides,
});

function tempFile() {
  return path.join(os.tmpdir(), `loxia-upgrade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
}

let tool, gallery, filePath;

beforeEach(async () => {
  filePath = tempFile();
  gallery = new GalleryStore({ filePath, persistDebounceMs: 0, logger: LOGGER });
  tool = new WidgetTool({}, LOGGER);
  tool.setGalleryStore(gallery);
  // Sharer renders + shares an initial widget
  await tool.execute(
    { action: 'render', kind: 'webcomponent',
      content: 'class V1 extends LoxiaElement {}',
      widgetId: 'tmpl' },
    ctx()
  );
});

afterEach(async () => {
  await gallery.flush();
  try { await fs.unlink(filePath); } catch { /* ok */ }
});

// ─────────────────────────────────────────────────────────────────────────
// check-upgrade
// ─────────────────────────────────────────────────────────────────────────

describe('check-upgrade', () => {
  test('not-linked widget reports hasUpgrade=false (reason: not-linked)', async () => {
    const r = await tool.execute(
      { action: 'check-upgrade', widgetId: 'tmpl' },
      ctx()
    );
    expect(r.success).toBe(true);
    expect(r.hasUpgrade).toBe(false);
    expect(r.reason).toBe('not-linked');
  });

  test('linked widget on latest version reports hasUpgrade=false', async () => {
    const sh = await tool.execute({ action: 'share-to-gallery', widgetId: 'tmpl' }, ctx());
    // Consumer renders from the freshly-shared template
    await tool.execute(
      { action: 'render-from-gallery', templateId: sh.templateId, widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    const r = await tool.execute(
      { action: 'check-upgrade', widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    expect(r.hasUpgrade).toBe(false);
    expect(r.currentVersion).toBe(1);
    expect(r.latestVersion).toBe(1);
  });

  test('linked widget reports hasUpgrade=true when sharer publishes a new version', async () => {
    const sh1 = await tool.execute({ action: 'share-to-gallery', widgetId: 'tmpl' }, ctx());
    await tool.execute(
      { action: 'render-from-gallery', templateId: sh1.templateId, widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    // Sharer edits + re-shares
    await tool.execute(
      { action: 'render', kind: 'webcomponent', content: 'class V2 extends LoxiaElement {}', widgetId: 'tmpl' },
      ctx()
    );
    const sh2 = await tool.execute({ action: 'share-to-gallery', widgetId: 'tmpl' }, ctx());

    const r = await tool.execute(
      { action: 'check-upgrade', widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    expect(r.hasUpgrade).toBe(true);
    expect(r.currentVersion).toBe(1);
    expect(r.latestVersion).toBe(2);
    expect(r.latestTemplateId).toBe(sh2.templateId);
  });

  test('diverged widget reports hasUpgrade=false (reason: diverged)', async () => {
    const sh = await tool.execute({ action: 'share-to-gallery', widgetId: 'tmpl' }, ctx());
    await tool.execute(
      { action: 'render-from-gallery', templateId: sh.templateId, widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    // Consumer edits locally (forks)
    await tool.execute(
      { action: 'render', kind: 'webcomponent', content: 'edited', widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    // Sharer publishes a new version — should NOT prompt the diverged consumer
    await tool.execute(
      { action: 'render', kind: 'webcomponent', content: 'V3', widgetId: 'tmpl' },
      ctx()
    );
    await tool.execute({ action: 'share-to-gallery', widgetId: 'tmpl' }, ctx());

    const r = await tool.execute(
      { action: 'check-upgrade', widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    expect(r.hasUpgrade).toBe(false);
    expect(r.reason).toBe('diverged');
  });

  test('linked-but-template-deleted reports hasUpgrade=false (reason: linked-template-missing)', async () => {
    const sh = await tool.execute({ action: 'share-to-gallery', widgetId: 'tmpl' }, ctx());
    await tool.execute(
      { action: 'render-from-gallery', templateId: sh.templateId, widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    // Sharer unshares — but consumer's widget is already in Sharer's
    // local state and got its link cleared by unshare-from-gallery's
    // local-cleanup. So we simulate the cross-session case: consumer's
    // widget still has the linked id but the gallery doesn't.
    await gallery.unshare(sh.templateId);

    const r = await tool.execute(
      { action: 'check-upgrade', widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    expect(r.hasUpgrade).toBe(false);
    expect(r.reason).toBe('linked-template-missing');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// apply-upgrade
// ─────────────────────────────────────────────────────────────────────────

describe('apply-upgrade', () => {
  test('pulls the latest version as a new local version; old version is preserved', async () => {
    const sh1 = await tool.execute({ action: 'share-to-gallery', widgetId: 'tmpl' }, ctx());
    const r1 = await tool.execute(
      { action: 'render-from-gallery', templateId: sh1.templateId, widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    expect(r1.widget.versions).toHaveLength(1);
    // Sharer publishes v2
    await tool.execute(
      { action: 'render', kind: 'webcomponent', content: 'class V2 {}', widgetId: 'tmpl' },
      ctx()
    );
    await tool.execute({ action: 'share-to-gallery', widgetId: 'tmpl' }, ctx());
    // Consumer applies the upgrade
    const upg = await tool.execute(
      { action: 'apply-upgrade', widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    expect(upg.success).toBe(true);
    expect(upg.fromVersion).toBe(1);
    expect(upg.toVersion).toBe(2);
    // The consumer's widget now has TWO versions; latest is the
    // upgrade, but older is still rollback-able.
    const list = await tool.execute(
      { action: 'list-versions', widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    expect(list.versions).toHaveLength(2);
    expect(list.versions[1].versionId).toBe(upg.newVersionId);
    // Linkage updated, not diverged
    const got = await tool.execute({ action: 'list' }, ctx({ agentId: 'consumer' }));
    const w = got.widgets.find(w => w.widgetId === 'borrowed');
    expect(w.linkedGalleryVersion).toBe(2);
    expect(w.divergedFromGallery).toBe(false);
  });

  test('refuses to upgrade when widget has diverged (protects local edits)', async () => {
    const sh = await tool.execute({ action: 'share-to-gallery', widgetId: 'tmpl' }, ctx());
    await tool.execute(
      { action: 'render-from-gallery', templateId: sh.templateId, widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    // Consumer edits → diverged
    await tool.execute(
      { action: 'render', kind: 'webcomponent', content: 'mine', widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    // Sharer publishes v2
    await tool.execute(
      { action: 'render', kind: 'webcomponent', content: 'v2', widgetId: 'tmpl' },
      ctx()
    );
    await tool.execute({ action: 'share-to-gallery', widgetId: 'tmpl' }, ctx());
    const upg = await tool.execute(
      { action: 'apply-upgrade', widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    expect(upg.success).toBe(false);
    expect(upg.error).toMatch(/diverged/i);
  });

  test('refuses when widget is not linked to any gallery template', async () => {
    const r = await tool.execute(
      { action: 'apply-upgrade', widgetId: 'tmpl' },
      ctx()
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not linked/i);
  });

  test('refuses when there is no newer version', async () => {
    const sh = await tool.execute({ action: 'share-to-gallery', widgetId: 'tmpl' }, ctx());
    await tool.execute(
      { action: 'render-from-gallery', templateId: sh.templateId, widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    const r = await tool.execute(
      { action: 'apply-upgrade', widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already on the latest/i);
  });

  test('refuses when the linked template was deleted from the gallery', async () => {
    const sh = await tool.execute({ action: 'share-to-gallery', widgetId: 'tmpl' }, ctx());
    await tool.execute(
      { action: 'render-from-gallery', templateId: sh.templateId, widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    await gallery.unshare(sh.templateId);
    const r = await tool.execute(
      { action: 'apply-upgrade', widgetId: 'borrowed' },
      ctx({ agentId: 'consumer' })
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no longer exists/i);
  });
});
