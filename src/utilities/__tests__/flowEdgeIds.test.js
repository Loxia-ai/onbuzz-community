/**
 * Tests for the shared edge-id stamping helper used by both the
 * server-side `stateManager.createFlow` and the client-side `FlowEditor`.
 *
 * The bug this guards against: ReactFlow silently drops edges missing
 * `id`, so templates / marketplace-installed flows rendered as
 * disconnected nodes (no arrows). Locking format + idempotency here
 * keeps both layers in sync.
 */
import { describe, test, expect } from '@jest/globals';
import { makeEdgeId, ensureEdgeIds } from '../flowEdgeIds.js';

describe('makeEdgeId', () => {
  test('encodes source/target/fields/index in a stable form', () => {
    const id = makeEdgeId({ source: 'a', sourceField: 'topic', target: 'b', targetField: 'topic' }, 0);
    expect(id).toBe('e-a:topic-b:topic-0');
  });

  test('omits :field segments when sourceField/targetField missing', () => {
    expect(makeEdgeId({ source: 'a', target: 'b' }, 0)).toBe('e-a-b-0');
    expect(makeEdgeId({ source: 'a', sourceField: 'x', target: 'b' }, 1)).toBe('e-a:x-b-1');
    expect(makeEdgeId({ source: 'a', target: 'b', targetField: 'y' }, 2)).toBe('e-a-b:y-2');
  });

  test('uses ? for missing source / target (defensive — should never happen with valid flows)', () => {
    expect(makeEdgeId({}, 0)).toBe('e-?-?-0');
    expect(makeEdgeId({ source: 'a' }, 0)).toBe('e-a-?-0');
    expect(makeEdgeId({ target: 'b' }, 0)).toBe('e-?-b-0');
  });

  test('null/undefined input doesn\'t crash', () => {
    expect(makeEdgeId(null, 0)).toBe('e-?-?-0');
    expect(makeEdgeId(undefined, 0)).toBe('e-?-?-0');
  });

  test('different indexes produce different ids (tiebreaker for parallel edges)', () => {
    const a = makeEdgeId({ source: 'x', target: 'y' }, 0);
    const b = makeEdgeId({ source: 'x', target: 'y' }, 1);
    expect(a).not.toBe(b);
  });
});

describe('ensureEdgeIds', () => {
  test('stamps ids on every unstamped edge', () => {
    const result = ensureEdgeIds([
      { source: 'a', target: 'b' },
      { source: 'b', sourceField: 'out', target: 'c', targetField: 'in' },
    ]);
    expect(result).toHaveLength(2);
    expect(result.every(e => typeof e.id === 'string' && e.id.length > 0)).toBe(true);
    expect(result[0].id).toBe('e-a-b-0');
    expect(result[1].id).toBe('e-b:out-c:in-1');
  });

  test('preserves existing ids — does not clobber user-supplied / round-tripped ids', () => {
    const result = ensureEdgeIds([
      { id: 'user-supplied', source: 'a', target: 'b' },
      { source: 'b', target: 'c' },                       // no id → stamped
    ]);
    expect(result[0].id).toBe('user-supplied');
    expect(result[1].id).toBe('e-b-c-1');
  });

  test('does NOT mutate the input array or its edges', () => {
    const input = [{ source: 'a', target: 'b' }];
    const before = JSON.parse(JSON.stringify(input));
    ensureEdgeIds(input);
    expect(input).toEqual(before);          // input untouched
    expect(input[0]).not.toHaveProperty('id');
  });

  test('idempotent: running twice produces equivalent ids on the second pass', () => {
    const first = ensureEdgeIds([
      { source: 'a', sourceField: 'x', target: 'b', targetField: 'y' },
    ]);
    const second = ensureEdgeIds(first);
    expect(second[0].id).toBe(first[0].id);
  });

  test('non-array input → empty array (defensive)', () => {
    expect(ensureEdgeIds(null)).toEqual([]);
    expect(ensureEdgeIds(undefined)).toEqual([]);
    expect(ensureEdgeIds('not an array')).toEqual([]);
    expect(ensureEdgeIds({})).toEqual([]);
  });

  test('empty array passes through cleanly', () => {
    expect(ensureEdgeIds([])).toEqual([]);
  });

  test('handles null edges defensively (skipped/repaired without throwing)', () => {
    const result = ensureEdgeIds([null, { source: 'a', target: 'b' }, undefined]);
    expect(result).toHaveLength(3);
    // Each entry has an id; nulls become objects with just an id.
    expect(result.every(e => typeof e.id === 'string')).toBe(true);
  });

  test('parallel edges between same nodes get distinct ids (tiebreaker)', () => {
    const result = ensureEdgeIds([
      { source: 'a', target: 'b' },
      { source: 'a', target: 'b' },
      { source: 'a', target: 'b' },
    ]);
    const ids = result.map(e => e.id);
    expect(new Set(ids).size).toBe(3);   // all distinct
  });

  test('id format is stable across saves (no Date.now/Math.random)', () => {
    // Critical: re-saving the same flow must produce the same edge ids.
    // Otherwise version-history diffs would be cluttered with id churn.
    const edges = [{ source: 'a', sourceField: 'x', target: 'b' }];
    const a = ensureEdgeIds(edges);
    const b = ensureEdgeIds(edges);
    expect(a[0].id).toBe(b[0].id);
  });
});
