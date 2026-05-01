import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockAiService } from '../../__test-utils__/mockFactories.js';
import ConversationCompactionService from '../conversationCompactionService.js';

describe('ConversationCompactionService', () => {
  let logger;
  let aiService;
  let tokenCountingService;
  let service;

  beforeEach(() => {
    logger = createMockLogger();
    aiService = createMockAiService();

    tokenCountingService = {
      getConversationTokenCount: jest.fn().mockReturnValue(50000),
      getModelContextWindow: jest.fn().mockReturnValue(128000),
      getModelMaxOutputTokens: jest.fn().mockReturnValue(8192),
      shouldTriggerCompaction: jest.fn().mockReturnValue(false),
      calculateTargetTokenCount: jest.fn().mockReturnValue(100000)
    };

    service = new ConversationCompactionService(tokenCountingService, aiService, logger);
  });

  // ─── Constructor ─────────────────────────────────────────────────────

  test('constructor creates instance with dependencies', () => {
    expect(service).toBeInstanceOf(ConversationCompactionService);
    expect(service.tokenCountingService).toBe(tokenCountingService);
    expect(service.aiService).toBe(aiService);
    expect(service.logger).toBe(logger);
    expect(service.modelsService).toBeNull();
    expect(service.compactionModelIndex).toBe(0);
  });

  // ─── compactConversation ─────────────────────────────────────────────

  test('compactConversation throws on empty messages array', async () => {
    await expect(service.compactConversation([], 'model-a', 'model-a'))
      .rejects.toThrow('Messages array is required and cannot be empty');
  });

  test('compactConversation with fewer than MIN_MESSAGES returns skipped result', async () => {
    // MIN_MESSAGES_FOR_COMPACTION = 10, send only 3 short messages
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'bye' }
    ];

    const result = await service.compactConversation(messages, 'model-a', 'model-a');
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('Too few messages');
    expect(result.compactedMessages).toBe(messages);
  });

  // ─── _splitOversizedMessages ─────────────────────────────────────────

  test('_splitOversizedMessages does not split short messages', () => {
    const messages = [
      { role: 'user', content: 'short message' },
      { role: 'assistant', content: 'another short one' }
    ];
    const result = service._splitOversizedMessages(messages);
    expect(result.wasSplit).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe('short message');
  });

  test('_splitOversizedMessages splits messages exceeding threshold into chunks', () => {
    // OVERSIZED_MESSAGE_THRESHOLD = 50000, MAX_CHUNK_SIZE = 30000
    const longContent = 'A'.repeat(60000);
    const messages = [
      { role: 'user', content: longContent }
    ];
    const result = service._splitOversizedMessages(messages);
    expect(result.wasSplit).toBe(true);
    expect(result.messages.length).toBeGreaterThan(1);
    // Each chunk should have Part metadata
    expect(result.messages[0].content).toContain('[Part 1/');
    expect(result.messages[0]._splitMetadata).toBeDefined();
    expect(result.messages[0]._splitMetadata.chunkIndex).toBe(0);
  });

  // ─── _splitContentIntoChunks ─────────────────────────────────────────

  test('_splitContentIntoChunks splits at paragraph boundary (double newline)', () => {
    // Build content with paragraphs that exceeds maxChunk
    const para1 = 'X'.repeat(200);
    const para2 = 'Y'.repeat(200);
    const content = para1 + '\n\n' + para2;
    // Use a small maxChunk that forces a split within content
    const maxChunk = 250;
    const chunks = service._splitContentIntoChunks(content, maxChunk);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should end at the double-newline boundary
    expect(chunks[0].endsWith('\n\n')).toBe(true);
  });

  test('_splitContentIntoChunks splits at sentence boundary when no paragraphs', () => {
    // Content with sentences but no newlines
    const sentence1 = 'A'.repeat(200) + '. ';
    const sentence2 = 'B'.repeat(200);
    const content = sentence1 + sentence2;
    const maxChunk = 250;
    const chunks = service._splitContentIntoChunks(content, maxChunk);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should end at sentence boundary
    expect(chunks[0].endsWith('. ')).toBe(true);
  });

  test('_splitContentIntoChunks hard-cuts when no boundaries found', () => {
    // Single continuous string with no newlines, no periods, no spaces
    const content = 'X'.repeat(500);
    const maxChunk = 200;
    const chunks = service._splitContentIntoChunks(content, maxChunk);
    expect(chunks.length).toBe(3); // 200 + 200 + 100
    expect(chunks[0]).toHaveLength(200);
    expect(chunks[1]).toHaveLength(200);
    expect(chunks[2]).toHaveLength(100);
  });

  test('_splitContentIntoChunks returns single chunk for short content', () => {
    const chunks = service._splitContentIntoChunks('short', 1000);
    expect(chunks).toEqual(['short']);
  });

  // ─── _identifySegments ──────────────────────────────────────────────

  test('_identifySegments with <=4 messages returns correct split', () => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
      { role: 'assistant', content: 'fourth' }
    ];
    const segments = service._identifySegments(messages);
    // With <=4 messages, beginning is empty, middle is all except last, end is last
    expect(segments.beginning).toEqual([]);
    expect(segments.middle).toHaveLength(3);
    expect(segments.end).toHaveLength(1);
    expect(segments.end[0].content).toBe('fourth');
  });

  test('_identifySegments with many messages preserves tail', () => {
    const messages = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg-${i}` });
    }
    const segments = service._identifySegments(messages);
    // End should contain the most recent messages (tail)
    expect(segments.end.length).toBeGreaterThan(0);
    // Last message should be in the end segment
    const lastMsg = messages[messages.length - 1];
    expect(segments.end[segments.end.length - 1]).toBe(lastMsg);
    // Middle should contain the earliest messages
    expect(segments.middle.length).toBeGreaterThan(0);
    expect(segments.middle[0]).toBe(messages[0]);
  });

  // ─── _performFallbackCompaction ──────────────────────────────────────

  test('_performFallbackCompaction filters out tool results and extra system messages', () => {
    const mainSystem = { role: 'system', content: 'You are an assistant' };
    const messages = [
      mainSystem,
      { role: 'user', content: 'Do something' },
      { role: 'assistant', content: 'Sure' },
      { role: 'tool', content: 'tool result data' },
      { role: 'system', content: 'extra system message' },
      { role: 'user', content: 'Next question' },
      { role: 'assistant', content: 'Answer', type: 'tool_result' },
      { role: 'user', content: 'Thanks' },
      { role: 'assistant', content: 'Welcome' },
      { role: 'user', content: 'Bye' },
      { role: 'assistant', content: 'Goodbye' }
    ];

    const result = service._performFallbackCompaction(messages);
    const compacted = result.compactedMessages;

    // Should NOT contain the extra system message or tool results
    const hasExtraSystem = compacted.some(m => m.content === 'extra system message');
    const hasToolRole = compacted.some(m => m.role === 'tool');
    const hasToolResult = compacted.some(m => m.type === 'tool_result');
    expect(hasExtraSystem).toBe(false);
    expect(hasToolRole).toBe(false);
    expect(hasToolResult).toBe(false);
  });

  test('_performFallbackCompaction preserves main system message', () => {
    const mainSystem = { role: 'system', content: 'Main system prompt' };
    const messages = [
      mainSystem,
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer' },
      { role: 'user', content: 'Another' },
      { role: 'assistant', content: 'Response' },
      { role: 'user', content: 'More' },
      { role: 'assistant', content: 'Info' },
      { role: 'user', content: 'Last' },
      { role: 'assistant', content: 'End' }
    ];

    const result = service._performFallbackCompaction(messages);
    // Fallback compaction should produce compacted messages
    expect(result.compactedMessages.length).toBeGreaterThan(0);
    expect(result.compactedMessages.length).toBeLessThan(messages.length);
    // Should have a summary message
    const hasSummary = result.compactedMessages.some(m =>
      m.content && m.content.includes('CONVERSATION SUMMARY')
    );
    expect(hasSummary).toBe(true);
  });

  // ─── Full compactConversation with AI ────────────────────────────────

  test('compactConversation calls AI for summarization on sufficient messages', async () => {
    // Build enough messages to exceed MIN_MESSAGES_FOR_COMPACTION (10)
    const messages = [];
    for (let i = 0; i < 15; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message content number ${i} with some padding text to make it realistic.`
      });
    }

    aiService.sendMessage.mockResolvedValue({
      content: 'Summary of the conversation covering key decisions and outcomes.',
      tokenUsage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 }
    });

    const result = await service.compactConversation(messages, 'model-a', 'model-a');

    expect(result.skipped).toBeFalsy();
    expect(result.compactedMessages).toBeDefined();
    expect(result.strategy).toBeDefined();
    expect(aiService.sendMessage).toHaveBeenCalled();
    // The summary message should appear in compacted output
    const summaryMsg = result.compactedMessages.find(m => m.type === 'summary');
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg.content).toContain('[CONVERSATION SUMMARY');
  });

  test('compactConversation handles AI failure by using fallback compaction', async () => {
    const messages = [];
    for (let i = 0; i < 15; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message number ${i} with some text.`
      });
    }

    // Make ALL AI calls fail to trigger fallback
    aiService.sendMessage.mockRejectedValue(new Error('API 429 rate limit exceeded'));

    const result = await service.compactConversation(messages, 'model-a', 'model-a');

    // Should have fallen back to structural compaction, not thrown
    expect(result.strategy).toBe('structural_fallback');
    expect(result.compactedMessages).toBeDefined();
    expect(result.compactedMessages.length).toBeGreaterThan(0);
    // Should contain a summary message from fallback
    const summaryMsg = result.compactedMessages.find(m => m.type === 'summary');
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg.content).toContain('structural fallback');
  });

  // ─── getCompactionStats ──────────────────────────────────────────────

  test('setModelsService injects models service', () => {
    const mockModelsService = { getModels: jest.fn(), getAvailableModelNames: jest.fn() };
    service.setModelsService(mockModelsService);
    expect(service.modelsService).toBe(mockModelsService);
    expect(logger.info).toHaveBeenCalledWith('ModelsService injected into compaction service');
  });
});
