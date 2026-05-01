import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock fs/promises, crypto, os, and userDataDir before importing
const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
};
const mockCrypto = {
  randomBytes: jest.fn(() => Buffer.alloc(32, 'a')),
  pbkdf2Sync: jest.fn(() => Buffer.alloc(32, 'k')),
  createCipheriv: jest.fn(),
  createDecipheriv: jest.fn(),
};
const mockOs = {
  hostname: jest.fn(() => 'test-host'),
  homedir: jest.fn(() => '/home/test'),
  userInfo: jest.fn(() => ({ username: 'testuser' })),
};

jest.unstable_mockModule('fs', () => ({ promises: mockFs }));
jest.unstable_mockModule('crypto', () => ({ default: mockCrypto, ...mockCrypto }));
jest.unstable_mockModule('os', () => ({ default: mockOs, ...mockOs }));
jest.unstable_mockModule('../../utilities/userDataDir.js', () => ({
  getUserDataPaths: jest.fn(() => ({ settings: '/fake/settings', attachments: '/fake/attachments' })),
  ensureUserDataDirs: jest.fn(async () => {}),
}));

const { default: ApiKeyManager } = await import('../apiKeyManager.js');

describe('ApiKeyManager — OSS schema (vendorKeys + customEndpoints)', () => {
  let manager;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
    manager = new ApiKeyManager(logger);
  });

  test('constructor initializes with empty vendorKeys and customEndpoints', () => {
    expect(manager.keys.vendorKeys).toEqual({});
    expect(manager.keys.customEndpoints).toEqual([]);
    expect(manager.initialized).toBe(false);
    // Legacy field should not exist
    expect(manager.keys.loxiaApiKey).toBeUndefined();
  });

  test('setSessionKeys stores vendor keys', async () => {
    // Bypass persistence in this unit test (no real disk)
    manager.persistenceFile = null;
    await manager.setSessionKeys(null, {
      vendorKeys: { openai: 'sk-openai', anthropic: 'sk-ant' },
    });
    expect(manager.keys.vendorKeys).toEqual({ openai: 'sk-openai', anthropic: 'sk-ant' });
  });

  test('setSessionKeys stores customEndpoints', async () => {
    manager.persistenceFile = null;
    await manager.setSessionKeys(null, {
      customEndpoints: [
        { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'or-…' },
      ],
    });
    expect(manager.keys.customEndpoints).toHaveLength(1);
    expect(manager.keys.customEndpoints[0].id).toBe('openrouter');
  });

  test('setSessionKeys filters customEndpoints with placeholder keys', async () => {
    manager.persistenceFile = null;
    await manager.setSessionKeys(null, {
      customEndpoints: [
        { id: 'good', baseUrl: 'https://x.test', apiKey: 'real-key' },
        { id: 'placeholder', baseUrl: 'https://y.test', apiKey: '••••••••' },
      ],
    });
    expect(manager.keys.customEndpoints).toHaveLength(1);
    expect(manager.keys.customEndpoints[0].id).toBe('good');
  });

  test('setSessionKeys with empty string vendor key clears that vendor', async () => {
    manager.persistenceFile = null;
    manager.keys.vendorKeys = { openai: 'sk-old' };
    await manager.setSessionKeys(null, { vendorKeys: { openai: '' } });
    expect(manager.keys.vendorKeys.openai).toBeUndefined();
  });

  test('getKeysForRequest returns vendorApiKey by vendor name', () => {
    manager.keys.vendorKeys = { openai: 'sk-test', anthropic: 'sk-ant' };
    expect(manager.getKeysForRequest(null, { vendor: 'openai' })).toEqual({ vendorApiKey: 'sk-test' });
    expect(manager.getKeysForRequest(null, { vendor: 'anthropic' })).toEqual({ vendorApiKey: 'sk-ant' });
    expect(manager.getKeysForRequest(null, { vendor: 'unknown' })).toEqual({ vendorApiKey: null });
    expect(manager.getKeysForRequest(null, {})).toEqual({ vendorApiKey: null });
  });

  test('removeSessionKeys clears all keys + endpoints, returns true if anything was removed', async () => {
    manager.persistenceFile = null;
    manager.keys = {
      vendorKeys:      { openai: 'sk-test' },
      customEndpoints: [{ id: 'openrouter', baseUrl: 'x', apiKey: 'or' }],
    };
    const result = await manager.removeSessionKeys(null);
    expect(result).toBe(true);
    expect(manager.keys.vendorKeys).toEqual({});
    expect(manager.keys.customEndpoints).toEqual([]);
  });

  test('removeSessionKeys returns false when nothing was stored', async () => {
    manager.persistenceFile = null;
    const result = await manager.removeSessionKeys(null);
    expect(result).toBe(false);
  });

  test('setKeys / removeKeys aliases work', async () => {
    manager.persistenceFile = null;
    await manager.setKeys(null, { vendorKeys: { gemini: 'aiza-test' } });
    expect(manager.keys.vendorKeys.gemini).toBe('aiza-test');
    await manager.removeKeys(null);
    expect(manager.keys.vendorKeys).toEqual({});
  });

  test('getActiveSessions returns empty array (compat shim)', () => {
    expect(manager.getActiveSessions()).toEqual([]);
  });

  test('cleanupExpiredSessions returns 0 (compat shim)', () => {
    expect(manager.cleanupExpiredSessions()).toBe(0);
  });
});
