import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock TagParser before importing
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

const { default: JobDoneTool } = await import('../jobDoneTool.js');

describe('JobDoneTool', () => {
  let tool;

  beforeEach(() => {
    tool = new JobDoneTool();
  });

  describe('constructor', () => {
    test('should set correct id and metadata', () => {
      expect(tool.id).toBe('jobdone');
      expect(tool.name).toBe('Job Done');
      expect(tool.version).toBe('1.0.0');
      expect(tool.requiresProject).toBe(false);
    });
  });

  describe('getDescription', () => {
    test('should return description containing usage info', () => {
      const desc = tool.getDescription();
      expect(desc).toContain('Job Done Tool');
      expect(desc).toContain('complete');
    });
  });

  describe('getSchema', () => {
    test('should return valid schema with actions property', () => {
      const schema = tool.getSchema();
      expect(schema.type).toBe('object');
      expect(schema.properties.actions).toBeDefined();
      expect(schema.required).toContain('actions');
    });
  });

  describe('getCapabilities', () => {
    test('should return capabilities with schema', () => {
      const caps = tool.getCapabilities();
      expect(caps.id).toBe('jobdone');
      expect(caps.schema).toBeDefined();
      expect(caps.enabled).toBe(true);
    });
  });

  describe('parseParameters', () => {
    test('should parse structured tags with summary', () => {
      const result = tool.parseParameters('<summary>Task done</summary><success>true</success>');
      expect(result.actions[0].summary).toBe('Task done');
      expect(result.actions[0].success).toBe(true);
      expect(result.actions[0].action).toBe('complete');
    });

    test('should parse with success=false', () => {
      const result = tool.parseParameters('<summary>Failed</summary><success>false</success>');
      expect(result.actions[0].success).toBe(false);
    });

    test('should parse details tag', () => {
      const result = tool.parseParameters('<summary>Done</summary><details>Extra info</details>');
      expect(result.actions[0].details).toBe('Extra info');
    });

    test('should fallback to raw content as summary', () => {
      const result = tool.parseParameters('Simple completion message');
      expect(result.actions[0].summary).toBe('Simple completion message');
      expect(result.actions[0].success).toBe(true);
    });

    test('should default summary to "Task completed" for empty content', () => {
      const result = tool.parseParameters('');
      expect(result.actions[0].summary).toBe('Task completed');
    });
  });

  describe('setAgentPool', () => {
    test('should store the agent pool reference', () => {
      const mockPool = { getAgent: jest.fn() };
      tool.setAgentPool(mockPool);
      expect(tool.agentPool).toBe(mockPool);
    });
  });

  describe('setWebSocketManager', () => {
    test('should store the websocket manager', () => {
      const mockWs = { broadcastToSession: jest.fn() };
      tool.setWebSocketManager(mockWs);
      expect(tool.webSocketManager).toBe(mockWs);
    });
  });

  describe('setFlowExecutor', () => {
    test('should store the flow executor', () => {
      const mockFlow = { notifyAgentCompletion: jest.fn() };
      tool.setFlowExecutor(mockFlow);
      expect(tool.flowExecutor).toBe(mockFlow);
    });
  });

  describe('execute', () => {
    test('should reject when actions array is missing', async () => {
      const result = await tool.execute({}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Actions array is required');
    });

    test('should reject when actions array is empty', async () => {
      const result = await tool.execute({ actions: [] }, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Actions array is required');
    });

    test('should reject invalid action type', async () => {
      const result = await tool.execute({
        actions: [{ action: 'invalid', summary: 'test' }]
      }, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid action');
    });

    test('should reject when summary is missing', async () => {
      const result = await tool.execute({
        actions: [{ action: 'complete' }]
      }, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('summary is required');
    });

    test('should successfully complete with minimal params', async () => {
      const result = await tool.execute({
        actions: [{ action: 'complete', summary: 'All done' }]
      }, {});
      expect(result.success).toBe(true);
      expect(result.taskComplete).toBe(true);
      expect(result.exitAutonomousMode).toBe(true);
      expect(result.summary).toBe('All done');
      expect(result.successfulCompletion).toBe(true);
    });

    test('should complete with success=false', async () => {
      const result = await tool.execute({
        actions: [{ action: 'complete', summary: 'Stuck', success: false }]
      }, {});
      expect(result.success).toBe(true);
      expect(result.successfulCompletion).toBe(false);
      expect(result.output).toContain('with issues');
    });

    test('should include details in output when provided', async () => {
      const result = await tool.execute({
        actions: [{ action: 'complete', summary: 'Done', details: 'Created 3 files' }]
      }, {});
      expect(result.details).toBe('Created 3 files');
      expect(result.output).toContain('Created 3 files');
    });

    test('should reject when agent has pending tasks and success=true', async () => {
      const mockAgent = {
        name: 'test-agent',
        sessionId: 'sess-1',
        taskList: {
          tasks: [
            { status: 'pending', title: 'Unfinished task' },
            { status: 'in_progress', title: 'Working task' }
          ]
        }
      };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue(mockAgent),
        persistAgentState: jest.fn().mockResolvedValue(undefined)
      };
      tool.setAgentPool(mockPool);

      const result = await tool.execute(
        { actions: [{ action: 'complete', summary: 'Done', success: true }] },
        { agentId: 'agent-1' }
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain('pending task(s)');
      expect(result.pendingTasks).toBe(2);
    });

    test('should allow completion with success=false even with pending tasks', async () => {
      const mockAgent = {
        name: 'test-agent',
        sessionId: 'sess-1',
        taskList: {
          tasks: [{ status: 'pending', title: 'Stuck task' }]
        }
      };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue(mockAgent),
        persistAgentState: jest.fn().mockResolvedValue(undefined)
      };
      tool.setAgentPool(mockPool);

      const result = await tool.execute(
        { actions: [{ action: 'complete', summary: 'Giving up', success: false }] },
        { agentId: 'agent-1' }
      );
      expect(result.success).toBe(true);
      expect(result.successfulCompletion).toBe(false);
    });

    test('should clear agent tasks and persist state on completion', async () => {
      const mockAgent = {
        id: 'agent-1',
        name: 'test-agent',
        sessionId: 'sess-1',
        taskList: {
          tasks: [{ status: 'completed', title: 'Done task' }]
        }
      };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue(mockAgent),
        persistAgentState: jest.fn().mockResolvedValue(undefined)
      };
      tool.setAgentPool(mockPool);

      await tool.execute(
        { actions: [{ action: 'complete', summary: 'All done' }] },
        { agentId: 'agent-1' }
      );
      expect(mockAgent.taskList.tasks).toEqual([]);
      expect(mockAgent.autonomousWorkComplete).toBe(true);
      expect(mockPool.persistAgentState).toHaveBeenCalledWith('agent-1');
    });

    test('should broadcast via websocket when available', async () => {
      const mockAgent = {
        id: 'agent-1',
        name: 'test-agent',
        sessionId: 'sess-1',
        mode: 'agent',
        taskList: { tasks: [] }
      };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue(mockAgent),
        persistAgentState: jest.fn().mockResolvedValue(undefined)
      };
      const mockWs = { broadcastToSession: jest.fn() };
      tool.setAgentPool(mockPool);
      tool.setWebSocketManager(mockWs);

      await tool.execute(
        { actions: [{ action: 'complete', summary: 'Done' }] },
        { agentId: 'agent-1' }
      );
      expect(mockWs.broadcastToSession).toHaveBeenCalledWith('sess-1', expect.objectContaining({
        type: 'agent_job_done'
      }));
    });

    test('should notify flow executor when set', async () => {
      const mockAgent = {
        id: 'agent-1',
        name: 'test-agent',
        sessionId: 'sess-1',
        taskList: { tasks: [] }
      };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue(mockAgent),
        persistAgentState: jest.fn().mockResolvedValue(undefined)
      };
      const mockFlow = { notifyAgentCompletion: jest.fn() };
      tool.setAgentPool(mockPool);
      tool.setFlowExecutor(mockFlow);

      await tool.execute(
        { actions: [{ action: 'complete', summary: 'Done' }] },
        { agentId: 'agent-1' }
      );
      expect(mockFlow.notifyAgentCompletion).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        summary: 'Done',
        success: true
      }));
    });

    // -- Phase 2: structured outputs forwarding --

    test('should forward structured outputs to flow executor (v2 nodes)', async () => {
      // When the agent declares typed outputs in its node contract, it
      // emits them via job-done's `outputs` field. The tool must hand
      // that bag through to the executor unmodified — the executor is
      // the authority on contract validation.
      const mockAgent = {
        id: 'agent-1', name: 't', sessionId: 's',
        taskList: { tasks: [] },
      };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue(mockAgent),
        persistAgentState: jest.fn().mockResolvedValue(undefined),
      };
      const mockFlow = { notifyAgentCompletion: jest.fn() };
      tool.setAgentPool(mockPool);
      tool.setFlowExecutor(mockFlow);

      await tool.execute(
        {
          actions: [{
            action: 'complete',
            summary: 'Wrote the article',
            details: 'Saved at /tmp/draft.md',
            outputs: { draft: 'long text', wordCount: 850 },
          }],
        },
        { agentId: 'agent-1' }
      );
      expect(mockFlow.notifyAgentCompletion).toHaveBeenCalledWith('agent-1',
        expect.objectContaining({
          summary: 'Wrote the article',
          outputs: { draft: 'long text', wordCount: 850 },
        }),
      );
    });

    test('schema accepts outputs as a free-form object (per-node fields decided by contract)', () => {
      const schema = tool.getSchema();
      const actionSchema = schema.properties.actions.items;
      // outputs is an optional, additionally-permitted property — the
      // per-node contract decides which keys must be present, not the
      // tool schema. The tool just forwards the bag verbatim.
      expect(actionSchema.properties.outputs).toBeDefined();
      expect(actionSchema.properties.outputs.type).toBe('object');
    });

    // -- Phase 8: tool-level contract validation --

    test('rejects job-done that omits required outputs (flow contract)', async () => {
      const mockAgent = { id: 'agent-1', name: 't', sessionId: 's', taskList: { tasks: [] } };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue(mockAgent),
        persistAgentState: jest.fn().mockResolvedValue(undefined),
      };
      const mockFlow = {
        notifyAgentCompletion: jest.fn(),
        getActiveContract: jest.fn().mockReturnValue({
          outputs: [
            { name: 'bullets',   type: 'list<text>', description: '3 bullets.' },
            { name: 'wordCount', type: 'number',     description: 'Word count.', example: 87 },
          ],
        }),
      };
      tool.setAgentPool(mockPool);
      tool.setFlowExecutor(mockFlow);

      const result = await tool.execute(
        { actions: [{ action: 'complete', summary: 'Did the work', outputs: {} }] },
        { agentId: 'agent-1' }
      );

      // Tool returned failure — agent will see this in its conversation
      // and re-call without conversation reset.
      expect(result.success).toBe(false);
      expect(result.flowContractViolation).toBe(true);
      expect(result.missingOutputs).toEqual(expect.arrayContaining(['bullets', 'wordCount']));
      expect(result.error).toMatch(/missing required output/i);
      expect(result.error).toContain('bullets');
      expect(result.error).toContain('wordCount');
      // Critically: completion was NOT signaled to the executor
      expect(mockFlow.notifyAgentCompletion).not.toHaveBeenCalled();
    });

    test('rejects job-done that has outputs key but with null required field', async () => {
      const mockAgent = { id: 'agent-1', taskList: { tasks: [] } };
      const mockPool = { getAgent: jest.fn().mockResolvedValue(mockAgent), persistAgentState: jest.fn() };
      const mockFlow = {
        notifyAgentCompletion: jest.fn(),
        getActiveContract: jest.fn().mockReturnValue({
          outputs: [{ name: 'draft', type: 'text' }],
        }),
      };
      tool.setAgentPool(mockPool);
      tool.setFlowExecutor(mockFlow);

      const result = await tool.execute(
        { actions: [{ action: 'complete', summary: 'd', outputs: { draft: null } }] },
        { agentId: 'agent-1' }
      );
      expect(result.success).toBe(false);
      expect(result.missingOutputs).toEqual(['draft']);
    });

    test('accepts job-done when all required outputs are populated', async () => {
      const mockAgent = { id: 'agent-1', taskList: { tasks: [] } };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue(mockAgent),
        persistAgentState: jest.fn().mockResolvedValue(),
      };
      const mockFlow = {
        notifyAgentCompletion: jest.fn(),
        getActiveContract: jest.fn().mockReturnValue({
          outputs: [{ name: 'draft', type: 'text' }, { name: 'wordCount', type: 'number' }],
        }),
      };
      tool.setAgentPool(mockPool);
      tool.setFlowExecutor(mockFlow);

      const result = await tool.execute(
        { actions: [{ action: 'complete', summary: 'done', outputs: { draft: 'long text', wordCount: 100 } }] },
        { agentId: 'agent-1' }
      );
      expect(result.success).toBe(true);
      expect(mockFlow.notifyAgentCompletion).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        outputs: { draft: 'long text', wordCount: 100 },
      }));
    });

    test('non-flow runs (no active contract) skip validation entirely', async () => {
      const mockAgent = { id: 'agent-1', taskList: { tasks: [] } };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue(mockAgent),
        persistAgentState: jest.fn().mockResolvedValue(),
      };
      const mockFlow = {
        notifyAgentCompletion: jest.fn(),
        getActiveContract: jest.fn().mockReturnValue(null),
      };
      tool.setAgentPool(mockPool);
      tool.setFlowExecutor(mockFlow);

      const result = await tool.execute(
        { actions: [{ action: 'complete', summary: 'just a regular finish' }] },
        { agentId: 'agent-1' }
      );
      expect(result.success).toBe(true);
      expect(mockFlow.notifyAgentCompletion).toHaveBeenCalled();
    });

    test('error message includes example shape and field types for guidance', async () => {
      const mockAgent = { id: 'agent-1', taskList: { tasks: [] } };
      const mockPool = { getAgent: jest.fn().mockResolvedValue(mockAgent), persistAgentState: jest.fn() };
      const mockFlow = {
        notifyAgentCompletion: jest.fn(),
        getActiveContract: jest.fn().mockReturnValue({
          outputs: [
            { name: 'draft', type: 'text', example: 'The article begins with...' },
            { name: 'wordCount', type: 'number', example: 850 },
          ],
        }),
      };
      tool.setAgentPool(mockPool);
      tool.setFlowExecutor(mockFlow);

      const result = await tool.execute(
        { actions: [{ action: 'complete', summary: 'd' }] },     // no outputs at all
        { agentId: 'agent-1' }
      );
      // Error message guides the agent: shows the exact JSON shape + examples
      expect(result.error).toContain('"toolId": "jobdone"');
      expect(result.error).toContain('"action": "complete"');
      expect(result.error).toContain('draft');
      expect(result.error).toContain('wordCount');
      // Examples are included
      expect(result.error).toMatch(/The article begins with|850/);
    });

    // -- Phase 8 regression locks: legacy pendingTasks check must NOT
    //    fire during flow runs.
    //
    //    Background (see conversation files a5/a6 in 2026-04 e2e dump):
    //    when a contract-correct job-done call coincides with a residual
    //    auto-created task (the scheduler-poke task spawned by every
    //    queued user message in AGENT mode), the legacy pendingTasks
    //    branch was rejecting the call with "Cannot mark job as done —
    //    you still have N pending task(s)" — forcing the model into a
    //    taskmanager dance for tasks the user never authored. The
    //    Phase 8 contract validator above is now the authoritative
    //    gate during flow runs.

    test('flow run with valid outputs succeeds despite pending tasks (regression)', async () => {
      const mockAgent = {
        id: 'agent-1', name: 'a', sessionId: 's',
        // The auto-task created by addUserMessage when this agent's
        // initial flow prompt was queued. With Phase 8 wired correctly,
        // this should NOT block job-done.
        taskList: { tasks: [{ status: 'in_progress', title: 'Process user request: ...' }] },
      };
      const mockPool = {
        getAgent: jest.fn().mockResolvedValue(mockAgent),
        persistAgentState: jest.fn().mockResolvedValue(),
      };
      const mockFlow = {
        notifyAgentCompletion: jest.fn(),
        getActiveContract: jest.fn().mockReturnValue({
          outputs: [{ name: 'draft', type: 'text' }, { name: 'wordCount', type: 'number' }],
        }),
      };
      tool.setAgentPool(mockPool);
      tool.setFlowExecutor(mockFlow);

      const result = await tool.execute(
        { actions: [{
          action: 'complete',
          summary: 'wrote paragraph',
          outputs: { draft: 'Climate change is...', wordCount: 115 },
        }] },
        { agentId: 'agent-1' }
      );

      // Phase 8 passed (outputs present), so the legacy pendingTasks
      // branch must be skipped — completion fires through cleanly.
      expect(result.success).toBe(true);
      expect(result.taskComplete).toBe(true);
      expect(mockFlow.notifyAgentCompletion).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        outputs: { draft: 'Climate change is...', wordCount: 115 },
      }));
    });

    test('flow run with missing outputs is still rejected by Phase 8 (gate not skipped)', async () => {
      const mockAgent = {
        id: 'agent-1',
        taskList: { tasks: [{ status: 'in_progress', title: 'Process user request: ...' }] },
      };
      const mockPool = { getAgent: jest.fn().mockResolvedValue(mockAgent), persistAgentState: jest.fn() };
      const mockFlow = {
        notifyAgentCompletion: jest.fn(),
        getActiveContract: jest.fn().mockReturnValue({ outputs: [{ name: 'draft', type: 'text' }] }),
      };
      tool.setAgentPool(mockPool);
      tool.setFlowExecutor(mockFlow);

      const result = await tool.execute(
        { actions: [{ action: 'complete', summary: 'd' }] }, // no outputs
        { agentId: 'agent-1' }
      );

      // Phase 8 catches it before pendingTasks branch is even considered.
      // Critically: error message mentions the contract violation, NOT
      // the legacy "still have N pending tasks" message.
      expect(result.success).toBe(false);
      expect(result.flowContractViolation).toBe(true);
      expect(result.output).not.toMatch(/still have \d+ pending task/i);
      expect(mockFlow.notifyAgentCompletion).not.toHaveBeenCalled();
    });

    test('NON-flow run with pending tasks still rejects (legacy behavior preserved)', async () => {
      // Belt-and-suspenders: confirm the pendingTasks gate is still
      // active for non-flow uses. Only flow context bypasses it.
      const mockAgent = {
        id: 'agent-1',
        taskList: { tasks: [{ status: 'pending', title: 'Real user task' }] },
      };
      const mockPool = { getAgent: jest.fn().mockResolvedValue(mockAgent), persistAgentState: jest.fn() };
      const mockFlow = {
        notifyAgentCompletion: jest.fn(),
        getActiveContract: jest.fn().mockReturnValue(null), // no flow context
      };
      tool.setAgentPool(mockPool);
      tool.setFlowExecutor(mockFlow);

      const result = await tool.execute(
        { actions: [{ action: 'complete', summary: 'done', success: true }] },
        { agentId: 'agent-1' }
      );

      expect(result.success).toBe(false);
      expect(result.output).toMatch(/still have 1 pending task/i);
      expect(result.pendingTasks).toBe(1);
      expect(mockFlow.notifyAgentCompletion).not.toHaveBeenCalled();
    });

  });
});
