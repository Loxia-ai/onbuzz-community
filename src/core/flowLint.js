/**
 * flowLint — semantic checks beyond what the schema validator catches.
 *
 * Schema = HARD gate (blocks save/execute on shape errors).
 * Lint   = SOFT advice (surface in editor tooltips and dry-run reports).
 *
 * Today's checks:
 *   - Unbound `{{placeholder}}` in a node's promptTemplate (no declared
 *     input by that name, no flow variable). Legacy `{{input}}` and
 *     `{{previousOutput}}` are always treated as bound.
 *   - Required v2 input without an inbound edge (this would also fail
 *     at runtime — surfacing it at edit-time saves the round-trip).
 *
 * Returns: { errors: [], warnings: [{ nodeId?, message }] }
 *
 * Pure-data — no I/O, no async. Safe to run client-side AND server-side.
 */

import { isV2Flow } from './flowMigration.js';

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_$][\w.$]*)\s*\}\}/g;

// Names always considered bound (legacy executor-injected variables).
const ALWAYS_BOUND = new Set(['input', 'previousOutput', 'userInput']);

export function lintFlow(flow) {
  const errors = [];
  const warnings = [];
  if (!flow || typeof flow !== 'object' || !Array.isArray(flow.nodes)) {
    return { errors, warnings };
  }

  // Lint focuses on v2 features. v1 flows skip these checks (their
  // semantics are looser by design).
  if (!isV2Flow(flow)) {
    return { errors, warnings };
  }

  const variableNames = new Set(Object.keys(flow.variables || {}));
  const edges = Array.isArray(flow.edges) ? flow.edges : [];

  for (const node of flow.nodes) {
    if (!node || typeof node.id !== 'string') continue;

    // Agent nodes with empty/missing agentId are valid at save (drafts)
    // but the run will fail. Surface this as a warning so the editor
    // can mark the node and the dry-run report can call it out.
    if (node.type === 'agent') {
      const agentId = node.data?.agentId;
      if (typeof agentId !== 'string' || agentId.trim().length === 0) {
        warnings.push({
          nodeId: node.id,
          kind: 'unbound-agent',
          message: `Agent node "${node.id}" has no agent assigned — pick one in the properties panel before running`,
        });
      }
    }

    // Per-node bound names: declared inputs + flow variables + legacy.
    const inputNames = new Set((Array.isArray(node.inputs) ? node.inputs : []).map(i => i?.name).filter(Boolean));
    const bound = new Set([...inputNames, ...variableNames, ...ALWAYS_BOUND]);

    // 1) Unbound {{placeholder}} in promptTemplate
    const tpl = node?.data?.promptTemplate;
    if (typeof tpl === 'string' && tpl.length > 0) {
      // Reset the regex (state is sticky across calls)
      PLACEHOLDER_RE.lastIndex = 0;
      const seen = new Set();
      let m;
      while ((m = PLACEHOLDER_RE.exec(tpl)) !== null) {
        // Strip dot-paths to root identifier (e.g. {{user.name}} → 'user')
        const root = m[1].split('.')[0];
        if (seen.has(root)) continue;
        seen.add(root);
        if (!bound.has(root)) {
          warnings.push({
            nodeId: node.id,
            message: `Template references "{{${m[1]}}}" but no input named "${root}" or variable is declared on node "${node.id}"`,
          });
        }
      }
    }

    // 2) Required input with no inbound edge mapping its targetField
    if (Array.isArray(node.inputs)) {
      for (const inp of node.inputs) {
        if (!inp || !inp.required) continue;
        const fed = edges.some(e => e && e.target === node.id && e.targetField === inp.name);
        if (!fed) {
          warnings.push({
            nodeId: node.id,
            message: `Required input "${inp.name}" on node "${node.id}" has no inbound edge feeding it`,
          });
        }
      }
    }
  }

  return { errors, warnings };
}

export default { lintFlow };
