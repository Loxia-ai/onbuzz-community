/**
 * FlowVersionStore — append-only history of flow definitions.
 *
 * Layout:
 *   <baseDir>/<flowId>/v-<n>.json   (n is monotonically increasing)
 *
 * On every PUT to a flow, the webServer also writes a new version
 * snapshot. Versions are immutable once written. listVersions returns
 * { version, savedAt } metadata sorted ascending. loadVersion reads
 * the full snapshot. rollback reads version N and lets the caller
 * persist it as the live record (the store itself is read/write of
 * the version archive — the actual "live record swap" stays in the
 * webServer route so we don't tangle responsibilities).
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { FlowVersionStore } from '../flowVersionStore.js';

let tmpRoot;
beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-version-test-'));
});
afterEach(async () => {
  try { await fs.rm(tmpRoot, { recursive: true, force: true }); } catch {}
});

const newStore = () => new FlowVersionStore({ baseDir: tmpRoot });

describe('FlowVersionStore — recordVersion', () => {
  test('first version is 1', async () => {
    const store = newStore();
    const v = await store.recordVersion('f1', { id: 'f1', name: 'A', nodes: [], edges: [] });
    expect(v.version).toBe(1);
    expect(typeof v.savedAt).toBe('string');
  });

  test('subsequent versions increment monotonically', async () => {
    const store = newStore();
    const v1 = await store.recordVersion('f1', { id: 'f1', name: 'A', nodes: [], edges: [] });
    const v2 = await store.recordVersion('f1', { id: 'f1', name: 'A2', nodes: [], edges: [] });
    const v3 = await store.recordVersion('f1', { id: 'f1', name: 'A3', nodes: [], edges: [] });
    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
  });

  test('versions for different flow IDs are independent', async () => {
    const store = newStore();
    const a1 = await store.recordVersion('a', { name: 'a' });
    const b1 = await store.recordVersion('b', { name: 'b' });
    const a2 = await store.recordVersion('a', { name: 'a2' });
    expect(a1.version).toBe(1);
    expect(b1.version).toBe(1);
    expect(a2.version).toBe(2);
  });

  test('records include savedAt ISO timestamp', async () => {
    const store = newStore();
    const v = await store.recordVersion('f1', { name: 'A' });
    expect(v.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('FlowVersionStore — listVersions', () => {
  test('returns [] for unknown flow', async () => {
    const store = newStore();
    expect(await store.listVersions('ghost')).toEqual([]);
  });

  test('returns metadata sorted ascending', async () => {
    const store = newStore();
    await store.recordVersion('f1', { name: 'v1' });
    await store.recordVersion('f1', { name: 'v2' });
    await store.recordVersion('f1', { name: 'v3' });
    const list = await store.listVersions('f1');
    expect(list.map(v => v.version)).toEqual([1, 2, 3]);
    for (const v of list) {
      expect(typeof v.savedAt).toBe('string');
      expect(v.name).toBeDefined();
    }
  });
});

describe('FlowVersionStore — loadVersion', () => {
  test('returns the exact snapshot persisted', async () => {
    const store = newStore();
    const flow = { id: 'f1', name: 'A', nodes: [{ id: 'n1' }], edges: [] };
    await store.recordVersion('f1', flow);
    const loaded = await store.loadVersion('f1', 1);
    expect(loaded.flow).toEqual(flow);
    expect(loaded.version).toBe(1);
    expect(loaded.savedAt).toBeDefined();
  });

  test('returns null for unknown version', async () => {
    const store = newStore();
    expect(await store.loadVersion('f1', 99)).toBe(null);
  });
});

describe('FlowVersionStore — defensive', () => {
  test('refuses path-traversal in flowId', async () => {
    const store = newStore();
    await expect(store.recordVersion('../escape', { name: 'x' })).rejects.toThrow();
  });

  test('handles flow id with slashes/colons via sanitization', async () => {
    const store = newStore();
    const v = await store.recordVersion('flow:complex/id', { name: 'x' });
    expect(v.version).toBe(1);
    const list = await store.listVersions('flow:complex/id');
    expect(list).toHaveLength(1);
  });

  test('does not mutate the input flow object', async () => {
    const store = newStore();
    const flow = { id: 'f', name: 'orig', nodes: [] };
    const snap = JSON.parse(JSON.stringify(flow));
    await store.recordVersion('f', flow);
    expect(flow).toEqual(snap);
  });
});
