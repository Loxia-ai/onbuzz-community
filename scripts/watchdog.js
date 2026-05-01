#!/usr/bin/env node
/**
 * Watchdog Script - External process for restarting Loxia Autopilot
 *
 * This script is spawned as an independent process before the main Loxia
 * process terminates. It waits for the specified delay, then restarts
 * Loxia using the configured command.
 *
 * Usage:
 *   node watchdog.js [options]
 *
 * Options:
 *   --delay <ms>      Delay before restart in milliseconds (default: 5000)
 *   --command <cmd>   Command to run (default: "loxia web")
 *   --pid <pid>       Parent PID to wait for (optional)
 *
 * Examples:
 *   node watchdog.js --delay 3000 --command "loxia web"
 *   node watchdog.js --command "npx @loxia-labs/loxia-autopilot-one web"
 *   node watchdog.js --delay 5000 --command "loxia web --port 3000"
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Log to file for debugging (since stdio might be ignored)
// Use script directory for reliable location
const logFile = path.join(__dirname, 'watchdog.log');
function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  console.log(message);
  try {
    fs.appendFileSync(logFile, line);
  } catch (e) {
    // Ignore file write errors
  }
}

// Log startup immediately
log('[Watchdog] Script loaded');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    delay: 5000,
    command: 'loxia web',
    pid: null
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--delay':
        options.delay = parseInt(args[++i], 10) || 5000;
        break;
      case '--command':
        options.command = args[++i] || 'loxia web';
        break;
      case '--pid':
        options.pid = parseInt(args[++i], 10) || null;
        break;
    }
  }

  return options;
}

// Check if a process is still running
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

// Wait for parent process to terminate (optional)
async function waitForParentExit(pid, timeout = 30000) {
  if (!pid) return;

  const startTime = Date.now();

  while (isProcessRunning(pid)) {
    if (Date.now() - startTime > timeout) {
      log(`[Watchdog] Parent process ${pid} still running after ${timeout}ms, proceeding anyway`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  log(`[Watchdog] Parent process ${pid} has terminated`);
}

// Main execution
async function main() {
  const options = parseArgs();

  log(`[Watchdog] Started with options:`, {
    delay: options.delay,
    command: options.command,
    pid: options.pid
  });

  // Wait for parent to exit if PID provided
  if (options.pid) {
    log(`[Watchdog] Waiting for parent process ${options.pid} to exit...`);
    await waitForParentExit(options.pid);
  }

  // Wait for configured delay
  log(`[Watchdog] Waiting ${options.delay}ms before restart...`);
  await new Promise(resolve => setTimeout(resolve, options.delay));

  // Parse command and arguments
  const parts = options.command.split(' ');
  const cmd = parts[0];
  const args = parts.slice(1);

  log(`[Watchdog] Executing: ${cmd} ${args.join(' ')}`);

  // Spawn the new process
  // Use shell on all platforms for proper resolution of npm global commands (like 'loxia')
  const isWindows = process.platform === 'win32';

  const child = spawn(cmd, args, {
    detached: true,
    stdio: 'ignore',   // Ignore stdio - Loxia web server will be accessible via browser
    shell: true,       // Use shell for command resolution (npm globals, PATH, etc.)
    windowsHide: false // Show console on Windows so user knows it's running
  });

  child.unref();

  log(`[Watchdog] Loxia restarted with PID ${child.pid}`);
  log(`[Watchdog] Watchdog exiting...`);

  // Give the child process a moment to start
  setTimeout(() => process.exit(0), 1000);
}

main().catch(error => {
  log(`[Watchdog] Error: ${error.message}`);
  process.exit(1);
});
