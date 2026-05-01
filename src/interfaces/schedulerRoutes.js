/**
 * Scheduler visualizer routes — extracted from webServer.js so they're
 * testable against the real production wiring (the lesson from the widget
 * routes 503 incident: tests that don't match production shape don't catch
 * production bugs).
 *
 * Two routes:
 *   GET /api/scheduler/state   — JSON snapshot from scheduler.getState()
 *   GET /scheduler             — self-contained HTML viewer page
 *
 * Registration:
 *   registerSchedulerRoutes(app, {
 *     getScheduler: () => orchestrator?.agentPool?.scheduler,
 *     logger,
 *     html: SCHEDULER_VIEWER_HTML,
 *   });
 *
 * `getScheduler` is a thunk (not the scheduler itself) so the routes resolve
 * the scheduler at request-time — handles the case where the scheduler is
 * attached after the routes are registered (orchestrator startup ordering).
 */

export function registerSchedulerRoutes(app, deps = {}) {
  if (!app) return;
  const getScheduler = typeof deps.getScheduler === 'function' ? deps.getScheduler : () => null;
  const logger = deps.logger || { error: () => {} };
  const html = typeof deps.html === 'string' ? deps.html : '<!doctype html><title>scheduler</title>';

  // JSON snapshot of scheduler + all agents — polled by /scheduler at 1 Hz.
  app.get('/api/scheduler/state', async (req, res) => {
    try {
      const sched = getScheduler();
      if (!sched || typeof sched.getState !== 'function') {
        return res.status(503).json({ error: 'scheduler is not attached' });
      }
      const state = await sched.getState();
      res.json(state);
    } catch (err) {
      try { logger.error('Failed to build scheduler state', { error: err?.message }); } catch (_) {}
      res.status(500).json({ error: err?.message || 'unknown' });
    }
  });

  // Self-contained HTML viewer page (no external assets).
  app.get('/scheduler', (req, res) => {
    res.type('html').send(html);
  });
}

export default { registerSchedulerRoutes };
