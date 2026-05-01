/**
 * Pure helpers for `visual_editor_open` WebSocket message processing.
 *
 * Extracted out of appStore.js + useVisualEditor.js so the tricky bits —
 * unconditional-stash, payload validation, TTL freshness — can be
 * regression-tested in isolation. The store + hook call into these
 * helpers and remain thin orchestration layers.
 *
 * Keeping the logic pure (inputs in, decision out, no React, no Zustand)
 * means a missed edge case is visible in a plain unit test rather than
 * surfacing as "the editor sometimes doesn't open" in production.
 */

/**
 * Maximum age, in milliseconds, a stashed visual-editor open request
 * stays honored after the WS broadcast. Older requests are considered
 * stale — typically left over from a previous app session — and dropped
 * silently rather than surprising the user with a late popup.
 */
export const VISUAL_EDITOR_OPEN_REQUEST_TTL_MS = 5 * 60 * 1000;

/**
 * Decide what the store should do with an incoming `visual_editor_open`
 * WebSocket payload.
 *
 * Contract:
 *   - Returns `{ action: 'stash', request }` when the payload carries the
 *     minimum required fields (`agentId` + `appUrl`). The caller writes
 *     `request` into `state.visualEditorOpenRequest` so the per-agent
 *     hook can consume it when/if the user navigates to that agent.
 *     `timestamp` is baked in so the hook's freshness check has a stable
 *     reference.
 *   - Returns `{ action: 'invalid', reason }` when a required field is
 *     missing — used by the store to log a warning. No state change.
 *
 * Crucially, stashing is NOT gated on whether the user is currently
 * viewing the requesting agent. Previous behavior silently dropped
 * cross-agent events, making the editor unreachable unless the user was
 * already on the matching agent at the moment the broadcast arrived.
 *
 * @param {object}  payload                    The WS event `data` field.
 * @param {string}  payload.agentId
 * @param {string}  payload.appUrl
 * @param {string?} payload.editorUrl
 * @param {object}  [opts]
 * @param {number}  [opts.now=Date.now()]      Injectable clock for tests.
 * @returns {{action: 'stash', request: object} | {action: 'invalid', reason: string}}
 */
export function processVisualEditorOpenMessage(payload, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();

  if (!payload || typeof payload !== 'object') {
    return { action: 'invalid', reason: 'payload-missing' };
  }
  if (!payload.agentId || typeof payload.agentId !== 'string') {
    return { action: 'invalid', reason: 'agentId-missing' };
  }
  if (!payload.appUrl || typeof payload.appUrl !== 'string') {
    return { action: 'invalid', reason: 'appUrl-missing' };
  }

  return {
    action: 'stash',
    request: {
      agentId: payload.agentId,
      appUrl: payload.appUrl,
      editorUrl: payload.editorUrl || null,
      timestamp: now
    }
  };
}

/**
 * Decide what the per-agent hook should do with a stashed open request.
 *
 * Contract:
 *   - `{ action: 'apply' }` when the request is for this agent and fresh
 *     enough (timestamp within TTL window). Caller enables the editor.
 *   - `{ action: 'clear' }` when the request is for this agent but too
 *     old. Caller clears the stash without enabling the editor so the
 *     next broadcast (or navigation) starts clean.
 *   - `{ action: 'ignore' }` when the request isn't for this agent, or
 *     there's no request at all. Caller leaves state untouched.
 *
 * @param {object|null} request                 The stashed request (may be null).
 * @param {string}      agentId                 The hook's owning agent id.
 * @param {object}      [opts]
 * @param {number}      [opts.now=Date.now()]   Injectable clock for tests.
 * @param {number}      [opts.ttlMs]            Override TTL for tests.
 * @returns {{action: 'apply'} | {action: 'clear'} | {action: 'ignore'}}
 */
export function resolveVisualEditorOpenRequest(request, agentId, opts = {}) {
  if (!request) return { action: 'ignore' };
  if (!agentId || request.agentId !== agentId) return { action: 'ignore' };

  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const ttlMs = typeof opts.ttlMs === 'number' ? opts.ttlMs : VISUAL_EDITOR_OPEN_REQUEST_TTL_MS;
  const age = now - (request.timestamp || 0);
  if (age > ttlMs) return { action: 'clear' };

  return { action: 'apply' };
}

export default {
  processVisualEditorOpenMessage,
  resolveVisualEditorOpenRequest,
  VISUAL_EDITOR_OPEN_REQUEST_TTL_MS
};
