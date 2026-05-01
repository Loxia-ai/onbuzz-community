import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock child_process
const mockExecAsync = jest.fn();
jest.unstable_mockModule('child_process', () => ({
  exec: (cmd, opts, cb) => {
    // promisify wraps exec, so we intercept at the promisified level
  }
}));
jest.unstable_mockModule('util', () => ({
  promisify: () => mockExecAsync
}));

// Mock fs/promises
const mockReadFile = jest.fn();
jest.unstable_mockModule('fs/promises', () => ({
  default: { readFile: mockReadFile },
  readFile: mockReadFile
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
    },
    CATEGORY: {
      SYNTAX: 'syntax',
      TYPE: 'type',
      IMPORT: 'import',
      STYLE: 'style',
      SECURITY: 'security',
      PERFORMANCE: 'performance',
      BEST_PRACTICE: 'best_practice'
    }
  }
}));

const { default: ConfigValidator } = await import('../ConfigValidator.js');

describe('ConfigValidator', () => {
  let validator;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    validator = new ConfigValidator(logger);
    jest.clearAllMocks();
    validator.availableScanners = null;
    validator.scannerCache.clear();
  });

  // ── Constructor ──
  test('constructor initializes with defaults', () => {
    expect(validator.logger).toBe(logger);
    expect(validator.availableScanners).toBeNull();
    expect(validator.scannerCache).toBeInstanceOf(Map);
  });

  test('constructor works without logger', () => {
    const v = new ConfigValidator();
    expect(v.logger).toBeNull();
  });

  // ── detectAvailableValidators ──
  test('detectAvailableValidators returns cached result on second call', async () => {
    mockExecAsync.mockRejectedValue(new Error('not found'));

    const first = await validator.detectAvailableValidators();
    const second = await validator.detectAvailableValidators();
    expect(first).toBe(second);
    // execAsync should only be called during first detection
  });

  test('detectAvailableValidators detects checkov when available', async () => {
    mockExecAsync.mockImplementation((cmd) => {
      if (cmd.startsWith('checkov')) return Promise.resolve({ stdout: '2.0' });
      return Promise.reject(new Error('not found'));
    });

    const result = await validator.detectAvailableValidators();
    expect(result.checkov).toBe(true);
    expect(result.hadolint).toBe(false);
    expect(result.yamllint).toBe(false);
  });

  test('detectAvailableValidators returns all false when nothing available', async () => {
    mockExecAsync.mockRejectedValue(new Error('not found'));

    const result = await validator.detectAvailableValidators();
    expect(result.checkov).toBe(false);
    expect(result.hadolint).toBe(false);
    expect(result.yamllint).toBe(false);
  });

  // ── detectFileType ──
  test('detectFileType identifies Dockerfile', () => {
    expect(validator.detectFileType('/path/Dockerfile')).toBe('dockerfile');
  });

  test('detectFileType identifies docker-compose.yml', () => {
    expect(validator.detectFileType('/path/docker-compose.yml')).toBe('docker-compose');
    expect(validator.detectFileType('/path/docker-compose.yaml')).toBe('docker-compose');
  });

  test('detectFileType identifies package.json', () => {
    expect(validator.detectFileType('/path/package.json')).toBe('package.json');
  });

  test('detectFileType identifies tsconfig.json', () => {
    expect(validator.detectFileType('/path/tsconfig.json')).toBe('tsconfig.json');
  });

  test('detectFileType identifies .env files', () => {
    expect(validator.detectFileType('/path/.env')).toBe('env');
    expect(validator.detectFileType('/path/production.env')).toBe('env');
  });

  test('detectFileType identifies github-actions from path', () => {
    expect(validator.detectFileType('/project/.github/workflows/ci.yml')).toBe('github-actions');
  });

  test('detectFileType identifies kubernetes from path', () => {
    expect(validator.detectFileType('/project/kubernetes/deploy.yml')).toBe('kubernetes');
    expect(validator.detectFileType('/project/k8s/service.yaml')).toBe('kubernetes');
  });

  test('detectFileType identifies terraform', () => {
    expect(validator.detectFileType('/path/main.tf')).toBe('terraform');
    expect(validator.detectFileType('/path/vars.tfvars')).toBe('terraform');
  });

  test('detectFileType identifies yaml', () => {
    expect(validator.detectFileType('/path/config.yml')).toBe('yaml');
    expect(validator.detectFileType('/path/config.yaml')).toBe('yaml');
  });

  test('detectFileType identifies json', () => {
    expect(validator.detectFileType('/path/data.json')).toBe('json');
  });

  test('detectFileType returns unknown for unrecognized', () => {
    expect(validator.detectFileType('/path/file.txt')).toBe('unknown');
  });

  // ── validateEnvFile ──
  test('validateEnvFile detects hardcoded secrets', async () => {
    mockReadFile.mockResolvedValue(
      '# comment\nDB_HOST=localhost\nAPI_KEY=sk-1234567890abcdef\nSECRET_TOKEN=my-super-secret-value\n'
    );

    const issues = await validator.validateEnvFile('/path/.env');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].severity).toBe('critical');
    expect(issues[0].rule).toBe('hardcoded-secret');
  });

  test('validateEnvFile ignores placeholders and short values', async () => {
    mockReadFile.mockResolvedValue(
      'API_KEY=your-key-here\nTOKEN=changeme\nSECRET=$OTHER_VAR\nPASSWORD=abc\n'
    );

    const issues = await validator.validateEnvFile('/path/.env');
    expect(issues.length).toBe(0);
  });

  test('validateEnvFile ignores comments and empty lines', async () => {
    mockReadFile.mockResolvedValue('# this is a comment\n\n');

    const issues = await validator.validateEnvFile('/path/.env');
    expect(issues.length).toBe(0);
  });

  test('validateEnvFile returns empty on read error', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const issues = await validator.validateEnvFile('/path/.env');
    expect(issues).toEqual([]);
  });

  // ── validateTsConfig ──
  test('validateTsConfig warns about missing strict mode', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      compilerOptions: { target: 'es2020' }
    }));

    const issues = await validator.validateTsConfig('/path/tsconfig.json');
    expect(issues.some(i => i.rule === 'strict-mode')).toBe(true);
  });

  test('validateTsConfig warns about noImplicitAny disabled', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      compilerOptions: { strict: true, noImplicitAny: false }
    }));

    const issues = await validator.validateTsConfig('/path/tsconfig.json');
    expect(issues.some(i => i.rule === 'no-implicit-any')).toBe(true);
  });

  test('validateTsConfig no warnings for strict config', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      compilerOptions: { strict: true }
    }));

    const issues = await validator.validateTsConfig('/path/tsconfig.json');
    expect(issues.length).toBe(0);
  });

  test('validateTsConfig returns error on invalid JSON', async () => {
    mockReadFile.mockResolvedValue('not json {{{');

    const issues = await validator.validateTsConfig('/path/tsconfig.json');
    expect(issues.length).toBe(1);
    expect(issues[0].rule).toBe('json-parse');
    expect(issues[0].severity).toBe('error');
  });

  test('validateTsConfig handles missing compilerOptions', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}));

    const issues = await validator.validateTsConfig('/path/tsconfig.json');
    expect(issues.length).toBe(0);
  });

  // ── validate (routing) ──
  test('validate routes env files without external tools', async () => {
    mockExecAsync.mockRejectedValue(new Error('not found'));
    mockReadFile.mockResolvedValue('SECRET=supersecretvalue123\n');

    const issues = await validator.validate('/path/.env');
    expect(issues.length).toBeGreaterThan(0);
  });

  test('validate returns empty for unknown file type', async () => {
    mockExecAsync.mockRejectedValue(new Error('not found'));

    const issues = await validator.validate('/path/file.txt');
    expect(issues).toEqual([]);
  });

  // ── normalizeResults ──
  test('normalizeResults fills in defaults', () => {
    const results = validator.normalizeResults([
      { file: 'test.yml', message: 'issue' }
    ]);
    expect(results[0].line).toBe(1);
    expect(results[0].column).toBe(1);
    expect(results[0].severity).toBe('warning');
    expect(results[0].rule).toBe('unknown');
    expect(results[0].cwe).toBeNull();
    expect(results[0].remediation).toBeNull();
    expect(results[0].references).toEqual([]);
  });

  // ── mapHadolintSeverity ──
  test('mapHadolintSeverity maps known levels', () => {
    expect(validator.mapHadolintSeverity('error')).toBe('error');
    expect(validator.mapHadolintSeverity('warning')).toBe('warning');
    expect(validator.mapHadolintSeverity('info')).toBe('info');
    expect(validator.mapHadolintSeverity('style')).toBe('info');
  });

  test('mapHadolintSeverity returns warning for unknown', () => {
    expect(validator.mapHadolintSeverity('unknown')).toBe('warning');
    expect(validator.mapHadolintSeverity(null)).toBe('warning');
  });

  // ── mapYamllintSeverity ──
  test('mapYamllintSeverity maps known levels', () => {
    expect(validator.mapYamllintSeverity('error')).toBe('error');
    expect(validator.mapYamllintSeverity('warning')).toBe('warning');
  });

  test('mapYamllintSeverity returns warning for unknown', () => {
    expect(validator.mapYamllintSeverity('something')).toBe('warning');
  });

  // ── mapCheckovSeverity ──
  test('mapCheckovSeverity always returns error', () => {
    expect(validator.mapCheckovSeverity('any')).toBe('error');
  });

  // ── parseHadolintResults ──
  test('parseHadolintResults parses array of issues', () => {
    const output = [
      { line: 5, column: 1, level: 'warning', code: 'DL3008', message: 'Pin versions' }
    ];
    const issues = validator.parseHadolintResults(output, '/path/Dockerfile');
    expect(issues.length).toBe(1);
    expect(issues[0].rule).toBe('DL3008');
    expect(issues[0].validator).toBe('hadolint');
  });

  test('parseHadolintResults returns empty for non-array', () => {
    expect(validator.parseHadolintResults({}, '/path/Dockerfile')).toEqual([]);
  });

  // ── parseYamllintResults ──
  test('parseYamllintResults parses formatted output', () => {
    const output = 'file.yml:3:1: [warning] too many blank lines (empty-lines)\n';
    const issues = validator.parseYamllintResults(output, '/path/file.yml');
    expect(issues.length).toBe(1);
    expect(issues[0].line).toBe(3);
    expect(issues[0].rule).toBe('empty-lines');
    expect(issues[0].validator).toBe('yamllint');
  });

  test('parseYamllintResults returns empty for non-matching output', () => {
    const issues = validator.parseYamllintResults('some random output\n', '/path/file.yml');
    expect(issues.length).toBe(0);
  });

  // ── parseCheckovResults ──
  test('parseCheckovResults parses failed checks', () => {
    const output = {
      results: {
        failed_checks: [
          { check_id: 'CKV_1', check_name: 'Test check', file_line_range: [10, 20], guideline: 'http://fix.me' }
        ]
      }
    };
    const issues = validator.parseCheckovResults(output, '/path/main.tf');
    expect(issues.length).toBe(1);
    expect(issues[0].rule).toBe('CKV_1');
    expect(issues[0].validator).toBe('checkov');
    expect(issues[0].references).toEqual(['http://fix.me']);
  });

  test('parseCheckovResults returns empty for no results', () => {
    expect(validator.parseCheckovResults({}, '/path/main.tf')).toEqual([]);
  });

  // ── getValidatorStatus ──
  test('getValidatorStatus returns validators and recommendations', async () => {
    mockExecAsync.mockRejectedValue(new Error('not found'));

    const status = await validator.getValidatorStatus();
    expect(status).toHaveProperty('validators');
    expect(status).toHaveProperty('recommendations');
    expect(status.recommendations.length).toBeGreaterThan(0);
  });

  // ── getInstallRecommendations ──
  test('getInstallRecommendations returns recommendations for missing tools', () => {
    const recs = validator.getInstallRecommendations({
      checkov: false, hadolint: false, yamllint: false, jsonSchema: false
    });
    expect(recs.length).toBe(4);
  });

  test('getInstallRecommendations returns empty when all available', () => {
    const recs = validator.getInstallRecommendations({
      checkov: true, hadolint: true, yamllint: true, jsonSchema: true
    });
    expect(recs.length).toBe(0);
  });
});
