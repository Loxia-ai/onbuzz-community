/**
 * HTTP routes owned by the widget module.
 *
 * Surface:
 *   GET /api/widget/runtime.js  — serves the iframe runtime bundle as JS
 *   GET /api/widget/audit?agentId=… — (optional) audit listing for the UI
 *
 * Registered by the core webServer via `widgetModule.registerRoutes(app, orchestrator)`
 * so removing the widget feature is "delete the registration line +
 * delete the module directory".
 */

import { WIDGET_RUNTIME } from './runtime/bundle.js';
import { WIDGET_WC_RUNTIME } from './runtime/webComponentBundle.js';

/**
 * Register the widget module's HTTP routes.
 *
 * @param {object} app          — Express app
 * @param {object} orchestrator — agent orchestrator (carries agentPool)
 * @param {object} [extras]     — optional explicit refs:
 *   - toolsRegistry: ToolsRegistry instance (production passes this here
 *     because it lives on the WebServer instance, NOT on the orchestrator)
 *
 * Resolution order for the widget tool, most-specific first:
 *   1. extras.toolsRegistry?.getTool('widget')   ← production
 *   2. orchestrator?.toolsRegistry?.getTool('widget') ← test convenience
 *
 * If neither resolves, routes return 503/empty as appropriate. The
 * dual lookup keeps both production wiring and tests working without a
 * forced refactor.
 */
export function registerRoutes(app, orchestrator, extras = {}) {
  if (!app) return;

  // Tool resolver — single source of truth used by every route below.
  // Re-evaluated on every request because the registry can be populated
  // AFTER routes are registered (boot order is not guaranteed).
  const getWidgetTool = () =>
    extras?.toolsRegistry?.getTool?.('widget') ||
    orchestrator?.toolsRegistry?.getTool?.('widget') ||
    null;

  // Runtime bundle. Inlined into every jsx iframe's srcdoc by the
  // parent-side <IframeWidget>. Served as-is; the parent fetches once
  // and caches, so this endpoint is hit on page load at most.
  //
  // CORS: the fetcher is the PARENT app (same origin), not the iframe
  // (which has null origin and cannot reach this URL anyway). So no
  // special CORS headers are required.
  app.get('/api/widget/runtime.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min — keeps dev iteration fast
    res.send(WIDGET_RUNTIME);
  });

  // Web-component runtime — much smaller than the JSX bundle (no htm
  // parser, no VDOM, no hooks). Served separately so HTML / JSX widgets
  // don't pay the (small) cost of fetching it. The frontend's
  // IframeWidget fetches whichever runtime the kind requires.
  app.get('/api/widget/runtime-wc.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(WIDGET_WC_RUNTIME);
  });

  // Audit: list widgets for a given agent. Drives the WidgetAuditPage.
  // Reads directly from the widget tool instance (source of truth) —
  // no DB, no extra persistence.
  app.get('/api/widget/audit', async (req, res) => {
    try {
      const agentId = req.query.agentId;
      const tool = getWidgetTool();
      if (!tool) {
        return res.json({ success: true, widgets: [] });
      }
      if (!agentId) {
        // No filter: return per-agent grouped list.
        const groups = [];
        for (const [aId, widgets] of tool._widgetsByAgent.entries()) {
          groups.push({
            agentId: aId,
            count: widgets.size,
            widgets: Array.from(widgets.values()).map(_summarize),
          });
        }
        return res.json({ success: true, groups });
      }
      const agentWidgets = tool._widgetsByAgent.get(agentId);
      const widgets = agentWidgets ? Array.from(agentWidgets.values()).map(_summarize) : [];
      res.json({ success: true, widgets });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Widget event ingress — the UI posts user interactions (click, submit,
  // input change) emitted from a sandboxed iframe. We deliver them as a
  // tool result so the agent wakes up and can react.
  //
  // Body: { agentId, widgetId, payload }
  //   - agentId required
  //   - widgetId required
  //   - payload: arbitrary JSON emitted by the widget's runtime sendEvent()
  //
  // The event is serialized into the agent's toolResults queue under the
  // widget tool id; the agent scheduler's normal wake-on-message path
  // picks it up. Nothing widget-specific in the scheduler.
  //
  // Error-event throttle: widgets with a bug in a setInterval / event
  // handler could fire the same __widgetError every frame. The iframe
  // runtime already dedupes, but we re-check here as defense in depth —
  // at most ERROR_WINDOW_MS between identical errors per (agent, widget),
  // and at most ERROR_MAX distinct errors per (agent, widget) lifetime.
  // Non-error events are untouched.
  const ERROR_WINDOW_MS = 60 * 1000;  // same error, once per minute max
  const ERROR_MAX = 5;                 // distinct errors per widget
  const _errorLedger = new Map();      // key = agentId::widgetId
  function _errorKey(a, w) { return `${a}::${w}`; }
  function _shouldDropError(agentId, widgetId, payload) {
    if (!payload || payload.__widgetError !== true) return false;
    const key = _errorKey(agentId, widgetId);
    let rec = _errorLedger.get(key);
    if (!rec) { rec = { seen: new Map(), uniqueCount: 0 }; _errorLedger.set(key, rec); }
    const sig = `${payload.phase || ''}|${String(payload.message || '').slice(0, 500)}`;
    const now = Date.now();
    const last = rec.seen.get(sig);
    if (last && (now - last) < ERROR_WINDOW_MS) return true;  // dupe in window
    if (!last && rec.uniqueCount >= ERROR_MAX) return true;   // hard cap
    if (!last) rec.uniqueCount++;
    rec.seen.set(sig, now);
    return false;
  }

  app.post('/api/widget/event', async (req, res) => {
    try {
      const { agentId, widgetId, payload } = req.body || {};
      if (!agentId || typeof agentId !== 'string') {
        return res.status(400).json({ success: false, error: 'agentId required' });
      }
      if (!widgetId || typeof widgetId !== 'string') {
        return res.status(400).json({ success: false, error: 'widgetId required' });
      }
      if (_shouldDropError(agentId, widgetId, payload)) {
        // Acknowledge but do NOT forward to the agent — keeps context clean.
        return res.json({ success: true, throttled: true });
      }
      const agentPool = orchestrator?.agentPool;
      if (!agentPool?.addToolResult) {
        return res.status(503).json({ success: false, error: 'agent pool unavailable' });
      }

      // Shape the tool result to match the convention every other tool
      // pushes (toolId/status/result/timestamp). Distinguish "user event"
      // from "render error" so the agent sees the right status + a clear
      // top-level message rather than a generic payload blob.
      const isError = payload && payload.__widgetError === true;
      const toolResult = isError
        ? {
            toolId: 'widget',
            status: 'failed',
            result: {
              success: false,
              action: 'render',
              widgetId,
              error:
                `WIDGET RENDER ERROR — widget "${widgetId}" failed during "${payload.phase || 'render'}": ${payload.message || 'unknown error'}. ` +
                'Your widget code did not execute. ' +
                'Fix the specific error and call widget.render again. ' +
                'If unsure what is available in the runtime, call { "toolId": "widget", "action": "list-capabilities" } ' +
                'to get a machine-readable list of supported hooks, primitives, namespaces, and named "not implemented" APIs with rewrite paths. ' +
                `Stack: ${payload.stack || '(no stack)'}`,
              phase: payload.phase || 'render',
              message: payload.message || 'unknown error',
              stack: payload.stack || null,
              hint: 'Call widget.list-capabilities for a programmatic capability report.',
            },
            timestamp: new Date().toISOString(),
          }
        : {
            toolId: 'widget',
            status: 'completed',
            result: {
              success: true,
              action: 'widget-event',
              widgetId,
              event: payload ?? null,
            },
            timestamp: new Date().toISOString(),
          };

      await agentPool.addToolResult(agentId, toolResult);

      // REACTIVATION for error events.
      //
      // shouldAgentBeActive(agent) returns false when the queue has only
      // tool results and no user/inter-agent messages (AGENT mode: needs
      // pending tasks; CHAT mode: explicitly ignores tool-results-only).
      // That makes sense for normal "tool replies" — they are consumed
      // during the cycle that triggered them. But widget render errors
      // arrive ASYNC after the tool call already returned success:true,
      // so the agent has typically already called jobdone and is now idle.
      // The error lands in the queue and nothing wakes the agent.
      //
      // Fix: for error events, also push a synthetic user-message. That
      // triggers auto-task-creation (AGENT mode) or message-pickup (CHAT
      // mode), wakes the agent, and the error becomes actionable feedback
      // instead of a silent log entry.
      //
      // The synthetic message is clearly tagged with a system marker so
      // the UI can filter it out of the chat feed (see
      // isInternalToolResultMessage in appStore.js).
      if (isError && agentPool.addUserMessage) {
        try {
          await agentPool.addUserMessage(agentId, {
            id: `widget-error-feedback-${Date.now()}`,
            role: 'user',
            content: `[Widget render error — action required]\n` +
              `Your widget "${widgetId}" failed to render in the user's browser. ` +
              `The backend stored the widget but the iframe couldn't execute it.\n\n` +
              `Error (${payload.phase || 'render'}): ${payload.message || 'unknown error'}\n\n` +
              `Fix the underlying problem and call widget.render again with a corrected version. Do NOT just retry the same code.\n` +
              `If the error mentions an undefined identifier or a "not implemented" API, call ` +
              `{ "toolId": "widget", "action": "list-capabilities" } first to see exactly what IS available.`,
            timestamp: new Date().toISOString(),
            type: 'widget-error-feedback',
            isToolResultInjection: true,
          });
        } catch (err) {
          // addUserMessage failing shouldn't drop the POST — the tool result
          // is already in the queue. Log and continue.
          // eslint-disable-next-line no-console
          console.warn('[widget] failed to push synthetic user message for reactivation', err.message);
        }
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Full widget record (incl. version history) for the artifacts panel.
  // Used when the user opens a widget in the side sheet — the audit
  // endpoint omits content to keep its payload small, this one is the
  // "give me everything to render the widget" call.
  app.get('/api/widget/full', (req, res) => {
    try {
      const { agentId, widgetId } = req.query;
      if (!agentId || !widgetId) {
        return res.status(400).json({ success: false, error: 'agentId and widgetId are required' });
      }
      const tool = getWidgetTool();
      if (!tool) return res.status(503).json({ success: false, error: 'widget tool unavailable' });
      const widget = tool._widgetsByAgent?.get(agentId)?.get(widgetId);
      if (!widget) return res.status(404).json({ success: false, error: `Widget not found: ${widgetId}` });
      res.json({ success: true, widget });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ── Gallery user-facing endpoints ─────────────────────────────────
  // The agent uses widget.* tool actions; the user (artifacts panel,
  // gallery page) uses these REST routes. Both go through the same
  // tool methods so semantics match exactly.

  // GET /api/widget/gallery — list all gallery templates.
  app.get('/api/widget/gallery', async (req, res) => {
    try {
      const tool = getWidgetTool();
      if (!tool) return res.status(503).json({ success: false, error: 'widget tool unavailable' });
      const result = await tool.execute(
        { action: 'list-gallery', tag: req.query.tag, agentId: req.query.agentId },
        { agentId: 'system', toolConfig: { allowCustomCode: true } }
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/widget/gallery/:templateId — single-template fetch INCLUDING
  // content. The /api/widget/gallery list intentionally strips content for
  // payload size; the gallery page uses this endpoint to lazy-load full
  // content on demand (e.g. when the user grants trust and we need to
  // render the iframe preview).
  app.get('/api/widget/gallery/:templateId', async (req, res) => {
    try {
      const { templateId } = req.params;
      const tool = getWidgetTool();
      if (!tool) return res.status(503).json({ success: false, error: 'widget tool unavailable' });
      const gallery = tool._galleryStore?.();
      if (!gallery?.get) return res.status(500).json({ success: false, error: 'gallery store unavailable' });
      const entry = await gallery.get(templateId);
      if (!entry) return res.status(404).json({ success: false, error: `Template not found: ${templateId}` });
      res.json({ success: true, template: entry });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/widget/share — user-driven share (artifacts-panel "Share" button).
  app.post('/api/widget/share', async (req, res) => {
    try {
      const { agentId, widgetId, title, tags } = req.body || {};
      if (!agentId || !widgetId) {
        return res.status(400).json({ success: false, error: 'agentId and widgetId are required' });
      }
      const tool = getWidgetTool();
      if (!tool) return res.status(503).json({ success: false, error: 'widget tool unavailable' });
      const result = await tool.execute(
        { action: 'share-to-gallery', widgetId, title, tags },
        { agentId, toolConfig: { allowCustomCode: true } }
      );
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // DELETE /api/widget/gallery/:templateId — user-driven unshare.
  app.delete('/api/widget/gallery/:templateId', async (req, res) => {
    try {
      const { templateId } = req.params;
      const agentId = req.query.agentId || 'system';
      const tool = getWidgetTool();
      if (!tool) return res.status(503).json({ success: false, error: 'widget tool unavailable' });
      const result = await tool.execute(
        { action: 'unshare-from-gallery', templateId },
        { agentId, toolConfig: { allowCustomCode: true } }
      );
      res.status(result.success ? 200 : 404).json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/widget/check-upgrade?agentId=X&widgetId=Y — does a newer
  // gallery template version exist for this widget? Drives the upgrade
  // badge on the artifacts panel cards.
  app.get('/api/widget/check-upgrade', async (req, res) => {
    try {
      const { agentId, widgetId } = req.query;
      if (!agentId || !widgetId) {
        return res.status(400).json({ success: false, error: 'agentId and widgetId are required' });
      }
      const tool = getWidgetTool();
      if (!tool) return res.status(503).json({ success: false, error: 'widget tool unavailable' });
      const result = await tool.execute(
        { action: 'check-upgrade', widgetId },
        { agentId, toolConfig: { allowCustomCode: true } }
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/widget/apply-upgrade — pull the latest gallery version
  // into the linked widget. User-facing; the agent uses widget.apply-upgrade.
  app.post('/api/widget/apply-upgrade', async (req, res) => {
    try {
      const { agentId, widgetId } = req.body || {};
      if (!agentId || !widgetId) {
        return res.status(400).json({ success: false, error: 'agentId and widgetId are required' });
      }
      const tool = getWidgetTool();
      if (!tool) return res.status(503).json({ success: false, error: 'widget tool unavailable' });
      const result = await tool.execute(
        { action: 'apply-upgrade', widgetId },
        { agentId, toolConfig: { allowCustomCode: true } }
      );
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/widget/set-main — promote a version to be the active one.
  // The user-driven equivalent of the agent's `widget.set-main` tool
  // action. Routes through the same code path so semantics match.
  app.post('/api/widget/set-main', async (req, res) => {
    try {
      const { agentId, widgetId, versionId } = req.body || {};
      if (!agentId || !widgetId || !versionId) {
        return res.status(400).json({ success: false, error: 'agentId, widgetId, versionId are all required' });
      }
      const tool = getWidgetTool();
      if (!tool) return res.status(503).json({ success: false, error: 'widget tool unavailable' });
      const result = await tool.execute(
        { action: 'set-main', widgetId, versionId },
        { agentId, toolConfig: { allowCustomCode: true } }
      );
      const status = result.success ? 200 : 400;
      res.status(status).json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/widget/rename — user-driven rename via the artifacts panel.
  // Body: { agentId, widgetId, name } where name=null|'' clears the name.
  app.post('/api/widget/rename', async (req, res) => {
    try {
      const { agentId, widgetId, name } = req.body || {};
      if (!agentId || !widgetId) {
        return res.status(400).json({ success: false, error: 'agentId and widgetId are required' });
      }
      const tool = getWidgetTool();
      if (!tool) return res.status(503).json({ success: false, error: 'widget tool unavailable' });
      const result = await tool.execute(
        { action: 'rename', widgetId, name: name == null ? null : name },
        { agentId, toolConfig: { allowCustomCode: true } }
      );
      const status = result.success ? 200 : (result.error === 'widget tool unavailable' ? 503 : 400);
      res.status(status).json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

function _summarize(w) {
  return {
    widgetId: w.widgetId,
    kind: w.kind,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    size: w.size,
    phishingHits: w.phishingHits,
  };
}

export default { registerRoutes };
