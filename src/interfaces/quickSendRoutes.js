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

// ── Provider-error classification ───────────────────────────────
//
// Small string-matching classifier mapping common provider failure
// messages to stable codes and actionable suggestions. Keep this
// intentionally simple — the goal is a useful banner in the side
// panel, not a full taxonomy. Categories were chosen from real
// failure modes seen in this project (anthropic-sonnet selected with
// no live anthropic provider, expired keys, OpenAI billing, etc.).
//
// hasLocalModels comes from the optional Ollama detection below and
// changes only the wording of the suggestion.
export function classifyProviderError(message, { hasLocalModels = false } = {}) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  const switchHint = hasLocalModels
    ? 'You can also switch the Quick Send agent to a local Ollama model to test without paid credits.'
    : null;

  if (/no provider matched model/i.test(text)) {
    return {
      code: 'MODEL_PROVIDER_UNAVAILABLE',
      message: text,
      suggestion: [
        'No working provider is configured for this model. Add an API key in OnBuzz Settings, or switch the Quick Send agent to a model whose provider is configured.',
        switchHint
      ].filter(Boolean).join(' ')
    };
  }
  if (/insufficient[_ ]quota|insufficient[_ ]credit|payment[_ ]required|\b402\b|billing/i.test(lower)) {
    return {
      code: 'PROVIDER_BILLING_ERROR',
      message: text,
      suggestion: [
        'The selected paid model could not be used because of a billing or credit issue. Add credits in your provider account, or switch Quick Send to a different model.',
        switchHint
      ].filter(Boolean).join(' ')
    };
  }
  if (/(invalid|incorrect|bad)[_ ]?api[_ ]?key|unauthorized|\b401\b|invalid_api_key/i.test(lower)) {
    return {
      code: 'PROVIDER_AUTH_ERROR',
      message: text,
      suggestion: [
        'The API key for this provider appears to be invalid or missing. Update it in OnBuzz Settings, or switch Quick Send to a different model.',
        switchHint
      ].filter(Boolean).join(' ')
    };
  }
  if (/rate[_ ]?limit|too[_ ]many[_ ]requests|\b429\b/i.test(lower)) {
    return {
      code: 'PROVIDER_RATE_LIMITED',
      message: text,
      suggestion: 'The provider is rate-limiting requests. Wait a moment and try again, or switch Quick Send to a different model.'
    };
  }
  return {
    code: 'PROVIDER_RUNTIME_ERROR',
    message: text || 'Provider returned an unknown error.',
    suggestion: [
      'The provider returned an error. Check the OnBuzz server logs for details, or switch Quick Send to a different model.',
      switchHint
    ].filter(Boolean).join(' ')
  };
}

// Detect whether any Ollama-provided models are visible to OnBuzz.
// Used to enrich error suggestions with a "you have local models
// available" hint without forcing the user to discover Ollama on
// their own. Best-effort — never throws, returns false on any error.
function hasLocalOllamaModels(aiService) {
  try {
    const models = aiService?.modelsService?.getModels?.() || [];
    return Array.isArray(models) && models.some(m => m && m.provider === 'ollama');
  } catch {
    return false;
  }
}

// Pre-flight a model id against the live provider registry. Returns
// { ok: true } when the model resolves cleanly, or a structured error
// payload (code + message + suggestion) otherwise.
//
// The provider registry's resolve() is the same call the AI service
// makes at dispatch time — running it here just lets us fail fast
// instead of letting the side panel hit the 60s poll timeout.
function preflightCheckModel(aiService, model) {
  if (!model) {
    return {
      ok: false,
      code: 'NO_DEFAULT_MODEL',
      message: 'No default model is configured.',
      suggestion: 'Open OnBuzz Settings and pick a default model before using the Send to OnBuzz extension.'
    };
  }
  try {
    const registry = aiService?.getProviderRegistry?.();
    if (!registry) {
      return {
        ok: false,
        code: 'AI_SERVICE_UNAVAILABLE',
        message: 'AI service is not attached.',
        suggestion: 'Restart OnBuzz and try again.'
      };
    }
    registry.resolve({ model });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      ...classifyProviderError(err.message, {
        hasLocalModels: hasLocalOllamaModels(aiService)
      })
    };
  }
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

      // Pre-flight model check. Catches two cases the side panel was
      // hitting as a generic 60-second timeout:
      //   1. The user's system.defaultModel points at a provider that
      //      isn't actually live (e.g. anthropic-sonnet selected, no
      //      working Anthropic key) — fail BEFORE creating a broken
      //      agent.
      //   2. A pre-existing Quick Send agent on disk still references
      //      an unusable model (the user installed OnBuzz, configured
      //      Anthropic, removed the key later, and now the saved
      //      agent's currentModel is anthropic-sonnet) — fail BEFORE
      //      queuing the message, since dispatch would just throw.
      const targetModel = quickSendAgent
        ? (quickSendAgent.currentModel || quickSendAgent.preferredModel || null)
        : (orchestrator.config?.system?.defaultModel || null);
      const preflight = preflightCheckModel(orchestrator.aiService, targetModel);
      if (!preflight.ok) {
        return res.status(STATUS.SERVICE_UNAVAILABLE).json({
          ok: false,
          code: preflight.code,
          message: preflight.message,
          suggestion: preflight.suggestion,
          // Legacy `error` field kept so older side-panel builds (and
          // generic error-banner code) still surface something useful.
          error: preflight.message,
          localModelsAvailable: hasLocalOllamaModels(orchestrator.aiService),
          agentId: quickSendAgent?.id || null,
          currentModel: targetModel || null
        });
      }

      if (!quickSendAgent) {
        logger.info('Quick Send: creating agent', { model: targetModel });
        const createResp = await orchestrator.processRequest({
          interface: IFACES.WEB,
          sessionId,
          action: ACTIONS.CREATE_AGENT,
          payload: buildQuickSendAgentSeed(targetModel),
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

      // Unhealthy detection — three signals, ordered by how early they
      // appear after an AI failure (so the side panel can stop polling
      // as soon as the backend knows something is wrong):
      //
      //   (a) agent.delayEndTime in the future — the scheduler sets this
      //       directly on any AI-service failure (60s default), BEFORE
      //       the failure is consolidated into the conversation. This
      //       is the earliest reliable signal.
      //
      //   (b) Pending tool-result queue entries with toolId='system-error'
      //       or status='failed' — added alongside the delay, still
      //       before consolidation. Carries the actual error string.
      //
      //   (c) [system-error] / "AI service error" user-role rows in the
      //       conversation slice — the consolidated form, only present
      //       after the next scheduler tick fires.
      const newSlice = all.slice(since);
      let consolidatedErrorMessage = null;
      for (let i = newSlice.length - 1; i >= 0; i--) {
        const m = newSlice[i];
        const text = typeof m.content === 'string' ? m.content : '';
        if (m.role === 'user' && /\[system-error\]|AI service error/i.test(text)) {
          consolidatedErrorMessage = text.split('\n').find((l) => /\[system-error\]|AI service error/i.test(l))
            || 'Agent reported an error';
          break;
        }
      }

      const pendingToolResults = agent.messageQueues?.toolResults || [];
      const pendingError = pendingToolResults.find(
        (tr) => tr && (tr.toolId === 'system-error' || tr.status === 'failed')
      );

      const now = Date.now();
      const delayUntilMs = agent.delayEndTime ? new Date(agent.delayEndTime).getTime() : 0;
      const isDelayed = Number.isFinite(delayUntilMs) && delayUntilMs > now;
      const isPaused = agent.status === 'paused' || agent.status === 'suspended';

      // Pick the most informative error string we can find, then run
      // it through the classifier for a stable code + suggestion.
      let rawError = consolidatedErrorMessage
        || pendingError?.error
        || (isDelayed && agent.delayEndTime
            ? `Agent is in error-backoff until ${agent.delayEndTime}.`
            : null);
      let errorHint = null;
      let errorCode = null;
      let suggestion = null;
      if (rawError) {
        const classified = classifyProviderError(rawError, {
          hasLocalModels: hasLocalOllamaModels(orchestrator.aiService)
        });
        errorHint = classified.message;
        errorCode = classified.code;
        suggestion = classified.suggestion;
      } else if (isPaused) {
        errorHint = `Agent status is ${agent.status}.`;
        errorCode = 'AGENT_PAUSED';
        suggestion = 'Open the Quick Send agent in OnBuzz and check why it is paused.';
      }

      return res.json({
        ok: true,
        agentId,
        total: all.length,
        messages: slice,
        agentStatus: agent.status || null,
        currentModel: agent.currentModel || null,
        unhealthy: Boolean(isPaused || isDelayed || pendingError || consolidatedErrorMessage),
        errorHint,
        code: errorCode,
        suggestion,
        localModelsAvailable: hasLocalOllamaModels(orchestrator.aiService)
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
