/**
 * Browser-extension Quick Send routes — extracted from webServer.js so
 * they're testable against the real production wiring (same pattern as
 * schedulerRoutes.js).
 *
 * Two routes:
 *   POST /api/chat/quick-send            — token + body → dispatch SEND_MESSAGE
 *   GET  /api/chat/quick-send/messages   — poll the agent's conversation
 *
 * Registration:
 *   registerQuickSendRoutes(app, {
 *     getOrchestrator: () => this.orchestrator,
 *     verifyToken:     verifyExtensionToken,
 *     logger,
 *     constants: { INTERFACE_TYPES, ORCHESTRATOR_ACTIONS, HTTP_STATUS },
 *   });
 *
 * The orchestrator is resolved at request-time via a thunk so the routes
 * survive late-attach during boot.
 *
 * Tool restriction is enforced ENTIRELY by agent.capabilities — the same
 * mechanism every other OnBuzz agent uses (the scheduler filters tool
 * schemas with getToolSchemasForAgent). This module owns no policy.
 */

// Name of the singleton agent the extension routes selections to.
// Looked up by exact match in the agent pool.
export const QUICK_SEND_AGENT_NAME = 'Quick Send';

// Stable session id for every extension call. The extension is REST
// polling only and never opens a WebSocket — broadcastToSession in
// webServer.js short-circuits on this exact id to avoid noisy fan-out.
export const EXTENSION_SESSION_ID = 'extension-quick-send';

// Default capabilities for a fresh Quick Send agent. After creation
// the user can edit them in the Settings UI like any other agent —
// the endpoint never touches them again.
export const QUICK_SEND_DEFAULT_CAPABILITIES = Object.freeze([
  'web',
  'pdf',
  'memory',
  'skills',
  'help',
  'user-prompt'
]);

// Hardcoded system prompt for the seed agent. Pure text; no runtime
// substitutions. Describes the chat-with-a-highlight role.
export const QUICK_SEND_SYSTEM_PROMPT = [
  'You are the OnBuzz Quick Send agent.',
  '',
  'You receive snippets the user has highlighted on web pages via the',
  'OnBuzz browser extension. Each request gives you the page title, the',
  'source URL, the selected text, and (optionally) a question from the',
  'user.',
  '',
  'Behaviour:',
  '- If the user provided a question, answer it grounded in the selected',
  '  text. Use the web tool to read referenced links when helpful.',
  '- If the user did not provide a question, give a short, useful',
  '  acknowledgement: a one-sentence summary plus an offer to dig deeper.',
  '- Quote sparingly. Do not regurgitate the whole selection.'
].join('\n');

/**
 * Build the CREATE_AGENT payload for the seed Quick Send agent.
 * @param {string} model
 */
export function buildQuickSendAgentSeed(model) {
  return {
    name: QUICK_SEND_AGENT_NAME,
    systemPrompt: QUICK_SEND_SYSTEM_PROMPT,
    model,
    capabilities: [...QUICK_SEND_DEFAULT_CAPABILITIES],
    metadata: { createdBy: 'quick-send-endpoint' }
  };
}

/**
 * Compose the single user-turn message the agent sees. Page metadata
 * + selected text + the typed question all in one plain-text block,
 * so the model has the full context inside the chat turn — no
 * scheduler-side injection required.
 */
export function composeQuickSendMessage({
  selectedText,
  pageTitle,
  sourceUrl,
  surroundingText,
  userMessage
}) {
  const parts = [];
  if (pageTitle) parts.push(`Page title: ${pageTitle}`);
  if (sourceUrl) parts.push(`Source URL: ${sourceUrl}`);
  if (parts.length > 0) parts.push('');
  parts.push('Selected text:');
  parts.push(selectedText);
  if (surroundingText) {
    parts.push('');
    parts.push('Surrounding context:');
    parts.push(surroundingText);
  }
  if (userMessage && userMessage.trim().length > 0) {
    parts.push('');
    parts.push(`User question: ${userMessage.trim()}`);
  }
  return parts.join('\n');
}

export function registerQuickSendRoutes(app, deps = {}) {
  if (!app) return;

  const getOrchestrator = typeof deps.getOrchestrator === 'function'
    ? deps.getOrchestrator
    : () => null;
  const verifyToken = typeof deps.verifyToken === 'function'
    ? deps.verifyToken
    : async () => false;
  const logger = deps.logger || { info: () => {}, error: () => {}, warn: () => {} };
  const constants = deps.constants || {};
  const { INTERFACE_TYPES, ORCHESTRATOR_ACTIONS, HTTP_STATUS } = constants;

  // Defensive defaults in case constants weren't injected — keeps the
  // module functional in isolation (e.g. test rigs that don't import
  // the full constants module). Production wiring always passes them.
  const STATUS = HTTP_STATUS || {
    OK: 200, BAD_REQUEST: 400, UNAUTHORIZED: 401, NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500, SERVICE_UNAVAILABLE: 503
  };
  const IFACES = INTERFACE_TYPES || { WEB: 'web' };
  const ACTIONS = ORCHESTRATOR_ACTIONS || {
    CREATE_AGENT: 'create_agent',
    SEND_MESSAGE: 'send_message'
  };

  // ── POST /api/chat/quick-send ─────────────────────────────────
  // Routes the highlighted selection to a regular pool agent named
  // "Quick Send". On first use the agent is created with a fixed
  // seed; afterwards it's reused with whatever capabilities/model/
  // system prompt the user has configured for it. The endpoint
  // itself owns no policy and never mutates the agent beyond initial
  // creation.
  app.post('/api/chat/quick-send', async (req, res) => {
    const MAX_FIELD_BYTES = 100 * 1024;
    const utf8Bytes = (s) => Buffer.byteLength(s || '', 'utf8');

    try {
      const presented = req.get('X-OnBuzz-Token');
      const ok = await verifyToken(presented);
      if (!ok) {
        return res.status(STATUS.UNAUTHORIZED).json({
          ok: false,
          error: 'Invalid or missing X-OnBuzz-Token header'
        });
      }

      const body = req.body || {};
      const selectedText = body.selected_text;
      const sourceUrl = body.source_url ?? null;
      const pageTitle = body.page_title ?? null;
      const surroundingText = body.surrounding_text ?? null;
      const userMessage = body.user_message ?? null;

      if (typeof selectedText !== 'string' || selectedText.trim().length === 0) {
        return res.status(STATUS.BAD_REQUEST).json({
          ok: false,
          error: 'Field "selected_text" is required and must be a non-empty string'
        });
      }
      for (const [name, val] of Object.entries({
        selected_text: selectedText,
        source_url: sourceUrl,
        page_title: pageTitle,
        surrounding_text: surroundingText,
        user_message: userMessage
      })) {
        if (val !== null && typeof val !== 'string') {
          return res.status(STATUS.BAD_REQUEST).json({
            ok: false,
            error: `Field "${name}" must be a string when provided`
          });
        }
        if (val && utf8Bytes(val) > MAX_FIELD_BYTES) {
          return res.status(STATUS.BAD_REQUEST).json({
            ok: false,
            error: `Field "${name}" exceeds maximum size of ${MAX_FIELD_BYTES} bytes`
          });
        }
      }

      const orchestrator = getOrchestrator();
      if (!orchestrator) {
        return res.status(STATUS.SERVICE_UNAVAILABLE).json({
          ok: false,
          error: 'OnBuzz orchestrator is not attached yet'
        });
      }

      const sessionId = EXTENSION_SESSION_ID;
      const projectDir = process.cwd();

      // Singleton lookup. The Quick Send agent is a regular pool
      // agent; we never mutate it after creation. If the user wants
      // a different model or different capabilities, they edit it
      // in the Settings UI like any other agent.
      const pool = await orchestrator.agentPool.listActiveAgents();
      let quickSendAgent = pool.find((a) => a.name === QUICK_SEND_AGENT_NAME);

      if (!quickSendAgent) {
        const defaultModel = orchestrator.config?.system?.defaultModel || null;
        if (!defaultModel) {
          return res.status(STATUS.SERVICE_UNAVAILABLE).json({
            ok: false,
            error: 'No default model is configured. Open OnBuzz Settings and pick a model before using the Send to OnBuzz extension.'
          });
        }
        logger.info('Quick Send: creating agent', { model: defaultModel });
        const createResp = await orchestrator.processRequest({
          interface: IFACES.WEB,
          sessionId,
          action: ACTIONS.CREATE_AGENT,
          payload: buildQuickSendAgentSeed(defaultModel),
          projectDir
        });
        if (!createResp?.success) {
          return res.status(STATUS.INTERNAL_SERVER_ERROR).json({
            ok: false,
            error: `Could not create Quick Send agent: ${createResp?.error || 'unknown error'}`
          });
        }
        quickSendAgent = createResp.data;
      }

      // Snapshot the message count BEFORE we send so the side panel
      // can poll for "everything since this index".
      const agentSnapshot = await orchestrator.agentPool.getAgent(quickSendAgent.id);
      const firstMessageIndex = agentSnapshot?.conversations?.full?.messages?.length || 0;

      // Single plain-text user turn carrying everything the model
      // needs: page metadata + selection + (optional) question.
      const composed = composeQuickSendMessage({
        selectedText,
        pageTitle,
        sourceUrl,
        surroundingText,
        userMessage
      });

      const sendResp = await orchestrator.processRequest({
        interface: IFACES.WEB,
        sessionId,
        action: ACTIONS.SEND_MESSAGE,
        payload: {
          agentId: quickSendAgent.id,
          message: composed,
          // chat = one user turn, one assistant reply. agent mode
          // would kick off the autonomous loop, wrong for paste-and-go.
          mode: 'chat',
          contextReferences: [],
          source: {
            type: 'browser-extension',
            sourceUrl,
            pageTitle
          }
        },
        projectDir
      });

      if (!sendResp?.success) {
        return res.status(STATUS.INTERNAL_SERVER_ERROR).json({
          ok: false,
          error: `Could not send message: ${sendResp?.error || 'unknown error'}`,
          agentId: quickSendAgent.id
        });
      }

      return res.json({
        ok: true,
        agentId: quickSendAgent.id,
        firstMessageIndex
      });
    } catch (error) {
      try { logger.error('Quick-send API error', { error: error.message }); } catch (_) {}
      return res.status(STATUS.INTERNAL_SERVER_ERROR).json({
        ok: false,
        error: error.message
      });
    }
  });

  // ── GET /api/chat/quick-send/messages ─────────────────────────
  // Poll endpoint for the side panel. Returns messages with index >=
  // `since` from the Quick Send agent's live conversation. Surfaces
  // `unhealthy` + `errorHint` so the panel can stop polling instead
  // of waiting out its 60s timeout when the agent is paused or the
  // scheduler injected a [system-error] row.
  app.get('/api/chat/quick-send/messages', async (req, res) => {
    try {
      const presented = req.get('X-OnBuzz-Token');
      const ok = await verifyToken(presented);
      if (!ok) {
        return res.status(STATUS.UNAUTHORIZED).json({
          ok: false,
          error: 'Invalid or missing X-OnBuzz-Token header'
        });
      }
      const agentId = req.query.agentId;
      const since = Math.max(0, parseInt(req.query.since, 10) || 0);
      if (typeof agentId !== 'string' || agentId.length === 0) {
        return res.status(STATUS.BAD_REQUEST).json({
          ok: false,
          error: 'Query parameter "agentId" is required'
        });
      }

      const orchestrator = getOrchestrator();
      if (!orchestrator) {
        return res.status(STATUS.SERVICE_UNAVAILABLE).json({
          ok: false,
          error: 'OnBuzz orchestrator is not attached yet'
        });
      }

      const agent = await orchestrator.agentPool.getAgent(agentId);
      if (!agent || agent.name !== QUICK_SEND_AGENT_NAME) {
        // We refuse to expose arbitrary agents via this endpoint —
        // it's intended specifically for the Quick Send flow.
        return res.status(STATUS.NOT_FOUND).json({
          ok: false,
          error: 'Quick Send agent not found'
        });
      }

      const all = agent.conversations?.full?.messages || [];
      const slice = all.slice(since).map((m, i) => ({
        index: since + i,
        role: m.role,
        content: typeof m.content === 'string' ? m.content : (m.content?.text || ''),
        timestamp: m.timestamp || null,
        type: m.type || null
      }));

      // Look for the AI-service-failure shape: the scheduler consolidates
      // a failed turn into a user-role message tagged with [system-error]
      // / "AI service error". When that appears in the new slice, the
      // side panel should give up early.
      const newSlice = all.slice(since);
      let latestErrorMessage = null;
      for (let i = newSlice.length - 1; i >= 0; i--) {
        const m = newSlice[i];
        const text = typeof m.content === 'string' ? m.content : '';
        if (m.role === 'user' && /\[system-error\]|AI service error/i.test(text)) {
          latestErrorMessage = text.split('\n').find((l) => /\[system-error\]|AI service error/i.test(l))
            || 'Agent reported an error';
          break;
        }
      }
      const isPaused = agent.status === 'paused' || agent.status === 'suspended';

      return res.json({
        ok: true,
        agentId,
        total: all.length,
        messages: slice,
        agentStatus: agent.status || null,
        currentModel: agent.currentModel || null,
        unhealthy: Boolean(isPaused || latestErrorMessage),
        errorHint: latestErrorMessage
      });
    } catch (error) {
      try { logger.error('Quick-send poll API error', { error: error.message }); } catch (_) {}
      return res.status(STATUS.INTERNAL_SERVER_ERROR).json({
        ok: false,
        error: error.message
      });
    }
  });
}

export default {
  registerQuickSendRoutes,
  buildQuickSendAgentSeed,
  composeQuickSendMessage,
  QUICK_SEND_AGENT_NAME,
  EXTENSION_SESSION_ID,
  QUICK_SEND_DEFAULT_CAPABILITIES,
  QUICK_SEND_SYSTEM_PROMPT
};
