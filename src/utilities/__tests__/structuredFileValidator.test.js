import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock fs for validateStructuredFile
jest.unstable_mockModule('fs', () => ({
  promises: {
    readFile: jest.fn()
  }
}));

const {
  detectFormat,
  getSupportedFormats,
  validateContent,
  validateStructuredFile,
  validateForToolResponse,
  registerValidator,
  hasValidator,
  default: validator
} = await import('../structuredFileValidator.js');

const { promises: mockFs } = await import('fs');

describe('detectFormat', () => {
  test('returns json for .json files', () => {
    expect(detectFormat('config.json')).toBe('json');
    expect(detectFormat('/some/path/data.json')).toBe('json');
  });

  test('returns yaml for .yml and .yaml files', () => {
    expect(detectFormat('config.yml')).toBe('yaml');
    expect(detectFormat('config.yaml')).toBe('yaml');
  });

  test('returns xml for .xml files', () => {
    expect(detectFormat('data.xml')).toBe('xml');
  });

  test('returns toml for .toml files', () => {
    expect(detectFormat('config.toml')).toBe('toml');
  });

  test('returns ini for .ini files', () => {
    expect(detectFormat('settings.ini')).toBe('ini');
  });

  test('returns env for .env and .env.* files', () => {
    expect(detectFormat('.env')).toBe('env');
    expect(detectFormat('.env.local')).toBe('env');
    expect(detectFormat('.env.production')).toBe('env');
    expect(detectFormat('.env.custom')).toBe('env');
  });

  test('returns properties for .properties files', () => {
    expect(detectFormat('app.properties')).toBe('properties');
  });

  test('returns null for unknown extensions', () => {
    expect(detectFormat('readme.txt')).toBeNull();
    expect(detectFormat('script.py')).toBeNull();
  });
});

describe('getSupportedFormats', () => {
  test('returns array including all built-in formats', () => {
    const formats = getSupportedFormats();
    expect(Array.isArray(formats)).toBe(true);
    expect(formats).toContain('json');
    expect(formats).toContain('yaml');
    expect(formats).toContain('xml');
    expect(formats).toContain('toml');
    expect(formats).toContain('ini');
  });

  test('returns unique format names', () => {
    const formats = getSupportedFormats();
    const unique = [...new Set(formats)];
    expect(formats.length).toBe(unique.length);
  });
});

describe('validateContent - JSON', () => {
  test('valid JSON returns { valid: true }', () => {
    const result = validateContent('{"key": "value"}', 'json');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('json');
    expect(result.errors).toHaveLength(0);
  });

  test('invalid JSON returns { valid: false } with errors', () => {
    const result = validateContent('{key: value}', 'json');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toHaveProperty('message');
    expect(result.errors[0].severity).toBe('error');
  });

  test('JSON with returnParsed option includes parsed data', () => {
    const result = validateContent('{"a": 1}', 'json', { returnParsed: true });
    expect(result.valid).toBe(true);
    expect(result.parsed).toEqual({ a: 1 });
  });
});

describe('validateContent - YAML', () => {
  test('valid YAML returns { valid: true }', () => {
    const result = validateContent('key: value\nother: data', 'yaml');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('yaml');
  });

  test('YAML with tabs returns error', () => {
    const result = validateContent('\tkey: value', 'yaml');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('tabs'))).toBe(true);
  });
});

describe('validateContent - XML', () => {
  test('valid XML returns { valid: true }', () => {
    const result = validateContent('<root><child>text</child></root>', 'xml');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('xml');
  });

  test('XML with mismatched tags returns error', () => {
    const result = validateContent('<root><child>text</wrong></root>', 'xml');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Mismatched'))).toBe(true);
  });

  test('XML with unclosed tags returns error', () => {
    const result = validateContent('<root><child></root>', 'xml');
    expect(result.valid).toBe(false);
  });

  test('self-closing XML tags are valid', () => {
    const result = validateContent('<root><br/></root>', 'xml');
    expect(result.valid).toBe(true);
  });
});

describe('validateContent - TOML', () => {
  test('valid TOML returns { valid: true }', () => {
    const result = validateContent('[section]\nkey = "value"', 'toml');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('toml');
  });

  test('TOML with invalid section header returns error', () => {
    const result = validateContent('[bad section', 'toml');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Invalid section header'))).toBe(true);
  });

  test('TOML with duplicate sections returns error', () => {
    const result = validateContent('[section]\nkey = "a"\n[section]\nkey = "b"', 'toml');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Duplicate section'))).toBe(true);
  });
});

describe('validateContent - INI/ENV/properties', () => {
  test('valid INI returns { valid: true }', () => {
    const result = validateContent('[section]\nkey=value', 'ini');
    expect(result.valid).toBe(true);
  });

  test('INI with missing closing bracket returns error', () => {
    const result = validateContent('[section\nkey=value', 'ini');
    expect(result.valid).toBe(false);
  });

  test('valid ENV returns { valid: true }', () => {
    const result = validateContent('MY_VAR=hello\nOTHER=world', 'env');
    expect(result.valid).toBe(true);
    expect(result.meta.variableCount).toBe(2);
  });

  test('ENV with invalid variable name returns error', () => {
    const result = validateContent('123BAD=value', 'env');
    expect(result.valid).toBe(false);
  });

  test('ENV detects duplicate variables as warning', () => {
    const result = validateContent('VAR=a\nVAR=b', 'env');
    expect(result.errors.some(e => e.message.includes('Duplicate'))).toBe(true);
  });
});

describe('validateContent - unsupported format', () => {
  test('returns valid=false for unsupported format', () => {
    const result = validateContent('content', 'unsupported_format_xyz');
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('No validator available');
  });
});

describe('validateStructuredFile', () => {
  test('reads file and validates content', async () => {
    mockFs.readFile.mockResolvedValue('{"a": 1}');
    const result = await validateStructuredFile('/path/to/config.json');
    expect(result.valid).toBe(true);
    expect(result.meta.filePath).toBe('/path/to/config.json');
  });

  test('returns error when file cannot be read', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    const result = await validateStructuredFile('/path/to/missing.json');
    expect(result.valid).toBe(false);
    expect(result.meta.readError).toBe(true);
  });

  test('returns error for unknown format', async () => {
    const result = await validateStructuredFile('/path/to/file.unknown');
    expect(result.valid).toBe(false);
    expect(result.format).toBe('unknown');
  });
});

describe('validateForToolResponse', () => {
  test('returns simplified result for known format', () => {
    const result = validateForToolResponse('{"a": 1}', 'config.json');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('json');
    expect(result.errorCount).toBe(0);
  });

  test('returns null for unknown format', () => {
    const result = validateForToolResponse('content', 'file.txt');
    expect(result).toBeNull();
  });

  test('includes errorCount and warningCount for invalid content', () => {
    const result = validateForToolResponse('{bad json}', 'file.json');
    expect(result.valid).toBe(false);
    expect(result.errorCount).toBeGreaterThan(0);
  });
});

describe('registerValidator / hasValidator', () => {
  test('registerValidator adds a custom validator', () => {
    registerValidator('custom_test_format', (content) => ({
      valid: true, format: 'custom_test_format', errors: [], meta: {}
    }));
    expect(hasValidator('custom_test_format')).toBe(true);
  });

  test('hasValidator returns false for unregistered format', () => {
    expect(hasValidator('totally_unknown_format_xyz')).toBe(false);
  });

  test('registered custom validator is used by validateContent', () => {
    registerValidator('myformat', (content) => ({
      valid: content === 'ok',
      format: 'myformat',
      errors: content === 'ok' ? [] : [{ message: 'not ok', severity: 'error' }],
      meta: {}
    }));
    expect(validateContent('ok', 'myformat').valid).toBe(true);
    expect(validateContent('bad', 'myformat').valid).toBe(false);
  });
});
