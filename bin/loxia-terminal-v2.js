#!/usr/bin/env node

/**
 * OnBuzz Terminal UI Launcher (Ink-based)
 * Cross-platform compatible including Windows
 */

import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

// Configuration
const DEFAULT_PORT = 8080;
const DEFAULT_HOST = 'localhost';
const SERVER_STARTUP_TIMEOUT = 10000;

/**
 * Check if server is running
 */
async function isServerRunning(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * Start the OnBuzz server
 */
async function startServer(host, port) {
  console.log('🚀 Starting OnBuzz server...');

  return new Promise((resolve, reject) => {
    const serverProcess = spawn('node', [
      path.join(projectRoot, 'bin/cli.js'),
      '--ui', 'web',
      '--host', host,
      '--port', port.toString()
    ], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', () => {
      // Silently consume
    });

    serverProcess.stderr.on('data', () => {
      // Silently consume
    });

    serverProcess.on('error', (error) => {
      console.error('Failed to start server:', error.message);
      reject(error);
    });

    // Wait for server to start
    const startTime = Date.now();
    const checkInterval = setInterval(async () => {
      const running = await isServerRunning(host, port);

      if (running) {
        clearInterval(checkInterval);
        console.log(`✓ Server started at ${host}:${port}`);
        resolve();
      } else if (Date.now() - startTime > SERVER_STARTUP_TIMEOUT) {
        clearInterval(checkInterval);
        serverProcess.kill();
        reject(new Error('Server startup timeout'));
      }
    }, 500);
  });
}

/**
 * Main entry point
 */
async function main() {
  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  OnBuzz Community - Terminal UI');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    // Parse command line arguments
    const args = process.argv.slice(2);
    let host = DEFAULT_HOST;
    let port = DEFAULT_PORT;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--host' && args[i + 1]) {
        host = args[i + 1];
        i++;
      } else if (args[i] === '--port' && args[i + 1]) {
        port = parseInt(args[i + 1], 10);
        i++;
      }
    }

    // Check if server is running
    console.log(`🔍 Checking if server is running at ${host}:${port}...`);
    const serverRunning = await isServerRunning(host, port);

    if (!serverRunning) {
      console.log('✗ Server is not running');
      await startServer(host, port);
    } else {
      console.log(`✓ Server is already running at ${host}:${port}`);
    }

    console.log('');
    console.log('🎨 Launching Ink-based Terminal UI...');
    console.log('');

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Set environment variables for Ink app
    process.env.LOXIA_HOST = host;
    process.env.LOXIA_PORT = port.toString();

    // Launch Terminal UI
    await import('../src/interfaces/terminal/index.js');

  } catch (error) {
    console.error('');
    console.error('❌ Failed to start Terminal UI:');
    console.error('  ', error.message);
    console.error('');
    console.error('💡 Troubleshooting:');
    console.error('   1. Make sure no other process is using port 8080');
    console.error('   2. Try running the server manually: node bin/cli.js');
    console.error('   3. Check logs for more details');
    console.error('');
    process.exit(1);
  }
}

// Run
main();
