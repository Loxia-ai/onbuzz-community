/**
 * Memory Tool - Persistent memory storage for agents
 *
 * Purpose:
 * - Allow agents to store, retrieve, update, and delete persistent memories
 * - Memories persist across sessions and agent restarts
 * - Support expiration conditions (date-based or custom conditions)
 * - Group memories by date for organized retrieval
 *
 * Actions:
 * - add: Create a new memory
 * - update: Update an existing memory
 * - delete: Remove a memory
 * - list: List memories with configurable detail level
 * - read: Load a memory's full content into context
 * - search: Search memories by title or description
 * - stats: Get memory statistics
 */

import { BaseTool } from './baseTool.js';
import { getMemoryService } from '../services/memoryService.js';
import {
  overview as convOverview,
  range as convRange,
  search as convSearch,
  around as convAround,
  byTool as convByTool,
  read as convRead,
} from '../services/conversationQuery.js';

class MemoryTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    this.memoryService = null;

    // Tool metadata
    this.requiresProject = false;
    this.isAsync = false;
    this.timeout = 30000; // 30 seconds
  }

  /**
   * Initialize memory service lazily
   */
  async _ensureMemoryService() {
    if (!this.memoryService) {
      this.memoryService = getMemoryService(this.logger);
      await this.memoryService.initialize();
    }
    return this.memoryService;
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
Memory Tool: Store and retrieve persistent memories that survive across sessions.

USAGE:
\`\`\`json
{
  "toolId": "memory",
  "action": "<action>",
  "parameters": { ... }
}
\`\`\`

ACTIONS:

1. ADD - Create a new memory
\`\`\`json
{
  "toolId": "memory",
  "action": "add",
  "title": "User prefers TypeScript",
  "description": "Programming language preference",
  "content": "The user explicitly stated they prefer TypeScript over JavaScript.",
  "expiration": null
}
\`\`\`

Expiration options:
- null or omit: Never expires
- "2025-06-01": Expires on date (ISO format)
- "When user changes preference": Custom condition (manually removed)

2. UPDATE - Modify an existing memory
\`\`\`json
{
  "toolId": "memory",
  "action": "update",
  "id": "mem-123-abc",
  "title": "Updated title",
  "description": "Updated description",
  "content": "Updated content",
  "expiration": "2025-12-31"
}
\`\`\`

3. DELETE - Remove a memory
\`\`\`json
{
  "toolId": "memory",
  "action": "delete",
  "id": "mem-123-abc"
}
\`\`\`

4. LIST - List memories (grouped by date, newest first)
\`\`\`json
{
  "toolId": "memory",
  "action": "list",
  "level": "titles"
}
\`\`\`

Level options:
- "titles": ID and title only (default, recommended)
- "descriptions": ID, title, and description
- "full": All fields including expiration and timestamps

5. READ - Load a memory's full content
\`\`\`json
{
  "toolId": "memory",
  "action": "read",
  "id": "mem-123-abc"
}
\`\`\`

6. SEARCH - Find memories by keyword
\`\`\`json
{
  "toolId": "memory",
  "action": "search",
  "query": "TypeScript"
}
\`\`\`

7. STATS - Get memory statistics
\`\`\`json
{
  "toolId": "memory",
  "action": "stats"
}
\`\`\`

8. REMINISCE - Browse your own pre-compaction conversation archive (READ-ONLY)

This is separate from the other actions. It does NOT read memory entries —
it reads your full past conversation as stored on disk. Use it when you
recall a detail from earlier in the session (a user instruction, a tool
output, an earlier decision) that's no longer in your recent context
because compaction removed it. The archive is durable: every message you
and the user exchanged is still there, even if you can't see it now.

The stable pointer is \`messageId\`. You can bookmark one result (e.g. from
\`search\`) and use it later in \`around\` to pull the surrounding context.
messageIds never change, even as the conversation grows or compaction runs.

Sub-modes:

  8a. overview — "where have I been"
  \`\`\`json
  { "toolId": "memory", "action": "reminisce", "mode": "overview" }
  \`\`\`
  Returns: totalMessages, firstAt, lastAt, totalApproxTokens, and a sparse
  timeline of ~20 evenly-spaced markers { at, role, messageId, snippet }.

  8b. range — slice by index or timestamp
  \`\`\`json
  {
    "toolId": "memory", "action": "reminisce", "mode": "range",
    "offset": 0, "limit": 20,
    "from": "2026-04-18T00:00:00Z", "to": "2026-04-18T12:00:00Z"
  }
  \`\`\`
  Returns: { messages, total, offset, limit, hasMore }.

  8c. search — substring across content + tool-call arguments
  \`\`\`json
  {
    "toolId": "memory", "action": "reminisce", "mode": "search",
    "query": "database schema", "role": "user", "maxResults": 10
  }
  \`\`\`
  Returns: { matches [{ messageId, role, at, source, snippet, highlightRanges }],
             total, hasMore, cursor }.
  Pass \`cursor\` back verbatim to get the next page.
  Note: search does NOT match tool results/outputs — only content and
  tool-call arguments.

  8d. around — N MESSAGES before + N MESSAGES after a bookmarked messageId
  \`\`\`json
  {
    "toolId": "memory", "action": "reminisce", "mode": "around",
    "messageId": "msg_abc", "before": 3, "after": 3
  }
  \`\`\`
  \`before\` and \`after\` count MESSAGES (not lines, not characters).
  Range: 0–20 each side. For a larger window, paginate with a new \`around\`
  call anchored at the messageId of the last-returned entry.
  Returns: { messages, center, targetFound }.

  8e. byTool — list your past tool calls (optionally filtered)
  \`\`\`json
  {
    "toolId": "memory", "action": "reminisce", "mode": "byTool",
    "toolId": "terminal", "limit": 20
  }
  \`\`\`
  Returns: { toolCalls [{ messageId, at, toolId, status, inputSnippet }],
             total, hasMore, cursor }.

  8f. read — open ONE message at sub-message granularity (lines OR chars)
  \`\`\`json
  // Read whole message (byte-capped at ~32 KB)
  { "toolId": "memory", "action": "reminisce", "mode": "read",
    "messageId": "msg_abc" }

  // Read lines 100–150 of a long message (stack trace, paste, etc.)
  { "toolId": "memory", "action": "reminisce", "mode": "read",
    "messageId": "msg_abc", "lineFrom": 100, "lineTo": 150 }

  // Read characters 5000–7000 (half-open range)
  { "toolId": "memory", "action": "reminisce", "mode": "read",
    "messageId": "msg_abc", "contentFrom": 5000, "contentTo": 7000 }
  \`\`\`
  Use this when \`search\` found a hit inside a huge message and the snippet
  isn't enough, OR when you want to page through a single long message
  without pulling the whole thing into context.

  Window selectors are mutually exclusive — if you pass both, LINES win.
  Omit both selectors to read the whole message. Caps: 500 lines / 16 000
  chars per call. If the message is larger, the response's
  \`contentWindow.hasMoreAfter\` is true — call \`read\` again with the next
  \`lineFrom\` or \`contentFrom\` to continue.

  Returns:
  \`\`\`
  {
    message: {
      messageId, role, at, tokenCount, hasToolCalls, model,
      content: "<requested slice>",
      contentWindow: {
        kind: "lines" | "chars" | "full",
        lineFrom?, lineTo?, totalLines?,       // kind="lines"
        contentFrom?, contentTo?,              // kind="chars"
        totalContentLength,
        hasMoreBefore, hasMoreAfter,
        truncatedAtBytes   // byte cap kicked in mid-window
      }
    },
    targetFound, center
  }
  \`\`\`

All reminisce responses are byte-capped (~32 KB) to protect your context.
When a response is capped it includes \`truncatedByBytes > 0\`; fetch fewer
or narrower results.

Add \`"detail": "full"\` on range/around to receive full untruncated content
and the raw toolExecutions / contextReferences — use sparingly; it eats
tokens fast.

BEST PRACTICES:
- Use memories for important facts, preferences, or decisions that should persist
- Keep titles concise and searchable
- Use descriptions for quick context without loading full content
- Set expiration dates for time-sensitive information
- Use LIST with "titles" first, then READ specific memories as needed
- Avoid storing sensitive data (API keys, passwords) in memories
- For reminisce: start with \`overview\`, then \`search\` or \`range\` to find
  the right messageId, then \`around\` for surrounding messages or \`read\`
  to open a specific message (whole, by line range, or by char range).
  Bookmark messageIds in memory entries via \`[reminisce:msg_xxx]\`
  references for a durable pointer that survives compaction.
    `;
  }

  /**
   * Parse parameters from tool command content
   * @param {string} content - Raw tool command content
   * @returns {Object} Parsed parameters
   */
  parseParameters(content) {
    // Already parsed as JSON by the time it reaches here
    return content;
  }

  /**
   * Get required parameters based on action
   * @returns {Array<string>}
   */
  getRequiredParameters() {
    return ['action'];
  }

  /**
   * Validate parameter types
   * @param {Object} params
   * @returns {Object}
   */
  validateParameterTypes(params) {
    const errors = [];

    if (params.action && typeof params.action !== 'string') {
      errors.push('action must be a string');
    }

    if (params.id && typeof params.id !== 'string') {
      errors.push('id must be a string');
    }

    if (params.title && typeof params.title !== 'string') {
      errors.push('title must be a string');
    }

    if (params.description && typeof params.description !== 'string') {
      errors.push('description must be a string');
    }

    if (params.content && typeof params.content !== 'string') {
      errors.push('content must be a string');
    }

    if (params.query && typeof params.query !== 'string') {
      errors.push('query must be a string');
    }

    if (params.level && !['titles', 'descriptions', 'full'].includes(params.level)) {
      errors.push('level must be one of: titles, descriptions, full');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Custom parameter validation
   * @param {Object} params
   * @returns {Object}
   */
  customValidateParameters(params) {
    const errors = [];
    const validActions = ['add', 'update', 'delete', 'list', 'read', 'search', 'stats', 'reminisce'];

    if (!params.action) {
      errors.push('action is required');
    } else if (!validActions.includes(params.action)) {
      errors.push(`action must be one of: ${validActions.join(', ')}`);
    } else {
      // Validate action-specific requirements
      switch (params.action) {
        case 'add':
          if (!params.title) errors.push('title is required for add action');
          if (!params.content) errors.push('content is required for add action');
          break;
        case 'update':
          if (!params.id) errors.push('id is required for update action');
          break;
        case 'delete':
          if (!params.id) errors.push('id is required for delete action');
          break;
        case 'read':
          if (!params.id) errors.push('id is required for read action');
          break;
        case 'search':
          if (!params.query) errors.push('query is required for search action');
          break;
      }
    }

    // Length limits
    if (params.title && params.title.length > 200) {
      errors.push('title cannot exceed 200 characters');
    }

    if (params.description && params.description.length > 500) {
      errors.push('description cannot exceed 500 characters');
    }

    if (params.content && params.content.length > 10000) {
      errors.push('content cannot exceed 10000 characters');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Execute tool with parsed parameters
   * @param {Object} params
   * @param {Object} context
   * @returns {Promise<Object>}
   */
  async execute(params, context) {
    const { action } = params;
    const { agentId } = context;

    if (!agentId) {
      throw new Error('Agent ID is required for memory tool');
    }

    const memoryService = await this._ensureMemoryService();

    try {
      switch (action) {
        case 'add':
          return await this._executeAdd(memoryService, agentId, params);
        case 'update':
          return await this._executeUpdate(memoryService, agentId, params);
        case 'delete':
          return await this._executeDelete(memoryService, agentId, params);
        case 'list':
          return await this._executeList(memoryService, agentId, params);
        case 'read':
          return await this._executeRead(memoryService, agentId, params);
        case 'search':
          return await this._executeSearch(memoryService, agentId, params);
        case 'stats':
          return await this._executeStats(memoryService, agentId);
        case 'reminisce':
          return await this._executeReminisce(agentId, params, context);
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.logger?.error(`Memory tool execution failed: ${error.message}`, {
        agentId,
        action,
        error: error.stack
      });
      throw error;
    }
  }

  /**
   * Execute ADD action
   */
  async _executeAdd(memoryService, agentId, params) {
    const memory = await memoryService.addMemory(agentId, {
      title: params.title,
      description: params.description || '',
      content: params.content,
      expiration: params.expiration
    });

    return {
      success: true,
      action: 'add',
      memory: {
        id: memory.id,
        title: memory.title,
        createdAt: memory.createdAt,
        expiration: memory.expiration
      },
      message: `Memory created: "${memory.title}" (${memory.id})`
    };
  }

  /**
   * Execute UPDATE action
   */
  async _executeUpdate(memoryService, agentId, params) {
    const updates = {};
    if (params.title !== undefined) updates.title = params.title;
    if (params.description !== undefined) updates.description = params.description;
    if (params.content !== undefined) updates.content = params.content;
    if (params.expiration !== undefined) updates.expiration = params.expiration;

    const memory = await memoryService.updateMemory(agentId, params.id, updates);

    if (!memory) {
      return {
        success: false,
        action: 'update',
        message: `Memory not found: ${params.id}`
      };
    }

    return {
      success: true,
      action: 'update',
      memory: {
        id: memory.id,
        title: memory.title,
        updatedAt: memory.updatedAt
      },
      message: `Memory updated: "${memory.title}"`
    };
  }

  /**
   * Execute DELETE action
   */
  async _executeDelete(memoryService, agentId, params) {
    const deleted = await memoryService.deleteMemory(agentId, params.id);

    if (!deleted) {
      return {
        success: false,
        action: 'delete',
        message: `Memory not found: ${params.id}`
      };
    }

    return {
      success: true,
      action: 'delete',
      message: `Memory deleted: ${params.id}`
    };
  }

  /**
   * Execute LIST action
   */
  async _executeList(memoryService, agentId, params) {
    const level = params.level || 'titles';
    const result = await memoryService.listMemories(agentId, level);

    return {
      success: true,
      action: 'list',
      level,
      totalMemories: result.count,
      memoriesByDate: result.grouped,
      message: result.count === 0
        ? 'No memories found'
        : `Found ${result.count} memories`
    };
  }

  /**
   * Execute READ action
   */
  async _executeRead(memoryService, agentId, params) {
    const memory = await memoryService.readMemory(agentId, params.id);

    if (!memory) {
      return {
        success: false,
        action: 'read',
        message: `Memory not found: ${params.id}`
      };
    }

    return {
      success: true,
      action: 'read',
      memory: {
        id: memory.id,
        title: memory.title,
        description: memory.description,
        content: memory.content,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
        expiration: memory.expiration,
        accessCount: memory.accessCount
      },
      message: `Memory loaded: "${memory.title}"`
    };
  }

  /**
   * Execute SEARCH action
   */
  async _executeSearch(memoryService, agentId, params) {
    const results = await memoryService.searchMemories(agentId, params.query);

    return {
      success: true,
      action: 'search',
      query: params.query,
      results,
      message: results.length === 0
        ? `No memories found matching "${params.query}"`
        : `Found ${results.length} memories matching "${params.query}"`
    };
  }

  /**
   * Execute STATS action
   */
  async _executeStats(memoryService, agentId) {
    const stats = await memoryService.getMemoryStats(agentId);

    return {
      success: true,
      action: 'stats',
      stats,
      message: `Memory statistics: ${stats.totalMemories} total memories, ${stats.totalAccessCount} total accesses`
    };
  }

  /**
   * Execute REMINISCE action — read-only query over the agent's
   * pre-compaction conversation archive (conversations.full.messages).
   *
   * Unlike the other memory actions, reminisce does NOT touch memoryService.
   * It's a lens over a different dataset: the conversation history that
   * stateManager preserves durably on disk regardless of compaction. The
   * agent uses it to pull specific spans of past context back into the
   * current turn when they've fallen out of the active context window.
   *
   * Pointer contract: `messageId` values returned here are stable across
   * session growth and compaction — an agent can bookmark one now and
   * resolve it in a much later turn (see services/conversationQuery.js).
   *
   * @param {string} agentId
   * @param {Object} params
   * @param {'overview'|'range'|'search'|'around'|'byTool'} params.mode
   * @param {Object} context  Must carry `agentPool` to fetch the agent's
   *                          conversation. If missing, returns a clean
   *                          failure (not a crash).
   */
  async _executeReminisce(agentId, params, context) {
    const mode = typeof params.mode === 'string' ? params.mode : '';
    const validModes = ['overview', 'range', 'search', 'around', 'byTool', 'read'];
    if (!validModes.includes(mode)) {
      return {
        success: false,
        action: 'reminisce',
        error: `mode must be one of: ${validModes.join(', ')}`,
      };
    }

    const agentPool = context?.agentPool;
    if (!agentPool?.getAgent) {
      return {
        success: false,
        action: 'reminisce',
        error: 'agentPool is not available on the tool context; cannot read conversation archive',
      };
    }

    const agent = await agentPool.getAgent(agentId);
    if (!agent) {
      return {
        success: false,
        action: 'reminisce',
        error: `Agent not found: ${agentId}`,
      };
    }

    // Always read from conversations.full — the durable archive that
    // survives every compaction pass. Never from per-model views.
    const messages = agent?.conversations?.full?.messages;
    if (!Array.isArray(messages)) {
      return {
        success: true,
        action: 'reminisce',
        mode,
        result: { empty: true, message: 'No conversation archive found for this agent.' },
      };
    }

    // Pass only the params relevant to each mode — conversationQuery's
    // per-mode validators clamp/default the rest.
    const modeParams = {
      from: params.from, to: params.to,
      offset: params.offset, limit: params.limit,
      query: params.query, role: params.role,
      maxResults: params.maxResults, cursor: params.cursor,
      messageId: params.messageId, before: params.before, after: params.after,
      toolId: params.toolId, detail: params.detail,
      // read-only window selectors (sub-message granularity)
      lineFrom: params.lineFrom, lineTo: params.lineTo,
      contentFrom: params.contentFrom, contentTo: params.contentTo,
      // Opt-in reasoning-content inclusion (default off — chain-of-thought
      // text can be very long; agents ask for it only when they actually
      // want to inspect what the model was thinking).
      includeReasoning: !!params.includeReasoning,
    };

    let result;
    switch (mode) {
      case 'overview': result = convOverview(messages); break;
      case 'range':    result = convRange(messages, modeParams); break;
      case 'search':   result = convSearch(messages, modeParams); break;
      case 'around':   result = convAround(messages, modeParams); break;
      case 'byTool':   result = convByTool(messages, modeParams); break;
      case 'read':     result = convRead(messages, modeParams); break;
    }

    return {
      success: true,
      action: 'reminisce',
      mode,
      result,
    };
  }

  /**
   * Get supported actions
   * @returns {Array<string>}
   */
  getSupportedActions() {
    return ['add', 'update', 'delete', 'list', 'read', 'search', 'stats', 'reminisce'];
  }

  /**
   * Get parameter schema
   * @returns {Object}
   */
  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'update', 'delete', 'list', 'read', 'search', 'stats', 'reminisce'],
          description: 'Action to perform'
        },
        id: {
          type: 'string',
          description: 'Memory ID (required for update, delete, read)'
        },
        title: {
          type: 'string',
          maxLength: 200,
          description: 'Memory title (required for add)'
        },
        description: {
          type: 'string',
          maxLength: 500,
          description: 'One-line description'
        },
        content: {
          type: 'string',
          maxLength: 10000,
          description: 'Full memory content (required for add)'
        },
        expiration: {
          oneOf: [
            { type: 'null' },
            { type: 'string' }
          ],
          description: 'Expiration date (ISO) or condition string'
        },
        level: {
          type: 'string',
          enum: ['titles', 'descriptions', 'full'],
          description: 'Detail level for list action'
        },
        query: {
          type: 'string',
          description: 'Search query (required for memory search AND reminisce search)'
        },

        // ── reminisce-specific parameters ────────────────────────────────
        // Required when action="reminisce"; ignored otherwise.
        mode: {
          type: 'string',
          enum: ['overview', 'range', 'search', 'around', 'byTool', 'read'],
          description: 'Reminisce sub-mode (required for action="reminisce")'
        },
        messageId: {
          type: 'string',
          description: 'Stable conversation-archive pointer. Required for reminisce around/read.'
        },
        from: { type: 'string', description: 'ISO timestamp lower bound (reminisce range)' },
        to:   { type: 'string', description: 'ISO timestamp upper bound (reminisce range)' },
        offset:     { type: 'integer', description: 'Pagination offset (reminisce range)' },
        limit:      { type: 'integer', description: 'Max entries (reminisce range/byTool), 1–100' },
        maxResults: { type: 'integer', description: 'Max search matches (reminisce search), 1–50' },
        role: {
          type: 'string',
          enum: ['user', 'assistant', 'system'],
          description: 'Role filter for reminisce search'
        },
        cursor: { type: 'string', description: 'Opaque pagination cursor (reminisce search/byTool) — pass verbatim from a previous response' },
        toolId: { type: 'string', description: 'Filter by toolId (reminisce byTool)' },
        before: { type: 'integer', description: 'Messages BEFORE the target (reminisce around), 0–20' },
        after:  { type: 'integer', description: 'Messages AFTER the target (reminisce around), 0–20' },
        lineFrom:    { type: 'integer', description: 'First line (reminisce read), 1-indexed inclusive' },
        lineTo:      { type: 'integer', description: 'Last line (reminisce read), 1-indexed inclusive; window ≤ 500 lines' },
        contentFrom: { type: 'integer', description: 'Char offset start (reminisce read), 0-indexed inclusive. Ignored if lineFrom is set.' },
        contentTo:   { type: 'integer', description: 'Char offset end (reminisce read), 0-indexed exclusive; window ≤ 16000 chars' },
        detail: {
          type: 'string',
          enum: ['default', 'full'],
          description: 'Reminisce return shape: "default" (truncated/slim) or "full" (everything)'
        }
      },
      required: ['action']
    };
  }

  /**
   * Get tool capabilities
   * @returns {Object}
   */
  getCapabilities() {
    const baseCapabilities = super.getCapabilities();

    return {
      ...baseCapabilities,
      persistent: true,
      actions: this.getSupportedActions(),
      useCases: [
        'user-preferences',
        'project-context',
        'important-decisions',
        'learned-patterns',
        'task-history'
      ]
    };
  }
}

export default MemoryTool;
