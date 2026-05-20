/**
 * Quick Send history policy — separates the persisted transcript from
 * the model payload so a Quick Send thread can stay conversational
 * without re-injecting the highlighted source text on every turn.
 *
 * The architecture
 * ----------------
 * A Quick Send thread is a SOURCE-GROUNDED CHAT. Each thread owns a
 * `sourceAnchor` — a typed object describing the page text the user
 * highlighted, plus metadata (page title, URL, surrounding context).
 * The anchor is structural state, not a chat turn:
 *
 *   - Stored on the thread's index entry: `target.sourceAnchor = {...}`
 *   - Mirrored to `agent.metadata.activeSourceAnchor` so the scheduler
 *     can read it without a filesystem hop.
 *   - Injected into the system prompt at dispatch time by the
 *     scheduler via `buildSourceAnchorBlock`.
 *
 * Transcript vs model payload
 * ---------------------------
 * The transcript array `agent.conversations.full.messages` holds ONLY
 * the user's typed questions + assistant replies — no selection blocks.
 * The side panel polls and renders that array as the chat history; the
 * source itself is surfaced separately by exposing `thread.sourceAnchor`
 * on the poll endpoint.
 *
 * What the scheduler hands to the provider on a Quick Send turn:
 *
 *   [system]     base Quick Send prompt
 *                + source anchor block (selectedText + metadata, ONCE)
 *   [user]       typed question N-K
 *   [assistant]  reply N-K
 *   ... (bounded recent window)
 *   [user]       typed question N (current)
 *
 * New selection vs follow-up
 * --------------------------
 * The endpoint fingerprints the incoming `selected_text` (whitespace-
 * normalized SHA-256 truncated to 16 chars) and compares against the
 * thread's stored fingerprint:
 *
 *   - Different fingerprint → NEW selection.
 *       Prior LIVE turns are stamped with `quickSendArchivedAt` and the
 *       new `sourceAnchor` is written to the thread. The transcript
 *       still contains the archived turns (display intact); the
 *       scheduler's trim drops them.
 *   - Same fingerprint → FOLLOW-UP.
 *       Anchor unchanged. New user turn is just the typed question; the
 *       scheduler reuses the existing anchor in the system prompt and
 *       walks back at most QUICK_SEND_WINDOW recent live turns.
 */

import crypto from 'crypto';

/**
 * Max number of LIVE messages handed to the provider on any one turn.
 * Includes the just-appended user message. Plain tail — the source
 * anchor is no longer inside the message array, so anchor pinning
 * isn't needed.
 *
 * Why 3: covers [last user, last assistant, current user] for normal
 * follow-up cadence. Quick Send's restricted toolset keeps multi-step
 * tool chains rare, so we don't routinely lose tool_use / tool_result
 * pairs at the cut.
 */
export const QUICK_SEND_WINDOW = 3;

/**
 * Marker field stamped onto messages from a previous selection. The
 * transcript keeps them so the side panel can show them; the
 * scheduler's trim drops them from what reaches the provider.
 */
export const ARCHIVED_KEY = 'quickSendArchivedAt';

/**
 * Whitespace-normalized SHA-256 (first 16 hex) of the selection. Used
 * to detect "is this still the same source the thread was anchored on?"
 * Returns null for empty / non-string input; callers treat null as
 * "no fingerprint available" → fall back to new-selection mode.
 */
export function fingerprintSelection(selectedText) {
  if (typeof selectedText !== 'string') return null;
  const normalized = selectedText.trim();
  if (!normalized) return null;
  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Classify an incoming Quick Send against the thread's last known
 * selection fingerprint.
 *
 * @returns {'new-selection' | 'follow-up'}
 */
export function decideMode({ incomingFingerprint, storedFingerprint }) {
  if (!storedFingerprint) return 'new-selection';
  if (!incomingFingerprint) return 'new-selection';
  return incomingFingerprint === storedFingerprint ? 'follow-up' : 'new-selection';
}

/**
 * Stamp every currently-live message with `quickSendArchivedAt`, in
 * place. Idempotent for already-archived entries. Returns the freshly
 * archived count for the dispatch log line.
 */
export function archiveLiveMessages(messages, atIso = new Date().toISOString()) {
  if (!Array.isArray(messages)) return 0;
  let count = 0;
  for (const m of messages) {
    if (m && typeof m === 'object' && !m[ARCHIVED_KEY]) {
      m[ARCHIVED_KEY] = atIso;
      count += 1;
    }
  }
  return count;
}

/**
 * The bounded model-input slice. Drops archived messages, then keeps
 * the last `window` live messages (plain tail).
 *
 * Returns a NEW array. Never mutates the input.
 *
 * Caveat: if a tool_use straddles the cut point from its tool_result,
 * the model may see an orphaned tool_use. Acceptable for Quick Send's
 * small allowlist and small WINDOW; revisit if either grows.
 */
export function trimMessagesForModel(messages, { window = QUICK_SEND_WINDOW } = {}) {
  if (!Array.isArray(messages)) return [];
  const live = messages.filter((m) => m && typeof m === 'object' && !m[ARCHIVED_KEY]);
  if (live.length <= window) return live;
  return live.slice(-window);
}

/**
 * Whether the scheduler should apply Quick Send's policy (trim +
 * anchor in system prompt). Keyed on the agent's exact name rather
 * than on agent.metadata.restrictedToolset so future non-Quick-Send
 * agents with their own restricted toolsets don't inherit this.
 */
export function shouldApplyQuickSendPolicy(agent) {
  return Boolean(agent && agent.name === 'Quick Send');
}

// ── Source anchor ──────────────────────────────────────────────────

/**
 * Build a typed source-anchor record from a Quick Send request. This
 * is the structured state that gets stored on the thread index entry
 * and mirrored to `agent.metadata.activeSourceAnchor`.
 *
 * `fingerprint` and `updatedAt` are filled by the helper so callers
 * pass just the raw request fields. `null` values are normalized away.
 */
export function composeSourceAnchor({
  selectedText,
  pageTitle = null,
  sourceUrl = null,
  surroundingText = null,
  updatedAt = new Date().toISOString()
}) {
  if (typeof selectedText !== 'string' || !selectedText.trim()) return null;
  return {
    selectedText,
    pageTitle: pageTitle || null,
    sourceUrl: sourceUrl || null,
    surroundingText: surroundingText || null,
    fingerprint: fingerprintSelection(selectedText),
    updatedAt
  };
}

/**
 * Format the source anchor as a system-prompt block. Returned as a
 * standalone string so the scheduler can append it to whatever
 * augmented system prompt it has already assembled. Returns null if
 * there's nothing to inject — caller should treat that as "skip."
 *
 * Format intentionally mirrors the page-context layout the model has
 * already seen historically in user-message bodies, so existing
 * system-prompt instructions ("answer grounded in the selected text")
 * continue to read naturally.
 */
export function buildSourceAnchorBlock(anchor) {
  if (!anchor || typeof anchor.selectedText !== 'string') return null;
  if (!anchor.selectedText.trim()) return null;
  const lines = ['', '── Source context (highlighted by the user) ──'];
  if (anchor.pageTitle) lines.push(`Page title: ${anchor.pageTitle}`);
  if (anchor.sourceUrl) lines.push(`Source URL: ${anchor.sourceUrl}`);
  lines.push('', 'Selected text:', anchor.selectedText);
  if (anchor.surroundingText) {
    lines.push('', 'Surrounding context:', anchor.surroundingText);
  }
  lines.push('── End source context ──');
  return lines.join('\n');
}

/**
 * Resolve the user-turn content the orchestrator persists into the
 * transcript. Just the typed question; the source itself lives on
 * the thread, not in the chat history.
 *
 * On the first turn of a new selection the user may not have typed
 * anything (clicked "Quick Send" on a highlight with no question);
 * the placeholder keeps the conversation array shape valid and is
 * understood by the system prompt's "if no question, give a short
 * acknowledgement" guidance.
 */
export function composeQuickSendUserMessage({ userMessage }) {
  if (typeof userMessage === 'string' && userMessage.trim().length > 0) {
    return userMessage;
  }
  return 'Please review the highlighted source and offer a brief, useful response.';
}
