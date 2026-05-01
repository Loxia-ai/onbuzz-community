/**
 * MessageProcessor - Comprehensive unit tests (target: 80%+ line coverage)
 * Tests message processing, tool command extraction, tool execution,
 * parameter unwrapping, async tools, and error handling.
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig, createMockAiService } from '../../__test-utils__/mockFactories.js';

// ── Mock dependencies ────────────────────────────────────────────────────────
jest.unstable_mockModule('../../services/visualEditorBridge.js', () => ({
  getVisualEditorBridge: jest.fn(() => ({
    isEnabled: () => false,
    hasInstance: () => false
  })),
  InstanceStatus: { IDLE: 'idle', RUNNING: 'running', ERROR: 'error' }
}));

const mockExtractToolCommands = jest.fn().mockReturnValue([]);
const mockNormalizeToolCommand = jest.fn((cmd) => ({
  toolId: cmd.toolId,
  parameters: cmd.parameters || {},
  type: cmd.type || 'json',
  rawContent: cmd.rawContent || ''
}));
const mockExtractAgentRedirects = jest.fn().mockReturnValue([]);
const mockParseXMLParameters = jest.fn().mockReturnValue({});
const mockDecodeHtmlEntities = jest.fn((s) => s);

jest.unstable_mockModule('../../utilities/tagParser.js', () => ({
  default: jest.fn().mockImplementation(() => ({
    extractToolCommands: mockExtractToolCommands,
    normalizeToolCommand: mockNormalizeToolCommand,
    extractAgentRedirects: mockExtractAgentRedirects,
    parseXMLParameters: mockParseXMLParameters,
    decodeHtmlEntities: mockDecodeHtmlEntities
  }))
}));

jest.unstable_mockModule('../../tools/visualEditorTool.js', () => ({
  VisualEditorTool: {
    injectContextIntoMessage: jest.fn((msg) => msg)
  }
}));

const { default: MessageProcessor } = await import('../messageProcessor.js');

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeMP(overrides = {}) {
  const config = createMockConfig(overrides.config);
  const logger = createMockLogger();
  const toolsRegistry = overrides.toolsRegistry || {
    getTool: jest.fn().mockReturnValue(null)
  };
  const agentPool = overrides.agentPool || {
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
  return { mp, config, logger, toolsRegistry, agentPool, contextManager, aiService };
}

function makeAgent(overrides = {}) {
  return {
    id: overrides.id || 'agent-test',
    name: 'TestAgent',
    mode: 'chat',
    conversations: {
      full: { messages: [], lastUpdated: new Date().toISOString() }
    },
    currentModel: 'test-model',
    messageQueues: { userMessages: [], interAgentMessages: [], toolResults: [] },
    directoryAccess: { workingDirectory: '/tmp' },
    projectDir: '/tmp',
    ...overrides
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('MessageProcessor', () => {
  let mp, logger, agentPool, toolsRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ mp, logger, agentPool, toolsRegistry } = makeMP());
  });

  // ─── processMessage ───────────────────────────────────────────────────
  describe('processMessage', () => {
    test('queues user message for existing agent', async () => {
      const agent = makeAgent();
      agentPool.getAgent.mockResolvedValue(agent);

      const result = await mp.processMessage('agent-test', 'Hello', { sessionId: 'sess-1' });
      expect(result.success).toBe(true);
      expect(agentPool.addUserMessage).toHaveBeenCalledWith('agent-test', expect.objectContaining({
        content: 'Hello',
        role: 'user'
      }));
    });

    test('throws for non-existent agent', async () => {
      agentPool.getAgent.mockResolvedValue(null);
      await expect(mp.processMessage('nonexistent', 'hi')).rejects.toThrow('Agent not found');
    });

    test('routes inter-agent messages to addInterAgentMessage', async () => {
      const agent = makeAgent();
      agentPool.getAgent.mockResolvedValue(agent);

      await mp.processMessage('agent-test', 'inter-msg', {
        isInterAgentMessage: true,
        originalSender: 'agent-sender',
        senderName: 'SenderAgent'
      });

      expect(agentPool.addInterAgentMessage).toHaveBeenCalledWith('agent-test', expect.objectContaining({
        content: 'inter-msg',
        sender: 'agent-sender',
        senderName: 'SenderAgent'
      }));
      expect(agentPool.addUserMessage).not.toHaveBeenCalled();
    });

    test('handles non-string message by JSON.stringify', async () => {
      const agent = makeAgent();
      agentPool.getAgent.mockResolvedValue(agent);

      await mp.processMessage('agent-test', { key: 'value' }, {});
      expect(logger.info).toHaveBeenCalled();
    });

    test('handles null message gracefully', async () => {
      const agent = makeAgent();
      agentPool.getAgent.mockResolvedValue(agent);

      const result = await mp.processMessage('agent-test', null, {});
      expect(result.success).toBe(true);
    });

    test('registers session with scheduler if available', async () => {
      const agent = makeAgent();
      agentPool.getAgent.mockResolvedValue(agent);
      const mockScheduler = { addAgent: jest.fn().mockResolvedValue(undefined) };
      mp.setScheduler(mockScheduler);

      await mp.processMessage('agent-test', 'test', { sessionId: 'sess-1' });
      expect(mockScheduler.addAgent).toHaveBeenCalledWith('agent-test', expect.objectContaining({
        triggeredBy: 'user-message',
        sessionId: 'sess-1'
      }));
    });

    test('sets triggeredBy to inter-agent-message for inter-agent context', async () => {
      const agent = makeAgent();
      agentPool.getAgent.mockResolvedValue(agent);
      const mockScheduler = { addAgent: jest.fn().mockResolvedValue(undefined) };
      mp.setScheduler(mockScheduler);

      await mp.processMessage('agent-test', 'msg', {
        isInterAgentMessage: true,
        originalSender: 'x',
        sessionId: 'sess-1'
      });
      expect(mockScheduler.addAgent).toHaveBeenCalledWith('agent-test', expect.objectContaining({
        triggeredBy: 'inter-agent-message'
      }));
    });

    test('includes flow execution context in user message', async () => {
      const agent = makeAgent();
      agentPool.getAgent.mockResolvedValue(agent);

      await mp.processMessage('agent-test', 'do flow', {
        isFlowExecution: true,
        flowRunId: 'run-1',
        flowNodeId: 'node-1'
      });
      expect(agentPool.addUserMessage).toHaveBeenCalledWith('agent-test', expect.objectContaining({
        isFlowExecution: true,
        flowRunId: 'run-1'
      }));
    });
  });

  // ─── unwrapParameters ─────────────────────────────────────────────────
  describe('unwrapParameters', () => {
    test('returns null/undefined as-is', () => {
      expect(mp.unwrapParameters(null)).toBeNull();
      expect(mp.unwrapParameters(undefined)).toBeUndefined();
    });

    test('returns primitives as-is', () => {
      expect(mp.unwrapParameters('hello')).toBe('hello');
      expect(mp.unwrapParameters(42)).toBe(42);
    });

    test('unwraps {value, attributes} wrapped object', () => {
      const wrapped = { value: 'test-value', attributes: {} };
      expect(mp.unwrapParameters(wrapped)).toBe('test-value');
    });

    test('unwraps nested {value, attributes} in object properties', () => {
      const params = {
        filePath: { value: '/path/to/file', attributes: {} },
        content: { value: 'file content', attributes: {} }
      };
      const result = mp.unwrapParameters(params);
      expect(result.filePath).toBe('/path/to/file');
      expect(result.content).toBe('file content');
    });

    test('preserves attributes when present', () => {
      const params = {
        action: { value: 'write', attributes: { type: 'file' } }
      };
      const result = mp.unwrapParameters(params);
      expect(result.action).toBe('write');
      expect(result.action_attributes).toEqual({ type: 'file' });
    });

    test('handles arrays by unwrapping each element', () => {
      const arr = [
        { value: 'a', attributes: {} },
        { value: 'b', attributes: {} }
      ];
      const result = mp.unwrapParameters(arr);
      expect(result).toEqual(['a', 'b']);
    });

    test('recursively unwraps nested objects', () => {
      const params = {
        outer: {
          inner: { value: 'deep', attributes: {} }
        }
      };
      const result = mp.unwrapParameters(params);
      expect(result.outer.inner).toBe('deep');
    });

    test('keeps plain values unchanged', () => {
      const params = { name: 'test', count: 5 };
      const result = mp.unwrapParameters(params);
      expect(result).toEqual({ name: 'test', count: 5 });
    });
  });

  // ─── extractToolCommands ──────────────────────────────────────────────
  describe('extractToolCommands', () => {
    test('returns empty array for message with no commands', async () => {
      mockExtractToolCommands.mockReturnValue([]);
      mockExtractAgentRedirects.mockReturnValue([]);
      const commands = await mp.extractToolCommands('Just a regular message');
      expect(commands).toEqual([]);
    });

    test('extracts commands from TagParser results', async () => {
      mockExtractToolCommands.mockReturnValue([
        { toolId: 'terminal', parameters: { command: 'ls' }, type: 'json', rawContent: '{}', position: {} }
      ]);
      mockNormalizeToolCommand.mockReturnValue({
        toolId: 'terminal',
        parameters: { command: 'ls' },
        type: 'json',
        rawContent: '{}'
      });

      const commands = await mp.extractToolCommands('Some message with tool');
      expect(commands).toHaveLength(1);
      expect(commands[0].toolId).toBe('terminal');
      expect(commands[0].parameters.command).toBe('ls');
    });

    test('extracts bracket notation commands', async () => {
      mockExtractToolCommands.mockReturnValue([]);
      const msg = '[tool id="filesystem"]{"action":"read"}[/tool]';
      const commands = await mp.extractToolCommands(msg);
      expect(commands.length).toBeGreaterThanOrEqual(1);
      expect(commands[0].toolId).toBe('filesystem');
    });

    test('deduplicates bracket commands already found by TagParser', async () => {
      const rawMatch = '[tool id="terminal"]ls[/tool]';
      mockExtractToolCommands.mockReturnValue([
        { toolId: 'terminal', parameters: {}, type: 'bracket', rawContent: rawMatch, position: { start: 0, end: rawMatch.length } }
      ]);
      mockNormalizeToolCommand.mockReturnValue({
        toolId: 'terminal',
        parameters: {},
        type: 'bracket',
        rawContent: rawMatch
      });

      const commands = await mp.extractToolCommands(rawMatch);
      // Should not have duplicates
      const terminalCmds = commands.filter(c => c.toolId === 'terminal');
      expect(terminalCmds.length).toBe(1);
    });

    test('extracts agent redirects', async () => {
      mockExtractToolCommands.mockReturnValue([]);
      mockExtractAgentRedirects.mockReturnValue([
        { to: 'agent-other', content: 'help', urgent: false, requiresResponse: false, context: {}, rawMatch: '<redirect>' }
      ]);

      const commands = await mp.extractToolCommands('redirect message');
      expect(commands).toHaveLength(1);
      expect(commands[0].toolId).toBe('agentcommunication');
      expect(commands[0].type).toBe('redirect');
    });

    test('handles bracket commands with XML content inside', async () => {
      mockExtractToolCommands.mockReturnValue([]);
      mockParseXMLParameters.mockReturnValue({ action: 'write', filePath: '/test.txt' });
      mockNormalizeToolCommand.mockReturnValue({
        toolId: 'filesystem',
        parameters: { actions: [{ action: 'write' }] },
        type: 'xml'
      });

      const msg = '[tool id="filesystem"]<action>write</action><filePath>/test.txt</filePath>[/tool]';
      const commands = await mp.extractToolCommands(msg);
      expect(commands.length).toBeGreaterThanOrEqual(1);
    });

    test('falls back to bracket format when XML parsing fails', async () => {
      mockExtractToolCommands.mockReturnValue([]);
      mockParseXMLParameters.mockImplementation(() => { throw new Error('bad xml'); });

      const msg = '[tool id="filesystem"]<broken>xml[/tool]';
      const commands = await mp.extractToolCommands(msg);
      expect(commands.length).toBeGreaterThanOrEqual(1);
      expect(commands[0].type).toBe('bracket');
    });

    test('handles async attribute in bracket notation', async () => {
      mockExtractToolCommands.mockReturnValue([]);
      const msg = '[tool id="terminal" async="true"]long running[/tool]';
      const commands = await mp.extractToolCommands(msg);
      expect(commands.length).toBeGreaterThanOrEqual(1);
      expect(commands[0].isAsync).toBe(true);
    });
  });

  // ─── executeTools ─────────────────────────────────────────────────────
  describe('executeTools', () => {
    test('returns failed result for unknown tool', async () => {
      toolsRegistry.getTool.mockReturnValue(null);
      const commands = [{ toolId: 'unknown', parameters: {}, isAsync: false }];
      const results = await mp.executeTools(commands, { agentId: 'a1' });
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('failed');
      expect(results[0].error).toContain('Tool not found');
    });

    test('executes synchronous tool successfully', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ success: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);
      const commands = [{ toolId: 'terminal', parameters: { cmd: 'ls' }, isAsync: false }];
      const results = await mp.executeTools(commands, { agentId: 'a1' });
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('completed');
      expect(results[0].result).toEqual({ success: true });
    });

    test('marks result as partial when command was truncated', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ success: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);
      const commands = [{ toolId: 'terminal', parameters: {}, isAsync: false, wasTruncated: true }];
      const results = await mp.executeTools(commands, { agentId: 'a1' });
      expect(results[0].status).toBe('partial');
      expect(results[0].wasTruncated).toBe(true);
    });

    test('catches tool execution error', async () => {
      const mockTool = { execute: jest.fn().mockRejectedValue(new Error('tool crashed')) };
      toolsRegistry.getTool.mockReturnValue(mockTool);
      const commands = [{ toolId: 'terminal', parameters: {}, isAsync: false }];
      const results = await mp.executeTools(commands, { agentId: 'a1' });
      expect(results[0].status).toBe('failed');
      expect(results[0].error).toBe('tool crashed');
    });

    test('parses content string when no parameters object', async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({ ok: true }),
        parseParameters: jest.fn().mockReturnValue({ parsed: true })
      };
      toolsRegistry.getTool.mockReturnValue(mockTool);
      const commands = [{ toolId: 'terminal', content: '{"cmd": "ls"}', isAsync: false }];
      const results = await mp.executeTools(commands, { agentId: 'a1' });
      expect(mockTool.parseParameters).toHaveBeenCalledWith('{"cmd": "ls"}');
      expect(results[0].status).toBe('completed');
    });

    test('uses raw content when tool has no parseParameters', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);
      const commands = [{ toolId: 'terminal', content: 'raw content', isAsync: false }];
      const results = await mp.executeTools(commands, { agentId: 'a1' });
      expect(mockTool.execute).toHaveBeenCalledWith('raw content', expect.any(Object));
    });

    test('falls back to raw content when parseParameters throws', async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({ ok: true }),
        parseParameters: jest.fn().mockImplementation(() => { throw new Error('parse fail'); })
      };
      toolsRegistry.getTool.mockReturnValue(mockTool);
      const commands = [{ toolId: 'terminal', content: 'raw', isAsync: false }];
      const results = await mp.executeTools(commands, { agentId: 'a1' });
      expect(mockTool.execute).toHaveBeenCalledWith('raw', expect.any(Object));
    });

    test('unwraps TagParser format parameters before execution', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);
      const commands = [{
        toolId: 'filesystem',
        parameters: { filePath: { value: '/test.txt', attributes: {} } },
        isAsync: false
      }];
      const results = await mp.executeTools(commands, { agentId: 'a1' });
      // The unwrapped parameter should have filePath as string
      const calledWith = mockTool.execute.mock.calls[0][0];
      expect(calledWith.filePath).toBe('/test.txt');
    });

    test('stores results in execution history', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);
      const commands = [{ toolId: 'terminal', parameters: {}, isAsync: false }];
      await mp.executeTools(commands, { agentId: 'a1', sessionId: 'sess-1' });
      expect(mp.executionHistory.size).toBe(1);
    });

    test('passes directoryAccess workingDirectory as projectDir', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);
      const commands = [{ toolId: 'terminal', parameters: {}, isAsync: false }];
      const context = {
        agentId: 'a1',
        directoryAccess: { workingDirectory: '/custom/dir' },
        projectDir: '/original'
      };
      await mp.executeTools(commands, context);
      const toolContext = mockTool.execute.mock.calls[0][1];
      expect(toolContext.projectDir).toBe('/custom/dir');
    });

    // Per-agent tool config passthrough — see agentPool `toolConfig`
    // schema and BaseTool#getEffectiveConfig. These tests lock the
    // message-processor side of the plumbing: the correct slice of
    // agent.toolConfig must land on the tool execution context.
    test('passes agent.toolConfig[toolId] to the tool as context.toolConfig', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);
      const commands = [{ toolId: 'terminal', parameters: {}, isAsync: false }];
      const context = {
        agentId: 'a1',
        agentToolConfig: {
          terminal:   { allowedCommands: ['git', 'npm'] },
          filesystem: { maxFileSize: 500 },
        },
      };
      await mp.executeTools(commands, context);
      const toolContext = mockTool.execute.mock.calls[0][1];
      expect(toolContext.toolConfig).toEqual({ allowedCommands: ['git', 'npm'] });
    });

    test('context.toolConfig is null when agent has no config for this tool', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);
      const commands = [{ toolId: 'vision', parameters: {}, isAsync: false }];
      const context = {
        agentId: 'a1',
        agentToolConfig: { terminal: { allowedCommands: ['git'] } },
      };
      await mp.executeTools(commands, context);
      const toolContext = mockTool.execute.mock.calls[0][1];
      expect(toolContext.toolConfig).toBeNull();
    });

    test('context.toolConfig is null when agent has no toolConfig at all', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      toolsRegistry.getTool.mockReturnValue(mockTool);
      const commands = [{ toolId: 'terminal', parameters: {}, isAsync: false }];
      await mp.executeTools(commands, { agentId: 'a1' });
      const toolContext = mockTool.execute.mock.calls[0][1];
      expect(toolContext.toolConfig).toBeNull();
    });
  });

  // ─── executeAsyncTool ─────────────────────────────────────────────────
  describe('executeAsyncTool', () => {
    test('returns async-pending status with operationId', async () => {
      const mockTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      const command = { toolId: 'terminal', parameters: { cmd: 'long' }, isAsync: true };
      const result = await mp.executeAsyncTool(command, mockTool, { agentId: 'a1' });
      expect(result.status).toBe('async-pending');
      expect(result.operationId).toBeDefined();
      expect(mp.asyncOperations.has(result.operationId)).toBe(true);
    });
  });

  // ─── getToolStatus ────────────────────────────────────────────────────
  describe('getToolStatus', () => {
    test('returns not-found for unknown operation', async () => {
      const result = await mp.getToolStatus('unknown-op');
      expect(result.status).toBe('not-found');
    });

    test('returns operation status for known operation', async () => {
      mp.asyncOperations.set('op-1', {
        id: 'op-1', toolId: 'terminal', status: 'completed', result: { ok: true }
      });
      const result = await mp.getToolStatus('op-1');
      expect(result.status).toBe('completed');
      expect(result.toolId).toBe('terminal');
    });
  });

  // ─── formatToolResultForAgent ─────────────────────────────────────────
  describe('formatToolResultForAgent', () => {
    test('formats completed object result', () => {
      const result = mp.formatToolResultForAgent({
        toolId: 'fs', status: 'completed', result: { data: 'ok' }
      });
      expect(result).toContain('fs');
      expect(result).toContain('successfully');
      expect(result).toContain('"data"');
    });

    test('formats completed string result', () => {
      const result = mp.formatToolResultForAgent({
        toolId: 'terminal', status: 'completed', result: 'done'
      });
      expect(result).toContain('done');
    });

    test('formats failed result', () => {
      const result = mp.formatToolResultForAgent({
        toolId: 'x', status: 'failed', error: 'boom'
      });
      expect(result).toContain('failed');
      expect(result).toContain('boom');
    });

    test('formats failed without error message', () => {
      const result = mp.formatToolResultForAgent({ toolId: 'x', status: 'failed' });
      expect(result).toContain('Unknown error');
    });

    test('formats async-pending result', () => {
      const result = mp.formatToolResultForAgent({
        toolId: 'x', status: 'async-pending', operationId: 'op-1'
      });
      expect(result).toContain('asynchronously');
      expect(result).toContain('op-1');
    });

    test('formats unknown status', () => {
      const result = mp.formatToolResultForAgent({ toolId: 'x', status: 'unknown' });
      expect(result).toContain('status: unknown');
    });
  });

  // ─── stopAutonomousExecution ──────────────────────────────────────────
  describe('stopAutonomousExecution', () => {
    test('returns error when no scheduler', async () => {
      mp.scheduler = null;
      const result = await mp.stopAutonomousExecution('agent-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Scheduler not available');
    });

    test('delegates to scheduler.stopAgentExecution', async () => {
      const mockScheduler = { stopAgentExecution: jest.fn().mockResolvedValue({ success: true }) };
      mp.scheduler = mockScheduler;
      const result = await mp.stopAutonomousExecution('agent-1');
      expect(mockScheduler.stopAgentExecution).toHaveBeenCalledWith('agent-1');
      expect(result.success).toBe(true);
    });
  });

  // ─── setters ──────────────────────────────────────────────────────────
  describe('setters', () => {
    test('setWebSocketManager stores manager', () => {
      const ws = { broadcast: jest.fn() };
      mp.setWebSocketManager(ws);
      expect(mp.webSocketManager).toBe(ws);
    });

    test('setScheduler stores scheduler', () => {
      const sched = { addAgent: jest.fn() };
      mp.setScheduler(sched);
      expect(mp.scheduler).toBe(sched);
    });
  });

  // ─── notifyAgentOfToolCompletion ──────────────────────────────────────
  describe('notifyAgentOfToolCompletion', () => {
    test('queues tool result for the agent', async () => {
      const operation = {
        agentId: 'a1',
        toolId: 'terminal',
        status: 'completed',
        result: { ok: true },
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        context: { sessionId: 'sess-1' }
      };
      await mp.notifyAgentOfToolCompletion(operation);
      expect(agentPool.addToolResult).toHaveBeenCalledWith('a1', expect.objectContaining({
        toolId: 'terminal',
        status: 'completed'
      }));
    });

    test('does nothing when no agentId', async () => {
      await mp.notifyAgentOfToolCompletion({ toolId: 'x' });
      expect(agentPool.addToolResult).not.toHaveBeenCalled();
    });

    test('logs error when addToolResult fails', async () => {
      agentPool.addToolResult.mockRejectedValueOnce(new Error('queue fail'));
      await mp.notifyAgentOfToolCompletion({
        agentId: 'a1', toolId: 'x', status: 'completed', startTime: '', endTime: ''
      });
      expect(logger.error).toHaveBeenCalled();
    });

    test('registers with scheduler when available', async () => {
      const mockScheduler = { addAgent: jest.fn().mockResolvedValue(undefined) };
      mp.scheduler = mockScheduler;
      await mp.notifyAgentOfToolCompletion({
        agentId: 'a1', toolId: 'x', status: 'completed',
        startTime: '', endTime: '', context: { sessionId: 'sess-1' }
      });
      expect(mockScheduler.addAgent).toHaveBeenCalledWith('a1', expect.objectContaining({
        triggeredBy: 'tool-completion'
      }));
    });
  });

  // ─── extractAndExecuteTools ───────────────────────────────────────────
  describe('extractAndExecuteTools', () => {
    test('returns empty array when no commands found', async () => {
      mockExtractToolCommands.mockReturnValue([]);
      mockExtractAgentRedirects.mockReturnValue([]);
      const results = await mp.extractAndExecuteTools('no tools here', 'a1', {});
      expect(results).toEqual([]);
    });

    test('returns empty array on error', async () => {
      mockExtractToolCommands.mockImplementation(() => { throw new Error('parse crash'); });
      const results = await mp.extractAndExecuteTools('bad', 'a1', {});
      expect(results).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
