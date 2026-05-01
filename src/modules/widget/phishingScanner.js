/**
 * Lightweight phishing-shape detector for agent-generated widget content.
 *
 * NOT a security boundary — the sandbox iframe is. This scanner is a
 * soft UX nudge: when the content asks for credentials or identity data,
 * the frontend bumps the user through a stronger confirmation modal
 * before rendering. It trades off false positives (cheap: one extra
 * click) against missing obvious credential-harvesting shapes.
 *
 * Shared between backend (so we can flag at tool-receive time and log)
 * and frontend (so the modal copy can reference the matched phrase).
 */

const KEYWORDS = [
  // Credentials
  'password', 'passphrase', 'passcode', 'pwd',
  'login', 'log in', 'sign in', 'signin',
  // Second factor / verification
  'otp', 'one-time code', 'one time code',
  '2fa', 'two factor', 'two-factor',
  'verify your identity', 'verify identity',
  'confirm your identity',
  // Financial
  'credit card', 'cvv', 'card number',
  'ssn', 'social security',
  'bank account', 'routing number',
  // Common phishing cover stories
  'account suspended', 'unusual activity',
  'verify account', 'reset your password',
];

/**
 * Scan content for phishing-shape keywords. Returns a list of matched
 * keywords (empty when clean).
 *
 * @param {string} content — raw HTML or JSX source the agent submitted
 * @returns {string[]}
 */
export function scanForPhishingKeywords(content) {
  if (typeof content !== 'string' || !content) return [];
  const haystack = content.toLowerCase();
  const hits = [];
  for (const needle of KEYWORDS) {
    if (haystack.includes(needle)) hits.push(needle);
  }
  return hits;
}
