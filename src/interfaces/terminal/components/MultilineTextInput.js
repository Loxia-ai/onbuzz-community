/**
 * MultilineTextInput Component
 * Editable multi-line text area for terminal UI
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

const CURSOR_BLINK_INTERVAL = 500; // milliseconds

/**
 * MultilineTextInput Component
 * @param {Object} props
 * @param {string} props.value - Current text value
 * @param {Function} props.onChange - Called when text changes
 * @param {string} props.label - Input label
 * @param {string} props.placeholder - Placeholder text
 * @param {boolean} props.focused - Whether this input is focused
 * @param {number} props.minHeight - Minimum height in lines
 * @param {number} props.maxHeight - Maximum height in lines
 * @param {number} props.width - Width of the text area
 * @param {string} props.borderColor - Border color
 */
export function MultilineTextInput({
  value = '',
  onChange,
  label = '',
  placeholder = '',
  focused = false,
  minHeight = 5,
  maxHeight = 15,
  width = 60,
  borderColor = 'cyan',
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [cursorPos, setCursorPos] = useState(0);

  // Sync with external value when not editing
  useEffect(() => {
    if (!isEditing) {
      setLocalValue(value);
      setCursorPos(value.length);
    }
  }, [value, isEditing]);

  // Cursor blinking
  useEffect(() => {
    if (!isEditing || !focused) {
      setCursorVisible(true);
      return;
    }

    const interval = setInterval(() => {
      setCursorVisible(prev => !prev);
    }, CURSOR_BLINK_INTERVAL);

    return () => clearInterval(interval);
  }, [isEditing, focused]);

  // Handle keyboard input
  useInput((char, key) => {
    if (!focused) return;

    // Enter edit mode on Enter key
    if (key.return && !isEditing) {
      setIsEditing(true);
      return;
    }

    // Exit edit mode on Escape
    if (key.escape && isEditing) {
      setIsEditing(false);
      setLocalValue(value); // Reset to original value
      setCursorPos(value.length);
      return;
    }

    // Save on Ctrl+S (handled by parent, but exit edit mode)
    if (key.ctrl && char === 's' && isEditing) {
      setIsEditing(false);
      onChange(localValue);
      return;
    }

    // Only process input when editing
    if (!isEditing) return;

    // Handle character input
    if (char && !key.ctrl && !key.meta) {
      const before = localValue.substring(0, cursorPos);
      const after = localValue.substring(cursorPos);
      const newValue = before + char + after;
      setLocalValue(newValue);
      setCursorPos(cursorPos + 1);
      onChange(newValue);
      return;
    }

    // Handle newline
    if (key.return) {
      const before = localValue.substring(0, cursorPos);
      const after = localValue.substring(cursorPos);
      const newValue = before + '\n' + after;
      setLocalValue(newValue);
      setCursorPos(cursorPos + 1);
      onChange(newValue);
      return;
    }

    // Handle backspace
    if (key.backspace && cursorPos > 0) {
      const before = localValue.substring(0, cursorPos - 1);
      const after = localValue.substring(cursorPos);
      const newValue = before + after;
      setLocalValue(newValue);
      setCursorPos(cursorPos - 1);
      onChange(newValue);
      return;
    }

    // Handle delete
    if (key.delete && cursorPos < localValue.length) {
      const before = localValue.substring(0, cursorPos);
      const after = localValue.substring(cursorPos + 1);
      const newValue = before + after;
      setLocalValue(newValue);
      onChange(newValue);
      return;
    }

    // Handle arrow keys for cursor movement
    if (key.leftArrow && cursorPos > 0) {
      setCursorPos(cursorPos - 1);
      return;
    }

    if (key.rightArrow && cursorPos < localValue.length) {
      setCursorPos(cursorPos + 1);
      return;
    }

    // Home - move to start of current line
    if (key.home) {
      const lines = localValue.substring(0, cursorPos).split('\n');
      const currentLineStart = cursorPos - lines[lines.length - 1].length;
      setCursorPos(currentLineStart);
      return;
    }

    // End - move to end of current line
    if (key.end) {
      const afterCursor = localValue.substring(cursorPos);
      const nextNewline = afterCursor.indexOf('\n');
      if (nextNewline === -1) {
        setCursorPos(localValue.length);
      } else {
        setCursorPos(cursorPos + nextNewline);
      }
      return;
    }
  });

  // Split text into lines for rendering
  const displayValue = localValue || (isEditing ? '' : placeholder);
  const lines = displayValue.split('\n');

  // Calculate visible line range
  const visibleLines = lines.slice(0, maxHeight);
  const actualHeight = Math.max(minHeight, Math.min(maxHeight, lines.length));

  // Render cursor at correct position if editing
  const renderLinesWithCursor = () => {
    if (!isEditing || !focused) {
      return visibleLines.map((line, index) =>
        React.createElement(
          Text,
          { key: index, color: localValue ? 'white' : 'gray', dimColor: !localValue },
          line || ' '
        )
      );
    }

    // Find which line the cursor is on
    let charCount = 0;
    return visibleLines.map((line, lineIndex) => {
      const lineStart = charCount;
      const lineEnd = charCount + line.length;
      const hasNewline = lineIndex < lines.length - 1;

      const cursorInThisLine = cursorPos >= lineStart && cursorPos <= lineEnd + (hasNewline ? 1 : 0);

      charCount = lineEnd + (hasNewline ? 1 : 0);

      if (cursorInThisLine) {
        const posInLine = cursorPos - lineStart;
        const before = line.substring(0, posInLine);
        const cursorChar = line.charAt(posInLine) || ' ';
        const after = line.substring(posInLine + 1);

        return React.createElement(
          Text,
          { key: lineIndex },
          React.createElement(Text, {}, before),
          cursorVisible
            ? React.createElement(Text, { inverse: true }, cursorChar)
            : React.createElement(Text, {}, cursorChar),
          React.createElement(Text, {}, after)
        );
      }

      return React.createElement(Text, { key: lineIndex }, line || ' ');
    });
  };

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    // Label
    label && React.createElement(
      Text,
      { bold: true, color: focused ? borderColor : 'gray', marginBottom: 1 },
      label
    ),
    // Text area with border
    React.createElement(
      Box,
      {
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: isEditing ? 'yellow' : (focused ? borderColor : 'gray'),
        paddingX: 1,
        paddingY: 0,
        height: actualHeight + 2, // +2 for borders
        width: width,
      },
      ...renderLinesWithCursor()
    ),
    // Help text
    React.createElement(
      Text,
      { dimColor: true, color: 'gray' },
      focused && !isEditing ? 'Press Enter to edit' :
      focused && isEditing ? 'Esc: Cancel  Ctrl+S: Save' :
      ''
    )
  );
}

export default MultilineTextInput;
