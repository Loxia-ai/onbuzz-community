import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock fs/promises
const fsMock = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 1000 }),
  access: jest.fn().mockResolvedValue(undefined)
};
jest.unstable_mockModule('fs', () => ({
  promises: fsMock,
  default: { promises: fsMock }
}));

const { default: FileContentReplaceTool } = await import('../fileContentReplaceTool.js');

describe('FileContentReplaceTool', () => {
  let tool;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    tool = new FileContentReplaceTool({}, logger);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should set correct id and metadata', () => {
      expect(tool.id).toBe('file-content-replace');
      expect(tool.requiresProject).toBe(true);
      expect(tool.isAsync).toBe(true);
    });
  });

  describe('getDescription', () => {
    test('should return description with usage info', () => {
      const desc = tool.getDescription();
      expect(desc).toContain('File Content Replace');
      expect(desc).toContain('oldContent');
      expect(desc).toContain('newContent');
    });
  });

  describe('getRequiredParameters', () => {
    test('should require files', () => {
      expect(tool.getRequiredParameters()).toContain('files');
    });
  });

  describe('parseParameters', () => {
    test('should parse JSON format', () => {
      const json = JSON.stringify({
        files: [{
          path: 'test.js',
          replacements: [{ oldContent: 'old', newContent: 'new' }]
        }]
      });
      const result = tool.parseParameters(json);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].replacements[0].mode).toBe('trim');
    });

    test('should parse XML format', () => {
      const xml = `<file path="test.js"><replace><old-content>old</old-content><new-content>new</new-content></replace></file>`;
      const result = tool.parseParameters(xml);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe('test.js');
    });

    test('should throw on invalid JSON', () => {
      expect(() => tool.parseParameters('{invalid}')).toThrow();
    });
  });

  describe('parseJSON', () => {
    test('should set default mode to trim', () => {
      const result = tool.parseJSON(JSON.stringify({
        files: [{ path: 'a.js', replacements: [{ oldContent: 'x', newContent: 'y' }] }]
      }));
      expect(result.files[0].replacements[0].mode).toBe('trim');
    });

    test('should throw when files is not an array', () => {
      expect(() => tool.parseJSON('{"files": "not-array"}')).toThrow('files');
    });
  });

  describe('applyTrimMode', () => {
    test('should trim whitespace in trim mode', () => {
      expect(tool.applyTrimMode('  hello  ', 'trim')).toBe('hello');
    });

    test('should only trim newlines in newlines mode', () => {
      expect(tool.applyTrimMode('\n  hello  \n', 'newlines')).toBe('  hello  ');
    });

    test('should not modify in none mode', () => {
      expect(tool.applyTrimMode('  hello  ', 'none')).toBe('  hello  ');
    });
  });

  describe('countOccurrences', () => {
    test('should count multiple occurrences', () => {
      expect(tool.countOccurrences('abcabcabc', 'abc')).toBe(3);
    });

    test('should return 0 for no matches', () => {
      expect(tool.countOccurrences('hello', 'xyz')).toBe(0);
    });

    test('should return 0 for empty substring', () => {
      expect(tool.countOccurrences('hello', '')).toBe(0);
    });
  });

  describe('parseLineRanges', () => {
    test('should parse single line number', () => {
      const result = tool.parseLineRanges('5');
      expect(result.has(5)).toBe(true);
      expect(result.size).toBe(1);
    });

    test('should parse comma-separated numbers', () => {
      const result = tool.parseLineRanges('1,3,5');
      expect(result.has(1)).toBe(true);
      expect(result.has(3)).toBe(true);
      expect(result.has(5)).toBe(true);
    });

    test('should parse ranges', () => {
      const result = tool.parseLineRanges('5-8');
      expect(result.has(5)).toBe(true);
      expect(result.has(6)).toBe(true);
      expect(result.has(7)).toBe(true);
      expect(result.has(8)).toBe(true);
    });

    test('should parse mixed format', () => {
      const result = tool.parseLineRanges('1,3-5,10');
      expect(result.size).toBe(5);
    });

    test('should handle empty string', () => {
      const result = tool.parseLineRanges('');
      expect(result.size).toBe(0);
    });

    test('should handle null', () => {
      const result = tool.parseLineRanges(null);
      expect(result.size).toBe(0);
    });
  });

  describe('applyReplacement', () => {
    test('should replace all occurrences without line limit', async () => {
      const result = await tool.applyReplacement('hello world hello', 'hello', 'hi', null, 'none');
      expect(result.newContent).toBe('hi world hi');
      expect(result.count).toBe(2);
    });

    test('should return 0 count when content not found', async () => {
      const result = await tool.applyReplacement('hello world', 'xyz', 'abc', null, 'none');
      expect(result.count).toBe(0);
      expect(result.newContent).toBe('hello world');
    });

    test('should respect line limits', async () => {
      const content = 'line1 old\nline2 old\nline3 old';
      const result = await tool.applyReplacement(content, 'old', 'new', '2', 'none');
      expect(result.count).toBe(1);
      expect(result.newContent).toBe('line1 old\nline2 new\nline3 old');
    });
  });

  describe('generateDiff', () => {
    test('should return "No differences" for identical content', () => {
      const result = tool.generateDiff('hello', 'hello');
      expect(result).toBe('No differences');
    });

    test('should show changed lines', () => {
      const original = 'line1\nold line\nline3';
      const modified = 'line1\nnew line\nline3';
      const result = tool.generateDiff(original, modified);
      expect(result).toContain('- old line');
      expect(result).toContain('+ new line');
    });
  });

  describe('generateSummary', () => {
    test('should format stats correctly', () => {
      const summary = tool.generateSummary({
        filesProcessed: 3,
        filesModified: 2,
        totalReplacements: 5,
        backupsCreated: 2,
        errors: 0
      });
      expect(summary).toContain('3 file(s)');
      expect(summary).toContain('5');
    });
  });

  describe('customValidateParameters', () => {
    test('should reject non-array files', () => {
      expect(() => tool.customValidateParameters({ files: 'not-array' })).toThrow();
    });

    test('should reject empty files array', () => {
      expect(() => tool.customValidateParameters({ files: [] })).toThrow();
    });

    test('should reject file without path', () => {
      expect(() => tool.customValidateParameters({
        files: [{ replacements: [{ oldContent: 'a', newContent: 'b' }] }]
      })).toThrow();
    });

    test('should reject path traversal', () => {
      expect(() => tool.customValidateParameters({
        files: [{ path: '../secret/file.js', replacements: [{ oldContent: 'a', newContent: 'b' }] }]
      })).toThrow('traversal');
    });

    test('should reject invalid mode', () => {
      expect(() => tool.customValidateParameters({
        files: [{ path: 'a.js', replacements: [{ oldContent: 'a', newContent: 'b', mode: 'invalid' }] }]
      })).toThrow('Invalid mode');
    });

    test('should accept valid params', () => {
      const result = tool.customValidateParameters({
        files: [{ path: 'a.js', replacements: [{ oldContent: 'a', newContent: 'b' }] }]
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('isPathAccessible', () => {
    test('should allow paths within working directory', () => {
      const result = tool.isPathAccessible('/project/src/app.js', '/project', {});
      expect(result).toBe(true);
    });

    test('should reject paths outside working directory', () => {
      const result = tool.isPathAccessible('/other/secret.js', '/project', {});
      expect(result).toBe(false);
    });

    test('should allow paths in writeEnabledDirectories', () => {
      const result = tool.isPathAccessible('/shared/file.js', '/project', {
        writeEnabledDirectories: ['/shared']
      });
      expect(result).toBe(true);
    });
  });

  describe('execute', () => {
    test('should process files and return results', async () => {
      fsMock.access.mockResolvedValue(undefined);
      fsMock.stat.mockResolvedValue({ size: 100 });
      fsMock.readFile.mockResolvedValue('const x = "old";');
      fsMock.writeFile.mockResolvedValue(undefined);

      const result = await tool.execute({
        files: [{
          path: 'test.js',
          replacements: [{ oldContent: 'old', newContent: 'new', mode: 'none' }]
        }]
      }, { projectDir: '/project' });

      expect(result.success).toBe(true);
      expect(result.statistics.totalReplacements).toBe(1);
    });

    test('should handle string params by parsing', async () => {
      fsMock.access.mockResolvedValue(undefined);
      fsMock.stat.mockResolvedValue({ size: 100 });
      fsMock.readFile.mockResolvedValue('hello old world');
      fsMock.writeFile.mockResolvedValue(undefined);

      const result = await tool.execute(
        JSON.stringify({ files: [{ path: 'a.js', replacements: [{ oldContent: 'old', newContent: 'new' }] }] }),
        { projectDir: '/project' }
      );
      expect(result.success).toBe(true);
    });

    test('should handle file not found error', async () => {
      fsMock.access.mockRejectedValue(new Error('ENOENT'));

      const result = await tool.execute({
        files: [{
          path: 'missing.js',
          replacements: [{ oldContent: 'a', newContent: 'b', mode: 'none' }]
        }]
      }, { projectDir: '/project' });

      expect(result.statistics.errors).toBe(1);
    });
  });

  describe('cleanup', () => {
    test('should complete without error', async () => {
      await expect(tool.cleanup('op-1')).resolves.not.toThrow();
    });
  });
});
