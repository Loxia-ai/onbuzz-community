/**
 * flowFieldMapping — assembles a target node's typed inputs from
 * upstream node outputs, following the v2 edge field mappings.
 *
 * Why pull this out of FlowExecutor: it's pure logic, easy to unit
 * test, and the executor already has plenty going on. Two consumers:
 *
 *   1. FlowExecutor.executeAgentNode — builds the prompt template
 *      variables before queueing a message.
 *   2. flowContextService — could surface the typed bag to the system
 *      prompt ("you will receive: topic (text), research (json)").
 *
 * Output shape:
 *   {
 *     values: { [inputName]: <coerced value> },
 *     missing: [inputName, ...],   // required inputs with no source / no upstream output
 *     legacy: boolean              // true when called against a v1 node
 *   }
 *
 * v1 fallback (legacy=true): when the target node has no `inputs[]`
 * declared, this returns `{ input, previousOutput }` keys built by
 * concatenating all upstream outputs — matching what FlowExecutor used
 * to compute inline.
 */

const SCALAR = new Set(['text', 'number', 'boolean']);

/**
 * Coerce `value` to the target input's type. Mirrors the compatibility
 * matrix in flowTypes.js — but applied at runtime to the actual value.
 *
 * The matrix says WHAT can connect; this function says HOW. They're
 * intentionally separate so the editor can refuse bad connects WITHOUT
 * needing the runtime data.
 */
function coerce(value, targetType) {
  if (value === undefined || value === null) return value;

  switch (targetType) {
    case 'text': {
      if (typeof value === 'string')   return value;
      if (typeof value === 'number')   return String(value);
      if (typeof value === 'boolean')  return String(value);
      // json → text: stringify
      try { return JSON.stringify(value); } catch { return String(value); }
    }
    case 'json':
      // Anything is valid JSON. Pass through unchanged (caller may
      // serialize at the boundary if it needs a string).
      return value;
    case 'file[]':
      if (Array.isArray(value)) return value;
      // Singleton string → 1-element list (file → file[]).
      return [value];
    case 'list<text>':
      if (Array.isArray(value)) return value.map(v => typeof v === 'string' ? v : String(v));
      return [typeof value === 'string' ? value : String(value)];
    default:
      // number / boolean / file: exact match expected (validator already
      // rejected mismatches), so pass through.
      return value;
  }
}

/**
 * Read a named output from a node's recorded result. Supports two
 * shapes:
 *   - v2:   { outputs: { fieldName: value } }                ← preferred
 *   - v1:   { output: <single value>, type: 'agent', ... }   ← legacy
 *
 * For v1 fallback, the only available "field" is treated as either
 * `result` (matching the migration default) or whatever name the edge
 * declares — both resolve to the single `output` value.
 */
function readSourceOutput(sourceResult, sourceField) {
  if (!sourceResult || typeof sourceResult !== 'object') return undefined;
  if (sourceResult.outputs && typeof sourceResult.outputs === 'object') {
    return sourceResult.outputs[sourceField];
  }
  // Legacy: the only output IS the .output field, regardless of name.
  // Migration default uses 'result' — accept that name and any name as
  // a fallback so partially-migrated flows work.
  if ('output' in sourceResult) return sourceResult.output;
  return undefined;
}

/**
 * @param {object}   node          The target node (with optional inputs[])
 * @param {Array}    edges         All flow edges (we filter to inbound)
 * @param {object}   nodeOutputs   Map of nodeId → result object
 * @returns {{ values: object, missing: string[], legacy: boolean }}
 */
export function assembleNodeInputs(node, edges, nodeOutputs) {
  const safeEdges   = Array.isArray(edges) ? edges : [];
  const safeOutputs = (nodeOutputs && typeof nodeOutputs === 'object') ? nodeOutputs : {};

  // v1 fallback: no inputs[] declared at all → legacy concat shape.
  // Note: an explicitly empty array means "this node takes no inputs"
  // (a valid v2 declaration), so we treat it as v2.
  const inputs = node?.inputs;
  if (!Array.isArray(inputs)) {
    const inboundIds = safeEdges
      .filter(e => e && e.target === node?.id)
      .map(e => e.source);
    const parts = inboundIds
      .map(id => safeOutputs[id])
      .filter(Boolean)
      .map(o => (typeof o.output === 'string' ? o.output : JSON.stringify(o.output ?? '')));
    const concat = parts.join('\n\n');
    return {
      legacy: true,
      values: { input: concat, previousOutput: concat },
      missing: [],
    };
  }

  // v2: per-declared-input lookup via edge targetField.
  const values = {};
  const missing = [];
  for (const input of inputs) {
    if (!input || typeof input.name !== 'string') continue;
    const edge = safeEdges.find(e => e && e.target === node.id && e.targetField === input.name);
    if (!edge) {
      if (input.required) missing.push(input.name);
      continue;
    }
    const sourceResult = safeOutputs[edge.source];
    const raw = readSourceOutput(sourceResult, edge.sourceField);
    if (raw === undefined) {
      if (input.required) missing.push(input.name);
      continue;
    }
    values[input.name] = coerce(raw, input.type);
  }
  return { legacy: false, values, missing };
}

export default { assembleNodeInputs };
