import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';
import ConversationCompactionService from '../conversationCompactionService.js';

describe('ConversationCompactionService - _generateSummary retry behavior', () => {
  let logger;
  let service;

  const mockAiService = {
    sendMessage: jest.fn()
  };

  const mockTokenCountingService = {
    getConversationTokenCount: jest.fn().mockReturnValue(50000),
    getModelContextWindow: jest.fn().mockReturnValue(128000),
    getModelMaxOutputTokens: jest.fn().mockReturnValue(8192),
    shouldTriggerCompaction: jest.fn().mockReturnValue(false),
    calculateTargetTokenCount: jest.fn().mockReturnValue(100000)
  };

  const mockModelsService = {
    getAvailableModelNames: jest.fn().mockReturnValue(['gpt-5.1-codex-mini', 'gpt-5-mini']),
    getModels: jest.fn().mockReturnValue([
      { name: 'gpt-5.1-codex-mini', type: 'chat', contextWindow: 400000 },
      { name: 'gpt-5-mini', type: 'chat', contextWindow: 400000 },
      { name: 'gpt-5-nano', type: 'chat', contextWindow: 400000 },
      { name: 'random-model-xyz', type: 'chat', contextWindow: 200000 }
    ])
  };

  const testMessages = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there, how can I help?' },
    { role: 'user', content: 'Tell me about testing' },
    { role: 'assistant', content: 'Testing is important for code quality...' }
  ];

  beforeEach(() => {
    logger = createMockLogger();
    mockAiService.sendMessage.mockReset();
    mockModelsService.getAvailableModelNames.mockClear();
    mockModelsService.getModels.mockClear();

    service = new ConversationCompactionService(mockTokenCountingService, mockAiService, logger);
    service.setModelsService(mockModelsService);
    service.compactionModelIndex = 0;
  });

  // ─── onRetryAttempt callback ────────────────────────────────────────

  describe('onRetryAttempt callback', () => {
    test('onRetryAttempt is called when first model fails and second model exists', async () => {
      const onRetryAttempt = jest.fn();

      // Only 2 validated models available; first fails, second succeeds
      mockModelsService.getAvailableModelNames.mockReturnValue(['gpt-5.1-codex-mini', 'gpt-5-mini']);
      mockAiService.sendMessage
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockResolvedValueOnce({ content: 'Summary of conversation' });

      await service._generateSummary(testMessages, 'gpt-5.1-codex-mini', { onRetryAttempt });

      expect(onRetryAttempt).toHaveBeenCalledTimes(1);
    });

    test('onRetryAttempt receives correct message, failedModel, nextModel, attempt', async () => {
      const onRetryAttempt = jest.fn();

      mockModelsService.getAvailableModelNames.mockReturnValue(['gpt-5.1-codex-mini', 'gpt-5-mini']);
      mockAiService.sendMessage
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockResolvedValueOnce({ content: 'Summary of conversation' });

      await service._generateSummary(testMessages, 'gpt-5.1-codex-mini', { onRetryAttempt });

      expect(onRetryAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'compaction_retry',
          failedModel: 'gpt-5.1-codex-mini',
          nextModel: 'gpt-5-mini',
          attempt: 1
        })
      );
    });

    test('onRetryAttempt is NOT called when last recommended model fails and no random model available', async () => {
      const onRetryAttempt = jest.fn();

      // Only 1 validated model, and no suitable random models
      mockModelsService.getAvailableModelNames.mockReturnValue(['gpt-5.1-codex-mini']);
      mockModelsService.getModels.mockReturnValue([
        { name: 'gpt-5.1-codex-mini', type: 'chat', contextWindow: 400000 }
      ]);
      mockAiService.sendMessage.mockRejectedValue(new Error('Service unavailable'));

      await expect(
        service._generateSummary(testMessages, 'gpt-5.1-codex-mini', { onRetryAttempt })
      ).rejects.toThrow();

      // The only call to onRetryAttempt would be from the last-resort block, but
      // there are no suitable random models (the only model was already attempted)
      // so onRetryAttempt should not be called at all
      expect(onRetryAttempt).not.toHaveBeenCalled();
    });
  });

  // ─── Random model fallback ─────────────────────────────────────────

  describe('Random model fallback', () => {
    test('after all recommended models fail, tries a random model from modelsService', async () => {
      mockModelsService.getAvailableModelNames.mockReturnValue(['gpt-5.1-codex-mini']);
      mockModelsService.getModels.mockReturnValue([
        { name: 'gpt-5.1-codex-mini', type: 'chat', contextWindow: 400000 },
        { name: 'random-model-xyz', type: 'chat', contextWindow: 200000 }
      ]);
      mockAiService.sendMessage
        .mockRejectedValueOnce(new Error('Service unavailable'))  // recommended model fails
        .mockResolvedValueOnce({ content: 'Last-resort summary' }); // random model succeeds

      const result = await service._generateSummary(testMessages, 'gpt-5.1-codex-mini', {});

      // Should have been called twice: once for recommended, once for random
      expect(mockAiService.sendMessage).toHaveBeenCalledTimes(2);
      expect(result.content).toContain('Last-resort summary');
    });

    test('random model success returns valid summary and does not throw', async () => {
      mockModelsService.getAvailableModelNames.mockReturnValue(['gpt-5.1-codex-mini']);
      mockModelsService.getModels.mockReturnValue([
        { name: 'gpt-5.1-codex-mini', type: 'chat', contextWindow: 400000 },
        { name: 'fallback-model', type: 'chat', contextWindow: 200000 }
      ]);
      mockAiService.sendMessage
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockResolvedValueOnce({ content: 'Fallback summary content' });

      const result = await service._generateSummary(testMessages, 'gpt-5.1-codex-mini', {});

      expect(result.role).toBe('system');
      expect(result.type).toBe('summary');
      expect(result.metadata.lastResort).toBe(true);
    });

    test('random model failure still throws ALL_MODELS_EXHAUSTED', async () => {
      mockModelsService.getAvailableModelNames.mockReturnValue(['gpt-5.1-codex-mini']);
      mockAiService.sendMessage.mockRejectedValue(new Error('Everything is broken'));

      await expect(
        service._generateSummary(testMessages, 'gpt-5.1-codex-mini', {})
      ).rejects.toThrow('ALL_MODELS_EXHAUSTED');
    });

    test('random model is NOT one already attempted (filtered out)', async () => {
      // Only gpt-5.1-codex-mini is validated; random pool has others
      mockModelsService.getAvailableModelNames.mockReturnValue(['gpt-5.1-codex-mini']);
      mockModelsService.getModels.mockReturnValue([
        { name: 'gpt-5.1-codex-mini', type: 'chat', contextWindow: 400000 },
        { name: 'random-model-xyz', type: 'chat', contextWindow: 200000 }
      ]);
      mockAiService.sendMessage
        .mockRejectedValueOnce(new Error('fail'))  // gpt-5.1-codex-mini fails
        .mockResolvedValueOnce({ content: 'Random success' }); // random-model-xyz succeeds

      const result = await service._generateSummary(testMessages, 'gpt-5.1-codex-mini', {});

      // Second call should be the random model, not the already-attempted one
      const secondCallModel = mockAiService.sendMessage.mock.calls[1][0];
      expect(secondCallModel).not.toBe('gpt-5.1-codex-mini');
      expect(result.metadata.compactionModel).not.toBe('gpt-5.1-codex-mini');
    });

    test('random model must have sufficient context window', async () => {
      // All models except the recommended one have tiny context windows
      mockModelsService.getAvailableModelNames.mockReturnValue(['gpt-5.1-codex-mini']);
      mockModelsService.getModels.mockReturnValue([
        { name: 'gpt-5.1-codex-mini', type: 'chat', contextWindow: 400000 },
        { name: 'tiny-model', type: 'chat', contextWindow: 100 } // too small
      ]);
      mockAiService.sendMessage.mockRejectedValue(new Error('fail'));

      await expect(
        service._generateSummary(testMessages, 'gpt-5.1-codex-mini', {})
      ).rejects.toThrow('ALL_MODELS_EXHAUSTED');

      // Should only have tried the recommended model, not the tiny one
      expect(mockAiService.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  // ─── onAllModelsExhausted ──────────────────────────────────────────

  describe('onAllModelsExhausted', () => {
    test('onAllModelsExhausted is called only after ALL models (including random) fail', async () => {
      const onAllModelsExhausted = jest.fn();

      mockModelsService.getAvailableModelNames.mockReturnValue(['gpt-5.1-codex-mini']);
      mockAiService.sendMessage.mockRejectedValue(new Error('fail'));

      await expect(
        service._generateSummary(testMessages, 'gpt-5.1-codex-mini', { onAllModelsExhausted })
      ).rejects.toThrow('ALL_MODELS_EXHAUSTED');

      expect(onAllModelsExhausted).toHaveBeenCalledTimes(1);
      expect(onAllModelsExhausted).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'compaction_models_exhausted'
        })
      );
    });

    test('onAllModelsExhausted includes all attempted model names', async () => {
      const onAllModelsExhausted = jest.fn();

      mockModelsService.getAvailableModelNames.mockReturnValue(['gpt-5.1-codex-mini', 'gpt-5-mini']);
      mockAiService.sendMessage.mockRejectedValue(new Error('fail'));

      await expect(
        service._generateSummary(testMessages, 'gpt-5.1-codex-mini', { onAllModelsExhausted })
      ).rejects.toThrow('ALL_MODELS_EXHAUSTED');

      const callArg = onAllModelsExhausted.mock.calls[0][0];
      expect(callArg.models).toContain('gpt-5.1-codex-mini');
      expect(callArg.models).toContain('gpt-5-mini');
      // Should also include at least one random model that was attempted
      expect(callArg.models.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Happy path ────────────────────────────────────────────────────

  describe('Happy path', () => {
    test('first model succeeds — no callbacks called, summary returned', async () => {
      const onRetryAttempt = jest.fn();
      const onAllModelsExhausted = jest.fn();

      mockModelsService.getAvailableModelNames.mockReturnValue(['gpt-5.1-codex-mini', 'gpt-5-mini']);
      mockAiService.sendMessage.mockResolvedValueOnce({ content: 'Great summary here' });

      const result = await service._generateSummary(testMessages, 'gpt-5.1-codex-mini', {
        onRetryAttempt,
        onAllModelsExhausted
      });

      expect(onRetryAttempt).not.toHaveBeenCalled();
      expect(onAllModelsExhausted).not.toHaveBeenCalled();
      expect(result.role).toBe('system');
      expect(result.type).toBe('summary');
      expect(result.content).toContain('Great summary here');
      expect(mockAiService.sendMessage).toHaveBeenCalledTimes(1);
    });

    test('second model succeeds after first fails — onRetryAttempt called once, summary returned', async () => {
      const onRetryAttempt = jest.fn();
      const onAllModelsExhausted = jest.fn();

      mockModelsService.getAvailableModelNames.mockReturnValue(['gpt-5.1-codex-mini', 'gpt-5-mini']);
      mockAiService.sendMessage
        .mockRejectedValueOnce(new Error('429 rate limit'))
        .mockResolvedValueOnce({ content: 'Second model summary' });

      const result = await service._generateSummary(testMessages, 'gpt-5.1-codex-mini', {
        onRetryAttempt,
        onAllModelsExhausted
      });

      expect(onRetryAttempt).toHaveBeenCalledTimes(1);
      expect(onAllModelsExhausted).not.toHaveBeenCalled();
      expect(result.content).toContain('Second model summary');
      expect(result.metadata.compactionModel).toBe('gpt-5-mini');
    });
  });
});
