import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { ToolCommandValidator, ToolCommandFactory, ToolCommandUtils } from '../toolCommand.js';

describe('ToolCommandFactory', () => {
  test('create returns command with toolId, status, and id', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', { script: 'test' }, { agentId: 'agent_1' });

    expect(cmd).toBeDefined();
    expect(typeof cmd.id).toBe('string');
    expect(cmd.id).toMatch(/^cmd_/);
    expect(cmd.toolId).toBe('terminal');
    expect(cmd.command).toBe('run');
  });

  test('create sets default status to pending', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'agent_1' });
    expect(cmd.status).toBe('pending');
  });

  test('create sets execution with executionId', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', { x: 1 }, { agentId: 'a1' });
    expect(cmd.execution).toBeDefined();
    expect(cmd.execution.executionId).toMatch(/^exec_/);
    expect(cmd.execution.input).toEqual({ command: 'run', parameters: { x: 1 } });
    expect(cmd.execution.output).toBeNull();
    expect(cmd.execution.error).toBeNull();
  });

  test('create applies options', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, {
      agentId: 'a1',
      conversationId: 'conv_1',
      messageId: 'msg_1',
      priority: 1,
      timeout: 60000,
      maxRetries: 5,
      workingDirectory: '/tmp'
    });
    expect(cmd.agentId).toBe('a1');
    expect(cmd.conversationId).toBe('conv_1');
    expect(cmd.messageId).toBe('msg_1');
    expect(cmd.priority).toBe(1);
    expect(cmd.timeout).toBe(60000);
    expect(cmd.maxRetries).toBe(5);
    expect(cmd.execution.workingDirectory).toBe('/tmp');
  });

  test('create uses default values when options not provided', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {});
    expect(cmd.agentId).toBe('');
    expect(cmd.priority).toBe(3);
    expect(cmd.timeout).toBe(30000);
    expect(cmd.maxRetries).toBe(3);
    expect(cmd.retryCount).toBe(0);
  });

  test('generateCommandId returns string starting with cmd_', () => {
    const id = ToolCommandFactory.generateCommandId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^cmd_/);
  });

  test('generateExecutionId returns string starting with exec_', () => {
    const id = ToolCommandFactory.generateExecutionId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^exec_/);
  });

  test('generateLogId returns string starting with log_', () => {
    const id = ToolCommandFactory.generateLogId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^log_/);
  });

  test('createLogEntry returns log with level and message', () => {
    const log = ToolCommandFactory.createLogEntry('info', 'Task started');
    expect(log.level).toBe('info');
    expect(log.message).toBe('Task started');
    expect(typeof log.timestamp).toBe('string');
    expect(typeof log.id).toBe('string');
    expect(log.source).toBe('tool-execution');
  });

  test('createLogEntry includes data when provided', () => {
    const log = ToolCommandFactory.createLogEntry('error', 'Failed', { code: 500 });
    expect(log.data).toEqual({ code: 500 });
  });

  test('createDefaultMetadata returns expected shape', () => {
    const meta = ToolCommandFactory.createDefaultMetadata();
    expect(meta.toolVersion).toBe('1.0.0');
    expect(meta.capabilities).toEqual([]);
    expect(meta.requiresAuth).toBe(false);
    expect(meta.tags).toEqual([]);
  });

  test('createDefaultMetadata applies overrides', () => {
    const meta = ToolCommandFactory.createDefaultMetadata({ toolVersion: '2.0.0', requiresAuth: true });
    expect(meta.toolVersion).toBe('2.0.0');
    expect(meta.requiresAuth).toBe(true);
  });
});

describe('ToolCommandValidator', () => {
  test('validate accepts valid command', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', { script: 'test' }, { agentId: 'agent_1' });
    const result = ToolCommandValidator.validate(cmd);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validate rejects missing required fields', () => {
    const result = ToolCommandValidator.validate({});
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Command ID'))).toBe(true);
    expect(result.errors.some(e => e.includes('Tool ID'))).toBe(true);
    expect(result.errors.some(e => e.includes('Command is required'))).toBe(true);
    expect(result.errors.some(e => e.includes('Agent ID'))).toBe(true);
  });

  test('validate warns on unknown toolId', () => {
    const cmd = ToolCommandFactory.create('custom_tool', 'run', {}, { agentId: 'a1' });
    const result = ToolCommandValidator.validate(cmd);
    // custom_ prefix is allowed, should not warn
    expect(result.warnings.some(w => w.includes('Unknown tool ID'))).toBe(false);
  });

  test('validate warns on truly unknown toolId', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.toolId = 'totally_unknown_tool';
    const result = ToolCommandValidator.validate(cmd);
    expect(result.warnings.some(w => w.includes('Unknown tool ID'))).toBe(true);
  });

  test('validate rejects invalid status', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.status = 'invalid-status';
    const result = ToolCommandValidator.validate(cmd);
    expect(result.errors.some(e => e.includes('Invalid tool status'))).toBe(true);
  });

  test('validate rejects non-object parameters', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.parameters = 'string';
    const result = ToolCommandValidator.validate(cmd);
    expect(result.errors.some(e => e.includes('Parameters must be an object'))).toBe(true);
  });

  test('validate rejects invalid priority', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.priority = 10;
    const result = ToolCommandValidator.validate(cmd);
    expect(result.errors.some(e => e.includes('Priority'))).toBe(true);
  });

  test('validate rejects negative timeout', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.timeout = -1;
    const result = ToolCommandValidator.validate(cmd);
    expect(result.errors.some(e => e.includes('Timeout'))).toBe(true);
  });

  test('validate warns on very long timeout', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.timeout = 7200000;
    const result = ToolCommandValidator.validate(cmd);
    expect(result.warnings.some(w => w.includes('Timeout is very long'))).toBe(true);
  });

  test('validate rejects non-number retryCount', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.retryCount = 'three';
    const result = ToolCommandValidator.validate(cmd);
    expect(result.errors.some(e => e.includes('Retry count'))).toBe(true);
  });

  test('validate warns when retryCount exceeds maxRetries', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.retryCount = 5;
    cmd.maxRetries = 3;
    const result = ToolCommandValidator.validate(cmd);
    expect(result.warnings.some(w => w.includes('Retry count exceeds'))).toBe(true);
  });

  test('validate rejects invalid timestamps', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.createdAt = 'not-a-date';
    const result = ToolCommandValidator.validate(cmd);
    expect(result.errors.some(e => e.includes('Invalid timestamp'))).toBe(true);
  });

  describe('validateExecution', () => {
    test('accepts valid execution', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      const result = ToolCommandValidator.validateExecution(cmd.execution);
      expect(result.errors).toHaveLength(0);
    });

    test('rejects missing executionId', () => {
      const result = ToolCommandValidator.validateExecution({ input: {} });
      expect(result.errors.some(e => e.includes('Execution ID'))).toBe(true);
    });

    test('rejects negative executionTime', () => {
      const result = ToolCommandValidator.validateExecution({
        executionId: 'exec_1',
        input: {},
        executionTime: -1
      });
      expect(result.errors.some(e => e.includes('Execution time'))).toBe(true);
    });

    test('rejects invalid cpuUsage', () => {
      const result = ToolCommandValidator.validateExecution({
        executionId: 'exec_1',
        input: {},
        cpuUsage: 150
      });
      expect(result.errors.some(e => e.includes('CPU usage'))).toBe(true);
    });

    test('rejects invalid log entries', () => {
      const result = ToolCommandValidator.validateExecution({
        executionId: 'exec_1',
        input: {},
        logs: [{ level: 'info' }] // missing message and timestamp
      });
      expect(result.errors.some(e => e.includes('Log entry'))).toBe(true);
    });
  });

  describe('validateToolDefinition', () => {
    test('accepts valid tool definition', () => {
      const result = ToolCommandValidator.validateToolDefinition({
        id: 'terminal',
        name: 'Terminal',
        description: 'Execute commands',
        version: '1.0.0',
        capabilities: [{ id: 'run', name: 'Run' }]
      });
      expect(result.errors).toHaveLength(0);
    });

    test('rejects missing required fields', () => {
      const result = ToolCommandValidator.validateToolDefinition({});
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });

    test('warns on empty capabilities', () => {
      const result = ToolCommandValidator.validateToolDefinition({
        id: 'test', name: 'Test', description: 'Desc', version: '1.0', capabilities: []
      });
      expect(result.warnings.some(w => w.includes('no capabilities'))).toBe(true);
    });
  });

  describe('validateParameters', () => {
    test('validates required parameters', () => {
      const result = ToolCommandValidator.validateParameters({}, {
        properties: { cmd: { type: 'string' } },
        required: ['cmd']
      });
      expect(result.errors.some(e => e.includes('Required parameter missing: cmd'))).toBe(true);
    });

    test('validates parameter types', () => {
      const result = ToolCommandValidator.validateParameters({ count: 'five' }, {
        properties: { count: { type: 'number' } },
        required: []
      });
      expect(result.errors.some(e => e.includes('must be of type number'))).toBe(true);
    });

    test('validates number ranges', () => {
      const result = ToolCommandValidator.validateParameters({ count: 0 }, {
        properties: { count: { type: 'number', minimum: 1, maximum: 10 } },
        required: []
      });
      expect(result.errors.some(e => e.includes('>= 1'))).toBe(true);
    });

    test('validates string lengths', () => {
      const result = ToolCommandValidator.validateParameters({ name: 'ab' }, {
        properties: { name: { type: 'string', minLength: 3 } },
        required: []
      });
      expect(result.errors.some(e => e.includes('at least 3'))).toBe(true);
    });

    test('validates enum values', () => {
      const result = ToolCommandValidator.validateParameters({ mode: 'invalid' }, {
        properties: { mode: { type: 'string', enum: ['read', 'write'] } },
        required: []
      });
      expect(result.errors.some(e => e.includes('must be one of'))).toBe(true);
    });

    test('returns warning when no schema provided', () => {
      const result = ToolCommandValidator.validateParameters({}, null);
      expect(result.warnings.some(w => w.includes('No parameter schema'))).toBe(true);
    });
  });
});

describe('ToolCommandUtils', () => {
  test('isPending returns true for pending command', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'agent_1' });
    expect(ToolCommandUtils.isPending(cmd)).toBe(true);
  });

  test('isExecuting returns true for executing command', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.status = 'executing';
    expect(ToolCommandUtils.isExecuting(cmd)).toBe(true);
  });

  test('isExecuting returns false for non-executing command', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    expect(ToolCommandUtils.isExecuting(cmd)).toBe(false);
  });

  test('isCompleted returns true for completed command', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.status = 'completed';
    expect(ToolCommandUtils.isCompleted(cmd)).toBe(true);
  });

  test('isCompleted returns false for pending command', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    expect(ToolCommandUtils.isCompleted(cmd)).toBe(false);
  });

  test('isFailed returns true for failed command', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.status = 'failed';
    expect(ToolCommandUtils.isFailed(cmd)).toBe(true);
  });

  test('isFailed returns false for completed command', () => {
    const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
    cmd.status = 'completed';
    expect(ToolCommandUtils.isFailed(cmd)).toBe(false);
  });

  describe('isTimedOut', () => {
    test('returns false when no startedAt', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      expect(ToolCommandUtils.isTimedOut(cmd)).toBe(false);
    });

    test('returns false when status is not executing', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      cmd.startedAt = new Date(Date.now() - 60000).toISOString();
      cmd.status = 'completed';
      expect(ToolCommandUtils.isTimedOut(cmd)).toBe(false);
    });

    test('returns true when executing and elapsed > timeout', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1', timeout: 1000 });
      cmd.status = 'executing';
      cmd.startedAt = new Date(Date.now() - 5000).toISOString();
      expect(ToolCommandUtils.isTimedOut(cmd)).toBe(true);
    });

    test('returns false when executing and elapsed < timeout', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1', timeout: 60000 });
      cmd.status = 'executing';
      cmd.startedAt = new Date().toISOString();
      expect(ToolCommandUtils.isTimedOut(cmd)).toBe(false);
    });
  });

  describe('getExecutionTime', () => {
    test('returns null when no startedAt', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      expect(ToolCommandUtils.getExecutionTime(cmd)).toBeNull();
    });

    test('returns elapsed time to completedAt when completed', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      cmd.startedAt = '2025-01-01T00:00:00.000Z';
      cmd.completedAt = '2025-01-01T00:00:05.000Z';
      expect(ToolCommandUtils.getExecutionTime(cmd)).toBe(5000);
    });

    test('returns elapsed time to now when no completedAt', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      cmd.startedAt = new Date(Date.now() - 2000).toISOString();
      const result = ToolCommandUtils.getExecutionTime(cmd);
      expect(result).toBeGreaterThanOrEqual(1900);
      expect(result).toBeLessThan(5000);
    });
  });

  describe('getProgress', () => {
    test('returns 100% for completed command', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      cmd.status = 'completed';
      const progress = ToolCommandUtils.getProgress(cmd);
      expect(progress.percentage).toBe(100);
      expect(progress.status).toBe('completed');
    });

    test('returns estimated progress for executing command', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1', timeout: 10000 });
      cmd.status = 'executing';
      cmd.startedAt = new Date(Date.now() - 5000).toISOString();
      const progress = ToolCommandUtils.getProgress(cmd);
      expect(progress.percentage).toBeGreaterThan(0);
      expect(progress.percentage).toBeLessThanOrEqual(95);
      expect(progress.remainingTime).toBeGreaterThanOrEqual(0);
    });

    test('returns 0% for pending command', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      const progress = ToolCommandUtils.getProgress(cmd);
      expect(progress.percentage).toBe(0);
      expect(progress.remainingTime).toBeNull();
    });

    test('includes isTimedOut flag', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1', timeout: 1000 });
      cmd.status = 'executing';
      cmd.startedAt = new Date(Date.now() - 5000).toISOString();
      const progress = ToolCommandUtils.getProgress(cmd);
      expect(progress.isTimedOut).toBe(true);
    });
  });

  describe('getMetrics', () => {
    test('returns metrics for a command', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      cmd.execution.executionTime = 1500;
      cmd.execution.memoryUsage = 1024;
      cmd.execution.cpuUsage = 25;
      const metrics = ToolCommandUtils.getMetrics(cmd);
      expect(metrics.executionTime).toBe(1500);
      expect(metrics.memoryUsage).toBe(1024);
      expect(metrics.cpuUsage).toBe(25);
      expect(metrics.status).toBe('pending');
      expect(metrics.retryCount).toBe(0);
      expect(metrics.priority).toBe(3);
      expect(metrics.logEntries).toBe(0);
      expect(metrics.hasError).toBe(false);
      expect(metrics.errorCode).toBeNull();
    });

    test('includes error info when present', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      cmd.execution.error = 'Something went wrong';
      cmd.execution.errorCode = 'ERR_TIMEOUT';
      const metrics = ToolCommandUtils.getMetrics(cmd);
      expect(metrics.hasError).toBe(true);
      expect(metrics.errorCode).toBe('ERR_TIMEOUT');
    });

    test('handles missing execution', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      delete cmd.execution;
      const metrics = ToolCommandUtils.getMetrics(cmd);
      expect(metrics.memoryUsage).toBe(0);
      expect(metrics.cpuUsage).toBe(0);
    });
  });

  describe('formatForDisplay', () => {
    test('returns formatted command data', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      cmd.status = 'completed';
      cmd.startedAt = '2025-01-01T00:00:00.000Z';
      cmd.completedAt = '2025-01-01T00:00:05.000Z';
      const result = ToolCommandUtils.formatForDisplay(cmd);
      expect(result.id).toBe(cmd.id);
      expect(result.toolId).toBe('terminal');
      expect(result.command).toBe('run');
      expect(result.status).toBe('completed');
      expect(result.progress).toBe(100);
      expect(result.hasError).toBe(false);
      expect(result.retryCount).toBe(0);
    });
  });

  describe('sanitize', () => {
    test('removes environmentVariables and environment from execution', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      cmd.execution.environmentVariables = { SECRET: 'value' };
      cmd.execution.environment = { PATH: '/usr/bin' };
      const result = ToolCommandUtils.sanitize(cmd);
      expect(result.execution.environmentVariables).toBeUndefined();
      expect(result.execution.environment).toBeUndefined();
    });

    test('truncates long logs to last 10', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      cmd.execution.logs = Array.from({ length: 20 }, (_, i) => ({
        id: `log_${i}`,
        level: 'info',
        message: `Log ${i}`,
        timestamp: new Date().toISOString()
      }));
      const result = ToolCommandUtils.sanitize(cmd);
      expect(result.execution.logs).toHaveLength(10);
    });

    test('redacts sensitive parameter keys', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {
        password: 'secret123',
        apiToken: 'tok_abc',
        normalParam: 'visible'
      }, { agentId: 'a1' });
      const result = ToolCommandUtils.sanitize(cmd);
      expect(result.parameters.password).toBe('[REDACTED]');
      expect(result.parameters.apiToken).toBe('[REDACTED]');
      expect(result.parameters.normalParam).toBe('visible');
    });

    test('handles missing execution gracefully', () => {
      const cmd = ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' });
      delete cmd.execution;
      const result = ToolCommandUtils.sanitize(cmd);
      expect(result.execution).toBeUndefined();
    });
  });

  describe('summarizeCommands', () => {
    test('returns summary with total count', () => {
      const commands = [
        ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'agent_1' }),
        ToolCommandFactory.create('filesystem', 'read', {}, { agentId: 'agent_1' }),
        ToolCommandFactory.create('terminal', 'exec', {}, { agentId: 'agent_1' }),
      ];

      const summary = ToolCommandUtils.summarizeCommands(commands);
      expect(summary.total).toBe(3);
      expect(summary.byStatus).toBeDefined();
      expect(summary.byTool).toBeDefined();
      expect(summary.byTool['terminal']).toBe(2);
      expect(summary.byTool['filesystem']).toBe(1);
    });

    test('calculates success rate', () => {
      const commands = [
        ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' }),
        ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' }),
      ];
      commands[0].status = 'completed';
      commands[1].status = 'failed';

      const summary = ToolCommandUtils.summarizeCommands(commands);
      expect(summary.successRate).toBe(50);
    });

    test('returns mostUsedTools sorted by count', () => {
      const commands = [
        ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' }),
        ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' }),
        ToolCommandFactory.create('filesystem', 'read', {}, { agentId: 'a1' }),
      ];
      const summary = ToolCommandUtils.summarizeCommands(commands);
      expect(summary.mostUsedTools[0].toolId).toBe('terminal');
      expect(summary.mostUsedTools[0].count).toBe(2);
    });

    test('returns recentCommands sorted by creation date', () => {
      const commands = [
        ToolCommandFactory.create('terminal', 'run', {}, { agentId: 'a1' }),
        ToolCommandFactory.create('filesystem', 'read', {}, { agentId: 'a1' }),
      ];
      const summary = ToolCommandUtils.summarizeCommands(commands);
      expect(summary.recentCommands).toHaveLength(2);
      expect(summary.recentCommands[0]).toHaveProperty('id');
      expect(summary.recentCommands[0]).toHaveProperty('toolId');
    });

    test('handles empty commands array', () => {
      const summary = ToolCommandUtils.summarizeCommands([]);
      expect(summary.total).toBe(0);
      expect(summary.averageExecutionTime).toBe(0);
      expect(summary.successRate).toBe(0);
      expect(summary.mostUsedTools).toEqual([]);
      expect(summary.recentCommands).toEqual([]);
    });
  });
});
