#!/usr/bin/env node
/**
 * Cleanup duplicate "Quick Send" agents on the local OnBuzz install.
 *
 * Why this exists
 * ---------------
 * The pre-refactor Quick Send code path only checked the in-memory
 * agent pool when looking up "the Quick Send agent". When the user
 * drove OnBuzz exclusively via the browser extension (no UI session
 * firing RESUME_SESSION to populate the pool), the lookup missed the
 * persisted agent and created a fresh one — leaving a stack of
 * duplicate "Quick Send" entries in agent-index.json over time.
 *
 * The current backend (commit 77ca937 onward, with the cleanup helper
 * in src/interfaces/quickSendCleanup.js) consolidates duplicates on
 * every POST and prevents new ones from accumulating. This script is
 * the one-time mop-up for installs that built up a backlog BEFORE
 * the cleanup helper landed — run it once with the OnBuzz server
 * stopped, and you should never need it again.
 *
 * What it does
 * ------------
 *   1. Reads `<userData>/state/agent-index.json`.
 *   2. Lists every entry where name === "Quick Send".
 *   3. Picks a canonical winner: most-recently-active.
 *   4. Asks you to confirm before deleting anything.
 *   5. On YES: removes every other Quick Send entry from the index,
 *      then unlinks its `agents/agent-<id>-state.json` and
 *      `agents/agent-<id>-conversations.json` sidecar files.
 *
 * Safety
 * ------
 *   - Touches only entries with `name === "Quick Send"` (exact match).
 *   - Dry-runs by default — prints what would happen and exits 0.
 *   - Pass `--apply` (or answer YES at the prompt in interactive mode)
 *     to actually delete.
 *   - Per-file unlink errors are warned but never throw — a missing
 *     sidecar from a half-finished prior delete won't abort the run.
 *   - Idempotent: rerun any time, second run sees one Quick Send and
 *     reports nothing to do.
 *
 * Where the data lives (matches src/utilities/userDataDir.js):
 *   - macOS:   ~/Library/Application Support/loxia-autopilot/state
 *   - Linux:   $XDG_DATA_HOME/loxia-autopilot/state  (or ~/.local/share/...)
 *   - Windows: %LOCALAPPDATA%/loxia-autopilot/state
 *   - Override via LOXIA_DATA_DIR env var (same as the server).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

const QUICK_SEND_NAME = 'Quick Send';

function resolveStateDir() {
  if (process.env.LOXIA_DATA_DIR) {
    return path.join(process.env.LOXIA_DATA_DIR, 'state');
  }
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'loxia-autopilot', 'state');
    case 'win32':
      return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
                       'loxia-autopilot', 'state');
    default: {
      const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
      return path.join(xdg, 'loxia-autopilot', 'state');
    }
  }
}

async function loadIndex(indexPath) {
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`could not read ${indexPath}: ${err.message}`);
  }
}

async function saveIndex(indexPath, index) {
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
}

async function unlinkIgnoreMissing(p) {
  try {
    await fs.unlink(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

function pickCanonical(quickSendEntries) {
  // Most-recently-active wins; ties broken by id (stable).
  return [...quickSendEntries].sort((a, b) => {
    const ta = new Date(a.entry.lastActivity || 0).getTime();
    const tb = new Date(b.entry.lastActivity || 0).getTime();
    if (ta !== tb) return tb - ta;
    return a.id.localeCompare(b.id);
  })[0];
}

function fmt(c) {
  return `${c.id.padEnd(40)}  model=${(c.entry.model || '<unset>').padEnd(28)}  lastActivity=${c.entry.lastActivity || '<never>'}`;
}

async function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (ans) => { rl.close(); resolve(ans); }));
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const yes = args.includes('--yes');

  const stateDir = resolveStateDir();
  const indexPath = path.join(stateDir, 'agent-index.json');

  console.log(`State dir: ${stateDir}`);
  console.log(`Index file: ${indexPath}`);
  console.log('');

  const index = await loadIndex(indexPath);
  const allQuickSend = Object.entries(index)
    .filter(([, v]) => v && v.name === QUICK_SEND_NAME)
    .map(([id, entry]) => ({ id, entry }));

  console.log(`Found ${allQuickSend.length} Quick Send agent(s) in the index.`);
  if (allQuickSend.length === 0) {
    console.log('Nothing to do.');
    return;
  }
  if (allQuickSend.length === 1) {
    console.log(`Only one Quick Send agent exists. No cleanup needed.`);
    console.log(`  ${fmt(allQuickSend[0])}`);
    return;
  }

  const canonical = pickCanonical(allQuickSend);
  const toRemove = allQuickSend.filter((c) => c.id !== canonical.id);

  console.log('');
  console.log(`Canonical (will be KEPT):`);
  console.log(`  ${fmt(canonical)}`);
  console.log('');
  console.log(`Duplicates (will be REMOVED):  (${toRemove.length} agent(s), plus their sidecar files)`);
  for (const c of toRemove) {
    console.log(`  ${fmt(c)}`);
    if (c.entry.stateFile)        console.log(`    state         ${path.join(stateDir, c.entry.stateFile)}`);
    if (c.entry.conversationsFile) console.log(`    conversations ${path.join(stateDir, c.entry.conversationsFile)}`);
  }

  if (!apply) {
    console.log('');
    console.log('Dry run only. Re-run with --apply to delete, or --apply --yes to skip the prompt.');
    return;
  }

  if (!yes) {
    const ans = await ask('Type YES to confirm deletion: ');
    if (ans !== 'YES') {
      console.log('Aborted.');
      return;
    }
  }

  let removed = 0;
  let filesGone = 0;
  let warnings = 0;

  // Remove from index in one pass first, then unlink the sidecar files.
  for (const c of toRemove) delete index[c.id];
  await saveIndex(indexPath, index);

  for (const c of toRemove) {
    for (const rel of [c.entry.stateFile, c.entry.conversationsFile]) {
      if (!rel) continue;
      const p = path.join(stateDir, rel);
      try {
        const wasThere = await unlinkIgnoreMissing(p);
        if (wasThere) filesGone++;
      } catch (err) {
        console.warn(`  warn: unlink ${p} failed: ${err.message}`);
        warnings++;
      }
    }
    removed++;
  }

  console.log('');
  console.log(`Done.  Removed ${removed} agent(s) from the index.  Unlinked ${filesGone} sidecar file(s).` +
              (warnings > 0 ? `  ${warnings} warning(s).` : ''));
  console.log(`Canonical kept: ${canonical.id}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
