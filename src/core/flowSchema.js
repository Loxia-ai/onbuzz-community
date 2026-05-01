/**
 * flowSchema — pure-JS validator for flow definitions.
 *
 * The gate: anything posted to /api/flows or executed by FlowExecutor
 * runs through this first. If it fails, the user gets specific errors
 * BEFORE waiting 90s for a runtime crash.
 *
 * Why hand-rolled (not Ajv): we want path-precise error messages
 * (e.g. "nodes[1].data.agentId is required") and we want the validator
 * to do graph-shape checks (cycles, edge endpoints) that Ajv can't
 * express in JSONSchema. ~150 LoC, zero runtime deps.
 *
 * Returns: { ok: boolean, errors: Array<{ path?: string, message: string }> }
 *
 * Optional `agentResolver(agentId): boolean` lets callers verify that
 * agent IDs referenced in agent-typed nodes actually exist in the pool.
 * Without it, presence/non-empty checks still run but existence isn't
 * verified — useful for client-side editor validation before save.
 */

import { isKnownType, isCompatible, describeCompat } from './flowTypes.js';
import { isV2Flow } from './flowMigration.js';

const NODE_TYPES = new Set(['input', 'agent', 'output']);

/**
 * @param {object} flow
 * @param {object} [opts]
 * @param {(agentId: string) => boolean} [opts.agentResolver]
 * @returns {{ ok: boolean, errors: Array<{ path?: string, message: string }> }}
 */
export function validateFlowDefinition(flow, opts = {}) {
  const errors = [];
  const push = (message, path) => errors.push(path ? { path, message } : { message });

  // --- root shape ---------------------------------------------------------
  if (flow === null || typeof flow !== 'object' || Array.isArray(flow)) {
    push('flow must be an object');
    return { ok: false, errors };
  }

  if (typeof flow.name !== 'string' || flow.name.trim().length === 0) {
    push('name is required and must be a non-empty string', 'name');
  }

  if (!Array.isArray(flow.nodes)) {
    push('nodes must be an array', 'nodes');
    // can't continue without nodes — return early
    return { ok: false, errors };
  }

  if (flow.edges !== undefined && !Array.isArray(flow.edges)) {
    push('edges must be an array when present', 'edges');
    return { ok: false, errors };
  }

  const edges = flow.edges || [];

  // --- node validation ---------------------------------------------------
  const seenIds = new Set();
  const nodeIds = new Set();              // populated only for valid-shape nodes
  for (let i = 0; i < flow.nodes.length; i++) {
    const node = flow.nodes[i];
    const path = `nodes[${i}]`;
    if (node === null || typeof node !== 'object') {
      push('node must be an object', path);
      continue;
    }
    if (typeof node.id !== 'string' || node.id.trim().length === 0) {
      push('node.id is required and must be a non-empty string', `${path}.id`);
      continue;
    }
    if (seenIds.has(node.id)) {
      push(`duplicate node id "${node.id}"`, `${path}.id`);
    } else {
      seenIds.add(node.id);
      nodeIds.add(node.id);
    }
    if (typeof node.type !== 'string' || !NODE_TYPES.has(node.type)) {
      push(
        `node.type must be one of ${[...NODE_TYPES].join(', ')} (got ${JSON.stringify(node.type)})`,
        `${path}.type`,
      );
      continue;
    }
    if (node.type === 'agent') {
      const agentId = node.data?.agentId;
      // Empty agentId is allowed at SAVE time so users can draft flows
      // (esp. from templates) and pick agents later. The lint surfaces
      // empty slots as warnings, and the executor refuses to RUN a flow
      // with unbound agent slots — separate concerns.
      if (agentId !== undefined && agentId !== null && typeof agentId !== 'string') {
        push(`agent node "${node.id}" data.agentId must be a string`, `${path}.data.agentId`);
      } else if (typeof agentId === 'string' && agentId.trim().length > 0 && typeof opts.agentResolver === 'function') {
        try {
          if (!opts.agentResolver(agentId)) {
            push(`agent "${agentId}" not found (referenced by node "${node.id}")`, `${path}.data.agentId`);
          }
        } catch (e) {
          // Resolver threw — treat as not-found but include the cause
          push(`agent resolver failed for "${agentId}": ${e?.message || e}`, `${path}.data.agentId`);
        }
      }
    }
  }

  // --- edge validation ---------------------------------------------------
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const path = `edges[${i}]`;
    if (edge === null || typeof edge !== 'object') {
      push('edge must be an object', path);
      continue;
    }
    if (typeof edge.source !== 'string' || edge.source.length === 0) {
      push('edge.source is required', `${path}.source`);
      continue;
    }
    if (typeof edge.target !== 'string' || edge.target.length === 0) {
      push('edge.target is required', `${path}.target`);
      continue;
    }
    if (edge.source === edge.target) {
      push(`edge has self-loop on "${edge.source}" (cycle)`, path);
      continue;
    }
    if (!nodeIds.has(edge.source)) {
      push(`edge.source "${edge.source}" does not match any node id`, `${path}.source`);
    }
    if (!nodeIds.has(edge.target)) {
      push(`edge.target "${edge.target}" does not match any node id`, `${path}.target`);
    }
  }

  // --- cycle detection (only if all edges reference real nodes) ---------
  // We build the adjacency only over edges whose endpoints both resolve;
  // unresolved-endpoint edges already reported above. Detecting cycles
  // separately avoids false positives from the broken edges.
  const adj = new Map();
  for (const id of nodeIds) adj.set(id, []);
  for (const edge of edges) {
    if (!edge || edge.source === edge.target) continue;
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adj.get(edge.source).push(edge.target);
    }
  }

  // Iterative DFS with WHITE/GRAY/BLACK coloring. GRAY ⇒ back-edge ⇒ cycle.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const id of nodeIds) color.set(id, WHITE);
  let cycleFound = false;
  let cycleHint = null;

  for (const start of nodeIds) {
    if (cycleFound) break;
    if (color.get(start) !== WHITE) continue;
    const stack = [{ node: start, idx: 0 }];
    color.set(start, GRAY);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const neighbors = adj.get(frame.node);
      if (frame.idx >= neighbors.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      const next = neighbors[frame.idx++];
      const c = color.get(next);
      if (c === GRAY) {
        cycleFound = true;
        cycleHint = `${frame.node} → ${next}`;
        break;
      }
      if (c === WHITE) {
        color.set(next, GRAY);
        stack.push({ node: next, idx: 0 });
      }
    }
  }

  if (cycleFound) {
    push(`flow has a cycle (back edge ${cycleHint}); flows must be acyclic`);
  }

  // --- v2 typed I/O validation ------------------------------------------
  // v2 = any node carries typed inputs/outputs OR schemaVersion: 2.
  // v1 flows skip this entirely (backwards compat).
  if (isV2Flow(flow)) {
    validateTypedIO(flow, errors, push);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate inputs/outputs arrays per node and edge field mappings + type
 * compatibility. Mutates `errors` via the `push` helper passed in.
 *
 * Why a separate function: keeps validateFlowDefinition readable and
 * makes it easy to skip for v1 flows.
 */
function validateTypedIO(flow, errors, push) {
  // Build per-node lookup of declared inputs/outputs by name → type
  // for fast edge validation.
  const nodeIO = new Map();   // nodeId → { inputs: Map<name,type>, outputs: Map<name,type> }

  for (let i = 0; i < flow.nodes.length; i++) {
    const node = flow.nodes[i];
    if (!node || typeof node !== 'object' || typeof node.id !== 'string') continue;
    const path = `nodes[${i}]`;
    const ios = { inputs: new Map(), outputs: new Map() };

    for (const kind of ['inputs', 'outputs']) {
      const arr = node[kind];
      if (arr === undefined) continue;       // omit = "no declared fields"; allowed
      if (!Array.isArray(arr)) {
        push(`node.${kind} must be an array when present`, `${path}.${kind}`);
        continue;
      }
      for (let j = 0; j < arr.length; j++) {
        const field = arr[j];
        const fpath = `${path}.${kind}[${j}]`;
        if (!field || typeof field !== 'object') {
          push(`${kind.slice(0, -1)} entry must be an object`, fpath);
          continue;
        }
        if (typeof field.name !== 'string' || field.name.length === 0) {
          push(`${kind.slice(0, -1)} field name is required`, `${fpath}.name`);
          continue;
        }
        if (!isKnownType(field.type)) {
          push(
            `${kind.slice(0, -1)} field "${field.name}" has unknown type ${JSON.stringify(field.type)}`,
            `${fpath}.type`,
          );
          continue;
        }
        if (ios[kind].has(field.name)) {
          push(`duplicate ${kind.slice(0, -1)} field name "${field.name}" on node "${node.id}"`, fpath);
          continue;
        }
        ios[kind].set(field.name, field.type);
      }
    }
    nodeIO.set(node.id, ios);
  }

  // Edge field mapping validation. An edge in a v2 flow MUST declare
  // sourceField + targetField. Each must reference a real declared field
  // on the corresponding node, and the types must be compatible per the
  // matrix.
  const edges = flow.edges || [];
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!edge || typeof edge !== 'object') continue;
    const path = `edges[${i}]`;
    const srcIO = nodeIO.get(edge.source);
    const dstIO = nodeIO.get(edge.target);
    if (!srcIO || !dstIO) continue;   // already-reported broken endpoint

    if (typeof edge.sourceField !== 'string' || edge.sourceField.length === 0) {
      push('v2 edge requires sourceField (output name on source node)', `${path}.sourceField`);
      continue;
    }
    if (typeof edge.targetField !== 'string' || edge.targetField.length === 0) {
      push('v2 edge requires targetField (input name on target node)', `${path}.targetField`);
      continue;
    }

    const srcType = srcIO.outputs.get(edge.sourceField);
    if (srcType === undefined) {
      push(
        `edge.sourceField "${edge.sourceField}" is not a declared output of node "${edge.source}"`,
        `${path}.sourceField`,
      );
      continue;
    }
    const dstType = dstIO.inputs.get(edge.targetField);
    if (dstType === undefined) {
      push(
        `edge.targetField "${edge.targetField}" is not a declared input of node "${edge.target}"`,
        `${path}.targetField`,
      );
      continue;
    }

    if (!isCompatible(srcType, dstType)) {
      push(
        `edge ${edge.source}.${edge.sourceField} → ${edge.target}.${edge.targetField}: ${describeCompat(srcType, dstType)}`,
        path,
      );
    }
  }
}

export default { validateFlowDefinition };
