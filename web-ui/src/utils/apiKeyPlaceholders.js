/**
 * API-key placeholder detection (web-ui copy — kept in sync with the
 * server-side copy in src/utilities/apiKeyPlaceholders.js).
 *
 * Strips display-only mask strings (bullet characters, "(server-managed)"
 * tags) before they can be persisted as real keys.
 */

export function isPlaceholderApiKey(value) {
  if (typeof value !== 'string' || !value) return false;
  if (value.includes('•')) return true;
  if (value.includes('(server-managed)')) return true;
  if (value.includes('[server-managed]')) return true;
  return false;
}

export function sanitizeApiKeyValue(value) {
  if (typeof value !== 'string') return '';
  return isPlaceholderApiKey(value) ? '' : value;
}

export function sanitizeApiKeysObject(apiKeys) {
  if (!apiKeys || typeof apiKeys !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(apiKeys)) out[k] = sanitizeApiKeyValue(v);
  return out;
}
