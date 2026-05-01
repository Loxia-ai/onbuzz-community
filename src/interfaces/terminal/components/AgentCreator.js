/**
 * AgentCreator Component
 * Multi-step wizard for creating new agents
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

const STEPS = {
  NAME: 0,
  MODEL: 1,
  MODE: 2,
  DYNAMIC_ROUTING: 3,
  ROUTING_STRATEGY: 4,
  CAPABILITIES: 5,
  SYSTEM_PROMPT: 6,
  CONFIRM: 7,
};

const STEP_TITLES = [
  'Agent Name',
  'Select Model',
  'Select Mode',
  'Dynamic Model Routing',
  'Routing Strategy (Optional)',
  'Select Capabilities',
  'System Prompt (Optional)',
  'Confirm & Create'
];

const MODES = [
  { value: 'chat', label: 'Chat Mode', description: 'Interactive conversation' },
  { value: 'auto', label: 'Auto Mode', description: 'Autonomous execution' },
];

// Tools will be fetched dynamically from API

const DYNAMIC_ROUTING_OPTIONS = [
  { value: true, label: 'Yes - Use dynamic routing', description: 'Recommended' },
  { value: false, label: 'No - Use model directly', description: 'Advanced users' },
];

export function AgentCreator({ sessionManager, onCancel, onCreate, terminalHeight = 24, terminalWidth = 80 }) {
  // terminalHeight and terminalWidth are now passed as props from Layout.js

  const [step, setStep] = useState(STEPS.NAME);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState(null);
  const [tools, setTools] = useState([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    model: '',
    mode: MODES[0].value,
    dynamicModelRouting: true, // Default to enabled
    routingStrategy: '',
    capabilities: [], // Array of tool names
    systemPrompt: '',
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [inputBuffer, setInputBuffer] = useState('');

  // Calculate max visible items based on terminal height
  // Reserve space for: dialog header (1), dialog borders (3), step title (1),
  // inner borders (2), compact status line (1), shortcuts (3), margins (2) = 13 lines
  // Reduced from 16 to 13 by removing scroll indicators, bordered footer, and redundant instructions
  const RESERVED_LINES = 13;
  const MAX_VISIBLE_ITEMS = Math.max(3, Math.min(15, terminalHeight - RESERVED_LINES));
  const MAX_VISIBLE_MODELS = Math.max(5, Math.min(8, terminalHeight - 14)); // For model selection

  // Fetch available models from API
  useEffect(() => {
    async function fetchModels() {
      try {
        setModelsLoading(true);
        const data = await sessionManager.makeRequest('GET', '/api/llm/models');

        // Map API response to UI format
        const mappedModels = data.models.map(model => ({
          value: model.name,
          label: formatModelLabel(model),
          description: formatModelDescription(model),
        }));

        setModels(mappedModels);

        // Set default model
        if (mappedModels.length > 0) {
          setFormData(prev => ({ ...prev, model: mappedModels[0].value }));
        }

        setModelsLoading(false);
      } catch (error) {
        console.error('Error fetching models:', error);
        setModelsError(error.message);
        setModelsLoading(false);
      }
    }

    if (sessionManager) {
      fetchModels();
    }
  }, [sessionManager]);

  // Fetch available tools from API when CAPABILITIES step is reached
  useEffect(() => {
    async function fetchTools() {
      if (step !== STEPS.CAPABILITIES) return;

      try {
        setToolsLoading(true);
        setToolsError(null);
        const data = await sessionManager.makeRequest('GET', '/api/tools');

        if (data.success && data.tools) {
          // Map API response to UI format
          const mappedTools = data.tools.map(tool => ({
            value: tool.name,
            label: tool.name,
            description: tool.description || 'No description available',
          }));

          setTools(mappedTools);
        } else {
          throw new Error(data.error || 'Failed to fetch tools');
        }

        setToolsLoading(false);
      } catch (error) {
        console.error('Error fetching tools:', error);
        setToolsError(error.message);
        setToolsLoading(false);
        // Set empty tools array as fallback
        setTools([]);
      }
    }

    if (sessionManager && step === STEPS.CAPABILITIES) {
      fetchTools();
    }
  }, [sessionManager, step]);

  // Helper function to format model names for display
  function formatModelLabel(model) {
    // Use displayName from API if available
    if (model.displayName) {
      return model.displayName;
    }

    // Otherwise, format the name field programmatically
    // Convert "anthropic-sonnet" to "Anthropic Sonnet"
    const name = model.name || '';
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Helper function to truncate text with ellipsis
  function truncate(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  // Helper function to format model descriptions from API data
  function formatModelDescription(model) {
    // Use API data for description
    const parts = [];

    if (model.category) {
      parts.push(model.category);
    }

    if (model.maxTokens) {
      parts.push(`${(model.maxTokens / 1000).toFixed(0)}K tokens`);
    }

    if (model.pricing?.input) {
      parts.push(`$${model.pricing.input}/1K`);
    }

    if (model.supportsVision) {
      parts.push('vision');
    }

    const description = parts.length > 0 ? parts.join(', ') : model.type || 'LLM';

    // Truncate to max 50 characters to prevent wrapping
    return truncate(description, 50);
  }

  useInput((char, key) => {
    // Cancel on Escape
    if (key.escape) {
      // Defer callback to avoid setState during render
      setTimeout(() => onCancel(), 0);
      return;
    }

    // Back on Ctrl+B
    if (key.ctrl && char === 'b' && step > STEPS.NAME) {
      // Skip routing strategy step if dynamic routing is disabled
      const prevStep = (step === STEPS.CAPABILITIES && !formData.dynamicModelRouting)
        ? STEPS.DYNAMIC_ROUTING
        : step - 1;
      setStep(prevStep);
      return;
    }

    // Handle based on current step
    if (step === STEPS.NAME || step === STEPS.SYSTEM_PROMPT || step === STEPS.ROUTING_STRATEGY) {
      // Text input steps
      if (key.return) {
        if (step === STEPS.NAME && inputBuffer.trim()) {
          setFormData({ ...formData, name: inputBuffer.trim() });
          setInputBuffer('');
          setStep(STEPS.MODEL);
        } else if (step === STEPS.ROUTING_STRATEGY) {
          setFormData({ ...formData, routingStrategy: inputBuffer.trim() });
          setInputBuffer('');
          setStep(STEPS.CAPABILITIES);
        } else if (step === STEPS.SYSTEM_PROMPT) {
          setFormData({ ...formData, systemPrompt: inputBuffer.trim() });
          setInputBuffer('');
          setStep(STEPS.CONFIRM);
        }
      } else if (key.backspace || key.delete) {
        setInputBuffer(prev => prev.slice(0, -1));
      } else if (char && !key.ctrl && !key.meta) {
        setInputBuffer(prev => prev + char);
      }
    } else if (step === STEPS.MODEL || step === STEPS.MODE || step === STEPS.DYNAMIC_ROUTING) {
      // Selection steps (single-select)
      const options = step === STEPS.MODEL ? models : (step === STEPS.MODE ? MODES : DYNAMIC_ROUTING_OPTIONS);

      if (key.upArrow) {
        setSelectedIndex(prev => {
          const newIndex = Math.max(0, prev - 1);
          // Scroll up if needed (for MODEL step only)
          if (step === STEPS.MODEL && newIndex < scrollOffset) {
            setScrollOffset(newIndex);
          }
          return newIndex;
        });
      } else if (key.downArrow) {
        setSelectedIndex(prev => {
          const newIndex = Math.min(options.length - 1, prev + 1);
          // Scroll down if needed (for MODEL step only)
          if (step === STEPS.MODEL && newIndex >= scrollOffset + MAX_VISIBLE_MODELS) {
            setScrollOffset(newIndex - MAX_VISIBLE_MODELS + 1);
          }
          return newIndex;
        });
      } else if (key.return) {
        if (step === STEPS.MODEL) {
          setFormData({ ...formData, model: models[selectedIndex].value });
          setSelectedIndex(0);
          setScrollOffset(0);
          setStep(STEPS.MODE);
        } else if (step === STEPS.MODE) {
          setFormData({ ...formData, mode: MODES[selectedIndex].value });
          setSelectedIndex(0);
          setStep(STEPS.DYNAMIC_ROUTING);
        } else if (step === STEPS.DYNAMIC_ROUTING) {
          const routingEnabled = DYNAMIC_ROUTING_OPTIONS[selectedIndex].value;
          setFormData({ ...formData, dynamicModelRouting: routingEnabled });
          setSelectedIndex(0);
          setInputBuffer('');
          // Skip strategy step if routing is disabled
          setStep(routingEnabled ? STEPS.ROUTING_STRATEGY : STEPS.CAPABILITIES);
        }
      }
    } else if (step === STEPS.CAPABILITIES) {
      // Multi-select step for capabilities (tools) with scrolling
      if (key.upArrow) {
        setSelectedIndex(prev => {
          const newIndex = Math.max(0, prev - 1);
          // Adjust scroll offset to keep selected item visible
          setScrollOffset(currentOffset => {
            if (newIndex < currentOffset) {
              return newIndex; // Scroll up to show item
            }
            return currentOffset;
          });
          return newIndex;
        });
      } else if (key.downArrow) {
        setSelectedIndex(prev => {
          const newIndex = Math.min(tools.length - 1, prev + 1);
          // Adjust scroll offset to keep selected item visible
          setScrollOffset(currentOffset => {
            if (newIndex >= currentOffset + MAX_VISIBLE_ITEMS) {
              return newIndex - MAX_VISIBLE_ITEMS + 1; // Scroll down to show item
            }
            return currentOffset;
          });
          return newIndex;
        });
      } else if (char === ' ' || key.space) {
        // Toggle selection
        if (tools.length > 0 && tools[selectedIndex]) {
          const toolName = tools[selectedIndex].value;
          setFormData(prev => {
            const capabilities = prev.capabilities || [];
            const isSelected = capabilities.includes(toolName);
            return {
              ...prev,
              capabilities: isSelected
                ? capabilities.filter(c => c !== toolName)
                : [...capabilities, toolName]
            };
          });
        }
      } else if (key.return) {
        // Continue to next step
        setSelectedIndex(0);
        setScrollOffset(0); // Reset scroll
        setStep(STEPS.SYSTEM_PROMPT);
      }
    } else if (step === STEPS.CONFIRM) {
      // Confirmation step
      if (key.return) {
        // Defer callback to avoid setState during render
        setTimeout(() => {
          onCreate(formData);
        }, 0);
        return;
      }
    }
  });

  const renderStep = () => {
    if (step === STEPS.NAME) {
      return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Text, {}, 'Enter agent name:'),
        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(Text, {}, '> ', inputBuffer, String.fromCharCode(0x2588))
        )
      );
    }

    if (step === STEPS.MODEL) {
      return React.createElement(
        Box,
        { flexDirection: 'column', alignItems: 'center' },
        React.createElement(Text, {}, 'Select model:'),
        React.createElement(
          Box,
          { flexDirection: 'column', marginTop: 1, alignItems: 'center', width: '100%' },
          modelsLoading
            ? React.createElement(Text, { dimColor: true }, 'Loading models from server...')
            : modelsError
            ? React.createElement(
                Box,
                { flexDirection: 'column', alignItems: 'center' },
                React.createElement(Text, { color: 'red' }, 'Failed to load models:'),
                React.createElement(Text, { dimColor: true }, modelsError),
                React.createElement(Text, { dimColor: true, marginTop: 1 }, 'Press Esc to cancel')
              )
            : models.length === 0
            ? React.createElement(Text, { dimColor: true }, 'No models available')
            : React.createElement(
                Box,
                { flexDirection: 'column', alignItems: 'center' },
                // Visible models (with scroll window)
                models.slice(scrollOffset, scrollOffset + MAX_VISIBLE_MODELS).map((model, visibleIndex) => {
                  const actualIndex = scrollOffset + visibleIndex;
                  const isSelected = actualIndex === selectedIndex;

                  return React.createElement(
                    Box,
                    { key: model.value },
                    React.createElement(
                      Text,
                      { backgroundColor: isSelected ? 'blue' : undefined, color: isSelected ? 'white' : undefined },
                      isSelected ? '> ' : '  ',
                      model.label,
                      React.createElement(Text, { dimColor: true }, ` - ${model.description}`)
                    )
                  );
                }),
                // Scroll indicator
                models.length > MAX_VISIBLE_MODELS &&
                  React.createElement(
                    Box,
                    { marginTop: 1 },
                    React.createElement(
                      Text,
                      { dimColor: true },
                      `Showing ${scrollOffset + 1}-${Math.min(scrollOffset + MAX_VISIBLE_MODELS, models.length)} of ${models.length}`
                    )
                  )
              )
        )
      );
    }

    if (step === STEPS.MODE) {
      return React.createElement(
        Box,
        { flexDirection: 'column', alignItems: 'center' },
        React.createElement(Text, {}, 'Select mode:'),
        React.createElement(
          Box,
          { flexDirection: 'column', marginTop: 1, alignItems: 'center' },
          MODES.map((mode, index) =>
            React.createElement(
              Box,
              { key: mode.value },
              React.createElement(
                Text,
                { backgroundColor: index === selectedIndex ? 'blue' : undefined, color: index === selectedIndex ? 'white' : undefined },
                index === selectedIndex ? '> ' : '  ',
                mode.label,
                React.createElement(Text, { dimColor: true }, ` - ${mode.description}`)
              )
            )
          )
        )
      );
    }

    if (step === STEPS.DYNAMIC_ROUTING) {
      return React.createElement(
        Box,
        { flexDirection: 'column', alignItems: 'center', width: '80%' },
        React.createElement(Text, { bold: true }, 'Dynamic Model Routing'),
        React.createElement(
          Box,
          { flexDirection: 'column', marginTop: 1, alignItems: 'center', borderStyle: 'single', borderColor: 'cyan', paddingX: 2, paddingY: 1, width: '100%' },
          React.createElement(Text, { dimColor: true, textAlign: 'center' }, 'Enable automatic API provider selection based on session context'),
          React.createElement(
            Box,
            { flexDirection: 'column', marginTop: 1, width: '100%' },
            DYNAMIC_ROUTING_OPTIONS.map((option, index) =>
              React.createElement(
                Box,
                { key: String(option.value), marginTop: index > 0 ? 1 : 0 },
                React.createElement(
                  Text,
                  { backgroundColor: index === selectedIndex ? 'blue' : undefined, color: index === selectedIndex ? 'white' : undefined },
                  index === selectedIndex ? '● ' : '○ ',
                  option.label,
                  React.createElement(Text, { dimColor: true }, ` (${option.description})`)
                )
              )
            )
          )
        )
      );
    }

    if (step === STEPS.ROUTING_STRATEGY) {
      return React.createElement(
        Box,
        { flexDirection: 'column', alignItems: 'center', width: '80%' },
        React.createElement(Text, { bold: true }, 'Routing Strategy (Optional)'),
        React.createElement(
          Box,
          { flexDirection: 'column', marginTop: 1, borderStyle: 'single', borderColor: 'cyan', paddingX: 2, paddingY: 1, width: '100%' },
          React.createElement(Text, { dimColor: true }, 'Custom instructions for model selection. Press Enter to skip.'),
          React.createElement(Text, { dimColor: true, italic: true }, 'e.g. Prefer fast models for short questions. Use Claude for code.'),
          React.createElement(
            Box,
            { marginTop: 1 },
            React.createElement(Text, { color: 'cyan' }, '> '),
            React.createElement(Text, null, inputBuffer || '')
          )
        )
      );
    }

    if (step === STEPS.CAPABILITIES) {
      const selectedCapabilities = formData.capabilities || [];
      const selectedCount = selectedCapabilities.length;

      return React.createElement(
        Box,
        { flexDirection: 'column', alignItems: 'center', width: '100%', maxHeight: contentMaxHeight },
        React.createElement(Text, { bold: true }, 'Select Capabilities (Tools)'),
        React.createElement(
          Box,
          { flexDirection: 'column', marginTop: 1, borderStyle: 'single', borderColor: 'cyan', paddingX: 2, paddingY: 1, width: '100%', maxHeight: contentMaxHeight - 6 },
          // Show loading state
          toolsLoading && React.createElement(
            Box,
            { justifyContent: 'center', paddingY: 2 },
            React.createElement(Text, { color: 'yellow' }, '⏳ Loading available tools from API...')
          ),
          // Show error state
          toolsError && React.createElement(
            Box,
            { flexDirection: 'column', paddingY: 1 },
            React.createElement(Text, { color: 'red' }, '✗ Error loading tools: ', toolsError),
            React.createElement(Text, { dimColor: true, marginTop: 1 }, 'Press Enter to continue without tools')
          ),
          // Show tools list (if loaded successfully) - with scrolling viewport
          !toolsLoading && !toolsError && tools.length > 0 && (() => {
            // Calculate visible slice of tools
            const visibleTools = tools.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS);
            const hasMore = tools.length > MAX_VISIBLE_ITEMS;
            const showingFrom = scrollOffset + 1;
            const showingTo = Math.min(scrollOffset + MAX_VISIBLE_ITEMS, tools.length);

            return [
              // Visible tools
              ...visibleTools.map((tool, visibleIndex) => {
                const actualIndex = scrollOffset + visibleIndex;
                const isSelected = selectedCapabilities.includes(tool.value);
                const isCurrent = actualIndex === selectedIndex;

                // Create compact display: checkbox + label only, truncated to fit terminal
                // Available width = 95% of terminal - borders(2) - padding(4) - checkbox(6) ≈ 0.95*width - 12
                const maxLabelLength = Math.max(40, Math.floor(terminalWidth * 0.95) - 12);
                const displayText = `${isCurrent ? '▶' : ' '} ${isSelected ? '[✓]' : '[ ]'} ${truncate(tool.label, maxLabelLength)}`;

                return React.createElement(
                  Box,
                  { key: tool.value },
                  React.createElement(
                    Text,
                    {
                      backgroundColor: isCurrent ? 'blue' : undefined,
                      color: isCurrent ? 'white' : undefined
                    },
                    displayText
                  )
                );
              }),
            ];
          })(),
          // Show empty state (if no tools available)
          !toolsLoading && !toolsError && tools.length === 0 && React.createElement(
            Box,
            { justifyContent: 'center', paddingY: 2 },
            React.createElement(Text, { dimColor: true }, 'No tools available. Press Enter to continue.')
          ),
          // Compact status line (selection count + scroll info) - only show if tools are loaded
          !toolsLoading && !toolsError && tools.length > 0 && (() => {
            const showingFrom = scrollOffset + 1;
            const showingTo = Math.min(scrollOffset + MAX_VISIBLE_ITEMS, tools.length);
            const hasScrollUp = scrollOffset > 0;
            const hasScrollDown = scrollOffset + MAX_VISIBLE_ITEMS < tools.length;

            // Build compact status line
            const parts = [];

            // Scroll up indicator
            if (hasScrollUp) {
              parts.push(`↑${scrollOffset} more`);
            }

            // Selection count (always show)
            parts.push(`${selectedCount} selected`);

            // Current view range (only if there are more tools than visible)
            if (tools.length > MAX_VISIBLE_ITEMS) {
              parts.push(`${showingFrom}-${showingTo}/${tools.length}`);
            }

            // Scroll down indicator
            if (hasScrollDown) {
              parts.push(`${tools.length - showingTo} more↓`);
            }

            return React.createElement(
              Box,
              { marginTop: 1, justifyContent: 'center' },
              React.createElement(
                Text,
                { dimColor: true },
                parts.join(' • ')
              )
            );
          })()
        )
      );
    }

    if (step === STEPS.SYSTEM_PROMPT) {
      return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Text, {}, 'System prompt (optional, press Enter to skip):'),
        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(Text, {}, '> ', inputBuffer, String.fromCharCode(0x2588))
        )
      );
    }

    if (step === STEPS.CONFIRM) {
      const selectedCapabilities = formData.capabilities || [];
      // Map selected tool names to their labels (or fallback to the name if not found)
      const capabilityLabels = selectedCapabilities.map(cap =>
        tools.find(t => t.value === cap)?.label || cap
      );

      return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Text, { bold: true }, 'Confirm agent creation:'),
        React.createElement(Box, { marginTop: 1 }, React.createElement(Text, {}, 'Name: ', React.createElement(Text, { color: 'cyan' }, formData.name))),
        React.createElement(Box, {}, React.createElement(Text, {}, 'Model: ', React.createElement(Text, { color: 'cyan' }, models.find(m => m.value === formData.model)?.label || formData.model))),
        React.createElement(Box, {}, React.createElement(Text, {}, 'Mode: ', React.createElement(Text, { color: 'cyan' }, MODES.find(m => m.value === formData.mode)?.label))),
        React.createElement(
          Box,
          {},
          React.createElement(Text, {}, 'Dynamic Routing: ', React.createElement(Text, { color: formData.dynamicModelRouting ? 'green' : 'yellow' }, formData.dynamicModelRouting ? 'Enabled' : 'Disabled'))
        ),
        formData.dynamicModelRouting && formData.routingStrategy && React.createElement(
          Box,
          {},
          React.createElement(Text, {}, 'Routing Strategy: ', React.createElement(Text, { color: 'cyan', dimColor: true }, formData.routingStrategy.length > 60 ? formData.routingStrategy.slice(0, 57) + '...' : formData.routingStrategy))
        ),
        React.createElement(
          Box,
          {},
          React.createElement(Text, {}, 'Capabilities: ', React.createElement(
            Text,
            { color: 'cyan' },
            selectedCapabilities.length > 0 ? `${selectedCapabilities.length} selected` : 'None'
          ))
        ),
        selectedCapabilities.length > 0 && React.createElement(
          Box,
          { flexDirection: 'column', marginLeft: 2, marginTop: 1 },
          capabilityLabels.map((label, index) =>
            React.createElement(Text, { key: index, dimColor: true }, `• ${label}`)
          )
        ),
        formData.systemPrompt &&
          React.createElement(Box, { marginTop: 1 }, React.createElement(Text, {}, 'Prompt: ', React.createElement(Text, { color: 'cyan', dimColor: true }, formData.systemPrompt.substring(0, 40) + '...'))),
        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(Text, { color: 'green' }, 'Press Enter to create, Esc to cancel')
        )
      );
    }
  };

  // Calculate constrained heights to prevent overflow
  const dialogMaxHeight = Math.floor(terminalHeight * 0.85) - 2; // Dialog takes max 85% of screen minus 2 rows for breathing room
  const contentMaxHeight = dialogMaxHeight - 7; // Leave room for header (3) + footer (4)

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
        width: '95%',
        maxHeight: dialogMaxHeight,
        borderStyle: 'round',
        borderColor: 'cyan',
        backgroundColor: 'black',
        paddingX: 2,
        paddingY: 1
      },
      React.createElement(
        Box,
        { marginBottom: 1 },
        React.createElement(Text, { bold: true, color: 'cyan' }, `Create New Agent (Step ${step + 1}/${Object.keys(STEPS).length})`)
      ),
      renderStep(),
      React.createElement(
        Box,
        { marginTop: 1, borderTop: true, borderStyle: 'single', paddingTop: 1 },
        React.createElement(
          Text,
          { dimColor: true },
          // Show appropriate shortcuts for current step
          step === STEPS.CONFIRM
            ? 'Enter: Create  Ctrl+B: Back  Esc: Cancel'
            : step === STEPS.NAME || step === STEPS.SYSTEM_PROMPT || step === STEPS.ROUTING_STRATEGY
            ? 'Enter: Next  Esc: Cancel'
            : step === STEPS.CAPABILITIES
            ? '↑↓: Navigate  Space: Toggle  Enter: Continue  Ctrl+B: Back  Esc: Cancel'
            : step === STEPS.MODEL || step === STEPS.MODE || step === STEPS.DYNAMIC_ROUTING
            ? '↑↓: Navigate  Enter: Select  Ctrl+B: Back  Esc: Cancel'
            : 'Esc: Cancel'
        )
      )
    )
  );
}

export default AgentCreator;
