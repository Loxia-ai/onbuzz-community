/**
 * modeTransitionReasons — single source of truth for why an agent's mode
 * flipped (CHAT ↔ AGENT) and how that reason is surfaced to humans.
 *
 * Each entry is keyed by a stable REASON CODE (string constant used for
 * machine-readable telemetry and back-compat with existing WebSocket
 * broadcasts) and carries a human message template — a plain-English
 * sentence suitable for tooltips, timeline rows in /scheduler, toasts, and
 * the chat-transcript intervention bubble.
 *
 * The `render(reasonCode, detail)` function is the ONLY sanctioned way to
 * turn a code into a human string; do not concatenate reason codes into
 * user-visible strings elsewhere.
 *
 * Pure module. No scheduler / agent dependencies. Easily testable.
 */

/**
 * @typedef {'user-stop'|'user-toggle'|'flow-init'|'ai-request-timeout'|'empty-response-stall'|'loop-detected'|'restore'} ModeTransitionReasonCode
 */

/**
 * Reason catalog. Templates may reference `{count}`, `{elapsed}`,
 * `{occurrences}`, `{windowSize}` and any future detail fields; missing
 * fields fall back to a neutral phrasing so the rendered string stays
 * well-formed even if a caller forgets a detail.
 */
export const MODE_TRANSITION_REASONS = Object.freeze({
  'user-stop':            { template: 'Stopped by user.' },
  'user-toggle':          { template: 'Mode changed via UI toggle.' },
  'flow-init':            { template: 'Switched to Autopilot at the start of a flow run.' },
  'ai-request-timeout':   { template: 'The model stopped responding for {elapsedSec}s — switched to Guided Chat so you can retry or change models.' },
  'empty-response-stall': { template: 'The model returned {count} empty responses in a row over {elapsedSec}s — likely rate-limited, misconfigured, or rejecting the conversation. Switched to Guided Chat.' },
  'loop-detected':        { template: 'The same action repeated {occurrences} times in a {windowSize}-step window — likely stuck. Switched to Guided Chat to break the loop.' },
  'restore':              { template: 'Mode restored from persisted state on startup.' },
});

/**
 * Default phrasing for codes not in the catalog. Keeps the UI from showing
 * bare symbols like `empty_response_stall` if a new code slips in without
 * a catalog entry.
 * @private
 */
function _fallback(code) {
  if (typeof code !== 'string' || code.length === 0) return 'Mode changed.';
  // Turn a symbolic code like `empty-response-stall` into something at least
  // kinda readable: "Mode change (empty response stall)".
  const readable = code.replace(/[-_]+/g, ' ').trim();
  return `Mode change (${readable}).`;
}

/**
 * Replace `{token}` placeholders in a template with values from `detail`.
 * Missing tokens render as "?" so malformed output is visible, not silent.
 * Safe against prototype pollution — only reads own keys of the detail object.
 *
 * @param {string} template
 * @param {Object} detail
 * @returns {string}
 */
function _interpolate(template, detail) {
  if (typeof template !== 'string' || template.length === 0) return '';
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (detail && Object.prototype.hasOwnProperty.call(detail, key) && detail[key] != null) {
      return String(detail[key]);
    }
    return '?';
  });
}

/**
 * Render the human sentence for a given reason code.
 *
 * @param {ModeTransitionReasonCode|string|null|undefined} reasonCode
 * @param {Object} [detail]   Template substitution values
 * @returns {string}          Natural-language reason suitable for the UI.
 *                            Always a non-empty, period-terminated sentence.
 */
export function render(reasonCode, detail = {}) {
  const entry = reasonCode && MODE_TRANSITION_REASONS[reasonCode];
  const template = entry?.template || _fallback(reasonCode);
  const interpolated = _interpolate(template, detail).trim();
  if (interpolated.length === 0) return _fallback(reasonCode);
  // Normalize to always end with a period for consistent UI rendering.
  return /[.!?]$/.test(interpolated) ? interpolated : (interpolated + '.');
}

/**
 * Returns true when the reason code is one the catalog knows about.
 * Useful for tests / static analysis, not required for runtime use.
 */
export function isKnownReasonCode(reasonCode) {
  return typeof reasonCode === 'string'
    && Object.prototype.hasOwnProperty.call(MODE_TRANSITION_REASONS, reasonCode);
}

export default {
  MODE_TRANSITION_REASONS,
  render,
  isKnownReasonCode,
};
