/**
 * Unit tests for the pure visual-editor message helpers.
 *
 * These cover the two behaviors whose previous bugs surfaced in the UI as
 * "the editor never opens on its own, only works when I type the URL
 * manually":
 *   1. `processVisualEditorOpenMessage` must stash EVERY valid payload,
 *      not silently drop cross-agent ones.
 *   2. `resolveVisualEditorOpenRequest` must apply fresh requests,
 *      garbage-collect stale ones, and ignore everything else.
 *
 * Both helpers are pure so the tests have no React, no Zustand, and no
 * timers — just value in, decision out.
 */

// vitest provides `describe`, `test`, `expect` as globals via the
// `test.globals: true` setting in vite.config.js — no explicit imports
// needed. Keeping the helper tests in the web-ui tree (rather than
// duplicating them under the CLI's Jest harness) means they run in the
// same environment as the store/hook they back.
import {
  processVisualEditorOpenMessage,
  resolveVisualEditorOpenRequest,
  VISUAL_EDITOR_OPEN_REQUEST_TTL_MS
} from '../visualEditorMessage.js';

// ─────────────────── processVisualEditorOpenMessage ─────────────────────────

describe('processVisualEditorOpenMessage()', () => {
  test('stashes request unconditionally for a valid payload', () => {
    const out = processVisualEditorOpenMessage({
      agentId: 'a1',
      appUrl: 'http://localhost:3000',
      editorUrl: 'http://localhost:4000?agentId=a1'
    }, { now: 1000 });

    expect(out).toEqual({
      action: 'stash',
      request: {
        agentId: 'a1',
        appUrl: 'http://localhost:3000',
        editorUrl: 'http://localhost:4000?agentId=a1',
        timestamp: 1000
      }
    });
  });

  test('stashes even when editorUrl is omitted (it is optional)', () => {
    const out = processVisualEditorOpenMessage({
      agentId: 'a1',
      appUrl: 'http://localhost:3000'
    }, { now: 42 });
    expect(out.action).toBe('stash');
    expect(out.request.editorUrl).toBeNull();
    expect(out.request.timestamp).toBe(42);
  });

  test('REGRESSION: stashes regardless of which agent is currently selected', () => {
    // Previous bug dropped the event when data.agentId !== currentAgentId.
    // The helper is intentionally stateless — it does NOT take a
    // currentAgentId — so the "always stash" contract is structural and
    // cannot silently regress.
    const out = processVisualEditorOpenMessage({
      agentId: 'a-not-selected',
      appUrl: 'http://localhost:3000'
    });
    expect(out.action).toBe('stash');
    expect(out.request.agentId).toBe('a-not-selected');
  });

  test('rejects payload with missing agentId', () => {
    const out = processVisualEditorOpenMessage({ appUrl: 'http://x' });
    expect(out).toEqual({ action: 'invalid', reason: 'agentId-missing' });
  });

  test('rejects payload with non-string agentId', () => {
    const out = processVisualEditorOpenMessage({ agentId: 42, appUrl: 'http://x' });
    expect(out.action).toBe('invalid');
    expect(out.reason).toBe('agentId-missing');
  });

  test('rejects payload with missing appUrl', () => {
    const out = processVisualEditorOpenMessage({ agentId: 'a1' });
    expect(out).toEqual({ action: 'invalid', reason: 'appUrl-missing' });
  });

  test('rejects null / non-object payloads', () => {
    expect(processVisualEditorOpenMessage(null).action).toBe('invalid');
    expect(processVisualEditorOpenMessage(undefined).action).toBe('invalid');
    expect(processVisualEditorOpenMessage('string').action).toBe('invalid');
    expect(processVisualEditorOpenMessage(42).action).toBe('invalid');
  });

  test('uses Date.now() when opts.now is not provided', () => {
    const before = Date.now();
    const out = processVisualEditorOpenMessage({ agentId: 'a1', appUrl: 'http://x' });
    const after = Date.now();
    expect(out.action).toBe('stash');
    expect(out.request.timestamp).toBeGreaterThanOrEqual(before);
    expect(out.request.timestamp).toBeLessThanOrEqual(after);
  });
});

// ─────────────────── resolveVisualEditorOpenRequest ─────────────────────────

describe('resolveVisualEditorOpenRequest()', () => {
  const req = (overrides = {}) => ({
    agentId: 'a1',
    appUrl: 'http://x',
    editorUrl: null,
    timestamp: 1_000_000,
    ...overrides
  });

  test('ignores when no request is stashed', () => {
    expect(resolveVisualEditorOpenRequest(null, 'a1')).toEqual({ action: 'ignore' });
    expect(resolveVisualEditorOpenRequest(undefined, 'a1')).toEqual({ action: 'ignore' });
  });

  test('ignores when request belongs to a different agent', () => {
    // This is how the hook gates per-agent: same stash, different hooks,
    // only the matching one acts. Other hooks ignore — they don't clear
    // the stash or enable the editor.
    expect(resolveVisualEditorOpenRequest(req(), 'a2')).toEqual({ action: 'ignore' });
  });

  test('ignores when agentId is empty/missing on the hook side', () => {
    expect(resolveVisualEditorOpenRequest(req(), null)).toEqual({ action: 'ignore' });
    expect(resolveVisualEditorOpenRequest(req(), '')).toEqual({ action: 'ignore' });
    expect(resolveVisualEditorOpenRequest(req(), undefined)).toEqual({ action: 'ignore' });
  });

  test('applies when request is fresh (within TTL) and matches agent', () => {
    const now = 1_000_000 + 60_000; // 1 min after request
    expect(resolveVisualEditorOpenRequest(req(), 'a1', { now })).toEqual({ action: 'apply' });
  });

  test('applies when request is exactly at the TTL boundary', () => {
    // Requests older than TTL should clear; at-exactly-TTL is still fresh.
    const now = 1_000_000 + VISUAL_EDITOR_OPEN_REQUEST_TTL_MS;
    expect(resolveVisualEditorOpenRequest(req(), 'a1', { now })).toEqual({ action: 'apply' });
  });

  test('clears when request is older than TTL', () => {
    const now = 1_000_000 + VISUAL_EDITOR_OPEN_REQUEST_TTL_MS + 1;
    expect(resolveVisualEditorOpenRequest(req(), 'a1', { now })).toEqual({ action: 'clear' });
  });

  test('honors opts.ttlMs override (useful for custom expiration)', () => {
    const now = 1_000_000 + 100;
    expect(resolveVisualEditorOpenRequest(req(), 'a1', { now, ttlMs: 50 }))
      .toEqual({ action: 'clear' });
    expect(resolveVisualEditorOpenRequest(req(), 'a1', { now, ttlMs: 500 }))
      .toEqual({ action: 'apply' });
  });

  test('uses Date.now() when opts.now is not provided (smoke test)', () => {
    const freshReq = req({ timestamp: Date.now() });
    expect(resolveVisualEditorOpenRequest(freshReq, 'a1')).toEqual({ action: 'apply' });
  });

  test('treats a request with missing timestamp as infinitely old (clear)', () => {
    // Defensive: a payload that somehow lost its timestamp should not
    // stick around masquerading as fresh forever.
    const reqNoTs = { agentId: 'a1', appUrl: 'http://x' }; // no timestamp
    expect(resolveVisualEditorOpenRequest(reqNoTs, 'a1', { now: Date.now() }))
      .toEqual({ action: 'clear' });
  });
});
