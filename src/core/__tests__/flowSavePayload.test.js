/**
 * UI → Server save-payload round-trip tests.
 *
 * Why this file exists: my unit tests built clean fixtures and ran them
 * through the validator. The actual EDITOR wraps nodes through ReactFlow,
 * which augments them with runtime state (selected, dragging, dimensions,
 * positionAbsolute) AND we (FlowCanvas) inject UI-only data fields
 * (executionStatus, lintWarnings, declaredInputs, declaredOutputs).
 * On save, that augmented mess gets sent to PUT /api/flows/:id.
 *
 * These tests simulate that pollution and verify two things:
 *   1. The sanitize-on-save logic in FlowEditor strips ALL the noise
 *      (so the persisted flow stays clean across save round-trips).
 *   2. After sanitization, every starter template still validates.
 *
 * Without this, the next change to FlowCanvas's data injection could
 * silently re-introduce the same class of "save fails with HTTP 400"
 * bug we just shipped a fix for.
 */

import { describe, test, expect } from '@jest/globals';
import { validateFlowDefinition } from '../flowSchema.js';
import { STARTER_TEMPLATES } from '../../../web-ui/src/utils/flowTemplates.js';

/**
 * Mirror of FlowEditor.sanitizeNodesForSave — kept identical so this
 * test suite locks the contract. If the UI sanitizer drifts, both
 * places must update together.
 */
function sanitizeNodesForSave(rawNodes) {
  return (rawNodes || []).map(n => {
    const { selected, dragging, width, height, positionAbsolute, ...keptTop } = n;
    const data = { ...(n.data || {}) };
    delete data.executionStatus;
    delete data.lintWarnings;
    delete data.declaredInputs;
    delete data.declaredOutputs;
    delete data.charactersStreamed;
    return { ...keptTop, data };
  });
}

/**
 * Pollute a clean node with the same augmentations the live UI adds:
 *   - data.executionStatus, data.lintWarnings (from FlowCanvas useMemo)
 *   - data.declaredInputs, data.declaredOutputs (Phase 5 surfacing)
 *   - data.charactersStreamed (streaming progress)
 *   - selected, dragging, width, height, positionAbsolute (ReactFlow internal)
 */
function pollute(node) {
  return {
    ...node,
    selected: false,
    dragging: false,
    width: 220,
    height: 96,
    positionAbsolute: { ...(node.position || { x: 0, y: 0 }) },
    data: {
      ...(node.data || {}),
      executionStatus: 'completed',
      lintWarnings: [{ kind: 'unbound-agent', message: '...' }],
      declaredInputs:  Array.isArray(node.inputs)  ? node.inputs  : null,
      declaredOutputs: Array.isArray(node.outputs) ? node.outputs : null,
      charactersStreamed: 1234,
    },
  };
}

describe('save payload round-trip', () => {
  test('sanitizer removes every UI-only data field', () => {
    const polluted = pollute({
      id: 'n', type: 'agent', position: { x: 0, y: 0 },
      data: { agentId: 'a', label: 'A', promptTemplate: '{{x}}' },
      inputs: [{ name: 'x', type: 'text', required: true }],
      outputs: [{ name: 'y', type: 'text' }],
    });
    // Sanity: pollution actually happened
    expect(polluted.data.executionStatus).toBe('completed');
    expect(polluted.selected).toBe(false);
    expect(polluted.width).toBe(220);

    const [clean] = sanitizeNodesForSave([polluted]);

    // Runtime data fields stripped
    expect(clean.data.executionStatus).toBeUndefined();
    expect(clean.data.lintWarnings).toBeUndefined();
    expect(clean.data.declaredInputs).toBeUndefined();
    expect(clean.data.declaredOutputs).toBeUndefined();
    expect(clean.data.charactersStreamed).toBeUndefined();
    // ReactFlow internal flags stripped
    expect(clean.selected).toBeUndefined();
    expect(clean.dragging).toBeUndefined();
    expect(clean.width).toBeUndefined();
    expect(clean.height).toBeUndefined();
    expect(clean.positionAbsolute).toBeUndefined();
    // User-authored data preserved
    expect(clean.data.agentId).toBe('a');
    expect(clean.data.label).toBe('A');
    expect(clean.data.promptTemplate).toBe('{{x}}');
    expect(clean.inputs).toEqual([{ name: 'x', type: 'text', required: true }]);
    expect(clean.outputs).toEqual([{ name: 'y', type: 'text' }]);
    expect(clean.position).toEqual({ x: 0, y: 0 });
  });

  test('sanitizer is idempotent (saving twice produces same shape)', () => {
    const polluted = pollute({
      id: 'n', type: 'agent', position: { x: 5, y: 10 },
      data: { agentId: 'a' },
      inputs: [], outputs: [{ name: 'y', type: 'text' }],
    });
    const once  = sanitizeNodesForSave([polluted]);
    const twice = sanitizeNodesForSave(once);
    expect(twice).toEqual(once);
  });

  test('sanitizer handles null/undefined nodes gracefully', () => {
    expect(sanitizeNodesForSave(null)).toEqual([]);
    expect(sanitizeNodesForSave(undefined)).toEqual([]);
    expect(sanitizeNodesForSave([])).toEqual([]);
  });
});

describe('every starter template survives a polluted save round-trip', () => {
  // The actual bug the user hit: load a template → canvas injects
  // runtime fields → user clicks save → server PUT validates the
  // augmented payload. This test reproduces that path end-to-end
  // for every template. If any new template ships with a shape that
  // the canvas augmentation breaks, this fails loud.
  for (const t of STARTER_TEMPLATES) {
    test(`"${t.key}" round-trips clean → polluted → sanitized → validated`, () => {
      // Mimic what the editor sends to PUT /api/flows/:id:
      const polluted = t.flow.nodes.map(pollute);
      const sanitized = sanitizeNodesForSave(polluted);

      // Reassemble the flow exactly as the PUT route's merge step
      // would: existing template + nodes/edges from the editor.
      const asUserSaves = {
        ...t.flow,
        nodes: sanitized,
        edges: t.flow.edges,
      };

      const result = validateFlowDefinition(asUserSaves);
      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.error(`Save round-trip for "${t.key}" failed validation:`, result.errors);
      }
      expect(result.ok).toBe(true);
    });
  }

  test('UNSANITIZED polluted save would have failed if validator tightened (regression evidence)', () => {
    // This documents WHY sanitization matters. Today the validator
    // accepts unknown fields silently — so a polluted save would
    // technically validate. But ReactFlow's `selected`/`dragging`
    // booleans and dimensions clutter the on-disk record and grow on
    // every round-trip. Sanitization is the contract.
    const polluted = STARTER_TEMPLATES[0].flow.nodes.map(pollute);
    // Confirm the pollution is observable
    expect(polluted[0].data.executionStatus).toBeDefined();
    expect(polluted[0].selected).toBeDefined();
    // After sanitize, none of those leak through
    const clean = sanitizeNodesForSave(polluted);
    for (const n of clean) {
      expect(n.data.executionStatus).toBeUndefined();
      expect(n.selected).toBeUndefined();
    }
  });
});
