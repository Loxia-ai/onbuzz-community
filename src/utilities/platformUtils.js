/**
 * Platform Utilities Module
 *
 * Centralized platform abstraction for cross-platform compatibility.
 * Provides functions for detecting platform, shell, paths, and other
 * platform-specific configurations.
 *
 * @module platformUtils
 */

import os from 'os';
import path from 'path';

/**
 * Platform constants
 */
export const PLATFORMS = {
  MACOS: 'darwin',
  WINDOWS: 'win32',
  LINUX: 'linux'
};

/**
 * Get the current platform
 * @returns {string} Platform identifier (darwin, win32, linux)
 */
export function getPlatform() {
  return process.platform;
}

/**
 * Check if running on macOS
 * @returns {boolean}
 */
export function isMacOS() {
  return process.platform === 'darwin';
}

/**
 * Check if running on Windows
 * @returns {boolean}
 */
export function isWindows() {
  return process.platform === 'win32';
}

/**
 * Check if running on Linux
 * @returns {boolean}
 */
export function isLinux() {
  return process.platform === 'linux';
}

/**
 * Detect the user's shell
 * @returns {string} Shell type (zsh, bash, fish, powershell, cmd)
 */
export function getUserShell() {
  if (isWindows()) {
    // Windows: Check for PowerShell or CMD
    if (process.env.PSModulePath) {
      return 'powershell';
    }
    // Check if running in WSL or Git Bash
    if (process.env.SHELL && process.env.SHELL.includes('bash')) {
      return 'bash';
    }
    return 'cmd';
  }

  // Unix-like systems (macOS, Linux)
  // macOS Catalina (10.15) and later default to zsh
  const defaultShell = isMacOS() ? '/bin/zsh' : '/bin/bash';
  const shell = process.env.SHELL || defaultShell;

  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  if (shell.includes('bash')) return 'bash';

  return 'bash'; // Fallback
}

/**
 * Get the shell executable path
 * @returns {string} Path to shell executable
 */
export function getShellPath() {
  if (isWindows()) {
    const shell = getUserShell();
    if (shell === 'powershell') return 'powershell';
    return 'cmd';
  }

  return process.env.SHELL || (isMacOS() ? '/bin/zsh' : '/bin/bash');
}

/**
 * Get system restricted paths for the current platform
 * These paths should be protected from unauthorized access
 * @returns {string[]} Array of restricted paths
 */
export function getSystemRestrictedPaths() {
  const common = [
    '/etc',
    '/var',
    '/usr',
    '/bin',
    '/sbin',
    '/boot',
    '/dev',
    '/proc',
    '/sys'
  ];

  if (isMacOS()) {
    return [
      ...common,
      '/System',
      '/Library',
      '/Applications',
      '/private',
      '/cores',
      '/Volumes',
      path.join(os.homedir(), 'Library')
    ];
  }

  if (isWindows()) {
    // Use environment variables for Windows paths (handles different drive letters)
    const winDir = process.env.WINDIR || 'C:\\Windows';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    return [winDir, programFiles, programFilesX86];
  }

  // Linux
  return common;
}

/**
 * Get platform-specific blocked file extensions
 * Only blocks executables/installers for the current platform
 * @returns {string[]} Array of blocked extensions
 */
export function getPlatformBlockedExtensions() {
  // Universal - blocked on all platforms
  const universal = ['.jar', '.apk'];

  // Platform-specific executables and installers
  const platformSpecific = {
    darwin: ['.app', '.dmg', '.pkg', '.dylib'],
    win32: ['.exe', '.dll', '.bat', '.cmd', '.ps1', '.msi'],
    linux: ['.so', '.deb', '.rpm']
  };

  return [...universal, ...(platformSpecific[process.platform] || [])];
}

/**
 * Normalize a path for comparison
 * Handles case-insensitivity on macOS and Windows
 * @param {string} p - Path to normalize
 * @returns {string} Normalized path
 */
export function normalizePath(p) {
  let normalized = path.normalize(p);

  // macOS (APFS/HFS+) and Windows (NTFS) are case-insensitive
  if (isMacOS() || isWindows()) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

/**
 * Compare two paths for equality (case-aware based on platform)
 * @param {string} path1 - First path
 * @param {string} path2 - Second path
 * @returns {boolean} True if paths are equal
 */
export function pathsEqual(path1, path2) {
  return normalizePath(path1) === normalizePath(path2);
}

/**
 * Check if targetPath starts with basePath (case-aware)
 * @param {string} targetPath - Path to check
 * @param {string} basePath - Base path to compare against
 * @returns {boolean} True if targetPath starts with basePath
 */
export function pathStartsWith(targetPath, basePath) {
  const normalizedTarget = normalizePath(targetPath);
  const normalizedBase = normalizePath(basePath);
  return normalizedTarget.startsWith(normalizedBase);
}

/**
 * Get platform-appropriate default user agent for browser automation
 * @returns {string} User agent string
 */
export function getDefaultUserAgent() {
  if (isMacOS()) {
    return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
  if (isWindows()) {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
  // Linux
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
}

/**
 * Get common Python executable locations for macOS
 * Includes Homebrew and pyenv paths
 * @returns {string[]} Array of Python paths to try
 */
export function getMacOSPythonPaths() {
  if (!isMacOS()) return [];

  const homeDir = os.homedir();
  return [
    '/opt/homebrew/bin/python3',           // Homebrew (Apple Silicon)
    '/usr/local/bin/python3',               // Homebrew (Intel Mac)
    `${homeDir}/.pyenv/shims/python3`,      // pyenv
    `${homeDir}/.pyenv/shims/python`
  ];
}

/**
 * Check if a Python command is from Homebrew installation
 * @param {string} pythonPath - Path to Python executable
 * @returns {boolean} True if Homebrew Python
 */
export function isHomebrewPython(pythonPath) {
  if (!pythonPath) return false;
  return pythonPath.includes('/opt/homebrew') || pythonPath.includes('/usr/local/Cellar');
}

/**
 * Get platform info object for logging/debugging
 * @returns {object} Platform information
 */
export function getPlatformInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    shell: getUserShell(),
    shellPath: getShellPath(),
    homeDir: os.homedir(),
    tmpDir: os.tmpdir(),
    nodeVersion: process.version
  };
}
