/**
 * File Explorer – rename endpoint tests
 * Tests both the FileExplorerController.renameItem() business logic
 * and the POST /rename route handler validation.
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import FileExplorerController from '../controller.js';
import { createFileExplorerRouter } from '../routes.js';

describe('FileExplorerController.renameItem', () => {
  let tmpDir;
  let controller;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fe-rename-'));
    controller = new FileExplorerController({});
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test('renames a file successfully', async () => {
    const oldFile = path.join(tmpDir, 'old.txt');
    await fs.writeFile(oldFile, 'hello');

    const result = await controller.renameItem(oldFile, 'new.txt');

    expect(result.success).toBe(true);
    expect(result.data.name).toBe('new.txt');
    expect(result.data.oldPath).toBe(path.resolve(oldFile));
    expect(result.data.newPath).toBe(path.join(tmpDir, 'new.txt'));

    // Verify on disk
    await expect(fs.access(oldFile)).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, 'new.txt'))).resolves.toBeUndefined();
  });

  test('renames a directory successfully', async () => {
    const oldDir = path.join(tmpDir, 'old-dir');
    await fs.mkdir(oldDir);
    await fs.writeFile(path.join(oldDir, 'inner.txt'), 'x');

    const result = await controller.renameItem(oldDir, 'new-dir');
    expect(result.success).toBe(true);

    const inner = await fs.readFile(path.join(tmpDir, 'new-dir', 'inner.txt'), 'utf8');
    expect(inner).toBe('x');
  });

  test('rejects invalid characters in new name (slash)', async () => {
    const oldFile = path.join(tmpDir, 'a.txt');
    await fs.writeFile(oldFile, 'x');

    const result = await controller.renameItem(oldFile, 'bad/name.txt');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid file/directory name');
  });

  test('rejects invalid characters (colon, asterisk, etc.)', async () => {
    const oldFile = path.join(tmpDir, 'a.txt');
    await fs.writeFile(oldFile, 'x');

    for (const badChar of [':', '*', '?', '"', '<', '>', '|', '\\']) {
      const result = await controller.renameItem(oldFile, `name${badChar}.txt`);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid file/directory name');
    }
  });

  test('rejects empty new name', async () => {
    const oldFile = path.join(tmpDir, 'a.txt');
    await fs.writeFile(oldFile, 'x');
    const result = await controller.renameItem(oldFile, '');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid file/directory name');
  });

  test('rejects when source does not exist', async () => {
    const result = await controller.renameItem(path.join(tmpDir, 'nonexistent.txt'), 'new.txt');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Source path does not exist');
  });

  test('rejects when target name already exists', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), '1');
    await fs.writeFile(path.join(tmpDir, 'b.txt'), '2');

    const result = await controller.renameItem(path.join(tmpDir, 'a.txt'), 'b.txt');
    expect(result.success).toBe(false);
    expect(result.error).toBe('An item with that name already exists');
  });

  test('respects restrictedPaths configuration', async () => {
    const restricted = new FileExplorerController({ restrictedPaths: [tmpDir] });
    const oldFile = path.join(tmpDir, 'a.txt');
    await fs.writeFile(oldFile, 'x');

    const result = await restricted.renameItem(oldFile, 'new.txt');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Access to this path is restricted');
  });
});

describe('POST /rename route handler', () => {
  function getHandler(router) {
    const layer = router.stack.find(l => l.route && l.route.path === '/rename');
    expect(layer).toBeDefined();
    const handlers = layer.route.stack;
    return handlers[handlers.length - 1].handle;
  }

  function makeRes() {
    const res = {
      _status: 200,
      _body: null,
      status: jest.fn(function (code) { this._status = code; return this; }),
      json: jest.fn(function (body) { this._body = body; return this; })
    };
    return res;
  }

  test('rejects missing oldPath with 400', async () => {
    const router = createFileExplorerRouter();
    const handler = getHandler(router);

    const res = makeRes();
    await handler({ body: { newName: 'new.txt' } }, res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      success: false,
      error: 'oldPath and newName are required'
    });
  });

  test('rejects missing newName with 400', async () => {
    const router = createFileExplorerRouter();
    const handler = getHandler(router);

    const res = makeRes();
    await handler({ body: { oldPath: '/tmp/a.txt' } }, res);
    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
  });

  test('returns 400 when controller reports failure', async () => {
    const router = createFileExplorerRouter();
    const handler = getHandler(router);

    const res = makeRes();
    // nonexistent path → controller returns success: false
    await handler({ body: { oldPath: '/this/does/not/exist/zzz.txt', newName: 'new.txt' } }, res);
    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
  });

  test('returns 200 with success on valid rename', async () => {
    const router = createFileExplorerRouter();
    const handler = getHandler(router);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fe-rename-route-'));
    try {
      const oldFile = path.join(tmpDir, 'a.txt');
      await fs.writeFile(oldFile, 'x');

      const res = makeRes();
      await handler({ body: { oldPath: oldFile, newName: 'b.txt' } }, res);

      expect(res._status).toBe(200);
      expect(res._body.success).toBe(true);
      expect(res._body.data.name).toBe('b.txt');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
