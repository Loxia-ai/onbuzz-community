/**
 * Terminal UI - Configuration Constants
 * All magic numbers and values centralized here
 * Following best practices: no hardcoded values in implementation code
 */

// UI Dimensions
export const UI_DIMENSIONS = {
  MESSAGE_LIST_HEIGHT: 20,
  MESSAGE_LIST_MIN_HEIGHT: 10,
  MESSAGE_LIST_MAX_HEIGHT: 40,
  INPUT_BOX_HEIGHT: 3,
  STATUS_BAR_HEIGHT: 1,
  HEADER_HEIGHT: 3,
  SIDEBAR_WIDTH: 30,
  MIN_TERMINAL_WIDTH: 80,
  MIN_TERMINAL_HEIGHT: 24,
};

// Message Display
export const MESSAGE_CONFIG = {
  MAX_MESSAGES_DISPLAY: 100,
  MESSAGE_PREVIEW_LENGTH: 200,
  HISTORY_LIMIT: 10,
  MAX_MESSAGE_LENGTH: 10000,
  TRUNCATION_SUFFIX: '...',
};

// Pagination
export const PAGINATION = {
  PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  DEFAULT_OFFSET: 0,
};

// Timeouts & Intervals (in milliseconds)
export const TIMING = {
  WEBSOCKET_RECONNECT_DELAY: 3000,
  WEBSOCKET_RECONNECT_MAX_DELAY: 30000,
  WEBSOCKET_RECONNECT_MULTIPLIER: 1.5,
  WEBSOCKET_PING_INTERVAL: 30000,
  WEBSOCKET_CONNECT_TIMEOUT: 10000,
  WEBSOCKET_PONG_TIMEOUT: 5000,
  MESSAGE_DEBOUNCE_DELAY: 300,
  INPUT_THROTTLE_DELAY: 100,
  AUTO_SAVE_INTERVAL: 60000,
  STATUS_UPDATE_INTERVAL: 5000,
  SPINNER_FRAME_RATE: 80,
};

// Network
export const NETWORK = {
  DEFAULT_HOST: 'localhost',
  DEFAULT_PORT: 8080,
  HTTP_TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
};

// Connection States
export const CONNECTION_STATE = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error',
};

// Connection Status (alias for CONNECTION_STATE for consistency)
export const CONNECTION_STATUS = CONNECTION_STATE;

// Reconnection Configuration
export const RECONNECT_CONFIG = {
  INITIAL_DELAY: 1000, // 1 second
  MAX_DELAY: 30000, // 30 seconds
  BACKOFF_MULTIPLIER: 1.5,
  MAX_ATTEMPTS: 10,
};

// Agent Modes
export const AGENT_MODE = {
  CHAT: 'CHAT',
  AGENT: 'AGENT',
};

// Agent Status
export const AGENT_STATUS = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  IDLE: 'idle',
  ERROR: 'error',
  ARCHIVED: 'archived',
};

// Message Roles
export const MESSAGE_ROLE = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
  TOOL: 'tool',
};

// Message Types
export const MESSAGE_TYPE = {
  USER_MESSAGE: 'user-message',
  AGENT_RESPONSE: 'agent-response',
  SYSTEM_NOTIFICATION: 'system-notification',
  TOOL_EXECUTION: 'tool-execution',
  ERROR: 'error',
  WARNING: 'warning',
};

// WebSocket Message Types
export const WS_MESSAGE_TYPE = {
  PING: 'ping',
  PONG: 'pong',
  CONNECTED: 'connected',
  JOIN_SESSION: 'join_session',
  SESSION_JOINED: 'session_joined',
  ORCHESTRATOR_REQUEST: 'orchestrator_request',
  ORCHESTRATOR_RESPONSE: 'orchestrator_response',
  MESSAGE_ADDED: 'message_added',
  AGENT_MODE_CHANGED: 'agent_mode_changed',
  EXECUTION_STOPPED: 'execution_stopped',
  AGENT_ERROR: 'agent_error',
  AGENT_WARNING: 'agent_warning',
  COMPACTION_EVENT: 'compaction_event',
  AGENT_IMPORTED: 'agent-imported',
  AGENT_COMMUNICATION: 'agent-communication',
  IMAGE_RESULT: 'image-result',
  IMAGE_GENERATED: 'imageGenerated',
  ERROR: 'error',
};

// File Operations
export const FILE_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_ATTACHMENTS: 10,
  PREVIEW_LENGTH: 500,
  ALLOWED_EXTENSIONS: [
    '.txt', '.js', '.jsx', '.ts', '.tsx', '.json', '.md',
    '.py', '.java', '.cpp', '.c', '.h', '.css', '.html'
  ],
};

// File Attachment Modes
export const FILE_MODE = {
  CONTENT: 'content',
  REFERENCE: 'reference',
};

// Views
export const VIEW = {
  CHAT: 'chat',
  AGENTS: 'agents',
  SETTINGS: 'settings',
  FILE_EXPLORER: 'file-explorer',
  HELP: 'help',
};

// Command Prefixes
export const COMMAND_PREFIX = '/';

// Commands
export const COMMANDS = {
  HELP: '/help',
  CLEAR: '/clear',
  AGENTS: '/agents',
  SETTINGS: '/settings',
  FILES: '/files',
  EXIT: '/exit',
  QUIT: '/quit',
  CREATE_AGENT: '/create',
  SWITCH_AGENT: '/switch',
  DELETE_AGENT: '/delete',
  PAUSE_AGENT: '/pause',
  RESUME_AGENT: '/resume',
  MODE: '/mode',
  MODEL: '/model',
  TOOLS: '/tools',
  ATTACH: '/attach',
  DETACH: '/detach',
  EXPORT: '/export',
  IMPORT: '/import',
};

// Keyboard Shortcuts
export const KEYBOARD = {
  EXIT: ['escape', 'ctrl+c'],
  SUBMIT: 'return',
  CANCEL: 'escape',
  DELETE: ['backspace', 'delete'],
  NAVIGATE_UP: 'up',
  NAVIGATE_DOWN: 'down',
  NAVIGATE_LEFT: 'left',
  NAVIGATE_RIGHT: 'right',
  PAGE_UP: 'pageUp',
  PAGE_DOWN: 'pageDown',
  HOME: 'home',
  END: 'end',
  TAB: 'tab',
  SHIFT_TAB: 'shift+tab',
};

// Status Messages
export const STATUS_MESSAGE = {
  CONNECTING: 'Connecting to server...',
  CONNECTED: 'Connected',
  DISCONNECTED: 'Disconnected',
  RECONNECTING: 'Reconnecting...',
  ERROR: 'Connection error',
  AGENT_PROCESSING: 'Agent processing...',
  SENDING_MESSAGE: 'Sending message...',
  LOADING: 'Loading...',
};

// Error Messages
export const ERROR_MESSAGE = {
  CONNECTION_FAILED: 'Failed to connect to server',
  WEBSOCKET_ERROR: 'WebSocket connection error',
  NO_AGENT_SELECTED: 'No agent selected',
  INVALID_COMMAND: 'Invalid command',
  FILE_TOO_LARGE: 'File size exceeds maximum limit',
  FILE_NOT_FOUND: 'File not found',
  PERMISSION_DENIED: 'Permission denied',
  NETWORK_ERROR: 'Network error occurred',
  UNKNOWN_ERROR: 'An unknown error occurred',
  SESSION_CREATE_FAILED: 'Failed to create session',
  SESSION_INVALID: 'Invalid session',
};

// Success Messages
export const SUCCESS_MESSAGE = {
  AGENT_CREATED: 'Agent created successfully',
  AGENT_DELETED: 'Agent deleted successfully',
  AGENT_SWITCHED: 'Switched to agent',
  FILE_ATTACHED: 'File attached successfully',
  MESSAGE_SENT: 'Message sent',
  SETTINGS_SAVED: 'Settings saved',
  SESSION_CREATED: 'Session created',
  CONNECTED_TO_SERVER: 'Connected to server',
};

// Compaction Status
export const COMPACTION_STATUS = {
  STARTED: 'started',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

// API Endpoints
export const API_ENDPOINTS = {
  HEALTH: '/api/health',
  SESSION_CREATE: '/api/sessions',
  KEYS_SET: '/api/keys',
  KEYS_GET: '/api/keys/:sessionId',
  KEYS_DELETE: '/api/keys/:sessionId',
  LLM_CHAT: '/api/llm/chat',
  LLM_MODELS: '/api/llm/models',
  TOOLS: '/api/tools',
  FILES_LIST: '/api/files',
  FILES_UPLOAD: '/api/files/upload',
  EXPLORER_BROWSE: '/api/explorer',
  EXPLORER_INFO: '/api/explorer/info',
  EXPLORER_MKDIR: '/api/explorer/mkdir',
  FILE_EXPLORER_HEALTH: '/api/file-explorer/health',
  FILE_EXPLORER_CWD: '/api/file-explorer/cwd',
  FILE_EXPLORER_BROWSE: '/api/file-explorer/browse',
  FILE_EXPLORER_INFO: '/api/file-explorer/file-info',
  FILE_EXPLORER_MKDIR: '/api/file-explorer/mkdir',
  AGENTS_AVAILABLE: '/api/agents/available',
  AGENTS_METADATA: '/api/agents/:agentId/metadata',
  AGENTS_IMPORT: '/api/agents/import',
  AGENTS_MODE_SET: '/api/agents/:agentId/mode',
  AGENTS_MODE_GET: '/api/agents/:agentId/mode',
  AGENTS_STOP: '/api/agents/:agentId/stop',
  ATTACHMENTS_UPLOAD: '/api/agents/:agentId/attachments/upload',
  ATTACHMENTS_LIST: '/api/agents/:agentId/attachments',
  ATTACHMENTS_GET: '/api/attachments/:fileId',
  ATTACHMENTS_PREVIEW: '/api/attachments/:fileId/preview',
  ATTACHMENTS_TOGGLE: '/api/attachments/:fileId/toggle',
  ATTACHMENTS_UPDATE: '/api/attachments/:fileId',
  ATTACHMENTS_DELETE: '/api/attachments/:fileId',
  ATTACHMENTS_IMPORT: '/api/attachments/:fileId/import',
  IMAGES_GET: '/api/images/:sessionId/:filename',
  ORCHESTRATOR: '/api/orchestrator',
};

// Tool Categories
export const TOOL_CATEGORY = {
  SYSTEM: 'system',
  AUTOMATION: 'automation',
  ANALYSIS: 'analysis',
  UTILITY: 'utility',
  COLLABORATION: 'collaboration',
  AI: 'ai',
};

// Available Tools
export const TOOLS = {
  TERMINAL: 'terminal',
  FILESYSTEM: 'filesystem',
  FILE_CONTENT_REPLACE: 'file-content-replace',
  SEEK: 'seek',
  FILE_TREE: 'file-tree',
  WEB_BROWSER: 'web-browser',
  WEB: 'web',
  STATIC_ANALYSIS: 'static-analysis',
  CLONE_DETECTION: 'clone-detection',
  AGENT_DELAY: 'agent-delay',
  JOB_DONE: 'job-done',
  AGENT_COMMUNICATION: 'agent-communication',
  TASK_MANAGER: 'task-manager',
  IMPORT_ANALYZER: 'import-analyzer',
  DEPENDENCY_RESOLVER: 'dependency-resolver',
  IMAGE_GENERATOR: 'image-generator',
};

// System Templates
export const AGENT_TEMPLATES = {
  CODING_ASSISTANT: 'coding-assistant',
  DATA_ANALYST: 'data-analyst',
  CREATIVE_WRITER: 'creative-writer',
  SYSTEM_ADMINISTRATOR: 'system-administrator',
  SECURITY_ARCHITECT: 'security-architect',
  SYSTEM_ANALYST: 'system-analyst',
  TEAM_MANAGER: 'team-manager',
  CUSTOM: 'custom',
};

// Model Categories
export const MODEL_CATEGORY = {
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  DEEPSEEK: 'deepseek',
  MICROSOFT: 'microsoft',
};

// Notification Severity
export const SEVERITY = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
};

// Theme
export const THEME = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
};

// Logging
export const LOG_LEVEL = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};

// Default export for convenience
export default {
  UI_DIMENSIONS,
  MESSAGE_CONFIG,
  PAGINATION,
  TIMING,
  NETWORK,
  CONNECTION_STATE,
  CONNECTION_STATUS,
  RECONNECT_CONFIG,
  AGENT_MODE,
  AGENT_STATUS,
  MESSAGE_ROLE,
  MESSAGE_TYPE,
  WS_MESSAGE_TYPE,
  FILE_CONFIG,
  FILE_MODE,
  VIEW,
  COMMAND_PREFIX,
  COMMANDS,
  KEYBOARD,
  STATUS_MESSAGE,
  ERROR_MESSAGE,
  SUCCESS_MESSAGE,
  COMPACTION_STATUS,
  API_ENDPOINTS,
  TOOL_CATEGORY,
  TOOLS,
  AGENT_TEMPLATES,
  MODEL_CATEGORY,
  SEVERITY,
  THEME,
  LOG_LEVEL,
};
