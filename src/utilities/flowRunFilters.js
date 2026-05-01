/**
 * Flow run filtering helpers — small pure functions used by the
 * `/api/flows/runs/active` endpoint to surface non-terminal runs to the
 * Flows page (for the running-indicator badge on each card).
 *
 * Lives in utilities/ so it stays testable without standing up the
 * webServer; the route consumes these helpers + sends the result.
 */

/**
 * Statuses considered "the run is still doing work" — anything not in
 * this set is terminal (completed / failed / cancelled). The names
 * match the executor's enum at runtime; if a new intermediate state is
 * added (e.g. 'awaiting-human'), include it here AND wherever the UI
 * renders status text.
 */
export const ACTIVE_FLOW_RUN_STATUSES = Object.freeze(
  new Set(['queued', 'pending', 'running', 'paused'])
);

/**
 * Return true if a run object is in a non-terminal state. Defensive on
 * shape — null/undefined/missing-status all collapse to `false`.
 *
 * @param {Object|null|undefined} run
 * @returns {boolean}
 */
export function isActiveFlowRun(run) {
  if (!run || typeof run !== 'object') return false;
  return ACTIVE_FLOW_RUN_STATUSES.has(run.status);
}

/**
 * Project a flow-run-index object (the shape persisted on disk:
 * `{ runId: { flowId, status, startedAt, nodeStates, ... }, ... }`)
 * into the compact list the FE consumes. Drops terminal runs and trims
 * to the fields the UI cares about, plus a `progress` summary derived
 * from nodeStates so the FlowsPage card can render "Step 2/4 · Writer"
 * without a second round-trip per flow.
 *
 * @param {Object|null|undefined} runIndex - Map-shaped run index
 * @param {(flowId: string) => Object|null|undefined} [flowLookup] -
 *   Optional resolver returning the flow definition for a given id;
 *   used to compute total node count + look up the current node's
 *   human label. When omitted (legacy callers / tests), the projection
 *   still works — `progress.total` and `progress.currentNodeLabel`
 *   degrade to null but `running`/`completed`/etc. counts are accurate.
 * @returns {Array<{
 *   runId: string, flowId: string|null, status: string,
 *   startedAt: string|null,
 *   progress: {
 *     total:    number|null,
 *     completed: number,
 *     running:   number,
 *     failed:    number,
 *     pending:   number,
 *     percent:   number|null,
 *     currentNodeId:    string|null,
 *     currentNodeLabel: string|null,
 *   }
 * }>}
 */
export function projectActiveRuns(runIndex, flowLookup) {
  if (!runIndex || typeof runIndex !== 'object') return [];
  const out = [];
  for (const [runId, run] of Object.entries(runIndex)) {
    if (!isActiveFlowRun(run)) continue;
    out.push({
      runId,
      flowId:    run.flowId || null,
      status:    run.status,
      startedAt: run.startedAt || run.createdAt || null,
      progress:  summarizeRunProgress(run, typeof flowLookup === 'function'
        ? flowLookup(run.flowId)
        : null),
    });
  }
  return out;
}

/**
 * Compute a UI-friendly progress summary from a run's nodeStates plus
 * (optionally) the flow definition for total + label resolution.
 *
 * Counts are always populated from nodeStates. The `total` and
 * `currentNodeLabel` fields are populated when a flow definition is
 * provided; otherwise they're `null` and the FE renders a less-rich
 * variant ("Running 2 nodes" instead of "Step 3/5: Writer"). This
 * separation keeps the helper testable without needing the full flow
 * registry.
 *
 * @param {Object} run - Persisted run object with `nodeStates` map
 * @param {Object|null} flowDef - Optional flow definition for label resolution
 * @returns {Object}
 */
export function summarizeRunProgress(run, flowDef) {
  const states = run && typeof run.nodeStates === 'object' && run.nodeStates !== null
    ? run.nodeStates
    : {};
  let completed = 0, running = 0, failed = 0, pending = 0;
  let currentNodeId = null;
  // Pick the LATEST `running` node by `startedAt` so a fan-out flow
  // surfaces the most-recently-started step (matches the user's
  // intuition of "what's happening right now").
  let currentRunningStart = null;
  for (const [nodeId, ns] of Object.entries(states)) {
    if (!ns || typeof ns !== 'object') continue;
    switch (ns.status) {
      case 'completed': completed++; break;
      case 'running':
        running++;
        if (!currentRunningStart || (ns.startedAt && ns.startedAt > currentRunningStart)) {
          currentNodeId = nodeId;
          currentRunningStart = ns.startedAt || currentRunningStart;
        }
        break;
      case 'failed':  failed++; break;
      case 'pending':
      case 'queued':  pending++; break;
      // Unknown statuses don't go in any bucket — defensive.
    }
  }
  // Resolve total + current label from the flow definition when present.
  let total = null;
  let currentNodeLabel = null;
  if (flowDef && Array.isArray(flowDef.nodes)) {
    // Only count agent + non-input/output nodes? No — count ALL nodes
    // including input/output so progress matches the canvas. Input runs
    // first and is fast; counting it keeps the % monotonically progress.
    total = flowDef.nodes.length;
    if (currentNodeId) {
      const cur = flowDef.nodes.find(n => n.id === currentNodeId);
      currentNodeLabel = cur?.data?.label || cur?.id || null;
    }
  }
  // Percent: only computable when total is known. Round to int — the
  // FE uses this on a small progress bar where decimal precision is noise.
  const percent = total && total > 0 ? Math.round((completed / total) * 100) : null;
  return {
    total,
    completed,
    running,
    failed,
    pending,
    percent,
    currentNodeId,
    currentNodeLabel,
  };
}
