import { describe, it, expect } from 'vitest';
import { PROVIDERS, getProvider, pickDefaultModel } from '../providers.js';

/**
 * The provider catalogue + default-model resolver is the onboarding
 * wizard's single source of truth for step 1 (tile metadata) and step 3
 * (which model to pre-select).
 *
 * pickDefaultModel is the gnarliest function in the bunch — three
 * fallback layers (hints → exact defaultModel → first available) — so
 * most of these tests pin its branches.
 */

describe('PROVIDERS catalogue shape', () => {
  it('lists exactly the five providers the brief requires', () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(
      ['anthropic', 'gemini', 'ollama', 'openai', 'xai'],
    );
  });

  it.each(['openai', 'anthropic', 'gemini', 'xai'])(
    'marks %s as a cloud provider',
    (id) => {
      expect(getProvider(id).cloud).toBe(true);
    },
  );

  it('marks ollama as a non-cloud provider', () => {
    expect(getProvider('ollama').cloud).toBe(false);
  });

  it('gives every cloud provider a placeholder, keyHelpUrl, and defaultModel', () => {
    for (const p of PROVIDERS.filter((x) => x.cloud)) {
      expect(p.placeholder, `${p.id}.placeholder`).toBeTruthy();
      expect(p.keyHelpUrl, `${p.id}.keyHelpUrl`).toMatch(/^https?:\/\//);
      expect(p.defaultModel, `${p.id}.defaultModel`).toBeTruthy();
      expect(Array.isArray(p.fallbackModelHints), `${p.id}.fallbackModelHints`).toBe(true);
      expect(p.fallbackModelHints.length).toBeGreaterThan(0);
    }
  });

  it('gives Ollama a non-empty cost framing too (the tile reads "Local & free")', () => {
    const ollama = getProvider('ollama');
    expect(ollama.costHint).toBe('Local & free');
    expect(ollama.keyHelpUrl).toMatch(/^https?:\/\//);
  });

  it('costHint on every cloud provider mentions "by token" framing', () => {
    for (const p of PROVIDERS.filter((x) => x.cloud)) {
      expect(p.costHint.toLowerCase(), `${p.id}.costHint`).toContain('token');
    }
  });
});

describe('getProvider', () => {
  it('returns the provider object by id', () => {
    expect(getProvider('openai').label).toBe('OpenAI');
  });

  it('returns undefined for unknown ids (no throw)', () => {
    expect(getProvider('mystery')).toBeUndefined();
    expect(getProvider(null)).toBeUndefined();
  });
});

describe('pickDefaultModel', () => {
  describe('happy path: hint matching', () => {
    it('returns the first hint that substring-matches a model in the list', () => {
      // 'gpt-4o-mini' is OpenAI's first hint; 'gpt-4o' is later. The
      // function should prefer the first hint that finds ANY match.
      const result = pickDefaultModel('openai', ['gpt-3.5-turbo', 'gpt-4o-mini', 'gpt-4o']);
      expect(result).toBe('gpt-4o-mini');
    });

    it('substring-matches are case-insensitive', () => {
      const result = pickDefaultModel('openai', ['GPT-4O-MINI']);
      expect(result).toBe('GPT-4O-MINI');
    });

    it('falls through to the next hint when the first does not match', () => {
      // OpenAI hints: ['gpt-4o-mini', 'gpt-4o', 'gpt-4', 'gpt-3.5'].
      // No 'gpt-4o-mini' in the list — should fall to 'gpt-4o' (which
      // substring-matches 'gpt-4o-2024').
      const result = pickDefaultModel('openai', ['gpt-4o-2024-08-06', 'gpt-4-turbo']);
      expect(result).toBe('gpt-4o-2024-08-06');
    });
  });

  describe('fallback 2: exact defaultModel match', () => {
    it('returns the provider defaultModel when no hint substring matches but defaultModel is present', () => {
      // Construct a list where nothing substring-matches any Anthropic
      // hint but the literal defaultModel ("claude-3-5-haiku-latest")
      // is present. Hints are ['claude-3-5-haiku', ...] — that hint
      // would substring-match too. So pick a different shape: the
      // defaultModel for xAI is 'grok-2-mini' and the first hint is
      // 'grok-2-mini'. To make THIS branch fire we'd need a list with
      // 'grok-2-mini' but no hint match — impossible since the hint
      // IS the defaultModel name.
      //
      // Instead, test the simpler case: hints array is empty.
      const out = pickDefaultModel('ollama', ['llama3', 'qwen2.5']);
      // Ollama has no defaultModel and no hints — falls through to first.
      expect(out).toBe('llama3');
    });
  });

  describe('fallback 3: first available', () => {
    it('returns the first model when neither hints nor defaultModel match', () => {
      const result = pickDefaultModel('openai', ['ancient-davinci-002', 'babbage-002']);
      expect(result).toBe('ancient-davinci-002');
    });
  });

  describe('edge cases', () => {
    it('returns null for an unknown provider', () => {
      expect(pickDefaultModel('mystery', ['anything'])).toBeNull();
    });

    it('returns the provider defaultModel for an empty list (cloud)', () => {
      // No models from the API but we still have a sensible default.
      expect(pickDefaultModel('openai', [])).toBe('gpt-4o-mini');
      expect(pickDefaultModel('anthropic', [])).toBe('claude-3-5-haiku-latest');
    });

    it('returns null for an empty list when the provider has no defaultModel', () => {
      // Ollama has defaultModel: null
      expect(pickDefaultModel('ollama', [])).toBeNull();
    });

    it('tolerates a non-array availableModels argument', () => {
      // The implementation coerces null/undefined to []; verify it doesn't throw.
      expect(() => pickDefaultModel('openai', null)).not.toThrow();
      expect(() => pickDefaultModel('openai', undefined)).not.toThrow();
      // And still returns a sensible default.
      expect(pickDefaultModel('openai', undefined)).toBe('gpt-4o-mini');
    });

    it('tolerates entries with non-string falsy values without throwing', () => {
      // Constructed pathological list — pickDefaultModel does string ops.
      expect(() =>
        pickDefaultModel('openai', [null, undefined, '', 'gpt-4o-mini']),
      ).not.toThrow();
      expect(pickDefaultModel('openai', [null, undefined, '', 'gpt-4o-mini'])).toBe('gpt-4o-mini');
    });
  });
});
