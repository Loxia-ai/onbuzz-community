/**
 * flowRetry — runs a node attempt with timeout + classified retry.
 *
 * Why a separate module: retry semantics in the executor get tangled
 * fast (per-node config, exponential backoff, attempt history, retry
 * classification, observability). Pulling it out keeps executeAgentNode
 * readable and gives us a tight test surface.
 *
 * Errors carry a `kind` so callers can:
 *   - decide whether to retry (per `retryOn`)
 *   - report which type of failure happened (timeout vs explicit fail)
 *
 * Default kinds:
 *   - 'timeout'         attemptFn didn't finish in timeoutMs
 *   - 'agent-error'     attemptFn threw a plain Error (default classification)
 *   - 'agent-failure'   attemptFn explicitly returned/threw a non-retryable failure
 *                       (caller throws FlowRetryError(msg, 'agent-failure'))
 *
 * Retries don't replay the underlying agent — the attemptFn IS the
 * "do one full agent invocation" closure. That keeps job-done semantics
 * clean: every retry is a fresh agent call.
 */

const DEFAULTS = Object.freeze({
  timeoutMs: 300000,
  maxRetries: 0,
  retryOn: ['timeout', 'agent-error'],
  backoffBaseMs: 1000,
  backoffMultiplier: 2,
});

export class FlowRetryError extends Error {
  constructor(message, kind = 'agent-error') {
    super(message);
    this.name = 'FlowRetryError';
    this.kind = kind;
  }
}

function _withTimeout(promise, ms) {
  let to;
  const timeout = new Promise((_, reject) => {
    to = setTimeout(() => {
      const e = new FlowRetryError(`attempt timed out after ${ms}ms`, 'timeout');
      reject(e);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(to));
}

function _classify(err) {
  if (err instanceof FlowRetryError) return err;
  // Plain Error → agent-error by default
  const wrapped = new FlowRetryError(err?.message || String(err), 'agent-error');
  wrapped.cause = err;
  return wrapped;
}

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @param {(attemptIndex: number) => Promise<any>} attemptFn
 * @param {object} [opts] see DEFAULTS
 * @returns {Promise<{ result, attempts: Array<{ attempt: number, error?: { kind, message } }> }>}
 */
export async function runWithRetry(attemptFn, opts = {}) {
  if (typeof attemptFn !== 'function') {
    throw new TypeError('runWithRetry: attemptFn must be a function');
  }
  const cfg = { ...DEFAULTS, ...opts };
  const attempts = [];
  let lastErr;

  // Total tries = 1 (initial) + maxRetries
  const totalTries = Math.max(1, 1 + (cfg.maxRetries | 0));

  for (let i = 0; i < totalTries; i++) {
    try {
      const result = await _withTimeout(Promise.resolve().then(() => attemptFn(i)), cfg.timeoutMs);
      attempts.push({ attempt: i });
      return { result, attempts };
    } catch (e) {
      const err = _classify(e);
      lastErr = err;
      const isLast = i === totalTries - 1;
      const willRetry = !isLast && cfg.retryOn.includes(err.kind);
      attempts.push({
        attempt: i,
        error: { kind: err.kind, message: err.message },
      });
      if (typeof cfg.onAttempt === 'function') {
        try { cfg.onAttempt({ attempt: i, error: err, willRetry }); } catch { /* observer must not break retry */ }
      }
      if (!willRetry) throw err;
      const wait = Math.round(cfg.backoffBaseMs * Math.pow(cfg.backoffMultiplier, i));
      await _sleep(wait);
    }
  }
  // Defensive — loop above always returns or throws.
  throw lastErr || new FlowRetryError('runWithRetry exhausted unexpectedly');
}

export default { runWithRetry, FlowRetryError };
