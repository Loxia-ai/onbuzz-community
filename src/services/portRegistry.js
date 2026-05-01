/**
 * Port Registry
 *
 * File-based registry for cross-process service discovery.
 * Services register their actual ports (which may differ from configured
 * if the preferred port was taken). Other processes read the registry
 * to discover where services are running.
 *
 * DESIGN: Fail-safe, never block startup. If corruption detected, reset and continue.
 *
 * Registry Location:
 * - Linux:   ~/.local/share/loxia-autopilot/runtime/ports.json
 * - macOS:   ~/Library/Application Support/loxia-autopilot/runtime/ports.json
 * - Windows: %LOCALAPPDATA%/loxia-autopilot/runtime/ports.json
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getUserDataPaths } from '../utilities/userDataDir.js';

const REGISTRY_FILENAME = 'ports.json';
const REGISTRY_VERSION = 1;

/**
 * Port Registry class for file-based service discovery
 */
export class PortRegistry {
  constructor() {
    this.filePath = null;
    this._initialized = false;
  }

  /**
   * Get the registry file path (lazy initialization)
   * @returns {string}
   */
  getFilePath() {
    if (!this.filePath) {
      const paths = getUserDataPaths();
      this.filePath = path.join(paths.runtime, REGISTRY_FILENAME);
    }
    return this.filePath;
  }

  /**
   * Ensure the runtime directory exists
   */
  async ensureDirectory() {
    const filePath = this.getFilePath();
    const dir = path.dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        console.warn('[PortRegistry] Failed to create directory:', error.message);
      }
    }
  }

  /**
   * Create an empty registry structure
   * @returns {Object}
   */
  _createEmpty() {
    return {
      version: REGISTRY_VERSION,
      lastUpdated: new Date().toISOString(),
      services: {}
    };
  }

  /**
   * Load the registry from disk - NEVER throws, always returns valid data
   * @returns {Promise<Object>} Registry data
   */
  async load() {
    const filePath = this.getFilePath();

    try {
      const content = await fs.readFile(filePath, 'utf8');

      // Validate content is not empty
      if (!content || content.trim().length === 0) {
        console.warn('[PortRegistry] Empty registry file, using defaults');
        return this._createEmpty();
      }

      const data = JSON.parse(content);

      // Validate version
      if (data.version !== REGISTRY_VERSION) {
        console.warn(`[PortRegistry] Version mismatch (got ${data.version}, expected ${REGISTRY_VERSION}), resetting`);
        return this._resetFile();
      }

      // Validate structure
      if (!data.services || typeof data.services !== 'object') {
        console.warn('[PortRegistry] Invalid structure, resetting');
        return this._resetFile();
      }

      return data;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - normal case on first run
        return this._createEmpty();
      }

      // Any other error (corruption, permission, etc) - reset and continue
      console.warn(`[PortRegistry] Load error (${error.message}), resetting`);
      return this._resetFile();
    }
  }

  /**
   * Reset the registry file to defaults - NEVER throws
   * @returns {Object} Empty registry
   */
  async _resetFile() {
    const empty = this._createEmpty();
    const filePath = this.getFilePath();

    try {
      await this.ensureDirectory();
      await fs.writeFile(filePath, JSON.stringify(empty, null, 2), 'utf8');
      console.log('[PortRegistry] Registry reset to defaults');
    } catch (error) {
      // Even if reset fails, return empty and continue
      console.warn('[PortRegistry] Could not reset file:', error.message);
    }

    return empty;
  }

  /**
   * Save the registry to disk - NEVER throws, logs errors and continues
   * @param {Object} data - Registry data to save
   * @returns {Promise<boolean>} True if save succeeded
   */
  async save(data) {
    const filePath = this.getFilePath();
    const tempPath = `${filePath}.tmp.${process.pid}`;

    // Update timestamp
    data.lastUpdated = new Date().toISOString();
    const content = JSON.stringify(data, null, 2);

    try {
      await this.ensureDirectory();

      // Write to temp file first, then atomic rename
      await fs.writeFile(tempPath, content, 'utf8');
      await fs.rename(tempPath, filePath);
      return true;
    } catch (error) {
      console.warn('[PortRegistry] Save failed:', error.message);

      // Try direct write as fallback
      try {
        await fs.writeFile(filePath, content, 'utf8');
        return true;
      } catch (fallbackError) {
        console.warn('[PortRegistry] Fallback save also failed:', fallbackError.message);
      }

      // Clean up temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      return false;
    }
  }

  /**
   * Register a service
   * @param {string} name - Service name (e.g., 'backend', 'visualEditor')
   * @param {Object} info - Service information
   * @param {number} info.port - Port the service is running on
   * @param {string} [info.host='localhost'] - Host address
   * @param {string} [info.protocol='http'] - Protocol
   * @param {Object} [info.metadata={}] - Additional metadata
   * @returns {Promise<Object>} Registered service info
   */
  async registerService(name, info) {
    if (!name || !info.port) {
      console.warn('[PortRegistry] Invalid service registration:', { name, port: info?.port });
      return null;
    }

    const registry = await this.load();

    const serviceInfo = {
      port: info.port,
      host: info.host || 'localhost',
      protocol: info.protocol || 'http',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      metadata: info.metadata || {}
    };

    registry.services[name] = serviceInfo;

    const saved = await this.save(registry);

    if (saved) {
      console.log(`[PortRegistry] Registered: ${name} at ${serviceInfo.host}:${serviceInfo.port} (PID: ${serviceInfo.pid})`);
    }

    return serviceInfo;
  }

  /**
   * Unregister a service
   * @param {string} name - Service name
   * @returns {Promise<boolean>} True if service was removed
   */
  async unregisterService(name) {
    const registry = await this.load();

    if (registry.services[name]) {
      delete registry.services[name];
      await this.save(registry);
      console.log(`[PortRegistry] Unregistered: ${name}`);
      return true;
    }

    return false;
  }

  /**
   * Get a service by name
   * @param {string} name - Service name
   * @returns {Promise<Object|null>} Service info or null
   */
  async getService(name) {
    const registry = await this.load();
    return registry.services[name] || null;
  }

  /**
   * Get all registered services
   * @returns {Promise<Object>} Map of service name to info
   */
  async getAllServices() {
    const registry = await this.load();
    return registry.services;
  }

  /**
   * Check if a process is running
   * @param {number} pid - Process ID
   * @returns {boolean}
   */
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === 'EPERM';
    }
  }

  /**
   * Clean up stale entries (services where the process is no longer running)
   * @returns {Promise<string[]>} Names of cleaned up services
   */
  async cleanupStaleEntries() {
    const registry = await this.load();
    const cleanedUp = [];

    for (const [name, info] of Object.entries(registry.services)) {
      if (info.pid && !this.isProcessRunning(info.pid)) {
        delete registry.services[name];
        cleanedUp.push(name);
        console.log(`[PortRegistry] Cleaned stale: ${name} (PID ${info.pid} gone)`);
      }
    }

    if (cleanedUp.length > 0) {
      await this.save(registry);
    }

    return cleanedUp;
  }

  /**
   * Get URL for a service
   * @param {string} name - Service name
   * @returns {Promise<string|null>} Service URL or null
   */
  async getServiceUrl(name) {
    const service = await this.getService(name);
    if (!service) return null;
    return `${service.protocol}://${service.host}:${service.port}`;
  }

  /**
   * Get WebSocket URL for a service
   * @param {string} name - Service name
   * @param {string} [wsPath=''] - WebSocket path
   * @returns {Promise<string|null>} WebSocket URL or null
   */
  async getServiceWsUrl(name, wsPath = '') {
    const service = await this.getService(name);
    if (!service) return null;
    const wsProtocol = service.protocol === 'https' ? 'wss' : 'ws';
    return `${wsProtocol}://${service.host}:${service.port}${wsPath}`;
  }

  /**
   * Clear all services from the registry
   * @returns {Promise<void>}
   */
  async clear() {
    await this._resetFile();
  }
}

// Singleton instance
let registryInstance = null;

/**
 * Get the singleton PortRegistry instance
 * @returns {PortRegistry}
 */
export function getPortRegistry() {
  if (!registryInstance) {
    registryInstance = new PortRegistry();
  }
  return registryInstance;
}

export default getPortRegistry;
