/**
 * Web UI Constants - Frontend-specific constants for the web interface
 */

// Themes
export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  DRACULA: 'dracula',
  REDTEAM: 'redteam',
  SYSTEM: 'system'
};

// Notification Types
export const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
};

// WebSocket Events
export const WS_EVENTS = {
  HANDSHAKE: 'handshake',
  HANDSHAKE_ACK: 'handshake_ack',
  MESSAGE_RECEIVED: 'message_received',
  AGENT_UPDATED: 'agent_updated',
  TYPING_START: 'typing_start',
  TYPING_STOP: 'typing_stop',
  NOTIFICATION: 'notification',
  ERROR: 'error'
};

// Connection Status
export const CONNECTION_STATUS = {
  CONNECTED: 'connected',
  CONNECTING: 'connecting',
  DISCONNECTED: 'disconnected',
  ERROR: 'error'
};

// Agent Status
export const AGENT_STATUS = {
  ACTIVE: 'active',
  IDLE: 'idle',
  BUSY: 'busy',
  SUSPENDED: 'suspended',
  PAUSED: 'paused'
};

// Message Roles
export const MESSAGE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system'
};

// Message Modes
export const MESSAGE_MODES = {
  CHAT: 'chat',
  AGENT: 'agent'
};

// Model Names
export const MODELS = {
  ANTHROPIC_SONNET: 'anthropic-sonnet',
  ANTHROPIC_HAIKU: 'anthropic-haiku',
  GPT_4: 'gpt-4',
  GPT_4_MINI: 'gpt-4-mini',
  GPT_5_1_CODEX_MINI: 'gpt-5.1-codex-mini',
  DEEPSEEK_R1: 'deepseek-r1',
  PHI_4: 'phi-4',
  PHI_4_REASONING: 'phi-4-reasoning'
};

// API Endpoints
export const API_ENDPOINTS = {
  BASE_URL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080',
  AGENTS: '/api/agents',
  MESSAGES: '/api/messages',
  SESSIONS: '/api/sessions',
  FILES: '/api/files',
  SYSTEM: '/api/system'
};

// UI Constants
export const UI_CONSTANTS = {
  MAX_MESSAGE_LENGTH: 10000,
  MAX_AGENT_NAME_LENGTH: 100,
  MAX_SYSTEM_PROMPT_LENGTH: 10000,
  TYPING_INDICATOR_DELAY: 1000,
  AUTO_SAVE_DELAY: 2000,
  NOTIFICATION_DURATION: 5000
};

// Local Storage Keys
export const STORAGE_KEYS = {
  THEME: 'loxia_theme',
  CURRENT_AGENT: 'loxia_current_agent',
  USER_PREFERENCES: 'loxia_user_preferences',
  SESSION_DATA: 'loxia_session_data'
};

// Error Types
export const ERROR_TYPES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  API_ERROR: 'API_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  WEBSOCKET_ERROR: 'WEBSOCKET_ERROR'
};

// Default Values
export const DEFAULTS = {
  THEME: THEMES.SYSTEM,
  MODEL: MODELS.ANTHROPIC_SONNET,
  AGENT_NAME: 'My Assistant',
  SYSTEM_PROMPT: 'You are a helpful AI assistant.',
  TEMPERATURE: 0.7,
  MAX_TOKENS: 4096
};

// Terminal Tasks Configuration
export const TERMINAL_CONFIG = {
  // UI refresh/polling
  POLLING_INTERVAL_MS: 2000,           // Polling interval for task updates
  IDLE_POLLING_INTERVAL_MS: 5000,      // Slower polling when no active tasks

  // Output display
  EXPANDED_VIEW_TAIL_LINES: 50,        // Lines shown in expanded dropdown view

  // Recent tasks
  RECENT_TASKS_UI_LIMIT: 10,           // Max recent tasks shown in UI dropdown
  RECENT_HIGHLIGHT_COUNT: 5,           // Number of most recent tasks to highlight as "new"

  // Task states
  STATES: {
    RUNNING: 'running',
    WAITING_FOR_INPUT: 'waiting_for_input',
    COMPLETED: 'completed',
    FAILED: 'failed'
  }
};

export default {
  THEMES,
  NOTIFICATION_TYPES,
  WS_EVENTS,
  CONNECTION_STATUS,
  AGENT_STATUS,
  MESSAGE_ROLES,
  MESSAGE_MODES,
  MODELS,
  API_ENDPOINTS,
  UI_CONSTANTS,
  STORAGE_KEYS,
  ERROR_TYPES,
  DEFAULTS,
  TERMINAL_CONFIG
};