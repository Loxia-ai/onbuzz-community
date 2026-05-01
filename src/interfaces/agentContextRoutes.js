/**
 * Agent context + memory routes.
 *
 * Powers the "Memory" tab in the AgentEditModal. Three concerns:
 *
 *   1. Memory catalog CRUD — backed by MemoryService.
 *      GET    /api/agents/:agentId/memories
 *      POST   /api/agents/:agentId/memories
 *      PUT    /api/agents/:agentId/memories/:memoryId
 *      DELETE /api/agents/:agentId/memories/:memoryId
 *
 *   2. Live "what would be sent to the model on the next turn" snapshot —
 *      the full system prompt (with all tool/capability injections), the
 *      message array assembled by agentPool.getMessagesForAI, and the
 *      pending message queues that haven't been folded in yet.
 *      GET /api/agents/:agentId/context-snapshot
 *
 *   3. Future: any other "lives inside the context window" data
 *      (compaction state, working dir, persisted skills, …) gets added
 *      here as a single read-only window into agent state.
 *
 * Extracted as a module (not inline in webServer.js) so the routes are
 * testable in isolation against a fake express + injected dependencies,
 * mirroring the schedulerRoutes / widget routes pattern.
 */

/**
 * @param {object} app                 express app
 * @param {object} deps
 * @param {() => object|null} deps.getAgentPool   resolve agentPool at request time
 * @param {(logger?) => object} deps.getMemoryService  memory service factory
 * @param {object} [deps.logger]
 */
export function registerAgentContextRoutes(app, deps = {}) {
  if (!app) return;
  const getAgentPool = typeof deps.getAgentPool === 'function' ? deps.getAgentPool : () => null;
  const getMemoryService = typeof deps.getMemoryService === 'function' ? deps.getMemoryService : null;
  const logger = deps.logger || { error: () => {}, warn: () => {} };

  if (!getMemoryService) {
    // Module is wired up but no memory service available — bail gracefully.
    // Routes will return 503 below; we don't even register them.
    return;
  }

  // ── Memory CRUD ─────────────────────────────────────────────────────

  // GET /api/agents/:agentId/memories — full memory objects (content + metadata).
  app.get('/api/agents/:agentId/memories', async (req, res) => {
    try {
      const { agentId } = req.params;
      if (!agentId) return res.status(400).json({ success: false, error: 'agentId is required' });
      const svc = getMemoryService(logger);
      const memories = await svc.loadMemories(agentId);
      res.json({ success: true, count: memories.length, memories });
    } catch (err) {
      logger.error('[agentContext] list memories failed', { error: err?.message });
      res.status(500).json({ success: false, error: err?.message || 'unknown' });
    }
  });

  // POST /api/agents/:agentId/memories — add memory.
  // Body: { title (required), description?, content (required), expiration? }
  app.post('/api/agents/:agentId/memories', async (req, res) => {
    try {
      const { agentId } = req.params;
      const { title, description, content, expiration } = req.body || {};
      if (!agentId) return res.status(400).json({ success: false, error: 'agentId is required' });
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ success: false, error: 'title (non-empty string) is required' });
      }
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ success: false, error: 'content (non-empty string) is required' });
      }
      const svc = getMemoryService(logger);
      const memory = await svc.addMemory(agentId, {
        title: title.trim(),
        description: typeof description === 'string' ? description.trim() : '',
        content,
        expiration,
      });
      res.json({ success: true, memory });
    } catch (err) {
      logger.error('[agentContext] add memory failed', { error: err?.message });
      res.status(500).json({ success: false, error: err?.message || 'unknown' });
    }
  });

  // PUT /api/agents/:agentId/memories/:memoryId — update memory.
  // Body: any subset of { title, description, content, expiration }.
  app.put('/api/agents/:agentId/memories/:memoryId', async (req, res) => {
    try {
      const { agentId, memoryId } = req.params;
      if (!agentId || !memoryId) {
        return res.status(400).json({ success: false, error: 'agentId and memoryId are required' });
      }
      const updates = req.body || {};
      const svc = getMemoryService(logger);
      const memory = await svc.updateMemory(agentId, memoryId, updates);
      if (!memory) return res.status(404).json({ success: false, error: `Memory not found: ${memoryId}` });
      res.json({ success: true, memory });
    } catch (err) {
      logger.error('[agentContext] update memory failed', { error: err?.message });
      res.status(500).json({ success: false, error: err?.message || 'unknown' });
    }
  });

  // DELETE /api/agents/:agentId/memories/:memoryId — delete memory.
  app.delete('/api/agents/:agentId/memories/:memoryId', async (req, res) => {
    try {
      const { agentId, memoryId } = req.params;
      if (!agentId || !memoryId) {
        return res.status(400).json({ success: false, error: 'agentId and memoryId are required' });
      }
      const svc = getMemoryService(logger);
      const ok = await svc.deleteMemory(agentId, memoryId);
      if (!ok) return res.status(404).json({ success: false, error: `Memory not found: ${memoryId}` });
      res.json({ success: true });
    } catch (err) {
      logger.error('[agentContext] delete memory failed', { error: err?.message });
      res.status(500).json({ success: false, error: err?.message || 'unknown' });
    }
  });

  // ── Context snapshot ────────────────────────────────────────────────

  // GET /api/agents/:agentId/context-snapshot — atomic read-only view of
  // everything "live in the context window" for this agent right now:
  //   - systemPrompt.original = user-authored prompt
  //   - systemPrompt.full     = enhanced prompt with all tool injections
  //   - messages              = exactly what getMessagesForAI returns
  //                             (i.e. what would be sent on the next turn)
  //   - pendingQueues         = msg queues not yet folded into the
  //                             conversation history
  //   - stats                 = sizes, counts, model id
  app.get('/api/agents/:agentId/context-snapshot', async (req, res) => {
    try {
      const { agentId } = req.params;
      if (!agentId) return res.status(400).json({ success: false, error: 'agentId is required' });

      const agentPool = getAgentPool();
      if (!agentPool || typeof agentPool.getAgent !== 'function') {
        return res.status(503).json({ success: false, error: 'agent pool not available' });
      }

      const agent = await agentPool.getAgent(agentId);
      if (!agent) return res.status(404).json({ success: false, error: `Agent not found: ${agentId}` });

      // System prompt — both forms. `systemPrompt` is the enhanced one
      // (with tool descriptions injected); `originalSystemPrompt` is the
      // user-authored version. Showing both lets the user understand
      // exactly what the model sees vs what they typed.
      const original = agent.originalSystemPrompt || agent.systemPrompt || '';
      const full     = agent.systemPrompt || original;

      // Messages prepared for the next turn. getMessagesForAI is the
      // exact function the scheduler calls right before sending; this
      // is the source of truth for "what would the model see now?".
      const modelId = agent.currentModel || agent.preferredModel;
      let messages = [];
      let messagesError = null;
      if (modelId && typeof agentPool.getMessagesForAI === 'function') {
        try {
          messages = await agentPool.getMessagesForAI(agentId, modelId);
        } catch (e) {
          // Don't fail the whole snapshot — surface the error inline so
          // the user can see "messages couldn't be assembled" without
          // losing the system-prompt + queue views.
          messagesError = e?.message || String(e);
        }
      }

      // Per-message lightweight projection — strip enormous tool output
      // bodies so the snapshot is bounded. Caller can re-query with a
      // "give me message X in full" path if/when we add it.
      const MAX_PREVIEW = 4000;
      const projection = (Array.isArray(messages) ? messages : []).map((m, i) => {
        const content = typeof m.content === 'string' ? m.content : safeStringify(m.content);
        const truncated = content.length > MAX_PREVIEW;
        return {
          index: i,
          role: m.role,
          name: m.name || null,
          contentPreview: truncated ? content.slice(0, MAX_PREVIEW) : content,
          contentLength: content.length,
          truncated,
          timestamp: m.timestamp || null,
          hasToolCalls: !!(m.toolCalls || m.tool_calls),
          toolCallId: m.toolCallId || m.tool_call_id || null,
        };
      });

      // Pending queues — what's waiting to be folded in but isn't yet.
      const queues = agent.messageQueues || {};
      const queueProjection = (arr, kind) => (Array.isArray(arr) ? arr : []).map((m, i) => ({
        index: i,
        kind,
        contentPreview: safePreview(m?.content ?? m?.message ?? m?.text ?? '', 200),
        timestamp: m?.timestamp || null,
      }));

      const totalSystemPromptLen = full.length;
      const totalMessageLen = projection.reduce((acc, m) => acc + (m.contentLength || 0), 0);
      // Rough token estimate (≈ 4 chars / token). Cheap and good enough
      // for the UI bar; the model-side accounting still uses real tokenizers.
      const estimatedTokens = Math.ceil((totalSystemPromptLen + totalMessageLen) / 4);

      res.json({
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          mode: agent.mode,
          status: agent.status,
          currentModel: agent.currentModel || null,
          preferredModel: agent.preferredModel || null,
        },
        systemPrompt: {
          original,
          full,
          enhancementBytes: Math.max(0, full.length - original.length),
          originalLength: original.length,
          fullLength: full.length,
        },
        messages: projection,
        messagesError,
        pendingQueues: {
          userMessages:       queueProjection(queues.userMessages,       'user'),
          interAgentMessages: queueProjection(queues.interAgentMessages, 'inter-agent'),
          toolResults:        queueProjection(queues.toolResults,        'tool-result'),
        },
        stats: {
          messageCount: projection.length,
          totalMessageBytes: totalMessageLen,
          estimatedTokens,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      logger.error('[agentContext] snapshot failed', { error: err?.message });
      res.status(500).json({ success: false, error: err?.message || 'unknown' });
    }
  });
}

function safeStringify(v) {
  if (v == null) return '';
  try { return typeof v === 'string' ? v : JSON.stringify(v); }
  catch { return String(v); }
}

function safePreview(v, max) {
  const s = safeStringify(v);
  return s.length > max ? s.slice(0, max) : s;
}

export default { registerAgentContextRoutes };
