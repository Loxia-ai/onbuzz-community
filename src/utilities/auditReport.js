/**
 * auditReport — classify and summarize `npm audit --json` findings.
 *
 * Goal: turn an opaque 44-line audit table into an actionable triage
 * list — per-vuln "bucket + recommendation + confidence" so the release
 * operator knows which findings need human decisions and which will
 * resolve mechanically.
 *
 * Buckets:
 *   'direct-auto'     — top-level dep, fix within compatible semver.
 *                        `npm audit fix` handles it, no breaking change.
 *   'direct-breaking' — top-level dep, fix requires a new major.
 *                        Targeted upgrade + likely code changes.
 *   'direct-orphan'   — top-level dep, no fix known anywhere.
 *                        Replace the dep or accept risk.
 *   'transitive-auto' — pulled in by something we depend on, fix ships
 *                        through `npm audit fix`. Mechanical.
 *   'transitive-needs-parent-bump' — pulled in transitively but the
 *                        fix requires a NEW major of a direct dep.
 *                        Deliberate upgrade of the parent.
 *   'transitive-orphan' — no parent release carries the fix. Options:
 *                        `overrides` in package.json, replace the parent
 *                        dep, or accept + mitigate.
 *   'unknown'         — audit JSON shape we didn't anticipate.
 *                        Reported as-is so nothing silently disappears.
 *
 * Pure module: takes parsed `npm audit --json` as input, returns
 * structured classification. No fs, no network, no child_process.
 */

/**
 * Curated alternatives map for deps that are commonly orphaned /
 * deprecated / chronically vulnerable. This is the judgment layer — the
 * script uses it to suggest an alternative when a vuln lands on one of
 * these packages. It's data-not-code so it can grow without touching
 * the classifier.
 *
 * Each entry:
 *   replacement   : npm package that solves the same problem
 *   note          : one-line justification / migration hint
 *   confidence    : 'high' (drop-in), 'medium' (minor API changes),
 *                    'low' (design review needed)
 */
export const ALTERNATIVES = Object.freeze({
  // The "deprecated HTTP clients" cohort
  request:           { replacement: 'undici (built-in Node fetch also works)', note: 'request was archived 2020; undici is Node\'s official HTTP client', confidence: 'medium' },
  'request-promise': { replacement: 'undici / fetch', note: 'Same as `request`; any `request-*` sub-package is end-of-life', confidence: 'medium' },
  'request-promise-native': { replacement: 'undici / fetch', note: 'Same family; end-of-life', confidence: 'medium' },

  // Deprecated file/glob/fs family
  inflight:          { replacement: 'lru-cache + Promise coalescing (or remove — usually pulled in by older glob)', note: 'Memory-leaky, unmaintained. Usually a transitive; upgrading glob fixes it.', confidence: 'high' },
  glob:              { replacement: 'upgrade to glob@>=9 (drops inflight)', note: 'glob v7/v8 pull in deprecated inflight; v9+ rewrote that path', confidence: 'high' },
  rimraf:            { replacement: 'fs.rm (node >=14) or rimraf@>=4', note: 'Old rimraf pulls glob@7 → inflight. Modern rimraf or native fs.rm resolves the chain.', confidence: 'high' },
  lodash:            { replacement: 'lodash-es (tree-shakable) or native JS', note: 'Lodash itself is fine; lodash.<fn> split packages are often stale. Prefer per-need native.', confidence: 'medium' },

  // XML / template libs that keep shipping vulns
  '@xmldom/xmldom':  { replacement: 'fast-xml-parser or sax', note: '@xmldom/xmldom has a recurring XXE/injection track record', confidence: 'medium' },
  xmldom:            { replacement: 'fast-xml-parser', note: 'Unmaintained upstream; @xmldom/xmldom is the fork but still vulnerable', confidence: 'medium' },

  // Legacy parsers
  minimist:          { replacement: 'yargs-parser or node\'s built-in util.parseArgs (>=18.3)', note: 'minimist has had multiple prototype-pollution CVEs', confidence: 'high' },
  yargs:             { replacement: 'yargs@>=17 or util.parseArgs', note: 'Old yargs pulls vulnerable minimist; modern yargs is fine', confidence: 'high' },

  // Testing stack
  'esbuild-jest':    { replacement: '@swc/jest or vitest', note: 'esbuild-jest is effectively abandoned; @swc/jest has the same shape', confidence: 'medium' },

  // Dev-tool pyramid known to drag vulns
  webpack:           { replacement: 'upgrade to webpack@>=5.94 OR swap to vite/rollup', note: 'webpack 4 is EOL; many indirect advisories trace to it', confidence: 'medium' },
});

/**
 * Get an alternatives-map entry for a package name, or null.
 * @param {string} pkgName
 * @returns {{ replacement: string, note: string, confidence: 'high'|'medium'|'low' } | null}
 */
export function getAlternative(pkgName) {
  return ALTERNATIVES[pkgName] || null;
}

/**
 * Classify a single vulnerability entry from `npm audit --json`.
 *
 * @param {Object} vulnName        The key in audit.vulnerabilities (pkg name)
 * @param {Object} vuln            The vulnerabilities[name] value
 * @returns {{
 *   name: string,
 *   severity: 'info'|'low'|'moderate'|'high'|'critical',
 *   bucket: 'direct-auto'|'direct-breaking'|'direct-orphan'|'transitive-auto'|'transitive-needs-parent-bump'|'transitive-orphan'|'unknown',
 *   isDirect: boolean,
 *   fixHint: string,              Human one-liner describing the mechanical fix (if any)
 *   advisories: Array<{ title: string, url: string, cvss?: number, cwe?: string[] }>,
 *   paths: string[],              node_modules paths where this vuln lives
 *   effects: string[],            downstream packages affected
 *   vulnerableRange: string,      the vulnerable semver range
 *   alternative: { replacement: string, note: string, confidence: string } | null,
 * }}
 */
export function classifyVulnerability(vulnName, vuln) {
  const name = vulnName || vuln?.name || '(unknown)';
  const severity = vuln?.severity || 'unknown';
  const isDirect = !!vuln?.isDirect;
  const fix = vuln?.fixAvailable;

  // Extract advisories from `via` entries that are objects (others are
  // string package refs pointing at other vulns — not advisories).
  const advisories = Array.isArray(vuln?.via)
    ? vuln.via
        .filter(v => v && typeof v === 'object')
        .map(v => ({
          title: v.title || '(no title)',
          url: v.url || '',
          cvss: v.cvss?.score ?? null,
          cwe: Array.isArray(v.cwe) ? v.cwe : [],
        }))
    : [];

  let bucket = 'unknown';
  let fixHint = '';

  if (fix === true) {
    // npm can apply the fix within semver range
    bucket = isDirect ? 'direct-auto' : 'transitive-auto';
    fixHint = 'Run `npm audit fix`';
  } else if (fix === false || fix == null) {
    // No known fix anywhere
    bucket = isDirect ? 'direct-orphan' : 'transitive-orphan';
    fixHint = isDirect
      ? 'No fix available — consider replacing the dep or using `overrides`'
      : 'No fix in any parent release — use `overrides` in package.json or replace the parent dep';
  } else if (typeof fix === 'object' && fix !== null) {
    // Object form: { name, version, isSemVerMajor }
    const targetName = fix.name || '(unknown)';
    const targetVer = fix.version ? `@${fix.version}` : '';
    if (fix.isSemVerMajor) {
      bucket = isDirect ? 'direct-breaking' : 'transitive-needs-parent-bump';
      fixHint = `Breaking upgrade: \`npm install ${targetName}${targetVer}\` (major bump — re-test)`;
    } else {
      // Non-major forced upgrade of a direct dep
      bucket = isDirect ? 'direct-auto' : 'transitive-auto';
      fixHint = `Targeted upgrade: \`npm install ${targetName}${targetVer}\``;
    }
  }

  return {
    name,
    severity,
    bucket,
    isDirect,
    fixHint,
    advisories,
    paths: Array.isArray(vuln?.nodes) ? vuln.nodes : [],
    effects: Array.isArray(vuln?.effects) ? vuln.effects : [],
    vulnerableRange: vuln?.range || '',
    alternative: getAlternative(name),
  };
}

/**
 * Classify an entire `npm audit --json` payload.
 *
 * @param {Object} auditJson  Parsed output of `npm audit --json`
 * @returns {{
 *   summary: { total: number, bySeverity: Object, byBucket: Object },
 *   findings: Array<ReturnType<classifyVulnerability>>,
 * }}
 */
export function classifyAudit(auditJson) {
  const vulns = auditJson?.vulnerabilities || {};
  const findings = Object.entries(vulns)
    .map(([name, v]) => classifyVulnerability(name, v));

  // Ordered by severity descending so the operator reads worst first.
  const SEV_ORDER = { critical: 0, high: 1, moderate: 2, low: 3, info: 4, unknown: 5 };
  findings.sort((a, b) => {
    const s = (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9);
    if (s !== 0) return s;
    return a.name.localeCompare(b.name);
  });

  const bySeverity = { critical: 0, high: 0, moderate: 0, low: 0, info: 0, unknown: 0 };
  const byBucket = {
    'direct-auto': 0, 'direct-breaking': 0, 'direct-orphan': 0,
    'transitive-auto': 0, 'transitive-needs-parent-bump': 0, 'transitive-orphan': 0,
    'unknown': 0,
  };
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byBucket[f.bucket] = (byBucket[f.bucket] || 0) + 1;
  }

  return {
    summary: { total: findings.length, bySeverity, byBucket },
    findings,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Markdown rendering
// ────────────────────────────────────────────────────────────────────────

const BUCKET_TITLES = {
  'direct-auto':                'Direct · auto-fixable',
  'direct-breaking':            'Direct · breaking upgrade required',
  'direct-orphan':              'Direct · no fix available',
  'transitive-auto':            'Transitive · auto-fixable',
  'transitive-needs-parent-bump': 'Transitive · needs major bump of a direct dep',
  'transitive-orphan':          'Transitive · no fix anywhere',
  'unknown':                    'Unclassified',
};

const BUCKET_ORDER = [
  'direct-orphan',
  'direct-breaking',
  'transitive-orphan',
  'transitive-needs-parent-bump',
  'direct-auto',
  'transitive-auto',
  'unknown',
];

/**
 * Render a classified audit result as a Markdown report.
 *
 * @param {ReturnType<classifyAudit>} classified
 * @param {{ workspace?: string }} [options]   Workspace label shown in header
 * @returns {string} Markdown string
 */
export function renderMarkdown(classified, options = {}) {
  const { summary, findings } = classified;
  const wsLabel = options.workspace ? ` — \`${options.workspace}\`` : '';

  const lines = [];
  lines.push(`# Dependency audit report${wsLabel}`);
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`**Total findings**: ${summary.total}`);
  lines.push('');

  if (summary.total === 0) {
    lines.push('_No vulnerabilities reported by `npm audit`._');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## Summary');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|---|---:|');
  for (const sev of ['critical', 'high', 'moderate', 'low', 'info']) {
    if (summary.bySeverity[sev]) {
      lines.push(`| ${sev} | ${summary.bySeverity[sev]} |`);
    }
  }
  lines.push('');
  lines.push('| Bucket | Count |');
  lines.push('|---|---:|');
  for (const b of BUCKET_ORDER) {
    if (summary.byBucket[b]) {
      lines.push(`| ${BUCKET_TITLES[b]} | ${summary.byBucket[b]} |`);
    }
  }
  lines.push('');

  // Group findings by bucket, in action-priority order
  const byBucket = new Map(BUCKET_ORDER.map(b => [b, []]));
  for (const f of findings) byBucket.get(f.bucket).push(f);

  for (const bucket of BUCKET_ORDER) {
    const group = byBucket.get(bucket);
    if (!group || group.length === 0) continue;
    lines.push(`## ${BUCKET_TITLES[bucket]}  (${group.length})`);
    lines.push('');
    for (const f of group) {
      lines.push(`### \`${f.name}\` · ${f.severity}`);
      lines.push('');
      lines.push(`- **Vulnerable range**: \`${f.vulnerableRange || 'unknown'}\``);
      if (f.fixHint) lines.push(`- **Fix**: ${f.fixHint}`);
      if (f.effects.length > 0) {
        lines.push(`- **Effects**: ${f.effects.map(e => `\`${e}\``).join(', ')}`);
      }
      if (f.paths.length > 0 && f.paths.length <= 5) {
        lines.push(`- **Located at**: ${f.paths.map(p => `\`${p}\``).join(', ')}`);
      } else if (f.paths.length > 5) {
        lines.push(`- **Located at**: \`${f.paths[0]}\` _and ${f.paths.length - 1} more_`);
      }
      if (f.alternative) {
        lines.push(`- **Alternative** _(${f.alternative.confidence} confidence)_: ${f.alternative.replacement} — ${f.alternative.note}`);
      }
      if (f.advisories.length > 0) {
        lines.push('- **Advisories**:');
        for (const a of f.advisories) {
          const cvss = a.cvss ? ` · CVSS ${a.cvss}` : '';
          const cwe = a.cwe.length ? ` · ${a.cwe.join(',')}` : '';
          lines.push(`  - [${a.title}](${a.url})${cvss}${cwe}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Decide whether the classified audit result should fail the release gate.
 *
 * @param {ReturnType<classifyAudit>} classified
 * @param {'critical'|'high'|'moderate'|'low'|'none'} failLevel   Minimum severity that fails
 * @returns {boolean} true when we should fail
 */
export function shouldFail(classified, failLevel = 'high') {
  if (failLevel === 'none') return false;
  const sev = classified?.summary?.bySeverity || {};
  const LEVELS = ['critical', 'high', 'moderate', 'low'];
  const cutoffIdx = LEVELS.indexOf(failLevel);
  if (cutoffIdx === -1) return false;
  for (let i = 0; i <= cutoffIdx; i++) {
    if (sev[LEVELS[i]] > 0) return true;
  }
  return false;
}

export default {
  ALTERNATIVES,
  getAlternative,
  classifyVulnerability,
  classifyAudit,
  renderMarkdown,
  shouldFail,
};
