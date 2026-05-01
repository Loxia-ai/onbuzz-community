/**
 * InputBox Component
 * Text input for sending messages with command history
 */

import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { debugLog } from '../utils/debugLogger.js';

const MAX_HISTORY = 100; // Maximum number of commands to remember

export function InputBox({ onSubmit, disabled = false, placeholder = 'Type a message...' }) {
  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef([]);
  const tempInputRef = useRef('');

  useInput((char, key) => {
    if (disabled) return;

    // Submit on Enter
    if (key.return) {
      // Capture input value IMMEDIATELY before any operations
      const currentInput = input;
      const trimmedInput = currentInput.trim();

      // DEBUG: Log captured values
      debugLog('InputBox', 'ENTER pressed - input state:', input);
      debugLog('InputBox', 'currentInput:', currentInput);
      debugLog('InputBox', 'trimmedInput:', trimmedInput);
      debugLog('InputBox', `trimmedInput type: ${typeof trimmedInput}, truthy: ${!!trimmedInput}`);

      // Only proceed if we have actual content
      if (!trimmedInput) {
        debugLog('InputBox', 'BLOCKED: trimmedInput is falsy, returning early');
        return;
      }

      // Add to history (avoid duplicates of last command)
      if (historyRef.current[historyRef.current.length - 1] !== trimmedInput) {
        historyRef.current.push(trimmedInput);

        // Limit history size
        if (historyRef.current.length > MAX_HISTORY) {
          historyRef.current.shift();
        }
      }

      // Call onSubmit BEFORE clearing to ensure value is captured
      debugLog('InputBox', 'Calling onSubmit with:', trimmedInput);
      onSubmit(trimmedInput);

      // Clear input only after onSubmit is called
      setInput('');
      setHistoryIndex(-1);
      tempInputRef.current = '';
    }
    // Navigate up in history
    else if (key.upArrow) {
      if (historyRef.current.length === 0) return;

      // Store current input before navigating
      if (historyIndex === -1) {
        tempInputRef.current = input;
      }

      const newIndex = Math.min(historyIndex + 1, historyRef.current.length - 1);
      setHistoryIndex(newIndex);

      // Get command from history (newest to oldest)
      const historyCommand = historyRef.current[historyRef.current.length - 1 - newIndex];
      setInput(historyCommand || '');
    }
    // Navigate down in history
    else if (key.downArrow) {
      if (historyIndex === -1) return;

      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);

      if (newIndex === -1) {
        // Restore the input we had before navigating history
        setInput(tempInputRef.current);
      } else {
        const historyCommand = historyRef.current[historyRef.current.length - 1 - newIndex];
        setInput(historyCommand || '');
      }
    }
    // Backspace/Delete
    else if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
      // Exit history mode when editing
      if (historyIndex !== -1) {
        setHistoryIndex(-1);
        tempInputRef.current = '';
      }
    }
    // Regular character input
    else if (char && !key.ctrl && !key.meta) {
      setInput(prev => prev + char);
      // Exit history mode when typing
      if (historyIndex !== -1) {
        setHistoryIndex(-1);
        tempInputRef.current = '';
      }
    }
  });

  const displayText = disabled ? placeholder : '> ' + input + String.fromCharCode(0x2588);

  return React.createElement(
    Box,
    { borderStyle: 'round', borderColor: disabled ? 'gray' : 'green', paddingX: 1 },
    React.createElement(Text, { dimColor: disabled }, displayText)
  );
}

export default InputBox;
