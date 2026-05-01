#!/usr/bin/env node
/**
 * audit-report.js — run `npm audit --json` against each workspace, classify
 * the findings via src/utilities/auditReport.js, and write a markdown report.
 *
 * Usage:
 *   node scripts/audit-report.js                       # default: root + web-ui, stdout markdown
 *   node scripts/audit-report.js --out=FILE.md         # also write to file
 *   node scripts/audit-report.js --scope=root          # only root
 *   node scripts/audit-report.js --scope=web-ui        # only web-ui
 *   node scripts/audit-report.js --fail-on=high        # exit 1 when high+critical remain
 *   node scripts/audit-report.js --fail-on=none        # never fail (informational)
 *   node scripts/audit-report.js --silent              # no stdout (use with --out)
 *
 * Exit codes:
 *   0 — no findings at or above --fail-on severity (default: high)
 *   1 — findings at or above --fail-on severity
 *   2 — something went wrong invoking `npm audit`
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  classifyAudit,
  renderMarkdown,
  shouldFail,
} from '../src/utilities/auditReport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ────────────────────────────────────────────────────────────────────────
// CLI arg parsing — intentionally minimal, no deps.
// ────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    scope: 'all',          // 'root' | 'web-ui' | 'all'
    out: null,             // optional output file path
    failOn: 'high',        // 'critical' | 'high' | 'moderate' | 'low' | 'none'
    silent: false,
  };
  for (const arg of argv.slice(2)) {
    const [key, val] = arg.split('=');
    switch (key) {
      case '--scope':   opts.scope  = val || 'all'; break;
      case '--out':     opts.out    = val || null;  break;
      case '--fail-on': opts.failOn = val || 'high'; break;
      case '--silent':  opts.silent = true;         break;
      case '--help':
      case '-h':
        console.log(fs.readFileSync(__filename, 'utf-8')
          .split('\n').slice(2, 18).map(s => s.replace(/^ \* ?/, '')).join('\n'));
        process.exit(0);
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown flag: ${arg}`);
          process.exit(2);
        }
    }
  }
  return opts;
}

// ────────────────────────────────────────────────────────────────────────
// Run `npm audit --json` in a directory and parse.
// Returns { ok: true, data } on success, { ok: false, error } on failure.
// `npm audit` exits non-zero when vulns exist — that's NOT a failure here;
// we still want to parse the JSON output and classify. Only actual spawn
// errors or malformed JSON are treated as failures.
// ────────────────────────────────────────────────────────────────────────

function runAudit(cwd) {
  // Windows: `npm` resolves to `npm.cmd` which requires shell=true on Node
  // 20+ (CVE-2024-27980 hardening). POSIX is fine without a shell — cheaper
  // spawn and avoids shell-escaping surprises.
  const isWin = process.platform === 'win32';
  const res = spawnSync(isWin ? 'npm.cmd' : 'npm', ['audit', '--json'], {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,  // 32 MB — big trees can produce long JSON
    shell: isWin,
  });
  if (res.error) {
    return { ok: false, error: `spawn failed: ${res.error.message}` };
  }
  const stdout = res.stdout || '';
  if (!stdout.trim()) {
    return { ok: false, error: `empty output from npm audit (exit ${res.status})` };
  }
  try {
    return { ok: true, data: JSON.parse(stdout) };
  } catch (err) {
    return { ok: false, error: `failed to parse npm audit JSON: ${err.message}` };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Workspace resolution
// ────────────────────────────────────────────────────────────────────────

function resolveWorkspaces(scope) {
  const root   = { label: 'root',   cwd: REPO_ROOT };
  const webUi  = { label: 'web-ui', cwd: path.join(REPO_ROOT, 'web-ui') };
  const list = [];
  if (scope === 'root' || scope === 'all') list.push(root);
  if (scope === 'web-ui' || scope === 'all') list.push(webUi);
  return list.filter(ws => {
    if (!fs.existsSync(path.join(ws.cwd, 'package.json'))) {
      console.error(`[audit-report] skipping ${ws.label} — no package.json at ${ws.cwd}`);
      return false;
    }
    return true;
  });
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv);
  const workspaces = resolveWorkspaces(opts.scope);
  if (workspaces.length === 0) {
    console.error('[audit-report] no workspaces to scan');
    process.exit(2);
  }

  const sections = [];
  let anyFailed = false;

  for (const ws of workspaces) {
    if (!opts.silent) console.error(`[audit-report] scanning ${ws.label}…`);
    const result = runAudit(ws.cwd);
    if (!result.ok) {
      console.error(`[audit-report] ${ws.label}: ${result.error}`);
      process.exit(2);
    }
    const classified = classifyAudit(result.data);
    const md = renderMarkdown(classified, { workspace: ws.label });
    sections.push(md);

    if (shouldFail(classified, opts.failOn)) anyFailed = true;
  }

  const fullReport = sections.join('\n\n---\n\n');

  if (opts.out) {
    fs.writeFileSync(path.resolve(opts.out), fullReport, 'utf-8');
    if (!opts.silent) console.error(`[audit-report] wrote ${opts.out}`);
  }

  if (!opts.silent) {
    // Print markdown to stdout for piping / direct viewing.
    process.stdout.write(fullReport + '\n');
  }

  process.exit(anyFailed ? 1 : 0);
}

main();
