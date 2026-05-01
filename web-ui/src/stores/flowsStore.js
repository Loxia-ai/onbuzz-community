import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { api } from '../services/api.js';

export const useFlowsStore = create(
  subscribeWithSelector((set, get) => ({
    // Flows state
    flows: [],
    currentFlow: null,
    loading: false,
    error: null,

    // Flow runs state
    runs: [], // Runs for the current flow
    currentRun: null,
    runsLoading: false,

    // Globally-active runs across every flow — populated by
    // fetchActiveRuns() and kept fresh by handleFlowUpdateEvent. Used by
    // the FlowsPage to render a "running" badge on each card without
    // polling per-flow. Map of flowId → array of run objects:
    //   { runId, status, startedAt }
    // Uses a plain object (not a Map) so React/Zustand picks up changes.
    activeRunsByFlowId: {},

    // Node progress state (for real-time activity indicators)
    nodeProgress: {}, // { [nodeId]: { charactersStreamed, chunkCount, lastUpdate } }

    // ==================== FLOW CRUD ACTIONS ====================

    /**
     * Fetch all flows
     */
    fetchFlows: async () => {
      try {
        set({ loading: true, error: null });
        const response = await api.getFlows();

        if (response.success) {
          set({ flows: response.data, loading: false });
          return response.data;
        } else {
          throw new Error(response.error);
        }
      } catch (error) {
        console.error('Failed to fetch flows:', error);
        set({ loading: false, error: error.message });
        throw error;
      }
    },

    /**
     * Get a specific flow by ID
     */
    getFlow: async (flowId) => {
      try {
        set({ loading: true, error: null });
        const response = await api.getFlow(flowId);

        if (response.success) {
          set({ currentFlow: response.data, loading: false });
          return response.data;
        } else {
          throw new Error(response.error);
        }
      } catch (error) {
        console.error('Failed to get flow:', error);
        set({ loading: false, error: error.message });
        throw error;
      }
    },

    /**
     * Create a new flow
     */
    createFlow: async (flowData) => {
      try {
        set({ loading: true, error: null });
        const response = await api.createFlow(flowData);

        if (!response.success) {
          throw new Error(response.error);
        }

        const newFlow = response.data;
        set(state => ({
          flows: [...state.flows, newFlow],
          currentFlow: newFlow,
          loading: false
        }));

        return newFlow;
      } catch (error) {
        console.error('Failed to create flow:', error);
        set({ loading: false, error: error.message });
        throw error;
      }
    },

    /**
     * Update an existing flow
     */
    updateFlow: async (flowId, updates) => {
      try {
        set({ loading: true, error: null });
        const response = await api.updateFlow(flowId, updates);

        if (!response.success) {
          throw new Error(response.error);
        }

        const updatedFlow = response.data;
        set(state => ({
          flows: state.flows.map(flow =>
            flow.id === flowId ? updatedFlow : flow
          ),
          currentFlow: state.currentFlow?.id === flowId ? updatedFlow : state.currentFlow,
          loading: false
        }));

        return updatedFlow;
      } catch (error) {
        console.error('Failed to update flow:', error);
        set({ loading: false, error: error.message });
        throw error;
      }
    },

    /**
     * Delete a flow
     */
    deleteFlow: async (flowId) => {
      try {
        set({ loading: true, error: null });
        const response = await api.deleteFlow(flowId);

        if (!response.success) {
          throw new Error(response.error);
        }

        set(state => ({
          flows: state.flows.filter(flow => flow.id !== flowId),
          currentFlow: state.currentFlow?.id === flowId ? null : state.currentFlow,
          loading: false
        }));

        return true;
      } catch (error) {
        console.error('Failed to delete flow:', error);
        set({ loading: false, error: error.message });
        throw error;
      }
    },

    // ==================== FLOW EXECUTION ACTIONS ====================

    /**
     * Execute a flow
     */
    executeFlow: async (flowId, input = {}) => {
      try {
        set({ loading: true, error: null });
        const response = await api.executeFlow(flowId, input);

        if (!response.success) {
          throw new Error(response.error);
        }

        const run = response.data;
        set(state => ({
          runs: [run, ...state.runs],
          // Merge API response into currentRun — WebSocket events may have
          // already populated nodeStates (e.g. input node completes instantly
          // before the API response arrives). Don't overwrite them.
          currentRun: {
            ...run,
            nodeStates: {
              ...run.nodeStates,
              ...state.currentRun?.nodeStates
            }
          },
          nodeProgress: {}, // Clear stale progress from previous runs
          loading: false
        }));

        return run;
      } catch (error) {
        console.error('Failed to execute flow:', error);
        set({ loading: false, error: error.message });
        throw error;
      }
    },

    /**
     * Stop a flow run
     */
    stopFlowRun: async (flowId, runId) => {
      try {
        set({ loading: true, error: null });
        const response = await api.stopFlow(flowId, runId);

        if (!response.success) {
          throw new Error(response.error);
        }

        const stoppedRun = response.data;
        set(state => ({
          runs: state.runs.map(run =>
            run.id === runId ? stoppedRun : run
          ),
          currentRun: state.currentRun?.id === runId ? stoppedRun : state.currentRun,
          loading: false
        }));

        return stoppedRun;
      } catch (error) {
        console.error('Failed to stop flow run:', error);
        set({ loading: false, error: error.message });
        throw error;
      }
    },

    /**
     * Fetch runs for a specific flow
     */
    fetchFlowRuns: async (flowId) => {
      try {
        set({ runsLoading: true, error: null });
        const response = await api.getFlowRuns(flowId);

        if (response.success) {
          set({ runs: response.data, runsLoading: false });
          return response.data;
        } else {
          throw new Error(response.error);
        }
      } catch (error) {
        console.error('Failed to fetch flow runs:', error);
        set({ runsLoading: false, error: error.message });
        throw error;
      }
    },

    /**
     * Get a specific run
     */
    getFlowRun: async (flowId, runId) => {
      try {
        set({ runsLoading: true, error: null });
        const response = await api.getFlowRun(flowId, runId);

        if (response.success) {
          set({ currentRun: response.data, runsLoading: false });
          return response.data;
        } else {
          throw new Error(response.error);
        }
      } catch (error) {
        console.error('Failed to get flow run:', error);
        set({ runsLoading: false, error: error.message });
        throw error;
      }
    },

    // ==================== LOCAL STATE ACTIONS ====================

    /**
     * Set the current flow (for editing)
     */
    setCurrentFlow: (flow) => {
      set({ currentFlow: flow });
    },

    /**
     * Set the current run (for viewing)
     */
    setCurrentRun: (run) => {
      set({ currentRun: run });
    },

    /**
     * Clear current flow
     */
    clearCurrentFlow: () => {
      set({ currentFlow: null, runs: [], currentRun: null });
    },

    /**
     * Clear error
     */
    clearError: () => {
      set({ error: null });
    },

    // ==================== WEBSOCKET EVENT HANDLERS ====================

    /**
     * Handle flow-related WebSocket events
     * Events come in two formats:
     * 1. Direct events: { type: 'flow-created', flow, flowId, run }
     * 2. Flow update wrapper: { type: 'flow_update', data: { type: '...', ... } }
     */
    handleFlowEvent: (event) => {
      // Handle wrapped flow_update events from FlowExecutor
      if (event.type === 'flow_update' && event.data) {
        get().handleFlowUpdateEvent(event.data);
        return;
      }

      const { type, flow, flowId, run } = event;

      switch (type) {
        case 'flow-created':
          set(state => ({
            flows: [...state.flows, flow]
          }));
          break;

        case 'flow-updated':
          set(state => ({
            flows: state.flows.map(f => f.id === flow.id ? flow : f),
            currentFlow: state.currentFlow?.id === flow.id ? flow : state.currentFlow
          }));
          break;

        case 'flow-deleted':
          set(state => ({
            flows: state.flows.filter(f => f.id !== flowId),
            currentFlow: state.currentFlow?.id === flowId ? null : state.currentFlow
          }));
          break;

        case 'flow-run-started':
        case 'flow-run-updated':
          set(state => {
            const existingIndex = state.runs.findIndex(r => r.id === run.id);
            const updatedRuns = existingIndex >= 0
              ? state.runs.map(r => r.id === run.id ? run : r)
              : [run, ...state.runs];

            return {
              runs: updatedRuns,
              currentRun: state.currentRun?.id === run.id ? run : state.currentRun
            };
          });
          break;

        case 'flow-run-stopped':
        case 'flow-run-completed':
        case 'flow-run-failed':
          set(state => ({
            runs: state.runs.map(r => r.id === run.id ? run : r),
            currentRun: state.currentRun?.id === run.id ? run : state.currentRun
          }));
          break;

        case 'flow-node-complete':
          // Update node state within the current run
          set(state => {
            if (!state.currentRun || state.currentRun.id !== run.id) {
              return state;
            }
            return {
              currentRun: {
                ...state.currentRun,
                nodeStates: {
                  ...state.currentRun.nodeStates,
                  ...run.nodeStates
                }
              }
            };
          });
          break;

        default:
          console.log('Unknown flow event:', type);
      }
    },

    /**
     * Fetch all active (non-terminal) flow runs across every flow.
     * Powers the running-flow indicator on the FlowsPage. Cheap —
     * the backend filters in-memory.
     */
    fetchActiveRuns: async () => {
      try {
        const response = await api.request('/flows/runs/active');
        if (response.success) {
          const byFlow = {};
          for (const run of (response.data || [])) {
            if (!run.flowId) continue;
            (byFlow[run.flowId] ||= []).push({
              runId: run.runId,
              status: run.status,
              startedAt: run.startedAt || null,
              // Progress shape comes from the server's summarizeRunProgress.
              // Pass through verbatim — the card UI knows what to do
              // with null total / null currentNodeLabel (degraded but
              // useful: "Running 2 nodes" vs "Step 3/5: Writer").
              progress: run.progress || null,
            });
          }
          set({ activeRunsByFlowId: byFlow });
          return byFlow;
        }
      } catch (error) {
        // Non-fatal — the indicator just doesn't render. Log so a
        // permanent regression is visible in the console.
        console.warn('[flowsStore] fetchActiveRuns failed:', error.message);
      }
      return {};
    },

    /**
     * Reactively update activeRunsByFlowId based on a ws event. Keeps the
     * indicator fresh between polls (which run on tab focus / mount).
     * Call from handleFlowUpdateEvent — see below.
     */
    _bumpActiveRuns: (data) => {
      const { type, runId, flowId } = data;
      if (!flowId || !runId) return;
      set(state => {
        const current = state.activeRunsByFlowId[flowId] || [];
        switch (type) {
          case 'flow_run_started': {
            // Add if not already present.
            if (current.some(r => r.runId === runId)) return state;
            return {
              activeRunsByFlowId: {
                ...state.activeRunsByFlowId,
                [flowId]: [...current, { runId, status: 'running', startedAt: data.startedAt || null }],
              },
            };
          }
          case 'flow_run_completed':
          case 'flow_run_failed':
          case 'flow_run_stopped': {
            const next = current.filter(r => r.runId !== runId);
            const out = { ...state.activeRunsByFlowId };
            if (next.length === 0) delete out[flowId]; else out[flowId] = next;
            return { activeRunsByFlowId: out };
          }
          default:
            return state;
        }
      });
    },

    /**
     * Handle flow_update events from FlowExecutor
     * These events track execution progress at node level
     */
    handleFlowUpdateEvent: (data) => {
      const { type, runId, flowId, nodeId, nodeType, status, output, error, startedAt, completedAt } = data;
      // Side-channel: keep the global active-runs map in sync regardless
      // of which flow is currently focused.
      get()._bumpActiveRuns(data);

      switch (type) {
        case 'flow_run_started':
          set(state => ({
            currentRun: {
              ...state.currentRun, // Preserve any data from API response
              id: runId,
              flowId,
              status: 'running',
              startedAt: startedAt || state.currentRun?.startedAt || new Date().toISOString(),
              nodeStates: state.currentRun?.nodeStates || {}
            },
            nodeProgress: {} // Clear progress when new run starts
          }));
          break;

        case 'flow_run_completed':
          set(state => {
            if (!state.currentRun || state.currentRun.id !== runId) return state;
            return {
              currentRun: {
                ...state.currentRun,
                status: 'completed',
                completedAt: completedAt || new Date().toISOString(),
                output: data.output
              }
            };
          });
          break;

        case 'flow_run_failed':
          set(state => {
            if (!state.currentRun || state.currentRun.id !== runId) return state;
            return {
              currentRun: {
                ...state.currentRun,
                status: 'failed',
                completedAt: completedAt || new Date().toISOString(),
                error: error
              }
            };
          });
          break;

        case 'flow_run_stopped':
          set(state => {
            if (!state.currentRun || state.currentRun.id !== runId) return state;
            return {
              currentRun: {
                ...state.currentRun,
                status: 'stopped',
                completedAt: completedAt || new Date().toISOString()
              }
            };
          });
          break;

        case 'flow_node_started':
          set(state => {
            if (!state.currentRun || state.currentRun.id !== runId) return state;
            return {
              currentRun: {
                ...state.currentRun,
                nodeStates: {
                  ...state.currentRun.nodeStates,
                  [nodeId]: { status: 'running', nodeType }
                }
              }
            };
          });
          break;

        case 'flow_node_completed':
          set(state => {
            if (!state.currentRun || state.currentRun.id !== runId) return state;
            return {
              currentRun: {
                ...state.currentRun,
                nodeStates: {
                  ...state.currentRun.nodeStates,
                  [nodeId]: { status: 'completed', nodeType, output }
                }
              }
            };
          });
          break;

        case 'flow_node_failed':
          set(state => {
            if (!state.currentRun || state.currentRun.id !== runId) return state;
            return {
              currentRun: {
                ...state.currentRun,
                nodeStates: {
                  ...state.currentRun.nodeStates,
                  [nodeId]: { status: 'failed', nodeType, error }
                }
              }
            };
          });
          break;

        case 'flow_node_progress':
          // Real-time progress updates during agent execution
          set(state => {
            if (!state.currentRun || state.currentRun.id !== runId) return state;

            const { agentId, charactersStreamed, chunkCount, isFinal } = data;

            // Update nodeProgress
            const updatedProgress = {
              ...state.nodeProgress,
              [nodeId]: {
                agentId,
                charactersStreamed,
                chunkCount,
                isFinal,
                lastUpdate: new Date().toISOString()
              }
            };

            // If final, also update the nodeStates with the final character count
            if (isFinal) {
              return {
                nodeProgress: updatedProgress,
                currentRun: {
                  ...state.currentRun,
                  nodeStates: {
                    ...state.currentRun.nodeStates,
                    [nodeId]: {
                      ...state.currentRun.nodeStates?.[nodeId],
                      charactersStreamed,
                      chunkCount
                    }
                  }
                }
              };
            }

            return { nodeProgress: updatedProgress };
          });
          break;

        default:
          console.log('Unknown flow_update event type:', type);
      }
    },

    /**
     * Clear node progress (call when flow starts or ends)
     */
    clearNodeProgress: () => {
      set({ nodeProgress: {} });
    },

    /**
     * Get progress for a specific node
     */
    getNodeProgress: (nodeId) => {
      return get().nodeProgress[nodeId] || null;
    },

    // ==================== HELPER GETTERS ====================

    /**
     * Get flows count
     */
    getFlowsCount: () => get().flows.length,

    /**
     * Get a flow by ID from local state
     */
    getFlowById: (flowId) => get().flows.find(f => f.id === flowId),

    /**
     * Check if a flow is currently running
     */
    isFlowRunning: (flowId) => {
      const runs = get().runs.filter(r => r.flowId === flowId);
      return runs.some(r => r.status === 'running' || r.status === 'pending');
    }
  }))
);

export default useFlowsStore;
