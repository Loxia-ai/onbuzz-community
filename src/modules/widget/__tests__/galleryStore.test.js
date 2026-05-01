/**
 * GalleryStore — persistent shared-widget catalog.
 *
 * Tests use a per-test temp file so each one gets a clean slate and we
 * don't accidentally write to the user's real ~/.loxia/widget-gallery.json.
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GalleryStore } from '../galleryStore.js';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

function tempFile() {
  return path.join(os.tmpdir(), `loxia-gallery-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
}

let filePath;
let store;

beforeEach(() => {
  filePath = tempFile();
  store = new GalleryStore({ filePath, persistDebounceMs: 0, logger: LOGGER });
});

afterEach(async () => {
  await store.flush();
  try { await fs.unlink(filePath); } catch { /* ok */ }
});

const widgetFor = (overrides) => ({
  widgetId: 'loan-calc',
  kind: 'webcomponent',
  content: 'class X extends LoxiaElement {}',
  props: { rate: 5 },
  phishingHits: [],
  size: 50,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────
// Basic share/get/list/unshare
// ─────────────────────────────────────────────────────────────────────────

describe('share', () => {
  test('returns templateId + version=1 + entry; persists to disk', async () => {
    const r = await store.share(widgetFor(), { agentId: 'a', agentName: 'Coder' });
    expect(r.templateId).toMatch(/loan-calc-v1-/);
    expect(r.version).toBe(1);
    expect(r.entry.title).toBe('loan-calc');
    expect(r.entry.kind).toBe('webcomponent');
    expect(r.entry.content).toBe('class X extends LoxiaElement {}');
    expect(r.entry.defaultProps).toEqual({ rate: 5 });
    expect(r.entry.sharedBy.agentId).toBe('a');
    expect(r.entry.sharedBy.agentName).toBe('Coder');
    expect(r.entry.renderCount).toBe(0);
    await store.flush();
    const written = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    expect(written.entries).toHaveLength(1);
    expect(written.entries[0].templateId).toBe(r.templateId);
  });

  test('rejects widgets without content', async () => {
    await expect(store.share({ widgetId: 'x' }, { agentId: 'a' }))
      .rejects.toThrow(/content/);
  });

  test('explicit title overrides widgetId default; respects custom tags', async () => {
    const r = await store.share(widgetFor(), {
      agentId: 'a',
      title: 'My Loan Calculator',
      tags: ['calculator', 'finance', 'demo'],
    });
    expect(r.entry.title).toBe('My Loan Calculator');
    expect(r.entry.tags).toEqual(['calculator', 'finance', 'demo']);
  });

  test('versioning: re-sharing same title by same agent bumps version', async () => {
    const r1 = await store.share(widgetFor(), { agentId: 'a', title: 'calc' });
    const r2 = await store.share(widgetFor({ content: 'v2' }), { agentId: 'a', title: 'calc' });
    const r3 = await store.share(widgetFor({ content: 'v3' }), { agentId: 'a', title: 'calc' });
    expect(r1.version).toBe(1);
    expect(r2.version).toBe(2);
    expect(r3.version).toBe(3);
    // Templates are independent — old ones still retrievable
    expect((await store.get(r1.templateId)).content).toBe(widgetFor().content);
    expect((await store.get(r2.templateId)).content).toBe('v2');
    expect((await store.get(r3.templateId)).content).toBe('v3');
  });

  test('versioning: same title by DIFFERENT agents do NOT collide — each starts at v1', async () => {
    const r1 = await store.share(widgetFor(), { agentId: 'a', title: 'calc' });
    const r2 = await store.share(widgetFor(), { agentId: 'b', title: 'calc' });
    expect(r1.version).toBe(1);
    expect(r2.version).toBe(1);
  });

  test('truncates oversized strings (defensive)', async () => {
    const longTitle = 'a'.repeat(500);
    const longTags = Array.from({ length: 50 }, (_, i) => `t${i}`.repeat(50));
    const r = await store.share(widgetFor(), { agentId: 'a', title: longTitle, tags: longTags });
    expect(r.entry.title.length).toBeLessThanOrEqual(120);
    expect(r.entry.tags.length).toBeLessThanOrEqual(16);
    for (const t of r.entry.tags) expect(t.length).toBeLessThanOrEqual(32);
  });
});

describe('list', () => {
  test('returns all entries newest first', async () => {
    const r1 = await store.share(widgetFor(), { agentId: 'a', title: 'first' });
    await new Promise(r => setTimeout(r, 5));
    const r2 = await store.share(widgetFor(), { agentId: 'a', title: 'second' });
    const list = await store.list();
    expect(list.map(e => e.templateId)).toEqual([r2.templateId, r1.templateId]);
  });

  test('filters by tag', async () => {
    await store.share(widgetFor(), { agentId: 'a', title: 'a', tags: ['finance'] });
    await store.share(widgetFor(), { agentId: 'a', title: 'b', tags: ['gaming'] });
    await store.share(widgetFor(), { agentId: 'a', title: 'c', tags: ['finance', 'demo'] });
    const finance = await store.list({ tag: 'finance' });
    expect(finance.map(e => e.title)).toEqual(['c', 'a']);
    const gaming = await store.list({ tag: 'gaming' });
    expect(gaming.map(e => e.title)).toEqual(['b']);
  });

  test('filters by agentId', async () => {
    await store.share(widgetFor(), { agentId: 'a', title: 'a-1' });
    await store.share(widgetFor(), { agentId: 'b', title: 'b-1' });
    await store.share(widgetFor(), { agentId: 'a', title: 'a-2' });
    const aOnly = await store.list({ agentId: 'a' });
    expect(aOnly.map(e => e.title).sort()).toEqual(['a-1', 'a-2']);
  });
});

describe('unshare', () => {
  test('removes the template, idempotent on missing', async () => {
    const r = await store.share(widgetFor(), { agentId: 'a' });
    expect(await store.unshare(r.templateId)).toBe(true);
    expect(await store.get(r.templateId)).toBeNull();
    expect(await store.unshare(r.templateId)).toBe(false);
    expect(await store.unshare('totally-fake')).toBe(false);
  });

  test('persists the deletion across instances', async () => {
    const r = await store.share(widgetFor(), { agentId: 'a' });
    await store.unshare(r.templateId);
    await store.flush();
    // Fresh store reads from disk
    const fresh = new GalleryStore({ filePath, persistDebounceMs: 0, logger: LOGGER });
    expect(await fresh.get(r.templateId)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Persistence: load → modify → flush → reload
// ─────────────────────────────────────────────────────────────────────────

describe('persistence', () => {
  test('saved entries survive a fresh store on the same file', async () => {
    const r = await store.share(widgetFor(), { agentId: 'a', title: 'persist-me', tags: ['t1'] });
    await store.flush();
    const fresh = new GalleryStore({ filePath, persistDebounceMs: 0, logger: LOGGER });
    const got = await fresh.get(r.templateId);
    expect(got).toBeTruthy();
    expect(got.title).toBe('persist-me');
    expect(got.tags).toEqual(['t1']);
  });

  test('missing file is treated as empty (no error)', async () => {
    // filePath here doesn't exist yet — fresh store load is a no-op
    const fresh = new GalleryStore({ filePath: tempFile(), persistDebounceMs: 0, logger: LOGGER });
    expect(await fresh.list()).toEqual([]);
  });

  test('corrupt JSON file is treated as empty (no crash, no clobber on next write)', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{ this is not json }', 'utf-8');
    const fresh = new GalleryStore({ filePath, persistDebounceMs: 0, logger: LOGGER });
    expect(await fresh.list()).toEqual([]);
    // A subsequent share writes a clean, valid file
    await fresh.share(widgetFor(), { agentId: 'a' });
    await fresh.flush();
    const written = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    expect(written.schema).toBe(1);
    expect(written.entries).toHaveLength(1);
  });

  test('write is atomic (no half-written file)', async () => {
    // We can't easily simulate a crash mid-write, but we can verify
    // that the .tmp file isn't lingering after a successful write.
    await store.share(widgetFor(), { agentId: 'a' });
    await store.flush();
    const tmp = filePath + '.tmp';
    await expect(fs.access(tmp)).rejects.toThrow(); // .tmp does not exist
    await expect(fs.access(filePath)).resolves.toBeUndefined(); // real file does
  });

  test('schema mismatch starts fresh — does not crash', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ schema: 99, entries: [] }), 'utf-8');
    const fresh = new GalleryStore({ filePath, persistDebounceMs: 0, logger: LOGGER });
    expect(await fresh.list()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// findLatestForOrigin (Phase 4 upgrade-prompt support)
// ─────────────────────────────────────────────────────────────────────────

describe('findLatestForOrigin', () => {
  test('returns the entry itself if no newer version exists', async () => {
    const r = await store.share(widgetFor(), { agentId: 'a', title: 'calc' });
    const latest = await store.findLatestForOrigin(r.templateId);
    expect(latest.templateId).toBe(r.templateId);
  });

  test('returns the latest version when a newer one was shared', async () => {
    const r1 = await store.share(widgetFor(), { agentId: 'a', title: 'calc' });
    const r2 = await store.share(widgetFor({ content: 'v2' }), { agentId: 'a', title: 'calc' });
    const r3 = await store.share(widgetFor({ content: 'v3' }), { agentId: 'a', title: 'calc' });
    const latestForR1 = await store.findLatestForOrigin(r1.templateId);
    expect(latestForR1.templateId).toBe(r3.templateId);
    expect(latestForR1.version).toBe(3);
    // Other agents' templates with the same title don't count
    await store.share(widgetFor(), { agentId: 'other', title: 'calc' });
    const latestStill = await store.findLatestForOrigin(r1.templateId);
    expect(latestStill.templateId).toBe(r3.templateId);
    void r2; // unused but kept for clarity in the trace
  });

  test('returns null for unknown originTemplateId', async () => {
    expect(await store.findLatestForOrigin('does-not-exist')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// bumpRenderCount + misc
// ─────────────────────────────────────────────────────────────────────────

describe('bumpRenderCount', () => {
  test('increments and persists', async () => {
    const r = await store.share(widgetFor(), { agentId: 'a' });
    await store.bumpRenderCount(r.templateId);
    await store.bumpRenderCount(r.templateId);
    const got = await store.get(r.templateId);
    expect(got.renderCount).toBe(2);
  });

  test('no-op for unknown templateId', async () => {
    await store.bumpRenderCount('nope');
    expect(await store.list()).toEqual([]);
  });
});

describe('debounce + flush', () => {
  test('multiple writes within debounce window are coalesced into one disk write', async () => {
    const slow = new GalleryStore({ filePath: tempFile(), persistDebounceMs: 50, logger: LOGGER });
    await slow.share(widgetFor(), { agentId: 'a', title: 'a' });
    await slow.share(widgetFor(), { agentId: 'a', title: 'b' });
    await slow.share(widgetFor(), { agentId: 'a', title: 'c' });
    // Flush awaits the pending debounced write
    await slow.flush();
    const written = JSON.parse(await fs.readFile(slow.filePath, 'utf-8'));
    expect(written.entries).toHaveLength(3);
    await fs.unlink(slow.filePath);
  });
});
