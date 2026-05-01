/**
 * Tests for resolvePreferredModel — catalog-driven model resolver.
 * Uses recommended_for and tags from the model catalog instead of name matching.
 */

import { describe, test, expect, beforeAll } from '@jest/globals';

let resolvePreferredModel, AGENT_TEMPLATES, TEMPLATE_PURPOSE_MAP;

beforeAll(async () => {
  ({ resolvePreferredModel, AGENT_TEMPLATES, TEMPLATE_PURPOSE_MAP } =
    await import('../../web-ui/src/constants/index.js'));
});

// Models with catalog computed fields
const MOCK_MODELS = [
  { id: 'o4-mini', modelName: 'o4-mini', recommended_for: ['vision', 'reasoning', 'default'], tags: ['vision', 'reasoning', 'agentic', 'budget', 'fast'], tier: 'budget' },
  { id: 'gpt-5.3-codex', modelName: 'gpt-5.3-codex', recommended_for: ['coding'], tags: ['agentic', 'standard-cost'], tier: 'standard' },
  { id: 'gpt-5.4', modelName: 'gpt-5.4', recommended_for: ['creative'], tags: ['agentic', 'standard-cost'], tier: 'standard' },
  { id: 'gpt-5-mini', modelName: 'gpt-5-mini', recommended_for: ['vision', 'default'], tags: ['vision', 'agentic', 'budget', 'fast'], tier: 'budget' },
  { id: 'Kimi-K2.5', modelName: 'Kimi-K2.5', recommended_for: ['vision'], tags: ['vision', 'budget'], tier: 'budget' },
  { id: 'grok-4', modelName: 'grok-4', recommended_for: [], tags: ['agentic', 'standard-cost'], tier: 'standard' },
  { id: 'DeepSeek-V3.2', modelName: 'DeepSeek-V3.2', recommended_for: [], tags: ['agentic', 'budget'], tier: 'budget' },
];

describe('resolvePreferredModel (catalog-driven)', () => {

  describe('recommended_for matching', () => {
    test('Coding Assistant resolves via TEMPLATE_MODEL_HINTS when a hint is available', () => {
      // CODING_ASSISTANT has TEMPLATE_MODEL_HINTS = ['Kimi-K2.5', 'Kimi-K2', 'Kimi'].
      // The hint runs BEFORE recommended_for matching (resolver step 0), so when
      // Kimi-K2.5 is in the catalog it wins over gpt-5.3-codex even though the
      // latter is `recommended_for: ['coding']`. This is intentional — the hint
      // pins a known-good model for the coder template until catalog metadata
      // can be trusted to drive the choice unaided.
      const result = resolvePreferredModel(AGENT_TEMPLATES.CODING_ASSISTANT, MOCK_MODELS);
      expect(result).toBe('Kimi-K2.5');
    });

    test('Coding Assistant falls through to recommended_for "coding" when no hint matches', () => {
      // Same catalog minus Kimi entries — hint can't match, so step 1
      // (recommended_for purpose match) takes over and selects the coding model.
      const noKimiCatalog = MOCK_MODELS.filter(m => !/kimi/i.test(m.id));
      const result = resolvePreferredModel(AGENT_TEMPLATES.CODING_ASSISTANT, noKimiCatalog);
      expect(result).toBe('gpt-5.3-codex');
    });

    test('Security Architect resolves to model recommended for reasoning', () => {
      const result = resolvePreferredModel(AGENT_TEMPLATES.SECURITY_ARCHITECT, MOCK_MODELS);
      expect(result).toBe('o4-mini');
    });

    test('Creative Writer resolves to model recommended for creative', () => {
      const result = resolvePreferredModel(AGENT_TEMPLATES.CREATIVE_WRITER, MOCK_MODELS);
      expect(result).toBe('gpt-5.4');
    });

    test('System Admin resolves to model recommended for default', () => {
      const result = resolvePreferredModel(AGENT_TEMPLATES.SYSTEM_ADMIN, MOCK_MODELS);
      expect(result).toBe('o4-mini'); // first model with recommended_for: 'default'
    });

    test('Custom resolves to default model', () => {
      const result = resolvePreferredModel(AGENT_TEMPLATES.CUSTOM, MOCK_MODELS);
      expect(result).toBe('o4-mini');
    });
  });

  describe('tag fallback', () => {
    test('falls back to tag match when no recommended_for match', () => {
      // Models without any recommended_for
      const models = [
        { id: 'model-a', modelName: 'model-a', tags: ['coding'], recommended_for: [] },
        { id: 'model-b', modelName: 'model-b', tags: ['general'], recommended_for: [] },
      ];
      const result = resolvePreferredModel(AGENT_TEMPLATES.CODING_ASSISTANT, models);
      expect(result).toBe('model-a');
    });
  });

  describe('default fallback', () => {
    test('falls back to default-recommended model when purpose not found', () => {
      const models = [
        { id: 'exotic', modelName: 'exotic', recommended_for: ['default'], tags: [] },
        { id: 'other', modelName: 'other', recommended_for: [], tags: [] },
      ];
      // Creative Writer with no 'creative' recommended_for → falls to 'default'
      const result = resolvePreferredModel(AGENT_TEMPLATES.CREATIVE_WRITER, models);
      expect(result).toBe('exotic');
    });
  });

  describe('first-available fallback', () => {
    test('returns first model when no tags or recommended_for match', () => {
      const models = [
        { id: 'unknown-1', modelName: 'unknown-1' },
        { id: 'unknown-2', modelName: 'unknown-2' },
      ];
      const result = resolvePreferredModel(AGENT_TEMPLATES.CODING_ASSISTANT, models);
      expect(result).toBe('unknown-1');
    });
  });

  describe('edge cases', () => {
    test('returns null for empty list', () => {
      expect(resolvePreferredModel(AGENT_TEMPLATES.CODING_ASSISTANT, [])).toBeNull();
    });

    test('returns null for null', () => {
      expect(resolvePreferredModel(AGENT_TEMPLATES.CODING_ASSISTANT, null)).toBeNull();
    });

    test('handles unknown template gracefully', () => {
      const result = resolvePreferredModel('nonexistent', MOCK_MODELS);
      // Unknown template defaults to 'default' purpose → finds o4-mini
      expect(result).toBe('o4-mini');
    });

    test('every AGENT_TEMPLATE has a purpose in TEMPLATE_PURPOSE_MAP', () => {
      for (const key of Object.values(AGENT_TEMPLATES)) {
        expect(TEMPLATE_PURPOSE_MAP[key]).toBeDefined();
      }
    });
  });
});
