import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock dependencies
const mockFileProcessor = {
  createDirectory: jest.fn().mockResolvedValue(undefined),
  fileExists: jest.fn().mockResolvedValue(true),
  readFile: jest.fn().mockResolvedValue('{}'),
  writeFile: jest.fn().mockResolvedValue(undefined),
  getFileStats: jest.fn().mockResolvedValue({ size: 1024, modified: new Date() }),
  calculateHash: jest.fn().mockResolvedValue('abc123hash'),
  processFile: jest.fn().mockResolvedValue({ content: 'processed content' }),
  estimateTokens: jest.fn().mockReturnValue(100),
  deleteDirectory: jest.fn().mockResolvedValue(undefined)
};

const mockValidator = {
  validate: jest.fn().mockReturnValue({ valid: true, errors: [], warnings: [], sizeLevel: 'small' }),
  getContentType: jest.fn().mockReturnValue('text'),
  getMimeType: jest.fn().mockReturnValue('text/plain')
};

jest.unstable_mockModule('../../utilities/fileProcessor.js', () => ({
  default: jest.fn().mockImplementation(() => mockFileProcessor)
}));

jest.unstable_mockModule('../../utilities/attachmentValidator.js', () => ({
  default: jest.fn().mockImplementation(() => mockValidator)
}));

jest.unstable_mockModule('../../utilities/userDataDir.js', () => ({
  getUserDataPaths: jest.fn(() => ({
    settings: '/fake/settings',
    attachments: '/fake/attachments',
    skills: '/fake/skills'
  })),
  ensureUserDataDirs: jest.fn(async () => {})
}));

jest.unstable_mockModule('crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid-1234')
}));

const { default: FileAttachmentService } = await import('../fileAttachmentService.js');

describe('FileAttachmentService', () => {
  let service;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
    service = new FileAttachmentService({}, logger);
    // Reset index to avoid stale state
    service.index = null;
  });

  test('constructor initializes with null index', () => {
    expect(service.index).toBeNull();
  });

  test('initialize creates directory and loads index', async () => {
    mockFileProcessor.fileExists.mockResolvedValueOnce(false);
    mockFileProcessor.writeFile.mockResolvedValue(undefined);

    await service.initialize();
    expect(mockFileProcessor.createDirectory).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  test('initialize throws on error', async () => {
    mockFileProcessor.createDirectory.mockRejectedValueOnce(new Error('no dir'));
    await expect(service.initialize()).rejects.toThrow('no dir');
  });

  test('loadIndex creates new index when file does not exist', async () => {
    mockFileProcessor.fileExists.mockResolvedValueOnce(false);
    mockFileProcessor.writeFile.mockResolvedValue(undefined);

    const index = await service.loadIndex();
    expect(index).toEqual({ attachments: {}, agentRefs: {} });
  });

  test('loadIndex loads existing index', async () => {
    const existingIndex = { attachments: { f1: {} }, agentRefs: { a1: ['f1'] } };
    mockFileProcessor.fileExists.mockResolvedValueOnce(true);
    mockFileProcessor.readFile.mockResolvedValueOnce(JSON.stringify(existingIndex));

    const index = await service.loadIndex();
    expect(index.attachments.f1).toBeDefined();
  });

  test('loadIndex handles read error with default', async () => {
    mockFileProcessor.fileExists.mockRejectedValueOnce(new Error('read fail'));
    const index = await service.loadIndex();
    expect(index).toEqual({ attachments: {}, agentRefs: {} });
  });

  test('saveIndex writes JSON to file', async () => {
    service.index = { attachments: {}, agentRefs: {} };
    await service.saveIndex();
    expect(mockFileProcessor.writeFile).toHaveBeenCalled();
  });

  test('uploadFile creates attachment metadata', async () => {
    service.index = { attachments: {}, agentRefs: {} };
    mockFileProcessor.fileExists.mockResolvedValue(true);
    mockFileProcessor.getFileStats.mockResolvedValue({ size: 512, modified: new Date() });
    mockFileProcessor.processFile.mockResolvedValue({ content: 'text content' });
    mockFileProcessor.estimateTokens.mockReturnValue(50);
    mockFileProcessor.writeFile.mockResolvedValue(undefined);
    mockFileProcessor.createDirectory.mockResolvedValue(undefined);
    mockValidator.validate.mockReturnValue({ valid: true, errors: [], warnings: [], sizeLevel: 'small' });

    const result = await service.uploadFile({
      agentId: 'agent-1',
      filePath: '/path/to/file.txt',
      mode: 'content'
    });

    expect(result.fileId).toBe('test-uuid-1234');
    expect(result.agentId).toBe('agent-1');
    expect(result.mode).toBe('content');
    expect(service.index.attachments['test-uuid-1234']).toBeDefined();
  });

  test('uploadFile throws for non-existent file', async () => {
    service.index = { attachments: {}, agentRefs: {} };
    mockFileProcessor.fileExists.mockResolvedValueOnce(false);

    await expect(service.uploadFile({
      agentId: 'agent-1',
      filePath: '/missing.txt'
    })).rejects.toThrow('File not found');
  });

  test('uploadFile throws on validation failure', async () => {
    service.index = { attachments: {}, agentRefs: {} };
    mockFileProcessor.fileExists.mockResolvedValueOnce(true);
    mockFileProcessor.getFileStats.mockResolvedValue({ size: 999999999, modified: new Date() });
    mockValidator.validate.mockReturnValue({ valid: false, errors: ['Too large'], warnings: [] });

    await expect(service.uploadFile({
      agentId: 'agent-1',
      filePath: '/big.txt'
    })).rejects.toThrow('Validation failed');
  });

  test('uploadFile handles reference mode', async () => {
    service.index = { attachments: {}, agentRefs: {} };
    mockFileProcessor.fileExists.mockResolvedValue(true);
    mockFileProcessor.getFileStats.mockResolvedValue({ size: 512, modified: new Date() });
    mockValidator.validate.mockReturnValue({ valid: true, errors: [], warnings: [], sizeLevel: 'small' });

    const result = await service.uploadFile({
      agentId: 'agent-1',
      filePath: '/path/ref.js',
      mode: 'reference'
    });

    expect(result.mode).toBe('reference');
    expect(result.tokenEstimate).toBe(0);
  });

  test('getAttachments returns filtered attachments', async () => {
    service.index = {
      attachments: { f1: { fileId: 'f1', agentId: 'a1', fileName: 'a.txt', mode: 'content', active: true } },
      agentRefs: { a1: ['f1'] }
    };
    mockFileProcessor.fileExists.mockResolvedValue(true);
    mockFileProcessor.readFile.mockResolvedValue(JSON.stringify({
      fileId: 'f1', agentId: 'a1', active: true, mode: 'content'
    }));

    const results = await service.getAttachments('a1');
    expect(results).toHaveLength(1);
  });

  test('getAttachments loads index if null', async () => {
    service.index = null;
    mockFileProcessor.fileExists.mockResolvedValueOnce(false);
    mockFileProcessor.writeFile.mockResolvedValue(undefined);

    const results = await service.getAttachments('a1');
    expect(results).toEqual([]);
  });

  test('getAttachment returns null for unknown fileId', async () => {
    service.index = { attachments: {}, agentRefs: {} };
    const result = await service.getAttachment('unknown');
    expect(result).toBeNull();
  });

  test('getAttachment returns null when metadata file missing', async () => {
    service.index = { attachments: { f1: { fileId: 'f1', agentId: 'a1' } }, agentRefs: {} };
    mockFileProcessor.fileExists.mockResolvedValueOnce(false);
    const result = await service.getAttachment('f1');
    expect(result).toBeNull();
  });

  test('getAttachmentContent returns null for reference mode', async () => {
    service.index = { attachments: { f1: { fileId: 'f1', agentId: 'a1' } }, agentRefs: {} };
    mockFileProcessor.fileExists.mockResolvedValueOnce(true);
    mockFileProcessor.readFile.mockResolvedValueOnce(JSON.stringify({ mode: 'reference', agentId: 'a1' }));

    const content = await service.getAttachmentContent('f1');
    expect(content).toBeNull();
  });

  test('toggleActive flips active state', async () => {
    service.index = { attachments: { f1: { fileId: 'f1', agentId: 'a1', active: true } }, agentRefs: {} };
    mockFileProcessor.fileExists.mockResolvedValue(true);
    mockFileProcessor.readFile.mockResolvedValueOnce(JSON.stringify({
      fileId: 'f1', agentId: 'a1', active: true
    }));

    const result = await service.toggleActive('f1');
    expect(result.active).toBe(false);
  });

  test('toggleActive throws for missing attachment', async () => {
    service.index = { attachments: {}, agentRefs: {} };
    await expect(service.toggleActive('unknown')).rejects.toThrow('Attachment not found');
  });

  test('deleteAttachment removes when no other references', async () => {
    service.index = {
      attachments: { f1: { fileId: 'f1', agentId: 'a1' } },
      agentRefs: { a1: ['f1'] }
    };
    mockFileProcessor.fileExists.mockResolvedValue(true);
    mockFileProcessor.readFile.mockResolvedValueOnce(JSON.stringify({
      fileId: 'f1', agentId: 'a1', referencedBy: ['a1']
    }));

    const deleted = await service.deleteAttachment('f1', 'a1');
    expect(deleted).toBe(true);
    expect(mockFileProcessor.deleteDirectory).toHaveBeenCalled();
  });

  test('deleteAttachment derefs when still referenced', async () => {
    service.index = {
      attachments: { f1: { fileId: 'f1', agentId: 'a1' } },
      agentRefs: { a1: ['f1'] }
    };
    mockFileProcessor.fileExists.mockResolvedValue(true);
    mockFileProcessor.readFile.mockResolvedValueOnce(JSON.stringify({
      fileId: 'f1', agentId: 'a1', referencedBy: ['a1', 'a2']
    }));

    const deleted = await service.deleteAttachment('f1', 'a1');
    expect(deleted).toBe(false);
  });

  test('getAttachmentPreview returns truncated content', async () => {
    service.index = { attachments: { f1: { fileId: 'f1', agentId: 'a1' } }, agentRefs: {} };
    mockFileProcessor.fileExists.mockResolvedValue(true);
    const metadata = { fileId: 'f1', agentId: 'a1', mode: 'content', contentFileName: 'content.txt' };
    mockFileProcessor.readFile
      .mockResolvedValueOnce(JSON.stringify(metadata)) // getAttachment
      .mockResolvedValueOnce('x'.repeat(2000)); // getAttachmentContent

    const preview = await service.getAttachmentPreview('f1');
    expect(preview.length).toBe(1003); // 1000 + '...'
  });

  test('getAttachmentPreview returns image placeholder', async () => {
    service.index = { attachments: { f1: { fileId: 'f1', agentId: 'a1' } }, agentRefs: {} };
    mockFileProcessor.fileExists.mockResolvedValue(true);
    const metadata = { fileId: 'f1', agentId: 'a1', mode: 'content', contentFileName: 'content.base64' };
    mockFileProcessor.readFile
      .mockResolvedValueOnce(JSON.stringify(metadata))
      .mockResolvedValueOnce('data:image/png;base64,abc');

    const preview = await service.getAttachmentPreview('f1');
    expect(preview).toBe('[Image content - base64 encoded]');
  });
});
