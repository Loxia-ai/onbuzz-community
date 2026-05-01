/**
 * @file services/portTracker.js
 * @description Tracks port usage across the system to prevent conflicts
 * and help agents find available ports for serving applications.
 */

import net from 'net';

// Well-known ports used by the system
const SYSTEM_PORTS = {
  WEB_UI: 8080,
  VISUAL_EDITOR: 4000,
};

// Default port range for user apps
const DEFAULT_PORT_RANGE = {
  start: 3000,
  end: 3100
};

/**
 * Port Tracker - manages port allocation and tracking
 */
class PortTracker {
  constructor() {
    // Map of port -> { owner: string, type: string, startedAt: Date, pid?: number }
    this.activePorts = new Map();

    // Register system ports
    this.activePorts.set(SYSTEM_PORTS.WEB_UI, {
      owner: 'loxia-web-ui',
      type: 'system',
      startedAt: new Date()
    });
    this.activePorts.set(SYSTEM_PORTS.VISUAL_EDITOR, {
      owner: 'visual-editor-server',
      type: 'system',
      startedAt: new Date()
    });
  }

  /**
   * Check if a port is available (not in use)
   * @param {number} port - Port to check
   * @returns {Promise<boolean>} True if available
   */
  async isPortAvailable(port) {
    // First check our internal tracking
    if (this.activePorts.has(port)) {
      return false;
    }

    // Then check if actually in use on the system
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          resolve(true); // Other errors mean port might be available
        }
      });

      server.once('listening', () => {
        server.close();
        resolve(true);
      });

      server.listen(port, '127.0.0.1');
    });
  }

  /**
   * Find next available port in range
   * @param {number} startPort - Starting port (default: 3000)
   * @param {number} endPort - Ending port (default: 3100)
   * @returns {Promise<number|null>} Available port or null
   */
  async findAvailablePort(startPort = DEFAULT_PORT_RANGE.start, endPort = DEFAULT_PORT_RANGE.end) {
    for (let port = startPort; port <= endPort; port++) {
      const available = await this.isPortAvailable(port);
      if (available) {
        return port;
      }
    }
    return null;
  }

  /**
   * Register a port as in use
   * @param {number} port - Port number
   * @param {Object} info - Port usage info
   * @param {string} info.owner - Owner identifier (agentId, service name)
   * @param {string} info.type - Type ('agent-app', 'system', 'dev-server')
   * @param {number} info.pid - Process ID (optional)
   * @param {string} info.command - Command that started the server (optional)
   */
  registerPort(port, info) {
    this.activePorts.set(port, {
      ...info,
      startedAt: new Date()
    });
  }

  /**
   * Unregister a port (mark as available)
   * @param {number} port - Port number
   * @returns {boolean} True if was registered
   */
  unregisterPort(port) {
    return this.activePorts.delete(port);
  }

  /**
   * Get info about a port
   * @param {number} port - Port number
   * @returns {Object|null} Port info or null
   */
  getPortInfo(port) {
    return this.activePorts.get(port) || null;
  }

  /**
   * Get all registered ports
   * @returns {Array<{port: number, info: Object}>}
   */
  getAllPorts() {
    return Array.from(this.activePorts.entries()).map(([port, info]) => ({
      port,
      ...info
    }));
  }

  /**
   * Get ports owned by a specific agent
   * @param {string} agentId - Agent ID
   * @returns {Array<{port: number, info: Object}>}
   */
  getAgentPorts(agentId) {
    return this.getAllPorts().filter(p => p.owner === agentId);
  }

  /**
   * Extract port from URL
   * @param {string} url - URL string
   * @returns {number|null} Port number or null
   */
  static extractPortFromUrl(url) {
    try {
      const parsed = new URL(url);
      return parseInt(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
    } catch {
      return null;
    }
  }

  /**
   * Extract port from terminal output (common patterns)
   * @param {string} output - Terminal output
   * @returns {Object|null} { port, url } or null
   */
  static extractPortFromOutput(output) {
    // Common patterns from dev servers:
    // - "Server running on http://localhost:3000"
    // - "Local: http://localhost:5173/"
    // - "listening on port 3000"
    // - "Started server on 0.0.0.0:3000"
    // - "Your application is available at http://127.0.0.1:8000"

    const patterns = [
      // URL patterns
      /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/gi,
      // Port only patterns
      /(?:listening|running|started|serving).*?(?:on|at)?\s*(?:port\s*)?(\d{4,5})/gi,
      /port\s*[:\s]\s*(\d{4,5})/gi,
      // Next.js / Vite specific
      /Local:\s*https?:\/\/[^:]+:(\d+)/gi,
      /ready.*https?:\/\/[^:]+:(\d+)/gi,
    ];

    for (const pattern of patterns) {
      const matches = output.matchAll(pattern);
      for (const match of matches) {
        const port = parseInt(match[1]);
        if (port >= 1024 && port <= 65535) {
          // Try to extract full URL
          const urlMatch = output.match(new RegExp(`https?://[^\\s]+:${port}[^\\s]*`));
          return {
            port,
            url: urlMatch ? urlMatch[0].replace(/[,;]$/, '') : `http://localhost:${port}`
          };
        }
      }
    }

    return null;
  }

  /**
   * Get system ports
   * @returns {Object} System port constants
   */
  static getSystemPorts() {
    return { ...SYSTEM_PORTS };
  }
}

// Singleton instance
let trackerInstance = null;

/**
 * Get or create the port tracker singleton
 * @returns {PortTracker}
 */
export function getPortTracker() {
  if (!trackerInstance) {
    trackerInstance = new PortTracker();
  }
  return trackerInstance;
}

export default PortTracker;
