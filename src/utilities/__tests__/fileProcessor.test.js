import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

const fsMock = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn(),
  access: jest.fn(),
  copyFile: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue(['a.js', 'b.txt']),
  rm: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined)
};

jest.unstable_mockModule('fs/promises', () => ({ default: fsMock, ...fsMock }));

const { default: FileProcessor } = await import('../fileProcessor.js');

describe('FileProcessor', () => {
  let fp;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
    fp = new FileProcessor({}, logger);
  });

  test('readFile calls fs.readFile and returns content', async () => {
    fsMock.readFile.mockResolvedValue('hello world');
    const result = await fp.readFile('/tmp/test.txt');
    expect(fsMock.readFile).toHaveBeenCalledWith('/tmp/test.txt', 'utf8');
    expect(result).toBe('hello world');
  });

  test('readFile propagates errors', async () => {
    fsMock.readFile.mockRejectedValue(new Error('ENOENT'));
    await expect(fp.readFile('/missing.txt')).rejects.toThrow('Failed to read file');
  });

  test('imageToBase64 returns data URI string starting with data:image/', async () => {
    const buf = Buffer.from('fakepng');
    fsMock.readFile.mockResolvedValue(buf);
    const result = await fp.imageToBase64('/tmp/photo.png');
    expect(result).toMatch(/^data:image\//);
    expect(result).toContain(';base64,');
  });

  test('imageToBase64 maps .png to image/png and .jpg to image/jpeg', async () => {
    const buf = Buffer.from('img');
    fsMock.readFile.mockResolvedValue(buf);

    const png = await fp.imageToBase64('/tmp/a.png');
    expect(png).toMatch(/^data:image\/png;base64,/);

    const jpg = await fp.imageToBase64('/tmp/b.jpg');
    expect(jpg).toMatch(/^data:image\/jpeg;base64,/);
  });

  test('estimateTokens returns ~length/4 for regular text', () => {
    const text = 'a'.repeat(100);
    const tokens = fp.estimateTokens(text);
    expect(tokens).toBe(Math.ceil(100 / 4));
  });

  test('estimateTokens returns ~length/1.5 for base64 images', () => {
    const base64Part = 'A'.repeat(300);
    const dataUri = `data:image/png;base64,${base64Part}`;
    const tokens = fp.estimateTokens(dataUri);
    expect(tokens).toBe(Math.ceil(300 / 1.5));
  });

  test('estimateTokens returns 0 for empty/null input', () => {
    expect(fp.estimateTokens(null)).toBe(0);
    expect(fp.estimateTokens('')).toBe(0);
    expect(fp.estimateTokens(undefined)).toBe(0);
  });

  test('fileExists returns true when access succeeds', async () => {
    fsMock.access.mockResolvedValue(undefined);
    const result = await fp.fileExists('/tmp/exists.txt');
    expect(result).toBe(true);
  });

  test('fileExists returns false when access throws', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    const result = await fp.fileExists('/tmp/nope.txt');
    expect(result).toBe(false);
  });

  test('writeFile creates parent directory before writing', async () => {
    await fp.writeFile('/tmp/sub/dir/file.txt', 'content');

    // mkdir should be called before writeFile
    expect(fsMock.mkdir).toHaveBeenCalled();
    expect(fsMock.writeFile).toHaveBeenCalled();

    const mkdirCall = fsMock.mkdir.mock.invocationCallOrder[0];
    const writeCall = fsMock.writeFile.mock.invocationCallOrder[0];
    expect(mkdirCall).toBeLessThan(writeCall);
  });
});
