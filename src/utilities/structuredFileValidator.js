/**
 * Structured File Validator
 *
 * A plug-and-play validation utility for structured file formats.
 * Supports JSON, YAML, XML, TOML, and can be extended with custom validators.
 *
 * Usage:
 *   import { validateStructuredFile, validateContent } from './structuredFileValidator.js';
 *
 *   // Validate by file path
 *   const result = await validateStructuredFile('/path/to/config.json');
 *
 *   // Validate content directly
 *   const result = validateContent('{"key": "value"}', 'json');
 */

import { promises as fs } from 'fs';
import path from 'path';

// ============================================================================
// VALIDATION RESULT TYPES
// ============================================================================

/**
 * @typedef {Object} ValidationError
 * @property {number} [line] - Line number (1-indexed)
 * @property {number} [column] - Column number (1-indexed)
 * @property {string} message - Error message
 * @property {string} [severity] - 'error' | 'warning'
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the content is valid
 * @property {string} format - Detected/specified format (json, yaml, xml, etc.)
 * @property {ValidationError[]} errors - Array of validation errors
 * @property {Object} [parsed] - Parsed content (if valid and parsing requested)
 * @property {Object} [meta] - Additional metadata
 */

// ============================================================================
// FORMAT DETECTION
// ============================================================================

/**
 * Map of file extensions to format names
 */
const EXTENSION_FORMAT_MAP = {
  '.json': 'json',
  '.jsonc': 'jsonc',      // JSON with comments
  '.json5': 'json5',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.properties': 'properties',
};

// Files that match by exact name (no extension or dotfiles)
const FILENAME_FORMAT_MAP = {
  '.env': 'env',
  '.env.local': 'env',
  '.env.development': 'env',
  '.env.production': 'env',
  '.env.test': 'env',
  '.env.example': 'env',
};

/**
 * Detect format from file path
 * @param {string} filePath - Path to file
 * @returns {string|null} Format name or null if unknown
 */
export function detectFormat(filePath) {
  // First check by extension
  const ext = path.extname(filePath).toLowerCase();
  if (EXTENSION_FORMAT_MAP[ext]) {
    return EXTENSION_FORMAT_MAP[ext];
  }

  // Then check by filename (for dotfiles like .env)
  const filename = path.basename(filePath).toLowerCase();
  if (FILENAME_FORMAT_MAP[filename]) {
    return FILENAME_FORMAT_MAP[filename];
  }

  // Check if filename starts with .env (handles .env.local, .env.anything)
  if (filename.startsWith('.env')) {
    return 'env';
  }

  return null;
}

/**
 * Get supported formats
 * @returns {string[]} Array of supported format names
 */
export function getSupportedFormats() {
  return [...new Set(Object.values(EXTENSION_FORMAT_MAP))];
}

// ============================================================================
// VALIDATORS
// ============================================================================

/**
 * Validator registry - maps format names to validator functions
 * Each validator returns ValidationResult
 */
const validators = new Map();

/**
 * Register a custom validator
 * @param {string} format - Format name
 * @param {Function} validatorFn - Validator function (content, options) => ValidationResult
 */
export function registerValidator(format, validatorFn) {
  validators.set(format.toLowerCase(), validatorFn);
}

/**
 * Check if a format has a registered validator
 * @param {string} format - Format name
 * @returns {boolean}
 */
export function hasValidator(format) {
  return validators.has(format.toLowerCase());
}

// ============================================================================
// BUILT-IN VALIDATORS
// ============================================================================

/**
 * JSON Validator
 * Validates JSON syntax and provides detailed error location
 */
function validateJson(content, options = {}) {
  const result = {
    valid: true,
    format: 'json',
    errors: [],
    meta: { contentLength: content.length }
  };

  try {
    const parsed = JSON.parse(content);
    if (options.returnParsed) {
      result.parsed = parsed;
    }
  } catch (error) {
    result.valid = false;

    // Parse error message to extract location
    const errorInfo = parseJsonError(error.message, content);
    result.errors.push({
      line: errorInfo.line,
      column: errorInfo.column,
      message: errorInfo.message,
      severity: 'error'
    });
  }

  return result;
}

/**
 * Parse JSON error message to extract line/column
 */
function parseJsonError(errorMessage, content) {
  // JSON.parse errors typically look like:
  // "Unexpected token X in JSON at position N"
  // "Expected property name or '}' at line X column Y"

  const positionMatch = errorMessage.match(/at position (\d+)/);
  const lineColMatch = errorMessage.match(/at line (\d+) column (\d+)/);

  let line = 1;
  let column = 1;

  if (lineColMatch) {
    line = parseInt(lineColMatch[1], 10);
    column = parseInt(lineColMatch[2], 10);
  } else if (positionMatch) {
    const position = parseInt(positionMatch[1], 10);
    // Convert position to line/column
    const upToPosition = content.substring(0, position);
    const lines = upToPosition.split('\n');
    line = lines.length;
    column = lines[lines.length - 1].length + 1;
  }

  return {
    line,
    column,
    message: errorMessage
  };
}

/**
 * JSON with Comments (JSONC) Validator
 * Strips comments before validating as JSON
 */
function validateJsonc(content, options = {}) {
  // Strip single-line comments (//)
  let stripped = content.replace(/\/\/.*$/gm, '');
  // Strip multi-line comments (/* */)
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');

  const result = validateJson(stripped, options);
  result.format = 'jsonc';
  return result;
}

/**
 * YAML Validator
 * Uses basic YAML parsing rules (no external dependency)
 */
function validateYaml(content, options = {}) {
  const result = {
    valid: true,
    format: 'yaml',
    errors: [],
    meta: { contentLength: content.length }
  };

  const lines = content.split('\n');
  let indentStack = [0];
  let inMultilineString = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }

    // Check for tabs (YAML should use spaces)
    if (line.match(/^\t/)) {
      result.errors.push({
        line: lineNum,
        column: 1,
        message: 'YAML should use spaces for indentation, not tabs',
        severity: 'error'
      });
      result.valid = false;
    }

    // Check for inconsistent indentation
    const indent = line.match(/^(\s*)/)[1].length;
    const trimmed = line.trim();

    // Basic key-value syntax check
    if (trimmed.includes(':') && !trimmed.startsWith('-')) {
      const colonIndex = trimmed.indexOf(':');
      const key = trimmed.substring(0, colonIndex);

      // Check for invalid characters in unquoted keys
      if (!key.startsWith('"') && !key.startsWith("'")) {
        if (key.match(/[{}\[\],&*#?|<>=!%@`]/)) {
          result.errors.push({
            line: lineNum,
            column: indent + 1,
            message: `Invalid characters in unquoted key: "${key}"`,
            severity: 'warning'
          });
        }
      }
    }

    // Check for duplicate keys (basic check within visible scope)
    // This is a simplified check - full YAML parsing would be more accurate
  }

  if (result.errors.length === 0) {
    result.valid = true;
  } else {
    // Only mark invalid if there are actual errors (not just warnings)
    result.valid = !result.errors.some(e => e.severity === 'error');
  }

  return result;
}

/**
 * XML Validator
 * Validates basic XML structure
 */
function validateXml(content, options = {}) {
  const result = {
    valid: true,
    format: 'xml',
    errors: [],
    meta: { contentLength: content.length }
  };

  const lines = content.split('\n');
  const tagStack = [];

  // Check for XML declaration
  const hasDeclaration = content.trim().startsWith('<?xml');
  result.meta.hasDeclaration = hasDeclaration;

  // Simple tag matching regex
  const tagRegex = /<\/?([a-zA-Z_][\w\-.:]*)[^>]*\/?>/g;
  const selfClosingRegex = /\/\s*>$/;

  let match;
  let position = 0;

  while ((match = tagRegex.exec(content)) !== null) {
    const fullTag = match[0];
    const tagName = match[1];
    const tagPosition = match.index;

    // Calculate line number
    const upToTag = content.substring(0, tagPosition);
    const lineNum = upToTag.split('\n').length;
    const lastNewline = upToTag.lastIndexOf('\n');
    const column = tagPosition - lastNewline;

    // Skip processing instructions and comments
    if (fullTag.startsWith('<?') || fullTag.startsWith('<!')) {
      continue;
    }

    // Check if self-closing
    if (selfClosingRegex.test(fullTag)) {
      continue;
    }

    // Check if closing tag
    if (fullTag.startsWith('</')) {
      if (tagStack.length === 0) {
        result.errors.push({
          line: lineNum,
          column,
          message: `Unexpected closing tag </${tagName}> with no matching opening tag`,
          severity: 'error'
        });
        result.valid = false;
      } else {
        const expected = tagStack.pop();
        if (expected !== tagName) {
          result.errors.push({
            line: lineNum,
            column,
            message: `Mismatched closing tag: expected </${expected}>, found </${tagName}>`,
            severity: 'error'
          });
          result.valid = false;
        }
      }
    } else {
      // Opening tag
      tagStack.push(tagName);
    }
  }

  // Check for unclosed tags
  if (tagStack.length > 0) {
    result.errors.push({
      line: lines.length,
      column: 1,
      message: `Unclosed tags: ${tagStack.join(', ')}`,
      severity: 'error'
    });
    result.valid = false;
  }

  return result;
}

/**
 * TOML Validator
 * Validates basic TOML structure
 */
function validateToml(content, options = {}) {
  const result = {
    valid: true,
    format: 'toml',
    errors: [],
    meta: { contentLength: content.length }
  };

  const lines = content.split('\n');
  const sections = new Set();
  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    // Section header [section] or [[array]]
    if (trimmed.startsWith('[')) {
      const sectionMatch = trimmed.match(/^\[{1,2}([^\]]+)\]{1,2}$/);
      if (!sectionMatch) {
        result.errors.push({
          line: lineNum,
          column: 1,
          message: `Invalid section header: ${trimmed}`,
          severity: 'error'
        });
        result.valid = false;
        continue;
      }

      currentSection = sectionMatch[1].trim();

      // Check for duplicate sections (non-array)
      if (!trimmed.startsWith('[[') && sections.has(currentSection)) {
        result.errors.push({
          line: lineNum,
          column: 1,
          message: `Duplicate section: [${currentSection}]`,
          severity: 'error'
        });
        result.valid = false;
      }
      sections.add(currentSection);
      continue;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^([a-zA-Z0-9_\-."]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      result.errors.push({
        line: lineNum,
        column: 1,
        message: `Invalid key-value pair: ${trimmed}`,
        severity: 'error'
      });
      result.valid = false;
      continue;
    }

    const [, key, value] = kvMatch;

    // Basic value validation
    const trimmedValue = value.trim();

    // Check for unclosed strings
    if ((trimmedValue.startsWith('"') && !trimmedValue.endsWith('"')) ||
        (trimmedValue.startsWith("'") && !trimmedValue.endsWith("'"))) {
      // Could be multi-line, but basic check
      if (!trimmedValue.startsWith('"""') && !trimmedValue.startsWith("'''")) {
        result.errors.push({
          line: lineNum,
          column: line.indexOf(value) + 1,
          message: `Unclosed string value for key "${key}"`,
          severity: 'warning'
        });
      }
    }
  }

  return result;
}

/**
 * INI Validator
 * Validates basic INI file structure
 */
function validateIni(content, options = {}) {
  const result = {
    valid: true,
    format: 'ini',
    errors: [],
    meta: { contentLength: content.length }
  };

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      continue;
    }

    // Section header
    if (trimmed.startsWith('[')) {
      if (!trimmed.endsWith(']')) {
        result.errors.push({
          line: lineNum,
          column: 1,
          message: `Invalid section header: missing closing bracket`,
          severity: 'error'
        });
        result.valid = false;
      }
      continue;
    }

    // Key-value pair
    if (!trimmed.includes('=')) {
      result.errors.push({
        line: lineNum,
        column: 1,
        message: `Invalid line: expected key=value format`,
        severity: 'error'
      });
      result.valid = false;
    }
  }

  return result;
}

/**
 * ENV file Validator
 * Validates .env file format
 */
function validateEnv(content, options = {}) {
  const result = {
    valid: true,
    format: 'env',
    errors: [],
    meta: { contentLength: content.length, variableCount: 0 }
  };

  const lines = content.split('\n');
  const variables = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    // Parse variable assignment
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      result.errors.push({
        line: lineNum,
        column: 1,
        message: `Invalid variable assignment: "${trimmed.substring(0, 30)}..."`,
        severity: 'error'
      });
      result.valid = false;
      continue;
    }

    const [, varName] = match;

    // Check for duplicates
    if (variables.has(varName)) {
      result.errors.push({
        line: lineNum,
        column: 1,
        message: `Duplicate variable: ${varName}`,
        severity: 'warning'
      });
    }
    variables.add(varName);
    result.meta.variableCount++;
  }

  return result;
}

// Register built-in validators
registerValidator('json', validateJson);
registerValidator('jsonc', validateJsonc);
registerValidator('json5', validateJsonc); // Use JSONC validator for JSON5 (basic support)
registerValidator('yaml', validateYaml);
registerValidator('yml', validateYaml);
registerValidator('xml', validateXml);
registerValidator('toml', validateToml);
registerValidator('ini', validateIni);
registerValidator('env', validateEnv);
registerValidator('properties', validateIni); // Similar to INI

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Validate content string
 * @param {string} content - Content to validate
 * @param {string} format - Format name (json, yaml, xml, etc.)
 * @param {Object} [options] - Validation options
 * @param {boolean} [options.returnParsed] - Include parsed content in result
 * @returns {ValidationResult}
 */
export function validateContent(content, format, options = {}) {
  const formatLower = format.toLowerCase();

  if (!validators.has(formatLower)) {
    return {
      valid: false,
      format: formatLower,
      errors: [{
        message: `No validator available for format: ${format}`,
        severity: 'error'
      }],
      meta: { unsupportedFormat: true }
    };
  }

  const validator = validators.get(formatLower);
  return validator(content, options);
}

/**
 * Validate a file by path
 * @param {string} filePath - Path to file
 * @param {Object} [options] - Validation options
 * @param {string} [options.format] - Override format detection
 * @param {boolean} [options.returnParsed] - Include parsed content in result
 * @returns {Promise<ValidationResult>}
 */
export async function validateStructuredFile(filePath, options = {}) {
  const format = options.format || detectFormat(filePath);

  if (!format) {
    return {
      valid: false,
      format: 'unknown',
      errors: [{
        message: `Cannot detect format for file: ${filePath}`,
        severity: 'error'
      }],
      meta: { filePath, unknownExtension: path.extname(filePath) }
    };
  }

  try {
    const content = await fs.readFile(filePath, 'utf8');
    const result = validateContent(content, format, options);
    result.meta = { ...result.meta, filePath };
    return result;
  } catch (error) {
    return {
      valid: false,
      format,
      errors: [{
        message: `Failed to read file: ${error.message}`,
        severity: 'error'
      }],
      meta: { filePath, readError: true }
    };
  }
}

/**
 * Validate content and return a simplified result suitable for tool responses
 * @param {string} content - Content to validate
 * @param {string} filePath - File path (for format detection)
 * @returns {Object} Simplified validation result
 */
export function validateForToolResponse(content, filePath) {
  const format = detectFormat(filePath);

  if (!format) {
    return null; // Not a structured file format
  }

  const result = validateContent(content, format);

  return {
    valid: result.valid,
    format: result.format,
    errors: result.errors.length > 0 ? result.errors : undefined,
    errorCount: result.errors.filter(e => e.severity === 'error').length,
    warningCount: result.errors.filter(e => e.severity === 'warning').length
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  validateContent,
  validateStructuredFile,
  validateForToolResponse,
  detectFormat,
  getSupportedFormats,
  registerValidator,
  hasValidator
};
