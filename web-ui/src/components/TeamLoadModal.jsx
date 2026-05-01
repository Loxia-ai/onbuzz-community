import React, { useState } from 'react';
import {
  XMarkIcon,
  UserGroupIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  CloudIcon
} from '@heroicons/react/24/outline';
import LoadingSpinner from './LoadingSpinner.jsx';

/**
 * TeamLoadModal - Modal for selecting and loading a team's members
 * Features expandable view to see team members before loading
 */
function TeamLoadModal({ isOpen, onClose, teams = [], agents = [], savedAgents = [], onLoadTeam, isLoading = false }) {
  const [expandedTeamId, setExpandedTeamId] = useState(null);
  const [loadingTeamId, setLoadingTeamId] = useState(null);

  if (!isOpen) return null;

  // Get team stats and member info
  const getTeamInfo = (team) => {
    const memberIds = team.memberAgentIds || [];
    const loadedAgents = agents.filter(a => memberIds.includes(a.id));
    const loadedIds = loadedAgents.map(a => a.id);

    // Build member list with loaded status
    const members = memberIds.map(id => {
      const loadedAgent = agents.find(a => a.id === id);
      const savedAgent = savedAgents.find(a => a.id === id);

      if (loadedAgent) {
        return {
          id,
          name: loadedAgent.name,
          status: loadedAgent.status || 'idle',
          isLoaded: true
        };
      } else if (savedAgent) {
        return {
          id,
          name: savedAgent.name,
          status: 'unloaded',
          isLoaded: false
        };
      } else {
        // Agent ID exists but no info available
        return {
          id,
          name: id.split('-').slice(0, 2).join('-'), // Show shortened ID
          status: 'unloaded',
          isLoaded: false
        };
      }
    });

    return {
      totalCount: memberIds.length,
      loadedCount: loadedAgents.length,
      unloadedCount: memberIds.length - loadedAgents.length,
      members
    };
  };

  const handleLoadTeam = async (teamId) => {
    setLoadingTeamId(teamId);
    try {
      await onLoadTeam(teamId);
      onClose();
    } catch (error) {
      console.error('Failed to load team:', error);
    } finally {
      setLoadingTeamId(null);
    }
  };

  const toggleExpand = (teamId) => {
    setExpandedTeamId(expandedTeamId === teamId ? null : teamId);
  };

  // Status badge colors
  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'paused': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'error': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      case 'unloaded': return 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
      default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <UserGroupIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  Load Team
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Click a team to see its members
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <XMarkIcon className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4">
            {teams.length === 0 ? (
              <div className="text-center py-8">
                <UserGroupIcon className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-gray-500 dark:text-gray-400">
                  No teams created yet. Create a team first.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {teams.map(team => {
                  const { totalCount, loadedCount, unloadedCount, members } = getTeamInfo(team);
                  const isFullyLoaded = unloadedCount === 0;
                  const isExpanded = expandedTeamId === team.id;

                  return (
                    <div
                      key={team.id}
                      className={`
                        rounded-lg border-2 transition-all overflow-hidden
                        ${isExpanded
                          ? 'border-blue-400 dark:border-blue-500'
                          : isFullyLoaded
                            ? 'border-gray-200 dark:border-gray-700 opacity-60'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}
                      `}
                    >
                      {/* Team Header Row */}
                      <div
                        onClick={() => toggleExpand(team.id)}
                        className={`
                          flex items-center justify-between p-3 cursor-pointer
                          ${isExpanded ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}
                        `}
                      >
                        <div className="flex items-center gap-3">
                          {/* Expand Icon */}
                          <div className="text-gray-400">
                            {isExpanded ? (
                              <ChevronDownIcon className="w-4 h-4" />
                            ) : (
                              <ChevronRightIcon className="w-4 h-4" />
                            )}
                          </div>

                          {/* Team Color */}
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: team.color || '#3B82F6' }}
                          />

                          {/* Team Info */}
                          <div>
                            <h4 className="font-medium text-gray-900 dark:text-gray-100">
                              {team.name}
                            </h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {loadedCount}/{totalCount} loaded
                              {isFullyLoaded && ' (all loaded)'}
                            </p>
                          </div>
                        </div>

                        {/* Load Button */}
                        {!isFullyLoaded && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleLoadTeam(team.id); }}
                            disabled={loadingTeamId === team.id}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                          >
                            {loadingTeamId === team.id ? (
                              <LoadingSpinner size="xs" />
                            ) : (
                              <ArrowDownTrayIcon className="w-4 h-4" />
                            )}
                            Load
                          </button>
                        )}
                      </div>

                      {/* Expanded Members List */}
                      {isExpanded && members.length > 0 && (
                        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                          <div className="p-2 space-y-1">
                            {members.map(member => (
                              <div
                                key={member.id}
                                className="flex items-center justify-between px-3 py-2 rounded-md bg-white dark:bg-gray-800"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {/* Status Icon */}
                                  {member.isLoaded ? (
                                    <CheckCircleIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                                  ) : (
                                    <CloudIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                  )}

                                  {/* Agent Name */}
                                  <span className={`text-sm truncate ${member.isLoaded ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>
                                    {member.name}
                                  </span>
                                </div>

                                {/* Status Badge */}
                                <span className={`
                                  px-2 py-0.5 text-[10px] font-medium rounded-full capitalize flex-shrink-0
                                  ${getStatusColor(member.status)}
                                `}>
                                  {member.status}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Summary Footer */}
                          {unloadedCount > 0 && (
                            <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700">
                              {unloadedCount} pilot{unloadedCount !== 1 ? 's' : ''} will be loaded
                            </div>
                          )}
                        </div>
                      )}

                      {/* Empty Team Message */}
                      {isExpanded && members.length === 0 && (
                        <div className="border-t border-gray-200 dark:border-gray-700 p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                          No pilots assigned to this team
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
            <button
              onClick={onClose}
              className="button-secondary"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TeamLoadModal;
