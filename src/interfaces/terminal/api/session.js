/**
 * Session Management
 * Handles HTTP session creation and management with the local OnBuzz server.
 */

import {
  NETWORK,
  API_ENDPOINTS,
  ERROR_MESSAGE,
  SUCCESS_MESSAGE,
} from '../config/constants.js';
import { ApiClient } from './apiClient.js';

/**
 * Session Manager Class
 * Manages HTTP session lifecycle and API key storage
 */
export class SessionManager {
  constructor(host = NETWORK.DEFAULT_HOST, port = NETWORK.DEFAULT_PORT) {
    this.host = host;
    this.port = port;
    this.baseUrl = `http://${host}:${port}`;

    this.sessionId = null;
    this.projectDir = null;
    this.createdAt = null;
    this.lastActivity = null;

    // API keys storage (vendor-keyed: openai, anthropic, gemini, xai, ...)
    this.vendorKeys = {};

    // Initialize API client (no client-side auth — keys live on the
    // backend's apiKeyManager).
    this.apiClient = new ApiClient(this.baseUrl);
  }

  /**
   * Create a new session
   */
  async createSession(projectDir = process.cwd()) {
    try {
      const response = await this.makeRequest('POST', API_ENDPOINTS.SESSION_CREATE, {
        projectDir,
      });

      if (response.success && response.session) {
        this.sessionId = response.session.id;
        this.projectDir = projectDir;
        this.createdAt = response.session.createdAt;
        this.lastActivity = response.session.lastActivity;

        return {
          success: true,
          sessionId: this.sessionId,
          session: response.session,
        };
      } else {
        throw new Error(response.error || ERROR_MESSAGE.SESSION_CREATE_FAILED);
      }
    } catch (error) {
      throw new Error(`${ERROR_MESSAGE.SESSION_CREATE_FAILED}: ${error.message}`);
    }
  }

  /**
   * Set vendor API keys for the session.
   * @param {Object} vendorKeys - { openai, anthropic, gemini, xai, ... }
   */
  async setApiKeys(vendorKeys = {}) {
    if (!this.sessionId) {
      throw new Error(ERROR_MESSAGE.SESSION_INVALID);
    }

    try {
      const response = await this.makeRequest('POST', API_ENDPOINTS.KEYS_SET, {
        sessionId: this.sessionId,
        vendorKeys,
      });

      if (response.success) {
        this.vendorKeys = vendorKeys;
        return {
          success:    true,
          vendorKeys: response.vendorKeys,
        };
      }
      throw new Error(response.error || 'Failed to set API keys');
    } catch (error) {
      throw new Error(`Failed to set API keys: ${error.message}`);
    }
  }

  /**
   * Get API key status for the session (presence only, never values).
   */
  async getApiKeyStatus() {
    if (!this.sessionId) {
      throw new Error(ERROR_MESSAGE.SESSION_INVALID);
    }

    try {
      const endpoint = API_ENDPOINTS.KEYS_GET.replace(':sessionId', this.sessionId);
      const response = await this.makeRequest('GET', endpoint);
      if (response.success) {
        return {
          success:    true,
          vendorKeys: response.vendorKeys || [],
          customEndpoints: response.customEndpoints || [],
        };
      }
      throw new Error(response.error || 'Failed to get API key status');
    } catch (error) {
      throw new Error(`Failed to get API key status: ${error.message}`);
    }
  }

  /**
   * Delete API keys for the session.
   */
  async deleteApiKeys() {
    if (!this.sessionId) {
      throw new Error(ERROR_MESSAGE.SESSION_INVALID);
    }

    try {
      const endpoint = API_ENDPOINTS.KEYS_DELETE.replace(':sessionId', this.sessionId);
      const response = await this.makeRequest('DELETE', endpoint);
      if (response.success) {
        this.vendorKeys = {};
        return { success: true };
      }
      throw new Error(response.error || 'Failed to delete API keys');
    } catch (error) {
      throw new Error(`Failed to delete API keys: ${error.message}`);
    }
  }

  /**
   * Initialize session (check health + create session)
   */
  async initialize(projectDir = process.cwd()) {
    try {
      // First check if server is healthy
      const healthCheck = await this.checkHealth();
      if (!healthCheck.success) {
        throw new Error(`Server health check failed: ${healthCheck.error}`);
      }

      // Create session
      const sessionResult = await this.createSession(projectDir);

      return {
        success: true,
        sessionId: sessionResult.sessionId,
        session: sessionResult.session,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Check server health
   */
  async checkHealth() {
    try {
      const response = await this.makeRequest('GET', API_ENDPOINTS.HEALTH);
      return {
        success: true,
        status: response.status,
        version: response.version,
        timestamp: response.timestamp,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Make HTTP request
   * Delegates to ApiClient for consistent authentication
   */
  async makeRequest(method, endpoint, body = null) {
    return this.apiClient.request(method, endpoint, { body });
  }

  /**
   * Get session ID
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * Get project directory
   */
  getProjectDir() {
    return this.projectDir;
  }

  /**
   * Check if session is valid
   */
  isValid() {
    return this.sessionId !== null;
  }

  /**
   * Update last activity timestamp
   */
  updateActivity() {
    this.lastActivity = new Date().toISOString();
  }

  /**
   * Get session info
   */
  getSessionInfo() {
    return {
      sessionId:       this.sessionId,
      projectDir:      this.projectDir,
      createdAt:       this.createdAt,
      lastActivity:    this.lastActivity,
      vendorKeysCount: Object.keys(this.vendorKeys).length,
    };
  }

  /**
   * Clear session data
   */
  clear() {
    this.sessionId    = null;
    this.projectDir   = null;
    this.createdAt    = null;
    this.lastActivity = null;
    this.vendorKeys   = {};
  }
}

export default SessionManager;
