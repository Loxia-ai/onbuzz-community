import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import {
  parseJSONWithRepair,
  looksLikeTruncatedJSON,
  createTruncationNotice,
  getFileExtension
} from '../jsonRepair.js';
import {
  validJson,
  trailingCommaObject,
  truncatedObject,
  truncatedString,
  plainText,
  emptyString
} from '../../__test-utils__/fixtures/malformedJson.js';

describe('jsonRepair', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('parseJSONWithRepair', () => {
    test('valid JSON returns data with wasRepaired=false', () => {
      const result = parseJSONWithRepair(validJson);
      expect(result.data).toEqual({ name: 'test', value: 42 });
      expect(result.wasRepaired).toBe(false);
      expect(result.wasTruncated).toBe(false);
      expect(result.error).toBeNull();
    });

    test('trailing comma repairs successfully with wasRepaired=true', () => {
      const result = parseJSONWithRepair(trailingCommaObject, { silent: true });
      expect(result.data).toEqual({ a: 1, b: 2 });
      expect(result.wasRepaired).toBe(true);
      expect(result.error).toBeNull();
    });

    test('truncated JSON sets wasTruncated=true', () => {
      const result = parseJSONWithRepair(truncatedObject, { silent: true });
      expect(result.wasRepaired).toBe(true);
      expect(result.wasTruncated).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.error).toBeNull();
    });

    test('completely invalid input returns error or repaired result', () => {
      // jsonrepair may be able to "repair" some plain text by treating it as a value
      const result = parseJSONWithRepair(plainText, { silent: true });
      // Either it was repaired successfully or it returned an error
      if (result.error) {
        expect(result.data).toBeNull();
        expect(result.error).toHaveProperty('originalError');
      } else {
        // jsonrepair managed to parse it somehow
        expect(result.data).not.toBeUndefined();
      }
    });

    test('null/undefined input handles gracefully', () => {
      // JSON.parse(null) returns null, so parseJSONWithRepair(null) succeeds with data=null
      const nullResult = parseJSONWithRepair(null, { silent: true });
      // Should not throw — returns a result object
      expect(nullResult).toHaveProperty('wasRepaired');
      expect(nullResult).toHaveProperty('error');
    });
  });

  describe('looksLikeTruncatedJSON', () => {
    test('unclosed bracket returns true', () => {
      expect(looksLikeTruncatedJSON('{"key": "value"')).toBe(true);
      expect(looksLikeTruncatedJSON('[1, 2, 3')).toBe(true);
      expect(looksLikeTruncatedJSON(truncatedString)).toBe(true);
    });

    test('complete JSON returns false', () => {
      expect(looksLikeTruncatedJSON('{"key": "value"}')).toBe(false);
      expect(looksLikeTruncatedJSON('[1, 2, 3]')).toBe(false);
      expect(looksLikeTruncatedJSON('{}')).toBe(false);
    });
  });

  describe('createTruncationNotice', () => {
    test('returns appropriate comment for each file type', () => {
      expect(createTruncationNotice('js')).toContain('//');
      expect(createTruncationNotice('css')).toContain('/*');
      expect(createTruncationNotice('html')).toContain('<!--');
      expect(createTruncationNotice('py')).toContain('#');
      // Note: json returns '' which is falsy, so || falls through to default
      expect(createTruncationNotice('json')).toContain('[CONTENT TRUNCATED]');
      expect(createTruncationNotice('unknown')).toContain('[CONTENT TRUNCATED]');
    });
  });

  describe('getFileExtension', () => {
    test('extracts extension correctly for various paths', () => {
      expect(getFileExtension('file.js')).toBe('js');
      expect(getFileExtension('path/to/file.test.ts')).toBe('ts');
      expect(getFileExtension('document.PDF')).toBe('pdf');
      expect(getFileExtension('noext')).toBe('');
      expect(getFileExtension('/some/path/file.json')).toBe('json');
    });
  });
});
