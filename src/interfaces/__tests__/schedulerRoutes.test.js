/**
 * HTTP route tests for the scheduler visualizer.
 *
 * Mounts a real Express app + the production registerSchedulerRoutes helper
 * — same shape webServer.js uses — so this catches the class of bug we hit
 * with the widget routes (handler reading from the wrong owner).
 *
 * Coverage:
 *   GET /api/scheduler/state — 200 happy path, 503 when scheduler missing,
 *                              503 when scheduler has no getState method,
 *                              500 on getState throw, late-attach via thunk.
 *   GET /scheduler           — 200 + html content-type + body equals supplied html.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import { createServer } from 'http';
import { registerSchedulerRoutes } from '../schedulerRoutes.js';

async function http(url, options = {}) {
  const resp = await globalThis.fetch(url, options);
  const ct = resp.headers.get('content-type') || '';
  const body = ct.includes('json') ? await resp.json() : await resp.text();
  return { status: resp.status, body, headers: resp.headers };
}

function startApp(deps) {
  const app = express();
  registerSchedulerRoutes(app, deps);
  const server = createServer(app);
  return new Promise(resolve => {
    server.listen(0, () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://localhost:${port}` });
    });
  });
}

describe('GET /api/scheduler/state — happy path', () => {
  let server, baseUrl;
  const SNAPSHOT = {
    serverTime: '2026-04-25T10:00:00.000Z',
    scheduler: { running: true, iterationDelayMs: 1000, maxConcurrent: 3, currentlyInFlight: 0, cycleCount: 7, cycleHistoryMax: 200 },
    locks: [],
    cycles: [{ n: 7, outcome: 'idle', at: '2026-04-25T10:00:00.000Z' }],
    agents: [{ id: 'a1', name: 'A', activity: { active: true, reason: 'has-pending-tasks' } }],
  };
  beforeAll(async () => {
    const fakeScheduler = { getState: jest.fn().mockResolvedValue(SNAPSHOT) };
    ({ server, baseUrl } = await startApp({
      getScheduler: () => fakeScheduler,
      logger: { error: jest.fn() },
      html: '<html>viz</html>',
    }));
  });
  afterAll(() => server?.close());

  it('returns 200 with the full snapshot shape', async () => {
    const r = await http(`${baseUrl}/api/scheduler/state`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(SNAPSHOT);
  });
});

describe('GET /api/scheduler/state — 503 paths (scheduler not attached / wrong shape)', () => {
  it('503 when getScheduler() returns null (boot ordering)', async () => {
    const { server, baseUrl } = await startApp({
      getScheduler: () => null,
      logger: { error: jest.fn() },
      html: '<x/>',
    });
    try {
      const r = await http(`${baseUrl}/api/scheduler/state`);
      expect(r.status).toBe(503);
      expect(r.body).toMatchObject({ error: expect.stringMatching(/not attached/) });
    } finally { server.close(); }
  });

  it('503 when getScheduler() returns an object missing getState (defensive)', async () => {
    const { server, baseUrl } = await startApp({
      getScheduler: () => ({ /* no getState */ }),
      logger: { error: jest.fn() },
      html: '<x/>',
    });
    try {
      const r = await http(`${baseUrl}/api/scheduler/state`);
      expect(r.status).toBe(503);
    } finally { server.close(); }
  });

  it('503 when no getScheduler dep is supplied at all', async () => {
    const { server, baseUrl } = await startApp({ logger: { error: jest.fn() }, html: '<x/>' });
    try {
      const r = await http(`${baseUrl}/api/scheduler/state`);
      expect(r.status).toBe(503);
    } finally { server.close(); }
  });
});

describe('GET /api/scheduler/state — 500 path', () => {
  it('returns 500 with the error message when getState throws', async () => {
    const errorLog = jest.fn();
    const fakeScheduler = { getState: jest.fn().mockRejectedValue(new Error('boom')) };
    const { server, baseUrl } = await startApp({
      getScheduler: () => fakeScheduler,
      logger: { error: errorLog },
      html: '<x/>',
    });
    try {
      const r = await http(`${baseUrl}/api/scheduler/state`);
      expect(r.status).toBe(500);
      expect(r.body).toMatchObject({ error: 'boom' });
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringMatching(/scheduler state/i),
        expect.objectContaining({ error: 'boom' }),
      );
    } finally { server.close(); }
  });
});

describe('thunk semantics: scheduler attached AFTER route registration', () => {
  it('first call 503s, then 200 once getScheduler() starts returning the scheduler', async () => {
    let scheduler = null;
    const { server, baseUrl } = await startApp({
      getScheduler: () => scheduler,
      logger: { error: jest.fn() },
      html: '<x/>',
    });
    try {
      const r1 = await http(`${baseUrl}/api/scheduler/state`);
      expect(r1.status).toBe(503);
      // Late-attach: this is the production-relevant scenario — webServer
      // mounts routes before orchestrator has wired the scheduler in.
      scheduler = { getState: jest.fn().mockResolvedValue({ ok: true, agents: [], cycles: [], locks: [], scheduler: {}, serverTime: 'x' }) };
      const r2 = await http(`${baseUrl}/api/scheduler/state`);
      expect(r2.status).toBe(200);
      expect(r2.body).toMatchObject({ ok: true });
    } finally { server.close(); }
  });
});

describe('GET /scheduler — HTML viewer page', () => {
  it('200 + text/html + supplied html body', async () => {
    const html = '<!doctype html><title>UNIQUE-MARKER</title>';
    const { server, baseUrl } = await startApp({
      getScheduler: () => ({ getState: async () => ({}) }),
      logger: { error: jest.fn() },
      html,
    });
    try {
      const r = await http(`${baseUrl}/scheduler`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toMatch(/html/);
      expect(r.body).toBe(html);
      expect(r.body).toContain('UNIQUE-MARKER');
    } finally { server.close(); }
  });

  it('falls back to a built-in stub html when none is supplied (defensive)', async () => {
    const { server, baseUrl } = await startApp({ getScheduler: () => null });
    try {
      const r = await http(`${baseUrl}/scheduler`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toMatch(/html/);
      expect(typeof r.body).toBe('string');
      expect(r.body.length).toBeGreaterThan(0);
    } finally { server.close(); }
  });
});

describe('registerSchedulerRoutes — defensive guards', () => {
  it('no-ops when app is null/undefined (does not throw)', () => {
    expect(() => registerSchedulerRoutes(null, {})).not.toThrow();
    expect(() => registerSchedulerRoutes(undefined, {})).not.toThrow();
  });
});
