import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock child_process
const mockExecAsync = jest.fn();
jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn((cmd, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    const err = new Error('not found');
    err.code = 'ENOENT';
    cb(err);
  })
}));

jest.unstable_mockModule('util', () => ({
  promisify: jest.fn(() => mockExecAsync)
}));

// Mock fs/promises
jest.unstable_mockModule('fs/promises', () => ({
  default: {
    access: jest.fn().mockRejectedValue(new Error('ENOENT'))
  },
  access: jest.fn().mockRejectedValue(new Error('ENOENT'))
}));

// Mock constants
jest.unstable_mockModule('../../utilities/constants.js', () => ({
  STATIC_ANALYSIS: {
    SEVERITY: {
      CRITICAL: 'critical',
      ERROR: 'error',
      WARNING: 'warning',
      INFO: 'info',
      SUGGESTION: 'suggestion'
    }
  }
}));

const { default: SecurityAnalyzer } = await import('../SecurityAnalyzer.js');

describe('SecurityAnalyzer', () => {
  let analyzer;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    analyzer = new SecurityAnalyzer(logger);
    // Reset scanner cache so each test gets fresh detection
    analyzer.availableScanners = null;
    mockExecAsync.mockReset();
    mockExecAsync.mockRejectedValue(new Error('not found'));
  });

  // --- constructor ---

  test('constructor creates instance with logger', () => {
    expect(analyzer).toBeInstanceOf(SecurityAnalyzer);
    expect(analyzer.logger).toBe(logger);
  });

  test('constructor creates instance without logger', () => {
    const a = new SecurityAnalyzer();
    expect(a).toBeInstanceOf(SecurityAnalyzer);
    expect(a.logger).toBeNull();
  });

  // --- detectAvailableScanners ---

  test('detectAvailableScanners returns all false when no scanners are installed', async () => {
    const scanners = await analyzer.detectAvailableScanners();
    expect(scanners.semgrep).toBe(false);
    expect(scanners.bandit).toBe(false);
    expect(scanners.npmAudit).toBe(false);
    expect(scanners.pipAudit).toBe(false);
    expect(scanners.eslintSecurity).toBe(false);
  });

  test('detectAvailableScanners caches result on second call', async () => {
    await analyzer.detectAvailableScanners();
    const callCount = mockExecAsync.mock.calls.length;
    await analyzer.detectAvailableScanners();
    // Should not have made additional calls
    expect(mockExecAsync.mock.calls.length).toBe(callCount);
  });

  test('detectAvailableScanners detects npm when available', async () => {
    // Make npm --version succeed
    mockExecAsync.mockImplementation((cmd) => {
      if (cmd === 'npm --version') return Promise.resolve({ stdout: '10.0.0' });
      return Promise.reject(new Error('not found'));
    });
    analyzer.availableScanners = null;
    const scanners = await analyzer.detectAvailableScanners();
    expect(scanners.npmAudit).toBe(true);
  });

  test('detectAvailableScanners detects bandit when available', async () => {
    mockExecAsync.mockImplementation((cmd) => {
      if (cmd === 'bandit --version') return Promise.resolve({ stdout: '1.7.0' });
      return Promise.reject(new Error('not found'));
    });
    analyzer.availableScanners = null;
    const scanners = await analyzer.detectAvailableScanners();
    expect(scanners.bandit).toBe(true);
  });

  // --- analyze ---

  test('analyze returns empty array for benign content with no scanners', async () => {
    const result = await analyzer.analyze('app.js', 'const x = 1 + 2;');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  test('analyze skips test files by default', async () => {
    const result = await analyzer.analyze('app.test.js', 'const password = "secret123";');
    expect(result).toEqual([]);
  });

  test('analyze scans test files when skipTestFiles is false', async () => {
    const result = await analyzer.analyze('app.test.js', 'const x = 1;', { skipTestFiles: false });
    expect(Array.isArray(result)).toBe(true);
  });

  // --- detectLanguage ---

  test('detectLanguage returns javascript for .js files', () => {
    expect(analyzer.detectLanguage('app.js')).toBe('javascript');
    expect(analyzer.detectLanguage('component.jsx')).toBe('javascript');
    expect(analyzer.detectLanguage('module.mjs')).toBe('javascript');
  });

  test('detectLanguage returns typescript for .ts files', () => {
    expect(analyzer.detectLanguage('app.ts')).toBe('typescript');
    expect(analyzer.detectLanguage('component.tsx')).toBe('typescript');
  });

  test('detectLanguage returns python for .py files', () => {
    expect(analyzer.detectLanguage('script.py')).toBe('python');
  });

  test('detectLanguage returns null for unsupported extensions', () => {
    expect(analyzer.detectLanguage('style.css')).toBeNull();
    expect(analyzer.detectLanguage('data.json')).toBeNull();
  });

  // --- isTestFile ---

  test('isTestFile detects various test file patterns', () => {
    expect(analyzer.isTestFile('app.test.js')).toBe(true);
    expect(analyzer.isTestFile('app.spec.ts')).toBe(true);
    expect(analyzer.isTestFile('__tests__/foo.js')).toBe(true);
    expect(analyzer.isTestFile('src/app.js')).toBe(false);
  });

  // --- parseSemgrepResults ---

  test('parseSemgrepResults parses valid semgrep output', () => {
    const output = {
      results: [{
        path: 'app.js',
        start: { line: 10, col: 5 },
        check_id: 'security.hardcoded-password',
        extra: {
          severity: 'ERROR',
          message: 'Hardcoded password detected',
          metadata: { cwe: 'CWE-798', owasp: 'A2', confidence: 'HIGH' }
        }
      }]
    };
    const issues = analyzer.parseSemgrepResults(output);
    expect(issues.length).toBe(1);
    expect(issues[0].file).toBe('app.js');
    expect(issues[0].line).toBe(10);
    expect(issues[0].severity).toBe('critical');
    expect(issues[0].scanner).toBe('semgrep');
    expect(issues[0].cwe).toBe('CWE-798');
  });

  test('parseSemgrepResults returns empty array for no results', () => {
    expect(analyzer.parseSemgrepResults({})).toEqual([]);
    expect(analyzer.parseSemgrepResults({ results: [] })).toEqual([]);
  });

  // --- parseBanditResults ---

  test('parseBanditResults parses valid bandit output', () => {
    const output = {
      results: [{
        filename: 'app.py',
        line_number: 42,
        test_id: 'B101',
        issue_severity: 'HIGH',
        issue_text: 'Use of assert detected',
        issue_confidence: 'HIGH',
        issue_cwe: { id: 703 }
      }]
    };
    const issues = analyzer.parseBanditResults(output);
    expect(issues.length).toBe(1);
    expect(issues[0].file).toBe('app.py');
    expect(issues[0].line).toBe(42);
    expect(issues[0].severity).toBe('critical');
    expect(issues[0].scanner).toBe('bandit');
    expect(issues[0].cwe).toBe('CWE-703');
  });

  test('parseBanditResults returns empty array for no results', () => {
    expect(analyzer.parseBanditResults({})).toEqual([]);
  });

  // --- parseNpmAuditResults ---

  test('parseNpmAuditResults parses npm audit v7+ format', () => {
    const output = {
      vulnerabilities: {
        'lodash': {
          severity: 'critical',
          via: [{ source: 12345, title: 'Prototype Pollution', cve: 'CVE-2021-23337', url: 'https://example.com' }],
          range: '<4.17.21',
          fixAvailable: true
        }
      }
    };
    const issues = analyzer.parseNpmAuditResults(output);
    expect(issues.length).toBe(1);
    expect(issues[0].package).toBe('lodash');
    expect(issues[0].severity).toBe('critical');
    expect(issues[0].scanner).toBe('npm-audit');
  });

  test('parseNpmAuditResults returns empty array when no vulnerabilities', () => {
    expect(analyzer.parseNpmAuditResults({})).toEqual([]);
  });

  // --- getScannerStatus ---

  test('getScannerStatus returns scanners and recommendations', async () => {
    const status = await analyzer.getScannerStatus();
    expect(status).toHaveProperty('scanners');
    expect(status).toHaveProperty('recommendations');
    expect(Array.isArray(status.recommendations)).toBe(true);
    // With no scanners available, we should get recommendations
    expect(status.recommendations.length).toBeGreaterThan(0);
  });

  // --- severity mapping ---

  test('mapSemgrepSeverity maps correctly', () => {
    expect(analyzer.mapSemgrepSeverity('ERROR')).toBe('critical');
    expect(analyzer.mapSemgrepSeverity('WARNING')).toBe('error');
    expect(analyzer.mapSemgrepSeverity('INFO')).toBe('warning');
    expect(analyzer.mapSemgrepSeverity('UNKNOWN')).toBe('warning');
  });

  test('mapBanditSeverity maps correctly', () => {
    expect(analyzer.mapBanditSeverity('HIGH')).toBe('critical');
    expect(analyzer.mapBanditSeverity('MEDIUM')).toBe('error');
    expect(analyzer.mapBanditSeverity('LOW')).toBe('warning');
  });

  test('mapNpmSeverity maps correctly', () => {
    expect(analyzer.mapNpmSeverity('critical')).toBe('critical');
    expect(analyzer.mapNpmSeverity('high')).toBe('critical');
    expect(analyzer.mapNpmSeverity('moderate')).toBe('error');
    expect(analyzer.mapNpmSeverity('low')).toBe('warning');
    expect(analyzer.mapNpmSeverity('info')).toBe('info');
  });

  test('mapESLintSeverity maps 2 to error, 1 to warning', () => {
    expect(analyzer.mapESLintSeverity(2)).toBe('error');
    expect(analyzer.mapESLintSeverity(1)).toBe('warning');
  });

  // --- normalizeResults ---

  test('normalizeResults maps all fields to common format', () => {
    const raw = [{
      file: 'x.js', line: 5, column: 3, severity: 'critical',
      rule: 'test-rule', message: 'Bad thing', scanner: 'test',
      cwe: 'CWE-1', fixable: true
    }];
    const normalized = analyzer.normalizeResults(raw);
    expect(normalized.length).toBe(1);
    expect(normalized[0].category).toBe('security');
    expect(normalized[0].fixable).toBe(true);
    expect(normalized[0].cwe).toBe('CWE-1');
  });

  // --- hasScannersForLanguage ---

  test('hasScannersForLanguage returns false when no scanners available', () => {
    const available = { semgrep: false, bandit: false, eslintSecurity: false };
    expect(analyzer.hasScannersForLanguage(available, 'javascript')).toBe(false);
    expect(analyzer.hasScannersForLanguage(available, 'python')).toBe(false);
    expect(analyzer.hasScannersForLanguage(available, 'ruby')).toBe(false);
  });

  test('hasScannersForLanguage returns true when semgrep available for JS', () => {
    expect(analyzer.hasScannersForLanguage({ semgrep: true, eslintSecurity: false }, 'javascript')).toBe(true);
  });
});
