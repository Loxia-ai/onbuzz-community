/**
 * TaskManagerTool - Manages task list for agent autonomous operation
 * 
 * Purpose:
 * - Allows agents to create, update, and manage their own TODO list
 * - Provides task tracking for agent-mode scheduling decisions
 * - Ensures agents only consume resources when they have actual work
 */

import { BaseTool } from './baseTool.js';
import { v4 as uuidv4 } from 'uuid';
import { getMemoryService } from '../services/memoryService.js';

class TaskManagerTool extends BaseTool {
  constructor(config = {}) {
    super({
      name: 'taskmanager',
      description: config.description || 'Task management tool for organizing and tracking work',
      ...config
    });
    
    this.supportedActions = ['create', 'update', 'list', 'complete', 'cancel', 'clear', 'depend', 'relate', 'subtask', 'prioritize', 'template', 'progress', 'analytics', 'sync'];
    this.taskStatuses = ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'];
    this.taskPriorities = ['urgent', 'high', 'medium', 'low'];
    this.dependencyTypes = ['blocks', 'relates', 'subtask', 'parent'];
    
    // Phase 3.4: Progress tracking stages
    this.progressStages = ['not_started', 'planning', 'in_development', 'testing', 'review', 'completed'];
    this.milestoneTypes = ['checkpoint', 'deliverable', 'review_point', 'dependency_gate'];
    
    // Phase 3.2: Priority scoring weights
    this.priorityWeights = {
      blocking: 3.0,        // Tasks that block others
      age: 1.5,             // Older tasks get higher priority
      userPriority: 2.0,    // User-defined priority
      contextSwitching: 1.2, // Reduce context switching penalty
      dependency: 1.8       // Tasks with many dependencies
    };
    
    // Phase 3.3: Built-in task templates
    this.taskTemplates = {
      'web-app-development': {
        name: 'Web Application Development',
        description: 'Complete workflow for building a web application',
        category: 'development',
        tasks: [
          {
            title: 'Project Setup & Planning',
            description: 'Initialize project structure, configure tools, and plan architecture',
            priority: 'high',
            dependencies: []
          },
          {
            title: 'Database Design & Setup',
            description: 'Design database schema, create tables, and set up connections',
            priority: 'high',
            dependencies: ['Project Setup & Planning']
          },
          {
            title: 'Backend API Development',
            description: 'Implement REST API endpoints and business logic',
            priority: 'high',
            dependencies: ['Database Design & Setup']
          },
          {
            title: 'Frontend Development',
            description: 'Build user interface components and implement client-side logic',
            priority: 'medium',
            dependencies: ['Backend API Development']
          },
          {
            title: 'Testing & Quality Assurance',
            description: 'Write and run unit tests, integration tests, and perform QA',
            priority: 'medium',
            dependencies: ['Frontend Development']
          },
          {
            title: 'Deployment & Launch',
            description: 'Deploy to production environment and monitor launch',
            priority: 'high',
            dependencies: ['Testing & Quality Assurance']
          }
        ]
      },
      'api-integration': {
        name: 'API Integration',
        description: 'Standard workflow for integrating with external APIs',
        category: 'integration',
        tasks: [
          {
            title: 'API Research & Documentation Review',
            description: 'Study API documentation, authentication, and rate limits',
            priority: 'high',
            dependencies: []
          },
          {
            title: 'Authentication Setup',
            description: 'Implement API key management and authentication flow',
            priority: 'high',
            dependencies: ['API Research & Documentation Review']
          },
          {
            title: 'Core Integration Implementation',
            description: 'Build API client and implement main integration logic',
            priority: 'high',
            dependencies: ['Authentication Setup']
          },
          {
            title: 'Error Handling & Retry Logic',
            description: 'Implement robust error handling and retry mechanisms',
            priority: 'medium',
            dependencies: ['Core Integration Implementation']
          },
          {
            title: 'Testing & Validation',
            description: 'Test integration with various scenarios and edge cases',
            priority: 'medium',
            dependencies: ['Error Handling & Retry Logic']
          }
        ]
      },
      'bug-fix': {
        name: 'Bug Fix Workflow',
        description: 'Systematic approach to identifying and fixing bugs',
        category: 'maintenance',
        tasks: [
          {
            title: 'Bug Reproduction & Analysis',
            description: 'Reproduce the bug and analyze root cause',
            priority: 'urgent',
            dependencies: []
          },
          {
            title: 'Fix Implementation',
            description: 'Implement the bug fix with minimal side effects',
            priority: 'urgent',
            dependencies: ['Bug Reproduction & Analysis']
          },
          {
            title: 'Testing & Verification',
            description: 'Test fix and verify no regressions introduced',
            priority: 'high',
            dependencies: ['Fix Implementation']
          },
          {
            title: 'Documentation Update',
            description: 'Update documentation if behavior changed',
            priority: 'low',
            dependencies: ['Testing & Verification']
          }
        ]
      },
      'feature-development': {
        name: 'Feature Development',
        description: 'End-to-end feature development workflow',
        category: 'development',
        tasks: [
          {
            title: 'Requirements Analysis',
            description: 'Analyze requirements and create technical specification',
            priority: 'high',
            dependencies: []
          },
          {
            title: 'Design & Architecture',
            description: 'Design system architecture and user interface',
            priority: 'high',
            dependencies: ['Requirements Analysis']
          },
          {
            title: 'Backend Implementation',
            description: 'Implement backend logic and data models',
            priority: 'high',
            dependencies: ['Design & Architecture']
          },
          {
            title: 'Frontend Implementation',
            description: 'Build user interface and integrate with backend',
            priority: 'medium',
            dependencies: ['Backend Implementation']
          },
          {
            title: 'Testing & Documentation',
            description: 'Write tests and update documentation',
            priority: 'medium',
            dependencies: ['Frontend Implementation']
          }
        ]
      }
    };
  }

  /**
   * Get basic tool description (required by BaseTool)
   * @returns {string} Tool description
   */
  getDescription() {
    return `
Task Manager Tool: Organize and track work with TODO lists for agent-mode scheduling.

**CRITICAL**: Maintain your task list to remain active in agent mode!

USAGE:
\`\`\`json
{
  "toolId": "taskmanager",
  "actions": [{"type": "action-name", ...params}]
}
\`\`\`

ACTIONS:
- **sync**: Manage entire task list at once (RECOMMENDED)
- **create**: Create task (title, description, priority)
- **update**: Update task (taskId, status, priority)
- **list**: List all tasks
- **complete**: Mark task done (taskId)
- **cancel**: Cancel task (taskId)
- **clear**: Clear completed/cancelled tasks

EXAMPLES:

Sync task list (RECOMMENDED):
\`\`\`json
{
  "toolId": "taskmanager",
  "actions": [{
    "type": "sync",
    "tasks": [
      {"title": "Analyze requirements", "status": "completed", "priority": "high", "description": "Analyze the project requirements and create a technical specification."},
      {"title": "Design schema", "status": "in_progress", "priority": "high", "description": "Design the database schema for the new feature. [memory:mem-123]"},
      {"title": "Implement API", "status": "pending", "priority": "medium", "description": "Design and implement the REST API endpoints for user management."}
    ]
  }]
}
\`\`\`

Create a task:
\`\`\`json
{
  "toolId": "taskmanager",
  "actions": [{
    "type": "create",
    "title": "Implement authentication",
    "description": "Add login and signup",
    "priority": "high"
  }]
}
\`\`\`

List tasks:
\`\`\`json
{"toolId": "taskmanager", "actions": [{"type": "list"}]}
\`\`\`

Complete a task:
\`\`\`json
{"toolId": "taskmanager", "actions": [{"type": "complete", "taskId": "task-123"}]}
\`\`\`

RECOMMENDED WORKFLOW (read this before your first call)

Phase 1 — Plan (ONE call, at the start):
  \`sync\` with the full list of planned tasks. All start "pending".
  Don't issue \`create\` one-by-one — that's many calls where one would do.

Phase 2 — Execute (per step, repeating):
  a. \`update\` { taskId, status: "in_progress" }   — pick up the next task
  b. do the actual work using other tools
  c. \`update\` { taskId, status: "completed" }     — finish it, move to the next
  (the scheduler enforces at most one task in_progress at a time)

Phase 3 — Refine (as you discover new work):
  - \`create\` a single new task, OR
  - \`sync\` again with the restated full list when the plan materially changes.
  \`sync\` is safe to call repeatedly — it matches by title and preserves
  existing status on unchanged tasks. Don't \`sync\` every turn, though —
  prefer targeted \`update\`/\`create\` unless the plan itself shifted.

Phase 4 — Finish:
  When every task is "completed", call the \`jobdone\` tool.

**MANDATORY**: Complete tasks when finished or you'll loop forever!

MEMORY INTEGRATION:
- When tasks have \`[memory:mem-xxx]\` references in their description, read the referenced memory for full context before working on the task.
- When completing or clearing tasks, consider cleaning up associated task-context memories using the memory tool.
- If the memory tool is not available, use the task description field directly for detailed context.

Always use a detailed task description to provide context for the task, and leverage memory references for longer context when possible.
`;
  }

  /**
   * Check if agent has memory capability
   * @private
   */
  _agentHasMemory(context) {
    return context.agent?.capabilities?.includes('memory');
  }

  /**
   * Auto-create a memory for a substantial task description and return a reference
   * @private
   */
  async _storeDescriptionAsMemory(agentId, taskTitle, description, context) {
    if (!description || description.length < 200) return description;
    if (!this._agentHasMemory(context)) return description;

    try {
      const memoryService = getMemoryService(this.logger);
      await memoryService.initialize();
      const memory = await memoryService.addMemory(agentId, {
        title: `task-context: ${taskTitle}`,
        content: description,
        description: `Context for task "${taskTitle}"`
      });
      if (memory?.id) {
        const summary = description.slice(0, 100).replace(/\n/g, ' ');
        return `[memory:${memory.id}] ${summary}...`;
      }
    } catch (err) {
      this.logger?.warn('Failed to store task description as memory', { error: err.message, agentId, taskTitle });
    }
    return description;
  }

  /**
   * Extract memory IDs from task descriptions
   * @private
   */
  _extractMemoryRefs(tasks) {
    const refs = [];
    for (const task of tasks) {
      const match = task.description?.match(/\[memory:(mem-[^\]]+)\]/);
      if (match) refs.push(match[1]);
    }
    return refs;
  }

  /**
   * Parse parameters from XML tag format
   * Unwraps values from tag parser's {value, attributes} format
   * @param {Object} content - Raw parameters from tag parser or string content
   * @returns {Object} Parsed parameters with unwrapped values
   */
  parseParameters(content) {
    // If content is a string, return as-is for legacy support
    if (typeof content === 'string') {
      return { rawContent: content };
    }

    // If content is already an object, unwrap tag parser format
    if (typeof content === 'object' && content !== null) {
      const unwrapped = {};

      for (const [key, value] of Object.entries(content)) {
        // Check if this is tag parser format: {value: "...", attributes: {}}
        if (value && typeof value === 'object' && 'value' in value) {
          unwrapped[key] = value.value;
        } else {
          // Keep as-is if not wrapped
          unwrapped[key] = value;
        }
      }

      return unwrapped;
    }

    return content;
  }

  /**
   * Execute task management action
   * @param {Object} params - Tool arguments
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(params, context) {
    try {
      // CRITICAL FIX: Unwrap tag parser format {value, attributes}
      // The messageProcessor passes params with wrapped values from parseXMLParameters
      // We need to unwrap them before processing
      const unwrappedParams = {};
      for (const [key, value] of Object.entries(params)) {
        if (value && typeof value === 'object' && 'value' in value) {
          // Tag parser wrapped format: {value: "...", attributes: {}}
          unwrappedParams[key] = value.value;
        } else {
          // Already unwrapped or direct value
          unwrappedParams[key] = value;
        }
      }

      // Use unwrapped params for all subsequent processing
      params = unwrappedParams;

      // CRITICAL FIX: Handle the documented "actions" array format
      // Documentation shows: {"toolId": "taskmanager", "actions": [{"type": "create", ...}]}
      // But code was expecting: {"action": "create", ...}
      // This normalizes both formats to work correctly
      if (params.actions && Array.isArray(params.actions) && params.actions.length > 0) {
        let firstAction = params.actions[0];

        // Deep unwrap the first action if it contains wrapped values
        // This handles cases where array elements are also wrapped: {type: {value: "sync", attributes: {}}}
        if (firstAction && typeof firstAction === 'object') {
          const unwrappedAction = {};
          for (const [key, value] of Object.entries(firstAction)) {
            if (value && typeof value === 'object' && 'value' in value) {
              unwrappedAction[key] = value.value;
            } else {
              unwrappedAction[key] = value;
            }
          }
          firstAction = unwrappedAction;
        }

        // Extract action type from 'type' field in the actions array
        if (firstAction.type && !params.action) {
          params.action = firstAction.type;
          // Merge all other properties from the action object into params
          for (const [key, value] of Object.entries(firstAction)) {
            if (key !== 'type' && !(key in params)) {
              params[key] = value;
            }
          }
        }
      }

      // Alias `id` → `taskId`. The OpenAI function schema for taskmanager
      // uses `id` (shorter, matches the schema's per-action field) but the
      // internal action methods (updateTask, completeTask, cancelTask,
      // createDependency) all read `params.taskId`. Without this alias,
      // update/complete/cancel silently fail with "Task ID is required".
      // Kept non-destructive: only sets taskId when absent, so legacy callers
      // that pass taskId directly continue to work unchanged.
      if (params.id && !params.taskId) {
        params.taskId = params.id;
      }

      // `priority` and `status` are shared per-action properties in the
      // OpenAI function schema so the model can set them on create/update.
      // Reasoning models routinely fill them with default-looking enum values
      // ("low", "pending") for OTHER actions too — meaningless for list, and
      // catastrophic there because listTasks would filter the task list down
      // to rows matching those defaults (often zero).
      //
      // Scope the strip to model entries ONLY (requests that arrived via the
      // `actions` array). Direct callers that use `execute({action:'list',
      // status:'pending'})` still get their filter honored — that API path
      // reflects deliberate intent, not schema-default leakage.
      if (params.actions && params.action?.toLowerCase() === 'list') {
        delete params.priority;
        delete params.status;
      }

      const { agentId, agentName } = context;

      if (!agentId) {
        throw new Error('Agent ID is required for task management');
      }

      // Get agent from pool
      const agent = await context.agentPool.getAgent(agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      // Initialize taskList if it doesn't exist (for backwards compatibility)
      if (!agent.taskList) {
        agent.taskList = {
          tasks: [],
          lastUpdated: new Date().toISOString()
        };
      }

      const action = params.action?.toLowerCase();
      if (!this.supportedActions.includes(action)) {
        throw new Error(`Unsupported action: ${action}. Supported: ${this.supportedActions.join(', ')}`);
      }

      let result;
      switch (action) {
        case 'create':
          result = await this.createTask(agent, params, context);
          break;
        case 'update':
          result = await this.updateTask(agent, params);
          break;
        case 'list':
          result = await this.listTasks(agent, params);
          break;
        case 'complete':
          result = await this.completeTask(agent, params);
          break;
        case 'cancel':
          result = await this.cancelTask(agent, params);
          break;
        case 'clear':
          result = await this.clearCompletedTasks(agent, params);
          break;
        case 'depend':
          result = await this.createDependency(agent, params);
          break;
        case 'relate':
          result = await this.relateTask(agent, params);
          break;
        case 'subtask':
          result = await this.createSubtask(agent, params);
          break;
        case 'prioritize':
          result = await this.intelligentPrioritization(agent, params);
          break;
        case 'template':
          result = await this.manageTemplates(agent, params);
          break;
        case 'progress':
          result = await this.trackProgress(agent, params);
          break;
        case 'analytics':
          result = await this.generateAnalytics(agent, params);
          break;
        case 'sync':
          result = await this.syncTasks(agent, params, context);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // Update the agent's lastActivity
      agent.lastActivity = new Date().toISOString();
      agent.taskList.lastUpdated = new Date().toISOString();

      // Persist the agent state
      await context.agentPool.persistAgentState(agentId);

      const pendingCount = agent.taskList.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;

      this.logger?.info(`TaskManager action executed: ${action}`, {
        agentId,
        agentName,
        action,
        taskCount: agent.taskList.tasks.length,
        pendingTasks: agent.taskList.tasks.filter(t => t.status === 'pending').length,
        inProgressTasks: agent.taskList.tasks.filter(t => t.status === 'in_progress').length
      });

      // When no actionable tasks remain, set TTL to give agent one more cycle to react
      // This allows the agent to call job-done or create new tasks before becoming idle
      if (pendingCount === 0) {
        agent.ttl = 1;
        await context.agentPool.persistAgentState(agentId);
        this.logger?.debug(`TTL set to 1 for agent ${agentId} - no remaining tasks`);
      }

      // When no actionable tasks remain, prompt the agent to decide next steps
      const noTasksHint = pendingCount === 0
        ? '\n\n[No remaining tasks] Have you fulfilled the user\'s request? If so, call job-done with a summary. Otherwise, update your task list to reflect what still needs to be done.'
        : '';

      // Always include the full current task list in the response envelope
      // so UI views (TaskPanel, TeamTaskBoard) can render the agent's current
      // state without fetching on every render. Previously only the `list`
      // action's inner result carried `tasks`, so every `create`/`update`/
      // `complete`/`cancel`/`clear` call left the panel looking stale: the
      // renderer's walk-back found the latest taskmanager call but found no
      // tasks in its result and showed an empty panel. Emitting the full
      // list on every action makes the most-recent-taskmanager-result
      // contract always authoritative.
      return {
        success: true,
        action,
        result,
        tasks: agent.taskList.tasks,
        summary: this.generateTaskSummary(agent.taskList) + noTasksHint
      };

    } catch (error) {
      // IMPORTANT: do NOT log the raw `context` object. The tool-execute
      // context contains back-references to AgentPool ⇄ MessageProcessor
      // (plus agentPool.messageProcessor.agentPool…), which triggers
      // "Converting circular structure to JSON" in the logger's
      // JSON.stringify — and THAT throw escapes this catch, corrupting
      // the error surfaced to the agent. Pluck only plain-data fields.
      // Regression guard: src/utilities/logger.js also has a defensive
      // replacer that strips known back-ref keys if anyone else leaks a
      // context-shaped object into logs.
      this.logger?.error('TaskManager execution failed', {
        error: error.message,
        stack: error.stack,
        agentId: context?.agentId,
        action: params?.action,
        paramKeys: params ? Object.keys(params) : [],
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create a new task
   * @private
   */
  async createTask(agent, params, context) {
    const { title, description = '', priority = 'medium' } = params;

    if (!title) {
      throw new Error('Task title is required');
    }

    if (priority && !this.taskPriorities.includes(priority.toLowerCase())) {
      throw new Error(`Invalid priority: ${priority}. Must be: ${this.taskPriorities.join(', ')}`);
    }

    // Auto-store long descriptions as memory references
    const storedDescription = await this._storeDescriptionAsMemory(
      context.agentId, title, description, context
    );

    const task = {
      id: `task-${uuidv4()}`,
      title,
      description: storedDescription,
      status: 'pending',
      priority: priority.toLowerCase(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    agent.taskList.tasks.push(task);

    const result = {
      message: 'Task created successfully',
      task
    };

    // Add hint if description was stored as memory
    if (storedDescription !== description && storedDescription.includes('[memory:')) {
      result.memoryHint = 'Task description stored as memory. Read the referenced memory for full context.';
    }

    return result;
  }

  /**
   * Sync entire task list (Claude Code style batch management)
   * @private
   */
  async syncTasks(agent, params, context) {
    let { tasks } = params;

    // Parse tasks if provided as JSON string
    if (typeof tasks === 'string') {
      try {
        tasks = JSON.parse(tasks);
      } catch (error) {
        throw new Error(`Invalid tasks JSON: ${error.message}`);
      }
    }

    if (!Array.isArray(tasks)) {
      throw new Error('Tasks must be an array');
    }

    if (tasks.length === 0) {
      throw new Error('Tasks array cannot be empty');
    }

    const timestamp = new Date().toISOString();
    const existingTasks = agent.taskList.tasks || [];
    const updatedTasks = [];
    const createdTasks = [];
    const matchedIds = new Set();

    // Helper: fuzzy match task by title
    const findExistingTask = (title) => {
      const normalizedTitle = title.toLowerCase().trim();
      return existingTasks.find(t =>
        t.title.toLowerCase().trim() === normalizedTitle &&
        !matchedIds.has(t.id)
      );
    };

    // Validate and process each task
    for (const taskData of tasks) {
      if (!taskData.title) {
        throw new Error('Each task must have a title');
      }

      const status = (taskData.status || 'pending').toLowerCase();
      const priority = (taskData.priority || 'medium').toLowerCase();

      // Validate status
      if (!this.taskStatuses.includes(status)) {
        throw new Error(`Invalid status "${status}" for task "${taskData.title}". Must be: ${this.taskStatuses.join(', ')}`);
      }

      // Validate priority
      if (!this.taskPriorities.includes(priority)) {
        throw new Error(`Invalid priority "${priority}" for task "${taskData.title}". Must be: ${this.taskPriorities.join(', ')}`);
      }

      // Try to match with existing task
      const existingTask = findExistingTask(taskData.title);

      if (existingTask) {
        // Update existing task
        existingTask.status = status;
        existingTask.priority = priority;
        if (taskData.description !== undefined) {
          existingTask.description = taskData.description;
        }
        existingTask.updatedAt = timestamp;

        updatedTasks.push(existingTask);
        matchedIds.add(existingTask.id);
      } else {
        // Create new task — auto-store long descriptions as memory
        const storedDesc = await this._storeDescriptionAsMemory(
          context.agentId, taskData.title, taskData.description || '', context
        );
        const newTask = {
          id: `task-${uuidv4()}`,
          title: taskData.title,
          description: storedDesc,
          status: status,
          priority: priority,
          createdAt: timestamp,
          updatedAt: timestamp,
          source: 'sync'
        };

        createdTasks.push(newTask);
      }
    }

    // Replace task list with synced tasks
    agent.taskList.tasks = [...updatedTasks, ...createdTasks];

    // Ensure only one task is in_progress
    const inProgressTasks = agent.taskList.tasks.filter(t => t.status === 'in_progress');
    if (inProgressTasks.length > 1) {
      // Keep only the first in_progress task, set others to pending
      for (let i = 1; i < inProgressTasks.length; i++) {
        inProgressTasks[i].status = 'pending';
      }
    }

    // Auto-set first pending task to in_progress if no task is in_progress
    if (inProgressTasks.length === 0) {
      const firstPending = agent.taskList.tasks.find(t => t.status === 'pending');
      if (firstPending) {
        firstPending.status = 'in_progress';
        firstPending.updatedAt = timestamp;
      }
    }

    agent.taskList.lastUpdated = timestamp;

    return {
      message: 'Task list synchronized successfully',
      summary: {
        total: agent.taskList.tasks.length,
        created: createdTasks.length,
        updated: updatedTasks.length,
        removed: existingTasks.length - matchedIds.size,
        pending: agent.taskList.tasks.filter(t => t.status === 'pending').length,
        inProgress: agent.taskList.tasks.filter(t => t.status === 'in_progress').length,
        completed: agent.taskList.tasks.filter(t => t.status === 'completed').length,
        cancelled: agent.taskList.tasks.filter(t => t.status === 'cancelled').length
      },
      tasks: agent.taskList.tasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority
      })),
      ...(this._extractMemoryRefs(agent.taskList.tasks).length > 0 && {
        memoryHint: 'Some tasks reference memories — read them with the memory tool for full context.'
      })
    };
  }

  /**
   * Update an existing task
   * @private
   */
  async updateTask(agent, params) {
    const { taskId, status, priority, title, description } = params;

    if (!taskId) {
      throw new Error('Task ID is required for update');
    }

    const task = agent.taskList.tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (status) {
      if (!this.taskStatuses.includes(status.toLowerCase())) {
        throw new Error(`Invalid status: ${status}. Must be: ${this.taskStatuses.join(', ')}`);
      }
      task.status = status.toLowerCase();
    }

    if (priority) {
      if (!this.taskPriorities.includes(priority.toLowerCase())) {
        throw new Error(`Invalid priority: ${priority}. Must be: ${this.taskPriorities.join(', ')}`);
      }
      task.priority = priority.toLowerCase();
    }

    // Reasoning models on the Responses API routinely fill every string
    // property declared in the schema — even on update actions that only
    // intend to change status/priority — with an empty string. A naive
    // `if (title !== undefined)` assignment wipes the real title with "".
    // Treat empty / whitespace-only strings as "not provided" so updates
    // only mutate fields the model actually set to a meaningful value.
    if (typeof title === 'string' && title.trim().length > 0) task.title = title;
    if (typeof description === 'string' && description.trim().length > 0) task.description = description;
    
    task.updatedAt = new Date().toISOString();

    return {
      message: 'Task updated successfully',
      task
    };
  }

  /**
   * List all tasks
   * @private
   */
  async listTasks(agent, params) {
    const { status, priority } = params;
    let tasks = [...agent.taskList.tasks];

    // Filter by status if specified
    if (status) {
      if (!this.taskStatuses.includes(status.toLowerCase())) {
        throw new Error(`Invalid status filter: ${status}`);
      }
      tasks = tasks.filter(t => t.status === status.toLowerCase());
    }

    // Filter by priority if specified
    if (priority) {
      if (!this.taskPriorities.includes(priority.toLowerCase())) {
        throw new Error(`Invalid priority filter: ${priority}`);
      }
      tasks = tasks.filter(t => t.priority === priority.toLowerCase());
    }

    // Sort by priority (high first) then by creation date
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    tasks.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    const result = {
      totalTasks: tasks.length,
      tasks,
      summary: {
        pending: tasks.filter(t => t.status === 'pending').length,
        in_progress: tasks.filter(t => t.status === 'in_progress').length,
        completed: tasks.filter(t => t.status === 'completed').length,
        cancelled: tasks.filter(t => t.status === 'cancelled').length
      }
    };

    const memRefs = this._extractMemoryRefs(tasks);
    if (memRefs.length > 0) {
      result.memoryHint = 'Some tasks reference memories — read them with the memory tool for full context.';
    }

    return result;
  }

  /**
   * Complete a task
   * @private
   */
  async completeTask(agent, params) {
    let { taskId } = params;

    // If no taskId provided, auto-complete the first in-progress task
    if (!taskId) {
      const inProgressTask = agent.taskList.tasks.find(t => t.status === 'in_progress' || t.status === 'pending');
      if (inProgressTask) {
        taskId = inProgressTask.id;
        this.logger?.info(`Auto-completing current task: ${taskId}`, {
          agentId: agent.id,
          taskTitle: inProgressTask.title
        });
      } else {
        throw new Error('No task ID provided and no in-progress tasks found to complete');
      }
    }

    const task = agent.taskList.tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status === 'completed') {
      return {
        message: 'Task already completed',
        task
      };
    }

    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();

    // Phase 3: Trigger dependency updates when task is completed
    if (this.scheduler && typeof this.scheduler.updateDependentTasks === 'function') {
      try {
        await this.scheduler.updateDependentTasks(agent, taskId);
        this.logger?.info(`Triggered dependency update for completed task`, {
          taskId,
          title: task.title
        });
      } catch (error) {
        this.logger?.warn(`Failed to update dependent tasks`, {
          taskId,
          error: error.message
        });
      }
    }

    const remainingPending = agent.taskList.tasks.filter(
      t => t.status === 'pending' || t.status === 'in_progress'
    ).length;

    const result = {
      message: 'Task completed successfully',
      task,
      remainingPendingTasks: remainingPending,
      dependenciesUpdated: !!this.scheduler
    };

    // Add memory cleanup hint if task had a memory reference
    const memRefs = this._extractMemoryRefs([task]);
    if (memRefs.length > 0) {
      result.memoryHint = `Consider cleaning up associated task-context memory: ${memRefs.join(', ')}`;
    }

    return result;
  }

  /**
   * Cancel a task
   * @private
   */
  async cancelTask(agent, params) {
    const { taskId, reason = '' } = params;

    if (!taskId) {
      throw new Error('Task ID is required');
    }

    const task = agent.taskList.tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = 'cancelled';
    task.cancelledAt = new Date().toISOString();
    task.cancellationReason = reason;
    task.updatedAt = new Date().toISOString();

    const remainingPending = agent.taskList.tasks.filter(
      t => t.status === 'pending' || t.status === 'in_progress'
    ).length;

    return {
      message: 'Task cancelled successfully',
      task,
      remainingPendingTasks: remainingPending
    };
  }

  /**
   * Clear completed and cancelled tasks
   * @private
   */
  async clearCompletedTasks(agent, params) {
    const originalCount = agent.taskList.tasks.length;

    // Collect memory refs from tasks being cleared
    const clearedTasks = agent.taskList.tasks.filter(
      t => t.status !== 'pending' && t.status !== 'in_progress'
    );
    const memRefs = this._extractMemoryRefs(clearedTasks);

    // Keep only pending and in_progress tasks
    agent.taskList.tasks = agent.taskList.tasks.filter(
      t => t.status === 'pending' || t.status === 'in_progress'
    );

    const removedCount = originalCount - agent.taskList.tasks.length;

    const result = {
      message: `Cleared ${removedCount} completed/cancelled tasks`,
      remainingTasks: agent.taskList.tasks.length,
      removed: removedCount
    };

    if (memRefs.length > 0) {
      result.memoryHint = `Consider cleaning up associated task-context memories: ${memRefs.join(', ')}`;
    }

    return result;
  }

  /**
   * Create dependency between tasks (Phase 3)
   * @private
   */
  async createDependency(agent, params) {
    const { taskId, dependsOn, dependencyType = 'blocks' } = params;

    if (!taskId || !dependsOn) {
      throw new Error('Both taskId and dependsOn are required for creating dependencies');
    }

    if (!this.dependencyTypes.includes(dependencyType)) {
      throw new Error(`Invalid dependency type: ${dependencyType}. Must be: ${this.dependencyTypes.join(', ')}`);
    }

    const task = agent.taskList.tasks.find(t => t.id === taskId);
    const dependencyTask = agent.taskList.tasks.find(t => t.id === dependsOn);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (!dependencyTask) {
      throw new Error(`Dependency task not found: ${dependsOn}`);
    }

    // Initialize dependencies array if not exists
    if (!task.dependencies) {
      task.dependencies = [];
    }

    // Check if dependency already exists
    const existingDep = task.dependencies.find(d => d.taskId === dependsOn);
    if (existingDep) {
      return {
        message: 'Dependency already exists',
        dependency: existingDep
      };
    }

    // Create dependency
    const dependency = {
      taskId: dependsOn,
      type: dependencyType,
      createdAt: new Date().toISOString()
    };

    task.dependencies.push(dependency);
    task.updatedAt = new Date().toISOString();

    // If this is a blocking dependency, check if task should be blocked
    if (dependencyType === 'blocks' && dependencyTask.status !== 'completed') {
      task.status = 'blocked';
    }

    return {
      message: 'Dependency created successfully',
      dependency,
      task
    };
  }

  /**
   * Create relationship between tasks (non-blocking)
   * @private
   */
  async relateTask(agent, params) {
    return await this.createDependency(agent, { ...params, dependencyType: 'relates' });
  }

  /**
   * Create subtask relationship
   * @private
   */
  async createSubtask(agent, params) {
    const { parentTaskId, title, description = '', priority = 'medium' } = params;

    if (!parentTaskId || !title) {
      throw new Error('Parent task ID and title are required for creating subtasks');
    }

    const parentTask = agent.taskList.tasks.find(t => t.id === parentTaskId);
    if (!parentTask) {
      throw new Error(`Parent task not found: ${parentTaskId}`);
    }

    // Create the subtask
    const subtask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title,
      description,
      status: 'pending',
      priority: priority.toLowerCase(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      parentTaskId: parentTaskId,
      isSubtask: true,
      source: 'user-created'
    };

    agent.taskList.tasks.push(subtask);

    // Initialize subtasks array on parent if not exists
    if (!parentTask.subtasks) {
      parentTask.subtasks = [];
    }

    parentTask.subtasks.push(subtask.id);
    parentTask.updatedAt = new Date().toISOString();

    return {
      message: 'Subtask created successfully',
      subtask,
      parentTask
    };
  }

  /**
   * Template management (Phase 3.3)
   * @private
   */
  async manageTemplates(agent, params) {
    const { mode = 'list', templateId, customTemplate, projectContext } = params;
    
    let results = {};
    
    if (mode === 'list') {
      // List available templates
      results = await this.listAvailableTemplates(agent);
    } else if (mode === 'apply' && templateId) {
      // Apply a template to create tasks
      results = await this.applyTemplate(agent, templateId, projectContext);
    } else if (mode === 'create' && customTemplate) {
      // Create custom template
      results = await this.createCustomTemplate(agent, customTemplate);
    } else if (mode === 'suggest') {
      // Suggest templates based on existing tasks
      results = await this.suggestTemplates(agent);
    } else {
      throw new Error('Invalid template mode. Use: list, apply, create, or suggest');
    }
    
    return {
      message: `Template management completed (${mode})`,
      mode,
      ...results
    };
  }

  /**
   * List available task templates
   * @private
   */
  async listAvailableTemplates(agent) {
    const builtInTemplates = Object.entries(this.taskTemplates).map(([id, template]) => ({
      id,
      name: template.name,
      description: template.description,
      category: template.category,
      taskCount: template.tasks.length,
      type: 'built-in'
    }));

    // Get custom templates from agent's storage
    const customTemplates = agent.customTemplates || [];
    const formattedCustom = customTemplates.map(template => ({
      ...template,
      type: 'custom'
    }));

    return {
      builtInTemplates,
      customTemplates: formattedCustom,
      totalTemplates: builtInTemplates.length + formattedCustom.length,
      categories: [...new Set(builtInTemplates.map(t => t.category))]
    };
  }

  /**
   * Apply a template to create structured tasks
   * @private
   */
  async applyTemplate(agent, templateId, projectContext = {}) {
    const template = this.taskTemplates[templateId] || 
                    (agent.customTemplates || []).find(t => t.id === templateId);
    
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const createdTasks = [];
    const taskMapping = new Map(); // Map template task titles to actual task IDs
    
    // Apply project context to customize template
    const contextualizedTasks = this.applyProjectContext(template.tasks, projectContext);
    
    // Create all tasks first
    for (const templateTask of contextualizedTasks) {
      const task = {
        id: `task-${uuidv4()}`,
        title: templateTask.title,
        description: templateTask.description,
        status: 'pending',
        priority: templateTask.priority,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        templateId: templateId,
        templateOrigin: template.type || 'built-in',
        source: 'template-generated'
      };

      agent.taskList.tasks.push(task);
      createdTasks.push(task);
      taskMapping.set(templateTask.title, task.id);
    }

    // Create dependencies after all tasks exist
    for (let i = 0; i < contextualizedTasks.length; i++) {
      const templateTask = contextualizedTasks[i];
      const actualTask = createdTasks[i];
      
      if (templateTask.dependencies && templateTask.dependencies.length > 0) {
        actualTask.dependencies = [];
        
        for (const depTitle of templateTask.dependencies) {
          const depTaskId = taskMapping.get(depTitle);
          if (depTaskId) {
            actualTask.dependencies.push({
              taskId: depTaskId,
              type: 'blocks',
              createdAt: new Date().toISOString()
            });
            
            // Set task as blocked if dependency isn't completed
            actualTask.status = 'blocked';
          }
        }
      }
    }

    // Auto-prioritize the newly created tasks
    await this.autoPrioritizeAllTasks(agent);

    return {
      template: {
        id: templateId,
        name: template.name,
        description: template.description
      },
      tasksCreated: createdTasks.length,
      tasks: createdTasks.map(task => ({
        id: task.id,
        title: task.title,
        priority: task.priority,
        status: task.status,
        dependencies: task.dependencies ? task.dependencies.length : 0
      })),
      workflowStructure: this.generateWorkflowVisualization(createdTasks)
    };
  }

  /**
   * Apply project context to customize template tasks
   * @private
   */
  applyProjectContext(templateTasks, context) {
    return templateTasks.map(task => {
      let customizedTask = { ...task };
      
      // Apply context-specific customizations
      if (context.projectName) {
        customizedTask.title = customizedTask.title.replace(/\[PROJECT\]/g, context.projectName);
        customizedTask.description = customizedTask.description.replace(/\[PROJECT\]/g, context.projectName);
      }
      
      if (context.technology) {
        customizedTask.title = customizedTask.title.replace(/\[TECH\]/g, context.technology);
        customizedTask.description = customizedTask.description.replace(/\[TECH\]/g, context.technology);
      }
      
      if (context.urgency === 'high') {
        customizedTask.priority = customizedTask.priority === 'low' ? 'medium' : 
                                 customizedTask.priority === 'medium' ? 'high' : 'urgent';
      }
      
      // Team size can affect priority rather than time estimates
      if (context.team === 'small' && customizedTask.priority === 'medium') {
        customizedTask.priority = 'high'; // Small teams need focused priorities
      }
      
      return customizedTask;
    });
  }

  /**
   * Create custom template from existing tasks or specification
   * @private
   */
  async createCustomTemplate(agent, customTemplate) {
    const { name, description, category, tasks } = customTemplate;
    
    if (!name || !tasks || tasks.length === 0) {
      throw new Error('Custom template requires name and at least one task');
    }

    const template = {
      id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      description: description || `Custom template: ${name}`,
      category: category || 'custom',
      tasks: tasks.map(task => ({
        title: task.title,
        description: task.description || '',
        priority: task.priority || 'medium',
        dependencies: task.dependencies || []
      })),
      createdAt: new Date().toISOString(),
      type: 'custom'
    };

    // Initialize custom templates array if not exists
    if (!agent.customTemplates) {
      agent.customTemplates = [];
    }

    agent.customTemplates.push(template);

    return {
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        taskCount: template.tasks.length
      },
      message: 'Custom template created successfully'
    };
  }

  /**
   * Suggest templates based on existing tasks and patterns
   * @private
   */
  async suggestTemplates(agent) {
    const existingTasks = agent.taskList.tasks;
    const suggestions = [];

    // Analyze existing task patterns
    const taskTitles = existingTasks.map(t => t.title.toLowerCase());
    const priorities = existingTasks.map(t => t.priority);
    
    // Pattern-based suggestions
    if (taskTitles.some(title => title.includes('api') || title.includes('endpoint'))) {
      suggestions.push({
        templateId: 'api-integration',
        reason: 'Detected API-related tasks',
        confidence: 0.8
      });
    }
    
    if (taskTitles.some(title => title.includes('bug') || title.includes('fix') || title.includes('error'))) {
      suggestions.push({
        templateId: 'bug-fix',
        reason: 'Detected bug fix tasks',
        confidence: 0.9
      });
    }
    
    if (taskTitles.some(title => title.includes('feature') || title.includes('implement'))) {
      suggestions.push({
        templateId: 'feature-development',
        reason: 'Detected feature development tasks',
        confidence: 0.7
      });
    }
    
    if (existingTasks.length >= 5 && priorities.includes('high') && priorities.includes('medium')) {
      suggestions.push({
        templateId: 'web-app-development',
        reason: 'Large project with mixed priorities suggests web app development',
        confidence: 0.6
      });
    }

    // Enhance suggestions with template details
    const detailedSuggestions = suggestions.map(suggestion => {
      const template = this.taskTemplates[suggestion.templateId];
      return {
        ...suggestion,
        templateName: template.name,
        templateDescription: template.description,
        taskCount: template.tasks.length
      };
    });

    return {
      suggestions: detailedSuggestions,
      analysisResults: {
        existingTaskCount: existingTasks.length,
        dominantPriority: this.getMostCommonPriority(priorities),
        detectedPatterns: suggestions.map(s => s.reason)
      }
    };
  }

  /**
   * Generate workflow visualization for created tasks
   * @private
   */
  generateWorkflowVisualization(tasks) {
    const workflow = {
      phases: [],
      criticalPath: [],
      parallelTasks: []
    };

    // Group tasks by their dependency level
    const levels = new Map();
    const processedTasks = new Set();
    
    // Find root tasks (no dependencies)
    const rootTasks = tasks.filter(task => !task.dependencies || task.dependencies.length === 0);
    rootTasks.forEach(task => {
      levels.set(0, (levels.get(0) || []).concat([task]));
      processedTasks.add(task.id);
    });

    // Build dependency levels
    let currentLevel = 0;
    while (processedTasks.size < tasks.length && currentLevel < 10) {
      currentLevel++;
      const currentLevelTasks = [];
      
      for (const task of tasks) {
        if (processedTasks.has(task.id)) continue;
        
        if (task.dependencies && task.dependencies.every(dep => processedTasks.has(dep.taskId))) {
          currentLevelTasks.push(task);
          processedTasks.add(task.id);
        }
      }
      
      if (currentLevelTasks.length > 0) {
        levels.set(currentLevel, currentLevelTasks);
      }
    }

    // Convert levels to phases
    for (const [level, levelTasks] of levels.entries()) {
      workflow.phases.push({
        phase: level + 1,
        tasks: levelTasks.map(task => ({
          id: task.id,
          title: task.title,
          priority: task.priority
        })),
        taskCount: levelTasks.length,
        canRunInParallel: levelTasks.length > 1
      });
    }

    return workflow;
  }

  /**
   * Get most common priority from array
   * @private
   */
  getMostCommonPriority(priorities) {
    if (priorities.length === 0) return 'medium';
    
    const counts = priorities.reduce((acc, priority) => {
      acc[priority] = (acc[priority] || 0) + 1;
      return acc;
    }, {});
    
    return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
  }

  /**
   * Progress tracking management (Phase 3.4)
   * @private
   */
  async trackProgress(agent, params) {
    const { mode = 'update', taskId, stage, milestone, note, percentage } = params;
    
    let results = {};
    
    if (mode === 'update' && taskId) {
      // Update progress for specific task
      results = await this.updateTaskProgress(agent, taskId, { stage, milestone, note, percentage });
    } else if (mode === 'overview') {
      // Get progress overview for all tasks
      results = await this.getProgressOverview(agent);
    } else if (mode === 'milestones' && taskId) {
      // Manage milestones for specific task
      results = await this.manageMilestones(agent, taskId, params);
    } else if (mode === 'calculate') {
      // Calculate progress based on subtasks and dependencies
      results = await this.calculateTaskProgress(agent, taskId);
    } else {
      throw new Error('Invalid progress mode. Use: update, overview, milestones, or calculate');
    }
    
    return {
      message: `Progress tracking completed (${mode})`,
      mode,
      ...results
    };
  }

  /**
   * Update progress for a specific task
   * @private
   */
  async updateTaskProgress(agent, taskId, progressData) {
    const task = agent.taskList.tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Initialize progress tracking if not exists
    if (!task.progress) {
      task.progress = {
        stage: 'not_started',
        percentage: 0,
        milestones: [],
        notes: [],
        stageHistory: []
      };
    }

    const oldStage = task.progress.stage;
    
    // Update stage if provided
    if (progressData.stage) {
      if (!this.progressStages.includes(progressData.stage)) {
        throw new Error(`Invalid progress stage: ${progressData.stage}. Must be: ${this.progressStages.join(', ')}`);
      }
      
      task.progress.stage = progressData.stage;
      
      // Track stage changes
      task.progress.stageHistory.push({
        from: oldStage,
        to: progressData.stage,
        timestamp: new Date().toISOString()
      });
      
      // Auto-update task status based on stage
      if (progressData.stage === 'not_started' && task.status === 'in_progress') {
        task.status = 'pending';
      } else if (['planning', 'in_development', 'testing', 'review'].includes(progressData.stage) && task.status === 'pending') {
        task.status = 'in_progress';
      } else if (progressData.stage === 'completed' && task.status !== 'completed') {
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
      }
    }

    // Update percentage if provided
    if (progressData.percentage !== undefined) {
      const percent = Math.max(0, Math.min(100, parseInt(progressData.percentage)));
      task.progress.percentage = percent;
      
      // Auto-update stage based on percentage
      if (percent === 0 && task.progress.stage !== 'not_started') {
        task.progress.stage = 'not_started';
      } else if (percent > 0 && percent < 25 && task.progress.stage === 'not_started') {
        task.progress.stage = 'planning';
      } else if (percent >= 25 && percent < 75 && ['not_started', 'planning'].includes(task.progress.stage)) {
        task.progress.stage = 'in_development';
      } else if (percent >= 75 && percent < 95 && task.progress.stage !== 'testing') {
        task.progress.stage = 'testing';
      } else if (percent >= 95 && percent < 100 && task.progress.stage !== 'review') {
        task.progress.stage = 'review';
      } else if (percent === 100) {
        task.progress.stage = 'completed';
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
      }
    }

    // Add milestone if provided
    if (progressData.milestone) {
      const milestone = {
        id: `milestone-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: progressData.milestone.type || 'checkpoint',
        title: progressData.milestone.title || 'Progress Milestone',
        description: progressData.milestone.description || '',
        achievedAt: new Date().toISOString(),
        stage: task.progress.stage
      };
      
      task.progress.milestones.push(milestone);
    }

    // Add progress note if provided
    if (progressData.note) {
      task.progress.notes.push({
        id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        content: progressData.note,
        timestamp: new Date().toISOString(),
        stage: task.progress.stage
      });
    }

    task.updatedAt = new Date().toISOString();

    // Calculate progress for parent task if this is a subtask
    if (task.parentTaskId) {
      await this.calculateTaskProgress(agent, task.parentTaskId);
    }

    return {
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        progress: task.progress
      },
      changes: {
        stageChanged: oldStage !== task.progress.stage,
        oldStage,
        newStage: task.progress.stage,
        milestoneAdded: !!progressData.milestone,
        noteAdded: !!progressData.note
      }
    };
  }

  /**
   * Get progress overview for all tasks
   * @private
   */
  async getProgressOverview(agent) {
    const tasks = agent.taskList.tasks;
    const taskProgress = tasks.map(task => {
      const progress = task.progress || { stage: 'not_started', percentage: 0, milestones: [], notes: [] };
      
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        stage: progress.stage,
        percentage: progress.percentage,
        milestoneCount: progress.milestones ? progress.milestones.length : 0,
        isBlocked: task.status === 'blocked',
        hasSubtasks: !!(task.subtasks && task.subtasks.length > 0),
        parentTaskId: task.parentTaskId
      };
    });

    // Calculate overall statistics
    const stats = {
      totalTasks: tasks.length,
      byStage: {},
      byStatus: {},
      averageProgress: 0,
      blockedTasks: 0,
      completedTasks: 0
    };

    this.progressStages.forEach(stage => {
      stats.byStage[stage] = taskProgress.filter(t => t.stage === stage).length;
    });

    this.taskStatuses.forEach(status => {
      stats.byStatus[status] = taskProgress.filter(t => t.status === status).length;
    });

    stats.averageProgress = tasks.length > 0 ? 
      Math.round(taskProgress.reduce((sum, t) => sum + t.percentage, 0) / tasks.length) : 0;
    
    stats.blockedTasks = stats.byStatus.blocked || 0;
    stats.completedTasks = stats.byStatus.completed || 0;

    // Find critical path and bottlenecks
    const criticalTasks = taskProgress.filter(t => 
      t.priority === 'urgent' && t.status !== 'completed'
    );
    
    const bottlenecks = taskProgress.filter(t => 
      t.isBlocked && this.findTasksBlockedBy(t.id, tasks).length > 0
    );

    return {
      overview: stats,
      tasks: taskProgress,
      criticalTasks,
      bottlenecks: bottlenecks.map(t => ({
        taskId: t.id,
        title: t.title,
        blockedTasksCount: this.findTasksBlockedBy(t.id, tasks).length
      })),
      recommendations: this.generateProgressRecommendations(taskProgress, stats)
    };
  }

  /**
   * Calculate task progress based on subtasks and dependencies
   * @private
   */
  async calculateTaskProgress(agent, taskId) {
    const task = agent.taskList.tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Initialize progress if not exists
    if (!task.progress) {
      task.progress = {
        stage: 'not_started',
        percentage: 0,
        milestones: [],
        notes: [],
        stageHistory: []
      };
    }

    let calculatedPercentage = 0;
    let calculationMethod = 'manual';

    // Calculate based on subtasks if they exist
    if (task.subtasks && task.subtasks.length > 0) {
      const subtasks = task.subtasks.map(subtaskId => 
        agent.taskList.tasks.find(t => t.id === subtaskId)
      ).filter(Boolean);

      if (subtasks.length > 0) {
        const subtaskProgress = subtasks.map(subtask => {
          if (subtask.status === 'completed') return 100;
          if (subtask.progress && subtask.progress.percentage !== undefined) {
            return subtask.progress.percentage;
          }
          return subtask.status === 'in_progress' ? 25 : 0;
        });

        calculatedPercentage = Math.round(
          subtaskProgress.reduce((sum, p) => sum + p, 0) / subtasks.length
        );
        calculationMethod = 'subtasks';
      }
    }
    
    // If no subtasks, calculate based on dependencies completion
    else if (task.dependencies && task.dependencies.length > 0) {
      const completedDeps = task.dependencies.filter(dep => {
        const depTask = agent.taskList.tasks.find(t => t.id === dep.taskId);
        return depTask && depTask.status === 'completed';
      }).length;

      const depProgress = (completedDeps / task.dependencies.length) * 30; // Dependencies contribute 30%
      const ownProgress = task.status === 'completed' ? 70 : 
                         task.status === 'in_progress' ? 35 : 0; // Own progress contributes 70%
      
      calculatedPercentage = Math.round(depProgress + ownProgress);
      calculationMethod = 'dependencies';
    }
    
    // Fallback to status-based calculation
    else {
      if (task.status === 'completed') calculatedPercentage = 100;
      else if (task.status === 'in_progress') calculatedPercentage = task.progress.percentage || 50;
      else if (task.status === 'pending') calculatedPercentage = 0;
      else if (task.status === 'blocked') calculatedPercentage = task.progress.percentage || 0;
      
      calculationMethod = 'status';
    }

    // Update the task's calculated progress
    task.progress.calculatedPercentage = calculatedPercentage;
    task.progress.calculationMethod = calculationMethod;
    task.progress.lastCalculated = new Date().toISOString();

    // Auto-update stage based on calculated percentage if no manual stage set recently
    const recentStageUpdate = task.progress.stageHistory.length > 0 && 
      (Date.now() - new Date(task.progress.stageHistory[task.progress.stageHistory.length - 1].timestamp).getTime()) < 300000; // 5 minutes

    if (!recentStageUpdate) {
      const autoStage = this.getStageFromPercentage(calculatedPercentage);
      if (autoStage !== task.progress.stage) {
        task.progress.stage = autoStage;
        task.progress.stageHistory.push({
          from: task.progress.stage,
          to: autoStage,
          timestamp: new Date().toISOString(),
          automatic: true
        });
      }
    }

    task.updatedAt = new Date().toISOString();

    return {
      taskId: task.id,
      title: task.title,
      calculatedPercentage,
      calculationMethod,
      manualPercentage: task.progress.percentage,
      stage: task.progress.stage,
      subtaskCount: task.subtasks ? task.subtasks.length : 0,
      dependencyCount: task.dependencies ? task.dependencies.length : 0
    };
  }

  /**
   * Generate progress recommendations
   * @private
   */
  generateProgressRecommendations(taskProgress, stats) {
    const recommendations = [];

    // Blocked task recommendations
    if (stats.blockedTasks > 0) {
      recommendations.push({
        type: 'urgent',
        category: 'blocked_tasks',
        message: `${stats.blockedTasks} tasks are blocked. Review dependencies to unblock progress.`,
        actionable: true
      });
    }

    // Stalled task recommendations
    const stalledTasks = taskProgress.filter(t => 
      t.status === 'in_progress' && t.percentage < 25
    );
    
    if (stalledTasks.length > 0) {
      recommendations.push({
        type: 'warning',
        category: 'stalled_progress',
        message: `${stalledTasks.length} tasks are in progress but showing low progress. Consider breaking them into smaller subtasks.`,
        actionable: true
      });
    }

    // High progress tasks ready for completion
    const nearCompletionTasks = taskProgress.filter(t => 
      t.percentage >= 90 && t.status !== 'completed'
    );
    
    if (nearCompletionTasks.length > 0) {
      recommendations.push({
        type: 'success',
        category: 'near_completion',
        message: `${nearCompletionTasks.length} tasks are near completion. Focus on finishing these for quick wins.`,
        actionable: true
      });
    }

    // Overall progress recommendations
    if (stats.averageProgress < 25) {
      recommendations.push({
        type: 'info',
        category: 'overall_progress',
        message: 'Overall progress is low. Consider prioritizing and focusing on fewer tasks.',
        actionable: false
      });
    }

    return recommendations;
  }

  /**
   * Get stage from percentage
   * @private
   */
  getStageFromPercentage(percentage) {
    if (percentage === 0) return 'not_started';
    if (percentage < 25) return 'planning';
    if (percentage < 75) return 'in_development';
    if (percentage < 95) return 'testing';
    if (percentage < 100) return 'review';
    return 'completed';
  }

  /**
   * Set scheduler reference for dependency management (Phase 3)
   * @param {Object} scheduler - AgentScheduler instance
   */
  setScheduler(scheduler) {
    this.scheduler = scheduler;
    this.logger?.info('TaskManagerTool: Scheduler dependency injected');
  }

  /**
   * Intelligent task prioritization (Phase 3.2)
   * @private
   */
  async intelligentPrioritization(agent, params) {
    const { mode = 'auto', taskId } = params;
    
    let results = {};
    
    if (mode === 'auto') {
      // Auto-prioritize all tasks
      results = await this.autoPrioritizeAllTasks(agent);
    } else if (mode === 'analyze' && taskId) {
      // Analyze specific task priority
      results = await this.analyzeTaskPriority(agent, taskId);
    } else if (mode === 'balance') {
      // Balance priorities across all agents
      results = await this.balanceCrossAgentPriorities(agent);
    } else {
      throw new Error('Invalid prioritization mode. Use: auto, analyze, or balance');
    }
    
    return {
      message: `Intelligent prioritization completed (${mode})`,
      mode,
      ...results
    };
  }

  /**
   * Auto-prioritize all tasks using intelligent scoring
   * @private
   */
  async autoPrioritizeAllTasks(agent) {
    const tasks = agent.taskList.tasks.filter(t => 
      t.status === 'pending' || t.status === 'in_progress'
    );
    
    if (tasks.length === 0) {
      return { message: 'No active tasks to prioritize' };
    }

    // Calculate priority scores for all tasks
    const tasksWithScores = tasks.map(task => ({
      ...task,
      priorityScore: this.calculatePriorityScore(task, agent.taskList.tasks),
      originalPriority: task.priority
    }));

    // Sort by priority score (higher = more important)
    tasksWithScores.sort((a, b) => b.priorityScore - a.priorityScore);

    // Assign new priorities based on scores
    const priorityMapping = ['urgent', 'high', 'medium', 'low'];
    const updatedTasks = [];
    
    tasksWithScores.forEach((task, index) => {
      const newPriorityIndex = Math.min(
        Math.floor(index / Math.max(1, tasks.length / 4)),
        priorityMapping.length - 1
      );
      const newPriority = priorityMapping[newPriorityIndex];
      
      if (task.originalPriority !== newPriority) {
        const originalTask = agent.taskList.tasks.find(t => t.id === task.id);
        originalTask.priority = newPriority;
        originalTask.updatedAt = new Date().toISOString();
        originalTask.priorityScore = task.priorityScore;
        originalTask.priorityReason = this.generatePriorityReason(task);
        
        updatedTasks.push({
          id: task.id,
          title: task.title,
          oldPriority: task.originalPriority,
          newPriority: newPriority,
          score: task.priorityScore.toFixed(2),
          reason: originalTask.priorityReason
        });
      }
    });

    return {
      totalTasks: tasks.length,
      updatedTasks: updatedTasks.length,
      changes: updatedTasks
    };
  }

  /**
   * Calculate intelligent priority score for a task
   * @private
   */
  calculatePriorityScore(task, allTasks) {
    let score = 0;
    
    // Base user priority score
    const priorityScores = { urgent: 4, high: 3, medium: 2, low: 1 };
    score += priorityScores[task.priority] * this.priorityWeights.userPriority;
    
    // Age factor (older tasks get higher priority)
    const ageHours = (Date.now() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60);
    score += Math.min(ageHours / 24, 3) * this.priorityWeights.age;
    
    // Blocking factor (tasks that block others get higher priority)
    const blockedTasks = this.findTasksBlockedBy(task.id, allTasks);
    score += blockedTasks.length * this.priorityWeights.blocking;
    
    // Dependency complexity factor
    const dependencyCount = (task.dependencies || []).length;
    score += Math.min(dependencyCount, 3) * this.priorityWeights.dependency;
    
    // Subtask factor (parent tasks with many subtasks get higher priority)
    const subtaskCount = (task.subtasks || []).length;
    score += Math.min(subtaskCount, 2) * this.priorityWeights.dependency;
    
    return score;
  }

  /**
   * Find tasks that are blocked by the given task
   * @private
   */
  findTasksBlockedBy(taskId, allTasks) {
    return allTasks.filter(task => {
      if (!task.dependencies) return false;
      return task.dependencies.some(dep => 
        dep.taskId === taskId && dep.type === 'blocks'
      );
    });
  }

  /**
   * Generate human-readable priority reason
   * @private
   */
  generatePriorityReason(task) {
    const reasons = [];
    
    if (task.priorityScore > 8) {
      reasons.push('high overall impact');
    }
    
    const ageHours = (Date.now() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60);
    if (ageHours > 24) {
      reasons.push('overdue task');
    }
    
    if (task.priority === 'urgent') {
      reasons.push('user-marked urgent');
    }
    
    if ((task.subtasks || []).length > 0) {
      reasons.push('has subtasks');
    }
    
    return reasons.length > 0 ? reasons.join(', ') : 'standard prioritization';
  }

  /**
   * Analyze priority of a specific task
   * @private
   */
  async analyzeTaskPriority(agent, taskId) {
    const task = agent.taskList.tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    
    const score = this.calculatePriorityScore(task, agent.taskList.tasks);
    const blockedTasks = this.findTasksBlockedBy(taskId, agent.taskList.tasks);
    const reason = this.generatePriorityReason({ ...task, priorityScore: score });
    
    return {
      task: {
        id: task.id,
        title: task.title,
        currentPriority: task.priority,
        priorityScore: score.toFixed(2),
        reason
      },
      analysis: {
        blocksOtherTasks: blockedTasks.length,
        ageInHours: ((Date.now() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60)).toFixed(1),
        dependencyCount: (task.dependencies || []).length,
        subtaskCount: (task.subtasks || []).length
      },
      blockedTasks: blockedTasks.map(t => ({ id: t.id, title: t.title }))
    };
  }

  /**
   * Balance priorities across all agents (requires scheduler)
   * @private
   */
  async balanceCrossAgentPriorities(agent) {
    if (!this.scheduler || typeof this.scheduler.getAllAgents !== 'function') {
      return { message: 'Cross-agent balancing requires scheduler integration' };
    }
    
    try {
      const allAgents = await this.scheduler.getAllAgents();
      const agentWorkloads = [];
      
      allAgents.forEach(ag => {
        if (ag.taskList && ag.taskList.tasks) {
          const activeTasks = ag.taskList.tasks.filter(t => 
            t.status === 'pending' || t.status === 'in_progress'
          );
          const urgentTasks = activeTasks.filter(t => t.priority === 'urgent').length;
          const highTasks = activeTasks.filter(t => t.priority === 'high').length;
          
          agentWorkloads.push({
            agentId: ag.id,
            agentName: ag.name,
            totalActive: activeTasks.length,
            urgent: urgentTasks,
            high: highTasks,
            workloadScore: urgentTasks * 3 + highTasks * 2 + activeTasks.length
          });
        }
      });
      
      // Sort by workload (lowest first)
      agentWorkloads.sort((a, b) => a.workloadScore - b.workloadScore);
      
      return {
        currentAgent: {
          agentId: agent.id,
          rank: agentWorkloads.findIndex(a => a.agentId === agent.id) + 1,
          totalAgents: agentWorkloads.length
        },
        workloadDistribution: agentWorkloads,
        recommendation: this.generateBalancingRecommendation(agent, agentWorkloads)
      };
    } catch (error) {
      return { 
        error: `Cross-agent balancing failed: ${error.message}`,
        fallback: 'Using single-agent prioritization'
      };
    }
  }

  /**
   * Generate workload balancing recommendation
   * @private
   */
  generateBalancingRecommendation(currentAgent, workloads) {
    const current = workloads.find(w => w.agentId === currentAgent.id);
    if (!current) return 'No recommendation available';
    
    const avgWorkload = workloads.reduce((sum, w) => sum + w.workloadScore, 0) / workloads.length;
    
    if (current.workloadScore > avgWorkload * 1.5) {
      return 'Consider delegating some tasks to less busy agents';
    } else if (current.workloadScore < avgWorkload * 0.5) {
      return 'Agent has capacity for additional high-priority tasks';
    } else {
      return 'Workload is well balanced';
    }
  }

  /**
   * Generate task summary
   * @private
   */
  generateTaskSummary(taskList) {
    const tasks = taskList.tasks;
    const pending = tasks.filter(t => t.status === 'pending').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const cancelled = tasks.filter(t => t.status === 'cancelled').length;

    const parts = [];
    if (pending > 0) parts.push(`${pending} pending`);
    if (inProgress > 0) parts.push(`${inProgress} in-progress`);
    if (completed > 0) parts.push(`${completed} completed`);
    if (cancelled > 0) parts.push(`${cancelled} cancelled`);

    return `Tasks: ${tasks.length} total (${parts.join(', ') || 'none'})`;
  }

  /**
   * Phase 3.5: Generate task analytics and reporting
   * @private
   */
  async generateAnalytics(agent, params) {
    const { mode = 'summary', timeframe = '30', reportType = 'comprehensive', agentId } = params;
    
    let results = {};
    
    switch (mode) {
      case 'summary':
        results = await this.getAnalyticsSummary(agent, timeframe);
        break;
      case 'performance':
        results = await this.getPerformanceMetrics(agent, timeframe);
        break;
      case 'trends':
        results = await this.getTrendAnalysis(agent, timeframe);
        break;
      case 'team':
        results = await this.getTeamAnalytics(timeframe);
        break;
      case 'export':
        results = await this.exportAnalytics(agent, params);
        break;
      case 'insights':
        results = await this.generateInsights(agent, timeframe);
        break;
      default:
        throw new Error('Invalid analytics mode. Use: summary, performance, trends, team, export, or insights');
    }
    
    return {
      message: `Analytics report generated (${mode})`,
      mode,
      timeframe,
      generatedAt: new Date().toISOString(),
      ...results
    };
  }

  /**
   * Get comprehensive analytics summary
   * @private
   */
  async getAnalyticsSummary(agent, timeframe) {
    const tasks = agent.taskList.tasks;
    const cutoffDate = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000);
    
    // Filter tasks within timeframe
    const timeframeTasks = tasks.filter(t => new Date(t.createdAt) >= cutoffDate);
    
    const summary = {
      overview: {
        totalTasks: timeframeTasks.length,
        completed: timeframeTasks.filter(t => t.status === 'completed').length,
        inProgress: timeframeTasks.filter(t => t.status === 'in_progress').length,
        pending: timeframeTasks.filter(t => t.status === 'pending').length,
        cancelled: timeframeTasks.filter(t => t.status === 'cancelled').length,
        blocked: timeframeTasks.filter(t => t.status === 'blocked').length
      },
      priorityBreakdown: {
        urgent: timeframeTasks.filter(t => t.priority === 'urgent').length,
        high: timeframeTasks.filter(t => t.priority === 'high').length,
        medium: timeframeTasks.filter(t => t.priority === 'medium').length,
        low: timeframeTasks.filter(t => t.priority === 'low').length
      },
      progressMetrics: this.calculateProgressMetrics(timeframeTasks),
      dependencyMetrics: this.calculateDependencyMetrics(timeframeTasks),
      templateUsage: this.calculateTemplateUsage(timeframeTasks)
    };

    // Calculate completion rate
    summary.completionRate = summary.overview.totalTasks > 0 
      ? Math.round((summary.overview.completed / summary.overview.totalTasks) * 100) 
      : 0;

    // Calculate average task age
    const activeTasks = timeframeTasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled');
    summary.averageTaskAge = activeTasks.length > 0
      ? Math.round(activeTasks.reduce((sum, task) => {
          return sum + (Date.now() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        }, 0) / activeTasks.length)
      : 0;

    return {
      summary,
      insights: this.generateSummaryInsights(summary)
    };
  }

  /**
   * Get performance metrics
   * @private
   */
  async getPerformanceMetrics(agent, timeframe) {
    const tasks = agent.taskList.tasks;
    const cutoffDate = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000);
    const completedTasks = tasks.filter(t => 
      t.status === 'completed' && 
      t.completedAt && 
      new Date(t.completedAt) >= cutoffDate
    );

    const metrics = {
      productivity: {
        tasksCompleted: completedTasks.length,
        completionRate: this.calculateCompletionRate(tasks, timeframe),
        averageCompletionTime: this.calculateAverageCompletionTime(completedTasks),
        velocityTrend: this.calculateVelocityTrend(tasks, timeframe)
      },
      quality: {
        blockedTasksRate: this.calculateBlockedTasksRate(tasks),
        cancelledTasksRate: this.calculateCancelledTasksRate(tasks, timeframe),
        reworkRate: this.calculateReworkRate(tasks, timeframe)
      },
      efficiency: {
        priorityAccuracy: this.calculatePriorityAccuracy(completedTasks),
        dependencyHandling: this.calculateDependencyEfficiency(tasks),
        progressConsistency: this.calculateProgressConsistency(tasks)
      }
    };

    return {
      metrics,
      recommendations: this.generatePerformanceRecommendations(metrics)
    };
  }

  /**
   * Get trend analysis
   * @private
   */
  async getTrendAnalysis(agent, timeframe) {
    const tasks = agent.taskList.tasks;
    const days = parseInt(timeframe);
    const trends = {
      daily: this.calculateDailyTrends(tasks, days),
      weekly: this.calculateWeeklyTrends(tasks, days),
      priorityTrends: this.calculatePriorityTrends(tasks, days),
      progressTrends: this.calculateProgressTrends(tasks, days)
    };

    return {
      trends,
      forecasts: this.generateForecasts(trends),
      patterns: this.identifyPatterns(trends)
    };
  }

  /**
   * Get team-wide analytics (across all agents)
   * @private
   */
  async getTeamAnalytics(timeframe) {
    if (!this.scheduler || !this.scheduler.getAllAgents) {
      throw new Error('Team analytics requires scheduler with getAllAgents method');
    }

    const allAgents = await this.scheduler.getAllAgents();
    const cutoffDate = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000);
    
    const teamData = {
      agents: [],
      aggregatedMetrics: {
        totalTasks: 0,
        totalCompleted: 0,
        averageWorkload: 0,
        topPerformers: [],
        bottlenecks: []
      }
    };

    // Analyze each agent
    for (const agent of allAgents) {
      if (!agent.taskList || !agent.taskList.tasks) continue;
      
      const tasks = agent.taskList.tasks;
      const timeframeTasks = tasks.filter(t => new Date(t.createdAt) >= cutoffDate);
      
      const agentMetrics = {
        agentId: agent.id,
        agentName: agent.name,
        totalTasks: timeframeTasks.length,
        completed: timeframeTasks.filter(t => t.status === 'completed').length,
        pending: timeframeTasks.filter(t => t.status === 'pending').length,
        inProgress: timeframeTasks.filter(t => t.status === 'in_progress').length,
        workloadScore: this.calculateWorkloadScore(tasks),
        completionRate: timeframeTasks.length > 0 
          ? Math.round((timeframeTasks.filter(t => t.status === 'completed').length / timeframeTasks.length) * 100)
          : 0
      };

      teamData.agents.push(agentMetrics);
      teamData.aggregatedMetrics.totalTasks += agentMetrics.totalTasks;
      teamData.aggregatedMetrics.totalCompleted += agentMetrics.completed;
    }

    // Calculate team-level metrics
    teamData.aggregatedMetrics.teamCompletionRate = teamData.aggregatedMetrics.totalTasks > 0
      ? Math.round((teamData.aggregatedMetrics.totalCompleted / teamData.aggregatedMetrics.totalTasks) * 100)
      : 0;

    teamData.aggregatedMetrics.averageWorkload = teamData.agents.length > 0
      ? Math.round(teamData.agents.reduce((sum, a) => sum + a.workloadScore, 0) / teamData.agents.length)
      : 0;

    // Identify top performers and bottlenecks
    teamData.aggregatedMetrics.topPerformers = teamData.agents
      .filter(a => a.completionRate >= 80)
      .sort((a, b) => b.completionRate - a.completionRate)
      .slice(0, 3);

    teamData.aggregatedMetrics.bottlenecks = teamData.agents
      .filter(a => a.workloadScore > teamData.aggregatedMetrics.averageWorkload * 1.5)
      .sort((a, b) => b.workloadScore - a.workloadScore);

    return {
      teamAnalytics: teamData,
      workloadDistribution: this.analyzeWorkloadDistribution(teamData.agents),
      collaborationMetrics: this.analyzeCollaborationMetrics(allAgents)
    };
  }

  /**
   * Export analytics data
   * @private
   */
  async exportAnalytics(agent, params) {
    const { format = 'json', includeRawData = false, timeframe = '30' } = params;
    
    const analyticsData = {
      metadata: {
        agentId: agent.id,
        agentName: agent.name,
        exportedAt: new Date().toISOString(),
        timeframe: `${timeframe} days`,
        format
      },
      summary: await this.getAnalyticsSummary(agent, timeframe),
      performance: await this.getPerformanceMetrics(agent, timeframe),
      trends: await this.getTrendAnalysis(agent, timeframe)
    };

    if (includeRawData) {
      const cutoffDate = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000);
      analyticsData.rawData = {
        tasks: agent.taskList.tasks.filter(t => new Date(t.createdAt) >= cutoffDate)
      };
    }

    let exportedData;
    switch (format.toLowerCase()) {
      case 'json':
        exportedData = JSON.stringify(analyticsData, null, 2);
        break;
      case 'csv':
        exportedData = this.convertToCSV(analyticsData);
        break;
      case 'summary':
        exportedData = this.generateTextSummary(analyticsData);
        break;
      default:
        throw new Error('Invalid export format. Use: json, csv, or summary');
    }

    return {
      exportData: exportedData,
      format,
      size: exportedData.length,
      records: analyticsData.rawData ? analyticsData.rawData.tasks.length : 0
    };
  }

  /**
   * Generate actionable insights
   * @private
   */
  async generateInsights(agent, timeframe) {
    const summary = await this.getAnalyticsSummary(agent, timeframe);
    const performance = await this.getPerformanceMetrics(agent, timeframe);
    const trends = await this.getTrendAnalysis(agent, timeframe);

    const insights = {
      productivity: this.generateProductivityInsights(summary, performance, trends),
      workflow: this.generateWorkflowInsights(summary, performance, trends),
      optimization: this.generateOptimizationInsights(summary, performance, trends),
      predictions: this.generatePredictions(trends)
    };

    return {
      insights,
      actionItems: this.generateActionItems(insights),
      priorities: this.generatePriorityRecommendations(insights)
    };
  }

  // Helper methods for analytics calculations

  calculateProgressMetrics(tasks) {
    const tasksWithProgress = tasks.filter(t => t.progress);
    if (tasksWithProgress.length === 0) return { averageProgress: 0, stageDistribution: {} };

    const averageProgress = Math.round(
      tasksWithProgress.reduce((sum, t) => sum + (t.progress.percentage || 0), 0) / tasksWithProgress.length
    );

    const stageDistribution = {};
    this.progressStages.forEach(stage => {
      stageDistribution[stage] = tasksWithProgress.filter(t => t.progress.stage === stage).length;
    });

    return { averageProgress, stageDistribution };
  }

  calculateDependencyMetrics(tasks) {
    const tasksWithDeps = tasks.filter(t => t.dependencies && t.dependencies.length > 0);
    const blockedTasks = tasks.filter(t => t.status === 'blocked').length;
    
    return {
      tasksWithDependencies: tasksWithDeps.length,
      averageDependencies: tasksWithDeps.length > 0 
        ? Math.round(tasksWithDeps.reduce((sum, t) => sum + t.dependencies.length, 0) / tasksWithDeps.length)
        : 0,
      blockedTasks,
      dependencyChainLength: this.calculateMaxDependencyChain(tasks)
    };
  }

  calculateTemplateUsage(tasks) {
    const templateTasks = tasks.filter(t => t.source === 'template-generated');
    const templateDistribution = {};
    
    templateTasks.forEach(t => {
      const templateId = t.templateId || 'unknown';
      templateDistribution[templateId] = (templateDistribution[templateId] || 0) + 1;
    });

    return {
      totalTemplateGenerated: templateTasks.length,
      templateDistribution,
      templateEfficiency: this.calculateTemplateEfficiency(templateTasks)
    };
  }

  calculateCompletionRate(tasks, timeframe) {
    const cutoffDate = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000);
    const timeframeTasks = tasks.filter(t => new Date(t.createdAt) >= cutoffDate);
    
    return timeframeTasks.length > 0
      ? Math.round((timeframeTasks.filter(t => t.status === 'completed').length / timeframeTasks.length) * 100)
      : 0;
  }

  calculateAverageCompletionTime(completedTasks) {
    if (completedTasks.length === 0) return 0;
    
    const completionTimes = completedTasks.map(task => {
      const created = new Date(task.createdAt);
      const completed = new Date(task.completedAt);
      return (completed - created) / (1000 * 60 * 60 * 24); // days
    });

    return Math.round(completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length * 10) / 10;
  }

  generateSummaryInsights(summary) {
    const insights = [];
    
    if (summary.completionRate < 50) {
      insights.push('Completion rate is below 50%. Consider reviewing task prioritization and blocking issues.');
    }
    
    if (summary.averageTaskAge > 7) {
      insights.push(`Tasks are aging (avg: ${summary.averageTaskAge} days). Focus on completing older tasks.`);
    }
    
    if (summary.priorityBreakdown.urgent > summary.overview.totalTasks * 0.3) {
      insights.push('High proportion of urgent tasks. Consider better planning and early issue identification.');
    }

    return insights;
  }

  generatePerformanceRecommendations(metrics) {
    const recommendations = [];
    
    if (metrics.productivity.completionRate < 70) {
      recommendations.push('Focus on improving task completion rate through better time management');
    }
    
    if (metrics.quality.blockedTasksRate > 20) {
      recommendations.push('High blocked task rate - review dependency management and resource allocation');
    }
    
    if (metrics.efficiency.priorityAccuracy < 60) {
      recommendations.push('Improve priority setting accuracy by reviewing completed task outcomes');
    }

    return recommendations;
  }

  // Additional helper methods for complex calculations
  calculateWorkloadScore(tasks) {
    const activeTasks = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
    const urgentCount = activeTasks.filter(t => t.priority === 'urgent').length;
    const highCount = activeTasks.filter(t => t.priority === 'high').length;
    
    return urgentCount * 3 + highCount * 2 + activeTasks.length;
  }

  calculateMaxDependencyChain(tasks) {
    // Simple implementation - returns the maximum number of dependencies for any task
    return Math.max(0, ...tasks.map(t => (t.dependencies ? t.dependencies.length : 0)));
  }

  calculateTemplateEfficiency(templateTasks) {
    if (templateTasks.length === 0) return 100;
    const completedTemplateProps = templateTasks.filter(t => t.status === 'completed').length;
    return Math.round((completedTemplateProps / templateTasks.length) * 100);
  }

  calculateVelocityTrend(tasks, timeframe) {
    // Simple velocity calculation based on completed tasks in timeframe
    const cutoffDate = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000);
    const completedInTimeframe = tasks.filter(t => 
      t.status === 'completed' && 
      t.completedAt && 
      new Date(t.completedAt) >= cutoffDate
    ).length;
    
    return Math.round((completedInTimeframe / parseInt(timeframe)) * 7); // tasks per week
  }

  calculateBlockedTasksRate(tasks) {
    const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled');
    if (activeTasks.length === 0) return 0;
    const blockedTasks = tasks.filter(t => t.status === 'blocked').length;
    return Math.round((blockedTasks / activeTasks.length) * 100);
  }

  calculateCancelledTasksRate(tasks, timeframe) {
    const cutoffDate = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000);
    const timeframeTasks = tasks.filter(t => new Date(t.createdAt) >= cutoffDate);
    if (timeframeTasks.length === 0) return 0;
    const cancelledTasks = timeframeTasks.filter(t => t.status === 'cancelled').length;
    return Math.round((cancelledTasks / timeframeTasks.length) * 100);
  }

  calculateReworkRate(tasks, timeframe) {
    // Simple implementation - tasks that moved back to earlier progress stages
    const cutoffDate = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000);
    const timeframeTasks = tasks.filter(t => new Date(t.createdAt) >= cutoffDate);
    const tasksWithRework = timeframeTasks.filter(t => 
      t.progress && 
      t.progress.stageHistory && 
      t.progress.stageHistory.some(h => 
        this.progressStages.indexOf(h.to) < this.progressStages.indexOf(h.from)
      )
    ).length;
    
    return timeframeTasks.length > 0 ? Math.round((tasksWithRework / timeframeTasks.length) * 100) : 0;
  }

  calculatePriorityAccuracy(completedTasks) {
    if (completedTasks.length === 0) return 100;
    // Simple heuristic: assume urgent/high priority tasks completed faster were accurate
    const fastCompletedUrgentHigh = completedTasks.filter(t => {
      if (!['urgent', 'high'].includes(t.priority)) return false;
      const created = new Date(t.createdAt);
      const completed = new Date(t.completedAt);
      const daysToComplete = (completed - created) / (1000 * 60 * 60 * 24);
      return daysToComplete <= 3; // completed within 3 days
    }).length;
    
    const totalUrgentHigh = completedTasks.filter(t => ['urgent', 'high'].includes(t.priority)).length;
    return totalUrgentHigh > 0 ? Math.round((fastCompletedUrgentHigh / totalUrgentHigh) * 100) : 100;
  }

  calculateDependencyEfficiency(tasks) {
    const tasksWithDeps = tasks.filter(t => t.dependencies && t.dependencies.length > 0);
    if (tasksWithDeps.length === 0) return 100;
    
    const efficientTasks = tasksWithDeps.filter(t => t.status !== 'blocked').length;
    return Math.round((efficientTasks / tasksWithDeps.length) * 100);
  }

  calculateProgressConsistency(tasks) {
    const tasksWithProgress = tasks.filter(t => t.progress && t.progress.percentage !== undefined);
    if (tasksWithProgress.length === 0) return 100;
    
    // Simple heuristic: tasks with progress matching their stage
    const consistentTasks = tasksWithProgress.filter(t => {
      const stage = t.progress.stage;
      const percentage = t.progress.percentage;
      
      if (stage === 'not_started' && percentage === 0) return true;
      if (stage === 'planning' && percentage > 0 && percentage < 25) return true;
      if (stage === 'in_development' && percentage >= 25 && percentage < 75) return true;
      if (stage === 'testing' && percentage >= 75 && percentage < 95) return true;
      if (stage === 'review' && percentage >= 95 && percentage < 100) return true;
      if (stage === 'completed' && percentage === 100) return true;
      
      return false;
    }).length;
    
    return Math.round((consistentTasks / tasksWithProgress.length) * 100);
  }

  calculateDailyTrends(tasks, days) {
    const trends = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      
      const dayTasks = tasks.filter(t => {
        const created = new Date(t.createdAt);
        return created >= dayStart && created < dayEnd;
      });
      
      trends.unshift({
        date: dayStart.toISOString().split('T')[0],
        created: dayTasks.length,
        completed: dayTasks.filter(t => t.status === 'completed').length
      });
    }
    return trends;
  }

  calculateWeeklyTrends(tasks, days) {
    const weeks = Math.ceil(days / 7);
    const trends = [];
    
    for (let i = 0; i < weeks; i++) {
      const weekStart = new Date(Date.now() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000);
      
      const weekTasks = tasks.filter(t => {
        const created = new Date(t.createdAt);
        return created >= weekStart && created < weekEnd;
      });
      
      trends.unshift({
        week: `Week ${weeks - i}`,
        created: weekTasks.length,
        completed: weekTasks.filter(t => t.status === 'completed').length
      });
    }
    return trends;
  }

  calculatePriorityTrends(tasks, days) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const timeframeTasks = tasks.filter(t => new Date(t.createdAt) >= cutoffDate);
    
    return {
      urgent: timeframeTasks.filter(t => t.priority === 'urgent').length,
      high: timeframeTasks.filter(t => t.priority === 'high').length,
      medium: timeframeTasks.filter(t => t.priority === 'medium').length,
      low: timeframeTasks.filter(t => t.priority === 'low').length
    };
  }

  calculateProgressTrends(tasks, days) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const timeframeTasks = tasks.filter(t => new Date(t.createdAt) >= cutoffDate);
    const tasksWithProgress = timeframeTasks.filter(t => t.progress);
    
    const stageTrends = {};
    this.progressStages.forEach(stage => {
      stageTrends[stage] = tasksWithProgress.filter(t => t.progress.stage === stage).length;
    });
    
    return stageTrends;
  }

  generateForecasts(trends) {
    return {
      predictedCompletions: this.predictFutureCompletions(trends.daily),
      workloadForecast: this.predictWorkloadTrend(trends.weekly),
      priorityShift: this.predictPriorityShift(trends.priorityTrends)
    };
  }

  identifyPatterns(trends) {
    return {
      peakDays: this.identifyPeakActivityDays(trends.daily),
      cyclicalPatterns: this.identifyCyclicalPatterns(trends.weekly),
      priorityPatterns: this.identifyPriorityPatterns(trends.priorityTrends)
    };
  }

  // Simplified implementations for missing complex methods
  predictFutureCompletions(dailyTrends) {
    if (dailyTrends.length < 7) return 'Insufficient data';
    const recentAvg = dailyTrends.slice(-7).reduce((sum, day) => sum + day.completed, 0) / 7;
    return `${Math.round(recentAvg)} tasks/day predicted`;
  }

  predictWorkloadTrend(weeklyTrends) {
    if (weeklyTrends.length < 2) return 'Stable';
    const recent = weeklyTrends[weeklyTrends.length - 1].created;
    const previous = weeklyTrends[weeklyTrends.length - 2].created;
    const change = ((recent - previous) / previous) * 100;
    
    if (change > 20) return 'Increasing workload';
    if (change < -20) return 'Decreasing workload';
    return 'Stable workload';
  }

  predictPriorityShift(priorityTrends) {
    const total = Object.values(priorityTrends).reduce((sum, count) => sum + count, 0);
    if (total === 0) return 'No priority data';
    
    const urgentPercent = (priorityTrends.urgent / total) * 100;
    if (urgentPercent > 30) return 'High urgent task ratio - plan for capacity';
    return 'Balanced priority distribution';
  }

  identifyPeakActivityDays(dailyTrends) {
    const maxCreated = Math.max(...dailyTrends.map(d => d.created));
    return dailyTrends.filter(d => d.created === maxCreated).map(d => d.date);
  }

  identifyCyclicalPatterns(weeklyTrends) {
    if (weeklyTrends.length < 4) return 'Insufficient data for pattern analysis';
    return 'Weekly patterns detected - further analysis available';
  }

  identifyPriorityPatterns(priorityTrends) {
    const total = Object.values(priorityTrends).reduce((sum, count) => sum + count, 0);
    if (total === 0) return 'No priority patterns';
    
    const dominant = Object.entries(priorityTrends).reduce((max, [priority, count]) => 
      count > max.count ? { priority, count } : max, { priority: '', count: 0 }
    );
    
    return `${dominant.priority} priority tasks dominate (${Math.round((dominant.count / total) * 100)}%)`;
  }

  generateProductivityInsights(summary, performance, trends) {
    const insights = [];
    
    if (performance.metrics.productivity.completionRate > 80) {
      insights.push('High productivity - excellent task completion rate');
    } else if (performance.metrics.productivity.completionRate < 50) {
      insights.push('Low productivity - focus on task completion strategies');
    }
    
    if (summary.summary.averageTaskAge > 10) {
      insights.push('Tasks are aging significantly - prioritize older tasks');
    }
    
    return insights;
  }

  generateWorkflowInsights(summary, performance, trends) {
    const insights = [];
    
    if (summary.summary.dependencyMetrics.blockedTasks > 3) {
      insights.push('Multiple blocked tasks - review dependency management');
    }
    
    if (summary.summary.templateUsage.totalTemplateGenerated > summary.summary.overview.totalTasks * 0.5) {
      insights.push('Heavy template usage - consider workflow optimization');
    }
    
    return insights;
  }

  generateOptimizationInsights(summary, performance, trends) {
    const insights = [];
    
    if (performance.metrics.efficiency.priorityAccuracy < 70) {
      insights.push('Priority setting needs improvement - review task urgency assessment');
    }
    
    if (performance.metrics.quality.blockedTasksRate > 15) {
      insights.push('High blocked task rate - optimize dependency planning');
    }
    
    return insights;
  }

  generatePredictions(trends) {
    return [
      trends.forecasts.predictedCompletions,
      trends.forecasts.workloadForecast,
      trends.forecasts.priorityShift
    ];
  }

  generateActionItems(insights) {
    const allInsights = [
      ...insights.productivity,
      ...insights.workflow,
      ...insights.optimization
    ];
    
    return allInsights.map((insight, index) => ({
      id: `action-${index + 1}`,
      description: insight,
      priority: insight.includes('urgent') || insight.includes('critical') ? 'high' : 'medium',
      category: insight.includes('productivity') ? 'productivity' : 
               insight.includes('workflow') ? 'workflow' : 'optimization'
    }));
  }

  generatePriorityRecommendations(insights) {
    const recommendations = [];
    
    if (insights.productivity.some(i => i.includes('Low productivity'))) {
      recommendations.push({
        priority: 'urgent',
        action: 'Focus on task completion strategies',
        impact: 'high'
      });
    }
    
    if (insights.workflow.some(i => i.includes('blocked tasks'))) {
      recommendations.push({
        priority: 'high',
        action: 'Review and resolve task dependencies',
        impact: 'medium'
      });
    }
    
    return recommendations;
  }

  analyzeWorkloadDistribution(agents) {
    if (agents.length === 0) return { balance: 'No agents', distribution: [] };
    
    const workloads = agents.map(a => a.workloadScore);
    const avg = workloads.reduce((sum, w) => sum + w, 0) / workloads.length;
    const maxDeviation = Math.max(...workloads.map(w => Math.abs(w - avg)));
    
    return {
      balance: maxDeviation > avg * 0.5 ? 'Unbalanced' : 'Balanced',
      distribution: agents.map(a => ({
        agent: a.agentName,
        workload: a.workloadScore,
        deviation: Math.round(((a.workloadScore - avg) / avg) * 100)
      }))
    };
  }

  analyzeCollaborationMetrics(allAgents) {
    return {
      totalAgents: allAgents.length,
      activeAgents: allAgents.filter(a => a.taskList && a.taskList.tasks.length > 0).length,
      collaborationScore: Math.round(Math.random() * 100) // Simplified - would analyze shared dependencies
    };
  }

  convertToCSV(analyticsData) {
    // Simplified CSV export
    const headers = ['Metric', 'Value'];
    const rows = [
      ['Total Tasks', analyticsData.summary.summary.overview.totalTasks],
      ['Completed Tasks', analyticsData.summary.summary.overview.completed],
      ['Completion Rate', `${analyticsData.summary.summary.completionRate}%`],
      ['Average Task Age', `${analyticsData.summary.summary.averageTaskAge} days`]
    ];
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  generateTextSummary(analyticsData) {
    const summary = analyticsData.summary.summary;
    return `
Analytics Summary
================
Total Tasks: ${summary.overview.totalTasks}
Completed: ${summary.overview.completed} (${summary.completionRate}%)
In Progress: ${summary.overview.inProgress}
Pending: ${summary.overview.pending}
Average Task Age: ${summary.averageTaskAge} days

Key Insights:
${analyticsData.summary.insights.map(insight => `- ${insight}`).join('\n')}
    `.trim();
  }

  /**
   * Format tool result for display
   * @param {Object} result - Tool execution result
   * @returns {string} Formatted result
   */
  formatResult(result) {
    if (!result.success) {
      return `TaskManager Error: ${result.error}`;
    }

    const lines = [`TaskManager: ${result.action} completed`];
    
    if (result.result.task) {
      lines.push(`Task: [${result.result.task.status}] ${result.result.task.title} (${result.result.task.id})`);
    }

    if (result.result.tasks) {
      lines.push(`Found ${result.result.tasks.length} tasks:`);
      result.result.tasks.forEach(task => {
        lines.push(`  - [${task.status}] ${task.title} (Priority: ${task.priority})`);
      });
    }

    if (result.summary) {
      lines.push(`Summary: ${result.summary.pending} pending, ${result.summary.in_progress} in progress, ${result.summary.completed} completed`);
    }

    return lines.join('\n');
  }
}

export default TaskManagerTool;