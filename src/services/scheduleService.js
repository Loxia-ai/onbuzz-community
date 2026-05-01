/**
 * ScheduleService - Manages scheduled/recurring tasks
 *
 * Purpose:
 * - Parse cron expressions and calculate next run times
 * - Persist schedules to disk (survives restarts)
 * - Check and trigger due schedules each tick
 * - Push prompts to agents (switching to agent mode) or execute flows
 * - Sync with OS scheduler (crontab/schtasks) for execution when system is down
 * - Track execution history
 */

import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getUserDataDir } from '../utilities/userDataDir.js';

// ========================
// Lightweight cron parser (no external dependency)
// Supports: minute hour dayOfMonth month dayOfWeek
// Fields: 0-59  0-23  1-31  1-12  0-6 (Sun=0)
// Supports: *, */n, n, n-m, n,m,o
// ========================

function parseCronField(field, min, max) {
  const values = new Set();

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      let start = min;
      let end = max;
      if (range !== '*') {
        if (range.includes('-')) {
          [start, end] = range.split('-').map(Number);
        } else {
          start = parseInt(range, 10);
        }
      }
      for (let i = start; i <= end; i += step) values.add(i);
    } else if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a; i <= b; i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return values;
}

function parseCron(expression) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: "${expression}" — expected 5 fields (minute hour dayOfMonth month dayOfWeek)`);
  }

  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    daysOfMonth: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    daysOfWeek: parseCronField(parts[4], 0, 6)
  };
}

function cronMatchesDate(parsed, date) {
  return (
    parsed.minutes.has(date.getMinutes()) &&
    parsed.hours.has(date.getHours()) &&
    parsed.daysOfMonth.has(date.getDate()) &&
    parsed.months.has(date.getMonth() + 1) &&
    parsed.daysOfWeek.has(date.getDay())
  );
}

function getNextCronDate(parsed, after = new Date()) {
  // Walk forward minute by minute (max 2 years)
  const limit = 2 * 365 * 24 * 60;
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  for (let i = 0; i < limit; i++) {
    if (cronMatchesDate(parsed, d)) return new Date(d);
    d.setMinutes(d.getMinutes() + 1);
  }

  return null;
}

// ========================
// Predefined presets for user-friendly schedule creation
// ========================

const CRON_PRESETS = {
  'every-minute': '* * * * *',
  'every-5-minutes': '*/5 * * * *',
  'every-15-minutes': '*/15 * * * *',
  'every-30-minutes': '*/30 * * * *',
  'every-hour': '0 * * * *',
  'every-6-hours': '0 */6 * * *',
  'every-12-hours': '0 */12 * * *',
  'daily': '0 9 * * *',
  'daily-morning': '0 8 * * *',
  'daily-evening': '0 18 * * *',
  'weekdays': '0 9 * * 1-5',
  'weekends': '0 10 * * 0,6',
  'weekly-monday': '0 9 * * 1',
  'monthly': '0 9 1 * *'
};

class ScheduleService {
  constructor(logger) {
    this.logger = logger;
    this.schedules = new Map(); // id → schedule object
    this.configPath = path.join(getUserDataDir(), 'schedules.json');
    this.checkIntervalMs = 30000; // Check every 30 seconds
    this.checkTimer = null;

    // Dependencies (injected)
    this.agentPool = null;
    this.messageProcessor = null;
    this.flowExecutor = null;
    this.webSocketManager = null;
    this.orchestrator = null;
  }

  // ========================
  // Dependency injection
  // ========================

  setAgentPool(agentPool) { this.agentPool = agentPool; }
  setMessageProcessor(messageProcessor) { this.messageProcessor = messageProcessor; }
  setFlowExecutor(flowExecutor) { this.flowExecutor = flowExecutor; }
  setWebSocketManager(wsManager) { this.webSocketManager = wsManager; }
  setOrchestrator(orchestrator) { this.orchestrator = orchestrator; }

  // ========================
  // Lifecycle
  // ========================

  async initialize() {
    await this._loadSchedules();
    this.logger.info('ScheduleService initialized', { scheduleCount: this.schedules.size });
  }

  start() {
    if (this.checkTimer) return;

    this.checkTimer = setInterval(() => {
      this._tick().catch(err =>
        this.logger.error('Schedule tick error', { error: err.message })
      );
    }, this.checkIntervalMs);

    this.logger.info('ScheduleService started', { intervalMs: this.checkIntervalMs });

    // Run an immediate check for any missed schedules
    this._tick().catch(err =>
      this.logger.error('Initial schedule tick error', { error: err.message })
    );

    // Sync all schedules to OS scheduler (non-blocking)
    this.syncAllToOS().catch(err =>
      this.logger.warn('Failed to sync schedules to OS on startup', { error: err.message })
    );
  }

  stop() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
      this.logger.info('ScheduleService stopped');
    }
  }

  // ========================
  // CRUD
  // ========================

  async createSchedule(config) {
    const {
      name,
      prompt,
      targetType,       // 'agent' or 'flow'
      targetId,          // agent ID or flow ID
      cronExpression,    // raw cron or preset name
      enabled = true,
      description = '',
      startDate = null,  // ISO date string — schedule starts after this date
      endDate = null,    // ISO date string — schedule stops after this date
      maxRuns = null,    // number — auto-disable after N executions (null = unlimited)
      runOnce = false    // boolean — run once then auto-disable
    } = config;

    if (!name) throw new Error('Schedule name is required');
    if (!prompt) throw new Error('Prompt is required');
    if (!targetType || !['agent', 'flow'].includes(targetType)) {
      throw new Error('targetType must be "agent" or "flow"');
    }
    if (!targetId) throw new Error('targetId is required');
    if (!cronExpression) throw new Error('cronExpression is required');

    // Resolve preset or validate cron
    const resolvedCron = CRON_PRESETS[cronExpression] || cronExpression;
    const parsed = parseCron(resolvedCron); // throws if invalid
    const nextRun = getNextCronDate(parsed);

    const id = `schedule-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    const schedule = {
      id,
      name,
      description,
      prompt,
      targetType,
      targetId,
      cronExpression: resolvedCron,
      cronPreset: CRON_PRESETS[cronExpression] ? cronExpression : null,
      enabled,
      startDate: startDate || null,
      endDate: endDate || null,
      maxRuns: maxRuns != null ? parseInt(maxRuns) : null,
      runOnce: !!runOnce,
      nextRun: nextRun ? nextRun.toISOString() : null,
      lastRun: null,
      lastRunStatus: null,
      runCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.schedules.set(id, schedule);
    await this._saveSchedules();

    // Sync to OS scheduler (non-blocking, non-fatal)
    this._syncToOS(schedule).catch(() => {});

    this._broadcast('schedule_created', schedule);
    this.logger.info('Schedule created', { id, name, cron: resolvedCron, targetType, targetId });

    return schedule;
  }

  async updateSchedule(id, updates) {
    const schedule = this.schedules.get(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);

    // If cron changed, reparse and recalculate next run
    if (updates.cronExpression) {
      const resolvedCron = CRON_PRESETS[updates.cronExpression] || updates.cronExpression;
      parseCron(resolvedCron); // validate
      updates.cronExpression = resolvedCron;
      updates.cronPreset = CRON_PRESETS[updates.cronExpression] ? updates.cronExpression : null;
      const parsed = parseCron(resolvedCron);
      updates.nextRun = getNextCronDate(parsed)?.toISOString() || null;
    }

    // If re-enabled, recalculate next run
    if (updates.enabled === true && !schedule.enabled) {
      const parsed = parseCron(updates.cronExpression || schedule.cronExpression);
      updates.nextRun = getNextCronDate(parsed)?.toISOString() || null;
    }

    const allowedFields = ['name', 'description', 'prompt', 'targetType', 'targetId', 'cronExpression', 'cronPreset', 'enabled', 'nextRun'];
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        schedule[key] = updates[key];
      }
    }
    schedule.updatedAt = new Date().toISOString();

    await this._saveSchedules();

    // Sync to OS scheduler (non-blocking, non-fatal)
    this._syncToOS(schedule).catch(() => {});

    this._broadcast('schedule_updated', schedule);
    this.logger.info('Schedule updated', { id, updates: Object.keys(updates) });

    return schedule;
  }

  async deleteSchedule(id) {
    if (!this.schedules.has(id)) throw new Error(`Schedule not found: ${id}`);

    // Remove from OS scheduler first
    this._removeFromOS(id).catch(() => {});

    this.schedules.delete(id);
    await this._saveSchedules();

    this._broadcast('schedule_deleted', { id });
    this.logger.info('Schedule deleted', { id });
  }

  getSchedule(id) {
    return this.schedules.get(id) || null;
  }

  listSchedules() {
    return Array.from(this.schedules.values()).sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  getPresets() {
    return { ...CRON_PRESETS };
  }

  // ========================
  // Tick — check and fire due schedules
  // ========================

  async _tick() {
    const now = new Date();

    for (const schedule of this.schedules.values()) {
      if (!schedule.enabled || !schedule.nextRun) continue;

      // Check if schedule has expired (endDate passed)
      if (schedule.endDate && now > new Date(schedule.endDate)) {
        schedule.enabled = false;
        schedule.nextRun = null;
        schedule.updatedAt = now.toISOString();
        this._broadcast('schedule_updated', schedule);
        this.logger.info('Schedule expired (end date reached)', { id: schedule.id, name: schedule.name });
        continue;
      }

      // Check if start date hasn't arrived yet
      if (schedule.startDate && now < new Date(schedule.startDate)) {
        continue;
      }

      const nextRun = new Date(schedule.nextRun);
      if (now >= nextRun) {
        // Fire!
        await this._executeSchedule(schedule);

        schedule.lastRun = now.toISOString();
        schedule.runCount++;
        schedule.updatedAt = now.toISOString();

        // Check if schedule should auto-disable (runOnce or maxRuns reached)
        if (schedule.runOnce || (schedule.maxRuns != null && schedule.runCount >= schedule.maxRuns)) {
          schedule.enabled = false;
          schedule.nextRun = null;
          this._broadcast('schedule_updated', schedule);
          this.logger.info('Schedule auto-disabled', {
            id: schedule.id, name: schedule.name,
            reason: schedule.runOnce ? 'run-once' : `maxRuns (${schedule.maxRuns}) reached`
          });
        } else {
          // Calculate next run
          const parsed = parseCron(schedule.cronExpression);
          const next = getNextCronDate(parsed, now);
          schedule.nextRun = next ? next.toISOString() : null;
        }
      }
    }

    await this._saveSchedules();
  }

  async _executeSchedule(schedule) {
    this.logger.info('Executing scheduled task', {
      id: schedule.id,
      name: schedule.name,
      targetType: schedule.targetType,
      targetId: schedule.targetId
    });

    this._broadcast('schedule_triggered', {
      id: schedule.id,
      name: schedule.name,
      targetType: schedule.targetType,
      targetId: schedule.targetId,
      triggeredAt: new Date().toISOString()
    });

    try {
      if (schedule.targetType === 'agent') {
        await this._executeAgentSchedule(schedule);
        schedule.lastRunStatus = 'success';
      } else if (schedule.targetType === 'flow') {
        await this._executeFlowSchedule(schedule);
        schedule.lastRunStatus = 'success';
      }
    } catch (error) {
      schedule.lastRunStatus = 'error';
      schedule.lastRunError = error.message;
      this.logger.error('Scheduled task execution failed', {
        id: schedule.id,
        error: error.message
      });
      this._broadcast('schedule_error', {
        id: schedule.id,
        name: schedule.name,
        error: error.message
      });
    }
  }

  async _executeAgentSchedule(schedule) {
    if (!this.agentPool) throw new Error('AgentPool not available');

    const agent = await this.agentPool.getAgent(schedule.targetId);
    if (!agent) throw new Error(`Target agent not found: ${schedule.targetId}`);

    // Switch agent to agent mode (autonomous)
    const { AGENT_MODES } = await import('../utilities/constants.js');

    // Get a session ID — use the first WebSocket connection or a synthetic one
    let sessionId = `schedule-${schedule.id}-${Date.now()}`;
    if (this.webSocketManager?.connections) {
      for (const conn of this.webSocketManager.connections.values()) {
        if (conn.sessionId) {
          sessionId = conn.sessionId;
          break;
        }
      }
    }

    // Switch to agent mode
    await this.agentPool.updateAgent(schedule.targetId, {
      mode: AGENT_MODES.AGENT,
      sessionId
    });

    // Push the prompt as a user message
    await this.agentPool.addUserMessage(schedule.targetId, {
      role: 'user',
      content: `[Scheduled Task: ${schedule.name}]\n\n${schedule.prompt}`,
      timestamp: new Date().toISOString(),
      source: 'schedule',
      scheduleId: schedule.id
    });

    this.logger.info('Prompt pushed to agent via schedule', {
      scheduleId: schedule.id,
      agentId: schedule.targetId,
      agentName: agent.name
    });
  }

  async _executeFlowSchedule(schedule) {
    if (!this.flowExecutor) throw new Error('FlowExecutor not available');

    let sessionId = `schedule-${schedule.id}-${Date.now()}`;
    if (this.webSocketManager?.connections) {
      for (const conn of this.webSocketManager.connections.values()) {
        if (conn.sessionId) {
          sessionId = conn.sessionId;
          break;
        }
      }
    }

    await this.flowExecutor.executeFlow(
      schedule.targetId,
      { userInput: schedule.prompt, source: 'schedule', scheduleId: schedule.id },
      sessionId
    );

    this.logger.info('Flow executed via schedule', {
      scheduleId: schedule.id,
      flowId: schedule.targetId
    });
  }

  // ========================
  // Persistence
  // ========================

  async _loadSchedules() {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const arr = JSON.parse(data);
      this.schedules.clear();
      for (const s of arr) {
        this.schedules.set(s.id, s);
      }
      this.logger.info('Schedules loaded from disk', { count: arr.length });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.logger.warn('Failed to load schedules', { error: err.message });
      }
      // First run or corrupted — start fresh
    }
  }

  async _saveSchedules() {
    try {
      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });
      const arr = Array.from(this.schedules.values());
      await fs.writeFile(this.configPath, JSON.stringify(arr, null, 2), 'utf-8');
    } catch (err) {
      this.logger.error('Failed to save schedules', { error: err.message });
    }
  }

  // ========================
  // WebSocket broadcasting
  // ========================

  _broadcast(type, data) {
    if (this.webSocketManager?.broadcast) {
      this.webSocketManager.broadcast({ type, ...data });
    }
  }

  // ========================
  // OS Scheduler Sync
  // Registers/unregisters cron jobs (Linux/macOS) or schtasks (Windows)
  // so schedules fire even when Loxia is shut down.
  // ========================

  /**
   * Find the loxia CLI binary path
   */
  _findLoxiaBin() {
    try {
      // Check if installed globally
      const which = process.platform === 'win32' ? 'where loxia' : 'which loxia';
      return execSync(which, { encoding: 'utf-8' }).trim().split('\n')[0];
    } catch {
      // Fallback to local bin
      const __dirname = path.dirname(new URL(import.meta.url).pathname);
      const localBin = path.resolve(__dirname, '../../bin/cli.js');
      return `node "${localBin}"`;
    }
  }

  /**
   * Sync a single schedule to the OS scheduler.
   * Called after create/update.
   */
  async _syncToOS(schedule) {
    if (!schedule.enabled) {
      await this._removeFromOS(schedule.id);
      return;
    }

    try {
      const loxiaBin = this._findLoxiaBin();
      const command = `${loxiaBin} trigger-schedule ${schedule.id}`;

      if (process.platform === 'win32') {
        await this._syncToWindows(schedule, command);
      } else {
        await this._syncToCrontab(schedule, command);
      }
    } catch (err) {
      // Non-fatal — internal scheduler still works as fallback
      this.logger.warn('Failed to sync schedule to OS scheduler', {
        id: schedule.id,
        error: err.message
      });
    }
  }

  /**
   * Remove a schedule from the OS scheduler.
   * Called after delete or disable.
   */
  async _removeFromOS(scheduleId) {
    try {
      if (process.platform === 'win32') {
        this._removeFromWindows(scheduleId);
      } else {
        this._removeFromCrontab(scheduleId);
      }
    } catch (err) {
      this.logger.warn('Failed to remove schedule from OS scheduler', {
        id: scheduleId,
        error: err.message
      });
    }
  }

  /**
   * Sync all enabled schedules to OS. Called on startup.
   */
  async syncAllToOS() {
    for (const schedule of this.schedules.values()) {
      await this._syncToOS(schedule);
    }
    this.logger.info('Synced all schedules to OS scheduler');
  }

  // --- Linux/macOS: crontab ---

  _syncToCrontab(schedule, command) {
    const tag = `# loxia-schedule:${schedule.id}`;

    // Read current crontab
    let existing = '';
    try {
      existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' });
    } catch {
      // No crontab yet
    }

    // Remove old entry for this schedule
    const lines = existing.split('\n').filter(l => !l.includes(`loxia-schedule:${schedule.id}`));

    // Add new entry
    lines.push(`${schedule.cronExpression} ${command} ${tag}`);

    // Write back
    const newCrontab = lines.filter(l => l.trim() !== '').join('\n') + '\n';
    execSync('crontab -', { input: newCrontab, encoding: 'utf-8' });

    this.logger.info('Synced schedule to crontab', { id: schedule.id, cron: schedule.cronExpression });
  }

  _removeFromCrontab(scheduleId) {
    let existing = '';
    try {
      existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' });
    } catch {
      return; // No crontab
    }

    const lines = existing.split('\n').filter(l => !l.includes(`loxia-schedule:${scheduleId}`));
    const newCrontab = lines.filter(l => l.trim() !== '').join('\n') + '\n';
    execSync('crontab -', { input: newCrontab, encoding: 'utf-8' });
  }

  // --- Windows: schtasks ---

  _syncToWindows(schedule, command) {
    const taskName = `LoxiaSchedule_${schedule.id}`;

    // Remove existing task if any
    try {
      execSync(`schtasks /Delete /TN "${taskName}" /F 2>nul`, { encoding: 'utf-8' });
    } catch {
      // Task may not exist
    }

    // schtasks doesn't support cron directly — we map common patterns
    // For complex crons, we rely on the internal scheduler as fallback
    const scArgs = this._cronToSchtasksArgs(schedule.cronExpression);
    if (!scArgs) {
      this.logger.warn('Complex cron not supported by Windows Task Scheduler, using internal scheduler only', {
        id: schedule.id,
        cron: schedule.cronExpression
      });
      return;
    }

    execSync(
      `schtasks /Create /TN "${taskName}" /TR "${command}" ${scArgs} /F`,
      { encoding: 'utf-8' }
    );

    this.logger.info('Synced schedule to Windows Task Scheduler', { id: schedule.id, taskName });
  }

  _removeFromWindows(scheduleId) {
    const taskName = `LoxiaSchedule_${scheduleId}`;
    try {
      execSync(`schtasks /Delete /TN "${taskName}" /F 2>nul`, { encoding: 'utf-8' });
    } catch {
      // Task may not exist
    }
  }

  /**
   * Convert simple cron patterns to schtasks /SC arguments.
   * Returns null for complex patterns that schtasks can't express.
   */
  _cronToSchtasksArgs(cron) {
    const parts = cron.trim().split(/\s+/);
    const [min, hour, dom, mon, dow] = parts;

    // Every N minutes: */N * * * *
    if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
      const n = parseInt(min.slice(2), 10);
      return `/SC MINUTE /MO ${n}`;
    }

    // Every hour at minute M: M * * * *
    if (/^\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
      return `/SC HOURLY /ST 00:${min.padStart(2, '0')}`;
    }

    // Daily at H:M: M H * * *
    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
      return `/SC DAILY /ST ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }

    // Weekly on specific days: M H * * D
    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && /^[\d,-]+$/.test(dow)) {
      const dayMap = { 0: 'SUN', 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT' };
      const days = dow.split(',').flatMap(part => {
        if (part.includes('-')) {
          const [a, b] = part.split('-').map(Number);
          const result = [];
          for (let i = a; i <= b; i++) result.push(dayMap[i] || '');
          return result;
        }
        return [dayMap[parseInt(part, 10)] || ''];
      }).filter(Boolean).join(',');
      if (days) return `/SC WEEKLY /D ${days} /ST ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }

    // Monthly on specific day: M H D * *
    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && mon === '*' && dow === '*') {
      return `/SC MONTHLY /D ${dom} /ST ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }

    return null; // Complex pattern — fallback to internal scheduler
  }
}

export default ScheduleService;
export { CRON_PRESETS, parseCron, cronMatchesDate, getNextCronDate };
