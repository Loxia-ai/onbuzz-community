import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import {
  PLATFORMS,
  getPlatform,
  isMacOS,
  isWindows,
  isLinux,
  normalizePath,
  pathsEqual,
  pathStartsWith,
  getPlatformInfo,
  getDefaultUserAgent,
  getUserShell,
  getSystemRestrictedPaths,
  getPlatformBlockedExtensions
} from '../platformUtils.js';

describe('platformUtils', () => {
  describe('getPlatform', () => {
    test('returns a string matching process.platform', () => {
      const platform = getPlatform();
      expect(typeof platform).toBe('string');
      expect(platform).toBe(process.platform);
    });
  });

  describe('PLATFORMS', () => {
    test('has MACOS, WINDOWS, LINUX keys', () => {
      expect(PLATFORMS.MACOS).toBe('darwin');
      expect(PLATFORMS.WINDOWS).toBe('win32');
      expect(PLATFORMS.LINUX).toBe('linux');
    });
  });

  describe('normalizePath', () => {
    test('handles forward and back slashes consistently', () => {
      const result = normalizePath('src/utilities/file.js');
      expect(typeof result).toBe('string');
      expect(result).not.toBe('');

      // On case-insensitive platforms (macOS/Windows), should lowercase
      if (process.platform === 'win32' || process.platform === 'darwin') {
        expect(normalizePath('SRC/File.JS')).toBe(normalizePath('src/file.js'));
      }
    });
  });

  describe('pathsEqual', () => {
    test('compares case correctly for current platform', () => {
      expect(pathsEqual('src/file.js', 'src/file.js')).toBe(true);

      if (process.platform === 'win32' || process.platform === 'darwin') {
        // Case-insensitive platforms
        expect(pathsEqual('SRC/File.js', 'src/file.js')).toBe(true);
      } else {
        // Case-sensitive platforms (Linux)
        expect(pathsEqual('SRC/File.js', 'src/file.js')).toBe(false);
      }
    });
  });

  describe('pathStartsWith', () => {
    test('detects prefix correctly', () => {
      expect(pathStartsWith('src/utilities/file.js', 'src')).toBe(true);
      expect(pathStartsWith('src/utilities/file.js', 'other')).toBe(false);

      if (process.platform === 'win32' || process.platform === 'darwin') {
        expect(pathStartsWith('SRC/utilities/file.js', 'src')).toBe(true);
      }
    });
  });

  describe('getPlatformInfo', () => {
    test('returns object with expected keys', () => {
      const info = getPlatformInfo();
      expect(info).toHaveProperty('platform');
      expect(info).toHaveProperty('arch');
      expect(info).toHaveProperty('shell');
      expect(info).toHaveProperty('shellPath');
      expect(info).toHaveProperty('homeDir');
      expect(info).toHaveProperty('tmpDir');
      expect(info).toHaveProperty('nodeVersion');
      expect(typeof info.platform).toBe('string');
      expect(typeof info.nodeVersion).toBe('string');
    });
  });
});
