/**
 * @file tools/dependencyResolverTool.js
 * @description Modern tool for resolving Node.js dependency conflicts by checking and updating to latest compatible versions
 */

import { promises as fs } from 'fs';
import path from 'path';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';

const exec = promisify(execCb);

/**
 * Configuration constants for the dependency resolver
 */
const RESOLVER_CONFIG = {
  DEFAULT_MODE: 'check',
  VALID_MODES: ['check', 'fix', 'auto'],
  NPM_COMMAND_TIMEOUT: 300000,        // 5 minutes for npm commands
  REGISTRY_TIMEOUT: 10000,             // 10 seconds for registry requests
  MAX_CONCURRENT_CHECKS: 5,            // Max parallel registry checks
  BACKUP_EXTENSION: '.backup.json',    // Backup file extension
  CREATE_BACKUPS: true,                // Always create backups
  RETRY_ATTEMPTS: 3,                   // Registry request retry attempts
  RETRY_DELAY: 1000,                   // Delay between retries (ms)
  MAX_DEPENDENCIES: 500,               // Safety limit
  NPM_REGISTRY_URL: 'https://registry.npmjs.org'
};

/**
 * DependencyResolverTool - Modern implementation
 * Resolves Node.js package dependency conflicts with improved security and reliability
 */
export class DependencyResolverTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    // Override tool ID to match documentation (with hyphen)
    this.id = 'dependency-resolver';
  }

  /**
   * Get tool description for agent system prompt
   * @returns {string} Formatted tool description
   */
  getDescription() {
    return `Tool: Dependency Resolver - Resolve Node.js package dependency conflicts

**Purpose:** Checks npm dependencies for updates and optionally updates package.json to latest compatible versions automatically.

**USAGE:**
\`\`\`json
{
  "toolId": "dependency-resolver",
  "parameters": {
    "path": "./my-project",
    "mode": "check",
    "includeDev": true
  }
}
\`\`\`

**Parameters:**
- **path** (string, optional): Path to project directory with package.json. Default: "."
- **mode** (string, optional): Operation mode. Options:
  - "check" - Only check for updates (default)
  - "fix" - Update package.json and run npm install
  - "auto" - Automatically fix all conflicts
- **includeDev** (boolean, optional): Include devDependencies. Default: true

**What It Does:**
- Checks npm registry for latest compatible versions
- Respects semver ranges (^, ~, >=, etc.)
- Creates automatic backups before modifications
- Runs npm install after updates (in fix/auto mode)
- Provides detailed update report

**Examples:**

1. Check for updates:
\`\`\`json
{
  "toolId": "dependency-resolver",
  "parameters": { "mode": "check" }
}
\`\`\`

2. Fix outdated dependencies:
\`\`\`json
{
  "toolId": "dependency-resolver",
  "parameters": { "path": "./my-project", "mode": "fix" }
}
\`\`\`

3. Auto-fix with devDependencies:
\`\`\`json
{
  "toolId": "dependency-resolver",
  "parameters": { "mode": "auto", "includeDev": true }
}
\`\`\`

**Notes:**
- Always creates backup (.backup.json) before modifications
- Network requests have timeout and retry logic
- npm install runs with timeout protection (5 minutes max)
- Supports complex semver ranges (||, &&, etc.)`;
  }

  /**
   * Parse tool parameters from raw content (XML or JSON)
   * @param {string|Object} content - Raw tool content or parsed object
   * @returns {Object} Parsed parameters
   */
  parseParameters(content) {
    // If already an object, validate and return
    if (typeof content === 'object' && content !== null) {
      return {
        path: content.path || '.',
        mode: content.mode || RESOLVER_CONFIG.DEFAULT_MODE,
        includeDev: content.includeDev !== undefined ? content.includeDev : true
      };
    }

    // Parse XML content
    if (typeof content === 'string') {
      // Try modern XML format first: <dependency-resolve>...</dependency-resolve>
      const modernPattern = /<dependency-resolve([^>]*)>([\s\S]*?)<\/dependency-resolve>/i;
      const modernMatch = modernPattern.exec(content);

      if (modernMatch) {
        const attributesStr = modernMatch[1];
        const innerContent = modernMatch[2];

        // Parse attributes from opening tag
        const pathAttr = /path=["']([^"']*)["']/i.exec(attributesStr);
        const modeAttr = /mode=["']([^"']*)["']/i.exec(attributesStr);
        const includeDevAttr = /include-dev=["']([^"']*)["']/i.exec(attributesStr);

        // Extract from inner content
        const pathPattern = /<path>(.*?)<\/path>/i;
        const pathMatch = pathPattern.exec(innerContent);

        const modePattern = /<mode>(.*?)<\/mode>/i;
        const modeMatch = modePattern.exec(innerContent);

        const includeDevPattern = /<include-dev>(.*?)<\/include-dev>/i;
        const includeDevMatch = includeDevPattern.exec(innerContent);

        // Content takes precedence over attributes
        const extractedPath = (pathMatch ? pathMatch[1].trim() : null) || (pathAttr ? pathAttr[1] : '.');
        const extractedMode = (modeMatch ? modeMatch[1].trim() : null) || (modeAttr ? modeAttr[1] : RESOLVER_CONFIG.DEFAULT_MODE);
        const extractedIncludeDev = (includeDevMatch ? includeDevMatch[1].trim() : null) || (includeDevAttr ? includeDevAttr[1] : 'true');

        return {
          path: extractedPath,
          mode: extractedMode,
          includeDev: this._parseBoolean(extractedIncludeDev, true)
        };
      }

      // Try legacy format: [resolve path="..." mode="..."]
      const legacyPattern = /\[resolve\s+([^\]]*)\]/i;
      const legacyMatch = legacyPattern.exec(content);

      if (legacyMatch) {
        const attrString = legacyMatch[1];

        // Parse attributes manually
        const pathAttr = /path=["']([^"']*)["']/i.exec(attrString);
        const modeAttr = /mode=["']([^"']*)["']/i.exec(attrString);
        const includeDevAttr = /include-dev=["']([^"']*)["']/i.exec(attrString);

        return {
          path: pathAttr ? pathAttr[1] : '.',
          mode: modeAttr ? modeAttr[1] : RESOLVER_CONFIG.DEFAULT_MODE,
          includeDev: this._parseBoolean(includeDevAttr ? includeDevAttr[1] : 'true', true)
        };
      }

      throw new Error('Invalid dependency-resolve format. Use <dependency-resolve> tags or JSON format.');
    }

    throw new Error('Invalid parameter format. Expected string (XML) or object (JSON).');
  }

  /**
   * Parse boolean from string or boolean
   * @param {any} value - Value to parse
   * @param {boolean} defaultValue - Default if undefined
   * @returns {boolean}
   * @private
   */
  _parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true' || value === '1';
    }
    return defaultValue;
  }

  /**
   * Validate parameters
   * @param {Object} params - Parameters to validate
   * @throws {Error} If validation fails
   * @private
   */
  _validateParameters(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('Parameters must be an object');
    }

    if (params.path && typeof params.path !== 'string') {
      throw new Error('path must be a string');
    }

    if (params.mode && !RESOLVER_CONFIG.VALID_MODES.includes(params.mode)) {
      throw new Error(`Invalid mode: ${params.mode}. Must be one of: ${RESOLVER_CONFIG.VALID_MODES.join(', ')}`);
    }

    if (params.includeDev !== undefined && typeof params.includeDev !== 'boolean') {
      throw new Error('includeDev must be a boolean');
    }
  }

  /**
   * Validate and resolve file path
   * @param {string} targetPath - Target path from parameters
   * @param {Object} context - Execution context
   * @returns {string} Resolved absolute path
   * @throws {Error} If path is invalid or inaccessible
   * @private
   */
  _resolveAndValidatePath(targetPath, context) {
    const { projectDir, directoryAccess } = context;

    // Determine working directory
    let workingDirectory = projectDir || process.cwd();

    if (directoryAccess && directoryAccess.workingDirectory) {
      workingDirectory = directoryAccess.workingDirectory;
    }

    // Resolve the target path
    const resolvedPath = path.isAbsolute(targetPath)
      ? path.normalize(targetPath)
      : path.normalize(path.join(workingDirectory, targetPath));

    // Security: Check for path traversal
    const realWorkingDir = path.normalize(workingDirectory);
    if (!resolvedPath.startsWith(realWorkingDir)) {
      throw new Error(`Path traversal detected: ${targetPath} resolves outside working directory`);
    }

    return resolvedPath;
  }

  /**
   * Create backup of package.json
   * @param {string} pkgPath - Path to package.json
   * @returns {Promise<string|null>} Backup file path or null if failed
   * @private
   */
  async _createBackup(pkgPath) {
    if (!RESOLVER_CONFIG.CREATE_BACKUPS) {
      return null;
    }

    try {
      const backupPath = pkgPath + RESOLVER_CONFIG.BACKUP_EXTENSION;
      await fs.copyFile(pkgPath, backupPath);
      this.logger?.info('Created backup', { backupPath });
      return backupPath;
    } catch (error) {
      this.logger?.warn('Failed to create backup', { error: error.message });
      return null;
    }
  }

  /**
   * Fetch package info from npm registry with retries
   * @param {string} packageName - Package name
   * @returns {Promise<Object|null>} Package data or null if failed
   * @private
   */
  async _fetchPackageInfo(packageName) {
    const url = `${RESOLVER_CONFIG.NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}`;

    for (let attempt = 1; attempt <= RESOLVER_CONFIG.RETRY_ATTEMPTS; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), RESOLVER_CONFIG.REGISTRY_TIMEOUT);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          if (response.status === 404) {
            this.logger?.warn(`Package not found: ${packageName}`);
            return null;
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Validate response structure
        if (!data || typeof data !== 'object' || !data['dist-tags']) {
          throw new Error('Invalid registry response format');
        }

        return data;

      } catch (error) {
        if (attempt < RESOLVER_CONFIG.RETRY_ATTEMPTS) {
          this.logger?.debug(`Retry ${attempt}/${RESOLVER_CONFIG.RETRY_ATTEMPTS} for ${packageName}`);
          await new Promise(resolve => setTimeout(resolve, RESOLVER_CONFIG.RETRY_DELAY * attempt));
        } else {
          this.logger?.error(`Failed to fetch ${packageName}:`, error.message);
          return null;
        }
      }
    }

    return null;
  }

  /**
   * Get latest compatible version for a package
   * Enhanced self-contained semver logic supporting:
   * - Caret ranges (^) with 0.x.y and 0.0.x special cases
   * - Tilde ranges (~)
   * - Comparison operators (>, >=, <, <=)
   * - X-ranges (4.x, 4.*, etc.)
   * - Pre-release versions
   * - Complex range expressions (AND/OR)
   * - Exact versions
   *
   * @param {string} packageName - Package name
   * @param {string} currentRange - Current version range
   * @returns {Promise<string|null>} Latest version or null if no update needed
   * @private
   */
  async _getLatestCompatibleVersion(packageName, currentRange) {
    const data = await this._fetchPackageInfo(packageName);

    if (!data) {
      return null;
    }

    const latest = data['dist-tags']?.latest;

    if (!latest) {
      return null;
    }

    // Parse latest version
    const latestParsed = this._parseVersion(latest);

    if (!latestParsed) {
      return null; // Can't parse latest
    }

    // Check if it's a complex range (AND/OR)
    if (this._isComplexRange(currentRange)) {
      const complexRange = this._parseComplexRange(currentRange);
      const isUpdateAvailable = this._satisfiesComplexRange(complexRange, latestParsed);

      if (isUpdateAvailable) {
        // For complex ranges, preserve the original format
        return latest;
      }
      return null;
    }

    // Simple range - parse normally
    const rangeInfo = this._parseVersionRange(currentRange);

    if (!rangeInfo) {
      return null; // Can't parse, skip
    }

    // Check if update is available and compatible
    const isUpdateAvailable = this._isUpdateAvailable(rangeInfo, latestParsed);

    if (isUpdateAvailable) {
      // Preserve the original prefix
      return rangeInfo.prefix + latest;
    }

    return null;
  }

  /**
   * Parse a version string into components including pre-release and build metadata
   * @param {string} version - Version string (e.g., "4.17.1", "1.0.0-alpha.1", "1.0.0+build.123")
   * @returns {Object|null} Parsed version or null
   * @private
   */
  _parseVersion(version) {
    // Match: major.minor.patch[-prerelease][+build]
    // Pre-release and build are optional
    const pattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
    const match = pattern.exec(version);

    if (!match) {
      // Fallback: try simple X.Y.Z pattern without pre-release/build
      const simpleMatch = version.match(/^(\d+)\.(\d+)\.(\d+)/);
      if (simpleMatch) {
        return {
          major: parseInt(simpleMatch[1], 10),
          minor: parseInt(simpleMatch[2], 10),
          patch: parseInt(simpleMatch[3], 10),
          prerelease: null,
          build: null
        };
      }
      return null;
    }

    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      prerelease: match[4] ? match[4].split('.') : null,
      build: match[5] || null
    };
  }

  /**
   * Compare two versions according to semver rules
   * Returns: < 0 if v1 < v2, 0 if v1 === v2, > 0 if v1 > v2
   * Handles pre-release versions correctly:
   * - 1.0.0 > 1.0.0-alpha (release > pre-release)
   * - 1.0.0-alpha < 1.0.0-beta (lexical comparison)
   * - 1.0.0-1 < 1.0.0-2 (numeric comparison)
   * @param {Object} v1 - First version
   * @param {Object} v2 - Second version
   * @returns {number} Comparison result
   * @private
   */
  _compareVersions(v1, v2) {
    // Compare major.minor.patch first
    if (v1.major !== v2.major) return v1.major - v2.major;
    if (v1.minor !== v2.minor) return v1.minor - v2.minor;
    if (v1.patch !== v2.patch) return v1.patch - v2.patch;

    // When major.minor.patch are equal, check pre-release
    // According to semver spec:
    // 1. Release version (no prerelease) > prerelease version
    // 2. If both have prerelease, compare identifiers

    if (!v1.prerelease && !v2.prerelease) {
      // Both are release versions, equal
      return 0;
    }

    if (!v1.prerelease && v2.prerelease) {
      // v1 is release, v2 is pre-release → v1 > v2
      return 1;
    }

    if (v1.prerelease && !v2.prerelease) {
      // v1 is pre-release, v2 is release → v1 < v2
      return -1;
    }

    // Both have pre-release, compare them
    return this._comparePrerelease(v1.prerelease, v2.prerelease);
  }

  /**
   * Compare pre-release version identifiers according to semver spec
   * Identifiers are compared as:
   * 1. Numeric identifiers are compared numerically
   * 2. Alphanumeric identifiers are compared lexically (ASCII sort)
   * 3. Numeric identifiers have lower precedence than alphanumeric
   * 4. Larger set of identifiers has higher precedence if all preceding are equal
   * @param {Array<string>} pre1 - First pre-release identifiers
   * @param {Array<string>} pre2 - Second pre-release identifiers
   * @returns {number} Comparison result
   * @private
   */
  _comparePrerelease(pre1, pre2) {
    const len = Math.max(pre1.length, pre2.length);

    for (let i = 0; i < len; i++) {
      // If one pre-release has fewer identifiers, it has lower precedence
      if (i >= pre1.length) return -1; // pre1 is shorter, pre1 < pre2
      if (i >= pre2.length) return 1;  // pre2 is shorter, pre1 > pre2

      const part1 = pre1[i];
      const part2 = pre2[i];

      // Check if parts are numeric
      const num1 = /^\d+$/.test(part1) ? parseInt(part1, 10) : null;
      const num2 = /^\d+$/.test(part2) ? parseInt(part2, 10) : null;

      // Both numeric: compare numerically
      if (num1 !== null && num2 !== null) {
        if (num1 !== num2) return num1 - num2;
        continue;
      }

      // One numeric, one alphanumeric: numeric has lower precedence
      if (num1 !== null && num2 === null) return -1;
      if (num1 === null && num2 !== null) return 1;

      // Both alphanumeric: compare lexically
      if (part1 < part2) return -1;
      if (part1 > part2) return 1;
    }

    // All identifiers equal
    return 0;
  }

  /**
   * Parse version range into components
   * @param {string} range - Version range (e.g., "^4.17.1", "~4.17.1", "<5.0.0", "4.x", "4.*")
   * @returns {Object|null} Parsed range or null
   * @private
   */
  _parseVersionRange(range) {
    const trimmed = range.trim();

    // Check for X-ranges first: 4.x, 4.*, 4.17.x, 4.17.*, or just 4
    // X-ranges use 'x', '*', or missing parts as wildcards
    const xRangePattern = /^(\d+|\*|x)(\.(\d+|\*|x))?(\.(\d+|\*|x))?$/i;
    const xMatch = xRangePattern.exec(trimmed);

    if (xMatch) {
      const majorStr = xMatch[1];
      const minorStr = xMatch[3];
      const patchStr = xMatch[5];

      // Check if any part is wildcard or missing (making it an X-range)
      const isXRange =
        majorStr === '*' || majorStr.toLowerCase() === 'x' ||
        minorStr === undefined || minorStr === '*' || minorStr.toLowerCase() === 'x' ||
        patchStr === undefined || patchStr === '*' || patchStr.toLowerCase() === 'x';

      if (isXRange) {
        return {
          prefix: '',
          operator: 'x-range',
          major: (majorStr === '*' || majorStr.toLowerCase() === 'x') ? null : parseInt(majorStr, 10),
          minor: (!minorStr || minorStr === '*' || minorStr.toLowerCase() === 'x') ? null : parseInt(minorStr, 10),
          patch: (!patchStr || patchStr === '*' || patchStr.toLowerCase() === 'x') ? null : parseInt(patchStr, 10),
          original: range
        };
      }
    }

    // Extract prefix and version for other operators
    let prefix = '';
    let version = trimmed;
    let operator = '=';

    if (trimmed.startsWith('^')) {
      prefix = '^';
      version = trimmed.slice(1);
      operator = '^';
    } else if (trimmed.startsWith('~')) {
      prefix = '~';
      version = trimmed.slice(1);
      operator = '~';
    } else if (trimmed.startsWith('>=')) {
      prefix = '>=';
      version = trimmed.slice(2).trim();
      operator = '>=';
    } else if (trimmed.startsWith('>')) {
      prefix = '>';
      version = trimmed.slice(1).trim();
      operator = '>';
    } else if (trimmed.startsWith('<=')) {
      prefix = '<=';
      version = trimmed.slice(2).trim();
      operator = '<=';
    } else if (trimmed.startsWith('<')) {
      prefix = '<';
      version = trimmed.slice(1).trim();
      operator = '<';
    }

    // Parse version X.Y.Z (including pre-release and build)
    const parsed = this._parseVersion(version);

    if (!parsed) {
      return null;
    }

    return {
      prefix,
      operator,
      major: parsed.major,
      minor: parsed.minor,
      patch: parsed.patch,
      prerelease: parsed.prerelease,
      build: parsed.build,
      original: range
    };
  }

  /**
   * Check if update is available and compatible with range
   * @param {Object} rangeInfo - Parsed range information
   * @param {Object} latest - Parsed latest version
   * @returns {boolean} True if update available
   * @private
   */
  _isUpdateAvailable(rangeInfo, latest) {
    const current = {
      major: rangeInfo.major,
      minor: rangeInfo.minor,
      patch: rangeInfo.patch,
      prerelease: rangeInfo.prerelease || null,
      build: rangeInfo.build || null
    };

    // Check based on operator
    switch (rangeInfo.operator) {
      case '^':
        return this._isCaretUpdateAvailable(current, latest);

      case '~':
        return this._isTildeUpdateAvailable(current, latest);

      case '>=':
      case '>':
        return this._isSimpleUpdateAvailable(current, latest);

      case '<':
      case '<=':
        return this._isLessThanUpdateAvailable(rangeInfo, latest);

      case 'x-range':
        return this._isXRangeUpdateAvailable(rangeInfo, latest);

      case '=':
      default:
        return this._isExactUpdateAvailable(current, latest);
    }
  }

  /**
   * Check if update is available for caret range (^)
   * Handles special cases:
   * - ^0.0.X → Only patch updates in 0.0.*
   * - ^0.X.Y → Only patch updates in 0.X.*
   * - ^X.Y.Z → Minor and patch updates in X.*.*
   * Also handles pre-release versions correctly
   * @private
   */
  _isCaretUpdateAvailable(current, latest) {
    // First check if latest is actually greater than current
    const cmp = this._compareVersions(latest, current);
    if (cmp <= 0) {
      // latest is not greater than current
      return false;
    }

    // ^0.0.X → Only patch updates in 0.0.*
    if (current.major === 0 && current.minor === 0) {
      return latest.major === 0 && latest.minor === 0;
    }

    // ^0.X.Y → Only patch updates in 0.X.*
    if (current.major === 0) {
      return latest.major === 0 && latest.minor === current.minor;
    }

    // ^X.Y.Z → Any minor/patch update in X.*.*
    return latest.major === current.major;
  }

  /**
   * Check if update is available for tilde range (~)
   * ~X.Y.Z → Only patch updates in X.Y.*
   * Also handles pre-release versions correctly
   * @private
   */
  _isTildeUpdateAvailable(current, latest) {
    // First check if latest is actually greater than current
    const cmp = this._compareVersions(latest, current);
    if (cmp <= 0) {
      return false;
    }

    // Must be same major and minor
    return latest.major === current.major && latest.minor === current.minor;
  }

  /**
   * Check if update is available for simple comparison (>, >=)
   * Also handles pre-release versions correctly
   * @private
   */
  _isSimpleUpdateAvailable(current, latest) {
    // Use proper version comparison that handles pre-release
    const cmp = this._compareVersions(latest, current);
    return cmp > 0;
  }

  /**
   * Check if update is available for exact version
   * Suggests update if latest is newer
   * @private
   */
  _isExactUpdateAvailable(current, latest) {
    return this._isSimpleUpdateAvailable(current, latest);
  }

  /**
   * Check if update is available for less than operators (<, <=)
   * <X.Y.Z → latest must be < range
   * <=X.Y.Z → latest must be <= range
   * Also handles pre-release versions correctly
   * @param {Object} rangeInfo - Parsed range information
   * @param {Object} latest - Parsed latest version
   * @returns {boolean} True if update satisfies constraint
   * @private
   */
  _isLessThanUpdateAvailable(rangeInfo, latest) {
    // Use proper version comparison that handles pre-release
    const cmp = this._compareVersions(latest, rangeInfo);

    if (rangeInfo.operator === '<') {
      // latest must be < range
      return cmp < 0;
    } else if (rangeInfo.operator === '<=') {
      // latest must be <= range
      return cmp <= 0;
    }
    return false;
  }

  /**
   * Check if update is available for X-ranges (4.x, 4.*, 4.17.x, etc.)
   * X-ranges match any version within the specified parts
   * 4.x or 4.* → any version 4.Y.Z
   * 4.17.x or 4.17.* → any version 4.17.Z
   * *.*.* → any version
   * @param {Object} rangeInfo - Parsed range information
   * @param {Object} latest - Parsed latest version
   * @returns {boolean} True if update is within range
   * @private
   */
  _isXRangeUpdateAvailable(rangeInfo, latest) {
    // Check major version if specified
    if (rangeInfo.major !== null && latest.major !== rangeInfo.major) {
      return false;
    }

    // Check minor version if specified
    if (rangeInfo.minor !== null && latest.minor !== rangeInfo.minor) {
      return false;
    }

    // Check patch version if specified
    if (rangeInfo.patch !== null && latest.patch !== rangeInfo.patch) {
      return false;
    }

    // All specified parts match, update is within range
    return true;
  }

  /**
   * Check if a range string is a complex range (contains AND/OR operators)
   * Complex ranges include:
   * - OR ranges: "^4.0.0 || ^5.0.0"
   * - AND ranges: ">=4.0.0 <5.0.0" (space-separated, multiple constraints)
   * @param {string} range - Version range string
   * @returns {boolean} True if complex range
   * @private
   */
  _isComplexRange(range) {
    // Check for OR operator
    if (range.includes('||')) {
      return true;
    }

    // Check for AND (multiple space-separated ranges)
    // Need to detect patterns like ">=4.0.0 <5.0.0"
    // But NOT "^4.0.0" or "~4.0.0" (single ranges with spaces after)
    const trimmed = range.trim();

    // Remove single operator prefixes to see what's left
    if (trimmed.startsWith('^') || trimmed.startsWith('~')) {
      return false; // Single caret or tilde range
    }

    // Split by whitespace and check if there are multiple parts
    const parts = trimmed.split(/\s+/).filter(p => p.length > 0);

    // If we have multiple parts, it might be a complex AND range
    // Examples: [">=4.0.0", "<5.0.0"], [">1.0.0", "<2.0.0"]
    if (parts.length > 1) {
      // Check if each part looks like a range operator
      const rangeOperators = /^(>=?|<=?|\^|~|[0-9])/;
      return parts.every(part => rangeOperators.test(part));
    }

    return false;
  }

  /**
   * Parse a complex range expression into a structured format
   * Handles:
   * - OR: "^4.0.0 || ^5.0.0" → {type: 'or', ranges: [...]}
   * - AND: ">=4.0.0 <5.0.0" → {type: 'and', ranges: [...]}
   * - Simple: "^4.0.0" → {type: 'simple', range: {...}}
   * @param {string} range - Complex range string
   * @returns {Object} Parsed complex range structure
   * @private
   */
  _parseComplexRange(range) {
    // Split by OR first (|| has precedence)
    if (range.includes('||')) {
      const orParts = range.split('||').map(p => p.trim());
      return {
        type: 'or',
        ranges: orParts.map(part => this._parseComplexRange(part))
      };
    }

    // Split by AND (space-separated, no || present)
    const andParts = range.trim().split(/\s+/).filter(p => p.length > 0);

    if (andParts.length > 1) {
      return {
        type: 'and',
        ranges: andParts.map(part => this._parseVersionRange(part))
      };
    }

    // Simple range
    return {
      type: 'simple',
      range: this._parseVersionRange(range)
    };
  }

  /**
   * Check if a version satisfies a single range
   * @param {Object} rangeInfo - Parsed range information
   * @param {Object} version - Parsed version to check
   * @returns {boolean} True if version satisfies range
   * @private
   */
  _satisfiesRange(rangeInfo, version) {
    if (!rangeInfo || !version) {
      return false;
    }

    // Use the existing _isUpdateAvailable logic which handles all operators
    return this._isUpdateAvailable(rangeInfo, version);
  }

  /**
   * Check if a version satisfies a complex range expression
   * Handles AND/OR logic recursively
   * @param {Object} complexRange - Parsed complex range structure
   * @param {Object} version - Parsed version to check
   * @returns {boolean} True if version satisfies the complex range
   * @private
   */
  _satisfiesComplexRange(complexRange, version) {
    if (!complexRange || !version) {
      return false;
    }

    switch (complexRange.type) {
      case 'simple':
        return this._satisfiesRange(complexRange.range, version);

      case 'and':
        // ALL ranges must be satisfied
        return complexRange.ranges.every(range => this._satisfiesRange(range, version));

      case 'or':
        // AT LEAST ONE range must be satisfied
        return complexRange.ranges.some(range => this._satisfiesComplexRange(range, version));

      default:
        return false;
    }
  }

  /**
   * Check dependencies in batches to avoid overwhelming the registry
   * @param {Object} dependencies - Map of package names to versions
   * @returns {Promise<Object>} Map of packages with available updates
   * @private
   */
  async _checkDependencies(dependencies) {
    const updates = {};
    const entries = Object.entries(dependencies);

    // Process in batches
    for (let i = 0; i < entries.length; i += RESOLVER_CONFIG.MAX_CONCURRENT_CHECKS) {
      const batch = entries.slice(i, i + RESOLVER_CONFIG.MAX_CONCURRENT_CHECKS);

      const promises = batch.map(async ([pkg, range]) => {
        try {
          const latest = await this._getLatestCompatibleVersion(pkg, range);

          if (latest) {
            // Preserve the range prefix (^, ~, etc.)
            const prefix = range.match(/^[\^~]/)?.[0] || '^';
            return { pkg, newVersion: `${prefix}${latest}`, oldVersion: range };
          }

          return null;
        } catch (error) {
          this.logger?.error(`Error checking ${pkg}:`, error.message);
          return null;
        }
      });

      const results = await Promise.all(promises);

      results.forEach(result => {
        if (result) {
          updates[result.pkg] = result.newVersion;
        }
      });
    }

    return updates;
  }

  /**
   * Execute tool with parsed parameters
   * @param {Object} params - Parsed parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(params, context = {}) {
    try {
      // Validate parameters
      this._validateParameters(params);

      const { path: targetPath, mode, includeDev } = params;
      const { projectDir, agentId, directoryAccess } = context;

      // Resolve and validate path
      const resolvedPath = this._resolveAndValidatePath(targetPath, context);
      const pkgPath = path.join(resolvedPath, 'package.json');

      this.logger?.info('Dependency resolver executing', {
        mode,
        resolvedPath,
        includeDev,
        agentId
      });

      const output = [];
      output.push(`🔍 Checking dependencies in: ${resolvedPath}`);
      output.push(`Mode: ${mode}`);

      // Check if package.json exists
      try {
        await fs.access(pkgPath);
      } catch {
        return {
          success: false,
          error: `No package.json found at: ${pkgPath}`,
          output: output.join('\n')
        };
      }

      // Read package.json
      output.push('\n📦 Reading package.json...');
      const pkgContent = await fs.readFile(pkgPath, 'utf-8');
      const pkgData = JSON.parse(pkgContent);

      // Collect dependencies
      const allDeps = { ...pkgData.dependencies };

      if (includeDev && pkgData.devDependencies) {
        Object.assign(allDeps, pkgData.devDependencies);
      }

      if (Object.keys(allDeps).length === 0) {
        return {
          success: true,
          mode,
          message: 'No dependencies found in package.json',
          statistics: {
            totalDependencies: 0,
            updatesAvailable: 0,
            updatesApplied: 0,
            errors: 0
          },
          output: output.join('\n')
        };
      }

      // Safety check
      if (Object.keys(allDeps).length > RESOLVER_CONFIG.MAX_DEPENDENCIES) {
        return {
          success: false,
          error: `Too many dependencies (${Object.keys(allDeps).length}), max allowed: ${RESOLVER_CONFIG.MAX_DEPENDENCIES}`,
          output: output.join('\n')
        };
      }

      output.push(`📊 Found ${Object.keys(allDeps).length} dependencies to check`);
      output.push('🌐 Querying npm registry for updates...');

      // Check for updates
      const updates = await this._checkDependencies(allDeps);

      output.push(`\n✅ Registry check complete`);
      output.push(`📈 Updates available: ${Object.keys(updates).length}`);

      if (Object.keys(updates).length > 0) {
        output.push('\n📋 Available updates:');
        for (const [pkg, newVersion] of Object.entries(updates)) {
          const oldVersion = allDeps[pkg];
          output.push(`  • ${pkg}: ${oldVersion} → ${newVersion}`);
        }
      } else {
        output.push('\n🎉 All dependencies are up-to-date!');
      }

      // Handle modes
      if (mode === 'check') {
        // Check mode - just report
        if (Object.keys(updates).length > 0) {
          output.push('\n💡 Run with mode="fix" or mode="auto" to apply updates');
        }

        return {
          success: true,
          mode: 'check',
          message: `Found ${Object.keys(updates).length} package(s) with available updates`,
          statistics: {
            totalDependencies: Object.keys(allDeps).length,
            updatesAvailable: Object.keys(updates).length,
            updatesApplied: 0,
            errors: 0
          },
          updates,
          output: output.join('\n')
        };
      }

      // Fix or auto mode - apply updates
      if ((mode === 'fix' || mode === 'auto') && Object.keys(updates).length > 0) {
        // Create backup
        output.push('\n💾 Creating backup of package.json...');
        const backupPath = await this._createBackup(pkgPath);

        if (backupPath) {
          output.push(`✅ Backup created: ${path.basename(backupPath)}`);
        } else {
          output.push('⚠️  Backup creation failed, continuing anyway...');
        }

        // Update package.json
        output.push('\n🛠  Updating package.json...');

        for (const [pkg, newVersion] of Object.entries(updates)) {
          if (pkgData.dependencies?.[pkg]) {
            pkgData.dependencies[pkg] = newVersion;
          }
          if (pkgData.devDependencies?.[pkg]) {
            pkgData.devDependencies[pkg] = newVersion;
          }
        }

        // Write updated package.json
        await fs.writeFile(pkgPath, JSON.stringify(pkgData, null, 2) + '\n');
        output.push('✅ package.json updated');

        // Run npm install
        output.push('\n📥 Installing dependencies (this may take a while)...');

        try {
          const { stdout, stderr } = await exec('npm install', {
            cwd: resolvedPath,
            timeout: RESOLVER_CONFIG.NPM_COMMAND_TIMEOUT,
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
          });

          if (stdout) {
            // Only show summary, not full output
            const lines = stdout.trim().split('\n');
            if (lines.length > 10) {
              output.push('  ' + lines.slice(-5).join('\n  '));
            } else {
              output.push('  ' + stdout.trim());
            }
          }

          if (stderr && !stderr.includes('npm WARN')) {
            output.push(`⚠️  ${stderr.trim()}`);
          }

          output.push('✅ Installation complete');

          // Show installed versions
          try {
            const { stdout: lsOutput } = await exec('npm ls --depth=0 --json', {
              cwd: resolvedPath,
              timeout: 30000
            });

            const lsData = JSON.parse(lsOutput);

            if (lsData.dependencies) {
              output.push('\n📦 Installed versions:');
              for (const pkg of Object.keys(updates)) {
                if (lsData.dependencies[pkg]) {
                  output.push(`  • ${pkg}@${lsData.dependencies[pkg].version}`);
                }
              }
            }
          } catch (lsError) {
            // npm ls might fail with peer dependency warnings - that's okay
            this.logger?.debug('npm ls failed:', lsError.message);
          }

          return {
            success: true,
            mode,
            message: `Successfully updated ${Object.keys(updates).length} package(s)`,
            statistics: {
              totalDependencies: Object.keys(allDeps).length,
              updatesAvailable: Object.keys(updates).length,
              updatesApplied: Object.keys(updates).length,
              errors: 0
            },
            updates,
            backupCreated: backupPath !== null,
            backupPath,
            output: output.join('\n')
          };

        } catch (installError) {
          output.push(`\n❌ npm install failed: ${installError.message}`);

          // Try to restore from backup
          if (backupPath) {
            try {
              await fs.copyFile(backupPath, pkgPath);
              output.push('🔄 Restored package.json from backup');
            } catch (restoreError) {
              output.push('⚠️  Failed to restore backup');
            }
          }

          return {
            success: false,
            mode,
            error: `npm install failed: ${installError.message}`,
            statistics: {
              totalDependencies: Object.keys(allDeps).length,
              updatesAvailable: Object.keys(updates).length,
              updatesApplied: 0,
              errors: 1
            },
            updates,
            backupCreated: backupPath !== null,
            output: output.join('\n')
          };
        }
      } else if (mode === 'fix' || mode === 'auto') {
        // No updates needed
        output.push('\n✨ No updates needed');

        return {
          success: true,
          mode,
          message: 'All dependencies are up-to-date',
          statistics: {
            totalDependencies: Object.keys(allDeps).length,
            updatesAvailable: 0,
            updatesApplied: 0,
            errors: 0
          },
          updates: {},
          output: output.join('\n')
        };
      }

    } catch (error) {
      this.logger?.error('Dependency resolver error:', error);

      return {
        success: false,
        error: error.message,
        statistics: {
          totalDependencies: 0,
          updatesAvailable: 0,
          updatesApplied: 0,
          errors: 1
        },
        output: error.message
      };
    }
  }
}

export default DependencyResolverTool;
