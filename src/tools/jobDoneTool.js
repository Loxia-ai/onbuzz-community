/**
 * Job Done Tool - Signals task completion in autonomous mode
 * 
 * Purpose:
 * - Allow agents to explicitly signal when a task is complete
 * - Provide completion summary/reason
 * - Gracefully exit autonomous mode
 * - Return to chat mode (unless in locked mode)
 */

import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';

class JobDoneTool extends BaseTool {
  constructor() {
    super();
    this.id = 'jobdone';
    this.name = 'Job Done';
    this.description = 'Call this tool when you have successfully completed the assigned task, OR if you are stuck/unable to proceed after multiple failed attempts. Provide a summary of what was accomplished or what prevented completion. This will exit autonomous mode and return control to the user.';
    this.version = '1.0.0';
    this.capabilities = ['task-completion', 'mode-control'];
    this.requiresProject = false;
    this.async = false;
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
Job Done Tool: Signal task completion in autonomous mode and exit to chat mode.

USAGE:
\`\`\`json
{
  "toolId": "jobdone",
  "actions": [{
    "action": "complete",
    "summary": "Task completion summary",
    "success": true,
    "details": "Optional additional details"
  }]
}
\`\`\`

PARAMETERS:
- action: Always "complete"
- summary: Clear summary of what was accomplished OR what prevented completion (required)
- success: true if completed successfully, false if stuck/failed (default: true)
- details: Optional additional information about the task

EXAMPLES:

1. Successful completion:
\`\`\`json
{
  "toolId": "jobdone",
  "actions": [{
    "action": "complete",
    "summary": "Created 5 song files successfully with lyrics and melodies",
    "success": true
  }]
}
\`\`\`

2. Unable to proceed:
\`\`\`json
{
  "toolId": "jobdone",
  "actions": [{
    "action": "complete",
    "summary": "Unable to proceed: missing API credentials for the service",
    "success": false
  }]
}
\`\`\`

3. Partial completion:
\`\`\`json
{
  "toolId": "jobdone",
  "actions": [{
    "action": "complete",
    "summary": "Task partially complete: implemented 2 of 3 requested features",
    "success": false,
    "details": "The third feature requires additional dependencies not available"
  }]
}
\`\`\`

WHEN TO USE:
- Call when you have SUCCESSFULLY completed the assigned task
- Call if you are STUCK or UNABLE to proceed after multiple failed attempts
- This will immediately exit autonomous mode and return control to the user

IMPORTANT - COMPLETION TIMING: - Call this tool IMMEDIATELY when your task is complete, Multiple jobdone calls per conversation are EXPECTED and CORRECT - Each discrete task = one jobdone call If user requests additional work after jobdone: 1. That's a NEW task, Complete the new task then Call jobdone again
    `.trim();
  }

  /**
   * Parse parameters from tool command content
   * @param {string} content - Raw tool command content
   * @returns {Object} Parsed parameters object
   */
  parseParameters(content) {
    try {
      // For JobDoneTool, we expect the content to be structured with tags
      // or we can parse it as a simple completion message
      
      // Try to extract structured content first
      const summaryMatches = TagParser.extractContent(content, 'summary');
      const detailsMatches = TagParser.extractContent(content, 'details');
      const successMatches = TagParser.extractContent(content, 'success');
      
      let summary = '';
      let details = '';
      let success = true;
      
      if (summaryMatches.length > 0) {
        // Structured format with tags
        summary = summaryMatches[0].trim();
        details = detailsMatches.length > 0 ? detailsMatches[0].trim() : '';
        success = successMatches.length > 0 ? (successMatches[0].toLowerCase() !== 'false') : true;
      } else {
        // Fallback: use the entire content as summary
        summary = content.trim() || 'Task completed';
      }
      
      return {
        actions: [{
          action: 'complete',
          summary: summary,
          success: success,
          details: details || undefined
        }]
      };
      
    } catch (error) {
      // Fallback to simple parsing
      return {
        actions: [{
          action: 'complete',
          summary: content.trim() || 'Task completed',
          success: true
        }]
      };
    }
  }

  /**
   * Get tool schema for AI model
   * @returns {Object} Tool schema
   */
  getSchema() {
    return {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['complete'],
                description: 'Mark task as complete - always use "complete"'
              },
              summary: {
                type: 'string',
                description: 'Clear summary of what you accomplished OR what prevented completion (e.g., "Created 5 song files successfully", "Unable to proceed: missing API credentials", "Stuck after 3 failed compilation attempts")'
              },
              success: {
                type: 'boolean',
                default: true,
                description: 'Set to true if task completed successfully, false if stuck/failed or partial completion'
              },
              details: {
                type: 'string',
                description: 'Optional: Additional details about what was done, what failed, any files created, or next steps for the user'
              },
              outputs: {
                // v2 flows: when this agent is running inside a flow node
                // that declares typed outputs, populate this object with
                // each declared field. Runtime validation rejects missing
                // fields and triggers a retry — schema is permissive but
                // runtime is strict. The text below is what the LLM sees
                // alongside REQUIRED OUTPUTS in the system prompt; phrased
                // strongly so model defaults toward including it.
                type: 'object',
                description: 'REQUIRED when your system prompt contains a "REQUIRED OUTPUTS" section (i.e. you are in a flow). Provide a JSON object with one key per declared output field name, holding the value matching the declared type. Example: if REQUIRED OUTPUTS lists "draft (text), wordCount (number)", emit outputs: { "draft": "<full text>", "wordCount": 850 }. Omitting any required field causes the flow node to fail and retry. Outside of flows this field is ignored.',
                additionalProperties: true
              }
            },
            required: ['action', 'summary'],
            additionalProperties: false
          },
          minItems: 1,
          maxItems: 1
        }
      },
      required: ['actions'],
      additionalProperties: false
    };
  }

  /**
   * Execute job done action
   * @param {Object} parameters - Tool parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(parameters, context = {}) {
    try {
      const { actions } = parameters;
      
      if (!actions || !Array.isArray(actions) || actions.length === 0) {
        throw new Error('Actions array is required');
      }

      const action = actions[0];
      
      if (action.action !== 'complete') {
        throw new Error('Invalid action. Only "complete" is supported');
      }

      if (!action.summary) {
        throw new Error('Completion summary is required');
      }

      const agentId = context.agentId;

      // Phase 8: when this agent is running inside a flow node with
      // declared outputs, validate action.outputs against the contract
      // BEFORE signaling completion. Returning a tool error here gives
      // the model immediate feedback in its current response cycle —
      // it can re-call jobdone with the missing fields populated, no
      // executor round-trip, no conversation reset.
      //
      // Falls through (no validation) when not in a flow OR when the
      // node has no declared outputs — keeps non-flow uses untouched.
      let activeFlowContract = null;
      if (this.flowExecutor && agentId && typeof this.flowExecutor.getActiveContract === 'function') {
        activeFlowContract = this.flowExecutor.getActiveContract(agentId);
      }
      if (activeFlowContract) {
        const contract = activeFlowContract;
        if (contract && Array.isArray(contract.outputs) && contract.outputs.length > 0) {
          const provided = (action.outputs && typeof action.outputs === 'object') ? action.outputs : {};
          const missing = [];
          for (const decl of contract.outputs) {
            if (!decl || typeof decl.name !== 'string') continue;
            if (!(decl.name in provided) || provided[decl.name] === null || provided[decl.name] === undefined) {
              missing.push(decl);
            }
          }
          if (missing.length > 0) {
            const declList = contract.outputs
              .map(o => `  • ${o.name}: ${o.type}${o.description ? ` — ${o.description}` : ''}`).join('\n');
            const exampleEntries = contract.outputs.map(o => {
              let exVal = '<value>';
              if (o.example !== undefined && o.example !== null) {
                try { exVal = JSON.stringify(o.example); } catch {}
              } else {
                // Type-specific placeholders
                if (o.type === 'text')          exVal = '"<your text>"';
                else if (o.type === 'number')   exVal = '0';
                else if (o.type === 'boolean')  exVal = 'true';
                else if (o.type === 'json')     exVal = '{ "key": "value" }';
                else if (o.type === 'file')     exVal = '"/path/to/file"';
                else if (o.type === 'file[]')   exVal = '["/path/to/file"]';
                else if (o.type === 'list<text>') exVal = '["item 1", "item 2"]';
              }
              return `      "${o.name}": ${exVal}`;
            }).join(',\n');
            const errorMsg =
              `Cannot complete: missing required output field(s): ${missing.map(m => m.name).join(', ')}.

This step's flow node declares ALL of these outputs:
${declList}

Re-call jobdone with EVERY field above populated in the "outputs" object.
Use this exact shape (replace placeholder values with your real content):

{
  "toolId": "jobdone",
  "actions": [{
    "action": "complete",
    "summary": "<your summary>",
    "outputs": {
${exampleEntries}
    }
  }]
}

The flow CANNOT proceed until all required output fields are populated.`;

            this.logger?.info(`JobDone: Rejected — flow contract missing outputs`, {
              agentId,
              missing: missing.map(m => m.name),
              declared: contract.outputs.map(o => o.name),
            });

            return {
              success: false,
              error: errorMsg,
              output: errorMsg,
              taskComplete: false,
              flowContractViolation: true,
              missingOutputs: missing.map(m => m.name),
            };
          }
        }
      }

      let agent = null;
      let agentInfo = '';

      if (agentId && this.agentPool) {
        try {
          agent = await this.agentPool.getAgent(agentId);
          if (agent) {
            agentInfo = ` by agent "${agent.name}"`;
          }
        } catch (error) {
          // Ignore agent info errors
        }
      }

      // Check for pending/in-progress tasks
      const pendingTasks = agent?.taskList?.tasks?.filter(
        t => t.status === 'pending' || t.status === 'in_progress'
      ) || [];

      // If there are pending tasks and the agent claims success, reject.
      // The agent must clear/complete its task list first.
      // Exception: success=false means the agent is giving up (stuck/unable to proceed).
      //
      // Flow exception: when this agent is running inside a flow node, the
      // Phase 8 contract validation above is the authoritative gate. The
      // task list contains scheduler-poke artifacts (auto-created from
      // queued user messages) that aren't real "user-tracked work" — they
      // exist purely so the scheduler picks the agent up. Letting the
      // legacy pendingTasks check fire here would block legitimate
      // contract-correct job-done calls and force the agent into a
      // taskmanager dance for tasks the user never actually authored.
      if (pendingTasks.length > 0 && action.success !== false && !activeFlowContract) {
        const taskListStr = pendingTasks
          .map((t, i) => `${i + 1}. [${t.status}] ${t.title}`)
          .join('\n');

        this.logger?.info(`JobDone: Rejected - agent ${agentId} has ${pendingTasks.length} pending tasks`, {
          pendingTasks: pendingTasks.length
        });

        return {
          success: false,
          output: `Cannot mark job as done — you still have ${pendingTasks.length} pending task(s):\n${taskListStr}\n\nComplete or cancel all tasks before calling job-done, or call job-done with success=false if you are unable to proceed.`,
          taskComplete: false,
          pendingTasks: pendingTasks.length
        };
      }

      // Format completion message
      const isSuccessful = action.success !== false;
      const completionMessage = `${isSuccessful ? '✅' : '⚠️'} Task completed${agentInfo}${isSuccessful ? ' successfully' : ' with issues'}

**Summary:** ${action.summary}${action.details ? `

**Details:** ${action.details}` : ''}

*All tasks cleared. Agent remains in agent mode, ready for new work.*`;

      // Clear the task list — agent becomes idle with no pending work.
      // Scheduler condition: has pending tasks AND in agent mode.
      // New messages will auto-create tasks and reactivate the agent.
      if (agent) {
        try {
          const sessionId = agent.sessionId;
          const clearedTaskCount = agent.taskList?.tasks?.length || 0;

          if (agent.taskList) {
            agent.taskList.tasks = [];
            agent.taskList.lastUpdated = new Date().toISOString();
          }

          agent.autonomousWorkComplete = true;
          agent.lastCompletionSummary = action.summary;
          agent.lastCompletionDetails = action.details || null;
          await this.agentPool.persistAgentState(agentId);

          // Signal flow executor directly (if agent is running inside a flow).
          // v2: forward structured `outputs` bag verbatim — the executor
          // validates it against the node's declared contract.
          if (this.flowExecutor) {
            this.flowExecutor.notifyAgentCompletion(agentId, {
              summary: action.summary,
              details: action.details,
              success: isSuccessful,
              outputs: action.outputs
            });
          }

          this.logger?.info(`JobDone: Agent ${agentId} tasks cleared, staying in AGENT mode`, {
            clearedTaskCount,
            summary: action.summary,
            success: isSuccessful
          });

          if (this.webSocketManager && sessionId) {
            this.webSocketManager.broadcastToSession(sessionId, {
              type: 'agent_job_done',
              data: {
                agentId,
                mode: agent.mode,
                clearedTaskCount,
                reason: 'jobdone',
                timestamp: new Date().toISOString()
              }
            });
          }
        } catch (error) {
          this.logger?.warn(`JobDone: Failed to clear agent tasks`, { error: error.message });
        }
      }

      return {
        success: true,
        output: completionMessage,
        taskComplete: true,
        exitAutonomousMode: true,
        summary: action.summary,
        details: action.details || null,
        successfulCompletion: isSuccessful,
        metadata: {
          toolId: this.id,
          agentId: agentId || 'unknown',
          completedAt: new Date().toISOString(),
          action: action.action
        }
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        output: `Failed to mark task as complete: ${error.message}`,
        taskComplete: false
      };
    }
  }

  /**
   * Set AgentPool dependency for agent information
   * @param {AgentPool} agentPool - AgentPool instance
   */
  setAgentPool(agentPool) {
    this.agentPool = agentPool;
  }

  /**
   * Set WebSocketManager dependency for broadcasting mode changes
   * @param {WebSocketManager} webSocketManager - WebSocketManager instance
   */
  setWebSocketManager(webSocketManager) {
    this.webSocketManager = webSocketManager;
  }

  /**
   * Set FlowExecutor dependency for direct completion signaling
   * @param {FlowExecutor} flowExecutor - FlowExecutor instance
   */
  setFlowExecutor(flowExecutor) {
    this.flowExecutor = flowExecutor;
  }

  /**
   * Get tool capabilities
   * @returns {Object} Tool capabilities
   */
  getCapabilities() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      version: this.version,
      capabilities: this.capabilities,
      requiresProject: this.requiresProject,
      async: this.async,
      enabled: true,
      schema: this.getSchema()
    };
  }
}

export default JobDoneTool;