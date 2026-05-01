/**
 * Tests for the active-flow-run helpers used by the
 * /api/flows/runs/active endpoint (which powers the running-indicator
 * on the FlowsPage cards).
 */
import { describe, test, expect } from '@jest/globals';
import {
  ACTIVE_FLOW_RUN_STATUSES,
  isActiveFlowRun,
  projectActiveRuns,
  summarizeRunProgress,
} from '../flowRunFilters.js';

describe('ACTIVE_FLOW_RUN_STATUSES', () => {
  test('includes the four non-terminal statuses', () => {
    for (const s of ['queued', 'pending', 'running', 'paused']) {
      expect(ACTIVE_FLOW_RUN_STATUSES.has(s)).toBe(true);
    }
  });

  test('excludes terminal statuses', () => {
    for (const s of ['completed', 'failed', 'stopped', 'cancelled']) {
      expect(ACTIVE_FLOW_RUN_STATUSES.has(s)).toBe(false);
    }
  });

  test('is frozen so terminal additions in code review are flagged', () => {
    // The Set itself can't be frozen meaningfully, but the export should be.
    expect(Object.isFrozen(ACTIVE_FLOW_RUN_STATUSES)).toBe(true);
  });
});

describe('isActiveFlowRun', () => {
  test('true for non-terminal statuses', () => {
    expect(isActiveFlowRun({ status: 'running' })).toBe(true);
    expect(isActiveFlowRun({ status: 'paused' })).toBe(true);
    expect(isActiveFlowRun({ status: 'queued' })).toBe(true);
    expect(isActiveFlowRun({ status: 'pending' })).toBe(true);
  });

  test('false for terminal statuses', () => {
    expect(isActiveFlowRun({ status: 'completed' })).toBe(false);
    expect(isActiveFlowRun({ status: 'failed' })).toBe(false);
    expect(isActiveFlowRun({ status: 'stopped' })).toBe(false);
  });

  test('false for null / undefined / non-object / missing-status (defensive)', () => {
    expect(isActiveFlowRun(null)).toBe(false);
    expect(isActiveFlowRun(undefined)).toBe(false);
    expect(isActiveFlowRun('running')).toBe(false);     // not an object
    expect(isActiveFlowRun(42)).toBe(false);
    expect(isActiveFlowRun({})).toBe(false);             // no status
    expect(isActiveFlowRun({ status: null })).toBe(false);
    expect(isActiveFlowRun({ status: 'made-up' })).toBe(false);
  });
});

describe('projectActiveRuns', () => {
  test('returns empty array for null / undefined / non-object', () => {
    expect(projectActiveRuns(null)).toEqual([]);
    expect(projectActiveRuns(undefined)).toEqual([]);
    expect(projectActiveRuns('not an object')).toEqual([]);
    expect(projectActiveRuns([])).toEqual([]);  // arrays are objects but Object.entries is fine — explicit empty result
  });

  test('returns empty array when all runs are terminal', () => {
    const idx = {
      'r-1': { flowId: 'f-1', status: 'completed' },
      'r-2': { flowId: 'f-1', status: 'failed' },
      'r-3': { flowId: 'f-2', status: 'stopped' },
    };
    expect(projectActiveRuns(idx)).toEqual([]);
  });

  test('returns only the non-terminal runs, projected to compact shape (with progress)', () => {
    const idx = {
      'r-active-1': { flowId: 'f-1', status: 'running', startedAt: '2026-05-01T10:00:00Z', extra: 'ignored' },
      'r-done':     { flowId: 'f-1', status: 'completed' },
      'r-active-2': { flowId: 'f-2', status: 'queued', createdAt: '2026-05-01T10:05:00Z' },
      'r-failed':   { flowId: 'f-3', status: 'failed' },
      'r-paused':   { flowId: 'f-4', status: 'paused', startedAt: '2026-05-01T09:00:00Z' },
    };
    const result = projectActiveRuns(idx);
    result.sort((a, b) => a.runId.localeCompare(b.runId));
    // Verify the four core fields. `progress` is asserted in dedicated
    // tests below — here we just ensure it exists on each row so
    // downstream consumers don't have to null-check.
    expect(result.map(r => ({ runId: r.runId, flowId: r.flowId, status: r.status, startedAt: r.startedAt }))).toEqual([
      { runId: 'r-active-1', flowId: 'f-1', status: 'running', startedAt: '2026-05-01T10:00:00Z' },
      { runId: 'r-active-2', flowId: 'f-2', status: 'queued',  startedAt: '2026-05-01T10:05:00Z' },
      { runId: 'r-paused',   flowId: 'f-4', status: 'paused',  startedAt: '2026-05-01T09:00:00Z' },
    ]);
    expect(result.every(r => typeof r.progress === 'object' && r.progress !== null)).toBe(true);
  });

  test('falls back to createdAt when startedAt is absent', () => {
    const idx = {
      'r-1': { flowId: 'f-1', status: 'queued', createdAt: '2026-05-01T08:00:00Z' },
    };
    const [r] = projectActiveRuns(idx);
    expect(r.startedAt).toBe('2026-05-01T08:00:00Z');
  });

  test('uses null for missing flowId / startedAt — never undefined', () => {
    const idx = { 'r-1': { status: 'running' } };       // no flowId, no startedAt
    const [r] = projectActiveRuns(idx);
    expect(r.flowId).toBeNull();
    expect(r.startedAt).toBeNull();
  });

  test('handles a malformed run entry without throwing', () => {
    const idx = {
      'r-good': { flowId: 'f-1', status: 'running' },
      'r-bad':  null,                                    // null entry
      'r-also-bad': 'not an object',                     // wrong type
    };
    const r = projectActiveRuns(idx);
    expect(r).toHaveLength(1);
    expect(r[0].runId).toBe('r-good');
  });

  test('preserves the relationship between runId (key) and run (value)', () => {
    const idx = {
      'a-run-id': { flowId: 'flow-x', status: 'running' },
    };
    const [r] = projectActiveRuns(idx);
    expect(r.runId).toBe('a-run-id');
    expect(r.flowId).toBe('flow-x');
  });

  test('attaches a progress summary to every projected run (powers the FlowsPage step indicator)', () => {
    const idx = {
      'r-1': {
        flowId: 'f-1', status: 'running',
        nodeStates: {
          'in':     { status: 'completed' },
          'writer': { status: 'running' },
        },
      },
    };
    const [r] = projectActiveRuns(idx);
    expect(r.progress).toBeDefined();
    expect(r.progress.completed).toBe(1);
    expect(r.progress.running).toBe(1);
  });

  test('uses the flowLookup callback to enrich progress with total + label', () => {
    const idx = {
      'r-1': {
        flowId: 'flow-X', status: 'running',
        nodeStates: { 'writer': { status: 'running', startedAt: '2026-05-01T10:00:00Z' } },
      },
    };
    const flowLookup = (flowId) => flowId === 'flow-X'
      ? { nodes: [
          { id: 'in', type: 'input' },
          { id: 'writer', type: 'agent', data: { label: 'Article Writer' } },
          { id: 'out', type: 'output' },
        ] }
      : null;
    const [r] = projectActiveRuns(idx, flowLookup);
    expect(r.progress.total).toBe(3);
    expect(r.progress.currentNodeId).toBe('writer');
    expect(r.progress.currentNodeLabel).toBe('Article Writer');
  });

  test('flowLookup callback is optional — runs with unknown flow degrade gracefully (no total / label)', () => {
    const idx = {
      'r-1': {
        flowId: 'flow-mystery', status: 'running',
        nodeStates: { 'a': { status: 'running' } },
      },
    };
    // Lookup returns null → progress still computed, just no total/label.
    const [r] = projectActiveRuns(idx, () => null);
    expect(r.progress.total).toBeNull();
    expect(r.progress.currentNodeLabel).toBeNull();
    expect(r.progress.running).toBe(1);
  });
});

// ─── summarizeRunProgress ─────────────────────────────────────────────

describe('summarizeRunProgress', () => {
  test('counts node states by status from the run\'s nodeStates map', () => {
    const run = {
      nodeStates: {
        a: { status: 'completed' },
        b: { status: 'completed' },
        c: { status: 'running' },
        d: { status: 'failed' },
        e: { status: 'pending' },
      },
    };
    const p = summarizeRunProgress(run);
    expect(p.completed).toBe(2);
    expect(p.running).toBe(1);
    expect(p.failed).toBe(1);
    expect(p.pending).toBe(1);
  });

  test('returns null total + currentNodeLabel when no flow definition is provided', () => {
    const run = { nodeStates: { a: { status: 'running' } } };
    const p = summarizeRunProgress(run);
    expect(p.total).toBeNull();
    expect(p.percent).toBeNull();
    expect(p.currentNodeLabel).toBeNull();
  });

  test('with flow def: computes total + percent + label', () => {
    const run = {
      nodeStates: {
        in:     { status: 'completed' },
        a:      { status: 'completed' },
        writer: { status: 'running', startedAt: '2026-05-01T10:00:00Z' },
        out:    { status: 'pending' },
      },
    };
    const flowDef = {
      nodes: [
        { id: 'in', type: 'input' },
        { id: 'a', type: 'agent', data: { label: 'A-step' } },
        { id: 'writer', type: 'agent', data: { label: 'Writer' } },
        { id: 'out', type: 'output' },
      ],
    };
    const p = summarizeRunProgress(run, flowDef);
    expect(p.total).toBe(4);
    expect(p.completed).toBe(2);
    expect(p.percent).toBe(50);   // 2/4 = 50%
    expect(p.currentNodeId).toBe('writer');
    expect(p.currentNodeLabel).toBe('Writer');
  });

  test('falls back to node id when label is missing on the flow def', () => {
    const run = { nodeStates: { 'cool-id': { status: 'running' } } };
    const flowDef = {
      nodes: [{ id: 'cool-id', type: 'agent' /* no data.label */ }],
    };
    const p = summarizeRunProgress(run, flowDef);
    expect(p.currentNodeLabel).toBe('cool-id');
  });

  test('with multiple running nodes, picks the one with the latest startedAt as "current"', () => {
    const run = {
      nodeStates: {
        a: { status: 'running', startedAt: '2026-05-01T10:00:00Z' },
        b: { status: 'running', startedAt: '2026-05-01T10:05:00Z' },   // newest
        c: { status: 'running', startedAt: '2026-05-01T09:00:00Z' },
      },
    };
    const flowDef = {
      nodes: [
        { id: 'a', data: { label: 'Alpha' } },
        { id: 'b', data: { label: 'Beta' } },
        { id: 'c', data: { label: 'Gamma' } },
      ],
    };
    const p = summarizeRunProgress(run, flowDef);
    expect(p.currentNodeId).toBe('b');
    expect(p.currentNodeLabel).toBe('Beta');
    expect(p.running).toBe(3);
  });

  test('handles missing nodeStates / null run defensively', () => {
    expect(summarizeRunProgress(null)).toMatchObject({ completed: 0, running: 0, failed: 0, pending: 0 });
    expect(summarizeRunProgress(undefined)).toMatchObject({ completed: 0, running: 0 });
    expect(summarizeRunProgress({})).toMatchObject({ completed: 0, running: 0 });
    expect(summarizeRunProgress({ nodeStates: null })).toMatchObject({ completed: 0, running: 0 });
    expect(summarizeRunProgress({ nodeStates: 'not-an-object' })).toMatchObject({ completed: 0 });
  });

  test('skips malformed entries in nodeStates (defensive against persisted-state corruption)', () => {
    const run = {
      nodeStates: {
        good:    { status: 'running' },
        bad:     null,
        worse:   'string',
        missing: {},                           // no status
      },
    };
    const p = summarizeRunProgress(run);
    expect(p.running).toBe(1);
    expect(p.completed + p.failed + p.pending).toBe(0);
  });

  test('percent rounds to integer (no decimal noise on the small bar)', () => {
    const run = {
      nodeStates: {
        a: { status: 'completed' }, b: { status: 'completed' },
        c: { status: 'running' },
      },
    };
    // 2 completed / 3 total = 66.67% → 67
    const p = summarizeRunProgress(run, { nodes: [{id:'a'},{id:'b'},{id:'c'}] });
    expect(p.percent).toBe(67);
  });

  test('zero-node flow def: total=0, percent stays null (no divide-by-zero)', () => {
    const p = summarizeRunProgress(
      { nodeStates: {} },
      { nodes: [] }
    );
    expect(p.total).toBe(0);
    expect(p.percent).toBeNull();
  });

  test('flow def without a nodes array: treated as no flow def (total stays null)', () => {
    const p = summarizeRunProgress(
      { nodeStates: { a: { status: 'running' } } },
      { /* no nodes array */ }
    );
    expect(p.total).toBeNull();
  });
});
