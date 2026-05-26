#!/usr/bin/env node

/**
 * OnBuzz Community - CLI Entry Point
 *
 * Commands:
 *   onbuzz web            - Start server (serves Web UI) + open browser
 *   onbuzz serve          - Start server only (no UI)
 *   onbuzz terminal       - Start Terminal UI only (server must be running)
 *   onbuzz plus-web       - Alias for 'web'
 *   onbuzz plus-terminal  - Start server (background) + Terminal UI (foreground)
 *   onbuzz trigger-schedule <id> - Trigger a scheduled task (wakes server if needed)
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default configuration
const DEFAULT_PORT = 8080;
// Use 127.0.0.1 instead of 'localhost' to avoid IPv6 issues in WSL2
const DEFAULT_HOST = '127.0.0.1';
const SERVER_STARTUP_TIMEOUT = 15000;
const SERVER_CHECK_INTERVAL = 500;

// Parse CLI arguments
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : null;
const flags = {
  port: null,
  host: null,
  help: args.includes('--help') || args.includes('-h'),
  version: args.includes('--version') || args.includes('-v')
};

// Extract port and host if provided
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    flags.port = parseInt(args[i + 1], 10);
  }
  if (args[i] === '--host' && args[i + 1]) {
    flags.host = args[i + 1];
  }
}

// Only use default port if explicitly specified, otherwise let server choose
const explicitPort = flags.port;
const host = flags.host || DEFAULT_HOST;

// Resolve brand info (binName, productName, docsUrl) from THIS install's
// package.json. The same source code ships as two npm packages — autopilot
// (`loxia` bin) and onbuzz (`onbuzz` bin). Each install's package.json
// identifies which one we are, so all banner / help / version text is
// derived rather than hardcoded.
function _resolveBrand() {
  const pkgPath = join(__dirname, '..', 'package.json');
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { /* fall through to defaults */ }
  return {
    binName:     'onbuzz',
    productName: 'OnBuzz Community',
    docsUrl:     'https://github.com/Loxia-ai/onbuzz-community',
    version:     pkg.version || '0.0.0',
  };
}
const BRAND = _resolveBrand();

// Show version
if (flags.version) {
  console.log(`${BRAND.productName} v${BRAND.version}`);
  process.exit(0);
}

// Show help
if (flags.help || !command) {
  const bin = BRAND.binName;
  console.log(`
${BRAND.productName} v${BRAND.version} - AI Agent System

Usage:
  ${bin} <command> [options]

Commands:
  web                       Start server + open Web UI in browser
  serve                     Start server only (no UI opened)
  terminal                  Start Terminal UI (server must be running)
  plus-web                  Alias for 'web'
  plus-terminal             Start server + Terminal UI together
  trigger-schedule <id>     Trigger a scheduled task (wakes server if needed)

Options:
  --port <number>   Specify port (default: auto-select starting from ${DEFAULT_PORT})
  --host <host>     Specify host (default: ${DEFAULT_HOST})
  -h, --help        Show this help message
  -v, --version     Show version number

Examples:
  ${bin} web                # Start server + open browser
  ${bin} serve              # Start server only (headless)
  ${bin} terminal           # Connect Terminal UI to running server
  ${bin} plus-terminal      # Start server + Terminal UI
  ${bin} web --port 3000    # Use specific port

Quick Start:
  1. Run '${bin} web' to start with Web UI
  2. Or run '${bin} plus-terminal' for Terminal UI experience
  3. Or run '${bin} serve' for headless server (connect remotely)

Note: If no port is specified, the server will automatically find
an available port. The Terminal UI will discover the server port
automatically from the port registry.

Documentation:
  ${BRAND.docsUrl}

`);
  process.exit(0);
}

/**
 * Dynamically import the port registry
 */
async function getPortRegistry() {
  const { getPortRegistry } = await import('../src/services/portRegistry.js');
  return getPortRegistry();
}

/**
 * Discover backend from port registry
 * @returns {Promise<{host: string, port: number}|null>}
 */
async function discoverBackend() {
  try {
    const portRegistry = await getPortRegistry();
    await portRegistry.cleanupStaleEntries();
    const backendInfo = await portRegistry.getService('backend');

    if (backendInfo) {
      return {
        host: backendInfo.host || 'localhost',
        port: backendInfo.port,
        pid: backendInfo.pid
      };
    }
    return null;
  } catch (error) {
    // Registry may not exist yet
    return null;
  }
}

/**
 * Check if server is running at the specified host:port
 */
async function checkServerRunning(host, port, maxAttempts = 1) {
  for (let i = 0; i < maxAttempts; i++) {
    const isRunning = await new Promise((resolve) => {
      const req = http.get(`http://${host}:${port}/api/health`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    });

    if (isRunning) return true;

    if (i < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, SERVER_CHECK_INTERVAL));
    }
  }
  return false;
}

/**
 * Wait for server to become ready by polling the port registry
 * @returns {Promise<{host: string, port: number}|null>}
 */
async function waitForServerWithDiscovery(timeout = SERVER_STARTUP_TIMEOUT) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Try to discover backend from registry
    const backend = await discoverBackend();

    if (backend) {
      // Verify with health check
      const isHealthy = await checkServerRunning(backend.host, backend.port);
      if (isHealthy) {
        return backend;
      }
    }

    await new Promise(resolve => setTimeout(resolve, SERVER_CHECK_INTERVAL));
  }

  return null;
}

/**
 * Wait for server at specific port (when port is explicitly specified)
 */
async function waitForServerAtPort(host, port, timeout = SERVER_STARTUP_TIMEOUT) {
  const maxAttempts = Math.ceil(timeout / SERVER_CHECK_INTERVAL);
  const isReady = await checkServerRunning(host, port, maxAttempts);
  return isReady ? { host, port } : null;
}

/**
 * Open URL in default browser
 * Uses spawn instead of exec for better security (no shell interpolation)
 */
function openBrowser(url) {
  let cmd, args;

  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  const child = spawn(cmd, args, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  child.on('error', () => {
    console.log(`Could not open browser automatically.`);
    console.log(`Please open manually: ${url}`);
  });
}

/**
 * Start the backend server
 * @param {boolean} silent - If true, suppress server output
 * @returns {ChildProcess}
 */
function startServer(silent = false) {
  const env = { ...process.env };

  // Only set port environment variables if explicitly specified
  // Otherwise, let the server dynamically allocate a port
  if (explicitPort) {
    env.LOXIA_PORT = explicitPort.toString();
    env.PORT = explicitPort.toString();
  }

  if (flags.host) {
    env.LOXIA_HOST = flags.host;
  }

  const mainScript = join(__dirname, '..', 'src', 'index.js');

  const child = spawn('node', [mainScript], {
    cwd: join(__dirname, '..'),
    env,
    stdio: silent ? ['ignore', 'ignore', 'ignore'] : 'inherit',
    detached: silent
  });

  if (silent) {
    child.unref();
  }

  return child;
}

/**
 * Start Terminal UI with discovered port
 */
function startTerminalUIProcess(discoveredHost, discoveredPort) {
  const terminalScript = join(__dirname, 'loxia-terminal.js');

  const env = {
    ...process.env,
    LOXIA_PORT: discoveredPort.toString(),
    LOXIA_HOST: discoveredHost
  };

  const child = spawn('node', [terminalScript], {
    cwd: join(__dirname, '..'),
    env,
    stdio: 'inherit'
  });

  return child;
}

// Command handlers
const commands = {
  // 'web' and 'plus-web': Start server + open browser
  'web': async () => {
    console.log(`Starting ${BRAND.productName} server...\n`);

    const serverProcess = startServer(false);

    // Wait for server to be ready
    console.log('Waiting for server to start...');

    let backend;
    if (explicitPort) {
      backend = await waitForServerAtPort(host, explicitPort);
    } else {
      backend = await waitForServerWithDiscovery();
    }

    if (backend) {
      const serverUrl = `http://${backend.host}:${backend.port}`;
      console.log(`\nOpening Web UI at ${serverUrl}`);
      openBrowser(serverUrl);
    } else {
      console.log(`\nServer may still be starting. Check the port registry or logs.`);
    }

    // Forward signals
    process.on('SIGINT', () => serverProcess.kill('SIGINT'));
    process.on('SIGTERM', () => serverProcess.kill('SIGTERM'));

    serverProcess.on('exit', (code) => process.exit(code || 0));
  },

  'plus-web': async () => {
    // Alias for 'web'
    await commands['web']();
  },

  // 'serve': Start server only (no UI)
  'serve': async () => {
    console.log(`Starting ${BRAND.productName} server...\n`);

    const serverProcess = startServer(false);

    // Wait for server to be ready
    console.log('Waiting for server to start...');

    let backend;
    if (explicitPort) {
      backend = await waitForServerAtPort(host, explicitPort);
    } else {
      backend = await waitForServerWithDiscovery();
    }

    if (backend) {
      const serverUrl = `http://${backend.host}:${backend.port}`;
      console.log(`\n✓ Server running at ${serverUrl}`);
      console.log(`\n  Web UI:       ${serverUrl}`);
      console.log(`  Terminal UI:  ${BRAND.binName} terminal`);
      console.log(`  API Health:   ${serverUrl}/api/health\n`);
    } else {
      console.log(`\nServer started but may still be initializing.`);
      console.log(`Run '${BRAND.binName} terminal' to connect when ready.`);
    }

    // Forward signals for graceful shutdown
    process.on('SIGINT', () => serverProcess.kill('SIGINT'));
    process.on('SIGTERM', () => serverProcess.kill('SIGTERM'));

    serverProcess.on('exit', (code) => process.exit(code || 0));
  },

  // 'terminal': Start Terminal UI only (server must be running)
  'terminal': async () => {
    console.log('Looking for running server...');

    // First try to discover from registry
    let backend = await discoverBackend();

    // If explicit port specified, use that instead
    if (explicitPort) {
      backend = { host, port: explicitPort };
    }

    if (!backend) {
      console.error(`\nNo running server found in the port registry.`);
      console.error('\nPlease start the server first:');
      console.error(`  ${BRAND.binName} web            # Start server + Web UI`);
      console.error(`  ${BRAND.binName} serve          # Start server only`);
      console.error(`  ${BRAND.binName} plus-terminal  # Start server + Terminal UI\n`);
      process.exit(1);
    }

    // Verify server is actually running
    const isRunning = await checkServerRunning(backend.host, backend.port);

    if (!isRunning) {
      console.error(`\nServer registered at ${backend.host}:${backend.port} but not responding.`);
      console.error('It may have crashed. Please restart it.');
      process.exit(1);
    }

    console.log(`Server discovered at ${backend.host}:${backend.port}`);
    console.log('Starting Terminal UI...\n');

    const terminalProcess = startTerminalUIProcess(backend.host, backend.port);

    process.on('SIGINT', () => terminalProcess.kill('SIGINT'));
    process.on('SIGTERM', () => terminalProcess.kill('SIGTERM'));

    terminalProcess.on('exit', (code) => process.exit(code || 0));
  },

  // 'plus-terminal': Start server (silent background) + Terminal UI (foreground)
  'plus-terminal': async () => {
    console.log(`Starting ${BRAND.productName} server in background...`);

    // Start server silently in background
    const serverProcess = startServer(true);

    // Wait for server to be ready
    let backend;
    if (explicitPort) {
      backend = await waitForServerAtPort(host, explicitPort);
    } else {
      backend = await waitForServerWithDiscovery();
    }

    if (!backend) {
      console.error('\nServer failed to start. Please check logs.');
      process.exit(1);
    }

    console.log(`Server running at http://${backend.host}:${backend.port}`);
    console.log('Starting Terminal UI...\n');

    const terminalProcess = startTerminalUIProcess(backend.host, backend.port);

    // When Terminal UI exits, also kill the server
    terminalProcess.on('exit', (code) => {
      console.log('\nShutting down server...');

      // Try to kill the server process
      try {
        process.kill(serverProcess.pid, 'SIGTERM');
      } catch (e) {
        // Server may have already exited
      }

      process.exit(code || 0);
    });

    process.on('SIGINT', () => {
      terminalProcess.kill('SIGINT');
    });

    process.on('SIGTERM', () => {
      terminalProcess.kill('SIGTERM');
    });
  },

  // 'trigger-schedule': Trigger a scheduled task, waking server if needed
  'trigger-schedule': async () => {
    const scheduleId = args[1];
    if (!scheduleId) {
      console.error(`Usage: ${BRAND.binName} trigger-schedule <schedule-id>`);
      process.exit(1);
    }

    // Try to find a running server
    let backend = await discoverBackend();
    let weStartedServer = false;

    if (backend) {
      const isRunning = await checkServerRunning(backend.host, backend.port);
      if (!isRunning) backend = null;
    }

    if (!backend) {
      // No running server — wake one up silently
      console.log(`No running server found. Starting ${BRAND.productName} in background...`);
      startServer(true);
      weStartedServer = true;

      // Wait for it to come up
      if (explicitPort) {
        backend = await waitForServerAtPort(host, explicitPort, 30000);
      } else {
        backend = await waitForServerWithDiscovery(30000);
      }

      if (!backend) {
        console.error('Failed to start server within 30s. Check logs.');
        process.exit(1);
      }
      console.log(`Server started at ${backend.host}:${backend.port}`);
    }

    // Trigger the schedule via API
    const triggerUrl = `http://${backend.host}:${backend.port}/api/schedules/${encodeURIComponent(scheduleId)}/trigger`;

    try {
      const result = await new Promise((resolve, reject) => {
        const postData = JSON.stringify({});
        const req = http.request(triggerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error(`Invalid response: ${data}`));
            }
          });
        });
        req.on('error', reject);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timed out')); });
        req.write(postData);
        req.end();
      });

      if (result.success) {
        console.log(`Schedule "${result.scheduleName || scheduleId}" triggered successfully.`);
      } else {
        console.error(`Failed to trigger schedule: ${result.error}`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`Failed to trigger schedule: ${err.message}`);
      process.exit(1);
    }

    // If we started the server, set idle shutdown timer
    if (weStartedServer) {
      const idleUrl = `http://${backend.host}:${backend.port}/api/system/idle-shutdown`;
      try {
        const postData = JSON.stringify({ timeoutMinutes: 10 });
        await new Promise((resolve) => {
          const req = http.request(idleUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
          }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
          req.on('error', resolve); // Non-critical, ignore errors
          req.write(postData);
          req.end();
        });
      } catch {
        // Non-critical
      }
    }

    process.exit(0);
  }
};

// Execute command
if (commands[command]) {
  commands[command]().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${command}`);
  console.error(`Run "${BRAND.binName} --help" for usage information.`);
  process.exit(1);
}
