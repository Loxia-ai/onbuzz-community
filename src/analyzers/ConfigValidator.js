/**
 * ConfigValidator - Validate configuration files for errors and security issues
 *
 * Validates common configuration files:
 * - package.json, tsconfig.json (JSON Schema)
 * - Dockerfile (hadolint)
 * - docker-compose.yml (yamllint)
 * - Kubernetes YAML (checkov, yamllint)
 * - Terraform (checkov)
 * - .env files (secret detection)
 * - GitHub Actions workflows (yamllint)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { STATIC_ANALYSIS } from '../utilities/constants.js';

const execAsync = promisify(exec);

class ConfigValidator {
  constructor(logger = null) {
    this.logger = logger;
    this.availableScanners = null;
    this.scannerCache = new Map();
  }

  /**
   * Detect which validation tools are available
   * @returns {Promise<Object>} Available validators
   */
  async detectAvailableValidators() {
    // Return cached result if available
    if (this.availableScanners !== null) {
      return this.availableScanners;
    }

    const available = {
      checkov: false,
      hadolint: false,
      yamllint: false,
      jsonSchema: false
    };

    // Check for checkov (Infrastructure as Code scanner)
    try {
      await execAsync('checkov --version', { timeout: 5000 });
      available.checkov = true;
      this.logger?.debug('checkov detected');
    } catch (error) {
      this.logger?.debug('checkov not available', { error: error.message });
    }

    // Check for hadolint (Dockerfile linter)
    try {
      await execAsync('hadolint --version', { timeout: 5000 });
      available.hadolint = true;
      this.logger?.debug('hadolint detected');
    } catch (error) {
      this.logger?.debug('hadolint not available', { error: error.message });
    }

    // Check for yamllint (YAML linter)
    try {
      await execAsync('yamllint --version', { timeout: 5000 });
      available.yamllint = true;
      this.logger?.debug('yamllint detected');
    } catch (error) {
      this.logger?.debug('yamllint not available', { error: error.message });
    }

    // Check for ajv (JSON Schema validation - npm package)
    try {
      await import('ajv');
      available.jsonSchema = true;
      this.logger?.debug('JSON Schema validation available');
    } catch (error) {
      this.logger?.debug('ajv not available', { error: error.message });
    }

    this.availableScanners = available;
    return available;
  }

  /**
   * Validate a configuration file
   * @param {string} filePath - Path to config file
   * @param {Object} options - Validation options
   * @returns {Promise<Array>} Validation issues
   */
  async validate(filePath, options = {}) {
    const issues = [];
    const available = await this.detectAvailableValidators();
    const fileType = this.detectFileType(filePath);

    this.logger?.debug('Validating config file', { filePath, fileType });

    // Route to appropriate validator based on file type
    switch (fileType) {
      case 'dockerfile':
        if (available.hadolint) {
          const hadolintIssues = await this.validateDockerfile(filePath, options);
          issues.push(...hadolintIssues);
        }
        if (available.checkov) {
          const checkovIssues = await this.validateWithCheckov(filePath, 'dockerfile', options);
          issues.push(...checkovIssues);
        }
        break;

      case 'docker-compose':
        if (available.yamllint) {
          const yamlIssues = await this.validateYAML(filePath, options);
          issues.push(...yamlIssues);
        }
        if (available.checkov) {
          const checkovIssues = await this.validateWithCheckov(filePath, 'docker_compose', options);
          issues.push(...checkovIssues);
        }
        break;

      case 'kubernetes':
        if (available.yamllint) {
          const yamlIssues = await this.validateYAML(filePath, options);
          issues.push(...yamlIssues);
        }
        if (available.checkov) {
          const checkovIssues = await this.validateWithCheckov(filePath, 'kubernetes', options);
          issues.push(...checkovIssues);
        }
        break;

      case 'terraform':
        if (available.checkov) {
          const checkovIssues = await this.validateWithCheckov(filePath, 'terraform', options);
          issues.push(...checkovIssues);
        }
        break;

      case 'package.json':
        if (available.jsonSchema) {
          const schemaIssues = await this.validatePackageJson(filePath, options);
          issues.push(...schemaIssues);
        }
        break;

      case 'tsconfig.json':
        if (available.jsonSchema) {
          const schemaIssues = await this.validateTsConfig(filePath, options);
          issues.push(...schemaIssues);
        }
        break;

      case 'github-actions':
        if (available.yamllint) {
          const yamlIssues = await this.validateYAML(filePath, options);
          issues.push(...yamlIssues);
        }
        break;

      case 'env':
        // Always check .env files for secrets (no external tool needed)
        const secretIssues = await this.validateEnvFile(filePath, options);
        issues.push(...secretIssues);
        break;

      case 'yaml':
        if (available.yamllint) {
          const yamlIssues = await this.validateYAML(filePath, options);
          issues.push(...yamlIssues);
        }
        break;

      default:
        this.logger?.warn('Unknown config file type', { filePath, fileType });
        return [];
    }

    return this.normalizeResults(issues);
  }

  /**
   * Validate Dockerfile using hadolint
   * @private
   */
  async validateDockerfile(filePath, options = {}) {
    try {
      const result = await execAsync(
        `hadolint --format json "${filePath}"`,
        {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30000
        }
      );

      const output = JSON.parse(result.stdout);
      return this.parseHadolintResults(output, filePath);
    } catch (error) {
      // hadolint exits with non-zero if issues found
      if (error.stdout) {
        try {
          const output = JSON.parse(error.stdout);
          return this.parseHadolintResults(output, filePath);
        } catch (parseError) {
          this.logger?.error('Failed to parse hadolint output', {
            error: parseError.message
          });
        }
      }
      this.logger?.error('hadolint validation failed', { error: error.message });
      return [];
    }
  }

  /**
   * Parse hadolint results
   * @private
   */
  parseHadolintResults(output, filePath) {
    const issues = [];

    if (Array.isArray(output)) {
      for (const issue of output) {
        issues.push({
          file: filePath,
          line: issue.line || 1,
          column: issue.column || 1,
          severity: this.mapHadolintSeverity(issue.level),
          rule: issue.code,
          message: issue.message,
          category: 'dockerfile',
          validator: 'hadolint'
        });
      }
    }

    return issues;
  }

  /**
   * Validate YAML files using yamllint
   * @private
   */
  async validateYAML(filePath, options = {}) {
    try {
      const result = await execAsync(
        `yamllint -f parsable "${filePath}"`,
        {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30000
        }
      );

      return this.parseYamllintResults(result.stdout, filePath);
    } catch (error) {
      // yamllint exits with non-zero if issues found
      if (error.stdout) {
        return this.parseYamllintResults(error.stdout, filePath);
      }
      this.logger?.error('yamllint validation failed', { error: error.message });
      return [];
    }
  }

  /**
   * Parse yamllint results
   * @private
   */
  parseYamllintResults(output, filePath) {
    const issues = [];
    const lines = output.split('\n').filter(line => line.trim());

    for (const line of lines) {
      // Format: file:line:column: [level] message (rule)
      const match = line.match(/^(.+?):(\d+):(\d+):\s*\[(\w+)\]\s*(.+?)\s*\((.+?)\)/);
      if (match) {
        const [, file, lineNum, col, level, message, rule] = match;
        issues.push({
          file: filePath,
          line: parseInt(lineNum, 10),
          column: parseInt(col, 10),
          severity: this.mapYamllintSeverity(level),
          rule: rule,
          message: message,
          category: 'yaml',
          validator: 'yamllint'
        });
      }
    }

    return issues;
  }

  /**
   * Validate with checkov (Infrastructure as Code)
   * @private
   */
  async validateWithCheckov(filePath, framework, options = {}) {
    try {
      const result = await execAsync(
        `checkov -f "${filePath}" --framework ${framework} --output json --compact`,
        {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60000
        }
      );

      const output = JSON.parse(result.stdout);
      return this.parseCheckovResults(output, filePath);
    } catch (error) {
      // checkov exits with non-zero if issues found
      if (error.stdout) {
        try {
          const output = JSON.parse(error.stdout);
          return this.parseCheckovResults(output, filePath);
        } catch (parseError) {
          this.logger?.error('Failed to parse checkov output', {
            error: parseError.message
          });
        }
      }
      this.logger?.error('checkov validation failed', { error: error.message });
      return [];
    }
  }

  /**
   * Parse checkov results
   * @private
   */
  parseCheckovResults(output, filePath) {
    const issues = [];

    if (output.results && output.results.failed_checks) {
      for (const check of output.results.failed_checks) {
        issues.push({
          file: filePath,
          line: check.file_line_range ? check.file_line_range[0] : 1,
          column: 1,
          severity: this.mapCheckovSeverity(check.check_class),
          rule: check.check_id,
          message: check.check_name || check.check_id,
          category: 'security',
          validator: 'checkov',
          remediation: check.guideline,
          cwe: check.cwe,
          references: check.guideline ? [check.guideline] : []
        });
      }
    }

    return issues;
  }

  /**
   * Validate package.json using JSON Schema
   * @private
   */
  async validatePackageJson(filePath, options = {}) {
    try {
      const Ajv = (await import('ajv')).default;
      const addFormats = (await import('ajv-formats')).default;

      const content = await fs.readFile(filePath, 'utf-8');
      const packageJson = JSON.parse(content);

      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);

      // Basic package.json schema (simplified)
      const schema = {
        type: 'object',
        required: ['name', 'version'],
        properties: {
          name: { type: 'string', pattern: '^(?:@[a-z0-9-~][a-z0-9-._~]*/)?[a-z0-9-~][a-z0-9-._~]*$' },
          version: { type: 'string' },
          description: { type: 'string' },
          main: { type: 'string' },
          type: { type: 'string', enum: ['module', 'commonjs'] },
          scripts: { type: 'object' },
          dependencies: { type: 'object' },
          devDependencies: { type: 'object' }
        },
        additionalProperties: true
      };

      const validate = ajv.compile(schema);
      const valid = validate(packageJson);

      if (!valid && validate.errors) {
        return validate.errors.map(error => ({
          file: filePath,
          line: 1,
          column: 1,
          severity: STATIC_ANALYSIS.SEVERITY.ERROR,
          rule: 'json-schema',
          message: error.instancePath ? `${error.instancePath} ${error.message}` : `must have required property '${error.params.missingProperty}'`,
          category: 'validation',
          validator: 'json-schema'
        }));
      }

      return [];
    } catch (error) {
      this.logger?.error('package.json validation failed', { error: error.message });
      return [{
        file: filePath,
        line: 1,
        column: 1,
        severity: STATIC_ANALYSIS.SEVERITY.ERROR,
        rule: 'json-parse',
        message: `Invalid JSON: ${error.message}`,
        category: 'syntax',
        validator: 'json-parse'
      }];
    }
  }

  /**
   * Validate tsconfig.json using JSON Schema
   * @private
   */
  async validateTsConfig(filePath, options = {}) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const tsconfig = JSON.parse(content);

      const issues = [];

      // Check for common misconfigurations
      if (tsconfig.compilerOptions) {
        const opts = tsconfig.compilerOptions;

        // Check for strict mode
        if (!opts.strict) {
          issues.push({
            file: filePath,
            line: 1,
            column: 1,
            severity: STATIC_ANALYSIS.SEVERITY.WARNING,
            rule: 'strict-mode',
            message: 'Consider enabling "strict" mode for better type safety',
            category: 'best-practice',
            validator: 'tsconfig-validator'
          });
        }

        // Check for noImplicitAny
        if (opts.noImplicitAny === false) {
          issues.push({
            file: filePath,
            line: 1,
            column: 1,
            severity: STATIC_ANALYSIS.SEVERITY.WARNING,
            rule: 'no-implicit-any',
            message: 'Disabling noImplicitAny reduces type safety',
            category: 'best-practice',
            validator: 'tsconfig-validator'
          });
        }
      }

      return issues;
    } catch (error) {
      this.logger?.error('tsconfig.json validation failed', { error: error.message });
      return [{
        file: filePath,
        line: 1,
        column: 1,
        severity: STATIC_ANALYSIS.SEVERITY.ERROR,
        rule: 'json-parse',
        message: `Invalid JSON: ${error.message}`,
        category: 'syntax',
        validator: 'json-parse'
      }];
    }
  }

  /**
   * Validate .env file for security issues
   * @private
   */
  async validateEnvFile(filePath, options = {}) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const issues = [];
      const lines = content.split('\n');

      const secretPatterns = [
        { pattern: /password|passwd|pwd/i, name: 'password' },
        { pattern: /api[_-]?key/i, name: 'API key' },
        { pattern: /secret/i, name: 'secret' },
        { pattern: /token/i, name: 'token' },
        { pattern: /private[_-]?key/i, name: 'private key' },
        { pattern: /aws[_-]?access/i, name: 'AWS credentials' }
      ];

      lines.forEach((line, index) => {
        const trimmed = line.trim();

        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) return;

        // Check for hardcoded values (not references to other env vars)
        if (trimmed.includes('=')) {
          const [key, value] = trimmed.split('=');
          const keyLower = key.toLowerCase();
          const valueTrimmed = value?.trim() || '';

          // Check if value looks like a real secret (not empty, not a placeholder)
          const looksLikeSecret = valueTrimmed &&
                                  valueTrimmed !== '' &&
                                  !valueTrimmed.startsWith('$') && // Not env var reference
                                  valueTrimmed !== 'your-key-here' &&
                                  valueTrimmed !== 'changeme' &&
                                  valueTrimmed.length > 5;

          if (looksLikeSecret) {
            for (const { pattern, name } of secretPatterns) {
              if (pattern.test(keyLower)) {
                issues.push({
                  file: filePath,
                  line: index + 1,
                  column: 1,
                  severity: STATIC_ANALYSIS.SEVERITY.CRITICAL,
                  rule: 'hardcoded-secret',
                  message: `Potential hardcoded ${name} detected in .env file`,
                  category: 'security',
                  validator: 'env-validator',
                  remediation: 'Use environment-specific .env files and add .env to .gitignore'
                });
                break;
              }
            }
          }
        }
      });

      return issues;
    } catch (error) {
      this.logger?.error('.env validation failed', { error: error.message });
      return [];
    }
  }

  /**
   * Detect configuration file type
   * @private
   */
  detectFileType(filePath) {
    const basename = path.basename(filePath).toLowerCase();
    const dirname = path.dirname(filePath);

    // Exact filename matches
    if (basename === 'dockerfile') return 'dockerfile';
    if (basename === 'docker-compose.yml' || basename === 'docker-compose.yaml') return 'docker-compose';
    if (basename === 'package.json') return 'package.json';
    if (basename === 'tsconfig.json') return 'tsconfig.json';
    if (basename === '.env' || basename.endsWith('.env')) return 'env';

    // Path-based detection
    if (dirname.includes('.github/workflows')) return 'github-actions';
    if (dirname.includes('kubernetes') || dirname.includes('k8s')) return 'kubernetes';

    // Extension-based detection
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.tf' || ext === '.tfvars') return 'terraform';
    if (ext === '.yml' || ext === '.yaml') return 'yaml';
    if (ext === '.json') return 'json';

    return 'unknown';
  }

  /**
   * Normalize all validator results to common format
   * @private
   */
  normalizeResults(results) {
    return results.map(result => ({
      file: result.file,
      line: result.line || 1,
      column: result.column || 1,
      severity: result.severity || STATIC_ANALYSIS.SEVERITY.WARNING,
      rule: result.rule || 'unknown',
      message: result.message || 'Validation issue detected',
      category: result.category || 'validation',
      validator: result.validator,
      cwe: result.cwe || null,
      remediation: result.remediation || null,
      references: result.references || []
    }));
  }

  /**
   * Map hadolint severity to our standard
   * @private
   */
  mapHadolintSeverity(level) {
    const map = {
      'error': STATIC_ANALYSIS.SEVERITY.ERROR,
      'warning': STATIC_ANALYSIS.SEVERITY.WARNING,
      'info': STATIC_ANALYSIS.SEVERITY.INFO,
      'style': STATIC_ANALYSIS.SEVERITY.INFO
    };
    return map[level?.toLowerCase()] || STATIC_ANALYSIS.SEVERITY.WARNING;
  }

  /**
   * Map yamllint severity to our standard
   * @private
   */
  mapYamllintSeverity(level) {
    const map = {
      'error': STATIC_ANALYSIS.SEVERITY.ERROR,
      'warning': STATIC_ANALYSIS.SEVERITY.WARNING
    };
    return map[level?.toLowerCase()] || STATIC_ANALYSIS.SEVERITY.WARNING;
  }

  /**
   * Map checkov severity to our standard
   * @private
   */
  mapCheckovSeverity(checkClass) {
    // checkov uses check_class to categorize severity
    // Most security issues are treated as errors
    return STATIC_ANALYSIS.SEVERITY.ERROR;
  }

  /**
   * Get validator status report
   * @returns {Promise<Object>} Validator availability and status
   */
  async getValidatorStatus() {
    const available = await this.detectAvailableValidators();
    return {
      validators: available,
      recommendations: this.getInstallRecommendations(available)
    };
  }

  /**
   * Get installation recommendations for missing validators
   * @private
   */
  getInstallRecommendations(available) {
    const recommendations = [];

    if (!available.checkov) {
      recommendations.push({
        validator: 'checkov',
        reason: 'Infrastructure as Code security scanning (Docker, Kubernetes, Terraform)',
        install: 'pip install checkov',
        priority: 'high'
      });
    }

    if (!available.hadolint) {
      recommendations.push({
        validator: 'hadolint',
        reason: 'Dockerfile linting and best practices',
        install: 'Download from https://github.com/hadolint/hadolint/releases',
        priority: 'high'
      });
    }

    if (!available.yamllint) {
      recommendations.push({
        validator: 'yamllint',
        reason: 'YAML file validation',
        install: 'pip install yamllint',
        priority: 'medium'
      });
    }

    if (!available.jsonSchema) {
      recommendations.push({
        validator: 'ajv (JSON Schema)',
        reason: 'JSON configuration validation',
        install: 'npm install ajv ajv-formats',
        priority: 'medium'
      });
    }

    return recommendations;
  }
}

export default ConfigValidator;
