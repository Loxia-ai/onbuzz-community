/**
 * Tests for the restricted-toolset runtime gate in MessageProcessor.
 *
 * Background
 * ----------
 * agent.capabilities in this codebase is a system-prompt hint only; it
 * does NOT block tool dispatch at runtime. The Quick Send agent (driven
 * by the browser extension) carries a separate, authoritative allowlist
 * at agent.metadata.restrictedToolset, plumbed through executeTools as
 * context.restrictedToolset. This file pins down the gate's behaviour:
 *
 *   1. No metadata → existing behaviour unchanged (the change is purely
 *      additive for agents that don't opt in).
 *   2. Allowed tool runs normally.
 *   3. Blocked tool is denied before either sync or async dispatch.
 *   4. The Quick Send agent config carries the restrictedToolset
 *      metadata (so the gate has something to enforce).
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import {
  createMockLogger,
  createMockConfig,
  createMockAiService
} from '../../__test-utils__/mockFactories.js';

// Match the import-mocks used by messageProcessor.test.js so the module
// graph loads identically.
jest.unstable_mockModule('../../services/visualEditorBridge.js', () => ({
  getVisualEditorBridge: jest.fn(() => ({
    isEnabled: () => false,
    hasInstance: () => false
  })),
  InstanceStatus: { IDLE: 'idle', RUNNING: 'running', ERROR: 'error' }
}));

jest.unstable_mockModule('../../utilities/tagParser.js', () => ({
  default: jest.fn().mockImplementation(() => ({
    extractToolCommands: jest.fn().mockReturnValue([]),
    normalizeToolCommand: jest.fn((cmd) => cmd),
    extractAgentRedirects: jest.fn().mockReturnValue([]),
    parseXMLParameters: jest.fn().mockReturnValue({}),
    decodeHtmlEntities: jest.fn((s) => s)
  }))
}));

jest.unstable_mockModule('../../tools/visualEditorTool.js', () => ({
  VisualEditorTool: { injectContextIntoMessage: jest.fn((msg) => msg) }
}));

const { default: MessageProcessor } = await import('../messageProcessor.js');
const {
  QUICK_SEND_ALLOWED_TOOLS,
  QUICK_SEND_AGENT_NAME,
  RESTRICTED_TOOLSET_KEY,
  buildQuickSendAgentConfig,
  diffQuickSendPolicy
} = await import('../../services/quickSendPolicy.js');

function makeMP(overrides = {}) {
  const config = createMockConfig(overrides.config);
  const logger = createMockLogger();
  const toolsRegistry = overrides.toolsRegistry || {
    getTool: jest.fn().mockReturnValue(null)
  };
  const agentPool = {
    getAgent: jest.fn().mockResolvedValue(null),
    addUserMessage: jest.fn().mockResolvedValue(undefined),
    addInterAgentMessage: jest.fn().mockResolvedValue(undefined),
    addToolResult: jest.fn().mockResolvedValue(undefined),
    persistAgentState: jest.fn().mockResolvedValue(undefined)
  };
  const contextManager = { getContext: jest.fn() };
  const aiService = createMockAiService();

  const mp = new MessageProcessor(
    config, logger, toolsRegistry, agentPool, contextManager, aiService
  );
  return { mp, logger, toolsRegistry, agentPool };
}

describe('MessageProcessor — restricted-toolset gate', () => {
  let mp, toolsRegistry, logger;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ mp, toolsRegistry, logger } = makeMP());
  });

  // (1) No metadata → existing behaviour unchanged.
  describe('without restrictedToolset', () => {
    test('runs a tool when context has no restrictedToolset (undefined)', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);

      const results = await mp.executeTools(
        [{ toolId: 'terminal', parameters: { cmd: 'ls' }, isAsync: false }],
        { agentId: 'a1' /* no restrictedToolset */ }
      );

      expect(mockTool.execute).toHaveBeenCalledTimes(1);
      expect(results[0].status).toBe('completed');
    });

    test('runs a tool when restrictedToolset is null', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);

      const results = await mp.executeTools(
        [{ toolId: 'filesystem', parameters: {}, isAsync: false }],
        { agentId: 'a1', restrictedToolset: null }
      );

      expect(mockTool.execute).toHaveBeenCalledTimes(1);
      expect(results[0].status).toBe('completed');
    });

    test('non-array restrictedToolset is treated as "no policy" (defensive)', async () => {
      // Defensive: only an Array enables the gate. A stray string, an
      // object, or `true` must NOT be misread as an allowlist of length 1.
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);

      for (const bad of ['web', { web: true }, true, 42]) {
        mockTool.execute.mockClear();
        const results = await mp.executeTools(
          [{ toolId: 'terminal', parameters: {}, isAsync: false }],
          { agentId: 'a1', restrictedToolset: bad }
        );
        expect(mockTool.execute).toHaveBeenCalledTimes(1);
        expect(results[0].status).toBe('completed');
      }
    });
  });

  // (2) Allowed tool runs.
  describe('with restrictedToolset — allowed', () => {
    test('runs a tool that is in the allowlist', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ pages: 3 }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);

      const results = await mp.executeTools(
        [{ toolId: 'web', parameters: { url: 'https://example.com' }, isAsync: false }],
        { agentId: 'a1', restrictedToolset: ['web', 'pdf'] }
      );

      expect(mockTool.execute).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('completed');
      expect(results[0].result).toEqual({ pages: 3 });
    });
  });

  // (3) Blocked tool is denied.
  describe('with restrictedToolset — denied', () => {
    test('synchronous: tool NOT in the allowlist is refused without dispatching', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);

      const results = await mp.executeTools(
        [{ toolId: 'terminal', parameters: { cmd: 'rm -rf /' }, isAsync: false }],
        { agentId: 'a1', restrictedToolset: ['web', 'pdf'] }
      );

      expect(mockTool.execute).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('failed');
      expect(results[0].toolId).toBe('terminal');
      expect(results[0].error).toMatch(/not permitted/i);
      expect(results[0].error).toContain('web');
      expect(results[0].error).toContain('pdf');
      // The denial is also surfaced to the logger so an operator can see it.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/restricted-toolset/i),
        expect.objectContaining({ toolId: 'terminal' })
      );
    });

    test('asynchronous: marking the command isAsync does NOT bypass the gate', async () => {
      // This is the failure mode I most want to lock in: someone (or the
      // LLM) could try `isAsync: true` to slip a blocked tool past a
      // pre-sync-only gate. The gate runs before either branch.
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);

      const results = await mp.executeTools(
        [{ toolId: 'filesystem', parameters: {}, isAsync: true }],
        { agentId: 'a1', restrictedToolset: ['web'] }
      );

      expect(mockTool.execute).not.toHaveBeenCalled();
      expect(results[0].status).toBe('failed');
      expect(results[0].error).toMatch(/not permitted/i);
    });

    test('empty allowlist denies every tool', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);

      const results = await mp.executeTools(
        [{ toolId: 'web', parameters: {}, isAsync: false }],
        { agentId: 'a1', restrictedToolset: [] }
      );

      expect(mockTool.execute).not.toHaveBeenCalled();
      expect(results[0].status).toBe('failed');
    });

    test('mixed batch: allowed tools run, blocked tools are denied independently', async () => {
      const webTool = { execute: jest.fn().mockResolvedValue({ from: 'web' }) };
      const termTool = { execute: jest.fn().mockResolvedValue({ from: 'terminal' }) };
      toolsRegistry.getTool.mockImplementation((id) =>
        id === 'web' ? webTool : id === 'terminal' ? termTool : null
      );

      const results = await mp.executeTools(
        [
          { toolId: 'web', parameters: {}, isAsync: false },
          { toolId: 'terminal', parameters: {}, isAsync: false }
        ],
        { agentId: 'a1', restrictedToolset: ['web'] }
      );

      expect(webTool.execute).toHaveBeenCalledTimes(1);
      expect(termTool.execute).not.toHaveBeenCalled();
      expect(results.map((r) => r.status)).toEqual(['completed', 'failed']);
      expect(results[1].error).toMatch(/not permitted/i);
    });
  });
});

// ── Policy module ────────────────────────────────────────────────
describe('quickSendPolicy — agent metadata', () => {
  test('buildQuickSendAgentConfig produces an agent with the allowlist in BOTH capabilities and metadata.restrictedToolset', async () => {
    const cfg = buildQuickSendAgentConfig('anthropic-sonnet');

    expect(cfg.name).toBe(QUICK_SEND_AGENT_NAME);
    expect(cfg.model).toBe('anthropic-sonnet');

    // capabilities matches the allowlist exactly (no extras, no
    // omissions). The order should also match so the system-prompt
    // enhancement reads the same on every boot.
    expect(cfg.capabilities).toEqual([...QUICK_SEND_ALLOWED_TOOLS]);

    // metadata carries the authoritative allowlist under the key the
    // runtime gate reads.
    expect(cfg.metadata).toBeDefined();
    expect(cfg.metadata[RESTRICTED_TOOLSET_KEY]).toEqual([...QUICK_SEND_ALLOWED_TOOLS]);

    // Hand-checked allowlist contents — adding to this should be a
    // deliberate decision, so this assertion forces a test update.
    expect(QUICK_SEND_ALLOWED_TOOLS).toEqual(['web', 'pdf', 'memory', 'skills', 'help', 'user-prompt']);

    // The allowlist must NOT contain anything destructive.
    for (const blocked of ['terminal', 'filesystem', 'file-content-replace',
                            'agentcommunication', 'taskmanager', 'jobdone',
                            'platformcontrol', 'dependency-resolver']) {
      expect(cfg.metadata[RESTRICTED_TOOLSET_KEY]).not.toContain(blocked);
      expect(cfg.capabilities).not.toContain(blocked);
    }
  });

  test('diffQuickSendPolicy returns null when the agent is already conformant', () => {
    const conformant = {
      capabilities: [...QUICK_SEND_ALLOWED_TOOLS],
      metadata: {
        [RESTRICTED_TOOLSET_KEY]: [...QUICK_SEND_ALLOWED_TOOLS],
        unrelated: 'keep-me'
      }
    };
    expect(diffQuickSendPolicy(conformant)).toBeNull();
  });

  test('diffQuickSendPolicy proposes the allowlist when metadata is missing', () => {
    const drifted = { capabilities: [...QUICK_SEND_ALLOWED_TOOLS], metadata: {} };
    const updates = diffQuickSendPolicy(drifted);
    expect(updates).not.toBeNull();
    expect(updates.metadata[RESTRICTED_TOOLSET_KEY]).toEqual([...QUICK_SEND_ALLOWED_TOOLS]);
  });

  test('diffQuickSendPolicy proposes the allowlist when capabilities drifted', () => {
    const drifted = {
      capabilities: ['terminal', 'filesystem'], // admin tried to relax it
      metadata: { [RESTRICTED_TOOLSET_KEY]: [...QUICK_SEND_ALLOWED_TOOLS] }
    };
    const updates = diffQuickSendPolicy(drifted);
    expect(updates).not.toBeNull();
    expect(updates.capabilities).toEqual([...QUICK_SEND_ALLOWED_TOOLS]);
  });

  test('diffQuickSendPolicy preserves unrelated metadata keys when proposing updates', () => {
    const drifted = {
      capabilities: [],
      metadata: { icon: 'rocket', color: 'blue' }
    };
    const updates = diffQuickSendPolicy(drifted);
    expect(updates.metadata.icon).toBe('rocket');
    expect(updates.metadata.color).toBe('blue');
    expect(updates.metadata[RESTRICTED_TOOLSET_KEY]).toEqual([...QUICK_SEND_ALLOWED_TOOLS]);
  });

  test('diffQuickSendPolicy returns null for a null agent (defensive)', () => {
    expect(diffQuickSendPolicy(null)).toBeNull();
    expect(diffQuickSendPolicy(undefined)).toBeNull();
  });
});
