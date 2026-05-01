#!/usr/bin/env node

/**
 * Loxia Terminal UI Launcher
 * Command-line interface for the terminal UI
 */

import { startTerminalUI } from '../src/interfaces/terminal/index.js';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  host: 'localhost',
  port: 8080,
};

// Simple argument parsing
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--host' || arg === '-h') {
    options.host = args[++i];
  } else if (arg === '--port' || arg === '-p') {
    options.port = parseInt(args[++i], 10);
  } else if (arg === '--help') {
    console.log(`
Loxia Terminal UI

Usage:
  loxia-terminal [options]

Options:
  --host, -h <host>    Backend host (default: localhost)
  --port, -p <port>    Backend port (default: 8080)
  --help               Show this help message

Environment Variables:
  LOXIA_HOST          Backend host
  LOXIA_PORT          Backend port

Examples:
  loxia-terminal
  loxia-terminal --host 192.168.1.100 --port 3000
  LOXIA_HOST=api.example.com LOXIA_PORT=443 loxia-terminal
`);
    process.exit(0);
  }
}

// Override with environment variables if set
if (process.env.LOXIA_HOST) {
  options.host = process.env.LOXIA_HOST;
}
if (process.env.LOXIA_PORT) {
  options.port = parseInt(process.env.LOXIA_PORT, 10);
}

// Check for TTY support
if (!process.stdin.isTTY) {
  console.error('ERROR: Terminal UI requires an interactive terminal (TTY).');
  console.error('');
  console.error('The terminal UI cannot run in:');
  console.error('  - Piped environments (e.g., | head, | grep)');
  console.error('  - Redirected output (e.g., > file.txt, 2>&1 | ...)');
  console.error('  - Background processes (e.g., & at the end)');
  console.error('  - Some CI/CD environments');
  console.error('');
  console.error('Please run this command in a real terminal without pipes or redirection:');
  console.error('  npm run terminal-ui');
  console.error('');
  console.error('Or use the web UI instead:');
  console.error('  npm start');
  process.exit(1);
}

// Start the Terminal UI
console.log(`Starting Loxia Terminal UI...`);
console.log(`Connecting to: ${options.host}:${options.port}`);
console.log(`Press Ctrl+C to exit\n`);

const instance = startTerminalUI(options);

// Wait for exit
instance.waitUntilExit().then(() => {
  console.log('\nTerminal UI exited');
  process.exit(0);
}).catch((error) => {
  console.error('\nTerminal UI error:', error);
  process.exit(1);
});
