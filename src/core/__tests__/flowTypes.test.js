/**
 * flowTypes — type registry + compat matrix that backs Flows v2 typed I/O.
 *
 * Why these tests exist: edges in v2 connect a *typed output* to a *typed
 * input*. The compatibility matrix decides which connections are allowed.
 * Get this wrong and either:
 *   - too lax: agents receive payloads they can't parse (silent break)
 *   - too strict: trivial-looking flows refuse to connect (UX paper-cut)
 *
 * The matrix below is the contract. Every cell is justified by a test.
 *
 * Allowed implicit conversions (no cast node needed):
 *   - exact match               always
 *   - any scalar  → text        (auto-stringify; text is the universal sink)
 *   - any         → json        (everything wraps as a JSON value)
 *   - file        → file[]      (singleton-as-list; common ergonomic case)
 *   - text        → list<text>  (single-line as 1-element list)
 *
 * Disallowed (must use an explicit cast/transform node):
 *   - text/number/json → file or file[]   (text is not a path)
 *   - file → text                          (don't auto-read file contents)
 *   - number ← text (parse direction)     (lossy; force user to declare)
 */

import { describe, test, expect } from '@jest/globals';
import {
  TYPES,
  isKnownType,
  isCompatible,
  describeCompat,
} from '../flowTypes.js';

describe('TYPES registry', () => {
  test('exposes the v2 minimum types', () => {
    expect(TYPES).toEqual(expect.arrayContaining([
      'text', 'number', 'boolean', 'json', 'file', 'file[]', 'list<text>',
    ]));
  });

  test('isKnownType true for declared types', () => {
    for (const t of TYPES) expect(isKnownType(t)).toBe(true);
  });

  test('isKnownType false for unknown types', () => {
    for (const bad of ['', null, undefined, 'string', 'int', 'list', 'list<json>', 'TEXT']) {
      expect(isKnownType(bad)).toBe(false);
    }
  });
});

describe('isCompatible — exact match', () => {
  test('every type is compatible with itself', () => {
    for (const t of TYPES) expect(isCompatible(t, t)).toBe(true);
  });
});

describe('isCompatible — text as universal sink', () => {
  test.each([
    ['number', 'text'],
    ['boolean', 'text'],
    ['json', 'text'],   // JSON.stringify is well-defined
  ])('%s → text is allowed (auto-stringify)', (from, to) => {
    expect(isCompatible(from, to)).toBe(true);
  });

  test('file → text is NOT allowed (would auto-read; surprising)', () => {
    expect(isCompatible('file', 'text')).toBe(false);
  });

  test('file[] → text is NOT allowed', () => {
    expect(isCompatible('file[]', 'text')).toBe(false);
  });
});

describe('isCompatible — json as universal sink', () => {
  test.each(['text', 'number', 'boolean', 'list<text>'])(
    '%s → json is allowed (wraps as JSON value)',
    (from) => { expect(isCompatible(from, 'json')).toBe(true); }
  );

  test('file → json is NOT allowed (don\'t auto-read)', () => {
    expect(isCompatible('file', 'json')).toBe(false);
  });
});

describe('isCompatible — file singleton-as-list', () => {
  test('file → file[] is allowed (singleton-as-list)', () => {
    expect(isCompatible('file', 'file[]')).toBe(true);
  });

  test('file[] → file is NOT allowed (lossy: which one?)', () => {
    expect(isCompatible('file[]', 'file')).toBe(false);
  });
});

describe('isCompatible — text → list<text>', () => {
  test('text → list<text> is allowed (1-element list)', () => {
    expect(isCompatible('text', 'list<text>')).toBe(true);
  });

  test('list<text> → text is NOT allowed (lossy: how to join?)', () => {
    expect(isCompatible('list<text>', 'text')).toBe(false);
  });
});

describe('isCompatible — disallowed pairs (require cast node)', () => {
  test.each([
    ['text', 'number'],     // parse — declare it
    ['text', 'boolean'],    // parse — declare it
    ['text', 'file'],       // text is not a path
    ['text', 'file[]'],
    ['json', 'file'],
    ['number', 'file'],
    ['boolean', 'number'],  // would silently coerce
  ])('%s → %s is rejected', (from, to) => {
    expect(isCompatible(from, to)).toBe(false);
  });
});

describe('isCompatible — defensive', () => {
  test('unknown source type returns false', () => {
    expect(isCompatible('blob', 'text')).toBe(false);
  });
  test('unknown target type returns false', () => {
    expect(isCompatible('text', 'blob')).toBe(false);
  });
  test('null/undefined return false', () => {
    expect(isCompatible(null, 'text')).toBe(false);
    expect(isCompatible('text', null)).toBe(false);
    expect(isCompatible(undefined, undefined)).toBe(false);
  });
});

describe('describeCompat — diagnostic messages', () => {
  test('returns a usable explanation for incompatible pairs', () => {
    const msg = describeCompat('file', 'text');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
    expect(msg.toLowerCase()).toContain('file');
    expect(msg.toLowerCase()).toContain('text');
  });

  test('returns null/empty for compatible pairs', () => {
    const msg = describeCompat('text', 'text');
    expect(msg === null || msg === '' || msg === undefined).toBe(true);
  });
});
