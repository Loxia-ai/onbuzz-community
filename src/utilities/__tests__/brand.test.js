/**
 * Tests for the (single-brand) brand resolver.
 *
 * The OSS edition collapses the previous Autopilot/OnBuzz dual-brand
 * resolver into a single OnBuzz Community identity. These tests pin the
 * shape so future changes are deliberate.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { getBrand, _resetBrandCacheForTests } from '../brand.js';

beforeEach(() => { _resetBrandCacheForTests(); });

describe('getBrand — single OnBuzz Community brand', () => {
  test('resolves to the OnBuzz brand with stable identifiers', () => {
    const b = getBrand();
    expect(b.binName).toBe('onbuzz');
    expect(b.isOnBuzz).toBe(true);
    expect(b.isAutopilot).toBe(false);
  });

  test('productName is "OnBuzz Community"', () => {
    expect(getBrand().productName).toBe('OnBuzz Community');
  });

  test('shortName is "OnBuzz"', () => {
    expect(getBrand().shortName).toBe('OnBuzz');
  });

  test('docsUrl is set', () => {
    const url = getBrand().docsUrl;
    expect(typeof url).toBe('string');
    expect(url.startsWith('http')).toBe(true);
  });

  test('version reflects the actual package.json version', () => {
    const b = getBrand();
    expect(typeof b.version).toBe('string');
    expect(b.version.length).toBeGreaterThan(0);
    expect(b.version).not.toBe('0.0.0'); // not the fallback
  });

  test('result is memoized — second call returns the same object reference', () => {
    const a = getBrand();
    const b = getBrand();
    expect(a).toBe(b);
  });

  test('reset hook clears the cache', () => {
    const a = getBrand();
    _resetBrandCacheForTests();
    const b = getBrand();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('shared user-data dir', () => {
  test('userDataDir is stable across brand changes', async () => {
    const { getUserDataDir } = await import('../userDataDir.js');
    const dir = getUserDataDir();
    expect(typeof dir).toBe('string');
    expect(dir.length).toBeGreaterThan(0);
  });
});
