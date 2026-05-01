/**
 * Client-side flow lint — mirrors src/core/flowLint.js for the editor.
 *
 * Why mirror instead of import: the React app builds independently
 * from the server. Keeping this file in sync with the backend is a
 * one-import update; the alternative (cross-package shared module)
 * adds a build-time coupling we don't want yet.
 *
 * Tests live next to it under __tests__/. The shape and rules MUST
 * match the backend so dry-run results align with inline editor lint.
 */

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_$][\w.$]*)\s*\}\}/g;
const ALWAYS_BOUND = new Set(['input', 'previousOutput', 'userInput']);

function isV2Flow(flow) {
  if (!flow || typeof flow !== 'object') return false;
  if (flow.schemaVersion === 2) return true;
  if (!Array.isArray(flow.nodes)) return false;
  return flow.nodes.some(n => Array.isArray(n?.inputs) || Array.isArray(n?.outputs));
}

export function lintFlow(flow) {
  const errors = [];
  const warnings = [];
  if (!flow || typeof flow !== 'object' || !Array.isArray(flow.nodes)) {
    return { errors, warnings };
  }
  if (!isV2Flow(flow)) return { errors, warnings };

  const variableNames = new Set(Object.keys(flow.variables || {}));
  const edges = Array.isArray(flow.edges) ? flow.edges : [];

  for (const node of flow.nodes) {
    if (!node || typeof node.id !== 'string') continue;

    // Agent nodes with empty/missing agentId — drafts you must complete
    // before running. Surface as warning so AgentNode can chip it and
    // dry-run can list it.
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

    const inputNames = new Set((Array.isArray(node.inputs) ? node.inputs : []).map(i => i?.name).filter(Boolean));
    const bound = new Set([...inputNames, ...variableNames, ...ALWAYS_BOUND]);

    const tpl = node?.data?.promptTemplate;
    if (typeof tpl === 'string' && tpl.length > 0) {
      PLACEHOLDER_RE.lastIndex = 0;
      const seen = new Set();
      let m;
      while ((m = PLACEHOLDER_RE.exec(tpl)) !== null) {
        const root = m[1].split('.')[0];
        if (seen.has(root)) continue;
        seen.add(root);
        if (!bound.has(root)) {
          warnings.push({
            nodeId: node.id,
            kind: 'unbound-placeholder',
            field: root,
            message: `Template references "{{${m[1]}}}" but no input named "${root}" is declared on node "${node.id}"`,
          });
        }
      }
    }

    if (Array.isArray(node.inputs)) {
      for (const inp of node.inputs) {
        if (!inp || !inp.required) continue;
        const fed = edges.some(e => e && e.target === node.id && e.targetField === inp.name);
        if (!fed) {
          warnings.push({
            nodeId: node.id,
            kind: 'unbound-required-input',
            field: inp.name,
            message: `Required input "${inp.name}" on node "${node.id}" has no inbound edge feeding it`,
          });
        }
      }
    }
  }

  return { errors, warnings };
}

/** Group warnings by nodeId so the editor can render badges per node. */
export function lintByNode(flow) {
  const { warnings } = lintFlow(flow);
  const map = new Map();
  for (const w of warnings) {
    if (!map.has(w.nodeId)) map.set(w.nodeId, []);
    map.get(w.nodeId).push(w);
  }
  return map;
}

export default { lintFlow, lintByNode };
