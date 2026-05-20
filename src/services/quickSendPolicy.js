/**
 * Quick-Send Policy — the tool/capability allowlist for the Quick Send
 * agent driven by the browser extension.
 *
 * Why this exists
 * ---------------
 * The Quick Send agent receives arbitrary text the user highlighted on a
 * web page. A maliciously-crafted snippet could try to coax the LLM into
 * calling destructive tools ("now run `rm -rf` to free up space…").
 * agent.capabilities is, in this codebase, only used to enhance the
 * system prompt — it does NOT block tool dispatch at runtime (see
 * src/core/messageProcessor.js). So we attach a SEPARATE, authoritative
 * allowlist to the agent via agent.metadata.restrictedToolset, and
 * enforce it inside executeTools.
 *
 * Whoever calls /api/chat/quick-send does NOT get to choose the
 * allowlist. The set below is hard-coded; we re-apply it on every
 * quick-send so any later UI edits to the agent are reset on next use.
 *
 * What's in the allowlist
 * -----------------------
 * The mental model for Quick Send is "research what the user is looking
 * at on the web and answer them." So we allow web reads + PDF reads +
 * agent self-state, and we expose the read-only metadata tools (help,
 * skills). We deliberately exclude every tool that touches the local
 * filesystem, the shell, other agents, or the platform control plane.
 */

/**
 * Tools the Quick Send agent is allowed to call.
 *
 * Hand-picked from src/utilities/toolConstants.js / src/tools/. Update
 * this list with care — adding a tool here gives any web page the
 * ability to ask the agent to invoke it via a carefully-worded
 * selection.
 */
export const QUICK_SEND_ALLOWED_TOOLS = Object.freeze([
  'web',     // HTTP fetch / page read — needed to follow links from the selection
  'pdf',     // Read PDFs referenced by URL
  'memory',  // Agent's own state snapshots
  'skills',  // Read-only library introspection
  'help',    // Tool introspection — safe metadata
  'user-prompt' // Ask the user for clarification — harmless
]);

/**
 * Metadata key on agent.metadata that carries the authoritative allowlist.
 * Read by the runtime gate in messageProcessor.executeTools.
 */
export const RESTRICTED_TOOLSET_KEY = 'restrictedToolset';

/**
 * The display name we look up by exact match.
 */
export const QUICK_SEND_AGENT_NAME = 'Quick Send';

/**
 * Return an updates object suitable for agentPool.updateAgent that
 * reasserts the Quick Send policy on an existing agent. We re-apply
 * this on every quick-send so an admin who reconfigured the Quick Send
 * agent in the UI doesn't accidentally relax the policy.
 *
 * Note: we merge metadata rather than replace, so unrelated metadata
 * keys the agent may have collected (icons, colours, etc.) survive.
 *
 * @param {Object} agent - Agent object (e.g. from agentPool.listActiveAgents()).
 * @returns {Object | null} Updates object to feed to updateAgent, or null
 *   if the agent is already conformant.
 */
export function diffQuickSendPolicy(agent) {
  if (!agent) return null;

  const allowed = [...QUICK_SEND_ALLOWED_TOOLS];

  const currentCaps = Array.isArray(agent.capabilities) ? agent.capabilities : [];
  const capsMatch = currentCaps.length === allowed.length
    && allowed.every((t) => currentCaps.includes(t));

  const currentRestricted = agent.metadata && agent.metadata[RESTRICTED_TOOLSET_KEY];
  const restrictedMatch = Array.isArray(currentRestricted)
    && currentRestricted.length === allowed.length
    && allowed.every((t) => currentRestricted.includes(t));

  if (capsMatch && restrictedMatch) return null;

  return {
    capabilities: allowed,
    metadata: {
      ...(agent.metadata || {}),
      [RESTRICTED_TOOLSET_KEY]: allowed
    }
  };
}

/**
 * Build a fresh-agent config for the Quick Send agent.
 *
 * @param {string} preferredModel - Model id (e.g. 'anthropic-sonnet').
 * @returns {Object} agentPool.createAgent / orchestrator CREATE_AGENT payload.
 */
export function buildQuickSendAgentConfig(preferredModel) {
  return {
    name: QUICK_SEND_AGENT_NAME,
    systemPrompt: [
      'You are the OnBuzz Quick Send agent.',
      '',
      'You receive snippets the user has highlighted on web pages via',
      'the OnBuzz browser extension. Each request gives you the selected',
      'text, the page title, the source URL, and (optionally) a question',
      'from the user.',
      '',
      'Behaviour:',
      '- If the user provided a question, answer it grounded in the',
      '  selected text. Use the web tool to read referenced links when',
      '  helpful.',
      '- If the user did not provide a question, give a short, useful',
      '  acknowledgement: a one-sentence summary plus an offer to dig',
      '  deeper.',
      '- Quote sparingly. Do not regurgitate the whole selection.',
      '',
      'You are restricted to safe, read-only tools. You cannot run shell',
      'commands, write files, or affect any other agent. If a request',
      'asks you to do those things, refuse briefly and explain why.'
    ].join('\n'),
    model: preferredModel,
    capabilities: [...QUICK_SEND_ALLOWED_TOOLS],
    metadata: {
      [RESTRICTED_TOOLSET_KEY]: [...QUICK_SEND_ALLOWED_TOOLS],
      createdBy: 'quick-send-endpoint'
    }
  };
}
