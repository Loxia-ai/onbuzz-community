/**
 * StateManager - Handles state persistence, recovery, and project state management
 *
 * Purpose:
 * - Project state persistence and recovery
 * - Agent state management across sessions
 * - Multi-model conversation state handling
 * - Context reference state management
 * - Session recovery and resume functionality
 *
 * IMPORTANT: State is now stored in a platform-appropriate user data directory
 * that persists across npm package updates. See userDataDir.js for details.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getUserDataPaths, ensureUserDataDirs } from '../utilities/userDataDir.js';

class StateManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;

    // UPDATED: Use persistent user data directory instead of relative path
    // This ensures data survives npm package updates
    const userPaths = getUserDataPaths();
    this.stateDirectory = userPaths.state;
    this.userDataPaths = userPaths;

    // Legacy: Keep for backwards compatibility detection
    this.legacyStateDirectory = config.system?.stateDirectory || '.loxia-state';
    this.stateVersion = '1.0.0';
    
    // State file paths
    this.stateFiles = {
      projectState: 'project-state.json',
      agentIndex: 'agent-index.json',
      teamIndex: 'team-index.json',
      flowIndex: 'flow-index.json',
      flowRunIndex: 'flow-run-index.json',
      conversationIndex: 'conversation-index.json',
      lastSession: 'last-session.json',
      contextReferences: 'context-references.json',
      asyncOperations: 'operations/async-operations.json',
      pausedAgents: 'operations/paused-agents.json',
      toolHistory: 'operations/tool-history.json',
      modelRouterCache: 'models/model-router-cache.json',
      errorRecoveryLog: 'models/error-recovery-log.json'
    };
  }

  /**
   * Get the state directory path
   * UPDATED: Now returns the user data directory (absolute path)
   * The projectDir parameter is kept for API compatibility but is ignored
   * @param {string} projectDir - Ignored, kept for compatibility
   * @returns {string} Absolute path to state directory
   */
  getStateDir(projectDir) {
    // Always use the persistent user data directory
    return this.stateDirectory;
  }

  /**
   * Get the agents subdirectory path
   * @returns {string} Absolute path to agents directory
   */
  getAgentsDir() {
    return this.userDataPaths.agents;
  }

  /**
   * Initialize state directory structure
   * @param {string} projectDir - Project directory path (now ignored, uses user data dir)
   * @returns {Promise<void>}
   */
  async initializeStateDirectory(projectDir) {
    // UPDATED: Use persistent user data directory instead of project-relative path
    // The projectDir parameter is kept for API compatibility but now ignored
    try {
      // Use the centralized utility to create all necessary directories
      const paths = await ensureUserDataDirs();

      this.logger.info(`State directory initialized in user data location`, {
        stateDir: paths.state,
        platform: process.platform
      });

    } catch (error) {
      this.logger.error(`Failed to initialize state directory: ${error.message}`);
      throw error;
    }
  }

  /**
   * Resume project from saved state
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Resumed project state
   */
  async resumeProject(projectDir) {
    try {
      await this.initializeStateDirectory(projectDir);
      
      // Load project state
      const projectState = await this.loadProjectState(projectDir);
      const agentIndex = await this.loadAgentIndex(projectDir);
      
      // Restore agents with multi-model conversations
      const restoredAgents = [];
      for (const [agentId, agentInfo] of Object.entries(agentIndex)) {
        try {
          const agent = await this.restoreAgent(agentId, agentInfo, projectDir);
          restoredAgents.push(agent);
        } catch (error) {
          this.logger.warn(`Failed to restore agent: ${agentId}`, error.message);
        }
      }
      
      // Restore async operations
      const asyncOperations = await this.restoreAsyncOperations(projectDir);
      
      // Restore paused agents
      const pausedAgents = await this.restorePausedAgents(projectDir);
      
      // Restore context references
      const contextReferences = await this.restoreContextReferences(projectDir);
      
      const resumedState = {
        projectState,
        agents: restoredAgents,
        asyncOperations,
        pausedAgents,
        contextReferences,
        resumedSuccessfully: true,
        resumedAt: new Date().toISOString()
      };
      
      // Update last session
      await this.saveLastSession(projectDir, {
        resumedAt: new Date().toISOString(),
        agentCount: restoredAgents.length,
        operationCount: asyncOperations.length
      });
      
      this.logger.info(`Project resumed successfully`, {
        projectDir,
        agentCount: restoredAgents.length,
        operationCount: asyncOperations.length
      });
      
      return resumedState;
      
    } catch (error) {
      this.logger.error(`Project resume failed: ${error.message}`, {
        projectDir,
        error: error.stack
      });
      
      return {
        projectState: null,
        agents: [],
        asyncOperations: [],
        pausedAgents: [],
        contextReferences: [],
        resumedSuccessfully: false,
        error: error.message
      };
    }
  }

  /**
   * Persist agent state to storage
   * @param {Object} agent - Agent object to persist
   * @param {string} projectDir - Project directory path
   * @returns {Promise<void>}
   */
  async persistAgentState(agent, projectDir = process.cwd()) {
    const stateDir = this.getStateDir(projectDir);
    const agentStateFile = path.join(stateDir, 'agents', `agent-${agent.id}-state.json`);
    const agentConversationsFile = path.join(stateDir, 'agents', `agent-${agent.id}-conversations.json`);
    
    try {
      // Separate conversations from main agent state
      const { conversations, ...agentState } = agent;
      
      // Save agent state
      await this.saveJSON(agentStateFile, {
        version: this.stateVersion,
        agentId: agent.id,
        state: agentState,
        lastPersisted: new Date().toISOString()
      });
      
      // Save conversations separately
      await this.saveJSON(agentConversationsFile, {
        version: this.stateVersion,
        agentId: agent.id,
        conversations,
        lastPersisted: new Date().toISOString()
      });
      
      // Update agent index
      await this.updateAgentIndex(agent, projectDir);
      
      this.logger.debug(`Agent state persisted: ${agent.id}`);
      
    } catch (error) {
      this.logger.error(`Failed to persist agent state: ${error.message}`, {
        agentId: agent.id,
        error: error.stack
      });
      throw error;
    }
  }

  /**
   * Get project state
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Project state object
   */
  async getProjectState(projectDir) {
    return await this.loadProjectState(projectDir);
  }

  /**
   * Load project state from storage
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Project state object
   */
  async loadProjectState(projectDir) {
    const stateFile = path.join(this.stateDirectory, this.stateFiles.projectState);
    
    try {
      const data = await this.loadJSON(stateFile);
      return data;
    } catch (error) {
      // Return default project state if file doesn't exist
      const defaultState = {
        version: this.stateVersion,
        projectDir,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        activeAgents: [],
        lastActiveSession: null,
        configuration: {
          defaultModel: this.config.system?.defaultModel || 'anthropic-sonnet',
          allowedTools: ['terminal', 'filesystem', 'browser'],
          budgetLimit: 100.00
        }
      };
      
      await this.saveProjectState(projectDir, defaultState);
      return defaultState;
    }
  }

  /**
   * Save project state to storage
   * @param {string} projectDir - Project directory path
   * @param {Object} projectState - Project state object
   * @returns {Promise<void>}
   */
  async saveProjectState(projectDir, projectState) {
    const stateFile = path.join(this.stateDirectory, this.stateFiles.projectState);
    
    const stateData = {
      ...projectState,
      lastModified: new Date().toISOString()
    };
    
    await this.saveJSON(stateFile, stateData);
  }

  /**
   * Load agent index
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Agent index object
   */
  async loadAgentIndex(projectDir) {
    const indexFile = path.join(this.stateDirectory, this.stateFiles.agentIndex);
    
    try {
      return await this.loadJSON(indexFile);
    } catch (error) {
      return {}; // Return empty index if file doesn't exist
    }
  }

  /**
   * Update agent index
   * @param {Object} agent - Agent object
   * @param {string} projectDir - Project directory path
   * @returns {Promise<void>}
   */
  async updateAgentIndex(agent, projectDir) {
    const indexFile = path.join(this.stateDirectory, this.stateFiles.agentIndex);
    
    let agentIndex;
    try {
      agentIndex = await this.loadJSON(indexFile);
    } catch {
      agentIndex = {};
    }
    
    agentIndex[agent.id] = {
      name: agent.name,
      type: agent.type,
      stateFile: `agents/agent-${agent.id}-state.json`,
      conversationsFile: `agents/agent-${agent.id}-conversations.json`,
      lastActivity: agent.lastActivity,
      model: agent.currentModel,
      status: agent.status,
      capabilities: agent.capabilities || []
    };
    
    await this.saveJSON(indexFile, agentIndex);
  }

  // ==================== TEAM INDEX METHODS ====================

  /**
   * Load team index
   * @param {string} projectDir - Project directory path (ignored, uses user data dir)
   * @returns {Promise<Object>} Team index object
   */
  async loadTeamIndex(projectDir) {
    const indexFile = path.join(this.stateDirectory, this.stateFiles.teamIndex);

    try {
      return await this.loadJSON(indexFile);
    } catch (error) {
      return {}; // Return empty index if file doesn't exist
    }
  }

  /**
   * Save team index
   * @param {Object} teamIndex - Team index object to save
   * @returns {Promise<void>}
   */
  async saveTeamIndex(teamIndex) {
    const indexFile = path.join(this.stateDirectory, this.stateFiles.teamIndex);
    await this.saveJSON(indexFile, teamIndex);
  }

  /**
   * Get all teams
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Array>} Array of team objects
   */
  async getAllTeams(projectDir) {
    const teamIndex = await this.loadTeamIndex(projectDir);
    return Object.entries(teamIndex).map(([id, team]) => ({
      id,
      ...team
    }));
  }

  /**
   * Get a single team by ID
   * @param {string} teamId - Team identifier
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Object|null>} Team object or null if not found
   */
  async getTeam(teamId, projectDir) {
    const teamIndex = await this.loadTeamIndex(projectDir);
    if (teamIndex[teamId]) {
      return { id: teamId, ...teamIndex[teamId] };
    }
    return null;
  }

  /**
   * Create a new team
   * @param {Object} teamData - Team data { name, description, color }
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Object>} Created team object
   */
  async createTeam(teamData, projectDir) {
    const teamIndex = await this.loadTeamIndex(projectDir);

    // Generate team ID
    const safeName = (teamData.name || 'team').toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20);
    const teamId = `team-${safeName}-${Date.now()}`;

    const team = {
      name: teamData.name,
      description: teamData.description || '',
      memberAgentIds: [],
      color: teamData.color || '#3B82F6', // Default blue
      // Used by platformControlTool's `ownedByMe` team scope. null when
      // the team was created via the UI / by no specific agent. When an
      // agent creates a team via the platformcontrol tool, this carries
      // the caller's id so ownership scope filtering works.
      createdBy: typeof teamData.createdBy === 'string' ? teamData.createdBy : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    teamIndex[teamId] = team;
    await this.saveTeamIndex(teamIndex);

    this.logger.info(`Team created: ${teamId}`, { name: team.name });

    return { id: teamId, ...team };
  }

  /**
   * Update an existing team
   * @param {string} teamId - Team identifier
   * @param {Object} updates - Fields to update
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Object>} Updated team object
   */
  async updateTeam(teamId, updates, projectDir) {
    const teamIndex = await this.loadTeamIndex(projectDir);

    if (!teamIndex[teamId]) {
      throw new Error(`Team ${teamId} not found`);
    }

    // Only allow updating specific fields
    const allowedFields = ['name', 'description', 'color', 'memberAgentIds'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        teamIndex[teamId][field] = updates[field];
      }
    }
    teamIndex[teamId].updatedAt = new Date().toISOString();

    await this.saveTeamIndex(teamIndex);

    this.logger.info(`Team updated: ${teamId}`, { updates: Object.keys(updates) });

    return { id: teamId, ...teamIndex[teamId] };
  }

  /**
   * Delete a team
   * @param {string} teamId - Team identifier
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteTeam(teamId, projectDir) {
    const teamIndex = await this.loadTeamIndex(projectDir);

    if (!teamIndex[teamId]) {
      throw new Error(`Team ${teamId} not found`);
    }

    const teamName = teamIndex[teamId].name;
    delete teamIndex[teamId];
    await this.saveTeamIndex(teamIndex);

    this.logger.info(`Team deleted: ${teamId}`, { name: teamName });

    return true;
  }

  /**
   * Add an agent to a team
   * @param {string} teamId - Team identifier
   * @param {string} agentId - Agent identifier to add
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Object>} Updated team object
   */
  async addAgentToTeam(teamId, agentId, projectDir) {
    const teamIndex = await this.loadTeamIndex(projectDir);

    if (!teamIndex[teamId]) {
      throw new Error(`Team ${teamId} not found`);
    }

    // Check if agent already in team
    if (!teamIndex[teamId].memberAgentIds.includes(agentId)) {
      teamIndex[teamId].memberAgentIds.push(agentId);
      teamIndex[teamId].updatedAt = new Date().toISOString();
      await this.saveTeamIndex(teamIndex);

      this.logger.info(`Agent added to team`, { teamId, agentId });
    }

    return { id: teamId, ...teamIndex[teamId] };
  }

  /**
   * Remove an agent from a team
   * @param {string} teamId - Team identifier
   * @param {string} agentId - Agent identifier to remove
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Object>} Updated team object
   */
  async removeAgentFromTeam(teamId, agentId, projectDir) {
    const teamIndex = await this.loadTeamIndex(projectDir);

    if (!teamIndex[teamId]) {
      throw new Error(`Team ${teamId} not found`);
    }

    const index = teamIndex[teamId].memberAgentIds.indexOf(agentId);
    if (index > -1) {
      teamIndex[teamId].memberAgentIds.splice(index, 1);
      teamIndex[teamId].updatedAt = new Date().toISOString();
      await this.saveTeamIndex(teamIndex);

      this.logger.info(`Agent removed from team`, { teamId, agentId });
    }

    return { id: teamId, ...teamIndex[teamId] };
  }

  /**
   * Get all teams that contain a specific agent
   * @param {string} agentId - Agent identifier
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Array>} Array of team objects containing the agent
   */
  async getAgentTeams(agentId, projectDir) {
    const teams = await this.getAllTeams(projectDir);
    return teams.filter(team => team.memberAgentIds.includes(agentId));
  }

  // ==================== END TEAM INDEX METHODS ====================

  // ==================== FLOW INDEX METHODS ====================

  /**
   * Load flow index
   * @param {string} projectDir - Project directory path (ignored, uses user data dir)
   * @returns {Promise<Object>} Flow index object
   */
  async loadFlowIndex(projectDir) {
    const indexFile = path.join(this.stateDirectory, this.stateFiles.flowIndex);

    try {
      return await this.loadJSON(indexFile);
    } catch (error) {
      return {}; // Return empty index if file doesn't exist
    }
  }

  /**
   * Save flow index
   * @param {Object} flowIndex - Flow index object to save
   * @returns {Promise<void>}
   */
  async saveFlowIndex(flowIndex) {
    const indexFile = path.join(this.stateDirectory, this.stateFiles.flowIndex);
    await this.saveJSON(indexFile, flowIndex);
  }

  /**
   * Get all flows
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Array>} Array of flow objects
   */
  async getAllFlows(projectDir) {
    const flowIndex = await this.loadFlowIndex(projectDir);
    return Object.entries(flowIndex).map(([id, flow]) => ({
      id,
      ...flow
    }));
  }

  /**
   * Get a single flow by ID
   * @param {string} flowId - Flow identifier
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Object|null>} Flow object or null if not found
   */
  async getFlow(flowId, projectDir) {
    const flowIndex = await this.loadFlowIndex(projectDir);
    if (flowIndex[flowId]) {
      return { id: flowId, ...flowIndex[flowId] };
    }
    return null;
  }

  /**
   * Create a new flow
   * @param {Object} flowData - Flow data { name, description, nodes, edges, variables }
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Object>} Created flow object
   */
  async createFlow(flowData, projectDir) {
    const flowIndex = await this.loadFlowIndex(projectDir);

    // Generate flow ID
    const safeName = (flowData.name || 'flow').toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20);
    const flowId = `flow-${safeName}-${Date.now()}`;

    // Stamp edge ids on save. Templates and marketplace-installed flows
    // ship without edge ids; ReactFlow refuses to render edges that
    // don't have a unique `id`, so unstamped edges show up as
    // disconnected dots on the canvas. Doing this here rather than in
    // the editor means the durable shape on disk is always renderable.
    // Helper is shared with FlowEditor's defense-in-depth layer so the
    // id format stays consistent across save + reload.
    const { ensureEdgeIds } = await import('../utilities/flowEdgeIds.js');
    const stampedEdges = ensureEdgeIds(flowData.edges);

    const flow = {
      name: flowData.name,
      description: flowData.description || '',
      nodes: flowData.nodes || [],
      edges: stampedEdges,
      variables: flowData.variables || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // createdBy: only present when the caller stamps it (e.g.
      // platformControlTool's create-flow path). Not required for the
      // happy-path UI flow but durable when set.
      ...(flowData.createdBy ? { createdBy: flowData.createdBy } : {})
    };

    flowIndex[flowId] = flow;
    await this.saveFlowIndex(flowIndex);

    this.logger.info(`Flow created: ${flowId}`, { name: flow.name });

    return { id: flowId, ...flow };
  }

  /**
   * Update an existing flow
   * @param {string} flowId - Flow identifier
   * @param {Object} updates - Fields to update
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Object>} Updated flow object
   */
  async updateFlow(flowId, updates, projectDir) {
    const flowIndex = await this.loadFlowIndex(projectDir);

    if (!flowIndex[flowId]) {
      throw new Error(`Flow ${flowId} not found`);
    }

    // Only allow updating specific fields. `version` and `schemaVersion`
    // are added so the Phase 6 version-stamp write-back persists, and
    // so v2 flows can be marked when typed I/O is added.
    const allowedFields = ['name', 'description', 'nodes', 'edges', 'variables', 'version', 'schemaVersion'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        flowIndex[flowId][field] = updates[field];
      }
    }
    flowIndex[flowId].updatedAt = new Date().toISOString();

    await this.saveFlowIndex(flowIndex);

    this.logger.info(`Flow updated: ${flowId}`, { updates: Object.keys(updates) });

    return { id: flowId, ...flowIndex[flowId] };
  }

  /**
   * Delete a flow
   * @param {string} flowId - Flow identifier
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteFlow(flowId, projectDir) {
    const flowIndex = await this.loadFlowIndex(projectDir);

    if (!flowIndex[flowId]) {
      throw new Error(`Flow ${flowId} not found`);
    }

    const flowName = flowIndex[flowId].name;
    delete flowIndex[flowId];
    await this.saveFlowIndex(flowIndex);

    this.logger.info(`Flow deleted: ${flowId}`, { name: flowName });

    return true;
  }

  // ==================== FLOW RUN METHODS ====================

  /**
   * Load flow run index
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Object>} Flow run index object
   */
  async loadFlowRunIndex(projectDir) {
    const indexFile = path.join(this.stateDirectory, this.stateFiles.flowRunIndex);

    try {
      return await this.loadJSON(indexFile);
    } catch (error) {
      return {}; // Return empty index if file doesn't exist
    }
  }

  /**
   * Save flow run index
   * @param {Object} runIndex - Flow run index object to save
   * @returns {Promise<void>}
   */
  async saveFlowRunIndex(runIndex) {
    const indexFile = path.join(this.stateDirectory, this.stateFiles.flowRunIndex);
    await this.saveJSON(indexFile, runIndex);
  }

  /**
   * Create a new flow run
   * @param {string} flowId - Flow identifier
   * @param {Object} initialInput - Initial input for the flow
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Object>} Created flow run object
   */
  async createFlowRun(flowId, initialInput, projectDir) {
    const runIndex = await this.loadFlowRunIndex(projectDir);

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const run = {
      flowId,
      status: 'pending', // pending, running, completed, failed, stopped
      initialInput,
      nodeStates: {},
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null
    };

    runIndex[runId] = run;
    await this.saveFlowRunIndex(runIndex);

    this.logger.info(`Flow run created: ${runId}`, { flowId });

    return { id: runId, ...run };
  }

  /**
   * Update a flow run
   * @param {string} runId - Run identifier
   * @param {Object} updates - Fields to update
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Object>} Updated flow run object
   */
  async updateFlowRun(runId, updates, projectDir) {
    const runIndex = await this.loadFlowRunIndex(projectDir);

    if (!runIndex[runId]) {
      throw new Error(`Flow run ${runId} not found`);
    }

    // Only allow updating specific fields
    const allowedFields = ['status', 'nodeStates', 'completedAt', 'error', 'output'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        runIndex[runId][field] = updates[field];
      }
    }

    await this.saveFlowRunIndex(runIndex);

    this.logger.info(`Flow run updated: ${runId}`, { status: updates.status });

    return { id: runId, ...runIndex[runId] };
  }

  /**
   * Get a flow run by ID
   * @param {string} runId - Run identifier
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Object|null>} Flow run object or null if not found
   */
  async getFlowRun(runId, projectDir) {
    const runIndex = await this.loadFlowRunIndex(projectDir);
    if (runIndex[runId]) {
      return { id: runId, ...runIndex[runId] };
    }
    return null;
  }

  /**
   * Get all runs for a specific flow
   * @param {string} flowId - Flow identifier
   * @param {string} projectDir - Project directory path (ignored)
   * @returns {Promise<Array>} Array of flow run objects
   */
  async getFlowRuns(flowId, projectDir) {
    const runIndex = await this.loadFlowRunIndex(projectDir);
    return Object.entries(runIndex)
      .filter(([, run]) => run.flowId === flowId)
      .map(([id, run]) => ({ id, ...run }))
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  }

  // ==================== END FLOW INDEX METHODS ====================

  /**
   * Restore agent from saved state
   * @param {string} agentId - Agent identifier
   * @param {Object} agentInfo - Agent info from index
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Restored agent object
   */
  async restoreAgent(agentId, agentInfo, projectDir) {
    const stateDir = this.getStateDir(projectDir);
    const stateFile = path.join(stateDir, agentInfo.stateFile);
    const conversationsFile = path.join(stateDir, agentInfo.conversationsFile);

    // Skeleton defaults the resilient loader falls back to when a state
    // file is missing, empty, or unrepairable. The state skeleton derives
    // the agent name from the index entry so even a total wipe leaves
    // the agent identifiable in the UI rather than ending up nameless.
    const stateDefault = () => ({
      version: 2,
      agentId,
      state: {
        id: agentId,
        name: agentInfo.name || agentId,
        type: agentInfo.type || 'user-created',
        status: 'active',
        mode: 'chat',
        currentModel: agentInfo.preferredModel || agentInfo.model || null,
        preferredModel: agentInfo.preferredModel || agentInfo.model || null,
        systemPrompt: '',
        capabilities: agentInfo.capabilities || [],
        taskList: { tasks: [], lastUpdated: new Date().toISOString() },
        messageQueues: { userMessages: [], interAgentMessages: [], toolResults: [] },
        interAgentTracking: {},
      },
      lastPersisted: new Date().toISOString(),
    });
    const conversationsDefault = () => ({
      version: 2,
      agentId,
      conversations: {
        // Empty `full` conversation — required by validateModelConversations
        // and the agent loop's history reader. New per-model entries are
        // added on demand at first use.
        full: { messages: [], lastUpdated: new Date().toISOString() },
      },
      lastPersisted: new Date().toISOString(),
    });

    // Recovery reports for any auto-fixed files. Attached to the
    // returned agent so the caller (orchestrator → webServer) can
    // broadcast each one as a toast in the UI. Empty array on the
    // happy path; harmless presence otherwise.
    const recoveries = [];

    try {
      const stateRes = await this.loadJSONResilient(stateFile, stateDefault, {
        label: `agent state (${agentInfo.name || agentId})`,
      });
      const conversationsRes = await this.loadJSONResilient(conversationsFile, conversationsDefault, {
        label: `agent conversations (${agentInfo.name || agentId})`,
      });
      const stateData = stateRes.data;
      const conversationsData = conversationsRes.data;
      if (stateRes.recovery) recoveries.push(stateRes.recovery);
      if (conversationsRes.recovery) recoveries.push(conversationsRes.recovery);

      // Validate model conversations integrity
      await this.validateModelConversations(conversationsData.conversations);

      // Check if agent is paused
      const pauseStatus = await this.checkAgentPauseStatus(agentId, projectDir);

      const restoredAgent = {
        ...stateData.state,
        conversations: conversationsData.conversations,
        isPaused: pauseStatus.isPaused,
        pausedUntil: pauseStatus.pausedUntil,
        isRestored: true,
        restoredAt: new Date().toISOString(),
        // Non-enumerable would be cleaner, but agentPool serializes the
        // whole object — keeping it as a plain field. The orchestrator
        // strips it before persisting (see import handler).
        _restoreRecoveries: recoveries,
      };

      // CRITICAL: Restore interAgentTracking as a Map (it comes as plain object from JSON)
      if (!restoredAgent.interAgentTracking || typeof restoredAgent.interAgentTracking !== 'object') {
        restoredAgent.interAgentTracking = new Map();
      } else if (!(restoredAgent.interAgentTracking instanceof Map)) {
        restoredAgent.interAgentTracking = new Map(Object.entries(restoredAgent.interAgentTracking));
      }

      this.logger.info(`Agent restored: ${agentId}`, {
        name: restoredAgent.name,
        status: restoredAgent.status,
        messageCount: restoredAgent.conversations?.full?.messages?.length || 0,
        recoveryCount: recoveries.length,
      });

      return restoredAgent;

    } catch (error) {
      this.logger.error(`Agent restoration failed: ${agentId}`, error.message);
      throw error;
    }
  }

  /**
   * Restore async operations
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Array>} Array of active async operations
   */
  async restoreAsyncOperations(projectDir) {
    const operationsFile = path.join(this.stateDirectory, this.stateFiles.asyncOperations);
    
    try {
      const data = await this.loadJSON(operationsFile);
      return data.operations || [];
    } catch {
      return [];
    }
  }

  /**
   * Restore paused agents
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Paused agents data
   */
  async restorePausedAgents(projectDir) {
    const pausedFile = path.join(this.stateDirectory, this.stateFiles.pausedAgents);
    
    try {
      const data = await this.loadJSON(pausedFile);
      const now = Date.now();
      
      // Check which agents should be resumed
      const toResume = [];
      for (const [agentId, pauseInfo] of Object.entries(data.pausedAgents || {})) {
        const pausedUntil = new Date(pauseInfo.pausedUntil).getTime();
        
        if (now >= pausedUntil) {
          toResume.push(agentId);
        }
      }
      
      // Move expired pauses to history
      for (const agentId of toResume) {
        const pauseInfo = data.pausedAgents[agentId];
        delete data.pausedAgents[agentId];
        
        data.pauseHistory = data.pauseHistory || [];
        data.pauseHistory.push({
          agentId,
          pausedAt: pauseInfo.pausedAt,
          resumedAt: new Date().toISOString(),
          reason: pauseInfo.reason,
          actualDuration: Math.round((now - new Date(pauseInfo.pausedAt).getTime()) / 1000)
        });
      }
      
      // Save updated data
      await this.saveJSON(pausedFile, data);
      
      return data;
      
    } catch {
      return {
        pausedAgents: {},
        pauseHistory: []
      };
    }
  }

  /**
   * Restore context references
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Context references data
   */
  async restoreContextReferences(projectDir) {
    const contextFile = path.join(this.stateDirectory, this.stateFiles.contextReferences);
    
    try {
      const data = await this.loadJSON(contextFile);
      
      // Validate context references (implementation would validate file existence, etc.)
      const validatedReferences = [];
      for (const reference of data.references || []) {
        // Add validation logic here
        reference.isValid = true; // Placeholder
        reference.lastValidated = new Date().toISOString();
        validatedReferences.push(reference);
      }
      
      data.references = validatedReferences;
      await this.saveJSON(contextFile, data);
      
      return data;
      
    } catch {
      return {
        references: [],
        lastCleanup: new Date().toISOString()
      };
    }
  }

  /**
   * Save last session data
   * @param {string} projectDir - Project directory path
   * @param {Object} sessionData - Session data to save
   * @returns {Promise<void>}
   */
  async saveLastSession(projectDir, sessionData) {
    const sessionFile = path.join(this.stateDirectory, this.stateFiles.lastSession);
    
    const data = {
      ...sessionData,
      savedAt: new Date().toISOString(),
      projectDir
    };
    
    await this.saveJSON(sessionFile, data);
  }

  /**
   * Load last session data
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Last session data
   */
  async loadLastSession(projectDir) {
    const sessionFile = path.join(this.stateDirectory, this.stateFiles.lastSession);
    
    try {
      return await this.loadJSON(sessionFile);
    } catch {
      return null;
    }
  }

  /**
   * Save paused agent data
   * @param {string} projectDir - Project directory path
   * @param {string} agentId - Agent identifier
   * @param {Object} pauseData - Pause information
   * @returns {Promise<void>}
   */
  async savePausedAgent(projectDir, agentId, pauseData) {
    const pausedFile = path.join(this.stateDirectory, this.stateFiles.pausedAgents);
    
    let data;
    try {
      data = await this.loadJSON(pausedFile);
    } catch {
      data = { pausedAgents: {}, pauseHistory: [] };
    }
    
    data.pausedAgents[agentId] = pauseData;
    await this.saveJSON(pausedFile, data);
  }

  /**
   * Remove paused agent data
   * @param {string} projectDir - Project directory path
   * @param {string} agentId - Agent identifier
   * @returns {Promise<void>}
   */
  async removePausedAgent(projectDir, agentId) {
    const pausedFile = path.join(this.stateDirectory, this.stateFiles.pausedAgents);
    
    try {
      const data = await this.loadJSON(pausedFile);
      delete data.pausedAgents[agentId];
      await this.saveJSON(pausedFile, data);
    } catch {
      // File doesn't exist, nothing to remove
    }
  }

  /**
   * Check agent pause status
   * @param {string} agentId - Agent identifier
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Pause status
   */
  async checkAgentPauseStatus(agentId, projectDir) {
    const pausedFile = path.join(this.stateDirectory, this.stateFiles.pausedAgents);
    
    try {
      const data = await this.loadJSON(pausedFile);
      const pauseInfo = data.pausedAgents[agentId];
      
      if (!pauseInfo) {
        return { isPaused: false, pausedUntil: null };
      }
      
      const now = Date.now();
      const pausedUntil = new Date(pauseInfo.pausedUntil).getTime();
      
      return {
        isPaused: now < pausedUntil,
        pausedUntil: pauseInfo.pausedUntil,
        reason: pauseInfo.reason
      };
      
    } catch {
      return { isPaused: false, pausedUntil: null };
    }
  }

  /**
   * Validate model conversations integrity
   * @param {Object} conversations - Conversations object
   * @returns {Promise<void>}
   */
  async validateModelConversations(conversations) {
    if (!conversations || !conversations.full) {
      throw new Error('Invalid conversations structure - missing full conversation');
    }
    
    const fullMessages = conversations.full.messages || [];
    const fullLastUpdated = new Date(conversations.full.lastUpdated);
    
    // Validate each model conversation against full conversation
    for (const [modelName, modelConv] of Object.entries(conversations)) {
      if (modelName === 'full') continue;
      
      if (!modelConv.messages) {
        this.logger.warn(`Model conversation ${modelName} missing messages array`);
        continue;
      }
      
      const modelLastUpdated = new Date(modelConv.lastUpdated);
      
      if (fullLastUpdated > modelLastUpdated) {
        this.logger.warn(`Model conversation ${modelName} is outdated, will sync on next use`);
        modelConv.needsSync = true;
      }
    }
  }

  /**
   * Save JSON data to file
   * @private
   */
  async saveJSON(filePath, data) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    
    const jsonData = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, jsonData, 'utf8');
  }

  /**
   * Load JSON data from file (strict — throws on missing or corrupt).
   * @private
   */
  async loadJSON(filePath) {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  }

  /**
   * Load JSON with best-effort recovery from common breakage modes.
   * Designed so a single bad state file doesn't take down the entire
   * agent-load flow — instead the caller gets back a usable object plus
   * a `recovery` report that callers can surface as a toast.
   *
   * Recovery ladder (first match wins):
   *   1. Missing file (ENOENT)             → recreate with `defaultValue`,
   *                                          report `kind='not-found'`
   *   2. Empty / whitespace-only file       → overwrite with `defaultValue`,
   *                                          report `kind='empty-recreated'`
   *   3. Common syntax issues               → repaired in memory and saved
   *      (trailing comma, BOM, unclosed       back to disk; report
   *      braces/brackets, stray garbage       `kind='repaired'`
   *      after the JSON object)
   *   4. Salvageable first JSON block       → use the salvaged object,
   *      (anywhere in the buffer)             archive the original to
   *                                          `<file>.corrupt-<ts>.json`,
   *                                          report `kind='partial'`
   *   5. Nothing usable                     → use `defaultValue`, archive
   *                                          original (if any), report
   *                                          `kind='unrepairable'`
   *
   * @param {string} filePath - Absolute path to the JSON file
   * @param {Object|Array|null|Function} defaultValue - Value to use when
   *   the file is missing/empty/unrepairable. If a function is provided
   *   it's called with the file path and its return value is used.
   * @param {Object} [options]
   * @param {boolean} [options.persistRecreated=true] - Whether to write
   *   the default back to disk on missing/empty/unrepairable cases.
   * @param {string} [options.label] - Human-readable label used in toast
   *   messages (e.g. 'agent state', 'agent conversations'). Falls back
   *   to the file's basename.
   * @returns {Promise<{data: any, recovery: ?Object}>}
   */
  async loadJSONResilient(filePath, defaultValue, options = {}) {
    const { persistRecreated = true } = options;
    const label = options.label || path.basename(filePath);
    const defaultOf = () =>
      typeof defaultValue === 'function' ? defaultValue(filePath) : defaultValue;

    // 1. Missing file → recreate with default
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        const data = defaultOf();
        if (persistRecreated && data !== undefined) {
          try { await this.saveJSON(filePath, data); } catch { /* tolerate read-only mounts */ }
        }
        const recovery = {
          kind: 'not-found', filePath, label,
          message: `${label} file was missing — created an empty one.`,
        };
        this.logger?.info(`[stateManager] ${recovery.message}`, { filePath });
        return { data, recovery };
      }
      throw err; // unexpected read error (permissions, etc) — let caller handle
    }

    // 2. Empty or whitespace-only → recreate
    if (!raw || raw.trim().length === 0) {
      const data = defaultOf();
      if (persistRecreated && data !== undefined) {
        try { await this.saveJSON(filePath, data); } catch { /* ok */ }
      }
      const recovery = {
        kind: 'empty-recreated', filePath, label,
        message: `${label} file was empty — recreated with a default skeleton.`,
      };
      this.logger?.warn(`[stateManager] ${recovery.message}`, { filePath });
      return { data, recovery };
    }

    // 3. Strict parse — happy path
    try {
      return { data: JSON.parse(raw), recovery: null };
    } catch (firstErr) {
      // 3a. Quick repairs: BOM, trailing comma before close, junk after
      // the closing brace, smart quotes that occasionally creep in via
      // copy-paste. None of these is exotic — they're the top-3 reasons
      // hand-edited or partially-flushed files break.
      let repaired = raw;
      if (repaired.charCodeAt(0) === 0xFEFF) repaired = repaired.slice(1);
      // Strip ASCII control chars except tab/newline/CR
      repaired = repaired.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
      // Trim whitespace
      repaired = repaired.trim();
      // Drop trailing commas before a closing } or ]
      repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
      // Cut anything after the last balanced } / ] (junk after JSON).
      const lastClose = Math.max(repaired.lastIndexOf('}'), repaired.lastIndexOf(']'));
      if (lastClose > 0 && lastClose < repaired.length - 1) {
        repaired = repaired.slice(0, lastClose + 1);
      }
      try {
        const data = JSON.parse(repaired);
        if (persistRecreated && repaired !== raw) {
          try { await this.saveJSON(filePath, data); } catch { /* ok */ }
        }
        const recovery = {
          kind: 'repaired', filePath, label,
          message: `${label} file had a minor syntax issue (${firstErr.message}) — auto-repaired.`,
        };
        this.logger?.warn(`[stateManager] ${recovery.message}`, { filePath });
        return { data, recovery };
      } catch { /* fall through */ }

      // 3b. Salvage: walk the buffer for the first balanced { ... } block
      // and try to parse just that. Catches truncated-mid-file cases.
      const salvaged = this._extractFirstJsonBlock(raw);
      if (salvaged) {
        try {
          const data = JSON.parse(salvaged);
          const archivePath = `${filePath}.corrupt-${Date.now()}.json`;
          try { await fs.writeFile(archivePath, raw, 'utf8'); } catch { /* ok */ }
          if (persistRecreated) {
            try { await this.saveJSON(filePath, data); } catch { /* ok */ }
          }
          const recovery = {
            kind: 'partial', filePath, label,
            message: `${label} file was partially corrupt — recovered the first valid section. Original archived to ${path.basename(archivePath)}.`,
            archivePath,
          };
          this.logger?.warn(`[stateManager] ${recovery.message}`, { filePath, archivePath });
          return { data, recovery };
        } catch { /* fall through */ }
      }

      // 4. Nothing parseable — archive the corrupt file and use default
      const data = defaultOf();
      const archivePath = `${filePath}.corrupt-${Date.now()}.json`;
      try { await fs.writeFile(archivePath, raw, 'utf8'); } catch { /* ok */ }
      if (persistRecreated && data !== undefined) {
        try { await this.saveJSON(filePath, data); } catch { /* ok */ }
      }
      const recovery = {
        kind: 'unrepairable', filePath, label,
        message: `${label} file is corrupt and could not be repaired — restored a default skeleton. Original archived to ${path.basename(archivePath)}.`,
        archivePath,
        originalError: firstErr.message,
      };
      this.logger?.error(`[stateManager] ${recovery.message}`, { filePath, archivePath, error: firstErr.message });
      return { data, recovery };
    }
  }

  /**
   * Walk a string and return the substring of the first balanced
   * `{ ... }` block, respecting string literals so braces inside strings
   * don't confuse the count. Returns null if no complete block exists.
   * @private
   */
  _extractFirstJsonBlock(s) {
    if (typeof s !== 'string') return null;
    const start = s.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inStr = false; }
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return null;
  }

  /**
   * Delete agent state from storage
   * @param {string} agentId - Agent identifier
   * @param {string} projectDir - Project directory path
   * @returns {Promise<void>}
   */
  async deleteAgentState(agentId, projectDir = process.cwd()) {
    const stateDir = this.getStateDir(projectDir);
    const agentStateFile = path.join(stateDir, 'agents', `agent-${agentId}-state.json`);
    const agentConversationsFile = path.join(stateDir, 'agents', `agent-${agentId}-conversations.json`);

    try {
      // Delete agent state file
      try {
        await fs.unlink(agentStateFile);
        this.logger.debug(`Deleted agent state file: ${agentId}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.logger.warn(`Failed to delete agent state file: ${error.message}`, { agentId });
        }
      }

      // Delete agent conversations file
      try {
        await fs.unlink(agentConversationsFile);
        this.logger.debug(`Deleted agent conversations file: ${agentId}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.logger.warn(`Failed to delete agent conversations file: ${error.message}`, { agentId });
        }
      }

      // Remove from agent index
      await this.removeFromAgentIndex(agentId, projectDir);

      this.logger.info(`Agent state deleted: ${agentId}`);

    } catch (error) {
      this.logger.error(`Failed to delete agent state: ${error.message}`, {
        agentId,
        error: error.stack
      });
      throw error;
    }
  }

  /**
   * Remove agent from agent index
   * @param {string} agentId - Agent identifier
   * @param {string} projectDir - Project directory path
   * @returns {Promise<void>}
   */
  async removeFromAgentIndex(agentId, projectDir) {
    const indexFile = path.join(this.stateDirectory, this.stateFiles.agentIndex);

    try {
      const agentIndex = await this.loadJSON(indexFile);
      delete agentIndex[agentId];
      await this.saveJSON(indexFile, agentIndex);
      this.logger.debug(`Removed agent from index: ${agentId}`);
    } catch (error) {
      // If index doesn't exist or can't be updated, log but don't throw
      this.logger.warn(`Failed to remove agent from index: ${error.message}`, { agentId });
    }
  }

  /**
   * Check if state directory exists
   * @param {string} projectDir - Project directory path
   * @returns {Promise<boolean>} True if state directory exists
   */
  async stateDirectoryExists(projectDir) {
    const stateDir = this.getStateDir(projectDir);

    try {
      const stats = await fs.stat(stateDir);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Clean up old state files
   * @param {string} projectDir - Project directory path
   * @param {number} maxAge - Maximum age in days
   * @returns {Promise<void>}
   */
  async cleanupOldState(projectDir, maxAge = 30) {
    const stateDir = this.getStateDir(projectDir);
    const cutoffDate = Date.now() - (maxAge * 24 * 60 * 60 * 1000);

    try {
      const agentsDir = path.join(stateDir, 'agents');
      const files = await fs.readdir(agentsDir);

      for (const file of files) {
        const filePath = path.join(agentsDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime.getTime() < cutoffDate) {
          await fs.unlink(filePath);
          this.logger.info(`Cleaned up old state file: ${file}`);
        }
      }

    } catch (error) {
      this.logger.warn(`State cleanup failed: ${error.message}`);
    }
  }

  /**
   * Get all available agents (active + archived) from filesystem
   * Scans both the index AND the agents directory to find all agents,
   * including those that may be missing from the index.
   * @param {string} projectDir - Project directory path
   * @param {Object} agentPool - Agent pool instance to check active agents
   * @returns {Promise<Array>} List of all agents with metadata
   */
  async getAllAvailableAgents(projectDir, agentPool) {
    try {
      const agentIndex = await this.loadAgentIndex(projectDir);
      const activeAgentIds = agentPool ? (await agentPool.getAllAgents()).map(a => a.id) : [];
      const agentsDir = this.getAgentsDir();

      // Track which agent IDs we've already processed
      const processedAgentIds = new Set();
      const agents = [];

      // First, process agents from the index
      for (const [agentId, info] of Object.entries(agentIndex)) {
        // Skip invalid or undefined entries
        if (!info || !info.name) {
          continue;
        }

        processedAgentIds.add(agentId);
        agents.push({
          agentId,
          name: info.name,
          type: info.type,
          model: info.model,
          lastActivity: info.lastActivity,
          status: info.status,
          stateFile: info.stateFile,
          conversationsFile: info.conversationsFile,
          capabilities: info.capabilities || [],
          isLoaded: activeAgentIds.includes(agentId),
          canImport: !activeAgentIds.includes(agentId)
        });
      }

      // Second, scan the agents directory for any agents not in the index
      try {
        const files = await fs.readdir(agentsDir);
        const stateFiles = files.filter(f => f.endsWith('-state.json'));

        let indexUpdated = false;

        for (const stateFile of stateFiles) {
          // Extract agent ID from filename: agent-{agentId}-state.json
          const match = stateFile.match(/^agent-(.+)-state\.json$/);
          if (!match) continue;

          const agentId = match[1];
          if (processedAgentIds.has(agentId)) continue;

          // Found an agent not in the index - load its state
          try {
            const statePath = path.join(agentsDir, stateFile);
            const stateData = await this.loadJSON(statePath);
            const state = stateData.state || stateData;

            // Build agent info from state file
            const agentInfo = {
              agentId,
              name: state.name || stateData.name || `Recovered Agent ${agentId.slice(-8)}`,
              type: state.type || 'user-created',
              model: state.currentModel || state.preferredModel || 'unknown',
              lastActivity: state.lastActivity || stateData.timestamp || null,
              status: state.status || 'idle',
              stateFile: `agents/${stateFile}`,
              conversationsFile: `agents/agent-${agentId}-conversations.json`,
              capabilities: state.capabilities || [],
              isLoaded: activeAgentIds.includes(agentId),
              canImport: !activeAgentIds.includes(agentId)
            };

            agents.push(agentInfo);
            processedAgentIds.add(agentId);

            // Update the index with this recovered agent
            agentIndex[agentId] = {
              name: agentInfo.name,
              type: agentInfo.type,
              stateFile: agentInfo.stateFile,
              conversationsFile: agentInfo.conversationsFile,
              lastActivity: agentInfo.lastActivity,
              model: agentInfo.model,
              status: agentInfo.status,
              capabilities: agentInfo.capabilities
            };
            indexUpdated = true;

            this.logger.info(`Recovered agent from disk: ${agentInfo.name} (${agentId})`);
          } catch (err) {
            this.logger.warn(`Failed to recover agent from ${stateFile}: ${err.message}`);
          }
        }

        // Save the updated index if we found missing agents
        if (indexUpdated) {
          const indexFile = path.join(this.stateDirectory, this.stateFiles.agentIndex);
          await this.saveJSON(indexFile, agentIndex);
          this.logger.info(`Updated agent index with ${agents.length - Object.keys(agentIndex).length + Object.keys(processedAgentIds).size} recovered agents`);
        }
      } catch (err) {
        this.logger.warn(`Failed to scan agents directory: ${err.message}`);
      }

      // Sort by last activity (most recent first)
      agents.sort((a, b) => {
        const dateA = a.lastActivity ? new Date(a.lastActivity) : new Date(0);
        const dateB = b.lastActivity ? new Date(b.lastActivity) : new Date(0);
        return dateB - dateA;
      });

      // Enrich agents with firstUserMessage snippet
      await this._enrichAgentsWithSnippets(agents, agentPool);

      this.logger.info(`Found ${agents.length} available agents (${agents.filter(a => a.isLoaded).length} active, ${agents.filter(a => !a.isLoaded).length} archived)`);

      return agents;
    } catch (error) {
      this.logger.error(`Failed to get available agents: ${error.message}`);
      throw error;
    }
  }

  /**
   * Enrich agent list with firstUserMessage snippets.
   * For loaded agents, reads from agentPool. For archived agents, peeks into conversations file.
   */
  async _enrichAgentsWithSnippets(agents, agentPool) {
    const extractSnippet = (messages) => {
      if (!messages || messages.length === 0) return null;
      const firstUser = messages.find(m =>
        m.role === 'user' && m.content && m.type !== 'task-boundary'
      );
      if (!firstUser) return null;
      const text = typeof firstUser.content === 'string'
        ? firstUser.content
        : Array.isArray(firstUser.content)
          ? firstUser.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
          : null;
      if (!text) return null;
      const lines = text.split('\n').filter(l => l.trim());
      const snippet = lines.slice(0, 2).join('\n');
      return snippet.length > 120 ? snippet.slice(0, 117) + '...' : snippet;
    };

    for (const agent of agents) {
      try {
        if (agent.isLoaded && agentPool) {
          // For loaded agents, get from the in-memory agent
          const liveAgent = await agentPool.getAgent(agent.agentId);
          if (liveAgent) {
            agent.firstUserMessage = extractSnippet(liveAgent.conversations?.full?.messages);
            continue;
          }
        }
        // For archived agents, peek into the conversations file on disk
        if (agent.conversationsFile) {
          const convPath = path.join(this.stateDirectory, agent.conversationsFile);
          try {
            const convData = await this.loadJSON(convPath);
            const messages = convData?.conversations?.full?.messages || convData?.full?.messages;
            agent.firstUserMessage = extractSnippet(messages);
          } catch {
            // File may not exist — that's fine
          }
        }
      } catch {
        // Non-critical — just skip this agent's snippet
      }
    }
  }

  /**
   * Get agent metadata without full restoration (lightweight preview)
   * @param {string} agentId - Agent ID
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Agent metadata for preview
   */
  async getAgentMetadata(agentId, projectDir) {
    try {
      // Load agent index
      const agentIndex = await this.loadAgentIndex(projectDir);
      const agentInfo = agentIndex[agentId];

      if (!agentInfo) {
        throw new Error(`Agent ${agentId} not found in index`);
      }

      // Load just the state file (lightweight)
      const stateDir = this.getStateDir(projectDir);
      const stateFile = path.join(stateDir, agentInfo.stateFile);
      const conversationsFile = path.join(stateDir, agentInfo.conversationsFile);

      // Check if files exist
      const stateExists = await fs.access(stateFile).then(() => true).catch(() => false);
      const conversationsExist = await fs.access(conversationsFile).then(() => true).catch(() => false);

      if (!stateExists) {
        throw new Error(`State file not found for agent ${agentId}`);
      }

      // Load state
      const stateData = await this.loadJSON(stateFile);
      const state = stateData.state || {};

      // Load conversation count without loading full messages (for performance)
      let messageCount = 0;
      let lastMessage = null;
      if (conversationsExist) {
        try {
          const conversations = await this.loadJSON(conversationsFile);
          messageCount = Array.isArray(conversations) ? conversations.length : 0;

          // Get last message for preview
          if (messageCount > 0) {
            const lastMsg = conversations[conversations.length - 1];
            lastMessage = lastMsg?.content?.substring(0, 100) || null;
          }
        } catch (error) {
          this.logger.warn(`Failed to load conversations for ${agentId}: ${error.message}`);
        }
      }

      const metadata = {
        agentId,
        name: agentInfo.name || state.name,
        model: agentInfo.model || state.preferredModel || state.currentModel,
        lastActivity: agentInfo.lastActivity,
        status: agentInfo.status,
        capabilities: state.capabilities || [],
        messageCount,
        lastMessage,
        taskCount: state.taskList?.tasks?.length || 0,
        createdAt: state.createdAt,
        workingDirectory: state.directoryAccess?.workingDirectory,
        mode: state.mode,
        systemPrompt: state.originalSystemPrompt
      };

      this.logger.info(`Loaded metadata for agent ${agentId}: ${metadata.messageCount} messages, ${metadata.taskCount} tasks`);

      return metadata;
    } catch (error) {
      this.logger.error(`Failed to get agent metadata for ${agentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Import archived agent from filesystem and add to agent pool
   * @param {string} agentId - Agent ID to import
   * @param {string} projectDir - Project directory path
   * @param {Object} agentPool - Agent pool instance
   * @returns {Promise<Object>} Imported agent object
   */
  async importArchivedAgent(agentId, projectDir, agentPool) {
    try {
      // Validate agent ID format for security
      const AGENT_ID_REGEX = /^agent-[a-z0-9-]+-\d+$/;
      if (!AGENT_ID_REGEX.test(agentId)) {
        throw new Error('Invalid agent ID format');
      }

      // Check if already loaded in agent pool
      if (agentPool && await agentPool.getAgent(agentId)) {
        throw new Error(`Agent ${agentId} is already loaded. Use switchAgent() instead.`);
      }

      // Load from agent index
      const agentIndex = await this.loadAgentIndex(projectDir);
      const agentInfo = agentIndex[agentId];

      if (!agentInfo) {
        throw new Error(`Agent ${agentId} not found in index`);
      }

      this.logger.info(`Importing archived agent: ${agentId} (${agentInfo.name})`);

      // Restore agent using existing restore logic
      const agent = await this.restoreAgent(agentId, agentInfo, projectDir);

      // Update agent's last activity
      agent.lastActivity = new Date().toISOString();

      // Add to agent pool if provided
      if (agentPool) {
        agentPool.agents.set(agent.id, agent);
        agentPool._updateAgentDirectory(agent);
        this.logger.info(`Agent ${agentId} added to agent pool`);
      }

      // Update agent index with new last activity
      await this.updateAgentIndex(agent, projectDir);

      this.logger.info(`Successfully imported agent ${agentId}: ${agent.name}`);

      return agent;
    } catch (error) {
      this.logger.error(`Failed to import agent ${agentId}: ${error.message}`);
      throw error;
    }
  }
}

export default StateManager;