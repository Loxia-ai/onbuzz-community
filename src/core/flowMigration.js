/**
 * flowMigration — legacy v1 → v2 flow auto-wrap.
 *
 * v2 flows declare typed `inputs[]` / `outputs[]` per node and
 * `sourceField` / `targetField` per edge. v1 flows have none of that.
 * Rather than force a global migration, the executor wraps v1 flows
 * on load using sane defaults that preserve v1 behavior:
 *
 *   - input  node: no inputs, one output  { name: 'result',  type: 'text' }
 *   - agent  node: one input  { name: 'context', type: 'text', required: true },
 *                  one output { name: 'result',  type: 'text' }
 *   - output node: one input  { name: 'context', type: 'text', required: true },
 *                  no outputs
 *   - every edge: sourceField='result', targetField='context'
 *
 * Idempotent. v2 flows pass through untouched. Never mutates input.
 */

const DEFAULT_TEXT_INPUT  = Object.freeze({ name: 'context', type: 'text', required: true });
const DEFAULT_TEXT_OUTPUT = Object.freeze({ name: 'result',  type: 'text' });

/**
 * A flow is v2 if it declares `schemaVersion: 2` OR if any node already
 * carries typed `inputs` / `outputs`. The "any typed node" heuristic
 * lets partial migrations round-trip cleanly without re-wrapping.
 */
export function isV2Flow(flow) {
  if (!flow || typeof flow !== 'object') return false;
  if (flow.schemaVersion === 2) return true;
  if (!Array.isArray(flow.nodes)) return false;
  return flow.nodes.some(n =>
    Array.isArray(n?.inputs) || Array.isArray(n?.outputs)
  );
}

function wrapNode(node) {
  // Preserve all existing fields; only ADD typed inputs/outputs.
  const next = { ...node };
  switch (node.type) {
    case 'input':
      next.inputs  = [];
      next.outputs = [{ ...DEFAULT_TEXT_OUTPUT }];
      break;
    case 'output':
      next.inputs  = [{ ...DEFAULT_TEXT_INPUT }];
      next.outputs = [];
      break;
    case 'agent':
    default:
      // Default to "takes context, produces result" for any unknown
      // node type too — keeps the migration total.
      next.inputs  = [{ ...DEFAULT_TEXT_INPUT }];
      next.outputs = [{ ...DEFAULT_TEXT_OUTPUT }];
      break;
  }
  return next;
}

function wrapEdge(edge) {
  return {
    ...edge,
    sourceField: 'result',
    targetField: 'context',
  };
}

/**
 * Migrate a v1 flow to v2 shape. Idempotent — already-v2 flows return
 * unchanged (same reference).
 *
 * Returns the input as-is if it isn't a recognizable flow object
 * (null/undefined/missing nodes). Lets callers fall through to their
 * own error handling without us throwing on the load path.
 */
export function migrateLegacyFlow(flow) {
  if (!flow || typeof flow !== 'object') return flow;
  if (!Array.isArray(flow.nodes)) return flow;
  if (isV2Flow(flow)) return flow;

  return {
    ...flow,
    schemaVersion: 2,
    nodes: flow.nodes.map(wrapNode),
    edges: Array.isArray(flow.edges) ? flow.edges.map(wrapEdge) : [],
  };
}

export default { isV2Flow, migrateLegacyFlow };
