/**
 * AgentActivityService - Centralized service for determining agent scheduler activity
 *
 * Purpose:
 * - Single source of truth for "should this agent be active in scheduler"
 * - Eliminates scattered add/remove logic across codebase
 * - Provides clear, testable activation conditions
 * - Returns detailed reasons for debugging
 *
 * Architecture:
 * - Pure functions that inspect agent state
 * - No side effects (doesn't modify agent state)
 * - Scheduler queries this service each cycle instead of managing events
 */

import {
  AGENT_MODES,
  AGENT_STATUS,
  AGENT_ACTIVITY_STATUS,
  TASK_STATUS
} from '../utilities/constants.js';

/**
 * Result of activity check
 * @typedef {Object} ActivityCheckResult
 * @property {boolean} active - Whether agent should be active in scheduler
 * @property {string} reason - Reason code from AGENT_ACTIVITY_STATUS
 * @property {string} [details] - Additional human-readable details
 */

/**
 * Check if an agent has pending or in-progress tasks
 * @param {Object} agent - Agent object
 * @returns {boolean} True if agent has work to do
 */
function hasPendingTasks(agent) {
  if (!agent.taskList || !agent.taskList.tasks || !Array.isArray(agent.taskList.tasks)) {
    return false;
  }

  return agent.taskList.tasks.some(task =>
    task.status === TASK_STATUS.PENDING || task.status === TASK_STATUS.IN_PROGRESS
  );
}

/**
 * Check if agent has queued messages of any type
 * @param {Object} agent - Agent object
 * @returns {{ hasMessages: boolean, counts: Object }} Message queue status
 */
function getMessageQueueStatus(agent) {
  const queues = agent.messageQueues || {};

  const counts = {
    toolResults: Array.isArray(queues.toolResults) ? queues.toolResults.length : 0,
    interAgentMessages: Array.isArray(queues.interAgentMessages) ? queues.interAgentMessages.length : 0,
    userMessages: Array.isArray(queues.userMessages) ? queues.userMessages.length : 0
  };

  counts.total = counts.toolResults + counts.interAgentMessages + counts.userMessages;

  return {
    hasMessages: counts.total > 0,
    hasUserMessages: counts.userMessages > 0,
    hasInterAgentMessages: counts.interAgentMessages > 0,
    hasToolResults: counts.toolResults > 0,
    counts
  };
}

/**
 * Check if agent is currently delayed
 * @param {Object} agent - Agent object
 * @returns {boolean} True if agent is delayed
 */
function isAgentDelayed(agent) {
  if (!agent.delayEndTime) {
    return false;
  }

  return new Date() < new Date(agent.delayEndTime);
}

/**
 * Check if agent is currently paused
 * @param {Object} agent - Agent object
 * @returns {boolean} True if agent is paused
 */
function isAgentPaused(agent) {
  // Check status-based pause
  if (agent.status === AGENT_STATUS.PAUSED) {
    // If pausedUntil is set, check if it's expired
    if (agent.pausedUntil) {
      return new Date() < new Date(agent.pausedUntil);
    }
    return true; // Paused indefinitely
  }

  // Check time-based pause
  if (agent.pausedUntil && new Date() < new Date(agent.pausedUntil)) {
    return true;
  }

  return false;
}

/**
 * Centralized function to determine if an agent should be active in the scheduler
 *
 * This function encapsulates ALL logic for determining agent activity status.
 * It inspects the agent's current state and returns a decision with reason.
 *
 * @param {Object} agent - Full agent object from AgentPool
 * @returns {ActivityCheckResult} Activity decision with reason
 */
export function shouldAgentBeActive(agent) {
  // 1. Basic existence check
  if (!agent) {
    return {
      active: false,
      reason: AGENT_ACTIVITY_STATUS.AGENT_NOT_FOUND,
      details: 'Agent object is null or undefined'
    };
  }

  // 2. Status check - agent must be active
  if (agent.status !== AGENT_STATUS.ACTIVE) {
    return {
      active: false,
      reason: AGENT_ACTIVITY_STATUS.AGENT_INACTIVE_STATUS,
      details: `Agent status is ${agent.status}, expected ${AGENT_STATUS.ACTIVE}`
    };
  }

  // Belt-and-suspenders: queued inbound work (user message, inter-agent
  // ping, tool result) overrides delay/pause. Inbound enqueue paths clear
  // delay/pause at arrival time via agentPool._wakeAgentForMessage, so in
  // the happy path a delayed agent never has queued messages. This guard
  // is a defensive second line: if anything bypasses the enqueue helpers
  // (persisted state loaded mid-delay, direct mutation in legacy code,
  // future paths) we still refuse to sideline an agent that has work to do.
  const _queueStatus = getMessageQueueStatus(agent);
  const _hasInboundWork = _queueStatus.hasUserMessages || _queueStatus.hasInterAgentMessages || _queueStatus.hasToolResults;

  // 3. Delay check
  if (isAgentDelayed(agent) && !_hasInboundWork) {
    return {
      active: false,
      reason: AGENT_ACTIVITY_STATUS.AGENT_DELAYED,
      details: `Agent delayed until ${agent.delayEndTime}`
    };
  }

  // 4. Pause check
  if (isAgentPaused(agent) && !_hasInboundWork) {
    return {
      active: false,
      reason: AGENT_ACTIVITY_STATUS.AGENT_PAUSED,
      details: agent.pausedUntil ? `Agent paused until ${agent.pausedUntil}` : 'Agent paused indefinitely'
    };
  }

  // 5. Awaiting user input check (credentials modal, user prompt, etc.)
  // Agent stays ACTIVE and visible to other agents, but scheduler skips it.
  if (agent.awaitingUserInput) {
    return {
      active: false,
      reason: AGENT_ACTIVITY_STATUS.AWAITING_USER_INPUT,
      details: `Agent awaiting user input: ${agent.awaitingUserInput.type || 'unknown'}`
    };
  }

  // 6. Stop request check
  if (agent.stopRequested) {
    return {
      active: false,
      reason: AGENT_ACTIVITY_STATUS.STOP_REQUESTED,
      details: 'Agent stop has been requested'
    };
  }

  // NOTE: JobDone clears the agent's task list but keeps agent in AGENT mode.
  // With no pending tasks, the agent becomes idle until new messages arrive
  // (which auto-create tasks in agentPool, re-activating the agent).
  // No need to check modeState — processingInProgress flag and
  // agentProcessingLocks in the scheduler prevent concurrent processing.

  // 7. TTL (Time-to-Live) override check
  // If agent has TTL remaining, keep it active for one more processing cycle
  // This allows agents to react after clearing tasks (e.g., call job-done or create new tasks)
  if (agent.ttl !== null && agent.ttl !== undefined && agent.ttl > 0) {
    return {
      active: true,
      reason: AGENT_ACTIVITY_STATUS.HAS_TTL_REMAINING,
      details: `Agent has ${agent.ttl} TTL cycle(s) remaining`
    };
  }

  // 8. Mode-specific logic

  if (agent.mode === AGENT_MODES.AGENT) {
    // AGENT mode: active only if has pending tasks.
    // New messages auto-create tasks at arrival time (in agentPool),
    // so pending tasks is the single source of truth for scheduling.
    if (hasPendingTasks(agent)) {
      return {
        active: true,
        reason: AGENT_ACTIVITY_STATUS.HAS_PENDING_TASKS,
        details: `Agent has pending/in-progress tasks`
      };
    }

    // AGENT mode with no pending tasks = idle, waiting for new work
    return {
      active: false,
      reason: AGENT_ACTIVITY_STATUS.NO_PENDING_WORK,
      details: 'AGENT mode agent has no pending tasks'
    };
  }

  if (agent.mode === AGENT_MODES.CHAT) {
    // CHAT mode: active ONLY if has user messages or inter-agent messages
    // Tool results alone should NOT keep CHAT agents active
    const queueStatus = getMessageQueueStatus(agent);

    if (queueStatus.hasUserMessages) {
      return {
        active: true,
        reason: AGENT_ACTIVITY_STATUS.HAS_USER_MESSAGES,
        details: `Agent has ${queueStatus.counts.userMessages} user message(s) to process`
      };
    }

    if (queueStatus.hasInterAgentMessages) {
      return {
        active: true,
        reason: AGENT_ACTIVITY_STATUS.HAS_INTER_AGENT_MESSAGES,
        details: `Agent has ${queueStatus.counts.interAgentMessages} inter-agent message(s) to process`
      };
    }

    // CHAT mode with no user/inter-agent messages
    return {
      active: false,
      reason: AGENT_ACTIVITY_STATUS.CHAT_MODE_NO_MESSAGES,
      details: queueStatus.hasToolResults
        ? `CHAT mode - has ${queueStatus.counts.toolResults} tool results but no new messages`
        : 'CHAT mode - no messages to process'
    };
  }

  // Unknown mode
  return {
    active: false,
    reason: AGENT_ACTIVITY_STATUS.UNKNOWN_MODE,
    details: `Unknown agent mode: ${agent.mode}`
  };
}

/**
 * Get all agents that should currently be active
 *
 * @param {Map|Array} agents - Collection of agents (Map from AgentPool.agents or Array)
 * @returns {Array<{ agentId: string, sessionId: string, reason: string, details: string }>}
 */
export function getActiveAgents(agents) {
  const agentArray = agents instanceof Map ? Array.from(agents.values()) : agents;

  return agentArray
    .map(agent => {
      const result = shouldAgentBeActive(agent);
      return {
        agent,
        agentId: agent.id,
        sessionId: agent.sessionId,
        ...result
      };
    })
    .filter(result => result.active);
}

/**
 * Get detailed activity status for all agents (for debugging/monitoring)
 *
 * @param {Map|Array} agents - Collection of agents
 * @returns {Array<Object>} Detailed status for each agent
 */
export function getAllAgentActivityStatus(agents) {
  const agentArray = agents instanceof Map ? Array.from(agents.values()) : agents;

  return agentArray.map(agent => {
    const result = shouldAgentBeActive(agent);
    const queueStatus = getMessageQueueStatus(agent);

    return {
      agentId: agent.id,
      agentName: agent.name,
      mode: agent.mode,
      status: agent.status,
      active: result.active,
      reason: result.reason,
      details: result.details,
      queueCounts: queueStatus.counts,
      hasPendingTasks: hasPendingTasks(agent),
      isDelayed: isAgentDelayed(agent),
      isPaused: isAgentPaused(agent),
      isExecutingTools: isExecutingTools(agent),
      awaitingUserInput: agent.awaitingUserInput || null,
      stopRequested: agent.stopRequested || false,
      delayEndTime: agent.delayEndTime || null,
      pausedUntil: agent.pausedUntil || null
    };
  });
}

/**
 * Check if agent is currently executing tools
 * @param {Object} agent - Agent object
 * @returns {boolean} True if tools are being executed
 */
function isExecutingTools(agent) {
  return agent.toolExecutionInProgress === true;
}

/**
 * Check if an agent should skip the current processing iteration
 * (but remain in the scheduler for future iterations)
 *
 * This is different from shouldAgentBeActive - an agent might be active
 * but should skip this particular iteration (e.g., still delayed but not removed)
 *
 * @param {Object} agent - Agent object
 * @returns {{ skip: boolean, reason: string }}
 */
export function shouldSkipIteration(agent) {
  if (!agent) {
    return { skip: true, reason: 'Agent not found' };
  }

  // Belt-and-suspenders: a queued inbound message is a stronger signal
  // than any delay/pause. Inbound enqueue paths (addUserMessage,
  // addInterAgentMessage, addToolResult) call agentPool._wakeAgentForMessage
  // to clear delay/pause *before* queueing — so in the happy path we never
  // reach this branch with a non-empty queue AND a live delay. But if
  // anything bypassed that (direct state mutation in tests, future code
  // paths, persisted state loaded mid-delay with pre-existing queue), we
  // still refuse to skip.
  const q = getMessageQueueStatus(agent);
  const hasInbound = q.hasUserMessages || q.hasInterAgentMessages || q.hasToolResults;

  // Skip if delayed (but don't remove - delay will expire)
  // This is also used for WebTool auto-delay to allow browser operations to complete
  if (isAgentDelayed(agent) && !hasInbound) {
    return { skip: true, reason: `Agent delayed until ${agent.delayEndTime}` };
  }

  // Skip if paused with expiration (but don't remove - pause will expire)
  if (agent.pausedUntil && new Date() < new Date(agent.pausedUntil) && !hasInbound) {
    return { skip: true, reason: `Agent paused until ${agent.pausedUntil}` };
  }

  return { skip: false, reason: null };
}

// Export helper functions for testing and direct use
export {
  hasPendingTasks,
  getMessageQueueStatus,
  isAgentDelayed,
  isAgentPaused,
  isExecutingTools,
};

export default {
  shouldAgentBeActive,
  getActiveAgents,
  getAllAgentActivityStatus,
  shouldSkipIteration,
  hasPendingTasks,
  getMessageQueueStatus,
  isAgentDelayed,
  isAgentPaused,
  isExecutingTools,
};
