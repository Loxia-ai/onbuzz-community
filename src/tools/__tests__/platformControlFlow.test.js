/**
 * Tool-level tests for the flow CRUD + execution actions on
 * platformcontrol.
 *
 * Stubs the injected services (stateManager, flowExecutor). Pins:
 *   - Permission level gating per action (disabled / self-created / all)
 *   - Read endpoints (list/get) unrestricted at any non-disabled level
 *   - Mutation endpoints respect self-created vs all
 *   - Quota enforcement (maxFlowsCreated)
 *   - createdBy tagging on new flows
 *   - delete cascades through stateManager.deleteFlow
 *   - execute-flow attributes the run to the calling agent
 *   - dry-run-flow accepts EITHER an existing flowId OR an inline flow def
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { PlatformControlTool } from '../platformControlTool.js';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

// ── Stubs ───────────────────────────────────────────────────────────

function makeStateManager(initialFlows = []) {
  const flows = new Map(initialFlows.map(f => [f.id, f]));
  let createCounter = flows.size;
  return {
    config: { project: { directory: '/test/proj' } },
    getAllFlows: jest.fn(async () => Array.from(flows.values())),
    getFlow:     jest.fn(async (id) => flows.get(id) || null),
    createFlow:  jest.fn(async (def) => {
      createCounter += 1;
      const id = `flow-${createCounter}`;
      const f = { id, version: 1, ...def };
      flows.set(id, f);
      return f;
    }),
    updateFlow:  jest.fn(async (id, patch) => {
      const f = flows.get(id);
      if (!f) throw new Error(`Flow not found: ${id}`);
      Object.assign(f, patch);
      return f;
    }),
    deleteFlow:  jest.fn(async (id) => {
      if (!flows.has(id)) throw new Error(`Flow not found: ${id}`);
      flows.delete(id);
      return true;
    }),
    _flows: flows,
  };
}

function makeFlowExecutor() {
  return {
    executeFlow: jest.fn(async (flowId) => ({ runId: `run-${flowId}-1`, status: 'queued' })),
    dryRun:      jest.fn(async () => ({ ok: true, errors: [], warnings: [] })),
  };
}

const ctx = ({ agentId = 'caller', cfg = {} } = {}) => ({
  agentId,
  toolConfig: cfg,
});

// Minimal valid flow definition the createFlow stub accepts.
const validNodes = () => ([
  { id: 'in', type: 'input', position: { x: 0, y: 0 }, inputs: [],
    outputs: [{ name: 'topic', type: 'text', description: 'Topic.' }] },
  { id: 'out', type: 'output', position: { x: 200, y: 0 }, data: { outputFormat: 'text' },
    inputs: [{ name: 'context', type: 'text', required: true, description: 'Output ctx.' }],
    outputs: [] },
]);

// ── Permission gating ──────────────────────────────────────────────

describe('flow permission gating', () => {
  let tool, stateManager;
  beforeEach(() => {
    tool = new PlatformControlTool({}, LOGGER);
    stateManager = makeStateManager([
      { id: 'f-mine',  name: 'Mine',  createdBy: 'caller',       nodes: [], edges: [] },
      { id: 'f-other', name: 'Other', createdBy: 'someone-else', nodes: [], edges: [] },
    ]);
    tool.setStateManager(stateManager);
    tool.setFlowExecutor(makeFlowExecutor());
  });

  test('disabled (default) → list-flows refused with disabled:true', async () => {
    const r = await tool.execute({ action: 'list-flows' }, ctx());
    expect(r).toMatchObject({ success: false, disabled: true });
  });

  test('self-created → list-flows OK (read is unrestricted)', async () => {
    const r = await tool.execute({ action: 'list-flows' }, ctx({ cfg: { flows: 'self-created' } }));
    expect(r.success).toBe(true);
    // List exposes ALL flows even at self-created — so the agent can
    // browse and decide what to run/clone. Mutability is annotated
    // per-row.
    expect(r.flows.length).toBe(2);
    const byId = Object.fromEntries(r.flows.map(f => [f.id, f]));
    expect(byId['f-mine'].mutable).toBe(true);
    expect(byId['f-other'].mutable).toBe(false);
  });

  test('all → list-flows shows all rows mutable', async () => {
    const r = await tool.execute({ action: 'list-flows' }, ctx({ cfg: { flows: 'all' } }));
    expect(r.success).toBe(true);
    expect(r.flows.every(f => f.mutable)).toBe(true);
  });

  test('self-created + delete-flow on someone else\'s → out of scope', async () => {
    const r = await tool.execute({ action: 'delete-flow', flowId: 'f-other' },
      ctx({ cfg: { flows: 'self-created' } }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/self-created/i);
    expect(stateManager.deleteFlow).not.toHaveBeenCalled();
  });

  test('self-created + delete-flow on my own → success', async () => {
    const r = await tool.execute({ action: 'delete-flow', flowId: 'f-mine' },
      ctx({ cfg: { flows: 'self-created' } }));
    expect(r.success).toBe(true);
    expect(stateManager.deleteFlow).toHaveBeenCalledWith('f-mine', '/test/proj');
  });

  test('all mode → delete-flow on someone else\'s → success', async () => {
    const r = await tool.execute({ action: 'delete-flow', flowId: 'f-other' },
      ctx({ cfg: { flows: 'all' } }));
    expect(r.success).toBe(true);
    expect(stateManager.deleteFlow).toHaveBeenCalledWith('f-other', '/test/proj');
  });

  test('disabled mode rejects EVERY mutation action with disabled:true', async () => {
    for (const action of ['create-flow', 'update-flow', 'delete-flow', 'execute-flow', 'dry-run-flow']) {
      const r = await tool.execute({ action, flowId: 'f-mine' }, ctx());
      expect(r).toMatchObject({ success: false, disabled: true });
    }
  });
});

// ── create-flow ────────────────────────────────────────────────────

describe('create-flow', () => {
  let tool, stateManager;
  beforeEach(() => {
    tool = new PlatformControlTool({}, LOGGER);
    stateManager = makeStateManager();
    tool.setStateManager(stateManager);
    tool.setFlowExecutor(makeFlowExecutor());
  });

  test('stamps createdBy from caller (so self-created scope can find it later)', async () => {
    const r = await tool.execute(
      { action: 'create-flow', name: 'Test', nodes: validNodes() },
      ctx({ agentId: 'caller-x', cfg: { flows: 'self-created' } })
    );
    expect(r.success).toBe(true);
    expect(stateManager.createFlow).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: 'caller-x', name: 'Test' }),
      '/test/proj'
    );
  });

  test('rejects when name is missing', async () => {
    const r = await tool.execute(
      { action: 'create-flow', nodes: validNodes() },
      ctx({ cfg: { flows: 'all' } })
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/name is required/i);
    expect(stateManager.createFlow).not.toHaveBeenCalled();
  });

  test('rejects when nodes is empty / missing', async () => {
    const r1 = await tool.execute(
      { action: 'create-flow', name: 'x', nodes: [] },
      ctx({ cfg: { flows: 'all' } })
    );
    expect(r1.success).toBe(false);
    const r2 = await tool.execute(
      { action: 'create-flow', name: 'x' },
      ctx({ cfg: { flows: 'all' } })
    );
    expect(r2.success).toBe(false);
    expect(stateManager.createFlow).not.toHaveBeenCalled();
  });
});

// ── maxFlowsCreated quota ──────────────────────────────────────────

describe('maxFlowsCreated quota', () => {
  test('rejects creation past the per-creator quota', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    const stateManager = makeStateManager([
      { id: 'a', name: 'A', createdBy: 'caller', nodes: [], edges: [] },
      { id: 'b', name: 'B', createdBy: 'caller', nodes: [], edges: [] },
    ]);
    tool.setStateManager(stateManager);
    tool.setFlowExecutor(makeFlowExecutor());

    const r = await tool.execute(
      { action: 'create-flow', name: 'C', nodes: validNodes() },
      ctx({ cfg: { flows: 'self-created', maxFlowsCreated: 2 } })
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/maxFlowsCreated quota/i);
    expect(stateManager.createFlow).not.toHaveBeenCalled();
  });

  test('does not count flows authored by OTHER agents toward this caller\'s quota', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    const stateManager = makeStateManager([
      { id: 'a', name: 'A', createdBy: 'someone-else', nodes: [], edges: [] },
      { id: 'b', name: 'B', createdBy: 'someone-else', nodes: [], edges: [] },
    ]);
    tool.setStateManager(stateManager);
    tool.setFlowExecutor(makeFlowExecutor());

    const r = await tool.execute(
      { action: 'create-flow', name: 'mine', nodes: validNodes() },
      ctx({ cfg: { flows: 'self-created', maxFlowsCreated: 2 } })
    );
    // Caller has authored 0 of 2 — even though there are 2 flows total,
    // they aren't theirs.
    expect(r.success).toBe(true);
  });

  test('null/unset maxFlowsCreated = unlimited', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    const stateManager = makeStateManager([
      ...Array.from({ length: 50 }, (_, i) => ({ id: `f-${i}`, createdBy: 'caller', nodes: [], edges: [] })),
    ]);
    tool.setStateManager(stateManager);
    tool.setFlowExecutor(makeFlowExecutor());

    const r = await tool.execute(
      { action: 'create-flow', name: 'unlimited', nodes: validNodes() },
      ctx({ cfg: { flows: 'all' } })  // no maxFlowsCreated set
    );
    expect(r.success).toBe(true);
  });
});

// ── update-flow ────────────────────────────────────────────────────

describe('update-flow', () => {
  let tool, stateManager;
  beforeEach(() => {
    tool = new PlatformControlTool({}, LOGGER);
    stateManager = makeStateManager([
      { id: 'f1', name: 'Mine', createdBy: 'caller', nodes: validNodes(), edges: [] },
    ]);
    tool.setStateManager(stateManager);
    tool.setFlowExecutor(makeFlowExecutor());
  });

  test('strips identity-spoof fields from the patch (id, createdBy, version)', async () => {
    const r = await tool.execute(
      { action: 'update-flow', flowId: 'f1',
        id: 'spoofed-id', createdBy: 'spoofed-creator', version: 999,
        name: 'Renamed', description: 'New desc' },
      ctx({ cfg: { flows: 'self-created' } })
    );
    expect(r.success).toBe(true);
    const callArgs = stateManager.updateFlow.mock.calls[0];
    expect(callArgs[0]).toBe('f1');                                 // flowId
    expect(callArgs[1]).not.toHaveProperty('id');
    expect(callArgs[1]).not.toHaveProperty('createdBy');
    expect(callArgs[1]).not.toHaveProperty('version');
    expect(callArgs[1].name).toBe('Renamed');
    expect(callArgs[1].description).toBe('New desc');
  });

  test('returns 404-shape for unknown flowId', async () => {
    const r = await tool.execute(
      { action: 'update-flow', flowId: 'nonexistent', name: 'x' },
      ctx({ cfg: { flows: 'all' } })
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });
});

// ── execute-flow ───────────────────────────────────────────────────

describe('execute-flow', () => {
  let tool, stateManager, flowExecutor;
  beforeEach(() => {
    tool = new PlatformControlTool({}, LOGGER);
    stateManager = makeStateManager([
      { id: 'f-mine',  name: 'M', createdBy: 'caller',       nodes: [] },
      { id: 'f-other', name: 'O', createdBy: 'someone-else', nodes: [] },
    ]);
    flowExecutor = makeFlowExecutor();
    tool.setStateManager(stateManager);
    tool.setFlowExecutor(flowExecutor);
  });

  test('refuses when flowExecutor is not wired', async () => {
    const t2 = new PlatformControlTool({}, LOGGER);
    t2.setStateManager(stateManager);
    // Note: setFlowExecutor NOT called.
    const r = await t2.execute(
      { action: 'execute-flow', flowId: 'f-mine' },
      ctx({ cfg: { flows: 'all' } })
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/FlowExecutor not available/i);
  });

  test('runs the flow + tags the run with the caller as triggeredBy.agent', async () => {
    const r = await tool.execute(
      { action: 'execute-flow', flowId: 'f-mine', input: { x: 1 } },
      ctx({ agentId: 'caller', cfg: { flows: 'self-created' } })
    );
    expect(r.success).toBe(true);
    expect(r.runId).toBeDefined();
    expect(flowExecutor.executeFlow).toHaveBeenCalledWith(
      'f-mine',
      { x: 1 },
      expect.objectContaining({
        triggeredBy: { kind: 'agent', agentId: 'caller' },
      })
    );
  });

  test('self-created mode + execute someone else\'s flow → out of scope', async () => {
    const r = await tool.execute(
      { action: 'execute-flow', flowId: 'f-other' },
      ctx({ cfg: { flows: 'self-created' } })
    );
    expect(r.success).toBe(false);
    expect(flowExecutor.executeFlow).not.toHaveBeenCalled();
  });
});

// ── dry-run-flow ───────────────────────────────────────────────────

describe('dry-run-flow', () => {
  let tool, stateManager, flowExecutor;
  beforeEach(() => {
    tool = new PlatformControlTool({}, LOGGER);
    stateManager = makeStateManager([
      { id: 'saved', name: 'Saved', createdBy: 'caller', nodes: validNodes(), edges: [] },
    ]);
    flowExecutor = makeFlowExecutor();
    tool.setStateManager(stateManager);
    tool.setFlowExecutor(flowExecutor);
  });

  test('accepts an existing flowId and returns the executor\'s lint report', async () => {
    const r = await tool.execute(
      { action: 'dry-run-flow', flowId: 'saved' },
      ctx({ cfg: { flows: 'self-created' } })
    );
    expect(r.success).toBe(true);
    expect(r.report).toEqual({ ok: true, errors: [], warnings: [] });
    expect(flowExecutor.dryRun).toHaveBeenCalled();
  });

  test('accepts an inline flow definition (so an agent can lint a draft before saving)', async () => {
    const draft = { name: 'draft', nodes: validNodes(), edges: [] };
    const r = await tool.execute(
      { action: 'dry-run-flow', flow: draft },
      ctx({ cfg: { flows: 'self-created' } })
    );
    expect(r.success).toBe(true);
    expect(flowExecutor.dryRun).toHaveBeenCalledWith(draft);
  });

  test('rejects when neither flowId nor flow is provided', async () => {
    const r = await tool.execute(
      { action: 'dry-run-flow' },
      ctx({ cfg: { flows: 'self-created' } })
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/flowId.*flow/i);
  });
});

// ── list-capabilities surfaces flows ────────────────────────────────

describe('list-capabilities (flows surface)', () => {
  test('surfaces flow level + max + boolean caps', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    tool.setStateManager(makeStateManager());
    tool.setFlowExecutor(makeFlowExecutor());
    const r = await tool.execute({ action: 'list-capabilities' },
      ctx({ cfg: { flows: 'self-created', maxFlowsCreated: 5 } }));
    expect(r.success).toBe(true);
    expect(r.capabilities.flows).toMatchObject({
      level: 'self-created',
      maxFlowsCreated: 5,
      canList:        true,
      canCreate:      true,
      canMutateSelfCreated: true,
      canMutateAll:   false,
    });
  });

  test('disabled flow level surfaces canList=false / canCreate=false', async () => {
    const tool = new PlatformControlTool({}, LOGGER);
    tool.setStateManager(makeStateManager());
    tool.setFlowExecutor(makeFlowExecutor());
    const r = await tool.execute({ action: 'list-capabilities' }, ctx());
    expect(r.success).toBe(true);
    expect(r.capabilities.flows).toMatchObject({
      level: 'disabled',
      canList:   false,
      canCreate: false,
    });
  });
});
