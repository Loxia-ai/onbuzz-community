/**
 * Web Server - HTTP and WebSocket server for web interface
 * 
 * Purpose:
 * - Serve React frontend application
 * - Handle HTTP API requests
 * - Manage WebSocket connections for real-time updates
 * - File upload and project management
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { promises as fs, createReadStream } from 'fs';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

import {
  INTERFACE_TYPES,
  ORCHESTRATOR_ACTIONS,
  HTTP_STATUS,
  AGENT_MODES
} from '../utilities/constants.js';

// Import visual editor bridge and server
import { getVisualEditorBridge } from '../services/visualEditorBridge.js';
import { getVisualEditorServer, getVisualEditorPort, getVisualEditorBaseUrl, setBridgeGetter } from '../services/visualEditorServer.js';

// Import credential vault for secure credential management
import { getCredentialVault } from '../services/credentialVault.js';
import { getUserDataPaths } from '../utilities/userDataDir.js';
import { projectActiveRuns } from '../utilities/flowRunFilters.js';

// Connect visual editor server to bridge (enables element selection forwarding)
setBridgeGetter(getVisualEditorBridge);

// Import service registry for service discovery
import registry, { findFreePort, ServiceStatus } from '../services/serviceRegistry.js';

// Import file explorer module
import { initFileExplorerModule } from '../modules/fileExplorer/index.js';

// Import FlowExecutor for flow pipeline execution
import FlowExecutor from '../core/flowExecutor.js';
// Flow definition gate — rejects malformed flows BEFORE persistence/execution.
import { validateFlowDefinition } from '../core/flowSchema.js';
// Phase 4: disk checkpoint store backs resume/restart of failed runs.
import { FlowCheckpointStore } from '../core/flowCheckpointStore.js';
// Phase 5: editor lint — soft warnings (unbound placeholders, etc.)
import { lintFlow } from '../core/flowLint.js';
// Phase 6: append-only flow version archive (rollback support).
import { FlowVersionStore } from '../core/flowVersionStore.js';

// Scheduler visualizer routes (extracted for testability)
import { registerSchedulerRoutes } from './schedulerRoutes.js';
// Agent memory + context-snapshot routes — power the Memory tab in AgentEditModal.
import { registerAgentContextRoutes } from './agentContextRoutes.js';
import { getMemoryService } from '../services/memoryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Self-contained HTML for the /scheduler debug viewer. No external deps;
// polls /api/scheduler/state every second and re-renders three sections:
// header strip, per-agent table, and cycle log. See plan:
// .claude/plans/snazzy-chasing-canyon.md ("Scheduler visualizer").
const SCHEDULER_VIEWER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Scheduler visualizer</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 12px 16px; background: #0f1115; color: #d6d9de; font: 13px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  h1 { font-size: 14px; margin: 0 0 8px; font-weight: 600; letter-spacing: .3px; }
  h2 { font-size: 12px; margin: 20px 0 6px; color: #8b93a1; text-transform: uppercase; letter-spacing: .5px; font-weight: 600; }
  .hdr { display: flex; gap: 24px; flex-wrap: wrap; padding: 10px 12px; background: #171a21; border: 1px solid #242832; border-radius: 6px; }
  .hdr .kv { display: flex; flex-direction: column; }
  .hdr .k { color: #8b93a1; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
  .hdr .v { font-size: 14px; color: #eaecef; }
  .hdr .v.ok { color: #41d392; }
  .hdr .v.bad { color: #ff6b6b; }
  table { border-collapse: collapse; width: 100%; background: #13161c; border: 1px solid #242832; border-radius: 6px; overflow: hidden; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #1c1f27; vertical-align: top; white-space: nowrap; }
  th { font-size: 10px; color: #8b93a1; text-transform: uppercase; letter-spacing: .4px; background: #171a21; position: sticky; top: 0; }
  tr:last-child td { border-bottom: none; }
  tr.row-wedged { background: rgba(255, 107, 107, 0.08); }
  tr.row-hung   { background: rgba(255, 184, 0, 0.08); }
  tr.row-active { background: rgba(65, 211, 146, 0.05); }
  .chip { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .chip.ok      { background: #133a27; color: #5fe2a6; }
  .chip.bad     { background: #3a1313; color: #ff8080; }
  .chip.warn    { background: #3a2e13; color: #ffc658; }
  .chip.neutral { background: #242832; color: #b4bac5; }
  .muted { color: #6c7280; }
  .mono { font-family: inherit; }
  .count { display: inline-block; min-width: 18px; text-align: right; color: #b4bac5; }
  .iconbtn { background: none; border: 1px solid #2a2f3a; color: #b4bac5; padding: 2px 8px; border-radius: 4px; font: inherit; cursor: pointer; margin-left: 8px; }
  .iconbtn:hover { background: #1c1f27; }
  .tasks-line { color: #8b93a1; font-size: 11px; white-space: normal; max-width: 480px; }
  .reason { color: #b4bac5; }
  .error { color: #ff6b6b; padding: 10px; background: #2a1515; border: 1px solid #5a2525; border-radius: 6px; margin-top: 10px; }
  .cycle-launched { color: #5fe2a6; }
  .cycle-idle     { color: #6c7280; }
  .cycle-locked   { color: #ff8080; }
  .cycle-cap      { color: #ffc658; }
  .pill-id { display: inline-block; padding: 0 4px; background: #242832; border-radius: 3px; font-size: 11px; color: #b4bac5; margin-right: 3px; }
  .wrap { max-width: 1600px; margin: 0 auto; }
  a, a:visited { color: #6ea8fe; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Scheduler visualizer <span id="paused-note" class="muted" style="font-weight:normal;"></span></h1>
  <div id="err" class="error" style="display:none"></div>
  <div id="hdr" class="hdr"></div>

  <h2>Agents (<span id="agent-count">0</span>)</h2>
  <div style="overflow-x:auto">
    <table id="agents">
      <thead><tr>
        <th>Name</th><th>Mode</th><th>Status</th>
        <th>Active?</th><th>Reason</th>
        <th>Lock</th><th>AI call</th><th>Empties</th>
        <th>Delay</th><th>Paused</th><th>TTL</th><th>Awaiting input</th>
        <th>Tasks (p/ip/✓)</th><th>Queues (U/I/T)</th>
        <th>Model</th>
      </tr></thead>
      <tbody></tbody>
    </table>
  </div>

  <h2>
    Cycle log
    <button class="iconbtn" id="show-all">Show all 200</button>
    <button class="iconbtn" id="pause">Pause</button>
  </h2>
  <div style="overflow-x:auto">
    <table id="cycles">
      <thead><tr>
        <th>#</th><th>Time</th><th>Outcome</th>
        <th>Total</th><th>Active</th>
        <th>In-flight</th><th>Locked-skip</th><th>Cap-skip</th>
        <th>Launched</th>
      </tr></thead>
      <tbody></tbody>
    </table>
  </div>
</div>

<script>
(() => {
  const $ = id => document.getElementById(id);
  let showAll = false;
  let paused = false;

  $('show-all').addEventListener('click', () => {
    showAll = !showAll;
    $('show-all').textContent = showAll ? 'Show last 30' : 'Show all 200';
    render(lastState);
  });
  $('pause').addEventListener('click', () => {
    paused = !paused;
    $('pause').textContent = paused ? 'Resume' : 'Pause';
    $('paused-note').textContent = paused ? '(paused)' : '';
  });

  const fmtMs = ms => {
    if (ms == null) return '';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    if (ms < 3600000) return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's';
    return Math.floor(ms / 3600000) + 'h ' + Math.floor((ms % 3600000) / 60000) + 'm';
  };
  const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('en-US', { hour12: false }) : '';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function chipActive(a) {
    if (a.activity?.active) return '<span class="chip ok">yes</span>';
    return '<span class="chip bad">no</span>';
  }

  function chipLock(a) {
    if (!a.lockHeld) return '<span class="muted">—</span>';
    const ms = a.lockHeldMs ?? 0;
    const cls = ms > 60000 ? 'bad' : ms > 5000 ? 'warn' : 'neutral';
    return '<span class="chip ' + cls + '">held ' + fmtMs(ms) + '</span>';
  }

  function chipAI(a) {
    const r = a.activeAIRequest;
    if (!r) return '<span class="muted">—</span>';
    const ms = r.durationMs ?? 0;
    const cls = ms > 60000 ? 'bad' : ms > 10000 ? 'warn' : 'neutral';
    return '<span class="chip ' + cls + '">' + esc(r.type || 'req') + ' ' + fmtMs(ms) + '</span>';
  }

  function chipEmpty(a) {
    const e = a.emptyResponse;
    if (!e || !e.count) return '<span class="muted">—</span>';
    const elapsedMs = Date.now() - new Date(e.firstAt).getTime();
    const cls = e.count >= 5 ? 'bad' : e.count >= 3 ? 'warn' : 'neutral';
    const samples = Array.isArray(e.samples) ? e.samples : [];
    const lastSample = samples[samples.length - 1];
    // Chip shows count/elapsed; subline shows the best-guess root-cause hint
    // from the last sample; hover the subline for a per-sample breakdown
    // (finish_reason, has tool calls, has reasoning, model).
    const chip = '<span class="chip ' + cls + '" title="first at ' + esc(new Date(e.firstAt).toISOString()) + '">' + e.count + 'x / ' + fmtMs(elapsedMs) + '</span>';
    if (!lastSample) return chip;
    // NB: the newline in .join below is double-escaped on purpose. This
    // whole block is inside a JS template literal (SCHEDULER_VIEWER_HTML),
    // so a single-escaped newline sequence would be processed at server
    // load time, yielding a literal newline inside a single-quoted string
    // in the served JS — which the browser rejects. Same trick in
    // fmtModeCell below.
    const sampleDetail = samples.map(s =>
      s.at + ': content=' + s.contentType + '(' + s.contentLength + ') ' +
      'tools=' + (s.hasToolCalls ? s.toolCallCount : 0) + ' ' +
      'reasoning=' + (s.hasReasoning ? 'yes' : 'no') + ' ' +
      'finish=' + (s.finishReason || '—') + ' ' +
      'model=' + (s.model || '—')
    ).join('\\n');
    return chip +
      '<div class="tasks-line" title="' + esc(sampleDetail) + '">' +
        esc(lastSample.hint || '(empty response — cause unknown)') +
      '</div>';
  }

  function chipDelay(a) {
    if (!a.delayEndTime) return '<span class="muted">—</span>';
    const end = new Date(a.delayEndTime).getTime();
    const ms = end - Date.now();
    if (ms <= 0) return '<span class="muted" title="' + esc(a.delayEndTime) + '">expired</span>';
    return '<span class="chip warn" title="' + esc(a.delayEndTime) + '">' + fmtMs(ms) + '</span>';
  }

  // "Mode" cell: current mode + a subline showing the last CHAT↔AGENT flip
  // with a human-readable reason (sourced from scheduler's _modeTransitionHistory).
  // Hover the subline to see the full history of recent transitions.
  function fmtModeCell(a) {
    const current = esc(a.mode || '');
    const history = Array.isArray(a.modeTransitions) ? a.modeTransitions : [];
    if (history.length === 0) return current;
    const last = history[history.length - 1];
    const age = Date.now() - new Date(last.at).getTime();
    // Build a title tooltip with the last ~5 transitions as a plain-text list.
    // See note above (chipEmpty): double-escape in the .join is intentional
    // — the outer template literal would otherwise process a single-escape
    // newline into a real newline at load time.
    const historyTip = history.slice(-5).reverse().map(t => {
      const ageT = Date.now() - new Date(t.at).getTime();
      return fmtMs(ageT) + ' ago: ' + t.from + ' → ' + t.to + ' — ' + t.humanReason;
    }).join('\\n');
    const direction = last.from + ' → ' + last.to;
    return current +
      '<div class="tasks-line" title="' + esc(historyTip) + '">' +
        '<span class="muted">' + esc(direction) + ' · ' + fmtMs(age) + ' ago</span>' +
      '</div>' +
      '<div class="tasks-line" title="' + esc(last.humanReason) + '">' +
        esc(last.humanReason) +
      '</div>';
  }

  function rowClass(a) {
    if (a.lockHeld && (a.lockHeldMs ?? 0) > 60000) return 'row-wedged';
    const aiMs = a.activeAIRequest?.durationMs ?? 0;
    if (aiMs > 60000) return 'row-hung';
    if ((a.emptyResponse?.count ?? 0) >= 3) return 'row-hung'; // amber — stall forming
    if (a.activity?.active && !a.lockHeld) return 'row-active';
    return '';
  }

  function renderAgents(agents) {
    $('agent-count').textContent = agents.length;
    const tbody = document.querySelector('#agents tbody');
    // Sort: locked-wedged first, then active, then everything else. Stable for same class.
    const score = a => (a.lockHeld && (a.lockHeldMs ?? 0) > 60000) ? 0
                     : (a.activeAIRequest?.durationMs ?? 0) > 60000 ? 1
                     : a.activity?.active ? 2
                     : 3;
    const sorted = agents.slice().sort((x, y) => score(x) - score(y));
    tbody.innerHTML = sorted.map(a => {
      const q = a.queues || {};
      const t = a.tasks || {};
      return '<tr class="' + rowClass(a) + '">' +
        '<td title="' + esc(a.id) + '">' + esc(a.name || a.id) + '</td>' +
        '<td>' + fmtModeCell(a) + '</td>' +
        '<td>' + esc(a.status || '') + '</td>' +
        '<td>' + chipActive(a) + '</td>' +
        '<td class="reason" title="' + esc(a.activity?.details || '') + '">' + esc(a.activity?.reason || '') + '</td>' +
        '<td>' + chipLock(a) + '</td>' +
        '<td>' + chipAI(a) + '</td>' +
        '<td>' + chipEmpty(a) + '</td>' +
        '<td>' + chipDelay(a) + '</td>' +
        '<td>' + (a.pausedUntil ? '<span class="chip warn">paused</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (a.ttl != null ? '<span class="chip warn">' + esc(a.ttl) + '</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (a.awaitingUserInput ? '<span class="chip warn">' + esc(a.awaitingUserInput.type || 'yes') + '</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td><span class="count">' + (t.pending||0) + '</span>/<span class="count">' + (t.inProgress||0) + '</span>/<span class="count muted">' + (t.completed||0) + '</span>' +
          (t.nextPending ? '<div class="tasks-line">next: ' + esc(t.nextPending) + '</div>' : '') + '</td>' +
        '<td>' + (q.userMessages||0) + '/' + (q.interAgentMessages||0) + '/' + (q.toolResults||0) + '</td>' +
        '<td class="muted">' + esc(a.currentModel || '—') + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderCycles(cycles) {
    const tbody = document.querySelector('#cycles tbody');
    // Newest first
    const reversed = cycles.slice().reverse();
    const limited = showAll ? reversed : reversed.slice(0, 30);
    tbody.innerHTML = limited.map(c => {
      const outcomeClass = 'cycle-' + (c.outcome === 'launched' ? 'launched'
                          : c.outcome === 'idle' ? 'idle'
                          : c.outcome === 'all-locked' ? 'locked'
                          : c.outcome === 'concurrency-cap' ? 'cap'
                          : 'idle');
      const launched = (c.launched || []).map(id => '<span class="pill-id" title="' + esc(id) + '">' + esc(id.slice(-8)) + '</span>').join('') || '<span class="muted">—</span>';
      const locked = (c.skippedLocked || []).map(id => '<span class="pill-id" title="' + esc(id) + '">' + esc(id.slice(-8)) + '</span>').join('') || '<span class="muted">—</span>';
      const cap = (c.skippedConcurrency || []).map(id => '<span class="pill-id" title="' + esc(id) + '">' + esc(id.slice(-8)) + '</span>').join('') || '<span class="muted">—</span>';
      return '<tr>' +
        '<td class="muted">' + c.n + '</td>' +
        '<td>' + fmtTime(c.at) + '</td>' +
        '<td class="' + outcomeClass + '">' + esc(c.outcome || '') + '</td>' +
        '<td>' + (c.totalAgents || 0) + '</td>' +
        '<td>' + (c.activeCount || 0) + '</td>' +
        '<td>' + (c.inFlightAtStart || 0) + '</td>' +
        '<td>' + locked + '</td>' +
        '<td>' + cap + '</td>' +
        '<td>' + launched + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderHeader(s) {
    const hdr = $('hdr');
    const inflight = s.scheduler.currentlyInFlight;
    const cap = s.scheduler.maxConcurrent;
    hdr.innerHTML =
      '<div class="kv"><div class="k">Server</div><div class="v">' + fmtTime(s.serverTime) + '</div></div>' +
      '<div class="kv"><div class="k">Scheduler</div><div class="v ' + (s.scheduler.running ? 'ok' : 'bad') + '">' + (s.scheduler.running ? 'running' : 'stopped') + '</div></div>' +
      '<div class="kv"><div class="k">Tick</div><div class="v">' + s.scheduler.iterationDelayMs + 'ms</div></div>' +
      '<div class="kv"><div class="k">Cycles</div><div class="v">' + s.scheduler.cycleCount + '</div></div>' +
      '<div class="kv"><div class="k">In-flight</div><div class="v ' + (inflight >= cap ? 'bad' : '') + '">' + inflight + ' / ' + cap + '</div></div>' +
      '<div class="kv"><div class="k">Agents</div><div class="v">' + s.agents.length + '</div></div>';
  }

  let lastState = null;
  function render(s) {
    if (!s) return;
    lastState = s;
    renderHeader(s);
    renderAgents(s.agents);
    renderCycles(s.cycles);
  }

  async function tick() {
    if (paused) return;
    try {
      const res = await fetch('/api/scheduler/state', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      $('err').style.display = 'none';
      render(data);
    } catch (err) {
      $('err').style.display = 'block';
      $('err').textContent = 'Failed to fetch scheduler state: ' + err.message;
    }
  }

  tick();
  setInterval(tick, 1000);
})();
</script>
</body>
</html>`;

class WebServer {
  constructor(orchestrator, logger, config = {}) {
    this.orchestrator = orchestrator;
    this.logger = logger;
    this.config = config;
    
    this.port = config.port || 8080;
    // Use 127.0.0.1 instead of 'localhost' to avoid IPv6 issues in WSL2
    // 'localhost' resolves to ::1 (IPv6) which has permission issues in WSL2
    this.host = config.host || '127.0.0.1';
    
    // Express app
    this.app = express();
    this.server = createServer(this.app);
    
    // WebSocket server with CORS support
    this.wss = new WebSocketServer({ 
      server: this.server,
      // Allow all origins for WebSocket connections
      verifyClient: (info) => {
        // Log connection attempt for debugging
        this.logger?.info('WebSocket connection attempt', {
          origin: info.origin,
          host: info.req.headers.host,
          userAgent: info.req.headers['user-agent'],
          url: info.req.url
        });
        
        // Allow all origins (you can restrict this later if needed)
        return true;
      }
    });
    
    // Active WebSocket connections
    this.connections = new Map();
    
    // Session management
    this.sessions = new Map();
    
    // API Key Manager reference (will be set by LoxiaSystem)
    this.apiKeyManager = null;

    // Credential Vault for secure credential management
    this.credentialVault = null;

    // Visual Editor Bridge and Server references
    this.visualEditorBridge = null;
    this.visualEditorServer = null;

    // Flow Executor for flow pipeline execution
    this.flowExecutor = null;

    // Schedule Service reference
    this.scheduleService = null;

    this.isRunning = false;
  }

  /**
   * Initialize web server
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.setupMiddleware();
      await this.setupRoutes();
      this.setupWebSocket();

      await this.startServer();

      // Start Visual Editor Server on backend startup (always-on mode)
      await this.startVisualEditorServer();

      // Initialize Flow Executor for flow pipeline execution
      this.initializeFlowExecutor();

      this.logger.info('Web server initialized', {
        port: this.port,
        host: this.host,
        url: `http://${this.host}:${this.port}`
      });

    } catch (error) {
      this.logger.error('Web server initialization failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Start the Visual Editor Server (always-on mode)
   * Server runs on port 4000 (or configured port) and waits for agent connections
   * @private
   */
  async startVisualEditorServer() {
    try {
      // Initialize bridge (manages per-agent instances)
      this.visualEditorBridge = getVisualEditorBridge({
        logger: this.logger
      });

      // Initialize and start the server
      this.visualEditorServer = getVisualEditorServer({
        logger: this.logger
      });

      const result = await this.visualEditorServer.start();

      this.logger.info('Visual Editor Server started (always-on mode)', {
        port: result.port,
        healthUrl: `http://localhost:${result.port}/health`,
        editorUrl: `http://localhost:${result.port}`
      });
    } catch (error) {
      // Log but don't fail - visual editor is optional
      this.logger.warn('Failed to start Visual Editor Server (non-fatal)', {
        error: error.message
      });
    }
  }

  /**
   * Initialize Flow Executor for executing visual flow pipelines
   * @private
   */
  initializeFlowExecutor() {
    try {
      const { stateManager, agentPool, messageProcessor, config } = this.orchestrator;

      if (!stateManager || !agentPool || !messageProcessor) {
        this.logger.warn('FlowExecutor not initialized - missing dependencies', {
          hasStateManager: !!stateManager,
          hasAgentPool: !!agentPool,
          hasMessageProcessor: !!messageProcessor
        });
        return;
      }

      this.flowExecutor = new FlowExecutor(
        config,
        this.logger,
        stateManager,
        agentPool,
        messageProcessor
      );

      // Connect WebServer as WebSocketManager for real-time updates
      // WebServer has broadcastToSession method that FlowExecutor will use
      this.flowExecutor.setWebSocketManager(this);

      // Phase 4: wire a disk checkpoint store so failed/interrupted
      // flow runs can be resumed instead of starting over from scratch.
      // Stored under the user data dir alongside agent state so the
      // data survives `npm i -g` updates and follows the user across
      // working-directory changes. (Earlier code read `dataPaths?.dataDir`
      // which doesn't exist on getUserDataPaths() — that fell through to
      // process.cwd() and dropped checkpoints into whatever directory the
      // process happened to start in. Use `state` instead, grouping with
      // agents/, operations/, models/, skills/.)
      try {
        const dataPaths = getUserDataPaths();
        const checkpointDir = path.join(dataPaths?.state || process.cwd(), 'flow-checkpoints');
        const store = new FlowCheckpointStore({ baseDir: checkpointDir });
        this.flowExecutor.setCheckpointStore(store);
        this.logger.info('FlowExecutor checkpoint store enabled', { baseDir: checkpointDir });
      } catch (err) {
        // Non-fatal: continue without resumability rather than failing init.
        this.logger.warn('Failed to enable flow checkpoint store (non-fatal)', { error: err.message });
      }

      // Phase 6: wire a version store so every flow save records an
      // immutable snapshot. Used by /api/flows/:id/versions and
      // /api/flows/:id/rollback. Stored alongside checkpoints under
      // user data dir (see comment above for path-fix history).
      try {
        const dataPaths = getUserDataPaths();
        const versionDir = path.join(dataPaths?.state || process.cwd(), 'flow-versions');
        this.flowVersionStore = new FlowVersionStore({ baseDir: versionDir });
        this.logger.info('Flow version store enabled', { baseDir: versionDir });
      } catch (err) {
        this.logger.warn('Failed to enable flow version store (non-fatal)', { error: err.message });
      }

      // Wire FlowExecutor into jobDoneTool so it can signal completion directly
      const toolsRegistry = this.orchestrator?.toolsRegistry;
      if (toolsRegistry) {
        const jobDoneTool = toolsRegistry.getTool('jobdone');
        if (jobDoneTool && typeof jobDoneTool.setFlowExecutor === 'function') {
          jobDoneTool.setFlowExecutor(this.flowExecutor);
        }
        // Wire FlowExecutor into platformControlTool so its execute-flow
        // and dry-run-flow actions can reach the executor. Without this,
        // an agent with `flows: 'all'` permission would still get
        // "FlowExecutor not available" when calling execute-flow.
        const platformControlTool = toolsRegistry.getTool('platformcontrol');
        if (platformControlTool && typeof platformControlTool.setFlowExecutor === 'function') {
          platformControlTool.setFlowExecutor(this.flowExecutor);
        }
      }

      this.logger.info('FlowExecutor initialized successfully');
    } catch (error) {
      // Log but don't fail - flow execution is optional
      this.logger.warn('Failed to initialize FlowExecutor (non-fatal)', {
        error: error.message
      });
    }
  }

  /**
   * Setup Express middleware
   * @private
   */
  setupMiddleware() {
    // CORS middleware
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(HTTP_STATUS.OK);
      } else {
        next();
      }
    });
    
    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // ── Remote Session Auth Gate ─────────────────────────────────────
    // Initialize file explorer module
    this.fileExplorerModule = initFileExplorerModule({
      showHidden: false,
      restrictedPaths: [] // Can be configured as needed
    });

    // Mount file explorer routes
    this.app.use('/api/file-explorer', this.fileExplorerModule.router);
    
    // Static files (React build)
    const staticPath = path.join(__dirname, '../../web-ui/build');
    this.app.use(express.static(staticPath));
    
    // Request logging
    this.app.use((req, res, next) => {
      this.logger.debug(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  /**
   * Setup API routes
   * @private
   */
  async setupRoutes() {
    // widget-module: remove this block if the module is deleted.
    // Mounts the widget runtime asset + audit routes under /api/widget/*.
    // AWAITED BEFORE other routes: Express matches routes in registration
    // order, and the SPA catch-all registered later in this file matches
    // EVERY GET request — if widget routes aren't in place first, the
    // fallback returns index.html for /api/widget/runtime.js and the
    // iframe tries to parse HTML as JS ("Unexpected token '<'").
    try {
      const mod = await import('../modules/widget/index.js');
      if (!mod.isDisabled()) {
        // The orchestrator does NOT carry toolsRegistry in production —
        // it lives on `this` (the WebServer). Other route handlers in
        // this file work around it with a `this.toolsRegistry || ...
        // orchestrator?.toolsRegistry` fallback. Pass both explicitly
        // so the widget module's routes resolve the tool reliably.
        mod.registerRoutes(this.app, this.orchestrator, {
          toolsRegistry: this.toolsRegistry,
        });
        this.logger.info('Widget module routes registered');

        // Bridge the WidgetTool's event bus to a `widget_changed` WebSocket
        // push. The artifacts panel listens for these so its summary cache
        // stays current — independent of whether the chat feed has the
        // tool-result message mounted (the feed is lazily virtualized; old
        // entries unload as the user scrolls and would otherwise be missed).
        try {
          const widgetTool =
            this.toolsRegistry?.getTool?.('widget') ||
            this.orchestrator?.toolsRegistry?.getTool?.('widget');
          if (widgetTool?.events?.on) {
            widgetTool.events.on('widget-changed', (evt) => {
              try {
                // sessionId=null → broadcastToSession falls back to all
                // connections. The frontend filters on currentAgent.
                this.broadcastToSession(null, {
                  type: 'widget_changed',
                  data: evt,
                });
              } catch (err) {
                this.logger.warn('Failed to broadcast widget_changed', { error: err.message });
              }
            });
            this.logger.info('Widget event bus bridged to WebSocket');
          } else {
            this.logger.warn('Widget tool has no events bus — push updates disabled');
          }
        } catch (err) {
          this.logger.warn('Widget event bus subscribe failed', { error: err.message });
        }
      }
    } catch (err) {
      this.logger.warn('Widget module not available', { error: err.message });
    }

    // Health check
    this.app.get('/api/health', async (req, res) => {
      try {
        const packageJsonPath = path.join(__dirname, '../../package.json');
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

        res.json({
          status: 'healthy',
          version: packageJson.version || '1.0.0',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.json({
          status: 'healthy',
          version: '1.0.0',
          timestamp: new Date().toISOString()
        });
      }
    });

    // =====================================================
    // System Update API
    // =====================================================

    // Check update status
    this.app.get('/api/system/update-status', async (req, res) => {
      try {
        const packageJsonPath = path.join(__dirname, '../../package.json');
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

        res.json({
          success: true,
          currentVersion: packageJson.version || '1.0.0',
          updateCommand: 'npm i -g onbuzz-community@latest'
        });
      } catch (error) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message
        });
      }
    });

    // Idle auto-shutdown (used by trigger-schedule when it wakes the server)
    this.app.post('/api/system/idle-shutdown', async (req, res) => {
      const { timeoutMinutes = 10 } = req.body || {};
      const ms = Math.max(1, Math.min(timeoutMinutes, 120)) * 60 * 1000;

      // Clear any previous idle timer
      if (this._idleShutdownTimer) clearTimeout(this._idleShutdownTimer);

      this._idleShutdownTimer = setTimeout(() => {
        this.logger.info('Idle shutdown triggered (no activity after scheduled task wake-up)');
        process.kill(process.pid, 'SIGTERM');
      }, ms);

      this.logger.info('Idle shutdown armed', { timeoutMinutes: Math.round(ms / 60000) });
      res.json({ success: true, shutdownIn: `${Math.round(ms / 60000)} minutes` });
    });

    // Perform update (localhost only for security)
    this.app.post('/api/system/update', async (req, res) => {
      // Security: only allow from localhost
      const clientIp = req.ip || req.connection.remoteAddress;
      const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';

      if (!isLocalhost) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          error: 'Updates can only be triggered from localhost'
        });
      }

      const { restartCommand = 'loxia web', restartDelay = 5000 } = req.body || {};

      try {
        this.logger.info('Starting system update...');

        // Run npm install
        const updateOutput = execSync('npm i -g onbuzz-community@latest', {
          encoding: 'utf8',
          timeout: 120000, // 2 minute timeout
          stdio: ['pipe', 'pipe', 'pipe']
        });

        this.logger.info('Update completed successfully', { output: updateOutput });

        // Launch watchdog as a truly independent process (survives parent exit)
        // Use inline script approach - works reliably on all platforms
        const nodePath = process.execPath;
        const inlineScript = `
          const { spawn } = require('child_process');
          const delay = ${restartDelay};
          const command = '${restartCommand.replace(/'/g, "\\'")}';

          console.log('[Watchdog] Started, waiting ' + delay + 'ms');

          setTimeout(() => {
            console.log('[Watchdog] Executing: ' + command);
            const parts = command.split(' ');
            const child = spawn(parts[0], parts.slice(1), {
              stdio: 'inherit',
              shell: true
            });
            child.on('error', (err) => console.error('[Watchdog] Error:', err));
          }, delay);
        `;

        const child = spawn(nodePath, ['-e', inlineScript], {
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore']
        });
        child.unref();

        this.logger.info('Watchdog spawned', {
          pid: child.pid,
          nodePath,
          restartCommand,
          restartDelay
        });

        // Send success response before exiting
        res.json({
          success: true,
          message: 'Update complete. Restarting...',
          restartIn: restartDelay
        });

        // Give watchdog process time to fully detach before we exit
        // Longer delay ensures child process is completely independent
        setTimeout(() => {
          this.logger.info('Exiting for restart - watchdog will take over...');
          process.exit(0);
        }, 3000);

      } catch (error) {
        this.logger.error('Update failed', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message,
          hint: 'Try running manually: npm i -g onbuzz-community@latest'
        });
      }
    });

    // =====================================================
    // Service Discovery API
    // =====================================================

    // Get all registered services
    this.app.get('/api/services', (req, res) => {
      try {
        const services = registry.getAll();
        res.json({
          success: true,
          services,
          stats: registry.getStats()
        });
      } catch (error) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get a specific service
    this.app.get('/api/services/:name', (req, res) => {
      try {
        const { name } = req.params;
        const service = registry.get(name);

        if (!service) {
          return res.status(HTTP_STATUS.NOT_FOUND).json({
            success: false,
            error: `Service '${name}' not found`
          });
        }

        res.json({
          success: true,
          service
        });
      } catch (error) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message
        });
      }
    });

    // Register a service
    this.app.post('/api/services/register', (req, res) => {
      try {
        const { name, port, host, protocol, metadata } = req.body;

        if (!name || !port) {
          return res.status(HTTP_STATUS.BAD_REQUEST).json({
            success: false,
            error: 'Service name and port are required'
          });
        }

        const serviceInfo = registry.register(name, {
          port,
          host,
          protocol,
          metadata
        });

        res.json({
          success: true,
          service: serviceInfo
        });
      } catch (error) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message
        });
      }
    });

    // Unregister a service
    this.app.delete('/api/services/:name', (req, res) => {
      try {
        const { name } = req.params;
        const removed = registry.unregister(name);

        res.json({
          success: true,
          removed
        });
      } catch (error) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message
        });
      }
    });

    // Service heartbeat
    this.app.post('/api/services/:name/heartbeat', (req, res) => {
      try {
        const { name } = req.params;
        registry.heartbeat(name);

        res.json({
          success: true,
          timestamp: Date.now()
        });
      } catch (error) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message
        });
      }
    });

    // =====================================================
    // End Service Discovery API
    // =====================================================

    // Session creation
    this.app.post('/api/sessions', async (req, res) => {
      try {
        const sessionId = `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const projectDir = req.body.projectDir || process.cwd();

        const session = {
          id: sessionId,
          projectDir,
          createdAt: new Date().toISOString(),
          lastActivity: new Date().toISOString()
        };

        this.sessions.set(sessionId, session);

        res.json({
          success: true,
          session
        });

      } catch (error) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message
        });
      }
    });
    
    // Orchestrator API proxy
    this.app.post('/api/orchestrator', async (req, res) => {
      try {
        const request = {
          interface: INTERFACE_TYPES.WEB,
          sessionId: req.body.sessionId,
          action: req.body.action,
          payload: req.body.payload,
          projectDir: req.body.projectDir || process.cwd()
        };
        
        const response = await this.orchestrator.processRequest(request);
        
        // Broadcast updates via WebSocket
        this.broadcastToSession(request.sessionId, {
          type: 'orchestrator_response',
          action: request.action,
          response
        });
        
        res.json(response);
        
      } catch (error) {
        this.logger.error('Orchestrator API error', {
          error: error.message,
          body: req.body
        });
        
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message
        });
      }
    });
    
    // File operations
    this.app.get('/api/files', async (req, res) => {
      try {
        const { path: filePath, projectDir } = req.query;
        const fullPath = path.resolve(projectDir || process.cwd(), filePath || '.');
        
        const stats = await fs.stat(fullPath);
        
        if (stats.isDirectory()) {
          const entries = await fs.readdir(fullPath, { withFileTypes: true });
          const files = entries.map(entry => ({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            path: path.join(filePath || '.', entry.name)
          }));
          
          res.json({ success: true, files });
        } else {
          const content = await fs.readFile(fullPath, 'utf8');
          res.json({ success: true, content, type: 'file' });
        }
        
      } catch (error) {
        res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: error.message
        });
      }
    });
    
    // File upload
    this.app.post('/api/files/upload', async (req, res) => {
      try {
        const { fileName, content, projectDir } = req.body;
        const targetDir = projectDir || process.cwd();
        const fullPath = path.resolve(targetDir, fileName);

        // Ensure the directory exists
        await fs.mkdir(targetDir, { recursive: true });

        // Write the file
        await fs.writeFile(fullPath, content, 'utf8');

        res.json({
          success: true,
          message: 'File uploaded successfully',
          path: fullPath
        });

      } catch (error) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message
        });
      }
    });
    
    // Enhanced folder explorer endpoint
    this.app.get('/api/explorer', async (req, res) => {
      try {
        const { path: requestedPath, showHidden = false } = req.query;
        const basePath = requestedPath || process.cwd();
        const fullPath = path.resolve(basePath);
        
        // Security: Basic path traversal protection
        const normalizedPath = path.normalize(fullPath);
        
        const stats = await fs.stat(normalizedPath);
        
        if (!stats.isDirectory()) {
          return res.status(HTTP_STATUS.BAD_REQUEST).json({
            success: false,
            error: 'Path is not a directory'
          });
        }
        
        const entries = await fs.readdir(normalizedPath, { withFileTypes: true });
        
        // Process entries
        const items = await Promise.all(
          entries
            .filter(entry => showHidden === 'true' || !entry.name.startsWith('.'))
            .map(async (entry) => {
              const itemPath = path.join(normalizedPath, entry.name);
              const itemStats = await fs.stat(itemPath).catch(() => null);
              
              return {
                name: entry.name,
                type: entry.isDirectory() ? 'directory' : 'file',
                path: itemPath,
                relativePath: path.relative(process.cwd(), itemPath),
                size: itemStats?.size || 0,
                modified: itemStats?.mtime || null,
                isHidden: entry.name.startsWith('.'),
                permissions: {
                  readable: true, // Could check with fs.access
                  writable: true  // Could check with fs.access
                }
              };
            })
        );
        
        // Sort: directories first, then files, both alphabetically
        items.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
        
        // Get parent directory info
        const parentPath = path.dirname(normalizedPath);
        const hasParent = parentPath !== normalizedPath;
        
        res.json({
          success: true,
          currentPath: normalizedPath,
          currentRelativePath: path.relative(process.cwd(), normalizedPath),
          parentPath: hasParent ? parentPath : null,
          items,
          totalItems: items.length,
          directories: items.filter(item => item.type === 'directory').length,
          files: items.filter(item => item.type === 'file').length
        });
        
      } catch (error) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message,
          code: error.code
        });
      }
    });
    
    // Create directory endpoint
    this.app.post('/api/explorer/mkdir', async (req, res) => {
      try {
        const { path: dirPath, name } = req.body;
        const fullPath = path.resolve(dirPath, name);
        
        await fs.mkdir(fullPath, { recursive: false });
        
        res.json({
          success: true,
          path: fullPath,
          relativePath: path.relative(process.cwd(), fullPath)
        });
        
      } catch (error) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message,
          code: error.code
        });
      }
    });
    
    // Get directory info endpoint
    this.app.get('/api/explorer/info', async (req, res) => {
      try {
        const { path: requestedPath } = req.query;
        const fullPath = path.resolve(requestedPath);
        
        const stats = await fs.stat(fullPath);
        
        res.json({
          success: true,
          path: fullPath,
          relativePath: path.relative(process.cwd(), fullPath),
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          accessed: stats.atime
        });
        
      } catch (error) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: error.message,
          code: error.code
        });
      }
    });
    
    // LLM Chat endpoint — dispatches to the local AIService, which routes
    // to the configured native provider (OpenAI / Anthropic / Gemini /
    // xAI / Ollama). Supports SSE streaming when stream:true.
    this.app.post('/api/llm/chat', async (req, res) => {
      try {
        const { model, messages, system, stream, options = {}, provider } = req.body || {};
        if (!model) return res.status(400).json({ error: 'model is required' });
        if (!Array.isArray(messages) || messages.length === 0) {
          return res.status(400).json({ error: 'messages must be a non-empty array' });
        }

        const aiService = this.orchestrator?.aiService;
        if (!aiService) return res.status(503).json({ error: 'AI service not available' });

        if (stream) {
          res.setHeader('Content-Type',  'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection',    'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders?.();

          const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
          try {
            const final = await aiService.sendMessageStream(model, messages, {
              ...options,
              provider,
              systemPrompt: system,
              onChunk:          (text) => send({ type: 'chunk',           content: text }),
              onReasoningChunk: (text) => send({ type: 'reasoning_chunk', content: text }),
              onError:          (err)  => send({ type: 'error', error: err.message, code: err.code }),
            });
            send({
              type:         'done',
              content:      final.content,
              reasoning:    final.reasoning,
              usage:        final.tokenUsage,
              model:        final.model,
              finishReason: final.finishReason,
              toolCalls:    final.toolCalls,
            });
            res.end();
          } catch (err) {
            send({ type: 'error', error: err.message, code: err.code || err.status });
            res.end();
          }
          return;
        }

        // Non-streaming
        try {
          const final = await aiService.sendMessage(model, messages, {
            ...options,
            provider,
            systemPrompt: system,
          });
          res.json({
            content:      final.content,
            reasoning:    final.reasoning,
            usage:        final.tokenUsage,
            model:        final.model,
            finishReason: final.finishReason,
            toolCalls:    final.toolCalls,
          });
        } catch (err) {
          res.status(err.status || 500).json({ error: err.message, code: err.code });
        }
      } catch (error) {
        this.logger.error('LLM chat request failed', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message });
      }
    });

    // LLM Models endpoint — returns the local model catalog
    // (modelsService loads from the static manifest + provider /models APIs).
    //
    // Query params:
    //   ?chat=true    — only return models tagged chat=true (filters out
    //                   TTS / embeddings / image / realtime / etc. that
    //                   live in vendor /models lists but aren't usable on
    //                   chat completions).
    this.app.get('/api/llm/models', async (req, res) => {
      try {
        const modelsService = this.orchestrator?.modelsService;
        if (!modelsService) return res.status(503).json({ success: false, error: 'Models service not available' });
        let models = modelsService.getModels?.() || [];
        if (req.query.chat === 'true') {
          models = models.filter(m => m.chat !== false);
        }
        res.json({ success: true, models });
      } catch (error) {
        this.logger.error('Failed to fetch models', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // Tools information endpoint - get available tools from registry
    this.app.get('/api/tools', async (req, res) => {
      try {
        // Get tools registry (passed from LoxiaSystem)
        const toolsRegistry = this.toolsRegistry;
        
        if (!toolsRegistry) {
          return res.status(500).json({
            error: 'Tools registry not available'
          });
        }
        
        // Get available tools for UI
        const tools = toolsRegistry.getAvailableToolsForUI();
        
        this.logger.info('Serving tools information', { 
          toolCount: tools.length,
          tools: tools.map(t => ({ id: t.id, name: t.name, category: t.category }))
        });
        
        res.json({
          success: true,
          tools,
          total: tools.length
        });
        
      } catch (error) {
        this.logger.error('Failed to get tools information', { 
          error: error.message,
          stack: error.stack 
        });
        
        res.status(500).json({
          error: 'Failed to retrieve tools information',
          message: error.message
        });
      }
    });
    
    // API Key Management Endpoints
    
    // Set API keys (vendor keys + custom OpenAI-compatible endpoints)
    this.app.post('/api/keys', async (req, res) => {
      try {
        const { sessionId, vendorKeys, customEndpoints } = req.body;

        if (!this.apiKeyManager) {
          return res.status(500).json({ success: false, error: 'API key manager not available' });
        }

        await this.apiKeyManager.setSessionKeys(sessionId || null, {
          vendorKeys:      vendorKeys || {},
          customEndpoints: customEndpoints || undefined,
        });

        // Invalidate the AIService provider registry so new keys take effect
        if (this.orchestrator?.aiService?.invalidateProviderRegistry) {
          this.orchestrator.aiService.invalidateProviderRegistry();
        }
        // Refresh model catalog so live provider models appear/disappear
        if (this.orchestrator?.modelsService?.refresh) {
          try { await this.orchestrator.modelsService.refresh(); } catch { /* ok */ }
        }

        this.logger.info('API keys updated', {
          sessionId,
          vendors: Object.keys(vendorKeys || {}),
        });

        res.json({
          success:    true,
          sessionId:  sessionId || null,
          vendorKeys: Object.keys(this.apiKeyManager.keys.vendorKeys || {}),
        });
      } catch (error) {
        this.logger.error('Failed to set API keys', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get API keys for a session (returns only presence, not values)
    this.app.get('/api/keys/:sessionId', async (req, res) => {
      try {
        const { sessionId } = req.params;
        if (!this.apiKeyManager) {
          return res.status(500).json({ success: false, error: 'API key manager not available' });
        }
        const keys = this.apiKeyManager.getSessionKeys(sessionId);
        res.json({
          success:    true,
          sessionId,
          vendorKeys: Object.keys(keys.vendorKeys || {}),
          customEndpoints: (keys.customEndpoints || []).map(ep => ({
            id:      ep.id,
            name:    ep.name,
            baseUrl: ep.baseUrl,
            // Never expose the apiKey itself.
          })),
        });
        
      } catch (error) {
        this.logger.error('Failed to get API key status', {
          error: error.message,
          sessionId: req.params.sessionId
        });
        
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
    
    // Remove API keys for current session
    this.app.delete('/api/keys/:sessionId', async (req, res) => {
      try {
        const { sessionId } = req.params;
        
        if (!this.apiKeyManager) {
          return res.status(500).json({
            success: false,
            error: 'API key manager not available'
          });
        }
        
        const removed = await this.apiKeyManager.removeSessionKeys(sessionId);

        res.json({
          success: true,
          removed,
          message: removed ? 'API keys removed successfully' : 'No API keys found for session'
        });
        
      } catch (error) {
        this.logger.error('Failed to remove API keys', {
          error: error.message,
          sessionId: req.params.sessionId
        });
        
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
    
    // Test a provider connection (used by the onboarding wizard).
    // Verifies the supplied API key by listing models from the provider's
    // REST endpoint. Keys are NOT stored — the caller still has to POST
    // them to /api/keys. Routing this through the backend avoids per-
    // provider CORS quirks and keeps keys off the wire to third parties
    // from the browser context.
    this.app.post('/api/providers/test', async (req, res) => {
      try {
        const { provider, apiKey, host } = req.body || {};
        const { testProviderConnection } = await import('../services/providerTester.js');
        const result = await testProviderConnection({ provider, apiKey, host });
        // Always 200 — the body's `ok` flag is the success signal. This
        // keeps the frontend logic uniform: a network error from us is
        // genuinely exceptional and stays a 5xx.
        res.json(result);
      } catch (error) {
        this.logger.error('Provider test failed', { error: error.message });
        res.status(500).json({ ok: false, message: error.message });
      }
    });

    // Get active sessions with API keys (admin endpoint)
    this.app.get('/api/keys', async (req, res) => {
      try {
        if (!this.apiKeyManager) {
          return res.status(500).json({
            success: false,
            error: 'API key manager not available'
          });
        }
        
        const activeSessions = this.apiKeyManager.getActiveSessions();
        
        res.json({
          success: true,
          sessions: activeSessions,
          total: activeSessions.length
        });
        
      } catch (error) {
        this.logger.error('Failed to get active sessions', {
          error: error.message
        });
        
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // ============================================================
    // Credential Vault Endpoints
    // ============================================================

    // List saved credentials (safe - no passwords exposed)
    this.app.get('/api/credentials', async (req, res) => {
      try {
        if (!this.credentialVault) {
          return res.status(500).json({
            success: false,
            error: 'Credential vault not available'
          });
        }

        const credentials = this.credentialVault.listCredentials();
        const knownSites = this.credentialVault.listKnownSites();

        res.json({
          success: true,
          credentials,
          knownSites
        });

      } catch (error) {
        this.logger.error('Failed to list credentials', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Save credentials for a site
    this.app.post('/api/credentials', async (req, res) => {
      try {
        const { siteId, username, password, loginUrl, selectors } = req.body;

        if (!this.credentialVault) {
          return res.status(500).json({
            success: false,
            error: 'Credential vault not available'
          });
        }

        if (!siteId || !username || !password) {
          return res.status(400).json({
            success: false,
            error: 'siteId, username, and password are required'
          });
        }

        await this.credentialVault.saveCredentials(siteId, {
          username,
          password,
          loginUrl,
          selectors
        });

        // Don't log password
        this.logger.info('Credentials saved via API', { siteId });

        res.json({
          success: true,
          message: `Credentials saved for ${siteId}`
        });

      } catch (error) {
        this.logger.error('Failed to save credentials', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Delete credentials for a site
    this.app.delete('/api/credentials/:siteId', async (req, res) => {
      try {
        const { siteId } = req.params;

        if (!this.credentialVault) {
          return res.status(500).json({
            success: false,
            error: 'Credential vault not available'
          });
        }

        const deleted = await this.credentialVault.deleteCredentials(siteId);

        if (deleted) {
          this.logger.info('Credentials deleted via API', { siteId });
          res.json({ success: true, message: `Credentials deleted for ${siteId}` });
        } else {
          res.status(404).json({
            success: false,
            error: `No credentials found for ${siteId}`
          });
        }

      } catch (error) {
        this.logger.error('Failed to delete credentials', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Submit credentials for a pending request (from UI modal)
    this.app.post('/api/credentials/submit', async (req, res) => {
      try {
        const { requestId, siteId, username, password, saveToVault, credentials, saveForFuture } = req.body;

        if (!this.credentialVault) {
          return res.status(500).json({
            success: false,
            error: 'Credential vault not available'
          });
        }

        // Support both formats:
        // 1. {requestId, username, password, saveToVault} - from CredentialRequestModal
        // 2. {requestId, credentials: {username, password}, saveForFuture} - legacy format
        const creds = credentials || { username, password };
        const shouldSave = saveToVault ?? saveForFuture ?? false;

        if (!requestId || !creds.username || !creds.password) {
          return res.status(400).json({
            success: false,
            error: 'requestId, username and password are required'
          });
        }

        await this.credentialVault.submitCredentials(
          requestId,
          creds,
          shouldSave === true
        );

        this.logger.info('Credentials submitted for request', { requestId, siteId });

        res.json({
          success: true,
          message: 'Credentials submitted successfully'
        });

      } catch (error) {
        this.logger.error('Failed to submit credentials', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Cancel a pending credential request
    this.app.post('/api/credentials/cancel', async (req, res) => {
      try {
        const { requestId } = req.body;

        if (!this.credentialVault) {
          return res.status(500).json({
            success: false,
            error: 'Credential vault not available'
          });
        }

        if (!requestId) {
          return res.status(400).json({
            success: false,
            error: 'requestId is required'
          });
        }

        this.credentialVault.cancelCredentialRequest(requestId);

        this.logger.info('Credential request cancelled', { requestId });

        res.json({
          success: true,
          message: 'Credential request cancelled'
        });

      } catch (error) {
        this.logger.error('Failed to cancel credential request', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ========================================
    // User Prompt Endpoints
    // ========================================

    // Submit user prompt response
    this.app.post('/api/prompt/submit', async (req, res) => {
      try {
        const { requestId, answers } = req.body;

        if (!requestId) {
          return res.status(400).json({
            success: false,
            error: 'requestId is required'
          });
        }

        if (!answers || !Array.isArray(answers)) {
          return res.status(400).json({
            success: false,
            error: 'answers array is required'
          });
        }

        // Get prompt service
        const { getPromptService } = await import('../services/promptService.js');
        const promptService = getPromptService(this.logger);

        const result = promptService.submitResponse(requestId, { answers });

        if (!result.success) {
          return res.status(404).json(result);
        }

        this.logger.info('User prompt response submitted', { requestId, answerCount: answers.length });

        res.json({
          success: true,
          message: 'Response submitted successfully'
        });

      } catch (error) {
        this.logger.error('Failed to submit prompt response', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Cancel a pending user prompt request
    this.app.post('/api/prompt/cancel', async (req, res) => {
      try {
        const { requestId, reason } = req.body;

        if (!requestId) {
          return res.status(400).json({
            success: false,
            error: 'requestId is required'
          });
        }

        // Get prompt service
        const { getPromptService } = await import('../services/promptService.js');
        const promptService = getPromptService(this.logger);

        const result = promptService.cancelRequest(requestId, reason || 'User cancelled');

        if (!result.success) {
          return res.status(404).json(result);
        }

        this.logger.info('User prompt request cancelled', { requestId, reason });

        res.json({
          success: true,
          message: 'Prompt request cancelled'
        });

      } catch (error) {
        this.logger.error('Failed to cancel prompt request', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Extend prompt timeout
    this.app.post('/api/prompts/:requestId/extend', async (req, res) => {
      try {
        const { additionalMs } = req.body;
        const { getPromptService } = await import('../services/promptService.js');
        const promptService = getPromptService(this.logger);
        const result = promptService.extendTimeout(req.params.requestId, additionalMs || 120000);
        if (!result.success) {
          return res.status(404).json(result);
        }
        res.json(result);
      } catch (error) {
        this.logger.error('Failed to extend prompt timeout', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Clear prompt timeout (stop countdown)
    this.app.post('/api/prompts/:requestId/clear-timeout', async (req, res) => {
      try {
        const { getPromptService } = await import('../services/promptService.js');
        const promptService = getPromptService(this.logger);
        const result = promptService.stopTimeout(req.params.requestId);
        if (!result.success) {
          return res.status(404).json(result);
        }
        res.json(result);
      } catch (error) {
        this.logger.error('Failed to clear prompt timeout', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get known site configuration
    this.app.get('/api/credentials/known-sites', async (req, res) => {
      try {
        if (!this.credentialVault) {
          return res.status(500).json({
            success: false,
            error: 'Credential vault not available'
          });
        }

        const knownSites = this.credentialVault.listKnownSites();

        res.json({
          success: true,
          knownSites
        });

      } catch (error) {
        this.logger.error('Failed to get known sites', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // TEST ENDPOINT: Manually trigger credential request modal
    // Usage: POST /api/credentials/test-modal with { siteId: 'linkedin' }
    this.app.post('/api/credentials/test-modal', async (req, res) => {
      try {
        const { siteId = 'test-site', agentId = 'test-agent' } = req.body;

        if (!this.credentialVault) {
          return res.status(500).json({
            success: false,
            error: 'Credential vault not available'
          });
        }

        // Create a test credential request
        const { requestInfo, promise } = this.credentialVault.createCredentialRequest(siteId, {
          agentId,
          loginUrl: `https://${siteId}.com/login`
        });

        // Handle the promise in background (don't block response)
        // This prevents unhandled rejection when user cancels
        promise
          .then(result => {
            this.logger.info('[TEST] Test credential request completed', {
              requestId: requestInfo.requestId,
              hasCredentials: !!result?.credentials
            });
          })
          .catch(err => {
            // Expected when user cancels - not an error
            this.logger.info('[TEST] Test credential request ended', {
              requestId: requestInfo.requestId,
              reason: err.message
            });
          });

        this.logger.info('[TEST] Broadcasting test credential request', {
          requestId: requestInfo.requestId,
          siteId: requestInfo.siteId,
          connectionsCount: this.connections.size
        });

        // Broadcast to all connections (no sessionId = broadcast to all)
        this.broadcastCredentialRequest(requestInfo, null);

        res.json({
          success: true,
          message: 'Credential request broadcast sent',
          requestId: requestInfo.requestId,
          siteId: requestInfo.siteId,
          connectionsCount: this.connections.size
        });

      } catch (error) {
        this.logger.error('Failed to test credential modal', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // File Attachments Management Endpoints

    // Upload file attachment for agent
    this.app.post('/api/agents/:agentId/attachments/upload', async (req, res) => {
      try {
        const { agentId } = req.params;
        const { filePath, mode, fileName } = req.body;

        if (!this.orchestrator?.fileAttachmentService) {
          return res.status(500).json({
            success: false,
            error: 'File attachment service not available'
          });
        }

        const result = await this.orchestrator.fileAttachmentService.uploadFile({
          agentId,
          filePath,
          mode: mode || 'content',
          fileName
        });

        this.logger.info('File attachment uploaded', {
          agentId,
          fileId: result.fileId,
          fileName: result.fileName
        });

        res.json({
          success: true,
          attachment: result
        });

      } catch (error) {
        this.logger.error('Failed to upload file attachment', {
          agentId: req.params.agentId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get all attachments for an agent
    this.app.get('/api/agents/:agentId/attachments', async (req, res) => {
      try {
        const { agentId } = req.params;
        const { mode, active } = req.query;

        if (!this.orchestrator?.fileAttachmentService) {
          return res.status(500).json({
            success: false,
            error: 'File attachment service not available'
          });
        }

        const filters = {};
        if (mode) filters.mode = mode;
        if (active !== undefined) filters.active = active === 'true';

        const attachments = await this.orchestrator.fileAttachmentService.getAttachments(agentId, filters);

        res.json({
          success: true,
          attachments,
          total: attachments.length
        });

      } catch (error) {
        this.logger.error('Failed to get attachments', {
          agentId: req.params.agentId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get single attachment by ID
    this.app.get('/api/attachments/:fileId', async (req, res) => {
      try {
        const { fileId } = req.params;

        if (!this.orchestrator?.fileAttachmentService) {
          return res.status(500).json({
            success: false,
            error: 'File attachment service not available'
          });
        }

        const attachment = await this.orchestrator.fileAttachmentService.getAttachment(fileId);

        if (!attachment) {
          return res.status(404).json({
            success: false,
            error: 'Attachment not found'
          });
        }

        res.json({
          success: true,
          attachment
        });

      } catch (error) {
        this.logger.error('Failed to get attachment', {
          fileId: req.params.fileId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Toggle attachment active status
    this.app.patch('/api/attachments/:fileId/toggle', async (req, res) => {
      try {
        const { fileId } = req.params;

        if (!this.orchestrator?.fileAttachmentService) {
          return res.status(500).json({
            success: false,
            error: 'File attachment service not available'
          });
        }

        const result = await this.orchestrator.fileAttachmentService.toggleActive(fileId);

        this.logger.info('Attachment active status toggled', {
          fileId,
          active: result.active
        });

        res.json({
          success: true,
          attachment: result
        });

      } catch (error) {
        this.logger.error('Failed to toggle attachment', {
          fileId: req.params.fileId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Update attachment metadata
    this.app.patch('/api/attachments/:fileId', async (req, res) => {
      try {
        const { fileId } = req.params;
        const { mode, active } = req.body;

        if (!this.orchestrator?.fileAttachmentService) {
          return res.status(500).json({
            success: false,
            error: 'File attachment service not available'
          });
        }

        const updates = {};
        if (mode !== undefined) updates.mode = mode;
        if (active !== undefined) updates.active = active;

        const result = await this.orchestrator.fileAttachmentService.updateAttachment(fileId, updates);

        this.logger.info('Attachment updated', {
          fileId,
          updates
        });

        res.json({
          success: true,
          attachment: result
        });

      } catch (error) {
        this.logger.error('Failed to update attachment', {
          fileId: req.params.fileId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Delete attachment
    this.app.delete('/api/attachments/:fileId', async (req, res) => {
      try {
        const { fileId } = req.params;
        const { agentId } = req.query;

        if (!agentId) {
          return res.status(400).json({
            success: false,
            error: 'agentId query parameter is required'
          });
        }

        if (!this.orchestrator?.fileAttachmentService) {
          return res.status(500).json({
            success: false,
            error: 'File attachment service not available'
          });
        }

        const result = await this.orchestrator.fileAttachmentService.deleteAttachment(fileId, agentId);

        this.logger.info('Attachment deleted', {
          fileId,
          agentId,
          physicallyDeleted: result.physicallyDeleted
        });

        res.json({
          success: true,
          message: result.physicallyDeleted ? 'Attachment deleted' : 'Reference removed',
          physicallyDeleted: result.physicallyDeleted
        });

      } catch (error) {
        this.logger.error('Failed to delete attachment', {
          fileId: req.params.fileId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Import attachment from another agent
    this.app.post('/api/attachments/:fileId/import', async (req, res) => {
      try {
        const { fileId } = req.params;
        const { targetAgentId } = req.body;

        if (!targetAgentId) {
          return res.status(400).json({
            success: false,
            error: 'targetAgentId is required'
          });
        }

        if (!this.orchestrator?.fileAttachmentService) {
          return res.status(500).json({
            success: false,
            error: 'File attachment service not available'
          });
        }

        const result = await this.orchestrator.fileAttachmentService.importFromAgent(fileId, targetAgentId);

        this.logger.info('Attachment imported', {
          fileId,
          targetAgentId
        });

        res.json({
          success: true,
          attachment: result
        });

      } catch (error) {
        this.logger.error('Failed to import attachment', {
          fileId: req.params.fileId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get attachment preview
    this.app.get('/api/attachments/:fileId/preview', async (req, res) => {
      try {
        const { fileId } = req.params;

        if (!this.orchestrator?.fileAttachmentService) {
          return res.status(500).json({
            success: false,
            error: 'File attachment service not available'
          });
        }

        const preview = await this.orchestrator.fileAttachmentService.getAttachmentPreview(fileId);

        if (!preview) {
          return res.status(404).json({
            success: false,
            error: 'Attachment not found'
          });
        }

        res.json({
          success: true,
          preview
        });

      } catch (error) {
        this.logger.error('Failed to get attachment preview', {
          fileId: req.params.fileId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });


    // Agent mode control endpoints
    this.app.post('/api/agents/:agentId/mode', async (req, res) => {
      try {
        const { agentId } = req.params;
        const { mode, lockMode = false, sessionId: bodySessionId } = req.body;
        
        // Validate mode
        if (!Object.values(AGENT_MODES).includes(mode)) {
          return res.status(400).json({
            success: false,
            error: `Invalid mode. Must be one of: ${Object.values(AGENT_MODES).join(', ')}`
          });
        }
        
        // CRITICAL FIX: Use session ID from body first, then req.sessionID
        const sessionId = bodySessionId || req.sessionID;
        
        if (!sessionId) {
          this.logger.warn('Agent mode update requested without session ID', {
            agentId,
            hasBodySessionId: !!bodySessionId,
            hasReqSessionId: !!req.sessionID
          });
        }
        
        // Update agent mode
        const request = {
          interface: INTERFACE_TYPES.WEB,
          sessionId: sessionId,
          action: 'update_agent',
          payload: {
            agentId,
            updates: {
              mode: mode  // lockMode is no longer used, only CHAT and AGENT modes
            }
          }
        };
        
        const response = await this.orchestrator.processRequest(request);
        
        if (response.success) {
          // Extract agent from response.data (orchestrator wraps result in data property)
          const updatedAgent = response.data;
          
          this.logger.info(`Agent mode updated: ${agentId}`, {
            newMode: mode,
            lockMode,
            finalMode: updatedAgent?.mode
          });
          
          // Broadcast mode change via WebSocket
          this.broadcastToSession(request.sessionId, {
            type: 'agent_mode_changed',
            data: {
              agentId,
              mode: updatedAgent?.mode
            }
          });
          
          res.json({
            success: true,
            agent: updatedAgent,
            message: `Agent mode switched to ${updatedAgent?.mode}`
          });
        } else {
          res.status(400).json({
            success: false,
            error: response.error || 'Failed to update agent mode'
          });
        }
        
      } catch (error) {
        this.logger.error('Failed to update agent mode', {
          agentId: req.params.agentId,
          error: error.message
        });
        
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
    
    // Stop autonomous execution
    this.app.post('/api/agents/:agentId/stop', async (req, res) => {
      try {
        const { agentId } = req.params;
        
        // Get message processor from orchestrator
        const messageProcessor = this.orchestrator.messageProcessor;
        if (!messageProcessor) {
          return res.status(500).json({
            success: false,
            error: 'Message processor not available'
          });
        }
        
        const result = await messageProcessor.stopAutonomousExecution(agentId);
        
        this.logger.info(`Autonomous execution stop requested: ${agentId}`);
        
        // Broadcast stop event via WebSocket with updated agent state
        // TODO: Get session ID from request body or agent context
        const broadcastSessionId = req.sessionID || result.agent?.sessionId;
        if (broadcastSessionId) {
          this.broadcastToSession(broadcastSessionId, {
            type: 'agent_mode_changed',
            data: {
              agentId,
              mode: result.agent?.mode
            }
          });
        }
        
        res.json(result);
        
      } catch (error) {
        this.logger.error('Failed to stop autonomous execution', {
          agentId: req.params.agentId,
          error: error.message
        });
        
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
    
    // Get agent mode status
    this.app.get('/api/agents/:agentId/mode', async (req, res) => {
      try {
        const { agentId } = req.params;

        // Get session ID from query params, headers, or express session
        const sessionId = req.query.sessionId || req.headers['x-session-id'] || req.sessionID;

        const request = {
          interface: INTERFACE_TYPES.WEB,
          sessionId: sessionId,
          action: 'get_agent_status',
          payload: { agentId }
        };

        const response = await this.orchestrator.processRequest(request);

        // Response data is in 'data' property from orchestrator
        const agentData = response.data || response.agent;

        if (response.success && agentData) {
          res.json({
            success: true,
            mode: agentData.mode,
            currentTask: agentData.currentTask,
            iterationCount: agentData.iterationCount,
            taskStartTime: agentData.taskStartTime,
            stopRequested: agentData.stopRequested
          });
        } else {
          res.status(404).json({
            success: false,
            error: 'Agent not found'
          });
        }
        
      } catch (error) {
        this.logger.error('Failed to get agent mode status', {
          agentId: req.params.agentId,
          error: error.message
        });
        
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Clear agent conversation history
    this.app.post('/api/agents/:agentId/clear', async (req, res) => {
      try {
        const { agentId } = req.params;

        const result = await this.orchestrator.agentPool.clearConversation(agentId);

        res.json(result);

      } catch (error) {
        this.logger.error('Failed to clear agent conversation', {
          agentId: req.params.agentId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get agent activity status (scheduler eligibility)
    this.app.get('/api/agents/:agentId/activity', async (req, res) => {
      try {
        const { agentId } = req.params;

        // Import the activity service function
        const { shouldAgentBeActive } = await import('../services/agentActivityService.js');

        // Get the agent from pool
        const agent = await this.orchestrator.agentPool.getAgent(agentId);

        if (!agent) {
          return res.status(404).json({
            success: false,
            error: 'Agent not found'
          });
        }

        // Get activity status using the same logic as the scheduler
        // isActive = true means agent has pending work and will be processed
        const activityResult = shouldAgentBeActive(agent);

        res.json({
          success: true,
          agentId,
          // Primary field: does the agent have pending work for the scheduler?
          isActive: activityResult.active,
          // Why is/isn't it active? (for UI display)
          reason: activityResult.reason,
          details: activityResult.details
        });

      } catch (error) {
        this.logger.error('Failed to get agent activity status', {
          agentId: req.params.agentId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // ============================================
    // Scheduler Visualizer — JSON state endpoint + HTML viewer
    // ============================================

    // Mount scheduler visualizer routes via the extracted helper. The thunk
    // form for getScheduler ensures we resolve the scheduler at request time
    // (it may be attached after route registration during orchestrator boot).
    registerSchedulerRoutes(this.app, {
      getScheduler: () => this.orchestrator?.agentPool?.scheduler,
      logger: this.logger,
      html: SCHEDULER_VIEWER_HTML,
    });

    // Agent context + memory routes (Memory tab in AgentEditModal).
    // Same thunk pattern: agentPool may be attached after route registration.
    registerAgentContextRoutes(this.app, {
      getAgentPool: () => this.orchestrator?.agentPool,
      getMemoryService,
      logger: this.logger,
    });

    // ============================================
    // Artifacts API Endpoint
    // ============================================

    // DEBUG: Inject a test artifact into an agent (remove after testing)
    this.app.post('/api/agents/:agentId/artifacts/test', async (req, res) => {
      try {
        const { agentId } = req.params;
        const agent = await this.orchestrator.agentPool.getAgent(agentId);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        if (!agent.artifacts) agent.artifacts = {};
        const testPath = (agent.directoryAccess?.workingDirectory || '/test') + '/test-artifact.js';
        const displayPath = 'test-artifact.js';

        agent.artifacts[testPath] = {
          displayPath,
          versions: [{
            id: `v-${Date.now()}`,
            content: '// Test artifact\nconsole.log("Hello from artifacts!");',
            timestamp: new Date().toISOString(),
            action: 'write',
            size: 50,
            fullPath: testPath
          }]
        };

        // Broadcast via WebSocket
        const sessionIds = this.orchestrator.webSocketManager?.getSessionsForAgent?.(agentId) || [];
        for (const sid of sessionIds) {
          this.orchestrator.webSocketManager.broadcastToSession(sid, {
            type: 'artifacts_updated',
            data: { agentId, artifacts: agent.artifacts, workingDirectory: agent.directoryAccess?.workingDirectory || '' }
          });
        }

        res.json({ success: true, artifactCount: Object.keys(agent.artifacts).length });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get artifacts (files written by the agent) with version history
    this.app.get('/api/agents/:agentId/artifacts', async (req, res) => {
      try {
        const { agentId } = req.params;
        const agent = await this.orchestrator.agentPool.getAgent(agentId);

        if (!agent) {
          return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        // Return the artifacts map (or empty if none yet)
        // { [filePath]: { displayPath, versions: [{ id, content, timestamp, action, size }] } }
        res.json({
          success: true,
          agentId,
          artifacts: agent.artifacts || {},
          workingDirectory: agent.directoryAccess?.workingDirectory || ''
        });

      } catch (error) {
        this.logger.error('Failed to get agent artifacts', {
          agentId: req.params.agentId,
          error: error.message
        });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ============================================
    // Terminal Tasks API Endpoints
    // ============================================

    // Get running terminal tasks for an agent
    this.app.get('/api/agents/:agentId/terminal-tasks', async (req, res) => {
      try {
        const { agentId } = req.params;
        const { includeRecent } = req.query;

        // Get terminal tool from tools registry (use direct reference or fallback to orchestrator)
        const terminalTool = this.toolsRegistry?.getTool('terminal') || this.orchestrator?.toolsRegistry?.getTool('terminal');

        if (!terminalTool) {
          return res.status(503).json({
            success: false,
            error: 'Terminal tool not available - toolsRegistry not initialized'
          });
        }

        const summary = terminalTool.getTasksSummary(agentId);

        // When includeRecent is true, return ALL tasks (running + completed + failed)
        // Otherwise just return running tasks
        const tasks = includeRecent === 'true'
          ? terminalTool.getRecentTasksForUI(agentId)
          : terminalTool.getRunningTasksForUI(agentId);

        const response = {
          success: true,
          agentId,
          tasks,
          summary,
          timestamp: new Date().toISOString()
        };

        res.json(response);
      } catch (error) {
        this.logger.error('Failed to get terminal tasks', {
          agentId: req.params.agentId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get output for a specific terminal task
    this.app.get('/api/agents/:agentId/terminal-tasks/:commandId/output', async (req, res) => {
      try {
        const { agentId, commandId } = req.params;
        const { tailLines, includeStderr } = req.query;

        const terminalTool = this.toolsRegistry?.getTool('terminal') || this.orchestrator?.toolsRegistry?.getTool('terminal');

        if (!terminalTool) {
          return res.status(503).json({
            success: false,
            error: 'Terminal tool not available - toolsRegistry not initialized'
          });
        }

        const output = terminalTool.getTaskOutput(commandId, agentId, {
          tailLines: tailLines ? parseInt(tailLines, 10) : 100,
          includeStderr: includeStderr !== 'false'
        });

        if (!output.success) {
          return res.status(404).json(output);
        }

        res.json(output);
      } catch (error) {
        this.logger.error('Failed to get terminal task output', {
          agentId: req.params.agentId,
          commandId: req.params.commandId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get all running terminal tasks across all agents (for global view)
    this.app.get('/api/terminal-tasks', async (req, res) => {
      try {
        const terminalTool = this.toolsRegistry?.getTool('terminal') || this.orchestrator?.toolsRegistry?.getTool('terminal');

        if (!terminalTool) {
          return res.status(503).json({
            success: false,
            error: 'Terminal tool not available'
          });
        }

        const runningTasks = terminalTool.getRunningTasksForUI(null); // null = all agents
        const summary = terminalTool.getTasksSummary(null);

        res.json({
          success: true,
          tasks: runningTasks,
          summary,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Failed to get all terminal tasks', {
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Skills Library Endpoints

    const _getSkillsService = async () => {
      const { getSkillsService } = await import('../services/skillsService.js');
      const svc = getSkillsService(this.logger);
      await svc.initialize();
      return svc;
    };

    // List all skills
    this.app.get('/api/skills', async (req, res) => {
      try {
        const svc = await _getSkillsService();
        const skills = await svc.listSkills();
        res.json({ success: true, skills });
      } catch (error) {
        this.logger.error('Failed to list skills', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Describe a skill (metadata, no content)
    this.app.get('/api/skills/:name', async (req, res) => {
      try {
        const svc = await _getSkillsService();
        const skill = await svc.describeSkill(req.params.name);
        res.json({ success: true, skill });
      } catch (error) {
        const status = error.message.includes('not found') ? 404 : 500;
        res.status(status).json({ success: false, error: error.message });
      }
    });

    // Read full skill content
    this.app.get('/api/skills/:name/content', async (req, res) => {
      try {
        const svc = await _getSkillsService();
        const skill = await svc.readSkill(req.params.name);
        res.json({ success: true, skill });
      } catch (error) {
        const status = error.message.includes('not found') ? 404 : 500;
        res.status(status).json({ success: false, error: error.message });
      }
    });

    // Create a skill
    this.app.post('/api/skills', async (req, res) => {
      try {
        const { name, content, files, description } = req.body;
        if (!name || !content) {
          return res.status(400).json({ success: false, error: 'name and content are required' });
        }
        const svc = await _getSkillsService();
        const entry = await svc.createSkill(name, content, files || [], description);
        res.json({ success: true, skill: entry });
      } catch (error) {
        const status = error.message.includes('already exists') ? 409 : 500;
        res.status(status).json({ success: false, error: error.message });
      }
    });

    // Update a skill
    this.app.put('/api/skills/:name', async (req, res) => {
      try {
        const { content, files, description } = req.body;
        const svc = await _getSkillsService();
        const entry = await svc.updateSkill(req.params.name, content || null, files || [], description);
        res.json({ success: true, skill: entry });
      } catch (error) {
        const status = error.message.includes('not found') ? 404 : 500;
        res.status(status).json({ success: false, error: error.message });
      }
    });

    // Delete a skill
    this.app.delete('/api/skills/:name', async (req, res) => {
      try {
        const svc = await _getSkillsService();
        await svc.deleteSkill(req.params.name);
        res.json({ success: true });
      } catch (error) {
        const status = error.message.includes('not found') ? 404 : 500;
        res.status(status).json({ success: false, error: error.message });
      }
    });

    // Preview a file/directory before importing as a skill
    this.app.post('/api/skills/preview', async (req, res) => {
      try {
        const { source } = req.body;
        if (!source) {
          return res.status(400).json({ success: false, error: 'source path is required' });
        }
        const fs = (await import('fs')).promises;
        const path = (await import('path')).default;
        const resolvedSource = path.resolve(source);
        let stat;
        try { stat = await fs.stat(resolvedSource); } catch {
          return res.status(404).json({ success: false, error: 'Path not found' });
        }

        const preview = { source: resolvedSource, isDirectory: stat.isDirectory(), files: [], content: null };

        if (stat.isDirectory()) {
          // List files in directory
          const entries = await fs.readdir(resolvedSource, { withFileTypes: true });
          preview.files = entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }));
          // Read skill.md if it exists
          const skillMdPath = path.join(resolvedSource, 'skill.md');
          try {
            const content = await fs.readFile(skillMdPath, 'utf8');
            preview.content = content.length > 5000 ? content.slice(0, 5000) + '\n\n... (truncated)' : content;
            preview.hasSkillMd = true;
          } catch {
            preview.hasSkillMd = false;
          }
        } else {
          // Single file
          preview.files = [{ name: path.basename(resolvedSource), isDirectory: false }];
          const content = await fs.readFile(resolvedSource, 'utf8');
          preview.content = content.length > 5000 ? content.slice(0, 5000) + '\n\n... (truncated)' : content;
          preview.hasSkillMd = true; // Single file becomes skill.md
        }

        preview.derivedName = path.basename(resolvedSource, path.extname(resolvedSource))
          .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        // Extract metadata from content (name, description)
        preview.extractedMeta = { name: null, description: null };
        if (preview.content) {
          const lines = preview.content.split('\n');
          // Try YAML frontmatter: ---\nname: ...\ndescription: ...\n---
          if (lines[0]?.trim() === '---') {
            const endIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
            if (endIdx > 0) {
              for (let i = 1; i < endIdx; i++) {
                const match = lines[i].match(/^(\w+)\s*:\s*(.+)/);
                if (match) {
                  const key = match[1].toLowerCase();
                  if (key === 'name') preview.extractedMeta.name = match[2].trim().replace(/^["']|["']$/g, '');
                  if (key === 'description') preview.extractedMeta.description = match[2].trim().replace(/^["']|["']$/g, '');
                }
              }
            }
          }
          // Fallback: scan for name:/description: anywhere in first 20 lines
          if (!preview.extractedMeta.name || !preview.extractedMeta.description) {
            for (let i = 0; i < Math.min(lines.length, 20); i++) {
              const line = lines[i].trim();
              if (!preview.extractedMeta.name) {
                const nameMatch = line.match(/^name\s*:\s*(.+)/i);
                if (nameMatch) preview.extractedMeta.name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
              }
              if (!preview.extractedMeta.description) {
                const descMatch = line.match(/^description\s*:\s*(.+)/i);
                if (descMatch) preview.extractedMeta.description = descMatch[1].trim().replace(/^["']|["']$/g, '');
              }
            }
          }
          // Fallback: use # heading as name, first content line as description
          if (!preview.extractedMeta.name) {
            const heading = lines.find(l => l.trim().startsWith('# '));
            if (heading) {
              preview.extractedMeta.name = heading.trim().replace(/^#+\s*/, '')
                .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            }
          }
          if (!preview.extractedMeta.description) {
            const descLine = lines.find(l => {
              const t = l.trim();
              return t && !t.startsWith('#') && !t.startsWith('---') && !t.match(/^\w+\s*:/);
            });
            if (descLine) preview.extractedMeta.description = descLine.trim();
          }
        }

        res.json({ success: true, preview });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Import a skill from disk
    this.app.post('/api/skills/import', async (req, res) => {
      try {
        const { source, name, description } = req.body;
        if (!source) {
          return res.status(400).json({ success: false, error: 'source path is required' });
        }
        const svc = await _getSkillsService();
        const entry = await svc.importSkill(source, name || null, description || null);
        res.json({ success: true, skill: entry });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Telegram Bot Endpoints

    this.app.get('/api/telegram/status', (req, res) => {
      if (!this.telegramService) {
        return res.json({ success: true, status: 'unavailable', connected: false });
      }
      res.json({ success: true, ...this.telegramService.getStatus() });
    });

    this.app.post('/api/telegram/connect', async (req, res) => {
      try {
        if (!this.telegramService) {
          return res.status(400).json({ success: false, error: 'Telegram service not available' });
        }
        const { botToken } = req.body;
        if (!botToken) {
          return res.status(400).json({ success: false, error: 'botToken is required' });
        }
        const result = await this.telegramService.connect(botToken);
        res.json({ success: true, ...result });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/telegram/disconnect', async (req, res) => {
      try {
        if (!this.telegramService) {
          return res.status(400).json({ success: false, error: 'Telegram service not available' });
        }
        await this.telegramService.disconnect();
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/telegram/test', async (req, res) => {
      try {
        if (!this.telegramService) {
          return res.status(400).json({ success: false, error: 'Telegram service not available' });
        }
        await this.telegramService.sendTestMessage();
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/telegram/settings', async (req, res) => {
      if (!this.telegramService) {
        return res.json({ success: true, settings: {} });
      }
      res.json({ success: true, settings: this.telegramService.config });
    });

    this.app.post('/api/telegram/settings', async (req, res) => {
      try {
        if (!this.telegramService) {
          return res.status(400).json({ success: false, error: 'Telegram service not available' });
        }
        const { watchEnabled } = req.body;
        if (watchEnabled !== undefined) {
          this.telegramService.watchEnabled = !!watchEnabled;
        }
        await this.telegramService._saveConfig();
        res.json({ success: true, settings: this.telegramService.config });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Discord Bot Endpoints

    this.app.get('/api/discord/status', (req, res) => {
      if (!this.discordService) {
        return res.json({ success: true, status: 'unavailable', connected: false });
      }
      res.json({ success: true, ...this.discordService.getStatus() });
    });

    this.app.post('/api/discord/connect', async (req, res) => {
      try {
        if (!this.discordService) {
          return res.status(400).json({ success: false, error: 'Discord service not available' });
        }
        const { botToken } = req.body;
        if (!botToken) {
          return res.status(400).json({ success: false, error: 'botToken is required' });
        }
        const result = await this.discordService.connect(botToken);
        res.json({ success: true, ...result });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/discord/disconnect', async (req, res) => {
      try {
        if (!this.discordService) {
          return res.status(400).json({ success: false, error: 'Discord service not available' });
        }
        await this.discordService.disconnect();
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/discord/channels', (req, res) => {
      if (!this.discordService) {
        return res.json({ success: true, channels: [] });
      }
      res.json({ success: true, channels: this.discordService.getAvailableChannels() });
    });

    this.app.get('/api/discord/mappings', (req, res) => {
      if (!this.discordService) {
        return res.json({ success: true, mappings: {}, knownGuilds: {}, knownChannels: {} });
      }
      res.json({ success: true, ...this.discordService.getChannelMappings() });
    });

    this.app.post('/api/discord/assign', async (req, res) => {
      try {
        if (!this.discordService) {
          return res.status(400).json({ success: false, error: 'Discord service not available' });
        }
        const { channelKey, agentId } = req.body;
        if (!channelKey || !agentId) {
          return res.status(400).json({ success: false, error: 'channelKey and agentId are required' });
        }
        await this.discordService.assignAgentToChannel(channelKey, agentId);
        res.json({ success: true, ...this.discordService.getChannelMappings() });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/discord/unassign', async (req, res) => {
      try {
        if (!this.discordService) {
          return res.status(400).json({ success: false, error: 'Discord service not available' });
        }
        const { channelKey, agentId } = req.body;
        if (!channelKey || !agentId) {
          return res.status(400).json({ success: false, error: 'channelKey and agentId are required' });
        }
        await this.discordService.removeAgentFromChannel(channelKey, agentId);
        res.json({ success: true, ...this.discordService.getChannelMappings() });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Agent Import/Resume Endpoints

    // Get all available agents (active + archived)
    this.app.get('/api/agents/available', async (req, res) => {
      try {
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();
        const agents = await this.orchestrator.stateManager.getAllAvailableAgents(
          projectDir,
          this.orchestrator.agentPool
        );

        res.json({
          success: true,
          agents: agents,
          total: agents.length,
          active: agents.filter(a => a.isLoaded).length,
          archived: agents.filter(a => !a.isLoaded).length
        });
      } catch (error) {
        this.logger.error('Failed to get available agents', {
          error: error.message,
          stack: error.stack
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Delete an archived agent's state files from disk
    // TODO: Refactor — this endpoint and agentPool.deleteAgent() both delete state files
    // independently. Extract shared file cleanup logic into stateManager.deleteAgentFiles(agentId)
    // so both paths use the same method and stay in sync if file structure changes.
    this.app.delete('/api/agents/archived/:agentId', async (req, res) => {
      try {
        const { agentId } = req.params;
        if (!agentId) {
          return res.status(400).json({ success: false, error: 'agentId is required' });
        }

        // Check if agent is currently loaded — refuse to delete active agents
        const activeAgent = await this.orchestrator.agentPool.getAgent(agentId);
        if (activeAgent) {
          return res.status(400).json({ success: false, error: 'Cannot delete an active agent. Unload it first.' });
        }

        const agentsDir = this.orchestrator.stateManager.getAgentsDir();
        const deletedFiles = [];

        // Delete state file, conversations file, and memory file
        for (const suffix of ['-state.json', '-conversations.json', '-memory.json']) {
          const filePath = path.join(agentsDir, `${agentId}${suffix}`);
          try {
            await fs.unlink(filePath);
            deletedFiles.push(filePath);
          } catch (err) {
            if (err.code !== 'ENOENT') throw err; // ignore missing files
          }
        }

        // Remove from agent index
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();
        try {
          const agentIndex = await this.orchestrator.stateManager.loadAgentIndex(projectDir);
          if (agentIndex[agentId]) {
            delete agentIndex[agentId];
            await this.orchestrator.stateManager.updateAgentIndex(projectDir, agentIndex);
          }
        } catch {}

        this.logger.info('Archived agent deleted from disk', { agentId, deletedFiles });
        res.json({ success: true, agentId, deletedFiles });
      } catch (error) {
        this.logger.error('Failed to delete archived agent', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get agent metadata for preview
    this.app.get('/api/agents/:agentId/metadata', async (req, res) => {
      try {
        const { agentId } = req.params;
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();

        const metadata = await this.orchestrator.stateManager.getAgentMetadata(
          agentId,
          projectDir
        );

        res.json({
          success: true,
          metadata
        });
      } catch (error) {
        this.logger.error('Failed to get agent metadata', {
          agentId: req.params.agentId,
          error: error.message
        });

        res.status(404).json({
          success: false,
          error: error.message
        });
      }
    });

    // Export agent conversation (persistent state file)
    this.app.get('/api/agents/:agentId/export', async (req, res) => {
      try {
        const { agentId } = req.params;
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();
        const stateDir = this.orchestrator.stateManager.getStateDir(projectDir);
        const conversationsFile = path.join(stateDir, 'agents', `agent-${agentId}-conversations.json`);
        const stateFile = path.join(stateDir, 'agents', `agent-${agentId}-state.json`);

        // Load both files
        const fs = await import('fs/promises');
        let conversations = null;
        let agentState = null;

        try {
          const conversationsData = await fs.readFile(conversationsFile, 'utf8');
          conversations = JSON.parse(conversationsData);
        } catch (error) {
          // Conversations file may not exist for new agents
        }

        try {
          const stateData = await fs.readFile(stateFile, 'utf8');
          agentState = JSON.parse(stateData);
        } catch (error) {
          // State file should exist
        }

        if (!conversations && !agentState) {
          return res.status(404).json({
            success: false,
            error: 'No conversation data found for this agent'
          });
        }

        res.json({
          success: true,
          data: {
            agentId,
            exportedAt: new Date().toISOString(),
            state: agentState,
            conversations
          }
        });
      } catch (error) {
        this.logger.error('Failed to export agent conversation', {
          agentId: req.params.agentId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Import archived agent
    this.app.post('/api/agents/import', async (req, res) => {
      try {
        const { agentId } = req.body;

        if (!agentId) {
          return res.status(400).json({
            success: false,
            error: 'agentId is required in request body'
          });
        }

        const projectDir = this.orchestrator.config.project?.directory || process.cwd();

        // Import the agent
        const agent = await this.orchestrator.stateManager.importArchivedAgent(
          agentId,
          projectDir,
          this.orchestrator.agentPool
        );

        // Broadcast agent added event via WebSocket
        if (this.wsManager) {
          this.wsManager.broadcast({
            type: 'agent-imported',
            agent: {
              id: agent.id,
              name: agent.name,
              status: agent.status,
              capabilities: agent.capabilities,
              model: agent.currentModel || agent.preferredModel
            }
          });
        }

        // If the resilient state loader recovered from missing/empty/
        // corrupt files, broadcast each recovery as a UI toast so the
        // operator sees what was salvaged. The reports were attached to
        // the restored agent in stateManager.restoreAgent.
        const recoveries = Array.isArray(agent._restoreRecoveries) ? agent._restoreRecoveries : [];
        if (recoveries.length > 0 && this.wsManager) {
          for (const r of recoveries) {
            this.wsManager.broadcast({
              type: 'state-file-recovery',
              level: r.kind === 'unrepairable' ? 'error'
                   : r.kind === 'partial'      ? 'warning'
                   : 'info',
              agentId: agent.id,
              agentName: agent.name,
              recovery: {
                kind: r.kind,
                label: r.label,
                message: r.message,
                archivePath: r.archivePath || null,
              },
            });
          }
        }
        // Strip the recovery payload before logging/serializing back to
        // the client — it's an internal hint, not part of the agent shape.
        delete agent._restoreRecoveries;

        this.logger.info('Agent imported successfully', {
          agentId: agent.id,
          name: agent.name,
          recoveryCount: recoveries.length,
        });

        res.json({
          success: true,
          agent: {
            id: agent.id,
            name: agent.name,
            status: agent.status,
            model: agent.currentModel || agent.preferredModel,
            capabilities: agent.capabilities,
            lastActivity: agent.lastActivity
          },
          message: `Agent ${agent.name} imported successfully`,
          // Surfaced to the importer too so a non-WS client (curl) sees
          // them in the response body.
          ...(recoveries.length > 0 ? { recoveries: recoveries.map(r => ({
            kind: r.kind, label: r.label, message: r.message,
          })) } : {}),
        });
      } catch (error) {
        this.logger.error('Failed to import agent', {
          agentId: req.body.agentId,
          error: error.message,
          stack: error.stack
        });

        // Determine appropriate status code
        const statusCode = error.message.includes('already active') ? 409 :
                          error.message.includes('not found') ? 404 :
                          error.message.includes('Invalid') ? 400 : 500;

        res.status(statusCode).json({
          success: false,
          error: error.message
        });
      }
    });

    // Duplicate/Clone an agent
    this.app.post('/api/agents/:agentId/duplicate', async (req, res) => {
      const { agentId } = req.params;
      this.logger.info('Duplicate agent request received', { agentId, body: req.body });

      try {
        const { newName, keepConversation = false, sessionId } = req.body || {};

        // Get the source agent
        const sourceAgent = await this.orchestrator.agentPool.getAgent(agentId);
        if (!sourceAgent) {
          this.logger.warn('Source agent not found for duplication', { agentId });
          return res.status(404).json({
            success: false,
            error: `Agent ${agentId} not found`
          });
        }

        this.logger.info('Source agent found, creating duplicate', {
          sourceId: sourceAgent.id,
          sourceName: sourceAgent.name
        });

        // Generate a clone name if not provided
        const cloneName = newName || `${sourceAgent.name} (Clone)`;

        // Create the duplicated agent with same config
        const duplicatedAgent = await this.orchestrator.createAgent(
          sourceAgent.originalSystemPrompt || sourceAgent.systemPrompt || 'You are a helpful assistant.',
          sourceAgent.preferredModel || sourceAgent.currentModel,
          {
            name: cloneName,
            capabilities: [...(sourceAgent.capabilities || [])],
            directoryAccess: sourceAgent.directoryAccess
              ? JSON.parse(JSON.stringify(sourceAgent.directoryAccess))
              : null,
            dynamicModelRouting: sourceAgent.dynamicModelRouting || false,
            routingStrategy: sourceAgent.routingStrategy || '',
            skills: [...(sourceAgent.skills || [])],
            sessionId: sessionId
          }
        );

        if (!duplicatedAgent) {
          throw new Error('createAgent returned null or undefined');
        }

        this.logger.info('Duplicated agent created', {
          newId: duplicatedAgent.id,
          newName: duplicatedAgent.name
        });

        // If keeping conversation, copy the messages
        if (keepConversation && sourceAgent.conversations?.full?.messages?.length > 0) {
          duplicatedAgent.conversations.full.messages = JSON.parse(
            JSON.stringify(sourceAgent.conversations.full.messages)
          );
          duplicatedAgent.conversations.full.lastUpdated = new Date().toISOString();

          // Save the updated state
          const projectDir = this.orchestrator.config.project?.directory || process.cwd();
          await this.orchestrator.stateManager.saveAgentState(duplicatedAgent, projectDir);
        }

        // Broadcast agent created event via WebSocket
        if (this.wsManager) {
          this.wsManager.broadcast({
            type: 'agent-created',
            agent: {
              id: duplicatedAgent.id,
              name: duplicatedAgent.name,
              status: duplicatedAgent.status,
              capabilities: duplicatedAgent.capabilities,
              model: duplicatedAgent.currentModel || duplicatedAgent.preferredModel
            }
          });
        }

        this.logger.info('Agent duplicated successfully', {
          sourceAgentId: agentId,
          newAgentId: duplicatedAgent.id,
          newName: duplicatedAgent.name,
          keepConversation
        });

        return res.json({
          success: true,
          agent: {
            id: duplicatedAgent.id,
            name: duplicatedAgent.name,
            status: duplicatedAgent.status,
            model: duplicatedAgent.currentModel || duplicatedAgent.preferredModel,
            capabilities: duplicatedAgent.capabilities,
            lastActivity: duplicatedAgent.lastActivity
          },
          message: `Pilot cloned as "${duplicatedAgent.name}"`
        });
      } catch (error) {
        this.logger.error('Failed to duplicate agent', {
          agentId,
          error: error.message,
          stack: error.stack
        });

        return res.status(500).json({
          success: false,
          error: error.message || 'Unknown error during duplication'
        });
      }
    });

    // ==================== TEAM ROUTES ====================

    // Get all teams
    this.app.get('/api/teams', async (req, res) => {
      try {
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();
        const teams = await this.orchestrator.stateManager.getAllTeams(projectDir);

        res.json({
          success: true,
          data: teams
        });
      } catch (error) {
        this.logger.error('Failed to get teams', { error: error.message });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Create a new team
    this.app.post('/api/teams', async (req, res) => {
      try {
        const { name, description, color } = req.body;

        if (!name || !name.trim()) {
          return res.status(400).json({
            success: false,
            error: 'Team name is required'
          });
        }

        const projectDir = this.orchestrator.config.project?.directory || process.cwd();
        const team = await this.orchestrator.stateManager.createTeam(
          { name: name.trim(), description, color },
          projectDir
        );

        // Broadcast team created event
        if (this.wsManager) {
          this.wsManager.broadcast({
            type: 'team-created',
            team
          });
        }

        res.json({
          success: true,
          data: team
        });
      } catch (error) {
        this.logger.error('Failed to create team', { error: error.message });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get a single team
    this.app.get('/api/teams/:teamId', async (req, res) => {
      try {
        const { teamId } = req.params;
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();
        const team = await this.orchestrator.stateManager.getTeam(teamId, projectDir);

        if (!team) {
          return res.status(404).json({
            success: false,
            error: `Team ${teamId} not found`
          });
        }

        res.json({
          success: true,
          data: team
        });
      } catch (error) {
        this.logger.error('Failed to get team', { error: error.message });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Update a team
    this.app.put('/api/teams/:teamId', async (req, res) => {
      try {
        const { teamId } = req.params;
        const updates = req.body;
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();

        const team = await this.orchestrator.stateManager.updateTeam(teamId, updates, projectDir);

        // Broadcast team updated event
        if (this.wsManager) {
          this.wsManager.broadcast({
            type: 'team-updated',
            team
          });
        }

        res.json({
          success: true,
          data: team
        });
      } catch (error) {
        this.logger.error('Failed to update team', { error: error.message });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Delete a team
    this.app.delete('/api/teams/:teamId', async (req, res) => {
      try {
        const { teamId } = req.params;
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();

        await this.orchestrator.stateManager.deleteTeam(teamId, projectDir);

        // Broadcast team deleted event
        if (this.wsManager) {
          this.wsManager.broadcast({
            type: 'team-deleted',
            teamId
          });
        }

        res.json({
          success: true,
          message: `Team ${teamId} deleted`
        });
      } catch (error) {
        this.logger.error('Failed to delete team', { error: error.message });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Load all team members
    this.app.post('/api/teams/:teamId/load', async (req, res) => {
      try {
        const { teamId } = req.params;
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();

        const team = await this.orchestrator.stateManager.getTeam(teamId, projectDir);
        if (!team) {
          return res.status(404).json({
            success: false,
            error: `Team ${teamId} not found`
          });
        }

        const loadResults = [];
        for (const agentId of team.memberAgentIds) {
          // Check if agent is already loaded
          const existing = await this.orchestrator.agentPool.getAgent(agentId);
          if (existing) {
            loadResults.push({
              agentId,
              status: 'already_loaded',
              agent: {
                id: existing.id,
                name: existing.name,
                status: existing.status,
                model: existing.currentModel
              }
            });
          } else {
            // Try to import the agent
            try {
              const agent = await this.orchestrator.stateManager.importArchivedAgent(
                agentId,
                projectDir,
                this.orchestrator.agentPool
              );
              loadResults.push({
                agentId,
                status: 'loaded',
                agent: {
                  id: agent.id,
                  name: agent.name,
                  status: agent.status,
                  model: agent.currentModel
                }
              });

              // Broadcast agent loaded event
              if (this.wsManager) {
                this.wsManager.broadcast({
                  type: 'agent-loaded',
                  agent: {
                    id: agent.id,
                    name: agent.name,
                    status: agent.status,
                    model: agent.currentModel,
                    capabilities: agent.capabilities
                  }
                });
              }
            } catch (error) {
              loadResults.push({
                agentId,
                status: 'error',
                error: error.message
              });
            }
          }
        }

        res.json({
          success: true,
          team,
          loadResults
        });
      } catch (error) {
        this.logger.error('Failed to load team', { error: error.message });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Add agent to team
    this.app.post('/api/teams/:teamId/members', async (req, res) => {
      try {
        const { teamId } = req.params;
        const { agentId } = req.body;

        if (!agentId) {
          return res.status(400).json({
            success: false,
            error: 'agentId is required'
          });
        }

        const projectDir = this.orchestrator.config.project?.directory || process.cwd();
        const team = await this.orchestrator.stateManager.addAgentToTeam(teamId, agentId, projectDir);

        // Broadcast team updated event
        if (this.wsManager) {
          this.wsManager.broadcast({
            type: 'team-member-added',
            teamId,
            agentId,
            team
          });
        }

        res.json({
          success: true,
          data: team
        });
      } catch (error) {
        this.logger.error('Failed to add agent to team', { error: error.message });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Remove agent from team
    this.app.delete('/api/teams/:teamId/members/:agentId', async (req, res) => {
      try {
        const { teamId, agentId } = req.params;
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();

        const team = await this.orchestrator.stateManager.removeAgentFromTeam(teamId, agentId, projectDir);

        // Broadcast team updated event
        if (this.wsManager) {
          this.wsManager.broadcast({
            type: 'team-member-removed',
            teamId,
            agentId,
            team
          });
        }

        res.json({
          success: true,
          data: team
        });
      } catch (error) {
        this.logger.error('Failed to remove agent from team', { error: error.message });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // ==================== FLOWS ROUTES ====================

    // List all flows
    this.app.get('/api/flows', async (req, res) => {
      try {
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();
        const flows = await this.orchestrator.stateManager.getAllFlows(projectDir);

        res.json({
          success: true,
          data: flows
        });
      } catch (error) {
        this.logger.error('Failed to list flows', { error: error.message });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Create a new flow
    this.app.post('/api/flows', async (req, res) => {
      try {
        const { name, description, nodes, edges, variables } = req.body;

        // Schema gate: reject malformed flows BEFORE they reach persistence
        // (avoids "saved but unexecutable" states). 400 with structured
        // errors so the editor can highlight specific problems inline.
        const validation = validateFlowDefinition({ name, nodes: nodes || [], edges: edges || [], variables });
        if (!validation.ok) {
          return res.status(400).json({
            success: false,
            error: 'Flow definition is invalid',
            details: validation.errors
          });
        }

        const projectDir = this.orchestrator.config.project?.directory || process.cwd();
        const flow = await this.orchestrator.stateManager.createFlow({
          name,
          description,
          nodes,
          edges,
          variables
        }, projectDir);

        // Phase 6: record initial version (v1). Best-effort — the flow
        // is already saved; failing to version is a non-fatal warning.
        // Stamp the version number back onto the flow record so runs
        // can record which definition produced their output.
        if (this.flowVersionStore && flow?.id) {
          try {
            const v = await this.flowVersionStore.recordVersion(flow.id, flow);
            const projectDir = this.orchestrator.config.project?.directory || process.cwd();
            await this.orchestrator.stateManager.updateFlow(flow.id, { version: v.version }, projectDir);
            flow.version = v.version;
          }
          catch (e) { this.logger.warn('flow version record failed', { error: e.message }); }
        }

        // Broadcast flow created event
        if (this.wsManager) {
          this.wsManager.broadcast({
            type: 'flow-created',
            flow
          });
        }

        res.json({
          success: true,
          data: flow
        });
      } catch (error) {
        this.logger.error('Failed to create flow', { error: error.message });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get a specific flow
    this.app.get('/api/flows/:flowId', async (req, res) => {
      try {
        const { flowId } = req.params;
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();
        const flow = await this.orchestrator.stateManager.getFlow(flowId, projectDir);

        if (!flow) {
          return res.status(404).json({
            success: false,
            error: `Flow ${flowId} not found`
          });
        }

        res.json({
          success: true,
          data: flow
        });
      } catch (error) {
        this.logger.error('Failed to get flow', { error: error.message, flowId: req.params.flowId });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Update a flow
    this.app.put('/api/flows/:flowId', async (req, res) => {
      try {
        const { flowId } = req.params;
        const { name, description, nodes, edges, variables } = req.body;
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();

        // PUT supports partial updates (e.g. just `{ nodes, edges }`
        // when the user clicks Save in the editor). Load the existing
        // flow and merge the patch before validating, so the schema
        // gate sees the full resulting record — not just the diff.
        const existing = await this.orchestrator.stateManager.getFlow(flowId, projectDir);
        if (!existing) {
          return res.status(404).json({ success: false, error: `Flow ${flowId} not found` });
        }
        const merged = {
          ...existing,
          ...(name        !== undefined ? { name }        : {}),
          ...(description !== undefined ? { description } : {}),
          ...(nodes       !== undefined ? { nodes }       : {}),
          ...(edges       !== undefined ? { edges }       : {}),
          ...(variables   !== undefined ? { variables }   : {}),
        };

        // Same schema gate as POST. Editing a flow into an invalid state
        // is just as bad as creating one — both should be caught here, not
        // 90s into a future execution.
        const validation = validateFlowDefinition(merged);
        if (!validation.ok) {
          return res.status(400).json({
            success: false,
            error: 'Flow definition is invalid',
            details: validation.errors
          });
        }

        const flow = await this.orchestrator.stateManager.updateFlow(flowId, {
          name,
          description,
          nodes,
          edges,
          variables
        }, projectDir);

        // Phase 6: record a new version snapshot on every PUT and
        // stamp the new version number onto the live record.
        if (this.flowVersionStore && flow?.id) {
          try {
            const v = await this.flowVersionStore.recordVersion(flow.id, flow);
            await this.orchestrator.stateManager.updateFlow(flow.id, { version: v.version }, projectDir);
            flow.version = v.version;
          }
          catch (e) { this.logger.warn('flow version record failed', { error: e.message }); }
        }

        // Broadcast flow updated event
        if (this.wsManager) {
          this.wsManager.broadcast({
            type: 'flow-updated',
            flow
          });
        }

        res.json({
          success: true,
          data: flow
        });
      } catch (error) {
        this.logger.error('Failed to update flow', { error: error.message, flowId: req.params.flowId });
        const statusCode = error.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({
          success: false,
          error: error.message
        });
      }
    });

    // Delete a flow
    this.app.delete('/api/flows/:flowId', async (req, res) => {
      try {
        const { flowId } = req.params;
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();

        await this.orchestrator.stateManager.deleteFlow(flowId, projectDir);

        // Broadcast flow deleted event
        if (this.wsManager) {
          this.wsManager.broadcast({
            type: 'flow-deleted',
            flowId
          });
        }

        res.json({
          success: true,
          message: `Flow ${flowId} deleted`
        });
      } catch (error) {
        this.logger.error('Failed to delete flow', { error: error.message, flowId: req.params.flowId });
        const statusCode = error.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get agent status for a flow (which agents are loaded/unloaded)
    this.app.get('/api/flows/:flowId/agents', async (req, res) => {
      try {
        const { flowId } = req.params;

        // Verify flow exists
        const flow = await this.orchestrator.stateManager.getFlow(flowId);
        if (!flow) {
          return res.status(404).json({
            success: false,
            error: `Flow ${flowId} not found`
          });
        }

        // Check if FlowExecutor is available
        if (!this.flowExecutor) {
          return res.status(500).json({
            success: false,
            error: 'Flow executor not initialized'
          });
        }

        const agentStatus = await this.flowExecutor.getFlowAgentStatus(flow);

        res.json({
          success: true,
          data: agentStatus
        });
      } catch (error) {
        this.logger.error('Failed to get flow agent status', { error: error.message, flowId: req.params.flowId });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Execute a flow
    this.app.post('/api/flows/:flowId/execute', async (req, res) => {
      try {
        const { flowId } = req.params;
        const { input, sessionId } = req.body;

        // Verify flow exists
        const flow = await this.orchestrator.stateManager.getFlow(flowId);
        if (!flow) {
          return res.status(404).json({
            success: false,
            error: `Flow ${flowId} not found`
          });
        }

        // Check if FlowExecutor is available
        if (!this.flowExecutor) {
          return res.status(500).json({
            success: false,
            error: 'Flow executor not initialized'
          });
        }

        // Start flow execution asynchronously
        // Return immediately with the run ID, execution continues in background
        const executionPromise = this.flowExecutor.executeFlow(flowId, input || {}, sessionId);

        // Wait briefly to get the initial run info
        // The execution will continue in the background
        const result = await Promise.race([
          executionPromise,
          new Promise(resolve => setTimeout(() => resolve({ pending: true }), 100))
        ]);

        if (result.pending) {
          // Execution still running, get the active execution info
          const activeExecutions = this.flowExecutor.getActiveExecutions();
          const activeRun = activeExecutions.find(e => e.flowId === flowId);

          res.json({
            success: true,
            data: {
              id: activeRun?.runId,
              flowId,
              status: 'running',
              nodeStates: {},
              startedAt: activeRun?.startedAt?.toISOString() || new Date().toISOString()
            }
          });
        } else {
          // Execution completed quickly (unlikely for real flows)
          res.json({
            success: true,
            data: result
          });
        }
      } catch (error) {
        this.logger.error('Failed to execute flow', { error: error.message, flowId: req.params.flowId });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Phase 6: list versions of a flow (lightweight metadata only).
    this.app.get('/api/flows/:flowId/versions', async (req, res) => {
      try {
        if (!this.flowVersionStore) return res.status(503).json({ success: false, error: 'version store not available' });
        const versions = await this.flowVersionStore.listVersions(req.params.flowId);
        res.json({ success: true, data: versions });
      } catch (error) {
        this.logger.error('list versions failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Phase 6: read a specific version snapshot (full flow definition).
    this.app.get('/api/flows/:flowId/versions/:version', async (req, res) => {
      try {
        if (!this.flowVersionStore) return res.status(503).json({ success: false, error: 'version store not available' });
        const v = parseInt(req.params.version, 10);
        if (!Number.isFinite(v) || v < 1) {
          return res.status(400).json({ success: false, error: 'version must be a positive integer' });
        }
        const snap = await this.flowVersionStore.loadVersion(req.params.flowId, v);
        if (!snap) return res.status(404).json({ success: false, error: 'version not found' });
        res.json({ success: true, data: snap });
      } catch (error) {
        this.logger.error('load version failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Phase 6: rollback — restore version N as the live flow record.
    // Body: { version: N }. Records ANOTHER new version after rollback
    // so history stays append-only ("rolled back to v3" produces v(N+1)).
    this.app.post('/api/flows/:flowId/rollback', async (req, res) => {
      try {
        if (!this.flowVersionStore) return res.status(503).json({ success: false, error: 'version store not available' });
        const { flowId } = req.params;
        const target = parseInt(req.body?.version, 10);
        if (!Number.isFinite(target) || target < 1) {
          return res.status(400).json({ success: false, error: 'body.version must be a positive integer' });
        }
        const snap = await this.flowVersionStore.loadVersion(flowId, target);
        if (!snap) return res.status(404).json({ success: false, error: `version ${target} not found` });

        // Validate the target snapshot before promoting it. A flow that
        // passed validation when first saved may now be invalid against
        // a newer schema — surfacing that here is better than at execute.
        const validation = validateFlowDefinition(snap.flow);
        if (!validation.ok) {
          return res.status(400).json({
            success: false,
            error: `version ${target} fails current validation`,
            details: validation.errors,
          });
        }

        const projectDir = this.orchestrator.config.project?.directory || process.cwd();
        const restored = await this.orchestrator.stateManager.updateFlow(flowId, {
          name:        snap.flow.name,
          description: snap.flow.description,
          nodes:       snap.flow.nodes,
          edges:       snap.flow.edges,
          variables:   snap.flow.variables,
        }, projectDir);

        // Append a new version entry tagging the rollback
        try {
          await this.flowVersionStore.recordVersion(flowId, {
            ...restored,
            _rollbackOf: target,
          });
        } catch (e) {
          this.logger.warn('post-rollback version record failed', { error: e.message });
        }

        if (this.wsManager) {
          this.wsManager.broadcast({ type: 'flow-updated', flow: restored });
        }
        res.json({ success: true, data: restored, rolledBackTo: target });
      } catch (error) {
        this.logger.error('rollback failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Phase 5: dry-run / lint an unsaved flow definition.
    // Posted body IS the flow definition (so the editor can lint
    // unsaved drafts). Combines schema gate + lint warnings into a
    // single report so the editor can highlight everything inline.
    this.app.post('/api/flows/dry-run', async (req, res) => {
      try {
        const flow = req.body || {};
        const validation = validateFlowDefinition(flow);
        const lint = lintFlow(flow);
        res.json({
          success: true,
          ok: validation.ok && lint.errors.length === 0,
          schemaErrors: validation.errors,
          lintErrors: lint.errors,
          lintWarnings: lint.warnings,
        });
      } catch (error) {
        this.logger.error('Dry-run failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Phase 4: resume a failed / interrupted flow run.
    // Per-node checkpoints on disk let us skip already-completed nodes
    // and re-run from the first non-completed one. The run record lives
    // under runId regardless of the flow it belongs to, so this lookup
    // does not require the flowId in the URL.
    this.app.post('/api/flows/runs/:runId/resume', async (req, res) => {
      try {
        const { runId } = req.params;
        const { sessionId } = req.body || {};
        if (!this.flowExecutor) {
          return res.status(503).json({ success: false, error: 'FlowExecutor not initialized' });
        }
        // Async: kick off and return immediately so the HTTP request
        // doesn't sit open for minutes. Errors propagate via WebSocket
        // (flow_run_failed) and the run record's status field.
        this.flowExecutor.resumeFlow(runId, sessionId || null).catch(err => {
          this.logger.error(`Resume flow failed for run ${runId}`, { error: err.message });
        });
        res.json({ success: true, runId, status: 'resuming' });
      } catch (error) {
        this.logger.error('Failed to resume flow run', { error: error.message, runId: req.params.runId });
        const status = /not found/i.test(error.message) ? 404
                     : /checkpoint store/i.test(error.message) ? 503
                     : 500;
        res.status(status).json({ success: false, error: error.message });
      }
    });

    // Stop a flow run
    this.app.post('/api/flows/:flowId/stop', async (req, res) => {
      try {
        const { flowId } = req.params;
        const { runId } = req.body;

        if (!runId) {
          return res.status(400).json({
            success: false,
            error: 'runId is required'
          });
        }

        // Get the run
        const run = await this.orchestrator.stateManager.getFlowRun(runId);
        if (!run) {
          return res.status(404).json({
            success: false,
            error: `Flow run ${runId} not found`
          });
        }

        // Stop execution via FlowExecutor if available
        if (this.flowExecutor) {
          await this.flowExecutor.stopExecution(runId);
        }

        // Update run status to stopped
        const updatedRun = await this.orchestrator.stateManager.updateFlowRun(runId, {
          status: 'stopped',
          completedAt: new Date().toISOString()
        });

        // Broadcast flow stopped event (null sessionId broadcasts to all)
        this.broadcastToSession(null, {
          type: 'flow_run_stopped',
          flowId,
          runId,
          run: updatedRun
        });

        res.json({
          success: true,
          data: updatedRun
        });
      } catch (error) {
        this.logger.error('Failed to stop flow', { error: error.message, flowId: req.params.flowId });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // List all currently-active runs across every flow. Used by the
    // FlowsPage to mark which cards are "running" without polling each
    // flow individually. Active = status in {queued, pending, running,
    // paused} — anything not yet terminal.
    //
    // Mounted ABOVE `/api/flows/:flowId/runs` so the literal `active`
    // segment isn't captured as a flowId by Express's pattern matcher.
    this.app.get('/api/flows/runs/active', async (req, res) => {
      try {
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();
        const runIndex = await this.orchestrator.stateManager.loadFlowRunIndex(projectDir);
        // Pre-load the flow index ONCE so the progress summary can
        // resolve total node count + current step labels per run
        // without N+1 lookups. The lookup callback is a closure over
        // the flow map; the helper queries by id at call time only.
        const flowIndex = await this.orchestrator.stateManager.loadFlowIndex(projectDir);
        const flowLookup = (flowId) => (flowIndex && flowId) ? flowIndex[flowId] || null : null;
        res.json({ success: true, data: projectActiveRuns(runIndex, flowLookup) });
      } catch (error) {
        this.logger.error('Failed to list active flow runs', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // List runs for a flow
    this.app.get('/api/flows/:flowId/runs', async (req, res) => {
      try {
        const { flowId } = req.params;
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();

        const runs = await this.orchestrator.stateManager.getFlowRuns(flowId, projectDir);

        res.json({
          success: true,
          data: runs
        });
      } catch (error) {
        this.logger.error('Failed to list flow runs', { error: error.message, flowId: req.params.flowId });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get a specific run
    this.app.get('/api/flows/:flowId/runs/:runId', async (req, res) => {
      try {
        const { flowId, runId } = req.params;
        const projectDir = this.orchestrator.config.project?.directory || process.cwd();

        const run = await this.orchestrator.stateManager.getFlowRun(runId, projectDir);

        if (!run) {
          return res.status(404).json({
            success: false,
            error: `Flow run ${runId} not found`
          });
        }

        // Verify run belongs to the specified flow
        if (run.flowId !== flowId) {
          return res.status(404).json({
            success: false,
            error: `Flow run ${runId} does not belong to flow ${flowId}`
          });
        }

        res.json({
          success: true,
          data: run
        });
      } catch (error) {
        this.logger.error('Failed to get flow run', { error: error.message, runId: req.params.runId });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // ==================== END FLOWS ROUTES ====================

    // ==================== VISUAL EDITOR ROUTES ====================

    // Helper to get the visual editor bridge (initialized on backend startup)
    const getBridge = () => {
      if (!this.visualEditorBridge) {
        // Fallback initialization if not started on init
        this.visualEditorBridge = getVisualEditorBridge({
          logger: this.logger
        });
      }
      return this.visualEditorBridge;
    };

    // Helper to get the visual editor server (initialized on backend startup)
    const getServer = () => {
      if (!this.visualEditorServer) {
        // Fallback initialization if not started on init
        this.visualEditorServer = getVisualEditorServer({
          logger: this.logger
        });
      }
      return this.visualEditorServer;
    };

    // Connect agent to visual editor (server is always running)
    this.app.post('/api/visual-editor/start', async (req, res) => {
      try {
        const { agentId, projectRoot, appUrl } = req.body;

        if (!agentId) {
          return res.status(400).json({
            success: false,
            error: 'agentId is required'
          });
        }

        const bridge = getBridge();
        const server = getServer();

        // Check if bridge is enabled
        if (!bridge.isEnabled()) {
          return res.status(503).json({
            success: false,
            error: 'Visual editor is disabled'
          });
        }

        // Ensure server is running (should already be from init, but fallback just in case)
        const serverPort = getVisualEditorPort();
        const serverBaseUrl = getVisualEditorBaseUrl();

        if (!server.isRunning) {
          this.logger.info('Visual Editor Server not running, starting now...');
          await server.start();
        }

        // Get or create instance in bridge for this agent
        const instance = await bridge.getInstance(agentId, {
          projectRoot: projectRoot || this.orchestrator?.config?.project?.directory,
          appUrl
        });

        // Register the app URL with the server for this agent
        if (appUrl) {
          server.registerAppUrl(agentId, appUrl);
        }

        // Generate editor URL that loads the Visual Editor Server
        const editorUrl = `${serverBaseUrl}?agentId=${encodeURIComponent(agentId)}&appUrl=${encodeURIComponent(appUrl || 'http://localhost:3000')}`;

        // Update instance with editor URL
        bridge.updateStatus(agentId, instance.status, { editorUrl });

        this.logger.info('Agent connected to Visual Editor', {
          agentId,
          appUrl: instance.appUrl,
          editorUrl,
          serverPort,
          status: instance.status
        });

        res.json({
          success: true,
          instance: {
            agentId: instance.agentId,
            status: instance.status,
            appUrl: instance.appUrl || appUrl,
            projectRoot: instance.projectRoot,
            editorUrl,
            serverPort,
            serverBaseUrl,  // Include base URL for frontend
            createdAt: instance.createdAt
          }
        });

      } catch (error) {
        this.logger.error('Failed to connect agent to visual editor', {
          error: error.message,
          agentId: req.body.agentId
        });

        const statusCode = error.message.includes('Maximum') ? 429 : 500;
        res.status(statusCode).json({
          success: false,
          error: error.message
        });
      }
    });

    // DEBUG: manually fire a `visual_editor_open` broadcast so the UI's
    // panel-open path can be tested independently of the agent tool path.
    // Exercised via: POST /api/visual-editor/debug-broadcast  { agentId, appUrl }.
    // This isolates the two failure surfaces when open-editor doesn't work —
    // either the backend never emits the WS event (bug in the tool / context /
    // webServer wiring) or the UI never reacts to it (bug in store / hook).
    this.app.post('/api/visual-editor/debug-broadcast', async (req, res) => {
      const { agentId, appUrl, editorUrl } = req.body || {};
      if (!agentId || !appUrl) {
        return res.status(400).json({ success: false, error: 'agentId and appUrl are required' });
      }
      try {
        this.broadcastToSession(null, {
          type: 'visual_editor_open',
          data: {
            agentId,
            appUrl,
            editorUrl: editorUrl || `http://localhost:4000?agentId=${agentId}&appUrl=${encodeURIComponent(appUrl)}`
          }
        });
        res.json({ success: true, message: 'visual_editor_open broadcast to all connections' });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Disconnect agent from visual editor (server keeps running)
    this.app.post('/api/visual-editor/stop', async (req, res) => {
      try {
        const { agentId } = req.body;

        if (!agentId) {
          return res.status(400).json({
            success: false,
            error: 'agentId is required'
          });
        }

        const bridge = getBridge();
        const stopped = await bridge.stopInstance(agentId);

        this.logger.info('Visual editor stopped', {
          agentId,
          stopped
        });

        res.json({
          success: true,
          stopped,
          message: stopped
            ? `Visual editor stopped for agent ${agentId}`
            : `No visual editor instance found for agent ${agentId}`
        });

      } catch (error) {
        this.logger.error('Failed to stop visual editor', {
          error: error.message,
          agentId: req.body.agentId
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get visual editor status for agent
    this.app.get('/api/visual-editor/status/:agentId', async (req, res) => {
      try {
        const { agentId } = req.params;

        const bridge = getBridge();
        const status = bridge.getStatus(agentId);

        res.json({
          success: true,
          ...status
        });

      } catch (error) {
        this.logger.error('Failed to get visual editor status', {
          error: error.message,
          agentId: req.params.agentId
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // List all visual editor instances
    this.app.get('/api/visual-editor/instances', async (req, res) => {
      try {
        const bridge = getBridge();
        const instances = bridge.listInstances();

        res.json({
          success: true,
          count: instances.length,
          maxInstances: bridge.maxInstances,
          instances
        });

      } catch (error) {
        this.logger.error('Failed to list visual editor instances', {
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Set visual context for agent (called by visual editor via WebSocket relay)
    this.app.post('/api/visual-editor/context', async (req, res) => {
      try {
        const { agentId, elementReference } = req.body;

        if (!agentId) {
          return res.status(400).json({
            success: false,
            error: 'agentId is required'
          });
        }

        if (!elementReference) {
          return res.status(400).json({
            success: false,
            error: 'elementReference is required'
          });
        }

        const bridge = getBridge();
        const success = bridge.setVisualContext(agentId, elementReference);

        if (success) {
          // Broadcast context update to subscribed UI clients
          this.broadcastToSession(req.body.sessionId, {
            type: 'visual-context-updated',
            agentId,
            context: elementReference
          });
        }

        res.json({
          success,
          message: success
            ? 'Visual context updated'
            : 'Failed to update visual context (no instance for agent)'
        });

      } catch (error) {
        this.logger.error('Failed to set visual context', {
          error: error.message,
          agentId: req.body.agentId
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Clear visual context for agent
    this.app.delete('/api/visual-editor/context/:agentId', async (req, res) => {
      try {
        const { agentId } = req.params;

        const bridge = getBridge();
        const cleared = bridge.clearVisualContext(agentId);

        res.json({
          success: true,
          cleared,
          message: cleared
            ? 'Visual context cleared'
            : 'No visual context to clear'
        });

      } catch (error) {
        this.logger.error('Failed to clear visual context', {
          error: error.message,
          agentId: req.params.agentId
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get visual context for agent
    this.app.get('/api/visual-editor/context/:agentId', async (req, res) => {
      try {
        const { agentId } = req.params;

        const bridge = getBridge();
        const context = bridge.getVisualContext(agentId);

        res.json({
          success: true,
          hasContext: !!context,
          context
        });

      } catch (error) {
        this.logger.error('Failed to get visual context', {
          error: error.message,
          agentId: req.params.agentId
        });

        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // ==================== END VISUAL EDITOR ROUTES ====================

    // =====================================================
    // Scheduled Tasks API
    // =====================================================

    // List all schedules
    this.app.get('/api/schedules', async (req, res) => {
      try {
        if (!this.scheduleService) {
          return res.json({ success: true, schedules: [] });
        }
        const schedules = this.scheduleService.listSchedules();
        res.json({ success: true, schedules });
      } catch (error) {
        this.logger.error('Failed to list schedules', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get cron presets
    this.app.get('/api/schedules/presets', async (req, res) => {
      try {
        if (!this.scheduleService) {
          return res.json({ success: true, presets: {} });
        }
        res.json({ success: true, presets: this.scheduleService.getPresets() });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Create a schedule
    this.app.post('/api/schedules', async (req, res) => {
      try {
        if (!this.scheduleService) {
          return res.status(400).json({ success: false, error: 'Schedule service not available' });
        }
        const schedule = await this.scheduleService.createSchedule(req.body);
        res.json({ success: true, schedule });
      } catch (error) {
        this.logger.error('Failed to create schedule', { error: error.message });
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Get a single schedule
    this.app.get('/api/schedules/:id', async (req, res) => {
      try {
        if (!this.scheduleService) {
          return res.status(404).json({ success: false, error: 'Schedule service not available' });
        }
        const schedule = this.scheduleService.getSchedule(req.params.id);
        if (!schedule) {
          return res.status(404).json({ success: false, error: 'Schedule not found' });
        }
        res.json({ success: true, schedule });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Update a schedule
    this.app.put('/api/schedules/:id', async (req, res) => {
      try {
        if (!this.scheduleService) {
          return res.status(400).json({ success: false, error: 'Schedule service not available' });
        }
        const schedule = await this.scheduleService.updateSchedule(req.params.id, req.body);
        res.json({ success: true, schedule });
      } catch (error) {
        this.logger.error('Failed to update schedule', { error: error.message });
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Delete a schedule
    this.app.delete('/api/schedules/:id', async (req, res) => {
      try {
        if (!this.scheduleService) {
          return res.status(400).json({ success: false, error: 'Schedule service not available' });
        }
        await this.scheduleService.deleteSchedule(req.params.id);
        res.json({ success: true });
      } catch (error) {
        this.logger.error('Failed to delete schedule', { error: error.message });
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Force-trigger a schedule immediately (used by CLI trigger-schedule command)
    this.app.post('/api/schedules/:id/trigger', async (req, res) => {
      try {
        if (!this.scheduleService) {
          return res.status(400).json({ success: false, error: 'Schedule service not available' });
        }
        const schedule = this.scheduleService.getSchedule(req.params.id);
        if (!schedule) {
          return res.status(404).json({ success: false, error: 'Schedule not found' });
        }
        // Execute immediately regardless of cron timing
        await this.scheduleService._executeSchedule(schedule);
        schedule.lastRun = new Date().toISOString();
        schedule.runCount++;
        schedule.updatedAt = new Date().toISOString();
        await this.scheduleService._saveSchedules();
        res.json({ success: true, scheduleName: schedule.name, lastRunStatus: schedule.lastRunStatus });
      } catch (error) {
        this.logger.error('Failed to trigger schedule', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Toggle schedule enabled/disabled
    this.app.post('/api/schedules/:id/toggle', async (req, res) => {
      try {
        if (!this.scheduleService) {
          return res.status(400).json({ success: false, error: 'Schedule service not available' });
        }
        const current = this.scheduleService.getSchedule(req.params.id);
        if (!current) {
          return res.status(404).json({ success: false, error: 'Schedule not found' });
        }
        const schedule = await this.scheduleService.updateSchedule(req.params.id, { enabled: !current.enabled });
        res.json({ success: true, schedule });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // =====================================================
    // Ollama Local Models API
    // =====================================================

    // Get Ollama status and available models
    this.app.get('/api/ollama/status', async (req, res) => {
      try {
        const { getOllamaService } = await import('../services/ollamaService.js');
        const ollama = getOllamaService(this.config, this.logger);
        const available = await ollama.isAvailable();
        const models = available ? await ollama.listModels() : [];
        res.json({
          success: true,
          available,
          host: ollama.host,
          enabled: ollama.enabled,
          modelCount: models.length,
          models
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get Ollama models list
    this.app.get('/api/ollama/models', async (req, res) => {
      try {
        const { getOllamaService } = await import('../services/ollamaService.js');
        const ollama = getOllamaService(this.config, this.logger);
        const models = await ollama.listModels();
        res.json({ success: true, models });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Pull a model from Ollama registry
    this.app.post('/api/ollama/pull', async (req, res) => {
      try {
        const { model } = req.body;
        if (!model) {
          return res.status(400).json({ success: false, error: 'Model name is required' });
        }
        const { getOllamaService } = await import('../services/ollamaService.js');
        const ollama = getOllamaService(this.config, this.logger);

        // Start pull (can take a while) — respond immediately, progress via WebSocket
        res.json({ success: true, message: `Pulling ${model}...`, model });

        // Pull in background and broadcast progress
        ollama.pullModel(model, (progress) => {
          this.broadcastToSession(req.body.sessionId || null, {
            type: 'ollama_pull_progress',
            data: { model, ...progress }
          });
        }).then(() => {
          this.broadcastToSession(req.body.sessionId || null, {
            type: 'ollama_pull_complete',
            data: { model, success: true }
          });
        }).catch((err) => {
          this.broadcastToSession(req.body.sessionId || null, {
            type: 'ollama_pull_error',
            data: { model, error: err.message }
          });
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Delete an Ollama model
    this.app.delete('/api/ollama/models/:name', async (req, res) => {
      try {
        const modelName = req.params.name;
        const { getOllamaService } = await import('../services/ollamaService.js');
        const ollama = getOllamaService(this.config, this.logger);
        await ollama.deleteModel(modelName);
        res.json({ success: true, message: `Deleted ${modelName}` });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get Ollama model info
    this.app.get('/api/ollama/models/:name/info', async (req, res) => {
      try {
        const { getOllamaService } = await import('../services/ollamaService.js');
        const ollama = getOllamaService(this.config, this.logger);
        const info = await ollama.getModelInfo(req.params.name);
        res.json(info);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Update Ollama settings
    this.app.put('/api/ollama/settings', async (req, res) => {
      try {
        const { host, enabled } = req.body;
        const { getOllamaService } = await import('../services/ollamaService.js');
        const ollama = getOllamaService(this.config, this.logger);

        if (host !== undefined) {
          ollama.setHost(host);
        }
        if (enabled !== undefined) {
          ollama.enabled = !!enabled;
        }

        const available = await ollama.isAvailable();
        res.json({ success: true, host: ollama.host, enabled: ollama.enabled, available });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // =====================================================

    // Unknown /api/* paths return a clean JSON 404 instead of falling
    // through to the SPA fallback (which would serve index.html and
    // confuse API clients into thinking the route exists).
    this.app.use('/api', (req, res) => {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error:   `Unknown API endpoint: ${req.method} ${req.originalUrl}`,
      });
    });

    // Serve React app for all other (non-/api) routes — SPA fallback.
    this.app.get('*', (req, res) => {
      const indexPath = path.join(__dirname, '../../web-ui/build/index.html');
      res.sendFile(indexPath, (err) => {
        if (err) {
          res.status(HTTP_STATUS.NOT_FOUND).send('Web UI not built. Run: npm run build:web-ui');
        }
      });
    });
  }

  /**
   * Setup WebSocket server
   * @private
   */
  setupWebSocket() {
    this.logger.info('Setting up WebSocket server', {
      port: this.port,
      host: this.host,
      wsServerExists: !!this.wss,
      httpServerExists: !!this.server
    });
    
    // Add error handler for WebSocket server
    this.wss.on('error', (error) => {
      this.logger.error('WebSocket server error:', {
        error: error.message,
        stack: error.stack,
        port: this.port
      });
    });
    
    // Log when WebSocket server is ready
    this.wss.on('listening', () => {
      this.logger.info('WebSocket server is now listening', {
        port: this.port,
        host: this.host
      });
    });
    
    // Server-side dead connection detection: ping all clients every 20 seconds
    // If a client doesn't respond with pong within 30 seconds, terminate it
    const WS_PING_INTERVAL = 20000;
    this._wsPingInterval = setInterval(() => {
      for (const [connId, conn] of this.connections) {
        if (conn._alive === false) {
          this.logger.warn('WebSocket connection dead (no pong) — terminating', { connectionId: connId });
          conn.ws.terminate();
          this.connections.delete(connId);
          continue;
        }
        conn._alive = false;
        // Use WebSocket protocol-level ping (not application-level)
        if (conn.ws.readyState === 1) { // OPEN
          conn.ws.ping();
        }
      }
    }, WS_PING_INTERVAL);

    this.wss.on('connection', (ws, req) => {
      const connectionId = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      this.logger.info('WebSocket connection established', {
        connectionId,
        ip: req.socket.remoteAddress,
        origin: req.headers.origin,
        host: req.headers.host,
        userAgent: req.headers['user-agent'],
        url: req.url
      });

      // Store connection
      const connection = {
        id: connectionId,
        ws,
        sessionId: null,
        connectedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        _alive: true
      };

      this.connections.set(connectionId, connection);

      // Protocol-level pong handler (response to server ping)
      ws.on('pong', () => {
        connection._alive = true;
      });

      // Handle messages
      ws.on('message', async (data) => {
        try {
          // Any message counts as proof of life
          connection._alive = true;
          const message = JSON.parse(data.toString());
          await this.handleWebSocketMessage(connectionId, message);
        } catch (error) {
          this.logger.error('WebSocket message error', {
            connectionId,
            error: error.message
          });

          ws.send(JSON.stringify({
            type: 'error',
            error: error.message
          }));
        }
      });

      // Handle disconnect
      ws.on('close', () => {
        this.logger.info('WebSocket connection closed', { connectionId });
        this.connections.delete(connectionId);
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        connectionId,
        timestamp: new Date().toISOString()
      }));
    });
  }

  /**
   * Handle WebSocket message
   * @private
   */
  async handleWebSocketMessage(connectionId, message) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    connection.lastActivity = new Date().toISOString();
    
    switch (message.type) {
      case 'join_session':
        const sessionId = message.sessionId;
        connection.sessionId = sessionId;
        
        this.logger.info('WebSocket joined session', {
          connectionId,
          sessionId,
          totalConnectionsForSession: Array.from(this.connections.values()).filter(c => c.sessionId === sessionId).length
        });
        
        connection.ws.send(JSON.stringify({
          type: 'session_joined',
          sessionId: sessionId
        }));
        break;
      
      case 'ping':
        connection.ws.send(JSON.stringify({
          type: 'pong',
          timestamp: new Date().toISOString()
        }));
        break;
      
      case 'orchestrator_request':
        // Handle real-time orchestrator requests
        try {
          const request = {
            interface: INTERFACE_TYPES.WEB,
            sessionId: connection.sessionId,
            action: message.action,
            payload: message.payload,
            projectDir: message.projectDir || process.cwd()
          };
          
          const response = await this.orchestrator.processRequest(request);
          
          connection.ws.send(JSON.stringify({
            type: 'orchestrator_response',
            requestId: message.requestId,
            response
          }));
          
        } catch (error) {
          connection.ws.send(JSON.stringify({
            type: 'error',
            requestId: message.requestId,
            error: error.message
          }));
        }
        break;

      case 'credential_response':
        // Handle credential submission from UI modal
        try {
          if (!this.credentialVault) {
            throw new Error('Credential vault not available');
          }

          await this.credentialVault.submitCredentials(
            message.requestId,
            message.credentials,
            message.saveForFuture === true
          );

          connection.ws.send(JSON.stringify({
            type: 'credential_result',
            requestId: message.requestId,
            success: true
          }));

        } catch (error) {
          connection.ws.send(JSON.stringify({
            type: 'credential_result',
            requestId: message.requestId,
            success: false,
            error: error.message
          }));
        }
        break;

      case 'credential_cancel':
        // Handle credential request cancellation from UI
        try {
          if (this.credentialVault && message.requestId) {
            this.credentialVault.cancelCredentialRequest(message.requestId);
          }

          connection.ws.send(JSON.stringify({
            type: 'credential_cancelled',
            requestId: message.requestId
          }));

        } catch (error) {
          this.logger.error('Failed to cancel credential request', { error: error.message });
        }
        break;

      case 'user_prompt_response':
        // Handle user prompt response from UI modal
        try {
          const { getPromptService } = await import('../services/promptService.js');
          const promptService = getPromptService(this.logger);

          const result = promptService.submitResponse(message.requestId, {
            answers: message.answers || []
          });

          connection.ws.send(JSON.stringify({
            type: 'user_prompt_result',
            requestId: message.requestId,
            success: result.success,
            error: result.error
          }));

        } catch (error) {
          this.logger.error('Failed to submit user prompt response', { error: error.message });
          connection.ws.send(JSON.stringify({
            type: 'user_prompt_result',
            requestId: message.requestId,
            success: false,
            error: error.message
          }));
        }
        break;

      case 'user_prompt_cancel':
        // Handle user prompt cancellation from UI
        try {
          const { getPromptService } = await import('../services/promptService.js');
          const promptService = getPromptService(this.logger);

          promptService.cancelRequest(message.requestId, message.reason || 'User cancelled');

          connection.ws.send(JSON.stringify({
            type: 'user_prompt_cancelled',
            requestId: message.requestId
          }));

        } catch (error) {
          this.logger.error('Failed to cancel user prompt request', { error: error.message });
        }
        break;

      case 'visual_editor_console_error':
        // Relay console errors from visual editor overlay to the agent
        try {
          const errorAgentId = message.agentId;
          const errorSessionId = message.sessionId || connection.sessionId;
          const errorData = message.data;

          const agentPool = this.orchestrator?.agentPool;
          if (errorAgentId && errorData && agentPool) {
            // Inject as a system message into the agent's conversation
            await agentPool.addUserMessage(errorAgentId, {
              role: 'user',
              content: `[Visual Editor - Console ${errorData.type || 'error'}]\n${errorData.message}${errorData.source ? `\nSource: ${errorData.source}:${errorData.line || '?'}` : ''}`,
              timestamp: new Date().toISOString(),
              source: 'visual-editor-error',
              isSystemGenerated: true
            });
          }
        } catch (error) {
          this.logger.error('Failed to relay visual editor console error', { error: error.message });
        }
        break;

      default:
        this.logger.warn('Unknown WebSocket message type', {
          connectionId,
          type: message.type
        });
    }
  }

  /**
   * Broadcast message to all connections in a session
   * @private
   */
  broadcastToSession(sessionId, message) {
    const sessionConnections = Array.from(this.connections.values())
      .filter(conn => conn.sessionId === sessionId);
    
    // If no connections found for this session, try broadcasting to all connections
    // This handles cases where session IDs might be mismatched
    let allConnections = [];
    if (sessionConnections.length === 0) {
      allConnections = Array.from(this.connections.values());
      
      this.logger?.warn('🔄 No connections for session, trying all connections:', {
        targetSessionId: sessionId,
        totalConnections: this.connections.size,
        allSessionIds: Array.from(this.connections.values()).map(c => c.sessionId).filter(Boolean)
      });
    }
    
    const targetConnections = sessionConnections.length > 0 ? sessionConnections : allConnections;
    
    // Skip verbose logging for high-frequency streaming messages
    const isHighFreq = message.data?.type === 'stream_chunk';
    if (!isHighFreq) {
      this.logger?.info('📡 WebSocket broadcastToSession called:', {
        sessionId,
        messageType: message.type,
        agentId: message.agentId,
        totalConnections: this.connections.size,
        sessionConnections: sessionConnections.length,
        targetConnections: targetConnections.length,
        connectionIds: targetConnections.map(c => c.id),
        usingFallback: sessionConnections.length === 0,
        messagePreview: message.type === 'autonomous_update' && message.message ? {
          messageId: message.message.id,
          messageRole: message.message.role,
          contentLength: message.message.content?.length,
          hasToolResults: !!message.message.toolResults
        } : undefined
      });
    }
    
    for (const connection of targetConnections) {
      try {
        const fullMessage = {
          ...message,
          timestamp: new Date().toISOString()
        };
        
        connection.ws.send(JSON.stringify(fullMessage));

        if (!isHighFreq) {
          this.logger?.info('✅ WebSocket message sent to connection:', {
            connectionId: connection.id,
            messageType: message.type,
            agentId: message.agentId
          });
        }
      } catch (error) {
        this.logger.warn('❌ Failed to send WebSocket message', {
          connectionId: connection.id,
          sessionId,
          messageType: message.type,
          error: error.message
        });
      }
    }
  }

  /**
   * Broadcast a credential request to the UI
   * Used when the browser tool needs credentials for a site
   * @param {Object} requestInfo - Credential request info from vault
   * @param {string} sessionId - Session ID to broadcast to
   */
  broadcastCredentialRequest(requestInfo, sessionId) {
    const message = {
      type: 'credential_request',
      data: {
        ...requestInfo,
        timestamp: new Date().toISOString()
      }
    };

    this.logger?.info('[WebServer] Broadcasting credential request', {
      requestId: requestInfo.requestId,
      siteId: requestInfo.siteId,
      sessionId
    });

    if (sessionId) {
      this.broadcastToSession(sessionId, message);
    } else {
      // Broadcast to all connections if no session specified
      for (const connection of this.connections.values()) {
        try {
          connection.ws.send(JSON.stringify(message));
        } catch (error) {
          this.logger?.error('Failed to send credential request', { error: error.message });
        }
      }
    }
  }

  /**
   * Broadcast credential authentication result to the UI
   * @param {Object} resultInfo - { requestId, siteId, success, error }
   * @param {string} sessionId - Session ID to broadcast to
   */
  broadcastCredentialResult(resultInfo, sessionId) {
    const message = {
      type: 'credential_result',
      data: {
        ...resultInfo,
        timestamp: new Date().toISOString()
      }
    };

    this.logger?.info('[WebServer] Broadcasting credential result', {
      requestId: resultInfo.requestId,
      success: resultInfo.success
    });

    if (sessionId) {
      this.broadcastToSession(sessionId, message);
    } else {
      for (const connection of this.connections.values()) {
        try {
          connection.ws.send(JSON.stringify(message));
        } catch (error) {
          this.logger?.error('Failed to send credential result', { error: error.message });
        }
      }
    }
  }

  /**
   * Broadcast credential request timeout to the UI
   * @param {Object} timeoutInfo - { requestId, siteId }
   * @param {string} sessionId - Session ID to broadcast to
   */
  broadcastCredentialTimeout(timeoutInfo, sessionId) {
    const message = {
      type: 'credential_timeout',
      data: {
        ...timeoutInfo,
        timestamp: new Date().toISOString()
      }
    };

    this.logger?.info('[WebServer] Broadcasting credential timeout', {
      requestId: timeoutInfo.requestId
    });

    if (sessionId) {
      this.broadcastToSession(sessionId, message);
    } else {
      for (const connection of this.connections.values()) {
        try {
          connection.ws.send(JSON.stringify(message));
        } catch (error) {
          this.logger?.error('Failed to send credential timeout', { error: error.message });
        }
      }
    }
  }

  /**
   * Start the HTTP server
   * @private
   */
  async startServer() {
    // Cleanup stale port registry entries from crashed/killed processes
    try {
      const portRegistry = (await import('../services/portRegistry.js')).getPortRegistry();
      await portRegistry.cleanupStaleEntries();
    } catch (err) {
      this.logger.warn('Port registry cleanup failed (non-fatal)', { error: err.message });
    }

    // Check for environment variable override (backward compatibility)
    const envPort = parseInt(process.env.LOXIA_PORT || process.env.PORT, 10);

    if (envPort && !isNaN(envPort)) {
      // Use explicitly configured port
      this.port = envPort;
      this.logger.info('Using configured port from environment', { port: this.port });
    } else {
      // Dynamic port allocation - find a free port starting from configured default
      try {
        const preferredPort = this.config.port || 8080;
        // Pass the host so we check the correct interface (localhost = ::1 on IPv6 systems)
        this.port = await findFreePort(preferredPort, 100, this.host);

        if (this.port !== preferredPort) {
          this.logger.info('Preferred port taken, using alternative', {
            preferredPort,
            actualPort: this.port
          });
        }
      } catch (error) {
        this.logger.error('Failed to find free port', { error: error.message });
        throw error;
      }
    }

    return new Promise((resolve, reject) => {
      // Handle bind errors (EADDRINUSE, EACCES, etc.) — must be set BEFORE listen()
      const onError = (error) => {
        this.logger.error('Failed to start HTTP server', {
          error: error.message,
          code: error.code,
          port: this.port,
          host: this.host
        });
        reject(error);
      };
      this.server.once('error', onError);

      // exclusive: false ensures SO_REUSEADDR — allows binding to ports in TIME_WAIT
      // (e.g., after debugger kill or crash where graceful shutdown didn't run)
      this.server.listen({ port: this.port, host: this.host, exclusive: false }, async () => {
        // Remove the startup error handler; replace with runtime error handler
        this.server.removeListener('error', onError);
        this.server.on('error', (error) => {
          this.logger.error('HTTP server runtime error:', {
            error: error.message,
            port: this.port
          });
        });

        this.isRunning = true;

        // Register with service registry (persists to file for cross-process discovery)
        try {
          registry.register('backend', {
            port: this.port,
            host: this.host,
            protocol: 'http',
            metadata: {
              wsPath: '/',
              apiPath: '/api',
              pid: process.pid
            }
          });

          // Setup exit handlers for cleanup
          registry.setupExitHandlers();
        } catch (regError) {
          this.logger.warn('Failed to register with service registry', {
            error: regError.message
          });
        }

        // Verify WebSocket server status
        this.logger.info('HTTP server started successfully', {
          port: this.port,
          host: this.host,
          httpUrl: `http://${this.host}:${this.port}`,
          wsUrl: `ws://${this.host}:${this.port}`,
          wsServerAttached: !!this.wss,
          wsConnections: this.connections.size
        });

        // Test WebSocket server availability
        setTimeout(async () => {
          await this.testWebSocketServer();
        }, 1000);

        resolve();
      });
    });
  }

  /**
   * Test WebSocket server availability
   * @private
   */
  async testWebSocketServer() {
    try {
      const { default: WebSocket } = await import('ws');
      const testWs = new WebSocket(`ws://localhost:${this.port}`);
      
      testWs.on('open', () => {
        this.logger.info('✅ WebSocket server test: SUCCESSFUL', {
          port: this.port,
          url: `ws://localhost:${this.port}`
        });
        testWs.close();
      });
      
      testWs.on('error', (error) => {
        this.logger.error('❌ WebSocket server test: FAILED', {
          port: this.port,
          url: `ws://localhost:${this.port}`,
          error: error.message,
          code: error.code
        });
      });
      
      testWs.on('close', (code, reason) => {
        if (code === 1000) {
          this.logger.info('WebSocket test connection closed cleanly');
        }
      });
      
      // Timeout the test
      setTimeout(() => {
        if (testWs.readyState === WebSocket.CONNECTING) {
          this.logger.error('❌ WebSocket server test: TIMEOUT', {
            port: this.port,
            url: `ws://localhost:${this.port}`,
            readyState: testWs.readyState
          });
          testWs.terminate();
        }
      }, 5000);
      
    } catch (error) {
      this.logger.error('❌ WebSocket server test: EXCEPTION', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Set API key manager instance
   * @param {ApiKeyManager} apiKeyManager - API key manager instance
   */
  setApiKeyManager(apiKeyManager) {
    this.apiKeyManager = apiKeyManager;

    this.logger?.info('API key manager set for web server', {
      hasManager: !!apiKeyManager
    });
  }

  /**
   * Set credential vault instance
   * @param {CredentialVault} credentialVault - Credential vault instance
   */
  setCredentialVault(credentialVault) {
    this.credentialVault = credentialVault;

    this.logger?.info('Credential vault set for web server', {
      hasVault: !!credentialVault
    });
  }

  setTelegramService(telegramService) {
    this.telegramService = telegramService;
  }

  setDiscordService(discordService) {
    this.discordService = discordService;
  }

  setScheduleService(scheduleService) {
    this.scheduleService = scheduleService;
  }

  /**
   * Extract vendor name from model name
   * @param {string} model - Model name
   * @returns {string|null} Vendor name
   * @private
   */
  _getVendorFromModel(model) {
    if (!model) return null;
    
    const modelName = model.toLowerCase();
    
    if (modelName.includes('anthropic') || modelName.includes('claude')) {
      return 'anthropic';
    } else if (modelName.includes('openai') || modelName.includes('gpt')) {
      return 'openai';
    } else if (modelName.includes('deepseek')) {
      return 'deepseek';
    } else if (modelName.includes('phi')) {
      return 'microsoft';
    }
    
    return null;
  }

  /**
   * Get server status
   * @returns {Object} Server status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      port: this.port,
      host: this.host,
      connections: this.connections.size,
      sessions: this.sessions.size,
      url: `http://${this.host}:${this.port}`
    };
  }

  /**
   * Shutdown the web server
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (!this.isRunning) return;

    this.logger.info('Shutting down web server...');

    // Unregister from service registry
    try {
      registry.unregister('backend');
      this.logger.info('Unregistered backend from service registry');
    } catch (err) {
      this.logger.warn('Error unregistering from service registry:', err.message);
    }

    // Stop Visual Editor Server if running
    if (this.visualEditorServer && this.visualEditorServer.isRunning) {
      try {
        await this.visualEditorServer.stop();
        this.logger.info('Visual Editor Server stopped');
      } catch (err) {
        this.logger.warn('Error stopping Visual Editor Server:', err.message);
      }
    }

    // Shutdown Visual Editor Bridge if active
    if (this.visualEditorBridge) {
      try {
        await this.visualEditorBridge.shutdown();
        this.logger.info('Visual Editor Bridge shutdown');
      } catch (err) {
        this.logger.warn('Error shutting down Visual Editor Bridge:', err.message);
      }
    }

    // Stop server-side ping interval
    if (this._wsPingInterval) {
      clearInterval(this._wsPingInterval);
      this._wsPingInterval = null;
    }

    // Close all WebSocket connections
    for (const connection of this.connections.values()) {
      connection.ws.close();
    }
    this.connections.clear();

    // Close WebSocket server
    this.wss.close();

    // Close HTTP server — force-close keep-alive connections that prevent clean exit
    return new Promise((resolve) => {
      // closeAllConnections() added in Node 18.2 — terminates keep-alive sockets immediately
      if (typeof this.server.closeAllConnections === 'function') {
        this.server.closeAllConnections();
      }
      this.server.close(() => {
        this.isRunning = false;
        this.logger.info('Web server shutdown complete');
        resolve();
      });
    });
  }
}

export default WebServer;

// Main execution block - start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Simple console logger for standalone mode
  const simpleLogger = {
    info: (msg, data) => console.log(`[INFO] ${msg}`, data ? JSON.stringify(data, null, 2) : ''),
    error: (msg, data) => console.error(`[ERROR] ${msg}`, data ? JSON.stringify(data, null, 2) : ''),
    warn: (msg, data) => console.warn(`[WARN] ${msg}`, data ? JSON.stringify(data, null, 2) : ''),
    debug: (msg, data) => console.log(`[DEBUG] ${msg}`, data ? JSON.stringify(data, null, 2) : '')
  };

  // Simple orchestrator mock for standalone mode
  const mockOrchestrator = {
    processAction: async (action, data) => {
      simpleLogger.info('Mock orchestrator action', { action, data });
      
      // Mock responses for different actions
      switch (action) {
        case ORCHESTRATOR_ACTIONS.LIST_AGENTS:
          return {
            success: true,
            data: []
          };
        
        case ORCHESTRATOR_ACTIONS.CREATE_AGENT:
          return {
            success: true,
            data: {
              id: `agent-${Date.now()}`,
              name: data.name || 'New Agent',
              status: 'active',
              model: data.model || 'anthropic-sonnet',
              systemPrompt: data.systemPrompt || 'You are a helpful AI assistant.'
            }
          };
        
        case ORCHESTRATOR_ACTIONS.SEND_MESSAGE:
          return {
            success: true,
            data: {
              message: {
                id: `msg-${Date.now()}`,
                content: `Echo: ${data.message}`,
                timestamp: new Date().toISOString()
              }
            }
          };
        
        default:
          return {
            success: false,
            error: `Unknown action: ${action}`
          };
      }
    }
  };

  const server = new WebServer(mockOrchestrator, simpleLogger, {
    port: 8080,
    host: '0.0.0.0'
  });

  console.log('🚀 Starting Loxia Web Server in standalone mode...');
  
  server.startServer()
    .then(() => {
      const status = server.getStatus();
      console.log(`✅ Web Server running at ${status.url}`);
      console.log('📱 Web UI available at: http://localhost:3001 (if running)');
      console.log('🔧 API available at: http://localhost:8080/api');
    })
    .catch(error => {
      console.error('❌ Failed to start web server:', error.message);
      process.exit(1);
    });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down web server...');
    await server.shutdown();
    process.exit(0);
  });
}
