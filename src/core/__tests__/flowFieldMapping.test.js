/**
 * flowFieldMapping — assembles typed inputs for a v2 node from upstream
 * outputs, following the edge field mappings.
 *
 * For each declared input on the target node:
 *   - Find an inbound edge mapping its targetField to that input name
 *   - Look up the source node's output for that sourceField
 *   - Apply the compatibility coercion (e.g. number → text stringifies,
 *     file → file[] wraps in an array, json → text JSON.stringify's)
 *   - Return the assembled { inputName: value } object
 *
 * Required inputs that have no inbound edge or no upstream output yet
 * are reported in `missing[]` so the executor can fail fast (or, in
 * Phase 2, ask the agent to re-emit).
 *
 * v1 fallback: when the node has no declared inputs (legacy flow), the
 * helper returns the legacy `{ input, previousOutput }` shape built by
 * concatenating upstream outputs. This keeps the executor's behavior
 * identical for un-migrated flows.
 */

import { describe, test, expect } from '@jest/globals';
import { assembleNodeInputs } from '../flowFieldMapping.js';

const wOut = (output, extra = {}) => ({ type: 'agent', output, ...extra });
const v2Node = (id, inputs) => ({ id, type: 'agent', data: { agentId: 'x' }, inputs });

describe('assembleNodeInputs — v2 typed flow', () => {
  test('maps single edge → declared input by name', () => {
    const node  = v2Node('w', [{ name: 'topic', type: 'text', required: true }]);
    const edges = [{ source: 'in', sourceField: 'topic', target: 'w', targetField: 'topic' }];
    const outputs = { in: { type: 'input', outputs: { topic: 'AI safety' } } };
    const r = assembleNodeInputs(node, edges, outputs);
    expect(r.values).toEqual({ topic: 'AI safety' });
    expect(r.missing).toEqual([]);
  });

  test('maps multiple edges → multiple declared inputs', () => {
    const node = v2Node('w', [
      { name: 'topic',    type: 'text',   required: true },
      { name: 'research', type: 'json',   required: true },
    ]);
    const edges = [
      { source: 'in', sourceField: 'topic',    target: 'w', targetField: 'topic' },
      { source: 'r',  sourceField: 'findings', target: 'w', targetField: 'research' },
    ];
    const outputs = {
      in: { type: 'input', outputs: { topic: 'AI safety' } },
      r:  { type: 'agent', outputs: { findings: { topPapers: [] } } },
    };
    const r = assembleNodeInputs(node, edges, outputs);
    expect(r.values.topic).toBe('AI safety');
    expect(r.values.research).toEqual({ topPapers: [] });
    expect(r.missing).toEqual([]);
  });

  test('flags required input with no inbound edge as missing', () => {
    const node = v2Node('w', [
      { name: 'topic',    type: 'text', required: true },
      { name: 'research', type: 'json', required: true },
    ]);
    const edges = [
      { source: 'in', sourceField: 'topic', target: 'w', targetField: 'topic' },
    ];
    const outputs = { in: { outputs: { topic: 'x' } } };
    const r = assembleNodeInputs(node, edges, outputs);
    expect(r.missing).toContain('research');
  });

  test('does not flag optional input as missing', () => {
    const node = v2Node('w', [
      { name: 'topic',    type: 'text', required: true },
      { name: 'extras',   type: 'json', required: false },
    ]);
    const edges = [
      { source: 'in', sourceField: 'topic', target: 'w', targetField: 'topic' },
    ];
    const outputs = { in: { outputs: { topic: 'x' } } };
    const r = assembleNodeInputs(node, edges, outputs);
    expect(r.missing).toEqual([]);
    // optional missing input → undefined value (not present in result)
    expect(r.values.extras).toBeUndefined();
  });

  test('flags edge whose source has not produced output yet', () => {
    const node = v2Node('w', [{ name: 'topic', type: 'text', required: true }]);
    const edges = [{ source: 'in', sourceField: 'topic', target: 'w', targetField: 'topic' }];
    const outputs = {};   // upstream not run yet
    const r = assembleNodeInputs(node, edges, outputs);
    expect(r.missing).toContain('topic');
  });
});

describe('assembleNodeInputs — type coercion', () => {
  test('number → text auto-stringifies', () => {
    const node = v2Node('w', [{ name: 'count', type: 'text', required: true }]);
    const edges = [{ source: 'src', sourceField: 'n', target: 'w', targetField: 'count' }];
    const outputs = { src: { outputs: { n: 42 } } };
    // Source field type known via _outputTypes lookup hint; if not, the
    // helper relies on input type alone. For coercion to text we just
    // call String() — keep it simple and predictable.
    const r = assembleNodeInputs(node, edges, outputs);
    expect(r.values.count).toBe('42');
  });

  test('json → text JSON.stringifies', () => {
    const node = v2Node('w', [{ name: 'blob', type: 'text', required: true }]);
    const edges = [{ source: 'src', sourceField: 'd', target: 'w', targetField: 'blob' }];
    const outputs = { src: { outputs: { d: { a: 1, b: [2, 3] } } } };
    const r = assembleNodeInputs(node, edges, outputs);
    expect(typeof r.values.blob).toBe('string');
    expect(JSON.parse(r.values.blob)).toEqual({ a: 1, b: [2, 3] });
  });

  test('file → file[] wraps singleton in array', () => {
    const node = v2Node('w', [{ name: 'attachments', type: 'file[]', required: true }]);
    const edges = [{ source: 'src', sourceField: 'doc', target: 'w', targetField: 'attachments' }];
    const outputs = { src: { outputs: { doc: '/tmp/a.pdf' } } };
    // Source type not declared, but target wants file[] and value is a
    // single string — we treat scalar→array as the singleton coercion.
    const r = assembleNodeInputs(node, edges, outputs);
    expect(r.values.attachments).toEqual(['/tmp/a.pdf']);
  });

  test('text → list<text> wraps as 1-element list', () => {
    const node = v2Node('w', [{ name: 'lines', type: 'list<text>', required: true }]);
    const edges = [{ source: 'src', sourceField: 's', target: 'w', targetField: 'lines' }];
    const outputs = { src: { outputs: { s: 'one line' } } };
    const r = assembleNodeInputs(node, edges, outputs);
    expect(r.values.lines).toEqual(['one line']);
  });

  test('exact match → value passed through unchanged', () => {
    const node = v2Node('w', [{ name: 'data', type: 'json', required: true }]);
    const edges = [{ source: 'src', sourceField: 'd', target: 'w', targetField: 'data' }];
    const obj = { complex: { nested: [1, 2, 3] } };
    const outputs = { src: { outputs: { d: obj } } };
    const r = assembleNodeInputs(node, edges, outputs);
    expect(r.values.data).toBe(obj);   // same reference
  });
});

describe('assembleNodeInputs — v1 legacy fallback', () => {
  test('node without inputs[] gets legacy { input, previousOutput }', () => {
    const node = { id: 'w', type: 'agent', data: { agentId: 'x' } };  // no inputs[]
    const edges = [{ source: 'a', target: 'w' }, { source: 'b', target: 'w' }];
    const outputs = {
      a: { type: 'agent', output: 'first part' },
      b: { type: 'agent', output: 'second part' },
    };
    const r = assembleNodeInputs(node, edges, outputs);
    // Legacy shape: input/previousOutput are concatenated upstream outputs.
    expect(r.legacy).toBe(true);
    expect(typeof r.values.input).toBe('string');
    expect(r.values.input).toContain('first part');
    expect(r.values.input).toContain('second part');
    expect(r.values.previousOutput).toBe(r.values.input);
  });

  test('node with empty inputs[] is treated as v2 (no legacy)', () => {
    const node = v2Node('w', []);
    const r = assembleNodeInputs(node, [], {});
    expect(r.legacy).toBeFalsy();
    expect(r.values).toEqual({});
    expect(r.missing).toEqual([]);
  });
});

describe('assembleNodeInputs — defensive', () => {
  test('null edges array → handled gracefully', () => {
    const node = v2Node('w', [{ name: 'topic', type: 'text', required: false }]);
    const r = assembleNodeInputs(node, null, {});
    expect(r.values).toEqual({});
  });

  test('null nodeOutputs → handled gracefully', () => {
    const node = v2Node('w', []);
    const r = assembleNodeInputs(node, [], null);
    expect(r.values).toEqual({});
  });

  test('edge target does not match node id → ignored', () => {
    const node = v2Node('w', [{ name: 'topic', type: 'text', required: true }]);
    const edges = [{ source: 'a', sourceField: 'topic', target: 'OTHER', targetField: 'topic' }];
    const outputs = { a: { outputs: { topic: 'x' } } };
    const r = assembleNodeInputs(node, edges, outputs);
    expect(r.missing).toContain('topic');
  });
});
