/**
 * Unit tests for the API-key placeholder detection helpers (shared by
 * apiKeyManager + the web UI). Locks the heuristic that prevents UI
 * mask strings (bullet characters, "(server-managed)" tags) from
 * leaking into persistence and overwriting real keys.
 */
import { describe, test, expect } from '@jest/globals';
import {
  isPlaceholderApiKey,
  sanitizeApiKeyValue,
  sanitizeApiKeysObject,
} from '../apiKeyPlaceholders.js';

describe('isPlaceholderApiKey', () => {
  test('detects strings containing bullet characters', () => {
    expect(isPlaceholderApiKey('••••••••')).toBe(true);
    expect(isPlaceholderApiKey('sk-•••')).toBe(true);
    expect(isPlaceholderApiKey('sk-••••••••••(server-managed)')).toBe(true);
  });

  test('detects (server-managed) and [server-managed] tags anywhere in the string', () => {
    expect(isPlaceholderApiKey('sk-abc(server-managed)')).toBe(true);
    expect(isPlaceholderApiKey('foo[server-managed]bar')).toBe(true);
    expect(isPlaceholderApiKey('(server-managed)')).toBe(true);
  });

  test('treats real-looking keys as not-placeholder', () => {
    expect(isPlaceholderApiKey('sk-proj-abcdefghijk')).toBe(false);
    expect(isPlaceholderApiKey('sk-ant-1234567890abcdef')).toBe(false);
    expect(isPlaceholderApiKey('AIzaSyAbcdef1234567890')).toBe(false);
    expect(isPlaceholderApiKey('xai-abcdef1234567890')).toBe(false);
  });

  test('returns false for empty / null / undefined / non-string', () => {
    expect(isPlaceholderApiKey('')).toBe(false);
    expect(isPlaceholderApiKey(null)).toBe(false);
    expect(isPlaceholderApiKey(undefined)).toBe(false);
    expect(isPlaceholderApiKey(123)).toBe(false);
    expect(isPlaceholderApiKey({})).toBe(false);
    expect(isPlaceholderApiKey([])).toBe(false);
  });

  test('does NOT treat the substring "managed" alone as a placeholder', () => {
    // Real keys should be allowed even if they happen to contain English
    // words — only the bracketed/parenthesised tag triggers detection.
    expect(isPlaceholderApiKey('sk-managed-account-key-12345')).toBe(false);
    expect(isPlaceholderApiKey('server')).toBe(false);
  });
});

describe('sanitizeApiKeyValue', () => {
  test('passes real keys through unchanged', () => {
    expect(sanitizeApiKeyValue('sk-real-key-abc123')).toBe('sk-real-key-abc123');
  });

  test('strips placeholder values to empty string', () => {
    expect(sanitizeApiKeyValue('••••••••')).toBe('');
    expect(sanitizeApiKeyValue('sk-•••(server-managed)')).toBe('');
    expect(sanitizeApiKeyValue('foo(server-managed)')).toBe('');
  });

  test('returns "" for non-string inputs', () => {
    expect(sanitizeApiKeyValue(null)).toBe('');
    expect(sanitizeApiKeyValue(undefined)).toBe('');
    expect(sanitizeApiKeyValue(0)).toBe('');
    expect(sanitizeApiKeyValue({ value: 'real' })).toBe('');
  });

  test('preserves empty string', () => {
    expect(sanitizeApiKeyValue('')).toBe('');
  });
});

describe('sanitizeApiKeysObject', () => {
  test('returns an empty object for null / undefined / non-object', () => {
    expect(sanitizeApiKeysObject(null)).toEqual({});
    expect(sanitizeApiKeysObject(undefined)).toEqual({});
    expect(sanitizeApiKeysObject('not-an-object')).toEqual({});
  });

  test('strips placeholders, preserves real keys', () => {
    const result = sanitizeApiKeysObject({
      anthropic: 'sk-ant-real-key-1234567890',
      openai:    '••••••••',
      gemini:    'AIza-real-key',
      xai:       'foo(server-managed)bar',
    });
    expect(result).toEqual({
      anthropic: 'sk-ant-real-key-1234567890',
      openai:    '',
      gemini:    'AIza-real-key',
      xai:       '',
    });
  });

  test('does not mutate the input', () => {
    const input = { openai: '••••••••' };
    sanitizeApiKeysObject(input);
    expect(input.openai).toBe('••••••••');
  });

  test('roundtrip: clean object passes through unchanged', () => {
    const clean = { openai: 'sk-real', anthropic: 'sk-ant-xyz' };
    expect(sanitizeApiKeysObject(clean)).toEqual(clean);
  });
});
