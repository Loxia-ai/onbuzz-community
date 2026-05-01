/**
 * flowMigration — legacy v1 → v2 auto-wrap.
 *
 * Existing flows on disk have no typed I/O and edges with no field mapping.
 * Rather than force a hard migration, the executor wraps legacy flows on
 * load: each node gets a single implicit `context: text` input and a
 * single implicit `result: text` output; each edge gets the obvious
 * field mapping. That keeps day-1 v2 reads of v1 data identical to v1
 * behavior, and lets users opt into typing on a flow-by-flow basis.
 *
 * Invariants tested:
 *   - already-v2 flows pass through unchanged (idempotent)
 *   - v1 flow gets defaulted inputs/outputs/edge mappings
 *   - edge mapping picks defensible defaults that match v1 semantics
 *   - `isV2Flow` detects v2 by structural signal (typed inputs/outputs)
 */

import { describe, test, expect } from '@jest/globals';
import { isV2Flow, migrateLegacyFlow } from '../flowMigration.js';

const v1Flow = () => ({
  id: 'flow-1', name: 'Legacy',
  nodes: [
    { id: 'in',  type: 'input',  data: { promptTemplate: '{{userInput}}' } },
    { id: 'ag',  type: 'agent',  data: { agentId: 'writer' } },
    { id: 'out', type: 'output', data: { outputFormat: 'text' } },
  ],
  edges: [
    { source: 'in', target: 'ag' },
    { source: 'ag', target: 'out' },
  ],
});

const v2Flow = () => ({
  id: 'flow-2', name: 'Already v2', schemaVersion: 2,
  nodes: [
    { id: 'in', type: 'input', data: {},
      inputs: [], outputs: [{ name: 'result', type: 'text' }] },
    { id: 'ag', type: 'agent', data: { agentId: 'writer' },
      inputs: [{ name: 'context', type: 'text', required: true }],
      outputs: [{ name: 'result', type: 'text' }] },
  ],
  edges: [
    { source: 'in', sourceField: 'result', target: 'ag', targetField: 'context' },
  ],
});

describe('isV2Flow detection', () => {
  test('v1 flow → false', () => {
    expect(isV2Flow(v1Flow())).toBe(false);
  });

  test('v2 flow with schemaVersion → true', () => {
    expect(isV2Flow(v2Flow())).toBe(true);
  });

  test('v1 flow with at least one typed node → true (treat as v2)', () => {
    const f = v1Flow();
    f.nodes[1].outputs = [{ name: 'result', type: 'text' }];
    expect(isV2Flow(f)).toBe(true);
  });

  test('null/undefined → false (defensive)', () => {
    expect(isV2Flow(null)).toBe(false);
    expect(isV2Flow(undefined)).toBe(false);
    expect(isV2Flow({})).toBe(false);
  });
});

describe('migrateLegacyFlow — already-v2 passthrough', () => {
  test('returns the same object reference (no-op)', () => {
    const f = v2Flow();
    const out = migrateLegacyFlow(f);
    expect(out).toBe(f);
  });
});

describe('migrateLegacyFlow — v1 → v2', () => {
  test('every node gets default inputs/outputs', () => {
    const out = migrateLegacyFlow(v1Flow());
    for (const node of out.nodes) {
      expect(Array.isArray(node.inputs)).toBe(true);
      expect(Array.isArray(node.outputs)).toBe(true);
    }
  });

  test('input node has no inputs and one text output named "result"', () => {
    const out = migrateLegacyFlow(v1Flow());
    const inNode = out.nodes.find(n => n.id === 'in');
    expect(inNode.inputs).toEqual([]);
    expect(inNode.outputs).toEqual([{ name: 'result', type: 'text' }]);
  });

  test('agent node has one text "context" input and one text "result" output', () => {
    const out = migrateLegacyFlow(v1Flow());
    const ag = out.nodes.find(n => n.id === 'ag');
    expect(ag.inputs).toEqual([{ name: 'context', type: 'text', required: true }]);
    expect(ag.outputs).toEqual([{ name: 'result', type: 'text' }]);
  });

  test('output node has one text "context" input and no outputs', () => {
    const out = migrateLegacyFlow(v1Flow());
    const o = out.nodes.find(n => n.id === 'out');
    expect(o.inputs).toEqual([{ name: 'context', type: 'text', required: true }]);
    expect(o.outputs).toEqual([]);
  });

  test('every edge gets sourceField="result" and targetField="context"', () => {
    const out = migrateLegacyFlow(v1Flow());
    for (const edge of out.edges) {
      expect(edge.sourceField).toBe('result');
      expect(edge.targetField).toBe('context');
    }
  });

  test('migrated flow is marked schemaVersion: 2', () => {
    const out = migrateLegacyFlow(v1Flow());
    expect(out.schemaVersion).toBe(2);
  });

  test('migration does not mutate the input flow', () => {
    const f = v1Flow();
    const snapshot = JSON.parse(JSON.stringify(f));
    migrateLegacyFlow(f);
    expect(f).toEqual(snapshot);
  });

  test('preserves existing data (label, agentId, promptTemplate, etc.)', () => {
    const out = migrateLegacyFlow(v1Flow());
    expect(out.nodes.find(n => n.id === 'ag').data.agentId).toBe('writer');
    expect(out.nodes.find(n => n.id === 'in').data.promptTemplate).toBe('{{userInput}}');
  });

  test('handles flow with no edges (single node) without throwing', () => {
    const f = { id: 'solo', name: 'Solo', nodes: [{ id: 'a', type: 'input', data: {} }], edges: [] };
    const out = migrateLegacyFlow(f);
    expect(out.schemaVersion).toBe(2);
    expect(out.nodes[0].inputs).toEqual([]);
    expect(out.nodes[0].outputs).toEqual([{ name: 'result', type: 'text' }]);
    expect(out.edges).toEqual([]);
  });

  test('idempotent: migrating an already-migrated flow is a no-op', () => {
    const once  = migrateLegacyFlow(v1Flow());
    const twice = migrateLegacyFlow(once);
    expect(twice).toBe(once);
  });
});

describe('migrateLegacyFlow — defensive', () => {
  test('null/undefined returns input as-is (caller decides)', () => {
    expect(migrateLegacyFlow(null)).toBe(null);
    expect(migrateLegacyFlow(undefined)).toBe(undefined);
  });

  test('flow without nodes array returns input unchanged', () => {
    const broken = { name: 'broken' };
    expect(migrateLegacyFlow(broken)).toBe(broken);
  });
});
