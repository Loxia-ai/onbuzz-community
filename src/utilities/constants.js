/**
 * Constants - Centralized constants and enums for the Loxia AI Agents System
 * 
 * Purpose:
 * - Eliminate magic values throughout the codebase
 * - Provide centralized configuration constants
 * - Define enums for system states and types
 * - Ensure consistency across modules
 */

// System Configuration Constants
const SYSTEM_DEFAULTS = {
  MAX_AGENTS_PER_PROJECT: 50,
  QUALITY_INSPECTOR_INTERVAL: 10,
  DEFAULT_MODEL: 'anthropic-sonnet',
  STATE_DIRECTORY: '.loxia-state',
  MAX_PAUSE_DURATION: 300, // seconds
  MAX_CONTEXT_SIZE: 50000, // characters
  MAX_CONTEXT_REFERENCES: 10,
  CACHE_EXPIRY: 3600, // seconds
  MAX_MESSAGE_SIZE: 100000, // characters
  MAX_FILE_SIZE: 10485760, // 10MB
  MAX_ASYNC_OPERATIONS: 5,
  MAX_TOOL_EXECUTION_TIME: 300000, // 5 minutes
  MAX_CONVERSATION_LENGTH: 50000 // tokens
};

// Model Router Configuration
const MODEL_ROUTER_CONFIG = {
  ROUTER_MODEL: 'autopilot-model-router', // Autopilot model router deployment
  CONTEXT_MESSAGES_COUNT: 5, // Number of recent messages to include
  BENCHMARK_REFRESH_INTERVAL: 3600000, // 1 hour in milliseconds
  FALLBACK_ON_ERROR: true, // Continue with previous model on router error
  REQUEST_TIMEOUT: 10000, // 10 seconds timeout for router requests
  MAX_ROUTING_STRATEGY_LENGTH: 2000 // Max chars for per-agent routing strategy
};

// Interface Types
const INTERFACE_TYPES = {
  CLI: 'cli',
  WEB: 'web',
  VSCODE: 'vscode',
  TELEGRAM: 'telegram',
  DISCORD: 'discord'
};

// Agent Types
const AGENT_TYPES = {
  USER_CREATED: 'user-created',
  SYSTEM_AGENT: 'system-agent',
  AGENT_ENGINEER: 'agent-engineer'
};

// Agent Status
const AGENT_STATUS = {
  ACTIVE: 'active',
  IDLE: 'idle',
  BUSY: 'busy',
  SUSPENDED: 'suspended',
  PAUSED: 'paused'
};

// Agent Modes
const AGENT_MODES = {
  CHAT: 'chat',           // Default: single message → single response
  AGENT: 'agent'          // Autonomous: task → loop until complete (persistent mode)
};

// Agent Mode States
const AGENT_MODE_STATES = {
  IDLE: 'idle',              // Not executing anything
  EXECUTING: 'executing',    // Currently processing autonomous task
  WAITING_APPROVAL: 'waiting_approval', // Paused for user approval
  STOPPED: 'stopped'         // User stopped execution
};

// Message Modes
const MESSAGE_MODES = {
  CHAT: 'chat',
  AGENT: 'agent'
};

// Message Roles
const MESSAGE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system'
};

// Context Reference Types
const CONTEXT_REFERENCE_TYPES = {
  FILE: 'file',
  COMPONENT: 'component',
  SELECTION: 'selection',
  DIRECTORY: 'directory'
};

// Tool Status
const TOOL_STATUS = {
  PENDING: 'pending',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Operation Status
const OPERATION_STATUS = {
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  NOT_FOUND: 'not_found'
};

// Conversation Status
const CONVERSATION_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  SUSPENDED: 'suspended'
};

// Error Types
const ERROR_TYPES = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  OPERATION_TIMEOUT: 'OPERATION_TIMEOUT',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR'
};

// HTTP Status Codes
const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// Model Providers
const MODEL_PROVIDERS = {
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  AZURE: 'azure',
  DEEPSEEK: 'deepseek',
  PHI: 'phi',
  OLLAMA: 'ollama'
};

// Model Names
const MODELS = { //TODO:update with moedels from server
  ANTHROPIC_OPUS: 'anthropic-opus',
  ANTHROPIC_SONNET: 'anthropic-sonnet',
  ANTHROPIC_HAIKU: 'anthropic-haiku',
  GPT_4: 'gpt-4',
  GPT_4_MINI: 'gpt-4-mini',
  GPT_5_1_CODEX_MINI: 'gpt-5.1-codex-mini',
  DEEPSEEK_R1: 'deepseek-r1',
  PHI_4: 'phi-4',
  PHI_4_REASONING: 'phi-4-reasoning'
};

// Platform Model IDs (with prefixes)
const PLATFORM_MODELS = {
  LOXIA_ANTHROPIC_OPUS: 'loxia-anthropic-opus',
  LOXIA_ANTHROPIC_SONNET: 'loxia-anthropic-sonnet',
  LOXIA_ANTHROPIC_HAIKU: 'loxia-anthropic-haiku',
  LOXIA_GPT_4: 'loxia-gpt-4',
  LOXIA_GPT_4_MINI: 'loxia-gpt-4-mini',
  LOXIA_GPT_5_1_CODEX_MINI: 'loxia-gpt-5.1-codex-mini',
  LOXIA_DEEPSEEK_R1: 'loxia-deepseek-r1',
  LOXIA_PHI_4: 'loxia-phi-4',
  LOXIA_PHI_4_REASONING: 'loxia-phi-4-reasoning'
};

// Direct Access Model IDs (with prefixes)
const DIRECT_MODELS = {
  DIRECT_ANTHROPIC_OPUS: 'direct-anthropic-opus',
  DIRECT_ANTHROPIC_SONNET: 'direct-anthropic-sonnet',
  DIRECT_ANTHROPIC_HAIKU: 'direct-anthropic-haiku',
  DIRECT_GPT_4: 'direct-gpt-4',
  DIRECT_GPT_4_MINI: 'direct-gpt-4-mini',
  DIRECT_GPT_5_1_CODEX_MINI: 'direct-gpt-5.1-codex-mini',
  DIRECT_DEEPSEEK_R1: 'direct-deepseek-r1',
  DIRECT_PHI_4: 'direct-phi-4',
  DIRECT_PHI_4_REASONING: 'direct-phi-4-reasoning'
};

// Model Format Versions
const MODEL_FORMAT_VERSIONS = {
  [MODELS.ANTHROPIC_OPUS]: 'anthropic-v1',
  [MODELS.ANTHROPIC_SONNET]: 'anthropic-v1',
  [MODELS.ANTHROPIC_HAIKU]: 'anthropic-v1',
  [MODELS.GPT_4]: 'openai-v1',
  [MODELS.GPT_4_MINI]: 'openai-v1',
  [MODELS.GPT_5_1_CODEX_MINI]: 'openai-v1',
  [MODELS.DEEPSEEK_R1]: 'deepseek-v1',
  [MODELS.PHI_4]: 'phi-v1',
  [MODELS.PHI_4_REASONING]: 'phi-v1',
  DEFAULT: 'generic-v1'
};

// Tool Names
const TOOL_NAMES = {
  TERMINAL: 'terminal',
  FILESYSTEM: 'filesystem',
  BROWSER: 'browser',
  AGENT_DELAY: 'agentdelay',
  EDITOR: 'editor',
  GIT: 'git',
  DATABASE: 'database'
};

// File Extensions and Languages
const FILE_EXTENSIONS = {
  JAVASCRIPT: '.js',
  JSX: '.jsx',
  TYPESCRIPT: '.ts',
  TSX: '.tsx',
  PYTHON: '.py',
  JAVA: '.java',
  CPP: '.cpp',
  C: '.c',
  CSHARP: '.cs',
  PHP: '.php',
  RUBY: '.rb',
  GO: '.go',
  RUST: '.rs',
  HTML: '.html',
  CSS: '.css',
  SCSS: '.scss',
  JSON: '.json',
  YAML: '.yml',
  YAML_ALT: '.yaml',
  MARKDOWN: '.md',
  XML: '.xml',
  SQL: '.sql'
};

const LANGUAGE_MAPPING = {
  [FILE_EXTENSIONS.JAVASCRIPT]: 'javascript',
  [FILE_EXTENSIONS.JSX]: 'jsx',
  [FILE_EXTENSIONS.TYPESCRIPT]: 'typescript',
  [FILE_EXTENSIONS.TSX]: 'tsx',
  [FILE_EXTENSIONS.PYTHON]: 'python',
  [FILE_EXTENSIONS.JAVA]: 'java',
  [FILE_EXTENSIONS.CPP]: 'cpp',
  [FILE_EXTENSIONS.C]: 'c',
  [FILE_EXTENSIONS.CSHARP]: 'csharp',
  [FILE_EXTENSIONS.PHP]: 'php',
  [FILE_EXTENSIONS.RUBY]: 'ruby',
  [FILE_EXTENSIONS.GO]: 'go',
  [FILE_EXTENSIONS.RUST]: 'rust',
  [FILE_EXTENSIONS.HTML]: 'html',
  [FILE_EXTENSIONS.CSS]: 'css',
  [FILE_EXTENSIONS.SCSS]: 'scss',
  [FILE_EXTENSIONS.JSON]: 'json',
  [FILE_EXTENSIONS.YAML]: 'yaml',
  [FILE_EXTENSIONS.YAML_ALT]: 'yaml',
  [FILE_EXTENSIONS.MARKDOWN]: 'markdown',
  [FILE_EXTENSIONS.XML]: 'xml',
  [FILE_EXTENSIONS.SQL]: 'sql'
};

// File Icons
const FILE_ICONS = {
  [FILE_EXTENSIONS.JAVASCRIPT]: '📜',
  [FILE_EXTENSIONS.JSX]: '⚛️',
  [FILE_EXTENSIONS.TYPESCRIPT]: '📘',
  [FILE_EXTENSIONS.TSX]: '⚛️',
  [FILE_EXTENSIONS.PYTHON]: '🐍',
  [FILE_EXTENSIONS.JAVA]: '☕',
  [FILE_EXTENSIONS.HTML]: '🌐',
  [FILE_EXTENSIONS.CSS]: '🎨',
  [FILE_EXTENSIONS.JSON]: '📋',
  [FILE_EXTENSIONS.MARKDOWN]: '📝',
  [FILE_EXTENSIONS.YAML]: '⚙️',
  [FILE_EXTENSIONS.YAML_ALT]: '⚙️',
  DEFAULT: '📄'
};

// Context Icons
const CONTEXT_ICONS = {
  [CONTEXT_REFERENCE_TYPES.FILE]: '📄',
  [CONTEXT_REFERENCE_TYPES.COMPONENT]: '🔧',
  [CONTEXT_REFERENCE_TYPES.SELECTION]: '✂️',
  [CONTEXT_REFERENCE_TYPES.DIRECTORY]: '📁',
  DEFAULT: '📎'
};

// State File Names
const STATE_FILES = {
  PROJECT_STATE: 'project-state.json',
  AGENT_INDEX: 'agent-index.json',
  CONVERSATION_INDEX: 'conversation-index.json',
  LAST_SESSION: 'last-session.json',
  CONTEXT_REFERENCES: 'context-references.json',
  ASYNC_OPERATIONS: 'operations/async-operations.json',
  PAUSED_AGENTS: 'operations/paused-agents.json',
  TOOL_HISTORY: 'operations/tool-history.json',
  MODEL_ROUTER_CACHE: 'models/model-router-cache.json',
  ERROR_RECOVERY_LOG: 'models/error-recovery-log.json'
};

// State Directory Structure
const STATE_DIRECTORIES = {
  ROOT: '.loxia-state',
  AGENTS: 'agents',
  OPERATIONS: 'operations',
  MODELS: 'models',
  FLOWS: 'flows',
  FLOW_RUNS: 'flow-runs'
};

// Quality Inspector Configuration
const QUALITY_INSPECTOR_CONFIG = {
  CHECK_INTERVAL_MESSAGES: 10,
  STUCK_PATTERNS: [
    'repetitive_commands',
    'infinite_waiting',
    'error_loops',
    'resource_exhaustion'
  ],
  INTERVENTION_THRESHOLD: 3,
  COOLDOWN_PERIOD: 300000 // 5 minutes
};

// Orchestrator Actions
const ORCHESTRATOR_ACTIONS = {
  CREATE_AGENT: 'create_agent',
  UPDATE_AGENT: 'update_agent',
  DELETE_AGENT: 'delete_agent',
  UNLOAD_AGENT: 'unload_agent',
  SEND_MESSAGE: 'send_message',
  LIST_AGENTS: 'list_agents',
  RESUME_SESSION: 'resume_session',
  GET_SESSION_STATE: 'get_session_state',
  PAUSE_AGENT: 'pause_agent',
  RESUME_AGENT: 'resume_agent',
  SWITCH_MODEL: 'switch_model',
  GET_AGENT_STATUS: 'get_agent_status',
  GET_AGENT_CONVERSATIONS: 'get_agent_conversations',
  // Team operations
  CREATE_TEAM: 'create_team',
  UPDATE_TEAM: 'update_team',
  DELETE_TEAM: 'delete_team',
  LOAD_TEAM: 'load_team',
  LIST_TEAMS: 'list_teams',
  ADD_AGENT_TO_TEAM: 'add_agent_to_team',
  REMOVE_AGENT_FROM_TEAM: 'remove_agent_from_team',
  // Flow operations
  CREATE_FLOW: 'create_flow',
  UPDATE_FLOW: 'update_flow',
  DELETE_FLOW: 'delete_flow',
  GET_FLOW: 'get_flow',
  LIST_FLOWS: 'list_flows',
  EXECUTE_FLOW: 'execute_flow',
  STOP_FLOW: 'stop_flow',
  GET_FLOW_RUN: 'get_flow_run',
  LIST_FLOW_RUNS: 'list_flow_runs'
};

// Message Types
const MESSAGE_TYPES = {
  AGENT_NOTIFICATION: 'agent_notification',
  AGENT_REDIRECT: 'agent_redirect',
  TOOL_COMPLETION: 'tool_completion',
  SYSTEM_MESSAGE: 'system_message',
  AGENT_COMMUNICATION: 'agent_communication'  // Inter-agent messages
};

// Inter-Agent Message Processing Configuration
const INTER_AGENT_MESSAGE = {
  // Processing priorities
  PRIORITY: {
    LOW: 'low',
    NORMAL: 'normal', 
    HIGH: 'high',
    URGENT: 'urgent'
  },
  
  // Processing delays (in milliseconds) - avoid magic numbers
  PROCESSING_DELAY: {
    IMMEDIATE: 0,         // Process immediately
    SHORT: 500,           // Half second delay
    NORMAL: 2000,         // 2 seconds delay
    LONG: 5000           // 5 seconds delay
  },
  
  // Queue and processing limits
  MAX_QUEUE_SIZE: 100,               // Maximum messages in queue per agent
  MAX_PROCESSING_RETRIES: 3,         // Maximum retry attempts
  PROCESSING_TIMEOUT: 30000,         // 30 seconds timeout for processing
  
  // Auto-response configuration
  AUTO_RESPONSE_ENABLED: true,       // Enable automatic responses
  REQUIRE_AGENT_MODE: false,         // If true, only respond in AGENT mode
  PRESERVE_CONTEXT: true             // Maintain conversation context during response
};

// Agent Redirect Attributes
const AGENT_REDIRECT_ATTRIBUTES = {
  URGENT: 'urgent',
  REQUIRES_RESPONSE: 'requiresResponse',
  CONTEXT: 'context'
};

// Budget and usage tracking constants
const BUDGET_LIMITS = {
  DAILY: 10.00,    // $10 per day default
  WEEKLY: 50.00,   // $50 per week default
  MONTHLY: 200.00  // $200 per month default
};

const COST_PER_TOKEN = {
  [MODELS.ANTHROPIC_OPUS]: {
    input: 0.000015,   // $15 per 1M input tokens
    output: 0.000075   // $75 per 1M output tokens
  },
  [MODELS.ANTHROPIC_SONNET]: {
    input: 0.000003,   // $3 per 1M input tokens
    output: 0.000015   // $15 per 1M output tokens
  },
  [MODELS.ANTHROPIC_HAIKU]: {
    input: 0.00000025, // $0.25 per 1M input tokens
    output: 0.00000125 // $1.25 per 1M output tokens
  },
  [MODELS.GPT_4]: {
    input: 0.000030,   // $30 per 1M input tokens
    output: 0.000060   // $60 per 1M output tokens
  },
  [MODELS.GPT_4_MINI]: {
    input: 0.000000150, // $0.15 per 1M input tokens
    output: 0.000000600 // $0.60 per 1M output tokens
  },
  [MODELS.GPT_5_1_CODEX_MINI]: {
    input: 0.000002,   // $2 per 1M input tokens
    output: 0.000008   // $8 per 1M output tokens
  },
  [MODELS.DEEPSEEK_R1]: {
    input: 0.000014,   // $14 per 1M input tokens
    output: 0.000028   // $28 per 1M output tokens
  },
  [MODELS.PHI_4]: {
    input: 0.0000015,  // $1.5 per 1M input tokens
    output: 0.0000025  // $2.5 per 1M output tokens
  },
  [MODELS.PHI_4_REASONING]: {
    input: 0.0000015,  // $1.5 per 1M input tokens
    output: 0.0000025  // $2.5 per 1M output tokens
  }
};

const USAGE_ALERTS = {
  THRESHOLDS: [50, 75, 90, 100], // Percentage thresholds for alerts
  COOLDOWN_PERIOD: 3600000 // 1 hour cooldown between alerts
};

// WebSocket Events
const WS_EVENTS = {
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
const CONNECTION_STATUS = {
  CONNECTED: 'connected',
  CONNECTING: 'connecting',
  DISCONNECTED: 'disconnected',
  ERROR: 'error'
};

// Themes
const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system'
};

// Notification Types
const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
};

// Orchestrator Status
const ORCHESTRATOR_STATUS = {
  INITIALIZING: 'initializing',
  RUNNING: 'running',
  PAUSED: 'paused',
  ERROR: 'error',
  STOPPED: 'stopped'
};

// Static Code Analysis Constants
const STATIC_ANALYSIS = {
  // Error severities
  SEVERITY: {
    CRITICAL: 'critical',
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info',
    SUGGESTION: 'suggestion'
  },

  // Error categories
  CATEGORY: {
    SYNTAX: 'syntax',
    TYPE: 'type',
    IMPORT: 'import',
    STYLE: 'style',
    SECURITY: 'security',
    PERFORMANCE: 'performance',
    BEST_PRACTICE: 'best_practice'
  },

  // Supported languages
  LANGUAGE: {
    JAVASCRIPT: 'javascript',
    TYPESCRIPT: 'typescript',
    PYTHON: 'python',
    CSS: 'css',
    SCSS: 'scss',
    LESS: 'less',
    GO: 'go',
    JAVA: 'java',
    CSHARP: 'csharp',
    RUBY: 'ruby',
    PHP: 'php',
    RUST: 'rust',
    CPP: 'cpp',
    C: 'c'
  },

  // File extension to language mapping
  EXTENSION_TO_LANGUAGE: {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'scss',
    '.less': 'less',
    '.go': 'go',
    '.java': 'java',
    '.cs': 'csharp',
    '.rb': 'ruby',
    '.php': 'php',
    '.rs': 'rust',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.hpp': 'cpp'
  },

  // Framework manifest files
  FRAMEWORK_MANIFESTS: {
    JAVASCRIPT: 'package.json',
    PYTHON: 'requirements.txt',
    PYTHON_POETRY: 'pyproject.toml',
    PYTHON_PIPENV: 'Pipfile',
    GO: 'go.mod',
    JAVA_MAVEN: 'pom.xml',
    JAVA_GRADLE: 'build.gradle',
    RUBY: 'Gemfile',
    PHP: 'composer.json',
    RUST: 'Cargo.toml',
    CSHARP: '*.csproj'
  },

  // JavaScript/TypeScript frameworks
  JS_FRAMEWORKS: {
    REACT: 'react',
    VUE: 'vue',
    ANGULAR: '@angular/core',
    SVELTE: 'svelte',
    NEXT: 'next',
    NUXT: 'nuxt',
    EXPRESS: 'express',
    NEST: '@nestjs/core',
    FASTIFY: 'fastify',
    KOA: 'koa'
  },

  // Python frameworks
  PYTHON_FRAMEWORKS: {
    DJANGO: 'django',
    FLASK: 'flask',
    FASTAPI: 'fastapi',
    TORNADO: 'tornado',
    PYRAMID: 'pyramid',
    BOTTLE: 'bottle'
  },

  // Analysis settings
  MAX_FILE_SIZE_FOR_ANALYSIS: 5242880, // 5MB
  MAX_FILES_PER_BATCH: 100,
  ANALYSIS_TIMEOUT: 60000, // 60 seconds per file
  ENABLE_CACHE: true,
  CACHE_DURATION: 300000 // 5 minutes
};

// Conversation Compactization Configuration
const COMPACTION_CONFIG = {
  // Thresholds and triggers
  DEFAULT_THRESHOLD: 0.7, // 70% of context window
  MIN_THRESHOLD: 0.6, // Minimum allowed threshold (60%)
  MAX_THRESHOLD: 0.9, // Maximum allowed threshold (90%)

  // Tail-preserving compaction: summarize oldest messages, keep recent
  TAIL_PRESERVE_PERCENTAGE: 0.50, // Keep the most recent 50% of chars verbatim

  // Multi-pass compaction
  MAX_COMPACTION_PASSES: 3, // Maximum summarization passes per compaction

  // Segment constraints
  MIN_MIDDLE_SEGMENT_PERCENTAGE: 0.50, // Middle must be at least 50% of messages
  MAX_BOOKEND_PERCENTAGE: 0.50, // Beginning + end together capped at 50%

  // Recommended model pool for compaction (validated against live model catalog at runtime)
  // Names MUST match catalog keys exactly (no azure-openai- prefix)
  // Ordered by context window size (largest first) to handle very large conversations
  COMPACTION_MODELS: [
    'gpt-5.1-codex-mini',           // 400K context - best for large conversations
    'gpt-5-mini',                   // 400K context
    'gpt-5-nano',                   // 400K context - lightweight
    'o4-mini'                       // 128K context - reasoning model
  ],

  // Context windows for recommended compaction models (fallback if modelsService unavailable)
  MODEL_CONTEXT_WINDOWS: {
    'gpt-5.1-codex-mini': 400000,
    'gpt-5-mini': 400000,
    'gpt-5-nano': 400000,
    'o4-mini': 128000
  },

  // Token limits
  MAX_OUTPUT_TOKENS: 10000, // Hard ceiling on AI response tokens (used by aiService + compaction check)
  MAX_SUMMARY_TOKENS: 8000, // Max tokens for summary generation
  MIN_MESSAGES_FOR_COMPACTION: 10, // Don't compact tiny conversations

  // Token estimation (used when no AI response data exists)
  CHARS_PER_TOKEN_ESTIMATE: 3, // Conservative: 1 token ~ 3 characters

  // Summary markers
  COMPACTION_SUMMARY_PREFIX: '[CONVERSATION SUMMARY',
  COMPACTION_SUMMARY_SUFFIX: '[END SUMMARY]',

  // Timeouts
  COMPACTION_TIMEOUT_MS: 30000, // 30 seconds max for compaction

  // Oversized message splitting
  OVERSIZED_MESSAGE_THRESHOLD: 50000,  // 50K chars (~16K tokens) — messages larger than this get split
  MAX_CHUNK_SIZE: 30000,               // 30K chars (~10K tokens) — target size for each chunk

  // Summarizer budget overhead — subtracted from summarizer's context window to get usable capacity
  SUMMARIZER_SYSTEM_PROMPT_OVERHEAD: 500,   // tokens reserved for compaction system prompt
  SUMMARIZER_TEMPLATE_OVERHEAD: 800,        // tokens for the summary prompt template text
  SUMMARIZER_SAFETY_MARGIN: 5000,           // token buffer for estimation inaccuracy

  // Quality validation
  MIN_REDUCTION_PERCENTAGE: 10, // Compaction must reduce by at least 10%
  MAX_ACCEPTABLE_TOKEN_COUNT_AFTER: 0.85, // After compaction, should be below 85% of context
};

// Compaction strategies
const COMPACTION_STRATEGIES = {
  SUMMARIZATION: 'summarization', // AI-based summarization (sandwich approach)
};

// Compaction status for UI feedback
const COMPACTION_STATUS = {
  IDLE: 'idle',
  STARTING: 'starting',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

// Agent Scheduler Configuration
const SCHEDULER_CONFIG = {
  // Timing configuration (milliseconds)
  ITERATION_DELAY_MS: 1000, // Delay between scheduler cycles

  // Parallel processing - worker pool pattern
  MAX_CONCURRENT_AGENTS: 3, // Max agents processed in parallel (worker pool size)

  // Repetition detection - sliding window approach
  // We track recent state hashes to detect when agent is stuck in a loop
  STATE_HASH_WINDOW_SIZE: 20, // Size of sliding window for repetition detection
  REPETITION_THRESHOLD: 5, // Same hash appearing this many times in window = loop detected

  // Recovery delays (milliseconds)
  API_KEY_ERROR_DELAY_MS: 5 * 60 * 1000, // 5 minutes for API key issues
  RATE_LIMIT_DELAY_MS: 2 * 60 * 1000, // 2 minutes for rate limiting
  NETWORK_ERROR_DELAY_MS: 30 * 1000, // 30 seconds for network issues
  UNKNOWN_ERROR_DELAY_MS: 60 * 1000, // 1 minute for unknown errors

  // Recent message threshold for inter-agent tracking
  RECENT_MESSAGE_THRESHOLD_MS: 10 * 60 * 1000, // 10 minutes

  // Consecutive messages without tool usage tracking (AGENT mode only)
  // Reminds agents to maintain their task list when not using tools
  CONSECUTIVE_NO_TOOL_THRESHOLD: 3, // After this many messages without tools, inject reminder
  CONSECUTIVE_NO_TOOL_ENABLED: true, // Feature toggle

  // AI call watchdog — aborts the request if no bytes come back before this elapses.
  // For streaming calls the timer is cleared on the first chunk; for non-streaming
  // it applies to the whole call. Without this, a hung model call wedges the
  // per-agent processing lock indefinitely.
  AI_PRESTREAM_TIMEOUT_MS: 60 * 1000,

  // Empty-response stall detection — when the model returns a response whose
  // content is empty or whitespace-only AND carries no tool calls, the cycle
  // made no progress. We keep retrying (the next cycle may get a real
  // response), but we don't pollute stateHashHistory with phantom records and
  // we surface a user-facing error + switch to CHAT once the stall has gone on
  // long enough.
  EMPTY_RESPONSE_STALL_THRESHOLD: 5,           // number of empties to tolerate
  EMPTY_RESPONSE_STALL_WINDOW_MS: 60 * 1000,   // within this elapsed time
};

// Agent Activity Status - reasons for activation/deactivation
const AGENT_ACTIVITY_STATUS = {
  // Active reasons
  HAS_PENDING_TASKS: 'has-pending-tasks',
  HAS_QUEUED_MESSAGES: 'has-queued-messages',
  HAS_USER_MESSAGES: 'has-user-messages',
  HAS_INTER_AGENT_MESSAGES: 'has-inter-agent-messages',
  HAS_TOOL_RESULTS: 'has-tool-results',
  AUTONOMOUS_MODE_ACTIVE: 'autonomous-mode-active',
  HAS_TTL_REMAINING: 'has-ttl-remaining', // Agent has TTL cycles remaining

  // Inactive reasons
  AGENT_NOT_FOUND: 'agent-not-found',
  AGENT_INACTIVE_STATUS: 'agent-inactive-status',
  AGENT_DELAYED: 'agent-delayed',
  AGENT_PAUSED: 'agent-paused',
  AWAITING_USER_INPUT: 'awaiting-user-input',
  STOP_REQUESTED: 'stop-requested',
  NO_PENDING_WORK: 'no-pending-work',
  CHAT_MODE_NO_MESSAGES: 'chat-mode-no-messages',
  UNKNOWN_MODE: 'unknown-mode',
  JOB_DONE_EXECUTED: 'job-done-executed',
};

// Scheduler trigger sources - what caused an agent to be considered for scheduling
const SCHEDULER_TRIGGERS = {
  SCHEDULER_STARTUP: 'scheduler-startup',
  MODE_CHANGE_TO_AGENT: 'mode-change-to-agent',
  MODE_CHANGE_TO_CHAT: 'mode-change-to-chat',
  USER_MESSAGE: 'user-message',
  INTER_AGENT_MESSAGE: 'inter-agent-message',
  TOOL_COMPLETION: 'tool-completion',
  STOPPED_BY_USER: 'stopped-by-user',
  PROCESSING_COMPLETED: 'processing-completed',
  PROCESSING_ERROR: 'processing-error',
};

// Task status values
const TASK_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  BLOCKED: 'blocked',
  FAILED: 'failed',
};

// Task priority levels
const TASK_PRIORITY = {
  URGENT: 'urgent',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

// Task priority order (lower number = higher priority)
const TASK_PRIORITY_ORDER = {
  [TASK_PRIORITY.URGENT]: 0,
  [TASK_PRIORITY.HIGH]: 1,
  [TASK_PRIORITY.MEDIUM]: 2,
  [TASK_PRIORITY.LOW]: 3,
};

// Terminal Tool Configuration
const TERMINAL_CONFIG = {
  // Output retrieval defaults
  DEFAULT_TAIL_LINES: 100,           // Default number of lines for getTaskOutput
  EXPANDED_VIEW_TAIL_LINES: 50,      // Lines shown in expanded dropdown view
  MAX_OUTPUT_LENGTH: 50000,          // Max characters for output retrieval

  // UI refresh/polling
  POLLING_INTERVAL_MS: 2000,         // Polling interval for task updates

  // Recent tasks limits
  RECENT_TASKS_LIMIT: 20,            // Max recent tasks to fetch from backend
  RECENT_TASKS_UI_LIMIT: 10,         // Max recent tasks shown in UI dropdown

  // Task states
  STATES: {
    RUNNING: 'running',
    WAITING_FOR_INPUT: 'waiting_for_input',
    COMPLETED: 'completed',
    FAILED: 'failed'
  }
};

// Version — read from package.json via createRequire so the displayed
// version always matches the published package without a manual bump.
// We use createRequire (not `import { readFileSync } from 'fs'`) because
// some tests mock the 'fs' module shape; createRequire bypasses the
// mock and reads package.json directly via Node's built-in require.
import { createRequire as _createRequire } from 'module';
const _require = _createRequire(import.meta.url);
let _pkgVersion = '0.0.0';
try {
  _pkgVersion = _require('../../package.json').version || _pkgVersion;
} catch { /* ignore — fall back to default */ }
const SYSTEM_VERSION = _pkgVersion;

// Export all constants using ES module syntax
export {
  SYSTEM_DEFAULTS,
  MODEL_ROUTER_CONFIG,
  INTERFACE_TYPES,
  AGENT_TYPES,
  AGENT_STATUS,
  AGENT_MODES,
  AGENT_MODE_STATES,
  MESSAGE_MODES,
  MESSAGE_ROLES,
  CONTEXT_REFERENCE_TYPES,
  TOOL_STATUS,
  OPERATION_STATUS,
  CONVERSATION_STATUS,
  ERROR_TYPES,
  HTTP_STATUS,
  MODEL_PROVIDERS,
  MODELS,
  PLATFORM_MODELS,
  DIRECT_MODELS,
  MODEL_FORMAT_VERSIONS,
  TOOL_NAMES,
  FILE_EXTENSIONS,
  LANGUAGE_MAPPING,
  FILE_ICONS,
  CONTEXT_ICONS,
  STATE_FILES,
  STATE_DIRECTORIES,
  QUALITY_INSPECTOR_CONFIG,
  ORCHESTRATOR_ACTIONS,
  MESSAGE_TYPES,
  INTER_AGENT_MESSAGE,
  AGENT_REDIRECT_ATTRIBUTES,
  BUDGET_LIMITS,
  COST_PER_TOKEN,
  USAGE_ALERTS,
  WS_EVENTS,
  CONNECTION_STATUS,
  THEMES,
  NOTIFICATION_TYPES,
  ORCHESTRATOR_STATUS,
  STATIC_ANALYSIS,
  COMPACTION_CONFIG,
  COMPACTION_STRATEGIES,
  COMPACTION_STATUS,
  SCHEDULER_CONFIG,
  AGENT_ACTIVITY_STATUS,
  SCHEDULER_TRIGGERS,
  TASK_STATUS,
  TASK_PRIORITY,
  TASK_PRIORITY_ORDER,
  TERMINAL_CONFIG,
  SYSTEM_VERSION
};