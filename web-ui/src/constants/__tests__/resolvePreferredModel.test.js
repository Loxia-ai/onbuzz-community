/**
 * Tests for resolvePreferredModel — the template → model selector used
 * by AgentCreationModal. Locks:
 *   - CODING_ASSISTANT prefers Kimi when available (template hint)
 *   - Hint falls through to purpose-based search when no Kimi in catalog
 *   - Substring match is case-insensitive
 *   - Returns null for empty catalogs
 */

import { describe, it, expect } from 'vitest';
import { resolvePreferredModel, AGENT_TEMPLATES } from '../index';

describe('resolvePreferredModel', () => {
  it('returns null when no models are available', () => {
    expect(resolvePreferredModel(AGENT_TEMPLATES.CODING_ASSISTANT, [])).toBeNull();
    expect(resolvePreferredModel(AGENT_TEMPLATES.CODING_ASSISTANT, null)).toBeNull();
  });

  it('CODING_ASSISTANT picks Kimi-K2.5 over a coding-tagged model', () => {
    const models = [
      { id: 'sonnet-4',  modelName: 'Claude Sonnet 4',  recommended_for: ['coding'] },
      { id: 'kimi-k25',  modelName: 'Kimi-K2.5' },
      { id: 'gpt',       modelName: 'GPT-5' },
    ];
    expect(resolvePreferredModel(AGENT_TEMPLATES.CODING_ASSISTANT, models)).toBe('kimi-k25');
  });

  it('CODING_ASSISTANT falls back to K2 when K2.5 unavailable', () => {
    const models = [
      { id: 'kimi-k2', modelName: 'Kimi-K2-Instruct' },
      { id: 'sonnet',  modelName: 'Claude Sonnet 4', recommended_for: ['coding'] },
    ];
    expect(resolvePreferredModel(AGENT_TEMPLATES.CODING_ASSISTANT, models)).toBe('kimi-k2');
  });

  it('CODING_ASSISTANT falls back to catalog recommendation when no Kimi available', () => {
    const models = [
      { id: 'sonnet', modelName: 'Claude Sonnet 4', recommended_for: ['coding'] },
      { id: 'gpt',    modelName: 'GPT-5' },
    ];
    expect(resolvePreferredModel(AGENT_TEMPLATES.CODING_ASSISTANT, models)).toBe('sonnet');
  });

  it('hint matching is case-insensitive', () => {
    const models = [{ id: 'kimi-lower', modelName: 'kimi-k2.5-preview' }];
    expect(resolvePreferredModel(AGENT_TEMPLATES.CODING_ASSISTANT, models)).toBe('kimi-lower');
  });

  it('DATA_ANALYST has no hint, uses catalog recommendation', () => {
    const models = [
      { id: 'kimi', modelName: 'Kimi-K2.5' },
      { id: 'opus', modelName: 'Claude Opus 4', recommended_for: ['default'] },
    ];
    // DATA_ANALYST purpose is 'default' → Opus wins, not Kimi.
    expect(resolvePreferredModel(AGENT_TEMPLATES.DATA_ANALYST, models)).toBe('opus');
  });
});
