/**
 * SecurityAnalyzer - Professional security scanning using external tools
 *
 * Uses industry-standard security scanners:
 * - Semgrep: Multi-language SAST
 * - Bandit: Python security scanner
 * - ESLint Security Plugin: JavaScript/TypeScript security
 * - npm audit: Node.js dependency vulnerabilities
 * - pip-audit: Python dependency vulnerabilities
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { STATIC_ANALYSIS } from '../utilities/constants.js';

const execAsync = promisify(exec);

class SecurityAnalyzer {
  constructor(logger = null) {
    this.logger = logger;
    this.availableScanners = null;
    this.scannerCache = new Map(); // Cache scanner availability checks

    // Path to locally installed scanners (from postinstall script)
    this.localScannerDir = path.join(process.cwd(), 'node_modules', '.scanners');
  }

  /**
   * Detect which security scanners are available on the system
   * @returns {Promise<Object>} Available scanners
   */
  async detectAvailableScanners() {
    // Return cached result if available
    if (this.availableScanners !== null) {
      return this.availableScanners;
    }

    const available = {
      semgrep: false,
      bandit: false,
      npmAudit: false,
      pipAudit: false,
      eslintSecurity: false
    };

    // Check for Semgrep (local first, then system)
    try {
      const localSemgrep = path.join(this.localScannerDir, 'semgrep');
      try {
        await fs.access(localSemgrep);
        available.semgrep = true;
        this.logger?.debug('Semgrep scanner detected (local)');
      } catch {
        await execAsync('semgrep --version', { timeout: 5000 });
        available.semgrep = true;
        this.logger?.debug('Semgrep scanner detected (system)');
      }
    } catch (error) {
      this.logger?.debug('Semgrep not available', { error: error.message });
    }

    // Check for Bandit
    try {
      await execAsync('bandit --version', { timeout: 5000 });
      available.bandit = true;
      this.logger?.debug('Bandit scanner detected');
    } catch (error) {
      this.logger?.debug('Bandit not available', { error: error.message });
    }

    // Check for npm (npm audit is built-in)
    try {
      await execAsync('npm --version', { timeout: 5000 });
      available.npmAudit = true;
      this.logger?.debug('npm audit available');
    } catch (error) {
      this.logger?.debug('npm not available', { error: error.message });
    }

    // Check for pip-audit
    try {
      await execAsync('pip-audit --version', { timeout: 5000 });
      available.pipAudit = true;
      this.logger?.debug('pip-audit detected');
    } catch (error) {
      this.logger?.debug('pip-audit not available', { error: error.message });
    }

    // Check for eslint-plugin-security
    try {
      // Check if the package is installed
      const result = await execAsync('npm list eslint-plugin-security --depth=0 --json', {
        timeout: 5000,
        cwd: process.cwd()
      });
      const parsed = JSON.parse(result.stdout);
      if (parsed.dependencies && parsed.dependencies['eslint-plugin-security']) {
        available.eslintSecurity = true;
        this.logger?.debug('eslint-plugin-security detected');
      }
    } catch (error) {
      this.logger?.debug('eslint-plugin-security not available', { error: error.message });
    }

    this.availableScanners = available;
    return available;
  }

  /**
   * Analyze a file for security vulnerabilities
   * @param {string} filePath - Path to file
   * @param {string} content - File content
   * @param {Object} options - Analysis options
   * @returns {Promise<Array>} Security issues found
   */
  async analyze(filePath, content, options = {}) {
    const issues = [];
    const available = await this.detectAvailableScanners();
    const language = this.detectLanguage(filePath);

    // Skip test files if requested
    if (options.skipTestFiles !== false && this.isTestFile(filePath)) {
      this.logger?.debug('Skipping test file for security scan', { filePath });
      return [];
    }

    // Run appropriate scanners based on language
    if (language === 'javascript' || language === 'typescript') {
      // Run Semgrep for JS/TS
      if (available.semgrep) {
        const semgrepIssues = await this.runSemgrep(filePath, [language], options);
        issues.push(...semgrepIssues);
      }

      // Run ESLint Security Plugin
      if (available.eslintSecurity) {
        const eslintIssues = await this.runESLintSecurity(filePath, content, options);
        issues.push(...eslintIssues);
      }
    }

    if (language === 'python') {
      // Run Bandit for Python
      if (available.bandit) {
        const banditIssues = await this.runBandit(filePath, options);
        issues.push(...banditIssues);
      }

      // Run Semgrep for Python
      if (available.semgrep) {
        const semgrepIssues = await this.runSemgrep(filePath, [language], options);
        issues.push(...semgrepIssues);
      }
    }

    // If no scanners available, return informative message
    if (issues.length === 0 && !this.hasScannersForLanguage(available, language)) {
      this.logger?.warn('No security scanners available for language', { language, filePath });
    }

    return this.normalizeResults(issues);
  }

  /**
   * Analyze a project directory for security vulnerabilities
   * @param {string} projectDir - Project directory path
   * @param {string} language - Primary language to scan
   * @param {Object} options - Analysis options
   * @returns {Promise<Array>} Security issues found
   */
  async analyzeProject(projectDir, language, options = {}) {
    const issues = [];
    const available = await this.detectAvailableScanners();

    // Run dependency scanners
    if (language === 'javascript' || language === 'typescript') {
      if (available.npmAudit) {
        const npmIssues = await this.runNpmAudit(projectDir, options);
        issues.push(...npmIssues);
      }
    }

    if (language === 'python') {
      if (available.pipAudit) {
        const pipIssues = await this.runPipAudit(projectDir, options);
        issues.push(...pipIssues);
      }
    }

    return this.normalizeResults(issues);
  }

  /**
   * Run Semgrep scanner
   * @private
   */
  async runSemgrep(filePath, languages, options = {}) {
    try {
      const dir = path.dirname(filePath);
      const result = await execAsync(
        `semgrep --config=auto --json "${filePath}"`,
        {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30000,
          cwd: dir
        }
      );

      const output = JSON.parse(result.stdout);
      return this.parseSemgrepResults(output);
    } catch (error) {
      // Semgrep exits with non-zero if issues found, check stdout
      if (error.stdout) {
        try {
          const output = JSON.parse(error.stdout);
          return this.parseSemgrepResults(output);
        } catch (parseError) {
          this.logger?.error('Failed to parse Semgrep output', {
            error: parseError.message,
            stdout: error.stdout
          });
        }
      }
      this.logger?.error('Semgrep scan failed', { error: error.message });
      return [];
    }
  }

  /**
   * Parse Semgrep results
   * @private
   */
  parseSemgrepResults(output) {
    const issues = [];

    if (output.results && Array.isArray(output.results)) {
      for (const result of output.results) {
        issues.push({
          file: result.path,
          line: result.start?.line || 1,
          column: result.start?.col || 1,
          severity: this.mapSemgrepSeverity(result.extra?.severity),
          rule: result.check_id,
          message: result.extra?.message || result.extra?.lines || 'Security issue detected',
          category: 'security',
          scanner: 'semgrep',
          cwe: result.extra?.metadata?.cwe,
          owasp: result.extra?.metadata?.owasp,
          confidence: result.extra?.metadata?.confidence,
          references: result.extra?.metadata?.references
        });
      }
    }

    return issues;
  }

  /**
   * Run Bandit scanner for Python
   * @private
   */
  async runBandit(filePath, options = {}) {
    try {
      const result = await execAsync(
        `bandit -f json "${filePath}"`,
        {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30000
        }
      );

      const output = JSON.parse(result.stdout);
      return this.parseBanditResults(output);
    } catch (error) {
      // Bandit exits with non-zero if issues found
      if (error.stdout) {
        try {
          const output = JSON.parse(error.stdout);
          return this.parseBanditResults(output);
        } catch (parseError) {
          this.logger?.error('Failed to parse Bandit output', {
            error: parseError.message
          });
        }
      }
      this.logger?.error('Bandit scan failed', { error: error.message });
      return [];
    }
  }

  /**
   * Parse Bandit results
   * @private
   */
  parseBanditResults(output) {
    const issues = [];

    if (output.results && Array.isArray(output.results)) {
      for (const result of output.results) {
        issues.push({
          file: result.filename,
          line: result.line_number || 1,
          column: result.col_offset || 1,
          severity: this.mapBanditSeverity(result.issue_severity),
          rule: result.test_id,
          message: result.issue_text,
          category: 'security',
          scanner: 'bandit',
          cwe: result.issue_cwe?.id ? `CWE-${result.issue_cwe.id}` : null,
          confidence: result.issue_confidence,
          moreInfo: result.more_info
        });
      }
    }

    return issues;
  }

  /**
   * Run ESLint with security plugin
   * @private
   */
  async runESLintSecurity(filePath, content, options = {}) {
    try {
      // Use ESLint programmatically
      const { ESLint } = await import('eslint');

      const eslint = new ESLint({
        overrideConfig: {
          plugins: ['security'],
          extends: ['plugin:security/recommended'],
          parserOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
          }
        },
        useEslintrc: false
      });

      const results = await eslint.lintText(content, { filePath });
      return this.parseESLintResults(results, filePath);
    } catch (error) {
      this.logger?.error('ESLint security scan failed', {
        error: error.message,
        filePath
      });
      return [];
    }
  }

  /**
   * Parse ESLint security results
   * @private
   */
  parseESLintResults(results, filePath) {
    const issues = [];

    for (const result of results) {
      if (result.messages && Array.isArray(result.messages)) {
        for (const message of result.messages) {
          // Only include security plugin rules
          if (message.ruleId && message.ruleId.startsWith('security/')) {
            issues.push({
              file: filePath,
              line: message.line || 1,
              column: message.column || 1,
              severity: this.mapESLintSeverity(message.severity),
              rule: message.ruleId,
              message: message.message,
              category: 'security',
              scanner: 'eslint-security',
              fixable: message.fix !== undefined
            });
          }
        }
      }
    }

    return issues;
  }

  /**
   * Run npm audit for dependency vulnerabilities
   * @private
   */
  async runNpmAudit(projectDir, options = {}) {
    try {
      // Check if package.json exists
      const packageJsonPath = path.join(projectDir, 'package.json');
      try {
        await fs.access(packageJsonPath);
      } catch {
        this.logger?.debug('No package.json found, skipping npm audit');
        return [];
      }

      const result = await execAsync(
        'npm audit --json',
        {
          cwd: projectDir,
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60000
        }
      );

      const output = JSON.parse(result.stdout);
      return this.parseNpmAuditResults(output);
    } catch (error) {
      // npm audit exits with non-zero if vulnerabilities found
      if (error.stdout) {
        try {
          const output = JSON.parse(error.stdout);
          return this.parseNpmAuditResults(output);
        } catch (parseError) {
          this.logger?.error('Failed to parse npm audit output', {
            error: parseError.message
          });
        }
      }
      return [];
    }
  }

  /**
   * Parse npm audit results
   * @private
   */
  parseNpmAuditResults(output) {
    const issues = [];

    // npm audit v7+ format
    if (output.vulnerabilities) {
      for (const [packageName, vuln] of Object.entries(output.vulnerabilities)) {
        issues.push({
          file: 'package.json',
          line: 1,
          column: 1,
          severity: this.mapNpmSeverity(vuln.severity),
          rule: `npm-${vuln.via[0]?.source || 'advisory'}`,
          message: `${packageName}: ${vuln.via[0]?.title || 'Security vulnerability'}`,
          category: 'security',
          scanner: 'npm-audit',
          package: packageName,
          vulnerableVersions: vuln.range,
          patchedVersions: vuln.fixAvailable ? 'Available' : 'None',
          cve: vuln.via[0]?.cve,
          cvss: vuln.via[0]?.cvss,
          references: vuln.via[0]?.url ? [vuln.via[0].url] : []
        });
      }
    }

    return issues;
  }

  /**
   * Run pip-audit for Python dependencies
   * @private
   */
  async runPipAudit(projectDir, options = {}) {
    try {
      // Check if requirements.txt exists
      const requirementsPath = path.join(projectDir, 'requirements.txt');
      try {
        await fs.access(requirementsPath);
      } catch {
        this.logger?.debug('No requirements.txt found, skipping pip-audit');
        return [];
      }

      const result = await execAsync(
        'pip-audit --format json',
        {
          cwd: projectDir,
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60000
        }
      );

      const output = JSON.parse(result.stdout);
      return this.parsePipAuditResults(output);
    } catch (error) {
      if (error.stdout) {
        try {
          const output = JSON.parse(error.stdout);
          return this.parsePipAuditResults(output);
        } catch (parseError) {
          this.logger?.error('Failed to parse pip-audit output', {
            error: parseError.message
          });
        }
      }
      return [];
    }
  }

  /**
   * Parse pip-audit results
   * @private
   */
  parsePipAuditResults(output) {
    const issues = [];

    if (output.dependencies && Array.isArray(output.dependencies)) {
      for (const dep of output.dependencies) {
        if (dep.vulns && Array.isArray(dep.vulns)) {
          for (const vuln of dep.vulns) {
            issues.push({
              file: 'requirements.txt',
              line: 1,
              column: 1,
              severity: this.mapPipAuditSeverity(vuln.severity),
              rule: vuln.id,
              message: `${dep.name}: ${vuln.description || 'Security vulnerability'}`,
              category: 'security',
              scanner: 'pip-audit',
              package: dep.name,
              vulnerableVersion: dep.version,
              fixedVersions: vuln.fix_versions,
              references: vuln.aliases || []
            });
          }
        }
      }
    }

    return issues;
  }

  /**
   * Detect language from file extension
   * @private
   */
  detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python'
    };
    return languageMap[ext] || null;
  }

  /**
   * Check if file is a test file
   * @private
   */
  isTestFile(filePath) {
    const testPatterns = [
      /\.test\./,
      /\.spec\./,
      /__tests__\//,
      /\/tests?\//,
      /\.test$/,
      /\.spec$/
    ];
    return testPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Check if scanners are available for a language
   * @private
   */
  hasScannersForLanguage(available, language) {
    if (language === 'javascript' || language === 'typescript') {
      return available.semgrep || available.eslintSecurity;
    }
    if (language === 'python') {
      return available.bandit || available.semgrep;
    }
    return false;
  }

  /**
   * Normalize all scanner results to common format
   * @private
   */
  normalizeResults(results) {
    return results.map(result => ({
      file: result.file,
      line: result.line || 1,
      column: result.column || 1,
      severity: result.severity || STATIC_ANALYSIS.SEVERITY.WARNING,
      rule: result.rule || 'unknown',
      message: result.message || 'Security issue detected',
      category: 'security',
      scanner: result.scanner,
      cwe: result.cwe || null,
      owasp: result.owasp || null,
      confidence: result.confidence || null,
      fixable: result.fixable || false,
      remediation: result.remediation || result.moreInfo || null,
      references: result.references || [],
      package: result.package || null
    }));
  }

  /**
   * Map Semgrep severity to our standard
   * @private
   */
  mapSemgrepSeverity(severity) {
    const map = {
      'ERROR': STATIC_ANALYSIS.SEVERITY.CRITICAL,
      'WARNING': STATIC_ANALYSIS.SEVERITY.ERROR,
      'INFO': STATIC_ANALYSIS.SEVERITY.WARNING
    };
    return map[severity?.toUpperCase()] || STATIC_ANALYSIS.SEVERITY.WARNING;
  }

  /**
   * Map Bandit severity to our standard
   * @private
   */
  mapBanditSeverity(severity) {
    const map = {
      'HIGH': STATIC_ANALYSIS.SEVERITY.CRITICAL,
      'MEDIUM': STATIC_ANALYSIS.SEVERITY.ERROR,
      'LOW': STATIC_ANALYSIS.SEVERITY.WARNING
    };
    return map[severity?.toUpperCase()] || STATIC_ANALYSIS.SEVERITY.WARNING;
  }

  /**
   * Map ESLint severity to our standard
   * @private
   */
  mapESLintSeverity(severity) {
    return severity === 2 ? STATIC_ANALYSIS.SEVERITY.ERROR : STATIC_ANALYSIS.SEVERITY.WARNING;
  }

  /**
   * Map npm audit severity to our standard
   * @private
   */
  mapNpmSeverity(severity) {
    const map = {
      'critical': STATIC_ANALYSIS.SEVERITY.CRITICAL,
      'high': STATIC_ANALYSIS.SEVERITY.CRITICAL,
      'moderate': STATIC_ANALYSIS.SEVERITY.ERROR,
      'low': STATIC_ANALYSIS.SEVERITY.WARNING,
      'info': STATIC_ANALYSIS.SEVERITY.INFO
    };
    return map[severity?.toLowerCase()] || STATIC_ANALYSIS.SEVERITY.WARNING;
  }

  /**
   * Map pip-audit severity to our standard
   * @private
   */
  mapPipAuditSeverity(severity) {
    // pip-audit doesn't always provide severity, default to ERROR
    if (!severity) return STATIC_ANALYSIS.SEVERITY.ERROR;

    const map = {
      'critical': STATIC_ANALYSIS.SEVERITY.CRITICAL,
      'high': STATIC_ANALYSIS.SEVERITY.CRITICAL,
      'medium': STATIC_ANALYSIS.SEVERITY.ERROR,
      'low': STATIC_ANALYSIS.SEVERITY.WARNING
    };
    return map[severity?.toLowerCase()] || STATIC_ANALYSIS.SEVERITY.ERROR;
  }

  /**
   * Get scanner status report
   * @returns {Promise<Object>} Scanner availability and status
   */
  async getScannerStatus() {
    const available = await this.detectAvailableScanners();
    return {
      scanners: available,
      recommendations: this.getInstallRecommendations(available)
    };
  }

  /**
   * Get installation recommendations for missing scanners
   * @private
   */
  getInstallRecommendations(available) {
    const recommendations = [];

    if (!available.semgrep) {
      recommendations.push({
        scanner: 'Semgrep',
        reason: 'Multi-language SAST with extensive security rules',
        install: 'pip install semgrep OR use Docker: docker pull returntocorp/semgrep',
        priority: 'high'
      });
    }

    if (!available.bandit) {
      recommendations.push({
        scanner: 'Bandit',
        reason: 'Python security scanner',
        install: 'pip install bandit',
        priority: 'medium'
      });
    }

    if (!available.eslintSecurity) {
      recommendations.push({
        scanner: 'eslint-plugin-security',
        reason: 'JavaScript/TypeScript security rules',
        install: 'npm install --save-dev eslint-plugin-security',
        priority: 'medium'
      });
    }

    if (!available.pipAudit) {
      recommendations.push({
        scanner: 'pip-audit',
        reason: 'Python dependency vulnerability scanner',
        install: 'pip install pip-audit',
        priority: 'low'
      });
    }

    return recommendations;
  }
}

export default SecurityAnalyzer;
