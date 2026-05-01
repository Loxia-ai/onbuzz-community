/**
 * Regression tests for the "Converting circular structure to JSON"
 * crash that reached clients. When any caller accidentally passed a
 * tool-execute `context` object (which carries AgentPool ⇄
 * MessageProcessor back-references) into `logger.error('...', { context })`,
 * `JSON.stringify(metadata)` inside the logger exploded.
 *
 * The fix is two-layered:
 *   (1) Callers pluck plain fields (see taskManagerTool.js:578 for the
 *       hot-path one that hit the bug in production).
 *   (2) The logger uses a safe replacer as defence-in-depth — these
 *       tests lock that layer.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

// Stub console + ensure logger config is minimal so formatForConsole
// runs through the safeStringify path without file I/O.
let captured;
beforeEach(() => {
  captured = [];
});

const { Logger } = await import('../logger.js').then(m => ({
  Logger: m.default?.constructor?.name === 'Logger' ? m.default.constructor : m.Logger,
})).catch(async () => {
  // Fallback: logger.js default-exports a class-like or a singleton.
  const mod = await import('../logger.js');
  return { Logger: mod.Logger || mod.default?.constructor };
});

function makeCapturingLogger() {
  const logger = new Logger({
    level: 'debug', file: null, console: true,
  });
  // Intercept console.error/log so we can assert the serialised output
  // without touching stdout.
  const orig = { error: console.error, log: console.log };
  console.error = (...a) => captured.push({ stream: 'err', line: a.join(' ') });
  console.log   = (...a) => captured.push({ stream: 'out', line: a.join(' ') });
  const restore = () => { console.error = orig.error; console.log = orig.log; };
  return { logger, restore };
}

describe('logger safe JSON stringify (defence-in-depth)', () => {
  test('logs with a raw context containing cycles do NOT throw', () => {
    const { logger, restore } = makeCapturingLogger();

    // Build the exact cycle shape that caused the prod crash:
    // AgentPool ⇄ MessageProcessor.
    const pool = { constructor: { name: 'AgentPool' } };
    const mp   = { constructor: { name: 'MessageProcessor' }, agentPool: pool };
    pool.messageProcessor = mp;

    expect(() => {
      logger.error('TaskManager execution failed', {
        error: 'unknown action',
        context: { agentId: 'a1', agentPool: pool, messageProcessor: mp },
        params: { action: 'bogus' },
      });
    }).not.toThrow();

    restore();
    const out = captured.find(c => c.line.includes('TaskManager execution failed'));
    expect(out).toBeTruthy();
  });

  test('back-reference keys render as [ref:ClassName]', () => {
    const { logger, restore } = makeCapturingLogger();
    class AgentPool {}
    const pool = new AgentPool();
    logger.error('test event', { agentPool: pool });

    restore();
    const out = captured.at(-1).line;
    expect(out).toMatch(/agentPool.*\[ref:AgentPool\]/);
  });

  test('non-cycle-key cycles get [circular] sentinel (no crash)', () => {
    const { logger, restore } = makeCapturingLogger();
    const a = { name: 'a' };
    const b = { name: 'b', other: a };
    a.other = b;
    expect(() => logger.error('self-refs', { tree: a })).not.toThrow();
    restore();
    const out = captured.at(-1).line;
    // Exact placement varies with recursion order, but the sentinel
    // must appear somewhere in the serialised payload.
    expect(out).toMatch(/\[circular\]/);
  });

  test('plain objects serialise normally', () => {
    const { logger, restore } = makeCapturingLogger();
    logger.info('ok', { n: 42, s: 'hello', arr: [1, 2, 3] });
    restore();
    const out = captured.at(-1).line;
    expect(out).toContain('42');
    expect(out).toContain('hello');
    expect(out).toContain('[1,2,3]');
  });

  test('all known back-ref keys are filtered', () => {
    const { logger, restore } = makeCapturingLogger();
    const ctx = {
      agentPool: { x: 1 },
      messageProcessor: { x: 2 },
      orchestrator: { x: 3 },
      contextManager: { x: 4 },
      aiService: { x: 5 },
      toolsRegistry: { x: 6 },
      scheduler: { x: 7 },
    };
    // Create a cycle through one of them just to be mean.
    ctx.agentPool.back = ctx;

    expect(() => logger.warn('everything', ctx)).not.toThrow();
    restore();
    const out = captured.at(-1).line;
    // Each back-ref key is replaced with a ref sentinel, not the raw object
    for (const key of ['agentPool', 'messageProcessor', 'orchestrator', 'aiService']) {
      expect(out).toMatch(new RegExp(`"${key}":"\\[ref:`));
    }
  });
});
