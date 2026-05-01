/**
 * AgentPool - Auto-resume on addUserMessage tests
 * Verifies that sending a user message to a paused agent auto-resumes it.
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig, createMockStateManager } from '../../__test-utils__/mockFactories.js';

// ── Mocks (same pattern as agentPool.test.js) ──────────────────────────────
const mockValidateAccessConfiguration = jest.fn().mockReturnValue({ valid: true });
const mockCreateProjectDefaults = jest.fn().mockReturnValue({
  workingDirectory: '/tmp/project',
  readOnlyDirectories: [],
  writeEnabledDirectories: ['/tmp/project']
});

jest.unstable_mockModule('../../utilities/directoryAccessManager.js', () => {
  const MockDAM = jest.fn().mockImplementation(() => ({
    validateAccessConfiguration: mockValidateAccessConfiguration
  }));
  MockDAM.createProjectDefaults = mockCreateProjectDefaults;
  return { default: MockDAM };
});

jest.unstable_mockModule('../../services/visualEditorBridge.js', () => ({
  getVisualEditorBridge: jest.fn().mockReturnValue({
    hasInstance: jest.fn().mockReturnValue(false),
    stopInstance: jest.fn().mockResolvedValue(undefined)
  })
}));

const { default: AgentPool } = await import('../agentPool.js');

// ── Helpers ─────────────────────────────────────────────────────────────────
function makePool(overrides = {}) {
  const config = createMockConfig(overrides.config);
  const logger = createMockLogger();
  const stateManager = createMockStateManager();
  const contextManager = { getContext: jest.fn() };
  const pool = new AgentPool(config, logger, stateManager, contextManager, null);
  return { pool, config, logger, stateManager, contextManager };
}

function agentCfg(overrides = {}) {
  return {
    name: 'TestAgent',
    systemPrompt: 'You are a test agent.',
    preferredModel: 'test-model',
    capabilities: [],
    projectDir: '/tmp/project',
    ...overrides
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('AgentPool – addUserMessage auto-resume', () => {
  let pool, logger;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ pool, logger } = makePool());
  });

  test('addUserMessage on active agent does NOT call resumeAgent', async () => {
    const agent = await pool.createAgent(agentCfg());
    expect(agent.status).toBe('active');

    const resumeSpy = jest.spyOn(pool, 'resumeAgent');
    await pool.addUserMessage(agent.id, { content: 'hello' });

    expect(resumeSpy).not.toHaveBeenCalled();
    resumeSpy.mockRestore();
  });

  test('addUserMessage on paused agent calls resumeAgent before queuing', async () => {
    const agent = await pool.createAgent(agentCfg());
    await pool.pauseAgent(agent.id, 300, 'manual pause');
    expect(agent.status).toBe('paused');

    const resumeSpy = jest.spyOn(pool, 'resumeAgent');
    await pool.addUserMessage(agent.id, { content: 'wake up' });

    expect(resumeSpy).toHaveBeenCalledWith(agent.id);
    resumeSpy.mockRestore();
  });

  test('after auto-resume, agent status is active (not paused)', async () => {
    const agent = await pool.createAgent(agentCfg());
    await pool.pauseAgent(agent.id, 300, 'pause reason');
    expect(agent.status).toBe('paused');

    await pool.addUserMessage(agent.id, { content: 'resume me' });

    expect(agent.status).toBe('active');
    expect(agent.pausedUntil).toBeNull();
  });

  test('message is still queued successfully after auto-resume', async () => {
    const agent = await pool.createAgent(agentCfg());
    await pool.pauseAgent(agent.id, 300, 'pause reason');

    await pool.addUserMessage(agent.id, { content: 'queued msg' });

    expect(agent.messageQueues.userMessages).toHaveLength(1);
    expect(agent.messageQueues.userMessages[0].content).toBe('queued msg');
    expect(agent.messageQueues.userMessages[0].id).toBeDefined();
    expect(agent.messageQueues.userMessages[0].queuedAt).toBeDefined();
  });

  test('addUserMessage on non-existent agent throws error', async () => {
    await expect(
      pool.addUserMessage('nonexistent-id', { content: 'hello' })
    ).rejects.toThrow('Agent not found');
  });

  // ── Additional coverage ───────────────────────────────────────────────

  test('auto-resume processes queued notifications after resume', async () => {
    const agent = await pool.createAgent(agentCfg());
    await pool.pauseAgent(agent.id, 300, 'pause for notifications');

    // Spy on _processQueuedNotifications to verify it is called during resume
    const processSpy = jest.spyOn(pool, '_processQueuedNotifications');

    await pool.addUserMessage(agent.id, { content: 'trigger resume' });

    // resumeAgent calls _processQueuedNotifications internally
    expect(processSpy).toHaveBeenCalledWith(agent.id);
    processSpy.mockRestore();
  });

  test('multiple rapid messages to paused agent — only first triggers resume', async () => {
    const agent = await pool.createAgent(agentCfg());
    await pool.pauseAgent(agent.id, 300, 'pause reason');
    expect(agent.status).toBe('paused');

    const resumeSpy = jest.spyOn(pool, 'resumeAgent');

    // Send first message — triggers auto-resume
    await pool.addUserMessage(agent.id, { content: 'msg1' });
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(agent.status).toBe('active');

    // Send second message — agent is now active, so no resume
    await pool.addUserMessage(agent.id, { content: 'msg2' });
    // resumeAgent should still only have been called once
    expect(resumeSpy).toHaveBeenCalledTimes(1);

    // Both messages should be queued
    expect(agent.messageQueues.userMessages).toHaveLength(2);
    resumeSpy.mockRestore();
  });

  test('addUserMessage after manual resume does NOT call resumeAgent again', async () => {
    const agent = await pool.createAgent(agentCfg());
    await pool.pauseAgent(agent.id, 300, 'pause reason');

    // Manually resume first
    await pool.resumeAgent(agent.id);
    expect(agent.status).toBe('active');

    const resumeSpy = jest.spyOn(pool, 'resumeAgent');

    // Now send a message — agent is already active
    await pool.addUserMessage(agent.id, { content: 'after manual resume' });

    expect(resumeSpy).not.toHaveBeenCalled();
    expect(agent.messageQueues.userMessages).toHaveLength(1);
    resumeSpy.mockRestore();
  });

  test('auto-resume logs info message with agent ID', async () => {
    const agent = await pool.createAgent(agentCfg());
    await pool.pauseAgent(agent.id, 300, 'pause for log test');

    // Clear mocks to isolate the log calls from addUserMessage
    logger.info.mockClear();

    await pool.addUserMessage(agent.id, { content: 'log test' });

    // The auto-resume path logs: `Auto-resuming paused agent ${agentId} due to user message`
    const autoResumeLog = logger.info.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('Auto-resuming paused agent')
    );
    expect(autoResumeLog).toBeDefined();
    expect(autoResumeLog[0]).toContain(agent.id);
  });

  test('auto-resume broadcasts mode change via scheduler if scheduler is set', async () => {
    const { pool: poolWithScheduler, logger: loggerWS } = makePool();

    // Set up a mock scheduler
    const mockScheduler = {
      addAgent: jest.fn().mockResolvedValue(undefined),
      removeAgent: jest.fn(),
      isAgentInScheduler: jest.fn().mockReturnValue(false)
    };
    poolWithScheduler.setScheduler(mockScheduler);

    const agent = await poolWithScheduler.createAgent(agentCfg());
    await poolWithScheduler.pauseAgent(agent.id, 300, 'pause for scheduler test');

    await poolWithScheduler.addUserMessage(agent.id, { content: 'scheduler trigger' });

    // Agent should be active after auto-resume
    expect(agent.status).toBe('active');
    // The resume flow should have run successfully with the scheduler set
    expect(agent.pausedUntil).toBeNull();
  });
});
