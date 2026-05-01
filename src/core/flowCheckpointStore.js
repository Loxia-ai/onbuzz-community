/**
 * FlowCheckpointStore — disk persistence for flow run state.
 *
 * Layout:
 *   <baseDir>/<runId>/run.json         — top-level run metadata + nodeStates
 *   <baseDir>/<runId>/node-<id>.json   — per-node recorded result
 *
 * Why per-node files: a single run.json rewritten after every node is
 * fine for small flows but loses partial-write safety. Per-node files
 * are written once per completion (atomic via tmp+rename) and let the
 * resume path reconstruct progress even if run.json is missing or stale.
 *
 * API surface (intentionally narrow — pure data layer):
 *   saveRun(run)                         → void
 *   loadRun(runId)                       → run | null
 *   saveNodeResult(runId, nodeId, value) → void
 *   loadNodeResult(runId, nodeId)        → value | null
 *   listNodeResults(runId)               → string[]
 *   loadAllNodeResults(runId)            → { [nodeId]: value }
 *   clearRun(runId)                      → void
 */

import path from 'path';
import { promises as fs } from 'fs';

// Filenames sanitize node IDs that contain slashes / colons / other
// characters that aren't safe to drop into a path. We ALSO encode the
// original id in the file content so loads round-trip exactly.
function _safeName(s) {
  return String(s).replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function _resolveRunDir(baseDir, runId) {
  // Defense against ".." escapes — the resolved dir MUST stay under baseDir.
  const safeId = _safeName(runId);
  const dir = path.resolve(baseDir, safeId);
  const baseResolved = path.resolve(baseDir);
  if (!dir.startsWith(baseResolved + path.sep) && dir !== baseResolved) {
    throw new Error(`runId resolves outside baseDir (refusing): ${runId}`);
  }
  // Also reject obviously-malicious raw inputs to give a clearer error.
  if (typeof runId === 'string' && (runId.includes('..') || runId.startsWith('/') || runId.startsWith('\\'))) {
    throw new Error(`runId must not contain "..", absolute path segments, or escape attempts: ${runId}`);
  }
  return dir;
}

async function _writeAtomic(filePath, json) {
  const tmp = filePath + '.tmp-' + process.pid + '-' + Date.now();
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, filePath);
}

export class FlowCheckpointStore {
  constructor({ baseDir }) {
    if (!baseDir || typeof baseDir !== 'string') {
      throw new Error('FlowCheckpointStore requires a string baseDir');
    }
    this.baseDir = baseDir;
  }

  async saveRun(run) {
    if (!run || typeof run.id !== 'string') {
      throw new Error('saveRun requires run.id');
    }
    const dir = _resolveRunDir(this.baseDir, run.id);
    await fs.mkdir(dir, { recursive: true });
    await _writeAtomic(path.join(dir, 'run.json'), JSON.stringify(run, null, 2));
  }

  async loadRun(runId) {
    const dir = _resolveRunDir(this.baseDir, runId);
    try {
      const raw = await fs.readFile(path.join(dir, 'run.json'), 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      if (e?.code === 'ENOENT') return null;
      throw e;
    }
  }

  /**
   * Per-node result file. We store the original nodeId inside the JSON
   * so listNodeResults can return the original ids regardless of how
   * the filename was sanitized.
   */
  async saveNodeResult(runId, nodeId, value) {
    const dir = _resolveRunDir(this.baseDir, runId);
    await fs.mkdir(dir, { recursive: true });
    const safe = _safeName(nodeId);
    const fname = `node-${safe}.json`;
    const payload = { nodeId, value };
    await _writeAtomic(path.join(dir, fname), JSON.stringify(payload, null, 2));
  }

  async loadNodeResult(runId, nodeId) {
    const dir = _resolveRunDir(this.baseDir, runId);
    const safe = _safeName(nodeId);
    try {
      const raw = await fs.readFile(path.join(dir, `node-${safe}.json`), 'utf8');
      const obj = JSON.parse(raw);
      return obj && 'value' in obj ? obj.value : null;
    } catch (e) {
      if (e?.code === 'ENOENT') return null;
      throw e;
    }
  }

  async listNodeResults(runId) {
    const dir = _resolveRunDir(this.baseDir, runId);
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch (e) {
      if (e?.code === 'ENOENT') return [];
      throw e;
    }
    const ids = [];
    for (const name of entries) {
      if (!name.startsWith('node-') || !name.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8');
        const obj = JSON.parse(raw);
        if (obj?.nodeId) ids.push(obj.nodeId);
      } catch { /* skip unreadable entries */ }
    }
    return ids;
  }

  async loadAllNodeResults(runId) {
    const ids = await this.listNodeResults(runId);
    const out = {};
    for (const id of ids) {
      const v = await this.loadNodeResult(runId, id);
      if (v !== null) out[id] = v;
    }
    return out;
  }

  async clearRun(runId) {
    const dir = _resolveRunDir(this.baseDir, runId);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export default FlowCheckpointStore;
