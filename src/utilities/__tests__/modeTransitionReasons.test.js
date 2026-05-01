/**
 * Tests for modeTransitionReasons — the natural-language catalog.
 *
 * The UI copy surfaced here is the main visible output of the whole
 * mode-flip feature, so the contract is locked hard: every known code
 * produces a full English sentence; templated tokens get replaced; unknown
 * codes degrade gracefully to a readable fallback.
 */

import { describe, test, expect } from '@jest/globals';
import {
  MODE_TRANSITION_REASONS,
  render,
  isKnownReasonCode,
} from '../modeTransitionReasons.js';

describe('MODE_TRANSITION_REASONS catalog', () => {
  test('is frozen so no runtime mutation can corrupt the catalog', () => {
    expect(Object.isFrozen(MODE_TRANSITION_REASONS)).toBe(true);
  });

  test('every entry has a non-empty template', () => {
    for (const [code, entry] of Object.entries(MODE_TRANSITION_REASONS)) {
      expect(typeof entry.template).toBe('string');
      expect(entry.template.length).toBeGreaterThan(0);
    }
  });

  test('includes the full set of reason codes the scheduler emits', () => {
    for (const code of ['user-stop', 'user-toggle', 'ai-request-timeout',
                         'empty-response-stall', 'loop-detected', 'flow-init']) {
      expect(MODE_TRANSITION_REASONS[code]).toBeDefined();
    }
  });
});

describe('render()', () => {
  test('static template (no tokens) returns the template verbatim', () => {
    expect(render('user-stop')).toBe('Stopped by user.');
  });

  test('empty-response-stall template interpolates count + elapsedSec', () => {
    const out = render('empty-response-stall', { count: 5, elapsedSec: 57 });
    expect(out).toMatch(/^The model returned 5 empty responses in a row over 57s/);
    expect(out).toMatch(/\.$/);
  });

  test('loop-detected template interpolates occurrences + windowSize', () => {
    const out = render('loop-detected', { occurrences: 7, windowSize: 10 });
    expect(out).toMatch(/7 times in a 10-step window/);
  });

  test('ai-request-timeout template interpolates elapsedSec', () => {
    const out = render('ai-request-timeout', { elapsedSec: 60 });
    expect(out).toContain('60s');
  });

  test('missing detail keys degrade to `?` so the gap is visible', () => {
    const out = render('empty-response-stall', { count: 5 });
    expect(out).toContain('5 empty responses');
    expect(out).toContain('?s');   // elapsedSec missing
  });

  test('unknown reason code produces a readable fallback, not a bare symbol', () => {
    const out = render('some-new-reason');
    expect(out).toMatch(/^Mode change \(some new reason\)\./);
    expect(out).not.toContain('{');
  });

  test('null / undefined / empty code falls back without throwing', () => {
    expect(render(null)).toBe('Mode changed.');
    expect(render(undefined)).toBe('Mode changed.');
    expect(render('')).toBe('Mode changed.');
  });

  test('all rendered strings end with sentence punctuation', () => {
    for (const code of Object.keys(MODE_TRANSITION_REASONS)) {
      const out = render(code, { count: 1, elapsedSec: 1, occurrences: 1, windowSize: 1 });
      expect(out).toMatch(/[.!?]$/);
    }
  });

  test('interpolation is safe against prototype-pollution tricks', () => {
    // Keys that aren't own-properties of the detail object should not be read.
    const detail = Object.create({ count: 'INJECTED' });
    const out = render('empty-response-stall', detail);
    expect(out).not.toContain('INJECTED');
    expect(out).toContain('? empty responses');
  });
});

describe('isKnownReasonCode()', () => {
  test('true for catalog entries', () => {
    expect(isKnownReasonCode('user-stop')).toBe(true);
    expect(isKnownReasonCode('empty-response-stall')).toBe(true);
  });

  test('false for unknown / empty / non-string', () => {
    expect(isKnownReasonCode('nope')).toBe(false);
    expect(isKnownReasonCode('')).toBe(false);
    expect(isKnownReasonCode(null)).toBe(false);
    expect(isKnownReasonCode(undefined)).toBe(false);
    expect(isKnownReasonCode(42)).toBe(false);
  });
});
