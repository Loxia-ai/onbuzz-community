import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock FileAttachmentService and serviceRegistry
jest.unstable_mockModule('../fileAttachmentService.js', () => ({
  default: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    getActiveAttachments: jest.fn().mockResolvedValue([]),
    getAttachmentContent: jest.fn().mockResolvedValue(null)
  }))
}));

jest.unstable_mockModule('../serviceRegistry.js', () => ({
  default: {
    getAll: jest.fn(() => ({}))
  }
}));

const { default: ContextInjectionService } = await import('../contextInjectionService.js');
const { default: registry } = await import('../serviceRegistry.js');

describe('ContextInjectionService', () => {
  let service;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
    service = new ContextInjectionService({}, logger);
  });

  test('initialize delegates to attachmentService', async () => {
    await service.initialize();
    expect(service.attachmentService.initialize).toHaveBeenCalled();
  });

  test('buildDynamicContext returns empty string when no attachments', async () => {
    service.attachmentService.getActiveAttachments.mockResolvedValue([]);
    const result = await service.buildDynamicContext('agent-1');
    expect(result).toBe('');
  });

  test('buildDynamicContext builds content file section', async () => {
    service.attachmentService.getActiveAttachments.mockResolvedValue([
      { fileId: 'f1', fileName: 'test.txt', mode: 'content', contentType: 'text', fileType: 'text/plain', size: 1024 }
    ]);
    service.attachmentService.getAttachmentContent.mockResolvedValue('file content here');

    const result = await service.buildDynamicContext('agent-1');
    expect(result).toContain('<attached-files>');
    expect(result).toContain('</attached-files>');
    expect(result).toContain('file content here');
  });

  test('buildDynamicContext builds reference file section', async () => {
    service.attachmentService.getActiveAttachments.mockResolvedValue([
      { fileId: 'f2', fileName: 'ref.js', mode: 'reference', fileType: 'text/javascript', size: 2048, originalPath: '/path/to/ref.js', lastModified: '2024-01-01T00:00:00Z' }
    ]);

    const result = await service.buildDynamicContext('agent-1');
    expect(result).toContain('<file-references>');
    expect(result).toContain('</file-references>');
    expect(result).toContain('ref.js');
    expect(result).toContain('filesystem tool');
  });

  test('buildDynamicContext skips content files with null content', async () => {
    service.attachmentService.getActiveAttachments.mockResolvedValue([
      { fileId: 'f1', fileName: 'test.txt', mode: 'content', contentType: 'text', fileType: 'text/plain', size: 512 }
    ]);
    service.attachmentService.getAttachmentContent.mockResolvedValue(null);

    const result = await service.buildDynamicContext('agent-1');
    expect(result).toContain('<attached-files>');
    expect(result).not.toContain('test.txt');
  });

  test('buildDynamicContext handles errors and returns empty string', async () => {
    service.attachmentService.getActiveAttachments.mockRejectedValue(new Error('fail'));
    const result = await service.buildDynamicContext('agent-1');
    expect(result).toBe('');
    expect(logger.error).toHaveBeenCalled();
  });

  test('formatContentFile handles text content type', () => {
    const result = service.formatContentFile(
      { fileName: 'test.txt', fileType: 'text/plain', size: 1024, contentType: 'text' },
      'hello world'
    );
    expect(result).toContain('test.txt');
    expect(result).toContain('hello world');
    expect(result).toContain('1.00KB');
  });

  test('formatContentFile handles image content type', () => {
    const result = service.formatContentFile(
      { fileName: 'img.png', fileType: 'image/png', size: 2048, contentType: 'image' },
      'data:image/png;base64,abc'
    );
    expect(result).toContain('img.png');
    expect(result).toContain('base64');
  });

  test('formatContentFile handles pdf content type', () => {
    const result = service.formatContentFile(
      { fileName: 'doc.pdf', fileType: 'application/pdf', size: 4096, contentType: 'pdf' },
      'extracted text'
    );
    expect(result).toContain('doc.pdf');
    expect(result).toContain('extracted text');
  });

  test('formatContentFile uses fallback for unknown content type', () => {
    const result = service.formatContentFile(
      { fileName: 'data.bin', fileType: 'application/octet-stream', size: 512, contentType: 'binary' },
      'raw data'
    );
    expect(result).toContain('data.bin');
    expect(result).toContain('raw data');
  });

  test('formatReferenceFile returns formatted XML tag', () => {
    const result = service.formatReferenceFile({
      fileName: 'ref.js',
      originalPath: '/src/ref.js',
      size: 2048,
      fileType: 'text/javascript',
      lastModified: '2024-06-15T12:00:00Z'
    });
    expect(result).toContain('ref.js');
    expect(result).toContain('/src/ref.js');
    expect(result).toContain('2024-06-15');
  });

  test('escapeXml escapes special characters', () => {
    expect(service.escapeXml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
    expect(service.escapeXml(null)).toBe('');
    expect(service.escapeXml('')).toBe('');
  });

  test('formatBytes handles various sizes', () => {
    expect(service.formatBytes(0)).toBe('0 Bytes');
    expect(service.formatBytes(500)).toContain('Bytes');
    expect(service.formatBytes(1024)).toContain('KB');
    expect(service.formatBytes(1048576)).toContain('MB');
  });

  test('estimateTotalTokens sums content tokens and reference overhead', async () => {
    service.attachmentService.getActiveAttachments.mockResolvedValue([
      { mode: 'content', tokenEstimate: 100 },
      { mode: 'content', tokenEstimate: 200 },
      { mode: 'reference' }
    ]);
    const total = await service.estimateTotalTokens('agent-1');
    expect(total).toBe(320); // 100 + 200 + 20
  });

  test('estimateTotalTokens handles error', async () => {
    service.attachmentService.getActiveAttachments.mockRejectedValue(new Error('fail'));
    const total = await service.estimateTotalTokens('agent-1');
    expect(total).toBe(0);
  });

  test('getAttachmentSummary returns summary object', async () => {
    service.attachmentService.getActiveAttachments.mockResolvedValue([
      { fileName: 'a.txt', mode: 'content', size: 1024, tokenEstimate: 50 },
      { fileName: 'b.js', mode: 'reference', size: 2048, tokenEstimate: 0 }
    ]);
    const summary = await service.getAttachmentSummary('agent-1');
    expect(summary.totalActive).toBe(2);
    expect(summary.contentMode).toBe(1);
    expect(summary.referenceMode).toBe(1);
    expect(summary.files).toHaveLength(2);
  });

  test('getAttachmentSummary handles error with defaults', async () => {
    service.attachmentService.getActiveAttachments.mockRejectedValue(new Error('fail'));
    const summary = await service.getAttachmentSummary('agent-1');
    expect(summary.totalActive).toBe(0);
    expect(summary.files).toEqual([]);
  });

  test('buildSystemConstraints returns port constraint string', () => {
    registry.getAll.mockReturnValue({
      web: { port: 3000 },
      api: { port: 8080 }
    });
    const result = service.buildSystemConstraints();
    expect(result).toContain('3000');
    expect(result).toContain('8080');
    expect(result).toContain('never kill');
  });

  test('buildSystemConstraints returns empty when no ports', () => {
    registry.getAll.mockReturnValue({});
    const result = service.buildSystemConstraints();
    expect(result).toBe('');
  });

  test('buildSystemConstraints handles errors gracefully', () => {
    registry.getAll.mockImplementation(() => { throw new Error('fail'); });
    const result = service.buildSystemConstraints();
    expect(result).toBe('');
  });

  describe('buildCurrentTimeContext', () => {
    test('formats a fixed Date as "Current local time: hh:mm dd/mm/yyyy"', () => {
      // Construct a date from explicit local-time fields so this test
      // doesn't drift across host timezones (which getHours/getDate read).
      const fixed = new Date(2026, 3, 26, 9, 5, 0); // Apr 26 2026, 09:05 local
      const result = service.buildCurrentTimeContext(fixed);
      expect(result).toBe('\n\nCurrent local time: 09:05 26/04/2026');
    });

    test('zero-pads single-digit hours, minutes, day, month', () => {
      const fixed = new Date(2026, 0, 3, 7, 4, 0); // Jan 03 2026, 07:04 local
      const result = service.buildCurrentTimeContext(fixed);
      expect(result).toBe('\n\nCurrent local time: 07:04 03/01/2026');
    });

    test('renders midnight as 00:00, not 24:00', () => {
      const fixed = new Date(2026, 11, 31, 0, 0, 0); // Dec 31 2026, 00:00 local
      expect(service.buildCurrentTimeContext(fixed)).toBe('\n\nCurrent local time: 00:00 31/12/2026');
    });

    test('returns empty string for invalid Date', () => {
      expect(service.buildCurrentTimeContext(new Date('invalid'))).toBe('');
    });

    test('returns empty string for non-Date input', () => {
      expect(service.buildCurrentTimeContext('2026-04-26')).toBe('');
      expect(service.buildCurrentTimeContext(null)).toBe('');
      expect(service.buildCurrentTimeContext(undefined)).not.toBe('');   // defaults to new Date()
    });

    test('default argument uses current time (string is non-empty and well-formed)', () => {
      const result = service.buildCurrentTimeContext();
      expect(result).toMatch(/^\n\nCurrent local time: \d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
    });

    test('output begins with two newlines so it cleanly appends to existing prompt', () => {
      const result = service.buildCurrentTimeContext(new Date(2026, 5, 1, 12, 0, 0));
      expect(result.startsWith('\n\n')).toBe(true);
    });
  });
});
