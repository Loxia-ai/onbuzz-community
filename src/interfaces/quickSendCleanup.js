/**
 * Quick Send agent consolidation.
 *
 * Why this exists
 * ---------------
 * The Quick Send POST handler's singleton lookup historically scanned
 * only the in-memory agent pool. When OnBuzz was driven exclusively
 * from the browser extension (no UI session firing RESUME_SESSION),
 * the pool was empty even though agent-index.json on disk already
 * carried a "Quick Send" entry — so find-or-create created another
 * one, and the disk index accumulated duplicate Quick Send agents
 * over time.
 *
 * `consolidateQuickSendAgents` runs at the start of every POST and:
 *   1. Collects every entry named exactly "Quick Send" from BOTH the
 *      pool AND the persisted agent index.
 *   2. Picks a canonical winner: working model + most recent activity,
 *      else most recent overall.
 *   3. Deletes every other Quick Send entry — via the orchestrator's
 *      DELETE_AGENT action for in-pool entries (which removes pool
 *      memory AND state files), and via direct fs cleanup for
 *      disk-only entries (which DELETE_AGENT can't reach because it
 *      requires the agent to be in the pool).
 *   4. If the canonical is disk-only, loads its per-agent state into
 *      the pool via `agentPool.resumeAgent(...)` so the rest of the
 *      route can use it normally.
 *   5. If every Quick Send candidate has a broken model AND there is
 *      a non-Quick-Send pool agent whose model resolves cleanly, the
 *      caller is told via `recreateRequested: true` to wipe the lot
 *      and let the existing create-with-fallback path build a fresh
 *      Quick Send. Otherwise the caller proceeds with whatever
 *      canonical exists (broken canonicals just hit the structured
 *      503 path the POST handler already has).
 *
 * No core systems are touched. The function is a pure orchestration
 * of existing primitives: agentPool.listActiveAgents,
 * agentPool.deleteAgent (via DELETE_AGENT), agentPool.resumeAgent,
 * stateManager.loadAgentIndex, stateManager.removeFromAgentIndex,
 * and the same preflightCheckModel used by the POST handler.
 *
 * Safety
 * ------
 * - Only entries with `name === "Quick Send"` (exact match) are ever
 *   touched, in pool or on disk.
 * - Every deletion is logged with id, model, lastActivity, source,
 *   and the two sidecar file paths BEFORE the delete fires.
 * - Errors during cleanup are caught and warned, never thrown — a
 *   cleanup failure must not break a legitimate send.
 * - Idempotent. On a second run there's only one Quick Send entry
 *   and the function short-circuits with no deletions.
 */

import { promises as fs } from 'fs';
import path from 'path';

// Internal default — production wiring; tests can override.
const defaultFileOps = {
  unlink: (p) => fs.unlink(p),
  readJson: async (p) => JSON.parse(await fs.readFile(p, 'utf8'))
};

// The exact agent name we're looking for. Kept as a local constant
// rather than imported from quickSendRoutes.js to avoid a circular
// import at module load.
const QUICK_SEND_AGENT_NAME = 'Quick Send';

/**
 * Consolidate Quick Send agents into a single canonical entry.
 *
 * @param {Object} deps
 * @param {Object} deps.orchestrator       - must expose processRequest, agentPool, stateManager, aiService
 * @param {Object} deps.constants          - { INTERFACE_TYPES, ORCHESTRATOR_ACTIONS }
 * @param {Object} deps.logger             - .info / .warn / .error
 * @param {string} deps.sessionId          - EXTENSION_SESSION_ID
 * @param {string} deps.projectDir
 * @param {Function} deps.preflight        - (aiService, modelId) => { ok, ... }
 * @param {Object}   [deps.fileOps]        - test seam for fs operations
 * @returns {Promise<{
 *   canonical: Object | null,
 *   removed: Array<{ id: string, source: 'pool'|'disk-only', model: string|null }>,
 *   recreateRequested: boolean
 * }>}
 */
export async function consolidateQuickSendAgents({
  orchestrator,
  constants,
  logger,
  sessionId,
  projectDir,
  preflight,
  fileOps = defaultFileOps
}) {
  if (typeof preflight !== 'function') {
    throw new Error('consolidateQuickSendAgents: preflight function is required');
  }
  const log = logger || { info: () => {}, warn: () => {}, error: () => {} };
  const empty = { canonical: null, removed: [], recreateRequested: false };

  if (!orchestrator?.agentPool || !orchestrator?.stateManager) return empty;
  const { INTERFACE_TYPES, ORCHESTRATOR_ACTIONS } = constants || {};
  const stateMgr = orchestrator.stateManager;
  const agentPool = orchestrator.agentPool;
  const aiService = orchestrator.aiService;

  // ── 1. Collect candidates ───────────────────────────────────
  let pool = [];
  try {
    pool = await agentPool.listActiveAgents();
  } catch (err) {
    log.warn('Quick Send cleanup: listActiveAgents failed', { error: err.message });
  }
  const poolQS = (pool || []).filter((a) => a && a.name === QUICK_SEND_AGENT_NAME);

  let diskIndex = {};
  try {
    diskIndex = (await stateMgr.loadAgentIndex(projectDir)) || {};
  } catch (err) {
    log.warn('Quick Send cleanup: loadAgentIndex failed', { error: err.message });
  }
  const diskQS = Object.entries(diskIndex)
    .filter(([id, v]) => id && id !== 'undefined' && v && v.name === QUICK_SEND_AGENT_NAME);

  // Build a single de-duplicated map. Pool wins over disk on overlap
  // (pool entry carries more up-to-date currentModel/status).
  const byId = new Map();
  for (const [id, v] of diskQS) {
    byId.set(id, {
      id,
      model: v.model || null,
      lastActivity: v.lastActivity || null,
      stateFile: v.stateFile || null,
      conversationsFile: v.conversationsFile || null,
      inPool: false,
      poolAgent: null
    });
  }
  for (const a of poolQS) {
    const existing = byId.get(a.id) || {};
    byId.set(a.id, {
      id: a.id,
      model: a.currentModel || a.preferredModel || existing.model || null,
      lastActivity: a.lastActivity || existing.lastActivity || null,
      stateFile: existing.stateFile || null,
      conversationsFile: existing.conversationsFile || null,
      inPool: true,
      poolAgent: a
    });
  }

  const all = Array.from(byId.values());
  if (all.length === 0) return empty;

  // ── 2. Sort: most recent first ──────────────────────────────
  const sorted = [...all].sort((a, b) => {
    const ta = new Date(a.lastActivity || 0).getTime();
    const tb = new Date(b.lastActivity || 0).getTime();
    if (ta !== tb) return tb - ta;
    if (a.inPool !== b.inPool) return a.inPool ? -1 : 1;
    return 0;
  });

  // ── 3. Pick canonical ───────────────────────────────────────
  let canonical = null;
  let anyCandidateWorks = false;
  for (const c of sorted) {
    if (c.model && preflight(aiService, c.model).ok) {
      anyCandidateWorks = true;
      if (!canonical) canonical = c;
    }
  }
  if (!canonical) canonical = sorted[0]; // fall back to most-recent broken

  // ── 4. Decide whether to recreate ──────────────────────────
  // If no candidate works AND a non-Quick-Send pool agent's model
  // does, the cleanest fix is to remove ALL Quick Send entries and
  // let the create-with-fallback path build a fresh one. The caller
  // is responsible for that branch; we just signal it.
  let recreateRequested = false;
  if (!anyCandidateWorks) {
    const fallbackInPool = (pool || []).some(
      (a) => a && a.name !== QUICK_SEND_AGENT_NAME && (a.currentModel || a.preferredModel)
        && preflight(aiService, a.currentModel || a.preferredModel).ok
    );
    if (fallbackInPool) {
      recreateRequested = true;
      canonical = null;
    }
  }

  // ── 5. Remove every non-canonical entry (and the canonical too
  //     if recreateRequested fired). Log before each removal. ──
  const toRemove = recreateRequested
    ? sorted
    : sorted.filter((c) => c.id !== canonical.id);

  const removed = [];
  for (const c of toRemove) {
    log.info('Quick Send cleanup: removing duplicate', {
      id: c.id,
      model: c.model,
      lastActivity: c.lastActivity,
      stateFile: c.stateFile,
      conversationsFile: c.conversationsFile,
      source: c.inPool ? 'pool' : 'disk-only',
      reason: recreateRequested ? 'recreate-with-fallback' : 'duplicate'
    });
    try {
      if (c.inPool) {
        // Pool entry — use the orchestrator's normal delete path,
        // which removes the pool entry and cleans state files.
        const resp = await orchestrator.processRequest({
          interface: INTERFACE_TYPES?.WEB || 'web',
          sessionId,
          action: ORCHESTRATOR_ACTIONS?.DELETE_AGENT || 'delete_agent',
          payload: { agentId: c.id },
          projectDir
        });
        if (resp?.success === false) {
          log.warn('Quick Send cleanup: orchestrator DELETE_AGENT did not succeed', {
            id: c.id, error: resp.error
          });
        }
      } else {
        // Disk-only entry — orchestrator's delete path requires the
        // agent in the pool (it calls getAgent first), so we directly
        // remove the index entry and unlink the two sidecar files.
        await stateMgr.removeFromAgentIndex(c.id, projectDir);
        const stateDir = stateMgr.getStateDir(projectDir);
        for (const rel of [c.stateFile, c.conversationsFile]) {
          if (!rel) continue;
          try {
            await fileOps.unlink(path.join(stateDir, rel));
          } catch (err) {
            if (err.code !== 'ENOENT') {
              log.warn('Quick Send cleanup: unlink failed', {
                id: c.id, file: rel, error: err.message
              });
            }
          }
        }
      }
      removed.push({
        id: c.id,
        source: c.inPool ? 'pool' : 'disk-only',
        model: c.model
      });
    } catch (err) {
      // Don't let a cleanup failure break the send.
      log.warn('Quick Send cleanup: removal failed', {
        id: c.id, error: err.message
      });
    }
  }

  if (recreateRequested) {
    log.info('Quick Send cleanup: all candidates broken, requesting recreate via fallback', {
      removedCount: removed.length
    });
    return { canonical: null, removed, recreateRequested: true };
  }

  // ── 6. If the canonical is disk-only, hydrate it into the pool
  //     so the POST handler can use it like a normal pool agent. ─
  let canonicalAgent = canonical.poolAgent;
  if (!canonicalAgent && canonical.stateFile) {
    try {
      const stateDir = stateMgr.getStateDir(projectDir);
      const agentData = await fileOps.readJson(path.join(stateDir, canonical.stateFile));
      canonicalAgent = await agentPool.resumeAgent(agentData);
      log.info('Quick Send cleanup: resumed canonical from disk', {
        id: canonical.id, model: canonicalAgent?.currentModel || canonical.model
      });
    } catch (err) {
      log.warn('Quick Send cleanup: failed to resume canonical from disk', {
        id: canonical.id, error: err.message
      });
      // Best-effort. Caller will fall back to the create path, which
      // is fine — the cleanup itself still removed the duplicates.
    }
  }

  return {
    canonical: canonicalAgent,
    removed,
    recreateRequested: false
  };
}

export const __test = { defaultFileOps };
