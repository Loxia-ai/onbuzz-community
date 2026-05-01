import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  PencilIcon,
  TrashIcon,
  EllipsisVerticalIcon,
  UserGroupIcon,
  PlayIcon,
  PauseIcon,
  BoltIcon,
  ChatBubbleLeftRightIcon
} from '@heroicons/react/24/outline';
import PilotCard from './PilotCard.jsx';
import LoadingSpinner from './LoadingSpinner.jsx';

/**
 * TeamFrame - Container component for a team showing its members
 *
 * Features:
 * - Header with team name, color indicator, member count
 * - Load All button to load all team members
 * - Drop zone for receiving pilots via drag-and-drop
 * - Grid of PilotCards for loaded members
 * - Actions menu: Edit, Delete
 */
function TeamFrame({
  team,
  agents = [],
  currentAgentId,
  isDropTarget = false,
  isLoading = false,
  onDrop,
  onDragOver,
  onDragLeave,
  onLoadTeam,
  onEditTeam,
  onDeleteTeam,
  onPauseTeam,
  onResumeTeam,
  onUnloadTeam,
  onEnableAutopilot,
  onDisableAutopilot,
  onRemoveAgent,
  onAgentChat,
  onAgentSettings,
  onAgentPause,
  onAgentResume,
  onAgentRename,
  onAgentUnload,
  onAgentDelete,
  onAgentQuickClone,
  onAgentCloneWithSettings,
  onDragStart,
  onDragEnd
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const dropZoneRef = useRef(null);

  // Handle touch drop events
  useEffect(() => {
    const el = dropZoneRef.current;
    if (!el) return;

    const handleTouchDrop = (e) => {
      const { agentId } = e.detail;
      if (agentId && onDrop) {
        // Create a mock event with dataTransfer for compatibility
        const mockEvent = {
          preventDefault: () => {},
          dataTransfer: { getData: () => agentId }
        };
        onDrop(mockEvent, team.id);
      }
      setIsHovering(false);
    };

    const handleTouchDragEnter = () => {
      setIsHovering(true);
      if (onDragOver) onDragOver(null, team.id);
    };

    const handleTouchDragLeave = () => {
      setIsHovering(false);
      if (onDragLeave) onDragLeave(null, team.id);
    };

    el.addEventListener('touchdrop', handleTouchDrop);
    el.addEventListener('touchdragenter', handleTouchDragEnter);
    el.addEventListener('touchdragleave', handleTouchDragLeave);

    return () => {
      el.removeEventListener('touchdrop', handleTouchDrop);
      el.removeEventListener('touchdragenter', handleTouchDragEnter);
      el.removeEventListener('touchdragleave', handleTouchDragLeave);
    };
  }, [team.id, onDrop, onDragOver, onDragLeave]);

  if (!team) return null;

  // Get loaded member agents
  const memberAgents = agents.filter(a => team.memberAgentIds?.includes(a.id));
  const loadedCount = memberAgents.length;
  const totalCount = team.memberAgentIds?.length || 0;
  const unloadedCount = totalCount - loadedCount;

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsHovering(true);
    if (onDragOver) onDragOver(e, team.id);
  };

  const handleDragLeave = (e) => {
    setIsHovering(false);
    if (onDragLeave) onDragLeave(e, team.id);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsHovering(false);
    if (onDrop) onDrop(e, team.id);
  };

  return (
    <div
      ref={dropZoneRef}
      data-drop-zone={`team-${team.id}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        rounded-xl border-2 p-4 transition-all duration-200
        bg-white dark:bg-gray-800
        ${isDropTarget || isHovering
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-lg'
          : 'border-dashed border-gray-300 dark:border-gray-600'}
      `}
    >
      {/* Team Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {/* Team Color Indicator */}
          <div
            className="w-4 h-4 rounded-full flex-shrink-0"
            style={{ backgroundColor: team.color || '#3B82F6' }}
          />

          {/* Team Name */}
          <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">
            {team.name}
          </h3>

          {/* Member Count */}
          <span className="text-sm text-gray-500 dark:text-gray-400">
            ({loadedCount}/{totalCount} loaded)
          </span>
        </div>

        {/* Team Actions */}
        <div className="flex items-center gap-2">
          {/* Load All Button */}
          {unloadedCount > 0 && (
            <button
              onClick={() => onLoadTeam?.(team.id)}
              disabled={isLoading}
              className="flex items-center gap-1 px-2 py-1 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <LoadingSpinner size="xs" />
              ) : (
                <ArrowDownTrayIcon className="w-4 h-4" />
              )}
              Load All
            </button>
          )}

          {/* Actions Menu */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            >
              <EllipsisVerticalIcon className="w-5 h-5" />
            </button>

            {showMenu && (
              <>
                {/* Backdrop */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />

                {/* Menu */}
                <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1">
                  {/* Mode Toggle */}
                  {loadedCount > 0 && (
                    <>
                      {onEnableAutopilot && (
                        <button
                          onClick={() => { setShowMenu(false); onEnableAutopilot?.(team); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <BoltIcon className="w-4 h-4 text-loxia-500" />
                          Enable Autopilot
                        </button>
                      )}
                      {onDisableAutopilot && (
                        <button
                          onClick={() => { setShowMenu(false); onDisableAutopilot?.(team); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <ChatBubbleLeftRightIcon className="w-4 h-4 text-blue-500" />
                          Switch to Chat
                        </button>
                      )}
                    </>
                  )}

                  {/* Pause/Resume Team */}
                  {loadedCount > 0 && (
                    <>
                      {onPauseTeam && (
                        <button
                          onClick={() => { setShowMenu(false); onPauseTeam?.(team); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <PauseIcon className="w-4 h-4 text-yellow-500" />
                          Pause All
                        </button>
                      )}
                      {onResumeTeam && (
                        <button
                          onClick={() => { setShowMenu(false); onResumeTeam?.(team); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <PlayIcon className="w-4 h-4 text-green-500" />
                          Resume All
                        </button>
                      )}
                    </>
                  )}

                  {/* Unload Team */}
                  {onUnloadTeam && loadedCount > 0 && (
                    <button
                      onClick={() => { setShowMenu(false); onUnloadTeam?.(team); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <ArrowUpTrayIcon className="w-4 h-4 text-orange-500" />
                      Unload Team
                    </button>
                  )}

                  <div className="border-t border-gray-200 dark:border-gray-700 my-1" />

                  <button
                    onClick={() => { setShowMenu(false); onEditTeam?.(team); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <PencilIcon className="w-4 h-4" />
                    Edit Team
                  </button>
                  <button
                    onClick={() => { setShowMenu(false); onDeleteTeam?.(team); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <TrashIcon className="w-4 h-4" />
                    Delete Team
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Team Description */}
      {team.description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {team.description}
        </p>
      )}

      {/* Member Pilots Grid - Single column within team frame for readability */}
      <div className="grid grid-cols-1 gap-3">
        {memberAgents.map(agent => (
          <PilotCard
            key={agent.id}
            agent={agent}
            teamColors={[team.color || '#3B82F6']}
            isCurrent={agent.id === currentAgentId}
            onDragStart={(e, a) => onDragStart?.(e, a, team.id)}
            onDragEnd={onDragEnd}
            onChat={onAgentChat}
            onSettings={onAgentSettings}
            onPause={onAgentPause}
            onResume={onAgentResume}
            onRename={onAgentRename}
            onUnload={onAgentUnload}
            onDelete={onAgentDelete}
            onQuickClone={onAgentQuickClone}
            onCloneWithSettings={onAgentCloneWithSettings}
            onRemoveFromTeam={() => onRemoveAgent?.(team.id, agent.id)}
            showRemoveButton
          />
        ))}

        {/* Unloaded Members Indicator */}
        {unloadedCount > 0 && (
          <div className="p-4 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 min-h-[120px]">
            <UserGroupIcon className="w-6 h-6 mb-2" />
            <span className="text-sm">+ {unloadedCount} not loaded</span>
          </div>
        )}
      </div>

      {/* Empty State */}
      {totalCount === 0 && (
        <div className={`
          py-8 text-center rounded-lg border-2 border-dashed
          ${isHovering ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/10' : 'border-gray-200 dark:border-gray-700'}
          transition-colors
        `}>
          <UserGroupIcon className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-gray-400 dark:text-gray-500 text-sm">
            Drag pilots here to add them to this team
          </p>
        </div>
      )}
    </div>
  );
}

export default TeamFrame;
