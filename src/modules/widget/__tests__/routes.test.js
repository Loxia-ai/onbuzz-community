/**
 * HTTP routes — we don't stand up a real Express, we use a tiny recording
 * fake so we can assert shape + behavior of each handler.
 *
 * Three routes under test:
 *   GET  /api/widget/runtime.js  — serves the WIDGET_RUNTIME string
 *   GET  /api/widget/audit       — returns per-agent widget summaries
 *   POST /api/widget/event       — ingress of user events from iframes
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { registerRoutes } from '../routes.js';
import { WidgetTool } from '../widgetTool.js';
import { WIDGET_RUNTIME } from '../runtime/bundle.js';

// --- minimal recording express stand-in ----------------------------------
function fakeApp() {
  const routes = { get: new Map(), post: new Map(), delete: new Map() };
  return {
    routes,
    get:    (p, h) => routes.get.set(p, h),
    post:   (p, h) => routes.post.set(p, h),
    delete: (p, h) => routes.delete.set(p, h),
  };
}
function fakeRes() {
  const res = {
    _status: 200, _headers: {}, _body: undefined, _json: undefined, _type: undefined,
    status(c) { this._status = c; return this; },
    json(b) { this._json = b; return this; },
    send(b) { this._body = b; return this; },
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
    type(t) { this._type = t; return this; },
  };
  return res;
}

describe('GET /api/widget/runtime.js', () => {
  test('serves the JSX runtime bundle with JS content-type + cache header', () => {
    const app = fakeApp();
    registerRoutes(app, {});
    const handler = app.routes.get.get('/api/widget/runtime.js');
    expect(typeof handler).toBe('function');
    const res = fakeRes();
    handler({}, res);
    expect(res._headers['content-type']).toMatch(/javascript/);
    expect(res._headers['cache-control']).toMatch(/max-age=/);
    expect(res._body).toBe(WIDGET_RUNTIME);
  });

  test('serves the WEB-COMPONENT runtime bundle separately at /runtime-wc.js', async () => {
    const { WIDGET_WC_RUNTIME } = await import('../runtime/webComponentBundle.js');
    const app = fakeApp();
    registerRoutes(app, {});
    const handler = app.routes.get.get('/api/widget/runtime-wc.js');
    expect(typeof handler).toBe('function');
    const res = fakeRes();
    handler({}, res);
    expect(res._headers['content-type']).toMatch(/javascript/);
    expect(res._body).toBe(WIDGET_WC_RUNTIME);
  });
});

describe('GET /api/widget/audit', () => {
  let tool, app, handler;
  beforeEach(async () => {
    tool = new WidgetTool();
    app = fakeApp();
    const orchestrator = {
      toolsRegistry: { getTool: (id) => id === 'widget' ? tool : null },
    };
    registerRoutes(app, orchestrator);
    handler = app.routes.get.get('/api/widget/audit');
    await tool.execute(
      { action: 'render', kind: 'html', content: '<p>A</p>', widgetId: 'wa' },
      { agentId: 'agent-1', toolConfig: { allowCustomCode: true } }
    );
    await tool.execute(
      { action: 'render', kind: 'jsx',  content: 'return()=>({type:"div"})', widgetId: 'wb' },
      { agentId: 'agent-2', toolConfig: { allowCustomCode: true } }
    );
    await tool.execute(
      { action: 'render', kind: 'html', content: 'Please enter your password', widgetId: 'wflag' },
      { agentId: 'agent-2', toolConfig: { allowCustomCode: true } }
    );
  });

  test('no agentId → returns groups with summaries (no content leak)', async () => {
    const req = { query: {} };
    const res = fakeRes();
    await handler(req, res);
    expect(res._json.success).toBe(true);
    expect(Array.isArray(res._json.groups)).toBe(true);
    const ids = res._json.groups.map(g => g.agentId).sort();
    expect(ids).toEqual(['agent-1', 'agent-2']);

    // Summary MUST NOT include raw content (prevents audit from echoing agent code)
    for (const g of res._json.groups) {
      for (const w of g.widgets) {
        expect(w.content).toBeUndefined();
        expect(w).toEqual(expect.objectContaining({
          widgetId: expect.any(String),
          kind: expect.stringMatching(/html|jsx/),
          size: expect.any(Number),
        }));
      }
    }
  });

  test('agentId filter → returns only that agent\'s widgets', async () => {
    const res = fakeRes();
    await handler({ query: { agentId: 'agent-1' } }, res);
    expect(res._json.success).toBe(true);
    expect(res._json.widgets).toHaveLength(1);
    expect(res._json.widgets[0].widgetId).toBe('wa');
  });

  test('missing tool → returns empty list (not a 500)', async () => {
    const app2 = fakeApp();
    registerRoutes(app2, { toolsRegistry: { getTool: () => null } });
    const h = app2.routes.get.get('/api/widget/audit');
    const res = fakeRes();
    await h({ query: {} }, res);
    expect(res._json).toEqual({ success: true, widgets: [] });
  });

  test('phishing widget exposes phishingHits in summary', async () => {
    const res = fakeRes();
    await handler({ query: { agentId: 'agent-2' } }, res);
    const flagged = res._json.widgets.find(w => w.widgetId === 'wflag');
    expect(flagged).toBeTruthy();
    expect(flagged.phishingHits).toEqual(expect.arrayContaining(['password']));
  });
});

describe('POST /api/widget/event', () => {
  let app, handler, addToolResult, addUserMessage, calls, userCalls;
  beforeEach(() => {
    calls = [];
    userCalls = [];
    addToolResult = async (agentId, payload) => { calls.push({ agentId, payload }); };
    addUserMessage = async (agentId, msg) => { userCalls.push({ agentId, msg }); };
    app = fakeApp();
    registerRoutes(app, { agentPool: { addToolResult, addUserMessage } });
    handler = app.routes.post.get('/api/widget/event');
  });

  test('400 when agentId missing', async () => {
    const res = fakeRes();
    await handler({ body: { widgetId: 'w1', payload: {} } }, res);
    expect(res._status).toBe(400);
    expect(res._json.success).toBe(false);
  });
  test('400 when widgetId missing', async () => {
    const res = fakeRes();
    await handler({ body: { agentId: 'a', payload: {} } }, res);
    expect(res._status).toBe(400);
  });
  test('503 when agentPool unavailable', async () => {
    const app2 = fakeApp();
    registerRoutes(app2, {}); // no agentPool
    const h = app2.routes.post.get('/api/widget/event');
    const res = fakeRes();
    await h({ body: { agentId: 'a', widgetId: 'w', payload: {} } }, res);
    expect(res._status).toBe(503);
  });
  test('user event → tool-result with status:completed and action:widget-event', async () => {
    const res = fakeRes();
    await handler({ body: { agentId: 'a1', widgetId: 'w9', payload: { type: 'click' } } }, res);
    expect(res._json.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].agentId).toBe('a1');
    expect(calls[0].payload).toEqual(expect.objectContaining({
      toolId: 'widget',
      status: 'completed',
      result: expect.objectContaining({
        success: true,
        action: 'widget-event',
        widgetId: 'w9',
        event: { type: 'click' },
      }),
      timestamp: expect.any(String),
    }));
  });

  test('__widgetError payload → tool-result with status:failed and a HUMAN-READABLE top-level error', async () => {
    const res = fakeRes();
    await handler({
      body: {
        agentId: 'a1', widgetId: 'w9',
        payload: {
          __widgetError: true,
          phase: 'render',
          message: 'h is not defined',
          stack: 'at userFn (widget:1:17)',
        },
      },
    }, res);
    expect(res._json.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toEqual(expect.objectContaining({
      toolId: 'widget',
      status: 'failed',
      result: expect.objectContaining({
        success: false,
        widgetId: 'w9',
        phase: 'render',
        message: 'h is not defined',
      }),
    }));
    // The agent sees this as plain text — the top-level 'error' string
    // MUST name the problem + tell it what to do next, otherwise the
    // agent treats it as noise and retries with the same broken code.
    const errText = calls[0].payload.result.error;
    expect(errText).toMatch(/WIDGET RENDER ERROR/);
    expect(errText).toMatch(/h is not defined/);
    expect(errText).toMatch(/fix the specific error/i);
    // Points the agent at list-capabilities so it can self-heal
    expect(errText).toMatch(/list-capabilities/);
    expect(calls[0].payload.result.hint).toMatch(/list-capabilities/);
  });

  test('payload null is permitted and forwarded as null event', async () => {
    const res = fakeRes();
    await handler({ body: { agentId: 'a1', widgetId: 'w9' } }, res);
    expect(res._json.success).toBe(true);
    expect(calls[0].payload.result.event).toBeNull();
  });

  // REGRESSION: shouldAgentBeActive treats tool-results-only queues as
  // "no work," so an async widget error arriving after jobdone used to
  // land in the queue and never wake the agent. Fix: error events also
  // push a synthetic user-message so AGENT mode auto-creates a task and
  // CHAT mode picks it up on the next cycle.
  test('error event ALSO pushes a synthetic user-message so the agent actually wakes up', async () => {
    const res = fakeRes();
    await handler({
      body: { agentId: 'a1', widgetId: 'w9',
        payload: { __widgetError: true, phase: 'render', message: 'htmPreact is not defined' } },
    }, res);
    expect(res._json.success).toBe(true);
    // Tool result still gets queued (unchanged behaviour)
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.status).toBe('failed');
    // AND the new reactivation user-message
    expect(userCalls).toHaveLength(1);
    expect(userCalls[0].agentId).toBe('a1');
    expect(userCalls[0].msg).toEqual(expect.objectContaining({
      role: 'user',
      type: 'widget-error-feedback',
      isToolResultInjection: true,
    }));
    // Content names the widget + the actual error so the agent can act
    expect(userCalls[0].msg.content).toMatch(/w9/);
    expect(userCalls[0].msg.content).toMatch(/htmPreact is not defined/);
    expect(userCalls[0].msg.content).toMatch(/fix/i);
  });

  test('user events do NOT push a synthetic user-message (only errors do)', async () => {
    const res = fakeRes();
    await handler({
      body: { agentId: 'a1', widgetId: 'w9', payload: { type: 'click' } },
    }, res);
    expect(res._json.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(userCalls).toHaveLength(0); // no reactivation for normal events
  });

  test('addUserMessage failure does not break the POST (tool-result still queued)', async () => {
    const app2 = fakeApp();
    registerRoutes(app2, {
      agentPool: {
        addToolResult: async (a, p) => { calls.push({ a, p }); },
        addUserMessage: async () => { throw new Error('boom'); },
      },
    });
    const h = app2.routes.post.get('/api/widget/event');
    const res = fakeRes();
    await h({
      body: { agentId: 'a', widgetId: 'w',
        payload: { __widgetError: true, message: 'x' } },
    }, res);
    expect(res._json.success).toBe(true); // still 200 — tool-result already queued
  });
  test('addToolResult throwing → 500 with error message', async () => {
    const app2 = fakeApp();
    registerRoutes(app2, { agentPool: { addToolResult: async () => { throw new Error('boom'); } } });
    const h = app2.routes.post.get('/api/widget/event');
    const res = fakeRes();
    await h({ body: { agentId: 'a', widgetId: 'w', payload: {} } }, res);
    expect(res._status).toBe(500);
    expect(res._json.error).toBe('boom');
  });
});

describe('POST /api/widget/event — error-event throttling', () => {
  let app, handler, calls;
  beforeEach(() => {
    calls = [];
    app = fakeApp();
    registerRoutes(app, { agentPool: { addToolResult: async (a, p) => { calls.push({ a, p }); } } });
    handler = app.routes.post.get('/api/widget/event');
  });

  test('non-error events are never throttled (ordinary widget traffic)', async () => {
    for (let i = 0; i < 20; i++) {
      const res = fakeRes();
      await handler({ body: { agentId: 'a', widgetId: 'w', payload: { type: 'click', i } } }, res);
      expect(res._json.success).toBe(true);
      expect(res._json.throttled).toBeUndefined();
    }
    expect(calls).toHaveLength(20);
  });

  test('identical __widgetError within window → first through, rest dropped', async () => {
    const err = { __widgetError: true, phase: 'render', message: 'h is not defined' };
    // First delivery → forwarded
    let res = fakeRes();
    await handler({ body: { agentId: 'a', widgetId: 'w', payload: err } }, res);
    expect(res._json).toEqual({ success: true });
    expect(calls).toHaveLength(1);
    // 9 more identical → all dropped as throttled, addToolResult never called again
    for (let i = 0; i < 9; i++) {
      res = fakeRes();
      await handler({ body: { agentId: 'a', widgetId: 'w', payload: err } }, res);
      expect(res._json).toEqual({ success: true, throttled: true });
    }
    expect(calls).toHaveLength(1);
  });

  test('different error messages each get through (until the hard cap)', async () => {
    for (let i = 0; i < 5; i++) {
      const res = fakeRes();
      await handler({
        body: { agentId: 'a', widgetId: 'w',
          payload: { __widgetError: true, phase: 'render', message: `unique-${i}` } },
      }, res);
      expect(res._json).toEqual({ success: true });
    }
    expect(calls).toHaveLength(5);
    // The 6th unique error hits the cap and is throttled
    const res = fakeRes();
    await handler({
      body: { agentId: 'a', widgetId: 'w',
        payload: { __widgetError: true, phase: 'render', message: 'unique-6' } },
    }, res);
    expect(res._json).toEqual({ success: true, throttled: true });
    expect(calls).toHaveLength(5);
  });

  test('throttle is scoped per (agentId, widgetId)', async () => {
    const err = { __widgetError: true, phase: 'render', message: 'h is not defined' };
    // Same error, two different widgets on the same agent → both through
    let res = fakeRes();
    await handler({ body: { agentId: 'a', widgetId: 'w1', payload: err } }, res);
    expect(res._json).toEqual({ success: true });
    res = fakeRes();
    await handler({ body: { agentId: 'a', widgetId: 'w2', payload: err } }, res);
    expect(res._json).toEqual({ success: true });
    // Same error, two different agents → both through
    res = fakeRes();
    await handler({ body: { agentId: 'a2', widgetId: 'w1', payload: err } }, res);
    expect(res._json).toEqual({ success: true });
    expect(calls).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /api/widget/full and /api/widget/set-main — user-driven endpoints used
// by the artifacts panel (no agent in the loop).
// ─────────────────────────────────────────────────────────────────────────

describe('GET /api/widget/full', () => {
  let tool, app, handler;
  beforeEach(async () => {
    tool = new WidgetTool();
    app = fakeApp();
    registerRoutes(app, { toolsRegistry: { getTool: id => id === 'widget' ? tool : null } });
    handler = app.routes.get.get('/api/widget/full');
    await tool.execute(
      { action: 'render', kind: 'html', content: '<p>v1</p>', widgetId: 'w1' },
      { agentId: 'a', toolConfig: { allowCustomCode: true } }
    );
    await tool.execute(
      { action: 'render', kind: 'html', content: '<p>v2</p>', widgetId: 'w1' },
      { agentId: 'a', toolConfig: { allowCustomCode: true } }
    );
  });

  test('returns the FULL widget incl. all versions', async () => {
    const res = fakeRes();
    await handler({ query: { agentId: 'a', widgetId: 'w1' } }, res);
    expect(res._json.success).toBe(true);
    expect(res._json.widget.versions).toHaveLength(2);
    expect(res._json.widget.versions[0].content).toBe('<p>v1</p>');
    expect(res._json.widget.versions[1].content).toBe('<p>v2</p>');
  });

  test('400 when query params missing', async () => {
    const res = fakeRes();
    await handler({ query: {} }, res);
    expect(res._status).toBe(400);
  });

  test('404 when widget not found', async () => {
    const res = fakeRes();
    await handler({ query: { agentId: 'a', widgetId: 'unknown' } }, res);
    expect(res._status).toBe(404);
  });
});

describe('POST /api/widget/set-main', () => {
  let tool, app, handler, v1Id;
  beforeEach(async () => {
    tool = new WidgetTool();
    app = fakeApp();
    registerRoutes(app, { toolsRegistry: { getTool: id => id === 'widget' ? tool : null } });
    handler = app.routes.post.get('/api/widget/set-main');
    const r1 = await tool.execute(
      { action: 'render', kind: 'html', content: '<p>v1</p>', widgetId: 'w1' },
      { agentId: 'a', toolConfig: { allowCustomCode: true } }
    );
    v1Id = r1.versionId;
    await tool.execute(
      { action: 'render', kind: 'html', content: '<p>v2</p>', widgetId: 'w1' },
      { agentId: 'a', toolConfig: { allowCustomCode: true } }
    );
  });

  test('successfully promotes a version', async () => {
    const res = fakeRes();
    await handler({ body: { agentId: 'a', widgetId: 'w1', versionId: v1Id } }, res);
    expect(res._json.success).toBe(true);
    expect(res._json.widget.mainVersionId).toBe(v1Id);
    expect(res._json.widget.content).toBe('<p>v1</p>'); // mirrored
  });

  test('400 when body fields missing', async () => {
    const res = fakeRes();
    await handler({ body: { agentId: 'a' } }, res);
    expect(res._status).toBe(400);
  });

  test('400 when version unknown — propagates the named error from the tool', async () => {
    const res = fakeRes();
    await handler({ body: { agentId: 'a', widgetId: 'w1', versionId: 'fake' } }, res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/Version not found/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Gallery user-facing routes — the artifacts panel + GalleryPage call
// these without an agent. Routed through the same tool methods so
// semantics match exactly.
// ─────────────────────────────────────────────────────────────────────────

describe('gallery routes', () => {
  let tool, app, gallery, filePath;

  beforeEach(async () => {
    const { GalleryStore } = await import('../galleryStore.js');
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    filePath = path.join(os.tmpdir(), `loxia-gallery-routes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    gallery = new GalleryStore({ filePath, persistDebounceMs: 0 });
    tool = new WidgetTool();
    tool.setGalleryStore(gallery);
    app = fakeApp();
    registerRoutes(app, { toolsRegistry: { getTool: id => id === 'widget' ? tool : null } });
    // Pre-render a widget so we have something to share.
    await tool.execute(
      { action: 'render', kind: 'webcomponent', content: 'class C extends LoxiaElement {}', widgetId: 'calc' },
      { agentId: 'a', toolConfig: { allowCustomCode: true } }
    );
  });

  test('POST /api/widget/share publishes the widget; GET /api/widget/gallery lists it', async () => {
    const post = app.routes.post.get('/api/widget/share');
    const shareRes = fakeRes();
    await post({ body: { agentId: 'a', widgetId: 'calc', title: 'My calc', tags: ['demo'] } }, shareRes);
    expect(shareRes._json.success).toBe(true);
    expect(shareRes._json.templateId).toMatch(/my-calc-v1-/);

    const get = app.routes.get.get('/api/widget/gallery');
    const listRes = fakeRes();
    await get({ query: {} }, listRes);
    expect(listRes._json.success).toBe(true);
    expect(listRes._json.count).toBe(1);
    expect(listRes._json.templates[0].title).toBe('My calc');
  });

  test('POST /api/widget/share — 400 on missing fields', async () => {
    const post = app.routes.post.get('/api/widget/share');
    const res = fakeRes();
    await post({ body: { agentId: 'a' } }, res);
    expect(res._status).toBe(400);
  });

  test('GET /api/widget/gallery filters by tag', async () => {
    const post = app.routes.post.get('/api/widget/share');
    await post({ body: { agentId: 'a', widgetId: 'calc', title: 'a', tags: ['fin'] } }, fakeRes());
    // Pre-render a second widget then share with different tag
    await tool.execute(
      { action: 'render', kind: 'html', content: '<p>x</p>', widgetId: 'card' },
      { agentId: 'a', toolConfig: { allowCustomCode: true } }
    );
    await post({ body: { agentId: 'a', widgetId: 'card', title: 'b', tags: ['demo'] } }, fakeRes());
    const get = app.routes.get.get('/api/widget/gallery');
    const r = fakeRes();
    await get({ query: { tag: 'fin' } }, r);
    expect(r._json.templates.map(t => t.title)).toEqual(['a']);
  });

  test('DELETE /api/widget/gallery/:templateId removes the template', async () => {
    const post = app.routes.post.get('/api/widget/share');
    const sh = fakeRes();
    await post({ body: { agentId: 'a', widgetId: 'calc', title: 'gone' } }, sh);
    const templateId = sh._json.templateId;

    const del = app.routes.delete.get('/api/widget/gallery/:templateId');
    expect(typeof del).toBe('function');
    const res = fakeRes();
    await del({ params: { templateId }, query: { agentId: 'a' } }, res);
    expect(res._json.success).toBe(true);
    expect(res._json.removed).toBe(true);
    // Gallery is now empty
    const list = await tool.execute(
      { action: 'list-gallery' },
      { agentId: 'system', toolConfig: { allowCustomCode: true } }
    );
    expect(list.count).toBe(0);
  });

  test('DELETE /api/widget/gallery/:templateId — 404 on unknown id', async () => {
    const del = app.routes.delete.get('/api/widget/gallery/:templateId');
    const res = fakeRes();
    await del({ params: { templateId: 'fake' }, query: {} }, res);
    expect(res._status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRODUCTION WIRING — the bug-caught-late test.
//
// In the real WebServer, `this.orchestrator` does NOT carry toolsRegistry
// — it lives on `this.toolsRegistry`. Earlier tests passed an
// orchestrator-shaped object with toolsRegistry directly attached, which
// is what test convenience uses but DIVERGES from production reality.
//
// When the production wiring shipped, all our user-facing routes
// (full / set-main / gallery / share / unshare / check-upgrade /
// apply-upgrade) returned 503 because `orchestrator?.toolsRegistry`
// resolved to undefined.
//
// These tests simulate the production shape: orchestrator with NO
// toolsRegistry on it, and toolsRegistry passed via `extras`. They
// would have failed under the old route signature.
// ─────────────────────────────────────────────────────────────────────────
describe('PRODUCTION WIRING — toolsRegistry passed via extras (matches WebServer reality)', () => {
  let tool, app;
  beforeEach(async () => {
    tool = new WidgetTool();
    // Inject an isolated tmp-file GalleryStore so the test doesn't read
    // the developer's actual ~/.loxia/widget-gallery.json — which used
    // to make GET /api/widget/gallery occasionally see N>0 templates and
    // flake the count assertion.
    const { GalleryStore } = await import('../galleryStore.js');
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'widget-routes-prod-'));
    tool.setGalleryStore(new GalleryStore({
      filePath: path.join(tmpDir, 'gallery.json'),
      persistDebounceMs: 0,
    }));

    app = fakeApp();
    // KEY DETAIL: orchestrator does NOT have toolsRegistry. The route
    // module must look it up via the third-arg `extras.toolsRegistry`.
    const orchestratorWithoutToolsRegistry = { agentPool: { addToolResult: async () => {} } };
    registerRoutes(
      app,
      orchestratorWithoutToolsRegistry,
      { toolsRegistry: { getTool: id => id === 'widget' ? tool : null } }
    );
    // Pre-render a widget for /full to find.
    await tool.execute(
      { action: 'render', kind: 'webcomponent', content: 'class C extends LoxiaElement {}', widgetId: 'w1' },
      { agentId: 'a', toolConfig: { allowCustomCode: true } }
    );
  });

  test('GET /api/widget/full resolves the tool via extras.toolsRegistry (no 503)', async () => {
    const handler = app.routes.get.get('/api/widget/full');
    const res = fakeRes();
    await handler({ query: { agentId: 'a', widgetId: 'w1' } }, res);
    expect(res._json.success).toBe(true);
    expect(res._json.widget.widgetId).toBe('w1');
  });

  test('GET /api/widget/audit ALSO resolves via extras.toolsRegistry (no silent empty)', async () => {
    const handler = app.routes.get.get('/api/widget/audit');
    const res = fakeRes();
    await handler({ query: { agentId: 'a' } }, res);
    expect(res._json.success).toBe(true);
    expect(res._json.widgets).toHaveLength(1);
    expect(res._json.widgets[0].widgetId).toBe('w1');
  });

  test('GET /api/widget/gallery resolves via extras.toolsRegistry', async () => {
    const handler = app.routes.get.get('/api/widget/gallery');
    const res = fakeRes();
    await handler({ query: {} }, res);
    expect(res._json.success).toBe(true);
    expect(res._json.count).toBe(0);
  });

  test('POST /api/widget/set-main resolves via extras.toolsRegistry', async () => {
    const versionId = (await tool.execute(
      { action: 'render', kind: 'webcomponent', content: 'edit', widgetId: 'w1' },
      { agentId: 'a', toolConfig: { allowCustomCode: true } }
    )).widget.versions[0].versionId;
    const handler = app.routes.post.get('/api/widget/set-main');
    const res = fakeRes();
    await handler({ body: { agentId: 'a', widgetId: 'w1', versionId } }, res);
    expect(res._json.success).toBe(true);
  });

  test('GET /api/widget/check-upgrade resolves via extras.toolsRegistry', async () => {
    const handler = app.routes.get.get('/api/widget/check-upgrade');
    const res = fakeRes();
    await handler({ query: { agentId: 'a', widgetId: 'w1' } }, res);
    expect(res._json.success).toBe(true);
    // Not linked → hasUpgrade:false with reason
    expect(res._json.hasUpgrade).toBe(false);
    expect(res._json.reason).toBe('not-linked');
  });

  test('LEGACY shape (toolsRegistry on orchestrator) ALSO works — backward compat', async () => {
    // This is what every other test in this file uses; verify the
    // dual-lookup didn't accidentally regress it.
    const tool2 = new WidgetTool();
    const app2 = fakeApp();
    registerRoutes(app2, { toolsRegistry: { getTool: () => tool2 } });
    await tool2.execute(
      { action: 'render', kind: 'html', content: '<p/>', widgetId: 'legacy' },
      { agentId: 'a', toolConfig: { allowCustomCode: true } }
    );
    const handler = app2.routes.get.get('/api/widget/full');
    const res = fakeRes();
    await handler({ query: { agentId: 'a', widgetId: 'legacy' } }, res);
    expect(res._json.success).toBe(true);
    expect(res._json.widget.widgetId).toBe('legacy');
  });

  test('NEITHER resolver finds the tool → 503 (the actual original bug surface)', async () => {
    const app3 = fakeApp();
    // Both refs missing toolsRegistry — production-style misconfig.
    registerRoutes(app3, { /* no toolsRegistry */ }, { /* no toolsRegistry */ });
    const handler = app3.routes.get.get('/api/widget/full');
    const res = fakeRes();
    await handler({ query: { agentId: 'a', widgetId: 'w1' } }, res);
    expect(res._status).toBe(503);
    expect(res._json.error).toMatch(/widget tool unavailable/);
  });
});

describe('registerRoutes defensive behavior', () => {
  test('noop when app is null', () => {
    expect(() => registerRoutes(null, {})).not.toThrow();
  });

  test('accepts extras=undefined (the legacy 2-arg signature still works)', () => {
    expect(() => registerRoutes(fakeApp(), { toolsRegistry: { getTool: () => null } })).not.toThrow();
  });
});
