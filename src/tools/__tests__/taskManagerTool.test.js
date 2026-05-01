import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// Mock uuid
let uuidCounter = 0;
jest.unstable_mockModule('uuid', () => ({
  v4: jest.fn(() => `mock-uuid-${++uuidCounter}`)
}));

const { default: TaskManagerTool } = await import('../taskManagerTool.js');

/**
 * Helper: create a tool instance, a fake agent, and context.
 */
function createTestSetup() {
  const logger = createMockLogger();
  const tool = new TaskManagerTool({ description: 'test task manager' });
  tool.logger = logger;

  const agent = {
    id: 'agent-1',
    name: 'Test Agent',
    lastActivity: null,
    taskList: {
      tasks: [],
      lastUpdated: new Date().toISOString()
    }
  };

  const agentPool = {
    getAgent: jest.fn().mockResolvedValue(agent),
    persistAgentState: jest.fn().mockResolvedValue(undefined)
  };

  const context = {
    agentId: 'agent-1',
    agentName: 'Test Agent',
    agentPool,
    projectDir: '/tmp/test'
  };

  return { tool, agent, agentPool, context, logger };
}

beforeEach(() => {
  uuidCounter = 0;
});

describe('TaskManagerTool', () => {
  // ── constructor ─────────────────────────────────────────────────
  describe('constructor', () => {
    test('initializes with supported actions, priorities, and statuses', () => {
      const tool = new TaskManagerTool();
      expect(tool.supportedActions).toContain('create');
      expect(tool.supportedActions).toContain('sync');
      expect(tool.supportedActions).toContain('analytics');
      expect(tool.taskPriorities).toEqual(['urgent', 'high', 'medium', 'low']);
      expect(tool.taskStatuses).toContain('pending');
      expect(tool.taskStatuses).toContain('completed');
      expect(tool.taskTemplates).toHaveProperty('bug-fix');
    });
  });

  // ── getDescription ──────────────────────────────────────────────
  describe('getDescription', () => {
    test('returns a non-empty description string', () => {
      const tool = new TaskManagerTool();
      const desc = tool.getDescription();
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(50);
    });
  });

  // ── parseParameters ─────────────────────────────────────────────
  describe('parseParameters', () => {
    test('returns rawContent for string input', () => {
      const tool = new TaskManagerTool();
      expect(tool.parseParameters('hello')).toEqual({ rawContent: 'hello' });
    });

    test('unwraps tag-parser format objects', () => {
      const tool = new TaskManagerTool();
      const result = tool.parseParameters({
        action: { value: 'create', attributes: {} },
        title: { value: 'My Task', attributes: {} }
      });
      expect(result.action).toBe('create');
      expect(result.title).toBe('My Task');
    });

    test('passes through plain objects', () => {
      const tool = new TaskManagerTool();
      expect(tool.parseParameters({ action: 'list' })).toEqual({ action: 'list' });
    });

    test('returns non-object values as-is', () => {
      const tool = new TaskManagerTool();
      expect(tool.parseParameters(null)).toBeNull();
    });
  });

  // ── create action ───────────────────────────────────────────────
  describe('execute - create', () => {
    test('creates a task with title, description, and priority', async () => {
      const { tool, agent, context } = createTestSetup();
      const result = await tool.execute(
        { action: 'create', title: 'Build API', description: 'REST endpoints', priority: 'high' },
        context
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe('create');
      expect(result.result.task.title).toBe('Build API');
      expect(result.result.task.priority).toBe('high');
      expect(result.result.task.status).toBe('pending');
      expect(agent.taskList.tasks).toHaveLength(1);
    });

    test('uses medium as default priority', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'create', title: 'Default' }, context);
      expect(result.result.task.priority).toBe('medium');
    });

    test('errors when title is missing', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'create', priority: 'low' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('title is required');
    });

    test('errors for invalid priority', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute(
        { action: 'create', title: 'Test', priority: 'superurgent' }, context
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid priority');
    });
  });

  // ── actions array format ────────────────────────────────────────
  describe('execute - actions array format', () => {
    test('unwraps first element of actions array', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute(
        { actions: [{ type: 'create', title: 'From array', priority: 'medium' }] },
        context
      );
      expect(result.success).toBe(true);
      expect(result.result.task.title).toBe('From array');
    });

    test('deep-unwraps tag-parser wrapped values in actions array', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        actions: [{
          type: { value: 'create', attributes: {} },
          title: { value: 'Wrapped', attributes: {} },
          priority: 'medium'
        }]
      }, context);
      expect(result.success).toBe(true);
      expect(result.result.task.title).toBe('Wrapped');
    });
  });

  // ── update action ───────────────────────────────────────────────
  describe('execute - update', () => {
    test('updates task status and priority', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Task A', priority: 'low' }, context);
      const taskId = agent.taskList.tasks[0].id;
      const result = await tool.execute(
        { action: 'update', taskId, status: 'in_progress', priority: 'high' }, context
      );
      expect(result.success).toBe(true);
      expect(result.result.task.status).toBe('in_progress');
      expect(result.result.task.priority).toBe('high');
    });

    test('updates title and description', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Old', priority: 'medium' }, context);
      const taskId = agent.taskList.tasks[0].id;
      const result = await tool.execute(
        { action: 'update', taskId, title: 'New Title', description: 'Desc' }, context
      );
      expect(result.result.task.title).toBe('New Title');
      expect(result.result.task.description).toBe('Desc');
    });

    test('errors when taskId is missing', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'update', status: 'completed' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Task ID is required');
    });

    test('errors for non-existent task', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'update', taskId: 'no-such', status: 'completed' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Task not found');
    });

    test('errors for invalid status', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'T', priority: 'medium' }, context);
      const taskId = agent.taskList.tasks[0].id;
      const result = await tool.execute({ action: 'update', taskId, status: 'badstatus' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid status');
    });
  });

  // ── list action ─────────────────────────────────────────────────
  describe('execute - list', () => {
    test('lists all tasks with summary counts', async () => {
      const { tool, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'T1', priority: 'high' }, context);
      await tool.execute({ action: 'create', title: 'T2', priority: 'low' }, context);
      const result = await tool.execute({ action: 'list' }, context);
      expect(result.success).toBe(true);
      expect(result.result.totalTasks).toBe(2);
      expect(result.result.summary.pending).toBe(2);
    });

    test('filters by status', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'T1', priority: 'high' }, context);
      await tool.execute({ action: 'create', title: 'T2', priority: 'low' }, context);
      await tool.execute({ action: 'complete', taskId: agent.taskList.tasks[0].id }, context);
      const result = await tool.execute({ action: 'list', status: 'pending' }, context);
      expect(result.result.totalTasks).toBe(1);
    });

    test('filters by priority', async () => {
      const { tool, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'T1', priority: 'high' }, context);
      await tool.execute({ action: 'create', title: 'T2', priority: 'low' }, context);
      const result = await tool.execute({ action: 'list', priority: 'high' }, context);
      expect(result.result.totalTasks).toBe(1);
    });

    test('sorts by priority then creation date', async () => {
      const { tool, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Low', priority: 'low' }, context);
      await tool.execute({ action: 'create', title: 'High', priority: 'high' }, context);
      const result = await tool.execute({ action: 'list' }, context);
      expect(result.result.tasks[0].title).toBe('High');
    });
  });

  // ── complete action ─────────────────────────────────────────────
  describe('execute - complete', () => {
    test('marks task as completed with timestamp', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Finish', priority: 'medium' }, context);
      const taskId = agent.taskList.tasks[0].id;
      const result = await tool.execute({ action: 'complete', taskId }, context);
      expect(result.success).toBe(true);
      expect(result.result.task.status).toBe('completed');
      expect(result.result.task.completedAt).toBeDefined();
    });

    test('auto-completes first in-progress task when no taskId', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Auto', priority: 'medium' }, context);
      agent.taskList.tasks[0].status = 'in_progress';
      const result = await tool.execute({ action: 'complete' }, context);
      expect(result.result.task.status).toBe('completed');
    });

    test('returns message for already-completed task', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Done', priority: 'medium' }, context);
      const taskId = agent.taskList.tasks[0].id;
      await tool.execute({ action: 'complete', taskId }, context);
      const result = await tool.execute({ action: 'complete', taskId }, context);
      expect(result.result.message).toContain('already completed');
    });

    test('sets TTL to 1 when no pending tasks remain', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Only', priority: 'medium' }, context);
      await tool.execute({ action: 'complete', taskId: agent.taskList.tasks[0].id }, context);
      expect(agent.ttl).toBe(1);
    });

    test('includes no-tasks hint in summary', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Only', priority: 'medium' }, context);
      const result = await tool.execute({ action: 'complete', taskId: agent.taskList.tasks[0].id }, context);
      expect(result.summary).toContain('No remaining tasks');
    });

    test('errors when no taskId and no in-progress tasks', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'complete' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No task ID provided');
    });
  });

  // ── cancel action ───────────────────────────────────────────────
  describe('execute - cancel', () => {
    test('cancels a task with reason', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Cancel me', priority: 'medium' }, context);
      const taskId = agent.taskList.tasks[0].id;
      const result = await tool.execute({ action: 'cancel', taskId, reason: 'Not needed' }, context);
      expect(result.success).toBe(true);
      expect(result.result.task.status).toBe('cancelled');
      expect(result.result.task.cancellationReason).toBe('Not needed');
    });

    test('errors when taskId is missing', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'cancel' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Task ID is required');
    });
  });

  // ── clear action ────────────────────────────────────────────────
  describe('execute - clear', () => {
    test('removes completed and cancelled tasks', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'T1', priority: 'medium' }, context);
      await tool.execute({ action: 'create', title: 'T2', priority: 'medium' }, context);
      await tool.execute({ action: 'create', title: 'T3', priority: 'medium' }, context);
      await tool.execute({ action: 'complete', taskId: agent.taskList.tasks[0].id }, context);
      await tool.execute({ action: 'cancel', taskId: agent.taskList.tasks[1].id }, context);
      const result = await tool.execute({ action: 'clear' }, context);
      expect(result.result.removed).toBe(2);
      expect(agent.taskList.tasks).toHaveLength(1);
    });
  });

  // ── depend action ───────────────────────────────────────────────
  describe('execute - depend', () => {
    test('creates blocking dependency and sets blocked status', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'T1', priority: 'high' }, context);
      await tool.execute({ action: 'create', title: 'T2', priority: 'medium' }, context);
      const [tA, tB] = agent.taskList.tasks;
      const result = await tool.execute(
        { action: 'depend', taskId: tB.id, dependsOn: tA.id, dependencyType: 'blocks' }, context
      );
      expect(result.success).toBe(true);
      expect(result.result.dependency.taskId).toBe(tA.id);
      expect(agent.taskList.tasks[1].status).toBe('blocked');
    });

    test('returns already-exists for duplicate dependency', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'T1', priority: 'high' }, context);
      await tool.execute({ action: 'create', title: 'T2', priority: 'medium' }, context);
      const [tA, tB] = agent.taskList.tasks;
      await tool.execute({ action: 'depend', taskId: tB.id, dependsOn: tA.id }, context);
      const result = await tool.execute({ action: 'depend', taskId: tB.id, dependsOn: tA.id }, context);
      expect(result.result.message).toContain('already exists');
    });

    test('errors when both params are missing', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'depend', taskId: 'x' }, context);
      expect(result.success).toBe(false);
    });

    test('errors for invalid dependency type', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'A', priority: 'high' }, context);
      await tool.execute({ action: 'create', title: 'B', priority: 'high' }, context);
      const [a, b] = agent.taskList.tasks;
      const result = await tool.execute(
        { action: 'depend', taskId: b.id, dependsOn: a.id, dependencyType: 'invalid' }, context
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid dependency type');
    });
  });

  // ── relate action ───────────────────────────────────────────────
  describe('execute - relate', () => {
    test('creates a relates-type dependency', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'T1', priority: 'high' }, context);
      await tool.execute({ action: 'create', title: 'T2', priority: 'medium' }, context);
      const [tA, tB] = agent.taskList.tasks;
      const result = await tool.execute(
        { action: 'relate', taskId: tB.id, dependsOn: tA.id }, context
      );
      expect(result.result.dependency.type).toBe('relates');
    });
  });

  // ── subtask action ──────────────────────────────────────────────
  describe('execute - subtask', () => {
    test('creates subtask under parent', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Parent', priority: 'high' }, context);
      const parentId = agent.taskList.tasks[0].id;
      const result = await tool.execute(
        { action: 'subtask', parentTaskId: parentId, title: 'Sub 1', priority: 'medium' }, context
      );
      expect(result.success).toBe(true);
      expect(result.result.subtask.isSubtask).toBe(true);
      expect(result.result.subtask.parentTaskId).toBe(parentId);
      expect(agent.taskList.tasks[0].subtasks).toContain(result.result.subtask.id);
    });

    test('errors when parent not found', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute(
        { action: 'subtask', parentTaskId: 'no-such', title: 'Sub' }, context
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Parent task not found');
    });

    test('errors when parentTaskId or title missing', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'subtask', title: 'Sub' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });
  });

  // ── sync action ─────────────────────────────────────────────────
  describe('execute - sync', () => {
    test('syncs task list creating new tasks', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        action: 'sync',
        tasks: [
          { title: 'A', status: 'completed', priority: 'high' },
          { title: 'B', status: 'in_progress', priority: 'medium' },
          { title: 'C', status: 'pending', priority: 'low' }
        ]
      }, context);
      expect(result.success).toBe(true);
      expect(result.result.summary.total).toBe(3);
      expect(result.result.summary.created).toBe(3);
    });

    test('updates existing tasks by matching title', async () => {
      const { tool, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Existing', priority: 'low' }, context);
      const result = await tool.execute({
        action: 'sync',
        tasks: [{ title: 'Existing', status: 'completed', priority: 'high' }]
      }, context);
      expect(result.result.summary.updated).toBe(1);
      expect(result.result.summary.created).toBe(0);
    });

    test('parses JSON string tasks', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        action: 'sync',
        tasks: JSON.stringify([{ title: 'JSON', status: 'pending', priority: 'medium' }])
      }, context);
      expect(result.success).toBe(true);
    });

    test('errors for empty tasks array', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'sync', tasks: [] }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    test('errors for invalid status', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        action: 'sync',
        tasks: [{ title: 'Bad', status: 'oops', priority: 'medium' }]
      }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid status');
    });

    test('enforces only one in_progress task', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({
        action: 'sync',
        tasks: [
          { title: 'A', status: 'in_progress', priority: 'high' },
          { title: 'B', status: 'in_progress', priority: 'medium' }
        ]
      }, context);
      const ipCount = agent.taskList.tasks.filter(t => t.status === 'in_progress').length;
      expect(ipCount).toBe(1);
    });

    test('auto-sets first pending to in_progress when none active', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({
        action: 'sync',
        tasks: [
          { title: 'A', status: 'pending', priority: 'high' },
          { title: 'B', status: 'pending', priority: 'medium' }
        ]
      }, context);
      const ipTasks = agent.taskList.tasks.filter(t => t.status === 'in_progress');
      expect(ipTasks).toHaveLength(1);
    });
  });

  // ── template action ─────────────────────────────────────────────
  describe('execute - template', () => {
    test('lists available templates', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'template', mode: 'list' }, context);
      expect(result.success).toBe(true);
      expect(result.result.builtInTemplates.length).toBeGreaterThan(0);
    });

    test('applies a built-in template', async () => {
      const { tool, agent, context } = createTestSetup();
      const result = await tool.execute(
        { action: 'template', mode: 'apply', templateId: 'bug-fix' }, context
      );
      expect(result.success).toBe(true);
      expect(result.result.tasksCreated).toBeGreaterThan(0);
      expect(agent.taskList.tasks.length).toBeGreaterThan(0);
    });

    test('errors for non-existent template', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute(
        { action: 'template', mode: 'apply', templateId: 'nope' }, context
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Template not found');
    });

    test('creates a custom template', async () => {
      const { tool, agent, context } = createTestSetup();
      const result = await tool.execute({
        action: 'template',
        mode: 'create',
        customTemplate: {
          name: 'My Workflow',
          description: 'Custom',
          tasks: [{ title: 'Step 1' }, { title: 'Step 2' }]
        }
      }, context);
      expect(result.success).toBe(true);
      expect(agent.customTemplates).toHaveLength(1);
    });

    test('errors when custom template has no tasks', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({
        action: 'template',
        mode: 'create',
        customTemplate: { name: 'Empty', tasks: [] }
      }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('requires name and at least one task');
    });

    test('suggests templates based on patterns', async () => {
      const { tool, agent, context } = createTestSetup();
      agent.taskList.tasks.push({
        id: 'bug-task', title: 'Fix login bug', status: 'pending',
        priority: 'high', createdAt: new Date().toISOString()
      });
      const result = await tool.execute({ action: 'template', mode: 'suggest' }, context);
      expect(result.success).toBe(true);
      expect(result.result.suggestions.length).toBeGreaterThan(0);
    });

    test('errors for invalid template mode', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'template', mode: 'invalid' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid template mode');
    });
  });

  // ── progress action ─────────────────────────────────────────────
  describe('execute - progress', () => {
    test('updates task progress with stage and note', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Dev', priority: 'high' }, context);
      const taskId = agent.taskList.tasks[0].id;
      const result = await tool.execute({
        action: 'progress', mode: 'update', taskId,
        stage: 'in_development', note: 'Started coding'
      }, context);
      expect(result.success).toBe(true);
      expect(result.result.task.progress.stage).toBe('in_development');
      expect(result.result.task.progress.notes).toHaveLength(1);
    });

    test('setting percentage to 100 completes task', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Pct', priority: 'high' }, context);
      const taskId = agent.taskList.tasks[0].id;
      await tool.execute({ action: 'progress', mode: 'update', taskId, percentage: 100 }, context);
      expect(agent.taskList.tasks[0].status).toBe('completed');
      expect(agent.taskList.tasks[0].progress.stage).toBe('completed');
    });

    test('gets progress overview', async () => {
      const { tool, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'T1', priority: 'high' }, context);
      const result = await tool.execute({ action: 'progress', mode: 'overview' }, context);
      expect(result.success).toBe(true);
      expect(result.result.overview).toBeDefined();
    });

    test('calculates progress from subtasks', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Parent', priority: 'high' }, context);
      const parentId = agent.taskList.tasks[0].id;
      await tool.execute({ action: 'subtask', parentTaskId: parentId, title: 'Sub1' }, context);
      const result = await tool.execute({ action: 'progress', mode: 'calculate', taskId: parentId }, context);
      expect(result.result.calculationMethod).toBe('subtasks');
    });

    test('errors for invalid stage', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'T', priority: 'high' }, context);
      const taskId = agent.taskList.tasks[0].id;
      const result = await tool.execute({ action: 'progress', mode: 'update', taskId, stage: 'nope' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid progress stage');
    });

    test('errors for invalid progress mode', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'progress', mode: 'invalid' }, context);
      expect(result.success).toBe(false);
    });
  });

  // ── prioritize action ───────────────────────────────────────────
  describe('execute - prioritize', () => {
    test('auto-prioritizes tasks', async () => {
      const { tool, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'T1', priority: 'low' }, context);
      await tool.execute({ action: 'create', title: 'T2', priority: 'medium' }, context);
      const result = await tool.execute({ action: 'prioritize', mode: 'auto' }, context);
      expect(result.success).toBe(true);
    });

    test('analyzes specific task priority', async () => {
      const { tool, agent, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'Analyze', priority: 'medium' }, context);
      const taskId = agent.taskList.tasks[0].id;
      const result = await tool.execute({ action: 'prioritize', mode: 'analyze', taskId }, context);
      expect(result.success).toBe(true);
      expect(result.result.task.priorityScore).toBeDefined();
    });

    test('balance mode without scheduler returns message', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'prioritize', mode: 'balance' }, context);
      expect(result.success).toBe(true);
      expect(result.result.message).toContain('scheduler');
    });

    test('errors for invalid mode', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'prioritize', mode: 'xyz' }, context);
      expect(result.success).toBe(false);
    });
  });

  // ── analytics action ────────────────────────────────────────────
  describe('execute - analytics', () => {
    test('generates summary analytics', async () => {
      const { tool, context } = createTestSetup();
      await tool.execute({ action: 'create', title: 'T1', priority: 'high' }, context);
      const result = await tool.execute({ action: 'analytics', mode: 'summary' }, context);
      expect(result.success).toBe(true);
      expect(result.result.generatedAt).toBeDefined();
    });

    test('errors for invalid analytics mode', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'analytics', mode: 'invalid' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid analytics mode');
    });
  });

  // ── error handling ──────────────────────────────────────────────
  describe('execute - error handling', () => {
    test('fails when agentId is missing', async () => {
      const { tool } = createTestSetup();
      const result = await tool.execute({ action: 'list' }, { agentPool: {} });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent ID is required');
    });

    test('fails when agent is not found', async () => {
      const { tool } = createTestSetup();
      const pool = { getAgent: jest.fn().mockResolvedValue(null) };
      const result = await tool.execute({ action: 'list' }, { agentId: 'x', agentPool: pool });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent not found');
    });

    test('fails for unsupported action', async () => {
      const { tool, context } = createTestSetup();
      const result = await tool.execute({ action: 'fly' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported action');
    });

    test('initializes taskList on agent if missing', async () => {
      const { tool, context, agentPool } = createTestSetup();
      const bare = { id: 'agent-1', name: 'Bare' };
      agentPool.getAgent.mockResolvedValue(bare);
      const result = await tool.execute({ action: 'list' }, context);
      expect(result.success).toBe(true);
      expect(bare.taskList).toBeDefined();
    });
  });
});
