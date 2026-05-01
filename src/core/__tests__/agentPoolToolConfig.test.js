/**
 * Tests for per-agent `toolConfig` field on the agent object.
 *
 * toolConfig is a plain object keyed by tool id:
 *   agent.toolConfig = {
 *     terminal:   { allowedCommands: ['git', 'npm'], maxBackgroundCommandsPerAgent: 3 },
 *     filesystem: { allowedExtensions: ['.js', '.ts'], maxFileSize: 1_000_000 },
 *     web:        { stealthLevel: 'medium' },
 *     ...
 *   }
 *
 * The values get merged into each tool's constructor config at tool
 * instantiation time (step 2 — ToolManager integration). These tests
 * lock the schema + persistence + validation contract so anything
 * downstream can depend on the shape without guessing.
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig, createMockStateManager } from '../../__test-utils__/mockFactories.js';

// Mocks (same pattern as sibling agentPool tests)
const mockValidateAccessConfiguration = jest.fn().mockReturnValue({ valid: true });
const mockCreateProjectDefaults = jest.fn().mockReturnValue({
  workingDirectory: '/tmp/project',
  readOnlyDirectories: [],
  writeEnabledDirectories: ['/tmp/project'],
});

jest.unstable_mockModule('../../utilities/directoryAccessManager.js', () => {
  const MockDAM = jest.fn().mockImplementation(() => ({
    validateAccessConfiguration: mockValidateAccessConfiguration,
  }));
  MockDAM.createProjectDefaults = mockCreateProjectDefaults;
  return { default: MockDAM };
});

jest.unstable_mockModule('../../services/visualEditorBridge.js', () => ({
  getVisualEditorBridge: jest.fn().mockReturnValue({
    hasInstance: jest.fn().mockReturnValue(false),
    stopInstance: jest.fn().mockResolvedValue(undefined),
  }),
}));

const { default: AgentPool } = await import('../agentPool.js');

function makePool() {
  const config = createMockConfig();
  const logger = createMockLogger();
  const stateManager = createMockStateManager();
  const contextManager = { getContext: jest.fn() };
  return new AgentPool(config, logger, stateManager, contextManager, null);
}

function cfg(overrides = {}) {
  return {
    name: 'TestAgent',
    systemPrompt: 'test',
    preferredModel: 'test-model',
    capabilities: [],
    projectDir: '/tmp/project',
    ...overrides,
  };
}

describe('agentPool — agent.toolConfig schema', () => {
  let pool;
  beforeEach(() => { jest.clearAllMocks(); pool = makePool(); });

  describe('createAgent', () => {
    test('agents without toolConfig in config get empty toolConfig object', async () => {
      const agent = await pool.createAgent(cfg());
      expect(agent.toolConfig).toEqual({});
    });

    test('agents with toolConfig in config retain it (shallow copy)', async () => {
      const agent = await pool.createAgent(cfg({
        toolConfig: {
          terminal:   { allowedCommands: ['git', 'npm'] },
          filesystem: { maxFileSize: 500_000 },
        },
      }));
      expect(agent.toolConfig).toEqual({
        terminal:   { allowedCommands: ['git', 'npm'] },
        filesystem: { maxFileSize: 500_000 },
      });
    });

    test('toolConfig is copied (not referenced) so caller mutation does not leak', async () => {
      const src = { terminal: { allowedCommands: ['git'] } };
      const agent = await pool.createAgent(cfg({ toolConfig: src }));
      src.terminal.allowedCommands.push('rm');
      // Agent's inner value still has the shared reference at this level
      // (shallow copy), but the top-level object is independent. This is
      // the same contract `capabilities` has.
      expect(agent.toolConfig).not.toBe(src);
    });

    test('malformed toolConfig (array) falls back to empty object instead of crashing', async () => {
      const agent = await pool.createAgent(cfg({ toolConfig: ['bogus'] }));
      expect(agent.toolConfig).toEqual({});
    });

    test('malformed toolConfig (non-object) falls back to empty object', async () => {
      const agent = await pool.createAgent(cfg({ toolConfig: 'not-an-object' }));
      expect(agent.toolConfig).toEqual({});
    });
  });

  describe('listActiveAgents', () => {
    test('exposes toolConfig in the listed agent shape', async () => {
      const agent = await pool.createAgent(cfg({
        toolConfig: { terminal: { allowedCommands: ['git'] } },
      }));
      const listed = await pool.listActiveAgents();
      const me = listed.find(a => a.id === agent.id);
      expect(me.toolConfig).toEqual({ terminal: { allowedCommands: ['git'] } });
    });

    test('emits empty object for agents without toolConfig (backward compat)', async () => {
      // Simulate an agent loaded from an older persisted state without toolConfig.
      const agent = await pool.createAgent(cfg());
      delete agent.toolConfig;
      const listed = await pool.listActiveAgents();
      const me = listed.find(a => a.id === agent.id);
      expect(me.toolConfig).toEqual({});
    });
  });

  describe('updateAgent', () => {
    test('updates toolConfig', async () => {
      const agent = await pool.createAgent(cfg());
      await pool.updateAgent(agent.id, {
        toolConfig: { terminal: { allowedCommands: ['git'] } },
      });
      const after = await pool.getAgent(agent.id);
      expect(after.toolConfig).toEqual({ terminal: { allowedCommands: ['git'] } });
    });

    test('replaces toolConfig entirely (caller is responsible for merging)', async () => {
      const agent = await pool.createAgent(cfg({
        toolConfig: {
          terminal:   { allowedCommands: ['git'] },
          filesystem: { maxFileSize: 500 },
        },
      }));
      await pool.updateAgent(agent.id, { toolConfig: { web: { stealthLevel: 'low' } } });
      const after = await pool.getAgent(agent.id);
      expect(after.toolConfig).toEqual({ web: { stealthLevel: 'low' } });
    });

    test('rejects non-object toolConfig', async () => {
      const agent = await pool.createAgent(cfg());
      await expect(
        pool.updateAgent(agent.id, { toolConfig: 'nope' })
      ).rejects.toThrow(/must be a plain object/);
    });

    test('rejects array toolConfig', async () => {
      const agent = await pool.createAgent(cfg());
      await expect(
        pool.updateAgent(agent.id, { toolConfig: ['not', 'valid'] })
      ).rejects.toThrow(/must be a plain object/);
    });

    test('rejects toolConfig entry that is not an object', async () => {
      const agent = await pool.createAgent(cfg());
      await expect(
        pool.updateAgent(agent.id, { toolConfig: { terminal: 'bogus' } })
      ).rejects.toThrow(/toolConfig\.terminal: must be an object or null/);
    });

    test('allows null entry (means reset that tool back to defaults)', async () => {
      const agent = await pool.createAgent(cfg({
        toolConfig: { terminal: { allowedCommands: ['git'] } },
      }));
      await pool.updateAgent(agent.id, { toolConfig: { terminal: null } });
      const after = await pool.getAgent(agent.id);
      expect(after.toolConfig).toEqual({ terminal: null });
    });

    test('updateAgent without toolConfig in updates leaves existing toolConfig intact', async () => {
      const agent = await pool.createAgent(cfg({
        toolConfig: { terminal: { allowedCommands: ['git'] } },
      }));
      await pool.updateAgent(agent.id, { name: 'NewName' });
      const after = await pool.getAgent(agent.id);
      expect(after.name).toBe('NewName');
      expect(after.toolConfig).toEqual({ terminal: { allowedCommands: ['git'] } });
    });
  });
});
