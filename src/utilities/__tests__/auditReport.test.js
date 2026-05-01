/**
 * Tests for auditReport — pure classification + markdown rendering.
 *
 * Coverage priority: the CLASSIFIER. Every real audit JSON flows through
 * it, and a single misclassification (e.g. a "direct-breaking" shown as
 * "transitive-auto") would silently let a known-bad release through the
 * gate. The six-bucket contract is locked hard.
 */

import { describe, test, expect } from '@jest/globals';
import {
  classifyVulnerability,
  classifyAudit,
  renderMarkdown,
  shouldFail,
  getAlternative,
  ALTERNATIVES,
} from '../auditReport.js';

// ────────────────────────────────────────────────────────────────────────
// classifyVulnerability
// ────────────────────────────────────────────────────────────────────────

describe('classifyVulnerability — bucket assignment', () => {
  test('direct + fixAvailable=true → direct-auto', () => {
    const out = classifyVulnerability('ajv', {
      severity: 'moderate', isDirect: true, fixAvailable: true,
      via: [], range: '<6.14.0',
    });
    expect(out.bucket).toBe('direct-auto');
    expect(out.fixHint).toMatch(/npm audit fix/);
  });

  test('transitive + fixAvailable=true → transitive-auto', () => {
    const out = classifyVulnerability('@xmldom/xmldom', {
      severity: 'high', isDirect: false, fixAvailable: true,
      via: [], range: '<0.8.12',
    });
    expect(out.bucket).toBe('transitive-auto');
  });

  test('direct + fixAvailable object with isSemVerMajor=true → direct-breaking', () => {
    const out = classifyVulnerability('webpack', {
      severity: 'high', isDirect: true,
      fixAvailable: { name: 'webpack', version: '5.94.0', isSemVerMajor: true },
      via: [], range: '<5.94.0',
    });
    expect(out.bucket).toBe('direct-breaking');
    expect(out.fixHint).toMatch(/Breaking upgrade/);
    expect(out.fixHint).toContain('webpack@5.94.0');
  });

  test('transitive + fixAvailable object with isSemVerMajor=true → transitive-needs-parent-bump', () => {
    const out = classifyVulnerability('lodash', {
      severity: 'high', isDirect: false,
      fixAvailable: { name: 'some-parent', version: '2.0.0', isSemVerMajor: true },
      via: [], range: '<4.17.21',
    });
    expect(out.bucket).toBe('transitive-needs-parent-bump');
    expect(out.fixHint).toContain('some-parent@2.0.0');
  });

  test('direct + fixAvailable object with isSemVerMajor=false → direct-auto (non-breaking targeted)', () => {
    const out = classifyVulnerability('foo', {
      severity: 'moderate', isDirect: true,
      fixAvailable: { name: 'foo', version: '1.2.4', isSemVerMajor: false },
      via: [], range: '<1.2.4',
    });
    expect(out.bucket).toBe('direct-auto');
    expect(out.fixHint).toMatch(/Targeted upgrade/);
  });

  test('direct + fixAvailable=false → direct-orphan', () => {
    const out = classifyVulnerability('abandonware', {
      severity: 'high', isDirect: true, fixAvailable: false,
      via: [], range: '*',
    });
    expect(out.bucket).toBe('direct-orphan');
    expect(out.fixHint).toMatch(/No fix available/);
  });

  test('transitive + fixAvailable=false → transitive-orphan', () => {
    const out = classifyVulnerability('abandonware', {
      severity: 'high', isDirect: false, fixAvailable: false,
      via: [], range: '*',
    });
    expect(out.bucket).toBe('transitive-orphan');
    expect(out.fixHint).toMatch(/overrides|replace/i);
  });

  test('missing fixAvailable treated as no fix (defensive)', () => {
    const out = classifyVulnerability('mystery', {
      severity: 'moderate', isDirect: true,
      via: [], range: '*',
    });
    expect(out.bucket).toBe('direct-orphan');
  });
});

describe('classifyVulnerability — advisory extraction', () => {
  test('object entries in `via` become advisories; string entries are ignored', () => {
    const out = classifyVulnerability('pkg', {
      severity: 'high', isDirect: false, fixAvailable: true,
      via: [
        { title: 'RCE via tag injection', url: 'https://example/1', cvss: { score: 9.8 }, cwe: ['CWE-77'] },
        'some-other-vuln-ref',
        { title: 'XXE', url: 'https://example/2' },
      ],
      range: '<1.0.0',
    });
    expect(out.advisories).toHaveLength(2);
    expect(out.advisories[0]).toEqual({ title: 'RCE via tag injection', url: 'https://example/1', cvss: 9.8, cwe: ['CWE-77'] });
    expect(out.advisories[1]).toEqual({ title: 'XXE', url: 'https://example/2', cvss: null, cwe: [] });
  });

  test('missing via array → empty advisories list (no throw)', () => {
    const out = classifyVulnerability('pkg', { severity: 'low', isDirect: true, fixAvailable: true });
    expect(out.advisories).toEqual([]);
  });
});

describe('classifyVulnerability — alternatives lookup', () => {
  test('known orphan gets an alternative attached', () => {
    const out = classifyVulnerability('request', {
      severity: 'high', isDirect: true, fixAvailable: false,
      via: [], range: '*',
    });
    expect(out.alternative).not.toBeNull();
    expect(out.alternative.replacement).toMatch(/undici|fetch/i);
  });

  test('unknown package gets no alternative', () => {
    const out = classifyVulnerability('some-obscure-pkg', {
      severity: 'low', isDirect: false, fixAvailable: true,
      via: [], range: '*',
    });
    expect(out.alternative).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// classifyAudit
// ────────────────────────────────────────────────────────────────────────

describe('classifyAudit', () => {
  const sample = {
    vulnerabilities: {
      'pkg-a': { severity: 'critical', isDirect: true, fixAvailable: true, via: [], range: '<1' },
      'pkg-b': { severity: 'high', isDirect: false, fixAvailable: false, via: [], range: '<2' },
      'pkg-c': { severity: 'moderate', isDirect: true, fixAvailable: { name: 'pkg-c', version: '2.0.0', isSemVerMajor: true }, via: [], range: '<2' },
      'pkg-d': { severity: 'low', isDirect: false, fixAvailable: true, via: [], range: '<1' },
    },
  };

  test('returns summary with severity + bucket counts', () => {
    const out = classifyAudit(sample);
    expect(out.summary.total).toBe(4);
    expect(out.summary.bySeverity.critical).toBe(1);
    expect(out.summary.bySeverity.high).toBe(1);
    expect(out.summary.bySeverity.moderate).toBe(1);
    expect(out.summary.bySeverity.low).toBe(1);
    expect(out.summary.byBucket['direct-auto']).toBe(1);      // pkg-a
    expect(out.summary.byBucket['transitive-orphan']).toBe(1); // pkg-b
    expect(out.summary.byBucket['direct-breaking']).toBe(1);   // pkg-c
    expect(out.summary.byBucket['transitive-auto']).toBe(1);   // pkg-d
  });

  test('findings are ordered by severity descending (critical first)', () => {
    const out = classifyAudit(sample);
    expect(out.findings.map(f => f.severity)).toEqual(['critical', 'high', 'moderate', 'low']);
  });

  test('empty vulnerabilities object → empty findings, zero counts', () => {
    const out = classifyAudit({ vulnerabilities: {} });
    expect(out.summary.total).toBe(0);
    expect(out.findings).toEqual([]);
  });

  test('completely malformed input is handled without throwing', () => {
    expect(() => classifyAudit(null)).not.toThrow();
    expect(() => classifyAudit(undefined)).not.toThrow();
    expect(() => classifyAudit({})).not.toThrow();
    expect(classifyAudit(null).summary.total).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// renderMarkdown
// ────────────────────────────────────────────────────────────────────────

describe('renderMarkdown', () => {
  test('empty audit renders the "no vulnerabilities" notice', () => {
    const out = renderMarkdown(classifyAudit({ vulnerabilities: {} }));
    expect(out).toMatch(/No vulnerabilities/);
    expect(out).not.toMatch(/## Summary/);
  });

  test('workspace label shows in header when provided', () => {
    const out = renderMarkdown(classifyAudit({ vulnerabilities: {} }), { workspace: 'web-ui' });
    expect(out).toMatch(/^# Dependency audit report — `web-ui`/m);
  });

  test('summary table lists only non-zero severity rows', () => {
    const audit = {
      vulnerabilities: {
        a: { severity: 'high', isDirect: true, fixAvailable: true, via: [], range: '<1' },
        b: { severity: 'high', isDirect: false, fixAvailable: true, via: [], range: '<2' },
      },
    };
    const md = renderMarkdown(classifyAudit(audit));
    expect(md).toMatch(/\| high \| 2 \|/);
    expect(md).not.toMatch(/\| critical \|/);   // zero, must not appear
    expect(md).not.toMatch(/\| low \|/);        // zero, must not appear
  });

  test('findings grouped under bucket headers in action-priority order', () => {
    const audit = {
      vulnerabilities: {
        'auto-pkg':  { severity: 'moderate', isDirect: true, fixAvailable: true, via: [], range: '<1' },
        'orphan-pkg':{ severity: 'high', isDirect: true, fixAvailable: false, via: [], range: '<1' },
      },
    };
    const md = renderMarkdown(classifyAudit(audit));
    const idxOrphan = md.indexOf('Direct · no fix available');
    const idxAuto   = md.indexOf('Direct · auto-fixable');
    expect(idxOrphan).toBeGreaterThan(-1);
    expect(idxAuto).toBeGreaterThan(-1);
    // Orphan section comes first — that's the "needs human decision" pile.
    expect(idxOrphan).toBeLessThan(idxAuto);
  });

  test('alternative hint is surfaced for orphan vulns with a mapped replacement', () => {
    const audit = {
      vulnerabilities: {
        request: { severity: 'high', isDirect: true, fixAvailable: false, via: [], range: '*' },
      },
    };
    const md = renderMarkdown(classifyAudit(audit));
    expect(md).toMatch(/Alternative/);
    expect(md).toMatch(/undici|fetch/i);
  });

  test('advisory bullets render with title, cvss, cwe when present', () => {
    const audit = {
      vulnerabilities: {
        pkg: {
          severity: 'high', isDirect: true, fixAvailable: true,
          via: [{ title: 'XSS', url: 'https://x', cvss: { score: 7.5 }, cwe: ['CWE-79'] }],
          range: '<1',
        },
      },
    };
    const md = renderMarkdown(classifyAudit(audit));
    expect(md).toMatch(/\[XSS\]\(https:\/\/x\)/);
    expect(md).toMatch(/CVSS 7\.5/);
    expect(md).toMatch(/CWE-79/);
  });

  test('path list collapses when there are more than 5 paths', () => {
    const paths = Array.from({ length: 8 }, (_, i) => `node_modules/n${i}/dep`);
    const audit = {
      vulnerabilities: {
        pkg: { severity: 'high', isDirect: false, fixAvailable: true, via: [], range: '<1', nodes: paths },
      },
    };
    const md = renderMarkdown(classifyAudit(audit));
    expect(md).toMatch(/and 7 more/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// shouldFail — release-gate decision
// ────────────────────────────────────────────────────────────────────────

describe('shouldFail', () => {
  const audit = (sev) => classifyAudit({
    vulnerabilities: { x: { severity: sev, isDirect: true, fixAvailable: true, via: [], range: '<1' } },
  });

  test('fails on cutoff severity and anything above it', () => {
    expect(shouldFail(audit('critical'), 'high')).toBe(true);
    expect(shouldFail(audit('high'),     'high')).toBe(true);
    expect(shouldFail(audit('moderate'), 'high')).toBe(false);
  });

  test('cutoff=moderate fails on moderate, high, and critical', () => {
    expect(shouldFail(audit('critical'), 'moderate')).toBe(true);
    expect(shouldFail(audit('high'),     'moderate')).toBe(true);
    expect(shouldFail(audit('moderate'), 'moderate')).toBe(true);
    expect(shouldFail(audit('low'),      'moderate')).toBe(false);
  });

  test('cutoff=none never fails regardless of severity', () => {
    expect(shouldFail(audit('critical'), 'none')).toBe(false);
  });

  test('empty audit never fails', () => {
    expect(shouldFail(classifyAudit({ vulnerabilities: {} }), 'low')).toBe(false);
  });

  test('unknown failLevel returns false (safe default)', () => {
    expect(shouldFail(audit('critical'), 'not-a-level')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Alternatives map sanity
// ────────────────────────────────────────────────────────────────────────

describe('ALTERNATIVES map', () => {
  test('is frozen — accidental mutation should fail silently or throw', () => {
    expect(Object.isFrozen(ALTERNATIVES)).toBe(true);
  });

  test('every entry has replacement, note, and a valid confidence', () => {
    const valid = new Set(['high', 'medium', 'low']);
    for (const [name, entry] of Object.entries(ALTERNATIVES)) {
      expect(typeof entry.replacement).toBe('string');
      expect(entry.replacement.length).toBeGreaterThan(0);
      expect(typeof entry.note).toBe('string');
      expect(valid.has(entry.confidence)).toBe(true);
    }
  });

  test('getAlternative returns null for unmapped packages', () => {
    expect(getAlternative('lodash-really-not-here')).toBeNull();
  });
});
