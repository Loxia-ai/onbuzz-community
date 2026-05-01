/**
 * SettingsPanel Component
 * Modal configuration screen with categorized settings
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from './TextInput.js';

const CATEGORIES = {
  CONNECTION: 0,
  DISPLAY: 1,
  API_KEYS: 2,
  SHORTCUTS: 3,
};

const CATEGORY_TITLES = ['Connection', 'Display', 'API Keys', 'Shortcuts'];

const BOOLEANS = {
  TRUE: 'enabled',
  FALSE: 'disabled',
};

/**
 * SettingsPanel Component
 * @param {Object} props
 * @param {Object} props.settings - Current settings object
 * @param {Function} props.onSave - Called when settings are saved
 * @param {Function} props.onCancel - Called when panel is closed without saving
 * @param {Number} props.terminalHeight - Terminal height for responsive sizing
 * @param {Number} props.terminalWidth - Terminal width for responsive sizing
 */
export function SettingsPanel({ settings = {}, onSave, onCancel, terminalHeight = 24, terminalWidth = 80 }) {
  const [category, setCategory] = useState(CATEGORIES.API_KEYS); // Start on API Keys for onboarding
  const [localSettings, setLocalSettings] = useState({
    // Connection settings
    reconnectDelay: settings.reconnectDelay ?? 3000,
    heartbeatInterval: settings.heartbeatInterval ?? 30000,

    // Display settings
    showTimestamps: settings.showTimestamps ?? true,
    colorScheme: settings.colorScheme ?? 'default',

    // API Keys
    apiKeys: {
      loxia: settings.apiKeys?.loxia || '',
      anthropic: settings.apiKeys?.anthropic || '',
      openai: settings.apiKeys?.openai || '',
      deepseek: settings.apiKeys?.deepseek || '',
    },

    // Shortcuts (read-only display)
    shortcuts: {
      'Agent Switcher': 'Ctrl+S',
      'New Agent': 'Ctrl+N',
      'Settings': 'Alt+S',
      'Search': 'Ctrl+F',
      'Help': 'Alt+H',
      'Reconnect': 'Ctrl+R',
      'Clear': 'Ctrl+L',
      'Reload Agents': 'Ctrl+A',
      'Reload Tools': 'Ctrl+T',
    },
  });

  const [selectedIndex, setSelectedIndex] = useState(0);

  // Get available options for current category and selected index
  const getOptions = () => {
    if (category === CATEGORIES.CONNECTION) {
      return [
        { key: 'reconnectDelay', label: 'Reconnect delay (ms)', type: 'number', min: 1000, max: 30000, step: 1000 },
        { key: 'heartbeatInterval', label: 'Heartbeat interval (ms)', type: 'number', min: 10000, max: 60000, step: 5000 },
      ];
    } else if (category === CATEGORIES.DISPLAY) {
      return [
        { key: 'showTimestamps', label: 'Show timestamps', type: 'boolean' },
        { key: 'colorScheme', label: 'Color scheme', type: 'select', options: ['default', 'light', 'dark', 'high-contrast'] },
      ];
    } else if (category === CATEGORIES.API_KEYS) {
      return [
        { key: 'loxia', label: 'Loxia Platform API Key', type: 'text', masked: true, required: true },
        { key: 'anthropic', label: 'Anthropic API Key (optional)', type: 'text', masked: true },
        { key: 'openai', label: 'OpenAI API Key (optional)', type: 'text', masked: true },
        { key: 'deepseek', label: 'DeepSeek API Key (optional)', type: 'text', masked: true },
      ];
    } else if (category === CATEGORIES.SHORTCUTS) {
      return Object.entries(localSettings.shortcuts).map(([label, shortcut]) => ({
        label,
        shortcut,
      }));
    }
    return [];
  };

  const options = getOptions();

  // Handle keyboard input
  useInput((char, key) => {
    // Cancel on Escape
    if (key.escape) {
      onCancel();
      return;
    }

    // Save on Ctrl+S (allow saving from any category)
    if (key.ctrl && char === 's') {
      onSave(localSettings);
      return;
    }

    // Navigate categories with Tab or Left/Right arrows
    if (key.tab && !key.shift) {
      setCategory(prev => (prev + 1) % Object.keys(CATEGORIES).length);
      setSelectedIndex(0);
      return;
    } else if (key.tab && key.shift) {
      setCategory(prev => (prev - 1 + Object.keys(CATEGORIES).length) % Object.keys(CATEGORIES).length);
      setSelectedIndex(0);
      return;
    } else if (key.leftArrow && key.ctrl) {
      setCategory(prev => Math.max(0, prev - 1));
      setSelectedIndex(0);
      return;
    } else if (key.rightArrow && key.ctrl) {
      setCategory(prev => Math.min(Object.keys(CATEGORIES).length - 1, prev + 1));
      setSelectedIndex(0);
      return;
    }

    // Shortcuts category is read-only
    if (category === CATEGORIES.SHORTCUTS) {
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex(prev => Math.min(options.length - 1, prev + 1));
      }
      return;
    }

    // API Keys category uses text inputs (handled by TextInput component)
    if (category === CATEGORIES.API_KEYS) {
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex(prev => Math.min(options.length - 1, prev + 1));
      }
      return; // TextInput handles Enter/edit mode
    }

    // Navigate settings
    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(options.length - 1, prev + 1));
    }
    // Toggle or modify selected setting
    else if (key.leftArrow || key.rightArrow) {
      const option = options[selectedIndex];
      if (!option) return;

      if (option.type === 'boolean') {
        setLocalSettings(prev => ({
          ...prev,
          [option.key]: key.rightArrow ? true : false,
        }));
      } else if (option.type === 'number') {
        const current = localSettings[option.key];
        const step = option.step || 1;
        const newValue = key.rightArrow
          ? Math.min(option.max, current + step)
          : Math.max(option.min, current - step);
        setLocalSettings(prev => ({
          ...prev,
          [option.key]: newValue,
        }));
      } else if (option.type === 'select') {
        const currentIndex = option.options.indexOf(localSettings[option.key]);
        const newIndex = key.rightArrow
          ? (currentIndex + 1) % option.options.length
          : (currentIndex - 1 + option.options.length) % option.options.length;
        setLocalSettings(prev => ({
          ...prev,
          [option.key]: option.options[newIndex],
        }));
      }
    }
    // Space to toggle boolean
    else if (char === ' ') {
      const option = options[selectedIndex];
      if (option && option.type === 'boolean') {
        setLocalSettings(prev => ({
          ...prev,
          [option.key]: !prev[option.key],
        }));
      }
    }
  });

  // Handle text input change for API keys
  const handleApiKeyChange = (key, value) => {
    setLocalSettings(prev => ({
      ...prev,
      apiKeys: {
        ...prev.apiKeys,
        [key]: value,
      },
    }));
  };

  // Render category tabs
  const renderTabs = () => {
    return React.createElement(
      Box,
      { marginBottom: 1 },
      CATEGORY_TITLES.map((title, index) =>
        React.createElement(
          Box,
          { key: title, marginRight: 1 },
          React.createElement(
            Text,
            {
              backgroundColor: index === category ? 'cyan' : undefined,
              color: index === category ? 'black' : 'cyan',
              bold: index === category,
            },
            ` ${title} `
          )
        )
      )
    );
  };

  // Render settings based on category
  const renderSettings = () => {
    if (category === CATEGORIES.SHORTCUTS) {
      return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(
          Text,
          { dimColor: true, marginBottom: 1 },
          'Keyboard shortcuts (read-only):'
        ),
        options.map((item, index) =>
          React.createElement(
            Box,
            { key: item.label, marginBottom: 0 },
            React.createElement(
              Text,
              {
                backgroundColor: index === selectedIndex ? 'blue' : undefined,
                color: index === selectedIndex ? 'white' : undefined,
              },
              index === selectedIndex ? '> ' : '  ',
              item.label.padEnd(20),
              ' ',
              React.createElement(Text, { color: 'yellow' }, item.shortcut)
            )
          )
        )
      );
    }

    if (category === CATEGORIES.API_KEYS) {
      return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(
          Text,
          { dimColor: true, marginBottom: 1 },
          'Configure your API keys for model access:'
        ),
        options.map((option, index) =>
          React.createElement(TextInput, {
            key: option.key,
            value: localSettings.apiKeys[option.key],
            label: option.label,
            onChange: (value) => handleApiKeyChange(option.key, value),
            masked: option.masked,
            focused: index === selectedIndex,
            placeholder: option.required ? 'Required - Press Enter to edit' : 'Optional - Press Enter to edit',
          })
        )
      );
    }

    return React.createElement(
      Box,
      { flexDirection: 'column' },
      options.map((option, index) => {
        const isSelected = index === selectedIndex;
        let valueDisplay;

        if (option.type === 'boolean') {
          const value = localSettings[option.key];
          valueDisplay = React.createElement(
            Text,
            { color: value ? 'green' : 'red' },
            value ? 'enabled' : 'disabled'
          );
        } else if (option.type === 'number') {
          valueDisplay = React.createElement(
            Text,
            { color: 'cyan' },
            localSettings[option.key]
          );
        } else if (option.type === 'select') {
          valueDisplay = React.createElement(
            Text,
            { color: 'cyan' },
            localSettings[option.key]
          );
        }

        return React.createElement(
          Box,
          { key: option.key, marginBottom: 0 },
          React.createElement(
            Text,
            {
              backgroundColor: isSelected ? 'blue' : undefined,
              color: isSelected ? 'white' : undefined,
            },
            isSelected ? '> ' : '  ',
            option.label.padEnd(25),
            ' ',
            valueDisplay
          )
        );
      })
    );
  };

  // Render help text based on category
  const renderHelp = () => {
    if (category === CATEGORIES.SHORTCUTS) {
      return React.createElement(
        Text,
        { dimColor: true },
        'Tab: Next category  Ctrl+S: Save  Esc: Cancel'
      );
    }

    if (category === CATEGORIES.API_KEYS) {
      return React.createElement(
        Text,
        { dimColor: true },
        '↑↓: Navigate  Enter: Edit  Tab: Next category  Ctrl+S: Save  Esc: Cancel'
      );
    }

    return React.createElement(
      Text,
      { dimColor: true },
      '←/→: Change value  Space: Toggle  Tab: Next category  Ctrl+S: Save  Esc: Cancel'
    );
  };

  // Calculate responsive dialog size
  const dialogWidth = Math.min(80, Math.floor(terminalWidth * 0.9));
  const dialogHeight = Math.min(28, Math.floor(terminalHeight * 0.9));

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
    // Dialog box (centered and responsive)
    React.createElement(
      Box,
      {
        flexDirection: 'column',
        width: dialogWidth,
        height: dialogHeight,
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
        React.createElement(Text, { bold: true, color: 'cyan' }, 'Settings')
      ),

      // Category tabs
      renderTabs(),

      // Settings content
      React.createElement(
        Box,
        { flexDirection: 'column', flexGrow: 1, marginBottom: 1 },
        renderSettings()
      ),

      // Help text
      React.createElement(
        Box,
        { borderTop: true, borderStyle: 'single', paddingTop: 1 },
        renderHelp()
      )
    )
  );
}

export default SettingsPanel;
