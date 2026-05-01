/**
 * Ancestry checks for platformControlTool's hard rules.
 *
 * Each agent record carries `createdBy: <agentId> | null`. An agent
 * created via this tool inherits the caller's id as its parent;
 * agents created via the UI have `createdBy: null` (no parent).
 *
 * The hard rule "no descendant modifies an ancestor" requires walking
 * UP the caller's chain looking for the target. Done as a pure function
 * over an `(id) → agent` lookup so it's testable without an agent pool.
 *
 * Defenses:
 *   - Cycle detection (visited set). The data model isn't supposed to
 *     have cycles, but a corrupt state file shouldn't crash the tool.
 *   - Depth cap (CHAIN_MAX). Hard ceiling on chain walks; if a real
 *     deployment ever sees a chain this deep, we have other problems.
 *   - Missing-agent tolerance. If the lookup returns null mid-walk we
 *     stop cleanly — orphaned chains are treated as "no further parent".
 */

export const CHAIN_MAX = 100;

/**
 * Returns true if `targetId` appears in `callerId`'s ancestor chain.
 * Self is NOT counted as an ancestor here — the self-modify rule is a
 * separate check at the call site (`targetId === callerId`).
 *
 * @param {string} callerId
 * @param {string} targetId
 * @param {(id: string) => ({ id?: string, createdBy?: string|null }|null|undefined)} getAgent
 * @returns {boolean}
 */
export function isAncestor(callerId, targetId, getAgent) {
  if (!callerId || !targetId) return false;
  if (callerId === targetId) return false;        // self isn't an ancestor in this sense
  if (typeof getAgent !== 'function') return false;

  const visited = new Set([callerId]);
  let cursorId = callerId;
  for (let i = 0; i < CHAIN_MAX; i++) {
    const cursor = getAgent(cursorId);
    if (!cursor) return false;
    const parentId = cursor.createdBy;
    if (!parentId) return false;
    if (parentId === targetId) return true;
    if (visited.has(parentId)) return false;      // cycle — bail
    visited.add(parentId);
    cursorId = parentId;
  }
  return false;
}

/**
 * Convenience: would `callerId` be blocked by the hard rules from
 * mutating `targetId`? Combines self-modify + ancestor-modify checks.
 */
export function isProtectedFromCaller(callerId, targetId, getAgent) {
  if (!callerId || !targetId) return false;
  if (callerId === targetId) return true;          // self-modify forbidden
  return isAncestor(callerId, targetId, getAgent);
}

/**
 * Build a `getAgent` lookup from an iterable of agents (Map, array,
 * agentPool.getAllAgents() result). Used by the tool when it has the
 * full set in hand and doesn't want to do async lookups inside the
 * pure ancestry walk.
 */
export function makeAgentLookup(agents) {
  if (!agents) return () => null;
  if (typeof agents.get === 'function' && typeof agents.has === 'function') {
    return (id) => agents.get(id) || null;
  }
  if (Array.isArray(agents)) {
    const map = new Map(agents.filter(a => a && a.id).map(a => [a.id, a]));
    return (id) => map.get(id) || null;
  }
  // Plain object
  if (typeof agents === 'object') {
    return (id) => agents[id] || null;
  }
  return () => null;
}

export default { CHAIN_MAX, isAncestor, isProtectedFromCaller, makeAgentLookup };
