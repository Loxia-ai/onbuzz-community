/**
 * Settings Storage Utility
 * Handles persistent storage of Terminal UI settings including API keys
 *
 * UPDATED: Settings are now stored in a platform-appropriate user data directory
 * that persists across npm package updates. See userDataDir.js for details.
 */

import fs from 'fs';
import path from 'path';
import { getUserDataPaths } from '../../../utilities/userDataDir.js';

// UPDATED: Use persistent user data directory instead of package-relative path
// This ensures settings survive npm package updates (npm i -g)
const userPaths = getUserDataPaths();
const SETTINGS_DIR = userPaths.settings;
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'terminal-settings.json');

// Legacy paths for migration detection
const LEGACY_SETTINGS_PATHS = [
  // Old: relative to package installation
  path.join(process.cwd(), 'loxia-state', 'terminal-settings.json'),
  path.join(process.cwd(), '.loxia-state', 'terminal-settings.json'),
];

/**
 * Default settings structure
 */
const DEFAULT_SETTINGS = {
  // Connection settings
  autoReconnect: true,
  reconnectDelay: 3000,
  heartbeatInterval: 30000,

  // Display settings
  showTimestamps: true,
  compactMode: false,
  colorScheme: 'default',
  maxMessages: 100,

  // Behavior settings
  autoScroll: true,
  playSound: false,
  confirmOnExit: true,
  saveHistory: true,

  // API Keys
  apiKeys: {
    loxia: '', // Loxia Platform API Key (for Azure backend)
    anthropic: '', // Optional: Direct Anthropic API access
    openai: '', // Optional: Direct OpenAI API access
    deepseek: '', // Optional: Direct DeepSeek API access
  },

  // Metadata
  version: '1.0.0',
  lastModified: null,
};

/**
 * Ensure settings directory exists
 */
function ensureSettingsDir() {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

/**
 * Attempt to migrate settings from legacy location
 * @returns {Object|null} Migrated settings or null if not found
 */
function tryMigrateLegacySettings() {
  for (const legacyPath of LEGACY_SETTINGS_PATHS) {
    try {
      if (fs.existsSync(legacyPath)) {
        const fileContent = fs.readFileSync(legacyPath, 'utf8');
        const legacySettings = JSON.parse(fileContent);
        console.log(`Migrating settings from legacy location: ${legacyPath}`);
        return legacySettings;
      }
    } catch (error) {
      // Continue to next legacy path
    }
  }
  return null;
}

/**
 * Load settings from disk
 * @returns {Object} Settings object
 */
export function loadSettings() {
  try {
    ensureSettingsDir();

    if (!fs.existsSync(SETTINGS_FILE)) {
      // No settings in new location, try to migrate from legacy location
      const legacySettings = tryMigrateLegacySettings();
      if (legacySettings) {
        // Save migrated settings to new location
        const mergedSettings = {
          ...DEFAULT_SETTINGS,
          ...legacySettings,
          apiKeys: {
            ...DEFAULT_SETTINGS.apiKeys,
            ...(legacySettings.apiKeys || {}),
          },
        };
        saveSettings(mergedSettings);
        console.log(`Settings migrated to persistent location: ${SETTINGS_FILE}`);
        return mergedSettings;
      }
      // No settings file exists anywhere, return defaults
      return { ...DEFAULT_SETTINGS };
    }

    const fileContent = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const savedSettings = JSON.parse(fileContent);

    // Merge with defaults to handle new settings added in updates
    return {
      ...DEFAULT_SETTINGS,
      ...savedSettings,
      apiKeys: {
        ...DEFAULT_SETTINGS.apiKeys,
        ...(savedSettings.apiKeys || {}),
      },
    };
  } catch (error) {
    console.error('Error loading settings:', error.message);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings to disk
 * @param {Object} settings - Settings object to save
 * @returns {boolean} Success status
 */
export function saveSettings(settings) {
  try {
    ensureSettingsDir();

    const settingsToSave = {
      ...settings,
      version: '1.0.0',
      lastModified: new Date().toISOString(),
    };

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settingsToSave, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving settings:', error.message);
    return false;
  }
}

/**
 * Check if Loxia API key is configured
 * @returns {boolean} True if API key exists
 */
export function hasLoxiaApiKey() {
  const settings = loadSettings();
  return !!(settings.apiKeys?.loxia && settings.apiKeys.loxia.trim().length > 0);
}

/**
 * Get Loxia API key
 * @returns {string|null} API key or null
 */
export function getLoxiaApiKey() {
  const settings = loadSettings();
  return settings.apiKeys?.loxia || null;
}

/**
 * Get all vendor API keys
 * @returns {Object} Vendor keys object
 */
export function getVendorApiKeys() {
  const settings = loadSettings();
  const apiKeys = settings.apiKeys || {};

  return {
    anthropic: apiKeys.anthropic || '',
    openai: apiKeys.openai || '',
    deepseek: apiKeys.deepseek || '',
  };
}

/**
 * Update API keys
 * @param {Object} keys - API keys object { loxia, anthropic, openai, deepseek }
 * @returns {boolean} Success status
 */
export function updateApiKeys(keys) {
  const settings = loadSettings();

  settings.apiKeys = {
    ...settings.apiKeys,
    ...keys,
  };

  return saveSettings(settings);
}

/**
 * Clear all settings (reset to defaults)
 * @returns {boolean} Success status
 */
export function clearSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      fs.unlinkSync(SETTINGS_FILE);
    }
    return true;
  } catch (error) {
    console.error('Error clearing settings:', error.message);
    return false;
  }
}

export default {
  loadSettings,
  saveSettings,
  hasLoxiaApiKey,
  getLoxiaApiKey,
  getVendorApiKeys,
  updateApiKeys,
  clearSettings,
};
