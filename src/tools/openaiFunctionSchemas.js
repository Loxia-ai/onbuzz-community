/**
 * OpenAI-compatible function schemas for the CLI's tool catalog.
 *
 * Purpose:
 * Reasoning models on the Responses API (codex, o-series, gpt-5-pro) are
 * RLHFed against the CLI's inline JSON-block protocol and need native
 * function declarations to emit tool calls. The CLI owns these schemas
 * (tools + their rendering are a CLI concern, never a backend concern) and
 * passes them through the chat payload's `options.tools` field. The Azure
 * backend forwards them verbatim to the Responses API and converts incoming
 * function_call SSE events back into the CLI's inline JSON-block format.
 *
 * Shape convention:
 * Each schema mirrors the `parsedData` shape expected by (a) the tool's
 * `execute()` / `parseParameters()` in src/tools/*.js, and (b) the matching
 * renderer in web-ui/src/components/toolRenderers/*.jsx. Keeping all three
 * in sync here means specific renderers (TaskManagerRenderer, TerminalRenderer,
 * etc.) render their native visualizations without the backend needing to
 * know anything about UI.
 *
 * When you add a new tool to the CLI, add its schema here. The backend
 * remains tool-agnostic.
 */

export const OPENAI_FUNCTION_SCHEMAS = [
  // TaskManager — actions-array with flat task fields per action.
  // Field names mirror the tool's system-prompt protocol (src/tools/taskManagerTool.js
  // doc block) and the tool's runtime read-sites, so Responses-API models and
  // chat-completion models produce identical payloads.
  //   create:            {type, title, description?, priority?}
  //   update:            {type, taskId, title?, description?, priority?, status?}
  //   complete|cancel:   {type, taskId}
  //   list|clear:        {type}
  // One call = one task action. Parallel tool calls cover multi-task cases.
  {
    type: 'function',
    name: 'taskmanager',
    description: 'Create, update, complete, cancel, list, or clear tasks. One call per action. For create: provide title. For update/complete/cancel: provide taskId.',
    parameters: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'Array with a single action object.',
          items: {
            type: 'object',
            properties: {
              type:        { type: 'string', enum: ['create', 'update', 'complete', 'cancel', 'list', 'clear'] },
              taskId:      { type: 'string', description: 'Task id — required for update/complete/cancel. Omit for create/list/clear.' },
              title:       { type: 'string', description: 'Task title — required for create; optional for update.' },
              description: { type: 'string' },
              priority:    { type: 'string', enum: ['high', 'medium', 'low'], description: 'Only set for create/update. Omit for list — do NOT use as a filter.' },
              status:      { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Only set for update. Omit for create (defaults to pending) and for list (returns all tasks).' },
            },
            required: ['type'],
          },
          minItems: 1,
          maxItems: 1,
        },
      },
      required: ['actions'],
    },
  },
  // JobDone — actions-array with action+summary.
  {
    type: 'function',
    name: 'jobdone',
    description: 'Signal that all tasks are complete and the agent should stop.',
    parameters: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action:  { type: 'string', enum: ['complete'] },
              summary: { type: 'string', description: 'Brief summary of what was accomplished' },
            },
            required: ['action', 'summary'],
          },
        },
      },
      required: ['actions'],
    },
  },
  // Filesystem — actions-array with per-action-typed field names (filePath /
  // outputPath / sourcePath + destPath / directory). Aligned with the tool's
  // system-prompt protocol (src/tools/fileSystemTool.js doc block) and the
  // tool's validate/execute read-sites.
  //   read|delete|exists|stats:   {type, filePath}
  //   write:                      {type, outputPath, content}
  //   append:                     {type, filePath, content}
  //   copy|move:                  {type, sourcePath, destPath}
  //   create-dir:                 {type, directory}
  //   list:                       {type, directory}
  {
    type: 'function',
    name: 'filesystem',
    description: 'Read, write, create, delete, copy/move, append, or list files and directories. Emit one action object per file operation (multiple allowed in the actions array).',
    parameters: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type:        { type: 'string', enum: ['read', 'write', 'append', 'delete', 'copy', 'move', 'exists', 'stats', 'create-dir', 'list'], description: 'The filesystem operation to perform.' },
              filePath:    { type: 'string', description: 'Target file path. Required for: read, append, delete, exists, stats.' },
              outputPath:  { type: 'string', description: 'Destination file path. Required for: write.' },
              sourcePath:  { type: 'string', description: 'Source file path. Required for: copy, move.' },
              destPath:    { type: 'string', description: 'Destination file path. Required for: copy, move.' },
              directory:   { type: 'string', description: 'Directory path. Required for: create-dir, list.' },
              content:     { type: 'string', description: 'File content. Required for: write, append.' },
            },
            required: ['type'],
          },
        },
      },
      required: ['actions'],
    },
  },
  // Terminal — actions-array. Tool supports run-command, change-directory,
  // list-directory, create-directory, get-working-directory (see
  // src/tools/terminalTool.js switch on action.type).
  {
    type: 'function',
    name: 'terminal',
    description: 'Run shell commands, change/list/create working directories, or report the current working directory.',
    parameters: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type:      { type: 'string', enum: ['run-command', 'change-directory', 'list-directory', 'create-directory', 'get-working-directory'], description: 'The terminal operation to perform.' },
              command:   { type: 'string', description: 'Shell command to run. Required for: run-command.' },
              directory: { type: 'string', description: 'Directory path. Required for: change-directory, list-directory, create-directory.' },
              timeout:   { type: 'number', description: 'Timeout in ms for run-command. Default 30000.' },
            },
            required: ['type'],
          },
        },
      },
      required: ['actions'],
    },
  },
  // Seek — uses filePaths + searchTerms (matches tool's and renderer's flat shape).
  {
    type: 'function',
    name: 'seek',
    description: 'Search for text/patterns across project files (grep-like).',
    parameters: {
      type: 'object',
      properties: {
        searchTerms: {
          type: 'array',
          items: { type: 'string' },
          description: 'Patterns to search for (regex supported)',
        },
        filePaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Directories or files to search in (defaults to project root)',
        },
      },
      required: ['searchTerms'],
    },
  },
  // File-content-replace — files array with nested replacements.
  // Field names mirror src/tools/fileContentReplaceTool.js runtime (file.path,
  // replacement.oldContent/newContent) so the same payload shape works for
  // both native function calls and the system-prompt inline protocol.
  {
    type: 'function',
    name: 'file-content-replace',
    description: 'Find and replace exact text spans within one or more files.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path relative to the project root.' },
              replacements: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    oldContent: { type: 'string', description: 'Exact text to find (whitespace-sensitive).' },
                    newContent: { type: 'string', description: 'Replacement text.' },
                    all:        { type: 'boolean', description: 'Replace every occurrence. Default false (replace first only).' },
                  },
                  required: ['oldContent', 'newContent'],
                },
              },
            },
            required: ['path', 'replacements'],
          },
        },
      },
      required: ['files'],
    },
  },
  // File-tree — flat params using `directory` + `maxDepth`.
  {
    type: 'function',
    name: 'file-tree',
    description: 'Get a tree-view of the project directory structure.',
    parameters: {
      type: 'object',
      properties: {
        directory:  { type: 'string', description: 'Root directory (defaults to project root)' },
        maxDepth:   { type: 'number', description: 'Max depth (default 3)' },
        showHidden: { type: 'boolean' },
      },
    },
  },
  // Memory — flat params (no actions array). Field names mirror the tool's
  // validate/execute sites in src/tools/memoryTool.js.
  //
  // Memory-entry actions (user-authored notes):
  //   add:             {action, title, content, description?}
  //   update:          {action, id, title?, content?, description?}
  //   delete|read:     {action, id}
  //   list:            {action, level?}
  //   search:          {action, query, level?}
  //   stats:           {action}
  //
  // Conversation-archive action (read-only browse of the agent's own past
  // conversation — survives compaction; see src/services/conversationQuery.js):
  //   reminisce:       {action, mode, ...mode-specific params}
  //     overview       — {mode}
  //     range          — {mode, from?, to?, offset?, limit?, detail?}
  //     search         — {mode, query, role?, maxResults?, cursor?, detail?}
  //     around         — {mode, messageId, before?, after?, detail?}
  //     byTool         — {mode, toolId?, limit?, cursor?}
  //     read           — {mode, messageId, lineFrom?/lineTo? OR contentFrom?/contentTo?, detail?}
  {
    type: 'function',
    name: 'memory',
    description: 'Store and retrieve persistent memories across sessions, and browse your own pre-compaction conversation archive via the `reminisce` action.',
    parameters: {
      type: 'object',
      properties: {
        action:      { type: 'string', enum: ['add', 'update', 'delete', 'read', 'list', 'search', 'stats', 'reminisce'] },
        id:          { type: 'string', description: 'Memory id. Required for: update, delete, read (of memory entries).' },
        title:       { type: 'string', description: 'Short title. Required for: add. Optional for: update.' },
        content:     { type: 'string', description: 'Full memory content. Required for: add. Optional for: update.' },
        description: { type: 'string', description: 'Short summary. Optional for: add, update.' },
        query:       { type: 'string', description: 'Search query. Required for memory search AND reminisce search.' },
        level:       { type: 'string', enum: ['titles', 'descriptions', 'full'], description: 'Detail level for memory list/search output.' },

        // ── reminisce-specific params ─────────────────────────────────────
        mode: {
          type: 'string',
          enum: ['overview', 'range', 'search', 'around', 'byTool', 'read'],
          description: 'Reminisce sub-mode. Required when action="reminisce".',
        },
        messageId: {
          type: 'string',
          description: 'Stable pointer into the conversation archive. Required for reminisce around/read. Get messageIds from overview/search/range/byTool results.',
        },
        // range / search / byTool paging
        from:        { type: 'string', description: 'ISO timestamp lower bound (reminisce range).' },
        to:          { type: 'string', description: 'ISO timestamp upper bound (reminisce range).' },
        offset:      { type: 'integer', description: 'Pagination offset (reminisce range).' },
        limit:       { type: 'integer', description: 'Max entries returned (reminisce range/byTool). 1–100.' },
        maxResults:  { type: 'integer', description: 'Max search matches returned (reminisce search). 1–50.' },
        role: {
          type: 'string',
          enum: ['user', 'assistant', 'system'],
          description: 'Filter by message role (reminisce search).',
        },
        cursor:      { type: 'string', description: 'Opaque pagination cursor from a previous reminisce search/byTool response. Pass verbatim to continue.' },
        toolId:      { type: 'string', description: 'Filter by toolId (reminisce byTool).' },
        // around — MESSAGES on each side of the target
        before: {
          type: 'integer',
          description: 'Number of MESSAGES before the target to include (reminisce around). 0–20.',
        },
        after: {
          type: 'integer',
          description: 'Number of MESSAGES after the target to include (reminisce around). 0–20.',
        },
        // read — sub-message window, mutually exclusive (lines win if both)
        lineFrom:    { type: 'integer', description: 'First line to read, 1-indexed inclusive (reminisce read).' },
        lineTo:      { type: 'integer', description: 'Last line to read, 1-indexed inclusive (reminisce read). Window capped at 500 lines.' },
        contentFrom: { type: 'integer', description: 'First character offset (reminisce read, 0-indexed inclusive). Ignored if lineFrom is set.' },
        contentTo:   { type: 'integer', description: 'Last character offset (reminisce read, 0-indexed exclusive). Window capped at 16000 chars.' },
        detail: {
          type: 'string',
          enum: ['default', 'full'],
          description: 'Return shape: "default" truncates content and omits toolExecutions; "full" returns everything (eats tokens fast).',
        },
      },
      required: ['action'],
    },
  },
];

/**
 * Build the tools array for a specific agent based on its enabled capabilities.
 * Keeps the model's tool list minimal — it sees only what the agent actually
 * has access to, which also reduces prompt size and ambiguity.
 *
 * @param {string[]} capabilities - Agent capabilities (matches tool ids)
 * @returns {Array} Function schemas the agent is allowed to invoke
 */
export function getToolSchemasForAgent(capabilities = []) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    // Agent has no capability list — give it the full catalog rather than
    // leaving it tool-less. Matches the CLI's existing "include all" fallback.
    return OPENAI_FUNCTION_SCHEMAS;
  }
  const allowed = new Set(capabilities.map(c => String(c).toLowerCase()));
  return OPENAI_FUNCTION_SCHEMAS.filter(s => allowed.has(s.name.toLowerCase()));
}

export default OPENAI_FUNCTION_SCHEMAS;
