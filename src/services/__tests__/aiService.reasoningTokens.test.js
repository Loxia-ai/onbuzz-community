/**
 * Tests for _extractReasoningTokens — pulls a reasoning-token count out
 * of a provider's `usage` block regardless of which schema the provider
 * chose. Surfaced even for opaque providers (OpenAI o-series) that don't
 * return reasoning content text — the count alone is useful signal.
 */

import { describe, test, expect } from '@jest/globals';
import { _extractReasoningTokens } from '../aiService.js';

describe('_extractReasoningTokens', () => {
  test('returns null for null/undefined/non-object', () => {
    expect(_extractReasoningTokens(null)).toBeNull();
    expect(_extractReasoningTokens(undefined)).toBeNull();
    expect(_extractReasoningTokens('{}')).toBeNull();
    expect(_extractReasoningTokens(42)).toBeNull();
  });

  test('returns null when no reasoning tokens fields present', () => {
    expect(_extractReasoningTokens({ prompt_tokens: 100, completion_tokens: 50 })).toBeNull();
  });

  test('OpenAI shape: completion_tokens_details.reasoning_tokens', () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 200,
      completion_tokens_details: { reasoning_tokens: 150 },
    };
    expect(_extractReasoningTokens(usage)).toBe(150);
  });

  test('Flat shape: usage.reasoning_tokens', () => {
    expect(_extractReasoningTokens({ reasoning_tokens: 512 })).toBe(512);
  });

  test('Anthropic-style shape: output_tokens_details.reasoning_tokens', () => {
    expect(_extractReasoningTokens({
      output_tokens_details: { reasoning_tokens: 4217 }
    })).toBe(4217);
  });

  test('camelCase variant: completionTokensDetails.reasoningTokens', () => {
    expect(_extractReasoningTokens({
      completionTokensDetails: { reasoningTokens: 1024 }
    })).toBe(1024);
  });

  test('preference order — flat reasoning_tokens wins when multiple present', () => {
    // Not a provider we expect, but defensive: if both are set, the
    // flattened top-level field is first in the candidate list.
    expect(_extractReasoningTokens({
      reasoning_tokens: 100,
      completion_tokens_details: { reasoning_tokens: 999 },
    })).toBe(100);
  });

  test('zero is a valid count, not null', () => {
    expect(_extractReasoningTokens({ reasoning_tokens: 0 })).toBe(0);
  });

  test('non-finite values are skipped (defensive against NaN/Infinity)', () => {
    expect(_extractReasoningTokens({ reasoning_tokens: NaN })).toBeNull();
    expect(_extractReasoningTokens({ reasoning_tokens: Infinity })).toBeNull();
    expect(_extractReasoningTokens({ reasoning_tokens: 'lots' })).toBeNull();
  });
});
