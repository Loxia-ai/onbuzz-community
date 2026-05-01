/**
 * Decision-persistence helpers: first-use → persist always/block,
 * "once" never persists, clear removes it. These three behaviors
 * gate whether the confirmation modal re-appears on every render.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getStoredDecision,
  storeDecision,
  clearDecision,
} from '../ConfirmationModal.jsx';

beforeEach(() => { localStorage.clear(); });

describe('decision persistence', () => {
  it('returns null when no decision stored', () => {
    expect(getStoredDecision('a1')).toBeNull();
  });

  it('stores "always" and "block" but not "once"', () => {
    storeDecision('a1', 'always');
    storeDecision('a2', 'block');
    storeDecision('a3', 'once');

    expect(getStoredDecision('a1')).toBe('always');
    expect(getStoredDecision('a2')).toBe('block');
    expect(getStoredDecision('a3')).toBeNull();
  });

  it('isolates decisions per agent', () => {
    storeDecision('alpha', 'always');
    storeDecision('beta',  'block');
    expect(getStoredDecision('alpha')).toBe('always');
    expect(getStoredDecision('beta')).toBe('block');
  });

  it('clearDecision removes the stored value', () => {
    storeDecision('a1', 'always');
    clearDecision('a1');
    expect(getStoredDecision('a1')).toBeNull();
  });
});
