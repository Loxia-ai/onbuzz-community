/**
 * End-to-end integration tests for Flows v2.
 *
 * These exercise FULL pipelines (multiple agent nodes, edges, typed I/O)
 * through executeFlow → assembleNodeInputs → flowContextService →
 * messageProcessor → jobdone-completion → resumeFlow, asserting the
 * exact handoff content one agent passes to the next.
 *
 * The unit tests prove each helper works alone. THESE prove the helpers
 * COMPOSE correctly — which is where bugs like "the outputs bag was
 * silently dropped between nodes" actually live.
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { createMockLogger, createMockConfig, createMockStateManager, createMockAgentPool } from '../../__test-utils__/mockFactories.js';

jest.unstable_mockModule('../../utilities/constants.js', () => ({
  AGENT_MODES: { CHAT: 'chat', AGENT: 'agent' },
}));

const { default: FlowExecutor } = await import('../flowExecutor.js');
const { default: FlowContextService } = await import('../../services/flowContextService.js');
const { FlowCheckpointStore } = await import('../flowCheckpointStore.js');

// Helper: build a 3-stage v2 typed flow (researcher → writer → reviewer)
function buildResearchFlow() {
  return {
    id: 'flow-e2e', name: 'E2E research flow', schemaVersion: 2,
    nodes: [
      { id: 'in', type: 'input', data: {},
        inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
      { id: 'researcher', type: 'agent',
        data: { agentId: 'researcher', label: 'Researcher',
          promptTemplate: 'Research: {{topic}}' },
        inputs:  [{ name: 'topic', type: 'text', required: true }],
        outputs: [
          { name: 'findings', type: 'json' },
          { name: 'citations', type: 'list<text>' },
        ] },
      { id: 'writer', type: 'agent',
        data: { agentId: 'writer', label: 'Writer',
          promptTemplate: 'Write about {{topic}} using findings: {{findings}}' },
        inputs: [
          { name: 'topic',    type: 'text', required: true },
          { name: 'findings', type: 'json', required: true },
        ],
        outputs: [{ name: 'draft', type: 'text' }] },
      { id: 'reviewer', type: 'agent',
        data: { agentId: 'reviewer', label: 'Reviewer',
          promptTemplate: 'Review: {{draft}} (citations: {{citations}})' },
        inputs: [
          { name: 'draft',     type: 'text',       required: true },
          { name: 'citations', type: 'list<text>', required: true },
        ],
        outputs: [{ name: 'verdict', type: 'text' }] },
      { id: 'out', type: 'output', data: { outputFormat: 'markdown' },
        inputs: [{ name: 'context', type: 'text', required: true }], outputs: [] },
    ],
    edges: [
      { source: 'in',         sourceField: 'topic',     target: 'researcher', targetField: 'topic' },
      { source: 'in',         sourceField: 'topic',     target: 'writer',     targetField: 'topic' },
      { source: 'researcher', sourceField: 'findings',  target: 'writer',     targetField: 'findings' },
      { source: 'researcher', sourceField: 'citations', target: 'reviewer',   targetField: 'citations' },
      { source: 'writer',     sourceField: 'draft',     target: 'reviewer',   targetField: 'draft' },
      { source: 'reviewer',   sourceField: 'verdict',   target: 'out',        targetField: 'context' },
    ],
    variables: {},
  };
}

describe('End-to-end: 3-agent typed flow', () => {
  let fe, config, logger, stateManager, agentPool, messageProcessor;
  let promptsByAgent;       // agentId → array of prompt strings sent
  let completionsByAgent;   // agentId → number of times agent completed

  beforeEach(() => {
    config = createMockConfig();
    logger = createMockLogger();
    stateManager = createMockStateManager();
    agentPool = createMockAgentPool();
    promptsByAgent = {};
    completionsByAgent = {};

    messageProcessor = {
      processMessage: jest.fn().mockImplementation(async (agentId, prompt) => {
        promptsByAgent[agentId] = promptsByAgent[agentId] || [];
        promptsByAgent[agentId].push(prompt);

        // Simulate the agent "doing work" and emitting structured outputs
        // matching the node's declared contract.
        completionsByAgent[agentId] = (completionsByAgent[agentId] || 0) + 1;
        let outputs;
        if (agentId === 'researcher') {
          outputs = {
            findings: { topic: 'AI safety', summary: 'Safety is hard' },
            citations: ['Bostrom 2014', 'Russell 2019'],
          };
        } else if (agentId === 'writer') {
          outputs = { draft: 'A 500-word article on AI safety...' };
        } else if (agentId === 'reviewer') {
          outputs = { verdict: 'Approved with minor notes' };
        }
        setImmediate(() => fe.notifyAgentCompletion(agentId, {
          summary: `${agentId} completed`,
          success: true,
          outputs,
        }));
      }),
    };

    fe = new FlowExecutor(config, logger, stateManager, agentPool, messageProcessor);

    // Stub agentPool to "have" all three agents already loaded.
    agentPool.getAgent = jest.fn().mockImplementation(async (id) => ({
      id, name: id, mode: 'chat',
      conversations: { full: { messages: [] } },
    }));
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
  });

  test('runs all three agents in topological order', async () => {
    const flow = buildResearchFlow();
    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-e2e' });
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-e2e', nodeStates: {} });

    const result = await fe.executeFlow('flow-e2e', { userInput: 'AI safety' });

    expect(result.status).toBe('completed');
    expect(completionsByAgent.researcher).toBe(1);
    expect(completionsByAgent.writer).toBe(1);
    expect(completionsByAgent.reviewer).toBe(1);
  });

  test('writer prompt contains researcher outputs assembled by NAME', async () => {
    const flow = buildResearchFlow();
    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-1' });
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-1', nodeStates: {} });

    await fe.executeFlow('flow-e2e', { userInput: 'AI safety' });

    // Writer's prompt template was: "Write about {{topic}} using findings: {{findings}}"
    // {{topic}} ← in.topic = 'AI safety'
    // {{findings}} ← researcher.findings = {topic, summary} (JSON-stringified)
    const writerPrompt = promptsByAgent.writer?.[0];
    expect(writerPrompt).toBeDefined();
    expect(writerPrompt).toContain('AI safety');
    // The findings object should be present in some form (stringified)
    expect(writerPrompt).toMatch(/Safety is hard/);
  });

  test('reviewer prompt contains BOTH writer.draft AND researcher.citations (fan-in)', async () => {
    const flow = buildResearchFlow();
    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-2' });
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-2', nodeStates: {} });

    await fe.executeFlow('flow-e2e', { userInput: 'AI safety' });

    const reviewerPrompt = promptsByAgent.reviewer?.[0];
    expect(reviewerPrompt).toBeDefined();
    // {{draft}} from writer
    expect(reviewerPrompt).toContain('500-word article');
    // {{citations}} from researcher (passed through writer's stage as a fan-in)
    expect(reviewerPrompt).toContain('Bostrom 2014');
    expect(reviewerPrompt).toContain('Russell 2019');
  });

  test('flowMetadata is correctly numbered for each step', async () => {
    const flow = buildResearchFlow();
    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-meta' });
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-meta', nodeStates: {} });

    const calls = [];
    messageProcessor.processMessage = jest.fn().mockImplementation(async (agentId, _p, opts) => {
      calls.push({ agentId, flowMetadata: opts.flowMetadata, nodeContract: opts.nodeContract });
      // Provide outputs so the contract validator passes
      let outputs;
      if (agentId === 'researcher') outputs = { findings: {}, citations: [] };
      else if (agentId === 'writer') outputs = { draft: 'x' };
      else if (agentId === 'reviewer') outputs = { verdict: 'ok' };
      setImmediate(() => fe.notifyAgentCompletion(agentId, { summary: `${agentId} done`, success: true, outputs }));
    });

    await fe.executeFlow('flow-e2e', { userInput: 'AI safety' });

    expect(calls).toHaveLength(3);
    expect(calls[0].flowMetadata).toMatchObject({ nodeName: 'Researcher', nodePosition: 2, totalNodes: 5 });
    expect(calls[1].flowMetadata).toMatchObject({ nodeName: 'Writer',     nodePosition: 3, totalNodes: 5 });
    expect(calls[2].flowMetadata).toMatchObject({ nodeName: 'Reviewer',   nodePosition: 4, totalNodes: 5 });
    // Node contracts forwarded so the system prompt can render REQUIRED OUTPUTS
    expect(calls[0].nodeContract.outputs).toHaveLength(2);
    expect(calls[1].nodeContract.outputs).toHaveLength(1);
  });

  test('previousAgentData carries the structured outputs end-to-end', async () => {
    const flow = buildResearchFlow();
    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-pad' });
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-pad', nodeStates: {} });

    const calls = [];
    messageProcessor.processMessage = jest.fn().mockImplementation(async (agentId, _p, opts) => {
      calls.push({ agentId, prev: opts.previousAgentData });
      let outputs;
      if (agentId === 'researcher') outputs = { findings: { x: 1 }, citations: ['c1'] };
      else if (agentId === 'writer') outputs = { draft: 'd' };
      else if (agentId === 'reviewer') outputs = { verdict: 'v' };
      setImmediate(() => fe.notifyAgentCompletion(agentId, { summary: 'ok', success: true, outputs }));
    });

    await fe.executeFlow('flow-e2e', { userInput: 'topic' });

    // Researcher: no upstream agent → previousAgentData null
    expect(calls[0].prev).toBeNull();
    // Writer: receives researcher's outputs in prev.outputs
    expect(calls[1].prev?.outputs).toEqual({ findings: { x: 1 }, citations: ['c1'] });
    // Reviewer: receives outputs from BOTH researcher + writer (fan-in merge)
    expect(calls[2].prev?.outputs).toEqual({ findings: { x: 1 }, citations: ['c1'], draft: 'd' });
    expect(calls[2].prev?.contributors?.length).toBe(2);
  });

  test('Phase 7: writer system prompt contains description + example verbatim from declared contract', async () => {
    // Producer (researcher) declares an output with description + example.
    // Consumer (writer) declares the corresponding input ALSO with description + example.
    // The writer's system prompt should render BOTH the writer's own input contract
    // AND see the upstream STRUCTURED HANDOFF.
    const fcs = new FlowContextService({}, logger);
    const flow = {
      id: 'rich-e2e', name: 'rich e2e', schemaVersion: 2,
      description: 'Produce a fact-checked article.',
      nodes: [
        { id: 'in', type: 'input', data: {},
          inputs: [],
          outputs: [{ name: 'topic', type: 'text', description: 'Topic.' }] },
        { id: 'researcher', type: 'agent',
          data: { agentId: 'researcher', label: 'Researcher',
            instructions: 'Search peer-reviewed sources.',
            promptTemplate: 'Research {{topic}}' },
          inputs: [{ name: 'topic', type: 'text', required: true, description: 'Topic to research.' }],
          outputs: [{
            name: 'findings', type: 'json',
            description: 'Structured research with title and citations.',
            example: { title: 'AI', citations: ['Bostrom 2014'] },
          }] },
        { id: 'writer', type: 'agent',
          data: { agentId: 'writer', label: 'Writer',
            instructions: 'Write a 500-word article.',
            promptTemplate: 'Write about {{topic}} using {{findings}}' },
          inputs: [
            { name: 'topic',    type: 'text', required: true,
              description: 'Article topic.' },
            { name: 'findings', type: 'json', required: true,
              description: 'Research findings to cite from. Must include title and citations.',
              example: { title: '...', citations: ['...'] } },
          ],
          outputs: [{ name: 'draft', type: 'text', description: 'The article draft.' }] },
      ],
      edges: [
        { source: 'in',         sourceField: 'topic',    target: 'researcher', targetField: 'topic' },
        { source: 'in',         sourceField: 'topic',    target: 'writer',     targetField: 'topic' },
        { source: 'researcher', sourceField: 'findings', target: 'writer',     targetField: 'findings' },
      ],
    };
    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-rich' });
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-rich', nodeStates: {} });

    const captured = [];
    messageProcessor.processMessage = jest.fn().mockImplementation(async (agentId, _p, opts) => {
      const addendum = fcs.buildFlowAgentContext(opts.flowMetadata, opts.previousAgentData, opts.nodeContract);
      captured.push({ agentId, addendum });
      let outputs;
      if (agentId === 'researcher') outputs = { findings: { title: 'AI Safety', citations: ['Bostrom 2014'] } };
      else if (agentId === 'writer') outputs = { draft: 'Article draft' };
      setImmediate(() => fe.notifyAgentCompletion(agentId, { summary: 'ok', success: true, outputs }));
    });

    await fe.executeFlow('rich-e2e', { userInput: 'AI Safety' });

    const writerAddendum = captured.find(c => c.agentId === 'writer').addendum;

    // Flow goal rendered
    expect(writerAddendum).toContain('FLOW GOAL');
    expect(writerAddendum).toContain('Produce a fact-checked article');

    // Node instructions rendered
    expect(writerAddendum).toContain('NODE INSTRUCTIONS');
    expect(writerAddendum).toContain('Write a 500-word article');

    // Writer's INPUT description + example are rendered
    expect(writerAddendum).toContain('Article topic');
    expect(writerAddendum).toContain('Research findings to cite from');

    // Writer's OUTPUT description rendered (draft)
    expect(writerAddendum).toContain('The article draft');

    // Structured handoff from upstream (researcher's findings) is present
    expect(writerAddendum).toContain('STRUCTURED HANDOFF');
    expect(writerAddendum).toContain('"AI Safety"');
    expect(writerAddendum).toContain('"Bostrom 2014"');
  });

  test('system prompt rendered for writer contains STRUCTURED HANDOFF section', async () => {
    // Verify that flowContextService + buildPreviousAgentData compose
    // correctly: when the data arrives at the prompt-injection layer,
    // the structured handoff section IS produced.
    const fcs = new FlowContextService({}, logger);
    const flow = buildResearchFlow();
    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-x' });
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'run-x', nodeStates: {} });

    const captured = [];
    messageProcessor.processMessage = jest.fn().mockImplementation(async (agentId, _p, opts) => {
      // Render the system prompt addendum the scheduler WOULD produce
      const addendum = fcs.buildFlowAgentContext(opts.flowMetadata, opts.previousAgentData, opts.nodeContract);
      captured.push({ agentId, addendum });
      let outputs;
      if (agentId === 'researcher') outputs = { findings: { topic: 'AI', summary: 'Hard' }, citations: ['c'] };
      else if (agentId === 'writer') outputs = { draft: 'd' };
      else if (agentId === 'reviewer') outputs = { verdict: 'v' };
      setImmediate(() => fe.notifyAgentCompletion(agentId, { summary: 'ok', success: true, outputs }));
    });

    await fe.executeFlow('flow-e2e', { userInput: 'AI' });

    const writerAddendum = captured.find(c => c.agentId === 'writer').addendum;
    expect(writerAddendum).toContain('STRUCTURED HANDOFF');
    expect(writerAddendum).toContain('findings');
    expect(writerAddendum).toContain('citations');
    expect(writerAddendum).toContain('REQUIRED OUTPUTS');
    expect(writerAddendum).toContain('draft');

    const reviewerAddendum = captured.find(c => c.agentId === 'reviewer').addendum;
    expect(reviewerAddendum).toContain('ALL UPSTREAM CONTRIBUTORS');
    // contributor.agentName comes from nodeOutput.agentName which falls
    // back to the agent's name property (here lowercase 'researcher'/'writer').
    expect(reviewerAddendum).toMatch(/researcher/i);
    expect(reviewerAddendum).toMatch(/writer/i);
    // Both contributors' structured outputs are included
    expect(reviewerAddendum).toContain('findings');
    expect(reviewerAddendum).toContain('draft');
  });
});

describe('End-to-end: re-prompt loop content', () => {
  let fe, config, logger, stateManager, agentPool, messageProcessor;
  beforeEach(() => {
    config = createMockConfig();
    logger = createMockLogger();
    stateManager = createMockStateManager();
    agentPool = createMockAgentPool();
    messageProcessor = { processMessage: jest.fn() };
    fe = new FlowExecutor(config, logger, stateManager, agentPool, messageProcessor);
    agentPool.getAgent = jest.fn().mockResolvedValue({ id: 'w', mode: 'chat' });
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
  });

  test('corrective re-prompt message names every missing field + shows example shape', async () => {
    const node = {
      id: 'w', type: 'agent',
      data: { agentId: 'w', promptTemplate: '{{input}}' },
      inputs: [{ name: 'input', type: 'text', required: true }],
      outputs: [
        { name: 'draft',     type: 'text' },
        { name: 'wordCount', type: 'number' },
      ],
    };
    const flow = {
      id: 'f', name: 'reprompt content', schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', data: {}, inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
        node,
      ],
      edges: [{ source: 'in', sourceField: 'topic', target: 'w', targetField: 'input' }],
    };
    const context = {
      input: 'AI', nodeOutputs: { in: { type: 'input', outputs: { topic: 'AI' } } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'r', nodeStates: {} });

    let call = 0;
    messageProcessor.processMessage = jest.fn().mockImplementation(async (id) => {
      call++;
      if (call === 1) {
        // First job-done: missing both required fields
        setImmediate(() => fe.notifyAgentCompletion(id, { summary: 'done', success: true, outputs: {} }));
      } else {
        // Re-prompt response: full bag
        setImmediate(() => fe.notifyAgentCompletion(id, {
          summary: 'fixed', success: true,
          outputs: { draft: 'D', wordCount: 1 },
        }));
      }
    });

    await fe.executeAgentNode(node, context, 'r', null, flow);

    // Inspect the corrective message content (2nd call)
    const repromptMsg = messageProcessor.processMessage.mock.calls[1][1];
    expect(repromptMsg).toContain('Missing field(s): draft, wordCount');
    expect(repromptMsg).toContain('draft: text');
    expect(repromptMsg).toContain('wordCount: number');
    // Shows the example JSON shape
    expect(repromptMsg).toContain('"toolId": "jobdone"');
    expect(repromptMsg).toContain('"action": "complete"');
    // Tells the agent NOT to redo the work
    expect(repromptMsg).toMatch(/do not redo|don't redo/i);
    // 2nd call is flagged as a reprompt
    expect(messageProcessor.processMessage.mock.calls[1][2].isReprompt).toBe(true);
  });

  // -- Phase 7: re-prompt includes description + example --

  test('re-prompt includes description + example for missing fields when declared', async () => {
    const node = {
      id: 'w', type: 'agent',
      data: { agentId: 'w', promptTemplate: '{{input}}' },
      inputs: [{ name: 'input', type: 'text', required: true }],
      outputs: [
        {
          name: 'draft', type: 'text',
          description: 'The article draft, ≥500 words, plain prose.',
          example: 'Once upon a time...',
        },
        {
          name: 'wordCount', type: 'number',
          description: 'Total word count of the produced draft.',
          example: 850,
        },
      ],
    };
    const flow = {
      id: 'f', name: 'rich reprompt', schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', data: {}, inputs: [], outputs: [{ name: 'topic', type: 'text' }] },
        node,
      ],
      edges: [{ source: 'in', sourceField: 'topic', target: 'w', targetField: 'input' }],
    };
    const context = {
      input: 'AI', nodeOutputs: { in: { type: 'input', outputs: { topic: 'AI' } } },
      variables: {}, sortedNodes: flow.nodes, flow,
    };
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({ id: 'r2', nodeStates: {} });

    let call = 0;
    messageProcessor.processMessage = jest.fn().mockImplementation(async (id) => {
      call++;
      if (call === 1) {
        setImmediate(() => fe.notifyAgentCompletion(id, { summary: 'done', success: true, outputs: {} }));
      } else {
        setImmediate(() => fe.notifyAgentCompletion(id, {
          summary: 'fixed', success: true,
          outputs: { draft: 'D', wordCount: 1 },
        }));
      }
    });

    await fe.executeAgentNode(node, context, 'r2', null, flow);
    const repromptMsg = messageProcessor.processMessage.mock.calls[1][1];

    // Description for each missing field
    expect(repromptMsg).toContain('The article draft, ≥500 words');
    expect(repromptMsg).toContain('Total word count of the produced draft');
    // Example for each missing field
    expect(repromptMsg).toContain('Once upon a time');
    expect(repromptMsg).toContain('850');
  });
});

describe('End-to-end: checkpoint + resume preserves typed outputs', () => {
  let tmpRoot;
  let fe, config, logger, stateManager, agentPool, messageProcessor;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-e2e-cp-'));
    config = createMockConfig();
    logger = createMockLogger();
    stateManager = createMockStateManager();
    agentPool = createMockAgentPool();
    messageProcessor = { processMessage: jest.fn() };
    fe = new FlowExecutor(config, logger, stateManager, agentPool, messageProcessor);
    fe.setCheckpointStore(new FlowCheckpointStore({ baseDir: tmpRoot }));
    agentPool.getAgent = jest.fn().mockImplementation(async (id) => ({ id, name: id, mode: 'chat' }));
    agentPool.persistAgentState = jest.fn().mockResolvedValue();
    agentPool.clearConversation = jest.fn().mockResolvedValue();
  });

  afterEach(async () => {
    try { await fs.rm(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  test('resume rehydrates typed outputs from checkpoints into downstream prompts', async () => {
    // Stage 1: full successful run, persisting outputs to disk.
    // Stage 2: simulate a "fresh" executor (e.g. after restart) and
    // resumeFlow — it should rehydrate the persisted outputs and feed
    // them as typed inputs into the second agent's prompt.
    const flow = buildResearchFlow();
    stateManager.getFlow = jest.fn().mockResolvedValue(flow);
    stateManager.createFlowRun = jest.fn().mockResolvedValue({ id: 'run-cp' });
    stateManager.updateFlowRun = jest.fn().mockResolvedValue();
    stateManager.getFlowRun = jest.fn().mockResolvedValue({
      id: 'run-cp', flowId: 'flow-e2e', status: 'failed',
      initialInput: { userInput: 'AI safety' },
      nodeStates: {},
    });

    // First, manually persist a researcher checkpoint to disk so we
    // can resume past it. The result shape mirrors what executeAgentNode
    // would persist.
    await fe.checkpointStore.saveNodeResult('run-cp', 'in', {
      type: 'input', output: 'AI safety', outputs: { topic: 'AI safety' },
    });
    await fe.checkpointStore.saveNodeResult('run-cp', 'researcher', {
      type: 'agent', agentId: 'researcher', agentName: 'Researcher',
      output: 'researcher done',
      outputs: {
        findings: { topic: 'AI', summary: 'Hard' },
        citations: ['Bostrom 2014'],
      },
    });

    const promptsSeen = {};
    messageProcessor.processMessage = jest.fn().mockImplementation(async (id, prompt) => {
      promptsSeen[id] = prompt;
      let outputs;
      if (id === 'writer')   outputs = { draft: 'D' };
      if (id === 'reviewer') outputs = { verdict: 'V' };
      setImmediate(() => fe.notifyAgentCompletion(id, { summary: 'ok', success: true, outputs }));
    });

    const result = await fe.resumeFlow('run-cp');
    expect(result.status).toBe('completed');

    // Researcher was checkpointed → never re-invoked
    expect(messageProcessor.processMessage).not.toHaveBeenCalledWith('researcher', expect.anything(), expect.anything());

    // Writer's prompt should have the researcher's persisted outputs
    // expanded by name — proving rehydration worked.
    expect(promptsSeen.writer).toContain('AI safety');
    expect(promptsSeen.writer).toContain('Hard');

    // Reviewer's prompt should have writer's draft + researcher's citations
    expect(promptsSeen.reviewer).toContain('Bostrom 2014');
  });
});
