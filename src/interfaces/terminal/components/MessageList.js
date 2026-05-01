/**
 * MessageList Component
 * Displays chat messages with scrolling
 * Supports compact mode for small terminals
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { debugLog } from '../utils/debugLogger.js';
import { getTheme } from '../utils/theme.js';

/**
 * Format timestamp for display
 * @param {string|number|Date} timestamp - Timestamp to format
 * @returns {string} Formatted timestamp string
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

export function MessageList({
  messages = [],
  loading = false,
  error = null,
  onError,
  compactMode = false,
  currentAgent = null,
  isConnected = false,
  terminalHeight = 24,
  terminalWidth = 80,
  showTimestamps = true,
  colorScheme = 'default',
}) {
  // Get theme colors based on color scheme
  const theme = getTheme(colorScheme);

  // LINE-based scrolling (not message-based)
  // scrollLineOffset = how many lines from the END to skip (0 = showing latest lines)
  const [scrollLineOffset, setScrollLineOffset] = useState(0);
  const prevMessagesLength = useRef(messages.length);

  // Store terminal height to prevent recalculation
  const [viewportHeight] = useState(terminalHeight);

  // Don't display errors inline - they go to ErrorPanel via onError callback
  // Use useEffect to avoid calling setState during render
  useEffect(() => {
    if (error && onError) {
      onError(error);
    }
  }, [error, onError]);

  // Calculate available height for messages (ONCE on mount, stored in viewportHeight)
  // Terminal layout: Header (3 rows) + MessageList + InputBox (3 rows) + StatusBar (1 row)
  // In compact mode: MessageList (compact header 1 row) + InputBox (3 rows)
  const headerHeight = compactMode ? 1 : 3; // Compact header or full header
  const inputHeight = 3; // Input box with border
  const statusBarHeight = compactMode ? 0 : 1; // Status bar (hidden in compact)
  const borderPadding = 2; // Top and bottom borders + padding of MessageList box

  const availableHeight = Math.max(
    5, // Minimum 5 rows for messages
    viewportHeight - headerHeight - inputHeight - statusBarHeight - borderPadding
  );

  // Account for scroll indicators and compact header
  const reservedRows = (compactMode && currentAgent ? 1 : 0) +
                       (messages.length > 0 ? 2 : 0); // 2 for scroll indicators

  const availableRowsForMessages = Math.max(4, availableHeight - reservedRows);

  // Flatten all messages into individual line objects
  // Each line knows which message it belongs to and what content to render
  const allLines = [];

  messages.forEach((msg, msgIndex) => {
    // Header line (timestamp + role)
    allLines.push({
      type: 'header',
      messageId: msg.id,
      messageIndex: msgIndex,
      role: msg.role,
      timestamp: showTimestamps ? msg.timestamp : null,
    });

    // Content lines (split by newline)
    const content = msg.content || msg.text || '';
    const contentLines = content.split('\n');

    contentLines.forEach((line, lineIndex) => {
      allLines.push({
        type: 'content',
        messageId: msg.id,
        messageIndex: msgIndex,
        content: line,
        lineIndex,
      });
    });

    // Spacing line after each message
    allLines.push({
      type: 'spacing',
      messageId: msg.id,
      messageIndex: msgIndex,
    });
  });

  const totalLines = allLines.length;

  // Calculate visible line range based on scroll offset (from end)
  const startLineIndex = Math.max(0, totalLines - availableRowsForMessages - scrollLineOffset);
  const endLineIndex = Math.min(totalLines, startLineIndex + availableRowsForMessages);

  // Get visible lines slice
  const visibleLines = allLines.slice(startLineIndex, endLineIndex);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > prevMessagesLength.current) {
      // New message arrived - scroll to bottom
      setScrollLineOffset(0);
      debugLog('MessageList', `Auto-scrolled to bottom (new message)`);
    }
    prevMessagesLength.current = messages.length;
  }, [messages.length]);

  // Handle keyboard input for scrolling (line-based)
  useInput((char, key) => {
    const maxLineScroll = Math.max(0, totalLines - availableRowsForMessages);
    const pageSize = Math.floor(availableRowsForMessages * 0.8); // 80% of viewport for page scroll

    // Scroll UP (toward older messages) with PageUp or Ctrl+Up
    if (key.pageUp || (key.upArrow && key.ctrl)) {
      setScrollLineOffset(prev => {
        const newOffset = Math.min(maxLineScroll, prev + pageSize);
        debugLog('MessageList', `Scroll up (older), new line offset: ${newOffset}`);
        return newOffset;
      });
      return;
    }

    // Scroll DOWN (toward newer messages) with PageDown or Ctrl+Down
    if (key.pageDown || (key.downArrow && key.ctrl)) {
      setScrollLineOffset(prev => {
        const newOffset = Math.max(0, prev - pageSize);
        debugLog('MessageList', `Scroll down (newer), new line offset: ${newOffset}`);
        return newOffset;
      });
      return;
    }

    // Jump to bottom (newest messages) with End
    if (key.end) {
      setScrollLineOffset(0);
      debugLog('MessageList', 'Jump to bottom (newest)');
      return;
    }

    // Jump to top (oldest messages) with Home
    if (key.home) {
      setScrollLineOffset(maxLineScroll);
      debugLog('MessageList', 'Jump to top (oldest)');
      return;
    }
  });

  // Scroll indicators (line-based)
  const hasOlderMessages = startLineIndex > 0;
  const hasNewerMessages = scrollLineOffset > 0;
  const olderLinesCount = startLineIndex;
  const newerLinesCount = scrollLineOffset;

  if (loading && messages.length === 0) {
    return React.createElement(
      Box,
      {
        height: availableHeight,
        padding: 1,
        borderStyle: 'round',
        borderColor: theme.borderLoading,
        flexDirection: 'column'
      },
      compactMode && currentAgent && React.createElement(
        Box,
        { marginBottom: 1, justifyContent: 'space-between', flexDirection: 'row' },
        React.createElement(Text, { bold: true, color: theme.secondary }, currentAgent.name),
        React.createElement(Text, { color: isConnected ? theme.success : theme.error }, isConnected ? '● Connected' : '● Disconnected')
      ),
      React.createElement(Text, { color: theme.warning }, 'Loading messages...')
    );
  }

  return React.createElement(
    Box,
    {
      height: availableHeight,
      padding: 1,
      borderStyle: 'round',
      borderColor: theme.border,
      flexDirection: 'column'
    },
    // Show compact header in compact mode
    compactMode && currentAgent && React.createElement(
      Box,
      { marginBottom: 1, justifyContent: 'space-between', flexDirection: 'row' },
      React.createElement(Text, { bold: true, color: theme.secondary }, currentAgent.name),
      React.createElement(Text, { color: isConnected ? theme.success : theme.error }, isConnected ? '●' : '●')
    ),

    // Scroll indicator - older messages above
    hasOlderMessages && React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(
        Text,
        { color: theme.dim, italic: true },
        `▲ ${olderLinesCount} more lines above (PgUp/Home to scroll)`
      )
    ),

    // Message list (line-based rendering)
    messages.length === 0
      ? React.createElement(Text, { color: theme.dim }, 'No messages yet. Start chatting!')
      : React.createElement(
          Box,
          { flexDirection: 'column' },
          visibleLines.map((line, idx) => {
            if (line.type === 'header') {
              // Render header line (timestamp + role)
              return React.createElement(
                Box,
                { key: `${line.messageId}-header`, flexDirection: 'row' },
                line.timestamp && React.createElement(
                  Text,
                  { color: theme.dim },
                  '[' + formatTimestamp(line.timestamp) + '] '
                ),
                React.createElement(
                  Text,
                  { bold: true, color: line.role === 'user' ? theme.success : theme.secondary },
                  '[' + line.role + ']: '
                )
              );
            } else if (line.type === 'content') {
              // Render content line
              return React.createElement(
                Box,
                { key: `${line.messageId}-content-${line.lineIndex}` },
                React.createElement(Text, { color: theme.primary }, line.content)
              );
            } else if (line.type === 'spacing') {
              // Render spacing line
              return React.createElement(Box, { key: `${line.messageId}-spacing`, height: 1 });
            }
            return null;
          })
        ),

    // Scroll indicator - newer messages below
    hasNewerMessages && React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(
        Text,
        { color: theme.dim, italic: true },
        `▼ ${newerLinesCount} more lines below (PgDn/End to scroll)`
      )
    )
  );
}

export default MessageList;
