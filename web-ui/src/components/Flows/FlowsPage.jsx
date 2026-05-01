import React, { useEffect, useState } from 'react';
import {
  PlusIcon,
  ShareIcon,
  TrashIcon,
  PencilIcon,
  PlayIcon,
  ClockIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { useFlowsStore } from '../../stores/flowsStore.js';
import { useAppStore } from '../../stores/appStore.js';
import FlowCreationModal from './FlowCreationModal.jsx';
import FlowEditor from './FlowEditor.jsx';
import FlowInputDialog from './panels/FlowInputDialog.jsx';
import LoadingSpinner from '../LoadingSpinner.jsx';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice.js';
import toast from 'react-hot-toast';

function FlowsPage() {
  const {
    flows,
    currentFlow,
    loading,
    error,
    activeRunsByFlowId,
    fetchFlows,
    fetchActiveRuns,
    createFlow,
    deleteFlow,
    executeFlow,
    setCurrentFlow,
    clearError
  } = useFlowsStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [flowToDelete, setFlowToDelete] = useState(null);
  const [editingFlow, setEditingFlow] = useState(null);
  const [flowToRun, setFlowToRun] = useState(null);

  const { sessionId } = useAppStore();

  // Fetch flows on mount
  useEffect(() => {
    fetchFlows().catch(err => {
      console.error('Failed to fetch flows:', err);
    });
  }, [fetchFlows]);

  // Active-run polling. Refreshes every 10s while the page is mounted so
  // a tab left open shows fresh status even if a ws message was missed.
  // Real-time updates ALSO flow through `flow_run_*` ws events into
  // flowsStore.handleFlowUpdateEvent → _bumpActiveRuns; the poll is a
  // belt-and-suspenders safety net.
  useEffect(() => {
    fetchActiveRuns().catch(() => {});
    const interval = setInterval(() => { fetchActiveRuns().catch(() => {}); }, 10000);
    return () => clearInterval(interval);
  }, [fetchActiveRuns]);

  // Handle flow creation
  const handleCreateFlow = async (flowData) => {
    try {
      const newFlow = await createFlow(flowData);
      setShowCreateModal(false);
      toast.success(`Flow "${flowData.name}" created`);
      // Open editor for new flow
      setEditingFlow(newFlow);
    } catch (err) {
      toast.error(`Failed to create flow: ${err.message}`);
    }
  };

  // Handle flow deletion
  const handleDeleteFlow = async (flow) => {
    try {
      await deleteFlow(flow.id);
      toast.success(`Flow "${flow.name}" deleted`);
      setFlowToDelete(null);
    } catch (err) {
      toast.error(`Failed to delete flow: ${err.message}`);
    }
  };

  // Show run dialog for flow
  const handleRunClick = (flow) => {
    setFlowToRun(flow);
  };

  // Handle flow execution with user input
  const handleExecuteFlow = async (userInput) => {
    if (!flowToRun) return;

    try {
      await executeFlow(flowToRun.id, {
        sessionId,
        input: { userInput }
      });
      toast.success(`Flow "${flowToRun.name}" started`);
      setFlowToRun(null);
    } catch (err) {
      toast.error(`Failed to execute: ${err.message}`);
    }
  };

  // If editing a flow, show the editor
  if (editingFlow) {
    return (
      <FlowEditor
        flow={editingFlow}
        onClose={() => {
          setEditingFlow(null);
          // Refresh flows to get updated data
          fetchFlows();
        }}
      />
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        {/* Main Header Row */}
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Flow Control Center
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Refresh Button */}
            <button
              onClick={() => fetchFlows()}
              disabled={loading}
              className="button-secondary text-sm py-2"
              title="Refresh flows"
            >
              <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Create Flow Button */}
            <button
              onClick={() => setShowCreateModal(true)}
              disabled={loading}
              className="button-primary text-sm py-2"
            >
              <PlusIcon className="w-4 h-4 mr-1.5" />
              New Flow
            </button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="px-6 py-2 flex items-center justify-between text-sm border-t border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-800/50">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-loxia-500"></div>
              <span className="text-gray-600 dark:text-gray-400">Flows:</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">{flows.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="p-6">
        {loading && flows.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : flows.length === 0 ? (
          /* Empty State */
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-12 text-center">
            <ShareIcon className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600" />
            <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              No Flows Yet
            </h3>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              Flows let you chain AI agents together in visual pipelines.
              The output of one agent becomes the input for the next.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="button-primary mt-6"
            >
              <PlusIcon className="w-5 h-5 mr-2" />
              Create Your First Flow
            </button>
          </div>
        ) : (
          /* Flows Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {flows.map(flow => (
              <FlowCard
                key={flow.id}
                flow={flow}
                isSelected={currentFlow?.id === flow.id}
                activeRuns={activeRunsByFlowId[flow.id] || []}
                onSelect={() => setCurrentFlow(flow)}
                onEdit={() => setEditingFlow(flow)}
                onRun={() => handleRunClick(flow)}
                onDelete={() => setFlowToDelete(flow)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Flow Modal */}
      {showCreateModal && (
        <FlowCreationModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateFlow}
        />
      )}

      {/* Delete Confirmation Modal */}
      {flowToDelete && (
        <DeleteConfirmModal
          flow={flowToDelete}
          onConfirm={() => handleDeleteFlow(flowToDelete)}
          onCancel={() => setFlowToDelete(null)}
        />
      )}

      {/* Error Toast */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-lg p-4 shadow-lg max-w-sm">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={clearError}
            className="mt-2 text-xs text-red-600 dark:text-red-400 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Run Flow Dialog */}
      {flowToRun && (
        <FlowInputDialog
          flow={flowToRun}
          onRun={handleExecuteFlow}
          onCancel={() => setFlowToRun(null)}
        />
      )}
    </div>
  );
}

/**
 * Flow card component
 */
function FlowCard({ flow, isSelected, activeRuns = [], onSelect, onEdit, onRun, onDelete }) {
  // On touch devices, hover-revealed buttons aren't reachable. Show the
  // action buttons always; bump them to ≥44px tap targets.
  const isTouch = useIsTouchDevice();
  const actionVisibility = isTouch ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';
  const tapSizeClass = isTouch ? 'p-2.5 min-w-[44px] min-h-[44px]' : 'p-1.5';

  const handleDelete = (e) => {
    e.stopPropagation();
    onDelete();
  };

  const handleEdit = (e) => {
    e.stopPropagation();
    onEdit();
  };

  const handleRun = (e) => {
    e.stopPropagation();
    onRun();
  };

  // Visual feedback when one or more runs are active for this flow.
  // Pulsing emerald accent on the card border + a step-aware "Running"
  // badge + a subtle bottom progress bar. Color overrides the selected-
  // state styling so a running selected flow stays clearly running.
  const isRunning = activeRuns.length > 0;
  const borderClass = isRunning
    ? 'border-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-800/60'
    : isSelected
      ? 'border-loxia-500 ring-2 ring-loxia-200 dark:ring-loxia-800'
      : 'border-gray-200 dark:border-gray-700';

  // Pick the most recently started run as the "primary" — its progress
  // is what the user sees on the card. (Other concurrent runs are
  // counted in the badge but not detailed; if you need more, open the
  // editor.) Sort defensively in case the server didn't.
  const primaryRun = isRunning
    ? [...activeRuns].sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))[0]
    : null;
  const progress = primaryRun?.progress || null;

  // Build the badge text. Order of preference:
  //   "3/5 · Writer"  ← have total + label  (richest)
  //   "3/5"           ← have total, no label
  //   "Step 3"        ← have count, no total (legacy / no flow def)
  //   "Running"       ← only know the run is alive (queued, no nodes started yet)
  const stepText = (() => {
    if (!progress) return 'Running';
    const { completed = 0, total, currentNodeLabel } = progress;
    const pos = completed + (progress.running > 0 ? 1 : 0);  // include running step in numerator
    if (total != null) {
      return currentNodeLabel ? `${pos}/${total} · ${currentNodeLabel}` : `${pos}/${total}`;
    }
    return currentNodeLabel ? `Running · ${currentNodeLabel}` : `Step ${pos || 1}`;
  })();
  const multiRunSuffix = activeRuns.length > 1 ? ` (+${activeRuns.length - 1})` : '';
  // Numeric percent for the bottom bar; null = indeterminate (animated shimmer).
  const percent = progress?.percent;

  return (
    <div
      onClick={onSelect}
      className={`
        group relative bg-white dark:bg-gray-800 rounded-xl border-2 p-4 cursor-pointer transition-all
        hover:shadow-lg hover:border-loxia-300 dark:hover:border-loxia-600
        ${borderClass}
      `}
    >
      {/* Step-aware "Running" badge — top-right. Replaces the simple
          "Running ×N" with a step indicator: "3/5 · Writer" when the
          backend can supply totals, falling back gracefully otherwise. */}
      {isRunning && (
        <div
          className="absolute top-3 right-12 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium max-w-[60%] truncate"
          title={`${activeRuns.length} active run${activeRuns.length !== 1 ? 's' : ''}${
            progress?.percent != null ? ` · ${progress.percent}% complete` : ''
          }${
            progress?.currentNodeLabel ? ` · current step: ${progress.currentNodeLabel}` : ''
          }`}
        >
          <span className="relative inline-flex h-2 w-2 flex-shrink-0">
            {/* Pulsing dot — concentric ping + solid center. */}
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="truncate">{stepText}{multiRunSuffix}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`
            w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
            ${isRunning
              ? 'bg-emerald-100 dark:bg-emerald-900/40'
              : isSelected
                ? 'bg-loxia-100 dark:bg-loxia-900/50'
                : 'bg-gray-100 dark:bg-gray-700'}
          `}>
            <ShareIcon className={`w-5 h-5 ${
              isRunning ? 'text-emerald-600 dark:text-emerald-400'
              : isSelected ? 'text-loxia-600' : 'text-gray-500 dark:text-gray-400'
            }`} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
              {flow.name}
            </h3>
            {flow.description && (
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                {flow.description}
              </p>
            )}
          </div>
        </div>

        {/* Delete button — always visible on touch (no hover signal). */}
        <button
          onClick={handleDelete}
          className={`${actionVisibility} ${tapSizeClass} rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-all flex items-center justify-center`}
          title="Delete flow"
          aria-label="Delete flow"
        >
          <TrashIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="mt-4 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
          <span>{flow.nodes?.length || 0} nodes</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
          <span>{flow.edges?.length || 0} edges</span>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
        <div className="flex items-center gap-1">
          <ClockIcon className="w-3.5 h-3.5" />
          <span>{formatDate(flow.updatedAt)}</span>
        </div>

        {/* Quick actions — visible on touch, hover-revealed on mouse. */}
        <div className={`flex items-center gap-1 ${actionVisibility} transition-opacity`}>
          <button
            onClick={handleEdit}
            className={`${tapSizeClass} rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-loxia-600 dark:hover:text-loxia-400 transition-colors flex items-center justify-center`}
            title="Edit flow"
            aria-label="Edit flow"
          >
            <PencilIcon className="w-4 h-4" />
          </button>
          <button
            onClick={handleRun}
            className={`${tapSizeClass} rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-gray-400 hover:text-green-600 transition-colors flex items-center justify-center`}
            title="Run flow"
            aria-label="Run flow"
          >
            <PlayIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress bar — slim strip at the bottom edge of the card,
          following its rounded corners. Determinate when the backend
          reported a percentage; indeterminate (animated shimmer) when
          the run is alive but no nodes have started yet (queued, or
          no flow def to compute total against).
          Sits underneath everything via z-0 so the action buttons stay
          tappable and the card content isn't obscured. */}
      {isRunning && (
        <div
          className="absolute left-0 right-0 bottom-0 h-1 rounded-b-xl overflow-hidden bg-emerald-100 dark:bg-emerald-900/40"
          aria-hidden="true"
        >
          {percent != null ? (
            // Determinate: emerald fill at the reported percent.
            <div
              className="h-full bg-emerald-500 transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
            />
          ) : (
            // Indeterminate: shimmering stripe so the card still
            // signals "something's happening" while we wait for a
            // node to start.
            <div className="h-full w-1/3 bg-emerald-500/70 animate-progress-shimmer" />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Delete confirmation modal
 */
function DeleteConfirmModal({ flow, onConfirm, onCancel }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 animate-fadeInScale"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Delete Flow
        </h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Are you sure you want to delete <span className="font-medium">"{flow.name}"</span>?
          This action cannot be undone.
        </p>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="button-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Format date relative to now
 */
function formatDate(dateString) {
  if (!dateString) return '';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return diffMins <= 1 ? 'Just now' : `${diffMins}m ago`;
    }
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString();
  }
}

export default FlowsPage;
