import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock fs and userDataDir
const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn(),
  access: jest.fn().mockResolvedValue(undefined),
  copyFile: jest.fn().mockResolvedValue(undefined)
};

jest.unstable_mockModule('fs', () => ({
  promises: mockFs
}));

jest.unstable_mockModule('../../utilities/userDataDir.js', () => ({
  getUserDataPaths: jest.fn(() => ({
    settings: '/fake/settings',
    attachments: '/fake/attachments',
    skills: '/fake/skills'
  })),
  ensureUserDataDirs: jest.fn(async () => {})
}));

const { SkillsService } = await import('../skillsService.js');

describe('SkillsService', () => {
  let service;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
    service = new SkillsService(logger);
    service.initialized = false;
    service.indexCache = null;
  });

  test('constructor initializes with default state', () => {
    expect(service.initialized).toBe(false);
    expect(service.indexCache).toBeNull();
  });

  test('initialize sets up skillsDir and marks initialized', async () => {
    await service.initialize();
    expect(service.initialized).toBe(true);
    expect(service.skillsDir).toBe('/fake/skills');
  });

  test('initialize only runs once', async () => {
    await service.initialize();
    const { ensureUserDataDirs } = await import('../../utilities/userDataDir.js');
    const callCount = ensureUserDataDirs.mock.calls.length;
    await service.initialize();
    expect(ensureUserDataDirs.mock.calls.length).toBe(callCount);
  });

  test('initialize throws on failure', async () => {
    const { ensureUserDataDirs } = await import('../../utilities/userDataDir.js');
    service.initialized = false;
    ensureUserDataDirs.mockRejectedValueOnce(new Error('disk error'));
    await expect(service.initialize()).rejects.toThrow('disk error');
  });

  describe('validation', () => {
    test('_validateSkillName rejects empty names', () => {
      expect(() => service._validateSkillName('')).toThrow('required');
      expect(() => service._validateSkillName(null)).toThrow('required');
    });

    test('_validateSkillName rejects too long names', () => {
      expect(() => service._validateSkillName('a'.repeat(51))).toThrow('50 characters');
    });

    test('_validateSkillName rejects non-kebab-case', () => {
      expect(() => service._validateSkillName('MySkill')).toThrow('kebab-case');
      expect(() => service._validateSkillName('my_skill')).toThrow('kebab-case');
    });

    test('_validateSkillName accepts valid names', () => {
      expect(() => service._validateSkillName('my-skill')).not.toThrow();
      expect(() => service._validateSkillName('code-review')).not.toThrow();
      expect(() => service._validateSkillName('a1-b2')).not.toThrow();
    });

    test('_validatePathSafe rejects traversal paths', () => {
      service.skillsDir = '/fake/skills';
      expect(() => service._validatePathSafe('my-skill', '../../etc/passwd')).toThrow('within the skill directory');
    });

    test('_validatePathSafe accepts valid paths', () => {
      service.skillsDir = '/fake/skills';
      const result = service._validatePathSafe('my-skill', 'subdir/file.txt');
      expect(result).toContain('my-skill');
    });
  });

  describe('content analysis', () => {
    test('_extractDescription returns first non-heading line', () => {
      const content = '# Title\n\nThis is the description.\nMore text.';
      expect(service._extractDescription(content)).toBe('This is the description.');
    });

    test('_extractDescription returns empty for null', () => {
      expect(service._extractDescription(null)).toBe('');
    });

    test('_extractDescription truncates long descriptions', () => {
      const content = 'x'.repeat(250);
      const desc = service._extractDescription(content);
      expect(desc.length).toBeLessThanOrEqual(200);
      expect(desc).toContain('...');
    });

    test('_extractSections finds ## headings', () => {
      const content = '# Title\nIntro\n## Section A\nContent A\n## Section B\nContent B';
      const sections = service._extractSections(content);
      expect(sections).toHaveLength(2);
      expect(sections[0].heading).toBe('## Section A');
      expect(sections[1].heading).toBe('## Section B');
    });

    test('_extractSections returns empty for null', () => {
      expect(service._extractSections(null)).toEqual([]);
    });

    test('_computeSize counts bytes and lines', () => {
      const result = service._computeSize('line1\nline2\nline3');
      expect(result.lineCount).toBe(3);
      expect(result.sizeBytes).toBeGreaterThan(0);
    });

    test('_computeSize handles null', () => {
      const result = service._computeSize(null);
      expect(result.lineCount).toBe(0);
    });
  });

  describe('CRUD operations', () => {
    beforeEach(async () => {
      // Pre-initialize
      service.initialized = true;
      service.skillsDir = '/fake/skills';
    });

    test('listSkills returns mapped skill summaries', async () => {
      service.indexCache = {
        skills: {
          'my-skill': {
            name: 'my-skill',
            description: 'A skill',
            sections: ['## Setup'],
            sizeBytes: 100,
            lineCount: 10,
            files: ['skill.md'],
            createdAt: '2024-01-01',
            updatedAt: '2024-01-02'
          }
        }
      };
      const list = await service.listSkills();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('my-skill');
      expect(list[0].fileCount).toBe(1);
    });

    test('listSkills loads index when cache empty', async () => {
      service.indexCache = null;
      mockFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
      const list = await service.listSkills();
      expect(list).toEqual([]);
    });

    test('describeSkill returns detailed info', async () => {
      service.indexCache = {
        skills: {
          'my-skill': {
            name: 'my-skill',
            description: 'Desc',
            sections: ['## Setup'],
            files: ['skill.md'],
            createdAt: '2024-01-01',
            updatedAt: '2024-01-02'
          }
        }
      };
      mockFs.readFile.mockResolvedValueOnce('# Title\n## Setup\nContent');

      const info = await service.describeSkill('my-skill');
      expect(info.name).toBe('my-skill');
      expect(info.sections).toHaveLength(1);
    });

    test('describeSkill throws for unknown skill', async () => {
      service.indexCache = { skills: {} };
      await expect(service.describeSkill('unknown')).rejects.toThrow('not found');
    });

    test('readSkill returns content and files', async () => {
      service.indexCache = { skills: { 'my-skill': { description: 'Desc' } } };
      mockFs.readFile.mockResolvedValueOnce('# Skill content');
      mockFs.readdir.mockResolvedValueOnce([{ name: 'skill.md', isFile: () => true }]);

      const result = await service.readSkill('my-skill');
      expect(result.content).toBe('# Skill content');
      expect(result.name).toBe('my-skill');
    });

    test('readSkill throws for unknown skill', async () => {
      service.indexCache = { skills: {} };
      await expect(service.readSkill('unknown')).rejects.toThrow('not found');
    });

    test('readSkillSection returns matching section', async () => {
      service.indexCache = { skills: { 'my-skill': {} } };
      mockFs.readFile.mockResolvedValueOnce('# Title\nIntro\n## Setup\nSetup content\n## Usage\nUsage content');

      const result = await service.readSkillSection('my-skill', 'Setup');
      expect(result.section).toBe('## Setup');
      expect(result.content).toContain('Setup content');
    });

    test('readSkillSection throws for missing section', async () => {
      service.indexCache = { skills: { 'my-skill': {} } };
      mockFs.readFile.mockResolvedValueOnce('# Title\n## Setup\nContent');

      await expect(service.readSkillSection('my-skill', 'Missing')).rejects.toThrow('Section not found');
    });

    test('readSkillFile reads a file within skill directory', async () => {
      service.indexCache = { skills: { 'my-skill': {} } };
      mockFs.readFile.mockResolvedValueOnce('file content');

      const result = await service.readSkillFile('my-skill', 'data.json');
      expect(result.content).toBe('file content');
    });

    test('readSkillFile throws for missing file', async () => {
      service.indexCache = { skills: { 'my-skill': {} } };
      mockFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));

      await expect(service.readSkillFile('my-skill', 'missing.txt')).rejects.toThrow('File not found');
    });

    test('createSkill creates directory and writes files', async () => {
      service.indexCache = { skills: {} };
      mockFs.readdir.mockResolvedValueOnce([{ name: 'skill.md', isFile: () => true }]);

      const entry = await service.createSkill('new-skill', '# New Skill\nDescription text');
      expect(mockFs.mkdir).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(entry.name).toBe('new-skill');
    });

    test('createSkill throws for existing skill', async () => {
      service.indexCache = { skills: { 'existing': {} } };
      await expect(service.createSkill('existing', 'content')).rejects.toThrow('already exists');
    });

    test('createSkill handles additional files', async () => {
      service.indexCache = { skills: {} };
      mockFs.readdir.mockResolvedValueOnce([{ name: 'skill.md', isFile: () => true }]);

      await service.createSkill('my-skill', '# Skill', [
        { path: 'data.json', content: '{}' }
      ]);
      // writeFile called for skill.md, data.json, and index
      expect(mockFs.writeFile.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    test('updateSkill updates content', async () => {
      service.indexCache = {
        skills: {
          'my-skill': { name: 'my-skill', createdAt: '2024-01-01', description: 'Old' }
        }
      };
      mockFs.readdir.mockResolvedValueOnce([{ name: 'skill.md', isFile: () => true }]);

      const entry = await service.updateSkill('my-skill', '# Updated');
      expect(entry.createdAt).toBe('2024-01-01'); // Preserved
    });

    test('updateSkill reads existing content when not provided', async () => {
      service.indexCache = { skills: { 'my-skill': { createdAt: '2024-01-01', description: 'D' } } };
      mockFs.readFile.mockResolvedValueOnce('# Existing content');
      mockFs.readdir.mockResolvedValueOnce([{ name: 'skill.md', isFile: () => true }]);

      await service.updateSkill('my-skill');
      expect(mockFs.readFile).toHaveBeenCalled();
    });

    test('updateSkill throws for unknown skill', async () => {
      service.indexCache = { skills: {} };
      await expect(service.updateSkill('unknown', 'content')).rejects.toThrow('not found');
    });

    test('deleteSkill removes directory and index entry', async () => {
      service.indexCache = { skills: { 'my-skill': {} } };
      await service.deleteSkill('my-skill');
      expect(mockFs.rm).toHaveBeenCalled();
      expect(service.indexCache.skills['my-skill']).toBeUndefined();
    });

    test('deleteSkill throws for unknown skill', async () => {
      service.indexCache = { skills: {} };
      await expect(service.deleteSkill('unknown')).rejects.toThrow('not found');
    });

    test('getSkillSummaries returns matching summaries', async () => {
      service.indexCache = {
        skills: {
          'skill-a': { name: 'skill-a', description: 'A', sections: ['## S1'], lineCount: 5 },
          'skill-b': { name: 'skill-b', description: 'B', sections: [], lineCount: 10 }
        }
      };

      const summaries = await service.getSkillSummaries(['skill-a', 'skill-c']);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].name).toBe('skill-a');
    });
  });

  describe('importSkill', () => {
    beforeEach(() => {
      service.initialized = true;
      service.skillsDir = '/fake/skills';
    });

    test('imports a single file as skill.md', async () => {
      service.indexCache = { skills: {} };
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => false });
      mockFs.readFile.mockResolvedValueOnce('# Imported skill content');
      // second readFile for _buildIndexEntry
      mockFs.readFile.mockResolvedValueOnce('# Imported skill content');
      mockFs.readdir.mockResolvedValueOnce([{ name: 'skill.md', isFile: () => true }]);

      const entry = await service.importSkill('/path/to/my-file.md', 'imported-skill');
      expect(entry.name).toBe('imported-skill');
    });

    test('throws for non-existent source', async () => {
      service.indexCache = { skills: {} };
      mockFs.stat.mockRejectedValueOnce(new Error('ENOENT'));

      await expect(service.importSkill('/missing/path')).rejects.toThrow('not found');
    });

    test('throws for duplicate skill name', async () => {
      service.indexCache = { skills: { 'existing': {} } };
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => false });

      await expect(service.importSkill('/path/file.md', 'existing')).rejects.toThrow('already exists');
    });

    test('derives skill name from source path', async () => {
      service.indexCache = { skills: {} };
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => false });
      mockFs.readFile.mockResolvedValueOnce('content');
      mockFs.readFile.mockResolvedValueOnce('content');
      mockFs.readdir.mockResolvedValueOnce([{ name: 'skill.md', isFile: () => true }]);

      const entry = await service.importSkill('/path/to/My Cool Skill.md');
      // Should be kebab-cased
      expect(entry.name).toMatch(/^[a-z0-9-]+$/);
    });

    test('imports directory with skill.md', async () => {
      service.indexCache = { skills: {} };
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true });
      // _copyDir
      mockFs.readdir.mockResolvedValueOnce([
        { name: 'skill.md', isFile: () => true, isDirectory: () => false },
        { name: 'data.json', isFile: () => true, isDirectory: () => false }
      ]);
      // access check
      mockFs.access.mockResolvedValueOnce(undefined);
      // readFile for _buildIndexEntry
      mockFs.readFile.mockResolvedValueOnce('# Dir skill');
      // _listSkillFiles
      mockFs.readdir.mockResolvedValueOnce([
        { name: 'skill.md', isFile: () => true },
        { name: 'data.json', isFile: () => true }
      ]);

      const entry = await service.importSkill('/path/skill-dir', 'dir-skill');
      expect(entry.name).toBe('dir-skill');
    });

    test('imports directory without skill.md throws', async () => {
      service.indexCache = { skills: {} };
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true });
      mockFs.readdir.mockResolvedValueOnce([]);
      mockFs.access.mockRejectedValueOnce(new Error('ENOENT'));

      await expect(service.importSkill('/path/no-skill', 'bad-import')).rejects.toThrow('must contain a skill.md');
    });
  });
});
