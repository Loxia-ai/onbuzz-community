import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock child_process BEFORE importing TerminalTool
const mockExec = jest.fn();
const mockSpawn = jest.fn();

jest.unstable_mockModule('child_process', () => ({
  exec: mockExec,
  spawn: mockSpawn,
  execSync: jest.fn(() => ''),
  default: { exec: mockExec, spawn: mockSpawn, execSync: jest.fn(() => '') }
}));

// Mock fs/promises
const mockFs = {
  stat: jest.fn(),
  readdir: jest.fn(),
  mkdir: jest.fn()
};

jest.unstable_mockModule('fs/promises', () => ({
  default: mockFs,
  ...mockFs
}));

// Mock constants
const TERMINAL_CONFIG = {
  STATES: {
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    KILLED: 'killed'
  },
  MAX_OUTPUT_SIZE: 100000
};

jest.unstable_mockModule('../../utilities/constants.js', () => ({
  TOOL_STATUS: { PENDING: 'pending', EXECUTING: 'executing', COMPLETED: 'completed', FAILED: 'failed' },
  OPERATION_STATUS: { NOT_FOUND: 'not_found' },
  ERROR_TYPES: {},
  SYSTEM_DEFAULTS: { MAX_TOOL_EXECUTION_TIME: 300000 },
  TERMINAL_CONFIG
}));

// Mock tagParser
jest.unstable_mockModule('../../utilities/tagParser.js', () => ({
  default: {
    extractContent: jest.fn((content, tag) => {
      const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi');
      const matches = [];
      let match;
      while ((match = regex.exec(content)) !== null) {
        matches.push(match[1]);
      }
      return matches;
    })
  }
}));

// Mock DirectoryAccessManager
jest.unstable_mockModule('../../utilities/directoryAccessManager.js', () => ({
  default: class MockDirectoryAccessManager {
    constructor() {}
    createDirectoryAccess(config) { return config; }
    getWorkingDirectory(config) { return config.workingDirectory || '/project'; }
    validateReadAccess() { return { allowed: true }; }
    validateWriteAccess() { return { allowed: true }; }
  }
}));

const { default: TerminalTool } = await import('../terminalTool.js');

// Helper: configure mockExec to call callback with success
function setupExecSuccess(stdout = 'output', stderr = '') {
  mockExec.mockImplementation((cmd, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    process.nextTick(() => cb(null, stdout, stderr));
    return { pid: 12345, on: jest.fn(), kill: jest.fn(), killed: false };
  });
}

// Helper: configure mockExec to call callback with error
function setupExecError(message = 'command failed', code = 1, stdout = '', stderr = 'error output') {
  mockExec.mockImplementation((cmd, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    const error = new Error(message);
    error.code = code;
    process.nextTick(() => cb(error, stdout, stderr));
    return { pid: 12345, on: jest.fn(), kill: jest.fn(), killed: false };
  });
}

describe('TerminalTool', () => {
  let tool;
  let logger;
  const context = { agentId: 'agent-1', projectDir: '/project' };

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
    tool = new TerminalTool({}, logger);
    // Override translateCommand to return command as-is for simpler testing
    tool.translateCommand = jest.fn(async (cmd) => cmd);
  });

  test('constructor sets metadata correctly', () => {
    expect(tool.id).toBe('terminal');
    expect(tool.requiresProject).toBe(false);
    expect(tool.timeout).toBe(120000);
  });

  test('getDescription mentions terminal', () => {
    const desc = tool.getDescription();
    expect(desc).toContain('Terminal Tool');
    expect(desc).toContain('run-command');
  });

  test('getSupportedActions returns all action types', () => {
    const actions = tool.getSupportedActions();
    expect(actions).toContain('run-command');
    expect(actions).toContain('change-directory');
    expect(actions).toContain('list-directory');
    expect(actions).toContain('create-directory');
    expect(actions).toContain('get-working-directory');
  });

  test('getRequiredParameters returns actions', () => {
    expect(tool.getRequiredParameters()).toEqual(['actions']);
  });

  test('parseParameters extracts run-command from XML', () => {
    const content = '<run-command>npm install</run-command>';
    const result = tool.parseParameters(content);
    expect(result.actions).toEqual([{ type: 'run-command', command: 'npm install' }]);
  });

  test('parseParameters extracts change-directory from XML', () => {
    const content = '<change-directory>src/components</change-directory>';
    const result = tool.parseParameters(content);
    expect(result.actions).toEqual([{ type: 'change-directory', directory: 'src/components' }]);
  });

  test('parseParameters extracts get-working-directory from XML', () => {
    const content = '<get-working-directory>true</get-working-directory>';
    const result = tool.parseParameters(content);
    expect(result.actions.some(a => a.type === 'get-working-directory')).toBe(true);
  });

  test('parseParameters extracts timeout and async flags', () => {
    const content = '<run-command>ls</run-command><timeout>5000</timeout><async>true</async>';
    const result = tool.parseParameters(content);
    expect(result.timeout).toBe(5000);
    expect(result.async).toBe(true);
  });

  test('customValidateParameters rejects empty actions', () => {
    const result = tool.customValidateParameters({ actions: [] });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters rejects action without type', () => {
    const result = tool.customValidateParameters({ actions: [{ command: 'ls' }] });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters rejects run-command without command', () => {
    const result = tool.customValidateParameters({
      actions: [{ type: 'run-command', command: '' }]
    });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters rejects blocked commands', () => {
    const result = tool.customValidateParameters({
      actions: [{ type: 'run-command', command: 'rm -rf /' }]
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('blocked'))).toBe(true);
  });

  test('customValidateParameters rejects change-directory without directory', () => {
    const result = tool.customValidateParameters({
      actions: [{ type: 'change-directory', directory: '' }]
    });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters rejects unknown action type', () => {
    const result = tool.customValidateParameters({
      actions: [{ type: 'unknown-action' }]
    });
    expect(result.valid).toBe(false);
  });

  test('customValidateParameters accepts valid actions', () => {
    const result = tool.customValidateParameters({
      actions: [{ type: 'run-command', command: 'npm install' }]
    });
    expect(result.valid).toBe(true);
  });

  test('isBlockedCommand detects blocked commands', () => {
    expect(tool.isBlockedCommand('rm -rf /')).toBe(true);
    expect(tool.isBlockedCommand('format C:')).toBe(true);
    expect(tool.isBlockedCommand('shutdown')).toBe(true);
    expect(tool.isBlockedCommand('npm install')).toBe(false);
  });

  test('isBlockedCommand is case-insensitive', () => {
    expect(tool.isBlockedCommand('SHUTDOWN')).toBe(true);
    expect(tool.isBlockedCommand('Format')).toBe(true);
  });

  // Per-agent config overrides (agent.toolConfig.terminal). These ride in
  // via context.toolConfig in execute() — see BaseTool#getEffectiveConfig.
  describe('per-agent toolConfig overrides', () => {
    test('per-agent blockedCommands refuses a command that is globally allowed', async () => {
      const result = await tool.execute(
        { actions: [{ type: 'run-command', command: 'curl https://evil.example' }] },
        { ...context, toolConfig: { blockedCommands: ['curl'] } }
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/blocked by agent policy/);
      // Must not execute the blocked command.
      expect(mockExec).not.toHaveBeenCalled();
    });

    test('per-agent allowedCommands rejects anything not in the list', async () => {
      const result = await tool.execute(
        { actions: [{ type: 'run-command', command: 'npm install' }] },
        { ...context, toolConfig: { allowedCommands: ['git'] } }
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not in the agent's allowed list/);
      expect(mockExec).not.toHaveBeenCalled();
    });

    test('per-agent allowedCommands accepts matches (prefix ok)', async () => {
      setupExecSuccess('main');
      const result = await tool.execute(
        { actions: [{ type: 'run-command', command: 'git status' }] },
        { ...context, toolConfig: { allowedCommands: ['git'] } }
      );
      expect(result.success).toBe(true);
      expect(mockExec).toHaveBeenCalled();
    });

    test('blocked wins over allowed when both set', async () => {
      const result = await tool.execute(
        { actions: [{ type: 'run-command', command: 'rm file.txt' }] },
        { ...context, toolConfig: { allowedCommands: ['rm'], blockedCommands: ['rm'] } }
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/blocked by agent policy/);
    });

    test('no toolConfig → global rules apply (unchanged behavior)', async () => {
      setupExecSuccess('ok');
      const result = await tool.execute(
        { actions: [{ type: 'run-command', command: 'echo hi' }] },
        context
      );
      expect(result.success).toBe(true);
    });

    test('empty allowedCommands array is treated as "any" (not "none")', async () => {
      // Empty list means "no override" not "nothing allowed". Otherwise
      // setting the override to [] would brick the agent.
      setupExecSuccess('ok');
      const result = await tool.execute(
        { actions: [{ type: 'run-command', command: 'echo hi' }] },
        { ...context, toolConfig: { allowedCommands: [] } }
      );
      expect(result.success).toBe(true);
    });
  });

  test('execute run-command returns stdout on success', async () => {
    setupExecSuccess('hello world');

    const result = await tool.execute(
      { actions: [{ type: 'run-command', command: 'echo hello' }] },
      context
    );

    expect(result.success).toBe(true);
    expect(result.actions[0].success).toBe(true);
    expect(result.actions[0].stdout).toBe('hello world');
    expect(result.actions[0].exitCode).toBe(0);
  });

  test('execute run-command handles command error', async () => {
    setupExecError('command not found', 127, '', 'bash: badcmd: command not found');

    const result = await tool.execute(
      { actions: [{ type: 'run-command', command: 'badcmd' }] },
      context
    );

    // The tool resolves even on failure, just with success: false on the action
    expect(result.actions[0].success).toBe(false);
    expect(result.actions[0].exitCode).toBe(127);
    expect(result.actions[0].error).toContain('command not found');
  });

  test('execute run-command captures exit code', async () => {
    setupExecError('exit 2', 2);

    const result = await tool.execute(
      { actions: [{ type: 'run-command', command: 'exit 2' }] },
      context
    );

    expect(result.actions[0].exitCode).toBe(2);
  });

  test('execute change-directory updates working dir', async () => {
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });

    const result = await tool.execute(
      { actions: [{ type: 'change-directory', directory: 'src' }] },
      context
    );

    expect(result.success).toBe(true);
    expect(result.actions[0].success).toBe(true);
    expect(result.actions[0].action).toBe('change-directory');
    expect(result.workingDirectory).toContain('src');
  });

  test('execute get-working-directory returns current dir', async () => {
    const result = await tool.execute(
      { actions: [{ type: 'get-working-directory' }] },
      context
    );

    expect(result.success).toBe(true);
    expect(result.actions[0].action).toBe('get-working-directory');
    expect(result.actions[0].workingDirectory).toBeTruthy();
  });

  test('execute list-directory returns directory contents', async () => {
    mockFs.readdir.mockResolvedValue([
      { name: 'file.js', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
      { name: 'src', isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false }
    ]);

    const result = await tool.execute(
      { actions: [{ type: 'list-directory', directory: '/project' }] },
      context
    );

    expect(result.success).toBe(true);
    expect(result.actions[0].totalItems).toBe(2);
    expect(result.actions[0].files).toBe(1);
    expect(result.actions[0].directories).toBe(1);
  });

  test('execute create-directory creates directory', async () => {
    mockFs.mkdir.mockResolvedValue(undefined);

    const result = await tool.execute(
      { actions: [{ type: 'create-directory', directory: 'new-dir' }] },
      context
    );

    expect(result.success).toBe(true);
    expect(result.actions[0].success).toBe(true);
    expect(result.actions[0].action).toBe('create-directory');
  });

  test('execute handles multiple actions', async () => {
    setupExecSuccess('ok');

    const result = await tool.execute(
      {
        actions: [
          { type: 'get-working-directory' },
          { type: 'run-command', command: 'echo ok' }
        ]
      },
      context
    );

    expect(result.executedActions).toBe(2);
    expect(result.actions.length).toBe(2);
  });

  test('execute reports overall failure when some actions fail', async () => {
    setupExecError('fail', 1);

    const result = await tool.execute(
      { actions: [{ type: 'run-command', command: 'fail-cmd' }] },
      context
    );

    expect(result.success).toBe(false);
    expect(result.failedActions).toBe(1);
  });

  test('execute handles action throwing error gracefully', async () => {
    mockFs.readdir.mockRejectedValue(new Error('permission denied'));

    const result = await tool.execute(
      { actions: [{ type: 'list-directory', directory: '/forbidden' }] },
      context
    );

    expect(result.actions[0].success).toBe(false);
    expect(result.actions[0].error).toContain('permission denied');
  });

  test('addToHistory records command and trims history', () => {
    for (let i = 0; i < 110; i++) {
      tool.addToHistory(
        { type: 'run-command', command: `cmd-${i}` },
        { success: true, executionTime: 10, workingDirectory: '/project' },
        'agent-1'
      );
    }
    expect(tool.commandHistory.length).toBe(100);
  });

  test('execute uses directoryAccess working directory', async () => {
    setupExecSuccess('ok');

    const result = await tool.execute(
      { actions: [{ type: 'run-command', command: 'ls' }] },
      {
        agentId: 'agent-1',
        projectDir: '/project',
        directoryAccess: {
          workingDirectory: '/custom/dir',
          writeEnabledDirectories: ['/custom/dir']
        }
      }
    );

    expect(result.success).toBe(true);
  });

  test('getParameterSchema returns valid schema', () => {
    const schema = tool.getParameterSchema();
    expect(schema.type).toBe('object');
    expect(schema.properties).toHaveProperty('actions');
  });
});
