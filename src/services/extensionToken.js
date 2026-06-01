/**
 * Extension Token — shared local secret for the OnBuzz browser extension.
 *
 * The /api/chat/quick-send endpoint requires this token in the
 * X-OnBuzz-Token header. Without it, any web page the user visits could
 * silently POST to localhost and inject messages into agents, because we
 * deliberately keep wildcard CORS for the rest of the local-only API.
 *
 * Resolution order:
 *   1. ONBUZZ_EXTENSION_TOKEN env var (preferred for headless/CI setups).
 *   2. <userDataPaths.settings>/extension-token.json — auto-generated on
 *      first call and persisted (mode 0600) so the user can copy it into
 *      the extension's options page once.
 *
 * We do NOT echo the token to logs anywhere.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { getUserDataPaths, ensureUserDataDirs } from '../utilities/userDataDir.js';

const TOKEN_FILE = 'extension-token.json';
const TOKEN_BYTES = 32;

let cachedToken = null;

function generateToken() {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

function tokenFilePath() {
  return path.join(getUserDataPaths().settings, TOKEN_FILE);
}

async function readPersistedToken() {
  try {
    const raw = await fs.readFile(tokenFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === 'string' && parsed.token.length >= 32) {
      return parsed.token;
    }
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writePersistedToken(token) {
  await ensureUserDataDirs();
  const file = tokenFilePath();
  const payload = JSON.stringify({
    token,
    createdAt: new Date().toISOString(),
    note: 'OnBuzz browser-extension token. Paste into the extension options page. Delete this file to rotate.'
  }, null, 2);
  await fs.writeFile(file, payload, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.chmod(file, 0o600);
  } catch {
    // Best-effort on platforms that don't honour mode in writeFile.
  }
}

/**
 * Resolve the active extension token. Generates and persists one on
 * first call if no env var is set and no token file exists.
 * @returns {Promise<{ token: string, source: 'env' | 'file' | 'generated', filePath: string }>}
 */
export async function getExtensionToken() {
  if (process.env.ONBUZZ_EXTENSION_TOKEN) {
    return {
      token: process.env.ONBUZZ_EXTENSION_TOKEN,
      source: 'env',
      filePath: tokenFilePath()
    };
  }

  if (cachedToken) {
    return { token: cachedToken, source: 'file', filePath: tokenFilePath() };
  }

  const existing = await readPersistedToken();
  if (existing) {
    cachedToken = existing;
    return { token: existing, source: 'file', filePath: tokenFilePath() };
  }

  const fresh = generateToken();
  await writePersistedToken(fresh);
  cachedToken = fresh;
  return { token: fresh, source: 'generated', filePath: tokenFilePath() };
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Constant-time check that the presented token matches the active one.
 * @param {string | undefined | null} presented
 * @returns {Promise<boolean>}
 */
export async function verifyExtensionToken(presented) {
  if (!presented || typeof presented !== 'string') return false;
  const { token } = await getExtensionToken();
  return timingSafeEqualStr(presented, token);
}

export const __test = { tokenFilePath };
