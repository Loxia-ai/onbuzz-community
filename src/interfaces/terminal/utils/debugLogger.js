/**
 * Debug Logger
 * Logs to file instead of console to avoid corrupting Ink UI
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '../../../../debug-terminal-ui.log');

// Clear log file on startup
try {
  fs.writeFileSync(LOG_FILE, `=== Terminal UI Debug Log - ${new Date().toISOString()} ===\n`);
} catch (err) {
  // Silently fail if we can't create log file
}

/**
 * Log a debug message to file
 */
export function debugLog(component, message, data = null) {
  try {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${component}] ${message}`;

    if (data !== null && data !== undefined) {
      if (typeof data === 'object') {
        logLine += ` ${JSON.stringify(data)}`;
      } else {
        logLine += ` ${data}`;
      }
    }

    logLine += '\n';

    fs.appendFileSync(LOG_FILE, logLine);
  } catch (err) {
    // Silently fail - don't break the app if logging fails
  }
}

export default debugLog;
