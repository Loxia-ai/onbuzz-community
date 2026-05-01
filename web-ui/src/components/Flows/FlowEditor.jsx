import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  PlayIcon,
  StopIcon,
  ArrowPathIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { ReactFlowProvider } from '@xyflow/react';
// Same logic as `src/utilities/flowEdgeIds.js` on the server. Vendored
// into web-ui/src/utils/ because the Docker build context is web-ui/
// only — cross-tree imports break production builds. Server-side tests
// at src/utilities/__tests__/flowEdgeIds.test.js are authoritative.
import { ensureEdgeIds } from '../../utils/flowEdgeIds.js';
import FlowCanvas from './FlowCanvas.jsx';
import NodePalette from './NodePalette.jsx';
import NodePropertiesPanel from './panels/NodePropertiesPanel.jsx';
import ExecutionPanel from './panels/ExecutionPanel.jsx';
import FlowInputDialog from './panels/FlowInputDialog.jsx';
import DryRunResultsPanel from './panels/DryRunResultsPanel.jsx';
import VersionsPanel from './panels/VersionsPanel.jsx';
import { useFlowsStore } from '../../stores/flowsStore.js';
import { useAppStore } from '../../stores/appStore.js';
import { api } from '../../services/api.js';
import toast from 'react-hot-toast';
// Phase 5: client lint mirror — surface unbound placeholders + missing
// required edges inline as the user edits, without round-tripping.
import { lintFlow, lintByNode } from '../../utils/flowLint.js';

import '@xyflow/react/dist/style.css';

function FlowEditor({ flow, onClose }) {
  const navigate = useNavigate();
  const { updateFlow, executeFlow, stopFlowRun, currentRun, setCurrentRun } = useFlowsStore();
  const { agents, sessionId } = useAppStore();

  // Clear stale run state when opening a new flow
  useEffect(() => {
    // Only keep currentRun if it belongs to this flow
    if (currentRun && currentRun.flowId !== flow.id) {
      setCurrentRun(null);
    }
  }, [flow.id, currentRun, setCurrentRun]);

  // Defensive: any node missing `position` would crash React Flow with
  // "Cannot read properties of undefined (reading 'x')". Auto-place any
  // positionless node in a left-to-right grid before mounting.
  const ensurePositions = (rawNodes) => {
    if (!Array.isArray(rawNodes)) return [];
    return rawNodes.map((n, idx) => {
      if (n?.position && typeof n.position.x === 'number' && typeof n.position.y === 'number') {
        return n;
      }
      return { ...n, position: { x: 60 + idx * 280, y: 100 } };
    });
  };

  // Defensive: ReactFlow REQUIRES every edge to have a unique `id`.
  // Templates and marketplace-installed flows ship without ids and would
  // render with no arrows. Helper is shared with the server-side
  // stateManager.createFlow path so id format stays consistent.

  // Local state for editing
  const [nodes, setNodes] = useState(ensurePositions(flow.nodes));
  const [edges, setEdges] = useState(ensureEdgeIds(flow.edges || []));
  const [selectedNode, setSelectedNode] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [showExecutionPanel, setShowExecutionPanel] = useState(false);
  const [showInputDialog, setShowInputDialog] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [showClearWarning, setShowClearWarning] = useState(false);
  const [dontShowClearWarning, setDontShowClearWarning] = useState(false);

  // Get node execution states from current run (only if it belongs to this flow)
  const nodeStates = (currentRun?.flowId === flow.id) ? (currentRun?.nodeStates || {}) : {};
  const isRunning = (currentRun?.flowId === flow.id) && currentRun?.status === 'running';

  // Show execution panel when a run starts
  React.useEffect(() => {
    if (currentRun && currentRun.status) {
      setShowExecutionPanel(true);
    }
  }, [currentRun]);

  // Track changes
  const handleNodesChange = useCallback((newNodes) => {
    setNodes(newNodes);
    setHasChanges(true);
  }, []);

  const handleEdgesChange = useCallback((newEdges) => {
    setEdges(newEdges);
    setHasChanges(true);
  }, []);

  const handleNodeSelect = useCallback((node) => {
    setSelectedNode(node);
  }, []);

  // Tap-to-add path for touch devices: NodePalette calls this when the
  // user taps a tile (drag-and-drop is unreliable on touch). The new
  // node is placed in a free spot by stepping right + down from the
  // last node so consecutive taps don't pile up at the origin.
  const handleAddNode = useCallback((type, label) => {
    setNodes((nds) => {
      // Find the rightmost node so the new one lands beside it; falls
      // back to the origin for an empty canvas.
      const last = nds.reduce((acc, n) => {
        const x = n.position?.x || 0, y = n.position?.y || 0;
        if (!acc) return { x, y };
        return x >= acc.x ? { x, y } : acc;
      }, null);
      const base = last ? { x: last.x + 220, y: last.y } : { x: 100, y: 100 };
      const newNode = {
        id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        position: base,
        data: { label },
      };
      return [...nds, newNode];
    });
    setHasChanges(true);
  }, []);

  const handleNodeUpdate = useCallback((nodeId, updates) => {
    setNodes(nds => nds.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n
    ));
    setHasChanges(true);
    // Update selected node reference
    if (selectedNode?.id === nodeId) {
      setSelectedNode(prev => ({ ...prev, data: { ...prev.data, ...updates } }));
    }
  }, [selectedNode]);

  // Phase 5: top-level node patches (inputs/outputs/execution) — these
  // are NOT under .data, so they need a separate updater. Used by the
  // Typed I/O editor and Execution settings in NodePropertiesPanel.
  const handleNodeUpdateTop = useCallback((nodeId, patch) => {
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, ...patch } : n));
    setHasChanges(true);
    if (selectedNode?.id === nodeId) {
      setSelectedNode(prev => ({ ...prev, ...patch }));
    }
  }, [selectedNode]);

  // Phase 5: live lint — runs every edit, cheap pure JS.
  // The current draft flow shape we hand to the linter mirrors what
  // the editor saves. v1 flows get a free pass (no typed I/O declared).
  const draftFlow = useMemo(
    () => ({ ...flow, nodes, edges }),
    [flow, nodes, edges]
  );
  const lint = useMemo(() => lintFlow(draftFlow), [draftFlow]);
  const lintBadgesByNode = useMemo(() => lintByNode(draftFlow), [draftFlow]);

  // Phase 5: dry-run button — POSTs the draft to /api/flows/dry-run
  // for a server-side authoritative check (schema gate + lint). Useful
  // when the user wants confirmation before saving + executing.
  const [dryRunResult, setDryRunResult] = useState(null);
  const [dryRunning, setDryRunning] = useState(false);
  const handleDryRun = useCallback(async () => {
    setDryRunning(true);
    setDryRunResult(null);
    try {
      // ApiClient.request returns the parsed JSON body directly — for
      // dry-run that's { success, ok, schemaErrors, lintErrors, lintWarnings }.
      const res = await api.request('/flows/dry-run', { method: 'POST', body: draftFlow });
      setDryRunResult(res);
      if (!res?.ok && (res?.schemaErrors?.length || 0) > 0) {
        toast.error(`Dry-run found ${res.schemaErrors.length} schema error(s)`);
      }
    } catch (err) {
      toast.error(`Dry-run failed: ${err.message}`);
    } finally {
      setDryRunning(false);
    }
  }, [draftFlow]);

  // Sanitize node data before saving — strip runtime-only fields that
  // FlowCanvas injects (executionStatus, lintWarnings, declaredInputs/Outputs)
  // and ReactFlow's internal flags (selected, dragging, width, height,
  // positionAbsolute). These are computed each render; persisting them
  // is noise at best and trips schema strictness at worst.
  const sanitizeNodesForSave = useCallback((rawNodes) => {
    return (rawNodes || []).map(n => {
      const { selected, dragging, width, height, positionAbsolute, ...keptTop } = n;
      const data = { ...(n.data || {}) };
      delete data.executionStatus;
      delete data.lintWarnings;
      delete data.declaredInputs;
      delete data.declaredOutputs;
      delete data.charactersStreamed;
      return { ...keptTop, data };
    });
  }, []);

  // Save flow
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateFlow(flow.id, { nodes: sanitizeNodesForSave(nodes), edges });
      setHasChanges(false);
      toast.success('Flow saved');
    } catch (err) {
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [flow.id, nodes, edges, updateFlow, sanitizeNodesForSave]);

  // Clear conversations for all agent nodes in the flow
  const clearAgentConversations = useCallback(async () => {
    const agentIds = [...new Set(
      nodes
        .filter(n => n.type === 'agent' && n.data?.agentId)
        .map(n => n.data.agentId)
    )];

    if (agentIds.length === 0) return;

    const results = await Promise.allSettled(
      agentIds.map(id => api.clearConversation(id))
    );

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`Failed to clear ${failed.length} agent conversation(s)`);
    }
  }, [nodes]);

  // Show input dialog when clicking Run (with optional clear-warning)
  const handleRunClick = useCallback(() => {
    const skipWarning = localStorage.getItem('flow-skip-clear-warning') === 'true';
    if (skipWarning) {
      clearAgentConversations().then(() => setShowInputDialog(true));
    } else {
      setShowClearWarning(true);
    }
  }, [clearAgentConversations]);

  // Confirm clear warning and proceed to input dialog
  const handleClearWarningConfirm = useCallback(async () => {
    if (dontShowClearWarning) {
      localStorage.setItem('flow-skip-clear-warning', 'true');
    }
    setShowClearWarning(false);
    setDontShowClearWarning(false);
    await clearAgentConversations();
    setShowInputDialog(true);
  }, [dontShowClearWarning, clearAgentConversations]);

  // Execute flow with user input
  const handleExecute = useCallback(async (userInput) => {
    // Save first if there are changes
    if (hasChanges) {
      await handleSave();
    }

    setShowInputDialog(false);
    setExecuting(true);
    try {
      await executeFlow(flow.id, {
        sessionId,
        input: { userInput }
      });
      toast.success('Flow execution started');
    } catch (err) {
      toast.error(`Failed to execute: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  }, [flow.id, hasChanges, handleSave, executeFlow, sessionId]);

  // Stop flow execution
  const handleStop = useCallback(async () => {
    if (!currentRun?.id) return;

    try {
      await stopFlowRun(flow.id, currentRun.id);
      toast.success('Flow execution stopped');
    } catch (err) {
      toast.error(`Failed to stop: ${err.message}`);
    }
  }, [flow.id, currentRun?.id, stopFlowRun]);

  // Handle back navigation
  const handleBack = useCallback(() => {
    if (hasChanges) {
      setShowDiscardModal(true);
    } else {
      onClose();
    }
  }, [hasChanges, onClose]);

  return (
    <div className="fixed inset-0 z-[60] bg-gray-100 dark:bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="h-14 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 flex-shrink-0">
        {/* Left: Back + Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
            title="Back to flows"
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {flow.name}
            </h1>
            {hasChanges && (
              <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 rounded">
                Unsaved
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Lint summary chip (Phase 5) */}
          {lint.warnings.length > 0 && (
            <span
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 rounded"
              title={lint.warnings.map(w => w.message).join('\n')}
            >
              <ExclamationTriangleIcon className="w-3.5 h-3.5" />
              {lint.warnings.length} warning{lint.warnings.length === 1 ? '' : 's'}
            </span>
          )}

          {/* History / Versions (Phase 6) */}
          <button
            onClick={() => setShowVersions(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              showVersions
                ? 'bg-loxia-100 dark:bg-loxia-900/40 text-loxia-700 dark:text-loxia-300'
                : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200'
            }`}
            title="Show version history"
          >
            <ClockIcon className="w-4 h-4" />
            History
          </button>

          {/* Dry-Run (Phase 5) */}
          <button
            onClick={handleDryRun}
            disabled={dryRunning || nodes.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Validate this flow without executing — checks schema, types, and lint warnings."
          >
            {dryRunning ? (
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
            ) : (
              <CheckIcon className="w-4 h-4" />
            )}
            Dry-Run
          </button>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors
              ${hasChanges
                ? 'bg-loxia-600 hover:bg-loxia-700 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'}
            `}
          >
            {saving ? (
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
            ) : (
              <CheckIcon className="w-4 h-4" />
            )}
            Save
          </button>

          {/* Execute/Stop */}
          {isRunning ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              <StopIcon className="w-4 h-4" />
              Stop
            </button>
          ) : (
            <button
              onClick={handleRunClick}
              disabled={executing || nodes.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {executing ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : (
                <PlayIcon className="w-4 h-4" />
              )}
              Run
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Node Palette */}
        <NodePalette onAddNode={handleAddNode} />

        {/* Center: Canvas */}
        <div className="flex-1 relative">
          <ReactFlowProvider>
            <FlowCanvas
              nodes={nodes}
              edges={edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onNodeSelect={handleNodeSelect}
              agents={agents}
              nodeStates={nodeStates}
              lintBadgesByNode={lintBadgesByNode}
            />
          </ReactFlowProvider>

          {/* Execution Panel */}
          {showExecutionPanel && currentRun && (
            <ExecutionPanel
              currentRun={currentRun}
              nodes={nodes}
              onStop={handleStop}
              onResume={async () => {
                try {
                  await api.request(`/flows/runs/${currentRun.id}/resume`, {
                    method: 'POST',
                    body: { sessionId },
                  });
                  toast.success('Resuming from last successful node...');
                } catch (err) {
                  toast.error(`Resume failed: ${err.message}`);
                }
              }}
              onClose={() => setShowExecutionPanel(false)}
            />
          )}

          {/* Phase 5: dry-run results — inline panel showing each issue
              with a clickable node link. Shown after Dry-Run is pressed
              and dismissed via its X button. */}
          {dryRunResult && (
            <DryRunResultsPanel
              result={dryRunResult}
              nodes={nodes}
              onSelectNode={(nodeId) => {
                const n = nodes.find(x => x.id === nodeId);
                if (n) setSelectedNode(n);
              }}
              onClose={() => setDryRunResult(null)}
            />
          )}
        </div>

        {/* Versions Panel (Phase 6) — slides in from the right when toggled */}
        {showVersions && (
          <VersionsPanel
            flowId={flow.id}
            liveVersion={flow.version}
            onRollback={async () => {
              // After rollback, refetch the live flow so the canvas re-renders
              try {
                // GET /flows/:id returns { success, data: <flow> }
                const res = await api.request(`/flows/${encodeURIComponent(flow.id)}`);
                if (res?.data) {
                  setNodes(ensurePositions(res.data.nodes));
                  setEdges(ensureEdgeIds(res.data.edges || []));
                  setHasChanges(false);
                }
              } catch (err) {
                toast.error(`Failed to reload flow after rollback: ${err.message}`);
              }
            }}
            onClose={() => setShowVersions(false)}
          />
        )}

        {/* Right: Properties Panel */}
        {selectedNode && (
          <NodePropertiesPanel
            node={selectedNode}
            agents={agents}
            onUpdate={(updates) => handleNodeUpdate(selectedNode.id, updates)}
            onUpdateTop={(patch) => handleNodeUpdateTop(selectedNode.id, patch)}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>

      {/* Validation Warning */}
      {nodes.length > 0 && !nodes.some(n => n.type === 'input') && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-yellow-100 dark:bg-yellow-900/50 border border-yellow-300 dark:border-yellow-700 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
          <ExclamationTriangleIcon className="w-4 h-4" />
          Flow needs an Input node to start
        </div>
      )}

      {/* Input Dialog */}
      {showInputDialog && (
        <FlowInputDialog
          flow={flow}
          onRun={handleExecute}
          onCancel={() => setShowInputDialog(false)}
        />
      )}

      {/* Unsaved Changes Modal */}
      {showDiscardModal && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowDiscardModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 animate-fadeInScale"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/50 flex items-center justify-center">
                <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Unsaved Changes
              </h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 ml-[52px]">
              You have unsaved changes to <span className="font-medium text-gray-900 dark:text-gray-200">"{flow.name}"</span>. Do you want to save before leaving?
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDiscardModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowDiscardModal(false); onClose(); }}
                className="px-4 py-2 text-sm font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-900/70 rounded-lg transition-colors"
              >
                Discard
              </button>
              <button
                onClick={async () => { setShowDiscardModal(false); await handleSave(); onClose(); }}
                className="px-4 py-2 text-sm font-medium text-white bg-loxia-600 hover:bg-loxia-700 rounded-lg transition-colors"
              >
                Save & Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Conversations Warning Modal */}
      {showClearWarning && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowClearWarning(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 animate-fadeInScale"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/50 flex items-center justify-center">
                <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Clear Agent Conversations
              </h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 ml-[52px]">
              Running this flow will clear the conversation history of all participating agents to ensure a clean execution. Previous context will be removed.
            </p>
            <label className="flex items-center gap-2 mt-4 ml-[52px] text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontShowClearWarning}
                onChange={e => setDontShowClearWarning(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-loxia-600 focus:ring-loxia-500"
              />
              Don't show this again
            </label>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => { setShowClearWarning(false); setDontShowClearWarning(false); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClearWarningConfirm}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
              >
                Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FlowEditor;
