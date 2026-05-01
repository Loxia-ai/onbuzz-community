/**
 * Edge-id stamping for flows.
 *
 * VENDORED COPY of `src/utilities/flowEdgeIds.js` (server-side). The
 * web-ui bundles only files under `web-ui/`, so cross-tree imports from
 * `../../../src/utilities/...` break the Docker build (which copies
 * just `web-ui/` into its build context). Authoritative tests live
 * server-side at `src/utilities/__tests__/flowEdgeIds.test.js`; this
 * copy must stay byte-identical in behavior. If you change one, change
 * both — the format is shared so the server's saved edges and the
 * editor's freshly-loaded edges agree on ids.
 *
 * Reason this exists at all: ReactFlow REQUIRES every edge to carry a
 * unique `id`. Templates and marketplace-installed flows ship without
 * ids — they're a v2 schema concern, not a renderer concern — so
 * freshly-loaded flows render with NO arrows between their nodes until
 * something stamps ids.
 *
 * Two layers in the stack apply this:
 *   1. Server: `stateManager.createFlow` stamps on save so the durable
 *      shape on disk is always renderable.
 *   2. Client: `FlowEditor` stamps on load as defense-in-depth (covers
 *      templates that mounted before the server ever saw them).
 */

/**
 * Build a stable id for an edge. Includes source/target plus the typed
 * field names (when present) so re-saving the same flow doesn't churn
 * ids and version diffs stay clean. The trailing index is the only
 * non-stable component, used only as a tiebreaker for the rare case of
 * two edges between the same pair with identical fields.
 *
 * @param {Object} edge - Edge with {source, sourceField?, target, targetField?}
 * @param {number} idx  - Position in the edges array (for tiebreaking)
 * @returns {string} Generated id
 */
export function makeEdgeId(edge, idx) {
  const sf = edge?.sourceField ? `:${edge.sourceField}` : '';
  const tf = edge?.targetField ? `:${edge.targetField}` : '';
  return `e-${edge?.source || '?'}${sf}-${edge?.target || '?'}${tf}-${idx}`;
}

/**
 * Stamp ids on every edge that doesn't already have one. Preserves
 * existing ids verbatim (so user-supplied ids — e.g. from rollback or
 * import — pass through unchanged). Returns a NEW array; doesn't
 * mutate the input.
 *
 * @param {Array<Object>|null|undefined} rawEdges
 * @returns {Array<Object>}
 */
export function ensureEdgeIds(rawEdges) {
  if (!Array.isArray(rawEdges)) return [];
  return rawEdges.map((e, idx) => {
    if (e && typeof e === 'object' && e.id) return e;
    return { ...(e || {}), id: makeEdgeId(e, idx) };
  });
}
