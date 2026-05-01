import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock fs
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('fs', () => ({
  promises: {
    readFile: mockReadFile,
    writeFile: mockWriteFile
  }
}));

// Mock crypto with real-enough implementations
const mockRandomBytes = jest.fn().mockReturnValue(Buffer.from('deadbeef', 'hex'));
const mockPbkdf2Sync = jest.fn();
const mockCreateCipheriv = jest.fn();
const mockCreateDecipheriv = jest.fn();
jest.unstable_mockModule('crypto', () => ({
  default: {
    randomBytes: mockRandomBytes,
    pbkdf2Sync: mockPbkdf2Sync,
    createCipheriv: mockCreateCipheriv,
    createDecipheriv: mockCreateDecipheriv
  },
  randomBytes: mockRandomBytes,
  pbkdf2Sync: mockPbkdf2Sync,
  createCipheriv: mockCreateCipheriv,
  createDecipheriv: mockCreateDecipheriv
}));

// Mock os
jest.unstable_mockModule('os', () => ({
  default: {
    hostname: () => 'test-host',
    homedir: () => '/home/test',
    userInfo: () => ({ username: 'testuser' })
  }
}));

// Mock userDataDir
const mockGetUserDataPaths = jest.fn().mockReturnValue({
  agents: '/tmp/test-agents',
  settings: '/tmp/test-settings'
});
const mockEnsureUserDataDirs = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../../utilities/userDataDir.js', () => ({
  getUserDataPaths: mockGetUserDataPaths,
  ensureUserDataDirs: mockEnsureUserDataDirs
}));

// Mock stealthConstants
jest.unstable_mockModule('../../utilities/stealthConstants.js', () => ({
  CREDENTIAL_CONFIG: {
    ENCRYPTION_ALGORITHM: 'aes-256-gcm',
    KEY_DERIVATION_ITERATIONS: 1000, // Low for testing
    SALT_LENGTH: 32,
    IV_LENGTH: 16,
    AUTH_TAG_LENGTH: 16,
    SESSION_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
    REQUEST_TIMEOUT_MS: 5 * 60 * 1000,
    STORAGE: {
      CREDENTIALS_FILE: 'credentials.enc',
      SESSIONS_FILE: 'sessions.enc',
      SETTINGS_DIR: 'settings'
    }
  },
  KNOWN_SITES: {
    linkedin: {
      name: 'LinkedIn',
      loginUrl: 'https://www.linkedin.com/login',
      selectors: { username: '#username', password: '#password' },
      usernameType: 'email',
      multiStep: false
    },
    github: {
      name: 'GitHub',
      loginUrl: 'https://github.com/login',
      selectors: { username: '#login_field', password: '#password' },
      usernameType: 'username',
      multiStep: false
    }
  },
  CREDENTIAL_EVENTS: {
    REQUEST: 'credential_request',
    RESPONSE: 'credential_response',
    CANCEL: 'credential_cancel',
    STATUS: 'credential_status'
  }
}));

const { default: CredentialVault, getCredentialVault } = await import('../../services/credentialVault.js');

describe('CredentialVault', () => {
  let vault;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    vault = new CredentialVault(logger);
    jest.clearAllMocks();
  });

  // ── Constructor ──
  test('constructor initializes with defaults', () => {
    expect(vault.logger).toBe(logger);
    expect(vault.credentials).toBeInstanceOf(Map);
    expect(vault.sessions).toBeInstanceOf(Map);
    expect(vault.pendingRequests).toBeInstanceOf(Map);
    expect(vault.initialized).toBe(false);
    expect(vault.encryptionKey).toBeNull();
  });

  test('constructor works without logger', () => {
    const v = new CredentialVault();
    expect(v.logger).toBeNull();
  });

  // ── _getMachineIdentifier ──
  test('_getMachineIdentifier returns consistent string', () => {
    const id = vault._getMachineIdentifier();
    expect(typeof id).toBe('string');
    expect(id).toContain('loxia-credential-vault-v1');
  });

  // ── _maskUsername ──
  test('_maskUsername masks usernames', () => {
    expect(vault._maskUsername('john@example.com')).toBe('j***om');
    expect(vault._maskUsername('ab')).toBe('***');
    expect(vault._maskUsername(null)).toBe('***');
    expect(vault._maskUsername('')).toBe('***');
  });

  // ── Credential CRUD (without encryption) ──
  test('saveCredentials stores credential entry', async () => {
    // Don't persist - just test in-memory
    vault.credentialsFile = null;
    vault.encryptionKey = null;

    await vault.saveCredentials('LinkedIn', {
      username: 'user@test.com',
      password: 'pass123'
    });

    expect(vault.credentials.has('linkedin')).toBe(true);
    const entry = vault.credentials.get('linkedin');
    expect(entry.username).toBe('user@test.com');
    expect(entry.name).toBe('LinkedIn');
    expect(entry.siteId).toBe('linkedin');
  });

  test('saveCredentials throws for missing fields', async () => {
    await expect(vault.saveCredentials('test', { username: 'u' }))
      .rejects.toThrow('siteId, username, and password are required');
    await expect(vault.saveCredentials('', { username: 'u', password: 'p' }))
      .rejects.toThrow();
  });

  test('saveCredentials uses known site info', async () => {
    vault.credentialsFile = null;
    vault.encryptionKey = null;

    await vault.saveCredentials('github', {
      username: 'octocat',
      password: 'pass'
    });

    const entry = vault.credentials.get('github');
    expect(entry.name).toBe('GitHub');
    expect(entry.loginUrl).toBe('https://github.com/login');
    expect(entry.usernameType).toBe('username');
  });

  test('saveCredentials uses custom values over known site', async () => {
    vault.credentialsFile = null;
    vault.encryptionKey = null;

    await vault.saveCredentials('github', {
      username: 'octocat',
      password: 'pass',
      loginUrl: 'https://custom.github.com/login'
    });

    const entry = vault.credentials.get('github');
    expect(entry.loginUrl).toBe('https://custom.github.com/login');
  });

  test('getCredentials returns credential and updates lastUsed', () => {
    vault.credentialsFile = null;
    vault.encryptionKey = null;
    vault.credentials.set('github', {
      siteId: 'github',
      username: 'user',
      password: 'pass',
      lastUsed: null
    });

    const result = vault.getCredentials('GitHub');
    expect(result.username).toBe('user');
    expect(result.lastUsed).toBeDefined();
  });

  test('getCredentials returns null for unknown site', () => {
    expect(vault.getCredentials('nonexistent')).toBeNull();
  });

  test('hasCredentials checks existence', () => {
    vault.credentials.set('github', { siteId: 'github' });
    expect(vault.hasCredentials('GitHub')).toBe(true);
    expect(vault.hasCredentials('unknown')).toBe(false);
  });

  test('deleteCredentials removes credential', async () => {
    vault.credentialsFile = null;
    vault.encryptionKey = null;
    vault.sessionsFile = null;
    vault.credentials.set('github', { siteId: 'github' });

    const deleted = await vault.deleteCredentials('GitHub');
    expect(deleted).toBe(true);
    expect(vault.credentials.has('github')).toBe(false);
  });

  test('deleteCredentials returns false for non-existent', async () => {
    vault.credentialsFile = null;
    vault.encryptionKey = null;

    const deleted = await vault.deleteCredentials('nonexistent');
    expect(deleted).toBe(false);
  });

  test('listCredentials returns masked summaries', () => {
    vault.credentials.set('github', {
      siteId: 'github',
      name: 'GitHub',
      username: 'octocat@github.com',
      loginUrl: 'https://github.com/login',
      createdAt: Date.now(),
      lastUsed: null
    });

    const list = vault.listCredentials();
    expect(list.length).toBe(1);
    expect(list[0].username).not.toBe('octocat@github.com');
    expect(list[0].siteId).toBe('github');
  });

  // ── Session Management ──
  test('saveSession stores session cookies', async () => {
    vault.sessionsFile = null;
    vault.encryptionKey = null;

    await vault.saveSession('github', [{ name: 'session', value: 'abc123' }]);

    const session = vault.sessions.get('github');
    expect(session.cookies.length).toBe(1);
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  test('getSession returns session if not expired', () => {
    vault.sessions.set('github', {
      siteId: 'github',
      cookies: [{ name: 'session' }],
      savedAt: Date.now(),
      expiresAt: Date.now() + 86400000
    });

    const session = vault.getSession('GitHub');
    expect(session).not.toBeNull();
    expect(session.cookies.length).toBe(1);
  });

  test('getSession returns null for expired session', () => {
    vault.sessions.set('github', {
      siteId: 'github',
      cookies: [],
      savedAt: Date.now() - 86400000,
      expiresAt: Date.now() - 1000 // expired
    });

    const session = vault.getSession('GitHub');
    expect(session).toBeNull();
    expect(vault.sessions.has('github')).toBe(false);
  });

  test('getSession returns null for non-existent', () => {
    expect(vault.getSession('unknown')).toBeNull();
  });

  test('getAllSessions skips expired sessions', () => {
    vault.sessions.set('github', {
      siteId: 'github',
      cookies: [],
      expiresAt: Date.now() + 86400000
    });
    vault.sessions.set('linkedin', {
      siteId: 'linkedin',
      cookies: [],
      expiresAt: Date.now() - 1000 // expired
    });

    const all = vault.getAllSessions();
    expect(Object.keys(all).length).toBe(1);
    expect(all.github).toBeDefined();
  });

  test('deleteSession removes session', async () => {
    vault.sessionsFile = null;
    vault.encryptionKey = null;
    vault.sessions.set('github', { siteId: 'github' });

    const deleted = await vault.deleteSession('GitHub');
    expect(deleted).toBe(true);
    expect(vault.sessions.has('github')).toBe(false);
  });

  test('deleteSession returns false for non-existent', async () => {
    vault.sessionsFile = null;
    vault.encryptionKey = null;

    const deleted = await vault.deleteSession('unknown');
    expect(deleted).toBe(false);
  });

  // ── _cleanupExpiredSessions ──
  test('_cleanupExpiredSessions removes expired sessions', () => {
    vault.sessionsFile = null;
    vault.encryptionKey = null;
    vault.sessions.set('expired', { expiresAt: Date.now() - 1000 });
    vault.sessions.set('active', { expiresAt: Date.now() + 86400000 });

    vault._cleanupExpiredSessions();
    expect(vault.sessions.has('expired')).toBe(false);
    expect(vault.sessions.has('active')).toBe(true);
  });

  test('_cleanupExpiredSessions does nothing when none expired', () => {
    vault.sessions.set('active', { expiresAt: Date.now() + 86400000 });

    vault._cleanupExpiredSessions();
    expect(vault.sessions.has('active')).toBe(true);
  });

  // ── Credential Request Flow ──
  test('createCredentialRequest returns requestInfo and promise', async () => {
    const { requestInfo, promise } = vault.createCredentialRequest('github');
    expect(requestInfo.requestId).toMatch(/^cred_/);
    expect(requestInfo.siteId).toBe('github');
    expect(requestInfo.siteName).toBe('GitHub');
    expect(promise).toBeInstanceOf(Promise);

    // Clean up — catch the rejection from cancel
    vault.cancelCredentialRequest(requestInfo.requestId);
    await expect(promise).rejects.toThrow();
  });

  test('submitCredentials resolves pending request', async () => {
    const { requestInfo, promise } = vault.createCredentialRequest('github');

    vault.credentialsFile = null;
    vault.encryptionKey = null;

    // Submit credentials
    await vault.submitCredentials(requestInfo.requestId, {
      username: 'user',
      password: 'pass'
    }, false);

    const result = await promise;
    expect(result.credentials.username).toBe('user');
    expect(result.siteId).toBe('github');
    expect(result.saved).toBe(false);
  });

  test('submitCredentials throws for unknown request', async () => {
    await expect(vault.submitCredentials('nonexistent', {}))
      .rejects.toThrow('No pending credential request found');
  });

  test('cancelCredentialRequest rejects pending promise', async () => {
    const { requestInfo, promise } = vault.createCredentialRequest('github');

    vault.cancelCredentialRequest(requestInfo.requestId);

    await expect(promise).rejects.toThrow('cancelled by user');
  });

  test('cancelCredentialRequest does nothing for unknown request', () => {
    // Should not throw
    vault.cancelCredentialRequest('nonexistent');
  });

  test('getPendingRequest returns request info', async () => {
    const { requestInfo, promise } = vault.createCredentialRequest('github');

    const pending = vault.getPendingRequest(requestInfo.requestId);
    expect(pending.siteId).toBe('github');

    // Cleanup — catch rejection
    vault.cancelCredentialRequest(requestInfo.requestId);
    await expect(promise).rejects.toThrow();
  });

  test('getPendingRequest returns null for unknown', () => {
    expect(vault.getPendingRequest('nonexistent')).toBeNull();
  });

  // ── Known Sites ──
  test('getKnownSite returns site config for known sites', () => {
    const site = vault.getKnownSite('LinkedIn');
    expect(site).not.toBeNull();
    expect(site.name).toBe('LinkedIn');
  });

  test('getKnownSite returns null for unknown sites', () => {
    expect(vault.getKnownSite('fakebook')).toBeNull();
  });

  test('listKnownSites returns all known sites', () => {
    const sites = vault.listKnownSites();
    expect(sites.length).toBeGreaterThan(0);
    expect(sites[0]).toHaveProperty('siteId');
    expect(sites[0]).toHaveProperty('name');
    expect(sites[0]).toHaveProperty('hasCredentials');
  });

  // ── Static methods ──
  test('getEventTypes returns credential events', () => {
    const events = CredentialVault.getEventTypes();
    expect(events).toHaveProperty('REQUEST');
    expect(events).toHaveProperty('RESPONSE');
  });

  // ── Encryption ──
  test('_encrypt throws when key not initialized', () => {
    vault.encryptionKey = null;
    expect(() => vault._encrypt('test')).toThrow('Encryption key not initialized');
  });

  test('_decrypt throws when key not initialized', () => {
    vault.encryptionKey = null;
    expect(() => vault._decrypt('test')).toThrow('Encryption key not initialized');
  });

  // ── Persistence (edge cases) ──
  test('_persistCredentials does nothing without file/key', async () => {
    vault.credentialsFile = null;
    await vault._persistCredentials();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  test('_persistSessions does nothing without file/key', async () => {
    vault.sessionsFile = null;
    await vault._persistSessions();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  test('_loadCredentials does nothing without file/key', async () => {
    vault.credentialsFile = null;
    await vault._loadCredentials();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  test('_loadSessions does nothing without file/key', async () => {
    vault.sessionsFile = null;
    await vault._loadSessions();
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
