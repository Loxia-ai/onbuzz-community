/**
 * Tool Command Constants
 * 
 * Centralized constants for tool command recognition and parsing
 * This ensures consistent tool identification across the system
 */

/**
 * Tool IDs - The canonical identifiers for each tool
 */
export const TOOL_IDS = {
  AGENT_COMMUNICATION: 'agentcommunication',
  TERMINAL: 'terminal',
  FILESYSTEM: 'filesystem',
  // BROWSER: 'browser', // DEPRECATED - use WEB instead
  AGENT_DELAY: 'agentdelay',
  JOB_DONE: 'jobdone',
  TASK_MANAGER: 'taskmanager',
  IMPORT_ANALYZER: 'import-analyzer',
  DEPENDENCY_RESOLVER: 'dependency-resolver',
  IMAGE_GEN: 'image-gen',
  VIDEO_GEN: 'video-gen',
  CLONE_DETECTION: 'clonedetection',
  FILE_TREE: 'file-tree',
  FILE_CONTENT_REPLACE: 'file-content-replace',
  SEEK: 'seek',
  WEB: 'web',
  STATIC_ANALYSIS: 'staticanalysis',
  HELP: 'help',
  PDF: 'pdf',
  DOC: 'doc',
  SPREADSHEET: 'spreadsheet',
  SKILLS: 'skills',
  VISION: 'vision'
};

/**
 * Agent Communication Tool Actions
 * These are the valid action types for the agent communication tool
 */
export const AGENT_COMM_ACTIONS = {
  GET_AVAILABLE: 'get-available-agents',
  SEND_MESSAGE: 'send-message',
  REPLY_MESSAGE: 'reply-to-message',
  GET_UNREPLIED: 'get-unreplied-messages',
  MARK_ENDED: 'mark-conversation-ended'
};

/**
 * Terminal Tool Actions
 */
export const TERMINAL_ACTIONS = {
  RUN_COMMAND: 'run-command',
  CHANGE_DIR: 'change-directory',
  LIST_DIR: 'list-directory',
  CREATE_DIR: 'create-directory',
  GET_CWD: 'get-working-directory'
};

/**
 * Filesystem Tool Actions
 */
export const FILESYSTEM_ACTIONS = {
  READ_FILE: 'read-file',
  WRITE_FILE: 'write-file',
  APPEND_FILE: 'append-file',
  DELETE_FILE: 'delete-file',
  LIST_FILES: 'list-files',
  CREATE_DIR: 'fs-create-directory',  // Prefixed to avoid conflict with terminal
  DELETE_DIR: 'fs-delete-directory',  // Prefixed for consistency
  MOVE_FILE: 'move-file',
  COPY_FILE: 'copy-file',
  GET_INFO: 'get-file-info'
};

/**
 * Browser Tool Actions
 * @deprecated Use WEB tool instead - Browser tool is deprecated as of December 2024
 */
export const BROWSER_ACTIONS = {
  NAVIGATE: 'navigate',
  CLICK: 'click',
  TYPE: 'type',
  SCREENSHOT: 'screenshot',
  GET_TEXT: 'get-text',
  WAIT: 'wait-for-element',
  SCROLL: 'scroll',
  CLOSE: 'close-browser'
};

/**
 * Job Done Tool Actions
 */
export const JOBDONE_ACTIONS = {
  COMPLETE: 'complete',
  COMPLETE_WITH_RESULT: 'complete-with-result',
  FAIL: 'fail-with-error'
};

/**
 * Agent Delay Tool Actions
 */
export const DELAY_ACTIONS = {
  DELAY: 'delay',
  PAUSE: 'pause'
};

/**
 * TaskManager Tool Actions
 */
export const TASK_MANAGER_ACTIONS = {
  CREATE: 'create',
  UPDATE: 'update',
  LIST: 'list',
  COMPLETE: 'complete',
  CANCEL: 'cancel',
  CLEAR: 'clear',
  DEPEND: 'depend',
  RELATE: 'relate',
  SUBTASK: 'subtask',
  PRIORITIZE: 'prioritize',
  TEMPLATE: 'template',
  PROGRESS: 'progress',
  ANALYTICS: 'analytics'
};

/**
 * Clone Detection Tool Actions
 */
export const CLONE_DETECTION_ACTIONS = {
  DETECT_CLONES: 'detect-clones'
};

/**
 * Help Tool Actions
 */
export const HELP_ACTIONS = {
  GET_DESCRIPTION: 'get-description',
  LIST_TOOLS: 'list-tools'
};

/**
 * PDF Tool Actions
 */
export const PDF_ACTIONS = {
  GET_INFO: 'get-info',
  READ_PAGES: 'read-pages',
  CREATE_PDF: 'create-pdf'
};

/**
 * Document (DOCX) Tool Actions
 */
export const DOC_ACTIONS = {
  GET_INFO: 'get-info',
  READ: 'read',
  CREATE: 'create'
};

/**
 * Spreadsheet (Excel) Tool Actions
 */
export const SPREADSHEET_ACTIONS = {
  GET_INFO: 'get-info',
  READ: 'read',
  CREATE: 'create'
};

/**
 * Skills Tool Actions
 */
export const SKILLS_ACTIONS = {
  LIST: 'list',
  DESCRIBE: 'describe',
  READ: 'read',
  READ_SECTION: 'read-section',
  READ_FILE: 'read-file',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  IMPORT: 'import'
};

/**
 * Tool Command Formats
 * JSON is the LLM industry standard format (preferred)
 * XML and bracket notation are supported for backward compatibility
 */
export const COMMAND_FORMATS = {
  JSON: 'json',           // Standard format: ```json {...} ```
  JSON_PLAIN: 'json-plain', // Plain JSON (fallback, not recommended)
  XML: 'xml',             // Legacy: <toolname>...</toolname>
  BRACKET: 'bracket',     // Legacy: [tool id="..."]...[/tool]
  REDIRECT: 'redirect'    // Agent redirects
};

/**
 * Tool Recognition Map
 * Maps action types to their corresponding tool IDs
 * This is the single source of truth for tool identification
 */
export const TOOL_ACTION_MAP = {
  // Agent Communication Tool
  [AGENT_COMM_ACTIONS.GET_AVAILABLE]: TOOL_IDS.AGENT_COMMUNICATION,
  [AGENT_COMM_ACTIONS.SEND_MESSAGE]: TOOL_IDS.AGENT_COMMUNICATION,
  [AGENT_COMM_ACTIONS.REPLY_MESSAGE]: TOOL_IDS.AGENT_COMMUNICATION,
  [AGENT_COMM_ACTIONS.GET_UNREPLIED]: TOOL_IDS.AGENT_COMMUNICATION,
  [AGENT_COMM_ACTIONS.MARK_ENDED]: TOOL_IDS.AGENT_COMMUNICATION,
  
  // Terminal Tool
  [TERMINAL_ACTIONS.RUN_COMMAND]: TOOL_IDS.TERMINAL,
  [TERMINAL_ACTIONS.CHANGE_DIR]: TOOL_IDS.TERMINAL,
  [TERMINAL_ACTIONS.LIST_DIR]: TOOL_IDS.TERMINAL,
  [TERMINAL_ACTIONS.CREATE_DIR]: TOOL_IDS.TERMINAL,
  [TERMINAL_ACTIONS.GET_CWD]: TOOL_IDS.TERMINAL,
  
  // Filesystem Tool
  [FILESYSTEM_ACTIONS.READ_FILE]: TOOL_IDS.FILESYSTEM,
  [FILESYSTEM_ACTIONS.WRITE_FILE]: TOOL_IDS.FILESYSTEM,
  [FILESYSTEM_ACTIONS.APPEND_FILE]: TOOL_IDS.FILESYSTEM,
  [FILESYSTEM_ACTIONS.DELETE_FILE]: TOOL_IDS.FILESYSTEM,
  [FILESYSTEM_ACTIONS.LIST_FILES]: TOOL_IDS.FILESYSTEM,
  [FILESYSTEM_ACTIONS.CREATE_DIR]: TOOL_IDS.FILESYSTEM,
  [FILESYSTEM_ACTIONS.DELETE_DIR]: TOOL_IDS.FILESYSTEM,
  [FILESYSTEM_ACTIONS.MOVE_FILE]: TOOL_IDS.FILESYSTEM,
  [FILESYSTEM_ACTIONS.COPY_FILE]: TOOL_IDS.FILESYSTEM,
  [FILESYSTEM_ACTIONS.GET_INFO]: TOOL_IDS.FILESYSTEM,
  
  // Browser Tool - DEPRECATED, use WEB tool instead
  // [BROWSER_ACTIONS.NAVIGATE]: TOOL_IDS.BROWSER,
  // [BROWSER_ACTIONS.CLICK]: TOOL_IDS.BROWSER,
  // [BROWSER_ACTIONS.TYPE]: TOOL_IDS.BROWSER,
  // [BROWSER_ACTIONS.SCREENSHOT]: TOOL_IDS.BROWSER,
  // [BROWSER_ACTIONS.GET_TEXT]: TOOL_IDS.BROWSER,
  // [BROWSER_ACTIONS.WAIT]: TOOL_IDS.BROWSER,
  // [BROWSER_ACTIONS.SCROLL]: TOOL_IDS.BROWSER,
  // [BROWSER_ACTIONS.CLOSE]: TOOL_IDS.BROWSER,
  
  // Job Done Tool
  [JOBDONE_ACTIONS.COMPLETE]: TOOL_IDS.JOB_DONE,
  [JOBDONE_ACTIONS.COMPLETE_WITH_RESULT]: TOOL_IDS.JOB_DONE,
  [JOBDONE_ACTIONS.FAIL]: TOOL_IDS.JOB_DONE,
  
  // Delay Tool
  [DELAY_ACTIONS.DELAY]: TOOL_IDS.AGENT_DELAY,
  [DELAY_ACTIONS.PAUSE]: TOOL_IDS.AGENT_DELAY,
  
  // TaskManager Tool
  [TASK_MANAGER_ACTIONS.CREATE]: TOOL_IDS.TASK_MANAGER,
  [TASK_MANAGER_ACTIONS.UPDATE]: TOOL_IDS.TASK_MANAGER,
  [TASK_MANAGER_ACTIONS.LIST]: TOOL_IDS.TASK_MANAGER,
  [TASK_MANAGER_ACTIONS.COMPLETE]: TOOL_IDS.TASK_MANAGER,
  [TASK_MANAGER_ACTIONS.CANCEL]: TOOL_IDS.TASK_MANAGER,
  [TASK_MANAGER_ACTIONS.CLEAR]: TOOL_IDS.TASK_MANAGER,
  [TASK_MANAGER_ACTIONS.DEPEND]: TOOL_IDS.TASK_MANAGER,
  [TASK_MANAGER_ACTIONS.RELATE]: TOOL_IDS.TASK_MANAGER,
  [TASK_MANAGER_ACTIONS.SUBTASK]: TOOL_IDS.TASK_MANAGER,
  [TASK_MANAGER_ACTIONS.PRIORITIZE]: TOOL_IDS.TASK_MANAGER,
  [TASK_MANAGER_ACTIONS.TEMPLATE]: TOOL_IDS.TASK_MANAGER,
  [TASK_MANAGER_ACTIONS.PROGRESS]: TOOL_IDS.TASK_MANAGER,
  [TASK_MANAGER_ACTIONS.ANALYTICS]: TOOL_IDS.TASK_MANAGER,

  // Clone Detection Tool
  [CLONE_DETECTION_ACTIONS.DETECT_CLONES]: TOOL_IDS.CLONE_DETECTION,

  // Help Tool
  [HELP_ACTIONS.GET_DESCRIPTION]: TOOL_IDS.HELP,
  [HELP_ACTIONS.LIST_TOOLS]: TOOL_IDS.HELP,

  // PDF Tool
  [PDF_ACTIONS.GET_INFO]: TOOL_IDS.PDF,
  [PDF_ACTIONS.READ_PAGES]: TOOL_IDS.PDF,
  [PDF_ACTIONS.CREATE_PDF]: TOOL_IDS.PDF,

  // Document (DOCX) Tool
  [DOC_ACTIONS.GET_INFO]: TOOL_IDS.DOC,
  [DOC_ACTIONS.READ]: TOOL_IDS.DOC,
  [DOC_ACTIONS.CREATE]: TOOL_IDS.DOC,

  // Spreadsheet (Excel) Tool
  [SPREADSHEET_ACTIONS.GET_INFO]: TOOL_IDS.SPREADSHEET,
  [SPREADSHEET_ACTIONS.READ]: TOOL_IDS.SPREADSHEET,
  [SPREADSHEET_ACTIONS.CREATE]: TOOL_IDS.SPREADSHEET,

  // Skills Tool
  [SKILLS_ACTIONS.LIST]: TOOL_IDS.SKILLS,
  [SKILLS_ACTIONS.DESCRIBE]: TOOL_IDS.SKILLS,
  [SKILLS_ACTIONS.READ]: TOOL_IDS.SKILLS,
  [SKILLS_ACTIONS.READ_SECTION]: TOOL_IDS.SKILLS,
  [SKILLS_ACTIONS.READ_FILE]: TOOL_IDS.SKILLS,
  [SKILLS_ACTIONS.CREATE]: TOOL_IDS.SKILLS,
  [SKILLS_ACTIONS.UPDATE]: TOOL_IDS.SKILLS,
  [SKILLS_ACTIONS.DELETE]: TOOL_IDS.SKILLS,
  [SKILLS_ACTIONS.IMPORT]: TOOL_IDS.SKILLS
};

/**
 * JSON Command Structure Types
 * Different JSON structures we support
 */
export const JSON_STRUCTURES = {
  // Standard format: {"toolId": "...", "parameters": {...}}
  STANDARD: 'standard',
  
  // Actions format: {"actions": [{"type": "...", ...}]}
  ACTIONS_ARRAY: 'actions-array',
  
  // Tool commands format: {"toolCommands": [{...}]}
  TOOL_COMMANDS: 'tool-commands',
  
  // Direct action format: {"type": "...", ...}
  DIRECT_ACTION: 'direct-action'
};

/**
 * Identify which JSON structure is being used
 */
export function identifyJsonStructure(jsonData) {
  if (!jsonData || typeof jsonData !== 'object') {
    return null;
  }
  
  if (jsonData.toolId && (jsonData.parameters || jsonData.actions)) {
    return JSON_STRUCTURES.STANDARD;
  }
  
  if (jsonData.actions && Array.isArray(jsonData.actions)) {
    return JSON_STRUCTURES.ACTIONS_ARRAY;
  }
  
  if (jsonData.toolCommands && Array.isArray(jsonData.toolCommands)) {
    return JSON_STRUCTURES.TOOL_COMMANDS;
  }
  
  if (jsonData.type && typeof jsonData.type === 'string') {
    return JSON_STRUCTURES.DIRECT_ACTION;
  }
  
  return null;
}

/**
 * Get tool ID from action type
 * This is the primary method for determining which tool to use
 */
export function getToolIdFromAction(actionType) {
  if (!actionType) return null;
  
  // Normalize the action type to handle case variations
  const normalizedAction = actionType.trim();
  
  // Direct lookup first (most efficient)
  if (TOOL_ACTION_MAP[normalizedAction]) {
    return TOOL_ACTION_MAP[normalizedAction];
  }
  
  // Case-insensitive lookup as fallback
  const lowerAction = normalizedAction.toLowerCase();
  for (const [action, toolId] of Object.entries(TOOL_ACTION_MAP)) {
    if (action.toLowerCase() === lowerAction) {
      return toolId;
    }
  }
  
  // Log unrecognized actions for debugging
  console.warn(`Unrecognized action type: "${actionType}"`);
  
  return null;
}

/**
 * Validate if a tool ID is valid
 */
export function isValidToolId(toolId) {
  return Object.values(TOOL_IDS).includes(toolId);
}

/**
 * Get all valid actions for a specific tool
 */
export function getToolActions(toolId) {
  const actions = [];
  for (const [action, tool] of Object.entries(TOOL_ACTION_MAP)) {
    if (tool === toolId) {
      actions.push(action);
    }
  }
  return actions;
}

/**
 * Export all constants for easy access
 */
export default {
  TOOL_IDS,
  AGENT_COMM_ACTIONS,
  TERMINAL_ACTIONS,
  FILESYSTEM_ACTIONS,
  BROWSER_ACTIONS,
  JOBDONE_ACTIONS,
  DELAY_ACTIONS,
  TASK_MANAGER_ACTIONS,
  CLONE_DETECTION_ACTIONS,
  HELP_ACTIONS,
  PDF_ACTIONS,
  DOC_ACTIONS,
  SPREADSHEET_ACTIONS,
  COMMAND_FORMATS,
  TOOL_ACTION_MAP,
  JSON_STRUCTURES,
  identifyJsonStructure,
  getToolIdFromAction,
  isValidToolId,
  getToolActions
};