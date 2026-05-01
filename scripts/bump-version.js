#!/usr/bin/env node
/**
 * Version Bump Script
 *
 * Bumps version across ALL files that track it, commits, tags, and pushes.
 *
 * Usage:
 *   node scripts/bump-version.js patch    → 3.6.0 → 3.6.1
 *   node scripts/bump-version.js minor    → 3.6.0 → 3.7.0
 *   node scripts/bump-version.js major    → 3.6.0 → 4.0.0
 *   node scripts/bump-version.js 3.8.0    → explicit version
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── All files that contain a version to sync ──────────────────────────────

const VERSION_FILES = [
  { file: 'package.json', key: 'version' },
  { file: 'package.autopilot.json', key: 'version' },
  { file: 'web-ui/package.json', key: 'version', independent: true },
];

// ─── Parse current version ─────────────────────────────────────────────────

function readVersion(relPath) {
  const full = path.join(ROOT, relPath);
  const pkg = JSON.parse(fs.readFileSync(full, 'utf8'));
  return pkg.version;
}

function writeVersion(relPath, newVersion) {
  const full = path.join(ROOT, relPath);
  const pkg = JSON.parse(fs.readFileSync(full, 'utf8'));
  const oldVersion = pkg.version;
  pkg.version = newVersion;
  fs.writeFileSync(full, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return oldVersion;
}

// ─── Bump logic ────────────────────────────────────────────────────────────

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);
  switch (type) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default:
      // Explicit version string — validate format
      if (/^\d+\.\d+\.\d+/.test(type)) return type;
      throw new Error(`Invalid bump type: "${type}". Use: patch, minor, major, or explicit version (e.g. 3.7.0)`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

const arg = process.argv[2];
if (!arg) {
  console.log('Usage: node scripts/bump-version.js <patch|minor|major|x.y.z>');
  process.exit(1);
}

const currentVersion = readVersion('package.json');
const newVersion = bumpVersion(currentVersion, arg);

console.log(`\n  Version bump: ${currentVersion} → ${newVersion}\n`);

// Update all files
for (const { file, independent } of VERSION_FILES) {
  const fullPath = path.join(ROOT, file);
  if (!fs.existsSync(fullPath)) {
    console.log(`  ⚠ Skipped (not found): ${file}`);
    continue;
  }

  let targetVersion = newVersion;

  // web-ui has its own version scheme — bump its patch independently
  if (independent) {
    const webVersion = readVersion(file);
    const webNew = bumpVersion(webVersion, arg.match(/^\d/) ? arg : arg); // same bump type
    targetVersion = webNew;
  }

  const old = writeVersion(file, targetVersion);
  console.log(`  ✓ ${file}: ${old} → ${targetVersion}`);
}

// Git: stage, commit, tag, push
console.log('\n  Git operations:');

const filesToStage = VERSION_FILES.map(v => v.file).filter(f => fs.existsSync(path.join(ROOT, f)));
execSync(`git add ${filesToStage.join(' ')}`, { cwd: ROOT, stdio: 'pipe' });
console.log(`  ✓ Staged ${filesToStage.length} files`);

execSync(`git commit -m "v${newVersion}"`, { cwd: ROOT, stdio: 'pipe' });
console.log(`  ✓ Committed: v${newVersion}`);

try {
  execSync(`git tag v${newVersion}`, { cwd: ROOT, stdio: 'pipe' });
  console.log(`  ✓ Tagged: v${newVersion}`);
} catch {
  console.log(`  ⚠ Tag v${newVersion} already exists, skipping`);
}

execSync(`git push origin main --tags`, { cwd: ROOT, stdio: 'pipe' });
console.log(`  ✓ Pushed to origin/main with tags`);

console.log(`\n  ✅ Version ${newVersion} ready to publish.\n  Run: publish-both.bat\n`);
