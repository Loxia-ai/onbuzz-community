/**
 * WebTool Unit Tests
 *
 * Tests the WebTool's error detection, validation, and feedback quality
 * WITHOUT requiring a real browser. Uses mocked Puppeteer page objects.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// We test the static helper and the core logic by importing WebTool
// and mocking the browser layer.

let WebTool;

beforeEach(async () => {
  const mod = await import('../../tools/webTool.js');
  WebTool = mod.default;
});

// ─── _dedupeErrors ───────────────────────────────────────────────────────────

describe('WebTool._dedupeErrors', () => {
  test('returns empty array for empty input', () => {
    expect(WebTool._dedupeErrors([])).toEqual([]);
  });

  test('returns empty array for null/undefined input', () => {
    expect(WebTool._dedupeErrors(null)).toEqual([]);
    expect(WebTool._dedupeErrors(undefined)).toEqual([]);
  });

  test('single unique error passes through unchanged', () => {
    expect(WebTool._dedupeErrors(['Error A'])).toEqual(['Error A']);
  });

  test('deduplicates repeated errors with count', () => {
    const input = ['Error A', 'Error A', 'Error A'];
    expect(WebTool._dedupeErrors(input)).toEqual(['Error A (x3)']);
  });

  test('preserves order and mixes unique + repeated', () => {
    const input = [
      'Cannot read properties of undefined',
      'Cannot read properties of undefined',
      'Cannot read properties of undefined',
      'Cannot read properties of undefined',
      'Unique error: widget failed',
      'GET https://api.bad.com/data → net::ERR_NAME_NOT_RESOLVED',
      'GET https://api.bad.com/data → net::ERR_NAME_NOT_RESOLVED',
      'GET https://api.bad.com/data → net::ERR_NAME_NOT_RESOLVED',
      'GET https://api.other.com/v2 → net::ERR_NAME_NOT_RESOLVED',
    ];
    const result = WebTool._dedupeErrors(input);
    expect(result).toEqual([
      'Cannot read properties of undefined (x4)',
      'Unique error: widget failed',
      'GET https://api.bad.com/data → net::ERR_NAME_NOT_RESOLVED (x3)',
      'GET https://api.other.com/v2 → net::ERR_NAME_NOT_RESOLVED',
    ]);
  });

  test('does not add count suffix for single occurrences', () => {
    const input = ['Error A', 'Error B', 'Error C'];
    const result = WebTool._dedupeErrors(input);
    expect(result).toEqual(['Error A', 'Error B', 'Error C']);
    result.forEach(r => {
      expect(r).not.toContain('(x');
    });
  });

  test('handles two duplicates correctly', () => {
    expect(WebTool._dedupeErrors(['X', 'X'])).toEqual(['X (x2)']);
  });
});

// ─── URL Validation ──────────────────────────────────────────────────────────

describe('WebTool URL validation', () => {
  let wt;
  const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

  beforeEach(() => {
    wt = new WebTool({ logger: silentLogger });
  });

  test('fetch with no URL returns error', async () => {
    const result = await wt.execute({ operation: 'fetch' }, { agentId: 'test', context: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/URL is required/i);
  });

  test('fetch with empty string URL returns error', async () => {
    const result = await wt.execute({ operation: 'fetch', url: '' }, { agentId: 'test', context: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/URL is required/i);
  });

  test('fetch with invalid URL format returns error', async () => {
    const result = await wt.execute({ operation: 'fetch', url: 'not-a-url' }, { agentId: 'test', context: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid URL format/);
    expect(result.error).toContain('not-a-url');
  });

  test('fetch with missing protocol returns error', async () => {
    const result = await wt.execute({ operation: 'fetch', url: 'example.com' }, { agentId: 'test', context: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid URL format/);
  });

  test('unknown operation returns error', async () => {
    const result = await wt.execute({ operation: 'foobar' }, { agentId: 'test', context: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown operation/);
  });
});

// ─── Search validation ───────────────────────────────────────────────────────

describe('WebTool search validation', () => {
  let wt;
  const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

  beforeEach(() => {
    wt = new WebTool({ logger: silentLogger });
  });

  test('search with empty query returns error', async () => {
    const result = await wt.execute({ operation: 'search', query: '' }, { agentId: 'test', context: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/query is required/i);
  });

  test('search with unknown engine returns error', async () => {
    const result = await wt.execute({ operation: 'search', query: 'hello', engine: 'fakesearch' }, { agentId: 'test', context: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown search engine/i);
  });
});

// ─── Execute wrapper ─────────────────────────────────────────────────────────

describe('WebTool execute wrapper', () => {
  let wt;
  const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

  beforeEach(() => {
    wt = new WebTool({ logger: silentLogger });
  });

  test('respects operation success=false flag', async () => {
    // fetch with invalid URL should propagate success=false
    const result = await wt.execute({ operation: 'fetch', url: 'invalid' }, { agentId: 'test', context: {} });
    expect(result.success).toBe(false);
    // Must NOT be overridden to true
  });

  test('includes operation name in result', async () => {
    const result = await wt.execute({ operation: 'fetch', url: 'bad' }, { agentId: 'test', context: {} });
    expect(result.operation).toBe('fetch');
  });

  test('includes toolUsed in result', async () => {
    const result = await wt.execute({ operation: 'fetch', url: 'bad' }, { agentId: 'test', context: {} });
    expect(result.toolUsed).toBe('web');
  });
});

// ─── Parameter parsing ───────────────────────────────────────────────────────

describe('WebTool parameter parsing', () => {
  let wt;
  const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

  beforeEach(() => {
    wt = new WebTool({ logger: silentLogger });
  });

  test('missing operation returns error', async () => {
    const result = await wt.execute({}, { agentId: 'test', context: {} });
    expect(result.success).toBe(false);
  });

  test('authenticate with no siteId returns error', async () => {
    const result = await wt.execute({ operation: 'authenticate' }, { agentId: 'test', context: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/site.*required/i);
  });

  test('interactive with empty actions array succeeds vacuously', async () => {
    const result = await wt.execute({ operation: 'interactive', actions: [] }, { agentId: 'test', context: {} });
    expect(result.success).toBe(true);
    expect(result.data.actionsExecuted).toBe(0);
  });
});
