import { describe, it, expect } from 'vitest';
import {
  providerLabel,
  providerBadgeClass,
  FEATURE_BADGE_CLASS,
  cleanDisplayName,
} from '../providerBadge.js';

/**
 * providerBadge owns the display layer for the chip next to each model.
 * Pure functions + class-string constants — no React, no DOM, no fetch.
 * That keeps these tests fast and the surface area small.
 *
 * What we lock down here:
 *   - The five known provider labels (the rest of the codebase keys off
 *     these — `appStore` iterates the same list).
 *   - The unknown-provider fallback (Title-cases hyphens / underscores
 *     since user-named custom endpoints look like `my-fancy-endpoint`).
 *   - cleanDisplayName strips the four backend-imposed prefixes/suffixes
 *     ("Loxia ", "Direct ", " (Platform)", " (Direct)").
 *   - The class strings include the base pill styles and the right
 *     accent border / neutral border for known + unknown cases.
 */

describe('providerLabel', () => {
  it.each([
    ['openai',    'OpenAI'],
    ['anthropic', 'Anthropic'],
    ['gemini',    'Gemini'],
    ['xai',       'xAI'],
    ['ollama',    'Ollama'],
  ])('returns the curated label for %s', (id, expected) => {
    expect(providerLabel(id)).toBe(expected);
  });

  it.each([
    [null,        'Unknown'],
    [undefined,   'Unknown'],
    ['',          'Unknown'],
    [42,          'Unknown'],
    [{},          'Unknown'],
  ])('falls back to Unknown for non-string / empty id (%p)', (id, expected) => {
    expect(providerLabel(id)).toBe(expected);
  });

  it('title-cases an unknown single-word id', () => {
    expect(providerLabel('mystral')).toBe('Mystral');
  });

  it('title-cases hyphenated unknown ids and inserts spaces', () => {
    expect(providerLabel('custom-foo')).toBe('Custom Foo');
    expect(providerLabel('my-fancy-endpoint')).toBe('My Fancy Endpoint');
  });

  it('title-cases underscored unknown ids and inserts spaces', () => {
    expect(providerLabel('my_endpoint')).toBe('My Endpoint');
    expect(providerLabel('a_b_c')).toBe('A B C');
  });

  it('collapses runs of separators rather than emitting empty words', () => {
    expect(providerLabel('foo--bar')).toBe('Foo Bar');
    expect(providerLabel('foo__bar')).toBe('Foo Bar');
    expect(providerLabel('foo-_-bar')).toBe('Foo Bar');
  });
});

describe('cleanDisplayName', () => {
  it.each([
    ['Loxia Claude Sonnet',          'Claude Sonnet'],
    ['Direct GPT-4o',                'GPT-4o'],
    ['Claude 3.5 Sonnet (Platform)', 'Claude 3.5 Sonnet'],
    ['GPT-4o (Direct)',              'GPT-4o'],
  ])('strips a single noise token: "%s" → "%s"', (input, expected) => {
    expect(cleanDisplayName(input)).toBe(expected);
  });

  it('strips both a prefix and a suffix on the same name', () => {
    expect(cleanDisplayName('Direct Claude 3.5 Sonnet (Direct)')).toBe('Claude 3.5 Sonnet');
    expect(cleanDisplayName('Loxia GPT-4o (Platform)')).toBe('GPT-4o');
  });

  it('returns "" for null/undefined rather than throwing', () => {
    expect(cleanDisplayName(null)).toBe('');
    expect(cleanDisplayName(undefined)).toBe('');
  });

  it('passes clean names through unchanged', () => {
    expect(cleanDisplayName('Llama 3 8B')).toBe('Llama 3 8B');
  });

  it('only strips the FIRST occurrence of each token (deliberate)', () => {
    // The function uses String.prototype.replace without the /g flag.
    // Two prefixes in one string is a pathological input from the backend;
    // we pin current behavior so future changes are intentional.
    expect(cleanDisplayName('Loxia Loxia X')).toBe('Loxia X');
  });
});

describe('providerBadgeClass', () => {
  it('always includes the base pill styling', () => {
    const cls = providerBadgeClass('openai');
    expect(cls).toContain('inline-flex');
    expect(cls).toContain('rounded-full');
    expect(cls).toContain('text-[11px]'); // pinned by the design brief
    expect(cls).toContain('border');
  });

  it.each([
    ['openai',    'border-emerald-300'],
    ['anthropic', 'border-orange-300'],
    ['gemini',    'border-blue-300'],
    ['xai',       'border-slate-400'],
    ['ollama',    'border-purple-300'],
  ])('applies the per-provider accent border for %s', (id, accent) => {
    expect(providerBadgeClass(id)).toContain(accent);
  });

  it('falls back to the neutral border for unknown providers', () => {
    const cls = providerBadgeClass('custom-foo');
    // Neutral border: gray-300 light + gray-600 dark
    expect(cls).toContain('border-gray-300');
    expect(cls).toContain('dark:border-gray-600');
  });

  it('uses the brighter dark-mode background so the chip reads against the modal', () => {
    // Pinned after the dark-mode contrast fix: dark:bg-gray-700, not gray-800.
    expect(providerBadgeClass('openai')).toContain('dark:bg-gray-700');
  });
});

describe('FEATURE_BADGE_CLASS', () => {
  it('is a string (not a function) so callers can use it inline', () => {
    expect(typeof FEATURE_BADGE_CLASS).toBe('string');
  });

  it('includes base pill styling and the neutral border', () => {
    expect(FEATURE_BADGE_CLASS).toContain('inline-flex');
    expect(FEATURE_BADGE_CLASS).toContain('rounded-full');
    expect(FEATURE_BADGE_CLASS).toContain('border-gray-300');
    expect(FEATURE_BADGE_CLASS).toContain('dark:border-gray-600');
  });

  it('does NOT include any provider-specific accent', () => {
    // The feature badge should read as a quieter sibling of the provider
    // chip — provider accents on it would compete for attention.
    expect(FEATURE_BADGE_CLASS).not.toContain('border-emerald-');
    expect(FEATURE_BADGE_CLASS).not.toContain('border-orange-');
    expect(FEATURE_BADGE_CLASS).not.toContain('border-blue-');
    expect(FEATURE_BADGE_CLASS).not.toContain('border-purple-');
    expect(FEATURE_BADGE_CLASS).not.toContain('border-slate-');
  });
});
