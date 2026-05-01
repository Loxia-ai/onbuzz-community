/**
 * FlowExecutor - Executes visual flow pipelines
 *
 * Purpose:
 * - Execute flow nodes in topologically sorted order
 * - Queue messages to agents via MessageProcessor
 * - Detect completion via jobdone tool results
 * - Track node states and outputs
 * - Broadcast execution progress via WebSocket
 */

import { AGENT_MODES } from '../utilities/constants.js';
import { validateFlowDefinition } from './flowSchema.js';
import { assembleNodeInputs } from './flowFieldMapping.js';
import { runWithRetry, FlowRetryError } from './flowRetry.js';

class FlowExecutor {
  constructor(config, logger, stateManager, agentPool, messageProcessor) {
    this.config = config;
    this.logger = logger;
    this.stateManager = stateManager;
    this.agentPool = agentPool;
    this.messageProcessor = messageProcessor;

    // WebSocket manager for broadcasting progress
    this.webSocketManager = null;

    // Active flow executions
    this.activeExecutions = new Map();

    // Completion listeners per run
    this.completionListeners = new Map();

    // Phase 8: agentId → currently-awaited node contract.
    // Set when an agent is invoked inside a flow node; cleared when
    // the await resolves. The jobdone tool reads this to validate
    // the agent's job-done call AT TOOL TIME — rejecting partial
    // calls before they propagate into the executor.
    this.activeContracts = new Map();

    // Optional disk checkpointing — when set, every successful node
    // persists its result so the run can resume after a crash. Off by
    // default (preserves pre-Phase-4 behavior; opt in via setCheckpointStore).
    this.checkpointStore = null;
  }

  /**
   * Phase 8: get the currently-awaited node contract for an agent (if any).
   * Returns the contract object { inputs, outputs, instructions, ... } so
   * the jobdone tool can validate the agent's call against it AT TOOL TIME
   * — much faster recovery than waiting for executor-level re-prompts.
   *
   * @param {string} agentId
   * @returns {object|null} the contract, or null when the agent isn't in
   *                        a flow step right now.
   */
  getActiveContract(agentId) {
    return this.activeContracts.get(agentId) || null;
  }

  /**
   * Phase 4: enable disk checkpoints + resume by injecting a store.
   * Calling with null disables checkpointing.
   */
  setCheckpointStore(store) {
    this.checkpointStore = store || null;
  }

  /**
   * Set WebSocket manager for real-time updates
   * @param {Object} webSocketManager - WebSocket manager instance
   */
  setWebSocketManager(webSocketManager) {
    this.webSocketManager = webSocketManager;
  }

  /**
   * Execute a flow
   * @param {string} flowId - Flow identifier
   * @param {Object} initialInput - Initial input data
   * @param {string} sessionId - WebSocket session ID for broadcasts
   * @returns {Promise<Object>} Flow run result
   */
  async executeFlow(flowId, initialInput = {}, sessionId = null) {
    // Load flow definition
    const flow = await this.stateManager.getFlow(flowId);
    if (!flow) {
      throw new Error(`Flow not found: ${flowId}`);
    }

    // Belt-and-suspenders schema check. The POST/PUT routes already gate
    // on this, but flows can also be authored by importing JSON files
    // directly into the index, or by older clients that bypassed the
    // route. Catching here means we never queue agents on a flow that
    // we can't actually execute. Errors include path so the caller can
    // surface them in the run-detail view.
    const validation = validateFlowDefinition(flow);
    if (!validation.ok) {
      const detail = validation.errors.map(e => e.message).join('; ');
      this.logger.warn(`Flow ${flowId} failed schema validation; refusing to execute`, {
        errors: validation.errors,
      });
      throw new Error(`Flow definition is invalid: ${detail}`);
    }

    // Create flow run record
    const run = await this.stateManager.createFlowRun(flowId, initialInput);
    const runId = run.id;

    this.logger.info(`Starting flow execution: ${flowId}`, {
      runId,
      nodeCount: flow.nodes?.length || 0,
      edgeCount: flow.edges?.length || 0
    });

    // Track this execution
    this.activeExecutions.set(runId, {
      flowId,
      flow,
      runId,
      sessionId,
      status: 'running',
      startedAt: new Date()
    });

    // Update run status to running. Phase 6.3: stamp the flow's
    // current version onto the run so we can later answer "which
    // definition produced this output?" — important after rollbacks.
    await this.stateManager.updateFlowRun(runId, {
      status: 'running',
      flowVersion: flow.version ?? null,
    });
    const startedAt = new Date().toISOString();
    this.broadcastFlowUpdate(sessionId, {
      type: 'flow_run_started',
      runId,
      flowId,
      status: 'running',
      startedAt
    });

    try {
      // Ensure all referenced agents are loaded before execution
      await this.ensureAgentsLoaded(flow.nodes);

      // Topologically sort nodes
      const sortedNodes = this.topologicalSort(flow.nodes, flow.edges);

      if (sortedNodes.length === 0) {
        throw new Error('Flow has no executable nodes');
      }

      // Initialize execution context
      const context = {
        input: initialInput.userInput || initialInput.input || '',
        nodeOutputs: {},
        variables: { ...flow.variables },
        sortedNodes, // Store for position tracking
        flow // Store flow reference
      };

      // Execute nodes in order
      for (const node of sortedNodes) {
        // Check if execution was stopped
        const execution = this.activeExecutions.get(runId);
        if (!execution || execution.status === 'stopped') {
          this.logger.info(`Flow execution stopped: ${runId}`);
          await this.stateManager.updateFlowRun(runId, {
            status: 'stopped',
            completedAt: new Date().toISOString()
          });
          this.broadcastFlowUpdate(sessionId, {
            type: 'flow_run_stopped',
            runId,
            flowId
          });
          return { runId, status: 'stopped' };
        }

        // Phase 4: skip nodes already completed in a previous run that
        // we're resuming from. Their outputs were rehydrated into
        // context.nodeOutputs by resumeFlow before the loop started.
        if (context.skipCompletedNodeIds?.has?.(node.id)) {
          this.logger.info(`Flow ${flowId}: skipping already-completed node ${node.id} on resume`);
          continue;
        }

        // Execute node
        const nodeResult = await this.executeNode(node, context, runId, sessionId, flow);

        // Store node output by node ID
        context.nodeOutputs[node.id] = nodeResult;

        // Also store by outputKey if specified (for named references like {{result}})
        if (node.data?.outputKey) {
          context.nodeOutputs[node.data.outputKey] = nodeResult;
        }

        // Update node state in run
        await this.updateNodeState(runId, node.id, 'completed', nodeResult);

        // Phase 4: persist a checkpoint after each successful node so a
        // resume can skip back here. Best-effort — checkpoint failures
        // don't fail the run (we'd rather complete without resumability
        // than blow up because disk is full).
        if (this.checkpointStore) {
          try {
            await this.checkpointStore.saveNodeResult(runId, node.id, nodeResult);
          } catch (err) {
            this.logger.warn(`Flow ${flowId}: failed to checkpoint node ${node.id}`, { error: err.message });
          }
        }
      }

      // Flow completed successfully
      const finalOutput = this.collectFinalOutput(sortedNodes, context);

      await this.stateManager.updateFlowRun(runId, {
        status: 'completed',
        output: finalOutput,
        completedAt: new Date().toISOString()
      });

      this.broadcastFlowUpdate(sessionId, {
        type: 'flow_run_completed',
        runId,
        flowId,
        output: finalOutput
      });

      this.activeExecutions.delete(runId);

      this.logger.info(`Flow execution completed: ${flowId}`, { runId });

      return { runId, status: 'completed', output: finalOutput };

    } catch (error) {
      this.logger.error(`Flow execution failed: ${flowId}`, {
        runId,
        error: error.message
      });

      await this.stateManager.updateFlowRun(runId, {
        status: 'failed',
        error: error.message,
        completedAt: new Date().toISOString()
      });

      this.broadcastFlowUpdate(sessionId, {
        type: 'flow_run_failed',
        runId,
        flowId,
        error: error.message
      });

      this.activeExecutions.delete(runId);

      return { runId, status: 'failed', error: error.message };
    }
  }

  /**
   * Phase 4: resume a previously-failed or interrupted run.
   *
   * Loads the run record + per-node checkpoints, rehydrates the
   * execution context with all completed nodes' outputs, and re-runs
   * the loop. The standard executeFlow loop skips any node whose ID is
   * present in `context.skipCompletedNodeIds`, so completed work isn't
   * repeated.
   *
   * Requires `setCheckpointStore` to have been called — without it,
   * there are no per-node checkpoints to read and resume is a no-op
   * fall-through.
   *
   * @param {string} runId
   * @param {string|null} sessionId
   * @returns {Promise<{ runId, status, output? }>}
   */
  async resumeFlow(runId, sessionId = null) {
    if (!this.checkpointStore) {
      throw new Error('Cannot resume: no checkpoint store configured (call setCheckpointStore first)');
    }

    const run = await this.stateManager.getFlowRun(runId);
    if (!run) throw new Error(`Cannot resume: flow run not found: ${runId}`);
    if (run.status === 'completed') {
      return { runId, status: 'completed', output: run.output };
    }

    const flow = await this.stateManager.getFlow(run.flowId);
    if (!flow) throw new Error(`Cannot resume: flow definition not found: ${run.flowId}`);

    // Same schema gate as executeFlow — the flow definition might have
    // been edited between runs into an invalid shape.
    const validation = validateFlowDefinition(flow);
    if (!validation.ok) {
      const detail = validation.errors.map(e => e.message).join('; ');
      throw new Error(`Cannot resume: flow definition is invalid: ${detail}`);
    }

    // Rehydrate completed-node outputs from disk.
    const persistedOutputs = await this.checkpointStore.loadAllNodeResults(runId);
    const completedIds = new Set(Object.keys(persistedOutputs));
    this.logger.info(`Resuming flow ${run.flowId} run ${runId}`, {
      completedNodes: completedIds.size,
      totalNodes: flow.nodes.length,
    });

    this.activeExecutions.set(runId, {
      flowId: run.flowId, flow, runId, sessionId,
      status: 'running', startedAt: new Date(),
    });
    await this.stateManager.updateFlowRun(runId, { status: 'running', resumedAt: new Date().toISOString() });
    this.broadcastFlowUpdate(sessionId, { type: 'flow_run_resumed', runId, flowId: run.flowId });

    try {
      await this.ensureAgentsLoaded(flow.nodes);
      const sortedNodes = this.topologicalSort(flow.nodes, flow.edges);
      if (sortedNodes.length === 0) throw new Error('Flow has no executable nodes');

      const context = {
        input: run.initialInput?.userInput || run.initialInput?.input || '',
        nodeOutputs: { ...persistedOutputs },
        variables: { ...flow.variables },
        sortedNodes,
        flow,
        skipCompletedNodeIds: completedIds,
      };

      for (const node of sortedNodes) {
        const execution = this.activeExecutions.get(runId);
        if (!execution || execution.status === 'stopped') {
          await this.stateManager.updateFlowRun(runId, { status: 'stopped', completedAt: new Date().toISOString() });
          this.broadcastFlowUpdate(sessionId, { type: 'flow_run_stopped', runId, flowId: run.flowId });
          return { runId, status: 'stopped' };
        }
        if (completedIds.has(node.id)) {
          this.logger.info(`Resume: skipping already-completed node ${node.id}`);
          continue;
        }
        const nodeResult = await this.executeNode(node, context, runId, sessionId, flow);
        context.nodeOutputs[node.id] = nodeResult;
        if (node.data?.outputKey) context.nodeOutputs[node.data.outputKey] = nodeResult;
        await this.updateNodeState(runId, node.id, 'completed', nodeResult);
        try { await this.checkpointStore.saveNodeResult(runId, node.id, nodeResult); }
        catch (err) { this.logger.warn(`Resume: checkpoint save failed for ${node.id}`, { error: err.message }); }
      }

      const finalOutput = this.collectFinalOutput(sortedNodes, context);
      await this.stateManager.updateFlowRun(runId, {
        status: 'completed', output: finalOutput, completedAt: new Date().toISOString(),
      });
      this.broadcastFlowUpdate(sessionId, { type: 'flow_run_completed', runId, flowId: run.flowId, output: finalOutput });
      this.activeExecutions.delete(runId);
      return { runId, status: 'completed', output: finalOutput };
    } catch (error) {
      this.logger.error(`Flow resume failed: ${run.flowId}`, { runId, error: error.message });
      await this.stateManager.updateFlowRun(runId, {
        status: 'failed', error: error.message, completedAt: new Date().toISOString(),
      });
      this.broadcastFlowUpdate(sessionId, { type: 'flow_run_failed', runId, flowId: run.flowId, error: error.message });
      this.activeExecutions.delete(runId);
      return { runId, status: 'failed', error: error.message };
    }
  }

  /**
   * Stop a flow execution
   * @param {string} runId - Run identifier
   * @returns {Promise<boolean>} True if stopped
   */
  async stopExecution(runId) {
    const execution = this.activeExecutions.get(runId);
    if (!execution) {
      return false;
    }

    execution.status = 'stopped';

    // Clean up any completion listeners
    this.completionListeners.delete(runId);

    return true;
  }

  /**
   * Ensure all agents referenced in the flow are loaded
   * Automatically loads unloaded agents from disk
   * @param {Array} nodes - Flow nodes
   * @returns {Promise<void>}
   */
  async ensureAgentsLoaded(nodes) {
    if (!nodes || nodes.length === 0) return;

    // First: surface ALL agent nodes that have no agentId at all (e.g.
    // a template was loaded but the user hasn't picked agents yet).
    // Better one clear "you haven't filled in N agents yet" than a
    // confusing chain of partial loads followed by a "name === ''" error.
    const unbound = nodes.filter(n =>
      n.type === 'agent' &&
      (typeof n.data?.agentId !== 'string' || n.data.agentId.trim().length === 0)
    );
    if (unbound.length > 0) {
      const labels = unbound.map(n => n.data?.label || n.id).join(', ');
      throw new Error(
        `Cannot run flow: ${unbound.length} agent node(s) have no agent assigned (${labels}). Open each node and pick an agent in the properties panel.`
      );
    }

    // Extract agent IDs from agent nodes
    const agentNodes = nodes.filter(n => n.type === 'agent' && n.data?.agentId);
    const agentIds = [...new Set(agentNodes.map(n => n.data.agentId))];

    if (agentIds.length === 0) return;

    this.logger.info(`Checking ${agentIds.length} agent(s) for flow execution`);

    // Get project directory from config
    const projectDir = this.config.projectDir || process.cwd();

    for (const agentId of agentIds) {
      // Check if already loaded
      const existingAgent = await this.agentPool.getAgent(agentId);
      if (existingAgent) {
        this.logger.debug(`Agent ${agentId} already loaded`);
        continue;
      }

      // Agent not loaded - try to load from disk
      this.logger.info(`Loading agent from disk: ${agentId}`);
      try {
        const agent = await this.stateManager.importArchivedAgent(agentId, projectDir, this.agentPool);
        this.logger.info(`Successfully loaded agent: ${agentId}`);

        // Broadcast agent-loaded event so UI sidebar updates.
        // Defensive: this is pure UX — it must NEVER kill the load.
        // The WebServer instance exposes broadcastToSession(null, msg)
        // for "broadcast to all"; some other manager shapes use
        // broadcast(msg). Use whichever is available, swallow errors.
        if (this.webSocketManager && agent) {
          try {
            const msg = {
              type: 'agent-loaded',
              agent: {
                id: agent.id,
                name: agent.name,
                status: agent.status,
                model: agent.currentModel || agent.preferredModel,
                capabilities: agent.capabilities,
              },
            };
            if (typeof this.webSocketManager.broadcast === 'function') {
              this.webSocketManager.broadcast(msg);
            } else if (typeof this.webSocketManager.broadcastToSession === 'function') {
              this.webSocketManager.broadcastToSession(null, msg);
            }
          } catch (broadcastErr) {
            this.logger.warn(`Failed to broadcast agent-loaded event (non-fatal)`, {
              agentId, error: broadcastErr.message,
            });
          }
        }
      } catch (error) {
        throw new Error(`Failed to load agent ${agentId}: ${error.message}. Make sure the agent exists.`);
      }
    }
  }

  /**
   * Get list of unloaded agents referenced in a flow
   * Useful for UI to show which agents need to be loaded
   * @param {Object} flow - Flow definition
   * @returns {Promise<Array>} Array of { agentId, isLoaded, agentInfo }
   */
  async getFlowAgentStatus(flow) {
    if (!flow?.nodes) return [];

    const agentNodes = flow.nodes.filter(n => n.type === 'agent' && n.data?.agentId);
    const agentIds = [...new Set(agentNodes.map(n => n.data.agentId))];
    const projectDir = this.config.projectDir || process.cwd();

    const results = [];
    for (const agentId of agentIds) {
      const existingAgent = await this.agentPool.getAgent(agentId);
      if (existingAgent) {
        results.push({
          agentId,
          isLoaded: true,
          name: existingAgent.name,
          model: existingAgent.currentModel
        });
      } else {
        // Try to get info from disk
        try {
          const metadata = await this.stateManager.getAgentMetadata(agentId, projectDir);
          results.push({
            agentId,
            isLoaded: false,
            name: metadata?.name || agentId,
            model: metadata?.model
          });
        } catch {
          results.push({
            agentId,
            isLoaded: false,
            name: agentId,
            notFound: true
          });
        }
      }
    }

    return results;
  }

  /**
   * Topologically sort nodes based on edges
   * @param {Array} nodes - Array of nodes
   * @param {Array} edges - Array of edges
   * @returns {Array} Sorted nodes array
   */
  topologicalSort(nodes, edges) {
    if (!nodes || nodes.length === 0) {
      return [];
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const inDegree = new Map(nodes.map(n => [n.id, 0]));
    const adjacency = new Map(nodes.map(n => [n.id, []]));

    // Build adjacency list and calculate in-degrees
    for (const edge of (edges || [])) {
      const source = edge.source;
      const target = edge.target;

      if (adjacency.has(source) && inDegree.has(target)) {
        adjacency.get(source).push(target);
        inDegree.set(target, inDegree.get(target) + 1);
      }
    }

    // Find all nodes with in-degree 0 (starting nodes)
    const queue = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    // Process queue
    const sorted = [];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      const node = nodeMap.get(nodeId);
      if (node) {
        sorted.push(node);
      }

      for (const neighbor of adjacency.get(nodeId) || []) {
        const newDegree = inDegree.get(neighbor) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // Check for cycles
    if (sorted.length !== nodes.length) {
      this.logger.warn('Flow contains cycles, some nodes may not execute');
    }

    return sorted;
  }

  /**
   * Execute a single node
   * @param {Object} node - Node to execute
   * @param {Object} context - Execution context
   * @param {string} runId - Run identifier
   * @param {string} sessionId - Session ID for broadcasts
   * @param {Object} flow - Flow definition
   * @returns {Promise<Object>} Node execution result
   */
  async executeNode(node, context, runId, sessionId, flow) {
    this.logger.info(`Executing node: ${node.id}`, {
      type: node.type,
      label: node.data?.label
    });

    // Update node state to running
    await this.updateNodeState(runId, node.id, 'running', null);
    this.broadcastFlowUpdate(sessionId, {
      type: 'flow_node_started',
      runId,
      nodeId: node.id,
      nodeType: node.type
    });

    let result;

    try {
      switch (node.type) {
        case 'input':
          result = await this.executeInputNode(node, context);
          break;
        case 'agent':
          result = await this.executeAgentNode(node, context, runId, sessionId, flow);
          break;
        case 'output':
          result = await this.executeOutputNode(node, context, flow);
          break;
        default:
          throw new Error(`Unknown node type: ${node.type}`);
      }

      this.broadcastFlowUpdate(sessionId, {
        type: 'flow_node_completed',
        runId,
        nodeId: node.id,
        nodeType: node.type,
        output: this.truncateOutput(result)
      });

      return result;

    } catch (error) {
      // Phase 6.1: capture structured error info — kind classification
      // (timeout / agent-error / agent-failure) + per-attempt history
      // (from runWithRetry). Persisted on the node state so the run-
      // detail UI can show "node-B timed out after 3 attempts" without
      // re-parsing log files.
      const errorInfo = {
        kind: error?.kind || 'agent-error',
        message: error?.message || String(error),
        attempts: error?.attempts || null,
        lastAt: new Date().toISOString(),
      };
      await this.updateNodeState(runId, node.id, 'failed', { error: error.message }, errorInfo);
      this.broadcastFlowUpdate(sessionId, {
        type: 'flow_node_failed',
        runId,
        nodeId: node.id,
        nodeType: node.type,
        error: error.message,
        errorInfo,
      });
      throw error;
    }
  }

  /**
   * Execute an input node
   * @param {Object} node - Input node
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Input result
   */
  async executeInputNode(node, context) {
    // Apply prompt template if provided
    const template = node.data?.promptTemplate || '{{userInput}}';
    const output = this.applyTemplate(template, {
      userInput: context.input,
      ...context.variables
    });

    return {
      type: 'input',
      output,
      raw: context.input
    };
  }

  /**
   * Execute an agent node
   * @param {Object} node - Agent node
   * @param {Object} context - Execution context
   * @param {string} runId - Run identifier
   * @param {string} sessionId - Session ID
   * @param {Object} flow - Flow definition
   * @returns {Promise<Object>} Agent response
   */
  async executeAgentNode(node, context, runId, sessionId, flow) {
    const agentId = node.data?.agentId;
    if (!agentId) {
      throw new Error(`Agent node ${node.id} has no agent assigned`);
    }

    // Get agent
    const agent = await this.agentPool.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // ---- Phase 1: typed-input assembly ---------------------------------
    // For v2 nodes (with declared inputs[]), assemble typed values from
    // upstream outputs by following the edge field mappings. For legacy
    // nodes (no inputs[]), this falls back to {input, previousOutput}
    // built by concatenating upstream outputs — identical to v1 behavior.
    const assembled = assembleNodeInputs(node, flow.edges, context.nodeOutputs);

    if (!assembled.legacy && assembled.missing.length > 0) {
      // v2 fail-fast: a required input has no upstream value. Better to
      // bail here with a clear error than send the agent half its data.
      throw new Error(
        `Agent node ${node.id} (${agentId}) is missing required input(s): ${assembled.missing.join(', ')}`
      );
    }

    // Legacy fallback also exposes inputNodeIds + previousOutput for the
    // existing buildPreviousAgentData / context-injection code paths.
    const inputNodeIds = this.getInputNodeIds(node.id, flow.edges);
    const previousOutput = assembled.legacy
      ? assembled.values.previousOutput
      : this.collectPreviousOutput(inputNodeIds, context.nodeOutputs);

    // Apply prompt template. Typed input values are exposed BY NAME so
    // templates can write {{topic}}, {{research}}, etc. Legacy keys
    // {{input}} / {{previousOutput}} stay available for backwards compat.
    const template = node.data?.promptTemplate || '{{input}}';
    const prompt = this.applyTemplate(template, {
      input: previousOutput,
      previousOutput,
      ...context.variables,
      ...context.nodeOutputs,
      ...assembled.values,            // typed inputs win over collisions
    });

    this.logger.info(`Sending message to agent: ${agentId}`, {
      promptLength: prompt.length,
      nodeId: node.id
    });

    // Build flow metadata + previous-agent data ONCE — reused per retry
    const sortedNodes = context.sortedNodes || [];
    const nodePosition = sortedNodes.findIndex(n => n.id === node.id) + 1;
    const flowMetadata = {
      flowId: flow.id,
      flowName: flow.name || 'Unnamed Flow',
      // Phase 7: forward flow.description so system prompt can render
      // a "FLOW GOAL" section orienting each agent to the bigger picture.
      flowDescription: flow.description,
      nodeName: node.data?.label || 'Agent',
      nodePosition: nodePosition || 1,
      totalNodes: sortedNodes.length
    };
    const previousAgentData = this.buildPreviousAgentData(node, context, flow);

    // v2: derive the node's typed I/O contract for system-prompt
    // advertisement (handled downstream in agentScheduler). v1 nodes
    // don't have inputs/outputs declared → contract is undefined and
    // the scheduler skips the contract section.
    // Phase 7: also forward node.data.instructions (the per-node role
    // + success-criteria description) so the prompt can render a
    // NODE INSTRUCTIONS section.
    const hasTypedIO = Array.isArray(node.inputs) || Array.isArray(node.outputs);
    const hasInstructions = typeof node.data?.instructions === 'string' && node.data.instructions.trim().length > 0;
    const nodeContract = (hasTypedIO || hasInstructions)
      ? {
          inputs: node.inputs || [],
          outputs: node.outputs || [],
          instructions: node.data?.instructions,
          // Phase 8: opt-out flag — when true, scheduler keeps the
          // agent's native system prompt and APPENDS flow context
          // (legacy behavior). When false/absent, scheduler REPLACES
          // the system prompt with a flow-worker version, eliminating
          // identity conflicts.
          useNativeSystemPrompt: node.data?.useNativeSystemPrompt === true,
        }
      : undefined;

    // ---- Phase 3: per-node retry + per-node timeout -------------------
    // The closure below is "one full agent invocation" — clear conv,
    // queue message, wait for jobdone, validate outputs. Each retry is
    // a brand-new invocation with the agent's conversation reset.
    // Precedence: node.execution > flow.execution > config.flows.execution > defaults.
    const exec = this._resolveExecutionConfig(node, flow);

    // Store original mode for potential restoration on hard fail (not
    // currently restored — same as pre-Phase 3 behavior — but useful
    // to capture if we add cleanup).
    const originalMode = agent.mode; // eslint-disable-line no-unused-vars

    // Compute the list of missing required outputs given a job-done result.
    // Returns [] when contract is satisfied (or no contract). Used both
    // inside attemptOnce (to drive in-conversation re-prompts) and once
    // more after the retry loop as a defensive belt-and-suspenders check.
    const detectMissingOutputs = (result) => {
      if (!nodeContract || !Array.isArray(nodeContract.outputs) || nodeContract.outputs.length === 0) return [];
      const provided = (result?.outputs && typeof result.outputs === 'object') ? result.outputs : {};
      const missing = [];
      for (const decl of nodeContract.outputs) {
        if (!decl || typeof decl.name !== 'string') continue;
        if (!(decl.name in provided) || provided[decl.name] === null || provided[decl.name] === undefined) {
          missing.push(decl.name);
        }
      }
      return missing;
    };

    // Build a corrective re-prompt that lists EXACTLY which fields are
    // missing and shows the JSON shape the agent must emit on the next
    // job-done. This is sent in the SAME conversation — the agent keeps
    // its working memory and just patches the handoff.
    const MAX_REPROMPTS_PER_ATTEMPT = 2;
    const buildRepromptMessage = (missing) => {
      // Phase 7: enrich the corrective message with each declared
      // output's description + example so the agent has the FULL
      // contract to satisfy on the retry, not just a list of names.
      const required = nodeContract.outputs.map(o => {
        const lines = [`  • ${o.name}: ${o.type}`];
        if (typeof o.description === 'string' && o.description.trim()) {
          lines.push(`    ${o.description.trim()}`);
        }
        if (o.example !== undefined && o.example !== null) {
          try {
            const ex = (typeof o.example === 'string')
              ? JSON.stringify(o.example)
              : JSON.stringify(o.example, null, 2);
            const oneLine = !ex.includes('\n');
            lines.push(oneLine ? `    Example: ${ex}` : `    Example: ${ex.split('\n').join('\n    ')}`);
          } catch { /* ignore unstringifiable examples */ }
        }
        return lines.join('\n');
      }).join('\n');
      const example = nodeContract.outputs
        .map(o => `    "${o.name}": <${o.type} value>`).join(',\n');
      return [
        `⚠ Your previous job-done was incomplete. The flow node declares REQUIRED OUTPUTS that must all be present in the "outputs" field of job-done.`,
        ``,
        `Missing field(s): ${missing.join(', ')}`,
        ``,
        `All required outputs:`,
        required,
        ``,
        `Please call job-done AGAIN with the complete payload. The "outputs" object must include EVERY field above. Example structure:`,
        ``,
        `{`,
        `  "toolId": "jobdone",`,
        `  "actions": [{`,
        `    "action": "complete",`,
        `    "summary": "<your summary>",`,
        `    "outputs": {`,
        example,
        `    }`,
        `  }]`,
        `}`,
        ``,
        `Use the work you've already done — do not redo the task. Just emit the structured outputs.`,
      ].join('\n');
    };

    const attemptOnce = async (attemptIndex) => {
      // Phase 8: register the active contract so the jobdone tool can
      // validate the agent's job-done call AT TOOL TIME — rejecting
      // partial calls before they propagate. Cleared in the finally
      // block of the outer try (see below) when the attempt completes
      // (success OR failure).
      if (nodeContract) {
        this.activeContracts.set(agentId, nodeContract);
      }

      // Reset completion state + conversation for a clean slate every
      // OUTER retry. In-conversation re-prompts (below) keep history.
      agent.autonomousWorkComplete = false;
      agent.lastCompletionSummary = null;
      agent.lastCompletionDetails = null;
      agent.mode = AGENT_MODES.AGENT;
      await this.agentPool.persistAgentState(agentId);
      try {
        await this.agentPool.clearConversation(agentId);
      } catch (error) {
        this.logger.warn(`Failed to clear conversation for agent ${agentId}`, { error: error.message });
      }

      // Register the listener BEFORE queuing the message so a fast jobdone
      // can resolve us immediately.
      let completionPromise = this.waitForAgentCompletion(agentId, runId);

      await this.messageProcessor.processMessage(agentId, prompt, {
        sessionId,
        isFlowExecution: true,
        flowRunId: runId,
        flowNodeId: node.id,
        flowMetadata,
        previousAgentData,
        nodeContract,
        attemptIndex,
      });

      let result = await completionPromise;

      // v2 in-conversation re-prompt loop: when outputs are missing, ask
      // the agent to fix the LAST job-done call WITHOUT clearing memory.
      // Cheap (~1 model call vs full re-run) and almost always succeeds
      // because the agent already produced the data — they just forgot
      // to put it in the outputs field. After MAX_REPROMPTS, we fall
      // through to the outer retry which DOES clear conversation.
      let reprompts = 0;
      while (reprompts < MAX_REPROMPTS_PER_ATTEMPT) {
        const missing = detectMissingOutputs(result);
        if (missing.length === 0) break;

        this.logger.warn(`Flow node ${node.id}: re-prompting agent for missing outputs`, {
          missing, reprompts, attemptIndex,
        });

        // Re-arm the listener BEFORE sending — the agent's response will
        // resolve it.
        agent.autonomousWorkComplete = false;
        await this.agentPool.persistAgentState(agentId);
        completionPromise = this.waitForAgentCompletion(agentId, runId);

        await this.messageProcessor.processMessage(agentId, buildRepromptMessage(missing), {
          sessionId,
          isFlowExecution: true,
          flowRunId: runId,
          flowNodeId: node.id,
          flowMetadata,
          previousAgentData,
          nodeContract,
          attemptIndex,
          isReprompt: true,
        });

        result = await completionPromise;
        reprompts++;
      }

      // Final check: if still missing after re-prompts, throw a retryable
      // error so the OUTER loop (runWithRetry) starts a fresh agent
      // invocation with cleared conversation.
      const stillMissing = detectMissingOutputs(result);
      if (stillMissing.length > 0) {
        throw new FlowRetryError(
          `Agent ${agentId} (node ${node.id}) job-done is missing required output(s) after ${reprompts} re-prompt(s): ${stillMissing.join(', ')}. ` +
          `Declared outputs: ${nodeContract.outputs.map(o => `${o.name}:${o.type}`).join(', ')}`,
          'agent-error'
        );
      }
      return result;
    };

    let attemptHistory = [];
    let completionResult;
    try {
      const ran = await runWithRetry(attemptOnce, {
        timeoutMs: exec.timeoutMs,
        maxRetries: exec.maxRetries,
        retryOn: exec.retryOn,
        backoffBaseMs: exec.backoffBaseMs,
        backoffMultiplier: exec.backoffMultiplier,
        onAttempt: (meta) => {
          this.logger.warn(`Flow node ${node.id} attempt ${meta.attempt} failed`, {
            kind: meta.error?.kind, message: meta.error?.message, willRetry: meta.willRetry,
          });
        },
      });
      completionResult = ran.result;
      attemptHistory = ran.attempts;
    } catch (e) {
      // Surface the kind on the thrown error so the caller (executeFlow)
      // and observability can distinguish timeout vs agent-error vs
      // explicit failure.
      const kind = e?.kind || 'agent-error';
      const friendly = kind === 'timeout'
        ? `Agent ${agentId} timed out (after ${exec.maxRetries + 1} attempt(s))`
        : (e?.message || `Agent ${agentId} failed`);
      const wrapped = new Error(friendly);
      wrapped.kind = kind;
      wrapped.attempts = e?.attempts;
      // Phase 8: clear active contract on failure so the jobdone tool
      // doesn't validate against a stale node when the agent gets used
      // outside the flow later.
      this.activeContracts.delete(agentId);
      throw wrapped;
    }
    // Phase 8: clear active contract on success too.
    this.activeContracts.delete(agentId);

    // Get the agent's response (last assistant message)
    const updatedAgent = await this.agentPool.getAgent(agentId);
    const lastResponse = this.getLastAssistantMessage(updatedAgent);

    // Extract files created during this agent's execution (from completion result or messages)
    const filesCreated = completionResult.filesCreated || this.extractFilesFromCompletion(completionResult);

    // v2: outputs validation already happened inside attemptOnce; this
    // block stays only as a defensive belt-and-suspenders for the case
    // where attemptOnce somehow returns without outputs. Same logic.
    if (nodeContract && Array.isArray(nodeContract.outputs) && nodeContract.outputs.length > 0) {
      const provided = (completionResult.outputs && typeof completionResult.outputs === 'object')
        ? completionResult.outputs : {};
      const missing = [];
      for (const decl of nodeContract.outputs) {
        if (!decl || typeof decl.name !== 'string') continue;
        if (!(decl.name in provided) || provided[decl.name] === null || provided[decl.name] === undefined) {
          missing.push(decl.name);
        }
      }
      if (missing.length > 0) {
        throw new Error(
          `Agent ${agentId} (node ${node.id}) job-done is missing required output(s): ${missing.join(', ')}. ` +
          `Declared outputs: ${nodeContract.outputs.map(o => `${o.name}:${o.type}`).join(', ')}`
        );
      }
    }

    // Choose what becomes the legacy `output` field used by v1 handoff
    // and the prose preview in the next agent's system prompt.
    //
    // Preference order:
    //   1. summary + details (if both present, glue them)
    //   2. lastResponse (the agent's full final assistant message)
    //   3. summary alone
    //   4. ''
    //
    // Why: tiny "Done." summaries used to flow through as the next
    // agent's entire context — agents had nothing to work with. Falling
    // back to the assistant's last message gives the next agent a real
    // payload even when the upstream agent skipped `details`.
    const summary = (completionResult.summary || '').trim();
    const details = (completionResult.details || '').trim();
    let prose;
    if (summary && details) prose = `${summary}\n\n${details}`;
    else if (summary && summary.length < 40 && lastResponse) prose = lastResponse;
    else prose = summary || lastResponse || '';

    return {
      type: 'agent',
      agentId,
      agentName: agent.name,
      output: prose,
      // v2: structured outputs bag — keyed by declared field name. This
      // is what assembleNodeInputs reads when wiring the next node.
      outputs: completionResult.outputs,
      details: completionResult.details,
      filesCreated,
      // Phase 3: attempt history (one entry per try; failed entries
      // include { kind, message }). Surfaces in run-detail UI later.
      attempts: attemptHistory,
      success: completionResult.success !== false
    };
  }

  /**
   * Resolve effective per-node execution config — timeout, retries,
   * backoff, retryOn classes. Precedence (highest wins):
   *   node.execution > flow.execution > config.flows.execution > defaults
   *
   * Defaults:
   *   timeoutMs        300000 (5min, matches pre-Phase-3 behavior; legacy
   *                    config.flows.nodeTimeout still honored as a global
   *                    timeout for back-compat)
   *   maxRetries       1      (one fresh-conversation retry after re-prompts
   *                            exhaust — without this, structured-output
   *                            misses by some models cause flow failure
   *                            after only 2 in-conversation re-prompts).
   *                            Override per node to 0 to disable retries.
   *   retryOn          ['timeout', 'agent-error']
   *   backoffBaseMs    1000
   *   backoffMultiplier 2
   */
  _resolveExecutionConfig(node, flow) {
    const globalCfg = this.config?.flows?.execution || {};
    const flowCfg   = flow?.execution || {};
    const nodeCfg   = node?.execution || {};
    // Legacy: config.flows.nodeTimeout was the only knob in v1. Keep
    // it as the default timeout if more-specific configs aren't set.
    const legacyTimeout = this.config?.flows?.nodeTimeout;

    const pick = (k, fallback) =>
      nodeCfg[k] !== undefined ? nodeCfg[k] :
      flowCfg[k] !== undefined ? flowCfg[k] :
      globalCfg[k] !== undefined ? globalCfg[k] :
      fallback;

    return {
      timeoutMs:         pick('timeoutMs', legacyTimeout ?? 300000),
      maxRetries:        pick('maxRetries', 1),
      retryOn:           pick('retryOn', ['timeout', 'agent-error']),
      backoffBaseMs:     pick('backoffBaseMs', 1000),
      backoffMultiplier: pick('backoffMultiplier', 2),
    };
  }

  /**
   * Build previous agent data for context passing to next agent
   * @param {Object} currentNode - Current agent node
   * @param {Object} context - Execution context with nodeOutputs
   * @param {Object} flow - Flow definition
   * @returns {Object|null} Previous agent data or null if first agent
   */
  buildPreviousAgentData(currentNode, context, flow) {
    // Find the previous agent node that feeds into this one
    const inputNodeIds = this.getInputNodeIds(currentNode.id, flow.edges);

    // Look for the most recent agent node in the inputs.
    // We collect ALL upstream agent contributions (not just one) so a
    // node fed by multiple agents gets a merged outputs bag and a
    // labeled list of contributors. v1 fallback: pick the first.
    const contributors = [];
    for (const inputId of inputNodeIds) {
      const nodeOutput = context.nodeOutputs[inputId];
      if (nodeOutput && nodeOutput.type === 'agent') contributors.push(nodeOutput);
    }
    if (contributors.length === 0) return null;

    // Merge structured outputs from all contributors. When the same
    // field name appears on multiple upstream agents, the LATER one
    // wins (sortedNodes order in context.sortedNodes is topological).
    const mergedOutputs = {};
    for (const c of contributors) {
      if (c.outputs && typeof c.outputs === 'object') {
        Object.assign(mergedOutputs, c.outputs);
      }
    }

    // Primary "previous agent" used for the legacy fields stays the
    // most recent contributor (last one in topo order).
    const primary = contributors[contributors.length - 1];

    return {
      agentId: primary.agentId,
      agentName: primary.agentName || primary.agentId,
      summary: primary.output,
      details: primary.details,
      filesCreated: primary.filesCreated || [],
      output: primary.output,
      // Phase 5/6 fix: forward the structured outputs bag end-to-end.
      // Without this the next agent never sees the typed handoff —
      // only the free-text summary, defeating the whole v2 contract.
      outputs: Object.keys(mergedOutputs).length > 0 ? mergedOutputs : undefined,
      // When multiple agents fed this node, list them so the system
      // prompt can show "you received outputs from agents A, B".
      contributors: contributors.length > 1
        ? contributors.map(c => ({
            agentId: c.agentId,
            agentName: c.agentName || c.agentId,
            outputs: c.outputs || null,
          }))
        : undefined,
    };
  }

  /**
   * Extract file paths from completion result
   * Parses the summary/details for file path mentions
   * @param {Object} completionResult - Job-done completion result
   * @returns {Array<string>} Array of file paths
   */
  extractFilesFromCompletion(completionResult) {
    const files = new Set();

    const textToSearch = [
      completionResult.summary || '',
      completionResult.details || '',
      typeof completionResult.output === 'string' ? completionResult.output : ''
    ].join(' ');

    // Common patterns for file paths
    const patterns = [
      /(?:created|wrote|saved|generated|modified|updated)\s+(?:file\s+)?["']?([\/\\][\w\-\.\/\\]+\.\w+)["']?/gi,
      /(?:at|to|in)\s+["']?([\/\\][\w\-\.\/\\]+\.\w+)["']?/gi,
      /File\s+(?:created|written|saved):\s*([\/\\][\w\-\.\/\\]+\.\w+)/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(textToSearch)) !== null) {
        const path = match[1];
        if (path && !path.includes('http') && path.length > 3) {
          files.add(path);
        }
      }
    }

    return Array.from(files);
  }

  /**
   * Execute an output node
   * @param {Object} node - Output node
   * @param {Object} context - Execution context
   * @param {Object} flow - Flow definition
   * @returns {Promise<Object>} Output result
   */
  async executeOutputNode(node, context, flow) {
    // Collect all previous outputs
    const inputNodeIds = this.getInputNodeIds(node.id, flow.edges);
    const output = this.collectPreviousOutput(inputNodeIds, context.nodeOutputs);

    // Apply output format
    const format = node.data?.outputFormat || 'text';
    let formattedOutput;

    switch (format) {
      case 'json':
        formattedOutput = typeof output === 'object' ? output : { result: output };
        break;
      case 'markdown':
        formattedOutput = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
        break;
      case 'text':
      default:
        formattedOutput = typeof output === 'string' ? output : JSON.stringify(output);
        break;
    }

    return {
      type: 'output',
      format,
      output: formattedOutput
    };
  }

  /**
   * Wait for an agent to complete via jobdone tool.
   * Completion is detected two ways:
   * 1. Direct signal: notifyAgentCompletion() called from jobDoneTool
   * 2. Polling fallback: checks autonomousWorkComplete flag every 2s
   * @param {string} agentId - Agent ID
   * @param {string} runId - Run ID
   * @returns {Promise<Object>} Completion result
   */
  waitForAgentCompletion(agentId, runId) {
    return new Promise((resolve) => {
      const key = `${runId}-${agentId}`;
      let checkInterval = null;

      const onComplete = (result) => {
        if (checkInterval) clearInterval(checkInterval);
        this.completionListeners.delete(key);
        resolve(result);
      };

      // Store listener so notifyAgentCompletion() can resolve directly
      this.completionListeners.set(key, {
        resolve: onComplete,
        agentId,
        runId
      });

      // Polling fallback: check autonomousWorkComplete flag
      checkInterval = setInterval(async () => {
        try {
          const agent = await this.agentPool.getAgent(agentId);
          if (agent && agent.autonomousWorkComplete) {
            onComplete({
              completed: true,
              summary: agent.lastCompletionSummary || '',
              details: agent.lastCompletionDetails || null,
              success: true
            });
          }
        } catch (error) {
          // Ignore errors during polling
        }
      }, 2000);

      // Clean up interval on timeout
      setTimeout(() => {
        if (checkInterval) clearInterval(checkInterval);
      }, this.config.flows?.nodeTimeout || 300000);
    });
  }

  /**
   * Notify that an agent has completed its work (called from jobDoneTool).
   * Directly resolves the completion promise instead of waiting for next poll.
   * @param {string} agentId - Agent ID
   * @param {Object} completionData - { summary, success, details }
   */
  notifyAgentCompletion(agentId, completionData = {}) {
    // Find any listener waiting for this agent
    for (const [key, listener] of this.completionListeners.entries()) {
      if (listener.agentId === agentId) {
        this.logger.info(`Flow: Agent ${agentId} completed via direct signal`, {
          runId: listener.runId,
          success: completionData.success
        });
        listener.resolve({
          completed: true,
          summary: completionData.summary || '',
          details: completionData.details || null,
          // v2: structured outputs bag — forwarded through to the
          // executor's contract validator. v1 callers don't set this.
          outputs: completionData.outputs,
          success: completionData.success !== false
        });
        return true;
      }
    }
    return false; // No listener found (agent not in a flow)
  }

  /**
   * Create a timeout promise
   * @param {number} ms - Timeout in milliseconds
   * @returns {Promise<Object>} Timeout result
   */
  createTimeoutPromise(ms) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ timeout: true });
      }, ms);
    });
  }

  /**
   * Get IDs of nodes that connect to a target node
   * @param {string} targetNodeId - Target node ID
   * @param {Array} edges - Flow edges
   * @returns {Array} Source node IDs
   */
  getInputNodeIds(targetNodeId, edges) {
    return (edges || [])
      .filter(e => e.target === targetNodeId)
      .map(e => e.source);
  }

  /**
   * Collect output from previous nodes
   * @param {Array} nodeIds - Node IDs to collect from
   * @param {Object} nodeOutputs - Map of node outputs
   * @returns {string} Combined output
   */
  collectPreviousOutput(nodeIds, nodeOutputs) {
    const outputs = nodeIds
      .map(id => nodeOutputs[id])
      .filter(o => o)
      .map(o => o.output || o)
      .filter(o => o);

    if (outputs.length === 0) return '';
    if (outputs.length === 1) return outputs[0];

    // Combine multiple outputs
    return outputs.join('\n\n---\n\n');
  }

  /**
   * Collect final output from output nodes
   * @param {Array} sortedNodes - Sorted nodes
   * @param {Object} context - Execution context
   * @returns {Object} Final output
   */
  collectFinalOutput(sortedNodes, context) {
    const outputNodes = sortedNodes.filter(n => n.type === 'output');

    if (outputNodes.length === 0) {
      // No output node, return last node's output
      const lastNode = sortedNodes[sortedNodes.length - 1];
      return context.nodeOutputs[lastNode?.id]?.output || null;
    }

    if (outputNodes.length === 1) {
      return context.nodeOutputs[outputNodes[0].id]?.output;
    }

    // Multiple output nodes
    const outputs = {};
    for (const node of outputNodes) {
      const key = node.data?.label || node.id;
      outputs[key] = context.nodeOutputs[node.id]?.output;
    }
    return outputs;
  }

  /**
   * Apply template with variable substitution
   * @param {string} template - Template string
   * @param {Object} variables - Variables to substitute
   * @returns {string} Processed template
   */
  applyTemplate(template, variables) {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      const valueStr = typeof value === 'object'
        ? JSON.stringify(value)
        : String(value || '');
      result = result.split(placeholder).join(valueStr);
    }

    return result;
  }

  /**
   * Update node state in the run record.
   *
   * Phase 6.1: optional `errorInfo` captures classified failure detail
   * (kind, message, attempts) for run-detail diagnostics. Stored as
   * `nodeStates[id].error` alongside the truncated result.
   *
   * @param {string} runId
   * @param {string} nodeId
   * @param {string} status      'running' | 'completed' | 'failed'
   * @param {Object} result
   * @param {Object} [errorInfo] { kind, message, attempts, lastAt }
   */
  async updateNodeState(runId, nodeId, status, result, errorInfo) {
    const run = await this.stateManager.getFlowRun(runId);
    if (!run) return;

    const nodeStates = run.nodeStates || {};
    const entry = {
      status,
      result: result ? this.truncateOutput(result) : null,
      updatedAt: new Date().toISOString()
    };
    if (errorInfo && typeof errorInfo === 'object') {
      entry.error = errorInfo;
    }
    nodeStates[nodeId] = entry;

    await this.stateManager.updateFlowRun(runId, { nodeStates });
  }

  /**
   * Get the last assistant message from an agent
   * @param {Object} agent - Agent object
   * @returns {string|null} Last assistant message content
   */
  getLastAssistantMessage(agent) {
    const messages = agent?.conversations?.full?.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        return messages[i].content;
      }
    }
    return null;
  }

  /**
   * Truncate output for storage/transmission.
   *
   * Special-case: when the output is an agent completion result with a
   * structured `outputs` field, preserve the `outputs` object verbatim.
   * Those are the typed contract values that downstream nodes consume —
   * truncating them silently breaks edge field-mapping (`writer.bullets
   * → critic.bullets` would deliver a string-truncation marker instead
   * of the real list). Long prose lives in `output` / `summary` /
   * `details`; those get the legacy string truncation.
   *
   * @param {Object} output - Output to truncate
   * @returns {Object} Truncated output
   */
  truncateOutput(output) {
    if (typeof output === 'string' && output.length > 1000) {
      return output.substring(0, 1000) + '... (truncated)';
    }
    if (output && typeof output === 'object') {
      // Agent-completion shape: preserve structured `outputs`, truncate
      // only the long prose fields. Keeps the run dump useful for
      // post-mortem inspection AND keeps downstream edges working.
      const hasStructuredOutputs = output.outputs && typeof output.outputs === 'object';
      if (hasStructuredOutputs) {
        const trunc = { ...output };
        for (const k of ['output', 'summary', 'details']) {
          if (typeof trunc[k] === 'string' && trunc[k].length > 1000) {
            trunc[k] = trunc[k].substring(0, 1000) + '... (truncated)';
          }
        }
        // outputs object preserved as-is; it's structured contract data.
        return trunc;
      }
      const str = JSON.stringify(output);
      if (str.length > 1000) {
        return { truncated: true, preview: str.substring(0, 1000) };
      }
    }
    return output;
  }

  /**
   * Broadcast flow update via WebSocket
   * @param {string} sessionId - Session ID (null broadcasts to all)
   * @param {Object} data - Update data
   */
  broadcastFlowUpdate(sessionId, data) {
    if (!this.webSocketManager) return;

    try {
      // broadcastToSession with null sessionId broadcasts to all connections
      this.webSocketManager.broadcastToSession(sessionId, {
        type: 'flow_update',
        data,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.warn('Failed to broadcast flow update', { error: error.message });
    }
  }

  /**
   * Get active executions
   * @returns {Array} Active execution info
   */
  getActiveExecutions() {
    return Array.from(this.activeExecutions.entries()).map(([runId, exec]) => ({
      runId,
      flowId: exec.flowId,
      status: exec.status,
      startedAt: exec.startedAt
    }));
  }
}

export default FlowExecutor;
