/**
 * flowLint — beyond schema validation, lints semantic / UX-level issues
 * the schema can't catch:
 *   - unbound {{placeholder}} in promptTemplate (no matching input/var)
 *   - declared input with required:true that has NO inbound edge
 *   - declared output that no downstream node consumes (reachability — info)
 *   - dead-end agent node whose output no node reads (info)
 *
 * The schema is the GATE (errors block save/execute). Lint is the
 * EDITOR HELPER (warnings surface in tooltips, dry-run report).
 *
 * Surface:
 *   lintFlow(flow) → { errors: [...], warnings: [...], info: [...] }
 */

import { describe, test, expect } from '@jest/globals';
import { lintFlow } from '../flowLint.js';

const v2Flow = (overrides = {}) => ({
  name: 'lint',
  schemaVersion: 2,
  nodes: [
    { id: 'in',  type: 'input', data: {},
      inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
    { id: 'ag', type: 'agent',
      data: { agentId: 'writer', promptTemplate: 'Write about {{topic}}' },
      inputs: [{ name: 'topic', type: 'text', required: true }],
      outputs: [{ name: 'draft', type: 'text' }] },
    { id: 'out', type: 'output', data: {},
      inputs: [{ name: 'context', type: 'text', required: true }],
      outputs: [] },
  ],
  edges: [
    { source: 'in', sourceField: 'topic', target: 'ag', targetField: 'topic' },
    { source: 'ag', sourceField: 'draft', target: 'out', targetField: 'context' },
  ],
  variables: {},
  ...overrides,
});

describe('lintFlow — happy path', () => {
  test('clean flow has no errors / warnings / info', () => {
    const r = lintFlow(v2Flow());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe('lintFlow — unbound placeholders', () => {
  test('flags {{x}} that is not a declared input or variable', () => {
    const f = v2Flow();
    f.nodes[1].data.promptTemplate = 'Write about {{topic}} for {{audience}}';
    // audience is not a declared input → should flag
    const r = lintFlow(f);
    expect(r.warnings.some(w => /audience/.test(w.message))).toBe(true);
    expect(r.warnings.find(w => /audience/.test(w.message)).nodeId).toBe('ag');
  });

  test('does NOT flag {{x}} when x is a declared input', () => {
    const f = v2Flow();
    f.nodes[1].data.promptTemplate = '{{topic}}';
    expect(lintFlow(f).warnings).toEqual([]);
  });

  test('does NOT flag {{x}} when x is a flow variable', () => {
    const f = v2Flow();
    f.nodes[1].data.promptTemplate = 'Write {{topic}} in {{tone}}';
    f.variables = { tone: 'formal' };
    expect(lintFlow(f).warnings).toEqual([]);
  });

  test('legacy {{input}} and {{previousOutput}} are always considered bound', () => {
    const f = v2Flow();
    f.nodes[1].data.promptTemplate = '{{input}} → {{previousOutput}}';
    expect(lintFlow(f).warnings).toEqual([]);
  });
});

describe('lintFlow — required input with no inbound edge', () => {
  test('warns when a v2 required input has no edge feeding it', () => {
    const f = v2Flow();
    // Add a second required input with no edge
    f.nodes[1].inputs.push({ name: 'context', type: 'text', required: true });
    const r = lintFlow(f);
    expect(r.warnings.some(w => /context/.test(w.message) && /no inbound/i.test(w.message))).toBe(true);
  });

  test('does NOT warn when the missing input is optional', () => {
    const f = v2Flow();
    f.nodes[1].inputs.push({ name: 'extras', type: 'json', required: false });
    expect(lintFlow(f).warnings).toEqual([]);
  });
});

describe('lintFlow — defensive', () => {
  test('null/undefined → empty results, no throws', () => {
    expect(lintFlow(null)).toEqual({ errors: [], warnings: [] });
    expect(lintFlow(undefined)).toEqual({ errors: [], warnings: [] });
  });

  test('v1 flow without inputs/outputs is silently skipped', () => {
    const v1 = {
      name: 'v1',
      nodes: [
        { id: 'in', type: 'input', data: {} },
        { id: 'ag', type: 'agent', data: { agentId: 'a', promptTemplate: '{{input}}' } },
      ],
      edges: [{ source: 'in', target: 'ag' }],
    };
    // Lint focuses on v2 features; legacy gets a free pass.
    expect(lintFlow(v1).warnings).toEqual([]);
  });

  test('handles node without promptTemplate gracefully', () => {
    const f = v2Flow();
    delete f.nodes[1].data.promptTemplate;
    expect(() => lintFlow(f)).not.toThrow();
  });
});
