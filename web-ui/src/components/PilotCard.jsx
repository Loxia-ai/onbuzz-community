import React, { useState, useRef, useEffect } from 'react';
import {
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  XMarkIcon,
  PlayIcon,
  PauseIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  PencilIcon,
  CheckIcon
} from '@heroicons/react/24/outline';
import AgentDuplicateMenu from './AgentDuplicateMenu.jsx';
import { handleTouchStart, handleTouchMove, handleTouchEnd } from '../hooks/useTouchDragDrop.js';

/**
 * PilotCard - Minimalistic, draggable card for displaying an agent/pilot
 *
 * Features:
 * - Compact horizontal layout
 * - Avatar with status badge below
 * - Name with inline rename (double-click name)
 * - First message snippet preview
 * - Minimal info display (model, messages as small text)
 * - Hover action bar at bottom
 * - Draggable with visual feedback
 * - Double-click card body to open chat
 */
const PilotCard = React.forwardRef(function PilotCard({
  agent,
  teamColors = [],
  isCurrent = false,
  isDragging = false,
  isLoading = false,
  isHighlighted = false,
  onDragStart,
  onDragEnd,
  onChat,
  onSettings,
  onPause,
  onResume,
  onUnload,
  onDelete,
  onRename,
  onQuickClone,
  onCloneWithSettings,
  onRemoveFromTeam,
  showRemoveButton = false,
  className = ''
}, ref) {
  const [needsMarquee, setNeedsMarquee] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const nameRef = useRef(null);
  const containerRef = useRef(null);
  const renameInputRef = useRef(null);

  if (!agent) return null;

  // Check if name overflows and needs marquee
  useEffect(() => {
    if (nameRef.current && containerRef.current && !isRenaming) {
      const nameWidth = nameRef.current.scrollWidth;
      const containerWidth = containerRef.current.clientWidth;
      setNeedsMarquee(nameWidth > containerWidth);
    }
  }, [agent.name, isRenaming]);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleDragStart = (e) => {
    if (isRenaming) { e.preventDefault(); return; }
    if (onDragStart) {
      e.dataTransfer.setData('agentId', agent.id);
      e.dataTransfer.effectAllowed = 'move';
      onDragStart(e, agent);
    }
  };

  const handleDragEnd = (e) => {
    if (onDragEnd) {
      onDragEnd(e, agent);
    }
  };

  // Touch drag handlers
  const onTouchStart = (e) => {
    if (isRenaming) return;
    handleTouchStart(e, { agentId: agent.id, agent }, () => {
      if (onDragStart) onDragStart(null, agent);
    });
  };

  const onTouchMove = (e) => {
    handleTouchMove(e);
  };

  const onTouchEnd = (e) => {
    handleTouchEnd(e, () => {
      if (onDragEnd) onDragEnd(null, agent);
    });
  };

  const handleDoubleClick = (e) => {
    // Don't open chat if clicking on the name area (that's for rename)
    if (isRenaming) return;
    if (onChat) {
      onChat(agent);
    }
  };

  // Rename handlers
  const startRename = (e) => {
    e.stopPropagation();
    if (!onRename) return;
    setRenameValue(agent.name);
    setIsRenaming(true);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== agent.name && onRename) {
      onRename(agent, trimmed);
    }
    setIsRenaming(false);
  };

  const cancelRename = () => {
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
  };

  // Determine agent status
  const getStatus = () => {
    if (agent.status === 'paused' && agent.pausedUntil) {
      const pausedUntil = new Date(agent.pausedUntil);
      if (new Date() < pausedUntil) {
        return 'paused';
      }
    }
    return agent.status || 'idle';
  };

  const status = getStatus();
  const isPaused = status === 'paused';
  const isActive = status === 'active';

  // Status colors
  const statusColors = {
    active: 'bg-green-500 text-white',
    paused: 'bg-yellow-500 text-white',
    idle: 'bg-gray-400 text-white',
    error: 'bg-red-500 text-white'
  };

  // Extract model display name - shortened
  const fullModel = agent.currentModel?.replace('-platform', '') || agent.model || 'Unknown';
  const shortModel = fullModel.length > 20 ? fullModel.substring(0, 18) + '...' : fullModel;

  // Get message count
  const messageCount = agent.conversationHistory?.length || agent.messageCount || 0;

  // First message snippet
  const snippet = agent.firstUserMessage || null;

  return (
    <div
      ref={ref}
      draggable={!isRenaming}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onDoubleClick={handleDoubleClick}
      title="Double-click to open chat"
      className={`
        group relative flex flex-col rounded-lg border overflow-hidden
        bg-white dark:bg-gray-800
        ${isDragging ? 'opacity-50 shadow-lg scale-105' : 'hover:shadow-md'}
        ${isCurrent ? 'border-loxia-500 border-2' : 'border-gray-200 dark:border-gray-700'}
        ${isHighlighted ? 'animate-glow-blue ring-2 ring-blue-400 dark:ring-blue-500' : ''}
        ${isRenaming ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}
        transition-all duration-200
        ${className}
      `}
    >
      {/* Team color indicators (left border) */}
      {teamColors.length > 0 && (
        <div className="absolute left-0 top-0 bottom-0 w-1 flex flex-col">
          {teamColors.map((color, idx) => (
            <div
              key={idx}
              className="flex-1"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      )}

      {/* Main Content */}
      <div className={`flex items-center gap-3 p-3 ${teamColors.length > 0 ? 'pl-4' : ''}`}>
        {/* Avatar Column with Status Below */}
        <div className="flex flex-col items-center flex-shrink-0">
          <div className={`
            w-10 h-10 rounded-full flex items-center justify-center
            ${isCurrent ? 'bg-loxia-600' : 'bg-gray-500 dark:bg-gray-600'}
          `}>
            <span className="text-white font-bold text-sm">
              {agent.name?.charAt(0).toUpperCase() || '?'}
            </span>
          </div>
          {/* Status Badge */}
          <span className={`
            mt-1 px-2 py-0.5 text-[10px] font-medium rounded-full capitalize
            ${statusColors[status] || statusColors.idle}
          `}>
            {status}
          </span>
        </div>

        {/* Info Column */}
        <div className="flex-1 min-w-0">
          {/* Name Row */}
          <div className="flex items-center gap-1.5">
            {isRenaming ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={commitRename}
                  className="flex-1 min-w-0 px-1.5 py-0.5 text-sm font-semibold rounded border border-loxia-400 dark:border-loxia-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-loxia-500"
                  onClick={e => e.stopPropagation()}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); commitRename(); }}
                  className="p-0.5 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600"
                  title="Save"
                >
                  <CheckIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <div ref={containerRef} className="flex-1 overflow-hidden">
                  <h4
                    ref={nameRef}
                    className={`
                      font-semibold text-gray-900 dark:text-gray-100 text-sm whitespace-nowrap
                      ${needsMarquee ? 'animate-marquee hover:animate-none' : ''}
                    `}
                  >
                    {agent.name}
                  </h4>
                </div>
                {/* Rename button — visible on hover */}
                {onRename && (
                  <button
                    onClick={startRename}
                    className="p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-opacity flex-shrink-0"
                    title="Rename"
                  >
                    <PencilIcon className="w-3 h-3" />
                  </button>
                )}
                {isCurrent && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-loxia-100 dark:bg-loxia-900/30 text-loxia-700 dark:text-loxia-300 rounded font-medium flex-shrink-0">
                    Current
                  </span>
                )}
              </>
            )}
          </div>

          {/* Meta Row - Compact */}
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
            <span title={fullModel}>{shortModel}</span>
            <span className="text-gray-300 dark:text-gray-600">&bull;</span>
            <span>{messageCount} msgs</span>
          </div>

          {/* First message snippet */}
          {snippet && (
            <p className="mt-1.5 text-[11px] leading-snug text-gray-400 dark:text-gray-500 line-clamp-2 italic">
              {snippet}
            </p>
          )}
        </div>
      </div>

      {/* Action Bar - Always present, buttons fade on hover */}
      <div className="
        flex items-center justify-center gap-1 px-2 py-1.5 h-9
        bg-gray-50 dark:bg-gray-700/50
        border-t border-gray-100 dark:border-gray-700
      ">
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {/* Chat */}
          {onChat && (
            <button
              onClick={(e) => { e.stopPropagation(); onChat(agent); }}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 hover:text-loxia-600"
              title="Open Chat"
              disabled={isLoading}
            >
              <ChatBubbleLeftRightIcon className="w-4 h-4" />
            </button>
          )}

          {/* Pause/Resume */}
          {isPaused && onResume ? (
            <button
              onClick={(e) => { e.stopPropagation(); onResume(agent); }}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 hover:text-green-600"
              title="Resume"
              disabled={isLoading}
            >
              <PlayIcon className="w-4 h-4" />
            </button>
          ) : onPause && isActive ? (
            <button
              onClick={(e) => { e.stopPropagation(); onPause(agent); }}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 hover:text-yellow-600"
              title="Pause"
              disabled={isLoading}
            >
              <PauseIcon className="w-4 h-4" />
            </button>
          ) : null}

          {/* Settings */}
          {onSettings && (
            <button
              onClick={(e) => { e.stopPropagation(); onSettings(agent); }}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 hover:text-gray-700 dark:hover:text-white"
              title="Settings"
              disabled={isLoading}
            >
              <Cog6ToothIcon className="w-4 h-4" />
            </button>
          )}

          {/* Duplicate Menu */}
          {(onQuickClone || onCloneWithSettings) && (
            <AgentDuplicateMenu
              agent={agent}
              onQuickClone={onQuickClone}
              onCloneWithSettings={onCloneWithSettings}
              disabled={isLoading}
              iconSize="w-4 h-4"
              buttonClass="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 hover:text-blue-600"
            />
          )}

          {/* Unload */}
          {onUnload && (
            <button
              onClick={(e) => { e.stopPropagation(); onUnload(agent); }}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 hover:text-orange-600"
              title="Unload (keep data)"
              disabled={isLoading}
            >
              <ArrowUpTrayIcon className="w-4 h-4" />
            </button>
          )}

          {/* Delete */}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(agent); }}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 hover:text-red-600"
              title="Delete"
              disabled={isLoading}
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          )}

          {/* Remove from team */}
          {showRemoveButton && onRemoveFromTeam && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemoveFromTeam(agent); }}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 hover:text-red-600"
              title="Remove from team"
              disabled={isLoading}
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default PilotCard;
