/**
 * flowTypes — type registry + compatibility matrix for Flows v2.
 *
 * Every node declares typed `inputs` and `outputs`; every edge maps an
 * output field to an input field. `isCompatible(srcType, dstType)` is
 * the rule that says "this connection won't surprise you at runtime."
 *
 * The matrix is intentionally narrow:
 *   - exact match always works
 *   - safe widenings work (any scalar → text/json, file → file[], text → list<text>)
 *   - everything else needs an explicit cast node (so the user is the one
 *     deciding what "parse this number" or "read this file" means)
 *
 * Editor uses this to refuse incompatible drag-connects. Server-side
 * schema validator uses it to reject saves. Single source of truth.
 */

export const TYPES = Object.freeze([
  'text',
  'number',
  'boolean',
  'json',
  'file',
  'file[]',
  'list<text>',
]);

const TYPE_SET = new Set(TYPES);

export function isKnownType(t) {
  return typeof t === 'string' && TYPE_SET.has(t);
}

/**
 * Compatibility matrix. Encoded as a Map<from, Set<to>> so additions
 * are easy to read; exact-match handled separately to keep the data
 * minimal.
 *
 * NOTE: file is intentionally NOT compatible with text/json. Auto-reading
 * a file is surprising behavior — if the user wants the content, they
 * should add a "read file" cast/transform node. Conversely, file → file[]
 * is allowed because "this single file" → "a list with one file" is
 * unambiguous and the most common pipeline shape.
 */
const ALLOWED = new Map([
  // any scalar / json → text (auto-stringify)
  ['number',     new Set(['text', 'json'])],
  ['boolean',    new Set(['text', 'json'])],
  ['json',       new Set(['text'])],
  // text widens to json (wraps as a JSON string) and to a 1-element list
  ['text',       new Set(['json', 'list<text>'])],
  // file singleton → list-of-files (very common)
  ['file',       new Set(['file[]'])],
  // list<text> can wrap as JSON
  ['list<text>', new Set(['json'])],
]);

/**
 * @param {string} from  source output type
 * @param {string} to    target input type
 * @returns {boolean}    true iff the connection is allowed without a cast
 */
export function isCompatible(from, to) {
  if (!isKnownType(from) || !isKnownType(to)) return false;
  if (from === to) return true;
  return ALLOWED.get(from)?.has(to) === true;
}

/**
 * Human-readable explanation for why two types don't connect. Returns
 * null when they DO connect (caller treats null as "all good"). Used
 * by editor tooltips and the schema validator's error messages.
 */
export function describeCompat(from, to) {
  if (isCompatible(from, to)) return null;
  if (!isKnownType(from)) return `unknown source type "${from}"`;
  if (!isKnownType(to))   return `unknown target type "${to}"`;
  return `${from} → ${to} requires an explicit cast node (incompatible types)`;
}

export default { TYPES, isKnownType, isCompatible, describeCompat };
