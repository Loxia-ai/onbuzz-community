/**
 * API-key placeholder detection — shared between server-side persistence
 * (`apiKeyManager`) and the web UI's settings flow.
 *
 * The UI may display masked-out forms of a stored key (bullet strings,
 * "(server-managed)" tags, etc.) so the user can see "yes, a key is set"
 * without exposing the actual value. If those display strings ever flow
 * back through a save, we strip them — they're never valid API keys.
 */

/**
 * Heuristic: does this value look like a placeholder rather than a real key?
 * Real keys are alphanumeric + a few punctuation chars; placeholders contain
 * bullets or "(server-managed)" / "[server-managed]" tags.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isPlaceholderApiKey(value) {
  if (typeof value !== 'string' || !value) return false;
  if (value.includes('•')) return true;
  if (value.includes('(server-managed)')) return true;
  if (value.includes('[server-managed]')) return true;
  return false;
}

/**
 * Strip a placeholder, returning '' if the value isn't a real key. Real
 * keys pass through unchanged. Non-strings collapse to ''.
 *
 * @param {string|*} value
 * @returns {string}
 */
export function sanitizeApiKeyValue(value) {
  if (typeof value !== 'string') return '';
  return isPlaceholderApiKey(value) ? '' : value;
}

/**
 * Sanitize an entire `apiKeys` object. Returns a new object with
 * placeholder values replaced by ''. Does not mutate the input.
 *
 * @param {Object|null|undefined} apiKeys
 * @returns {Object}
 */
export function sanitizeApiKeysObject(apiKeys) {
  if (!apiKeys || typeof apiKeys !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(apiKeys)) out[k] = sanitizeApiKeyValue(v);
  return out;
}
