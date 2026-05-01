import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig, createMockStateManager, createMockAgentPool } from '../../__test-utils__/mockFactories.js';

jest.unstable_mockModule('../../utilities/constants.js', () => ({
  AGENT_MODES: { CHAT: 'chat', AGENT: 'agent' }
}));

const { default: FlowExecutor } = await import('../flowExecutor.js');

describe('FlowExecutor', () => {
  let fe;
  let config, logger, stateManager, agentPool, messageProcessor;

  beforeEach(() => {
    config = createMockConfig();
    logger = createMockLogger();
    stateManager = createMockStateManager();
    agentPool = createMockAgentPool();
    messageProcessor = { processMessage: jest.fn().mockResolvedValue(undefined) };
    fe = new FlowExecutor(config, logger, stateManager, agentPool, messageProcessor);
  });

  // --- topologicalSort ---

  test('topologicalSort with simple linear DAG returns correct order', () => {
    const nodes = [
      { id: 'a', data: {} },
      { id: 'b', data: {} },
      { id: 'c', data: {} }
    ];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' }
    ];
    const sorted = fe.topologicalSort(nodes, edges);
    expect(sorted.length).toBe(3);
    const ids = sorted.map(n => n.id);
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'));
  });

  test('topologicalSort with diamond DAG respects all edges', () => {
    const nodes = [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }
    ];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' }
    ];
    const sorted = fe.topologicalSort(nodes, edges);
    expect(sorted.length).toBe(4);
    const ids = sorted.map(n => n.id);
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('d'));
    expect(ids.indexOf('c')).toBeLessThan(ids.indexOf('d'));
  });

  test('topologicalSort with single node returns that node', () => {
    const sorted = fe.topologicalSort([{ id: 'x' }], []);
    expect(sorted.length).toBe(1);
    expect(sorted[0].id).toBe('x');
  });

  test('topologicalSort with cycle logs warning and returns partial result', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' }
    ];
    const sorted = fe.topologicalSort(nodes, edges);
    // Cycle means sorted.length < nodes.length
    expect(sorted.length).toBeLessThan(nodes.length);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('cycles'));
  });

  test('topologicalSort with empty/null nodes returns empty array', () => {
    expect(fe.topologicalSort([], [])).toEqual([]);
    expect(fe.topologicalSort(null, [])).toEqual([]);
  });

  // --- executeInputNode ---

  test('executeInputNode passes input through with template', async () => {
    const node = { id: 'in1', data: { promptTemplate: '{{userInput}}' } };
    const context = { input: 'Hello world', variables: {} };
    const result = await fe.executeInputNode(node, context);
    expect(result.type).toBe('input');
    expect(result.output).toBe('Hello world');
    expect(result.raw).toBe('Hello world');
  });

  test('executeInputNode uses default template when none provided', async () => {
    const node = { id: 'in1', data: {} };
    const context = { input: 'Test input', variables: {} };
    const result = await fe.executeInputNode(node, context);
    expect(result.output).toBe('Test input');
  });

  // --- executeOutputNode ---

  test('executeOutputNode collects final output from previous nodes in text format', async () => {
    const node = { id: 'out1', data: { outputFormat: 'text' } };
    const flow = { edges: [{ source: 'agent1', target: 'out1' }] };
    const context = {
      input: '', variables: {},
      nodeOutputs: { agent1: { output: 'Agent result here' } }
    };
    const result = await fe.executeOutputNode(node, context, flow);
    expect(result.type).toBe('output');
    expect(result.format).toBe('text');
    expect(result.output).toBe('Agent result here');
  });

  test('executeOutputNode uses json format when specified', async () => {
    const node = { id: 'out1', data: { outputFormat: 'json' } };
    const flow = { edges: [{ source: 'a1', target: 'out1' }] };
    const context = { input: '', variables: {}, nodeOutputs: { a1: { output: 'text data' } } };
    const result = await fe.executeOutputNode(node, context, flow);
    expect(result.format).toBe('json');
    expect(result.output).toHaveProperty('result');
  });

  // --- setWebSocketManager ---

  test('setWebSocketManager stores the reference', () => {
    const wsm = { broadcast: jest.fn() };
    fe.setWebSocketManager(wsm);
    expect(fe.webSocketManager).toBe(wsm);
  });

  // --- getActiveExecutions ---

  test('getActiveExecutions returns empty array initially', () => {
    const active = fe.getActiveExecutions();
    expect(active).toEqual([]);
  });

  test('getActiveExecutions returns entries during a running flow', () => {
    fe.activeExecutions.set('run-1', {
      flowId: 'flow-1', status: 'running', startedAt: new Date()
    });
    const active = fe.getActiveExecutions();
    expect(active.length).toBe(1);
    expect(active[0].runId).toBe('run-1');
    expect(active[0].flowId).toBe('flow-1');
    expect(active[0].status).toBe('running');
  });

  // --- stopExecution ---

  test('stopExecution marks execution as stopped and returns true', async () => {
    fe.activeExecutions.set('run-1', { flowId: 'f1', status: 'running' });
    fe.completionListeners.set('run-1', {});
    const result = await fe.stopExecution('run-1');
    expect(result).toBe(true);
    expect(fe.activeExecutions.get('run-1').status).toBe('stopped');
    expect(fe.completionListeners.has('run-1')).toBe(false);
  });

  test('stopExecution returns false for nonexistent run', async () => {
    const result = await fe.stopExecution('nonexistent');
    expect(result).toBe(false);
  });

  // --- notifyAgentCompletion ---

  test('notifyAgentCompletion resolves waiting listener', () => {
    let resolved = null;
    fe.completionListeners.set('run-1-agent-1', {
      agentId: 'agent-1',
      runId: 'run-1',
      resolve: (data) => { resolved = data; }
    });
    const found = fe.notifyAgentCompletion('agent-1', { summary: 'Done', success: true });
    expect(found).toBe(true);
    expect(resolved).not.toBeNull();
    expect(resolved.summary).toBe('Done');
    expect(resolved.completed).toBe(true);
  });

  test('notifyAgentCompletion returns false when no listener found', () => {
    const found = fe.notifyAgentCompletion('unknown-agent', {});
    expect(found).toBe(false);
  });

  // --- executeFlow ---

  test('executeFlow with input+output nodes completes successfully', async () => {
    const flowId = 'test-flow';
    const flow = {
      id: flowId,
      name: 'Test Flow',
      nodes: [
        { id: 'in', type: 'input', data: {} },
        { id: 'out', type: 'output', data: {} }
      ],
      edges: [{ source: 'in', target: 'out' }],
      variables: {}
    };

    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-1' });
    stateManager.updateFlowRun = jest.fn().mockResolvedValue(undefined);
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    const result = await fe.executeFlow(flowId, { userInput: 'Hello' });
    expect(result.status).toBe('completed');
    expect(result.runId).toBe('run-1');
  });

  test('executeFlow throws when flow not found', async () => {
    stateManager.getFlow = jest.fn().mockResolvedValue(null);
    stateManager.createFlowRun = jest.fn();
    await expect(fe.executeFlow('missing-flow', {})).rejects.toThrow('Flow not found');
  });

  // --- schema validation gate (Phase 0) ---

  test('executeFlow refuses to run a flow with cycles (schema gate)', async () => {
    // The executor's belt-and-suspenders validator should reject this
    // BEFORE topologicalSort silently drops nodes.
    const cyclicFlow = {
      id: 'flow-cycle',
      name: 'Cyclic flow',
      nodes: [
        { id: 'a', type: 'agent', data: { agentId: 'x' } },
        { id: 'b', type: 'agent', data: { agentId: 'y' } },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    };
    stateManager.getFlow = jest.fn().mockResolvedValue(cyclicFlow);
    stateManager.createFlowRun = jest.fn();
    await expect(fe.executeFlow('flow-cycle', {})).rejects.toThrow(/invalid|cycle/i);
    // Critical: must not have created a run (we refused before persistence)
    expect(stateManager.createFlowRun).not.toHaveBeenCalled();
  });

  test('executeFlow refuses to run a flow with dangling edges', async () => {
    const brokenFlow = {
      id: 'flow-bad-edges',
      name: 'Broken edges',
      nodes: [{ id: 'in', type: 'input', data: {} }],
      edges: [{ source: 'in', target: 'ghost' }],
    };
    stateManager.getFlow = jest.fn().mockResolvedValue(brokenFlow);
    stateManager.createFlowRun = jest.fn();
    await expect(fe.executeFlow('flow-bad-edges', {})).rejects.toThrow(/invalid|ghost/i);
    expect(stateManager.createFlowRun).not.toHaveBeenCalled();
  });

  test('executeFlow refuses to run when an agent node has no agent assigned (clear error)', async () => {
    // Schema allows save with empty agentId (drafts). Executor must
    // refuse to run with a friendly message naming the unbound nodes.
    const noAgentFlow = {
      id: 'flow-no-agent',
      name: 'Agent without ID',
      nodes: [
        { id: 'in', type: 'input', data: {} },
        { id: 'ag', type: 'agent', data: { label: 'Writer' } },   // no agentId
      ],
      edges: [{ source: 'in', target: 'ag' }],
    };
    stateManager.getFlow = jest.fn().mockResolvedValue(noAgentFlow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-na' });
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();

    const result = await fe.executeFlow('flow-no-agent', {});
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Writer|no agent assigned/i);
  });

  // --- Phase 1: typed-input assembly in executeAgentNode ---

  test('executeAgentNode (v2) exposes typed inputs as template variables', async () => {
    // Build a v2 node that declares two inputs and a prompt template
    // referencing both by name. The mocked agent finishes immediately.
    const node = {
      id: 'w', type: 'agent', data: { agentId: 'writer', promptTemplate: 'Write about {{topic}} ({{count}})' },
      inputs:  [{ name: 'topic', type: 'text', required: true },
                { name: 'count', type: 'text', required: true }],
      outputs: [{ name: 'draft', type: 'text' }],
    };
    const flow = {
      id: 'f', name: 'Typed flow', schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', data: {}, inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
        node,
      ],
      edges: [
        { source: 'in', sourceField: 'topic', target: 'w', targetField: 'topic' },
        { source: 'in', sourceField: 'topic', target: 'w', targetField: 'count' },
      ],
    };
    const context = {
      input: '',
      // Source result advertises typed outputs map (preferred shape).
      nodeOutputs: { in: { type: 'input', outputs: { topic: 'AI safety' } } },
      variables: {},
      sortedNodes: flow.nodes,
      flow,
    };

    // Stub agent + completion: agentPool returns a usable agent; the
    // executor queues a message and waits for completion. We resolve it
    // immediately via notifyAgentCompletion to avoid the timeout path.
    const agent = { id: 'writer', name: 'Writer', mode: 'chat', conversationHistory: [] };
    agentPool.getAgent = jest.fn().mockResolvedValue(agent);
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    let capturedPrompt = null;
    messageProcessor.processMessage = jest.fn().mockImplementation(async (id, prompt) => {
      capturedPrompt = prompt;
      // Resolve completion on next tick so the awaiter is registered.
      // v2 node declares outputs[draft] → must include it in the bag.
      setImmediate(() => fe.notifyAgentCompletion(id, {
        summary: 'done', success: true,
        outputs: { draft: 'an article' },
      }));
    });

    await fe.executeAgentNode(node, context, 'run-1', null, flow);
    expect(capturedPrompt).toBe('Write about AI safety (AI safety)');
  });

  test('executeAgentNode (v2) stores structured outputs on the node result', async () => {
    // When the agent emits an outputs bag via job-done, the executor
    // should store it under .outputs on the node's recorded result, so
    // downstream nodes can read it via assembleNodeInputs.
    const node = {
      id: 'w', type: 'agent', data: { agentId: 'writer', promptTemplate: '{{topic}}' },
      inputs:  [{ name: 'topic', type: 'text', required: true }],
      outputs: [{ name: 'draft', type: 'text' }, { name: 'wordCount', type: 'number' }],
    };
    const flow = {
      id: 'f', name: 'Structured outputs', schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', data: {}, inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
        node,
      ],
      edges: [{ source: 'in', sourceField: 'topic', target: 'w', targetField: 'topic' }],
    };
    const context = {
      input: '',
      nodeOutputs: { in: { type: 'input', outputs: { topic: 'AI safety' } } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'writer', mode: 'chat' });
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    messageProcessor.processMessage = jest.fn().mockImplementation(async (id) => {
      setImmediate(() => fe.notifyAgentCompletion(id, {
        summary: 'wrote a draft',
        success: true,
        outputs: { draft: 'long text', wordCount: 850 },
      }));
    });

    const result = await fe.executeAgentNode(node, context, 'run-1', null, flow);
    expect(result.outputs).toEqual({ draft: 'long text', wordCount: 850 });
    expect(result.type).toBe('agent');
  });

  test('executeAgentNode (v2) throws when agent omits a required declared output', async () => {
    // Contract says { draft, wordCount } but agent only provides draft.
    // The executor refuses to commit a half-baked handoff.
    const node = {
      id: 'w', type: 'agent', data: { agentId: 'writer', promptTemplate: '{{topic}}' },
      inputs:  [{ name: 'topic', type: 'text', required: true }],
      outputs: [{ name: 'draft', type: 'text' }, { name: 'wordCount', type: 'number' }],
    };
    const flow = {
      id: 'f', name: 'Missing output', schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', data: {}, inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
        node,
      ],
      edges: [{ source: 'in', sourceField: 'topic', target: 'w', targetField: 'topic' }],
    };
    const context = {
      input: '',
      nodeOutputs: { in: { type: 'input', outputs: { topic: 'x' } } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'writer', mode: 'chat' });
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    messageProcessor.processMessage = jest.fn().mockImplementation(async (id) => {
      setImmediate(() => fe.notifyAgentCompletion(id, {
        summary: 'wrote a draft', success: true,
        outputs: { draft: 'just text' },               // wordCount missing
      }));
    });

    await expect(fe.executeAgentNode(node, context, 'run-1', null, flow))
      .rejects.toThrow(/wordCount/);
  });

  test('executeAgentNode (v2) throws when agent provides no outputs at all on a typed node', async () => {
    const node = {
      id: 'w', type: 'agent', data: { agentId: 'writer', promptTemplate: '{{topic}}' },
      inputs:  [{ name: 'topic', type: 'text', required: true }],
      outputs: [{ name: 'draft', type: 'text' }],
    };
    const flow = {
      id: 'f', name: 'No outputs', schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', data: {}, inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
        node,
      ],
      edges: [{ source: 'in', sourceField: 'topic', target: 'w', targetField: 'topic' }],
    };
    const context = {
      input: '',
      nodeOutputs: { in: { type: 'input', outputs: { topic: 'x' } } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'writer', mode: 'chat' });
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    messageProcessor.processMessage = jest.fn().mockImplementation(async (id) => {
      // No outputs field at all
      setImmediate(() => fe.notifyAgentCompletion(id, { summary: 'done', success: true }));
    });

    await expect(fe.executeAgentNode(node, context, 'run-1', null, flow))
      .rejects.toThrow(/draft/);
  });

  // -- Phase 8: getActiveContract for tool-level validation --

  describe('getActiveContract', () => {
    test('returns null when no contract registered for agent', () => {
      expect(fe.getActiveContract('agent-x')).toBe(null);
    });

    test('returns the registered contract for an agent', () => {
      const contract = { outputs: [{ name: 'draft', type: 'text' }] };
      fe.activeContracts.set('agent-x', contract);
      expect(fe.getActiveContract('agent-x')).toBe(contract);
    });

    test('contract is registered when executeAgentNode begins, cleared when it ends', async () => {
      // The full executeAgentNode cycle is heavy; this is a focused
      // unit test for the registration/cleanup contract. We check
      // that the contract is registered by attemptOnce and that
      // _activeContracts ends empty after a clean run.
      const node = {
        id: 'w', type: 'agent',
        data: { agentId: 'writer', promptTemplate: '{{input}}' },
        inputs: [{ name: 'input', type: 'text', required: true }],
        outputs: [{ name: 'draft', type: 'text' }],
      };
      const flow = {
        id: 'f', name: 'contract-lifecycle', schemaVersion: 2,
        nodes: [
          { id: 'in', type: 'input', data: {}, inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
          node,
        ],
        edges: [{ source: 'in', sourceField: 'topic', target: 'w', targetField: 'input' }],
      };
      const context = {
        input: 'hi', nodeOutputs: { in: { type: 'input', outputs: { topic: 'hi' } } },
        variables: {}, sortedNodes: flow.nodes, flow,
      };
      agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'writer', mode: 'chat' });
      agentPool.persistAgentState = jest.fn().mockResolvedValue();
      agentPool.clearConversation = jest.fn().mockResolvedValue();
      stateManager.updateFlowRun = jest.fn().mockResolvedValue();
      stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'r', nodeStates: {} });

      messageProcessor.processMessage = jest.fn().mockImplementation(async (id) => {
        // While the call is in-flight, the contract should be registered
        expect(fe.getActiveContract('writer')).toBeTruthy();
        expect(fe.getActiveContract('writer').outputs).toHaveLength(1);
        setImmediate(() => fe.notifyAgentCompletion(id, {
          summary: 'done', success: true, outputs: { draft: 'D' },
        }));
      });

      await fe.executeAgentNode(node, context, 'r', null, flow);
      // After completion, contract is cleared
      expect(fe.getActiveContract('writer')).toBe(null);
    });
  });

  // -- ensureAgentsLoaded: broadcast safety --

  test('ensureAgentsLoaded survives a webSocketManager that lacks broadcast()', async () => {
    // Regression: when wired to the WebServer instance (which only has
    // broadcastToSession), the executor used to crash with
    // "this.webSocketManager.broadcast is not a function" mid-load,
    // killing the run.
    const wsm = { broadcastToSession: jest.fn() };  // no .broadcast
    fe.setWebSocketManager(wsm);
    agentPool.getAgent = jest.fn().mockResolvedValue(null);  // not loaded
    stateManager.importArchivedAgent = jest.fn().mockResolvedValue({
      id: 'a1', name: 'A', status: 'active', currentModel: 'm', capabilities: [],
    });

    await expect(fe.ensureAgentsLoaded([
      { id: 'n', type: 'agent', data: { agentId: 'a1' } },
    ])).resolves.not.toThrow();

    // Falls back to broadcastToSession(null, msg)
    expect(wsm.broadcastToSession).toHaveBeenCalledWith(null, expect.objectContaining({
      type: 'agent-loaded',
    }));
  });

  test('ensureAgentsLoaded survives a webSocketManager whose broadcast throws', async () => {
    const wsm = { broadcast: jest.fn().mockImplementation(() => { throw new Error('boom'); }) };
    fe.setWebSocketManager(wsm);
    agentPool.getAgent = jest.fn().mockResolvedValue(null);
    stateManager.importArchivedAgent = jest.fn().mockResolvedValue({ id: 'a2', name: 'B' });

    // Must not throw — broadcast errors are UX-only
    await expect(fe.ensureAgentsLoaded([
      { id: 'n', type: 'agent', data: { agentId: 'a2' } },
    ])).resolves.not.toThrow();
  });

  // -- Handoff fixes (data forwarding + re-prompt) --

  describe('buildPreviousAgentData (handoff data forwarding)', () => {
    test('forwards structured outputs bag from upstream agent', () => {
      const flow = { id: 'f', edges: [{ source: 'a', target: 'b' }] };
      const ctx = {
        nodeOutputs: {
          a: { type: 'agent', agentId: 'a-id', agentName: 'A', output: 'summary',
               outputs: { draft: 'long text', wordCount: 850 } },
        },
      };
      const r = fe.buildPreviousAgentData({ id: 'b' }, ctx, flow);
      expect(r.outputs).toEqual({ draft: 'long text', wordCount: 850 });
      expect(r.summary).toBe('summary');
      expect(r.agentName).toBe('A');
    });

    test('returns null when no upstream agent contributors', () => {
      const flow = { id: 'f', edges: [{ source: 'in', target: 'b' }] };
      const ctx = { nodeOutputs: { in: { type: 'input', output: 'hi' } } };
      expect(fe.buildPreviousAgentData({ id: 'b' }, ctx, flow)).toBe(null);
    });

    test('omits outputs field when upstream had no structured bag', () => {
      const flow = { id: 'f', edges: [{ source: 'a', target: 'b' }] };
      const ctx = {
        nodeOutputs: {
          a: { type: 'agent', agentId: 'a', output: 'just text', outputs: undefined },
        },
      };
      const r = fe.buildPreviousAgentData({ id: 'b' }, ctx, flow);
      expect(r.outputs).toBeUndefined();
    });

    test('merges outputs from multiple upstream agents (fan-in)', () => {
      const flow = { id: 'f', edges: [
        { source: 'a', target: 'c' },
        { source: 'b', target: 'c' },
      ]};
      const ctx = {
        nodeOutputs: {
          a: { type: 'agent', agentId: 'a', output: 'A done', outputs: { findings: 'X' } },
          b: { type: 'agent', agentId: 'b', output: 'B done', outputs: { trends: 'Y' } },
        },
      };
      const r = fe.buildPreviousAgentData({ id: 'c' }, ctx, flow);
      expect(r.outputs).toEqual({ findings: 'X', trends: 'Y' });
      expect(Array.isArray(r.contributors)).toBe(true);
      expect(r.contributors).toHaveLength(2);
    });

    test('later contributor wins on field-name collision', () => {
      const flow = { id: 'f', edges: [
        { source: 'a', target: 'c' },
        { source: 'b', target: 'c' },
      ]};
      const ctx = {
        nodeOutputs: {
          a: { type: 'agent', agentId: 'a', output: '', outputs: { result: 'first' } },
          b: { type: 'agent', agentId: 'b', output: '', outputs: { result: 'second' } },
        },
      };
      const r = fe.buildPreviousAgentData({ id: 'c' }, ctx, flow);
      expect(r.outputs.result).toBe('second');
    });
  });

  test('executeAgentNode (v1) prefers full assistant response when summary is too brief', async () => {
    // Bug class we're fixing: agent calls jobdone with {summary: "Done."}
    // and skips details. Old behavior used "Done." as the next agent's
    // entire context. Now we fall back to lastAssistantMessage so the
    // next agent has real content to read.
    const node = { id: 'w', type: 'agent', data: { agentId: 'writer', promptTemplate: '{{input}}' } };
    const flow = {
      id: 'f', name: 'fallback test',
      nodes: [{ id: 'in', type: 'input', data: {} }, node],
      edges: [{ source: 'in', target: 'w' }],
    };
    const context = {
      input: 'hi',
      nodeOutputs: { in: { type: 'input', output: 'hi' } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    const fullAssistantMessage = 'Here is the FULL output the agent actually produced — paragraphs of useful work that we want passed downstream.';
    agentPool.getAgent = jest.fn().mockResolvedValue({
      id: 'writer', mode: 'chat',
      conversations: { full: { messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: fullAssistantMessage },
      ]}},
    });
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    messageProcessor.processMessage = jest.fn().mockImplementation(async (id) => {
      // Brief summary, no details — the failure mode the user reported
      setImmediate(() => fe.notifyAgentCompletion(id, { summary: 'Done.', success: true }));
    });

    const result = await fe.executeAgentNode(node, context, 'run-1', null, flow);
    expect(result.output).toBe(fullAssistantMessage);
  });

  test('executeAgentNode glues summary + details when both present', async () => {
    const node = { id: 'w', type: 'agent', data: { agentId: 'writer', promptTemplate: '{{input}}' } };
    const flow = {
      id: 'f', name: 'glue test',
      nodes: [{ id: 'in', type: 'input', data: {} }, node],
      edges: [{ source: 'in', target: 'w' }],
    };
    const context = {
      input: 'hi',
      nodeOutputs: { in: { type: 'input', output: 'hi' } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'writer', mode: 'chat' });
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    messageProcessor.processMessage = jest.fn().mockImplementation(async (id) => {
      setImmediate(() => fe.notifyAgentCompletion(id, {
        summary: 'A complete summary that is sufficiently descriptive',
        details: 'Plus extra details about the work',
        success: true,
      }));
    });
    const r = await fe.executeAgentNode(node, context, 'run-1', null, flow);
    expect(r.output).toContain('complete summary');
    expect(r.output).toContain('extra details');
  });

  test('executeAgentNode (v2) re-prompts in-conversation when outputs missing, then succeeds', async () => {
    // The agent's first job-done is missing wordCount. The executor
    // must send a corrective message in the SAME conversation (no
    // clearConversation between attempts) and accept the fixed reply.
    const node = {
      id: 'w', type: 'agent', data: { agentId: 'writer', promptTemplate: '{{input}}' },
      inputs: [{ name: 'input', type: 'text', required: true }],
      outputs: [
        { name: 'draft',     type: 'text' },
        { name: 'wordCount', type: 'number' },
      ],
    };
    const flow = {
      id: 'f', name: 'reprompt test', schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', data: {}, inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
        node,
      ],
      edges: [{ source: 'in', sourceField: 'topic', target: 'w', targetField: 'input' }],
    };
    const context = {
      input: 'AI',
      nodeOutputs: { in: { type: 'input', outputs: { topic: 'AI' } } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'writer', mode: 'chat' });
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    let call = 0;
    messageProcessor.processMessage = jest.fn().mockImplementation(async (id, _prompt, opts) => {
      call++;
      // First call: incomplete outputs (missing wordCount).
      // Second call (re-prompt): complete outputs.
      if (call === 1) {
        setImmediate(() => fe.notifyAgentCompletion(id, {
          summary: 'wrote draft', success: true,
          outputs: { draft: 'long text' },        // wordCount missing
        }));
      } else {
        // Re-prompt should NOT clear conversation between attempts —
        // verify by ensuring clearConversation count stays at 1.
        setImmediate(() => fe.notifyAgentCompletion(id, {
          summary: 'fixed', success: true,
          outputs: { draft: 'long text', wordCount: 850 },
        }));
        // Sanity: opts.isReprompt should be true on the corrective msg
        expect(opts?.isReprompt).toBe(true);
      }
    });

    const r = await fe.executeAgentNode(node, context, 'run-1', null, flow);
    expect(r.outputs).toEqual({ draft: 'long text', wordCount: 850 });
    // 1 initial + 1 reprompt = 2 messages
    expect(messageProcessor.processMessage).toHaveBeenCalledTimes(2);
    // Conversation cleared once (start of attempt 0), NOT between
    // re-prompts within an attempt.
    expect(agentPool.clearConversation).toHaveBeenCalledTimes(1);
  });

  test('executeAgentNode (v2) escalates to outer retry after re-prompts exhausted', async () => {
    // If the agent stubbornly emits incomplete outputs even after
    // re-prompts, attemptOnce throws an agent-error which runWithRetry
    // catches → fresh agent invocation (clearConversation).
    const node = {
      id: 'w', type: 'agent',
      data: { agentId: 'writer', promptTemplate: '{{input}}' },
      execution: { timeoutMs: 1000, maxRetries: 1, backoffBaseMs: 1, backoffMultiplier: 1 },
      inputs: [{ name: 'input', type: 'text', required: true }],
      outputs: [{ name: 'draft', type: 'text' }],
    };
    const flow = {
      id: 'f', name: 'reprompt escalation', schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', data: {}, inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
        node,
      ],
      edges: [{ source: 'in', sourceField: 'topic', target: 'w', targetField: 'input' }],
    };
    const context = {
      input: 'X',
      nodeOutputs: { in: { type: 'input', outputs: { topic: 'X' } } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'writer', mode: 'chat' });
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    // Always emits empty outputs — never satisfies contract
    messageProcessor.processMessage = jest.fn().mockImplementation(async (id) => {
      setImmediate(() => fe.notifyAgentCompletion(id, {
        summary: 'still incomplete', success: true, outputs: {},
      }));
    });

    await expect(fe.executeAgentNode(node, context, 'run-1', null, flow)).rejects.toThrow(/draft/);
    // Outer retries = 1 → 2 attempts × (1 initial + 2 reprompts) = 6 calls
    expect(messageProcessor.processMessage).toHaveBeenCalledTimes(6);
    // Conversation cleared once per outer attempt (2 total)
    expect(agentPool.clearConversation).toHaveBeenCalledTimes(2);
  });

  // -- Phase 6.3: flow version stamp on runs --

  test('executeFlow stamps flow.version onto the run record', async () => {
    const flow = {
      id: 'fv', name: 'versioned',
      version: 7,
      nodes: [{ id: 'in', type: 'input', data: {} }, { id: 'out', type: 'output', data: {} }],
      edges: [{ source: 'in', target: 'out' }],
    };
    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-v' });
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-v', nodeStates: {} });
    const updates = [];
    stateManager.updateFlowRun = jest.fn().mockImplementation(async (_, patch) => { updates.push(patch); });

    await fe.executeFlow('fv', { userInput: 'hi' });
    // First updateFlowRun call after creation should stamp flowVersion
    const stampUpdate = updates.find(u => u.flowVersion !== undefined);
    expect(stampUpdate).toBeDefined();
    expect(stampUpdate.flowVersion).toBe(7);
  });

  test('executeFlow stamps null flowVersion when flow has no version field', async () => {
    const flow = {
      id: 'fnv', name: 'unversioned',
      nodes: [{ id: 'in', type: 'input', data: {} }, { id: 'out', type: 'output', data: {} }],
      edges: [{ source: 'in', target: 'out' }],
    };
    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-nv' });
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-nv', nodeStates: {} });
    const updates = [];
    stateManager.updateFlowRun = jest.fn().mockImplementation(async (_, patch) => { updates.push(patch); });

    await fe.executeFlow('fnv', { userInput: 'hi' });
    const stampUpdate = updates.find(u => u.flowVersion !== undefined);
    expect(stampUpdate).toBeDefined();
    expect(stampUpdate.flowVersion).toBeNull();
  });

  // -- Phase 6.1: per-node persisted errors --

  test('updateNodeState stores errorInfo when provided', async () => {
    const captured = [];
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'r1', nodeStates: {} });
    stateManager.updateFlowRun = jest.fn().mockImplementation(async (runId, patch) => {
      captured.push(patch);
    });
    const errorInfo = { kind: 'timeout', message: 'too slow', attempts: [{ attempt: 0, error: { kind: 'timeout', message: 't' } }], lastAt: '2026-01-01T00:00:00Z' };
    await fe.updateNodeState('r1', 'n1', 'failed', { error: 'too slow' }, errorInfo);
    const last = captured.at(-1);
    expect(last.nodeStates.n1.status).toBe('failed');
    expect(last.nodeStates.n1.error).toEqual(errorInfo);
  });

  test('updateNodeState omits error field when no errorInfo', async () => {
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'r1', nodeStates: {} });
    let captured;
    stateManager.updateFlowRun = jest.fn().mockImplementation(async (_, patch) => { captured = patch; });
    await fe.updateNodeState('r1', 'n1', 'completed', { type: 'agent', output: 'ok' });
    expect(captured.nodeStates.n1.error).toBeUndefined();
  });

  test('failed agent node persists kind=timeout + attempt history into nodeStates', async () => {
    // Per-node timeout very small + maxRetries=1 → both attempts hang
    // → executor throws with kind:'timeout' + attempts[]. The catch in
    // executeNode must capture both into nodeStates[id].error.
    const node = {
      id: 'w', type: 'agent',
      data: { agentId: 'writer', promptTemplate: '{{input}}' },
      execution: { timeoutMs: 20, maxRetries: 1, backoffBaseMs: 1, backoffMultiplier: 1 },
    };
    const flow = {
      id: 'f', name: 'fail flow',
      nodes: [{ id: 'in', type: 'input', data: {} }, node],
      edges: [{ source: 'in', target: 'w' }],
    };
    const context = {
      input: 'x',
      nodeOutputs: { in: { type: 'input', output: 'x' } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'writer', mode: 'chat' });
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
    messageProcessor.processMessage = jest.fn().mockResolvedValue();   // never notify

    const captured = [];
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-fail', nodeStates: {} });
    stateManager.updateFlowRun = jest.fn().mockImplementation(async (_, patch) => { captured.push(patch); });

    await expect(fe.executeNode(node, context, 'run-fail', null, flow)).rejects.toMatchObject({ kind: 'timeout' });

    // Find the failed update — node state must include error + attempts
    const failedUpdate = captured.find(p => p.nodeStates?.w?.status === 'failed');
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate.nodeStates.w.error.kind).toBe('timeout');
    expect(failedUpdate.nodeStates.w.error.attempts).toBeDefined();
    expect(failedUpdate.nodeStates.w.error.lastAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // -- Phase 4: disk checkpoint + resume --

  test('checkpointStore receives node results when set, none when null', async () => {
    const flow = {
      id: 'f', name: 'cp test',
      nodes: [{ id: 'in', type: 'input', data: {} }, { id: 'out', type: 'output', data: {} }],
      edges: [{ source: 'in', target: 'out' }],
      variables: {},
    };
    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-cp' });
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-cp', nodeStates: {} });

    const saveNodeResult = jest.fn().mockResolvedValue();
    fe.setCheckpointStore({ saveNodeResult });
    await fe.executeFlow('f', { userInput: 'hello' });
    // 2 nodes → 2 saves
    expect(saveNodeResult).toHaveBeenCalledTimes(2);
    expect(saveNodeResult).toHaveBeenCalledWith('run-cp', 'in', expect.any(Object));
    expect(saveNodeResult).toHaveBeenCalledWith('run-cp', 'out', expect.any(Object));
  });

  test('resumeFlow throws when no checkpoint store is configured', async () => {
    fe.setCheckpointStore(null);
    await expect(fe.resumeFlow('run-x')).rejects.toThrow(/checkpoint store/i);
  });

  test('resumeFlow short-circuits when run is already completed', async () => {
    fe.setCheckpointStore({
      loadAllNodeResults: jest.fn(),
      saveNodeResult: jest.fn(),
    });
    stateManager.getFlowRun = jest.fn().mockResolvedValue({
      id: 'run-done', flowId: 'f', status: 'completed', output: { final: 'yes' },
    });
    const r = await fe.resumeFlow('run-done');
    expect(r.status).toBe('completed');
    expect(r.output).toEqual({ final: 'yes' });
  });

  test('resumeFlow skips already-completed nodes and runs only the rest', async () => {
    // 3-node flow: in → mid → out. Pretend "in" already completed.
    const flow = {
      id: 'f-resume', name: 'resume test',
      nodes: [
        { id: 'in',  type: 'input',  data: {} },
        { id: 'mid', type: 'output', data: {} },   // use output node so we don't need agentPool wiring
        { id: 'out', type: 'output', data: {} },
      ],
      edges: [
        { source: 'in',  target: 'mid' },
        { source: 'mid', target: 'out' },
      ],
      variables: {},
    };
    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.getFlowRun = jest.fn().mockResolvedValue({
      id: 'run-r', flowId: 'f-resume', status: 'failed',
      initialInput: { userInput: 'hi' }, nodeStates: {},
    });
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();

    const persistedOutputs = {
      in: { type: 'input', output: 'hi-from-checkpoint' },
    };
    const saveNodeResult = jest.fn().mockResolvedValue();
    fe.setCheckpointStore({
      loadAllNodeResults: jest.fn().mockResolvedValue(persistedOutputs),
      saveNodeResult,
    });

    // Spy on executeNode so we can verify only mid+out are executed.
    const calls = [];
    const realExec = fe.executeNode.bind(fe);
    fe.executeNode = jest.fn(async (node, context, runId, sessionId, f) => {
      calls.push(node.id);
      return realExec(node, context, runId, sessionId, f);
    });

    const r = await fe.resumeFlow('run-r');
    expect(r.status).toBe('completed');
    // "in" was checkpointed → executeNode never called for it
    expect(calls).toEqual(['mid', 'out']);
    // Two new checkpoints saved (mid, out)
    expect(saveNodeResult).toHaveBeenCalledTimes(2);
  });

  // -- Phase 3: per-node retry + per-node timeout --

  test('_resolveExecutionConfig honors node > flow > config > defaults precedence', () => {
    config.flows = { execution: { timeoutMs: 1000, maxRetries: 5 } };
    const flow = { execution: { timeoutMs: 2000 } };
    const node = { execution: { timeoutMs: 3000 } };
    const r = fe._resolveExecutionConfig(node, flow);
    expect(r.timeoutMs).toBe(3000);   // node wins
    expect(r.maxRetries).toBe(5);     // falls through to global
    expect(r.retryOn).toEqual(['timeout', 'agent-error']);  // default
  });

  test('_resolveExecutionConfig honors legacy config.flows.nodeTimeout when no execution config given', () => {
    config.flows = { nodeTimeout: 7777 };
    const r = fe._resolveExecutionConfig({}, {});
    expect(r.timeoutMs).toBe(7777);
  });

  test('_resolveExecutionConfig defaults: maxRetries=1, timeoutMs=300000', () => {
    // Phase 7 hardening: bumped default maxRetries 0→1 so a single
    // structured-output miss doesn't fail the whole flow when re-prompts
    // didn't recover. Override per-node to 0 to disable.
    delete config.flows;
    const r = fe._resolveExecutionConfig({}, {});
    expect(r.maxRetries).toBe(1);
    expect(r.timeoutMs).toBe(300000);
  });

  test('executeAgentNode retries on timeout and eventually succeeds', async () => {
    // Tiny per-node timeout + 2 retries. First two processMessage calls
    // never resolve the awaiter (simulated hang); the third does.
    const node = {
      id: 'w', type: 'agent',
      data: { agentId: 'writer', promptTemplate: '{{input}}' },
      execution: { timeoutMs: 50, maxRetries: 2, backoffBaseMs: 1, backoffMultiplier: 1 },
    };
    const flow = {
      id: 'f', name: 'Retry on timeout',
      nodes: [{ id: 'in', type: 'input', data: {} }, node],
      edges: [{ source: 'in', target: 'w' }],
    };
    const context = {
      input: 'hi',
      nodeOutputs: { in: { type: 'input', output: 'hi' } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'writer', mode: 'chat' });
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    let calls = 0;
    messageProcessor.processMessage = jest.fn().mockImplementation(async (id) => {
      calls++;
      if (calls < 3) return;       // hang the awaiter → timeout
      setImmediate(() => fe.notifyAgentCompletion(id, { summary: 'finally', success: true }));
    });

    const result = await fe.executeAgentNode(node, context, 'run-1', null, flow);
    expect(result.output).toBe('finally');
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts[0].error.kind).toBe('timeout');
    expect(result.attempts[1].error.kind).toBe('timeout');
    expect(result.attempts[2].error).toBeUndefined();
  });

  test('executeAgentNode exhausts retries then throws with kind=timeout', async () => {
    const node = {
      id: 'w', type: 'agent',
      data: { agentId: 'writer', promptTemplate: '{{input}}' },
      execution: { timeoutMs: 30, maxRetries: 1, backoffBaseMs: 1, backoffMultiplier: 1 },
    };
    const flow = {
      id: 'f', name: 'Persistent timeout',
      nodes: [{ id: 'in', type: 'input', data: {} }, node],
      edges: [{ source: 'in', target: 'w' }],
    };
    const context = {
      input: 'hi',
      nodeOutputs: { in: { type: 'input', output: 'hi' } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'writer', mode: 'chat' });
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    messageProcessor.processMessage = jest.fn().mockResolvedValue();   // never notify

    await expect(fe.executeAgentNode(node, context, 'run-1', null, flow))
      .rejects.toMatchObject({ kind: 'timeout' });
  });

  test('executeAgentNode (v1) ignores outputs validation entirely', async () => {
    // Legacy node has no inputs[]/outputs[] — the executor should NOT
    // try to validate a non-existent contract.
    const node = {
      id: 'w', type: 'agent',
      data: { agentId: 'writer', promptTemplate: '{{input}}' },
    };
    const flow = {
      id: 'f', name: 'Legacy',
      nodes: [{ id: 'in', type: 'input', data: {} }, node],
      edges: [{ source: 'in', target: 'w' }],
    };
    const context = {
      input: 'hello',
      nodeOutputs: { in: { type: 'input', output: 'hello' } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'writer', mode: 'chat' });
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    messageProcessor.processMessage = jest.fn().mockImplementation(async (id) => {
      setImmediate(() => fe.notifyAgentCompletion(id, { summary: 'done', success: true }));
    });
    const result = await fe.executeAgentNode(node, context, 'run-1', null, flow);
    expect(result.type).toBe('agent');
    expect(result.output).toBe('done');
  });

  test('executeAgentNode (v2) throws when a required input has no inbound edge', async () => {
    const node = {
      id: 'w', type: 'agent', data: { agentId: 'writer', promptTemplate: '{{topic}}' },
      inputs:  [{ name: 'topic',    type: 'text', required: true },
                { name: 'research', type: 'json', required: true }],   // unbound
      outputs: [{ name: 'draft', type: 'text' }],
    };
    const flow = {
      id: 'f', name: 'Missing required',
      nodes: [
        { id: 'in', type: 'input', data: {}, inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
        node,
      ],
      edges: [
        { source: 'in', sourceField: 'topic', target: 'w', targetField: 'topic' },
        // no edge feeds w.research
      ],
    };
    const context = {
      input: '',
      nodeOutputs: { in: { type: 'input', outputs: { topic: 'x' } } },
      variables: {},
      sortedNodes: flow.nodes,
      flow,
    };
    agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'writer', mode: 'chat' });
    // Should throw before queueing a message.
    await expect(fe.executeAgentNode(node, context, 'run-1', null, flow)).rejects.toThrow(/research/);
    expect(messageProcessor.processMessage).not.toHaveBeenCalled();
  });

  // --- truncateOutput ---

  test('truncateOutput truncates long strings', () => {
    const longStr = 'x'.repeat(2000);
    const result = fe.truncateOutput(longStr);
    expect(result.length).toBeLessThan(2000);
    expect(result).toContain('truncated');
  });

  test('truncateOutput returns short strings unchanged', () => {
    expect(fe.truncateOutput('short')).toBe('short');
  });

  test('truncateOutput handles large objects', () => {
    const obj = { data: 'x'.repeat(2000) };
    const result = fe.truncateOutput(obj);
    expect(result.truncated).toBe(true);
    expect(result.preview).toBeDefined();
  });

  // Regression lock: agent completion results with structured `outputs`
  // must preserve `outputs` verbatim. Truncating the whole result blob
  // (the pre-fix behavior) breaks downstream edge field-mapping —
  // `writer.bullets → critic.bullets` would deliver `null` because the
  // captured run dump only had {truncated: true, preview: "..."}
  // instead of the real list. See e2e dump from 2026-04-29: every
  // long-output node showed null handoffs even when the agent's
  // jobdone payload was structurally perfect.
  test('truncateOutput preserves structured outputs on agent completion shape', () => {
    const longDraft = 'climate change '.repeat(200);     // ~3 KB
    const longPreview = 'preview text '.repeat(200);     // ~2.5 KB
    const completion = {
      type: 'agent',
      agentId: 'agent-1',
      output: longPreview,
      summary: 'Wrote a paragraph',
      outputs: { draft: longDraft, wordCount: 145 },
    };
    const result = fe.truncateOutput(completion);

    // outputs object preserved exactly — downstream edges depend on this
    expect(result.outputs).toBeDefined();
    expect(result.outputs.draft).toBe(longDraft);
    expect(result.outputs.wordCount).toBe(145);

    // Long prose fields get the legacy string truncation
    expect(result.output.length).toBe(1000 + '... (truncated)'.length);
    expect(result.output.endsWith('... (truncated)')).toBe(true);

    // Top-level metadata (not a string, not 'outputs') stays
    expect(result.type).toBe('agent');
    expect(result.agentId).toBe('agent-1');
  });

  test('truncateOutput still falls back to {truncated, preview} for non-completion blobs', () => {
    // Random object without a structured `outputs` key behaves like
    // before — get the legacy preview-marker shape.
    const obj = { someBigField: 'x'.repeat(2000) };
    const result = fe.truncateOutput(obj);
    expect(result.truncated).toBe(true);
    expect(result.preview).toBeDefined();
  });

  // --- applyTemplate ---

  test('applyTemplate substitutes variables', () => {
    const result = fe.applyTemplate('Hello {{name}}, you have {{count}} items', { name: 'Alice', count: 5 });
    expect(result).toBe('Hello Alice, you have 5 items');
  });

  // --- collectPreviousOutput ---

  test('collectPreviousOutput combines multiple outputs', () => {
    const nodeOutputs = {
      n1: { output: 'First' },
      n2: { output: 'Second' }
    };
    const result = fe.collectPreviousOutput(['n1', 'n2'], nodeOutputs);
    expect(result).toContain('First');
    expect(result).toContain('Second');
  });

  test('collectPreviousOutput returns empty string for no outputs', () => {
    expect(fe.collectPreviousOutput([], {})).toBe('');
  });
});
