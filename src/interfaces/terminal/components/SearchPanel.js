/**
 * SearchPanel Component
 * Command palette overlay for finding messages
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * Fuzzy match score
 * @param {string} str - String to search in
 * @param {string} query - Query to search for
 * @returns {number} - Match score (higher is better, 0 = no match)
 */
function fuzzyScore(str, query) {
  if (!query) return 1;

  const lowerStr = str.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Exact match gets highest score
  if (lowerStr.includes(lowerQuery)) {
    return 1000;
  }

  // Character-by-character matching
  let score = 0;
  let queryIndex = 0;

  for (let i = 0; i < lowerStr.length && queryIndex < lowerQuery.length; i++) {
    if (lowerStr[i] === lowerQuery[queryIndex]) {
      score += 1;
      queryIndex++;
    }
  }

  // All query characters found
  if (queryIndex === lowerQuery.length) {
    return score;
  }

  return 0; // No match
}

/**
 * Format timestamp
 */
function formatTime(timestamp) {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * SearchPanel Component
 * @param {Object} props
 * @param {Array} props.messages - Array of messages to search
 * @param {Function} props.onSelect - Called when a message is selected
 * @param {Function} props.onClose - Called when search is closed
 */
export function SearchPanel({ messages = [], onSelect, onClose }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterType, setFilterType] = useState('all'); // 'all', 'user', 'assistant', 'system'

  // Filter and search messages
  const filteredMessages = messages
    .filter(msg => {
      // Filter by type
      if (filterType !== 'all' && msg.role !== filterType) {
        return false;
      }

      // Filter by search query
      if (!searchQuery) return true;

      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return fuzzyScore(content, searchQuery) > 0;
    })
    .map(msg => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return {
        ...msg,
        score: fuzzyScore(content, searchQuery),
        displayContent: content,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10); // Show top 10 results

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery, filterType]);

  // Handle keyboard input
  useInput((char, key) => {
    // Close on Escape
    if (key.escape) {
      onClose();
      return;
    }

    // Select on Enter
    if (key.return && filteredMessages[selectedIndex]) {
      onSelect(filteredMessages[selectedIndex]);
      return;
    }

    // Navigate with arrow keys
    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(filteredMessages.length - 1, prev + 1));
    }
    // Cycle filter type with Tab
    else if (key.tab) {
      const types = ['all', 'user', 'assistant', 'system'];
      const currentIndex = types.indexOf(filterType);
      const nextIndex = (currentIndex + 1) % types.length;
      setFilterType(types[nextIndex]);
    }
    // Backspace to delete search query
    else if (key.backspace || key.delete) {
      setSearchQuery(prev => prev.slice(0, -1));
    }
    // Type to search
    else if (char && !key.ctrl && !key.meta) {
      setSearchQuery(prev => prev + char);
    }
  });

  // Get role color
  const getRoleColor = (role) => {
    switch (role) {
      case 'user':
        return 'cyan';
      case 'assistant':
        return 'green';
      case 'system':
        return 'yellow';
      default:
        return 'white';
    }
  };

  // Get role indicator
  const getRoleIndicator = (role) => {
    switch (role) {
      case 'user':
        return 'U';
      case 'assistant':
        return 'A';
      case 'system':
        return 'S';
      default:
        return '?';
    }
  };

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      width: 70,
      height: 20,
      borderStyle: 'round',
      borderColor: 'cyan',
      paddingX: 1,
      paddingY: 1,
    },
    // Title and filter type
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(Text, { bold: true, color: 'cyan' }, 'Search Messages'),
      React.createElement(Text, { dimColor: true }, ' ('),
      React.createElement(Text, { color: 'yellow' }, filterType),
      React.createElement(Text, { dimColor: true }, ')')
    ),

    // Search input
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(Text, {}, '> '),
      React.createElement(Text, { color: 'yellow' }, searchQuery),
      React.createElement(Text, {}, String.fromCharCode(0x2588)) // Cursor
    ),

    // Results
    React.createElement(
      Box,
      { flexDirection: 'column', flexGrow: 1 },
      filteredMessages.length === 0
        ? React.createElement(
            Text,
            { dimColor: true },
            searchQuery ? 'No matching messages' : 'Type to search...'
          )
        : filteredMessages.map((msg, index) => {
            const isSelected = index === selectedIndex;
            const preview = msg.displayContent.substring(0, 60).replace(/\n/g, ' ');
            const truncated = msg.displayContent.length > 60 ? '...' : '';

            return React.createElement(
              Box,
              { key: msg.id || index, marginBottom: 0 },
              React.createElement(
                Text,
                {
                  backgroundColor: isSelected ? 'blue' : undefined,
                  color: isSelected ? 'white' : undefined,
                },
                isSelected ? '> ' : '  ',
                React.createElement(
                  Text,
                  { color: getRoleColor(msg.role) },
                  `[${getRoleIndicator(msg.role)}]`
                ),
                ' ',
                React.createElement(
                  Text,
                  { dimColor: true },
                  msg.timestamp ? formatTime(msg.timestamp) : ''
                ),
                ' ',
                React.createElement(
                  Text,
                  {},
                  preview + truncated
                )
              )
            );
          })
    ),

    // Help text
    React.createElement(
      Box,
      { marginTop: 1, borderTop: true, borderStyle: 'single', paddingTop: 1 },
      React.createElement(
        Text,
        { dimColor: true },
        'Tab: Filter type  ↑/↓: Navigate  Enter: Select  Esc: Cancel'
      )
    ),

    // Results count
    React.createElement(
      Box,
      {},
      React.createElement(
        Text,
        { dimColor: true },
        `${filteredMessages.length} result${filteredMessages.length !== 1 ? 's' : ''}`
      )
    )
  );
}

export default SearchPanel;
