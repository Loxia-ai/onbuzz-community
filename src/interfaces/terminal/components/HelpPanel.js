/**
 * HelpPanel Component
 * Context-sensitive help overlay with keyboard shortcuts
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

const SHORTCUTS = {
  'Navigation': [
    { key: '↑/↓', description: 'Navigate messages' },
    { key: 'Ctrl+S', description: 'Switch agent' },
    { key: 'Ctrl+F', description: 'Search messages' },
  ],
  'Agent Management': [
    { key: 'Ctrl+N', description: 'Create new agent' },
    { key: 'Ctrl+E', description: 'Edit agent (in switcher)' },
    { key: 'Ctrl+D or Del', description: 'Delete agent (in switcher)' },
    { key: 'Ctrl+A', description: 'Reload agents list' },
  ],
  'Connection': [
    { key: 'Ctrl+R', description: 'Reconnect to server' },
    { key: 'Ctrl+L', description: 'Clear messages' },
    { key: 'Ctrl+T', description: 'Reload tools' },
  ],
  'Settings & Help': [
    { key: 'Alt+S', description: 'Open settings' },
    { key: 'Alt+H', description: 'Show this help' },
  ],
  'Input': [
    { key: 'Enter', description: 'Send message' },
    { key: '↑/↓', description: 'Navigate command history' },
    { key: 'Esc', description: 'Close overlays' },
  ],
};

const TIPS = [
  'Use Tab in settings to switch between categories',
  'Search supports fuzzy matching and filtering by role',
  'Agent switcher sorts by recent activity',
  'Command history saves your last 100 commands',
  'Press Space to toggle boolean settings',
  'Use ←/→ to change numeric and select settings',
];

/**
 * HelpPanel Component
 * @param {Object} props
 * @param {Function} props.onClose - Called when help is closed
 * @param {Number} props.terminalHeight - Terminal height for fullscreen rendering
 * @param {Number} props.terminalWidth - Terminal width for fullscreen rendering
 */
export function HelpPanel({ onClose, terminalHeight = 24, terminalWidth = 80 }) {
  const [selectedCategory, setSelectedCategory] = useState(0);
  const [tipStartIndex, setTipStartIndex] = useState(0);
  const categories = Object.keys(SHORTCUTS);

  // Cycle tips every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setTipStartIndex(prev => (prev + 3) % TIPS.length);
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Handle keyboard input
  useInput((char, key) => {
    // Close on Escape
    if (key.escape) {
      onClose();
      return;
    }

    // Navigate categories with Tab or Left/Right
    if (key.tab && !key.shift) {
      setSelectedCategory(prev => (prev + 1) % categories.length);
    } else if (key.tab && key.shift) {
      setSelectedCategory(prev => (prev - 1 + categories.length) % categories.length);
    } else if (key.leftArrow) {
      setSelectedCategory(prev => Math.max(0, prev - 1));
    } else if (key.rightArrow) {
      setSelectedCategory(prev => Math.min(categories.length - 1, prev + 1));
    }
    // Close on Enter or h
    else if (key.return || char === 'h') {
      onClose();
    }
  });

  // Render category tabs
  const renderTabs = () => {
    return React.createElement(
      Box,
      { marginBottom: 1 },
      categories.map((category, index) =>
        React.createElement(
          Box,
          { key: category, marginRight: 1 },
          React.createElement(
            Text,
            {
              backgroundColor: index === selectedCategory ? 'cyan' : undefined,
              color: index === selectedCategory ? 'black' : 'cyan',
              bold: index === selectedCategory,
            },
            ` ${category} `
          )
        )
      )
    );
  };

  // Render shortcuts for selected category
  const renderShortcuts = () => {
    const categoryName = categories[selectedCategory];
    const shortcuts = SHORTCUTS[categoryName];

    return React.createElement(
      Box,
      { flexDirection: 'column', marginBottom: 1 },
      React.createElement(
        Text,
        { bold: true, color: 'cyan', marginBottom: 1 },
        categoryName
      ),
      shortcuts.map((shortcut, index) =>
        React.createElement(
          Box,
          { key: index, marginBottom: 0 },
          React.createElement(
            Text,
            { color: 'yellow', bold: true },
            shortcut.key.padEnd(20)
          ),
          React.createElement(
            Text,
            {},
            shortcut.description
          )
        )
      )
    );
  };

  // Render tips section
  const renderTips = () => {
    // Show 3 tips starting from tipStartIndex, cycling through all tips
    const selectedTips = [];
    for (let i = 0; i < 3; i++) {
      selectedTips.push(TIPS[(tipStartIndex + i) % TIPS.length]);
    }

    return React.createElement(
      Box,
      { flexDirection: 'column', marginTop: 1, marginBottom: 1 },
      React.createElement(
        Text,
        { bold: true, color: 'green' },
        'Tips:'
      ),
      selectedTips.map((tip, index) =>
        React.createElement(
          Box,
          { key: index, marginTop: 0 },
          React.createElement(Text, { dimColor: true }, '• '),
          React.createElement(Text, { dimColor: true }, tip)
        )
      )
    );
  };

  // Fullscreen container with centered dialog
  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      width: terminalWidth,
      height: terminalHeight,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'black',
    },
    // Dialog box (centered)
    React.createElement(
      Box,
      {
        flexDirection: 'column',
        width: 70,
        height: 22,
        borderStyle: 'round',
        borderColor: 'cyan',
        backgroundColor: 'black',
        paddingX: 2,
        paddingY: 1,
      },
      // Title
      React.createElement(
        Box,
        { marginBottom: 1 },
        React.createElement(Text, { bold: true, color: 'cyan' }, 'Keyboard Shortcuts & Help')
      ),

      // Category tabs
      renderTabs(),

      // Shortcuts list
      React.createElement(
        Box,
        { flexDirection: 'column', flexGrow: 1 },
        renderShortcuts()
      ),

      // Tips
      renderTips(),

      // Help text
      React.createElement(
        Box,
        { borderTop: true, borderStyle: 'single', paddingTop: 1 },
        React.createElement(
          Text,
          { dimColor: true },
          'Tab: Next category  Enter/Esc: Close'
        )
      )
    )
  );
}

export default HelpPanel;
