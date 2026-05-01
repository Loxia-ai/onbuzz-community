import React, { useState, useEffect, useMemo } from 'react';
import {
  XMarkIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  CloudArrowDownIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import LoadingSpinner from './LoadingSpinner.jsx';
import toast from 'react-hot-toast';

/**
 * AgentImportModal - Modal for browsing and importing archived agents
 *
 * @param {boolean} isOpen - Whether the modal is open
 * @param {function} onClose - Callback when modal is closed
 * @param {function} onImport - Callback when agent is successfully imported (agent) => void
 * @param {Array} activeAgents - List of currently active agents
 */
function AgentImportModal({ isOpen, onClose, onImport, activeAgents = [] }) {
  // State
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // agentId to confirm
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState(null);

  // Load agents when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchAvailableAgents();
    } else {
      // Reset state when modal closes
      setSearchQuery('');
      setError(null);
    }
  }, [isOpen]);

  // ESC key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  /**
   * Fetch all available agents from API
   */
  const fetchAvailableAgents = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/agents/available');
      const data = await response.json();

      if (data.success) {
        setAgents(data.agents || []);
      } else {
        throw new Error(data.error || 'Failed to load agents');
      }
    } catch (err) {
      setError(err.message);
      toast.error('Failed to load archived agents');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Import an archived agent
   */
  const handleImport = async (agentId, agentName) => {
    setImporting(agentId);

    try {
      const response = await fetch('/api/agents/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ agentId })
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Loaded ${agentName}`);
        onImport(data.agent);
        // Update local state instantly — just flip isLoaded for this agent
        setAgents(prev => prev.map(a =>
          a.agentId === agentId ? { ...a, isLoaded: true, canImport: false } : a
        ));
      } else {
        throw new Error(data.error || 'Failed to load pilot');
      }
    } catch (err) {
      toast.error(err.message);
      setError(err.message);
    } finally {
      setImporting(null);
    }
  };

  /**
   * Delete an archived agent from disk
   */
  const handleDelete = async (agentId, agentName) => {
    setDeleting(agentId);
    setDeleteConfirm(null);
    try {
      const response = await fetch(`/api/agents/archived/${agentId}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success) {
        toast.success(`Deleted ${agentName}`);
        setAgents(prev => prev.filter(a => a.agentId !== agentId));
      } else {
        throw new Error(data.error || 'Failed to delete');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(null);
    }
  };

  /**
   * Filter agents based on search query
   */
  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) {
      return agents;
    }

    const query = searchQuery.toLowerCase();
    return agents.filter(agent =>
      agent.name?.toLowerCase().includes(query) ||
      agent.agentId?.toLowerCase().includes(query) ||
      agent.model?.toLowerCase().includes(query) ||
      agent.firstUserMessage?.toLowerCase().includes(query)
    );
  }, [agents, searchQuery]);

  /**
   * Separate archived and active agents
   */
  const { archivedAgents, activeAgentsInList } = useMemo(() => {
    const archived = [];
    const active = [];

    filteredAgents.forEach(agent => {
      if (agent.isLoaded) {
        active.push(agent);
      } else {
        archived.push(agent);
      }
    });

    return { archivedAgents: archived, activeAgentsInList: active };
  }, [filteredAgents]);

  /**
   * Format timestamp to relative time
   */
  const formatLastActivity = (timestamp) => {
    if (!timestamp) return 'Unknown';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffWeeks < 4) return `${diffWeeks}w ago`;
    if (diffMonths < 12) return `${diffMonths}mo ago`;

    return date.toLocaleDateString();
  };

  /**
   * Render agent card
   */
  const renderAgentCard = (agent) => {
    const isImporting = importing === agent.agentId;
    const isActive = agent.isLoaded;

    return (
      <div
        key={agent.agentId}
        className={`group/card relative p-4 rounded-lg border transition-all overflow-hidden ${
          isActive
            ? 'bg-yellow-50 dark:bg-yellow-900/10 border-yellow-300 dark:border-yellow-700'
            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-loxia-400 dark:hover:border-loxia-600 hover:shadow-md'
        }`}
      >
        <div className="flex items-start justify-between">
          {/* Agent Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2 mb-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
                {agent.name}
              </h3>
              {isActive && (
                <span className="flex items-center px-2 py-0.5 text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 rounded">
                  <CheckCircleIcon className="w-3 h-3 mr-1" />
                  Active
                </span>
              )}
            </div>

            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
              <div className="flex items-center gap-3">
                <span>Last active: {formatLastActivity(agent.lastActivity)}</span>
                {agent.model && (
                  <span className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                    {agent.model}
                  </span>
                )}
              </div>
              {agent.firstUserMessage && (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic line-clamp-2 mt-1">
                  {agent.firstUserMessage}
                </p>
              )}
            </div>
          </div>

          {/* Active: simple Switch button */}
          {isActive && (
            <div className="flex-shrink-0 ml-4">
              <button
                onClick={() => {
                  onClose();
                  toast.success(`Pilot ${agent.name} is already active`);
                }}
                className="button-secondary text-sm"
              >
                Switch
              </button>
            </div>
          )}
        </div>

        {/* Archived: slide-in Load overlay from right on hover */}
        {!isActive && (
          isImporting ? (
            <div className="absolute inset-y-0 right-0 flex items-center px-6 bg-gradient-to-l from-loxia-50 dark:from-loxia-900/30 via-loxia-50/80 dark:via-loxia-900/20 to-transparent w-32">
              <LoadingSpinner size="sm" />
            </div>
          ) : (
            <button
              onClick={() => handleImport(agent.agentId, agent.name)}
              disabled={importing !== null || deleting !== null}
              className="
                absolute inset-y-0 right-0 flex items-center gap-2 px-5
                bg-gradient-to-l from-loxia-500 via-loxia-500 to-loxia-500/0
                text-white font-medium text-sm
                translate-x-full opacity-0 group-hover/card:translate-x-0 group-hover/card:opacity-100
                transition-all duration-300 ease-out
                hover:from-loxia-600 hover:via-loxia-600 hover:to-loxia-600/0
                disabled:opacity-50 disabled:cursor-not-allowed
                cursor-pointer
              "
            >
              <CloudArrowDownIcon className="w-5 h-5" />
              Load
            </button>
          )
        )}

        {/* Archived: slide-in Delete overlay from left on hover */}
        {!isActive && !isImporting && (
          deleting === agent.agentId ? (
            <div className="absolute inset-y-0 left-0 flex items-center px-6 bg-gradient-to-r from-red-50 dark:from-red-900/30 via-red-50/80 dark:via-red-900/20 to-transparent w-32">
              <LoadingSpinner size="sm" />
            </div>
          ) : deleteConfirm === agent.agentId ? (
            <div className="absolute inset-y-0 left-0 flex items-center gap-2 px-4 bg-gradient-to-r from-red-500 via-red-500 to-red-500/0 text-white text-sm z-10">
              <span>Delete?</span>
              <button onClick={() => handleDelete(agent.agentId, agent.name)} className="px-2 py-0.5 bg-white/20 rounded hover:bg-white/30 font-medium">Yes</button>
              <button onClick={() => setDeleteConfirm(null)} className="px-2 py-0.5 bg-white/10 rounded hover:bg-white/20">No</button>
            </div>
          ) : (
            <button
              onClick={() => setDeleteConfirm(agent.agentId)}
              disabled={importing !== null || deleting !== null}
              className="
                absolute inset-y-0 left-0 flex items-center gap-2 px-4
                bg-gradient-to-r from-red-500 via-red-500 to-red-500/0
                text-white font-medium text-sm
                -translate-x-full opacity-0 group-hover/card:translate-x-0 group-hover/card:opacity-100
                transition-all duration-300 ease-out
                hover:from-red-600 hover:via-red-600 hover:to-red-600/0
                disabled:opacity-50 disabled:cursor-not-allowed
                cursor-pointer
              "
            >
              <TrashIcon className="w-4 h-4" />
              Delete
            </button>
          )
        )}
      </div>
    );
  };

  // Don't render if not open
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Load Pilot
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Select a pilot to load from previous sessions
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>

          {/* Search */}
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, ID, or model..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-loxia-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <LoadingSpinner />
                <span className="ml-3 text-gray-600 dark:text-gray-400">
                  Loading pilots...
                </span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12">
                <ExclamationTriangleIcon className="w-12 h-12 text-red-500 mb-4" />
                <p className="text-red-600 dark:text-red-400 text-center mb-4">
                  {error}
                </p>
                <button
                  onClick={fetchAvailableAgents}
                  className="button-secondary text-sm"
                >
                  <ArrowPathIcon className="w-4 h-4 mr-2" />
                  Retry
                </button>
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                  <MagnifyingGlassIcon className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                  {searchQuery ? 'No pilots found' : 'No previous pilots'}
                </h3>
                <p className="text-gray-500 dark:text-gray-400 text-center max-w-sm">
                  {searchQuery
                    ? 'Try adjusting your search query'
                    : 'All your pilots are currently active, or you haven\'t created any pilots yet.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Archived Agents */}
                {archivedAgents.length > 0 && (
                  <>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                      Archived Pilots ({archivedAgents.length})
                    </h3>
                    {archivedAgents.map(renderAgentCard)}
                  </>
                )}

                {/* Active Agents */}
                {activeAgentsInList.length > 0 && (
                  <>
                    {archivedAgents.length > 0 && <div className="my-6 border-t border-gray-200 dark:border-gray-700" />}
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                      Already Active ({activeAgentsInList.length})
                    </h3>
                    {activeAgentsInList.map(renderAgentCard)}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {filteredAgents.length > 0 && (
                <span>
                  Showing {filteredAgents.length} of {agents.length} pilot{agents.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="button-secondary"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default AgentImportModal;
