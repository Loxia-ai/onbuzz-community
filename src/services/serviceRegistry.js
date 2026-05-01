/**
 * Service Registry
 *
 * Centralized registry for service discovery. Each service registers itself
 * with its actual port (which may differ from configured if port was taken).
 * Other components query the registry to discover service locations.
 *
 * This registry maintains both in-memory state (for fast access) and
 * file-based persistence (for cross-process discovery via PortRegistry).
 */

import { EventEmitter } from 'events';
import net from 'net';
import { getPortRegistry } from './portRegistry.js';

/**
 * Service status enum
 */
export const ServiceStatus = {
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error'
};

/**
 * Service Registry class
 */
class ServiceRegistry extends EventEmitter {
  constructor() {
    super();

    // Registry: serviceName -> ServiceInfo
    this.services = new Map();

    // Health check interval
    this.healthCheckInterval = null;
  }

  /**
   * Register a service
   * @param {string} name - Service name (e.g., 'visualEditor', 'backend')
   * @param {Object} info - Service information
   * @param {number} info.port - Port the service is running on
   * @param {string} [info.host='localhost'] - Host address
   * @param {string} [info.protocol='http'] - Protocol (http, https, ws, wss)
   * @param {string} [info.status='running'] - Service status
   * @param {Object} [info.metadata={}] - Additional metadata
   * @param {boolean} [info.persistToFile=true] - Whether to persist to file registry
   * @returns {Object} Registered service info
   */
  register(name, info) {
    if (!name) {
      throw new Error('Service name is required');
    }
    if (!info.port) {
      throw new Error('Service port is required');
    }

    const serviceInfo = {
      name,
      port: info.port,
      host: info.host || 'localhost',
      protocol: info.protocol || 'http',
      status: info.status || ServiceStatus.RUNNING,
      metadata: info.metadata || {},
      registeredAt: Date.now(),
      lastHeartbeat: Date.now()
    };

    // Build URLs
    serviceInfo.url = `${serviceInfo.protocol}://${serviceInfo.host}:${serviceInfo.port}`;
    serviceInfo.wsUrl = `ws://${serviceInfo.host}:${serviceInfo.port}`;

    const isUpdate = this.services.has(name);
    this.services.set(name, serviceInfo);

    console.log(`[ServiceRegistry] ${isUpdate ? 'Updated' : 'Registered'} service: ${name} at ${serviceInfo.url}`);

    this.emit(isUpdate ? 'service:updated' : 'service:registered', serviceInfo);

    // Persist to file-based registry for cross-process discovery
    if (info.persistToFile !== false) {
      this._persistToFile(name, serviceInfo).catch(err => {
        console.warn(`[ServiceRegistry] Failed to persist ${name} to file registry:`, err.message);
      });
    }

    return serviceInfo;
  }

  /**
   * Persist service to file-based registry
   * @private
   */
  async _persistToFile(name, serviceInfo) {
    const portRegistry = getPortRegistry();
    await portRegistry.registerService(name, {
      port: serviceInfo.port,
      host: serviceInfo.host,
      protocol: serviceInfo.protocol,
      metadata: serviceInfo.metadata
    });
  }

  /**
   * Unregister a service
   * @param {string} name - Service name
   * @param {boolean} [persistToFile=true] - Whether to remove from file registry
   * @returns {boolean} True if service was removed
   */
  unregister(name, persistToFile = true) {
    const service = this.services.get(name);
    if (service) {
      this.services.delete(name);
      console.log(`[ServiceRegistry] Unregistered service: ${name}`);
      this.emit('service:unregistered', { name, ...service });

      // Remove from file-based registry
      if (persistToFile) {
        this._removeFromFile(name).catch(err => {
          console.warn(`[ServiceRegistry] Failed to remove ${name} from file registry:`, err.message);
        });
      }

      return true;
    }
    return false;
  }

  /**
   * Remove service from file-based registry
   * @private
   */
  async _removeFromFile(name) {
    const portRegistry = getPortRegistry();
    await portRegistry.unregisterService(name);
  }

  /**
   * Get a service by name
   * @param {string} name - Service name
   * @returns {Object|null} Service info or null
   */
  get(name) {
    return this.services.get(name) || null;
  }

  /**
   * Get all registered services
   * @returns {Object} Map of service name to info
   */
  getAll() {
    const result = {};
    for (const [name, info] of this.services) {
      result[name] = { ...info };
    }
    return result;
  }

  /**
   * Get URL for a service
   * @param {string} name - Service name
   * @returns {string|null} Service URL or null
   */
  getUrl(name) {
    const service = this.services.get(name);
    return service?.url || null;
  }

  /**
   * Get WebSocket URL for a service
   * @param {string} name - Service name
   * @param {string} [path=''] - Optional path to append
   * @returns {string|null} WebSocket URL or null
   */
  getWsUrl(name, path = '') {
    const service = this.services.get(name);
    if (!service) return null;
    return `${service.wsUrl}${path}`;
  }

  /**
   * Update service status
   * @param {string} name - Service name
   * @param {string} status - New status
   */
  updateStatus(name, status) {
    const service = this.services.get(name);
    if (service) {
      service.status = status;
      service.lastHeartbeat = Date.now();
      this.emit('service:statusChanged', { name, status });
    }
  }

  /**
   * Record heartbeat for a service
   * @param {string} name - Service name
   */
  heartbeat(name) {
    const service = this.services.get(name);
    if (service) {
      service.lastHeartbeat = Date.now();
    }
  }

  /**
   * Check if a service is registered and running
   * @param {string} name - Service name
   * @returns {boolean}
   */
  isRunning(name) {
    const service = this.services.get(name);
    return service?.status === ServiceStatus.RUNNING;
  }

  /**
   * Clear all registered services
   */
  clear() {
    this.services.clear();
    this.emit('registry:cleared');
  }

  /**
   * Get registry statistics
   * @returns {Object}
   */
  getStats() {
    const services = Array.from(this.services.values());
    return {
      totalServices: services.length,
      runningServices: services.filter(s => s.status === ServiceStatus.RUNNING).length,
      services: services.map(s => ({ name: s.name, port: s.port, status: s.status }))
    };
  }

  /**
   * Load services from file-based registry
   * Useful for discovering services started by other processes
   * @returns {Promise<Object>} Map of service name to info
   */
  async loadFromFile() {
    const portRegistry = getPortRegistry();
    await portRegistry.cleanupStaleEntries();
    return portRegistry.getAllServices();
  }

  /**
   * Get a service from file-based registry (for cross-process discovery)
   * @param {string} name - Service name
   * @returns {Promise<Object|null>} Service info or null
   */
  async getFromFile(name) {
    const portRegistry = getPortRegistry();
    return portRegistry.getService(name);
  }

  /**
   * Setup process exit handlers to cleanup registry on shutdown
   * Call this after registering services to ensure cleanup on exit
   */
  setupExitHandlers() {
    if (this._exitHandlersSetup) return;
    this._exitHandlersSetup = true;

    const cleanup = async () => {
      console.log('[ServiceRegistry] Cleaning up on process exit...');
      const portRegistry = getPortRegistry();

      // Unregister all services owned by this process
      for (const [name] of this.services) {
        try {
          await portRegistry.unregisterService(name);
        } catch (err) {
          // Ignore errors during cleanup
        }
      }
    };

    // Run cleanup when the process is about to exit naturally
    // Note: Do NOT add SIGINT/SIGTERM handlers here — the main app (index.js)
    // handles signals and calls shutdown() which already unregisters services.
    // Adding competing handlers causes race conditions and premature exit.
    process.on('beforeExit', cleanup);
  }
}

// Singleton instance
const registry = new ServiceRegistry();

/**
 * Find a free port starting from the preferred port
 * @param {number} preferredPort - Port to try first
 * @param {number} [maxAttempts=100] - Maximum ports to try
 * @param {string} [host='127.0.0.1'] - Host to check availability on
 * @returns {Promise<number>} Available port
 */
export async function findFreePort(preferredPort, maxAttempts = 100, host = '127.0.0.1') {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = preferredPort + attempt;
    const isFree = await isPortFree(port, host);
    if (isFree) {
      if (attempt > 0) {
        console.log(`[ServiceRegistry] Port ${preferredPort} taken, using ${port}`);
      }
      return port;
    }
  }
  throw new Error(`Could not find free port after ${maxAttempts} attempts starting from ${preferredPort}`);
}

/**
 * Check if a port is free on a specific host
 * @param {number} port - Port to check
 * @param {string} host - Host to check (default: '127.0.0.1')
 * @returns {Promise<boolean>}
 */
export async function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();

    // Set a timeout to avoid hanging
    const timeout = setTimeout(() => {
      try { server.close(); } catch {}
      resolve(false);
    }, 1000);

    server.once('error', (err) => {
      clearTimeout(timeout);
      // EADDRINUSE = port in use, EACCES = permission denied (WSL2 IPv6 issue)
      // Any error means we can't use this port
      resolve(false);
    });

    server.once('listening', () => {
      clearTimeout(timeout);
      server.close(() => {
        resolve(true);
      });
    });

    try {
      server.listen(port, host);
    } catch (err) {
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

/**
 * Start a service with automatic port fallback
 * @param {string} serviceName - Name to register the service as
 * @param {number} preferredPort - Preferred port
 * @param {Function} startFn - Function that starts the service, receives port, returns server
 * @param {Object} [options={}] - Additional options
 * @returns {Promise<Object>} { server, port, serviceInfo }
 */
export async function startServiceWithFallback(serviceName, preferredPort, startFn, options = {}) {
  const port = await findFreePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`[ServiceRegistry] Port ${preferredPort} taken, using ${port} for ${serviceName}`);
  }

  // Start the service
  const server = await startFn(port);

  // Register with registry
  const serviceInfo = registry.register(serviceName, {
    port,
    host: options.host || 'localhost',
    protocol: options.protocol || 'http',
    metadata: options.metadata || {}
  });

  return { server, port, serviceInfo };
}

// Export singleton and class
export { registry, ServiceRegistry, ServiceStatus as Status };
export { getPortRegistry } from './portRegistry.js';
export default registry;
