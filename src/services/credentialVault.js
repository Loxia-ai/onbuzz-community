/**
 * Credential Vault Service
 *
 * Purpose:
 * - Securely store website login credentials with AES-256-GCM encryption
 * - Store authentication sessions (cookies) for reuse
 * - Provide credentials to browser tool without exposing to AI agents
 * - Support credential injection for automated login flows
 *
 * Security Model:
 * - Credentials are encrypted at rest using machine-specific key derivation
 * - Credentials are NEVER exposed to AI agents or included in conversation context
 * - Only the browser tool can access credentials for form filling
 * - Sessions include expiry tracking for automatic cleanup
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { getUserDataPaths, ensureUserDataDirs } from '../utilities/userDataDir.js';
import {
  CREDENTIAL_CONFIG,
  KNOWN_SITES,
  CREDENTIAL_EVENTS
} from '../utilities/stealthConstants.js';

// Encryption configuration (from constants)
const ALGORITHM = CREDENTIAL_CONFIG.ENCRYPTION_ALGORITHM;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = CREDENTIAL_CONFIG.IV_LENGTH;
const AUTH_TAG_LENGTH = CREDENTIAL_CONFIG.AUTH_TAG_LENGTH;
const SALT_LENGTH = CREDENTIAL_CONFIG.SALT_LENGTH;
const PBKDF2_ITERATIONS = CREDENTIAL_CONFIG.KEY_DERIVATION_ITERATIONS;

class CredentialVault {
  constructor(logger = null) {
    this.logger = logger;

    // In-memory storage
    this.credentials = new Map(); // siteId -> credential data
    this.sessions = new Map();    // siteId -> session cookies

    // Pending credential requests (for async UI flow)
    this.pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }

    // Persistence configuration
    this.credentialsFile = null;
    this.sessionsFile = null;
    this.encryptionKey = null;
    this.initialized = false;
  }

  /**
   * Initialize persistence - must be called before using vault
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await ensureUserDataDirs();
      const paths = getUserDataPaths();
      const settingsDir = paths.settings;

      this.credentialsFile = path.join(settingsDir, CREDENTIAL_CONFIG.STORAGE.CREDENTIALS_FILE);
      this.sessionsFile = path.join(settingsDir, CREDENTIAL_CONFIG.STORAGE.SESSIONS_FILE);

      // Generate or load machine-specific encryption key
      this.encryptionKey = await this._getOrCreateEncryptionKey(settingsDir);

      // Load persisted data
      await this._loadCredentials();
      await this._loadSessions();

      // Cleanup expired sessions
      this._cleanupExpiredSessions();

      this.initialized = true;
      this.logger?.info('[CredentialVault] Initialized', {
        credentialsCount: this.credentials.size,
        sessionsCount: this.sessions.size
      });
    } catch (error) {
      this.logger?.warn('[CredentialVault] Initialization failed, using memory-only mode', {
        error: error.message
      });
    }
  }

  /**
   * Get or create a machine-specific encryption key
   * @private
   */
  async _getOrCreateEncryptionKey(settingsDir) {
    const saltFile = path.join(settingsDir, '.credential-salt');
    let salt;

    try {
      salt = await fs.readFile(saltFile);
    } catch (error) {
      // Generate new salt
      salt = crypto.randomBytes(SALT_LENGTH);
      await fs.writeFile(saltFile, salt, { mode: 0o600 });
      this.logger?.info('[CredentialVault] Generated new encryption salt');
    }

    // Derive key from salt + machine-specific data
    const machineData = this._getMachineIdentifier();
    const key = crypto.pbkdf2Sync(
      machineData,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      'sha256'
    );

    return key;
  }

  /**
   * Get a machine-specific identifier for key derivation
   * @private
   */
  _getMachineIdentifier() {
    const parts = [
      os.hostname(),
      os.homedir(),
      os.userInfo().username,
      process.platform,
      'loxia-credential-vault-v1'
    ];
    return parts.join(':');
  }

  /**
   * Encrypt data using AES-256-GCM
   * @private
   */
  _encrypt(plaintext) {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Combine IV + authTag + encrypted data
    const combined = Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, 'base64')
    ]);

    return combined.toString('base64');
  }

  /**
   * Decrypt data using AES-256-GCM
   * @private
   */
  _decrypt(encryptedData) {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    const combined = Buffer.from(encryptedData, 'base64');

    // Extract IV, authTag, and encrypted data
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted.toString('base64'), 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  // ============================================================
  // Credential Management
  // ============================================================

  /**
   * Store credentials for a site
   * @param {string} siteId - Site identifier (e.g., 'linkedin', 'github')
   * @param {Object} credentials - Credential data
   * @param {string} credentials.username - Username or email
   * @param {string} credentials.password - Password
   * @param {string} [credentials.loginUrl] - Custom login URL
   * @param {Object} [credentials.selectors] - Custom CSS selectors
   * @returns {Promise<void>}
   */
  async saveCredentials(siteId, credentials) {
    if (!siteId || !credentials.username || !credentials.password) {
      throw new Error('siteId, username, and password are required');
    }

    const normalizedId = siteId.toLowerCase().trim();

    // Get known site info if available
    const knownSite = KNOWN_SITES[normalizedId];

    const credentialEntry = {
      siteId: normalizedId,
      name: knownSite?.name || normalizedId,
      username: credentials.username,
      password: credentials.password,
      loginUrl: credentials.loginUrl || knownSite?.loginUrl || null,
      selectors: credentials.selectors || knownSite?.selectors || null,
      usernameType: credentials.usernameType || knownSite?.usernameType || 'email',
      multiStep: credentials.multiStep || knownSite?.multiStep || false,
      createdAt: Date.now(),
      lastUsed: null
    };

    this.credentials.set(normalizedId, credentialEntry);

    await this._persistCredentials();

    this.logger?.info('[CredentialVault] Credentials saved', {
      siteId: normalizedId,
      username: this._maskUsername(credentials.username)
    });
  }

  /**
   * Get credentials for a site (internal use only - never expose to agent)
   * @param {string} siteId - Site identifier
   * @returns {Object|null} Credential data or null
   */
  getCredentials(siteId) {
    const normalizedId = siteId.toLowerCase().trim();
    const entry = this.credentials.get(normalizedId);

    if (entry) {
      // Update last used timestamp
      entry.lastUsed = Date.now();
      this._persistCredentials().catch(() => {}); // Fire and forget
    }

    return entry || null;
  }

  /**
   * Check if credentials exist for a site
   * @param {string} siteId - Site identifier
   * @returns {boolean}
   */
  hasCredentials(siteId) {
    const normalizedId = siteId.toLowerCase().trim();
    return this.credentials.has(normalizedId);
  }

  /**
   * Delete credentials for a site
   * @param {string} siteId - Site identifier
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteCredentials(siteId) {
    const normalizedId = siteId.toLowerCase().trim();
    const deleted = this.credentials.delete(normalizedId);

    if (deleted) {
      await this._persistCredentials();
      // Also delete associated session
      await this.deleteSession(normalizedId);
      this.logger?.info('[CredentialVault] Credentials deleted', { siteId: normalizedId });
    }

    return deleted;
  }

  /**
   * List all stored credentials (safe version without passwords)
   * @returns {Array} Array of credential summaries
   */
  listCredentials() {
    const list = [];
    for (const [siteId, entry] of this.credentials) {
      list.push({
        siteId,
        name: entry.name,
        username: this._maskUsername(entry.username),
        loginUrl: entry.loginUrl,
        createdAt: entry.createdAt,
        lastUsed: entry.lastUsed,
        hasSession: this.sessions.has(siteId)
      });
    }
    return list.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  }

  // ============================================================
  // Session Management
  // ============================================================

  /**
   * Save authentication session (cookies) for a site
   * @param {string} siteId - Site identifier
   * @param {Array} cookies - Array of cookie objects from Puppeteer
   * @returns {Promise<void>}
   */
  async saveSession(siteId, cookies) {
    const normalizedId = siteId.toLowerCase().trim();

    const sessionEntry = {
      siteId: normalizedId,
      cookies,
      savedAt: Date.now(),
      expiresAt: Date.now() + CREDENTIAL_CONFIG.SESSION_EXPIRY_MS
    };

    this.sessions.set(normalizedId, sessionEntry);
    await this._persistSessions();

    this.logger?.info('[CredentialVault] Session saved', {
      siteId: normalizedId,
      cookiesCount: cookies.length
    });
  }

  /**
   * Get session cookies for a site
   * @param {string} siteId - Site identifier
   * @returns {Object|null} Session data or null
   */
  getSession(siteId) {
    const normalizedId = siteId.toLowerCase().trim();
    const entry = this.sessions.get(normalizedId);

    if (!entry) return null;

    // Check if session has expired
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(normalizedId);
      this._persistSessions().catch(() => {});
      return null;
    }

    return entry;
  }

  /**
   * Get all stored sessions (for cookie restoration)
   * @returns {Object} Map of siteId -> session data
   */
  getAllSessions() {
    const result = {};
    const now = Date.now();

    for (const [siteId, entry] of this.sessions) {
      // Skip expired sessions
      if (now > entry.expiresAt) {
        continue;
      }
      result[siteId] = entry;
    }

    return result;
  }

  /**
   * Delete session for a site
   * @param {string} siteId - Site identifier
   * @returns {Promise<boolean>}
   */
  async deleteSession(siteId) {
    const normalizedId = siteId.toLowerCase().trim();
    const deleted = this.sessions.delete(normalizedId);

    if (deleted) {
      await this._persistSessions();
      this.logger?.info('[CredentialVault] Session deleted', { siteId: normalizedId });
    }

    return deleted;
  }

  /**
   * Cleanup expired sessions
   * @private
   */
  _cleanupExpiredSessions() {
    const now = Date.now();
    let cleaned = 0;

    for (const [siteId, entry] of this.sessions) {
      if (now > entry.expiresAt) {
        this.sessions.delete(siteId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this._persistSessions().catch(() => {});
      this.logger?.info('[CredentialVault] Cleaned up expired sessions', { count: cleaned });
    }
  }

  // ============================================================
  // Async Credential Request Flow
  // ============================================================

  /**
   * Create a credential request (for UI prompt flow)
   * @param {string} siteId - Site identifier
   * @param {Object} options - Request options
   * @returns {Promise<Object>} Request info for WebSocket
   */
  createCredentialRequest(siteId, options = {}) {
    const requestId = `cred_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const normalizedId = siteId.toLowerCase().trim();
    const knownSite = KNOWN_SITES[normalizedId];

    const createdAt = Date.now();
    const requestInfo = {
      requestId,
      siteId: normalizedId,
      siteName: knownSite?.name || normalizedId,
      loginUrl: options.loginUrl || knownSite?.loginUrl || null,
      fields: options.fields || ['username', 'password'],
      usernameType: knownSite?.usernameType || 'email',
      agentId: options.agentId || null,
      createdAt,
      timeout: createdAt + CREDENTIAL_CONFIG.REQUEST_TIMEOUT_MS // Timestamp when request expires
    };

    // Create a promise that will be resolved when credentials are submitted
    const promise = new Promise((resolve, reject) => {
      // Set timeout for credential request
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Credential request timed out for ${normalizedId}`));
      }, CREDENTIAL_CONFIG.REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout,
        requestInfo
      });
    });

    this.logger?.info('[CredentialVault] Credential request created', {
      requestId,
      siteId: normalizedId
    });

    return {
      requestInfo,
      promise
    };
  }

  /**
   * Submit credentials for a pending request
   * @param {string} requestId - Request ID
   * @param {Object} credentials - Submitted credentials
   * @param {boolean} saveForFuture - Whether to save for future use
   * @returns {Promise<void>}
   */
  async submitCredentials(requestId, credentials, saveForFuture = false) {
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      throw new Error(`No pending credential request found: ${requestId}`);
    }

    // Clear timeout
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    // Save credentials if requested
    if (saveForFuture) {
      await this.saveCredentials(pending.requestInfo.siteId, credentials);
    }

    // Resolve the promise with credentials
    pending.resolve({
      credentials,
      siteId: pending.requestInfo.siteId,
      saved: saveForFuture
    });

    this.logger?.info('[CredentialVault] Credentials submitted', {
      requestId,
      siteId: pending.requestInfo.siteId,
      saved: saveForFuture
    });
  }

  /**
   * Cancel a pending credential request
   * @param {string} requestId - Request ID
   */
  cancelCredentialRequest(requestId) {
    const pending = this.pendingRequests.get(requestId);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      pending.reject(new Error('Credential request cancelled by user'));

      this.logger?.info('[CredentialVault] Credential request cancelled', { requestId });
    }
  }

  /**
   * Get pending request info (for status checks)
   * @param {string} requestId - Request ID
   * @returns {Object|null}
   */
  getPendingRequest(requestId) {
    const pending = this.pendingRequests.get(requestId);
    return pending ? pending.requestInfo : null;
  }

  // ============================================================
  // Persistence
  // ============================================================

  /**
   * Persist credentials to encrypted file
   * @private
   */
  async _persistCredentials() {
    if (!this.credentialsFile || !this.encryptionKey) return;

    try {
      const data = {
        version: 1,
        savedAt: new Date().toISOString(),
        credentials: Array.from(this.credentials.entries())
      };

      const encrypted = this._encrypt(JSON.stringify(data));
      await fs.writeFile(this.credentialsFile, encrypted, { mode: 0o600 });
    } catch (error) {
      this.logger?.warn('[CredentialVault] Failed to persist credentials', {
        error: error.message
      });
    }
  }

  /**
   * Load credentials from encrypted file
   * @private
   */
  async _loadCredentials() {
    if (!this.credentialsFile || !this.encryptionKey) return;

    try {
      const encrypted = await fs.readFile(this.credentialsFile, 'utf8');
      const decrypted = this._decrypt(encrypted);
      const data = JSON.parse(decrypted);

      if (data.credentials) {
        this.credentials = new Map(data.credentials);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger?.warn('[CredentialVault] Failed to load credentials', {
          error: error.message
        });
      }
    }
  }

  /**
   * Persist sessions to encrypted file
   * @private
   */
  async _persistSessions() {
    if (!this.sessionsFile || !this.encryptionKey) return;

    try {
      const data = {
        version: 1,
        savedAt: new Date().toISOString(),
        sessions: Array.from(this.sessions.entries())
      };

      const encrypted = this._encrypt(JSON.stringify(data));
      await fs.writeFile(this.sessionsFile, encrypted, { mode: 0o600 });
    } catch (error) {
      this.logger?.warn('[CredentialVault] Failed to persist sessions', {
        error: error.message
      });
    }
  }

  /**
   * Load sessions from encrypted file
   * @private
   */
  async _loadSessions() {
    if (!this.sessionsFile || !this.encryptionKey) return;

    try {
      const encrypted = await fs.readFile(this.sessionsFile, 'utf8');
      const decrypted = this._decrypt(encrypted);
      const data = JSON.parse(decrypted);

      if (data.sessions) {
        this.sessions = new Map(data.sessions);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger?.warn('[CredentialVault] Failed to load sessions', {
          error: error.message
        });
      }
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Mask username for logging (show only first/last chars)
   * @private
   */
  _maskUsername(username) {
    if (!username || username.length < 4) return '***';
    return username[0] + '***' + username.slice(-2);
  }

  /**
   * Get known site configuration
   * @param {string} siteId - Site identifier
   * @returns {Object|null}
   */
  getKnownSite(siteId) {
    const normalizedId = siteId.toLowerCase().trim();
    return KNOWN_SITES[normalizedId] || null;
  }

  /**
   * List all known sites
   * @returns {Array}
   */
  listKnownSites() {
    return Object.entries(KNOWN_SITES).map(([id, config]) => ({
      siteId: id,
      name: config.name,
      loginUrl: config.loginUrl,
      hasCredentials: this.hasCredentials(id)
    }));
  }

  /**
   * Get credential event types (for WebSocket integration)
   * @returns {Object}
   */
  static getEventTypes() {
    return CREDENTIAL_EVENTS;
  }
}

// Singleton instance
let vaultInstance = null;

/**
 * Get or create the credential vault instance
 * @param {Object} logger - Logger instance
 * @returns {CredentialVault}
 */
export function getCredentialVault(logger = null) {
  if (!vaultInstance) {
    vaultInstance = new CredentialVault(logger);
  }
  return vaultInstance;
}

export default CredentialVault;
