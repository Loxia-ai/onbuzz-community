import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// ── Mock fs/promises BEFORE importing FileSystemTool ──────────────
const fsMock = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn(),
  access: jest.fn(),
  copyFile: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined)
};

jest.unstable_mockModule('fs/promises', () => ({ default: fsMock, ...fsMock }));

// ── Mock TagParser ────────────────────────────────────────────────
jest.unstable_mockModule('../../utilities/tagParser.js', () => ({
  default: class MockTagParser {
    static extractTagsWithAttributes() { return []; }
    parseAttributes(str) {
      const attrs = {};
      const matches = str.matchAll(/([\w-]+)=["']([^"']+)["']/g);
      for (const m of matches) attrs[m[1]] = m[2];
      return attrs;
    }
  }
}));

// ── Mock DirectoryAccessManager ───────────────────────────────────
jest.unstable_mockModule('../../utilities/directoryAccessManager.js', () => ({
  default: class MockDAM {
    constructor() {}
    createDirectoryAccess(cfg) { return cfg; }
    getWorkingDirectory(cfg) { return cfg?.workingDirectory || '/tmp/test'; }
    validateReadAccess() { return { allowed: true }; }
    validateWriteAccess() { return { allowed: true }; }
    createRelativePath(p) { return p.replace(/^\/tmp\/test\/?/, '') || p; }
  }
}));

// ── Mock structuredFileValidator ──────────────────────────────────
jest.unstable_mockModule('../../utilities/structuredFileValidator.js', () => ({
  validateForToolResponse: jest.fn().mockReturnValue(null)
}));

// ── Mock jsonRepair ───────────────────────────────────────────────
jest.unstable_mockModule('../../utilities/jsonRepair.js', () => ({
  createTruncationNotice: jest.fn().mockReturnValue(null),
  getFileExtension: jest.fn((p) => {
    const m = p.match(/\.([^.]+)$/);
    return m ? m[1] : '';
  })
}));

// ── Mock constants ────────────────────────────────────────────────
jest.unstable_mockModule('../../utilities/constants.js', () => ({
  TOOL_STATUS: { SUCCESS: 'success', ERROR: 'error' },
  FILE_EXTENSIONS: {},
  SYSTEM_DEFAULTS: { MAX_FILE_SIZE: 10 * 1024 * 1024, MAX_TOOL_EXECUTION_TIME: 30000 }
}));

// ── Mock BaseTool ─────────────────────────────────────────────────
jest.unstable_mockModule('../baseTool.js', () => ({
  BaseTool: class {
    constructor() {
      this.id = 'filesystem';
      this.config = {};
      this.logger = null;
      this.requiresProject = false;
      this.isAsync = false;
      this.timeout = 30000;
      this.maxConcurrentOperations = 1;
      this.builtinDelay = 0;
      this.activeOperations = new Map();
      this.operationHistory = [];
      this.isEnabled = true;
      this.lastUsed = null;
      this.usageCount = 0;
    }
    // Mirror real BaseTool#getEffectiveConfig so the per-agent config gate
    // in fileSystemTool.execute() works under test. Real helper lives in
    // src/tools/baseTool.js — change in lockstep if you touch it.
    getEffectiveConfig(context, fallbacks = {}) {
      const perAgent = (context && context.toolConfig && typeof context.toolConfig === 'object' && !Array.isArray(context.toolConfig))
        ? context.toolConfig
        : {};
      return { ...fallbacks, ...(this.config || {}), ...perAgent };
    }
  }
}));

const { default: FileSystemTool } = await import('../fileSystemTool.js');

// ── Helpers ───────────────────────────────────────────────────────
function createTestSetup() {
  const logger = createMockLogger();
  const tool = new FileSystemTool({}, logger);
  tool.logger = logger;

  const context = {
    projectDir: '/tmp/test',
    agentId: 'test-agent',
    directoryAccess: {
      workingDirectory: '/tmp/test',
      writeEnabledDirectories: ['/tmp/test'],
      restrictToProject: true
    }
  };

  return { tool, context, logger };
}

function mockStatResult(overrides = {}) {
  return {
    size: 100,
    mtime: new Date('2024-01-01'),
    atime: new Date('2024-01-01'),
    birthtime: new Date('2024-01-01'),
    mode: 0o644,
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default happy-path mocks
  fsMock.stat.mockResolvedValue(mockStatResult());
  fsMock.readFile.mockResolvedValue('file content');
  fsMock.access.mockResolvedValue(undefined);
  fsMock.readdir.mockResolvedValue([]);
});

describe('FileSystemTool', () => {
  // ── constructor ─────────────────────────────────────────────────
  describe('constructor', () => {
    test('initializes with default settings', () => {
      const tool = new FileSystemTool({});
      expect(tool.requiresProject).toBe(true);
      expect(tool.blockedExtensions).toContain('.exe');
      expect(tool.operationHistory).toEqual([]);
    });
  });

  // ── getDescription ──────────────────────────────────────────────
  describe('getDescription', () => {
    test('returns description mentioning supported actions', () => {
      const { tool } = createTestSetup();
      const desc = tool.getDescription();
      expect(desc).toContain('read');
      expect(desc).toContain('write');
      expect(desc).toContain('delete');
    });
  });

  // ── customValidateParameters ────────────────────────────────────
  describe('customValidateParameters', () => {
    test('valid for correct read action', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'read', filePath: 'src/index.js' }]
      });
      expect(result.valid).toBe(true);
    });

    test('invalid when actions array is empty', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({ actions: [] });
      expect(result.valid).toBe(false);
    });

    test('invalid when filePath missing for read', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'read' }]
      });
      expect(result.valid).toBe(false);
    });

    test('invalid when outputPath missing for write', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'write', content: 'hello' }]
      });
      expect(result.valid).toBe(false);
    });

    test('invalid when content undefined for write', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'write', outputPath: 'file.js' }]
      });
      expect(result.valid).toBe(false);
    });

    test('invalid when content null for write', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'write', outputPath: 'file.js', content: null }]
      });
      expect(result.valid).toBe(false);
    });

    test('valid for write with empty string content', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'write', outputPath: 'file.js', content: '' }]
      });
      expect(result.valid).toBe(true);
    });

    test('invalid for copy without sourcePath', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'copy', destPath: 'b.js' }]
      });
      expect(result.valid).toBe(false);
    });

    test('invalid for copy without destPath', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'copy', sourcePath: 'a.js' }]
      });
      expect(result.valid).toBe(false);
    });

    test('invalid for create-dir without directory', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'create-dir' }]
      });
      expect(result.valid).toBe(false);
    });

    test('invalid for unknown action type', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'teleport' }]
      });
      expect(result.valid).toBe(false);
    });

    test('rejects blocked file extension', () => {
      const { tool } = createTestSetup();
      const result = tool.customValidateParameters({
        actions: [{ type: 'read', filePath: 'virus.exe' }]
      });
      expect(result.valid).toBe(false);
    });
  });

  // ── execute - parameter validation ──────────────────────────────
  describe('execute - parameter validation', () => {
    test('throws when params is not an object', async () => {
      const { tool, context } = createTestSetup();
      await expect(tool.execute(null, context)).rejects.toThrow('params must be an object');
    });

    test('throws when actions is missing', async () => {
      const { tool, context } = createTestSetup();
      await expect(tool.execute({}, context)).rejects.toThrow('actions is required');
    });

    test('throws when actions is not an array', async () => {
      const { tool, context } = createTestSetup();
      await expect(tool.execute({ actions: 'not-array' }, context)).rejects.toThrow('actions must be an array');
    });

    test('throws when actions is empty', async () => {
      const { tool, context } = createTestSetup();
      await expect(tool.execute({ actions: [] }, context)).rejects.toThrow('actions array is empty');
    });
  });

  // ── execute - read ──────────────────────────────────────────────
  describe('execute - read', () => {
    test('reads file content successfully', async () => {
      const { tool, context } = createTestSetup();
      fsMock.stat.mockResolvedValueOnce(mockStatResult({ size: 42 }));
      fsMock.readFile.mockResolvedValueOnce('hello world');

      const result = await tool.execute({
        actions: [{ type: 'read', filePath: 'src/index.js' }]
      }, context);

      expect(result.success).toBe(true);
      expect(result.actions[0].success).toBe(true);
      expect(result.actions[0].content).toBe('hello world');
      expect(result.actions[0].action).toBe('read');
    });

    test('handles file not found error', async () => {
      const { tool, context } = createTestSetup();
      fsMock.stat.mockRejectedValueOnce(new Error('ENOENT: no such file'));

      const result = await tool.execute({
        actions: [{ type: 'read', filePath: 'nonexistent.js' }]
      }, context);

      expect(result.success).toBe(false);
      expect(result.actions[0].success).toBe(false);
      expect(result.actions[0].error).toContain('Failed to read');
    });

    test('rejects file too large', async () => {
      const { tool, context } = createTestSetup();
      tool.maxFileSize = 100;
      fsMock.stat.mockResolvedValueOnce(mockStatResult({ size: 999 }));

      const result = await tool.execute({
        actions: [{ type: 'read', filePath: 'large.js' }]
      }, context);

      expect(result.actions[0].success).toBe(false);
      expect(result.actions[0].error).toContain('too large');
    });
  });

  // ── execute - write ─────────────────────────────────────────────
  describe('execute - write', () => {
    test('writes file content successfully', async () => {
      const { tool, context } = createTestSetup();
      const content = 'console.log("hi");';
      // access throws (file does not exist yet)
      fsMock.access.mockRejectedValueOnce(new Error('ENOENT'));
      fsMock.stat.mockResolvedValue(mockStatResult({ size: Buffer.byteLength(content) }));
      fsMock.readFile.mockResolvedValue(content);

      const result = await tool.execute({
        actions: [{ type: 'write', outputPath: 'new.js', content }]
      }, context);

      expect(result.success).toBe(true);
      expect(result.actions[0].success).toBe(true);
      expect(result.actions[0].action).toBe('write');
      expect(result.actions[0].verified).toBe(true);
      expect(fsMock.writeFile).toHaveBeenCalled();
    });

    test('creates parent directories', async () => {
      const { tool, context } = createTestSetup();
      const content = 'data';
      fsMock.access.mockRejectedValueOnce(new Error('ENOENT'));
      fsMock.stat.mockResolvedValue(mockStatResult({ size: Buffer.byteLength(content) }));
      fsMock.readFile.mockResolvedValue(content);

      await tool.execute({
        actions: [{ type: 'write', outputPath: 'deep/path/file.js', content }]
      }, context);

      expect(fsMock.mkdir).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
    });

    test('creates backup when file exists', async () => {
      const { tool, context } = createTestSetup();
      const content = 'updated';
      // access succeeds (file exists)
      fsMock.access.mockResolvedValueOnce(undefined);
      fsMock.stat.mockResolvedValue(mockStatResult({ size: Buffer.byteLength(content) }));
      fsMock.readFile.mockResolvedValue(content);

      const result = await tool.execute({
        actions: [{ type: 'write', outputPath: 'existing.js', content }]
      }, context);

      expect(fsMock.copyFile).toHaveBeenCalled();
      expect(result.actions[0].backupPath).not.toBeNull();
    });

    test('rejects content too large', async () => {
      const { tool, context } = createTestSetup();
      tool.maxFileSize = 10;
      const content = 'A'.repeat(100);

      const result = await tool.execute({
        actions: [{ type: 'write', outputPath: 'big.js', content }]
      }, context);

      expect(result.actions[0].success).toBe(false);
      expect(result.actions[0].error).toContain('too large');
    });
  });

  // ── execute - append ────────────────────────────────────────────
  describe('execute - append', () => {
    test('appends to existing file', async () => {
      const { tool, context } = createTestSetup();
      const appendContent = '\nnew line';
      const fullContent = 'old content\nnew line';
      fsMock.stat
        .mockResolvedValueOnce(mockStatResult({ size: 11 })) // before append
        .mockResolvedValueOnce(mockStatResult({ size: 11 + Buffer.byteLength(appendContent) })); // after
      fsMock.readFile.mockResolvedValueOnce(fullContent);

      const result = await tool.execute({
        actions: [{ type: 'append', filePath: 'log.txt', content: appendContent }]
      }, context);

      expect(result.actions[0].success).toBe(true);
      expect(result.actions[0].action).toBe('append');
      expect(fsMock.appendFile).toHaveBeenCalled();
    });

    test('creates file if it does not exist', async () => {
      const { tool, context } = createTestSetup();
      const content = 'first line';
      fsMock.stat
        .mockRejectedValueOnce(new Error('ENOENT')) // file doesn't exist
        .mockResolvedValueOnce(mockStatResult({ size: Buffer.byteLength(content) })); // after write
      fsMock.readFile.mockResolvedValueOnce(content);

      const result = await tool.execute({
        actions: [{ type: 'append', filePath: 'new.log', content }]
      }, context);

      expect(result.actions[0].success).toBe(true);
    });
  });

  // ── execute - delete ────────────────────────────────────────────
  describe('execute - delete', () => {
    test('deletes file with backup', async () => {
      const { tool, context } = createTestSetup();
      fsMock.stat.mockResolvedValueOnce(mockStatResult({ size: 50 }));

      const result = await tool.execute({
        actions: [{ type: 'delete', filePath: 'old.js' }]
      }, context);

      expect(result.actions[0].success).toBe(true);
      expect(result.actions[0].action).toBe('delete');
      expect(fsMock.unlink).toHaveBeenCalled();
      expect(fsMock.copyFile).toHaveBeenCalled(); // backup
    });

    test('handles missing file error', async () => {
      const { tool, context } = createTestSetup();
      fsMock.stat.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await tool.execute({
        actions: [{ type: 'delete', filePath: 'gone.js' }]
      }, context);

      expect(result.actions[0].success).toBe(false);
      expect(result.actions[0].error).toContain('Failed to delete');
    });
  });

  // ── execute - copy ──────────────────────────────────────────────
  describe('execute - copy', () => {
    test('copies file to destination', async () => {
      const { tool, context } = createTestSetup();
      fsMock.stat.mockResolvedValueOnce(mockStatResult({ size: 200 }));

      const result = await tool.execute({
        actions: [{ type: 'copy', sourcePath: 'a.js', destPath: 'b.js' }]
      }, context);

      expect(result.actions[0].success).toBe(true);
      expect(result.actions[0].action).toBe('copy');
      expect(fsMock.copyFile).toHaveBeenCalled();
      expect(fsMock.mkdir).toHaveBeenCalled(); // dest dir
    });

    test('rejects source file too large', async () => {
      const { tool, context } = createTestSetup();
      tool.maxFileSize = 10;
      fsMock.stat.mockResolvedValueOnce(mockStatResult({ size: 999 }));

      const result = await tool.execute({
        actions: [{ type: 'copy', sourcePath: 'big.js', destPath: 'copy.js' }]
      }, context);

      expect(result.actions[0].success).toBe(false);
      expect(result.actions[0].error).toContain('too large');
    });
  });

  // ── execute - move ──────────────────────────────────────────────
  describe('execute - move', () => {
    test('moves file successfully', async () => {
      const { tool, context } = createTestSetup();
      fsMock.stat.mockResolvedValueOnce(mockStatResult({ size: 150 }));

      const result = await tool.execute({
        actions: [{ type: 'move', sourcePath: 'old.js', destPath: 'new.js' }]
      }, context);

      expect(result.actions[0].success).toBe(true);
      expect(result.actions[0].action).toBe('move');
      expect(fsMock.rename).toHaveBeenCalled();
    });
  });

  // ── execute - create-dir ────────────────────────────────────────
  describe('execute - create-dir', () => {
    test('creates directory recursively', async () => {
      const { tool, context } = createTestSetup();

      const result = await tool.execute({
        actions: [{ type: 'create-dir', directory: 'src/components/ui' }]
      }, context);

      expect(result.actions[0].success).toBe(true);
      expect(result.actions[0].action).toBe('create-dir');
      expect(fsMock.mkdir).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
    });
  });

  // ── execute - list ──────────────────────────────────────────────
  describe('execute - list', () => {
    test('lists directory contents with file info', async () => {
      const { tool, context } = createTestSetup();
      fsMock.readdir.mockResolvedValueOnce([
        { name: 'file1.js', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
        { name: 'subdir', isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false }
      ]);
      fsMock.stat
        .mockResolvedValueOnce(mockStatResult({ size: 100 }))
        .mockResolvedValueOnce(mockStatResult({ size: 0, isDirectory: () => true }));

      const result = await tool.execute({
        actions: [{ type: 'list', directory: 'src' }]
      }, context);

      expect(result.actions[0].success).toBe(true);
      expect(result.actions[0].totalItems).toBe(2);
      expect(result.actions[0].files).toBe(1);
      expect(result.actions[0].directories).toBe(1);
    });
  });

  // ── execute - exists ────────────────────────────────────────────
  describe('execute - exists', () => {
    test('returns true when file exists', async () => {
      const { tool, context } = createTestSetup();
      fsMock.stat.mockResolvedValueOnce(mockStatResult());

      const result = await tool.execute({
        actions: [{ type: 'exists', filePath: 'file.js' }]
      }, context);

      expect(result.actions[0].success).toBe(true);
      expect(result.actions[0].exists).toBe(true);
      expect(result.actions[0].type).toBe('file');
    });

    test('returns false when file does not exist', async () => {
      const { tool, context } = createTestSetup();
      const err = new Error('not found');
      err.code = 'ENOENT';
      fsMock.stat.mockRejectedValueOnce(err);

      const result = await tool.execute({
        actions: [{ type: 'exists', filePath: 'missing.js' }]
      }, context);

      expect(result.actions[0].success).toBe(true);
      expect(result.actions[0].exists).toBe(false);
    });

    test('detects directory type', async () => {
      const { tool, context } = createTestSetup();
      fsMock.stat.mockResolvedValueOnce(mockStatResult({
        isDirectory: () => true, isFile: () => false
      }));

      const result = await tool.execute({
        actions: [{ type: 'exists', filePath: 'src' }]
      }, context);

      expect(result.actions[0].type).toBe('directory');
    });
  });

  // ── execute - stats ─────────────────────────────────────────────
  describe('execute - stats', () => {
    test('returns file metadata', async () => {
      const { tool, context } = createTestSetup();
      fsMock.stat.mockResolvedValueOnce(mockStatResult({
        size: 1234,
        isDirectory: () => false,
        isSymbolicLink: () => false
      }));

      const result = await tool.execute({
        actions: [{ type: 'stats', filePath: 'package.json' }]
      }, context);

      expect(result.actions[0].success).toBe(true);
      expect(result.actions[0].stats.size).toBe(1234);
      expect(result.actions[0].stats.type).toBe('file');
      expect(result.actions[0].stats.lastModified).toBeDefined();
      expect(result.actions[0].stats.created).toBeDefined();
    });

    test('handles stat error', async () => {
      const { tool, context } = createTestSetup();
      fsMock.stat.mockRejectedValueOnce(new Error('Permission denied'));

      const result = await tool.execute({
        actions: [{ type: 'stats', filePath: 'secret.js' }]
      }, context);

      expect(result.actions[0].success).toBe(false);
      expect(result.actions[0].error).toContain('Failed to get stats');
    });
  });

  // ── execute - unknown action type ───────────────────────────────
  describe('execute - unknown action', () => {
    test('returns error for unknown action type', async () => {
      const { tool, context } = createTestSetup();
      // Bypass validation to test execute switch
      tool.customValidateParameters = jest.fn().mockReturnValue({ valid: true, errors: [] });

      const result = await tool.execute({
        actions: [{ type: 'teleport' }]
      }, context);

      expect(result.actions[0].success).toBe(false);
      expect(result.actions[0].error).toContain('Unknown action type');
    });
  });

  // ── execute - multiple actions ──────────────────────────────────
  describe('execute - multiple actions', () => {
    test('executes multiple actions and reports partial failures', async () => {
      const { tool, context } = createTestSetup();
      // First action succeeds
      fsMock.stat.mockResolvedValueOnce(mockStatResult({ size: 10 }));
      fsMock.readFile.mockResolvedValueOnce('content');
      // Second action fails
      fsMock.stat.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await tool.execute({
        actions: [
          { type: 'read', filePath: 'good.js' },
          { type: 'read', filePath: 'bad.js' }
        ]
      }, context);

      expect(result.success).toBe(false); // not all succeeded
      expect(result.successfulActions).toBe(1);
      expect(result.failedActions).toBe(1);
      expect(result.warning).toContain('1 of 2');
    });
  });

  // ── isAllowedFileExtension ──────────────────────────────────────
  describe('isAllowedFileExtension', () => {
    test('blocks .exe files', () => {
      const { tool } = createTestSetup();
      expect(tool.isAllowedFileExtension('virus.exe')).toBe(false);
    });

    test('allows .bat files (agents need batch scripts)', () => {
      const { tool } = createTestSetup();
      expect(tool.isAllowedFileExtension('script.bat')).toBe(true);
    });

    test('allows .js files', () => {
      const { tool } = createTestSetup();
      expect(tool.isAllowedFileExtension('app.js')).toBe(true);
    });

    test('respects allowedExtensions whitelist', () => {
      const tool = new FileSystemTool({ allowedExtensions: ['.js', '.ts'] });
      expect(tool.isAllowedFileExtension('style.css')).toBe(false);
      expect(tool.isAllowedFileExtension('app.js')).toBe(true);
    });
  });

  // ── addToHistory ────────────────────────────────────────────────
  describe('addToHistory', () => {
    test('records operation in history', () => {
      const { tool } = createTestSetup();
      tool.addToHistory(
        { type: 'read', filePath: 'test.js' },
        { success: true, size: 42 },
        'agent-1'
      );
      expect(tool.operationHistory).toHaveLength(1);
      expect(tool.operationHistory[0].action).toBe('read');
    });

    test('trims history to 200 entries', () => {
      const { tool } = createTestSetup();
      for (let i = 0; i < 210; i++) {
        tool.addToHistory({ type: 'read', filePath: `f${i}.js` }, { success: true }, 'a');
      }
      expect(tool.operationHistory.length).toBe(200);
    });
  });

  // ── getSupportedActions ─────────────────────────────────────────
  describe('getSupportedActions', () => {
    test('returns all supported action names', () => {
      const { tool } = createTestSetup();
      const actions = tool.getSupportedActions();
      expect(actions).toContain('read');
      expect(actions).toContain('write');
      expect(actions).toContain('append');
      expect(actions).toContain('delete');
      expect(actions).toContain('copy');
      expect(actions).toContain('move');
      expect(actions).toContain('create-dir');
      expect(actions).toContain('list');
      expect(actions).toContain('exists');
      expect(actions).toContain('stats');
    });
  });

  // Per-agent overrides via context.toolConfig (agent.toolConfig.filesystem)
  // — merged into effective config by BaseTool#getEffectiveConfig at
  // execute time, then applied as a per-action gate above the existing
  // path-access and size checks.
  describe('per-agent toolConfig overrides', () => {
    test('per-agent blockedExtensions blocks a previously-allowed extension', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute(
        { actions: [{ type: 'read', filePath: '/tmp/test/secret.env' }] },
        { ...context, toolConfig: { blockedExtensions: ['.env'] } }
      );
      expect(result.actions[0].success).toBe(false);
      expect(result.actions[0].error).toMatch(/blocked by agent policy/);
      // No actual read attempted.
      expect(fsMock.readFile).not.toHaveBeenCalled();
    });

    test('per-agent allowedExtensions rejects anything outside the list', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute(
        { actions: [{ type: 'read', filePath: '/tmp/test/app.js' }] },
        { ...context, toolConfig: { allowedExtensions: ['.ts'] } }
      );
      expect(result.actions[0].success).toBe(false);
      expect(result.actions[0].error).toMatch(/not in the agent's allowed list/);
      expect(fsMock.readFile).not.toHaveBeenCalled();
    });

    test('per-agent allowedExtensions accepts matches', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute(
        { actions: [{ type: 'read', filePath: '/tmp/test/app.js' }] },
        { ...context, toolConfig: { allowedExtensions: ['.js'] } }
      );
      expect(result.actions[0].success).toBe(true);
    });

    test('per-agent maxFileSize rejects oversized write payload', async () => {
      const { tool, context } = createTestSetup();
      const bigContent = 'x'.repeat(500);
      const result = await tool.execute(
        {
          actions: [{ type: 'write', outputPath: 'big.txt', content: bigContent }],
        },
        { ...context, toolConfig: { maxFileSize: 100 } }
      );
      expect(result.actions[0].success).toBe(false);
      expect(result.actions[0].error).toMatch(/too large/);
      expect(result.actions[0].error).toMatch(/per-agent maxFileSize/);
      expect(fsMock.writeFile).not.toHaveBeenCalled();
    });

    test('per-agent maxFileSize accepts payloads within limit', async () => {
      const { tool, context } = createTestSetup();
      const content = 'hello';
      // Mirror the mock setup used by the existing write tests so the
      // verify-after-write step finds the file with matching size.
      fsMock.access.mockRejectedValueOnce(new Error('ENOENT'));
      fsMock.stat.mockResolvedValue(mockStatResult({ size: Buffer.byteLength(content) }));
      fsMock.readFile.mockResolvedValue(content);

      const result = await tool.execute(
        { actions: [{ type: 'write', outputPath: 'ok.txt', content }] },
        { ...context, toolConfig: { maxFileSize: 1_000_000 } }
      );
      expect(result.actions[0].success).toBe(true);
      expect(fsMock.writeFile).toHaveBeenCalled();
    });

    test('blocked wins over allowed when both set', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute(
        { actions: [{ type: 'read', filePath: '/tmp/test/app.js' }] },
        { ...context, toolConfig: { allowedExtensions: ['.js'], blockedExtensions: ['.js'] } }
      );
      expect(result.actions[0].success).toBe(false);
      expect(result.actions[0].error).toMatch(/blocked by agent policy/);
    });

    test('no toolConfig → original behaviour preserved', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute(
        { actions: [{ type: 'read', filePath: '/tmp/test/app.js' }] },
        context
      );
      expect(result.actions[0].success).toBe(true);
    });
  });
});
