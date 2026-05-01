/**
 * Browser-side mirror of src/modules/widget/phishingScanner.js.
 * Kept as a duplicate (not a shared import) so the two sides of the module
 * boundary stay portable — the backend is ESM Node, the UI is Vite/ESM,
 * and reaching across with a build-time symlink would couple them in a
 * way that defeats the "one-directory removable" goal.
 *
 * If these drift, the agent may render something the UI flags as scary
 * when the backend didn't, or vice versa. The backend's copy is the
 * source of truth for logging/audit; this copy drives the confirmation
 * modal copy. Minor drift is acceptable for MVP.
 */

const KEYWORDS = [
  'password', 'passphrase', 'passcode', 'pwd',
  'login', 'log in', 'sign in', 'signin',
  'otp', 'one-time code', 'one time code',
  '2fa', 'two factor', 'two-factor',
  'verify your identity', 'verify identity', 'confirm your identity',
  'credit card', 'cvv', 'card number',
  'ssn', 'social security',
  'bank account', 'routing number',
  'account suspended', 'unusual activity',
  'verify account', 'reset your password',
];

export function scanForPhishingKeywords(content) {
  if (typeof content !== 'string' || !content) return [];
  const haystack = content.toLowerCase();
  const hits = [];
  for (const needle of KEYWORDS) {
    if (haystack.includes(needle)) hits.push(needle);
  }
  return hits;
}
