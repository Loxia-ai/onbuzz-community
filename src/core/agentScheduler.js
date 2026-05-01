/**
 * AgentScheduler - Manages cooperative execution of multiple agents
 *
 * Architecture:
 * - Uses centralized AgentActivityService to determine which agents should be active
 * - Iterates over active agents in round-robin fashion
 * - For each agent, processes queued messages (toolResults, interAgentMessages, userMessages) in arrival order
 * - Sends conversation history to AI service for completion
 * - Handles agent mode differences (CHAT vs AGENT)
 * - Respects agent delays set by agentDelay tool
 *
 * Key Change: Instead of managing add/remove events scattered across codebase,
 * the scheduler now queries AgentActivityService.getActiveAgents() each cycle
 * to determine which agents should be processed.
 */

import {
  AGENT_MODES,
  MESSAGE_ROLES,
  COMPACTION_CONFIG,
  COMPACTION_STATUS,
  COMPACTION_STRATEGIES,
  SCHEDULER_CONFIG,
  AGENT_ACTIVITY_STATUS,
  TASK_STATUS,
  TASK_PRIORITY_ORDER
} from '../utilities/constants.js';
import ContextInjectionService from '../services/contextInjectionService.js';
import FlowContextService from '../services/flowContextService.js';
import TokenCountingService from '../services/tokenCountingService.js';
import { render as renderModeTransitionReason } from '../utilities/modeTransitionReasons.js';
import ConversationCompactionService from '../services/conversationCompactionService.js';
import { getToolSchemasForAgent } from '../tools/openaiFunctionSchemas.js';
import {
  shouldAgentBeActive,
  getActiveAgents,
  shouldSkipIteration
} from '../services/agentActivityService.js';

class AgentScheduler {
  /**
   * Register the Discord service so the scheduler can ask whether a given
   * agent is currently bridged — drives conditional `<external>` prompt
   * injection per turn. Optional; unset if Discord isn't available.
   */
  setDiscordService(discordService) { this.discordService = discordService; }

  /** Same as {@link setDiscordService} but for Telegram. */
  setTelegramService(telegramService) { this.telegramService = telegramService; }

  constructor(agentPool, messageProcessor, aiService, logger, webSocketManager = null, modelRouterService = null, modelsService = null) {
    this.agentPool = agentPool;
    this.messageProcessor = messageProcessor;
    this.aiService = aiService;
    this.logger = logger;
    this.webSocketManager = webSocketManager;
    this.modelRouterService = modelRouterService;
    this.modelsService = modelsService;

    // Initialize ContextInjectionService for file attachments
    this.contextInjectionService = new ContextInjectionService({}, logger);

    // Initialize FlowContextService for flow execution context
    this.flowContextService = new FlowContextService({}, logger);

    // Initialize compactization services
    this.tokenCountingService = new TokenCountingService(logger, modelsService);
    this.compactionService = new ConversationCompactionService(
      this.tokenCountingService,
      aiService,
      logger
    );
    // Inject modelsService for runtime compaction model validation
    if (modelsService) {
      this.compactionService.setModelsService(modelsService);
    }

    // Compactization state tracking
    this.compactionInProgress = new Map(); // Map of agentId to compaction status

    // Scheduler state
    this.isRunning = false;
    this.agentSessionMap = new Map(); // Map of agentId to sessionId (for API key resolution)
    this.scheduleInterval = null;

    // Repetition detection - sliding window of recent state hashes per agent
    // Structure: Map<agentId, Array<{hash, timestamp}>>
    this.stateHashHistory = new Map();

    // Per-agent processing locks — prevent the same agent from being processed
    // concurrently across overlapping cycles. No global lock needed; each cycle
    // skips agents that are already in-flight from a previous cycle.
    this.agentProcessingLocks = new Map(); // Map of agentId to processing state

    // Round-robin fairness: tracks last cycle's launch order so agents that
    // were skipped due to concurrency cap get priority in the next cycle.
    this._lastLaunchedAgentIds = new Set();

    // Token limit error retry tracking - tracks failed attempts per agent
    // Structure: Map<agentId, { attempts: number, lastError: string, timestamp: Date }>
    this.tokenLimitRetryTracker = new Map();
    this.MAX_TOKEN_LIMIT_RETRIES = 2;

    // Consecutive messages without tool usage tracking (AGENT mode only)
    // Structure: Map<agentId, number> - count of consecutive messages without tools
    this.consecutiveNoToolMessages = new Map();

    // Visualizer telemetry — see GET /scheduler endpoint.
    // Ring buffer of recent cycle decisions + per-agent lock-acquire timestamps.
    // Not load-bearing; safe to disable by never reading. See _recordCycle().
    this._cycleHistory = [];         // newest last
    this._cycleCounter = 0;
    this._lockAcquiredAt = new Map(); // agentId -> Date when lock was acquired
    this._CYCLE_HISTORY_MAX = 200;

    // Per-agent mode-transition ring buffer. Every CHAT ↔ AGENT flip, internal
    // (user stop, AI timeout, empty-response stall, loop detection) or external
    // (UI toggle, programmatic update_agent), lands here with a timestamp and
    // a human-readable reason. The /scheduler visualizer surfaces the last
    // entry per agent so operators immediately see why an agent flipped.
    //
    // Structure: Map<agentId, Array<{ at: ISOString, from: string, to: string,
    //                                 reasonCode: string, humanReason: string,
    //                                 detail?: Object }>>
    this._modeTransitionHistory = new Map();
    this._MODE_TRANSITION_HISTORY_MAX_PER_AGENT = 50;

    // Empty-response stall tracker. Populated only when a cycle received an
    // AI response whose content was empty/whitespace AND carried no tool calls.
    // Reset on any productive cycle. Structure: Map<agentId, { count, firstAt }>.
    this._emptyResponseTracker = new Map();

    // Configuration from constants (no magic numbers)
    this.iterationDelayMs = SCHEDULER_CONFIG.ITERATION_DELAY_MS;
    this.maxIterationsPerCycle = SCHEDULER_CONFIG.MAX_ITERATIONS_PER_CYCLE;
  }

  /**
   * Append one entry to the cycle-history ring buffer and trim to MAX.
   * Telemetry for the scheduler visualizer.
   * @private
   */
  _recordCycle(entry) {
    this._cycleHistory.push(entry);
    if (this._cycleHistory.length > this._CYCLE_HISTORY_MAX) {
      this._cycleHistory.splice(0, this._cycleHistory.length - this._CYCLE_HISTORY_MAX);
    }
  }

  /**
   * Record a mode transition into the per-agent ring buffer. Pure bookkeeping —
   * does NOT mutate agent.mode, does NOT persist, does NOT broadcast. Callers
   * who need those effects should go through `_transitionMode` (internal,
   * scheduler-initiated flips) or call this method AFTER they've already
   * persisted/broadcast (agentPool does that for UI-driven flips).
   *
   * @param {string} agentId
   * @param {string} from        Previous mode ('chat' | 'agent')
   * @param {string} to          New mode ('chat' | 'agent')
   * @param {string} reasonCode  Stable reason key — see utilities/modeTransitionReasons.js
   * @param {Object} [detail]    Template substitution values (count, elapsedSec, …)
   */
  recordModeTransition(agentId, from, to, reasonCode, detail = {}) {
    if (!agentId || from === to) return;
    const humanReason = renderModeTransitionReason(reasonCode, detail);
    const entry = {
      at: new Date().toISOString(),
      from, to,
      reasonCode: reasonCode || 'unknown',
      humanReason,
      detail: detail && Object.keys(detail).length > 0 ? { ...detail } : null,
    };
    if (!this._modeTransitionHistory.has(agentId)) {
      this._modeTransitionHistory.set(agentId, []);
    }
    const arr = this._modeTransitionHistory.get(agentId);
    arr.push(entry);
    if (arr.length > this._MODE_TRANSITION_HISTORY_MAX_PER_AGENT) {
      arr.splice(0, arr.length - this._MODE_TRANSITION_HISTORY_MAX_PER_AGENT);
    }
  }

  /**
   * Apply a scheduler-initiated mode transition end-to-end: mutate the agent,
   * record in history, persist, and broadcast both legacy + canonical state
   * events with BOTH reasonCode (machine) and humanReason (UI-friendly).
   *
   * This is the ONLY sanctioned way for the scheduler to flip mode. Direct
   * `agent.mode = …` assignments in this file are a mistake — they skip the
   * history, the humanReason, and the broadcast.
   *
   * Broadcast events:
   *   - `agent_mode_changed`    — carries { agentId, mode, reason, humanReason }.
   *                                `reason` kept for back-compat with existing UI.
   *   - `broadcastAgentStateUpdate` — canonical UI state refresh.
   *
   * @param {string} agentId
   * @param {string} toMode        AGENT_MODES.CHAT | AGENT_MODES.AGENT
   * @param {string} reasonCode    e.g. 'empty-response-stall' — see utilities/modeTransitionReasons.js
   * @param {Object} [detail]      Template values + optional { transcriptMessage } to
   *                                push as a chat message.
   * @returns {Promise<boolean>}   true if the transition happened, false if skipped (no-op).
   * @private
   */
  async _transitionMode(agentId, toMode, reasonCode, detail = {}) {
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) return false;
    const fromMode = agent.mode;
    if (fromMode === toMode) return false;

    // 1. Mutate in-memory state.
    agent.mode = toMode;

    // 2. Optional transcript message (the existing stall / loop / timeout
    //    handlers push a chat bubble explaining what happened; we accept it
    //    here so all mode-change bookkeeping lives in one place).
    if (detail.transcriptMessage && agent.conversations?.full) {
      agent.conversations.full.messages.push(detail.transcriptMessage);
      agent.conversations.full.lastUpdated = new Date().toISOString();
    }

    // 3. Record in the visualizer ring buffer (natural-language included).
    //    Don't leak transcriptMessage into the saved detail — it can be large.
    const persistedDetail = { ...detail };
    delete persistedDetail.transcriptMessage;
    this.recordModeTransition(agentId, fromMode, toMode, reasonCode, persistedDetail);
    const entry = this._modeTransitionHistory.get(agentId)?.slice(-1)[0];

    // 4. Persist — best-effort. A persistence failure should NOT leave us in
    //    a re-firing state; scheduler trackers (stall, loop) are expected to
    //    be cleared by the caller BEFORE invoking us.
    try {
      await this.agentPool.persistAgentState(agentId);
    } catch (err) {
      this.logger?.error?.(`[_transitionMode] persist failed`, { agentId, error: err.message });
    }

    // 5. Broadcast — two events. Legacy `agent_mode_changed` is what the UI
    //    toggle listens to; we enrich it with `humanReason` without breaking
    //    older consumers that only read `reason`.
    const sessionId = this.getAgentSession(agentId) || agent.sessionId;
    if (sessionId && this.webSocketManager?.broadcastToSession) {
      try {
        if (detail.transcriptMessage) {
          this.webSocketManager.broadcastToSession(sessionId, {
            type: 'message_added',
            data: {
              agentId,
              message: detail.transcriptMessage,
              type: reasonCode,
            },
          });
        }
        this.webSocketManager.broadcastToSession(sessionId, {
          type: 'agent_mode_changed',
          data: {
            agentId,
            mode: toMode,
            reason: reasonCode,        // back-compat
            humanReason: entry?.humanReason || '',  // new: UI-friendly
            timestamp: entry?.at || new Date().toISOString(),
          },
        });
      } catch (err) {
        this.logger?.warn?.(`[_transitionMode] broadcast failed`, { agentId, error: err.message });
      }
    }
    try {
      await this.broadcastAgentStateUpdate(agentId, reasonCode);
    } catch { /* broadcast errors are best-effort */ }

    return true;
  }

  /**
   * Start the agent scheduler
   */
  start() {
    if (this.isRunning) {
      this.logger.info('Agent scheduler is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting Agent Scheduler with centralized activity service');

    // Start the main scheduler loop
    // No need to initialize agents - the processing cycle queries active agents each iteration
    this.scheduleInterval = setInterval(() => {
      this.processingCycle().catch(error => {
        this.logger.error('Scheduler processing cycle failed:', error);
      });
    }, this.iterationDelayMs);
  }

  /**
   * Register session ID for an agent (used for API key resolution)
   * This is called when a message is sent to an agent to associate the session
   * @param {string} agentId - Agent ID
   * @param {string} sessionId - Session ID for API key resolution
   */
  registerAgentSession(agentId, sessionId) {
    if (agentId && sessionId) {
      this.agentSessionMap.set(agentId, sessionId);
      this.logger.debug(`Registered session for agent: ${agentId}`, { sessionId });
    }
  }

  /**
   * Get session ID for an agent
   * @param {string} agentId - Agent ID
   * @returns {string|undefined} Session ID or undefined
   */
  getAgentSession(agentId) {
    return this.agentSessionMap.get(agentId);
  }

  /**
   * Stop the agent scheduler
   */
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
      this.scheduleInterval = null;
    }

    this.agentSessionMap.clear();
    this.compactionInProgress.clear();
    this.stateHashHistory.clear();
    this.agentProcessingLocks.clear();
    this.consecutiveNoToolMessages.clear();
    this._lockAcquiredAt.clear();
    this._cycleHistory.length = 0;
    this._emptyResponseTracker.clear();
    this._modeTransitionHistory.clear();

    // Cleanup services
    if (this.tokenCountingService && this.tokenCountingService.cleanup) {
      this.tokenCountingService.cleanup();
    }

    this.logger.info('Agent Scheduler stopped');
  }

  /**
   * Atomic snapshot of scheduler + agent state, for the /scheduler visualizer.
   *
   * Everything here is read from in-memory state held by the scheduler or by
   * AgentPool — there are no mutations, no network calls, and no awaits other
   * than the single `agentPool.getAllAgents()` call (which is what the scheduler
   * itself invokes every cycle, so calling it on demand is free).
   *
   * @returns {Promise<Object>}
   */
  async getState() {
    const allAgents = await this.agentPool.getAllAgents();
    const now = Date.now();
    const iter = (allAgents && typeof allAgents[Symbol.iterator] === 'function' && !Array.isArray(allAgents))
      ? allAgents.values()
      : allAgents;

    const agents = [];
    for (const agent of iter) {
      if (!agent) continue;
      const activity = shouldAgentBeActive(agent);
      const lockAcq = this._lockAcquiredAt.get(agent.id);
      const tasks = agent.taskList?.tasks || [];
      const nextActive = tasks.find(t => t.status === 'pending' || t.status === 'in_progress');
      const queues = agent.messageQueues || {};
      const activeAIReq = this.aiService?.getActiveRequest?.(agent.id) || null;

      agents.push({
        id: agent.id,
        name: agent.name,
        mode: agent.mode,
        status: agent.status,
        currentModel: agent.currentModel,
        activity,
        lockHeld: this.agentProcessingLocks.has(agent.id),
        lockHeldMs: lockAcq ? now - lockAcq.getTime() : null,
        delayEndTime: agent.delayEndTime || null,
        delayedNow: !!(agent.delayEndTime && new Date(agent.delayEndTime).getTime() > now),
        pausedUntil: agent.pausedUntil || null,
        ttl: agent.ttl ?? null,
        awaitingUserInput: agent.awaitingUserInput || null,
        stopRequested: !!agent.stopRequested,
        tasks: {
          total: tasks.length,
          pending:    tasks.filter(t => t.status === 'pending').length,
          inProgress: tasks.filter(t => t.status === 'in_progress').length,
          completed:  tasks.filter(t => t.status === 'completed').length,
          nextPending: nextActive ? String(nextActive.content || '').slice(0, 120) : null,
        },
        queues: {
          userMessages:       Array.isArray(queues.userMessages)       ? queues.userMessages.length       : 0,
          interAgentMessages: Array.isArray(queues.interAgentMessages) ? queues.interAgentMessages.length : 0,
          toolResults:        Array.isArray(queues.toolResults)        ? queues.toolResults.length        : 0,
        },
        activeAIRequest: activeAIReq,
        stateHashHistory: (this.stateHashHistory.get(agent.id) || []).slice(-10),
        emptyResponse: this._emptyResponseTracker.get(agent.id) || null,
        // Last 10 mode transitions (CHAT ↔ AGENT) for this agent. Newest-last.
        // Each entry: { at, from, to, reasonCode, humanReason, detail }.
        // The /scheduler visualizer surfaces humanReason under the mode cell.
        modeTransitions: (this._modeTransitionHistory.get(agent.id) || []).slice(-10),
      });
    }

    return {
      serverTime: new Date().toISOString(),
      scheduler: {
        running: this.isRunning,
        iterationDelayMs: this.iterationDelayMs,
        maxConcurrent: SCHEDULER_CONFIG.MAX_CONCURRENT_AGENTS || 3,
        currentlyInFlight: this.agentProcessingLocks.size,
        cycleCount: this._cycleCounter,
        cycleHistoryMax: this._CYCLE_HISTORY_MAX,
      },
      locks: Array.from(this.agentProcessingLocks.keys()).map(id => ({
        agentId: id,
        heldMs: this._lockAcquiredAt.get(id) ? now - this._lockAcquiredAt.get(id).getTime() : null,
      })),
      cycles: this._cycleHistory.slice(),   // newest last; client reverses
      agents,
    };
  }

  /**
   * Register an agent's session and ensure scheduler is running
   *
   * NOTE: This method is kept for backward compatibility. The actual decision
   * of whether an agent should be processed is now made by AgentActivityService.
   * This method now only:
   * 1. Registers the session ID for API key resolution
   * 2. Ensures the scheduler is running
   *
   * @param {string} agentId - Agent ID
   * @param {Object} context - Context containing sessionId
   */
  async addAgent(agentId, context = {}) {
    // Register session ID for API key resolution
    if (context.sessionId) {
      this.registerAgentSession(agentId, context.sessionId);
    } else {
      this.logger.warn(`Agent ${agentId} registered without sessionId - API key resolution may fail`, {
        triggeredBy: context.triggeredBy
      });
    }

    // Clear hash history when the user takes an action that should reset the
    // loop detector: either sending a new message or flipping the agent back
    // into AGENT mode. Without the mode-change reset, a loop intervention
    // that partially failed (e.g. persistAgentState threw before the cleanup
    // could run) could leave stale hashes that re-fire the loop detector on
    // the first cycle after the user resumed autopilot.
    const isFreshStart = context.triggeredBy === 'user-message'
      || context.triggeredBy === 'mode-change-to-agent';

    if (isFreshStart) {
      this.clearHashHistory(agentId);
      this.logger.debug(`Hash history cleared for agent ${agentId}`, { triggeredBy: context.triggeredBy });

      // Also reset consecutive no-tool and empty-response trackers so the
      // agent really does get a clean slate.
      if (this.consecutiveNoToolMessages.has(agentId)) {
        this.consecutiveNoToolMessages.set(agentId, 0);
      }
      if (this._emptyResponseTracker.has(agentId)) {
        this._emptyResponseTracker.delete(agentId);
      }
    }

    // Initialize hash history for this agent if not exists
    if (!this.stateHashHistory.has(agentId)) {
      this.stateHashHistory.set(agentId, []);
    }

    this.logger.debug(`Agent session registered: ${agentId}`, {
      sessionId: context.sessionId || 'NO_SESSION_ID',
      triggeredBy: context.triggeredBy || 'unknown'
    });

    // Start scheduler if not running
    if (!this.isRunning) {
      this.start();
    }
  }

  /**
   * Clean up session tracking for an agent
   *
   * NOTE: This method is kept for backward compatibility and cleanup.
   * The actual decision of whether to stop processing an agent is now
   * made by AgentActivityService - agents are not "removed" from scheduler,
   * they simply become inactive based on their state.
   *
   * @param {string} agentId - Agent ID
   * @param {string} reason - Reason for cleanup (for logging)
   */
  removeAgent(agentId, reason = 'completed') {
    // Clean up session mapping
    if (this.agentSessionMap.has(agentId)) {
      this.agentSessionMap.delete(agentId);
    }

    // Clean up state hash history for this agent
    if (this.stateHashHistory.has(agentId)) {
      this.stateHashHistory.delete(agentId);
    }

    // Clean up processing lock
    if (this.agentProcessingLocks.has(agentId)) {
      this.agentProcessingLocks.delete(agentId);
    }
    this._lockAcquiredAt.delete(agentId);

    // Clean up consecutive no-tool counter
    if (this.consecutiveNoToolMessages.has(agentId)) {
      this.consecutiveNoToolMessages.delete(agentId);
    }

    // Clean up empty-response tracker
    if (this._emptyResponseTracker.has(agentId)) {
      this._emptyResponseTracker.delete(agentId);
    }

    this.logger.debug(`Agent session cleaned up: ${agentId}`, { reason });
  }

  /**
   * Check if agent should currently be active in scheduler
   * Uses the centralized AgentActivityService for the decision
   * @param {string} agentId - Agent ID to check
   * @returns {Promise<boolean>} True if agent should be active
   */
  async isAgentInScheduler(agentId) {
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) return false;

    const result = shouldAgentBeActive(agent);
    return result.active;
  }

  /**
   * Stop autonomous execution for a specific agent
   * This sets the agent state so that shouldAgentBeActive() returns false
   * @param {string} agentId - Agent ID to stop
   * @returns {Promise<Object>} Result with agent state
   */
  async stopAgentExecution(agentId) {
    try {
      const agent = await this.agentPool.getAgent(agentId);
      if (!agent) {
        return {
          success: false,
          error: 'Agent not found'
        };
      }

      // Set stopRequested flag FIRST - this signals any concurrent processing to stop
      // This is checked by shouldAgentBeActive() and processAgent()
      agent.stopRequested = true;

      // CRITICAL: Abort any active streaming request to Azure backend
      // This immediately stops the HTTP connection and prevents further chunk processing
      if (this.aiService && this.aiService.abortRequest) {
        const aborted = this.aiService.abortRequest(agentId);
        if (aborted) {
          this.logger.info(`Aborted active request for agent: ${agentId}`);
        }
      }

      // Clear any delays BEFORE the mode flip — _transitionMode persists after.
      agent.delayEndTime = null;

      // Flip mode → CHAT (records transition + persists + broadcasts
      // agent_mode_changed with humanReason "Stopped by user.")
      await this._transitionMode(agentId, AGENT_MODES.CHAT, 'user-stop');

      // Clear stop request flag after mode is set (it has been honored).
      agent.stopRequested = false;

      // Clean up session tracking.
      this.removeAgent(agentId, 'stopped-by-user');

      // Legacy `execution_stopped` event — some UI paths key off it rather
      // than agent_mode_changed. Kept for back-compat; the mode flip itself
      // was already broadcast by _transitionMode above.
      const sessionId = this.getAgentSession(agentId) || agent.sessionId;
      if (sessionId && this.webSocketManager && this.webSocketManager.broadcastToSession) {
        this.webSocketManager.broadcastToSession(sessionId, {
          type: 'execution_stopped',
          data: {
            agentId,
            type: 'execution_stopped',
            mode: AGENT_MODES.CHAT,
            timestamp: new Date().toISOString()
          }
        });
      }

      this.logger.info(`Agent execution stopped: ${agentId}`, {
        mode: agent.mode
      });

      return {
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          mode: agent.mode
        }
      };

    } catch (error) {
      this.logger.error(`Failed to stop agent execution: ${agentId}`, {
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Main processing cycle - queries active agents and processes them
   *
   * KEY CHANGE: Instead of iterating over a managed activeAgents Map,
   * we now query AgentActivityService.getActiveAgents() each cycle.
   * This is the centralized approach that eliminates scattered add/remove logic.
   *
   * @private
   */
  async processingCycle() {
    // Get all agents from pool and determine which should be active
    const allAgents = await this.agentPool.getAllAgents();
    const activeAgentResults = getActiveAgents(allAgents);
    const totalAgents = (allAgents && typeof allAgents.size === 'number') ? allAgents.size : (Array.isArray(allAgents) ? allAgents.length : 0);
    const currentlyInFlightAtStart = this.agentProcessingLocks.size;
    const cycleN = ++this._cycleCounter;
    const cycleAt = new Date().toISOString();

    if (activeAgentResults.length === 0) {
      // No agents want to run this cycle.
      this._recordCycle({
        n: cycleN, at: cycleAt, totalAgents,
        activeCount: 0, active: [],
        inFlightAtStart: currentlyInFlightAtStart,
        skippedLocked: [], skippedConcurrency: [], launched: [],
        outcome: 'idle',
      });
      return;
    }

    // Concurrency enforcement: count how many agents are already in-flight
    // from previous cycles, and only launch new ones up to the global cap.
    const maxConcurrent = SCHEDULER_CONFIG.MAX_CONCURRENT_AGENTS || 3;
    const currentlyInFlight = currentlyInFlightAtStart;

    // Filter out agents already being processed
    const skippedLocked = [];
    const unlockedAgents = activeAgentResults.filter(r => {
      if (this.agentProcessingLocks.get(r.agentId)) {
        this.logger.debug(`Agent ${r.agentId} still processing from previous cycle, skipping`);
        skippedLocked.push(r.agentId);
        return false;
      }
      return true;
    });

    if (unlockedAgents.length === 0) {
      // Every active agent is wedged in a previous cycle's lock.
      this._recordCycle({
        n: cycleN, at: cycleAt, totalAgents,
        activeCount: activeAgentResults.length,
        active: activeAgentResults.map(r => ({ agentId: r.agentId, name: r.agent?.name, reason: r.reason, details: r.details })),
        inFlightAtStart: currentlyInFlight,
        skippedLocked, skippedConcurrency: [], launched: [],
        outcome: 'all-locked',
      });
      return;
    }

    // Round-robin fairness: agents that launched in a recent cycle go to the back
    // so that waiting agents get priority for available slots.
    unlockedAgents.sort((a, b) => {
      const aRan = this._lastLaunchedAgentIds.has(a.agentId) ? 1 : 0;
      const bRan = this._lastLaunchedAgentIds.has(b.agentId) ? 1 : 0;
      return aRan - bRan; // agents that didn't run recently come first
    });

    // Cap new launches so total in-flight never exceeds MAX_CONCURRENT_AGENTS
    const slotsAvailable = Math.max(0, maxConcurrent - currentlyInFlight);
    const agentsToLaunch = unlockedAgents.slice(0, slotsAvailable);
    const skippedConcurrency = unlockedAgents.slice(slotsAvailable).map(r => r.agentId);

    if (agentsToLaunch.length === 0) {
      this.logger.debug(`Concurrency cap reached: ${currentlyInFlight}/${maxConcurrent} agents in-flight, ${unlockedAgents.length} waiting`);
      this._recordCycle({
        n: cycleN, at: cycleAt, totalAgents,
        activeCount: activeAgentResults.length,
        active: activeAgentResults.map(r => ({ agentId: r.agentId, name: r.agent?.name, reason: r.reason, details: r.details })),
        inFlightAtStart: currentlyInFlight,
        skippedLocked, skippedConcurrency, launched: [],
        outcome: 'concurrency-cap',
      });
      return;
    }

    this.logger.debug(`Processing cycle: launching ${agentsToLaunch.length} agents (${currentlyInFlight} in-flight, ${maxConcurrent} max)`, {
      agents: agentsToLaunch.map(r => ({ id: r.agentId, reason: r.reason })),
      waiting: unlockedAgents.length - agentsToLaunch.length
    });

    // Track which agents we're launching for round-robin fairness
    this._lastLaunchedAgentIds = new Set(agentsToLaunch.map(r => r.agentId));

    // Record the launch decision before firing so the visualizer sees it
    // even if the async launch errors.
    this._recordCycle({
      n: cycleN, at: cycleAt, totalAgents,
      activeCount: activeAgentResults.length,
      active: activeAgentResults.map(r => ({ agentId: r.agentId, name: r.agent?.name, reason: r.reason, details: r.details })),
      inFlightAtStart: currentlyInFlight,
      skippedLocked, skippedConcurrency,
      launched: agentsToLaunch.map(r => r.agentId),
      outcome: 'launched',
    });

    // Fire-and-forget: launch processing without awaiting.
    // Each agent is protected by its own lock in processAgent().
    // Next cycle (1s later) will pick up remaining agents when slots free up.
    this.processAgentsInParallel(agentsToLaunch).catch(error => {
      this.logger.error('Parallel agent processing failed:', error);
    });
  }

  /**
   * Process multiple agents in parallel.
   * Concurrency is capped at the cycle level (processingCycle slices to
   * MAX_CONCURRENT_AGENTS), so this method simply launches all given agents
   * concurrently via Promise.all.
   *
   * @param {Array} activeAgentResults - Array of { agent, agentId, reason }
   * @private
   */
  async processAgentsInParallel(activeAgentResults) {
    this.logger.debug(`Launching ${activeAgentResults.length} agents in parallel`, {
      agentIds: activeAgentResults.map(r => r.agentId)
    });

    await Promise.all(
      activeAgentResults.map(async ({ agentId, reason }) => {
        try {
          await this.processAgent(agentId);
        } catch (error) {
          this.logger.error(`Agent processing failed: ${agentId}`, {
            error: error.message,
            stack: error.stack,
            activationReason: reason
          });
          // Clean up on error - don't leave stale locks
          this.agentProcessingLocks.delete(agentId);
          this._lockAcquiredAt.delete(agentId);
        }
      })
    );
  }

  /**
   * Process a single agent - handle queues and get AI response
   *
   * NOTE: This method no longer returns whether the agent should continue.
   * The decision is made by AgentActivityService at the start of each cycle.
   *
   * @param {string} agentId - Agent ID to process
   * @private
   */
  async processAgent(agentId) {
    // Check if this agent is already being processed
    if (this.agentProcessingLocks.get(agentId)) {
      this.logger.debug(`Agent ${agentId} is already being processed, skipping`);
      return;
    }

    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) {
      return; // Agent no longer exists
    }

    // Set processing lock (prevents concurrent processing of the same agent)
    this.agentProcessingLocks.set(agentId, true);
    this._lockAcquiredAt.set(agentId, new Date());

    try {
      // Use centralized service to check if we should skip this iteration
      const skipCheck = shouldSkipIteration(agent);
      if (skipCheck.skip) {
        this.logger.debug(`Agent ${agentId} skipping iteration: ${skipCheck.reason}`);
        return;
      }

      // Generate current state hash for repetition detection
      const currentStateHash = this.generateAgentStateHash(agent);

      // Check for repetitive loop using sliding window
      const loopDetection = this.detectRepetitiveLoop(agentId, currentStateHash);
      if (loopDetection.isLoop) {
        this.logger.warn(`Agent ${agentId} detected in repetitive loop - terminating`, {
          stateHash: currentStateHash,
          occurrences: loopDetection.occurrences,
          windowSize: SCHEDULER_CONFIG.STATE_HASH_WINDOW_SIZE,
          threshold: SCHEDULER_CONFIG.REPETITION_THRESHOLD
        });

        // Notify user about the loop and stop the agent
        await this.handleRepetitiveLoop(agentId, loopDetection);
        return;
      }

      // Get message queue status
      const queues = agent.messageQueues || {};
      const totalMessages = (queues.toolResults?.length || 0) +
                           (queues.interAgentMessages?.length || 0) +
                           (queues.userMessages?.length || 0);

      // Check if this exact state was just processed (immediate duplicate).
      // The hash is computed from the agent's OUTPUT (last assistant
      // messages) so when nothing new has been emitted since the previous
      // cycle the hash repeats. But we must NOT skip when there is pending
      // input queued — tool results, user messages, or inter-agent
      // messages all change the effective "state" even though the output
      // history looks the same. Without this guard, an agent that
      // finishes a turn, gets tool results back, and then matches the
      // prior hash stalls forever: processAgent returns early every
      // cycle, the queued tool results never get consumed, no new
      // assistant message is produced, hash never changes — perpetual
      // skip. Starvation, not a loop.
      if (loopDetection.isImmediateDuplicate && totalMessages === 0) {
        this.logger.debug(`Agent ${agentId} state unchanged and no pending input, skipping`, {
          stateHash: currentStateHash,
          agentMode: agent.mode
        });
        return; // Skip - nothing new to process
      }

      // Log if user messages are present (highest priority)
      if (queues.userMessages?.length > 0) {
        this.logger.info(`User message detected for agent ${agentId} - will be prioritized`, {
          userMessageCount: queues.userMessages.length,
          agentMode: agent.mode
        });
      }

      // Check if stop was requested - exit early if so
      if (agent.stopRequested) {
        this.logger.info(`Agent ${agentId} stop requested - aborting processing`);
        return;
      }

      // Track what happened this cycle. Two independent signals:
      //   gotResponse — the AI service returned *anything* (vs null).
      //   advanced    — the conversation actually moved forward (message
      //                 appended or tools extracted). If false despite
      //                 gotResponse=true, the model returned an empty or
      //                 whitespace-only message with no tool calls — a
      //                 "no-op cycle" that must NOT pollute stateHashHistory.
      let gotResponse = false;
      let advanced = false;
      // Preserved for the empty-response-stall diagnostic snapshot — we want
      // to show the operator the raw shape of an "empty" response (finish
      // reason, has-tool-calls, content length) so the root cause is visible.
      let lastAiResponse = null;

      // Process based on whether there are messages or agent needs autonomous processing
      if (totalMessages === 0 && agent.mode === AGENT_MODES.AGENT) {
        // AGENT mode with no messages - check for task-based work
        await this.autoCreateInitialTaskIfNeeded(agentId);
        const result = await this.processAgentAutonomously(agentId);
        gotResponse = result.gotResponse;
        advanced = result.advanced;
        lastAiResponse = result.aiResponse ?? null;
      } else if (totalMessages > 0) {
        // Has messages to process
        const processedMessages = await this.processAgentQueues(agentId);

        if (processedMessages > 0 || agent.mode === AGENT_MODES.AGENT) {
          // Get AI response after processing queued messages
          const aiResponse = await this.getAgentAIResponse(agentId);

          if (aiResponse) {
            gotResponse = true;
            lastAiResponse = aiResponse;
            advanced = await this.processAIResponse(agentId, aiResponse);

            // Clear token limit retry tracker on successful AI response
            this.clearTokenLimitRetryTracker(agentId);
          } else {
            this.logger.warn(`No AI response for agent ${agentId}`);
          }
        }
      }
      // CHAT mode with no messages: do nothing - activity service will mark as inactive

      // Only record state hash when the conversation actually advanced. If
      // the model returned an empty response (gotResponse=true, advanced=false),
      // we're still in the same conversation state as before and recording
      // would produce phantom duplicates that detectRepetitiveLoop misreads
      // as progress toward a loop.
      if (advanced) {
        this.recordStateHash(agentId, currentStateHash);
      }

      // Empty-response stall detector. When the model returns an empty /
      // whitespace-only response with no tool calls, we keep retrying — the
      // next cycle may produce a real message. But we ring-buffer the empties
      // so a genuinely stuck model eventually surfaces as a user-facing error
      // instead of silently spinning forever. We also snapshot the response
      // shape so the operator can see WHY the model returned nothing
      // (content_filter? tool-call-only? reasoning-only? etc).
      if (gotResponse && !advanced) {
        await this._trackEmptyResponse(agentId, lastAiResponse);
      } else if (advanced) {
        // Productive cycle — any previous stall has resolved itself.
        if (this._emptyResponseTracker.has(agentId)) {
          this._emptyResponseTracker.delete(agentId);
        }
      }

      // Decrement TTL (Time-to-Live) if set
      // TTL gives agents extra processing cycles after clearing tasks
      const agentForTtl = await this.agentPool.getAgent(agentId);
      if (agentForTtl && agentForTtl.ttl !== null && agentForTtl.ttl !== undefined && agentForTtl.ttl > 0) {
        agentForTtl.ttl--;
        if (agentForTtl.ttl <= 0) {
          agentForTtl.ttl = null; // Clear expired TTL
        }
        await this.agentPool.persistAgentState(agentId);
        this.logger.debug(`TTL decremented for agent ${agentId}`, { newTtl: agentForTtl.ttl });
      }

    } finally {
      // Always clear processing lock, even on errors
      this.agentProcessingLocks.delete(agentId);
      this._lockAcquiredAt.delete(agentId);
    }
  }

  /**
   * Process agent's message queues with consolidated single-message approach
   * @param {string} agentId - Agent ID
   * @returns {Promise<number>} Number of messages processed
   * @private
   */
  async processAgentQueues(agentId) {
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) return 0;

    const queues = agent.messageQueues;

    // Task boundary: if agent just completed work (jobdone) and has stale tool
    // results from the previous task alongside new messages, drain the stale
    // results into conversation history as a separate boundary entry so they
    // don't get mixed into the new task's consolidated input.
    const hasNewMessages = (queues.userMessages?.length > 0) || (queues.interAgentMessages?.length > 0);
    if (agent.autonomousWorkComplete && queues.toolResults?.length > 0 && hasNewMessages) {
      const staleCount = queues.toolResults.length;
      let boundaryContent = '[Previous Task — Final Tool Results]\n';
      queues.toolResults.forEach(msg => {
        boundaryContent += `${this.formatToolResult(msg)}\n`;
      });
      boundaryContent += '\n--- Previous task completed. New task follows. ---';

      await this.addMessageToConversation(agentId, {
        id: `task-boundary-${Date.now()}`,
        role: MESSAGE_ROLES.USER,
        content: boundaryContent.trim(),
        timestamp: new Date().toISOString(),
        // `task-boundary` stays as the specific subtype, but it IS a
        // tool-result drain — mark it so downstream consumers (UI filter,
        // token accounting, export) can treat it uniformly without
        // having to enumerate every subtype.
        type: 'task-boundary',
        isToolResultInjection: true,
        originalMessageCount: staleCount,
      }, false);

      queues.toolResults.length = 0;
      agent.autonomousWorkComplete = false;
      this.logger.info(`Task boundary: drained ${staleCount} stale tool results for agent ${agentId}`);
    } else if (agent.autonomousWorkComplete && hasNewMessages) {
      // No stale tool results but new messages arrived — just reset the flag
      agent.autonomousWorkComplete = false;
    }

    // Collect all messages with timestamps for proper ordering
    const allMessages = [
      ...queues.toolResults.map(msg => ({ ...msg, queueType: 'toolResults' })),
      ...queues.interAgentMessages.map(msg => ({ ...msg, queueType: 'interAgentMessages' })),
      ...queues.userMessages.map(msg => ({ ...msg, queueType: 'userMessages' }))
    ];

    if (allMessages.length === 0) return 0;

    // Sort by arrival time (timestamp)
    allMessages.sort((a, b) => new Date(a.timestamp || a.queuedAt || 0) - new Date(b.timestamp || b.queuedAt || 0));

    // CRITICAL FIX: Consolidate all messages into single AI request
    let consolidatedContent = '';
    const hasUserMessages = allMessages.some(m => m.queueType === 'userMessages');
    const hasInterAgentMessages = allMessages.some(m => m.queueType === 'interAgentMessages');
    const hasToolResults = allMessages.some(m => m.queueType === 'toolResults');

    // Add user messages first (highest priority)
    const userMessages = allMessages.filter(m => m.queueType === 'userMessages');
    if (userMessages.length > 0) {
      userMessages.forEach(msg => {
        if (consolidatedContent) consolidatedContent += '\n\n';
        consolidatedContent += msg.content;
      });
    }

    // Add inter-agent messages as context (not as separate system messages)
    const interAgentMessages = allMessages.filter(m => m.queueType === 'interAgentMessages');
    if (interAgentMessages.length > 0) {
      if (consolidatedContent) consolidatedContent += '\n\n';
      consolidatedContent += '[Agent Messages]\n';
      interAgentMessages.forEach(msg => {
        const senderName = msg.senderName || msg.sender || 'Unknown Agent';
        consolidatedContent += `${senderName}: ${msg.content}\n`;
      });
    }

    // Build tool results as a SEPARATE message (role: 'user' with tool-result type marker)
    // so they are distinguishable from actual user messages in the conversation history.
    const toolResults = allMessages.filter(m => m.queueType === 'toolResults');
    let toolResultContent = '';
    if (toolResults.length > 0) {
      // Group results by responseTurnId (the AI message that triggered them)
      const turnGroups = new Map();
      for (const msg of toolResults) {
        const turnKey = msg.responseTurnId || 'unknown';
        if (!turnGroups.has(turnKey)) turnGroups.set(turnKey, []);
        turnGroups.get(turnKey).push(msg);
      }

      // Manifest: tell agent what to expect
      const turnCount = turnGroups.size;
      const toolCount = toolResults.length;
      const toolIds = [...new Set(toolResults.map(m => m.toolId).filter(Boolean))];
      toolResultContent += `[Tool Results — ${toolCount} result${toolCount > 1 ? 's' : ''} from ${turnCount} tool batch${turnCount > 1 ? 'es' : ''}: ${toolIds.join(', ')}]\n`;

      // Current-working-directory banner. Reasoning models regularly forget
      // that `change-directory` persists the CWD across turns and then
      // re-prepend the project folder name to relative paths, which nests
      // directories unintentionally (".../foo/foo/..."). Surfacing the CWD
      // at the top of every tool-results injection gives the model a stable
      // anchor: "you are HERE, all relative paths resolve from HERE."
      try {
        const agentForCwd = await this.agentPool.getAgent(agentId);
        const cwd = agentForCwd?.directoryAccess?.workingDirectory;
        if (cwd) {
          toolResultContent += `[CWD: ${cwd} — relative paths resolve from here; do NOT prepend the project folder name]\n`;
        }
      } catch { /* best-effort; never block the tool-results injection */ }

      if (turnCount === 1) {
        // Single batch — flat list (no sub-headers needed)
        toolResults.forEach(msg => {
          toolResultContent += `${this.formatToolResult(msg)}\n`;
        });
      } else {
        // Multiple batches — group with labeled sub-headers
        let batchIndex = 1;
        for (const [, group] of turnGroups) {
          toolResultContent += `\n--- Batch ${batchIndex} of ${turnCount} ---\n`;
          group.forEach(msg => {
            toolResultContent += `${this.formatToolResult(msg)}\n`;
          });
          batchIndex++;
        }
      }
    }

    // Add processing instructions only if needed
    if (hasInterAgentMessages) {
      consolidatedContent += '\nNote: Use the agentcommunication tool if you need to respond to other agents.';
    }

    // PHASE 2: Auto-create tasks for incoming messages
    await this.autoCreateTasksForMessages(agentId, userMessages, interAgentMessages);

    // Decide message strategy based on what's queued:
    // - Tool results only → single message with type: 'tool-result' (most common in agent loops)
    // - User/inter-agent only → single message with type: 'consolidated-input'
    // - Both → must merge into single user message (API requires alternating user/assistant)
    const hasNonToolContent = consolidatedContent.trim().length > 0;

    if (toolResultContent && !hasNonToolContent) {
      // TOOL RESULTS ONLY — add as dedicated tool-result message
      const toolMessage = {
        id: `tool-result-${Date.now()}`,
        role: MESSAGE_ROLES.USER,
        content: toolResultContent.trim(),
        timestamp: new Date().toISOString(),
        type: 'tool-result',
        originalMessageCount: toolResults.length
      };
      await this.addMessageToConversation(agentId, toolMessage, false);
    } else if (!toolResultContent && hasNonToolContent) {
      // USER/INTER-AGENT ONLY — add as user message
      const userMessage = {
        id: `consolidated-${Date.now()}`,
        role: MESSAGE_ROLES.USER,
        content: consolidatedContent.trim(),
        timestamp: new Date().toISOString(),
        type: 'consolidated-input',
        originalMessageCount: userMessages.length + interAgentMessages.length
      };
      await this.addMessageToConversation(agentId, userMessage, false);
    } else if (toolResultContent && hasNonToolContent) {
      // BOTH — merge into single message to avoid consecutive user messages
      // (API requires strict user/assistant alternation)
      // Put tool results first, then user content (user content is higher priority context)
      const mergedContent = toolResultContent.trim() + '\n\n' + consolidatedContent.trim();
      const mergedMessage = {
        id: `consolidated-${Date.now()}`,
        role: MESSAGE_ROLES.USER,
        content: mergedContent,
        timestamp: new Date().toISOString(),
        type: 'consolidated-input',
        originalMessageCount: allMessages.length
      };
      await this.addMessageToConversation(agentId, mergedMessage, false);
    }

    // CRITICAL: Update conversation tracking when inter-agent messages are processed
    if (agent && interAgentMessages.length > 0) {
      // Ensure interAgentTracking is a Map (defensive - may be plain object from JSON)
      if (!agent.interAgentTracking || !(agent.interAgentTracking instanceof Map)) {
        if (agent.interAgentTracking && typeof agent.interAgentTracking === 'object') {
          agent.interAgentTracking = new Map(Object.entries(agent.interAgentTracking));
        } else {
          agent.interAgentTracking = new Map();
        }
      }

      for (const msg of interAgentMessages) {
        if (msg.sender) {
          // Mark that this agent received a message from the sender
          if (!agent.interAgentTracking.has(msg.sender)) {
            agent.interAgentTracking.set(msg.sender, {
              lastSent: null,
              lastReceived: null,
              lastType: null
            });
          }

          const tracking = agent.interAgentTracking.get(msg.sender);
          tracking.lastReceived = Date.now();
          tracking.lastType = 'received';
        }
      }
      // Persist updated tracking
      await this.agentPool.persistAgentState(agentId);
    }

    // Clear all processed queues
    queues.toolResults.length = 0;
    queues.interAgentMessages.length = 0; 
    queues.userMessages.length = 0;

    // Persist updated agent state
    await this.agentPool.persistAgentState(agentId);

    this.logger.debug(`Consolidated ${allMessages.length} queued messages for agent ${agentId}`);
    return allMessages.length;
  }

  /**
   * Add message to agent's conversation history with proper formatting
   * @param {string} agentId - Agent ID
   * @param {Object} message - Message to add
   * @param {boolean} broadcast - Whether to broadcast message to UI (default true)
   * @private
   */
  async addMessageToConversation(agentId, message, broadcast = true) {
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) return false;

    // Format message based on queue type
    let formattedMessage;

    switch (message.queueType) {
      case 'toolResults': // Tool results
        formattedMessage = {
          ...message,
          role: 'tool',
          content: this.formatToolResult(message)
        };
        break;

      case 'interAgentMessages': // Inter-agent messages
        formattedMessage = {
          ...message,
          role: MESSAGE_ROLES.SYSTEM,
          content: `Message from ${message.senderName || message.sender}: ${message.content}`
        };
        break;

      case 'userMessages': // User messages
        formattedMessage = {
          ...message,
          role: MESSAGE_ROLES.USER
        };
        break;

      default:
        formattedMessage = message;
    }

    // Add timestamp if not present
    if (!formattedMessage.timestamp) {
      formattedMessage.timestamp = new Date().toISOString();
    }

    // GUARD: Skip empty messages - they should never be added to history.
    // Returning `false` lets the caller (processAIResponse) know the conversation
    // did NOT advance, so it can avoid polluting stateHashHistory and instead
    // mark the cycle as an "empty response" for the stall-detector.
    const messageContent = formattedMessage.content;
    if (!messageContent || (typeof messageContent === 'string' && !messageContent.trim())) {
      this.logger.warn(`Skipping empty message for agent ${agentId}`, {
        role: formattedMessage.role,
        queueType: message.queueType,
        hasContent: !!messageContent
      });
      return false; // Don't add empty messages; caller should treat as "no progress"
    }

    // Add to conversation history
    agent.conversations.full.messages.push(formattedMessage);
    agent.conversations.full.lastUpdated = new Date().toISOString();

    // Add to current model conversation if exists
    if (agent.currentModel && agent.conversations[agent.currentModel]) {
      agent.conversations[agent.currentModel].messages.push(formattedMessage);
      agent.conversations[agent.currentModel].lastUpdated = new Date().toISOString();
    }

    // FIX: Only broadcast user-visible messages to UI (not internal system prompts)
    if (broadcast && this.shouldBroadcastMessage(formattedMessage)) {
      this.broadcastMessageUpdate(agentId, formattedMessage);
    }

    return true;
  }

  /**
   * Process agent autonomously (for AGENT mode with no queued messages)
   * @param {string} agentId - Agent ID
   * @private
   */
  async processAgentAutonomously(agentId) {
    // Auto-mark the highest priority pending task as in-progress
    await this.autoProgressHighestPriorityTask(agentId);

    // Get AI response without new messages
    const aiResponse = await this.getAgentAIResponse(agentId);

    if (!aiResponse) {
      // No response - activity service will determine if we should continue.
      // Reported as { gotResponse: false } so the caller doesn't count this
      // as an "empty-response stall" (which is specifically about empty content).
      return { gotResponse: false, advanced: false, aiResponse: null };
    }

    // Process AI response and execute tools. processAIResponse returns `true`
    // when the conversation actually advanced (assistant message appended or
    // tool calls extracted), and `false` when the response was empty/whitespace
    // and carried no tools.
    const advanced = await this.processAIResponse(agentId, aiResponse);

    // Clear token limit retry tracker on successful AI response
    this.clearTokenLimitRetryTracker(agentId);

    // Return aiResponse alongside flags so the caller can snapshot the raw
    // shape into the empty-response diagnostic tracker when advanced=false.
    return { gotResponse: true, advanced, aiResponse };
  }

  /**
   * Check if compaction is needed and perform it
   * @param {string} agentId - Agent ID
   * @param {string} targetModel - Target model for AI request
   * @param {string} sessionId - Session ID for context
   * @returns {Promise<Object>} Result with shouldContinue flag
   * @private
   */
  async checkAndPerformCompaction(agentId, targetModel, sessionId) {
    const ENABLE_COMPACT_DEBUG = process.env.COMPACT_DEBUG === 'true';

    if (ENABLE_COMPACT_DEBUG) {
      console.log('[COMPACT-CHECK-START]', {
        agentId,
        targetModel,
        sessionId,
        timestamp: new Date().toISOString()
      });
    }

    try {
      const agent = await this.agentPool.getAgent(agentId);
      if (!agent) {
        if (ENABLE_COMPACT_DEBUG) {
          console.log('[COMPACT-ERROR]', { agentId, reason: 'Agent not found' });
        }
        return { shouldContinue: false, error: 'Agent not found' };
      }

      // For model switching, check the current model's conversation, not the target model's
      // This handles scenarios where we're switching from a larger context to a smaller one
      let modelToCheck = agent.currentModel && agent.currentModel !== targetModel
        ? agent.currentModel
        : targetModel;

      // DEFENSIVE: If modelToCheck is undefined, try to find a valid conversation key
      if (!modelToCheck) {
        this.logger.warn(`Agent ${agentId} has no currentModel or targetModel set, attempting to use available conversation`, {
          agentId,
          currentModel: agent.currentModel,
          targetModel,
          preferredModel: agent.preferredModel,
          availableConversations: Object.keys(agent.conversations || {})
        });

        // Notify user via WebSocket
        this.broadcastCompactionEvent(agentId, sessionId, {
          status: 'warning',
          message: 'Agent model configuration issue detected - using fallback',
          details: `Agent has no currentModel set. Using fallback model for compaction check.`,
          agentName: agent.name
        });

        // Try preferredModel first
        if (agent.preferredModel && agent.conversations[agent.preferredModel]) {
          modelToCheck = agent.preferredModel;
          this.logger.info(`Using preferredModel as fallback for compaction check: ${modelToCheck}`);
        } else {
          // Find any non-'full' conversation key
          const conversationKeys = Object.keys(agent.conversations || {}).filter(key => key !== 'full');
          if (conversationKeys.length > 0) {
            modelToCheck = conversationKeys[0];
            this.logger.warn(`Using first available conversation key for compaction check: ${modelToCheck}`);
          } else {
            this.logger.error(`No valid conversation found for agent ${agentId}, skipping compaction`);

            // Notify user of critical error
            this.broadcastCompactionEvent(agentId, sessionId, {
              status: 'error',
              message: 'No valid conversation found for compaction',
              details: `Agent ${agent.name} has no valid conversation data. Compaction skipped.`,
              agentName: agent.name
            });

            return { shouldContinue: true, error: 'No valid conversation found' };
          }
        }
      }

      // Get conversation metadata
      let metadata = await this.agentPool.getCompactionMetadata(agentId, modelToCheck);

      if (ENABLE_COMPACT_DEBUG) {
        console.log('[COMPACT-METADATA]', {
          agentId,
          modelToCheck,
          hasMetadata: !!metadata,
          isCompacted: metadata?.isCompacted,
          originalMessageCount: metadata?.originalMessages?.length || 0,
          compactedMessageCount: metadata?.compactedMessages?.length || 0,
          lastCompactization: metadata?.lastCompactization || 'never',
          compactizationCount: metadata?.compactizationCount || 0,
          originalTokenCount: metadata?.originalTokenCount || 0,
          compactedTokenCount: metadata?.compactedTokenCount || 0
        });
      }

      // If no conversation exists for this model yet, return early
      if (!metadata || (!metadata.originalMessages && !metadata.compactedMessages)) {
        this.logger.debug(`Compaction skipped: no conversation metadata for agent ${agentId}, model ${modelToCheck}`);
        if (ENABLE_COMPACT_DEBUG) {
          console.log('[COMPACT-SKIPPED]', { agentId, reason: 'No conversation metadata' });
        }
        return { shouldContinue: true }; // No conversation to compact
      }

      // CRITICAL: Sync pending messages BEFORE token counting.
      // Without this, the token count uses stale compactedMessages that miss new messages
      // (tool results, user inputs) added since the last getMessagesForAI call.
      // This was causing severe underestimation (e.g., 50K estimated vs 212K actual).
      if (metadata.isCompacted) {
        const earlySyncResult = await this.agentPool.syncPendingMessages(agentId, modelToCheck);
        if (earlySyncResult.synced > 0) {
          this.logger.info(`Pre-check sync: ${earlySyncResult.synced} pending messages synced for accurate token count`, {
            agentId,
            modelToCheck
          });
          // Re-fetch metadata to get updated compactedMessages
          const updatedMetadata = await this.agentPool.getCompactionMetadata(agentId, modelToCheck);
          metadata = updatedMetadata;
        }
      }

      // Determine which messages to use for token counting
      let messages = metadata.isCompacted
        ? metadata.compactedMessages
        : metadata.originalMessages;

      if (ENABLE_COMPACT_DEBUG) {
        console.log('[COMPACT-MESSAGES-SELECTED]', {
          agentId,
          selectedArray: metadata.isCompacted ? 'compactedMessages' : 'originalMessages',
          messageCount: messages?.length || 0,
          reason: metadata.isCompacted ? 'Compaction exists, using compacted version' : 'No compaction yet, using original'
        });
      }

      // Check if any messages are oversized — if so, always allow compaction
      // because the splitting logic inside compactConversation will create enough messages
      const hasOversizedMessages = messages && messages.some(m => {
        const content = typeof m.content === 'string' ? m.content : '';
        return content.length > COMPACTION_CONFIG.OVERSIZED_MESSAGE_THRESHOLD;
      });

      if (!hasOversizedMessages && (!messages || messages.length < COMPACTION_CONFIG.MIN_MESSAGES_FOR_COMPACTION)) {
        this.logger.debug(`Compaction skipped: too few messages (${messages?.length || 0}) for agent ${agentId}`);
        if (ENABLE_COMPACT_DEBUG) {
          console.log('[COMPACT-SKIPPED]', { agentId, reason: 'Too few messages', messageCount: messages?.length || 0, minRequired: COMPACTION_CONFIG.MIN_MESSAGES_FOR_COMPACTION });
        }
        return { shouldContinue: true }; // Conversation too short to compact
      }

      // Count current tokens using AI response metadata (system prompt included)
      const currentTokens = this.tokenCountingService.getConversationTokenCount(
        messages,
        targetModel,
        agent.systemPrompt
      );

      // Get model specifications
      const contextWindow = this.tokenCountingService.getModelContextWindow(targetModel);
      const maxOutputTokens = this.tokenCountingService.getModelMaxOutputTokens(targetModel);

      if (ENABLE_COMPACT_DEBUG) {
        console.log('[COMPACT-TOKEN-COUNT]', {
          agentId,
          currentTokens,
          maxOutputTokens,
          contextWindow,
          model: targetModel,
          countingMode: 'response-data-based'
        });
      }

      // Check if compaction is needed
      const threshold = agent.compactionThreshold || COMPACTION_CONFIG.DEFAULT_THRESHOLD;
      const shouldCompact = this.tokenCountingService.shouldTriggerCompaction(
        currentTokens,
        maxOutputTokens,
        contextWindow,
        threshold
      );

      if (ENABLE_COMPACT_DEBUG) {
        const requiredTokens = currentTokens + maxOutputTokens;
        const thresholdTokens = threshold * contextWindow;
        console.log('[COMPACT-TRIGGER-CHECK]', {
          agentId,
          currentTokens,
          maxOutputTokens,
          requiredTokens,
          contextWindow,
          threshold,
          thresholdTokens,
          shouldCompact,
          formula: `${currentTokens} + ${maxOutputTokens} = ${requiredTokens} ${shouldCompact ? '>=' : '<'} ${thresholdTokens} (${threshold * 100}% of ${contextWindow})`,
          decision: shouldCompact ? 'TRIGGER COMPACTION' : 'SKIP - below threshold'
        });
      }

      if (!shouldCompact) {
        if (ENABLE_COMPACT_DEBUG) {
          console.log('[COMPACT-SKIPPED]', { agentId, reason: 'Below threshold', utilizationPct: ((currentTokens + maxOutputTokens) / contextWindow * 100).toFixed(1) });
        }
        return { shouldContinue: true }; // No compaction needed
      }

      this.logger.info(`Compaction triggered for agent ${agentId}`, {
        currentTokens,
        contextWindow,
        threshold: `${(threshold * 100).toFixed(0)}%`,
        utilization: `${((currentTokens + maxOutputTokens) / contextWindow * 100).toFixed(1)}%`,
        targetModel
      });

      if (ENABLE_COMPACT_DEBUG) {
        console.log('[COMPACT-TRIGGERED]', {
          agentId,
          reason: 'Threshold exceeded',
          currentTokens,
          maxOutputTokens,
          requiredTokens: currentTokens + maxOutputTokens,
          contextWindow,
          threshold,
          utilizationPct: ((currentTokens + maxOutputTokens) / contextWindow * 100).toFixed(1)
        });
      }

      // Mark compaction in progress
      this.compactionInProgress.set(agentId, COMPACTION_STATUS.STARTING);

      // Broadcast compaction started event
      this.broadcastCompactionEvent(agentId, sessionId, {
        status: COMPACTION_STATUS.STARTING,
        currentTokens,
        targetTokens: this.tokenCountingService.calculateTargetTokenCount(contextWindow),
        contextWindow,
        model: targetModel
      });

      // Always use summarization — multi-pass is handled inside compaction service
      const currentModel = agent.currentModel;
      const isModelSwitch = currentModel && currentModel !== targetModel;

      // Update status to in-progress
      this.compactionInProgress.set(agentId, COMPACTION_STATUS.IN_PROGRESS);
      this.broadcastCompactionEvent(agentId, sessionId, {
        status: COMPACTION_STATUS.IN_PROGRESS,
        strategy: COMPACTION_STRATEGIES.SUMMARIZATION,
        messageCount: messages.length
      });

      // Final sync before compaction: catch any messages that arrived AFTER the early pre-check
      // sync but BEFORE compaction starts (e.g., tool results completing during threshold decision).
      if (metadata.isCompacted) {
        const syncResult = await this.agentPool.syncPendingMessages(agentId, modelToCheck);
        if (syncResult.synced > 0) {
          this.logger.info(`Pre-compaction sync: ${syncResult.synced} additional messages synced`, {
            agentId,
            modelToCheck
          });
          const updatedMetadata = await this.agentPool.getCompactionMetadata(agentId, modelToCheck);
          messages = updatedMetadata.compactedMessages;
        }
      }

      // Record message count BEFORE compaction starts.
      // This is the watermark: messages at indices < this count are considered "already compacted".
      // Messages added DURING compaction (e.g., user messages via WebSocket while the
      // summarization API call is in flight) will be at indices >= this count, and will be
      // detected as "new" by getMessagesForAI's sync logic after compaction completes.
      const preCompactionMessageCount = agent.conversations[targetModel]?.messages?.length || 0;

      // Gather compacted conversations for model-switch scenarios
      const compactedConversations = isModelSwitch
        ? this._gatherCompactedConversations(agent)
        : null;

      // Single call — multi-pass retry is now inside the compaction service
      const compactionResult = await this.compactionService.compactConversation(
        messages,
        currentModel || targetModel,
        targetModel,
        {
          targetTokenCount: this.tokenCountingService.calculateTargetTokenCount(contextWindow),
          sessionId,
          compactedConversations,
          onRetryAttempt: (retryInfo) => {
            this.broadcastCompactionEvent(agentId, sessionId, {
              status: 'retrying',
              message: retryInfo.message,
              attempt: retryInfo.attempt,
              totalModels: retryInfo.totalModels
            });
          },
          onAllModelsExhausted: (errorInfo) => {
            this.broadcastCompactionEvent(agentId, sessionId, {
              type: 'compaction_models_exhausted',
              status: 'warning',
              message: errorInfo.message,
              modelsAttempted: errorInfo.models,
              error: errorInfo.error
            });
          }
        }
      );

      // Update AgentPool with compacted messages — pass pre-compaction watermark
      await this.agentPool.updateCompactedMessages(agentId, targetModel, compactionResult, preCompactionMessageCount);

      if (ENABLE_COMPACT_DEBUG) {
        console.log('[COMPACT-COMPLETED]', {
          agentId,
          strategy: compactionResult.strategy,
          originalMessageCount: compactionResult.originalMessages?.length || 0,
          compactedMessageCount: compactionResult.compactedMessages?.length || 0,
          originalTokens: compactionResult.originalTokenCount,
          compactedTokens: compactionResult.compactedTokenCount,
          reductionPercent: compactionResult.reductionPercent.toFixed(1),
          executionTimeMs: compactionResult.executionTime,
          model: targetModel
        });
      }

      this.logger.info(`Compaction completed for agent ${agentId}`, {
        strategy: compactionResult.strategy,
        originalTokens: compactionResult.originalTokenCount,
        compactedTokens: compactionResult.compactedTokenCount,
        reduction: `${compactionResult.reductionPercent.toFixed(1)}%`,
        executionTime: `${compactionResult.executionTime}ms`
      });

      // Update status to completed
      this.compactionInProgress.delete(agentId);
      this.broadcastCompactionEvent(agentId, sessionId, {
        status: COMPACTION_STATUS.COMPLETED,
        originalTokens: compactionResult.originalTokenCount,
        compactedTokens: compactionResult.compactedTokenCount,
        reductionPercent: compactionResult.reductionPercent,
        strategy: compactionResult.strategy,
        executionTime: compactionResult.executionTime
      });

      return { shouldContinue: true, compactionPerformed: true };

    } catch (error) {
      this.logger.error(`Compaction failed for agent ${agentId}`, {
        error: error.message,
        stack: error.stack
      });

      // Update status to failed
      this.compactionInProgress.delete(agentId);
      this.broadcastCompactionEvent(agentId, sessionId, {
        status: COMPACTION_STATUS.FAILED,
        error: error.message
      });

      // Don't block AI request on compaction failure
      return { shouldContinue: true, error: error.message };
    }
  }

  /**
   * Gather compacted conversations from all model conversations for an agent.
   * Used during model switching to find the best existing conversation.
   * @param {Object} agent - Agent object with conversations
   * @returns {Map|null} Map of modelId → compactedMessages, or null
   * @private
   */
  _gatherCompactedConversations(agent) {
    if (!agent.conversations) return null;

    const result = new Map();
    for (const [modelId, conv] of Object.entries(agent.conversations)) {
      if (modelId === 'full') continue;
      // Use compactizedMessages (correct field name) if available, otherwise messages
      const msgs = conv.compactizedMessages || conv.messages;
      if (Array.isArray(msgs) && msgs.length > 0) {
        result.set(modelId, msgs);
      }
    }

    return result.size > 0 ? result : null;
  }

  /**
   * Broadcast compaction event to UI
   * @param {string} agentId - Agent ID
   * @param {string} sessionId - Session ID
   * @param {Object} data - Event data
   * @private
   */
  broadcastCompactionEvent(agentId, sessionId, data) {
    if (!this.webSocketManager || !this.webSocketManager.broadcastToSession) {
      return;
    }

    this.webSocketManager.broadcastToSession(sessionId, {
      type: 'compaction_event',
      data: {
        agentId,
        timestamp: new Date().toISOString(),
        ...data
      }
    });
  }

  /**
   * Get AI response for agent with proper error handling
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object|null>} AI response or null if failed
   * @private
   */
  async getAgentAIResponse(agentId) {
    try {
      const agent = await this.agentPool.getAgent(agentId);
      if (!agent) return null;

      const conversationHistory = agent.conversations?.full?.messages || [];

      // Get the session ID from the session map, agent's stored sessionId, or any active session
      let sessionId = this.getAgentSession(agentId) || agent.sessionId;

      // Fallback: if this agent has no session (e.g., activated by inter-agent message
      // from a different session), borrow a session from any other registered agent.
      // This is safe because sessions are only used for API key resolution.
      if (!sessionId && this.agentSessionMap.size > 0) {
        const fallbackSession = this.agentSessionMap.values().next().value;
        if (fallbackSession) {
          sessionId = fallbackSession;
          this.registerAgentSession(agentId, sessionId);
          this.logger.info(`Agent ${agentId} borrowed session from pool for API key resolution`, {
            agentName: agent.name,
            borrowedSessionId: sessionId
          });
        }
      }

      if (!sessionId) {
        this.logger.error(`Agent ${agentId} has no session ID - API key resolution will fail`, {
          agentName: agent.name,
          agentSessionId: agent.sessionId,
          sessionMapHas: this.agentSessionMap.has(agentId),
          totalSessions: this.agentSessionMap.size
        });
        // Return null to avoid making requests that will fail
        return null;
      }
      
      // DYNAMIC ROUTING: Check if agent has dynamic model routing enabled
      let targetModel = agent.currentModel;

      // DEFENSIVE: Ensure targetModel is set, fallback to preferredModel if currentModel is undefined
      if (!targetModel) {
        this.logger.warn(`Agent ${agentId} has no currentModel set, using preferredModel as fallback`, {
          agentId,
          preferredModel: agent.preferredModel,
          availableConversations: Object.keys(agent.conversations || {})
        });

        // Notify user via WebSocket
        if (this.webSocketManager && sessionId) {
          this.webSocketManager.broadcastToSession(sessionId, {
            type: 'agent_warning',
            agentId,
            agentName: agent.name,
            message: 'Agent model configuration restored',
            details: `Agent "${agent.name}" had no currentModel set. Automatically restored to ${agent.preferredModel || 'default model'}.`,
            severity: 'warning',
            timestamp: new Date().toISOString()
          });
        }

        targetModel = agent.preferredModel;

        // Update agent's currentModel to preferredModel for future iterations
        if (targetModel) {
          agent.currentModel = targetModel;
          await this.agentPool.persistAgentState(agentId);
          this.logger.info(`Set agent currentModel to ${targetModel}`);
        } else {
          this.logger.error(`Agent ${agentId} has no preferredModel or currentModel, cannot continue`);

          // Notify user of critical error
          if (this.webSocketManager && sessionId) {
            this.webSocketManager.broadcastToSession(sessionId, {
              type: 'agent_error',
              agentId,
              agentName: agent.name,
              message: 'Agent model configuration error',
              details: `Agent "${agent.name}" has no valid model configuration. Cannot process messages.`,
              severity: 'error',
              timestamp: new Date().toISOString()
            });
          }

          return null;
        }
      }

      if (agent.dynamicModelRouting && this.modelRouterService) {
        try {
          // Get the last user message for routing decision
          const lastUserMessage = [...conversationHistory].reverse().find(m => m.role === 'user');
          
          if (lastUserMessage) {
            // Get available models from ModelsService
            let availableModels = [];
            if (this.modelsService) {
              try {
                this.logger.debug('ModelsService type check', {
                  hasModelsService: !!this.modelsService,
                  type: typeof this.modelsService,
                  methods: Object.getOwnPropertyNames(Object.getPrototypeOf(this.modelsService))
                });
                
                // Try to get models, if empty/stale, fetch with current sessionId
                let allModels = this.modelsService.getModels();
                
                // Check if models need refresh (safer check)
                const needsRefresh = !this.modelsService.lastFetched || 
                                   (this.modelsService.lastFetched && 
                                    (Date.now() - new Date(this.modelsService.lastFetched).getTime()) > (5 * 60 * 1000));
                
                if (!allModels || allModels.length === 0 || needsRefresh) {
                  this.logger.info('Models list empty or stale, fetching from backend with sessionId');
                  await this.modelsService.fetchModels({ sessionId });
                  allModels = this.modelsService.getModels();
                }
                
                // Filter to only include models that are available (not router models)
                availableModels = allModels
                  .filter(model => model.id !== 'autopilot-model-router' && model.name !== 'autopilot-model-router');
                  
                this.logger.debug(`Available models for routing: ${availableModels.map(m => m.id || m.name).join(', ')}`);
              } catch (error) {
                this.logger.warn(`Failed to get available models for routing: ${error.message}`);
              }
            }
            
            const routingResult = await this.modelRouterService.routeMessage(
              lastUserMessage.content,
              conversationHistory.slice(-5), // Last 5 messages for context
              agent.currentModel,
              availableModels, // Pass actual available models
              { agentId, sessionId, routingStrategy: agent.routingStrategy }
            );
            
            this.logger.info('Routing result analysis', {
              selectedModel: routingResult.selectedModel,
              currentModel: agent.currentModel,
              areEqual: routingResult.selectedModel === agent.currentModel,
              willSwitch: routingResult.selectedModel && routingResult.selectedModel !== agent.currentModel
            });
            
            if (routingResult.selectedModel && routingResult.selectedModel !== agent.currentModel) {
              this.logger.info(`Dynamic routing: switching from ${agent.currentModel} to ${routingResult.selectedModel}`, {
                agentId,
                reason: routingResult.reasoning
              });
              
              targetModel = routingResult.selectedModel;
              
              // Update agent's current model
              agent.currentModel = targetModel;
              await this.agentPool.persistAgentState(agentId);
              
              this.logger.info(`Model updated: targetModel=${targetModel}, agent.currentModel=${agent.currentModel}`);
            } else {
              this.logger.info('No model switch needed', {
                selectedModel: routingResult.selectedModel,
                currentModel: agent.currentModel,
                hasSelectedModel: !!routingResult.selectedModel
              });
            }
          }
        } catch (routingError) {
          this.logger.warn(`Dynamic routing failed, using current model: ${routingError.message}`);
          // Fall back to current model on routing failure
        }
      }
      
      this.logger.info(`About to send message to model: ${targetModel}`, {
        agentId,
        targetModel,
        originalModel: agent.currentModel
      });

      // PHASE 4: Check and perform compaction if needed BEFORE sending to AI
      const compactionResult = await this.checkAndPerformCompaction(agentId, targetModel, sessionId);

      if (!compactionResult.shouldContinue) {
        this.logger.warn(`Compaction check returned shouldContinue=false for agent ${agentId}`);
        return null;
      }

      if (compactionResult.compactionPerformed) {
        this.logger.info(`Compaction performed for agent ${agentId}, proceeding with AI request`);
      }

      // After compaction, retrieve messages from AgentPool (will use compacted if available)
      const messagesToSend = await this.agentPool.getMessagesForAI(agentId, targetModel);

      // Inject TaskManager instructions for AGENT mode
      let enhancedSystemPrompt = agent.systemPrompt;
      if (agent.mode === AGENT_MODES.AGENT) {
        const taskManagerInstruction = "\n\nIMPORTANT: You are in AGENT mode. The use of TaskManager tool is mandatory.\n\n" +
          "TASK LIFECYCLE (follow this, don't improvise):\n" +
          "  1. If your task list is empty, your FIRST TaskManager call must be `sync` with your complete plan as a single call. " +
          "Don't `create` tasks one at a time at the start — use `sync` once to establish the whole plan.\n" +
          "  2. Then process tasks one at a time: `update` the next task to `in_progress`, do the work with other tools, " +
          "`update` it to `completed`, move on. The scheduler enforces at most one task `in_progress` at a time.\n" +
          "  3. If you discover new work mid-execution, `create` a single new task, or issue another `sync` when the plan materially changes. " +
          "Don't `sync` every turn — prefer targeted `update`/`create` unless the plan itself shifted.\n" +
          "  4. When every task is `completed`, call the `jobdone` tool.\n\n" +
          "Update the user about task-list status periodically. While in agent mode: no thank-you's, no compliments, " +
          "no rhetorical questions, no self-commentary — stay focused on executing tasks. " +
          "Only ask questions through dedicated tools designed for user interaction (if available).";
        enhancedSystemPrompt = (agent.systemPrompt || '') + taskManagerInstruction;

        // Note: Consecutive no-tool reminders are now sent as tool results (see _processAIResponse)
      }

      // Inject dynamic file attachment context
      try {
        const fileAttachmentContext = await this.contextInjectionService.buildDynamicContext(agentId);
        if (fileAttachmentContext) {
          enhancedSystemPrompt = (enhancedSystemPrompt || '') + fileAttachmentContext;
          this.logger.debug(`Injected file attachment context for agent ${agentId}`, {
            contextLength: fileAttachmentContext.length
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to inject file attachment context for agent ${agentId}`, {
          error: error.message
        });
        // Continue without file attachments if service fails
      }

      // Inject system environment constraints (reserved ports, process safety)
      const systemConstraints = this.contextInjectionService.buildSystemConstraints();
      if (systemConstraints) {
        enhancedSystemPrompt = (enhancedSystemPrompt || '') + systemConstraints;
      }

      // Inject current local time. Re-evaluated every turn so the agent
      // always sees the wall-clock time the model is answering at — useful
      // for time-sensitive reasoning (cron expressions, "schedule for
      // tomorrow morning", "is it past business hours?", etc.).
      const timeContext = this.contextInjectionService.buildCurrentTimeContext();
      if (timeContext) {
        enhancedSystemPrompt = (enhancedSystemPrompt || '') + timeContext;
      }

      // Inject external-channel routing guidance ONLY when the agent has
      // at least one live bridge. Pulls the per-channel alias list from
      // each service so the agent can address specific channels/threads
      // via `<external to="alias">`. When the agent isn't bridged the
      // paragraph is omitted — no point teaching routing for listeners
      // that aren't there. Filter + alias matching logic live in
      // services/channelFilter.js so this block stays declarative.
      try {
        const activeChannels = [];
        if (typeof this.discordService?.getBridgedChannels === 'function') {
          activeChannels.push(...this.discordService.getBridgedChannels(agentId));
        }
        if (typeof this.telegramService?.getBridgedChannels === 'function') {
          activeChannels.push(...this.telegramService.getBridgedChannels(agentId));
        }
        if (activeChannels.length > 0) {
          const { getExternalChannelPromptGuidance } = await import('../services/channelFilter.js');
          const guidance = getExternalChannelPromptGuidance(activeChannels);
          if (guidance) enhancedSystemPrompt = (enhancedSystemPrompt || '') + guidance;
        }
      } catch (err) {
        this.logger.warn('[external-routing] failed to inject <external> guidance', { agentId, error: err.message });
      }

      // Inject flow execution context if this is part of a flow
      try {
        const lastUserMsg = [...conversationHistory].reverse().find(m => m.role === 'user');
        if (lastUserMsg?.isFlowExecution && lastUserMsg?.flowMetadata) {
          // Phase 8: when running inside a flow, by default REPLACE the
          // agent's persisted system prompt with a flow-worker prompt
          // built from the node's role + contract. This prevents the
          // agent's native identity (e.g. "you are a software developer")
          // from fighting the flow's structured-output requirements.
          //
          // Opt-out: if the flow node sets useNativeSystemPrompt:true OR
          // the node has no instructions/outputs to assert, fall back
          // to legacy append-context behavior so v1 flows + curated
          // single-purpose agents still work as before.
          const opt = lastUserMsg.nodeContract?.useNativeSystemPrompt === true;
          const replacement = opt ? null : this.flowContextService.buildFlowAgentSystemPrompt(
            lastUserMsg.flowMetadata,
            lastUserMsg.previousAgentData,
            lastUserMsg.nodeContract
          );

          if (replacement) {
            // REPLACE mode — the flow node's role becomes the agent's
            // identity for this turn. Agent's persisted prompt is
            // intentionally discarded for this invocation only.
            enhancedSystemPrompt = replacement;
            this.logger.info(`Replaced system prompt with flow-worker prompt for agent ${agentId}`, {
              flowName: lastUserMsg.flowMetadata.flowName,
              nodePosition: `${lastUserMsg.flowMetadata.nodePosition}/${lastUserMsg.flowMetadata.totalNodes}`,
              hasPreviousAgent: !!lastUserMsg.previousAgentData,
              promptLength: replacement.length,
            });
          } else {
            // APPEND mode (legacy) — used for v1 flows + opt-out cases.
            const flowContext = this.flowContextService.buildFlowAgentContext(
              lastUserMsg.flowMetadata,
              lastUserMsg.previousAgentData,
              lastUserMsg.nodeContract
            );
            if (flowContext) {
              enhancedSystemPrompt = (enhancedSystemPrompt || '') + flowContext;
              this.logger.info(`Appended flow execution context for agent ${agentId}`, {
                flowName: lastUserMsg.flowMetadata.flowName,
                nodePosition: `${lastUserMsg.flowMetadata.nodePosition}/${lastUserMsg.flowMetadata.totalNodes}`,
                hasPreviousAgent: !!lastUserMsg.previousAgentData
              });
            }
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to inject flow execution context for agent ${agentId}`, {
          error: error.message
        });
        // Continue without flow context if service fails
      }

      // Check if streaming is enabled - consider both agent config and user message preference
      // Get the last user message to check for streaming preference
      const lastUserMsg = [...conversationHistory].reverse().find(m => m.role === 'user');
      const userStreamingPref = lastUserMsg?.streamingEnabled;
      // Use user preference if explicitly set, otherwise use agent config
      const streamingEnabled = userStreamingPref !== undefined
        ? userStreamingPref !== false
        : agent.streamingEnabled !== false; // Default to true

      // Native function-call tools for the agent's enabled capabilities.
      // Passed as `options.tools` to the backend. For Responses-API models
      // (codex/o-series/gpt-5-pro) the backend forwards these to Azure so
      // the model can emit native function_call events; the backend converts
      // them back into the CLI's inline JSON-block format on the wire. For
      // chat-completion models the backend ignores this field and the model
      // uses the system prompt's inline-JSON instructions as before.
      const toolSchemas = getToolSchemasForAgent(agent.capabilities || []);

      if (streamingEnabled && this.aiService.sendMessageStream) {
        // Build flow context if this is part of a flow execution
        const flowContext = lastUserMsg?.isFlowExecution ? {
          flowRunId: lastUserMsg.flowRunId,
          flowNodeId: lastUserMsg.flowNodeId
        } : null;

        // Use streaming response
        return await this._getStreamingResponse(
          agentId,
          targetModel,
          messagesToSend,
          enhancedSystemPrompt,
          sessionId,
          flowContext,
          toolSchemas
        );
      }

      // Non-streaming fallback — same watchdog idea as streaming, but with no
      // "first chunk" escape (the call is opaque). If the provider doesn't
      // return a full response within the timeout, abort.
      let nonStreamTimer = setTimeout(() => {
        nonStreamTimer = null;
        this.logger.warn(`Agent ${agentId} - no response within ${SCHEDULER_CONFIG.AI_PRESTREAM_TIMEOUT_MS}ms for model ${targetModel} (non-streaming), aborting`, {
          agentId,
          model: targetModel,
          timeoutMs: SCHEDULER_CONFIG.AI_PRESTREAM_TIMEOUT_MS
        });
        try {
          this.aiService?.abortRequest?.(agentId);
        } catch (abortErr) {
          this.logger.warn(`Agent ${agentId} - abort on non-streaming timeout failed: ${abortErr.message}`);
        }
      }, SCHEDULER_CONFIG.AI_PRESTREAM_TIMEOUT_MS);

      try {
        const response = await this.aiService.sendMessage(
          targetModel,
          messagesToSend,
          {
            agentId: agentId,
            systemPrompt: enhancedSystemPrompt,
            sessionId: sessionId,
            tools: toolSchemas && toolSchemas.length > 0 ? toolSchemas : undefined,
          }
        );

        return response;
      } finally {
        if (nonStreamTimer !== null) {
          clearTimeout(nonStreamTimer);
          nonStreamTimer = null;
        }
      }
      
    } catch (error) {
      this.logger.error(`AI response failed for agent ${agentId}:`, error);
      
      // Handle different types of AI service failures
      await this.handleAIServiceFailure(agentId, error);
      
      return null;
    }
  }

  /**
   * Get AI response using streaming with WebSocket broadcast
   * @param {string} agentId - Agent ID
   * @param {string} targetModel - Model to use
   * @param {Array}  messagesToSend - Messages to send
   * @param {string} systemPrompt - System prompt
   * @param {string} sessionId - Session ID for WebSocket
   * @param {Object} flowContext - Optional flow execution context
   * @returns {Promise<Object>} Response object
   * @private
   */
  async _getStreamingResponse(agentId, targetModel, messagesToSend, systemPrompt, sessionId, flowContext = null, tools = null) {
    // Generate a unique message ID for this streaming response
    const streamMessageId = `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Flow progress tracking
    let flowProgress = null;
    if (flowContext) {
      flowProgress = {
        charactersStreamed: 0,
        chunkCount: 0,
        lastBroadcast: Date.now(),
        flowRunId: flowContext.flowRunId,
        flowNodeId: flowContext.flowNodeId
      };
    }

    // Broadcast stream start event
    this._broadcastStreamEvent(sessionId, {
      type: 'stream_start',
      agentId,
      messageId: streamMessageId,
      model: targetModel,
      timestamp: new Date().toISOString(),
      // Include flow context if present
      ...(flowContext && {
        flowRunId: flowContext.flowRunId,
        flowNodeId: flowContext.flowNodeId
      })
    });

    // Pre-stream watchdog: abort the request if no bytes arrive before the
    // timeout elapses. Cleared by onChunk on the first chunk — active streaming
    // is proof of life, and a live stream should not be killed mid-response.
    let prestreamTimer = setTimeout(() => {
      prestreamTimer = null;
      this.logger.warn(`Agent ${agentId} - no streaming chunk within ${SCHEDULER_CONFIG.AI_PRESTREAM_TIMEOUT_MS}ms for model ${targetModel}, aborting`, {
        agentId,
        model: targetModel,
        timeoutMs: SCHEDULER_CONFIG.AI_PRESTREAM_TIMEOUT_MS
      });
      try {
        this.aiService?.abortRequest?.(agentId);
      } catch (abortErr) {
        this.logger.warn(`Agent ${agentId} - abort on prestream timeout failed: ${abortErr.message}`);
      }
    }, SCHEDULER_CONFIG.AI_PRESTREAM_TIMEOUT_MS);
    const clearPrestreamTimer = () => {
      if (prestreamTimer !== null) {
        clearTimeout(prestreamTimer);
        prestreamTimer = null;
      }
    };

    try {
      const response = await this.aiService.sendMessageStream(
        targetModel,
        messagesToSend,
        {
          agentId: agentId,
          systemPrompt: systemPrompt,
          sessionId: sessionId,
          tools: tools && tools.length > 0 ? tools : undefined,
          onChunk: (chunk) => {
            // First chunk — clear the prestream watchdog. Active streaming means
            // the model is responsive; we don't want to cut a live stream off.
            clearPrestreamTimer();

            // Normalize chunk to string — some providers (Ollama) send {content, type} objects
            const chunkText = typeof chunk === 'string' ? chunk : (chunk?.content || chunk?.text || String(chunk));

            // Update flow progress if in flow execution
            if (flowProgress) {
              flowProgress.charactersStreamed += chunkText.length;
              flowProgress.chunkCount++;

              // Broadcast flow progress every 500ms or 50 chunks
              const now = Date.now();
              if (now - flowProgress.lastBroadcast > 500 || flowProgress.chunkCount % 50 === 0) {
                this._broadcastFlowProgress(sessionId, agentId, flowProgress);
                flowProgress.lastBroadcast = now;
              }
            }

            // Broadcast each chunk to the UI
            this._broadcastStreamEvent(sessionId, {
              type: 'stream_chunk',
              agentId,
              messageId: streamMessageId,
              content: chunkText,
              timestamp: new Date().toISOString(),
              // Include flow context if present
              ...(flowContext && {
                flowRunId: flowContext.flowRunId,
                flowNodeId: flowContext.flowNodeId
              })
            });
          },
          onDone: (result) => {
            // Final flow progress broadcast
            if (flowProgress) {
              this._broadcastFlowProgress(sessionId, agentId, flowProgress, true);
            }

            // Broadcast stream completion. Reasoning fields are included
            // only when present so non-reasoning models' broadcasts stay
            // minimal; the web-UI treats undefined/empty as "no thinking
            // panel to render." See utilities/reasoningContext patterns.
            const streamCompleteEvent = {
              type: 'stream_complete',
              agentId,
              messageId: streamMessageId,
              content: result.content,
              usage: result.usage,
              model: result.model || targetModel,
              finishReason: result.finishReason,
              timestamp: new Date().toISOString(),
              // Include flow context if present
              ...(flowContext && {
                flowRunId: flowContext.flowRunId,
                flowNodeId: flowContext.flowNodeId
              })
            };
            if (typeof result.reasoning === 'string' && result.reasoning.length > 0) {
              streamCompleteEvent.reasoning = result.reasoning;
            }
            if (Number.isFinite(result.reasoningTokens) && result.reasoningTokens > 0) {
              streamCompleteEvent.reasoningTokens = result.reasoningTokens;
            }
            this._broadcastStreamEvent(sessionId, streamCompleteEvent);
          },
          onError: (error) => {
            // Check if this is a model-related error that should show suggestions
            const isModelError = this.aiService?.isModelRelatedError?.(error);
            const modelSuggestions = isModelError && this.aiService?.getModelSuggestions?.(targetModel, error);

            // Broadcast stream error with model suggestions if applicable
            this._broadcastStreamEvent(sessionId, {
              type: isModelError ? 'model_error' : 'stream_error',
              agentId,
              messageId: streamMessageId,
              error: error.message,
              model: targetModel,
              timestamp: new Date().toISOString(),
              // Include model suggestions for model-related errors
              ...(modelSuggestions && { modelSuggestions }),
              // Include flow context if present
              ...(flowContext && {
                flowRunId: flowContext.flowRunId,
                flowNodeId: flowContext.flowNodeId
              })
            });
          }
        }
      );

      // Defensive: clear the watchdog if no chunks arrived but the call resolved
      // (providers returning empty completions shouldn't leave a dangling timer).
      clearPrestreamTimer();

      this.logger.info(`Streaming response completed for agent ${agentId}`, {
        contentLength: response.content?.length || 0,
        model: response.model,
        ...(flowProgress && { flowCharsStreamed: flowProgress.charactersStreamed })
      });

      return response;

    } catch (error) {
      // Always clear the watchdog on error — whether this error IS the timeout
      // (we already fired abortRequest inside the timer callback) or an unrelated
      // failure. Either way we don't want a zombie timer.
      clearPrestreamTimer();

      // Check if this is a model-related error that should show suggestions
      const isModelError = this.aiService?.isModelRelatedError?.(error);
      const modelSuggestions = isModelError && this.aiService?.getModelSuggestions?.(targetModel, error);

      // Broadcast error event with model suggestions if applicable
      this._broadcastStreamEvent(sessionId, {
        type: isModelError ? 'model_error' : 'stream_error',
        agentId,
        messageId: streamMessageId,
        error: error.message,
        model: targetModel,
        timestamp: new Date().toISOString(),
        // Include model suggestions for model-related errors
        ...(modelSuggestions && { modelSuggestions }),
        // Include flow context if present
        ...(flowContext && {
          flowRunId: flowContext.flowRunId,
          flowNodeId: flowContext.flowNodeId
        })
      });

      throw error;
    }
  }

  /**
   * Broadcast flow node progress event
   * @param {string} sessionId - Session ID
   * @param {string} agentId - Agent ID
   * @param {Object} progress - Progress data
   * @param {boolean} isFinal - Whether this is the final progress update
   * @private
   */
  _broadcastFlowProgress(sessionId, agentId, progress, isFinal = false) {
    if (!this.webSocketManager) return;

    try {
      this.webSocketManager.broadcastToSession(sessionId, {
        type: 'flow_update',
        data: {
          type: 'flow_node_progress',
          runId: progress.flowRunId,
          nodeId: progress.flowNodeId,
          agentId,
          charactersStreamed: progress.charactersStreamed,
          chunkCount: progress.chunkCount,
          isFinal,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.warn('Failed to broadcast flow progress', { error: error.message });
    }
  }

  /**
   * Broadcast streaming event via WebSocket
   * @param {string} sessionId - Session ID
   * @param {Object} eventData - Event data to broadcast
   * @private
   */
  _broadcastStreamEvent(sessionId, eventData) {
    if (this.webSocketManager && this.webSocketManager.broadcastToSession) {
      this.webSocketManager.broadcastToSession(sessionId, {
        type: eventData.type,
        data: eventData
      });
    }
  }

  /**
   * Handle AI service failures with appropriate recovery strategies
   * @param {string} agentId - Agent ID that failed
   * @param {Error} error - The error that occurred
   * @private
   */
  async handleAIServiceFailure(agentId, error) {
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) return;

    const sessionId = this.getAgentSession(agentId) || agent.sessionId || 'scheduler-session';

    // PRIORITY: Handle timeout errors that should return to chat mode
    if (error.shouldReturnToChat || error.isTimeout) {
      this.logger.warn(`Agent ${agentId} returning to chat mode due to timeout`, {
        errorMessage: error.message,
        status: error.status
      });

      // Flip mode → CHAT via the central helper so the transition gets
      // captured in _modeTransitionHistory with a natural-language reason.
      // elapsedSec is best-effort; many timeout errors don't carry timing.
      const elapsedSec = Number.isFinite(error.elapsedMs)
        ? Math.round(error.elapsedMs / 1000)
        : 60;   // SCHEDULER_CONFIG's default AI-call watchdog window
      await this._transitionMode(agentId, AGENT_MODES.CHAT, 'ai-request-timeout', { elapsedSec });

      // Toast-only notification (separate event so the UI can render a
      // corner toast in addition to the mode-change indicator).
      if (this.webSocketManager && this.webSocketManager.broadcastToSession) {
        this.webSocketManager.broadcastToSession(sessionId, {
          type: 'agent_timeout',
          data: {
            agentId: agentId,
            agentName: agent.name,
            action: 'returned_to_chat',
            timestamp: new Date().toISOString()
          }
        });
      }

      return; // Don't proceed with other error handling
    }

    // Determine failure type and response
    const errorMessage = error.message?.toLowerCase() || '';

    if (errorMessage.includes('api key') || errorMessage.includes('authentication')) {
      // API key issues - pause agent to prevent infinite retries
      this.logger.warn(`Agent ${agentId} paused due to API key issue`);

      agent.delayEndTime = new Date(Date.now() + SCHEDULER_CONFIG.API_KEY_ERROR_DELAY_MS).toISOString();
      await this.agentPool.persistAgentState(agentId);
      await this.broadcastAgentStateUpdate(agentId, 'api-key-error');

      // Add error message to agent's queue
      await this.agentPool.addToolResult(agentId, {
        toolId: 'system-error',
        status: 'failed',
        error: 'API key authentication failed. Please check your API key configuration in Settings.',
        timestamp: new Date().toISOString()
      });

    } else if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
      // Rate limit - delay agent
      this.logger.warn(`Agent ${agentId} delayed due to rate limiting`);

      agent.delayEndTime = new Date(Date.now() + SCHEDULER_CONFIG.RATE_LIMIT_DELAY_MS).toISOString();
      await this.agentPool.persistAgentState(agentId);
      await this.broadcastAgentStateUpdate(agentId, 'rate-limit');

    } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
      // Network issues (non-timeout) - shorter delay and retry
      this.logger.warn(`Agent ${agentId} delayed due to network issues`);

      agent.delayEndTime = new Date(Date.now() + SCHEDULER_CONFIG.NETWORK_ERROR_DELAY_MS).toISOString();
      await this.agentPool.persistAgentState(agentId);
      await this.broadcastAgentStateUpdate(agentId, 'network-error');

    } else if (this.isTokenLimitError(errorMessage)) {
      // Token/context limit error - trigger emergency compaction and retry
      await this.handleTokenLimitError(agentId, agent, error);
      return; // Don't add error message or broadcast - will retry after compaction

    } else {
      // Unknown error - pause agent and notify
      this.logger.error(`Agent ${agentId} paused due to unknown AI service error: ${error.message}`);

      agent.delayEndTime = new Date(Date.now() + SCHEDULER_CONFIG.UNKNOWN_ERROR_DELAY_MS).toISOString();
      await this.agentPool.persistAgentState(agentId);
      await this.broadcastAgentStateUpdate(agentId, 'server-error');

      // Add error message to agent's queue
      await this.agentPool.addToolResult(agentId, {
        toolId: 'system-error',
        status: 'failed',
        error: `AI service error: ${error.message}. Agent temporarily paused.`,
        timestamp: new Date().toISOString()
      });
    }

    // Broadcast error to UI
    if (this.webSocketManager && this.webSocketManager.broadcastToSession) {
      const sessionId = this.getAgentSession(agentId) || agent.sessionId || 'scheduler-session';
      
      // FIX: Wrap payload in 'data' field to match UI expectations
      this.webSocketManager.broadcastToSession(sessionId, {
        type: 'agent_error',
        data: {
          agentId: agentId,
          error: error.message,
          recovery: 'Agent temporarily paused for recovery',
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  /**
   * Check if error message indicates a token/context limit error
   * @param {string} errorMessage - Lowercased error message
   * @returns {boolean}
   * @private
   */
  isTokenLimitError(errorMessage) {
    const tokenLimitPatterns = [
      'prompt is too long',
      'tokens',
      'context length',
      'context window',
      'maximum context',
      'token limit',
      'max_tokens',
      'context_length_exceeded',
      'maximum.*exceeded'
    ];

    return tokenLimitPatterns.some(pattern => {
      if (pattern.includes('.*')) {
        return new RegExp(pattern).test(errorMessage);
      }
      return errorMessage.includes(pattern);
    });
  }

  /**
   * Handle token limit errors with emergency compaction and retry
   * @param {string} agentId - Agent ID
   * @param {Object} agent - Agent object
   * @param {Error} error - The token limit error
   * @private
   */
  async handleTokenLimitError(agentId, agent, error) {
    const sessionId = this.getAgentSession(agentId) || agent.sessionId || 'scheduler-session';

    // Get or initialize retry tracker for this agent
    let tracker = this.tokenLimitRetryTracker.get(agentId);
    if (!tracker) {
      tracker = { attempts: 0, lastError: '', timestamp: new Date() };
      this.tokenLimitRetryTracker.set(agentId, tracker);
    }

    // Increment retry count
    tracker.attempts++;
    tracker.lastError = error.message;
    tracker.timestamp = new Date();

    this.logger.warn(`Token limit error for agent ${agentId} (attempt ${tracker.attempts}/${this.MAX_TOKEN_LIMIT_RETRIES})`, {
      error: error.message,
      agentName: agent.name
    });

    // Check if we've exceeded max retries
    if (tracker.attempts > this.MAX_TOKEN_LIMIT_RETRIES) {
      this.logger.error(`Agent ${agentId} exceeded max token limit retries, pausing agent`, {
        attempts: tracker.attempts,
        lastError: error.message
      });

      // Clear the retry tracker
      this.tokenLimitRetryTracker.delete(agentId);

      // Now show the error to the user
      agent.delayEndTime = new Date(Date.now() + SCHEDULER_CONFIG.UNKNOWN_ERROR_DELAY_MS).toISOString();
      await this.agentPool.persistAgentState(agentId);
      await this.broadcastAgentStateUpdate(agentId, 'context-limit-exhausted');

      // Broadcast error to UI
      if (this.webSocketManager && this.webSocketManager.broadcastToSession) {
        this.webSocketManager.broadcastToSession(sessionId, {
          type: 'agent_error',
          data: {
            agentId: agentId,
            error: `Context limit exceeded after ${this.MAX_TOKEN_LIMIT_RETRIES} compaction attempts. The conversation may be too large. Consider starting a new conversation.`,
            recovery: 'Agent temporarily paused',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Add a user-friendly error message to the queue
      await this.agentPool.addToolResult(agentId, {
        toolId: 'system-error',
        status: 'failed',
        error: `Context limit exceeded after automatic compaction. The conversation is too large for the current model. Please consider clearing the conversation or switching to a model with larger context window.`,
        timestamp: new Date().toISOString()
      });

      return;
    }

    // Determine compaction strategy based on attempt number
    // Attempt 1: Regular compaction (multi-pass summarization)
    // Attempt 2: Emergency compaction (summarization with lower min messages)
    const useEmergencyCompaction = tracker.attempts >= 2;
    const strategyName = useEmergencyCompaction ? 'emergency' : 'regular';

    this.logger.info(`Triggering ${strategyName} compaction for agent ${agentId} due to token limit error`, {
      attempt: tracker.attempts,
      maxAttempts: this.MAX_TOKEN_LIMIT_RETRIES,
      strategy: strategyName
    });

    // Notify UI that compaction is happening
    this.broadcastCompactionEvent(agentId, sessionId, {
      status: COMPACTION_STATUS.STARTING,
      message: useEmergencyCompaction
        ? 'Emergency compaction triggered'
        : 'Compaction triggered due to context limit',
      emergency: useEmergencyCompaction,
      retryAttempt: tracker.attempts,
      timestamp: new Date().toISOString()
    });

    try {
      const targetModel = agent.currentModel || agent.preferredModel;
      let compactionResult;

      if (useEmergencyCompaction) {
        // Second attempt: emergency compaction with lower minimum messages
        compactionResult = await this.performEmergencyCompaction(agentId, targetModel, sessionId);
      } else {
        // First attempt: regular multi-pass compaction
        compactionResult = await this.checkAndPerformCompaction(agentId, targetModel, sessionId);
        // Convert the result format to match emergency compaction output
        if (compactionResult.compactionPerformed) {
          compactionResult = {
            success: true,
            ...compactionResult
          };
        } else if (compactionResult.shouldContinue) {
          compactionResult = { success: true, skipped: true };
        } else {
          compactionResult = { success: false, error: compactionResult.error };
        }
      }

      if (compactionResult.success) {
        if (compactionResult.skipped) {
          this.logger.info(`Regular compaction skipped for agent ${agentId} (not needed or too few messages)`);
        } else {
          this.logger.info(`${strategyName} compaction successful for agent ${agentId}`, {
            reductionPercent: compactionResult.reductionPercent,
            originalTokens: compactionResult.originalTokenCount,
            compactedTokens: compactionResult.compactedTokenCount
          });
        }

        // Broadcast successful compaction
        this.broadcastCompactionEvent(agentId, sessionId, {
          status: COMPACTION_STATUS.COMPLETED,
          originalTokens: compactionResult.originalTokenCount,
          compactedTokens: compactionResult.compactedTokenCount,
          reductionPercent: compactionResult.reductionPercent,
          strategy: useEmergencyCompaction ? 'emergency_aggressive' : 'regular',
          emergency: useEmergencyCompaction,
          message: compactionResult.skipped
            ? 'Compaction check complete'
            : `Compaction complete. Reduced by ${compactionResult.reductionPercent?.toFixed(1) || 0}%`,
          timestamp: new Date().toISOString()
        });

        // Don't add any delay - the scheduler will naturally retry on next cycle
        this.logger.info(`Agent ${agentId} ready for retry after ${strategyName} compaction`);

      } else {
        this.logger.error(`${strategyName} compaction failed for agent ${agentId}`, {
          error: compactionResult.error
        });

        // Broadcast failed compaction
        this.broadcastCompactionEvent(agentId, sessionId, {
          status: COMPACTION_STATUS.FAILED,
          error: compactionResult.error || `${strategyName} compaction failed`,
          emergency: useEmergencyCompaction,
          timestamp: new Date().toISOString()
        });

        // Will retry on next attempt until max retries reached
      }

    } catch (compactionError) {
      this.logger.error(`${strategyName} compaction threw error for agent ${agentId}`, {
        error: compactionError.message
      });

      this.broadcastCompactionEvent(agentId, sessionId, {
        status: COMPACTION_STATUS.FAILED,
        error: compactionError.message,
        emergency: useEmergencyCompaction,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Perform emergency compaction with more aggressive settings
   * @param {string} agentId - Agent ID
   * @param {string} targetModel - Target model
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Compaction result
   * @private
   */
  async performEmergencyCompaction(agentId, targetModel, sessionId) {
    try {
      const agent = await this.agentPool.getAgent(agentId);
      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      // Get the current conversation
      const modelConversation = agent.conversations[targetModel];
      if (!modelConversation) {
        return { success: false, error: 'No conversation found for model' };
      }

      // CRITICAL: Sync pending messages before reading compactizedMessages.
      // The scheduler's addMessageToConversation only pushes to conversation.messages.
      if (modelConversation.compactizedMessages) {
        const originalLength = modelConversation.messages.length;
        const compactedLength = modelConversation.compactizedMessages.length;
        // SAFETY: Use ?? compactedLength instead of || originalLength to prevent silent message loss
        // when watermark is null (see agentPool.getMessagesForAI for detailed explanation)
        const originalCount = modelConversation.originalMessageCountAtCompaction ?? compactedLength;
        if (originalLength > originalCount) {
          const newCount = originalLength - originalCount;
          const newMessages = modelConversation.messages.slice(-newCount);
          modelConversation.compactizedMessages.push(...newMessages);
          modelConversation.originalMessageCountAtCompaction = originalLength;
          this.logger.info(`Emergency compaction: pre-synced ${newCount} pending messages`, { agentId });
        }
      }

      // Get the messages to compact — use compactizedMessages (correct field name)
      const messages = modelConversation.compactizedMessages || modelConversation.messages;

      // Allow compaction even with few messages if any are oversized
      // (splitting inside compactConversation will create enough messages)
      const hasOversized = messages && messages.some(m => {
        const content = typeof m.content === 'string' ? m.content : '';
        return content.length > COMPACTION_CONFIG.OVERSIZED_MESSAGE_THRESHOLD;
      });

      if (!hasOversized && (!messages || messages.length < 5)) {
        return { success: false, error: 'Not enough messages to compact' };
      }

      // Record watermark BEFORE compaction starts
      const preCompactionMessageCount = modelConversation.messages.length;

      const contextWindow = this.tokenCountingService.getModelContextWindow(targetModel);

      // Use aggressive settings - aim for 50% of context window instead of normal threshold
      const targetTokens = Math.floor(contextWindow * 0.5);

      this.logger.info(`Emergency compaction: targeting ${targetTokens} tokens (50% of ${contextWindow})`, {
        agentId,
        messageCount: messages.length,
        targetModel
      });

      // Call compaction service with summarization (multi-pass handles reduction)
      const compactionResult = await this.compactionService.compactConversation(
        messages,
        targetModel,
        targetModel,
        {
          sessionId,
          agentId,
          emergency: true,
          onRetryAttempt: (retryInfo) => {
            this.broadcastCompactionEvent(agentId, sessionId, {
              status: 'retrying',
              message: retryInfo.message,
              attempt: retryInfo.attempt,
              totalModels: retryInfo.totalModels
            });
          },
          onAllModelsExhausted: (errorInfo) => {
            this.broadcastCompactionEvent(agentId, sessionId, {
              type: 'compaction_models_exhausted',
              status: 'warning',
              message: errorInfo.message,
              modelsAttempted: errorInfo.models,
              error: errorInfo.error
            });
          }
        }
      );

      // Compaction service returns compactedMessages directly (no success flag)
      // Check for compactedMessages array with length > 0 and not skipped
      const compactionSucceeded = compactionResult.compactedMessages?.length > 0 && !compactionResult.skipped;

      if (compactionSucceeded) {
        // Update the agent's conversation — use correct field name: compactizedMessages
        modelConversation.compactizedMessages = compactionResult.compactedMessages;
        modelConversation.originalMessageCountAtCompaction = preCompactionMessageCount;
        modelConversation.lastCompactization = new Date().toISOString();
        modelConversation.compactizationCount = (modelConversation.compactizationCount || 0) + 1;
        modelConversation.compactedTokenCount = compactionResult.compactedTokenCount;
        modelConversation.originalTokenCount = compactionResult.originalTokenCount;

        // Persist the changes
        await this.agentPool.persistAgentState(agentId);

        return {
          success: true,
          originalTokenCount: compactionResult.originalTokenCount,
          compactedTokenCount: compactionResult.compactedTokenCount,
          reductionPercent: compactionResult.reductionPercent
        };
      }

      return { success: false, error: compactionResult.error || 'Compaction returned no messages' };

    } catch (error) {
      this.logger.error(`Emergency compaction error for agent ${agentId}`, {
        error: error.message,
        stack: error.stack
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear token limit retry tracker for an agent (call after successful AI response)
   * @param {string} agentId - Agent ID
   * @private
   */
  clearTokenLimitRetryTracker(agentId) {
    if (this.tokenLimitRetryTracker.has(agentId)) {
      this.tokenLimitRetryTracker.delete(agentId);
      this.logger.debug(`Cleared token limit retry tracker for agent ${agentId}`);
    }
  }

  /**
   * Process AI response and execute any tools.
   *
   * Returns `true` when the conversation actually advanced (either the assistant
   * message was appended or tool calls were queued for async execution), and
   * `false` when the response had empty / whitespace content AND no tool calls.
   * The caller (processAgent) uses this to decide whether to record the
   * pre-cycle state hash — preventing the detectRepetitiveLoop pollution that
   * empty responses would otherwise cause.
   *
   * @param {string} agentId - Agent ID
   * @param {Object} aiResponse - AI service response
   * @returns {Promise<boolean>} true if conversation advanced, false on dropped-empty
   * @private
   */
  async processAIResponse(agentId, aiResponse) {
    // Get the session ID from the session map
    const agent = await this.agentPool.getAgent(agentId);
    const sessionId = this.getAgentSession(agentId) || agent?.sessionId || 'scheduler-session';

    // Safety check: agent must exist
    if (!agent) {
      this.logger.warn(`Cannot process AI response - agent ${agentId} not found`);
      return false;
    }

    // Check if response contains tool calls
    const hasTools = this._hasToolCalls(aiResponse.content);

    // Track consecutive messages without tools (AGENT mode only)
    if (agent && agent.mode === AGENT_MODES.AGENT && SCHEDULER_CONFIG.CONSECUTIVE_NO_TOOL_ENABLED) {
      if (!hasTools) {
        // Increment consecutive no-tool counter
        const currentCount = this.consecutiveNoToolMessages.get(agentId) || 0;
        const newCount = currentCount + 1;
        this.consecutiveNoToolMessages.set(agentId, newCount);
        this.logger.warn(`[NO-TOOL-TRACKER] Agent ${agentId}: ${newCount} consecutive messages without tools (threshold: ${SCHEDULER_CONFIG.CONSECUTIVE_NO_TOOL_THRESHOLD})`);

        // If threshold exceeded, queue a tool result reminder (more noticeable than system prompt)
        if (newCount >= SCHEDULER_CONFIG.CONSECUTIVE_NO_TOOL_THRESHOLD) {
          const toolResultReminder = {
            id: `no-tool-reminder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            toolId: 'system_reminder',
            status: 'warning',
            result: `[NO-TOOL WARNING] You have sent ${newCount} consecutive messages without using any tools. You MUST now either: (1) Update your task list using the TaskManager tool, or (2) Call the jobdone tool if all tasks are complete. Do not respond with text only - take action with a tool.`,
            timestamp: new Date().toISOString(),
            queuedAt: new Date().toISOString(),
            isSystemGenerated: true
          };

          // Queue as tool result for next processing cycle
          agent.messageQueues.toolResults.push(toolResultReminder);

          this.logger.warn(`[NO-TOOL-TRACKER] Agent ${agentId}: *** QUEUED NO-TOOL REMINDER AS TOOL RESULT ***`);
        }
      } else {
        this.logger.warn(`[NO-TOOL-TRACKER] Agent ${agentId}: Response HAS tools, counter will reset in _executeToolsAsync`);
      }
      // Note: Counter is reset in _executeToolsAsync when tools ARE executed
    }

    // Normalize token usage field names (backend may send input_tokens/output_tokens
    // instead of prompt_tokens/completion_tokens depending on provider)
    // NOTE: use ?? (not ||) so that a genuine 0 doesn't fall through to the next
    // field — but also guard against the case where `tokenUsage` is entirely
    // absent or empty. Emits a one-shot debug log so we can see the actual
    // shape once per unusual response in server logs.
    let normalizedTokenUsage = null;
    if (aiResponse.tokenUsage) {
      const u = aiResponse.tokenUsage;
      normalizedTokenUsage = {
        prompt_tokens:     u.prompt_tokens     ?? u.input_tokens  ?? 0,
        completion_tokens: u.completion_tokens ?? u.output_tokens ?? 0,
        total_tokens:      u.total_tokens      ?? ((u.prompt_tokens ?? u.input_tokens ?? 0) + (u.completion_tokens ?? u.output_tokens ?? 0)),
      };
      if (process.env.DEBUG_TOKEN_USAGE === '1' || normalizedTokenUsage.total_tokens === 0) {
        this.logger.warn('[TOKEN-USAGE] non-zero expected but got zero or debug-requested', {
          agentId,
          model: aiResponse.model,
          rawTokenUsage: u,
          normalized: normalizedTokenUsage,
        });
      }
    } else if (process.env.DEBUG_TOKEN_USAGE === '1') {
      this.logger.warn('[TOKEN-USAGE] aiResponse has no tokenUsage field', {
        agentId,
        model: aiResponse.model,
        aiResponseKeys: Object.keys(aiResponse || {}),
      });
    }

    // Create response message. Reasoning fields are only attached when
    // there's something to attach — avoids cluttering every assistant
    // message with null fields for non-reasoning models.
    //   - `reasoning`: chain-of-thought text, when the provider exposed it
    //     (DeepSeek-R1, Kimi K2 thinking, xAI reasoning, Claude thinking).
    //   - `reasoningTokens`: token count spent thinking, surfaced even
    //     when the text is opaque (OpenAI o-series, gpt-5-reasoning).
    // See src/services/aiService.js — `_extractReasoningTokens` + the
    // streaming/non-streaming handlers for the capture contract.
    const responseMessage = {
      id: `ai-response-${Date.now()}`,
      agentId: agentId,
      role: MESSAGE_ROLES.ASSISTANT,
      content: aiResponse.content,
      timestamp: new Date().toISOString(),
      model: aiResponse.model,
      tokenUsage: normalizedTokenUsage,
      sessionId: sessionId,
      // Mark if tools will be executed (UI can show loading indicator)
      pendingToolExecution: hasTools
    };
    if (typeof aiResponse.reasoning === 'string' && aiResponse.reasoning.length > 0) {
      responseMessage.reasoning = aiResponse.reasoning;
    }
    if (Number.isFinite(aiResponse.reasoningTokens) && aiResponse.reasoningTokens > 0) {
      responseMessage.reasoningTokens = aiResponse.reasoningTokens;
    }

    const appended = await this.addMessageToConversation(agentId, responseMessage, false);

    // IMMEDIATELY broadcast the AI response to UI (don't wait for tool execution).
    // We only broadcast if the message actually made it into the conversation —
    // broadcasting an empty message confuses the UI.
    if (appended && this.shouldBroadcastMessage(responseMessage)) {
      const updatedAgent = await this.agentPool.getAgent(agentId);
      this.broadcastMessageUpdate(agentId, responseMessage, {
        agentCurrentModel: updatedAgent?.currentModel
      });
    }

    // Execute tools ASYNCHRONOUSLY - don't block the response. Tools run even
    // if the assistant message itself was empty and dropped, so long as the
    // content string happened to contain tool-call markup.
    this._executeToolsAsync(agentId, aiResponse.content, sessionId, responseMessage.id);

    // The cycle "made progress" if EITHER the assistant message was persisted
    // or a tool call was extracted from the content (tools will surface new
    // messages through the toolResults queue next cycle).
    return appended || hasTools;
  }

  /**
   * Check if AI response contains tool calls
   * @param {string} content - AI response content
   * @returns {boolean} Whether content has tool calls
   * @private
   */
  _hasToolCalls(content) {
    if (!content) return false;
    // Check for JSON code block tool format (primary format used by tagParser)
    if (content.includes('```json')) {
      // Quick check for toolId in JSON block
      const jsonBlockPattern = /```json\s*\{[\s\S]*?"toolId"\s*:/;
      if (jsonBlockPattern.test(content)) return true;
    }
    // Also check for legacy patterns
    return content.includes('<tool>') ||
           content.includes('<function_call>') ||
           content.includes('```tool') ||
           /<\w+_tool>/i.test(content);
  }

  /**
   * Execute tools asynchronously and stream results to UI
   * @param {string} agentId - Agent ID
   * @param {string} content - AI response content
   * @param {string} sessionId - Session ID
   * @param {string} responseMessageId - Original response message ID for correlation
   * @private
   */
  async _executeToolsAsync(agentId, content, sessionId, responseMessageId) {
    // Check tools for builtinDelay via registry and apply the maximum delay
    try {
      const extractedTools = await this.messageProcessor.extractToolCommands(content);
      const toolsRegistry = this.messageProcessor.toolsRegistry;

      // Find the maximum builtinDelay among all tools being executed
      let maxDelay = 0;
      for (const cmd of extractedTools) {
        const tool = toolsRegistry?.getTool(cmd.toolId);
        if (tool?.builtinDelay > maxDelay) {
          maxDelay = tool.builtinDelay;
        }
      }

      if (maxDelay > 0) {
        const agent = await this.agentPool.getAgent(agentId);
        if (agent) {
          agent.delayEndTime = new Date(Date.now() + maxDelay).toISOString();
          await this.agentPool.persistAgentState(agentId);
          await this.broadcastAgentStateUpdate(agentId, 'builtin-delay');
          this.logger.debug(`Agent ${agentId} - applying ${maxDelay}ms builtin delay for tool execution`);
        }
      }
    } catch (extractError) {
      this.logger.warn(`Agent ${agentId} - failed to check tool delays:`, extractError.message);
    }

    try {
      const toolResults = await this.messageProcessor.extractAndExecuteTools(
        content,
        agentId,
        { sessionId: sessionId }
      );

      // Queue tool results in T queue for next iteration
      if (toolResults.length > 0) {
        // Reset consecutive no-tool counter since tools were executed
        if (this.consecutiveNoToolMessages.has(agentId)) {
          this.logger.debug(`Agent ${agentId} used tools - resetting consecutive no-tool counter`);
          this.consecutiveNoToolMessages.set(agentId, 0);
        }

        const agent = await this.agentPool.getAgent(agentId);
        if (agent) {
          const toolExecutions = [];
          const fullToolResults = [];

          for (const result of toolResults) {
            const toolResultEntry = {
              id: `tool-result-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              toolId: result.toolId,
              status: result.status,
              result: result.result,
              error: result.error,
              executionTime: result.executionTime,
              timestamp: new Date().toISOString(),
              queuedAt: new Date().toISOString(),
              responseTurnId: responseMessageId  // Track which AI turn triggered this result
            };

            agent.messageQueues.toolResults.push(toolResultEntry);

            toolExecutions.push({
              toolId: result.toolId,
              status: result.status,
              error: result.error,
              executionTime: result.executionTime
            });

            fullToolResults.push({
              id: toolResultEntry.id,
              toolId: result.toolId,
              status: result.status,
              result: result.result,
              error: result.error,
              executionTime: result.executionTime,
              timestamp: toolResultEntry.timestamp
            });
          }

          // Attach toolResults and toolExecutions to the original assistant message
          // so they persist in conversation history and are available when loading old conversations
          this._attachToolResultsToMessage(agent, responseMessageId, toolExecutions, fullToolResults);

          await this.agentPool.persistAgentState(agentId);

          // Broadcast tool execution completion to UI
          this._broadcastToolResults(agentId, sessionId, responseMessageId, toolExecutions, fullToolResults);
        }
      } else {
        // No tools to execute - broadcast completion with empty results
        this._broadcastToolResults(agentId, sessionId, responseMessageId, [], []);
      }

    } catch (error) {
      this.logger.error(`Tool execution failed for agent ${agentId}:`, error);
      // Broadcast error to UI
      this._broadcastToolResults(agentId, sessionId, responseMessageId, [], [], error.message);
    }
  }

  /**
   * Broadcast tool execution results to UI
   * @param {string} agentId - Agent ID
   * @param {string} sessionId - Session ID
   * @param {string} responseMessageId - Original response message ID
   * @param {Array} toolExecutions - Summary of tool executions
   * @param {Array} toolResults - Full tool results
   * @param {string} error - Error message if execution failed
   * @private
   */
  _broadcastToolResults(agentId, sessionId, responseMessageId, toolExecutions, toolResults, error = null) {
    if (this.webSocketManager && this.webSocketManager.broadcastToSession) {
      this.webSocketManager.broadcastToSession(sessionId, {
        type: 'tool_execution_complete',
        data: {
          agentId: agentId,
          responseMessageId: responseMessageId,
          toolExecutions: toolExecutions,
          toolResults: toolResults,
          error: error,
          timestamp: new Date().toISOString()
        }
      });

      this.logger.debug('Broadcast tool execution results', {
        agentId,
        sessionId,
        toolCount: toolExecutions.length,
        hasError: !!error
      });

      // If any filesystem tool ran, broadcast updated artifacts to UI
      const hasFilesystemOps = toolExecutions.some(t => t.toolId === 'filesystem');
      if (hasFilesystemOps && !error) {
        try {
          const agent = this.agentPool.agents?.get(agentId);
          if (agent?.artifacts && Object.keys(agent.artifacts).length > 0) {
            this.webSocketManager.broadcastToSession(sessionId, {
              type: 'artifacts_updated',
              data: {
                agentId,
                artifacts: agent.artifacts,
                workingDirectory: agent.directoryAccess?.workingDirectory || ''
              }
            });
            console.log('[Artifacts] Broadcast to session:', sessionId, Object.keys(agent.artifacts).length, 'files');
          }
        } catch (e) {
          // Non-fatal — UI can still fetch via API
        }
      }
    }
  }

  /**
   * Attach tool execution results to the original assistant message in conversation history.
   * This ensures results persist and are available when loading old conversations,
   * rather than only being available via the transient WebSocket event.
   * @param {Object} agent - Agent object with conversations
   * @param {string} responseMessageId - ID of the assistant message that triggered tool execution
   * @param {Array} toolExecutions - Summary of tool executions (toolId, status, error, executionTime)
   * @param {Array} toolResults - Full tool results with result data
   * @private
   */
  _attachToolResultsToMessage(agent, responseMessageId, toolExecutions, toolResults) {
    if (!agent || !responseMessageId) return;

    try {
      // Update in full conversation history
      if (agent.conversations?.full?.messages) {
        const fullMsg = agent.conversations.full.messages.find(m => m.id === responseMessageId);
        if (fullMsg) {
          fullMsg.toolExecutions = toolExecutions;
          fullMsg.toolResults = toolResults;
          fullMsg.pendingToolExecution = false;
          fullMsg.hasToolExecutions = true;
        }
      }

      // Also update in all model-specific conversations
      for (const [key, conv] of Object.entries(agent.conversations || {})) {
        if (key === 'full' || !conv?.messages) continue;
        const modelMsg = conv.messages.find(m => m.id === responseMessageId);
        if (modelMsg) {
          modelMsg.toolExecutions = toolExecutions;
          modelMsg.toolResults = toolResults;
          modelMsg.pendingToolExecution = false;
          modelMsg.hasToolExecutions = true;
        }
        // Also check compactizedMessages if conversation was compacted
        if (conv.compactizedMessages) {
          const compactMsg = conv.compactizedMessages.find(m => m.id === responseMessageId);
          if (compactMsg) {
            compactMsg.toolExecutions = toolExecutions;
            compactMsg.toolResults = toolResults;
            compactMsg.pendingToolExecution = false;
            compactMsg.hasToolExecutions = true;
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to attach tool results to message ${responseMessageId}:`, err.message);
    }
  }

  /**
   * Format tool result for conversation
   * @param {Object} toolResult - Tool result message
   * @returns {string} Formatted content
   * @private
   */
  formatToolResult(toolResult) {
    const toolLabel = toolResult.toolId ? `[${toolResult.toolId}] ` : '';
    if (toolResult.status === 'completed') {
      if (typeof toolResult.result === 'object') {
        return `${toolLabel}${JSON.stringify(toolResult.result, null, 2)}`;
      }
      return `${toolLabel}${String(toolResult.result || 'Tool executed successfully')}`;
    } else if (toolResult.status === 'failed') {
      return `${toolLabel}Tool execution failed: ${toolResult.error || 'Unknown error'}`;
    } else if (toolResult.result) {
      // Warning or other status with a result message (e.g. no-tool reminders)
      return `${toolLabel}${String(toolResult.result)}`;
    }
    return `${toolLabel}Tool status: ${toolResult.status}`;
  }

  /**
   * Check if message should be broadcast to UI
   * @param {Object} message - Message to check
   * @returns {boolean} Whether to broadcast
   * @private
   */
  shouldBroadcastMessage(message) {
    // Don't broadcast internal scheduler prompts
    if (message.type === 'scheduler-prompt') {
      return false;
    }

    // Don't broadcast consolidated-input messages (internal AI context with tool results)
    if (message.type === 'consolidated-input') {
      return false;
    }

    // Don't broadcast pure system instructions (but allow system messages from inter-agent communication)
    if (message.role === MESSAGE_ROLES.SYSTEM && !message.queueType) {
      return false;
    }

    // Broadcast all other messages (user, assistant, tool, inter-agent)
    return true;
  }

  /**
   * Broadcast message update to UI
   * @param {string} agentId - Agent ID
   * @param {Object} message - Message that was added
   * @param {Object} agentInfo - Additional agent information for UI sync
   * @private
   */
  /**
   * Broadcast an agent state snapshot (mode, delayEndTime, awaitingUserInput,
   * stopRequested) whenever the scheduler mutates one of those fields.
   *
   * The UI reducer merges this payload into its agent record, so a single
   * helper call everywhere-the-state-changes keeps the UI in sync without
   * adding one-off event types per scenario. `reason` is a short tag
   * (`timeout`, `rate-limit`, `builtin-delay`, `loop-detected`, etc.) so the
   * UI can render a human-readable cause if it wants to.
   *
   * Best-effort: a missing webSocketManager or a sessionless agent makes this
   * a no-op. Never throws.
   *
   * @param {string} agentId
   * @param {string} reason   Short tag describing WHY the state changed.
   */
  async broadcastAgentStateUpdate(agentId, reason = 'state-change') {
    try {
      if (!this.webSocketManager?.broadcastToSession) return;
      const agent = await this.agentPool.getAgent(agentId);
      if (!agent) return;
      const sessionId = this.getAgentSession(agentId) || agent.sessionId || 'scheduler-session';
      this.webSocketManager.broadcastToSession(sessionId, {
        type: 'agent_state_updated',
        data: {
          agentId,
          mode: agent.mode,
          delayEndTime: agent.delayEndTime || null,
          awaitingUserInput: agent.awaitingUserInput || null,
          stopRequested: !!agent.stopRequested,
          reason,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      this.logger?.warn?.(`agent_state_updated broadcast failed: ${err.message}`, { agentId, reason });
    }
  }

  broadcastMessageUpdate(agentId, message, agentInfo = {}) {
    if (this.webSocketManager && this.webSocketManager.broadcastToSession) {
      // Get the session ID from session map, message, or fallback
      let sessionId = this.getAgentSession(agentId);

      // Try to get sessionId from message if not in session map
      if (!sessionId && message.sessionId) {
        sessionId = message.sessionId;
      }

      // Final fallback
      if (!sessionId) {
        sessionId = 'scheduler-session';
      }

      this.logger.debug('Broadcasting message to session', {
        agentId: agentId,
        sessionId: sessionId,
        messageRole: message.role,
        messageType: message.type
      });

      this.webSocketManager.broadcastToSession(sessionId, {
        type: 'message_added',
        data: {
          agentId: agentId,
          message: message,
          timestamp: new Date().toISOString(),
          agentCurrentModel: agentInfo.agentCurrentModel
        }
      });
    }
  }

  /**
   * Auto-create initial task if agent just switched to AGENT mode
   * @param {string} agentId - Agent ID
   * @private
   */
  async autoCreateInitialTaskIfNeeded(agentId) {
    try {
      const agent = await this.agentPool.getAgent(agentId);
      if (!agent || agent.mode !== AGENT_MODES.AGENT) {
        return;
      }

      // Ensure taskList exists
      if (!agent.taskList) {
        agent.taskList = {
          tasks: [],
          lastUpdated: new Date().toISOString()
        };
      }

      // Check if we already have tasks
      if (agent.taskList.tasks && agent.taskList.tasks.length > 0) {
        return; // Already has tasks
      }

      // If agent just completed work via jobdone, don't recreate a task
      // from old conversation history — wait for a genuinely new message.
      if (agent.autonomousWorkComplete) {
        return;
      }

      // Look for the last user message in conversation history
      const conversations = agent.conversations?.full?.messages || [];
      const lastUserMessage = [...conversations].reverse().find(m => m.role === MESSAGE_ROLES.USER);
      
      if (lastUserMessage) {
        const taskTitle = `Process initial request: ${this.extractTaskTitle(lastUserMessage.content)}`;
        const taskDescription = `Handle user request: "${this.truncateContent(lastUserMessage.content, 200)}"`;
        
        const task = {
          id: `task-initial-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          title: taskTitle,
          description: taskDescription,
          status: 'pending',
          priority: 'high',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: 'auto-created-initial',
          messageId: lastUserMessage.id
        };

        agent.taskList.tasks.push(task);
        agent.taskList.lastUpdated = new Date().toISOString();
        
        await this.agentPool.persistAgentState(agentId);
        
        this.logger.info(`Auto-created initial task for agent ${agentId}`, {
          taskId: task.id,
          title: task.title,
          agentName: agent.name
        });
      }
    } catch (error) {
      this.logger.error(`Failed to auto-create initial task for agent ${agentId}`, {
        error: error.message
      });
    }
  }

  /**
   * Auto-create tasks for incoming messages (Phase 2)
   * @param {string} agentId - Agent ID
   * @param {Array} userMessages - User messages to process
   * @param {Array} interAgentMessages - Inter-agent messages to process
   * @private
   */
  async autoCreateTasksForMessages(agentId, userMessages, interAgentMessages) {
    try {
      const agent = await this.agentPool.getAgent(agentId);
      if (!agent || agent.mode !== AGENT_MODES.AGENT) {
        return; // Only auto-create tasks for AGENT mode agents
      }

      // Ensure taskList exists
      if (!agent.taskList) {
        agent.taskList = {
          tasks: [],
          lastUpdated: new Date().toISOString()
        };
      }

      // Create tasks for user messages
      for (const msg of userMessages) {
        const taskTitle = `Process user request: ${this.extractTaskTitle(msg.content)}`;
        const taskDescription = `Handle user message: "${this.truncateContent(msg.content, 200)}"`;
        
        // Check if similar task already exists
        const existingTask = agent.taskList.tasks.find(task => 
          task.status === 'pending' && 
          task.title.includes('Process user request') &&
          this.calculateContentSimilarity(task.description, taskDescription) > 0.7
        );

        if (!existingTask) {
          const task = {
            id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: taskTitle,
            description: taskDescription,
            status: 'pending',
            priority: 'high', // User messages get high priority
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'auto-created',
            messageId: msg.id
          };

          agent.taskList.tasks.push(task);
          
          this.logger?.info(`Auto-created task for user message`, {
            agentId,
            taskId: task.id,
            title: task.title
          });
        }
      }

      // Create tasks for inter-agent messages
      for (const msg of interAgentMessages) {
        const senderName = msg.senderName || msg.sender || 'Unknown Agent';
        const taskTitle = `Respond to ${senderName}: ${this.extractTaskTitle(msg.content)}`;
        const taskDescription = `Handle message from ${senderName}: "${this.truncateContent(msg.content, 200)}"`;
        
        // Check if similar task already exists
        const existingTask = agent.taskList.tasks.find(task => 
          task.status === 'pending' && 
          task.title.includes(`Respond to ${senderName}`) &&
          this.calculateContentSimilarity(task.description, taskDescription) > 0.7
        );

        if (!existingTask) {
          const task = {
            id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: taskTitle,
            description: taskDescription,
            status: 'pending',
            priority: 'medium', // Inter-agent messages get medium priority
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'auto-created',
            messageId: msg.id,
            senderAgent: msg.sender
          };

          agent.taskList.tasks.push(task);
          
          this.logger?.info(`Auto-created task for inter-agent message`, {
            agentId,
            taskId: task.id,
            title: task.title,
            sender: senderName
          });
        }
      }

      // Update task list timestamp
      if (userMessages.length > 0 || interAgentMessages.length > 0) {
        agent.taskList.lastUpdated = new Date().toISOString();
        await this.agentPool.persistAgentState(agentId);
      }

    } catch (error) {
      this.logger?.error(`Failed to auto-create tasks for agent ${agentId}`, {
        error: error.message,
        userMessageCount: userMessages.length,
        interAgentMessageCount: interAgentMessages.length
      });
    }
  }

  /**
   * Extract a concise title from message content
   * @param {string} content - Message content
   * @returns {string} Extracted title
   * @private
   */
  extractTaskTitle(content) {
    // Extract first meaningful sentence or phrase, max 50 chars
    const cleaned = content.trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    const firstSentence = cleaned.split(/[.!?]/)[0].trim();
    
    if (firstSentence.length > 50) {
      return firstSentence.substring(0, 47) + '...';
    }
    
    return firstSentence || 'Process message';
  }

  /**
   * Truncate content to specified length
   * @param {string} content - Content to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated content
   * @private
   */
  truncateContent(content, maxLength) {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength - 3) + '...';
  }

  /**
   * Calculate content similarity (simple implementation)
   * @param {string} content1 - First content
   * @param {string} content2 - Second content
   * @returns {number} Similarity score (0-1)
   * @private
   */
  calculateContentSimilarity(content1, content2) {
    // Simple word-based similarity
    const words1 = content1.toLowerCase().split(/\s+/);
    const words2 = content2.toLowerCase().split(/\s+/);
    
    const commonWords = words1.filter(word => words2.includes(word));
    const totalWords = new Set([...words1, ...words2]).size;
    
    return commonWords.length / totalWords;
  }

  /**
   * Auto-mark highest priority pending task as in-progress (Phase 2)
   * @param {string} agentId - Agent ID
   * @private
   */
  async autoProgressHighestPriorityTask(agentId) {
    try {
      const agent = await this.agentPool.getAgent(agentId);
      if (!agent || !agent.taskList || !agent.taskList.tasks) {
        return;
      }

      // Find highest priority pending task that can be started (respecting dependencies)
      let pendingTasks = agent.taskList.tasks.filter(task => task.status === TASK_STATUS.PENDING);
      
      if (pendingTasks.length === 0) {
        return; // No pending tasks
      }

      // Phase 3: Filter out blocked tasks (dependencies not met)
      pendingTasks = this.filterAvailableTasks(agent.taskList.tasks, pendingTasks);

      if (pendingTasks.length === 0) {
        this.logger?.info(`All pending tasks are blocked by dependencies for agent ${agentId}`);
        return; // All tasks are blocked
      }

      // Sort by intelligent priority score, fallback to priority level, then creation date
      pendingTasks.sort((a, b) => {
        // Use priority score if available (higher score = higher priority)
        if (a.priorityScore !== undefined && b.priorityScore !== undefined) {
          const scoreDiff = b.priorityScore - a.priorityScore;
          if (Math.abs(scoreDiff) > 0.1) return scoreDiff; // Use score if significantly different
        }

        // Fallback to traditional priority ordering using constants
        const priorityA = TASK_PRIORITY_ORDER[a.priority] ?? TASK_PRIORITY_ORDER.medium;
        const priorityB = TASK_PRIORITY_ORDER[b.priority] ?? TASK_PRIORITY_ORDER.medium;
        const priorityDiff = priorityA - priorityB;
        if (priorityDiff !== 0) return priorityDiff;

        // Finally sort by creation date (older first)
        return new Date(a.createdAt) - new Date(b.createdAt);
      });

      const taskToProgress = pendingTasks[0];

      // Check if we already have a task in progress
      const inProgressTasks = agent.taskList.tasks.filter(task => task.status === TASK_STATUS.IN_PROGRESS);
      
      if (inProgressTasks.length === 0) {
        // Mark highest priority task as in-progress
        taskToProgress.status = TASK_STATUS.IN_PROGRESS;
        taskToProgress.updatedAt = new Date().toISOString();
        taskToProgress.startedAt = new Date().toISOString();
        
        agent.taskList.lastUpdated = new Date().toISOString();
        await this.agentPool.persistAgentState(agentId);
        
        this.logger?.info(`Auto-progressed task to in-progress`, {
          agentId,
          taskId: taskToProgress.id,
          title: taskToProgress.title,
          priority: taskToProgress.priority
        });
      }

    } catch (error) {
      this.logger?.error(`Failed to auto-progress task for agent ${agentId}`, {
        error: error.message
      });
    }
  }

  /**
   * Filter tasks to only include those that can be started (Phase 3)
   * @param {Array} allTasks - All tasks for the agent
   * @param {Array} pendingTasks - Tasks with pending status
   * @returns {Array} Tasks that can be started (no blocking dependencies)
   * @private
   */
  filterAvailableTasks(allTasks, pendingTasks) {
    return pendingTasks.filter(task => {
      // If task has no dependencies, it's available
      if (!task.dependencies || task.dependencies.length === 0) {
        return true;
      }

      // Check all blocking dependencies
      const blockingDeps = task.dependencies.filter(dep => dep.type === 'blocks');
      
      for (const dep of blockingDeps) {
        const depTask = allTasks.find(t => t.id === dep.taskId);
        
        // If dependency task doesn't exist or isn't completed, task is blocked
        if (!depTask || depTask.status !== 'completed') {
          return false;
        }
      }

      return true; // All blocking dependencies are satisfied
    });
  }

  /**
   * Update task statuses based on dependency completion (Phase 3)
   * @param {Object} agent - Agent object
   * @param {string} completedTaskId - ID of the task that was just completed
   * @private
   */
  async updateDependentTasks(agent, completedTaskId) {
    try {
      if (!agent.taskList || !agent.taskList.tasks) {
        return;
      }

      let updated = false;

      // Find tasks that were blocked by the completed task
      for (const task of agent.taskList.tasks) {
        if (task.status === 'blocked' && task.dependencies) {
          const blockingDep = task.dependencies.find(
            dep => dep.type === 'blocks' && dep.taskId === completedTaskId
          );

          if (blockingDep) {
            // Check if all other blocking dependencies are also completed
            const stillBlocked = task.dependencies.some(dep => {
              if (dep.type !== 'blocks') return false;
              const depTask = agent.taskList.tasks.find(t => t.id === dep.taskId);
              return depTask && depTask.status !== 'completed';
            });

            if (!stillBlocked) {
              task.status = 'pending';
              task.updatedAt = new Date().toISOString();
              updated = true;

              this.logger?.info(`Task unblocked due to dependency completion`, {
                taskId: task.id,
                title: task.title,
                completedDependency: completedTaskId
              });
            }
          }
        }
      }

      if (updated) {
        agent.taskList.lastUpdated = new Date().toISOString();
        await this.agentPool.persistAgentState(agent.id);
      }

    } catch (error) {
      this.logger?.error(`Failed to update dependent tasks for agent ${agent.id}`, {
        error: error.message,
        completedTaskId
      });
    }
  }

  /**
   * Generate a hash representing the agent's most recent output
   *
   * IMPORTANT: We only hash AGENT/ASSISTANT responses, not user inputs.
   * This is because:
   * - User inputs changing is normal and expected
   * - Agent producing the SAME OUTPUT repeatedly indicates a loop
   * - If agent keeps saying "I'll do X" without actually doing it = loop
   *
   * @param {Object} agent - Agent object
   * @returns {string} Hash of the agent's recent output
   * @private
   */
  generateAgentStateHash(agent) {
    const stateComponents = [];

    // Get the most recent ASSISTANT messages (agent outputs only)
    const allMessages = agent.conversations?.full?.messages || [];
    const assistantMessages = allMessages
      .filter(m => m.role === 'assistant')
      .slice(-3); // Last 3 assistant responses

    // Hash the agent's actual output content
    const outputSummary = assistantMessages
      .map(m => {
        // Get the meaningful content - strip tool calls for cleaner comparison
        const content = m.content || '';
        // Truncate but include enough to detect patterns
        return content.substring(0, 500);
      })
      .join('|');

    stateComponents.push(`output:${outputSummary}`);

    // Also include tool calls from recent assistant messages (agent's actions)
    // If agent keeps trying to call the same tool = loop
    const recentToolCalls = assistantMessages
      .filter(m => m.toolCalls && m.toolCalls.length > 0)
      .flatMap(m => m.toolCalls)
      .slice(-5)
      .map(tc => `${tc.toolId || tc.name}:${JSON.stringify(tc.parameters || tc.params || {}).substring(0, 100)}`)
      .join(',');

    if (recentToolCalls) {
      stateComponents.push(`tools:${recentToolCalls}`);
    }

    // Create hash from agent output only
    const stateString = stateComponents.join('||');

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < stateString.length; i++) {
      const char = stateString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    return `${hash}_${stateString.length}`;
  }

  /**
   * Detect if agent is in a repetitive loop using sliding window approach
   *
   * @param {string} agentId - Agent ID
   * @param {string} stateHash - Current state hash
   * @returns {{ isLoop: boolean, isImmediateDuplicate: boolean, occurrences: number }}
   * @private
   */
  detectRepetitiveLoop(agentId, stateHash) {
    const history = this.stateHashHistory.get(agentId) || [];
    const windowSize = SCHEDULER_CONFIG.STATE_HASH_WINDOW_SIZE;
    const threshold = SCHEDULER_CONFIG.REPETITION_THRESHOLD;

    // Get the sliding window (last N entries)
    const window = history.slice(-windowSize);

    // Check if this is an immediate duplicate (same as last hash)
    const isImmediateDuplicate = window.length > 0 && window[window.length - 1].hash === stateHash;

    // Count occurrences of this hash in the window
    const occurrences = window.filter(entry => entry.hash === stateHash).length;

    // It's a loop if the same hash appears threshold times or more
    const isLoop = occurrences >= threshold;

    return {
      isLoop,
      isImmediateDuplicate,
      occurrences,
      windowSize: window.length
    };
  }

  /**
   * Record a cycle where the model returned an empty or whitespace-only
   * response that carried no tool calls. The scheduler keeps retrying — the
   * next cycle may produce a real message — but we buffer the empties so
   * we can surface a clear error to the user if the stall persists.
   *
   * A snapshot of the raw response's shape is captured per cycle (capped at
   * 3 samples per entry) so the operator can see WHY the model returned
   * nothing: was it a content-filter trip, a tool-call-only turn whose
   * tool_calls failed to bridge, a reasoning-only stream that never emitted
   * text, or an actual silent-but-200 upstream. Without this the stall is
   * indistinguishable from "the model is broken" vs "our parser missed it".
   *
   * @param {string} agentId
   * @param {Object|null} aiResponse  Raw AI response from aiService; null OK.
   * @private
   */
  async _trackEmptyResponse(agentId, aiResponse = null) {
    const now = Date.now();
    const existing = this._emptyResponseTracker.get(agentId);
    const sample = this._snapshotResponseShape(aiResponse);
    const prevSamples = existing?.samples || [];
    // Keep up to 3 samples so operators see the pattern, not just the last one.
    const samples = [...prevSamples, sample].slice(-3);
    const entry = existing
      ? { count: existing.count + 1, firstAt: existing.firstAt, lastAt: now, samples }
      : { count: 1, firstAt: now, lastAt: now, samples };

    this._emptyResponseTracker.set(agentId, entry);

    this.logger.warn(`[EMPTY-RESPONSE] Agent ${agentId}: cycle produced no content`, {
      count: entry.count,
      elapsedMs: now - entry.firstAt,
      threshold: SCHEDULER_CONFIG.EMPTY_RESPONSE_STALL_THRESHOLD,
      windowMs: SCHEDULER_CONFIG.EMPTY_RESPONSE_STALL_WINDOW_MS,
      sample,  // snapshot of THIS empty response — aids root-cause analysis
    });

    const shouldStall =
      entry.count >= SCHEDULER_CONFIG.EMPTY_RESPONSE_STALL_THRESHOLD &&
      (now - entry.firstAt) >= SCHEDULER_CONFIG.EMPTY_RESPONSE_STALL_WINDOW_MS;

    if (shouldStall) {
      try {
        await this._handleEmptyResponseStall(agentId, entry);
      } finally {
        this._emptyResponseTracker.delete(agentId);
      }
    }
  }

  /**
   * Reduce an AI response object to the minimum forensic info needed to
   * diagnose WHY it was classified as empty. Keeps the snapshot tiny (fits
   * in WebSocket + UI) and avoids leaking full conversation content.
   *
   * Fields probed:
   *   - contentType / contentLength  : what the accumulator got
   *   - hasToolCalls                  : was it a tool-only turn?
   *   - toolCallCount                 : how many, if so
   *   - finishReason                  : provider's stop signal (length,
   *                                      content_filter, tool_calls, stop, …)
   *   - hasReasoning                  : reasoning-only turn indicator
   *   - model                         : which model produced it
   *
   * Each field is a cheap string/number/bool. No content bodies included.
   *
   * @param {Object|null} r  Raw aiService response.
   * @returns {{ at: string, contentType: string, contentLength: number, hasToolCalls: boolean, toolCallCount: number, finishReason: string|null, hasReasoning: boolean, model: string|null, hint: string }}
   * @private
   */
  _snapshotResponseShape(r) {
    const at = new Date().toISOString();
    if (!r || typeof r !== 'object') {
      return { at, contentType: 'null', contentLength: 0, hasToolCalls: false,
               toolCallCount: 0, finishReason: null, hasReasoning: false,
               model: null, hint: 'aiService returned null/undefined' };
    }
    const content = r.content;
    let contentType, contentLength;
    if (typeof content === 'string') {
      contentType = 'string';
      contentLength = content.length;
    } else if (Array.isArray(content)) {
      contentType = 'array';
      contentLength = content.reduce((n, p) => n + (typeof p?.text === 'string' ? p.text.length : 0), 0);
    } else if (content == null) {
      contentType = 'null';
      contentLength = 0;
    } else {
      contentType = typeof content;
      contentLength = 0;
    }

    const toolCalls = Array.isArray(r.toolCalls) ? r.toolCalls
                    : Array.isArray(r.tool_calls) ? r.tool_calls
                    : null;
    const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
    const toolCallCount = hasToolCalls ? toolCalls.length : 0;

    const finishReason = r.finishReason || r.finish_reason || r.stop_reason || null;
    const hasReasoning = !!(r.reasoning || r.reasoning_content
                            || (Array.isArray(content) && content.some(p => p?.type === 'reasoning')));
    const model = r.model || null;

    // Best-guess hint. The operator sees this at the top of the sample so
    // they don't have to read the other fields to get a first theory. Wrong
    // hints are easy to override visually because all the raw fields are
    // right there.
    let hint;
    if (hasToolCalls && contentLength === 0) {
      hint = 'Tool-call-only turn — tool_calls did not reach the content accumulator. Likely a Chat Completions bridge gap.';
    } else if (hasReasoning && contentLength === 0) {
      hint = 'Reasoning-only turn — model emitted thinking tokens but no text output. Likely a Responses API stream that never reached output_text.';
    } else if (finishReason === 'content_filter') {
      hint = 'Blocked by the provider content filter.';
    } else if (finishReason === 'length') {
      hint = 'Hit max_tokens before producing any output. Raise the model\'s output cap or compact the conversation.';
    } else if (contentLength === 0 && finishReason === 'stop') {
      hint = 'Model returned 200 with clean stop and no output. Possible silent prompt-rejection / context-limit / upstream timeout.';
    } else {
      hint = 'Classified empty by the detector; root cause unclear — inspect raw fields.';
    }

    return { at, contentType, contentLength, hasToolCalls, toolCallCount,
             finishReason, hasReasoning, model, hint };
  }

  /**
   * Circuit breaker fired when an agent has produced N empty responses across
   * at least the configured time window. Surfaces a user-facing error message,
   * switches the agent to CHAT mode (scheduler will mark it inactive), and
   * clears scheduler-side state that could otherwise keep re-firing.
   *
   * Mirrors the shape of handleRepetitiveLoop but with a different message
   * explaining the actual failure mode.
   *
   * @param {string} agentId
   * @param {{count: number, firstAt: number, lastAt: number}} entry
   * @private
   */
  async _handleEmptyResponseStall(agentId, entry) {
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) return;

    // Clear scheduler state FIRST so any throw in persistence / broadcast below
    // can't leave us re-firing this handler next cycle.
    this.stateHashHistory.delete(agentId);
    this.consecutiveNoToolMessages.delete(agentId);

    const elapsedSec = Math.round((entry.lastAt - entry.firstAt) / 1000);

    // Flip mode → CHAT. System events like this one are NOT pushed into the
    // chat transcript — they surface via the `agent_mode_changed` +
    // `agent_notification` broadcasts as toast + notification-center entries.
    // Transcript bubbles are for conversation content only; filling the feed
    // with "I've switched to chat mode" bodies made every stall triple-post.
    await this._transitionMode(agentId, AGENT_MODES.CHAT, 'empty-response-stall', {
      count: entry.count,
      elapsedSec,
    });

    this.logger.error(`Agent ${agentId} switched to CHAT mode after ${entry.count} empty responses`, {
      agentName: agent.name,
      elapsedMs: entry.lastAt - entry.firstAt,
      samples: entry.samples || [],   // diagnostic — see _trackEmptyResponse
    });
  }

  /**
   * Record a state hash in the sliding window
   *
   * @param {string} agentId - Agent ID
   * @param {string} stateHash - State hash to record
   * @private
   */
  recordStateHash(agentId, stateHash) {
    if (!this.stateHashHistory.has(agentId)) {
      this.stateHashHistory.set(agentId, []);
    }

    const history = this.stateHashHistory.get(agentId);

    // Add new entry with timestamp
    history.push({
      hash: stateHash,
      timestamp: Date.now()
    });

    // Trim to keep only the sliding window (no arbitrary limits)
    // We keep slightly more than window size for context, but not unlimited
    const maxHistorySize = SCHEDULER_CONFIG.STATE_HASH_WINDOW_SIZE * 2;
    if (history.length > maxHistorySize) {
      // Remove oldest entries beyond double the window size
      history.splice(0, history.length - maxHistorySize);
    }
  }

  /**
   * Handle detected repetitive loop - notify user and stop agent
   *
   * @param {string} agentId - Agent ID
   * @param {Object} loopDetection - Loop detection result
   * @private
   */
  async handleRepetitiveLoop(agentId, loopDetection) {
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) return;

    // Clear scheduler state FIRST. If persistAgentState or a WebSocket broadcast
    // throws below, we must NOT leave stale loop-detector state that would
    // re-fire this handler on the next scheduler cycle — that was the exact
    // "detects a loop repeatedly without adding a new message first" bug.
    this.stateHashHistory.delete(agentId);
    this._emptyResponseTracker.delete(agentId);
    this.consecutiveNoToolMessages.delete(agentId);

    // Flip mode → CHAT. No chat-transcript bubble — the humanReason
    // ("The same action repeated N times…") is surfaced by the UI as a
    // toast + notification-center entry via the agent_mode_changed /
    // agent_notification broadcasts fired inside _transitionMode. Putting
    // system events into the transcript cluttered the feed every time the
    // loop tripped.
    await this._transitionMode(agentId, AGENT_MODES.CHAT, 'loop-detected', {
      occurrences: loopDetection.occurrences,
      windowSize: loopDetection.windowSize,
    });

    this.logger.warn(`Agent ${agentId} stopped due to repetitive loop - awaiting user intervention`, {
      occurrences: loopDetection.occurrences,
      agentName: agent.name
    });
  }

  /**
   * Clear hash history for an agent (e.g., when conversation changes significantly)
   *
   * @param {string} agentId - Agent ID
   */
  clearHashHistory(agentId) {
    if (this.stateHashHistory.has(agentId)) {
      this.stateHashHistory.set(agentId, []);
    }
  }

  /**
   * Get scheduler status
   * Uses AgentActivityService to get current active agents
   * @returns {Promise<Object>} Scheduler status
   */
  async getStatus() {
    const allAgents = await this.agentPool.getAllAgents();
    const activeAgentResults = getActiveAgents(allAgents);

    return {
      isRunning: this.isRunning,
      activeAgents: activeAgentResults.map(r => ({
        agentId: r.agentId,
        reason: r.reason,
        sessionId: this.getAgentSession(r.agentId)
      })),
      agentCount: activeAgentResults.length,
      sessionMapSize: this.agentSessionMap.size
    };
  }
}

export default AgentScheduler;