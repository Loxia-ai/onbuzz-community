/**
 * flowRetry — runs a node-attempt function with timeout + retry.
 *
 * Why pull this out: retry semantics and exponential backoff have a lot
 * of edge cases (max attempts, retry-only-on-timeout, attempt-count
 * tracking, onAttempt callbacks for observability). Embedding all of
 * this in executeAgentNode would bury the logic; isolating it keeps
 * the executor short and lets us hammer the retry rules in tests.
 *
 * Contract:
 *   runWithRetry(attemptFn, opts) → { result, attempts: [...] }
 *
 *   - attemptFn(attemptIndex) returns a promise
 *   - opts.timeoutMs            per-attempt timeout (default 5min)
 *   - opts.maxRetries           additional tries beyond the first (default 0)
 *   - opts.retryOn              which errors trigger retry (default ['timeout','agent-error'])
 *   - opts.backoffBaseMs        base delay (default 1000)
 *   - opts.backoffMultiplier    exponential factor (default 2)
 *   - opts.onAttempt(meta)      called with { attempt, error?, willRetry } between attempts
 *
 * Errors throw with a `.kind` field that retryOn can match. attemptFn
 * may also throw plain errors — those classified as 'agent-error'.
 */

import { jest, describe, test, expect } from '@jest/globals';
import { runWithRetry, FlowRetryError } from '../flowRetry.js';

describe('runWithRetry — happy path', () => {
  test('returns result on first success without retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const r = await runWithRetry(fn, { maxRetries: 3, timeoutMs: 1000 });
    expect(r.result).toBe('ok');
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0].error).toBeUndefined();
  });

  test('passes the attempt index (0-based) to attemptFn', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await runWithRetry(fn, { maxRetries: 2, timeoutMs: 500 });
    expect(fn).toHaveBeenCalledWith(0);
  });
});

describe('runWithRetry — timeout', () => {
  test('throws timeout when attemptFn exceeds timeoutMs (no retries)', async () => {
    const fn = () => new Promise(() => {});  // never resolves
    await expect(runWithRetry(fn, { maxRetries: 0, timeoutMs: 50 }))
      .rejects.toMatchObject({ kind: 'timeout' });
  });

  test('retries on timeout up to maxRetries, then succeeds', async () => {
    let calls = 0;
    const fn = () => new Promise((resolve) => {
      calls++;
      if (calls < 3) return; // first 2 hang
      resolve('eventually');
    });
    const r = await runWithRetry(fn, {
      maxRetries: 3, timeoutMs: 30, backoffBaseMs: 1, backoffMultiplier: 1,
    });
    expect(r.result).toBe('eventually');
    expect(r.attempts).toHaveLength(3);
    expect(r.attempts[0].error.kind).toBe('timeout');
    expect(r.attempts[1].error.kind).toBe('timeout');
    expect(r.attempts[2].error).toBeUndefined();
  });

  test('exhausts retries on persistent timeout', async () => {
    const fn = () => new Promise(() => {});
    await expect(runWithRetry(fn, {
      maxRetries: 2, timeoutMs: 20, backoffBaseMs: 1, backoffMultiplier: 1,
    })).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('runWithRetry — agent-error', () => {
  test('retries on plain thrown errors (classified as agent-error)', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls < 2) throw new Error('boom');
      return Promise.resolve('ok');
    };
    const r = await runWithRetry(fn, {
      maxRetries: 2, timeoutMs: 500, backoffBaseMs: 1, backoffMultiplier: 1,
    });
    expect(r.result).toBe('ok');
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[0].error.kind).toBe('agent-error');
    expect(r.attempts[0].error.message).toBe('boom');
  });

  test('does NOT retry when retryOn excludes agent-error', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(runWithRetry(fn, {
      maxRetries: 5, timeoutMs: 500, retryOn: ['timeout'],
      backoffBaseMs: 1, backoffMultiplier: 1,
    })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('preserves the kind on FlowRetryError when fed back through', async () => {
    const fn = () => Promise.reject(new FlowRetryError('explicit', 'agent-failure'));
    await expect(runWithRetry(fn, {
      maxRetries: 0, timeoutMs: 100, retryOn: ['timeout'],
    })).rejects.toMatchObject({ kind: 'agent-failure', message: 'explicit' });
  });
});

describe('runWithRetry — backoff timing', () => {
  test('waits backoffBaseMs * multiplier^attempt between retries', async () => {
    const onAttempt = jest.fn();
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls < 3) throw new Error('fail');
      return Promise.resolve('ok');
    };
    const t0 = Date.now();
    await runWithRetry(fn, {
      maxRetries: 3, timeoutMs: 200,
      backoffBaseMs: 30, backoffMultiplier: 2,
      onAttempt,
    });
    const elapsed = Date.now() - t0;
    // Backoffs: after attempt 0 (failed) wait ~30ms, after 1 (failed) wait ~60ms.
    // Total ≥ 90ms, allow generous slack for CI.
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(onAttempt).toHaveBeenCalledTimes(2); // only "between" attempts (not the final success)
  });
});

describe('runWithRetry — defensive', () => {
  test('maxRetries=0 means exactly one attempt', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('one shot'));
    await expect(runWithRetry(fn, { maxRetries: 0, timeoutMs: 100 }))
      .rejects.toThrow('one shot');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('non-function attemptFn throws synchronously', async () => {
    await expect(runWithRetry(null)).rejects.toThrow();
    await expect(runWithRetry('nope')).rejects.toThrow();
  });
});
