/**
 * ErrorPanel Component
 * Displays error log in an overlay panel
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * Format timestamp for error entry
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * ErrorPanel Component
 * @param {Object} props
 * @param {Array} props.errors - Array of error objects { timestamp, type, message, stack, id }
 * @param {Function} props.onClose - Called when panel is closed
 * @param {Function} props.onClear - Called to clear all errors
 * @param {Function} props.onDismiss - Called to dismiss a single error by index
 * @param {number} props.terminalHeight - Terminal height for fullscreen rendering
 * @param {number} props.terminalWidth - Terminal width for fullscreen rendering
 */
export function ErrorPanel({ errors = [], onClose, onClear, onDismiss, terminalHeight = 24, terminalWidth = 80 }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'detail'

  const MAX_VISIBLE_ITEMS = 8;

  useInput((char, key) => {
    // Close on Escape
    if (key.escape) {
      onClose();
      return;
    }

    // View mode: list
    if (viewMode === 'list') {
      // Toggle detail view on Enter
      if (key.return && errors.length > 0) {
        setViewMode('detail');
        return;
      }

      // Navigate with arrow keys
      if (key.upArrow && errors.length > 0) {
        setSelectedIndex(prev => {
          const newIndex = Math.max(0, prev - 1);
          if (newIndex < scrollOffset) {
            setScrollOffset(newIndex);
          }
          return newIndex;
        });
      } else if (key.downArrow && errors.length > 0) {
        setSelectedIndex(prev => {
          const newIndex = Math.min(errors.length - 1, prev + 1);
          if (newIndex >= scrollOffset + MAX_VISIBLE_ITEMS) {
            setScrollOffset(newIndex - MAX_VISIBLE_ITEMS + 1);
          }
          return newIndex;
        });
      }

      // Clear all errors on 'c'
      if (char === 'c' && errors.length > 0) {
        onClear();
      }

      // Dismiss selected error on 'd' or Delete
      if ((char === 'd' || key.delete) && errors.length > 0 && onDismiss) {
        onDismiss(selectedIndex);
        // Adjust selected index if needed
        if (selectedIndex >= errors.length - 1 && selectedIndex > 0) {
          setSelectedIndex(prev => prev - 1);
        }
        if (scrollOffset >= errors.length - MAX_VISIBLE_ITEMS && scrollOffset > 0) {
          setScrollOffset(prev => Math.max(0, prev - 1));
        }
      }
    }

    // View mode: detail
    if (viewMode === 'detail') {
      // Back to list on Escape or Backspace
      if (key.backspace) {
        setViewMode('list');
        return;
      }

      // Dismiss error from detail view on 'd' or Delete
      if ((char === 'd' || key.delete) && onDismiss) {
        onDismiss(selectedIndex);
        setViewMode('list');
        // Adjust selected index if needed
        if (selectedIndex >= errors.length - 1 && selectedIndex > 0) {
          setSelectedIndex(prev => prev - 1);
        }
      }
    }
  });

  // Render list view
  const renderListView = () => {
    if (errors.length === 0) {
      return React.createElement(
        Box,
        { flexDirection: 'column', paddingY: 2 },
        React.createElement(Text, { color: 'green' }, '✓ No errors'),
        React.createElement(Text, { dimColor: true, marginTop: 1 }, 'All systems operational')
      );
    }

    return React.createElement(
      Box,
      { flexDirection: 'column' },
      // Error list
      errors.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS).map((error, visibleIndex) => {
        const actualIndex = scrollOffset + visibleIndex;
        const isSelected = actualIndex === selectedIndex;

        return React.createElement(
          Box,
          { key: actualIndex, marginBottom: 1 },
          React.createElement(
            Text,
            {
              backgroundColor: isSelected ? 'red' : undefined,
              color: isSelected ? 'white' : 'red',
            },
            isSelected ? '> ' : '  ',
            `[${formatTimestamp(error.timestamp)}] ${error.type || 'ERROR'}`
          ),
          React.createElement(
            Box,
            { paddingLeft: 4 },
            React.createElement(
              Text,
              { dimColor: !isSelected },
              error.message.substring(0, 60) + (error.message.length > 60 ? '...' : '')
            )
          )
        );
      }),

      // Scroll indicator
      errors.length > MAX_VISIBLE_ITEMS &&
        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(
            Text,
            { dimColor: true },
            `Showing ${scrollOffset + 1}-${Math.min(scrollOffset + MAX_VISIBLE_ITEMS, errors.length)} of ${errors.length}`
          )
        )
    );
  };

  // Render detail view
  const renderDetailView = () => {
    if (errors.length === 0) {
      return renderListView();
    }

    const error = errors[selectedIndex];

    return React.createElement(
      Box,
      { flexDirection: 'column', paddingY: 1 },
      // Error header
      React.createElement(
        Box,
        { marginBottom: 1 },
        React.createElement(Text, { bold: true, color: 'red' }, `${error.type || 'ERROR'} at ${formatTimestamp(error.timestamp)}`)
      ),

      // Error message
      React.createElement(
        Box,
        { flexDirection: 'column', marginBottom: 1 },
        React.createElement(Text, { bold: true }, 'Message:'),
        React.createElement(Text, {}, error.message)
      ),

      // Stack trace (if available)
      error.stack &&
        React.createElement(
          Box,
          { flexDirection: 'column' },
          React.createElement(Text, { bold: true }, 'Stack Trace:'),
          React.createElement(
            Text,
            { dimColor: true },
            error.stack.split('\n').slice(0, 5).join('\n') + (error.stack.split('\n').length > 5 ? '\n...' : '')
          )
        )
    );
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
        width: '85%',
        borderStyle: 'double',
        borderColor: errors.length > 0 ? 'red' : 'green',
        backgroundColor: 'black',
        paddingX: 2,
        paddingY: 1,
      },
      // Title
      React.createElement(
        Box,
        { marginBottom: 1 },
        React.createElement(
          Text,
          { bold: true, color: errors.length > 0 ? 'red' : 'green' },
          `Error Log (${errors.length} errors)`
        )
      ),

      // Content
      React.createElement(
        Box,
        { flexDirection: 'column', flexGrow: 1 },
        viewMode === 'list' ? renderListView() : renderDetailView()
      ),

      // Footer
      React.createElement(
        Box,
        { marginTop: 1, borderTop: true, borderStyle: 'single', paddingTop: 1 },
        React.createElement(
          Text,
          { dimColor: true },
          viewMode === 'list'
            ? errors.length > 0
              ? 'Enter: Details  D: Dismiss  C: Clear All  Esc: Close'
              : 'Esc: Close'
            : 'D: Dismiss  Backspace: Back  Esc: Close'
        )
      )
    )
  );
}

export default ErrorPanel;
