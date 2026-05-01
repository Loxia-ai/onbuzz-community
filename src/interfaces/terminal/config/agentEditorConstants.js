/**
 * Agent Editor Constants
 * Centralized configuration for agent editor UI
 */

// Editor categories
export const EDITOR_CATEGORY = {
  BASIC_INFO: 0,
  SYSTEM_PROMPT: 1,
  CAPABILITIES: 2,
  CONFIGURATION: 3,
};

export const CATEGORY_TITLES = [
  'Basic Info',
  'System Prompt',
  'Capabilities',
  'Configuration',
];

// Agent modes
export const AGENT_MODE = {
  CHAT: 'CHAT',
  AGENT: 'AGENT',
};

// Available tools (capabilities)
// IMPORTANT: 'value' must match the exact tool ID registered in toolsRegistry
export const AVAILABLE_TOOLS = [
  { name: 'FileSystem', value: 'filesystem', description: 'Read, write, and manage files' },
  { name: 'FileTree', value: 'file-tree', description: 'Navigate and explore directory structure' },
  { name: 'Seek', value: 'seek', description: 'Search for patterns in files' },
  { name: 'Terminal', value: 'terminal', description: 'Execute shell commands' },
  { name: 'Web', value: 'web', description: 'Fetch, browse, and interact with web content' },
  // Browser tool is DEPRECATED - use Web tool instead
  { name: 'Image', value: 'image-gen', description: 'Generate and process images' },
  { name: 'TaskManager', value: 'taskmanager', description: 'Manage and track tasks' },
  { name: 'StaticAnalysis', value: 'staticanalysis', description: 'Analyze code structure and patterns' },
  { name: 'DependencyResolver', value: 'dependency-resolver', description: 'Analyze and resolve dependencies' },
  { name: 'ImportAnalyzer', value: 'import-analyzer', description: 'Analyze import statements' },
  { name: 'CloneDetection', value: 'clonedetection', description: 'Detect code duplication' },
  { name: 'FileContentReplace', value: 'file-content-replace', description: 'Advanced find and replace' },
  { name: 'AgentCommunication', value: 'agentcommunication', description: 'Communicate with other agents' },
  { name: 'JobDone', value: 'jobdone', description: 'Signal task completion in autonomous mode' },
  { name: 'AgentDelay', value: 'agentdelay', description: 'Pause agent activity for a duration' },
  { name: 'VisualEditor', value: 'visual-editor', description: 'Visual editing of web apps with element selection' },
  // TODO: Re-enable once Sora replacement is available
  // { name: 'Video', value: 'video-gen', description: 'Generate and process videos' },
  { name: 'Skills', value: 'skills', description: 'Browse and use reusable skill instructions' },
  { name: 'Vision', value: 'vision', description: 'Analyze images with AI vision models' },
];

// Field configuration
export const FIELD_CONFIG = {
  NAME: {
    key: 'name',
    label: 'Agent Name',
    type: 'text',
    required: true,
    maxLength: 50,
    placeholder: 'Enter agent name',
  },
  DESCRIPTION: {
    key: 'description',
    label: 'Description',
    type: 'text',
    required: false,
    maxLength: 200,
    placeholder: 'Brief description (optional)',
  },
  MODE: {
    key: 'mode',
    label: 'Agent Mode',
    type: 'select',
    options: [AGENT_MODE.CHAT, AGENT_MODE.AGENT],
    descriptions: {
      [AGENT_MODE.CHAT]: 'Conversational mode - responds to user messages',
      [AGENT_MODE.AGENT]: 'Autonomous mode - can execute tasks independently',
    },
  },
  SYSTEM_PROMPT: {
    key: 'systemPrompt',
    label: 'System Prompt',
    type: 'multiline',
    required: true,
    minLength: 10,
    placeholder: 'Enter system prompt that defines agent behavior...',
  },
  CAPABILITIES: {
    key: 'capabilities',
    label: 'Enabled Tools',
    type: 'multiselect',
    options: AVAILABLE_TOOLS,
    description: 'Select tools this agent can use',
  },
  PREFERRED_MODEL: {
    key: 'preferredModel',
    label: 'Preferred Model',
    type: 'select',
    required: true,
  },
  DYNAMIC_MODEL_ROUTING: {
    key: 'dynamicModelRouting',
    label: 'Dynamic Model Routing',
    type: 'boolean',
    description: 'Automatically select best model for each task',
  },
  ROUTING_STRATEGY: {
    key: 'routingStrategy',
    label: 'Routing Strategy',
    type: 'multiline',
    maxLength: 2000,
    description: 'Custom instructions that guide model selection for this agent',
    conditionalOn: 'dynamicModelRouting',
  },
  TEMPERATURE: {
    key: 'temperature',
    label: 'Temperature',
    type: 'number',
    min: 0,
    max: 2,
    step: 0.1,
    default: 0.7,
    description: 'Controls randomness (0=focused, 2=creative)',
  },
  MAX_TOKENS: {
    key: 'maxTokens',
    label: 'Max Tokens',
    type: 'number',
    min: 100,
    max: 100000,
    step: 100,
    default: 4000,
    description: 'Maximum response length',
  },
};

// UI dimensions and layout
export const UI_CONFIG = {
  DIALOG_WIDTH_RATIO: 0.9,
  DIALOG_HEIGHT_RATIO: 0.9,
  MIN_DIALOG_WIDTH: 70,
  MAX_DIALOG_WIDTH: 120,
  MIN_DIALOG_HEIGHT: 25,
  MAX_DIALOG_HEIGHT: 40,
  PADDING_X: 2,
  PADDING_Y: 1,
  LABEL_WIDTH: 25,
  MULTILINE_MIN_HEIGHT: 8,
  MULTILINE_MAX_HEIGHT: 15,
  TOOLS_PER_COLUMN: 7,
  TOOL_COLUMN_WIDTH: 35,
};

// Validation rules
export const VALIDATION = {
  NAME_MIN_LENGTH: 1,
  NAME_MAX_LENGTH: 50,
  DESCRIPTION_MAX_LENGTH: 200,
  SYSTEM_PROMPT_MIN_LENGTH: 10,
  SYSTEM_PROMPT_MAX_LENGTH: 10000,
  TEMPERATURE_MIN: 0,
  TEMPERATURE_MAX: 2,
  MAX_TOKENS_MIN: 100,
  MAX_TOKENS_MAX: 100000,
};

// Colors and theming
export const EDITOR_THEME = {
  BORDER_COLOR: 'cyan',
  TITLE_COLOR: 'cyan',
  ERROR_COLOR: 'red',
  SUCCESS_COLOR: 'green',
  WARNING_COLOR: 'yellow',
  SELECTED_BG: 'blue',
  SELECTED_FG: 'white',
  TAB_ACTIVE_BG: 'cyan',
  TAB_ACTIVE_FG: 'black',
  TAB_INACTIVE_FG: 'cyan',
  LABEL_COLOR: 'gray',
  VALUE_COLOR: 'white',
  DIM_COLOR: 'gray',
  TOOL_ENABLED_COLOR: 'green',
  TOOL_DISABLED_COLOR: 'gray',
};

// Keyboard shortcuts (aligned with other dialogs)
export const SHORTCUTS = {
  SAVE: 'Ctrl+S',
  CANCEL: 'Esc',
  NEXT_TAB: 'Tab',
  PREV_TAB: 'Shift+Tab',
  NAV_UP: '↑',
  NAV_DOWN: '↓',
  EDIT: 'Enter',
  TOGGLE: 'Space',
  CHANGE_VALUE: '←/→',
  INCREMENT: '↑',
  DECREMENT: '↓',
};

// Success/error messages
export const MESSAGES = {
  SAVE_SUCCESS: 'Agent updated successfully!',
  SAVE_ERROR: 'Failed to save agent changes',
  VALIDATION_ERROR: 'Please fix validation errors before saving',
  REQUIRED_FIELD: 'This field is required',
  MIN_LENGTH: 'Must be at least {min} characters',
  MAX_LENGTH: 'Must not exceed {max} characters',
  MIN_VALUE: 'Must be at least {min}',
  MAX_VALUE: 'Must not exceed {max}',
  NO_CHANGES: 'No changes to save',
  LOADING: 'Loading agent data...',
};

export default {
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
};
