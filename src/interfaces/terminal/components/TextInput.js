/**
 * TextInput Component
 * Editable text input with optional masking for API keys
 * Features: Enter to edit, Esc to cancel, masked display (••••)
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * TextInput Component
 * @param {Object} props
 * @param {string} props.value - Current value
 * @param {string} props.label - Field label
 * @param {Function} props.onChange - Called when value changes
 * @param {boolean} props.masked - Whether to mask the input (for passwords/API keys)
 * @param {boolean} props.focused - Whether this input is focused
 * @param {string} props.placeholder - Placeholder text when empty
 */
export function TextInput({
  value = '',
  label = '',
  onChange,
  masked = false,
  focused = false,
  placeholder = 'Press Enter to edit...'
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  // Update editValue when value prop changes
  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useInput((char, key) => {
    // Only handle input if this component is focused
    if (!focused) return;

    if (isEditing) {
      // Editing mode
      if (key.return) {
        // Save and exit editing
        onChange(editValue);
        setIsEditing(false);
      } else if (key.escape) {
        // Cancel editing
        setEditValue(value);
        setIsEditing(false);
      } else if (key.backspace || key.delete) {
        // Delete character
        setEditValue(prev => prev.slice(0, -1));
      } else if (char && !key.ctrl && !key.meta) {
        // Add character
        setEditValue(prev => prev + char);
      }
    } else {
      // Not editing - enter to start editing
      if (key.return) {
        setIsEditing(true);
      }
    }
  }, { isActive: focused });

  // Display value (masked or plain)
  const displayValue = () => {
    if (isEditing) {
      // Show cursor in editing mode
      return masked
        ? '•'.repeat(editValue.length) + '_'
        : editValue + '_';
    } else {
      // Show masked or plain value
      if (!value || value.length === 0) {
        return placeholder;
      }
      return masked ? '•'.repeat(value.length) : value;
    }
  };

  const valueColor = () => {
    if (isEditing) return 'yellow';
    if (!value || value.length === 0) return 'gray';
    return 'cyan';
  };

  return React.createElement(
    Box,
    {
      borderStyle: 'round',
      borderColor: focused ? (isEditing ? 'yellow' : 'cyan') : 'gray',
      paddingX: 1,
      width: '100%',
      marginBottom: 0,
    },
    React.createElement(
      Box,
      { flexDirection: 'column' },
      // Label
      React.createElement(
        Text,
        {
          color: focused ? 'cyan' : 'gray',
          dimColor: !focused,
          bold: focused,
        },
        label
      ),
      // Value
      React.createElement(
        Text,
        { color: valueColor() },
        displayValue()
      ),
      // Help text when focused
      focused && React.createElement(
        Text,
        { dimColor: true, marginTop: 0 },
        isEditing
          ? '↵ Save  Esc: Cancel  ← Delete'
          : '↵ Edit  ↑↓ Navigate'
      )
    )
  );
}

export default TextInput;
