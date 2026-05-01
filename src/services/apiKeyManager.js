/**
 * API Key Manager - Persistent API key storage
 *
 * Purpose:
 * - Store API keys with encrypted persistence to disk
 * - Manage both platform (Loxia) and vendor-specific keys
 * - Provide keys to AI services based on model requirements
 * - Survive backend restarts by loading persisted keys
 *
 * Note: API keys are stored globally (not per-session) since there's
 * only one user using the local backend. Session IDs are ephemeral
 * and change on every restart, so session-based storage doesn't make sense.
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { getUserDataPaths, ensureUserDataDirs } from '../utilities/userDataDir.js';
import { isPlaceholderApiKey } from '../utilities/apiKeyPlaceholders.js';

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

class ApiKeyManager {
  constructor(logger) {
    this.logger = logger;

    // Global API keys (persisted). Vendor keys are the primary surface
    // since the OSS edition talks to providers directly. customEndpoints
    // hold OpenAI-compatible third-party gateways (OpenRouter, Together, etc.).
    this.keys = {
      vendorKeys: {},      // { openai, anthropic, gemini, xai }
      customEndpoints: [], // [{ id, name, baseUrl, apiKey }]
    };

    // Persistence configuration
    this.persistenceFile = null;
    this.encryptionKey = null;
    this.initialized = false;
  }

  /**
   * Initialize persistence - must be called before using persistence features
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await ensureUserDataDirs();
      const paths = getUserDataPaths();
      this.persistenceFile = path.join(paths.settings, 'api-keys.enc');

      // Generate or load machine-specific encryption key
      this.encryptionKey = await this._getOrCreateEncryptionKey(paths.settings);

      // Load persisted keys
      await this.loadFromDisk();

      this.initialized = true;
      this.logger?.info('[ApiKeyManager] Initialized with persistence', {
        vendors: Object.keys(this.keys.vendorKeys || {}),
        customEndpoints: (this.keys.customEndpoints || []).length,
      });
    } catch (error) {
      this.logger?.warn('[ApiKeyManager] Persistence initialization failed, using memory-only mode', {
        error: error.message
      });
    }
  }

  /**
   * Get or create a machine-specific encryption key
   * @param {string} settingsDir - Settings directory path
   * @returns {Promise<Buffer>} Encryption key
   */
  async _getOrCreateEncryptionKey(settingsDir) {
    const saltFile = path.join(settingsDir, '.key-salt');
    let salt;

    try {
      salt = await fs.readFile(saltFile);
    } catch (error) {
      // Generate new salt
      salt = crypto.randomBytes(SALT_LENGTH);
      await fs.writeFile(saltFile, salt, { mode: 0o600 });
      this.logger?.info('[ApiKeyManager] Generated new encryption salt');
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
   * @returns {string}
   */
  _getMachineIdentifier() {
    const parts = [
      os.hostname(),
      os.homedir(),
      os.userInfo().username,
      process.platform,
      'loxia-api-key-encryption-v1'
    ];
    return parts.join(':');
  }

  /**
   * Encrypt data using AES-256-GCM
   * @param {string} plaintext - Data to encrypt
   * @returns {string} Encrypted data as base64
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
   * @param {string} encryptedData - Encrypted data as base64
   * @returns {string} Decrypted plaintext
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

  /**
   * Persist keys to encrypted file
   * @returns {Promise<void>}
   */
  async persist() {
    if (!this.persistenceFile || !this.encryptionKey) {
      return; // Persistence not initialized
    }

    try {
      const data = {
        version: 3,
        savedAt: new Date().toISOString(),
        keys: this.keys,
      };

      const encrypted = this._encrypt(JSON.stringify(data));
      await fs.writeFile(this.persistenceFile, encrypted, { mode: 0o600 });

      this.logger?.debug('[ApiKeyManager] Keys persisted to disk');
    } catch (error) {
      this.logger?.warn('[ApiKeyManager] Failed to persist keys', { error: error.message });
    }
  }

  /**
   * Load persisted keys from disk
   * @returns {Promise<void>}
   */
  async loadFromDisk() {
    if (!this.persistenceFile || !this.encryptionKey) {
      return; // Persistence not initialized
    }

    try {
      const encrypted = await fs.readFile(this.persistenceFile, 'utf8');
      const decrypted = this._decrypt(encrypted);
      const data = JSON.parse(decrypted);

      // v3 (current OSS schema): { vendorKeys, customEndpoints }
      // v2 (legacy commercial): had `loxiaApiKey` — drop it on migration.
      // v1 (legacy nested): had `globalKeys`.
      if (data.version === 3 && data.keys) {
        this.keys = {
          vendorKeys:      data.keys.vendorKeys      || {},
          customEndpoints: data.keys.customEndpoints || [],
        };
      } else if (data.version === 2 && data.keys) {
        // Drop loxiaApiKey, keep vendorKeys (user-approved migration).
        this.keys = {
          vendorKeys:      data.keys.vendorKeys || {},
          customEndpoints: [],
        };
        this.logger?.info('[ApiKeyManager] Migrated v2 → v3 (dropped loxiaApiKey, preserved vendor keys)');
      } else if (data.globalKeys) {
        this.keys = {
          vendorKeys:      data.globalKeys.vendorKeys || {},
          customEndpoints: [],
        };
      }

      // Scrub placeholder strings the legacy UI may have written to disk.
      let scrubbed = false;
      for (const k of Object.keys(this.keys.vendorKeys || {})) {
        if (isPlaceholderApiKey(this.keys.vendorKeys[k])) {
          this.logger?.warn(`[ApiKeyManager] Scrubbing placeholder vendor key: ${k}`);
          delete this.keys.vendorKeys[k];
          scrubbed = true;
        }
      }
      if (scrubbed) {
        try { await this.persist(); } catch { /* ok */ }
      }

      this.logger?.info('[ApiKeyManager] Loaded persisted keys', {
        vendors:         Object.keys(this.keys.vendorKeys || {}),
        customEndpoints: (this.keys.customEndpoints || []).length,
        savedAt:         data.savedAt,
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger?.debug('[ApiKeyManager] No persisted keys found');
      } else {
        this.logger?.warn('[ApiKeyManager] Failed to load persisted keys', {
          error: error.message
        });
      }
    }
  }

  /**
   * Set API keys (sessionId parameter kept for API compatibility but ignored).
   *
   * Defense-in-depth: reject UI placeholder strings (bullet-character
   * masks the UI may use to display a stored key without echoing the
   * real value). They're never valid API keys.
   *
   * @param {string|null} sessionId - Ignored, kept for API compatibility
   * @param {Object}      keys - { vendorKeys, customEndpoints }
   * @param {Object}      keys.vendorKeys - { openai, anthropic, gemini, xai, ... }
   * @param {Array}       keys.customEndpoints - [{ id, name, baseUrl, apiKey }]
   */
  async setSessionKeys(sessionId, keys) {
    if (keys.vendorKeys) {
      const cleanVendor = {};
      for (const [vendor, value] of Object.entries(keys.vendorKeys)) {
        if (isPlaceholderApiKey(value)) {
          this.logger?.warn(`[ApiKeyManager] Refusing to store placeholder for vendor ${vendor} — keeping existing key`);
          continue;
        }
        if (value === '' || value == null) {
          // Empty value clears the key
          delete this.keys.vendorKeys[vendor];
          continue;
        }
        cleanVendor[vendor] = value;
      }
      this.keys.vendorKeys = { ...this.keys.vendorKeys, ...cleanVendor };
    }

    if (Array.isArray(keys.customEndpoints)) {
      this.keys.customEndpoints = keys.customEndpoints
        .filter(ep => ep && typeof ep.baseUrl === 'string' && !isPlaceholderApiKey(ep.apiKey));
    }

    this.logger?.info('[ApiKeyManager] API keys updated', {
      vendors:         Object.keys(this.keys.vendorKeys || {}),
      customEndpoints: (this.keys.customEndpoints || []).length,
    });

    await this.persist();
  }

  /**
   * Get API keys (sessionId parameter kept for API compatibility but ignored)
   * @param {string} sessionId - Ignored, kept for API compatibility
   * @returns {Object} API keys object
   */
  getSessionKeys(sessionId) {
    return this.keys;
  }

  /**
   * Get the API key for a vendor.
   * @param {string} _sessionId - Ignored, kept for API compatibility
   * @param {Object} options - { vendor }
   * @returns {Object} { vendorApiKey }
   */
  getKeysForRequest(_sessionId, options = {}) {
    const vendorApiKey = options.vendor && this.keys.vendorKeys
      ? this.keys.vendorKeys[options.vendor] || null
      : null;
    return { vendorApiKey };
  }

  /**
   * Remove API keys (clears all keys)
   * @param {string} sessionId - Ignored, kept for API compatibility
   */
  async removeSessionKeys(_sessionId) {
    const hadKeys = Object.keys(this.keys.vendorKeys || {}).length > 0
                  || (this.keys.customEndpoints || []).length > 0;
    this.keys = { vendorKeys: {}, customEndpoints: [] };

    if (hadKeys) {
      this.logger?.info('[ApiKeyManager] API keys removed');
      await this.persist();
    }
    return hadKeys;
  }

  /**
   * Set global API keys (alias of setSessionKeys).
   * @param {Object} keys - { vendorKeys, customEndpoints }
   */
  async setGlobalKeys(keys) {
    return this.setSessionKeys(null, keys);
  }

  /**
   * Alias of setSessionKeys.
   * @param {string|null} sessionId
   * @param {Object} keys
   */
  async setKeys(sessionId, keys) {
    return this.setSessionKeys(sessionId, keys);
  }

  /**
   * Alias of removeSessionKeys.
   * @param {string|null} sessionId
   */
  async removeKeys(sessionId) {
    return this.removeSessionKeys(sessionId);
  }

  /**
   * Get active sessions info (returns empty for compatibility)
   * @returns {Array}
   */
  getActiveSessions() {
    return [];
  }

  /**
   * Cleanup (no-op, kept for API compatibility)
   */
  cleanupExpiredSessions() {
    return 0;
  }
}

export default ApiKeyManager;
