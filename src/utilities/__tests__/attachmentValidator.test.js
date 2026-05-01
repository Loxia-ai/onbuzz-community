import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import AttachmentValidator from '../attachmentValidator.js';

describe('AttachmentValidator', () => {
  let validator;

  beforeEach(() => {
    validator = new AttachmentValidator();
  });

  describe('validateFileType', () => {
    test('allows .js, .txt, .json files', () => {
      expect(validator.validateFileType('script.js').valid).toBe(true);
      expect(validator.validateFileType('readme.txt').valid).toBe(true);
      expect(validator.validateFileType('config.json').valid).toBe(true);
    });

    test('blocks executable files', () => {
      // These are platform-specific; on Windows .exe, .bat, .cmd are blocked
      // On all platforms .jar and .apk are blocked
      const result = validator.validateFileType('malware.jar');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Executable');

      const apkResult = validator.validateFileType('app.apk');
      expect(apkResult.valid).toBe(false);
    });
  });

  describe('isExecutable', () => {
    test('returns true for platform executables', () => {
      // Universal blocked extensions
      expect(validator.isExecutable('file.jar')).toBe(true);
      expect(validator.isExecutable('file.apk')).toBe(true);
    });

    test('returns false for non-executable files', () => {
      expect(validator.isExecutable('file.js')).toBe(false);
      expect(validator.isExecutable('file.txt')).toBe(false);
      expect(validator.isExecutable('file.json')).toBe(false);
    });
  });

  describe('validateSize', () => {
    test('accepts files under content limit (1MB)', () => {
      const result = validator.validateSize(500 * 1024, 'content');
      expect(result.valid).toBe(true);
    });

    test('rejects files over content limit', () => {
      const result = validator.validateSize(2 * 1024 * 1024, 'content');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('validatePath', () => {
    test('rejects directory traversal (../)', () => {
      const result = validator.validatePath('../../etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    test('accepts normal paths', () => {
      const result = validator.validatePath('src/file.js');
      expect(result.valid).toBe(true);
    });
  });

  describe('getContentType', () => {
    test('returns correct content type for various extensions', () => {
      expect(validator.getContentType('app.js')).toBe('text');
      expect(validator.getContentType('photo.png')).toBe('image');
      expect(validator.getContentType('doc.pdf')).toBe('pdf');
      expect(validator.getContentType('lib.dll')).toBe('binary');
      expect(validator.getContentType('style.css')).toBe('text');
      expect(validator.getContentType('pic.jpg')).toBe('image');
    });
  });
});
