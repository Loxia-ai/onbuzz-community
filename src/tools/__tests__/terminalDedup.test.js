/**
 * Tests for the terminal command dedup module.
 *
 * Contract under test:
 *   - Same agent + same command + STILL RUNNING → deny.
 *   - Same agent + same command + PRIOR RUN ENDED → allow.
 *   - Different agents, same command, both running → both allowed.
 *   - force:true with NO prior denial → silently ignored (still denied
 *     if duplicate; allowed if not). The "no first-call abuse" property.
 *   - force:true AFTER a denial of the SAME command → allow + clear token.
 *   - force:true after denial expires → ignored (must be re-denied).
 *   - force:true after a denial of a DIFFERENT command → ignored.
 *   - Whitespace + CRLF normalization.
 *   - Per-agent config opt-out short-circuits the whole check.
 */

import { describe, test, expect } from '@jest/globals';
import {
  checkDedup, normalizeCommand, findRunningDuplicate, FORCE_TOKEN_TTL_MS,
} from '../terminalDedup.js';
import { TERMINAL_CONFIG } from '../../utilities/constants.js';

const RUNNING = TERMINAL_CONFIG.STATES.RUNNING;
const COMPLETED = TERMINAL_CONFIG.STATES.COMPLETED;
const FAILED = TERMINAL_CONFIG.STATES.FAILED;

function trackerWith(...entries) {
  const m = new Map();
  for (const e of entries) {
    m.set(e.commandId, {
      commandId:        e.commandId,
      agentId:          e.agentId,
      command:          e.command,
      state:            e.state ?? RUNNING,
      startTime:        e.startTime ?? new Date(Date.now() - 5000).toISOString(),
      workingDirectory: e.workingDirectory ?? '/tmp',
    });
  }
  return m;
}

describe('normalizeCommand', () => {
  test('trims surrounding whitespace', () => {
    expect(normalizeCommand('  npm test  ')).toBe('npm test');
  });
  test('normalizes CRLF to LF', () => {
    expect(normalizeCommand('echo a\r\necho b')).toBe('echo a\necho b');
  });
  test('preserves internal whitespace', () => {
    expect(normalizeCommand('npm  test')).toBe('npm  test');
  });
  test('non-string → empty string (defensive)', () => {
    expect(normalizeCommand(42)).toBe('');
    expect(normalizeCommand(null)).toBe('');
    expect(normalizeCommand(undefined)).toBe('');
  });
});

describe('findRunningDuplicate', () => {
  test('matches same agent + same command + RUNNING', () => {
    const t = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test' });
    expect(findRunningDuplicate(t, 'a', 'npm test')?.commandId).toBe('c1');
  });
  test('does NOT match a different agent', () => {
    const t = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test' });
    expect(findRunningDuplicate(t, 'b', 'npm test')).toBeNull();
  });
  test('does NOT match a finished command (COMPLETED)', () => {
    const t = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test', state: COMPLETED });
    expect(findRunningDuplicate(t, 'a', 'npm test')).toBeNull();
  });
  test('does NOT match a finished command (FAILED)', () => {
    const t = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test', state: FAILED });
    expect(findRunningDuplicate(t, 'a', 'npm test')).toBeNull();
  });
  test('matches across whitespace differences (normalization)', () => {
    const t = trackerWith({ commandId: 'c1', agentId: 'a', command: '  npm test  ' });
    expect(findRunningDuplicate(t, 'a', 'npm test')?.commandId).toBe('c1');
  });
});

describe('checkDedup — basic allow/deny', () => {
  test('no duplicate running → allow', () => {
    const r = checkDedup({
      commandTracker: trackerWith(),
      lastDeniedExec: new Map(),
      agentId: 'a',
      command: 'npm test',
    });
    expect(r.allow).toBe(true);
  });

  test('duplicate running for same agent → deny + records token', () => {
    const tracker = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test' });
    const tokens = new Map();
    const r = checkDedup({
      commandTracker: tracker,
      lastDeniedExec: tokens,
      agentId: 'a',
      command: 'npm test',
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('duplicate-running');
    expect(r.hint).toMatch(/force:true/);
    expect(r.status.commandId).toBe('c1');
    expect(r.status.command).toBe('npm test');
    expect(r.status.state).toBe(RUNNING);
    expect(r.status.elapsedSec).toBeGreaterThanOrEqual(0);
    // Token recorded for THIS agent + command
    expect(tokens.get('a')).toMatchObject({ command: 'npm test' });
  });

  test('different agents same command → both allowed', () => {
    const tracker = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test' });
    const tokens = new Map();
    const r = checkDedup({
      commandTracker: tracker,
      lastDeniedExec: tokens,
      agentId: 'b',          // different agent
      command: 'npm test',
    });
    expect(r.allow).toBe(true);
    expect(tokens.size).toBe(0);
  });

  test('completed prior run → allowed (no-op)', () => {
    const tracker = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test', state: COMPLETED });
    const r = checkDedup({
      commandTracker: tracker,
      lastDeniedExec: new Map(),
      agentId: 'a',
      command: 'npm test',
    });
    expect(r.allow).toBe(true);
  });
});

describe('checkDedup — force:true semantics (the abuse-prevention property)', () => {
  test('force:true with NO prior denial → still denied (record token)', () => {
    // First-ever call with force:true must NOT bypass anything. The flag
    // is only meaningful as a response to a denial.
    const tracker = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test' });
    const tokens = new Map();
    const r = checkDedup({
      commandTracker: tracker,
      lastDeniedExec: tokens,
      agentId: 'a',
      command: 'npm test',
      force: true,
    });
    expect(r.allow).toBe(false);
    expect(tokens.has('a')).toBe(true);
  });

  test('force:true with NO duplicate running → allowed (force is silently ignored)', () => {
    // Important: agents that always pass force should behave identically
    // to agents that never pass it when there is no conflict. Otherwise
    // force would become "permission to skip dedup permanently."
    const tokens = new Map();
    const r = checkDedup({
      commandTracker: trackerWith(),
      lastDeniedExec: tokens,
      agentId: 'a',
      command: 'npm test',
      force: true,
    });
    expect(r.allow).toBe(true);
    expect(tokens.size).toBe(0);
  });

  test('force:true AFTER a matching denial → allowed + token consumed', () => {
    const tracker = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test' });
    const tokens = new Map();
    // First call: denied.
    checkDedup({ commandTracker: tracker, lastDeniedExec: tokens, agentId: 'a', command: 'npm test' });
    expect(tokens.has('a')).toBe(true);
    // Second call WITH force: allowed, token consumed.
    const r = checkDedup({
      commandTracker: tracker,
      lastDeniedExec: tokens,
      agentId: 'a',
      command: 'npm test',
      force: true,
    });
    expect(r.allow).toBe(true);
    expect(tokens.has('a')).toBe(false);    // single-use
  });

  test('force:true after denial expires → still denied (token TTL exceeded)', () => {
    const tracker = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test' });
    const t0 = 1_000_000;
    const tokens = new Map();
    checkDedup({ commandTracker: tracker, lastDeniedExec: tokens, agentId: 'a', command: 'npm test', now: t0 });
    // Force long after the TTL expired.
    const tLate = t0 + FORCE_TOKEN_TTL_MS + 1;
    const r = checkDedup({
      commandTracker: tracker,
      lastDeniedExec: tokens,
      agentId: 'a',
      command: 'npm test',
      force: true,
      now: tLate,
    });
    expect(r.allow).toBe(false);
  });

  test('force:true after denial of a DIFFERENT command → ignored (denied as fresh)', () => {
    // Agent was denied for "npm test" earlier. Now sends force:true with
    // "npm build" — different command. The token doesn't apply; force
    // is ignored; npm-build is denied because it's also already running.
    const tracker = trackerWith(
      { commandId: 'c1', agentId: 'a', command: 'npm test' },
      { commandId: 'c2', agentId: 'a', command: 'npm build' },
    );
    const tokens = new Map();
    checkDedup({ commandTracker: tracker, lastDeniedExec: tokens, agentId: 'a', command: 'npm test' });
    const r = checkDedup({
      commandTracker: tracker,
      lastDeniedExec: tokens,
      agentId: 'a',
      command: 'npm build',     // different command
      force: true,
    });
    expect(r.allow).toBe(false);   // force not honored across commands
  });

  test('the spam-force exploit: force on every single call doesn\'t bypass dedup', () => {
    // Adversarial agent: passes force:true on EVERY call. Confirm that
    // dedup still kicks in on duplicates and the agent can't sneak past.
    const tracker = trackerWith({ commandId: 'c1', agentId: 'a', command: 'rm -rf node_modules' });
    const tokens = new Map();
    // First call (with force) — should be denied because no prior denial.
    let r = checkDedup({ commandTracker: tracker, lastDeniedExec: tokens, agentId: 'a', command: 'rm -rf node_modules', force: true });
    expect(r.allow).toBe(false);
    // Second call (still with force) — token EXISTS now, so this one IS allowed.
    // That's the legitimate retry path. The exploit fails on the first call.
    r = checkDedup({ commandTracker: tracker, lastDeniedExec: tokens, agentId: 'a', command: 'rm -rf node_modules', force: true });
    expect(r.allow).toBe(true);
    // Critical: the agent had to be denied at least once before force worked.
    // Spamming force from the start gains nothing on the first call.
  });
});

describe('checkDedup — config opt-out', () => {
  test('config.denyDuplicateConcurrentCommands === false → always allow', () => {
    const tracker = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test' });
    const r = checkDedup({
      commandTracker: tracker,
      lastDeniedExec: new Map(),
      agentId: 'a',
      command: 'npm test',
      config: { denyDuplicateConcurrentCommands: false },
    });
    expect(r.allow).toBe(true);
  });

  test('config.denyDuplicateConcurrentCommands === true (default) → enforced', () => {
    const tracker = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test' });
    const r = checkDedup({
      commandTracker: tracker,
      lastDeniedExec: new Map(),
      agentId: 'a',
      command: 'npm test',
      config: { denyDuplicateConcurrentCommands: true },
    });
    expect(r.allow).toBe(false);
  });

  test('config absent → enforced (default behavior)', () => {
    const tracker = trackerWith({ commandId: 'c1', agentId: 'a', command: 'npm test' });
    const r = checkDedup({
      commandTracker: tracker,
      lastDeniedExec: new Map(),
      agentId: 'a',
      command: 'npm test',
    });
    expect(r.allow).toBe(false);
  });
});

describe('checkDedup — defensive guards', () => {
  test('missing agentId → allow', () => {
    expect(checkDedup({
      commandTracker: trackerWith({ commandId: 'c1', agentId: 'a', command: 'x' }),
      lastDeniedExec: new Map(),
      agentId: '',
      command: 'x',
    }).allow).toBe(true);
  });

  test('empty/whitespace command → allow (no fingerprint to match)', () => {
    expect(checkDedup({
      commandTracker: trackerWith({ commandId: 'c1', agentId: 'a', command: '' }),
      lastDeniedExec: new Map(),
      agentId: 'a',
      command: '   ',
    }).allow).toBe(true);
  });
});

describe('time-varying commands naturally pass dedup', () => {
  test('commands with $(date) substitutions get unique strings → not deduped', () => {
    // `echo $(date)` — the command STRING itself differs by timestamp
    // when the agent generates them; even if it doesn't, our exact-match
    // policy means the agent has to deliberately re-issue the same
    // string. This is the documented behavior, not a bug.
    const tracker = trackerWith({ commandId: 'c1', agentId: 'a', command: 'echo $(date)' });
    const r = checkDedup({
      commandTracker: tracker,
      lastDeniedExec: new Map(),
      agentId: 'a',
      command: 'echo $(date)',     // exact-match — IS deduped
    });
    expect(r.allow).toBe(false);   // exact match → deduped
    // But a different invocation:
    const r2 = checkDedup({
      commandTracker: tracker,
      lastDeniedExec: new Map(),
      agentId: 'a',
      command: 'echo "now: $(date)"',
    });
    expect(r2.allow).toBe(true);   // different string → allowed
  });
});
