import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock TagParser before importing HelpTool
jest.unstable_mockModule('../../utilities/tagParser.js', () => ({
  default: {
    extractContent: jest.fn((content, tag) => {
      const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, 'gs');
      const matches = [];
      let match;
      while ((match = regex.exec(content)) !== null) {
        matches.push(match[1]);
      }
      return matches;
    })
  }
}));

const { default: HelpTool } = await import('../helpTool.js');

describe('HelpTool', () => {
  let tool;
  let logger;
  let config;

  beforeEach(() => {
    logger = createMockLogger();
    config = createMockConfig();
    tool = new HelpTool(config, logger);
  });

  describe('constructor', () => {
    test('should set correct id and metadata', () => {
      expect(tool.id).toBe('help');
      expect(tool.name).toBe('Help Tool');
      expect(tool.version).toBe('1.0.0');
      expect(tool.requiresProject).toBe(false);
      expect(tool.isAsync).toBe(false);
      expect(tool.toolsRegistry).toBeNull();
    });
  });

  describe('getDescription', () => {
    test('should return non-empty description string', () => {
      const desc = tool.getDescription();
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(0);
      expect(desc).toContain('Help Tool');
      expect(desc).toContain('toolId');
    });
  });

  describe('setToolsRegistry', () => {
    test('should set the registry reference', () => {
      const mockRegistry = { getTool: jest.fn() };
      tool.setToolsRegistry(mockRegistry);
      expect(tool.toolsRegistry).toBe(mockRegistry);
    });
  });

  describe('getSupportedActions', () => {
    test('should return expected actions', () => {
      const actions = tool.getSupportedActions();
      expect(actions).toContain('get-description');
      expect(actions).toContain('list-tools');
    });
  });

  describe('parseParameters', () => {
    test('should parse tool name from tags', () => {
      const result = tool.parseParameters('<tool>filesystem</tool>');
      expect(result.tool).toBe('filesystem');
      expect(result.list).toBe(false);
    });

    test('should parse list=true from tags', () => {
      const result = tool.parseParameters('<list>true</list>');
      expect(result.list).toBe(true);
      expect(result.tool).toBeNull();
    });

    test('should return defaults when no tags found', () => {
      const result = tool.parseParameters('some random content');
      expect(result.tool).toBeNull();
      expect(result.list).toBe(false);
    });
  });

  describe('execute', () => {
    test('should return error when toolsRegistry is not set', async () => {
      const result = await tool.execute({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not properly initialized');
    });

    test('should return error when no tool specified and list is false', async () => {
      tool.setToolsRegistry({ getTool: jest.fn(), listTools: jest.fn() });
      const result = await tool.execute({ tool: null, list: false });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No tool specified');
    });

    test('should list tools when list=true', async () => {
      const mockRegistry = {
        getTool: jest.fn().mockReturnValue({ isEnabled: true }),
        listTools: jest.fn().mockReturnValue(['filesystem', 'terminal']),
        toolSummaries: new Map([
          ['filesystem', 'File operations'],
          ['terminal', 'Run commands']
        ])
      };
      tool.setToolsRegistry(mockRegistry);

      const result = await tool.execute({ list: true });
      expect(result.success).toBe(true);
      expect(result.action).toBe('list-tools');
      expect(result.tools).toHaveLength(2);
      expect(result.output).toContain('filesystem');
      expect(result.output).toContain('terminal');
    });

    test('should list tools with disabled indicator', async () => {
      const mockRegistry = {
        getTool: jest.fn().mockReturnValue({ isEnabled: false }),
        listTools: jest.fn().mockReturnValue(['web']),
        toolSummaries: new Map([['web', 'Web browsing']])
      };
      tool.setToolsRegistry(mockRegistry);

      const result = await tool.execute({ list: true });
      expect(result.output).toContain('(disabled)');
    });

    test('should get tool description for valid tool', async () => {
      const mockTool = {
        getDescription: jest.fn().mockReturnValue('Full description of filesystem'),
        getCapabilities: jest.fn().mockReturnValue({
          supportedActions: ['read', 'write'],
          async: false,
          requiresProject: true
        })
      };
      const mockRegistry = {
        getTool: jest.fn().mockReturnValue(mockTool),
        listTools: jest.fn().mockReturnValue(['filesystem'])
      };
      tool.setToolsRegistry(mockRegistry);

      const result = await tool.execute({ tool: 'filesystem' });
      expect(result.success).toBe(true);
      expect(result.action).toBe('get-description');
      expect(result.toolId).toBe('filesystem');
      expect(result.output).toContain('FILESYSTEM TOOL');
      expect(result.output).toContain('read, write');
    });

    test('should return error for unknown tool', async () => {
      const mockRegistry = {
        getTool: jest.fn().mockReturnValue(null),
        listTools: jest.fn().mockReturnValue(['filesystem', 'terminal'])
      };
      tool.setToolsRegistry(mockRegistry);

      const result = await tool.execute({ tool: 'nonexistent' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool not found');
      expect(result.output).toContain('nonexistent');
      expect(result.output).toContain('filesystem, terminal');
    });

    test('should handle nested parameters format', async () => {
      const mockTool = {
        getDescription: jest.fn().mockReturnValue('desc'),
        getCapabilities: jest.fn().mockReturnValue({
          supportedActions: ['execute'],
          async: false,
          requiresProject: false
        })
      };
      const mockRegistry = {
        getTool: jest.fn().mockReturnValue(mockTool),
        listTools: jest.fn()
      };
      tool.setToolsRegistry(mockRegistry);

      const result = await tool.execute({ parameters: { tool: 'terminal' } });
      expect(result.success).toBe(true);
      expect(mockRegistry.getTool).toHaveBeenCalledWith('terminal');
    });

    test('should handle nested list parameter', async () => {
      const mockRegistry = {
        getTool: jest.fn().mockReturnValue({ isEnabled: true }),
        listTools: jest.fn().mockReturnValue([]),
        toolSummaries: new Map()
      };
      tool.setToolsRegistry(mockRegistry);

      const result = await tool.execute({ parameters: { list: true } });
      expect(result.success).toBe(true);
      expect(result.action).toBe('list-tools');
    });
  });
});
