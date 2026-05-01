/**
 * Tests for the ancestry walker.
 *
 * Pure module — no I/O, no async. Pin every edge case so a future
 * refactor of the walk can't quietly let descendants modify their
 * ancestors.
 */
import { describe, test, expect } from '@jest/globals';
import {
  CHAIN_MAX, isAncestor, isProtectedFromCaller, makeAgentLookup,
} from '../platformControl/ancestry.js';

const lookup = (rows) => makeAgentLookup(rows);

describe('isAncestor', () => {
  test('direct parent → true', () => {
    const get = lookup([{ id: 'p' }, { id: 'c', createdBy: 'p' }]);
    expect(isAncestor('c', 'p', get)).toBe(true);
  });

  test('grandparent → true', () => {
    const get = lookup([
      { id: 'gp' },
      { id: 'p', createdBy: 'gp' },
      { id: 'c', createdBy: 'p' },
    ]);
    expect(isAncestor('c', 'gp', get)).toBe(true);
  });

  test('sibling → false (no common path)', () => {
    const get = lookup([
      { id: 'p' },
      { id: 'a', createdBy: 'p' },
      { id: 'b', createdBy: 'p' },
    ]);
    expect(isAncestor('a', 'b', get)).toBe(false);
  });

  test('descendant → false (we don\'t reverse-walk)', () => {
    const get = lookup([{ id: 'p' }, { id: 'c', createdBy: 'p' }]);
    expect(isAncestor('p', 'c', get)).toBe(false);
  });

  test('self → false (handled by separate self-modify check)', () => {
    const get = lookup([{ id: 'a' }]);
    expect(isAncestor('a', 'a', get)).toBe(false);
  });

  test('createdBy=null → no parent → false', () => {
    const get = lookup([{ id: 'a', createdBy: null }, { id: 'b' }]);
    expect(isAncestor('a', 'b', get)).toBe(false);
  });

  test('missing intermediate agent stops the walk cleanly (no throw)', () => {
    const get = lookup([{ id: 'c', createdBy: 'missing-parent' }]);
    expect(isAncestor('c', 'gp', get)).toBe(false);
  });

  test('cycle in the chain (defensive) → false, no infinite loop', () => {
    const get = lookup([
      { id: 'a', createdBy: 'b' },
      { id: 'b', createdBy: 'a' },     // a→b→a cycle
    ]);
    expect(isAncestor('a', 'someone-else', get)).toBe(false);
  });

  test('deep chain stops at CHAIN_MAX (no infinite walk)', () => {
    // Build a chain length CHAIN_MAX + 5; walking should stop at MAX
    // and not find the deepest ancestor.
    const rows = [];
    for (let i = 0; i <= CHAIN_MAX + 5; i++) {
      rows.push({ id: `n${i}`, createdBy: i === 0 ? null : `n${i - 1}` });
    }
    const get = lookup(rows);
    expect(isAncestor(`n${CHAIN_MAX + 5}`, `n0`, get)).toBe(false);
    // But a closer ancestor IS found
    expect(isAncestor(`n${CHAIN_MAX + 5}`, `n${CHAIN_MAX + 4}`, get)).toBe(true);
  });

  test('null/undefined inputs return false (defensive)', () => {
    const get = lookup([{ id: 'a' }]);
    expect(isAncestor(null, 'a', get)).toBe(false);
    expect(isAncestor('a', null, get)).toBe(false);
    expect(isAncestor('a', 'b', null)).toBe(false);
  });
});

describe('isProtectedFromCaller', () => {
  test('self → true (no-self-modify combined here for caller convenience)', () => {
    const get = lookup([{ id: 'a' }]);
    expect(isProtectedFromCaller('a', 'a', get)).toBe(true);
  });

  test('parent of caller → true', () => {
    const get = lookup([{ id: 'p' }, { id: 'c', createdBy: 'p' }]);
    expect(isProtectedFromCaller('c', 'p', get)).toBe(true);
  });

  test('child of caller → false (caller can modify their own descendants)', () => {
    const get = lookup([{ id: 'p' }, { id: 'c', createdBy: 'p' }]);
    expect(isProtectedFromCaller('p', 'c', get)).toBe(false);
  });

  test('unrelated → false', () => {
    const get = lookup([{ id: 'a' }, { id: 'b' }]);
    expect(isProtectedFromCaller('a', 'b', get)).toBe(false);
  });
});

describe('makeAgentLookup', () => {
  test('accepts a Map', () => {
    const m = new Map([['a', { id: 'a', createdBy: null }]]);
    const get = makeAgentLookup(m);
    expect(get('a').id).toBe('a');
    expect(get('missing')).toBe(null);
  });
  test('accepts an array', () => {
    const get = makeAgentLookup([{ id: 'x' }]);
    expect(get('x').id).toBe('x');
    expect(get('y')).toBe(null);
  });
  test('accepts a plain object id→agent', () => {
    const get = makeAgentLookup({ x: { id: 'x' } });
    expect(get('x').id).toBe('x');
    expect(get('y')).toBe(null);
  });
  test('null/undefined → always-null lookup', () => {
    expect(makeAgentLookup(null)('x')).toBe(null);
    expect(makeAgentLookup(undefined)('x')).toBe(null);
  });
});
