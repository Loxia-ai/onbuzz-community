import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { ContextReferenceValidator, ContextReferenceFactory, ContextReferenceUtils } from '../contextReference.js';

describe('ContextReferenceFactory', () => {
  test('create returns reference with type, path, name, and id', () => {
    const ref = ContextReferenceFactory.create('file', '/src/index.js', 'index.js');
    expect(ref).toBeDefined();
    expect(typeof ref.id).toBe('string');
    expect(ref.id).toMatch(/^ref_/);
    expect(ref.type).toBe('file');
    expect(ref.path).toBe('/src/index.js');
    expect(ref.name).toBe('index.js');
    expect(ref.isValid).toBe(true);
    expect(ref.accessCount).toBe(0);
    expect(ref.lastAccessed).toBeNull();
  });

  test('createFileReference returns file reference with absolutePath', () => {
    const ref = ContextReferenceFactory.createFileReference('/home/user/src/app.js', 'src/app.js');
    expect(ref.absolutePath).toBe('/home/user/src/app.js');
    expect(ref.relativePath).toBe('src/app.js');
    expect(ref.type).toBe('file');
    expect(ref.extension).toBe('.js');
    expect(ref.exists).toBe(true);
  });

  test('createFileReference with exists=false', () => {
    const ref = ContextReferenceFactory.createFileReference('/a.js', 'a.js', { exists: false });
    expect(ref.exists).toBe(false);
  });

  test('createFileReference extracts name from path', () => {
    const ref = ContextReferenceFactory.createFileReference('/home/user/src/app.js', 'src/app.js');
    expect(ref.name).toBe('app.js');
  });

  test('createFileReference uses provided name', () => {
    const ref = ContextReferenceFactory.createFileReference('/a.js', 'a.js', { name: 'Custom Name' });
    expect(ref.name).toBe('Custom Name');
  });

  describe('createSelectionReference', () => {
    test('creates selection reference with scope', () => {
      const ref = ContextReferenceFactory.createSelectionReference(
        '/src/app.js',
        'const x = 1;',
        { startLine: 10, endLine: 15 }
      );
      expect(ref.type).toBe('selection');
      expect(ref.sourceFile).toBe('/src/app.js');
      expect(ref.selectedText).toBe('const x = 1;');
      expect(ref.scope.startLine).toBe(10);
      expect(ref.scope.endLine).toBe(15);
    });

    test('generates name from file and scope', () => {
      const ref = ContextReferenceFactory.createSelectionReference(
        '/src/app.js',
        'text',
        { startLine: 10, endLine: 20 }
      );
      expect(ref.name).toBe('app.js:10-20');
    });

    test('generates single-line name when start equals end', () => {
      const ref = ContextReferenceFactory.createSelectionReference(
        '/src/app.js',
        'text',
        { startLine: 10, endLine: 10 }
      );
      expect(ref.name).toBe('app.js:10');
    });

    test('sets content from selectedText', () => {
      const ref = ContextReferenceFactory.createSelectionReference(
        '/src/app.js',
        'selected text here',
        { startLine: 1, endLine: 1 }
      );
      expect(ref.content).toBe('selected text here');
    });

    test('includes optional fields', () => {
      const ref = ContextReferenceFactory.createSelectionReference(
        '/src/app.js',
        'text',
        { startLine: 1, endLine: 1 },
        { purpose: 'review', syntax: { language: 'javascript' } }
      );
      expect(ref.purpose).toBe('review');
      expect(ref.syntax.language).toBe('javascript');
    });
  });

  describe('createDirectoryReference', () => {
    test('creates directory reference', () => {
      const ref = ContextReferenceFactory.createDirectoryReference('/home/user/src', 'src');
      expect(ref.type).toBe('directory');
      expect(ref.absolutePath).toBe('/home/user/src');
      expect(ref.relativePath).toBe('src');
      expect(ref.name).toBe('src');
    });

    test('includes optional directory fields', () => {
      const ref = ContextReferenceFactory.createDirectoryReference('/src', 'src', {
        fileCount: 10,
        totalSize: 5000,
        fileTypes: ['.js', '.ts']
      });
      expect(ref.fileCount).toBe(10);
      expect(ref.totalSize).toBe(5000);
      expect(ref.fileTypes).toEqual(['.js', '.ts']);
    });

    test('extracts directory name from path', () => {
      const ref = ContextReferenceFactory.createDirectoryReference('/home/user/project/src', 'src');
      expect(ref.name).toBe('src');
    });
  });

  describe('createComponentReference', () => {
    test('creates component reference', () => {
      const ref = ContextReferenceFactory.createComponentReference(
        'React', '/src/Button.jsx', 'Button'
      );
      expect(ref.type).toBe('component');
      expect(ref.componentType).toBe('React');
      expect(ref.name).toBe('Button');
    });

    test('includes optional fields', () => {
      const ref = ContextReferenceFactory.createComponentReference(
        'React', '/src/Button.jsx', 'Button',
        {
          sourceFile: '/src/Button.jsx',
          properties: { color: 'string' },
          dependencies: ['React'],
          documentation: 'A button component'
        }
      );
      expect(ref.sourceFile).toBe('/src/Button.jsx');
      expect(ref.properties).toEqual({ color: 'string' });
      expect(ref.dependencies).toEqual(['React']);
      expect(ref.documentation).toBe('A button component');
    });
  });

  test('generateReferenceId returns unique strings', () => {
    const id1 = ContextReferenceFactory.generateReferenceId();
    const id2 = ContextReferenceFactory.generateReferenceId();
    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');
    expect(id1).not.toBe(id2);
  });

  test('getLanguageFromExtension returns javascript for .js', () => {
    expect(ContextReferenceFactory.getLanguageFromExtension('.js')).toBe('javascript');
  });

  test('getLanguageFromExtension returns null for unknown extension', () => {
    expect(ContextReferenceFactory.getLanguageFromExtension('.xyz')).toBeNull();
  });

  test('getLanguageFromExtension is case-insensitive', () => {
    expect(ContextReferenceFactory.getLanguageFromExtension('.JS')).toBe('javascript');
  });

  test('getMimeTypeFromExtension returns correct types', () => {
    expect(ContextReferenceFactory.getMimeTypeFromExtension('.js')).toBe('application/javascript');
    expect(ContextReferenceFactory.getMimeTypeFromExtension('.html')).toBe('text/html');
  });

  test('getMimeTypeFromExtension returns text/plain for unknown', () => {
    expect(ContextReferenceFactory.getMimeTypeFromExtension('.xyz')).toBe('text/plain');
  });

  test('extractFileName returns filename from path', () => {
    expect(ContextReferenceFactory.extractFileName('/home/user/src/app.js')).toBe('app.js');
    expect(ContextReferenceFactory.extractFileName('app.js')).toBe('app.js');
  });

  test('extractDirectoryName returns last directory segment', () => {
    expect(ContextReferenceFactory.extractDirectoryName('/home/user/src')).toBe('src');
    expect(ContextReferenceFactory.extractDirectoryName('/')).toBe('Root');
  });

  test('extractFileExtension returns extension', () => {
    expect(ContextReferenceFactory.extractFileExtension('/src/app.js')).toBe('.js');
    expect(ContextReferenceFactory.extractFileExtension('/src/noext')).toBe('');
  });

  test('generateSelectionName handles functionName scope', () => {
    const name = ContextReferenceFactory.generateSelectionName('/src/app.js', { functionName: 'handleClick' });
    expect(name).toBe('app.js:handleClick()');
  });

  test('generateSelectionName handles className scope', () => {
    const name = ContextReferenceFactory.generateSelectionName('/src/app.js', { className: 'MyComponent' });
    expect(name).toBe('app.js:MyComponent');
  });

  test('generateSelectionName handles no scope details', () => {
    const name = ContextReferenceFactory.generateSelectionName('/src/app.js', {});
    expect(name).toBe('app.js (selection)');
  });
});

describe('ContextReferenceValidator', () => {
  test('validate accepts valid reference', () => {
    const ref = ContextReferenceFactory.create('file', '/src/index.js', 'index.js', {
      metadata: { size: 100 }
    });
    const result = ContextReferenceValidator.validate(ref);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validate rejects missing required fields', () => {
    const result = ContextReferenceValidator.validate({});
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Reference ID'))).toBe(true);
    expect(result.errors.some(e => e.includes('Reference type'))).toBe(true);
    expect(result.errors.some(e => e.includes('Reference path'))).toBe(true);
    expect(result.errors.some(e => e.includes('Reference name'))).toBe(true);
  });

  test('validate rejects invalid type', () => {
    const ref = ContextReferenceFactory.create('file', '/src/a.js', 'a.js');
    ref.type = 'invalid-type';
    const result = ContextReferenceValidator.validate(ref);
    expect(result.errors.some(e => e.includes('Invalid reference type'))).toBe(true);
  });

  test('validate rejects non-string content', () => {
    const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
    ref.content = 123;
    const result = ContextReferenceValidator.validate(ref);
    expect(result.errors.some(e => e.includes('content must be a string'))).toBe(true);
  });

  test('validate warns on very large content', () => {
    const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
    ref.content = 'x'.repeat(1000001);
    const result = ContextReferenceValidator.validate(ref);
    expect(result.warnings.some(w => w.includes('very large'))).toBe(true);
  });

  test('validate rejects non-number accessCount', () => {
    const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
    ref.accessCount = 'many';
    const result = ContextReferenceValidator.validate(ref);
    expect(result.errors.some(e => e.includes('Access count'))).toBe(true);
  });

  test('validate validates file references', () => {
    const ref = ContextReferenceFactory.createFileReference('/a.js', 'a.js');
    ref.absolutePath = 123; // invalid
    const result = ContextReferenceValidator.validate(ref);
    expect(result.errors.some(e => e.includes('Absolute path'))).toBe(true);
  });

  test('validate validates selection references', () => {
    const ref = ContextReferenceFactory.createSelectionReference('/a.js', 'text', {});
    const result = ContextReferenceValidator.validate(ref);
    // Should warn about missing line scope
    expect(result.warnings.some(w => w.includes('line scope'))).toBe(true);
  });

  test('validate validates directory references', () => {
    const ref = ContextReferenceFactory.createDirectoryReference('/src', 'src');
    ref.fileCount = -1;
    const result = ContextReferenceValidator.validate(ref);
    expect(result.errors.some(e => e.includes('File count'))).toBe(true);
  });

  describe('validateScope', () => {
    test('rejects negative line numbers', () => {
      const result = ContextReferenceValidator.validateScope({ startLine: -1 });
      expect(result.errors.some(e => e.includes('startLine'))).toBe(true);
    });

    test('rejects startLine > endLine', () => {
      const result = ContextReferenceValidator.validateScope({ startLine: 20, endLine: 10 });
      expect(result.errors.some(e => e.includes('Start line must be'))).toBe(true);
    });

    test('rejects startColumn > endColumn', () => {
      const result = ContextReferenceValidator.validateScope({ startColumn: 20, endColumn: 10 });
      expect(result.errors.some(e => e.includes('Start column must be'))).toBe(true);
    });
  });
});

describe('ContextReferenceUtils', () => {
  test('isValid returns true for valid reference', () => {
    const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
    expect(ContextReferenceUtils.isValid(ref)).toBe(true);
  });

  test('isValid returns false for invalid reference', () => {
    const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
    ref.isValid = false;
    ref.invalidReason = 'File deleted';
    expect(ContextReferenceUtils.isValid(ref)).toBe(false);
  });

  describe('markAccessed', () => {
    test('updates lastAccessed and increments accessCount', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      const updated = ContextReferenceUtils.markAccessed(ref);
      expect(updated.lastAccessed).toBeDefined();
      expect(updated.accessCount).toBe(1);
      // Original should not be modified
      expect(ref.accessCount).toBe(0);
    });

    test('increments accessCount on subsequent access', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      const first = ContextReferenceUtils.markAccessed(ref);
      const second = ContextReferenceUtils.markAccessed(first);
      expect(second.accessCount).toBe(2);
    });
  });

  describe('markInvalid', () => {
    test('sets isValid to false and adds reason', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      const invalid = ContextReferenceUtils.markInvalid(ref, 'File was deleted');
      expect(invalid.isValid).toBe(false);
      expect(invalid.invalidReason).toBe('File was deleted');
      // Original should not be modified
      expect(ref.isValid).toBe(true);
    });
  });

  describe('getDisplayName', () => {
    test('returns name for file reference', () => {
      const ref = ContextReferenceFactory.create('file', '/src/app.js', 'app.js');
      expect(ContextReferenceUtils.getDisplayName(ref)).toBe('app.js');
    });

    test('returns generated name for selection reference with scope', () => {
      const ref = ContextReferenceFactory.createSelectionReference('/src/app.js', 'text', { startLine: 10, endLine: 20 });
      expect(ContextReferenceUtils.getDisplayName(ref)).toBe('app.js:10-20');
    });
  });

  describe('getDescription', () => {
    test('returns metadata description when available', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js', {
        metadata: { description: 'Main entry point' }
      });
      expect(ContextReferenceUtils.getDescription(ref)).toBe('Main entry point');
    });

    test('returns type-specific description for file', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      expect(ContextReferenceUtils.getDescription(ref)).toBe('File: /a.js');
    });

    test('returns type-specific description for directory', () => {
      const ref = ContextReferenceFactory.create('directory', '/src', 'src');
      expect(ContextReferenceUtils.getDescription(ref)).toBe('Directory: /src');
    });

    test('returns type-specific description for selection', () => {
      const ref = ContextReferenceFactory.create('selection', '/a.js', 'sel');
      expect(ContextReferenceUtils.getDescription(ref)).toBe('Selection from /a.js');
    });

    test('returns type-specific description for component', () => {
      const ref = ContextReferenceFactory.create('component', '/src/Button', 'Button');
      expect(ContextReferenceUtils.getDescription(ref)).toBe('Component: Button');
    });

    test('returns path for unknown type', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      ref.type = 'unknown';
      expect(ContextReferenceUtils.getDescription(ref)).toBe('/a.js');
    });
  });

  describe('calculateRelevance', () => {
    test('returns base score for minimal reference', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      const score = ContextReferenceUtils.calculateRelevance(ref);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    test('gives bonus for recent access', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      ref.lastAccessed = new Date().toISOString();
      const scoreAccessed = ContextReferenceUtils.calculateRelevance(ref);

      const ref2 = ContextReferenceFactory.create('file', '/b.js', 'b.js');
      const scoreNotAccessed = ContextReferenceUtils.calculateRelevance(ref2);

      expect(scoreAccessed).toBeGreaterThan(scoreNotAccessed);
    });

    test('gives bonus for high access count', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      ref.accessCount = 20;
      const scoreFrequent = ContextReferenceUtils.calculateRelevance(ref);

      const ref2 = ContextReferenceFactory.create('file', '/b.js', 'b.js');
      const scoreLow = ContextReferenceUtils.calculateRelevance(ref2);

      expect(scoreFrequent).toBeGreaterThan(scoreLow);
    });

    test('gives bonus for matching file type', () => {
      const ref = ContextReferenceFactory.createFileReference('/a.js', 'a.js');
      const score = ContextReferenceUtils.calculateRelevance(ref, { fileTypes: ['javascript'] });
      const scoreNoMatch = ContextReferenceUtils.calculateRelevance(ref, { fileTypes: ['python'] });
      expect(score).toBeGreaterThan(scoreNoMatch);
    });

    test('gives bonus for selection type', () => {
      const selRef = ContextReferenceFactory.createSelectionReference('/a.js', 'text', { startLine: 1, endLine: 1 });
      const fileRef = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      const selScore = ContextReferenceUtils.calculateRelevance(selRef);
      const fileScore = ContextReferenceUtils.calculateRelevance(fileRef);
      expect(selScore).toBeGreaterThan(fileScore);
    });

    test('gives bonus for keyword matches', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js', {
        metadata: { keywords: ['auth', 'login'] }
      });
      const scoreMatch = ContextReferenceUtils.calculateRelevance(ref, { keywords: ['auth'] });
      const scoreNoMatch = ContextReferenceUtils.calculateRelevance(ref, { keywords: ['database'] });
      expect(scoreMatch).toBeGreaterThan(scoreNoMatch);
    });

    test('penalizes invalid references', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      const validScore = ContextReferenceUtils.calculateRelevance(ref);
      ref.isValid = false;
      const invalidScore = ContextReferenceUtils.calculateRelevance(ref);
      expect(invalidScore).toBeLessThan(validScore);
    });

    test('clamps score between 0 and 1', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      ref.accessCount = 1000;
      ref.lastAccessed = new Date().toISOString();
      const score = ContextReferenceUtils.calculateRelevance(ref, {
        fileTypes: ['javascript'],
        keywords: ['auth', 'login', 'session']
      });
      expect(score).toBeLessThanOrEqual(1);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('groupByType', () => {
    test('groups references correctly', () => {
      const refs = [
        ContextReferenceFactory.create('file', '/a.js', 'a.js'),
        ContextReferenceFactory.create('file', '/b.js', 'b.js'),
        ContextReferenceFactory.create('directory', '/src', 'src'),
      ];
      const grouped = ContextReferenceUtils.groupByType(refs);
      expect(grouped['file']).toHaveLength(2);
      expect(grouped['directory']).toHaveLength(1);
    });
  });

  describe('sortByRelevance', () => {
    test('sorts references by relevance score descending', () => {
      const refs = [
        ContextReferenceFactory.create('file', '/a.js', 'a.js'),
        ContextReferenceFactory.create('file', '/b.js', 'b.js'),
      ];
      refs[1].accessCount = 50;
      refs[1].lastAccessed = new Date().toISOString();

      const sorted = ContextReferenceUtils.sortByRelevance(refs);
      expect(sorted[0].path).toBe('/b.js');
    });

    test('does not modify original array', () => {
      const refs = [
        ContextReferenceFactory.create('file', '/a.js', 'a.js'),
        ContextReferenceFactory.create('file', '/b.js', 'b.js'),
      ];
      refs[1].accessCount = 50;
      const sorted = ContextReferenceUtils.sortByRelevance(refs);
      expect(refs[0].path).toBe('/a.js'); // original unchanged
      expect(sorted).not.toBe(refs); // different array instance
    });
  });

  describe('filter', () => {
    test('filters by type', () => {
      const refs = [
        ContextReferenceFactory.create('file', '/a.js', 'a.js'),
        ContextReferenceFactory.create('directory', '/src', 'src'),
      ];
      const filtered = ContextReferenceUtils.filter(refs, { types: ['file'] });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe('file');
    });

    test('filters by validOnly', () => {
      const refs = [
        ContextReferenceFactory.create('file', '/a.js', 'a.js'),
        ContextReferenceFactory.create('file', '/b.js', 'b.js'),
      ];
      refs[1].isValid = false;
      const filtered = ContextReferenceUtils.filter(refs, { validOnly: true });
      expect(filtered).toHaveLength(1);
    });

    test('filters by language', () => {
      const refs = [
        ContextReferenceFactory.createFileReference('/a.js', 'a.js'),
        ContextReferenceFactory.createFileReference('/b.py', 'b.py'),
      ];
      const filtered = ContextReferenceUtils.filter(refs, { languages: ['javascript'] });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].path).toBe('a.js');
    });

    test('filters by pathPattern', () => {
      const refs = [
        ContextReferenceFactory.create('file', '/src/components/Button.js', 'Button.js'),
        ContextReferenceFactory.create('file', '/src/utils/helper.js', 'helper.js'),
      ];
      const filtered = ContextReferenceUtils.filter(refs, { pathPattern: 'components' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Button.js');
    });

    test('filters by keywords', () => {
      const refs = [
        ContextReferenceFactory.create('file', '/a.js', 'a.js', { metadata: { keywords: ['auth'] } }),
        ContextReferenceFactory.create('file', '/b.js', 'b.js', { metadata: { keywords: ['db'] } }),
      ];
      const filtered = ContextReferenceUtils.filter(refs, { keywords: ['auth'] });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('a.js');
    });

    test('filters by createdAfter', () => {
      const refs = [
        ContextReferenceFactory.create('file', '/a.js', 'a.js'),
        ContextReferenceFactory.create('file', '/b.js', 'b.js'),
      ];
      refs[0].createdAt = '2024-01-01T00:00:00.000Z';
      refs[1].createdAt = '2025-06-01T00:00:00.000Z';
      const filtered = ContextReferenceUtils.filter(refs, { createdAfter: '2025-01-01T00:00:00.000Z' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('b.js');
    });

    test('filters by createdBefore', () => {
      const refs = [
        ContextReferenceFactory.create('file', '/a.js', 'a.js'),
        ContextReferenceFactory.create('file', '/b.js', 'b.js'),
      ];
      refs[0].createdAt = '2024-01-01T00:00:00.000Z';
      refs[1].createdAt = '2025-06-01T00:00:00.000Z';
      const filtered = ContextReferenceUtils.filter(refs, { createdBefore: '2025-01-01T00:00:00.000Z' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('a.js');
    });

    test('returns all when no criteria', () => {
      const refs = [
        ContextReferenceFactory.create('file', '/a.js', 'a.js'),
        ContextReferenceFactory.create('file', '/b.js', 'b.js'),
      ];
      const filtered = ContextReferenceUtils.filter(refs);
      expect(filtered).toHaveLength(2);
    });
  });

  describe('formatForDisplay', () => {
    test('returns formatted reference', () => {
      const ref = ContextReferenceFactory.createFileReference('/src/app.js', 'src/app.js');
      const result = ContextReferenceUtils.formatForDisplay(ref);
      expect(result.id).toBe(ref.id);
      expect(result.type).toBe('file');
      expect(result.name).toBe('app.js');
      expect(result.path).toBe('src/app.js');
      expect(result.isValid).toBe(true);
      expect(result.accessCount).toBe(0);
      expect(result.language).toBe('javascript');
    });

    test('includes icon from metadata', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      const result = ContextReferenceUtils.formatForDisplay(ref);
      expect(result.icon).toBeDefined();
    });

    test('includes description', () => {
      const ref = ContextReferenceFactory.create('file', '/a.js', 'a.js');
      const result = ContextReferenceUtils.formatForDisplay(ref);
      expect(result.description).toBe('File: /a.js');
    });
  });
});
