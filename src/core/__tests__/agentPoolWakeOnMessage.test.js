/**
 * Regression tests: an inbound message (user / inter-agent / tool-result)
 * MUST wake the recipient out of any paused or delayed state.
 *
 * This was previously fixed only for addUserMessage; addInterAgentMessage
 * and addToolResult silently queued into paused/delayed agents, so the
 * recipient never acted on the incoming message until the back-off
 * naturally expired. These tests lock the shared-helper implementation so
 * the invariant "inbound message always wins over delay/pause" cannot
 * regress again by patching one path and forgetting the others.
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig, createMockStateManager } from '../../__test-utils__/mockFactories.js';

// ── Mocks ───────────────────────────────────────────────────────────────────
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

// ── Helpers ─────────────────────────────────────────────────────────────────
function makePool(overrides = {}) {
  const config = createMockConfig(overrides.config);
  const logger = createMockLogger();
  const stateManager = createMockStateManager();
  const contextManager = { getContext: jest.fn() };
  const pool = new AgentPool(config, logger, stateManager, contextManager, null);
  return { pool, logger };
}

function agentCfg(overrides = {}) {
  return {
    name: 'TestAgent',
    systemPrompt: 'You are a test agent.',
    preferredModel: 'test-model',
    capabilities: [],
    projectDir: '/tmp/project',
    ...overrides,
  };
}

/** Stamp a future delay directly on the agent (mimics scheduler back-off). */
function setDelay(agent, msFromNow = 60_000) {
  agent.delayEndTime = new Date(Date.now() + msFromNow).toISOString();
}

function makeScheduler() {
  return {
    addAgent: jest.fn().mockResolvedValue(undefined),
    removeAgent: jest.fn(),
    isAgentInScheduler: jest.fn().mockReturnValue(false),
    broadcastAgentStateUpdate: jest.fn().mockResolvedValue(undefined),
  };
}

// ────────────────────────────────────────────────────────────────────────
// addUserMessage — locks existing behaviour including delay-clear (the
// original fix covered auto-resume but the delay-clear assertion lived in
// a different test file; we consolidate both guarantees here).
// ────────────────────────────────────────────────────────────────────────

describe('agentPool.addUserMessage — wake-on-message', () => {
  test('clears future delayEndTime', async () => {
    const { pool } = makePool();
    const agent = await pool.createAgent(agentCfg());
    setDelay(agent, 30_000);

    await pool.addUserMessage(agent.id, { content: 'wake me' });

    expect(agent.delayEndTime).toBeNull();
    expect(agent.messageQueues.userMessages).toHaveLength(1);
  });

  test('past delayEndTime is left alone (no spurious broadcast)', async () => {
    const { pool } = makePool();
    const scheduler = makeScheduler();
    pool.setScheduler(scheduler);
    const agent = await pool.createAgent(agentCfg());
    agent.delayEndTime = new Date(Date.now() - 60_000).toISOString(); // already expired

    await pool.addUserMessage(agent.id, { content: 'hi' });

    expect(scheduler.broadcastAgentStateUpdate).not.toHaveBeenCalled();
  });

  test('broadcasts delay-clear when delay was cleared', async () => {
    const { pool } = makePool();
    const scheduler = makeScheduler();
    pool.setScheduler(scheduler);
    const agent = await pool.createAgent(agentCfg());
    setDelay(agent, 30_000);

    await pool.addUserMessage(agent.id, { content: 'hi' });

    expect(scheduler.broadcastAgentStateUpdate).toHaveBeenCalledWith(
      agent.id,
      'user-message-clears-delay'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// addInterAgentMessage — the previously-broken path.
// ────────────────────────────────────────────────────────────────────────

describe('agentPool.addInterAgentMessage — wake-on-message', () => {
  test('clears future delayEndTime on inter-agent message', async () => {
    const { pool } = makePool();
    const agent = await pool.createAgent(agentCfg());
    setDelay(agent, 45_000);

    await pool.addInterAgentMessage(agent.id, {
      content: 'need your help',
      sender: 'OtherAgent',
      senderName: 'OtherAgent',
    });

    expect(agent.delayEndTime).toBeNull();
    expect(agent.messageQueues.interAgentMessages).toHaveLength(1);
  });

  test('auto-resumes paused recipient', async () => {
    const { pool } = makePool();
    const agent = await pool.createAgent(agentCfg());
    await pool.pauseAgent(agent.id, 300, 'manual pause');
    expect(agent.status).toBe('paused');

    const resumeSpy = jest.spyOn(pool, 'resumeAgent');

    await pool.addInterAgentMessage(agent.id, {
      content: 'wake up',
      sender: 'OtherAgent',
    });

    expect(resumeSpy).toHaveBeenCalledWith(agent.id);
    expect(agent.status).toBe('active');
    expect(agent.pausedUntil).toBeNull();
    resumeSpy.mockRestore();
  });

  test('clears BOTH pause and delay when both are set', async () => {
    const { pool } = makePool();
    const agent = await pool.createAgent(agentCfg());
    await pool.pauseAgent(agent.id, 300, 'pause');
    setDelay(agent, 60_000);

    await pool.addInterAgentMessage(agent.id, {
      content: 'act now',
      sender: 'OtherAgent',
    });

    expect(agent.status).toBe('active');
    expect(agent.pausedUntil).toBeNull();
    expect(agent.delayEndTime).toBeNull();
  });

  test('broadcasts delay-clear with correct reason when delay was cleared', async () => {
    const { pool } = makePool();
    const scheduler = makeScheduler();
    pool.setScheduler(scheduler);
    const agent = await pool.createAgent(agentCfg());
    setDelay(agent, 60_000);

    await pool.addInterAgentMessage(agent.id, {
      content: 'hi',
      sender: 'OtherAgent',
    });

    expect(scheduler.broadcastAgentStateUpdate).toHaveBeenCalledWith(
      agent.id,
      'inter-agent-message-clears-delay'
    );
  });

  test('non-paused non-delayed agent: no resume, no broadcast', async () => {
    const { pool } = makePool();
    const scheduler = makeScheduler();
    pool.setScheduler(scheduler);
    const agent = await pool.createAgent(agentCfg());
    const resumeSpy = jest.spyOn(pool, 'resumeAgent');

    await pool.addInterAgentMessage(agent.id, {
      content: 'hi',
      sender: 'OtherAgent',
    });

    expect(resumeSpy).not.toHaveBeenCalled();
    expect(scheduler.broadcastAgentStateUpdate).not.toHaveBeenCalled();
    resumeSpy.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────
// addToolResult — the third previously-broken path.
// ────────────────────────────────────────────────────────────────────────

describe('agentPool.addToolResult — wake-on-message', () => {
  test('clears future delayEndTime when a tool result arrives', async () => {
    const { pool } = makePool();
    const agent = await pool.createAgent(agentCfg());
    setDelay(agent, 120_000);

    await pool.addToolResult(agent.id, {
      toolId: 'image-gen',
      status: 'completed',
      result: { imageUrl: '/tmp/out.png' },
    });

    expect(agent.delayEndTime).toBeNull();
    expect(agent.messageQueues.toolResults).toHaveLength(1);
  });

  test('auto-resumes paused agent when a tool result arrives', async () => {
    const { pool } = makePool();
    const agent = await pool.createAgent(agentCfg());
    await pool.pauseAgent(agent.id, 300, 'manual pause');
    expect(agent.status).toBe('paused');

    await pool.addToolResult(agent.id, {
      toolId: 'video-gen',
      status: 'completed',
      result: { videoUrl: '/tmp/v.mp4' },
    });

    expect(agent.status).toBe('active');
    expect(agent.pausedUntil).toBeNull();
  });

  test('broadcasts with tool-result reason when delay was cleared', async () => {
    const { pool } = makePool();
    const scheduler = makeScheduler();
    pool.setScheduler(scheduler);
    const agent = await pool.createAgent(agentCfg());
    setDelay(agent, 60_000);

    await pool.addToolResult(agent.id, {
      toolId: 'image-gen',
      status: 'completed',
      result: {},
    });

    expect(scheduler.broadcastAgentStateUpdate).toHaveBeenCalledWith(
      agent.id,
      'tool-result-clears-delay'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// _wakeAgentForMessage — direct unit test of the shared helper so future
// contributors see the exact contract every inbound path must honour.
// ────────────────────────────────────────────────────────────────────────

describe('agentPool._wakeAgentForMessage (shared helper)', () => {
  test('no-op on happy-path (active, not delayed)', async () => {
    const { pool } = makePool();
    const agent = await pool.createAgent(agentCfg());

    const info = await pool._wakeAgentForMessage(agent, 'test');

    expect(info).toEqual({ wasPaused: false, hadDelay: false, hadPausedUntil: false });
    expect(agent.status).toBe('active');
    expect(agent.delayEndTime).toBeFalsy();
  });

  test('reports wasPaused=true and clears pause', async () => {
    const { pool } = makePool();
    const agent = await pool.createAgent(agentCfg());
    await pool.pauseAgent(agent.id, 300, 'pause');

    const info = await pool._wakeAgentForMessage(agent, 'test');

    expect(info.wasPaused).toBe(true);
    expect(agent.status).toBe('active');
  });

  test('reports hadDelay=true and clears delay', async () => {
    const { pool } = makePool();
    const agent = await pool.createAgent(agentCfg());
    setDelay(agent, 30_000);

    const info = await pool._wakeAgentForMessage(agent, 'test');

    expect(info.hadDelay).toBe(true);
    expect(agent.delayEndTime).toBeNull();
  });

  test('null agent returns zero-info object (defensive)', async () => {
    const { pool } = makePool();

    const info = await pool._wakeAgentForMessage(null, 'test');

    expect(info).toEqual({ wasPaused: false, hadDelay: false, hadPausedUntil: false });
  });
});
