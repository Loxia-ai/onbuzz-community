/**
 * Tests for flowSchema — pure-JS validator that gates flow definitions
 * before they reach the executor.
 *
 * The shape we're guarding (matches what FlowExecutor reads today):
 *   {
 *     id?: string, name: string, description?: string,
 *     nodes: [{ id: string, type: 'input'|'agent'|'output', data?: {...} }],
 *     edges: [{ source: string, target: string }],
 *     variables?: object
 *   }
 *
 * Each test names a distinct rejection class so failures point to the
 * exact rule that broke. The validator returns { ok, errors } — callers
 * can show errors[].message inline in the editor.
 */

import { describe, test, expect } from '@jest/globals';
import { validateFlowDefinition } from '../flowSchema.js';

const validFlow = () => ({
  id: 'flow-test',
  name: 'Test flow',
  nodes: [
    { id: 'in',  type: 'input',  data: {} },
    { id: 'ag',  type: 'agent',  data: { agentId: 'writer' } },
    { id: 'out', type: 'output', data: {} },
  ],
  edges: [
    { source: 'in', target: 'ag' },
    { source: 'ag', target: 'out' },
  ],
});

describe('validateFlowDefinition — happy path', () => {
  test('accepts a minimal linear flow', () => {
    const r = validateFlowDefinition(validFlow());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  test('accepts a diamond DAG', () => {
    const f = validFlow();
    f.nodes.push({ id: 'ag2', type: 'agent', data: { agentId: 'reviewer' } });
    f.edges = [
      { source: 'in',  target: 'ag' },
      { source: 'in',  target: 'ag2' },
      { source: 'ag',  target: 'out' },
      { source: 'ag2', target: 'out' },
    ];
    expect(validateFlowDefinition(f).ok).toBe(true);
  });

  test('accepts flow with no edges (single node)', () => {
    const f = { name: 'solo', nodes: [{ id: 'in', type: 'input', data: {} }], edges: [] };
    expect(validateFlowDefinition(f).ok).toBe(true);
  });
});

describe('validateFlowDefinition — structural rejections', () => {
  test('rejects null / non-object', () => {
    expect(validateFlowDefinition(null).ok).toBe(false);
    expect(validateFlowDefinition('hi').ok).toBe(false);
    expect(validateFlowDefinition(undefined).ok).toBe(false);
  });

  test('rejects missing name', () => {
    const f = validFlow(); delete f.name;
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /name/i.test(e.message))).toBe(true);
  });

  test('rejects missing nodes array', () => {
    const f = validFlow(); delete f.nodes;
    expect(validateFlowDefinition(f).ok).toBe(false);
  });

  test('rejects nodes that is not an array', () => {
    const f = validFlow(); f.nodes = { id: 'x' };
    expect(validateFlowDefinition(f).ok).toBe(false);
  });

  test('rejects edges that is not an array (when present)', () => {
    const f = validFlow(); f.edges = 'not-an-array';
    expect(validateFlowDefinition(f).ok).toBe(false);
  });
});

describe('validateFlowDefinition — node rejections', () => {
  test('rejects node without id', () => {
    const f = validFlow();
    f.nodes[0] = { type: 'input', data: {} };
    expect(validateFlowDefinition(f).ok).toBe(false);
  });

  test('rejects duplicate node ids', () => {
    const f = validFlow();
    f.nodes[1].id = 'in'; // collide with first
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /duplicate/i.test(e.message))).toBe(true);
  });

  test('rejects unknown node type', () => {
    const f = validFlow();
    f.nodes[0].type = 'magic';
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /type/i.test(e.message))).toBe(true);
  });

  test('ALLOWS agent node with no agentId at save time (drafts)', () => {
    // Phase 5 behavior: empty agentId is allowed at save so users can
    // load templates and pick agents later. Lint warns + executor
    // refuses to run such flows. The schema gate stays out of it.
    const f = validFlow();
    f.nodes[1].data = {}; // strip agentId
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(true);
  });

  test('ALLOWS agent node with empty-string agentId (drafts)', () => {
    const f = validFlow();
    f.nodes[1].data.agentId = '';
    expect(validateFlowDefinition(f).ok).toBe(true);
  });

  test('rejects agent node where agentId is a non-string (type error)', () => {
    const f = validFlow();
    f.nodes[1].data.agentId = 42;
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
  });
});

describe('validateFlowDefinition — edge rejections', () => {
  test('rejects edge with missing source', () => {
    const f = validFlow();
    f.edges[0] = { target: 'ag' };
    expect(validateFlowDefinition(f).ok).toBe(false);
  });

  test('rejects edge with missing target', () => {
    const f = validFlow();
    f.edges[0] = { source: 'in' };
    expect(validateFlowDefinition(f).ok).toBe(false);
  });

  test('rejects edge referencing unknown source', () => {
    const f = validFlow();
    f.edges.push({ source: 'ghost', target: 'out' });
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /ghost/.test(e.message))).toBe(true);
  });

  test('rejects edge referencing unknown target', () => {
    const f = validFlow();
    f.edges.push({ source: 'in', target: 'ghost' });
    expect(validateFlowDefinition(f).ok).toBe(false);
  });

  test('rejects self-loop edge', () => {
    const f = validFlow();
    f.edges.push({ source: 'ag', target: 'ag' });
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /self|loop|cycle/i.test(e.message))).toBe(true);
  });
});

describe('validateFlowDefinition — cycle detection', () => {
  test('rejects 2-node cycle', () => {
    const f = {
      name: 'cycle',
      nodes: [
        { id: 'a', type: 'agent', data: { agentId: 'x' } },
        { id: 'b', type: 'agent', data: { agentId: 'y' } },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    };
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /cycle/i.test(e.message))).toBe(true);
  });

  test('rejects 3-node ring', () => {
    const f = {
      name: 'ring',
      nodes: [
        { id: 'a', type: 'agent', data: { agentId: 'x' } },
        { id: 'b', type: 'agent', data: { agentId: 'y' } },
        { id: 'c', type: 'agent', data: { agentId: 'z' } },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'a' },
      ],
    };
    expect(validateFlowDefinition(f).ok).toBe(false);
  });

  test('accepts 3-node DAG (no cycle)', () => {
    const f = {
      name: 'dag',
      nodes: [
        { id: 'a', type: 'input', data: {} },
        { id: 'b', type: 'agent', data: { agentId: 'y' } },
        { id: 'c', type: 'output', data: {} },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
    };
    expect(validateFlowDefinition(f).ok).toBe(true);
  });
});

describe('validateFlowDefinition — agent resolution (optional)', () => {
  test('with agentResolver: accepts when agentId resolves', () => {
    const r = validateFlowDefinition(validFlow(), {
      agentResolver: (id) => id === 'writer',
    });
    expect(r.ok).toBe(true);
  });

  test('with agentResolver: rejects when agentId does not resolve', () => {
    const r = validateFlowDefinition(validFlow(), {
      agentResolver: () => false,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /writer|not found|unknown/i.test(e.message))).toBe(true);
  });

  test('without agentResolver: agentId presence still checked, existence skipped', () => {
    // No resolver provided → don't try to verify existence
    const r = validateFlowDefinition(validFlow());
    expect(r.ok).toBe(true);
  });
});

/**
 * Phase 1: typed I/O + named edge field mapping.
 *
 * v2 flows declare `inputs[]`, `outputs[]` per node and
 * `sourceField` / `targetField` per edge. The validator must:
 *   - shape-check the inputs/outputs arrays
 *   - reject invalid types
 *   - reject duplicate field names within the same node
 *   - reject edges whose sourceField is not a real output of the source
 *     node (or targetField not a real input of the target)
 *   - reject edges where source and target field types are incompatible
 *
 * v1 flows (no typed I/O) continue to validate as before — typing is
 * opt-in per flow.
 */
describe('validateFlowDefinition — typed I/O (Phase 1, v2)', () => {
  const v2Flow = () => ({
    name: 'typed', schemaVersion: 2,
    nodes: [
      { id: 'in', type: 'input', data: {},
        inputs: [],
        outputs: [{ name: 'topic', type: 'text' }] },
      { id: 'ag', type: 'agent', data: { agentId: 'writer' },
        inputs:  [{ name: 'topic', type: 'text', required: true }],
        outputs: [{ name: 'draft', type: 'text' }] },
    ],
    edges: [
      { source: 'in', sourceField: 'topic', target: 'ag', targetField: 'topic' },
    ],
  });

  test('accepts a well-typed v2 flow', () => {
    const r = validateFlowDefinition(v2Flow());
    expect(r.ok).toBe(true);
  });

  test('rejects unknown input type', () => {
    const f = v2Flow();
    f.nodes[1].inputs[0].type = 'string';
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /type/i.test(e.message))).toBe(true);
  });

  test('rejects unknown output type', () => {
    const f = v2Flow();
    f.nodes[1].outputs[0].type = 'blob';
    expect(validateFlowDefinition(f).ok).toBe(false);
  });

  test('rejects input with missing name', () => {
    const f = v2Flow();
    f.nodes[1].inputs[0] = { type: 'text', required: true };
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /name/i.test(e.message))).toBe(true);
  });

  test('rejects duplicate input field names within the same node', () => {
    const f = v2Flow();
    f.nodes[1].inputs = [
      { name: 'topic', type: 'text', required: true },
      { name: 'topic', type: 'json', required: false },
    ];
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /duplicate/i.test(e.message))).toBe(true);
  });

  test('rejects duplicate output field names within the same node', () => {
    const f = v2Flow();
    f.nodes[0].outputs = [
      { name: 'topic', type: 'text' },
      { name: 'topic', type: 'json' },
    ];
    expect(validateFlowDefinition(f).ok).toBe(false);
  });

  test('rejects edge sourceField not declared on source node', () => {
    const f = v2Flow();
    f.edges[0].sourceField = 'ghost';
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /sourceField|ghost/i.test(e.message))).toBe(true);
  });

  test('rejects edge targetField not declared on target node', () => {
    const f = v2Flow();
    f.edges[0].targetField = 'ghost';
    expect(validateFlowDefinition(f).ok).toBe(false);
  });

  test('rejects edge connecting incompatible types (file → text)', () => {
    const f = v2Flow();
    f.nodes[0].outputs = [{ name: 'topic', type: 'file' }];
    // input remains text → file → text is incompatible
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /incompatible|cast/i.test(e.message))).toBe(true);
  });

  test('accepts compatible widening (number → text)', () => {
    const f = v2Flow();
    f.nodes[0].outputs = [{ name: 'topic', type: 'number' }];
    // target input is text → number → text widens cleanly
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(true);
  });

  test('v2 edges without sourceField/targetField are rejected', () => {
    const f = v2Flow();
    f.edges[0] = { source: 'in', target: 'ag' };  // missing fields
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /sourceField|targetField/i.test(e.message))).toBe(true);
  });

  // Phase 7: rich-contract fields (description, example, instructions)
  // are accepted silently. Locks the contract so future schema
  // tightening doesn't accidentally reject them.
  test('rich contract fields (description / example / instructions) pass validation', () => {
    const f = {
      name: 'rich',
      description: 'Overall flow goal — produce a fact-checked article.',
      schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', data: {},
          inputs: [],
          outputs: [{ name: 'topic', type: 'text', description: 'Topic.', example: 'AI' }] },
        { id: 'ag', type: 'agent',
          data: { agentId: 'a', instructions: 'Research; done when ≥3 citations.' },
          inputs:  [{ name: 'topic', type: 'text', required: true, description: 'Topic to research.' }],
          outputs: [{ name: 'findings', type: 'json',
            description: 'Structured research bag.',
            example: { title: 'AI', citations: ['x'] } }] },
      ],
      edges: [{ source: 'in', sourceField: 'topic', target: 'ag', targetField: 'topic' }],
    };
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  test('v1 flow (no typed I/O on any node) does NOT require edge fields', () => {
    // Backwards compat — old flows still validate
    const v1 = {
      name: 'v1',
      nodes: [
        { id: 'in', type: 'input', data: {} },
        { id: 'ag', type: 'agent', data: { agentId: 'writer' } },
      ],
      edges: [{ source: 'in', target: 'ag' }],
    };
    expect(validateFlowDefinition(v1).ok).toBe(true);
  });

  test('rejects inputs/outputs that is not an array', () => {
    const f = v2Flow();
    f.nodes[0].outputs = 'not-an-array';
    expect(validateFlowDefinition(f).ok).toBe(false);
  });
});

describe('validateFlowDefinition — error shape', () => {
  test('errors have { path, message } shape', () => {
    const r = validateFlowDefinition({ name: 'x', nodes: [{ id: 'a', type: 'bad' }], edges: [] });
    expect(r.ok).toBe(false);
    expect(Array.isArray(r.errors)).toBe(true);
    expect(r.errors.length).toBeGreaterThan(0);
    for (const e of r.errors) {
      expect(typeof e.message).toBe('string');
      expect(e.message.length).toBeGreaterThan(0);
      // path is optional but should be a string when present
      if (e.path !== undefined) expect(typeof e.path).toBe('string');
    }
  });

  test('multiple problems → multiple errors (not just the first)', () => {
    const f = {
      name: 'broken',
      nodes: [
        { id: 'a', type: 'agent', data: { agentId: 42 } },  // bad agentId type
        { id: 'a', type: 'unknown' },                        // duplicate id + bad type
      ],
      edges: [{ source: 'ghost', target: 'a' }],             // unknown source
    };
    const r = validateFlowDefinition(f);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});
