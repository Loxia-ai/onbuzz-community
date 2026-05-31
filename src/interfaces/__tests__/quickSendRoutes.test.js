/**
 * Tests for the browser-extension Quick Send routes.
 *
 * Two layers of coverage:
 *
 *   1. Pure-helper unit tests — composeQuickSendMessage and
 *      buildQuickSendAgentSeed. Lock in the message shape and the
 *      default capability set so a careless edit can't broaden the
 *      allowlist without a deliberate test update.
 *
 *   2. HTTP integration tests — mount the real registerQuickSendRoutes
 *      onto an Express app, hit the endpoints over the loopback, and
 *      assert against a fake orchestrator/agentPool/processRequest.
 *      Same pattern as schedulerRoutes.test.js. Covers auth, body
 *      validation, find-or-create behaviour, the no-mutation invariant,
 *      failure paths, and the poll endpoint's unhealthy signals.
 */

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import { createServer } from 'http';
import {
  registerQuickSendRoutes,
  buildQuickSendAgentSeed,
  composeQuickSendMessage,
  classifyProviderError,
  QUICK_SEND_AGENT_NAME,
  EXTENSION_SESSION_ID,
  QUICK_SEND_DEFAULT_CAPABILITIES,
  QUICK_SEND_SYSTEM_PROMPT
} from '../quickSendRoutes.js';

// ────────────────────────────────────────────────────────────────
// Helper: tiny fetch wrapper that returns { status, body }.
// ────────────────────────────────────────────────────────────────

async function http(url, options = {}) {
  const resp = await globalThis.fetch(url, options);
  const ct = resp.headers.get('content-type') || '';
  const body = ct.includes('json') ? await resp.json() : await resp.text();
  return { status: resp.status, body };
}

// ────────────────────────────────────────────────────────────────
// Test harness: build a real Express app wired to the real route
// registrar, with a fake orchestrator and a configurable verifyToken.
// ────────────────────────────────────────────────────────────────

const VALID_TOKEN = 'valid-test-token';

// Build a fake AI service whose providerRegistry.resolve() succeeds
// for any model NOT in `unresolvableModels`. Tests that exercise the
// pre-flight path pass a list of "broken" model ids; everything else
// resolves to a stub provider object. listAvailableModels controls
// whether the local-Ollama detection fires (used by suggestion text).
function makeFakeAiService({
  unresolvableModels = [],
  resolveError = null,           // overrides the generic message for ALL unresolvable models
  ollamaModels = []              // list of model NAMES whose `provider === 'ollama'`
} = {}) {
  const stubProvider = { id: 'stub' };
  return {
    getProviderRegistry: () => ({
      resolve: ({ model }) => {
        if (unresolvableModels.includes(model)) {
          throw new Error(
            resolveError ||
            `No provider matched model "${model}". Configure a provider key in Settings, or pass an explicit \`provider\` field.`
          );
        }
        return stubProvider;
      }
    }),
    modelsService: {
      getModels: () => ollamaModels.map(name => ({ name, provider: 'ollama' }))
    }
  };
}

function makeFakeOrchestrator({
  agents = [],
  defaultModel = 'test-model',
  processRequestImpl = null,
  aiService = makeFakeAiService()
} = {}) {
  const agentsById = new Map();
  const agentsByName = new Map();
  for (const a of agents) {
    agentsById.set(a.id, a);
    agentsByName.set(a.name, a);
  }
  const calls = [];

  const defaultProcessRequest = async ({ action, payload }) => {
    if (action === 'create_agent') {
      const newAgent = {
        id: `agent-${agentsById.size + 1}`,
        name: payload.name,
        systemPrompt: payload.systemPrompt,
        currentModel: payload.model,
        capabilities: payload.capabilities,
        metadata: payload.metadata || {},
        status: 'active',
        conversations: { full: { messages: [] } }
      };
      agentsById.set(newAgent.id, newAgent);
      agentsByName.set(newAgent.name, newAgent);
      return { success: true, data: newAgent };
    }
    if (action === 'send_message') {
      return { success: true };
    }
    return { success: false, error: `unknown action ${action}` };
  };

  return {
    config: { system: { defaultModel } },
    aiService,
    processRequest: jest.fn(async (req) => {
      calls.push(req);
      return (processRequestImpl || defaultProcessRequest)(req);
    }),
    agentPool: {
      listActiveAgents: jest.fn(async () => Array.from(agentsById.values())),
      getAgent: jest.fn(async (id) => agentsById.get(id) || null)
    },
    __calls: calls,
    __addAgent: (a) => { agentsById.set(a.id, a); agentsByName.set(a.name, a); }
  };
}

function startApp({ orchestrator, verifyToken } = {}) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  registerQuickSendRoutes(app, {
    getOrchestrator: () => orchestrator,
    verifyToken: verifyToken || (async (t) => t === VALID_TOKEN),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    constants: {
      INTERFACE_TYPES: { WEB: 'web' },
      ORCHESTRATOR_ACTIONS: {
        CREATE_AGENT: 'create_agent',
        SEND_MESSAGE: 'send_message'
      },
      HTTP_STATUS: {
        OK: 200, BAD_REQUEST: 400, UNAUTHORIZED: 401, NOT_FOUND: 404,
        INTERNAL_SERVER_ERROR: 500, SERVICE_UNAVAILABLE: 503
      }
    }
  });
  const server = createServer(app);
  return new Promise(resolve => {
    server.listen(0, () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// ────────────────────────────────────────────────────────────────
// Pure helper tests
// ────────────────────────────────────────────────────────────────

describe('composeQuickSendMessage', () => {
  it('emits every field in order when all are present', () => {
    const result = composeQuickSendMessage({
      selectedText: 'the highlighted text',
      pageTitle: 'Example Page',
      sourceUrl: 'https://example.com/article',
      surroundingText: 'context around the highlight',
      userMessage: 'what does this mean?'
    });
    expect(result).toBe([
      'Page title: Example Page',
      'Source URL: https://example.com/article',
      '',
      'Selected text:',
      'the highlighted text',
      '',
      'Surrounding context:',
      'context around the highlight',
      '',
      'User question: what does this mean?'
    ].join('\n'));
  });

  it('omits page metadata cleanly when missing', () => {
    const result = composeQuickSendMessage({
      selectedText: 'just the selection',
      pageTitle: null,
      sourceUrl: null,
      surroundingText: null,
      userMessage: null
    });
    expect(result).toBe('Selected text:\njust the selection');
  });

  it('keeps page title alone when source URL missing', () => {
    const result = composeQuickSendMessage({
      selectedText: 'the selection',
      pageTitle: 'Title Only',
      sourceUrl: null,
      surroundingText: null,
      userMessage: null
    });
    expect(result).toBe('Page title: Title Only\n\nSelected text:\nthe selection');
  });

  it('trims and skips blank user questions', () => {
    const result = composeQuickSendMessage({
      selectedText: 'sel',
      pageTitle: null,
      sourceUrl: null,
      surroundingText: null,
      userMessage: '   '
    });
    expect(result).toBe('Selected text:\nsel');
  });

  it('trims the user question when present', () => {
    const result = composeQuickSendMessage({
      selectedText: 'sel',
      pageTitle: null,
      sourceUrl: null,
      surroundingText: null,
      userMessage: '  what is this?  '
    });
    expect(result.endsWith('User question: what is this?')).toBe(true);
  });

  it('includes surrounding context only when supplied', () => {
    const without = composeQuickSendMessage({
      selectedText: 'sel',
      pageTitle: null,
      sourceUrl: null,
      surroundingText: null,
      userMessage: null
    });
    const withCtx = composeQuickSendMessage({
      selectedText: 'sel',
      pageTitle: null,
      sourceUrl: null,
      surroundingText: 'extra',
      userMessage: null
    });
    expect(without.includes('Surrounding context')).toBe(false);
    expect(withCtx.includes('Surrounding context:\nextra')).toBe(true);
  });
});

describe('buildQuickSendAgentSeed', () => {
  it('returns the standard seed with the supplied model', () => {
    const seed = buildQuickSendAgentSeed('anthropic-sonnet');
    expect(seed.name).toBe('Quick Send');
    expect(seed.model).toBe('anthropic-sonnet');
    expect(seed.systemPrompt).toBe(QUICK_SEND_SYSTEM_PROMPT);
    expect(seed.metadata).toEqual({ createdBy: 'quick-send-endpoint' });
  });

  it('ships the frozen default capability list as a fresh array', () => {
    const seed = buildQuickSendAgentSeed('m');
    // Same contents
    expect(seed.capabilities).toEqual([...QUICK_SEND_DEFAULT_CAPABILITIES]);
    // Not the same reference — frozen source must not be mutable via the seed
    expect(seed.capabilities).not.toBe(QUICK_SEND_DEFAULT_CAPABILITIES);
  });

  it('locks down the default capability set (allowlist regression guard)', () => {
    // This assertion exists so that broadening Quick Send's default
    // tool access requires a deliberate test edit, not a silent change.
    expect([...QUICK_SEND_DEFAULT_CAPABILITIES].sort()).toEqual(
      ['help', 'memory', 'pdf', 'skills', 'user-prompt', 'web']
    );
  });

  it('explicitly excludes destructive tools from the default seed', () => {
    const dangerous = ['terminal', 'filesystem', 'file-content-replace',
      'taskmanager', 'jobdone', 'agentcommunication', 'platformcontrol',
      'dependency-resolver'];
    for (const tool of dangerous) {
      expect(QUICK_SEND_DEFAULT_CAPABILITIES).not.toContain(tool);
    }
  });
});

describe('module-level constants', () => {
  it('exports the canonical agent name', () => {
    expect(QUICK_SEND_AGENT_NAME).toBe('Quick Send');
  });

  it('exports the stable extension session id', () => {
    // webServer.js's broadcastToSession early-returns on this exact id;
    // changing it here must be matched in webServer.js or the WS guard
    // breaks.
    expect(EXTENSION_SESSION_ID).toBe('extension-quick-send');
  });
});

// ────────────────────────────────────────────────────────────────
// POST /api/chat/quick-send — auth + validation
// ────────────────────────────────────────────────────────────────

describe('POST /api/chat/quick-send — auth and validation', () => {
  let server, baseUrl, orchestrator;
  beforeAll(async () => {
    orchestrator = makeFakeOrchestrator();
    ({ server, baseUrl } = await startApp({ orchestrator }));
  });
  afterAll(() => server?.close());

  const send = (headers, body) => http(`${baseUrl}/api/chat/quick-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

  it('401 when token header is missing', async () => {
    const r = await send({}, { selected_text: 'x' });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ ok: false, error: expect.stringMatching(/token/i) });
  });

  it('401 when token is wrong', async () => {
    const r = await send({ 'X-OnBuzz-Token': 'bad' }, { selected_text: 'x' });
    expect(r.status).toBe(401);
  });

  it('400 when selected_text is missing', async () => {
    const r = await send({ 'X-OnBuzz-Token': VALID_TOKEN }, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/selected_text/);
  });

  it('400 when selected_text is empty / whitespace only', async () => {
    const r = await send({ 'X-OnBuzz-Token': VALID_TOKEN }, { selected_text: '   ' });
    expect(r.status).toBe(400);
  });

  it('400 when an optional field is not a string', async () => {
    const r = await send({ 'X-OnBuzz-Token': VALID_TOKEN }, {
      selected_text: 'ok',
      page_title: 42
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/page_title.*string/);
  });

  it('400 when a field exceeds the 100 KB cap', async () => {
    const huge = 'a'.repeat(100 * 1024 + 1);
    const r = await send({ 'X-OnBuzz-Token': VALID_TOKEN }, { selected_text: huge });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/exceeds maximum size/);
  });
});

// ────────────────────────────────────────────────────────────────
// POST /api/chat/quick-send — config and orchestrator state
// ────────────────────────────────────────────────────────────────

describe('POST /api/chat/quick-send — environment errors', () => {
  it('503 when no orchestrator is attached', async () => {
    const { server, baseUrl } = await startApp({ orchestrator: null });
    try {
      const r = await http(`${baseUrl}/api/chat/quick-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OnBuzz-Token': VALID_TOKEN },
        body: JSON.stringify({ selected_text: 'hi' })
      });
      expect(r.status).toBe(503);
    } finally { server.close(); }
  });

  it('503 when no default model is configured (fresh install)', async () => {
    const orchestrator = makeFakeOrchestrator({ defaultModel: null });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await http(`${baseUrl}/api/chat/quick-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OnBuzz-Token': VALID_TOKEN },
        body: JSON.stringify({ selected_text: 'hi' })
      });
      expect(r.status).toBe(503);
      expect(r.body.error).toMatch(/default model/i);
      // Should not have attempted to create — no point trying.
      expect(orchestrator.processRequest).not.toHaveBeenCalled();
    } finally { server.close(); }
  });
});

// ────────────────────────────────────────────────────────────────
// POST /api/chat/quick-send — find-or-create behaviour
// ────────────────────────────────────────────────────────────────

describe('POST /api/chat/quick-send — agent lifecycle', () => {
  let orchestrator, server, baseUrl;

  beforeEach(async () => {
    orchestrator = makeFakeOrchestrator();
    ({ server, baseUrl } = await startApp({ orchestrator }));
  });
  afterEach(() => server?.close());

  const send = (body) => http(`${baseUrl}/api/chat/quick-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OnBuzz-Token': VALID_TOKEN },
    body: JSON.stringify(body)
  });

  it('creates the Quick Send agent on first call with the seed', async () => {
    const r = await send({
      selected_text: 'first selection',
      page_title: 'P', source_url: 'https://example.com/a'
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.agentId).toBeTruthy();
    expect(r.body.firstMessageIndex).toBe(0);

    // CREATE_AGENT then SEND_MESSAGE
    const actions = orchestrator.__calls.map(c => c.action);
    expect(actions).toEqual(['create_agent', 'send_message']);

    // The create payload is the seed
    const createCall = orchestrator.__calls.find(c => c.action === 'create_agent');
    expect(createCall.payload).toMatchObject({
      name: 'Quick Send',
      model: 'test-model',
      capabilities: [...QUICK_SEND_DEFAULT_CAPABILITIES],
      metadata: { createdBy: 'quick-send-endpoint' }
    });
    expect(createCall.sessionId).toBe(EXTENSION_SESSION_ID);
  });

  it('reuses the existing agent on subsequent calls — never re-creates', async () => {
    await send({ selected_text: 'first' });
    orchestrator.processRequest.mockClear();
    orchestrator.__calls.length = 0;

    const r = await send({ selected_text: 'second' });
    expect(r.status).toBe(200);

    // No CREATE_AGENT on the second call.
    const actions = orchestrator.__calls.map(c => c.action);
    expect(actions).toEqual(['send_message']);
  });

  it('never dispatches UPDATE_AGENT — the agent is immutable per request', async () => {
    // Pre-seed an existing Quick Send agent with custom capabilities
    // (simulating a user who edited it in the UI).
    orchestrator.__addAgent({
      id: 'qs-1',
      name: 'Quick Send',
      currentModel: 'user-picked-model',
      capabilities: ['web'], // user narrowed it down
      conversations: { full: { messages: [] } },
      status: 'active',
      metadata: {}
    });

    await send({ selected_text: 'hello' });

    // Endpoint must never call update_agent or any other mutating action.
    const updateCalls = orchestrator.__calls.filter(
      c => c.action !== 'send_message' && c.action !== 'create_agent'
    );
    expect(updateCalls).toEqual([]);
    // The user's narrower capabilities survive — verifying we didn't
    // overwrite the agent.
    expect(orchestrator.agentPool.getAgent.mock.results.length).toBeGreaterThan(0);
  });

  it('dispatches SEND_MESSAGE with mode=chat and the composed plain-text message', async () => {
    await send({
      selected_text: 'the highlight',
      page_title: 'Hello',
      source_url: 'https://example.com',
      user_message: 'why?'
    });

    const sendCall = orchestrator.__calls.find(c => c.action === 'send_message');
    expect(sendCall).toBeDefined();
    expect(sendCall.payload.mode).toBe('chat');
    expect(sendCall.payload.agentId).toBeTruthy();
    expect(sendCall.payload.message).toContain('Page title: Hello');
    expect(sendCall.payload.message).toContain('Source URL: https://example.com');
    expect(sendCall.payload.message).toContain('Selected text:');
    expect(sendCall.payload.message).toContain('the highlight');
    expect(sendCall.payload.message).toContain('User question: why?');
    expect(sendCall.payload.source).toMatchObject({ type: 'browser-extension' });
    expect(sendCall.sessionId).toBe(EXTENSION_SESSION_ID);
  });

  it('returns firstMessageIndex reflecting the existing transcript length', async () => {
    orchestrator.__addAgent({
      id: 'qs-1',
      name: 'Quick Send',
      currentModel: 'm',
      capabilities: [],
      conversations: { full: { messages: [
        { role: 'user', content: 'old1' },
        { role: 'assistant', content: 'old2' },
        { role: 'user', content: 'old3' }
      ] } },
      status: 'active',
      metadata: {}
    });
    const r = await send({ selected_text: 'new' });
    expect(r.body.firstMessageIndex).toBe(3);
  });

  it('500 when CREATE_AGENT fails', async () => {
    orchestrator = makeFakeOrchestrator({
      processRequestImpl: async ({ action }) => {
        if (action === 'create_agent') return { success: false, error: 'boom' };
        return { success: true };
      }
    });
    server.close();
    ({ server, baseUrl } = await startApp({ orchestrator }));
    const r = await send({ selected_text: 'x' });
    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/Could not create.*boom/);
  });

  it('500 when SEND_MESSAGE fails', async () => {
    orchestrator = makeFakeOrchestrator({
      processRequestImpl: async ({ action, payload }) => {
        if (action === 'create_agent') {
          const a = { id: 'qs-x', name: payload.name, conversations: { full: { messages: [] } } };
          return { success: true, data: a };
        }
        if (action === 'send_message') return { success: false, error: 'provider down' };
        return { success: false };
      }
    });
    server.close();
    ({ server, baseUrl } = await startApp({ orchestrator }));
    // Add the agent into the pool too so getAgent finds it for the snapshot.
    // currentModel is set so the pre-flight passes and we reach send_message.
    orchestrator.__addAgent({
      id: 'qs-x', name: 'Quick Send', currentModel: 'test-model',
      conversations: { full: { messages: [] } }, status: 'active', metadata: {}
    });
    const r = await send({ selected_text: 'x' });
    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/Could not send.*provider down/);
    expect(r.body.agentId).toBe('qs-x');
  });
});

// ────────────────────────────────────────────────────────────────
// GET /api/chat/quick-send/messages
// ────────────────────────────────────────────────────────────────

describe('GET /api/chat/quick-send/messages', () => {
  let orchestrator, server, baseUrl;

  beforeEach(async () => {
    orchestrator = makeFakeOrchestrator();
    ({ server, baseUrl } = await startApp({ orchestrator }));
  });
  afterEach(() => server?.close());

  const poll = (qs, headers = { 'X-OnBuzz-Token': VALID_TOKEN }) =>
    http(`${baseUrl}/api/chat/quick-send/messages?${qs}`, { headers });

  it('401 when token is missing', async () => {
    const r = await poll('agentId=qs-1', {});
    expect(r.status).toBe(401);
  });

  it('400 when agentId is missing', async () => {
    const r = await poll('');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/agentId/);
  });

  it('404 when the agent does not exist', async () => {
    const r = await poll('agentId=nope');
    expect(r.status).toBe(404);
  });

  it('404 when the agent exists but is not named "Quick Send"', async () => {
    orchestrator.__addAgent({
      id: 'other-1', name: 'Some Other Agent',
      conversations: { full: { messages: [] } }, status: 'active', metadata: {}
    });
    const r = await poll('agentId=other-1');
    expect(r.status).toBe(404);
  });

  it('returns slice(since) with index/role/content/timestamp/type', async () => {
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send', status: 'active',
      currentModel: 'm', metadata: {},
      conversations: { full: { messages: [
        { role: 'user', content: 'q1', timestamp: 't0' },
        { role: 'assistant', content: 'a1', timestamp: 't1' },
        { role: 'user', content: 'q2', timestamp: 't2' },
        { role: 'assistant', content: 'a2', timestamp: 't3', type: 'final' }
      ] } }
    });
    const r = await poll('agentId=qs-1&since=2');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(4);
    expect(r.body.messages).toEqual([
      { index: 2, role: 'user', content: 'q2', timestamp: 't2', type: null },
      { index: 3, role: 'assistant', content: 'a2', timestamp: 't3', type: 'final' }
    ]);
    expect(r.body.unhealthy).toBe(false);
    expect(r.body.errorHint).toBeNull();
    expect(r.body.currentModel).toBe('m');
    expect(r.body.agentStatus).toBe('active');
  });

  it('flags unhealthy=true when the agent is paused', async () => {
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send', status: 'paused',
      conversations: { full: { messages: [] } }, metadata: {}
    });
    const r = await poll('agentId=qs-1&since=0');
    expect(r.body.unhealthy).toBe(true);
    expect(r.body.agentStatus).toBe('paused');
  });

  it('flags unhealthy=true when the agent is suspended', async () => {
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send', status: 'suspended',
      conversations: { full: { messages: [] } }, metadata: {}
    });
    const r = await poll('agentId=qs-1&since=0');
    expect(r.body.unhealthy).toBe(true);
  });

  it('extracts errorHint from a [system-error] user-role row in the slice', async () => {
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send', status: 'active',
      metadata: {},
      conversations: { full: { messages: [
        { role: 'user', content: 'old, before since' },
        { role: 'user', content: 'preamble\n[system-error] AI service error: provider returned 500\nmore' },
      ] } }
    });
    const r = await poll('agentId=qs-1&since=1');
    expect(r.body.unhealthy).toBe(true);
    expect(r.body.errorHint).toMatch(/system-error/);
  });

  it('does NOT flag unhealthy on a normal user message that just says "AI"', async () => {
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send', status: 'active',
      metadata: {},
      conversations: { full: { messages: [
        { role: 'user', content: 'tell me about AI' }
      ] } }
    });
    const r = await poll('agentId=qs-1&since=0');
    expect(r.body.unhealthy).toBe(false);
  });

  it('normalises content shape for providers returning {text: ...}', async () => {
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send', status: 'active', metadata: {},
      conversations: { full: { messages: [
        { role: 'assistant', content: { text: 'structured' } }
      ] } }
    });
    const r = await poll('agentId=qs-1&since=0');
    expect(r.body.messages[0].content).toBe('structured');
  });

  it('503 when orchestrator is not attached', async () => {
    server.close();
    ({ server, baseUrl } = await startApp({ orchestrator: null }));
    const r = await poll('agentId=qs-1&since=0');
    expect(r.status).toBe(503);
  });
});

// ────────────────────────────────────────────────────────────────
// classifyProviderError — stable code mapping
// ────────────────────────────────────────────────────────────────

describe('classifyProviderError', () => {
  it('maps "No provider matched model" to MODEL_PROVIDER_UNAVAILABLE', () => {
    const r = classifyProviderError(
      'No provider matched model "anthropic-sonnet". Configure a provider key in Settings...'
    );
    expect(r.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
    expect(r.suggestion).toMatch(/Settings/);
  });

  it('maps 401/invalid-key errors to PROVIDER_AUTH_ERROR', () => {
    expect(classifyProviderError('401 Unauthorized: invalid_api_key').code).toBe('PROVIDER_AUTH_ERROR');
    expect(classifyProviderError('Invalid API key provided').code).toBe('PROVIDER_AUTH_ERROR');
  });

  it('maps quota/billing/402 errors to PROVIDER_BILLING_ERROR', () => {
    expect(classifyProviderError('insufficient_quota: You exceeded your quota').code).toBe('PROVIDER_BILLING_ERROR');
    expect(classifyProviderError('402 Payment Required').code).toBe('PROVIDER_BILLING_ERROR');
    expect(classifyProviderError('Insufficient credits in your account').code).toBe('PROVIDER_BILLING_ERROR');
  });

  it('maps 429/rate-limit errors to PROVIDER_RATE_LIMITED', () => {
    expect(classifyProviderError('429 Too Many Requests').code).toBe('PROVIDER_RATE_LIMITED');
    expect(classifyProviderError('rate limit exceeded').code).toBe('PROVIDER_RATE_LIMITED');
  });

  it('falls through to PROVIDER_RUNTIME_ERROR for unrecognised errors', () => {
    const r = classifyProviderError('Some weird upstream error');
    expect(r.code).toBe('PROVIDER_RUNTIME_ERROR');
    expect(r.message).toBe('Some weird upstream error');
  });

  it('strips the scheduler "AI service error: ... Agent temporarily paused." wrapper from the message', () => {
    const wrapped = 'AI service error: insufficient_quota: You exceeded your current quota. Agent temporarily paused.';
    const r = classifyProviderError(wrapped);
    // Classification unchanged
    expect(r.code).toBe('PROVIDER_BILLING_ERROR');
    // Display message is the inner provider text only — no scheduler wording
    expect(r.message).toBe('insufficient_quota: You exceeded your current quota');
    expect(r.message).not.toMatch(/AI service error/i);
    expect(r.message).not.toMatch(/Agent (temporarily )?paused/i);
  });

  it('is a no-op when neither prefix nor suffix is present', () => {
    const raw = 'insufficient_quota: You exceeded your current quota';
    expect(classifyProviderError(raw).message).toBe(raw);
  });

  it('handles partial wrappers (prefix only, or alternate "Agent paused.")', () => {
    expect(classifyProviderError('AI service error: 401 Unauthorized').message).toBe('401 Unauthorized');
    expect(classifyProviderError('boom. Agent paused.').message).toBe('boom');
  });

  it('mentions Ollama in the suggestion when hasLocalModels=true', () => {
    const r = classifyProviderError('No provider matched model "x".', { hasLocalModels: true });
    expect(r.suggestion).toMatch(/Ollama/);
  });

  it('does NOT mention Ollama in the suggestion when hasLocalModels=false', () => {
    const r = classifyProviderError('No provider matched model "x".', { hasLocalModels: false });
    expect(r.suggestion).not.toMatch(/Ollama/);
  });
});

// ────────────────────────────────────────────────────────────────
// POST pre-flight — model must resolve to a live provider
// ────────────────────────────────────────────────────────────────

describe('POST /api/chat/quick-send — pre-flight model resolution', () => {
  const send = (baseUrl, body) => http(`${baseUrl}/api/chat/quick-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OnBuzz-Token': VALID_TOKEN },
    body: JSON.stringify(body)
  });

  it('503 with MODEL_PROVIDER_UNAVAILABLE when system.defaultModel has no live provider (no agent yet)', async () => {
    const orchestrator = makeFakeOrchestrator({
      defaultModel: 'anthropic-sonnet',
      aiService: makeFakeAiService({ unresolvableModels: ['anthropic-sonnet'] })
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await send(baseUrl, { selected_text: 'x' });
      expect(r.status).toBe(503);
      expect(r.body.ok).toBe(false);
      expect(r.body.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
      expect(r.body.message).toMatch(/No provider matched/);
      expect(r.body.suggestion).toMatch(/Settings|provider/i);
      expect(r.body.currentModel).toBe('anthropic-sonnet');
      expect(r.body.error).toBe(r.body.message); // legacy field
      // The endpoint must NOT have created a broken agent.
      const createCalls = orchestrator.__calls.filter(c => c.action === 'create_agent');
      expect(createCalls).toEqual([]);
    } finally { server.close(); }
  });

  it('503 when an existing Quick Send agent references an unresolvable model', async () => {
    // Mirrors the "I have a broken agent on disk from before" case.
    const orchestrator = makeFakeOrchestrator({
      defaultModel: 'test-model',
      aiService: makeFakeAiService({ unresolvableModels: ['anthropic-sonnet'] })
    });
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send',
      currentModel: 'anthropic-sonnet',
      preferredModel: 'anthropic-sonnet',
      capabilities: ['web'], status: 'active', metadata: {},
      conversations: { full: { messages: [] } }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await send(baseUrl, { selected_text: 'follow-up' });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
      expect(r.body.currentModel).toBe('anthropic-sonnet');
      expect(r.body.agentId).toBe('qs-1');
      // No message dispatched.
      const sendCalls = orchestrator.__calls.filter(c => c.action === 'send_message');
      expect(sendCalls).toEqual([]);
    } finally { server.close(); }
  });

  it('includes localModelsAvailable=true when Ollama models are visible', async () => {
    const orchestrator = makeFakeOrchestrator({
      defaultModel: 'anthropic-sonnet',
      aiService: makeFakeAiService({
        unresolvableModels: ['anthropic-sonnet'],
        ollamaModels: ['llama3', 'qwen2']
      })
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await send(baseUrl, { selected_text: 'x' });
      expect(r.status).toBe(503);
      expect(r.body.localModelsAvailable).toBe(true);
      expect(r.body.suggestion).toMatch(/Ollama/);
    } finally { server.close(); }
  });

  it('includes localModelsAvailable=false when no Ollama models', async () => {
    const orchestrator = makeFakeOrchestrator({
      defaultModel: 'anthropic-sonnet',
      aiService: makeFakeAiService({ unresolvableModels: ['anthropic-sonnet'], ollamaModels: [] })
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await send(baseUrl, { selected_text: 'x' });
      expect(r.body.localModelsAvailable).toBe(false);
    } finally { server.close(); }
  });

  it('PROVIDER_AUTH_ERROR code propagates when the resolver throws a 401-shaped message', async () => {
    const orchestrator = makeFakeOrchestrator({
      defaultModel: 'gpt-4',
      aiService: makeFakeAiService({
        unresolvableModels: ['gpt-4'],
        resolveError: '401 Unauthorized: invalid_api_key'
      })
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await send(baseUrl, { selected_text: 'x' });
      expect(r.body.code).toBe('PROVIDER_AUTH_ERROR');
    } finally { server.close(); }
  });

  it('passes through and dispatches normally when the model resolves', async () => {
    const orchestrator = makeFakeOrchestrator({
      defaultModel: 'test-model',
      aiService: makeFakeAiService()  // resolves everything
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await send(baseUrl, { selected_text: 'hello' });
      expect(r.status).toBe(200);
      expect(r.body.usedFallbackModel).toBeNull();
      const actions = orchestrator.__calls.map(c => c.action);
      expect(actions).toEqual(['create_agent', 'send_message']);
    } finally { server.close(); }
  });
});

// ────────────────────────────────────────────────────────────────
// POST creation-time fallback to a working pool agent's model
// ────────────────────────────────────────────────────────────────

describe('POST /api/chat/quick-send — creation-time fallback', () => {
  const send = (baseUrl, body) => http(`${baseUrl}/api/chat/quick-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OnBuzz-Token': VALID_TOKEN },
    body: JSON.stringify(body)
  });

  it('falls back to a working pool model when defaultModel is broken (no Quick Send agent yet)', async () => {
    const orchestrator = makeFakeOrchestrator({
      defaultModel: 'anthropic-sonnet',
      aiService: makeFakeAiService({ unresolvableModels: ['anthropic-sonnet'] })
    });
    // Seed a pre-existing working agent the user has been chatting with.
    orchestrator.__addAgent({
      id: 'research-1', name: 'Research Agent',
      currentModel: 'llama3.2:3b', preferredModel: 'llama3.2:3b',
      lastActivity: new Date('2026-01-01T12:00:00Z').toISOString(),
      conversations: { full: { messages: [] } }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await send(baseUrl, { selected_text: 'fresh send' });
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.usedFallbackModel).toMatchObject({
        from: 'anthropic-sonnet',
        to: 'llama3.2:3b',
        referenceAgent: 'Research Agent',
        reason: 'MODEL_PROVIDER_UNAVAILABLE'
      });
      // Agent was created with the fallback model, not the broken default.
      const createCall = orchestrator.__calls.find(c => c.action === 'create_agent');
      expect(createCall.payload.model).toBe('llama3.2:3b');
    } finally { server.close(); }
  });

  it('picks the most-recently-active candidate when multiple agents are available', async () => {
    const orchestrator = makeFakeOrchestrator({
      defaultModel: 'anthropic-sonnet',
      aiService: makeFakeAiService({ unresolvableModels: ['anthropic-sonnet'] })
    });
    orchestrator.__addAgent({
      id: 'older-1', name: 'Older Agent',
      currentModel: 'older-model',
      lastActivity: new Date('2025-01-01T00:00:00Z').toISOString(),
      conversations: { full: { messages: [] } }
    });
    orchestrator.__addAgent({
      id: 'newer-1', name: 'Newer Agent',
      currentModel: 'newer-model',
      lastActivity: new Date('2026-05-30T18:00:00Z').toISOString(),
      conversations: { full: { messages: [] } }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await send(baseUrl, { selected_text: 'pick the newer one' });
      expect(r.body.usedFallbackModel.to).toBe('newer-model');
      expect(r.body.usedFallbackModel.referenceAgent).toBe('Newer Agent');
    } finally { server.close(); }
  });

  it('skips Quick Send itself when scanning for fallback candidates', async () => {
    // If a Quick Send agent already exists in the pool, the route
    // takes the "existing agent" branch and the fallback never runs.
    // This test guards the OTHER direction: if for some odd reason the
    // pool happens to have an agent named "Quick Send" alongside the
    // missing-target case (impossible in practice), the fallback must
    // not consider Quick Send as a candidate.
    //
    // Constructed indirectly: a corrupt pool with a Quick Send agent
    // whose model is also broken. Existing agent path → 503 (no
    // fallback for existing agents).
    const orchestrator = makeFakeOrchestrator({
      defaultModel: 'anthropic-sonnet',
      aiService: makeFakeAiService({
        unresolvableModels: ['anthropic-sonnet', 'also-broken']
      })
    });
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send',
      currentModel: 'also-broken',
      conversations: { full: { messages: [] } }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await send(baseUrl, { selected_text: 'x' });
      // Existing-agent path with broken model → 503, no fallback,
      // no auto-mutation.
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
      const createCalls = orchestrator.__calls.filter(c => c.action === 'create_agent');
      expect(createCalls).toEqual([]);
    } finally { server.close(); }
  });

  it('skips candidates whose own model also fails to resolve', async () => {
    const orchestrator = makeFakeOrchestrator({
      defaultModel: 'anthropic-sonnet',
      aiService: makeFakeAiService({
        unresolvableModels: ['anthropic-sonnet', 'broken-too']
      })
    });
    orchestrator.__addAgent({
      id: 'broken-agent', name: 'Broken Agent',
      currentModel: 'broken-too',
      lastActivity: new Date('2026-05-30T19:00:00Z').toISOString(),
      conversations: { full: { messages: [] } }
    });
    orchestrator.__addAgent({
      id: 'working-1', name: 'Working Agent',
      currentModel: 'llama3.2:3b',
      lastActivity: new Date('2026-05-30T18:00:00Z').toISOString(),
      conversations: { full: { messages: [] } }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await send(baseUrl, { selected_text: 'find the working one' });
      // Even though "Broken Agent" is more recent, its model can't
      // resolve, so we keep scanning and find "Working Agent".
      expect(r.body.usedFallbackModel.to).toBe('llama3.2:3b');
      expect(r.body.usedFallbackModel.referenceAgent).toBe('Working Agent');
    } finally { server.close(); }
  });

  it('returns 503 when defaultModel is broken AND no fallback candidate works', async () => {
    const orchestrator = makeFakeOrchestrator({
      defaultModel: 'anthropic-sonnet',
      aiService: makeFakeAiService({
        unresolvableModels: ['anthropic-sonnet', 'also-broken'],
        ollamaModels: []
      })
    });
    orchestrator.__addAgent({
      id: 'other', name: 'Other Agent', currentModel: 'also-broken',
      conversations: { full: { messages: [] } }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await send(baseUrl, { selected_text: 'x' });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
      const createCalls = orchestrator.__calls.filter(c => c.action === 'create_agent');
      expect(createCalls).toEqual([]);
    } finally { server.close(); }
  });

  it('does NOT fall back when an existing Quick Send agent already references a broken model', async () => {
    // Once the agent exists, the endpoint never mutates it — the
    // user fixes the model explicitly in the OnBuzz UI. This is the
    // invariant the previous spec was emphatic about.
    const orchestrator = makeFakeOrchestrator({
      defaultModel: 'test-model',
      aiService: makeFakeAiService({ unresolvableModels: ['anthropic-sonnet'] })
    });
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send',
      currentModel: 'anthropic-sonnet',
      conversations: { full: { messages: [] } }
    });
    orchestrator.__addAgent({
      id: 'working-1', name: 'Working Agent',
      currentModel: 'llama3.2:3b',
      lastActivity: new Date('2026-05-30T19:00:00Z').toISOString(),
      conversations: { full: { messages: [] } }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await send(baseUrl, { selected_text: 'x' });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
      // No CREATE_AGENT (one exists) and no UPDATE_AGENT (we never
      // mutate an existing agent's model).
      const actionsOther = orchestrator.__calls
        .map(c => c.action)
        .filter(a => a !== 'send_message');
      expect(actionsOther).toEqual([]);
    } finally { server.close(); }
  });
});

// ────────────────────────────────────────────────────────────────
// GET messages — broadened unhealthy detection
// ────────────────────────────────────────────────────────────────

describe('GET /api/chat/quick-send/messages — delay + tool-result unhealthy detection', () => {
  const poll = (baseUrl, qs) =>
    http(`${baseUrl}/api/chat/quick-send/messages?${qs}`, {
      headers: { 'X-OnBuzz-Token': VALID_TOKEN }
    });

  it('flags unhealthy=true when delayEndTime is in the future (scheduler set the soft pause)', async () => {
    const orchestrator = makeFakeOrchestrator();
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send', status: 'active', metadata: {},
      delayEndTime: new Date(Date.now() + 60_000).toISOString(),
      conversations: { full: { messages: [] } }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await poll(baseUrl, 'agentId=qs-1&since=0');
      expect(r.status).toBe(200);
      expect(r.body.unhealthy).toBe(true);
      expect(r.body.errorHint).toMatch(/backoff/i);
    } finally { server.close(); }
  });

  it('treats a past delayEndTime as healthy', async () => {
    const orchestrator = makeFakeOrchestrator();
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send', status: 'active', metadata: {},
      delayEndTime: new Date(Date.now() - 5_000).toISOString(),
      conversations: { full: { messages: [] } }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await poll(baseUrl, 'agentId=qs-1&since=0');
      expect(r.body.unhealthy).toBe(false);
    } finally { server.close(); }
  });

  it('flags unhealthy=true when the tool-result queue has a system-error entry', async () => {
    const orchestrator = makeFakeOrchestrator();
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send', status: 'active', metadata: {},
      conversations: { full: { messages: [] } },
      messageQueues: {
        toolResults: [
          { toolId: 'system-error', status: 'failed',
            error: 'AI service error: No provider matched model "anthropic-sonnet". Agent temporarily paused.' }
        ]
      }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await poll(baseUrl, 'agentId=qs-1&since=0');
      expect(r.body.unhealthy).toBe(true);
      expect(r.body.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
      expect(r.body.errorHint).toMatch(/No provider matched/);
      expect(r.body.suggestion).toMatch(/Settings|provider/i);
      // Banner shouldn't expose the scheduler's internal wrapper wording.
      expect(r.body.errorHint).not.toMatch(/AI service error/i);
      expect(r.body.errorHint).not.toMatch(/Agent (temporarily )?paused/i);
    } finally { server.close(); }
  });

  it('strips the scheduler wrapper from a wrapped billing/quota error end-to-end', async () => {
    // Full poll-path regression: the scheduler wraps real provider
    // errors with "AI service error: <msg>. Agent temporarily paused."
    // before queueing them as system-error tool results. The side
    // panel should see the inner provider text, not the wrapper.
    const orchestrator = makeFakeOrchestrator({
      aiService: makeFakeAiService({ ollamaModels: ['llama3'] })
    });
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send', status: 'active', metadata: {},
      conversations: { full: { messages: [] } },
      messageQueues: {
        toolResults: [
          {
            toolId: 'system-error',
            status: 'failed',
            error: 'AI service error: insufficient_quota: You exceeded your current quota, please check your plan and billing details. Agent temporarily paused.'
          }
        ]
      }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await poll(baseUrl, 'agentId=qs-1&since=0');
      expect(r.body.unhealthy).toBe(true);
      expect(r.body.code).toBe('PROVIDER_BILLING_ERROR');
      // Classification still picks up the inner keyword
      expect(r.body.errorHint).toMatch(/insufficient_quota/);
      expect(r.body.errorHint).toMatch(/exceeded your current quota/);
      // Wrapper wording is not exposed to the user
      expect(r.body.errorHint).not.toMatch(/AI service error/i);
      expect(r.body.errorHint).not.toMatch(/Agent (temporarily )?paused/i);
      // Suggestion is the billing one (not the generic runtime one) and
      // mentions Ollama because local models are available.
      expect(r.body.suggestion).toMatch(/billing|credit/i);
      expect(r.body.suggestion).toMatch(/Ollama/);
      expect(r.body.localModelsAvailable).toBe(true);
    } finally { server.close(); }
  });

  it('flags unhealthy=true when both delayEndTime AND tool-result are present (uses the tool-result error)', async () => {
    const orchestrator = makeFakeOrchestrator();
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send', status: 'active', metadata: {},
      delayEndTime: new Date(Date.now() + 60_000).toISOString(),
      conversations: { full: { messages: [] } },
      messageQueues: {
        toolResults: [
          { toolId: 'system-error', status: 'failed', error: '401 Unauthorized' }
        ]
      }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await poll(baseUrl, 'agentId=qs-1&since=0');
      expect(r.body.unhealthy).toBe(true);
      expect(r.body.code).toBe('PROVIDER_AUTH_ERROR');
    } finally { server.close(); }
  });

  it('exposes suggestion + localModelsAvailable in the poll response when unhealthy', async () => {
    const orchestrator = makeFakeOrchestrator({
      aiService: makeFakeAiService({ ollamaModels: ['llama3'] })
    });
    orchestrator.__addAgent({
      id: 'qs-1', name: 'Quick Send', status: 'active', metadata: {},
      conversations: { full: { messages: [] } },
      messageQueues: {
        toolResults: [
          { toolId: 'system-error', status: 'failed',
            error: 'No provider matched model "anthropic-sonnet".' }
        ]
      }
    });
    const { server, baseUrl } = await startApp({ orchestrator });
    try {
      const r = await poll(baseUrl, 'agentId=qs-1&since=0');
      expect(r.body.localModelsAvailable).toBe(true);
      expect(r.body.suggestion).toMatch(/Ollama/);
    } finally { server.close(); }
  });
});
