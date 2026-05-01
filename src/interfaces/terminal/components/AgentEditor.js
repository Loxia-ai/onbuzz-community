/**
 * AgentEditor Component
 * Full-featured agent editor with validation and API integration
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { MultilineTextInput } from './MultilineTextInput.js';
import {
  EDITOR_CATEGORY,
  CATEGORY_TITLES,
  AGENT_MODE,
  AVAILABLE_TOOLS,
  FIELD_CONFIG,
  UI_CONFIG,
  VALIDATION,
  EDITOR_THEME,
  SHORTCUTS,
  MESSAGES,
} from '../config/agentEditorConstants.js';

/**
 * AgentEditor Component
 * @param {Object} props
 * @param {Object} props.agent - Agent to edit
 * @param {Function} props.onSave - Called when agent is saved (agentId, updates)
 * @param {Function} props.onClose - Called when editor is closed
 * @param {Array} props.availableModels - List of available AI models
 * @param {number} props.terminalHeight - Terminal height for fullscreen rendering
 * @param {number} props.terminalWidth - Terminal width for fullscreen rendering
 */
export function AgentEditor({
  agent,
  onSave,
  onClose,
  availableModels = ['anthropic-sonnet', 'anthropic-haiku', 'gpt-4', 'gpt-4-mini', 'gpt-5.1-codex-mini', 'deepseek-r1', 'phi-4', 'phi-4-reasoning'],
  terminalHeight = 24,
  terminalWidth = 80,
}) {
  // Current category/tab
  const [currentCategory, setCurrentCategory] = useState(EDITOR_CATEGORY.BASIC_INFO);

  // Form data
  const [formData, setFormData] = useState({
    name: agent?.name || '',
    description: agent?.description || '',
    systemPrompt: agent?.systemPrompt || '',
    mode: agent?.mode || AGENT_MODE.CHAT,
    capabilities: agent?.capabilities || [],
    preferredModel: agent?.preferredModel || availableModels[0],
    dynamicModelRouting: agent?.dynamicModelRouting ?? true,
    routingStrategy: agent?.routingStrategy || '',
    temperature: agent?.temperature ?? FIELD_CONFIG.TEMPERATURE.default,
    maxTokens: agent?.maxTokens ?? FIELD_CONFIG.MAX_TOKENS.default,
  });

  // Current focused field within category
  const [focusedField, setFocusedField] = useState(0);

  // Validation errors
  const [errors, setErrors] = useState({});

  // Feedback message
  const [feedback, setFeedback] = useState(null);
  const [feedbackType, setFeedbackType] = useState(null); // 'success' | 'error' | 'warning'

  // Loading state
  const [saving, setSaving] = useState(false);

  // Track if there are unsaved changes
  const [hasChanges, setHasChanges] = useState(false);

  // Calculate dialog dimensions
  const dialogWidth = Math.min(
    UI_CONFIG.MAX_DIALOG_WIDTH,
    Math.max(UI_CONFIG.MIN_DIALOG_WIDTH, Math.floor(terminalWidth * UI_CONFIG.DIALOG_WIDTH_RATIO))
  );
  const dialogHeight = Math.min(
    UI_CONFIG.MAX_DIALOG_HEIGHT,
    Math.max(UI_CONFIG.MIN_DIALOG_HEIGHT, Math.floor(terminalHeight * UI_CONFIG.DIALOG_HEIGHT_RATIO))
  );

  // Define fields per category
  const categoryFields = {
    [EDITOR_CATEGORY.BASIC_INFO]: ['name', 'description', 'mode'],
    [EDITOR_CATEGORY.SYSTEM_PROMPT]: ['systemPrompt'],
    [EDITOR_CATEGORY.CAPABILITIES]: ['capabilities'],
    [EDITOR_CATEGORY.CONFIGURATION]: ['preferredModel', 'dynamicModelRouting', 'routingStrategy', 'temperature', 'maxTokens'],
  };

  const currentFields = categoryFields[currentCategory] || [];

  /**
   * Validate a single field
   */
  const validateField = useCallback((fieldName, value) => {
    const config = FIELD_CONFIG[fieldName.toUpperCase()];
    if (!config) return null;

    // Required field check
    if (config.required && !value) {
      return MESSAGES.REQUIRED_FIELD;
    }

    // Min length check
    if (config.minLength && value.length < config.minLength) {
      return MESSAGES.MIN_LENGTH.replace('{min}', config.minLength);
    }

    // Max length check
    if (config.maxLength && value.length > config.maxLength) {
      return MESSAGES.MAX_LENGTH.replace('{max}', config.maxLength);
    }

    return null;
  }, []);

  /**
   * Validate all fields
   */
  const validateAll = useCallback(() => {
    const newErrors = {};

    Object.keys(formData).forEach((fieldName) => {
      const error = validateField(fieldName, formData[fieldName]);
      if (error) {
        newErrors[fieldName] = error;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, validateField]);

  /**
   * Update a field value
   */
  const updateField = useCallback((fieldName, value) => {
    setFormData((prev) => ({
      ...prev,
      [fieldName]: value,
    }));

    // Clear error for this field
    setErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[fieldName];
      return newErrors;
    });

    // Mark as changed
    setHasChanges(true);

    // Clear feedback
    setFeedback(null);
  }, []);

  /**
   * Save changes
   */
  const handleSave = useCallback(async () => {
    // Validate first
    if (!validateAll()) {
      setFeedback(MESSAGES.VALIDATION_ERROR);
      setFeedbackType('error');
      return;
    }

    // Check if there are changes
    if (!hasChanges) {
      setFeedback(MESSAGES.NO_CHANGES);
      setFeedbackType('warning');
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      // Call parent save handler
      await onSave(agent.agentId, formData);

      setFeedback(MESSAGES.SAVE_SUCCESS);
      setFeedbackType('success');
      setHasChanges(false);

      // Close editor after brief delay
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (error) {
      setFeedback(`${MESSAGES.SAVE_ERROR}: ${error.message}`);
      setFeedbackType('error');
    } finally {
      setSaving(false);
    }
  }, [validateAll, hasChanges, onSave, agent, formData, onClose]);

  /**
   * Handle keyboard input
   */
  useInput((char, key) => {
    // Save with Ctrl+S
    if (key.ctrl && char === 's') {
      handleSave();
      return;
    }

    // Close with Escape (warn if unsaved changes)
    if (key.escape) {
      if (hasChanges) {
        setFeedback('You have unsaved changes! Press Ctrl+S to save or Esc again to discard.');
        setFeedbackType('warning');
        // Allow second Esc to force close
        setTimeout(() => setFeedback(null), 3000);
      } else {
        onClose();
      }
      return;
    }

    // Category navigation with Tab/Shift+Tab (when no fields in current category)
    // OR when at first/last field
    if (key.tab && !key.shift) {
      if (currentFields.length === 0 || focusedField === currentFields.length - 1) {
        // Move to next category
        const nextCategory = (currentCategory + 1) % CATEGORY_TITLES.length;
        setCurrentCategory(nextCategory);
        setFocusedField(0);
        return;
      } else {
        // Move to next field in current category
        setFocusedField(focusedField + 1);
        return;
      }
    }

    if (key.tab && key.shift) {
      if (currentFields.length === 0 || focusedField === 0) {
        // Move to previous category
        const prevCategory = currentCategory === 0 ? CATEGORY_TITLES.length - 1 : currentCategory - 1;
        setCurrentCategory(prevCategory);
        // Focus last field in previous category
        const prevCategoryFields = categoryFields[prevCategory] || [];
        setFocusedField(Math.max(0, prevCategoryFields.length - 1));
        return;
      } else {
        // Move to previous field in current category
        setFocusedField(focusedField - 1);
        return;
      }
    }

    // Field navigation with arrows (when not editing multiline)
    if (key.upArrow) {
      const prevField = focusedField === 0 ? currentFields.length - 1 : focusedField - 1;
      setFocusedField(prevField);
      return;
    }

    if (key.downArrow) {
      const nextField = (focusedField + 1) % currentFields.length;
      setFocusedField(nextField);
      return;
    }

    // Toggle boolean fields with Space
    const currentFieldName = currentFields[focusedField];
    const currentFieldConfig = currentFieldName ? FIELD_CONFIG[currentFieldName.toUpperCase()] : null;

    if (key.space && currentFieldConfig?.type === 'boolean') {
      updateField(currentFieldName, !formData[currentFieldName]);
      return;
    }

    // Cycle select fields with arrows
    if ((key.leftArrow || key.rightArrow) && currentFieldConfig?.type === 'select') {
      const options = currentFieldConfig.options || availableModels;
      const currentIndex = options.indexOf(formData[currentFieldName]);
      let newIndex;

      if (key.rightArrow) {
        newIndex = (currentIndex + 1) % options.length;
      } else {
        newIndex = currentIndex === 0 ? options.length - 1 : currentIndex - 1;
      }

      updateField(currentFieldName, options[newIndex]);
      return;
    }

    // Increment/decrement number fields with arrows
    if ((key.upArrow || key.downArrow) && currentFieldConfig?.type === 'number') {
      const currentValue = formData[currentFieldName];
      const step = currentFieldConfig.step || 1;
      const min = currentFieldConfig.min ?? -Infinity;
      const max = currentFieldConfig.max ?? Infinity;

      let newValue;
      if (key.upArrow) {
        newValue = Math.min(max, currentValue + step);
      } else {
        newValue = Math.max(min, currentValue - step);
      }

      // Round to step precision (for decimal steps like 0.1)
      if (step < 1) {
        const decimals = step.toString().split('.')[1]?.length || 0;
        newValue = parseFloat(newValue.toFixed(decimals));
      }

      updateField(currentFieldName, newValue);
      return;
    }
  });

  /**
   * Render field based on type
   */
  const renderField = (fieldName, index) => {
    const config = FIELD_CONFIG[fieldName.toUpperCase()];
    if (!config) return null;

    // Skip fields whose conditional dependency is not met
    if (config.conditionalOn && !formData[config.conditionalOn]) return null;

    const isFocused = index === focusedField;
    const value = formData[fieldName];
    const error = errors[fieldName];

    // Multiline text input (system prompt)
    if (config.type === 'multiline') {
      return React.createElement(
        Box,
        { key: fieldName, flexDirection: 'column', marginBottom: 1 },
        React.createElement(MultilineTextInput, {
          value: value,
          onChange: (newValue) => updateField(fieldName, newValue),
          label: config.label,
          placeholder: config.placeholder,
          focused: isFocused,
          minHeight: UI_CONFIG.MULTILINE_MIN_HEIGHT,
          maxHeight: UI_CONFIG.MULTILINE_MAX_HEIGHT,
          width: dialogWidth - (UI_CONFIG.PADDING_X * 2) - 4, // Account for borders
          borderColor: error ? EDITOR_THEME.ERROR_COLOR : EDITOR_THEME.BORDER_COLOR,
        }),
        error && React.createElement(
          Text,
          { color: EDITOR_THEME.ERROR_COLOR, marginTop: 1 },
          `⚠ ${error}`
        )
      );
    }

    // Boolean toggle
    if (config.type === 'boolean') {
      return React.createElement(
        Box,
        { key: fieldName, flexDirection: 'column', marginBottom: 1 },
        React.createElement(
          Box,
          { flexDirection: 'row', alignItems: 'center' },
          React.createElement(
            Text,
            {
              color: isFocused ? EDITOR_THEME.TITLE_COLOR : EDITOR_THEME.LABEL_COLOR,
              bold: isFocused,
            },
            config.label.padEnd(UI_CONFIG.LABEL_WIDTH)
          ),
          React.createElement(
            Text,
            {
              backgroundColor: isFocused ? EDITOR_THEME.SELECTED_BG : undefined,
              color: value ? EDITOR_THEME.SUCCESS_COLOR : EDITOR_THEME.DIM_COLOR,
            },
            value ? '[✓] Enabled' : '[ ] Disabled'
          )
        ),
        config.description && React.createElement(
          Text,
          { color: EDITOR_THEME.DIM_COLOR, marginLeft: UI_CONFIG.LABEL_WIDTH },
          config.description
        )
      );
    }

    // Select dropdown
    if (config.type === 'select') {
      const options = config.options || availableModels;
      const descriptions = config.descriptions || {};

      return React.createElement(
        Box,
        { key: fieldName, flexDirection: 'column', marginBottom: 1 },
        React.createElement(
          Box,
          { flexDirection: 'row', alignItems: 'center' },
          React.createElement(
            Text,
            {
              color: isFocused ? EDITOR_THEME.TITLE_COLOR : EDITOR_THEME.LABEL_COLOR,
              bold: isFocused,
            },
            config.label.padEnd(UI_CONFIG.LABEL_WIDTH)
          ),
          React.createElement(
            Text,
            {
              backgroundColor: isFocused ? EDITOR_THEME.SELECTED_BG : undefined,
              color: EDITOR_THEME.VALUE_COLOR,
            },
            `< ${value} >`
          )
        ),
        descriptions[value] && React.createElement(
          Text,
          { color: EDITOR_THEME.DIM_COLOR, marginLeft: UI_CONFIG.LABEL_WIDTH },
          descriptions[value]
        )
      );
    }

    // Number input (increment/decrement with arrows)
    if (config.type === 'number') {
      return React.createElement(
        Box,
        { key: fieldName, flexDirection: 'column', marginBottom: 1 },
        React.createElement(
          Box,
          { flexDirection: 'row', alignItems: 'center' },
          React.createElement(
            Text,
            {
              color: isFocused ? EDITOR_THEME.TITLE_COLOR : EDITOR_THEME.LABEL_COLOR,
              bold: isFocused,
            },
            config.label.padEnd(UI_CONFIG.LABEL_WIDTH)
          ),
          React.createElement(
            Text,
            {
              backgroundColor: isFocused ? EDITOR_THEME.SELECTED_BG : undefined,
              color: EDITOR_THEME.VALUE_COLOR,
            },
            `< ${value} >`
          ),
          React.createElement(
            Text,
            { color: EDITOR_THEME.DIM_COLOR, marginLeft: 1 },
            `(${config.min} - ${config.max})`
          )
        ),
        config.description && React.createElement(
          Text,
          { color: EDITOR_THEME.DIM_COLOR, marginLeft: UI_CONFIG.LABEL_WIDTH },
          config.description
        )
      );
    }

    // Multiselect (tools/capabilities)
    if (config.type === 'multiselect') {
      const options = config.options || AVAILABLE_TOOLS;
      const selectedValues = Array.isArray(value) ? value : [];

      // Display in 2 columns
      const leftColumn = options.slice(0, UI_CONFIG.TOOLS_PER_COLUMN);
      const rightColumn = options.slice(UI_CONFIG.TOOLS_PER_COLUMN);

      return React.createElement(
        Box,
        { key: fieldName, flexDirection: 'column', marginBottom: 1 },
        React.createElement(
          Text,
          {
            color: isFocused ? EDITOR_THEME.TITLE_COLOR : EDITOR_THEME.LABEL_COLOR,
            bold: true,
            marginBottom: 1,
          },
          config.label
        ),
        React.createElement(
          Box,
          { flexDirection: 'row' },
          // Left column
          React.createElement(
            Box,
            { flexDirection: 'column', width: UI_CONFIG.TOOL_COLUMN_WIDTH },
            leftColumn.map((tool, index) => {
              const isEnabled = selectedValues.includes(tool.value);
              return React.createElement(
                Box,
                { key: tool.value, marginBottom: 0 },
                React.createElement(
                  Text,
                  {
                    color: isEnabled ? EDITOR_THEME.TOOL_ENABLED_COLOR : EDITOR_THEME.TOOL_DISABLED_COLOR,
                  },
                  isEnabled ? '[✓] ' : '[ ] '
                ),
                React.createElement(
                  Text,
                  { color: isEnabled ? 'white' : EDITOR_THEME.DIM_COLOR },
                  tool.name
                )
              );
            })
          ),
          // Right column
          React.createElement(
            Box,
            { flexDirection: 'column', width: UI_CONFIG.TOOL_COLUMN_WIDTH },
            rightColumn.map((tool, index) => {
              const isEnabled = selectedValues.includes(tool.value);
              return React.createElement(
                Box,
                { key: tool.value, marginBottom: 0 },
                React.createElement(
                  Text,
                  {
                    color: isEnabled ? EDITOR_THEME.TOOL_ENABLED_COLOR : EDITOR_THEME.TOOL_DISABLED_COLOR,
                  },
                  isEnabled ? '[✓] ' : '[ ] '
                ),
                React.createElement(
                  Text,
                  { color: isEnabled ? 'white' : EDITOR_THEME.DIM_COLOR },
                  tool.name
                )
              );
            })
          )
        ),
        isFocused && React.createElement(
          Text,
          { color: EDITOR_THEME.DIM_COLOR, marginTop: 1 },
          'Note: Tool selection UI coming soon - currently read-only'
        )
      );
    }

    // Simple text input (inline editing not supported - use Enter to edit in future)
    return React.createElement(
      Box,
      { key: fieldName, flexDirection: 'column', marginBottom: 1 },
      React.createElement(
        Box,
        { flexDirection: 'row', alignItems: 'center' },
        React.createElement(
          Text,
          {
            color: isFocused ? EDITOR_THEME.TITLE_COLOR : EDITOR_THEME.LABEL_COLOR,
            bold: isFocused,
          },
          config.label.padEnd(UI_CONFIG.LABEL_WIDTH)
        ),
        React.createElement(
          Text,
          {
            backgroundColor: isFocused ? EDITOR_THEME.SELECTED_BG : undefined,
            color: EDITOR_THEME.VALUE_COLOR,
          },
          value || React.createElement(Text, { dimColor: true }, config.placeholder || '(empty)')
        )
      ),
      error && React.createElement(
        Text,
        { color: EDITOR_THEME.ERROR_COLOR, marginLeft: UI_CONFIG.LABEL_WIDTH },
        `⚠ ${error}`
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
        width: dialogWidth,
        height: dialogHeight,
        borderStyle: 'double',
        borderColor: EDITOR_THEME.BORDER_COLOR,
        backgroundColor: 'black',
        paddingX: UI_CONFIG.PADDING_X,
        paddingY: UI_CONFIG.PADDING_Y,
      },
      // Title
      React.createElement(
        Box,
        { marginBottom: 1, justifyContent: 'space-between' },
        React.createElement(
          Text,
          { bold: true, color: EDITOR_THEME.TITLE_COLOR },
          `Edit Agent: ${agent?.name || 'Unknown'}`
        ),
        hasChanges && React.createElement(
          Text,
          { color: EDITOR_THEME.WARNING_COLOR },
          '● Unsaved'
        )
      ),

      // Category tabs
      React.createElement(
        Box,
        { marginBottom: 1 },
        CATEGORY_TITLES.map((title, index) =>
          React.createElement(
            Box,
            { key: index, marginRight: 1 },
            React.createElement(
              Text,
              {
                backgroundColor: index === currentCategory ? EDITOR_THEME.TAB_ACTIVE_BG : undefined,
                color: index === currentCategory ? EDITOR_THEME.TAB_ACTIVE_FG : EDITOR_THEME.TAB_INACTIVE_FG,
                bold: index === currentCategory,
              },
              ` ${title} `
            )
          )
        )
      ),

      // Field rendering area
      React.createElement(
        Box,
        { flexDirection: 'column', flexGrow: 1, paddingTop: 1 },
        currentFields.length === 0
          ? React.createElement(
              Text,
              { color: EDITOR_THEME.DIM_COLOR },
              'No fields in this category yet.'
            )
          : currentFields.map((fieldName, index) => renderField(fieldName, index))
      ),

      // Feedback message
      feedback && React.createElement(
        Box,
        { marginTop: 1, marginBottom: 1 },
        React.createElement(
          Text,
          {
            color: feedbackType === 'success' ? EDITOR_THEME.SUCCESS_COLOR :
                   feedbackType === 'error' ? EDITOR_THEME.ERROR_COLOR :
                   EDITOR_THEME.WARNING_COLOR,
          },
          feedback
        )
      ),

      // Help footer
      React.createElement(
        Box,
        { borderTop: true, borderStyle: 'single', paddingTop: 1 },
        React.createElement(
          Text,
          { dimColor: true },
          `${SHORTCUTS.SAVE}: Save  |  ${SHORTCUTS.CANCEL}: Cancel  |  `,
          `${SHORTCUTS.NEXT_TAB}/${SHORTCUTS.PREV_TAB}: Navigate  |  `,
          saving ? 'Saving...' : `${SHORTCUTS.TOGGLE}: Toggle  |  ${SHORTCUTS.NAV_UP}/${SHORTCUTS.NAV_DOWN}: Adjust`
        )
      )
    )
  );
}

export default AgentEditor;
