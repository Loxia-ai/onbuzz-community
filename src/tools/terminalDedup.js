/**
 * Terminal command deduplication.
 *
 * Goal: prevent the agent from accidentally launching the same command
 * twice while the first invocation is still running. The user's intent
 * is rarely "I really want two copies of `npm test` in flight at once" —
 * it's more often a re-issued tool call after a perceived hang.
 *
 * Trigger: per-agent, deny only if an *identical* command (after
 * whitespace normalization) is CURRENTLY RUNNING for the same agent.
 * Once the prior run has exited (success OR failure), repeats are fine.
 * Different agents running the same command in parallel are also fine.
 *
 * `force: true` override:
 *   - Only honored if the SAME agent has just been denied for the SAME
 *     command (within FORCE_TOKEN_TTL_MS).
 *   - The first call of any command can NEVER bypass dedup with force.
 *     This is the abuse-prevention property: `force` is a response to
 *     a denial, not a preemptive permission.
 *   - When force is honored, a parallel execution is allowed (option A
 *     per design discussion). The token is cleared on use.
 *
 * The functions here are pure where possible and operate on plain
 * arguments (a Map of running commands, a Map of denial tokens, a
 * config). The TerminalTool instance owns those maps.
 */

import { TERMINAL_CONFIG } from '../utilities/constants.js';

/** How long a "you were just denied; you may retry with force" token stays valid. */
export const FORCE_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Normalize a command string for equality comparison. Trims surrounding
 * whitespace and collapses CRLF to LF so a copy-pasted command from a
 * Windows console doesn't fail to match its Unix-typed twin. Internal
 * whitespace, env-var substitutions, etc. are NOT canonicalized — that
 * way `echo $(date)` invocations naturally differ each call and the
 * dedup never falsely fires.
 *
 * @param {string} command
 * @returns {string}
 */
export function normalizeCommand(command) {
  if (typeof command !== 'string') return '';
  return command.replace(/\r\n/g, '\n').trim();
}

/**
 * Locate a currently-running command for `agentId` that matches the
 * given normalized command string. Returns the tracker entry (with
 * commandId) or null.
 *
 * @param {Map<string, object>} commandTracker  Live tracker from TerminalTool.
 * @param {string} agentId
 * @param {string} normalizedCommand
 * @returns {object|null}
 */
export function findRunningDuplicate(commandTracker, agentId, normalizedCommand) {
  if (!commandTracker || !agentId || !normalizedCommand) return null;
  for (const info of commandTracker.values()) {
    if (info.agentId !== agentId) continue;
    if (info.state !== TERMINAL_CONFIG.STATES.RUNNING) continue;
    if (normalizeCommand(info.command) !== normalizedCommand) continue;
    return info;
  }
  return null;
}

/**
 * Decide whether to allow or deny the requested execution. Pure function:
 * accepts the tool's state via parameters and returns a decision.
 *
 * @param {object} args
 * @param {Map<string, object>} args.commandTracker
 * @param {Map<string, object>} args.lastDeniedExec   Mutable; updated on deny / cleared on honored-force.
 * @param {string} args.agentId
 * @param {string} args.command                       Original (unnormalized) command.
 * @param {boolean} [args.force=false]
 * @param {object} [args.config]                      Effective per-agent terminal config.
 * @param {number} [args.now=Date.now()]              Override for tests.
 * @returns {{ allow: true } | { allow: false, reason: string, hint: string, status: object }}
 */
export function checkDedup({
  commandTracker,
  lastDeniedExec,
  agentId,
  command,
  force = false,
  config = {},
  now = Date.now(),
}) {
  // Honor a per-agent kill switch — agent's tool config can opt out
  // (e.g. test agents that need to spam identical commands). Default
  // is enabled.
  if (config.denyDuplicateConcurrentCommands === false) {
    return { allow: true };
  }
  if (!agentId) return { allow: true };

  const normalized = normalizeCommand(command);
  if (!normalized) return { allow: true };

  const duplicate = findRunningDuplicate(commandTracker, agentId, normalized);
  if (!duplicate) {
    // No conflicting in-flight command. `force` is silently ignored —
    // there's nothing to override. Critically: this means an agent
    // that ALWAYS passes force=true gains nothing by doing so. The
    // flag is useless except as a response to a prior denial.
    return { allow: true };
  }

  // There IS a duplicate in flight. Three sub-cases:
  if (force === true) {
    // Force is only honored if a matching denial token exists for THIS
    // agent + THIS command, and isn't expired. That guarantees the
    // agent has actually seen the denial first.
    const token = lastDeniedExec.get(agentId);
    const tokenValid = token
      && token.command === normalized
      && (now - token.deniedAt) <= FORCE_TOKEN_TTL_MS;
    if (tokenValid) {
      lastDeniedExec.delete(agentId);   // single-use token
      return { allow: true };
    }
    // Force without a prior denial → fall through to denial path; record
    // a new token, agent can then retry with force on its NEXT turn.
  }

  // Record the denial so the agent's next turn (with force=true) can
  // legitimately retry. Single-use, agent-scoped.
  lastDeniedExec.set(agentId, { command: normalized, deniedAt: now });

  const elapsedMs = now - new Date(duplicate.startTime).getTime();
  const elapsedSec = Math.max(0, Math.round(elapsedMs / 1000));
  return {
    allow: false,
    reason: 'duplicate-running',
    hint: 'An identical command is still running. Wait for it to finish — the result will arrive on a later turn. ' +
          'If you are SURE you want to launch a parallel copy, retry the same call with force:true.',
    status: {
      commandId:        duplicate.commandId,
      command:          duplicate.command,
      state:            duplicate.state,
      startedAt:        duplicate.startTime,
      elapsedSec,
      workingDirectory: duplicate.workingDirectory,
    },
  };
}

/**
 * Build the "denied" tool result the terminal tool returns to the agent.
 * Shape mirrors the standard run-command failure envelope so existing
 * agent error-handling paths just work.
 *
 * @param {object} decision  Output of checkDedup with allow=false.
 * @param {string} originalCommand
 * @returns {object}
 */
export function denialResult(decision, originalCommand) {
  return {
    success: false,
    deduped: true,
    action: 'run-command',
    command: originalCommand,
    error: 'Duplicate command rejected: ' + decision.hint,
    duplicateOf: decision.status,
  };
}

export default {
  normalizeCommand,
  findRunningDuplicate,
  checkDedup,
  denialResult,
  FORCE_TOKEN_TTL_MS,
};
