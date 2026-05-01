/**
 * Verifies every starter flow template:
 *   - passes the v2 schema validator (so users can save it as-is)
 *   - passes lint with zero warnings (no unbound placeholders, no
 *     missing required edges)
 *   - has a unique key + a non-empty label and description
 *
 * If a template ever ships broken, this test fails loud.
 */

import { describe, test, expect } from '@jest/globals';
import { STARTER_TEMPLATES, getTemplateByKey } from '../../../web-ui/src/utils/flowTemplates.js';
import { validateFlowDefinition } from '../flowSchema.js';
import { lintFlow } from '../flowLint.js';

describe('STARTER_TEMPLATES — registry shape', () => {
  test('exposes at least 3 templates', () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  test('every template has key, label, description, flow', () => {
    for (const t of STARTER_TEMPLATES) {
      expect(typeof t.key).toBe('string');
      expect(t.key.length).toBeGreaterThan(0);
      expect(typeof t.label).toBe('string');
      expect(t.label.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.flow).toBeDefined();
    }
  });

  test('keys are unique', () => {
    const keys = STARTER_TEMPLATES.map(t => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('getTemplateByKey returns the right one + null for unknown', () => {
    const first = STARTER_TEMPLATES[0];
    expect(getTemplateByKey(first.key)).toBe(first);
    expect(getTemplateByKey('nonexistent-key-xyz')).toBe(null);
  });
});

describe('STARTER_TEMPLATES — every template validates clean', () => {
  for (const t of STARTER_TEMPLATES) {
    test(`"${t.key}" passes schema validator`, () => {
      const r = validateFlowDefinition(t.flow);
      if (!r.ok) {
        // Print errors for easier debugging
        // eslint-disable-next-line no-console
        console.error(`Template ${t.key} schema errors:`, r.errors);
      }
      expect(r.ok).toBe(true);
    });

    test(`"${t.key}" lint warnings are ONLY 'unbound-agent' (user picks agents after loading)`, () => {
      // Templates ship with empty agentIds so users pick their own
      // agents. Every other lint rule (unbound placeholder, unbound
      // required input) must still pass — otherwise the template is
      // genuinely broken.
      const r = lintFlow(t.flow);
      const otherWarnings = r.warnings.filter(w => w.kind !== 'unbound-agent');
      if (otherWarnings.length > 0) {
        // eslint-disable-next-line no-console
        console.error(`Template ${t.key} non-agent lint warnings:`, otherWarnings);
      }
      expect(otherWarnings).toEqual([]);
    });

    test(`"${t.key}" is marked as v2 (schemaVersion: 2)`, () => {
      expect(t.flow.schemaVersion).toBe(2);
    });

    // Phase 7: every template ships with rich contracts so users
    // see the value immediately without filling in fields.

    test(`"${t.key}" has a non-empty flow.description (FLOW GOAL)`, () => {
      expect(typeof t.flow.description).toBe('string');
      expect(t.flow.description.trim().length).toBeGreaterThan(20);
    });

    test(`"${t.key}" — every agent node has non-empty data.instructions`, () => {
      const agentNodes = t.flow.nodes.filter(n => n.type === 'agent');
      expect(agentNodes.length).toBeGreaterThan(0);
      for (const n of agentNodes) {
        expect(typeof n.data?.instructions).toBe('string');
        expect(n.data.instructions.trim().length).toBeGreaterThan(20);
      }
    });

    test(`"${t.key}" — every declared input/output has a non-empty description`, () => {
      for (const node of t.flow.nodes) {
        for (const kind of ['inputs', 'outputs']) {
          const arr = node[kind];
          if (!Array.isArray(arr)) continue;
          for (const field of arr) {
            expect(typeof field.description).toBe('string');
            expect(field.description.trim().length).toBeGreaterThan(0);
          }
        }
      }
    });

    test(`"${t.key}" — agent node outputs include an example for json/list types (where most useful)`, () => {
      // Examples are most valuable for opaque types where the model
      // would otherwise guess shape. Strict for json + list types.
      for (const node of t.flow.nodes.filter(n => n.type === 'agent')) {
        for (const out of (node.outputs || [])) {
          if (out.type === 'json' || out.type === 'list<text>' || out.type === 'file[]') {
            expect(out.example).toBeDefined();
          }
        }
      }
    });

    // ---- Phase 7 audit: producer ↔ consumer description alignment ----
    //
    // For each edge, BOTH the source output and target input must have
    // a meaningful description (≥40 chars). Catches the "consumer is
    // too terse" failure mode where the producer says "shape is
    // {a,b,c}" and the consumer just says "from upstream" — leaving
    // the consuming agent without enough context to use the data well.
    test(`"${t.key}" — every edge has descriptions on BOTH ends (≥40 chars each)`, () => {
      const findField = (nodeId, kind, fieldName) => {
        const node = t.flow.nodes.find(n => n.id === nodeId);
        return (node?.[kind] || []).find(f => f.name === fieldName);
      };

      for (const edge of (t.flow.edges || [])) {
        if (!edge.sourceField || !edge.targetField) continue; // v1 edges
        const src = findField(edge.source, 'outputs', edge.sourceField);
        const dst = findField(edge.target, 'inputs',  edge.targetField);
        expect(src).toBeDefined();
        expect(dst).toBeDefined();
        const where = `${edge.source}.${edge.sourceField} → ${edge.target}.${edge.targetField}`;
        // Producer description present and substantial
        if (!(src.description && src.description.length >= 40)) {
          // eslint-disable-next-line no-console
          console.error(`Edge "${where}" — producer description too thin: ${JSON.stringify(src.description)}`);
        }
        expect(typeof src.description).toBe('string');
        expect(src.description.length).toBeGreaterThanOrEqual(40);
        // Consumer description present and substantial
        if (!(dst.description && dst.description.length >= 40)) {
          // eslint-disable-next-line no-console
          console.error(`Edge "${where}" — consumer description too thin: ${JSON.stringify(dst.description)}`);
        }
        expect(typeof dst.description).toBe('string');
        expect(dst.description.length).toBeGreaterThanOrEqual(40);
      }
    });

    // Phase 7 audit: catch the linear-research class of bug — output
    // node receives a one-token field as the user-facing context.
    // If the output node's input is wired to a `text` field whose
    // example is shorter than ~10 chars, that's almost certainly the
    // wrong wire (e.g. wiring "verdict: 'approved'" instead of the
    // full article).
    test(`"${t.key}" — output node receives a substantive context payload`, () => {
      const outputNode = t.flow.nodes.find(n => n.type === 'output');
      if (!outputNode) return;
      const inboundEdges = (t.flow.edges || []).filter(e => e.target === outputNode.id);
      for (const edge of inboundEdges) {
        if (!edge.sourceField) continue;
        const sourceNode = t.flow.nodes.find(n => n.id === edge.source);
        const sourceOutput = (sourceNode?.outputs || []).find(o => o.name === edge.sourceField);
        if (!sourceOutput) continue;
        // If the source output has an example, the example must be
        // substantive — not a single token like "approved".
        if (sourceOutput.example !== undefined && typeof sourceOutput.example === 'string') {
          if (sourceOutput.example.length < 20) {
            // eslint-disable-next-line no-console
            console.error(
              `Output node "${outputNode.id}" receives "${edge.source}.${edge.sourceField}" whose example is only "${sourceOutput.example}" — likely wrong wire (user will see this short token as the entire flow output).`
            );
          }
          expect(sourceOutput.example.length).toBeGreaterThanOrEqual(20);
        }
      }
    });
  }
});

// ---- Per-template behavioural locks ----
//
// The generic checks above guarantee schema/lint/Phase-7 hygiene across
// every template. The blocks below lock the specific behaviour each new
// template exists to demonstrate — so a refactor can't silently drop the
// feature that justifies the template's existence.

describe('Template "support-triage" — feature locks', () => {
  const triage = getTemplateByKey('support-triage');

  test('exists', () => {
    expect(triage).not.toBeNull();
  });

  test('has the four specialist-pipeline nodes (classifier, specialist, formatter, plus io)', () => {
    const ids = triage.flow.nodes.map(n => n.id);
    expect(ids).toEqual(expect.arrayContaining(['classifier', 'specialist', 'formatter', 'in', 'out']));
  });

  test('classifier emits the three routing fields (category enum, urgency number, sentiment enum)', () => {
    const classifier = triage.flow.nodes.find(n => n.id === 'classifier');
    const outputNames = (classifier.outputs || []).map(o => o.name);
    expect(outputNames).toEqual(expect.arrayContaining(['category', 'urgency', 'sentiment']));
    const urgency = classifier.outputs.find(o => o.name === 'urgency');
    expect(urgency.type).toBe('number');
  });

  test('classifier has a tight timeout (≤30s) — fast classification is the whole point', () => {
    const classifier = triage.flow.nodes.find(n => n.id === 'classifier');
    expect(classifier.execution?.timeoutMs).toBeDefined();
    expect(classifier.execution.timeoutMs).toBeLessThanOrEqual(30000);
  });

  test('specialist has a longer timeout (≥60s) — resolution work needs more headroom than classification', () => {
    const specialist = triage.flow.nodes.find(n => n.id === 'specialist');
    expect(specialist.execution?.timeoutMs).toBeDefined();
    expect(specialist.execution.timeoutMs).toBeGreaterThanOrEqual(60000);
  });

  test('flow has retry policy (queue robustness across transient failures)', () => {
    expect(triage.flow.execution?.maxRetries).toBeDefined();
    expect(triage.flow.execution.maxRetries).toBeGreaterThan(0);
  });

  test('all three classifier outputs reach the specialist (typed routing)', () => {
    const edges = triage.flow.edges.filter(e => e.source === 'classifier' && e.target === 'specialist');
    const fields = edges.map(e => e.sourceField).sort();
    expect(fields).toEqual(['category', 'sentiment', 'urgency']);
  });

  test('formatter receives both the resolution AND the sentiment (tone-matching contract)', () => {
    const inbound = triage.flow.edges.filter(e => e.target === 'formatter');
    const targetFields = inbound.map(e => e.targetField).sort();
    expect(targetFields).toEqual(['resolution', 'sentiment']);
  });

  test('output node receives the polished reply (formatter.reply), not raw resolution', () => {
    const out = triage.flow.nodes.find(n => n.id === 'out');
    const inbound = triage.flow.edges.find(e => e.target === out.id);
    expect(inbound.source).toBe('formatter');
    expect(inbound.sourceField).toBe('reply');
  });
});

describe('Template "spec-plan-implement-verify" — feature locks', () => {
  const sp = getTemplateByKey('spec-plan-implement-verify');

  test('exists', () => {
    expect(sp).not.toBeNull();
  });

  test('has the four-stage autonomous-coding pipeline (pm → architect → implementer → verifier)', () => {
    const ids = sp.flow.nodes.map(n => n.id);
    expect(ids).toEqual(expect.arrayContaining(['pm', 'architect', 'implementer', 'verifier', 'in', 'out']));
  });

  test('PM produces structured requirements (json), not free prose', () => {
    const pm = sp.flow.nodes.find(n => n.id === 'pm');
    const requirements = (pm.outputs || []).find(o => o.name === 'requirements');
    expect(requirements).toBeDefined();
    expect(requirements.type).toBe('json');
  });

  test('architect produces a typed file list (the implementer\'s contract — most important guarantee in this flow)', () => {
    const architect = sp.flow.nodes.find(n => n.id === 'architect');
    const files = (architect.outputs || []).find(o => o.name === 'files');
    expect(files).toBeDefined();
    // Either json (a structured list) or list-of-something is acceptable;
    // the value comes from being structured — not a prose blob.
    expect(['json', 'list<text>']).toContain(files.type);
  });

  test('implementer receives the architect\'s files list AND the prose plan (typed handoff prevents drift)', () => {
    const inbound = sp.flow.edges.filter(e => e.target === 'implementer');
    const targets = inbound.map(e => e.targetField).sort();
    expect(targets).toEqual(['files', 'plan']);
    // Both must come from the architect — the implementer can't take a
    // file list from anywhere else.
    expect(inbound.every(e => e.source === 'architect')).toBe(true);
  });

  test('implementer has the longest timeout (≥5min) and ≥2 retries — code generation is the slow + flaky step', () => {
    const implementer = sp.flow.nodes.find(n => n.id === 'implementer');
    expect(implementer.execution?.timeoutMs).toBeGreaterThanOrEqual(300000);
    expect(implementer.execution?.maxRetries).toBeGreaterThanOrEqual(2);
  });

  test('verifier has zero retries (deterministic step — re-running tests on the same code is wasted work)', () => {
    const verifier = sp.flow.nodes.find(n => n.id === 'verifier');
    expect(verifier.execution?.maxRetries).toBe(0);
  });

  test('verifier emits all three required signals: passed (boolean), failures (list<text>), report (text)', () => {
    const verifier = sp.flow.nodes.find(n => n.id === 'verifier');
    const byName = Object.fromEntries((verifier.outputs || []).map(o => [o.name, o]));
    expect(byName.passed?.type).toBe('boolean');
    expect(byName.failures?.type).toBe('list<text>');
    expect(byName.report?.type).toBe('text');
  });

  test('output node receives the human-readable report (text) — type-compatible with the output node', () => {
    const out = sp.flow.nodes.find(n => n.id === 'out');
    const inbound = sp.flow.edges.find(e => e.target === out.id);
    expect(inbound.source).toBe('verifier');
    expect(inbound.sourceField).toBe('report');
  });
});
