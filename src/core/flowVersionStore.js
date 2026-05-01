/**
 * FlowVersionStore — append-only flow version archive.
 *
 * Each PUT to a flow records a new immutable snapshot:
 *   <baseDir>/<safeFlowId>/v-<N>.json   (N monotonically increasing)
 *
 * Snapshot file content: { version: N, savedAt: ISO, flow: <full> }
 *
 * Pure data layer. Routes decide WHEN to record (on save) and HOW to
 * roll back (load version + write through stateManager.updateFlow).
 *
 * Why not just rely on stateManager.updateFlow's overwrite + a backup
 * dir? Versioning needs three guarantees:
 *   1. Monotonic version numbers visible to UI/runs
 *   2. Immutable snapshots (rollback never edits history)
 *   3. Independent of stateManager's internal storage choices
 */

import path from 'path';
import { promises as fs } from 'fs';

function _safe(s) {
  return String(s).replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function _resolveDir(baseDir, flowId) {
  if (typeof flowId === 'string' && (flowId.includes('..') || flowId.startsWith('/') || flowId.startsWith('\\'))) {
    throw new Error(`flowId must not contain ".." or absolute path segments: ${flowId}`);
  }
  const dir = path.resolve(baseDir, _safe(flowId));
  const baseResolved = path.resolve(baseDir);
  if (!dir.startsWith(baseResolved + path.sep) && dir !== baseResolved) {
    throw new Error(`flowId resolves outside baseDir: ${flowId}`);
  }
  return dir;
}

async function _writeAtomic(filePath, json) {
  const tmp = filePath + '.tmp-' + process.pid + '-' + Date.now();
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, filePath);
}

const FILE_RE = /^v-(\d+)\.json$/;

export class FlowVersionStore {
  constructor({ baseDir }) {
    if (!baseDir || typeof baseDir !== 'string') {
      throw new Error('FlowVersionStore requires a string baseDir');
    }
    this.baseDir = baseDir;
  }

  async _nextVersion(dir) {
    let entries;
    try { entries = await fs.readdir(dir); }
    catch (e) {
      if (e?.code === 'ENOENT') return 1;
      throw e;
    }
    let max = 0;
    for (const name of entries) {
      const m = FILE_RE.exec(name);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }

  async recordVersion(flowId, flow) {
    const dir = _resolveDir(this.baseDir, flowId);
    await fs.mkdir(dir, { recursive: true });
    const version = await this._nextVersion(dir);
    const savedAt = new Date().toISOString();
    // Deep-clone to be sure we don't mutate the caller's reference
    // and that the snapshot is decoupled from later mutations.
    const snapshot = { version, savedAt, flow: JSON.parse(JSON.stringify(flow)) };
    await _writeAtomic(path.join(dir, `v-${version}.json`), JSON.stringify(snapshot, null, 2));
    return { version, savedAt };
  }

  async listVersions(flowId) {
    const dir = _resolveDir(this.baseDir, flowId);
    let entries;
    try { entries = await fs.readdir(dir); }
    catch (e) {
      if (e?.code === 'ENOENT') return [];
      throw e;
    }
    const out = [];
    for (const name of entries) {
      const m = FILE_RE.exec(name);
      if (!m) continue;
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8');
        const obj = JSON.parse(raw);
        out.push({
          version: obj.version,
          savedAt: obj.savedAt,
          name: obj.flow?.name,
        });
      } catch { /* skip unreadable */ }
    }
    out.sort((a, b) => a.version - b.version);
    return out;
  }

  async loadVersion(flowId, version) {
    const dir = _resolveDir(this.baseDir, flowId);
    try {
      const raw = await fs.readFile(path.join(dir, `v-${version}.json`), 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      if (e?.code === 'ENOENT') return null;
      throw e;
    }
  }
}

export default FlowVersionStore;
