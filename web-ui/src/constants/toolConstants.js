/**
 * Tool Constants for Frontend
 *
 * Mirrored from backend src/utilities/toolConstants.js
 * This ensures consistent tool identification across frontend and backend
 *
 * Tool Invocation Format:
 * The frontend renders tool invocations in JSON format only (LLM industry standard)
 * Format: ```json {"toolId": "...", "parameters": {...}} ```
 */

/**
 * Tool IDs - The canonical identifiers for each tool
 * These MUST match the backend TOOL_IDS exactly
 */
export const TOOL_IDS = {
  AGENT_COMMUNICATION: 'agentcommunication',
  TERMINAL: 'terminal',
  FILESYSTEM: 'filesystem',
  // BROWSER: 'browser', // DEPRECATED - use WEB instead
  WEB: 'web',
  AGENT_DELAY: 'agentdelay',
  JOB_DONE: 'jobdone',
  TASK_MANAGER: 'taskmanager',
  IMPORT_ANALYZER: 'import-analyzer',
  DEPENDENCY_RESOLVER: 'dependency-resolver',
  CLONE_DETECTION: 'clonedetection',
  FILE_TREE: 'file-tree',
  FILE_CONTENT_REPLACE: 'file-content-replace',
  SEEK: 'seek',
  STATIC_ANALYSIS: 'staticanalysis',
  VISUAL_EDITOR: 'visual-editor',
  PDF: 'pdf',
  HELP: 'help',
  DOC: 'doc',
  SPREADSHEET: 'spreadsheet',
  CODE_MAP: 'code-map',
  MEMORY: 'memory',
  SKILLS: 'skills',
  USER_PROMPT: 'userprompt',
  PLATFORM_CONTROL: 'platformcontrol',
  // widget-module: remove this line if the module is deleted.
  WIDGET: 'widget'
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
  READ: 'read',
  WRITE: 'write',
  APPEND: 'append',
  DELETE: 'delete',
  COPY: 'copy',
  MOVE: 'move',
  LIST: 'list',
  CREATE_DIR: 'create-dir',
  EXISTS: 'exists',
  STATS: 'stats'
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
 * Agent Communication Tool Actions
 */
export const AGENT_COMM_ACTIONS = {
  GET_AVAILABLE: 'get-available-agents',
  SEND_MESSAGE: 'send-message',
  REPLY_MESSAGE: 'reply-to-message',
  GET_UNREPLIED: 'get-unreplied-messages',
  MARK_ENDED: 'mark-conversation-ended'
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
 * Tool Display Names - Human-readable names for UI display
 */
export const TOOL_DISPLAY_NAMES = {
  [TOOL_IDS.AGENT_COMMUNICATION]: 'Agent Communication',
  [TOOL_IDS.TERMINAL]: 'Terminal',
  [TOOL_IDS.FILESYSTEM]: 'File System',
  [TOOL_IDS.WEB]: 'Web',
  [TOOL_IDS.AGENT_DELAY]: 'Agent Delay',
  [TOOL_IDS.JOB_DONE]: 'Job Done',
  [TOOL_IDS.TASK_MANAGER]: 'Task Manager',
  [TOOL_IDS.IMPORT_ANALYZER]: 'Import Analyzer',
  [TOOL_IDS.DEPENDENCY_RESOLVER]: 'Dependency Resolver',
  [TOOL_IDS.CLONE_DETECTION]: 'Clone Detection',
  [TOOL_IDS.FILE_TREE]: 'File Tree',
  [TOOL_IDS.FILE_CONTENT_REPLACE]: 'File Content Replace',
  [TOOL_IDS.SEEK]: 'Seek',
  [TOOL_IDS.STATIC_ANALYSIS]: 'Static Analysis',
  [TOOL_IDS.VISUAL_EDITOR]: 'Visual Editor',
  [TOOL_IDS.PDF]: 'PDF',
  [TOOL_IDS.HELP]: 'Help',
  [TOOL_IDS.DOC]: 'Document',
  [TOOL_IDS.SPREADSHEET]: 'Spreadsheet',
  [TOOL_IDS.CODE_MAP]: 'Code Map',
  [TOOL_IDS.MEMORY]: 'Memory',
  [TOOL_IDS.SKILLS]: 'Skills',
  [TOOL_IDS.USER_PROMPT]: 'User Prompt',
  [TOOL_IDS.PLATFORM_CONTROL]: 'Platform Control',
  // widget-module: remove this line if the module is deleted.
  [TOOL_IDS.WIDGET]: 'Widget'
};

/**
 * Tool Icons - Icon identifiers for each tool (used with Heroicons)
 */
export const TOOL_ICONS = {
  [TOOL_IDS.AGENT_COMMUNICATION]: 'ChatBubbleLeftRight',
  [TOOL_IDS.TERMINAL]: 'CommandLine',
  [TOOL_IDS.FILESYSTEM]: 'FolderOpen',
  [TOOL_IDS.WEB]: 'GlobeAlt',
  [TOOL_IDS.AGENT_DELAY]: 'Clock',
  [TOOL_IDS.JOB_DONE]: 'CheckCircle',
  [TOOL_IDS.TASK_MANAGER]: 'ClipboardDocumentList',
  [TOOL_IDS.IMPORT_ANALYZER]: 'MagnifyingGlass',
  [TOOL_IDS.DEPENDENCY_RESOLVER]: 'ArrowsPointingOut',
  [TOOL_IDS.CLONE_DETECTION]: 'DocumentDuplicate',
  [TOOL_IDS.FILE_TREE]: 'FolderTree',
  [TOOL_IDS.FILE_CONTENT_REPLACE]: 'DocumentText',
  [TOOL_IDS.SEEK]: 'MagnifyingGlassCircle',
  [TOOL_IDS.STATIC_ANALYSIS]: 'CodeBracket',
  [TOOL_IDS.VISUAL_EDITOR]: 'CursorArrowRays',
  [TOOL_IDS.PDF]: 'DocumentText',
  [TOOL_IDS.HELP]: 'QuestionMarkCircle',
  [TOOL_IDS.DOC]: 'DocumentText',
  [TOOL_IDS.SPREADSHEET]: 'TableCells',
  [TOOL_IDS.CODE_MAP]: 'MapIcon',
  [TOOL_IDS.MEMORY]: 'CircleStack',
  [TOOL_IDS.SKILLS]: 'BookOpen',
  [TOOL_IDS.USER_PROMPT]: 'QuestionMarkCircle',
  [TOOL_IDS.PLATFORM_CONTROL]: 'CalendarDays',
  // widget-module: remove this line if the module is deleted.
  [TOOL_IDS.WIDGET]: 'CodeBracket'
};

/**
 * Tools that should NEVER be auto-selected by templates or bulk
 * "select all" actions. The user must add them individually.
 *
 * Why: these tools grant cross-cutting platform power that almost no
 * agent should have by default. Adding them silently via "Custom
 * template" or the "All" button would surprise the user with
 * privileges they didn't realize they were granting.
 *
 * Adding a tool here OPTS IT OUT of:
 *   - AgentCreationModal CUSTOM template's auto-check
 *   - AgentCreationModal "All" button
 *   - AgentEditModal's legacy-agent-with-no-capabilities fallback
 *
 * Individual checkboxes are unaffected — the user can still pick the
 * tool deliberately.
 */
export const OPT_IN_ONLY_TOOLS = Object.freeze([
  TOOL_IDS.PLATFORM_CONTROL,
]);

/**
 * Strip opt-in-only tool ids from a list. Used at every "bulk select"
 * site so a single source of truth governs the policy.
 */
export function withoutOptInOnly(toolIds) {
  if (!Array.isArray(toolIds)) return [];
  const blocked = new Set(OPT_IN_ONLY_TOOLS);
  return toolIds.filter(id => !blocked.has(id));
}

/**
 * Validate if a tool ID is valid
 */
export function isValidToolId(toolId) {
  return Object.values(TOOL_IDS).includes(toolId);
}

/**
 * Get display name for a tool ID
 */
export function getToolDisplayName(toolId) {
  return TOOL_DISPLAY_NAMES[toolId] || toolId;
}

export default {
  TOOL_IDS,
  TASK_MANAGER_ACTIONS,
  TERMINAL_ACTIONS,
  FILESYSTEM_ACTIONS,
  BROWSER_ACTIONS,
  AGENT_COMM_ACTIONS,
  JOBDONE_ACTIONS,
  TOOL_DISPLAY_NAMES,
  TOOL_ICONS,
  OPT_IN_ONLY_TOOLS,
  withoutOptInOnly,
  isValidToolId,
  getToolDisplayName
};
