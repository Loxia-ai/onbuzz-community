/**
 * Cascade-on-delete service for platformControlTool.
 *
 * Independent of the tool's permission logic — that gates whether a
 * delete is allowed; THIS module does the actual cleanup once the
 * delete is approved. Modular + testable: every dependency is injected,
 * each step is independently observable, and failures in earlier steps
 * don't abort later ones unless `strict:true`.
 *
 * Why this lives in its own file:
 *   - The tool's dispatch is already long; embedding the cleanup choreography
 *     would obscure the permission logic.
 *   - The cleanup needs to be testable WITHOUT spinning up real services
 *     (real ScheduleService writes files, real AgentPool spawns processes).
 *   - Future deletions (delete-team-with-cascade, delete-agent-with-flow-cleanup)
 *     can plug new steps in here without touching the tool dispatcher.
 *
 * Step order for cascadeDeleteAgent — in this exact order, on purpose:
 *   1. Schedules: deleted FIRST so they can't fire mid-cleanup and re-spawn work.
 *   2. Memories: small file deletion; if it fails, agent state is still cleanable.
 *   3. Team memberships: removes the agentId from every team that contains it.
 *   4. The agent itself (agentPool.deleteAgent): handles attachments, terminal
 *      processes, visual editor, persistent state — all already implemented there.
 *
 * Each step yields an entry on the report. The caller surfaces this to
 * the agent making the call so they know what happened.
 */

/**
 * @param {object} args
 * @param {string} args.agentId
 * @param {object} args.scheduleService   — `listSchedules`, `deleteSchedule`
 * @param {object} args.memoryService     — `deleteMemoryFile(agentId)`
 * @param {object} args.stateManager      — `getAllTeams`, `removeAgentFromTeam`
 * @param {object} args.agentPool         — `deleteAgent(agentId)`
 * @param {object} [args.logger]          — { warn(msg, meta) }
 * @param {boolean} [args.strict=false]   — abort on first failure
 * @returns {Promise<{
 *   schedulesDeleted: number,
 *   memoriesCleaned: boolean,
 *   teamsLeft: string[],
 *   agentDeleted: boolean,
 *   errors: Array<{ step: string, error: string }>,
 * }>}
 */
export async function cascadeDeleteAgent({
  agentId,
  scheduleService,
  memoryService,
  stateManager,
  agentPool,
  logger,
  strict = false,
}) {
  if (!agentId) throw new Error('cascadeDeleteAgent: agentId is required');

  const report = {
    schedulesDeleted: 0,
    memoriesCleaned: false,
    teamsLeft: [],
    agentDeleted: false,
    errors: [],
  };
  const log = logger || { warn() {} };

  // Wrapper so each step is independently fail-tolerant. In strict mode,
  // the first failure throws and skips the rest.
  const step = async (name, fn) => {
    try { await fn(); }
    catch (err) {
      const msg = err?.message || String(err);
      report.errors.push({ step: name, error: msg });
      log.warn(`[cascadeDeleteAgent] step "${name}" failed`, { agentId, error: msg });
      if (strict) throw err;
    }
  };

  // 1. Schedules
  await step('schedules', async () => {
    if (!scheduleService) return;
    const all = typeof scheduleService.listSchedules === 'function'
      ? scheduleService.listSchedules() : [];
    const owned = (Array.isArray(all) ? all : []).filter(s =>
      s && s.targetType === 'agent' && s.targetId === agentId);
    for (const s of owned) {
      await scheduleService.deleteSchedule(s.id);
      report.schedulesDeleted++;
    }
  });

  // 2. Memory file
  await step('memories', async () => {
    if (!memoryService || typeof memoryService.deleteMemoryFile !== 'function') return;
    const ok = await memoryService.deleteMemoryFile(agentId);
    report.memoriesCleaned = !!ok;
  });

  // 3. Team memberships
  await step('teams', async () => {
    if (!stateManager || typeof stateManager.getAllTeams !== 'function') return;
    const teams = await stateManager.getAllTeams();
    const containing = (Array.isArray(teams) ? teams : []).filter(t =>
      t && Array.isArray(t.memberAgentIds) && t.memberAgentIds.includes(agentId));
    for (const t of containing) {
      await stateManager.removeAgentFromTeam(t.id, agentId);
      report.teamsLeft.push(t.id);
    }
  });

  // 4. The agent record itself.
  await step('agentPool', async () => {
    if (!agentPool || typeof agentPool.deleteAgent !== 'function') {
      throw new Error('agentPool.deleteAgent unavailable');
    }
    await agentPool.deleteAgent(agentId);
    report.agentDeleted = true;
  });

  return report;
}

/**
 * Team delete is much simpler — `stateManager.deleteTeam` already
 * removes the team record (and the memberships die with it because
 * they live INSIDE the team object, not in a separate join table).
 *
 * Kept here for symmetry and to centralize "what does cascade-delete
 * mean per resource type" in one file.
 */
export async function cascadeDeleteTeam({ teamId, stateManager, logger }) {
  if (!teamId) throw new Error('cascadeDeleteTeam: teamId is required');
  const log = logger || { warn() {} };
  const report = { teamDeleted: false, errors: [] };
  try {
    await stateManager.deleteTeam(teamId);
    report.teamDeleted = true;
  } catch (err) {
    const msg = err?.message || String(err);
    report.errors.push({ step: 'team', error: msg });
    log.warn('[cascadeDeleteTeam] failed', { teamId, error: msg });
    throw err;       // unlike agent cascade, team-delete is a single op; rethrow.
  }
  return report;
}

export default { cascadeDeleteAgent, cascadeDeleteTeam };
