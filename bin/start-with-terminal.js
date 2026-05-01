#!/usr/bin/env node

/**
 * Launcher: Start Loxia server + Terminal UI together
 * Starts the server in background, then opens the Terminal UI
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Configuration
const SERVER_PORT = process.env.PORT || 8080;
const STARTUP_WAIT = 2000; // Wait 2 seconds for server to start

let serverProcess = null;

/**
 * Check if server is ready by attempting connection
 */
async function checkServerReady(maxAttempts = 10, interval = 500) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${SERVER_PORT}/health`, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Server returned ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });

      console.log('✅ Server is ready!');
      return true;
    } catch (err) {
      if (i < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
  }

  console.log('⚠️  Server may not be fully ready, but continuing anyway...');
  return false;
}

/**
 * Start the Loxia server in background
 */
async function startServer() {
  return new Promise((resolve) => {
    console.log('🚀 Starting Loxia server...');

    const serverScript = join(rootDir, 'src', 'index.js');

    serverProcess = spawn('node', [serverScript], {
      cwd: rootDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    // Capture server output
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[SERVER] ${output}`);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output && !output.includes('ExperimentalWarning')) {
        console.error(`[SERVER ERROR] ${output}`);
      }
    });

    serverProcess.on('error', (error) => {
      console.error('Failed to start server:', error.message);
      process.exit(1);
    });

    serverProcess.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        console.error(`Server exited with code ${code}`);
        process.exit(code);
      }
    });

    // Give server time to start
    setTimeout(resolve, STARTUP_WAIT);
  });
}

/**
 * Start the Terminal UI
 */
async function startTerminalUI() {
  console.log('🖥️  Starting Terminal UI...');
  console.log('');

  const terminalScript = join(rootDir, 'bin', 'loxia-terminal.js');

  const terminalProcess = spawn('node', [terminalScript], {
    cwd: rootDir,
    env: { ...process.env },
    stdio: 'inherit', // Terminal UI needs full terminal control
  });

  terminalProcess.on('error', (error) => {
    console.error('Failed to start Terminal UI:', error.message);
    cleanup();
    process.exit(1);
  });

  terminalProcess.on('exit', (code) => {
    console.log('\n👋 Terminal UI closed.');
    cleanup();
    process.exit(code || 0);
  });

  return terminalProcess;
}

/**
 * Cleanup: Stop server when exiting
 */
function cleanup() {
  if (serverProcess && !serverProcess.killed) {
    console.log('🛑 Stopping server...');
    serverProcess.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    }, 5000);
  }
}

/**
 * Handle process termination
 */
process.on('SIGINT', () => {
  console.log('\n⚠️  Received SIGINT, shutting down...');
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Received SIGTERM, shutting down...');
  cleanup();
  process.exit(0);
});

process.on('exit', () => {
  cleanup();
});

/**
 * Main launcher
 */
async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Loxia AI Agents - Server + Terminal UI      ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log('');

  try {
    // Start server
    await startServer();

    // Wait for server to be ready
    await checkServerReady();

    // Start Terminal UI
    await startTerminalUI();

    // Keep process alive
    await new Promise(() => {});

  } catch (error) {
    console.error('Error during startup:', error.message);
    cleanup();
    process.exit(1);
  }
}

main();
