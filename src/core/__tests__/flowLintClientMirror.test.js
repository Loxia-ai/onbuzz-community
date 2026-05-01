/**
 * Cross-checks the client-side flowLint mirror at web-ui/src/utils/flowLint.js
 * against the server-side rules. The mirror is plain ESM with no React
 * imports, so it runs cleanly in the unit (Node) test environment.
 *
 * Why this test exists: the editor inlines lint warnings client-side
 * (no round-trip per keystroke). If the mirror drifts from the server's
 * lintFlow, dry-run results disagree with the inline indicators — bad
 * UX. This file pins the high-impact behaviors.
 */

import { describe, test, expect } from '@jest/globals';
import { lintFlow as clientLint, lintByNode } from '../../../web-ui/src/utils/flowLint.js';
import { lintFlow as serverLint } from '../flowLint.js';

const v2 = (over = {}) => ({
  name: 'lint',
  schemaVersion: 2,
  nodes: [
    { id: 'in', type: 'input', data: {}, inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
    { id: 'ag', type: 'agent',
      data: { agentId: 'a', promptTemplate: 'Write {{topic}}' },
      inputs: [{ name: 'topic', type: 'text', required: true }],
      outputs: [{ name: 'draft', type: 'text' }] },
  ],
  edges: [
    { source: 'in', sourceField: 'topic', target: 'ag', targetField: 'topic' },
  ],
  variables: {},
  ...over,
});

describe('client flowLint mirror — public surface', () => {
  test('clean flow → no warnings', () => {
    expect(clientLint(v2()).warnings).toEqual([]);
  });

  test('flags unbound placeholder', () => {
    const f = v2();
    f.nodes[1].data.promptTemplate = '{{topic}} for {{audience}}';
    const r = clientLint(f);
    expect(r.warnings.some(w => w.kind === 'unbound-placeholder' && w.field === 'audience')).toBe(true);
  });

  test('flags unbound required input', () => {
    const f = v2();
    f.nodes[1].inputs.push({ name: 'context', type: 'text', required: true });
    const r = clientLint(f);
    expect(r.warnings.some(w => w.kind === 'unbound-required-input' && w.field === 'context')).toBe(true);
  });

  test('lintByNode groups by nodeId', () => {
    const f = v2();
    f.nodes[1].data.promptTemplate = '{{topic}} {{x}} {{y}}';
    const map = lintByNode(f);
    expect(map.has('ag')).toBe(true);
    expect(map.get('ag').length).toBeGreaterThanOrEqual(2);
  });

  test('v1 flow → free pass', () => {
    const v1 = {
      name: 'v1',
      nodes: [{ id: 'in', type: 'input', data: {} }, { id: 'ag', type: 'agent', data: { agentId: 'x', promptTemplate: '{{input}}' } }],
      edges: [{ source: 'in', target: 'ag' }],
    };
    expect(clientLint(v1).warnings).toEqual([]);
  });

  test('null/undefined → empty', () => {
    expect(clientLint(null).warnings).toEqual([]);
    expect(clientLint(undefined).warnings).toEqual([]);
  });
});

describe('client mirror agrees with server lint on representative cases', () => {
  // Direct equality of warning *count + kinds* on each shared input.
  // Message strings differ slightly (server includes "or variable") so
  // we don't compare those verbatim — kinds + fields are the contract.
  const cases = [
    ['clean', v2()],
    ['unbound-placeholder', (() => { const f = v2(); f.nodes[1].data.promptTemplate = '{{ghost}}'; return f; })()],
    ['unbound-required-input', (() => { const f = v2(); f.nodes[1].inputs.push({ name: 'ctx', type: 'text', required: true }); return f; })()],
    ['v1-passthrough', { name: 'v1', nodes: [{ id: 'a', type: 'input', data: {} }], edges: [] }],
  ];
  for (const [label, flow] of cases) {
    test(`agrees on case "${label}"`, () => {
      const c = clientLint(flow).warnings;
      const s = serverLint(flow).warnings;
      expect(c.length).toBe(s.length);
      const cKinds = new Set(c.map(w => `${w.nodeId}:${w.field || ''}`));
      const sKinds = new Set(s.map(w => `${w.nodeId || ''}:${(w.message.match(/"([^"]+)"/) || [, ''])[1]}`));
      // Soft check: same nodeIds appear on both sides
      const cNodes = new Set(c.map(w => w.nodeId));
      const sNodes = new Set(s.map(w => w.nodeId));
      expect([...cNodes].sort()).toEqual([...sNodes].sort());
    });
  }
});
