/**
 * Quick Send thread store — sidecar-backed multi-thread storage for
 * the single Quick Send agent driven by the browser extension.
 *
 * Why this exists
 * ---------------
 * MessageProcessor and the scheduler operate on one conversation array
 * per agent (agent.conversations.full.messages). Letting the user run
 * unrelated topics in that single array contaminates every future
 * prompt. We want isolated threads without spinning a new agent per
 * topic, without touching MessageProcessor, and without a DB.
 *
 * The model
 * ---------
 *   - The agent is "tuned" to one thread at a time. Its in-memory
 *     conversations.full.messages IS that thread's history.
 *   - Inactive threads live as sidecar JSON files next to the agent's
 *     existing state files.
 *   - Switching active thread = snapshot current → load target → flip
 *     the pointer. The scheduler keeps running on the same array; the
 *     contents are what changed.
 *
 * IMPORTANT: callers must serialize the swap via withAgentLock and
 * idle-gate via waitForAgentIdle before mutating conversations.full.
 * The scheduler appends to that array mid-turn; swapping during a turn
 * corrupts the running reply.
 *
 * On-disk layout (sibling to agent-<id>-state.json):
 *   <stateDir>/agents/agent-<agentId>-quick-send-threads/
 *     index.json       { version, activeThreadId, threads: [...] }
 *     <threadId>.json  { version, threadId, createdAt, lastUpdated, messages }
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const INDEX_FILENAME = 'index.json';
const INDEX_VERSION = 1;
const TITLE_MAX_LEN = 60;
const RECENTS_CAP = 20;
const DEFAULT_IDLE_TIMEOUT_MS = 2000;
const DEFAULT_IDLE_POLL_MS = 50;

// Agent statuses that block a swap. The scheduler flips to 'busy'
// while consuming a turn. 'active' / 'idle' are fine — the agent is
// either ready or already finished.
const BUSY_STATUSES = new Set(['busy']);

// ── Paths ─────────────────────────────────────────────────────
export function threadsDir(stateDir, agentId) {
  return path.join(stateDir, 'agents', `agent-${agentId}-quick-send-threads`);
}
export function threadFile(stateDir, agentId, threadId) {
  return path.join(threadsDir(stateDir, agentId), `${threadId}.json`);
}
export function indexFile(stateDir, agentId) {
  return path.join(threadsDir(stateDir, agentId), INDEX_FILENAME);
}

// ── Low-level JSON I/O ────────────────────────────────────────
async function readJson(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Write-temp-then-rename. Same-directory rename is atomic on POSIX;
// readers either see the old file or the new file, never a torn one.
async function writeJsonAtomic(p, value) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

// ── Index helpers ─────────────────────────────────────────────
export async function loadIndex({ stateDir, agentId }) {
  return readJson(indexFile(stateDir, agentId));
}

export async function saveIndex({ stateDir, agentId, index }) {
  await writeJsonAtomic(indexFile(stateDir, agentId), index);
}

export async function readThreadMessages({ stateDir, agentId, threadId }) {
  const raw = await readJson(threadFile(stateDir, agentId, threadId));
  if (!raw) return null;
  return Array.isArray(raw.messages) ? raw.messages : [];
}

async function writeThreadMessages({ stateDir, agentId, threadId, messages, createdAt }) {
  await writeJsonAtomic(threadFile(stateDir, agentId, threadId), {
    version: INDEX_VERSION,
    threadId,
    createdAt: createdAt || new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    messages
  });
}

// ── Identity / title heuristics ───────────────────────────────
function newThreadId(prefix = 'th') {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${ts}${rand}`;
}

function deriveTitle({ pageTitle, sourceUrl }) {
  if (typeof pageTitle === 'string' && pageTitle.trim()) {
    return pageTitle.trim().slice(0, TITLE_MAX_LEN);
  }
  const host = hostFromUrl(sourceUrl);
  if (host) return host.slice(0, TITLE_MAX_LEN);
  return 'New thread';
}

function hostFromUrl(url) {
  if (typeof url !== 'string') return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return null; }
}

function newIndexEntry({ id, title, sourceHost, messageCount }) {
  const now = new Date().toISOString();
  return {
    id,
    title,
    createdAt: now,
    lastActivity: now,
    sourceHost: sourceHost || null,
    messageCount: messageCount || 0
  };
}

// ── Per-agent mutex ───────────────────────────────────────────
//
// The Quick Send endpoint is the only writer and the localhost
// extension is the only client, so real contention is near zero. The
// mutex exists to make the swap atomic with respect to itself if two
// requests for the same agent ever race — without it, two concurrent
// swaps could interleave snapshot/load and lose messages.
const _agentLocks = new Map();

export async function withAgentLock(agentId, fn) {
  const prev = _agentLocks.get(agentId) || Promise.resolve();
  let release;
  const ticket = new Promise((r) => { release = r; });
  const chained = prev.then(() => ticket);
  _agentLocks.set(agentId, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (_agentLocks.get(agentId) === chained) {
      _agentLocks.delete(agentId);
    }
  }
}

// ── Idle gate ─────────────────────────────────────────────────
//
// SEND_MESSAGE returns when the message is queued, not when the reply
// has been written. The scheduler then mutates conversations.full
// over multiple ticks. Swapping during that window splits the reply
// across two threads. Block the caller until status is no longer busy
// or until the timeout fires.
export class AgentBusyError extends Error {
  constructor(message, agentId) {
    super(message);
    this.name = 'AgentBusyError';
    this.agentId = agentId;
    this.code = 'AGENT_BUSY';
  }
}

export async function waitForAgentIdle({
  getAgent,
  agentId,
  timeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  intervalMs = DEFAULT_IDLE_POLL_MS
}) {
  const start = Date.now();
  let agent = await getAgent(agentId);
  while (agent && BUSY_STATUSES.has(agent.status)) {
    if (Date.now() - start >= timeoutMs) {
      throw new AgentBusyError(
        `Agent ${agentId} stayed busy for ${timeoutMs}ms; cannot swap thread.`,
        agentId
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    agent = await getAgent(agentId);
  }
  return agent;
}

// ── Migration ─────────────────────────────────────────────────
//
// First time a Quick Send agent meets the store, materialize whatever
// is already in agent.conversations.full.messages as a "legacy"
// thread. Idempotent: a second call returns the existing index.
export async function ensureMigrated({ stateDir, agent }) {
  const existing = await loadIndex({ stateDir, agentId: agent.id });
  if (existing && existing.activeThreadId) return existing;

  const legacyId = `th_legacy_${crypto.randomBytes(3).toString('hex')}`;
  const messages = agent?.conversations?.full?.messages || [];
  await writeThreadMessages({
    stateDir,
    agentId: agent.id,
    threadId: legacyId,
    messages,
    createdAt: agent?.conversations?.full?.lastUpdated || new Date().toISOString()
  });

  const entry = newIndexEntry({
    id: legacyId,
    title: messages.length === 0 ? 'New thread' : 'Earlier conversation',
    sourceHost: null,
    messageCount: messages.length
  });

  const index = {
    version: INDEX_VERSION,
    activeThreadId: legacyId,
    threads: [entry]
  };
  await saveIndex({ stateDir, agentId: agent.id, index });

  agent.metadata = { ...(agent.metadata || {}), activeThreadId: legacyId };
  return index;
}

// ── Mint a new thread ─────────────────────────────────────────
//
// Creates an empty thread, prepends it to the index, prunes past
// RECENTS_CAP. Does NOT set it active — caller decides whether to
// swap. Returns the new index entry.
export async function mintThread({ stateDir, agent, index, seed = {} }) {
  const id = newThreadId();
  const title = deriveTitle({ pageTitle: seed.pageTitle, sourceUrl: seed.sourceUrl });
  const sourceHost = hostFromUrl(seed.sourceUrl);

  await writeThreadMessages({
    stateDir,
    agentId: agent.id,
    threadId: id,
    messages: [],
    createdAt: new Date().toISOString()
  });

  const entry = newIndexEntry({ id, title, sourceHost, messageCount: 0 });
  index.threads = [entry, ...index.threads];

  if (index.threads.length > RECENTS_CAP) {
    const removed = index.threads.splice(RECENTS_CAP);
    await Promise.all(removed.map(async (r) => {
      try { await fs.unlink(threadFile(stateDir, agent.id, r.id)); }
      catch { /* ignore — file may already be gone */ }
    }));
  }

  return entry;
}

// ── Swap ──────────────────────────────────────────────────────
//
// Caller MUST hold withAgentLock and have already idle-gated. The
// in-memory array is mutated in place so any reference held elsewhere
// (scheduler queues, conversationQuery lenses) sees the new contents.
export async function swapToThread({ stateDir, agent, index, targetId }) {
  if (!index.threads.some((t) => t.id === targetId)) {
    throw new Error(`Unknown thread id: ${targetId}`);
  }
  const fromId = index.activeThreadId;
  if (fromId === targetId) return;

  // 1. Snapshot the current array to its sidecar so we can come back.
  if (fromId) {
    const currentMessages = agent.conversations?.full?.messages || [];
    const currentEntry = index.threads.find((t) => t.id === fromId);
    await writeThreadMessages({
      stateDir,
      agentId: agent.id,
      threadId: fromId,
      messages: currentMessages,
      createdAt: currentEntry?.createdAt
    });
    if (currentEntry) {
      currentEntry.messageCount = currentMessages.length;
      currentEntry.lastActivity = new Date().toISOString();
    }
  }

  // 2. Load target into the same array reference. Replace contents in
  //    place so the scheduler keeps seeing the same array identity.
  const targetMessages = (await readThreadMessages({
    stateDir, agentId: agent.id, threadId: targetId
  })) || [];

  if (!agent.conversations) {
    agent.conversations = { full: { messages: [], lastUpdated: new Date().toISOString() } };
  }
  if (!agent.conversations.full) {
    agent.conversations.full = { messages: [], lastUpdated: new Date().toISOString() };
  }
  agent.conversations.full.messages.length = 0;
  for (const m of targetMessages) agent.conversations.full.messages.push(m);
  agent.conversations.full.lastUpdated = new Date().toISOString();

  // 3. Flip the pointer + mirror the target's source anchor so the
  //    scheduler can read it directly from agent metadata when it
  //    builds the system prompt for the next turn. Mirroring is
  //    intentional: the canonical store is the index entry, but the
  //    scheduler shouldn't need a filesystem hop on every turn.
  const targetEntry = index.threads.find((t) => t.id === targetId);
  index.activeThreadId = targetId;
  agent.metadata = {
    ...(agent.metadata || {}),
    activeThreadId: targetId,
    activeSourceAnchor: targetEntry?.sourceAnchor || null
  };
  await saveIndex({ stateDir, agentId: agent.id, index });
}

// ── Bookkeeping for the active thread after a send ────────────
//
// Called by the endpoint right after orchestrator queues the message.
// We don't await the reply (the scheduler is async), so messageCount
// here reflects the current length — the assistant reply will land
// later and be captured on the next swap or list call.
export async function touchActiveThread({ stateDir, agent, index, seed = {} }) {
  const entry = index.threads.find((t) => t.id === index.activeThreadId);
  if (!entry) return;
  entry.lastActivity = new Date().toISOString();
  entry.messageCount = agent.conversations?.full?.messages?.length || 0;

  // Late-fill: if the first send on a thread arrives with a real page
  // title and the thread title is still the generic "New thread"
  // placeholder, upgrade it.
  if (entry.title === 'New thread') {
    const better = deriveTitle({ pageTitle: seed.pageTitle, sourceUrl: seed.sourceUrl });
    if (better && better !== 'New thread') entry.title = better;
  }
  if (!entry.sourceHost) {
    const host = hostFromUrl(seed.sourceUrl);
    if (host) entry.sourceHost = host;
  }
  await saveIndex({ stateDir, agentId: agent.id, index });
}

// ── List for the side panel ───────────────────────────────────
export async function listThreads({ stateDir, agentId }) {
  const idx = await loadIndex({ stateDir, agentId });
  if (!idx) return { activeThreadId: null, threads: [] };
  const sorted = [...idx.threads].sort((a, b) =>
    new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime()
  );
  return { activeThreadId: idx.activeThreadId, threads: sorted };
}

// ── Test helpers ──────────────────────────────────────────────
// Exported only so tests can reset the module-scoped mutex map between
// suites. Production code never calls these.
export function _resetLocksForTests() {
  _agentLocks.clear();
}
export const _internals = { RECENTS_CAP, INDEX_VERSION, BUSY_STATUSES };
