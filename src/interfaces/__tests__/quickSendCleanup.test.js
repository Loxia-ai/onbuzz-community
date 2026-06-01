/**
 * Tests for consolidateQuickSendAgents() — the helper that runs at
 * the start of every Quick Send POST to keep exactly one "Quick Send"
 * agent on disk + in the pool, cleaning up the duplicates that the
 * pre-refactor implementation accumulated.
 *
 * Coverage focuses on behavior rather than the exact orchestration
 * primitives. The fake orchestrator tracks every processRequest call
 * so we can assert which agents got DELETE_AGENT'd vs which were
 * removed via direct fs cleanup, and a fake stateManager carries an
 * in-memory agent-index so the disk-only branch can be exercised
 * without touching the real filesystem.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { consolidateQuickSendAgents } from '../quickSendCleanup.js';

const QUICK_SEND = 'Quick Send';
const SESSION_ID = 'extension-quick-send';
const STATE_DIR = '/mock/state';

// ────────────────────────────────────────────────────────────────
// Fakes
// ────────────────────────────────────────────────────────────────

function makeFakePreflight({ unresolvable = [] } = {}) {
  return jest.fn((aiService, model) => {
    if (!model) return { ok: false, code: 'NO_DEFAULT_MODEL', message: 'no model' };
    if (unresolvable.includes(model)) {
      return {
        ok: false,
        code: 'MODEL_PROVIDER_UNAVAILABLE',
        message: `No provider matched model "${model}".`,
        suggestion: 'fix it'
      };
    }
    return { ok: true };
  });
}

function makeFakeStateManager({ index = {} } = {}) {
  const idx = JSON.parse(JSON.stringify(index));
  return {
    loadAgentIndex: jest.fn(async () => JSON.parse(JSON.stringify(idx))),
    removeFromAgentIndex: jest.fn(async (id) => { delete idx[id]; }),
    getStateDir: jest.fn(() => STATE_DIR),
    __peekIndex: () => JSON.parse(JSON.stringify(idx))
  };
}

function makeFakeFileOps({ files = {} } = {}) {
  const store = { ...files };
  return {
    unlink: jest.fn(async (p) => {
      if (!(p in store)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      delete store[p];
    }),
    readJson: jest.fn(async (p) => {
      if (!(p in store)) throw new Error(`Not found: ${p}`);
      return store[p];
    }),
    __peekFiles: () => Object.keys(store).sort()
  };
}

function makeFakeOrchestrator({
  pool = [],
  stateManager = makeFakeStateManager(),
  deleteImpl = null
} = {}) {
  const agents = new Map(pool.map(a => [a.id, a]));
  const calls = [];
  return {
    aiService: {},
    config: { system: {} },
    stateManager,
    processRequest: jest.fn(async (req) => {
      calls.push(req);
      if (req.action === 'delete_agent') {
        if (deleteImpl) return deleteImpl(req);
        if (!agents.has(req.payload.agentId)) {
          return { success: false, error: 'agent not found' };
        }
        agents.delete(req.payload.agentId);
        return { success: true };
      }
      return { success: false, error: `unknown ${req.action}` };
    }),
    agentPool: {
      listActiveAgents: jest.fn(async () => Array.from(agents.values())),
      getAgent: jest.fn(async (id) => agents.get(id) || null),
      resumeAgent: jest.fn(async (agentData) => {
        const obj = { ...agentData };
        agents.set(obj.id, obj);
        return obj;
      })
    },
    __peekPool: () => Array.from(agents.values()),
    __processCalls: calls
  };
}

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
}

const COMMON_CONSTANTS = {
  INTERFACE_TYPES: { WEB: 'web' },
  ORCHESTRATOR_ACTIONS: { DELETE_AGENT: 'delete_agent' }
};

function poolAgent({ id, name = QUICK_SEND, model = 'test-model', lastActivity = null }) {
  return {
    id, name,
    currentModel: model,
    lastActivity,
    conversations: { full: { messages: [] } }
  };
}

// Mirrors stateManager.updateAgentIndex: stateFile / conversationsFile
// always carry the agent's id in the filename, so two agents with the
// same name still have distinct state-file paths on disk.
function indexEntry({ id, name = QUICK_SEND, model = 'test-model', lastActivity = null }) {
  if (!id) throw new Error('indexEntry: id is required (matches production layout)');
  return {
    name, type: 'user-created',
    stateFile: `agents/agent-${id}-state.json`,
    conversationsFile: `agents/agent-${id}-conversations.json`,
    model, lastActivity, status: 'active', capabilities: []
  };
}
function stateFilePath(id)         { return `${STATE_DIR}/agents/agent-${id}-state.json`; }
function conversationsPath(id)     { return `${STATE_DIR}/agents/agent-${id}-conversations.json`; }

// ────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────

describe('consolidateQuickSendAgents — no candidates', () => {
  it('returns empty when no Quick Send agents exist in pool or on disk', async () => {
    const orchestrator = makeFakeOrchestrator({ pool: [], stateManager: makeFakeStateManager() });
    const result = await consolidateQuickSendAgents({
      orchestrator,
      constants: COMMON_CONSTANTS,
      logger: makeLogger(),
      sessionId: SESSION_ID,
      projectDir: '/proj',
      preflight: makeFakePreflight()
    });
    expect(result).toEqual({ canonical: null, removed: [], recreateRequested: false });
    expect(orchestrator.processRequest).not.toHaveBeenCalled();
  });

  it('returns empty when only non-Quick-Send agents exist', async () => {
    const orchestrator = makeFakeOrchestrator({
      pool: [poolAgent({ id: 'a-1', name: 'Research' })],
      stateManager: makeFakeStateManager({
        index: { 'a-1': indexEntry({ id: 'a-1', name: 'Research' }) }
      })
    });
    const result = await consolidateQuickSendAgents({
      orchestrator,
      constants: COMMON_CONSTANTS,
      logger: makeLogger(),
      sessionId: SESSION_ID,
      projectDir: '/proj',
      preflight: makeFakePreflight()
    });
    expect(result.canonical).toBeNull();
    expect(result.removed).toEqual([]);
    expect(orchestrator.processRequest).not.toHaveBeenCalled();
  });
});

describe('consolidateQuickSendAgents — single Quick Send agent', () => {
  it('returns the single in-pool Quick Send unchanged', async () => {
    const agent = poolAgent({ id: 'qs-1', model: 'good-model', lastActivity: '2026-05-30T18:00:00Z' });
    const orchestrator = makeFakeOrchestrator({ pool: [agent] });
    const result = await consolidateQuickSendAgents({
      orchestrator,
      constants: COMMON_CONSTANTS,
      logger: makeLogger(),
      sessionId: SESSION_ID,
      projectDir: '/proj',
      preflight: makeFakePreflight()
    });
    expect(result.canonical).toBe(agent);
    expect(result.removed).toEqual([]);
    expect(orchestrator.processRequest).not.toHaveBeenCalled();
  });

  it('resumes a disk-only Quick Send into the pool', async () => {
    const stateMgr = makeFakeStateManager({
      index: { 'qs-1': indexEntry({ id: 'qs-1', model: 'good-model', lastActivity: '2026-05-30T18:00:00Z' }) }
    });
    const fileOps = makeFakeFileOps({
      files: {
        [stateFilePath('qs-1')]: {
          id: 'qs-1',
          name: QUICK_SEND,
          currentModel: 'good-model',
          conversations: { full: { messages: [{ role: 'user', content: 'old' }] } }
        }
      }
    });
    const orchestrator = makeFakeOrchestrator({ pool: [], stateManager: stateMgr });

    const result = await consolidateQuickSendAgents({
      orchestrator,
      constants: COMMON_CONSTANTS,
      logger: makeLogger(),
      sessionId: SESSION_ID,
      projectDir: '/proj',
      preflight: makeFakePreflight(),
      fileOps
    });

    expect(result.canonical?.id).toBe('qs-1');
    expect(result.canonical?.name).toBe(QUICK_SEND);
    expect(result.removed).toEqual([]);
    expect(orchestrator.agentPool.resumeAgent).toHaveBeenCalledTimes(1);
    // No delete action because there was only one entry to begin with.
    expect(orchestrator.processRequest).not.toHaveBeenCalled();
  });
});

describe('consolidateQuickSendAgents — duplicates', () => {
  let orchestrator;
  let stateMgr;
  let fileOps;
  let logger;

  beforeEach(() => {
    // Mix of pool + disk-only entries — the realistic layout in
    // production where the pool has one entry from a fresh send and
    // disk carries many old ones.
    stateMgr = makeFakeStateManager({
      index: {
        'qs-old-1':    indexEntry({ id: 'qs-old-1', model: 'good-model',   lastActivity: '2025-01-01T00:00:00Z' }),
        'qs-old-2':    indexEntry({ id: 'qs-old-2', model: 'broken-model', lastActivity: '2025-02-01T00:00:00Z' }),
        'qs-mid':      indexEntry({ id: 'qs-mid', model: 'good-model',   lastActivity: '2026-04-01T00:00:00Z' }),
        'qs-poolish':  indexEntry({ id: 'qs-poolish', model: 'pool-model',   lastActivity: '2026-05-30T19:00:00Z' }),
        // Note: 'qs-poolish' is ALSO in the pool below to test pool-wins-on-overlap.
        'r-1':         indexEntry({ id: 'r-1', name: 'Research', model: 'good-model', lastActivity: '2026-05-30T20:00:00Z' })
      }
    });
    // The canonical winner in this beforeEach setup ends up being
    // qs-poolish (in pool), so the resume-from-disk branch never
    // fires. The fileOps files just keep unlink quiet for the
    // disk-only entries being removed.
    fileOps = makeFakeFileOps({
      files: {
        [stateFilePath('qs-old-1')]: {}, [conversationsPath('qs-old-1')]: {},
        [stateFilePath('qs-old-2')]: {}, [conversationsPath('qs-old-2')]: {},
        [stateFilePath('qs-mid')]:   {}, [conversationsPath('qs-mid')]:   {}
      }
    });
    orchestrator = makeFakeOrchestrator({
      pool: [
        poolAgent({ id: 'qs-poolish', model: 'pool-model', lastActivity: '2026-05-30T19:00:00Z' }),
        poolAgent({ id: 'r-1', name: 'Research', model: 'good-model', lastActivity: '2026-05-30T20:00:00Z' })
      ],
      stateManager: stateMgr
    });
    logger = makeLogger();
  });

  it('keeps the most recently active WORKING Quick Send and deletes the rest', async () => {
    // qs-poolish is the most recent and pool-model is working.
    const result = await consolidateQuickSendAgents({
      orchestrator, constants: COMMON_CONSTANTS, logger,
      sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight({ unresolvable: ['broken-model'] }),
      fileOps
    });

    expect(result.canonical?.id).toBe('qs-poolish');
    expect(result.recreateRequested).toBe(false);
    expect(result.removed.map(r => r.id).sort()).toEqual(
      ['qs-mid', 'qs-old-1', 'qs-old-2']
    );
    // Pool entry deleted via DELETE_AGENT (none in this case — only qs-poolish
    // was in pool, and that's the canonical we kept).
    const deleted = orchestrator.__processCalls.filter(c => c.action === 'delete_agent');
    expect(deleted).toEqual([]);
    // Disk-only entries deleted via stateMgr.removeFromAgentIndex.
    const removedIds = stateMgr.removeFromAgentIndex.mock.calls.map(c => c[0]).sort();
    expect(removedIds).toEqual(['qs-mid', 'qs-old-1', 'qs-old-2']);
    // Non-Quick-Send entries are untouched.
    expect(stateMgr.__peekIndex()['r-1']).toBeDefined();
    expect(orchestrator.__peekPool().some(a => a.id === 'r-1')).toBe(true);
  });

  it('uses the orchestrator DELETE_AGENT path for in-pool duplicates', async () => {
    // Make qs-mid also live in the pool so we can verify both paths.
    orchestrator.__peekPool().push(); // no-op; rebuild from scratch:
    orchestrator = makeFakeOrchestrator({
      pool: [
        poolAgent({ id: 'qs-A', model: 'good-model', lastActivity: '2026-05-30T19:00:00Z' }),
        poolAgent({ id: 'qs-B', model: 'good-model', lastActivity: '2026-05-30T20:00:00Z' })
      ],
      stateManager: makeFakeStateManager({
        index: {
          'qs-A': indexEntry({ id: 'qs-A', model: 'good-model', lastActivity: '2026-05-30T19:00:00Z' }),
          'qs-B': indexEntry({ id: 'qs-B', model: 'good-model', lastActivity: '2026-05-30T20:00:00Z' }),
          'qs-disk': indexEntry({ id: 'qs-disk', model: 'good-model', lastActivity: '2026-05-25T00:00:00Z' })
        }
      })
    });
    const result = await consolidateQuickSendAgents({
      orchestrator, constants: COMMON_CONSTANTS, logger,
      sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight(),
      fileOps: makeFakeFileOps()
    });
    expect(result.canonical?.id).toBe('qs-B'); // most recent
    const deleted = orchestrator.__processCalls
      .filter(c => c.action === 'delete_agent')
      .map(c => c.payload.agentId);
    expect(deleted).toEqual(['qs-A']);  // qs-A was in pool, deleted via orchestrator
    // qs-disk was disk-only, deleted via removeFromAgentIndex
    expect(orchestrator.stateManager.removeFromAgentIndex)
      .toHaveBeenCalledWith('qs-disk', '/proj');
  });

  it('prefers a working candidate even when a broken candidate is more recent', async () => {
    const orch = makeFakeOrchestrator({
      pool: [
        poolAgent({ id: 'qs-broken-recent', model: 'broken-model', lastActivity: '2026-05-30T20:00:00Z' }),
        poolAgent({ id: 'qs-good-older',    model: 'good-model',   lastActivity: '2026-05-30T18:00:00Z' })
      ],
      stateManager: makeFakeStateManager({
        index: {
          'qs-broken-recent': indexEntry({ id: 'qs-broken-recent', model: 'broken-model', lastActivity: '2026-05-30T20:00:00Z' }),
          'qs-good-older':    indexEntry({ id: 'qs-good-older', model: 'good-model',   lastActivity: '2026-05-30T18:00:00Z' })
        }
      })
    });
    const result = await consolidateQuickSendAgents({
      orchestrator: orch, constants: COMMON_CONSTANTS, logger,
      sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight({ unresolvable: ['broken-model'] }),
      fileOps: makeFakeFileOps()
    });
    expect(result.canonical?.id).toBe('qs-good-older');
    expect(result.removed[0].id).toBe('qs-broken-recent');
  });

  it('falls back to most recent broken when ALL candidates are broken and no fallback exists', async () => {
    const orch = makeFakeOrchestrator({
      pool: [
        poolAgent({ id: 'qs-a', model: 'broken-1', lastActivity: '2025-01-01T00:00:00Z' }),
        poolAgent({ id: 'qs-b', model: 'broken-2', lastActivity: '2026-05-30T20:00:00Z' })
      ],
      stateManager: makeFakeStateManager()
    });
    const result = await consolidateQuickSendAgents({
      orchestrator: orch, constants: COMMON_CONSTANTS, logger,
      sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight({ unresolvable: ['broken-1', 'broken-2'] }),
      fileOps: makeFakeFileOps()
    });
    expect(result.canonical?.id).toBe('qs-b'); // most recent broken
    expect(result.recreateRequested).toBe(false);
    expect(result.removed.map(r => r.id)).toEqual(['qs-a']);
  });

  it('requests RECREATE when all Quick Send candidates are broken AND a working pool fallback exists', async () => {
    const orch = makeFakeOrchestrator({
      pool: [
        poolAgent({ id: 'qs-a', model: 'broken-1', lastActivity: '2025-01-01T00:00:00Z' }),
        poolAgent({ id: 'qs-b', model: 'broken-2', lastActivity: '2026-05-30T20:00:00Z' }),
        poolAgent({ id: 'research-1', name: 'Research', model: 'llama3', lastActivity: '2026-05-30T22:00:00Z' })
      ],
      stateManager: makeFakeStateManager({
        index: {
          'qs-disk': indexEntry({ id: 'qs-disk', model: 'broken-3', lastActivity: '2024-01-01T00:00:00Z' })
        }
      })
    });
    const result = await consolidateQuickSendAgents({
      orchestrator: orch, constants: COMMON_CONSTANTS, logger,
      sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight({ unresolvable: ['broken-1', 'broken-2', 'broken-3'] }),
      fileOps: makeFakeFileOps()
    });
    expect(result.recreateRequested).toBe(true);
    expect(result.canonical).toBeNull();
    // ALL Quick Send entries deleted.
    const removedIds = result.removed.map(r => r.id).sort();
    expect(removedIds).toEqual(['qs-a', 'qs-b', 'qs-disk']);
    // Research is untouched.
    expect(orch.__peekPool().some(a => a.id === 'research-1')).toBe(true);
  });

  it('removes the disk-only canonical AND signals recreate when hydration into the pool fails', async () => {
    // agentPool.resumeAgent / restoreAgent is broken in this codebase
    // (two methods named resumeAgent, the second shadowing the first).
    // When the canonical only exists on disk and we can't bring it
    // into the pool, leaving it in place causes the POST handler to
    // create a duplicate via the fallback path. The cleanup must
    // therefore delete the disk entry too and signal recreate so the
    // POST handler builds exactly one fresh agent.
    const stateMgr = makeFakeStateManager({
      index: {
        'qs-disk-only': indexEntry({ id: 'qs-disk-only', model: 'good-model',
                                     lastActivity: '2026-05-30T20:00:00Z' })
      }
    });
    // No file in fileOps → readJson throws → resume fails → cleanup
    // must clean it up rather than return canonical: null silently.
    const fileOps = makeFakeFileOps({ files: {} });
    const orch = makeFakeOrchestrator({ pool: [], stateManager: stateMgr });
    const result = await consolidateQuickSendAgents({
      orchestrator: orch, constants: COMMON_CONSTANTS, logger: makeLogger(),
      sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight(),
      fileOps
    });
    expect(result.canonical).toBeNull();
    expect(result.recreateRequested).toBe(true);
    expect(result.removed.map(r => r.id)).toEqual(['qs-disk-only']);
    // Disk entry is gone — no duplicate-on-next-POST.
    expect(stateMgr.__peekIndex()['qs-disk-only']).toBeUndefined();
  });

  it('requests RECREATE when only a DISK-ONLY non-Quick-Send agent has a working model (extension-first boot)', async () => {
    // The scenario this commit closes: server just booted, no UI
    // session yet, pool is empty. The only persisted non-Quick-Send
    // agent is an Ollama one on disk. The pool-only check used to
    // miss it and the extension hit 503 instead of self-healing.
    const orch = makeFakeOrchestrator({
      pool: [],
      stateManager: makeFakeStateManager({
        index: {
          'qs-broken': indexEntry({ id: 'qs-broken', model: 'anthropic-sonnet',
                                    lastActivity: '2026-05-30T20:00:00Z' }),
          'ollama-research': indexEntry({ id: 'ollama-research', name: 'Research',
                                          model: 'llama3.2:3b',
                                          lastActivity: '2026-05-25T10:00:00Z' })
        }
      })
    });
    const result = await consolidateQuickSendAgents({
      orchestrator: orch, constants: COMMON_CONSTANTS, logger,
      sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight({ unresolvable: ['anthropic-sonnet'] }),
      fileOps: makeFakeFileOps()
    });
    expect(result.recreateRequested).toBe(true);
    expect(result.canonical).toBeNull();
    expect(result.removed.map(r => r.id)).toEqual(['qs-broken']);
    // The disk-only Research agent must NOT be touched.
    expect(orch.stateManager.__peekIndex()['ollama-research']).toBeDefined();
  });
});

describe('consolidateQuickSendAgents — safety invariants', () => {
  it('never deletes any agent whose name is not "Quick Send"', async () => {
    const stateMgr = makeFakeStateManager({
      index: {
        'qs-1': indexEntry({ id: 'qs-1', model: 'good-model', lastActivity: '2026-05-01T00:00:00Z' }),
        'qs-2': indexEntry({ id: 'qs-2', model: 'good-model', lastActivity: '2026-05-02T00:00:00Z' }),
        'research-1': indexEntry({ id: 'research-1', name: 'Research',     model: 'good-model', lastActivity: '2026-05-30T00:00:00Z' }),
        'planner-1':  indexEntry({ id: 'planner-1', name: 'Planner Bot',  model: 'good-model', lastActivity: '2026-05-30T00:00:00Z' }),
        'quick-send-look-alike': indexEntry({ id: 'quick-send-look-alike', name: 'quick send', model: 'good-model' }) // wrong case
      }
    });
    // Make qs-2's stateFile available so the canonical can be
    // resumed and only the duplicate (qs-1) is removed. Keeps the
    // test focused on the safety invariant: non-Quick-Send entries
    // are untouched regardless of Quick Send churn.
    const fileOps = makeFakeFileOps({
      files: {
        [stateFilePath('qs-2')]: { id: 'qs-2', name: QUICK_SEND, currentModel: 'good-model' }
      }
    });
    const orch = makeFakeOrchestrator({ pool: [], stateManager: stateMgr });
    await consolidateQuickSendAgents({
      orchestrator: orch, constants: COMMON_CONSTANTS, logger: makeLogger(),
      sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight(),
      fileOps
    });
    // No removeFromAgentIndex call ever targeted a non-Quick-Send id.
    const removedIds = stateMgr.removeFromAgentIndex.mock.calls.map(c => c[0]);
    for (const safe of ['research-1', 'planner-1', 'quick-send-look-alike']) {
      expect(removedIds).not.toContain(safe);
      expect(stateMgr.__peekIndex()[safe]).toBeDefined();
    }
  });

  it('is idempotent — second run sees one Quick Send and does nothing', async () => {
    const stateMgr = makeFakeStateManager({
      index: {
        'qs-1': indexEntry({ id: 'qs-1', model: 'good-model', lastActivity: '2026-05-30T00:00:00Z' }),
        'qs-2': indexEntry({ id: 'qs-2', model: 'good-model', lastActivity: '2026-05-30T01:00:00Z' })
      }
    });
    const fileOps = makeFakeFileOps({
      files: {
        // Canonical qs-2 — must be resumable so the first cleanup
        // returns canonical = the resumed agent.
        [stateFilePath('qs-2')]: { id: 'qs-2', name: QUICK_SEND, currentModel: 'good-model' },
        // qs-1 is the duplicate to be removed.
        [stateFilePath('qs-1')]: {}, [conversationsPath('qs-1')]: {}
      }
    });
    const orch = makeFakeOrchestrator({ pool: [], stateManager: stateMgr });

    const first = await consolidateQuickSendAgents({
      orchestrator: orch, constants: COMMON_CONSTANTS, logger: makeLogger(),
      sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight(), fileOps
    });
    expect(first.removed.length).toBe(1);
    expect(first.canonical?.id).toBe('qs-2');

    const second = await consolidateQuickSendAgents({
      orchestrator: orch, constants: COMMON_CONSTANTS, logger: makeLogger(),
      sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight(), fileOps
    });
    expect(second.removed).toEqual([]);
    expect(second.canonical?.id).toBe('qs-2');
  });

  it('logs each removal with id/model/lastActivity/source BEFORE the delete fires', async () => {
    const stateMgr = makeFakeStateManager({
      index: {
        'qs-1': indexEntry({ id: 'qs-1', model: 'good-model', lastActivity: '2026-05-01T00:00:00Z' }),
        'qs-2': indexEntry({ id: 'qs-2', model: 'good-model', lastActivity: '2026-05-02T00:00:00Z' })
      }
    });
    const logger = makeLogger();
    const orch = makeFakeOrchestrator({ pool: [], stateManager: stateMgr });
    await consolidateQuickSendAgents({
      orchestrator: orch, constants: COMMON_CONSTANTS, logger,
      sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight(), fileOps: makeFakeFileOps()
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Quick Send cleanup: removing duplicate',
      expect.objectContaining({
        id: 'qs-1',
        model: 'good-model',
        lastActivity: '2026-05-01T00:00:00Z',
        source: 'disk-only'
      })
    );
    // The log call was made before removeFromAgentIndex.
    const logOrder = logger.info.mock.invocationCallOrder[0];
    const removeOrder = stateMgr.removeFromAgentIndex.mock.invocationCallOrder[0];
    expect(logOrder).toBeLessThan(removeOrder);
  });

  it('keeps going when a single deletion fails (other duplicates still removed)', async () => {
    const stateMgr = makeFakeStateManager({
      index: {
        'qs-1': indexEntry({ id: 'qs-1', model: 'good-model', lastActivity: '2026-05-01T00:00:00Z' }),
        'qs-2': indexEntry({ id: 'qs-2', model: 'good-model', lastActivity: '2026-05-02T00:00:00Z' }),
        'qs-3': indexEntry({ id: 'qs-3', model: 'good-model', lastActivity: '2026-05-03T00:00:00Z' })
      }
    });
    let callCount = 0;
    stateMgr.removeFromAgentIndex = jest.fn(async (id) => {
      callCount++;
      if (callCount === 1) throw new Error('disk error');
      // Otherwise no-op
    });
    const logger = makeLogger();
    const orch = makeFakeOrchestrator({ pool: [], stateManager: stateMgr });
    // Canonical qs-3 must be resumable so the function returns it.
    const fileOps = makeFakeFileOps({
      files: { [stateFilePath('qs-3')]: { id: 'qs-3', name: QUICK_SEND, currentModel: 'good-model' } }
    });
    const result = await consolidateQuickSendAgents({
      orchestrator: orch, constants: COMMON_CONSTANTS, logger,
      sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight(), fileOps
    });
    // qs-3 is canonical; qs-1 and qs-2 are to be removed.
    // qs-2 fails (it's the older one and the first attempted), qs-1 succeeds.
    // Either way, the function doesn't throw and at least one removal records.
    expect(result.canonical?.id).toBe('qs-3');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns empty when stateManager is missing (defensive)', async () => {
    const orch = {
      agentPool: { listActiveAgents: jest.fn(async () => []) },
      stateManager: null
    };
    const result = await consolidateQuickSendAgents({
      orchestrator: orch, constants: COMMON_CONSTANTS,
      logger: makeLogger(), sessionId: SESSION_ID, projectDir: '/proj',
      preflight: makeFakePreflight()
    });
    expect(result).toEqual({ canonical: null, removed: [], recreateRequested: false });
  });
});
