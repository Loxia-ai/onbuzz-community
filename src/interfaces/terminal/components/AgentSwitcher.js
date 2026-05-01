/**
 * AgentSwitcher Component
 * Quick-switch overlay for selecting agents
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { debugLog } from '../utils/debugLogger.js';

/**
 * Format time ago
 */
function timeAgo(timestamp) {
  if (!timestamp) return 'never';

  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * AgentSwitcher Component
 * @param {Object} props
 * @param {Array} props.agents - List of agents
 * @param {string} props.currentAgentId - Currently selected agent ID
 * @param {Function} props.onSelect - Called when agent is selected
 * @param {Function} props.onClose - Called when switcher is closed
 * @param {Function} props.onDelete - Called when agent deletion is confirmed
 * @param {Function} props.onEdit - Called when agent edit is triggered (Ctrl+E)
 * @param {number} props.terminalHeight - Terminal height for fullscreen rendering
 * @param {number} props.terminalWidth - Terminal width for fullscreen rendering
 */
export function AgentSwitcher({ agents = [], currentAgentId, onSelect, onClose, onDelete, onEdit, terminalHeight = 24, terminalWidth = 80 }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirmAgent, setDeleteConfirmAgent] = useState(null); // Agent pending deletion

  const MAX_VISIBLE_ITEMS = 9; // Max items visible at once

  // Filter agents by search query
  const filteredAgents = agents.filter(agent =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sort: current agent first, then by recent activity
  const sortedAgents = [...filteredAgents].sort((a, b) => {
    if (a.agentId === currentAgentId) return -1;
    if (b.agentId === currentAgentId) return 1;

    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });

  // Reset selected index and scroll when filter changes
  useEffect(() => {
    setSelectedIndex(0);
    setScrollOffset(0);
  }, [searchQuery]);

  // Handle keyboard input
  useInput((char, key) => {
    // If in delete confirmation mode, handle Y/N
    if (deleteConfirmAgent) {
      if (char?.toLowerCase() === 'y') {
        // Confirm deletion
        if (onDelete) {
          setTimeout(() => {
            onDelete(deleteConfirmAgent);
            onClose(); // Close switcher after delete
          }, 0);
        }
        return;
      } else if (char?.toLowerCase() === 'n' || key.escape) {
        // Cancel deletion
        setDeleteConfirmAgent(null);
        return;
      }
      return; // Ignore other keys in confirmation mode
    }

    // Close on Escape
    if (key.escape) {
      // Defer callback to avoid setState during render
      setTimeout(() => onClose(), 0);
      return;
    }

    // Select on Enter
    if (key.return && sortedAgents[selectedIndex]) {
      // Defer callback to avoid setState during render
      setTimeout(() => onSelect(sortedAgents[selectedIndex]), 0);
      return;
    }

    // Edit on Ctrl+E
    if (key.ctrl && char?.toLowerCase() === 'e') {
      if (sortedAgents[selectedIndex] && onEdit) {
        debugLog('AgentSwitcher', `Edit triggered for agent: ${sortedAgents[selectedIndex].name}`);
        // Defer callback to avoid setState during render
        setTimeout(() => onEdit(sortedAgents[selectedIndex]), 0);
      }
      return;
    }

    // Delete on Delete key or Ctrl+D (must come BEFORE search handler and be explicit)
    const isDeleteKey = key.delete || (key.ctrl && char?.toLowerCase() === 'd');

    debugLog('AgentSwitcher', `Key pressed - char: ${char}, key.ctrl: ${key.ctrl}, key.delete: ${key.delete}, isDeleteKey: ${isDeleteKey}`);

    if (isDeleteKey) {
      debugLog('AgentSwitcher', 'Delete triggered');
      debugLog('AgentSwitcher', `sortedAgents.length: ${sortedAgents.length}, selectedIndex: ${selectedIndex}`);

      if (!sortedAgents[selectedIndex]) {
        debugLog('AgentSwitcher', 'No agent at selectedIndex');
        return;
      }

      const selectedAgent = sortedAgents[selectedIndex];
      debugLog('AgentSwitcher', 'Selected agent', selectedAgent);
      debugLog('AgentSwitcher', `Selected agent ID: ${selectedAgent?.agentId}, Current agent ID: ${currentAgentId}`);

      // Validate agent has an ID before allowing deletion
      if (!selectedAgent || !selectedAgent.agentId) {
        debugLog('AgentSwitcher', 'Cannot delete agent without ID');
        return;
      }

      // Allow deleting any agent, including the current one
      // The backend will handle warnings for agents mid-task or used by other interfaces
      debugLog('AgentSwitcher', `Setting delete confirmation for: ${selectedAgent.name}`);
      setDeleteConfirmAgent(selectedAgent);
      return;
    }

    // Navigate with arrow keys (with scrolling)
    if (key.upArrow) {
      const newIndex = Math.max(0, selectedIndex - 1);
      const newScrollOffset = newIndex < scrollOffset ? newIndex : scrollOffset;

      setSelectedIndex(newIndex);
      setScrollOffset(newScrollOffset);
    } else if (key.downArrow) {
      const newIndex = Math.min(sortedAgents.length - 1, selectedIndex + 1);
      const newScrollOffset = newIndex >= scrollOffset + MAX_VISIBLE_ITEMS
        ? newIndex - MAX_VISIBLE_ITEMS + 1
        : scrollOffset;

      setSelectedIndex(newIndex);
      setScrollOffset(newScrollOffset);
    }
    // Number selection (1-9)
    else if (char >= '1' && char <= '9') {
      const index = parseInt(char) - 1;
      if (sortedAgents[index]) {
        // Defer callback to avoid setState during render
        setTimeout(() => onSelect(sortedAgents[index]), 0);
      }
    }
    // Backspace for search (only if not in delete confirmation)
    else if (key.backspace) {
      debugLog('AgentSwitcher', `Backspace pressed, current searchQuery: ${searchQuery}`);
      setSearchQuery(prev => {
        const newQuery = prev.slice(0, -1);
        debugLog('AgentSwitcher', `New searchQuery: ${newQuery}`);
        return newQuery;
      });
    }
    // Type to search
    else if (char && !key.ctrl && !key.meta && char.match(/[a-zA-Z0-9\-_ ]/)) {
      debugLog('AgentSwitcher', `Search handler reached - char: ${char}, key.ctrl: ${key.ctrl}, key.meta: ${key.meta}`);
      setSearchQuery(prev => {
        const newQuery = prev + char;
        debugLog('AgentSwitcher', `Adding to search query: ${char}, new query: ${newQuery}`);
        return newQuery;
      });
    }
  });

  // Get agent status indicator
  const getStatusIndicator = (agent) => {
    if (agent.agentId === currentAgentId) return '●';
    if (!agent.isLoaded) return '◌'; // Not loaded/archived
    return '○';
  };

  const getStatusColor = (agent) => {
    if (agent.agentId === currentAgentId) return 'green';
    if (!agent.isLoaded) return 'yellow'; // Not loaded shown in yellow
    return 'gray';
  };

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      minHeight: terminalHeight,
      maxHeight: terminalHeight,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'black',
    },
    React.createElement(
      Box,
      {
        flexDirection: 'column',
        width: '80%',
        borderStyle: 'double',
        borderColor: 'cyan',
        backgroundColor: 'black',
        paddingX: 1,
      },
    // Title
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(Text, { bold: true, color: 'cyan' }, 'Switch Agent')
    ),

    // Agent list (with scrolling)
    React.createElement(
      Box,
      { flexDirection: 'column', flexGrow: 1 },
      sortedAgents.length === 0
        ? React.createElement(
            Text,
            { dimColor: true },
            searchQuery ? 'No matching agents' : 'No agents available'
          )
        : React.createElement(
            Box,
            { flexDirection: 'column' },
            // Visible agents (with scroll window)
            sortedAgents.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS).map((agent, visibleIndex) => {
              const actualIndex = scrollOffset + visibleIndex;
              const isSelected = actualIndex === selectedIndex;
              const isCurrent = agent.agentId === currentAgentId;
              const number = actualIndex + 1;

              return React.createElement(
                Box,
                { key: agent.agentId },
                React.createElement(
                  Text,
                  {
                    backgroundColor: isSelected ? 'blue' : undefined,
                    color: isSelected ? 'white' : undefined,
                  },
                  `[${number}] ${getStatusIndicator(agent)} `,
                  React.createElement(
                    Text,
                    { color: getStatusColor(agent) },
                    agent.name.padEnd(20).substring(0, 20)
                  ),
                  ' ',
                  React.createElement(
                    Text,
                    { dimColor: true, color: !agent.isLoaded ? 'yellow' : undefined },
                    isCurrent ? '(active)' : !agent.isLoaded ? '(not loaded)' : timeAgo(agent.lastMessageAt)
                  )
                )
              );
            }),
            // Scroll indicator
            sortedAgents.length > MAX_VISIBLE_ITEMS &&
              React.createElement(
                Box,
                { key: 'scroll-indicator', marginTop: 1 },
                React.createElement(
                  Text,
                  { dimColor: true },
                  `Showing ${scrollOffset + 1}-${Math.min(scrollOffset + MAX_VISIBLE_ITEMS, sortedAgents.length)} of ${sortedAgents.length}`
                )
              )
          )
    ),

      // Search hint or Delete confirmation
      React.createElement(
        Box,
        { marginTop: 1, borderTop: true, borderStyle: 'single', paddingTop: 1 },
        deleteConfirmAgent
          ? React.createElement(
              Box,
              { flexDirection: 'column' },
              React.createElement(
                Text,
                {},
                'Delete agent ',
                React.createElement(Text, { color: 'red', bold: true }, `"${deleteConfirmAgent.name}"`),
                '?'
              ),
              React.createElement(
                Text,
                { marginTop: 1 },
                React.createElement(Text, { dimColor: true }, 'This cannot be undone. '),
                React.createElement(Text, { color: 'green', bold: true }, '[Y]'),
                React.createElement(Text, { dimColor: true }, 'es / '),
                React.createElement(Text, { color: 'red', bold: true }, '[N]'),
                React.createElement(Text, { dimColor: true }, 'o')
              )
            )
          : searchQuery
          ? React.createElement(
              Text,
              {},
              'Search: ',
              React.createElement(Text, { color: 'yellow' }, searchQuery),
              React.createElement(Text, { dimColor: true }, ' (backspace to clear)')
            )
          : React.createElement(
              Text,
              { dimColor: true },
              'Type number or search... ',
              React.createElement(Text, { color: 'cyan' }, 'Ctrl+E'),
              React.createElement(Text, { dimColor: true }, ' edit  '),
              React.createElement(Text, { color: 'red' }, 'Ctrl+D'),
              React.createElement(Text, { dimColor: true }, ' delete (Esc to cancel)')
            )
      )
    ) // Close inner Box
  ); // Close outer Box
}

export default AgentSwitcher;
