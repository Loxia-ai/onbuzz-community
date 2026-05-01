/**
 * Terminal UI Entry Point
 * Launches the Ink-based Terminal UI for OnBuzz Community
 */

import React from 'react';
import { render } from 'ink';
import { Layout } from './components/Layout.js';
import { getPortRegistry } from '../../services/portRegistry.js';

/**
 * Discover backend port from the port registry
 * @returns {Promise<{host: string, port: number}|null>} Backend info or null if not found
 */
async function discoverBackend() {
  try {
    const portRegistry = getPortRegistry();

    // Clean up any stale entries first
    await portRegistry.cleanupStaleEntries();

    // Look for the backend service
    const backendInfo = await portRegistry.getService('backend');

    if (backendInfo) {
      return {
        host: backendInfo.host || 'localhost',
        port: backendInfo.port
      };
    }

    return null;
  } catch (error) {
    // Silently fail - will fall back to defaults
    console.warn('Could not discover backend from registry:', error.message);
    return null;
  }
}

/**
 * Start the Terminal UI
 * @param {Object} options - Configuration options
 * @param {string} options.host - Backend host (default: localhost)
 * @param {number} options.port - Backend port (default: 8080)
 * @returns {Object} - Ink instance with waitUntilExit method
 */
export function startTerminalUI(options = {}) {
  const { host = 'localhost', port = 8080 } = options;

  // Render the Layout component
  const { waitUntilExit, unmount, clear } = render(
    React.createElement(Layout, { host, port })
  );

  // Handle graceful shutdown
  const cleanup = () => {
    try {
      clear();
      unmount();
    } catch (error) {
      // Ignore cleanup errors
    }
  };

  // Register cleanup handlers
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  process.on('exit', () => {
    cleanup();
  });

  // Return the Ink instance for external control
  return {
    waitUntilExit,
    unmount,
    clear,
    cleanup,
  };
}

/**
 * Start Terminal UI with automatic backend discovery
 * @param {Object} options - Configuration options
 * @param {string} [options.host] - Backend host (optional, will discover if not provided)
 * @param {number} [options.port] - Backend port (optional, will discover if not provided)
 * @returns {Promise<Object>} - Ink instance with waitUntilExit method
 */
export async function startTerminalUIWithDiscovery(options = {}) {
  let { host, port } = options;

  // If no port specified, try to discover from registry
  if (!port) {
    const discovered = await discoverBackend();

    if (discovered) {
      host = discovered.host;
      port = discovered.port;
      console.log(`Discovered backend at ${host}:${port}`);
    } else {
      // Fall back to defaults
      host = host || 'localhost';
      port = 8080;
      console.log(`No backend found in registry, using default ${host}:${port}`);
    }
  } else {
    host = host || 'localhost';
  }

  return startTerminalUI({ host, port });
}

/**
 * Main entry point when run directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  // Check for explicit env var override (backward compatibility)
  const envHost = process.env.LOXIA_HOST;
  const envPort = process.env.LOXIA_PORT ? parseInt(process.env.LOXIA_PORT, 10) : null;

  console.log(`Starting Loxia Terminal UI...`);

  // Main async function
  (async () => {
    let host, port;

    if (envPort) {
      // Use explicitly configured port
      host = envHost || 'localhost';
      port = envPort;
      console.log(`Using configured backend: ${host}:${port}`);
    } else {
      // Try to discover from registry
      const discovered = await discoverBackend();

      if (discovered) {
        host = discovered.host;
        port = discovered.port;
        console.log(`Discovered backend at ${host}:${port}`);
      } else {
        // Fall back to defaults
        host = envHost || 'localhost';
        port = 8080;
        console.log(`No backend found in registry, using default ${host}:${port}`);
      }
    }

    console.log(`Connecting to: ${host}:${port}`);
    console.log(`Press Ctrl+C to exit\n`);

    const instance = startTerminalUI({ host, port });

    // Wait for exit
    instance.waitUntilExit().then(() => {
      console.log('\nTerminal UI exited');
      process.exit(0);
    });
  })();
}

export default startTerminalUI;
