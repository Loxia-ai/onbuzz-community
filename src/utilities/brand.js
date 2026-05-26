/**
 * Brand resolver — single-brand build for OnBuzz Community (OSS).
 *
 * Historically this codebase shipped as two npm packages from the same
 * source (Autopilot and OnBuzz). The OSS fork drops the dual-brand
 * scaffolding and serves a single OnBuzz Community identity.
 *
 * Lazy + cached: read once on first call, then memoized. Tests can call
 * `_resetBrandCacheForTests()` to force a re-read with mocked fs.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

let cached = null;

/**
 * @typedef {object} BrandInfo
 * @property {string} binName        always 'onbuzz'
 * @property {string} productName    'OnBuzz Community'
 * @property {string} shortName      'OnBuzz'
 * @property {string} docsUrl        documentation URL
 * @property {string} version        from package.json
 * @property {string} packageName    raw package.json `name`
 * @property {boolean} isAutopilot   always false (legacy field, kept for compat)
 * @property {boolean} isOnBuzz      always true (legacy field, kept for compat)
 */

/**
 * Resolve brand info. Single-brand: always OnBuzz Community.
 * @returns {BrandInfo}
 */
export function getBrand() {
  if (cached) return cached;

  // package.json is two levels above /src/utilities/.
  const pkgPath = path.join(__dirname, '..', '..', 'package.json');
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    // Missing / malformed — fall back to defaults.
  }

  cached = {
    binName:     'onbuzz',
    productName: 'OnBuzz Community',
    shortName:   'OnBuzz',
    docsUrl:     'https://github.com/Loxia-ai/onbuzz-community',
    version:     typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    packageName: typeof pkg.name === 'string' ? pkg.name : 'onbuzz-community',
    isAutopilot: false,
    isOnBuzz:    true,
  };
  return cached;
}

/** Test-only — clear the cache so a subsequent getBrand() re-reads. */
export function _resetBrandCacheForTests() { cached = null; }

export default { getBrand, _resetBrandCacheForTests };
