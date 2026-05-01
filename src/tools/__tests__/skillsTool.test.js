import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock the skills service
const mockSkillsService = {
  initialize: jest.fn().mockResolvedValue(undefined),
  listSkills: jest.fn().mockResolvedValue([{ name: 'code-review', description: 'Code review' }]),
  describeSkill: jest.fn().mockResolvedValue({ name: 'code-review', sections: [] }),
  readSkill: jest.fn().mockResolvedValue({ name: 'code-review', content: '# Code Review' }),
  readSkillSection: jest.fn().mockResolvedValue({ content: 'Section content' }),
  readSkillFile: jest.fn().mockResolvedValue({ content: 'file content' }),
  createSkill: jest.fn().mockResolvedValue({ name: 'new-skill' }),
  updateSkill: jest.fn().mockResolvedValue({ name: 'updated-skill' }),
  deleteSkill: jest.fn().mockResolvedValue(undefined),
  importSkill: jest.fn().mockResolvedValue({ name: 'imported-skill' })
};

jest.unstable_mockModule('../../services/skillsService.js', () => ({
  getSkillsService: jest.fn().mockReturnValue(mockSkillsService)
}));

jest.unstable_mockModule('../../utilities/toolConstants.js', () => ({
  SKILLS_ACTIONS: {
    LIST: 'list',
    DESCRIBE: 'describe',
    READ: 'read',
    READ_SECTION: 'read-section',
    READ_FILE: 'read-file',
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    IMPORT: 'import'
  }
}));

const { default: SkillsTool } = await import('../skillsTool.js');

describe('SkillsTool', () => {
  let tool;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    tool = new SkillsTool({}, logger);
    tool.skillsService = null; // Reset so _ensureSkillsService re-initializes
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should set correct metadata', () => {
      expect(tool.requiresProject).toBe(false);
      expect(tool.isAsync).toBe(false);
      expect(tool.timeout).toBe(30000);
      expect(tool.skillsService).toBeNull();
    });
  });

  describe('getDescription', () => {
    test('should return description with all actions', () => {
      const desc = tool.getDescription();
      expect(desc).toContain('Skills Tool');
      expect(desc).toContain('list');
      expect(desc).toContain('describe');
      expect(desc).toContain('read');
      expect(desc).toContain('create');
      expect(desc).toContain('delete');
      expect(desc).toContain('import');
    });
  });

  describe('parseParameters', () => {
    test('should return content as-is', () => {
      const result = tool.parseParameters('test');
      expect(result).toBe('test');
    });
  });

  describe('getRequiredParameters', () => {
    test('should require action', () => {
      expect(tool.getRequiredParameters()).toContain('action');
    });
  });

  describe('getSupportedActions', () => {
    test('should return all skill actions', () => {
      const actions = tool.getSupportedActions();
      expect(actions).toContain('list');
      expect(actions).toContain('describe');
      expect(actions).toContain('read');
      expect(actions).toContain('create');
      expect(actions).toContain('delete');
      expect(actions).toContain('import');
    });
  });

  describe('validateParameterTypes', () => {
    test('should reject non-string action', () => {
      const errors = tool.validateParameterTypes({ action: 123 });
      expect(errors).toContain('action must be a string');
    });

    test('should reject non-string name', () => {
      const errors = tool.validateParameterTypes({ name: 123 });
      expect(errors).toContain('name must be a string');
    });

    test('should accept valid params', () => {
      const errors = tool.validateParameterTypes({ action: 'list' });
      expect(errors).toHaveLength(0);
    });
  });

  describe('customValidateParameters', () => {
    test('should reject invalid action', () => {
      const errors = tool.customValidateParameters({ action: 'invalid' });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Invalid action');
    });

    test('should require name for describe', () => {
      const errors = tool.customValidateParameters({ action: 'describe' });
      expect(errors).toContain('"name" is required for action "describe"');
    });

    test('should require content for create', () => {
      const errors = tool.customValidateParameters({ action: 'create', name: 'test' });
      expect(errors).toContain('"content" is required for action "create"');
    });

    test('should require section for read-section', () => {
      const errors = tool.customValidateParameters({ action: 'read-section', name: 'test' });
      expect(errors).toContain('"section" is required for action "read-section"');
    });

    test('should require file for read-file', () => {
      const errors = tool.customValidateParameters({ action: 'read-file', name: 'test' });
      expect(errors).toContain('"file" is required for action "read-file"');
    });

    test('should require source for import', () => {
      const errors = tool.customValidateParameters({ action: 'import' });
      expect(errors).toContain('"source" is required for action "import"');
    });

    test('should accept valid list params', () => {
      const errors = tool.customValidateParameters({ action: 'list' });
      expect(errors).toHaveLength(0);
    });
  });

  describe('execute', () => {
    test('should list skills', async () => {
      const result = await tool.execute({ action: 'list' });
      expect(result.success).toBe(true);
      expect(result.message).toContain('listed');
    });

    test('should describe a skill', async () => {
      const result = await tool.execute({ action: 'describe', name: 'code-review' });
      expect(result.success).toBe(true);
      expect(mockSkillsService.describeSkill).toHaveBeenCalledWith('code-review');
    });

    test('should read a skill', async () => {
      const result = await tool.execute({ action: 'read', name: 'code-review' });
      expect(result.success).toBe(true);
      expect(mockSkillsService.readSkill).toHaveBeenCalledWith('code-review');
    });

    test('should read a section', async () => {
      const result = await tool.execute({ action: 'read-section', name: 'code-review', section: 'Checklist' });
      expect(result.success).toBe(true);
      expect(mockSkillsService.readSkillSection).toHaveBeenCalledWith('code-review', 'Checklist');
    });

    test('should read a file', async () => {
      const result = await tool.execute({ action: 'read-file', name: 'templates', file: 'welcome.html' });
      expect(result.success).toBe(true);
      expect(mockSkillsService.readSkillFile).toHaveBeenCalledWith('templates', 'welcome.html');
    });

    test('should create a skill', async () => {
      const result = await tool.execute({ action: 'create', name: 'new', content: '# New' });
      expect(result.success).toBe(true);
      expect(mockSkillsService.createSkill).toHaveBeenCalled();
    });

    test('should update a skill', async () => {
      const result = await tool.execute({ action: 'update', name: 'existing', content: '# Updated' });
      expect(result.success).toBe(true);
    });

    test('should delete a skill', async () => {
      const result = await tool.execute({ action: 'delete', name: 'old' });
      expect(result.success).toBe(true);
      expect(result.result.deleted).toBe('old');
    });

    test('should import a skill', async () => {
      const result = await tool.execute({ action: 'import', source: '/path/to/skill' });
      expect(result.success).toBe(true);
    });

    test('should return error for unknown action', async () => {
      const result = await tool.execute({ action: 'unknown' });
      expect(result.success).toBe(false);
    });

    test('should handle service errors', async () => {
      mockSkillsService.readSkill.mockRejectedValueOnce(new Error('Skill not found'));
      const result = await tool.execute({ action: 'read', name: 'nonexistent' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getParameterSchema', () => {
    test('should return valid schema', () => {
      const schema = tool.getParameterSchema();
      expect(schema.type).toBe('object');
      expect(schema.required).toContain('action');
      expect(schema.properties.action).toBeDefined();
      expect(schema.properties.name).toBeDefined();
    });
  });
});
