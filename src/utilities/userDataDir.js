/**
 * User Data Directory Utility
 *
 * Determines the appropriate persistent storage location for user data
 * that survives package updates (npm i -g).
 *
 * This solves the critical issue where user data (agents, conversations,
 * settings, API keys) was lost when updating the globally installed package
 * because data was stored relative to the package installation directory.
 *
 * Storage Locations by Platform:
 * - Linux:   ~/.local/share/loxia-autopilot/
 * - macOS:   ~/Library/Application Support/loxia-autopilot/
 * - Windows: %LOCALAPPDATA%/loxia-autopilot/ (typically C:\Users\<user>\AppData\Local\loxia-autopilot)
 *
 * Environment Variable Override:
 * - LOXIA_DATA_DIR: If set, uses this path instead of the platform default
 */

import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

// IMPORTANT: both brands (autopilot + onbuzz) DELIBERATELY share this
// directory. Agents, conversations, attachments, gallery — all of it
// is intended to be a single fleet visible to whichever brand the user
// happens to launch. Don't make this brand-specific without explicit
// product approval.
const APP_NAME = 'loxia-autopilot';

/**
 * Get the platform-appropriate user data directory
 * @returns {string} Absolute path to user data directory
 */
export function getUserDataDir() {
  // Allow override via environment variable
  if (process.env.LOXIA_DATA_DIR) {
    return path.resolve(process.env.LOXIA_DATA_DIR);
  }

  const platform = process.platform;
  const homeDir = os.homedir();

  switch (platform) {
    case 'win32': {
      // Windows: Use LOCALAPPDATA (persists locally, not roamed)
      // Falls back to APPDATA, then to home directory
      const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA;
      if (localAppData) {
        return path.join(localAppData, APP_NAME);
      }
      return path.join(homeDir, 'AppData', 'Local', APP_NAME);
    }

    case 'darwin': {
      // macOS: Use Application Support directory
      return path.join(homeDir, 'Library', 'Application Support', APP_NAME);
    }

    case 'linux':
    default: {
      // Linux/Unix: Follow XDG Base Directory Specification
      // Use XDG_DATA_HOME if set, otherwise ~/.local/share
      const xdgDataHome = process.env.XDG_DATA_HOME;
      if (xdgDataHome) {
        return path.join(xdgDataHome, APP_NAME);
      }
      return path.join(homeDir, '.local', 'share', APP_NAME);
    }
  }
}

/**
 * Get specific subdirectories within user data directory
 */
export function getUserDataPaths() {
  const baseDir = getUserDataDir();

  return {
    base: baseDir,
    state: path.join(baseDir, 'state'),           // Agent state, conversations
    agents: path.join(baseDir, 'state', 'agents'), // Individual agent data
    settings: path.join(baseDir, 'settings'),      // User settings, API keys
    attachments: path.join(baseDir, 'attachments'), // File attachments
    logs: path.join(baseDir, 'logs'),              // Application logs
    cache: path.join(baseDir, 'cache'),            // Temporary cache data
    operations: path.join(baseDir, 'state', 'operations'), // Async operations
    models: path.join(baseDir, 'state', 'models'), // Model router cache
    runtime: path.join(baseDir, 'runtime'),        // Runtime data (port registry, etc.)
    skills: path.join(baseDir, 'state', 'skills'),  // Global skills library
    gallery: path.join(baseDir, 'gallery'),         // Durable gallery root
    galleryImages: path.join(baseDir, 'gallery', 'images'), // Saved image-gen outputs
    galleryVideos: path.join(baseDir, 'gallery', 'videos'), // Saved video-gen outputs
  };
}

/**
 * Ensure user data directory structure exists
 * @returns {Promise<Object>} Created paths
 */
export async function ensureUserDataDirs() {
  const paths = getUserDataPaths();

  const dirsToCreate = [
    paths.base,
    paths.state,
    paths.agents,
    paths.settings,
    paths.attachments,
    paths.logs,
    paths.cache,
    paths.operations,
    paths.models,
    paths.runtime,
    paths.skills,
  ];

  for (const dir of dirsToCreate) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // Ignore if already exists
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  return paths;
}

/**
 * Check if user data directory exists and is accessible
 * @returns {Promise<boolean>}
 */
export async function userDataDirExists() {
  try {
    const baseDir = getUserDataDir();
    const stats = await fs.stat(baseDir);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
}

/**
 * Migrate data from old location to new user data directory
 * This helps users transition from the old storage location
 *
 * @param {string} oldDir - Old data directory path
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} Migration result
 */
export async function migrateFromOldLocation(oldDir, options = {}) {
  const { dryRun = false, logger = null } = options;
  const newPaths = getUserDataPaths();

  const result = {
    migrated: [],
    skipped: [],
    errors: [],
  };

  try {
    // Check if old directory exists
    try {
      await fs.access(oldDir);
    } catch {
      logger?.info('No old data directory found, skipping migration', { oldDir });
      return result;
    }

    // Check if new directory already has data (don't overwrite)
    const newHasData = await userDataDirExists();
    if (newHasData) {
      const newStateDir = newPaths.state;
      try {
        const files = await fs.readdir(newStateDir);
        if (files.length > 0) {
          logger?.info('New data directory already has data, skipping migration to prevent overwrite');
          result.skipped.push({ reason: 'new_location_has_data', path: newStateDir });
          return result;
        }
      } catch {
        // Directory doesn't exist or is empty, continue with migration
      }
    }

    // Ensure new directories exist
    if (!dryRun) {
      await ensureUserDataDirs();
    }

    // Migration mappings: oldSubPath -> newPath
    const migrations = [
      { old: 'agents', new: newPaths.agents },
      { old: 'operations', new: newPaths.operations },
      { old: 'models', new: newPaths.models },
      { old: 'attachments', new: newPaths.attachments },
      { old: 'terminal-settings.json', new: path.join(newPaths.settings, 'terminal-settings.json') },
      { old: 'project-state.json', new: path.join(newPaths.state, 'project-state.json') },
      { old: 'agent-index.json', new: path.join(newPaths.state, 'agent-index.json') },
      { old: 'last-session.json', new: path.join(newPaths.state, 'last-session.json') },
    ];

    for (const migration of migrations) {
      const oldPath = path.join(oldDir, migration.old);
      const newPath = migration.new;

      try {
        await fs.access(oldPath);

        if (dryRun) {
          result.migrated.push({ from: oldPath, to: newPath, dryRun: true });
          continue;
        }

        // Check if it's a directory or file
        const stats = await fs.stat(oldPath);

        if (stats.isDirectory()) {
          // Copy directory contents recursively
          await copyDir(oldPath, newPath);
        } else {
          // Copy single file
          await fs.copyFile(oldPath, newPath);
        }

        result.migrated.push({ from: oldPath, to: newPath });
        logger?.info('Migrated data', { from: oldPath, to: newPath });

      } catch (error) {
        if (error.code === 'ENOENT') {
          // File/dir doesn't exist, skip silently
          result.skipped.push({ path: oldPath, reason: 'not_found' });
        } else {
          result.errors.push({ path: oldPath, error: error.message });
          logger?.warn('Migration error', { path: oldPath, error: error.message });
        }
      }
    }

    if (result.migrated.length > 0 && !dryRun) {
      logger?.info('Data migration completed', {
        migratedCount: result.migrated.length,
        skippedCount: result.skipped.length,
        errorCount: result.errors.length,
      });
    }

  } catch (error) {
    result.errors.push({ path: oldDir, error: error.message });
    logger?.error('Migration failed', { error: error.message });
  }

  return result;
}

/**
 * Recursively copy a directory
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Get legacy data directory paths for migration detection
 * @returns {string[]} Array of potential old data locations
 */
export function getLegacyDataPaths() {
  const paths = [];

  // Old location: relative to package install (inside node_modules)
  // This won't work after package update, but useful for first-run detection

  // Old location: process.cwd() based
  const cwdBased = path.join(process.cwd(), '.loxia-state');
  paths.push(cwdBased);

  // Alternative old location
  const cwdBasedAlt = path.join(process.cwd(), 'loxia-state');
  paths.push(cwdBasedAlt);

  return paths;
}

export default {
  getUserDataDir,
  getUserDataPaths,
  ensureUserDataDirs,
  userDataDirExists,
  migrateFromOldLocation,
  getLegacyDataPaths,
};
