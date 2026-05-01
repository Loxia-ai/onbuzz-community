/**
 * HTTP route tests for the agent memory + context-snapshot routes.
 *
 * Mounts a real express app + the production registerAgentContextRoutes
 * helper with stubbed memory service / agent pool, hits each endpoint via
 * fetch, asserts the JSON shape. Same approach as schedulerRoutes.test.js.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import { createServer } from 'http';
import { registerAgentContextRoutes } from '../agentContextRoutes.js';

async function http(url, options = {}) {
  const resp = await globalThis.fetch(url, options);
  const ct = resp.headers.get('content-type') || '';
  const body = ct.includes('json') ? await resp.json() : await resp.text();
  return { status: resp.status, body };
}

function makeMemoryService() {
  const mems = new Map();   // agentId → memories[]
  return {
    loadMemories: jest.fn(async (agentId) => mems.get(agentId) || []),
    addMemory:    jest.fn(async (agentId, data) => {
      const mem = { id: 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), ...data, createdAt: new Date().toISOString() };
      const list = mems.get(agentId) || [];
      list.push(mem);
      mems.set(agentId, list);
      return mem;
    }),
    updateMemory: jest.fn(async (agentId, memId, updates) => {
      const list = mems.get(agentId) || [];
      const i = list.findIndex(m => m.id === memId);
      if (i === -1) return null;
      list[i] = { ...list[i], ...updates, updatedAt: new Date().toISOString() };
      return list[i];
    }),
    deleteMemory: jest.fn(async (agentId, memId) => {
      const list = mems.get(agentId) || [];
      const i = list.findIndex(m => m.id === memId);
      if (i === -1) return false;
      list.splice(i, 1);
      return true;
    }),
    _store: mems,
  };
}

function startApp({ memoryService, agentPool }) {
  const app = express();
  app.use(express.json());
  registerAgentContextRoutes(app, {
    getAgentPool: () => agentPool,
    getMemoryService: () => memoryService,
    logger: { error: jest.fn(), warn: jest.fn() },
  });
  const server = createServer(app);
  return new Promise(resolve => {
    server.listen(0, () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://localhost:${port}` });
    });
  });
}

describe('memory CRUD', () => {
  let server, baseUrl, mem;
  beforeAll(async () => {
    mem = makeMemoryService();
    ({ server, baseUrl } = await startApp({ memoryService: mem, agentPool: null }));
  });
  afterAll(() => server?.close());

  it('GET memories returns empty list initially', async () => {
    const r = await http(`${baseUrl}/api/agents/agent-x/memories`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, count: 0, memories: [] });
  });

  it('POST adds a memory and returns it', async () => {
    const r = await http(`${baseUrl}/api/agents/agent-x/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'A note', content: 'remember this' }),
    });
    expect(r.status).toBe(200);
    expect(r.body.memory).toMatchObject({ title: 'A note', content: 'remember this' });
    expect(r.body.memory.id).toMatch(/^m-/);
  });

  it('POST trims title/description; rejects empty title', async () => {
    const r1 = await http(`${baseUrl}/api/agents/agent-x/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ', content: 'x' }),
    });
    expect(r1.status).toBe(400);
    const r2 = await http(`${baseUrl}/api/agents/agent-x/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '  Trimmed  ', description: '  desc  ', content: 'c' }),
    });
    expect(r2.status).toBe(200);
    expect(r2.body.memory.title).toBe('Trimmed');
    expect(r2.body.memory.description).toBe('desc');
  });

  it('POST rejects when content is missing', async () => {
    const r = await http(`${baseUrl}/api/agents/agent-x/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'no content' }),
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/content/);
  });

  it('PUT updates an existing memory', async () => {
    const created = await http(`${baseUrl}/api/agents/agent-x/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'orig', content: 'c' }),
    });
    const id = created.body.memory.id;
    const r = await http(`${baseUrl}/api/agents/agent-x/memories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'updated' }),
    });
    expect(r.status).toBe(200);
    expect(r.body.memory.title).toBe('updated');
  });

  it('PUT 404s on unknown memoryId', async () => {
    const r = await http(`${baseUrl}/api/agents/agent-x/memories/nope`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(r.status).toBe(404);
  });

  it('DELETE removes a memory', async () => {
    const created = await http(`${baseUrl}/api/agents/agent-x/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'goner', content: 'bye' }),
    });
    const id = created.body.memory.id;
    const r = await http(`${baseUrl}/api/agents/agent-x/memories/${id}`, { method: 'DELETE' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    // PUT after delete → 404
    const after = await http(`${baseUrl}/api/agents/agent-x/memories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(after.status).toBe(404);
  });

  it('DELETE 404s on unknown memoryId', async () => {
    const r = await http(`${baseUrl}/api/agents/agent-x/memories/nope`, { method: 'DELETE' });
    expect(r.status).toBe(404);
  });
});

describe('context snapshot', () => {
  let server, baseUrl;
  const messages = [
    { role: 'system', content: 'system…' },
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there' },
  ];
  const agent = {
    id: 'agent-x', name: 'Test', mode: 'AGENT', status: 'ACTIVE',
    currentModel: 'gpt-x',
    preferredModel: 'gpt-x',
    originalSystemPrompt: 'You are helpful.',
    systemPrompt: 'You are helpful.\n\n[Tools: ...]',
    messageQueues: {
      userMessages: [{ content: 'pending user msg', timestamp: '2026-04-26T00:00:00Z' }],
      interAgentMessages: [],
      toolResults: [{ content: 'tool result body' }],
    },
  };
  const agentPool = {
    getAgent: jest.fn(async (id) => id === 'agent-x' ? agent : null),
    getMessagesForAI: jest.fn(async () => messages),
  };

  beforeAll(async () => {
    ({ server, baseUrl } = await startApp({
      memoryService: makeMemoryService(),
      agentPool,
    }));
  });
  afterAll(() => server?.close());

  it('returns the full snapshot shape', async () => {
    const r = await http(`${baseUrl}/api/agents/agent-x/context-snapshot`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      success: true,
      agent: { id: 'agent-x', name: 'Test', currentModel: 'gpt-x' },
      systemPrompt: {
        original: 'You are helpful.',
        full: 'You are helpful.\n\n[Tools: ...]',
        originalLength: 16,
        fullLength: 30,
        enhancementBytes: 14,
      },
      pendingQueues: {
        userMessages: [expect.objectContaining({ contentPreview: 'pending user msg' })],
        interAgentMessages: [],
        toolResults: [expect.objectContaining({ contentPreview: 'tool result body' })],
      },
    });
    expect(r.body.messages).toHaveLength(3);
    expect(r.body.messages[0]).toMatchObject({ index: 0, role: 'system' });
    expect(r.body.stats.messageCount).toBe(3);
    expect(r.body.stats.estimatedTokens).toBeGreaterThan(0);
  });

  it('truncates very long message content (with `truncated:true`)', async () => {
    const huge = 'x'.repeat(10_000);
    agentPool.getMessagesForAI.mockResolvedValueOnce([{ role: 'user', content: huge }]);
    const r = await http(`${baseUrl}/api/agents/agent-x/context-snapshot`);
    expect(r.body.messages[0].truncated).toBe(true);
    expect(r.body.messages[0].contentPreview.length).toBeLessThan(huge.length);
    expect(r.body.messages[0].contentLength).toBe(huge.length);
  });

  it('returns 404 for unknown agent', async () => {
    const r = await http(`${baseUrl}/api/agents/missing/context-snapshot`);
    expect(r.status).toBe(404);
  });

  it('surfaces messagesError when getMessagesForAI throws (rather than 500ing)', async () => {
    agentPool.getMessagesForAI.mockRejectedValueOnce(new Error('boom'));
    const r = await http(`${baseUrl}/api/agents/agent-x/context-snapshot`);
    expect(r.status).toBe(200);          // snapshot still returns
    expect(r.body.messages).toEqual([]);
    expect(r.body.messagesError).toMatch(/boom/);
    // System prompt + queues still surface for UI use
    expect(r.body.systemPrompt.full).toBeTruthy();
  });
});

describe('defensive', () => {
  it('agentPool unavailable → 503 on context-snapshot, but memory routes still work', async () => {
    const mem = makeMemoryService();
    const { server, baseUrl } = await startApp({ memoryService: mem, agentPool: null });
    try {
      const ctx = await http(`${baseUrl}/api/agents/agent-x/context-snapshot`);
      expect(ctx.status).toBe(503);
      const list = await http(`${baseUrl}/api/agents/agent-x/memories`);
      expect(list.status).toBe(200);
    } finally { server.close(); }
  });

  it('registerAgentContextRoutes(null) is a no-op', () => {
    expect(() => registerAgentContextRoutes(null, {})).not.toThrow();
  });

  it('registerAgentContextRoutes without getMemoryService skips registration', () => {
    const app = express();
    expect(() => registerAgentContextRoutes(app, { getAgentPool: () => null })).not.toThrow();
    // No routes added — sanity check by hitting one (will 404 since unmounted).
    // We don't need a server; the express stack just won't have these handlers.
  });
});
