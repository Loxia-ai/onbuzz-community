/**
 * Tests for BaseTool#getEffectiveConfig — the helper tools use to merge
 * global defaults (this.config) with per-agent overrides delivered via
 * context.toolConfig (from agent.toolConfig[toolId]).
 *
 * Contract: per-agent > global > fallbacks. Missing/malformed context
 * leaves the tool looking only at its own config (no crash).
 */

import { describe, test, expect } from '@jest/globals';
import { BaseTool } from '../baseTool.js';

function makeTool(config = {}) {
  const t = new BaseTool(config, { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
  return t;
}

describe('BaseTool.getEffectiveConfig', () => {
  test('returns this.config when context is missing', () => {
    const tool = makeTool({ allowedCommands: ['git'] });
    expect(tool.getEffectiveConfig(null)).toEqual({ allowedCommands: ['git'] });
    expect(tool.getEffectiveConfig(undefined)).toEqual({ allowedCommands: ['git'] });
    expect(tool.getEffectiveConfig({})).toEqual({ allowedCommands: ['git'] });
  });

  test('returns this.config when context has no toolConfig', () => {
    const tool = makeTool({ allowedCommands: ['git'] });
    expect(tool.getEffectiveConfig({ toolConfig: null })).toEqual({ allowedCommands: ['git'] });
  });

  test('per-agent toolConfig overrides global config field', () => {
    const tool = makeTool({ allowedCommands: ['git'] });
    const effective = tool.getEffectiveConfig({
      toolConfig: { allowedCommands: ['git', 'npm'] },
    });
    expect(effective.allowedCommands).toEqual(['git', 'npm']);
  });

  test('per-agent toolConfig merges extra fields with global config', () => {
    const tool = makeTool({ allowedCommands: ['git'], maxBackgroundCommandsPerAgent: 3 });
    const effective = tool.getEffectiveConfig({
      toolConfig: { blockedCommands: ['rm -rf'] },
    });
    expect(effective).toEqual({
      allowedCommands: ['git'],
      maxBackgroundCommandsPerAgent: 3,
      blockedCommands: ['rm -rf'],
    });
  });

  test('fallbacks are applied only when neither global nor per-agent sets the field', () => {
    const tool = makeTool({ allowedCommands: ['git'] });
    const effective = tool.getEffectiveConfig({ toolConfig: { } }, {
      maxFileSize: 10_000,
      allowedCommands: ['SHOULD NOT WIN'],
    });
    expect(effective.allowedCommands).toEqual(['git']);    // global wins over fallback
    expect(effective.maxFileSize).toBe(10_000);            // fallback fills the gap
  });

  test('malformed toolConfig (array) is ignored', () => {
    const tool = makeTool({ allowedCommands: ['git'] });
    const effective = tool.getEffectiveConfig({ toolConfig: ['not', 'an', 'object'] });
    expect(effective).toEqual({ allowedCommands: ['git'] });
  });

  test('malformed toolConfig (primitive) is ignored', () => {
    const tool = makeTool({ allowedCommands: ['git'] });
    expect(tool.getEffectiveConfig({ toolConfig: 'bogus' })).toEqual({ allowedCommands: ['git'] });
    expect(tool.getEffectiveConfig({ toolConfig: 42 })).toEqual({ allowedCommands: ['git'] });
  });

  test('agents with empty toolConfig get plain global config', () => {
    const tool = makeTool({ allowedCommands: ['git'] });
    expect(tool.getEffectiveConfig({ toolConfig: {} })).toEqual({ allowedCommands: ['git'] });
  });
});
