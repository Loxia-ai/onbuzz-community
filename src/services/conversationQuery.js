/**
 * conversationQuery — pure query functions over a conversation archive.
 *
 * This is a STATELESS LENS over `conversations.full.messages[]`. It does not
 * hold a copy of the data, does not persist anything, and does not do any
 * I/O. Every exported function takes a messages array as input and returns
 * a query result. Callers (memoryTool.reminisce) are responsible for
 * fetching the array from wherever it lives (agentPool → in-memory agent
 * object, which itself is sourced from stateManager's on-disk archive).
 *
 * The archive itself is the single source of truth; this module is its
 * query surface.
 *
 * Stable-pointer contract
 * -----------------------
 * Returned entries ALWAYS surface `messageId` as the canonical pointer.
 * `messageId` is immutable (assigned at message creation, never rewritten,
 * never reassigned) and survives compaction because compaction only writes
 * to `conversations[model].messages[]`, never mutates `conversations.full`.
 * The agent is free to bookmark a `messageId` in turn 5 and resolve it in
 * turn 500.
 *
 * Array indices are NOT surfaced to the agent — they're used only for
 * intra-call pagination (offset/limit) and never handed out as long-term
 * bookmarks.
 *
 * Size guardrails
 * ---------------
 * `capEntries(entries, maxBytes)` enforces a byte budget across any list
 * of returned entries. Every mode funnels through it so no single query
 * can blow out the agent's context window.
 */

// ── Constants ────────────────────────────────────────────────────────────

/**
 * Per-call response cap applied AFTER JSON serialization. 32 KB is ~8K
 * tokens — a comfortable upper bound on what a single tool result should
 * inject into the current conversation.
 */
export const DEFAULT_MAX_BYTES = 32 * 1024;

/** Default messages-per-response for range/byTool. */
export const DEFAULT_LIMIT = 20;

/** Hard maximum to prevent abuse / accidents. */
export const HARD_MAX_LIMIT = 100;

/** Default search results. */
export const DEFAULT_MAX_RESULTS = 10;

/** Hard maximum search results. */
export const HARD_MAX_RESULTS = 50;

/** Around-context: messages before/after the target by default. */
export const DEFAULT_AROUND_BEFORE = 3;
export const DEFAULT_AROUND_AFTER = 3;

/** Maximum around-context window. */
export const HARD_MAX_AROUND = 20;

/** Overview timeline marker count (sparse checkpoints). */
export const OVERVIEW_TIMELINE_SIZE = 20;

/** Default content-truncation for slim entries. */
export const DEFAULT_CONTENT_TRUNCATE = 500;

/** Snippet length around a search hit. */
export const SEARCH_SNIPPET_CONTEXT = 60;

// ── Helpers (internal) ───────────────────────────────────────────────────

/**
 * Extract a message's creation timestamp. Messages in the archive carry
 * `createdAt` (per stateManager schema) but some older/synthetic ones use
 * `timestamp`. Tolerant read, both supported.
 * @private
 */
function _messageAt(m) {
  return m?.createdAt || m?.timestamp || null;
}

/**
 * Message content as a searchable string. Messages store `content` as
 * string in the normal path, but some older / array-form entries store it
 * as `[{type:'text', text:'…'}]` — both normalized here.
 * @private
 */
function _contentString(m) {
  const c = m?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map(p => (typeof p === 'string' ? p : p?.text || '')).join('');
  }
  if (c == null) return '';
  return String(c);
}

/**
 * Flatten all tool-call inputs on a message into a single searchable
 * string. Tool RESULTS are intentionally excluded — they'd be noisy and
 * the user explicitly opted against including them in search scope.
 * @private
 */
function _toolArgsString(m) {
  const execs = Array.isArray(m?.toolExecutions) ? m.toolExecutions : [];
  if (execs.length === 0) return '';
  return execs.map(e => {
    if (!e) return '';
    const parts = [];
    if (e.toolId) parts.push(String(e.toolId));
    if (e.input != null) {
      try { parts.push(typeof e.input === 'string' ? e.input : JSON.stringify(e.input)); }
      catch { parts.push(String(e.input)); }
    }
    return parts.join(' ');
  }).join('\n');
}

/**
 * Best-effort token count for a message. Uses stored tokenUsage when
 * available (exact); falls back to a char-based estimate (chars/4) so the
 * overview + slim entries always have a number to show.
 * @private
 */
function _tokenCountOf(m) {
  const t = m?.tokenUsage;
  if (t && typeof t.totalTokens === 'number') return t.totalTokens;
  if (t && typeof t.total_tokens === 'number') return t.total_tokens;
  const s = _contentString(m);
  return Math.ceil(s.length / 4);
}

/**
 * Check whether a message has at least one tool execution.
 * @private
 */
function _hasToolCalls(m) {
  return Array.isArray(m?.toolExecutions) && m.toolExecutions.length > 0;
}

/**
 * Truncate a content string to `max` chars with a trailing "(N more chars)"
 * marker. Never touches messages with shorter content.
 * @private
 */
function _truncateContent(s, max = DEFAULT_CONTENT_TRUNCATE) {
  if (typeof s !== 'string') return '';
  if (s.length <= max) return s;
  return s.slice(0, max) + `…(${s.length - max} more chars)`;
}

/**
 * Shape a raw message into the slim default response entry. Hides index
 * on purpose — only `messageId` and `at` are stable pointers.
 * @private
 */
function _slimMessage(m, detail = 'default') {
  const base = {
    messageId: m?.id || null,
    role: m?.role || 'unknown',
    at: _messageAt(m),
    tokenCount: _tokenCountOf(m),
    hasToolCalls: _hasToolCalls(m),
  };
  const content = _contentString(m);

  if (detail === 'full') {
    return {
      ...base,
      content,
      toolExecutions: Array.isArray(m?.toolExecutions) ? m.toolExecutions : [],
      contextReferences: Array.isArray(m?.contextReferences) ? m.contextReferences : [],
      model: m?.metadata?.model || null,
    };
  }
  return { ...base, content: _truncateContent(content) };
}

/**
 * Clamp a number into [min, max]. Null/undefined/NaN uses `fallback`.
 * @private
 */
function _clamp(n, min, max, fallback) {
  const v = Number.isFinite(n) ? n : fallback;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * Try to parse an ISO-ish string; returns epoch ms or null.
 * @private
 */
function _isoToMs(s) {
  if (typeof s !== 'string') return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * Opaque cursor: base64(JSON). Agent never inspects it; it's passed back
 * verbatim to continue pagination. Encoding is side-effect-free.
 */
export function encodeCursor(obj) {
  try {
    const s = JSON.stringify(obj || {});
    return Buffer.from(s, 'utf-8').toString('base64');
  } catch {
    return null;
  }
}

export function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length === 0) return null;
  try {
    const s = Buffer.from(cursor, 'base64').toString('utf-8');
    const obj = JSON.parse(s);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Enforce a byte budget across an array of entries. Serializes the array,
 * and if it exceeds `maxBytes`, drops trailing entries one at a time until
 * it fits. Attaches a `_truncated` marker with the dropped count so
 * callers can surface it. Returns { entries, truncatedCount }.
 */
export function capEntries(entries, maxBytes = DEFAULT_MAX_BYTES) {
  if (!Array.isArray(entries)) return { entries: [], truncatedCount: 0 };
  const jsonSize = (arr) => Buffer.byteLength(JSON.stringify(arr), 'utf-8');
  if (jsonSize(entries) <= maxBytes) return { entries, truncatedCount: 0 };
  const trimmed = entries.slice();
  let dropped = 0;
  while (trimmed.length > 0 && jsonSize(trimmed) > maxBytes) {
    trimmed.pop();
    dropped++;
  }
  return { entries: trimmed, truncatedCount: dropped };
}

// ── Public: overview ─────────────────────────────────────────────────────

/**
 * One-shot "where have I been." Returns archive-wide stats + a sparse
 * timeline of ~20 markers evenly distributed across the archive so the
 * agent can see the shape of its own history at a glance.
 *
 * Each timeline entry carries a `messageId` — those are the stable
 * pointers the agent can use to dive in with `around` / `range`.
 *
 * @param {Array<Object>} messages
 * @returns {{
 *   totalMessages: number,
 *   firstAt: string|null,
 *   lastAt: string|null,
 *   totalApproxTokens: number,
 *   timeline: Array<{ at: string|null, role: string, messageId: string|null, snippet: string }>
 * }}
 */
export function overview(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const total = list.length;
  if (total === 0) {
    return {
      totalMessages: 0,
      firstAt: null,
      lastAt: null,
      totalApproxTokens: 0,
      timeline: [],
    };
  }

  const firstAt = _messageAt(list[0]);
  const lastAt = _messageAt(list[total - 1]);
  const totalApproxTokens = list.reduce((n, m) => n + _tokenCountOf(m), 0);

  // Sparse timeline: pick up to OVERVIEW_TIMELINE_SIZE evenly-spaced markers.
  const markers = [];
  const size = Math.min(OVERVIEW_TIMELINE_SIZE, total);
  for (let i = 0; i < size; i++) {
    // Spread indices across [0, total-1] so first + last are always included.
    const idx = size === 1 ? 0 : Math.round((i * (total - 1)) / (size - 1));
    const m = list[idx];
    markers.push({
      at: _messageAt(m),
      role: m?.role || 'unknown',
      messageId: m?.id || null,
      snippet: _truncateContent(_contentString(m), 80),
    });
  }

  return {
    totalMessages: total,
    firstAt,
    lastAt,
    totalApproxTokens,
    timeline: markers,
  };
}

// ── Public: range ────────────────────────────────────────────────────────

/**
 * Slice the archive by index (offset+limit) and/or timestamp (from/to).
 * Both filters compose — a timestamp window is applied first, then
 * offset/limit paginates within that window.
 *
 * @param {Array<Object>} messages
 * @param {Object} params
 * @param {string} [params.from]    ISO timestamp lower bound (inclusive)
 * @param {string} [params.to]      ISO timestamp upper bound (inclusive)
 * @param {number} [params.offset]  0-based offset within filtered window
 * @param {number} [params.limit]   Max entries returned (clamped to HARD_MAX_LIMIT)
 * @param {'default'|'full'} [params.detail]
 * @param {number} [params.maxBytes]
 */
export function range(messages, params = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const fromMs = _isoToMs(params.from);
  const toMs = _isoToMs(params.to);
  const offset = _clamp(params.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = _clamp(params.limit, 1, HARD_MAX_LIMIT, DEFAULT_LIMIT);
  const detail = params.detail === 'full' ? 'full' : 'default';
  const maxBytes = _clamp(params.maxBytes, 1024, 1024 * 1024, DEFAULT_MAX_BYTES);

  // Apply timestamp filter first.
  const windowed = list.filter(m => {
    const t = _isoToMs(_messageAt(m));
    if (t == null) return fromMs == null && toMs == null; // untimestamped: keep only with no filter
    if (fromMs != null && t < fromMs) return false;
    if (toMs != null && t > toMs) return false;
    return true;
  });

  const total = windowed.length;
  const sliced = windowed.slice(offset, offset + limit);
  const shaped = sliced.map(m => _slimMessage(m, detail));
  const { entries, truncatedCount } = capEntries(shaped, maxBytes);

  return {
    messages: entries,
    total,
    offset,
    limit,
    hasMore: offset + entries.length < total,
    truncatedByBytes: truncatedCount,
  };
}

// ── Public: search ───────────────────────────────────────────────────────

/**
 * Substring search across message content + tool-call arguments. Case-
 * insensitive. Returns slim match entries with `snippet` (a window around
 * the first hit) and `highlightRanges` (offsets WITHIN the snippet).
 *
 * Scope: `content` + `toolExecutions[*].toolId + input`.
 * Explicitly NOT searched: tool outputs/results, reasoning fields,
 * metadata, context references.
 */
export function search(messages, params = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const raw = typeof params.query === 'string' ? params.query : '';
  const q = raw.toLowerCase().trim();
  if (q.length === 0) {
    return { matches: [], total: 0, hasMore: false, cursor: null, truncatedByBytes: 0 };
  }
  const role = typeof params.role === 'string' ? params.role : null;
  const maxResults = _clamp(params.maxResults, 1, HARD_MAX_RESULTS, DEFAULT_MAX_RESULTS);
  const maxBytes = _clamp(params.maxBytes, 1024, 1024 * 1024, DEFAULT_MAX_BYTES);

  // Cursor: `{ lastMessageId }` — skip forward past messages up to and
  // including the one with that id. Agent opaquely passes it back.
  const cursorObj = decodeCursor(params.cursor);
  const lastMessageId = cursorObj?.lastMessageId || null;

  // Locate cursor position (first index AFTER the cursor's lastMessageId).
  let startIdx = 0;
  if (lastMessageId) {
    const i = list.findIndex(m => m?.id === lastMessageId);
    startIdx = i >= 0 ? i + 1 : 0;
  }

  const matches = [];
  let total = 0;
  // ID of the LAST RETURNED match — cursor points at this so resumption
  // picks up exactly where the previous page ended. NOT the "last match
  // seen during counting"; that would cause resumption to skip results.
  let lastReturnedHitId = null;

  for (let i = startIdx; i < list.length; i++) {
    const m = list[i];
    if (role && m?.role !== role) continue;

    const content = _contentString(m);
    const toolArgs = _toolArgsString(m);

    // Find first hit in either scope. We return the content snippet if the
    // hit is in content; otherwise a tool-args snippet. This keeps the
    // matched text proximate to what the agent searched for.
    const contentIdx = content.toLowerCase().indexOf(q);
    const toolIdx = contentIdx >= 0 ? -1 : toolArgs.toLowerCase().indexOf(q);
    if (contentIdx < 0 && toolIdx < 0) continue;

    total++;
    if (matches.length >= maxResults) continue; // keep counting total but stop accumulating
    // Only update cursor anchor for RETURNED matches.
    lastReturnedHitId = m?.id || lastReturnedHitId;

    const source = contentIdx >= 0 ? 'content' : 'tool_args';
    const baseText = contentIdx >= 0 ? content : toolArgs;
    const hitAt = contentIdx >= 0 ? contentIdx : toolIdx;

    // Build snippet: SEARCH_SNIPPET_CONTEXT chars on each side of the hit.
    const start = Math.max(0, hitAt - SEARCH_SNIPPET_CONTEXT);
    const end = Math.min(baseText.length, hitAt + q.length + SEARCH_SNIPPET_CONTEXT);
    let snippet = baseText.slice(start, end);
    const relStart = hitAt - start;
    // Mark truncation with ellipses so the agent knows the snippet is a window.
    if (start > 0) snippet = '…' + snippet;
    if (end < baseText.length) snippet = snippet + '…';
    const highlightOffset = relStart + (start > 0 ? 1 : 0); // account for prepended ellipsis

    matches.push({
      messageId: m?.id || null,
      role: m?.role || 'unknown',
      at: _messageAt(m),
      source,                       // where the hit landed: 'content' | 'tool_args'
      snippet,
      highlightRanges: [[highlightOffset, highlightOffset + q.length]],
    });
  }

  const { entries, truncatedCount } = capEntries(matches, maxBytes);
  const hasMore = matches.length < total; // more results exist beyond maxResults
  const cursor = hasMore
    ? encodeCursor({ lastMessageId: lastReturnedHitId, query: raw, role })
    : null;

  return {
    matches: entries,
    total,
    hasMore,
    cursor,
    truncatedByBytes: truncatedCount,
  };
}

// ── Public: around ───────────────────────────────────────────────────────

/**
 * Fetch N messages before + N after a given `messageId`. Clamps against
 * archive start / end. Returns `targetFound: false` when the id doesn't
 * resolve (archive was pruned, or id was hallucinated by the agent).
 */
export function around(messages, params = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const messageId = typeof params.messageId === 'string' ? params.messageId : '';
  const before = _clamp(params.before, 0, HARD_MAX_AROUND, DEFAULT_AROUND_BEFORE);
  const after = _clamp(params.after, 0, HARD_MAX_AROUND, DEFAULT_AROUND_AFTER);
  const detail = params.detail === 'full' ? 'full' : 'default';
  const maxBytes = _clamp(params.maxBytes, 1024, 1024 * 1024, DEFAULT_MAX_BYTES);

  const idx = messageId ? list.findIndex(m => m?.id === messageId) : -1;
  if (idx < 0) {
    return { messages: [], center: messageId || null, targetFound: false, truncatedByBytes: 0 };
  }
  const start = Math.max(0, idx - before);
  const end = Math.min(list.length, idx + after + 1);
  const shaped = list.slice(start, end).map(m => _slimMessage(m, detail));
  const { entries, truncatedCount } = capEntries(shaped, maxBytes);

  return {
    messages: entries,
    center: messageId,
    targetFound: true,
    truncatedByBytes: truncatedCount,
  };
}

// ── Public: byTool ───────────────────────────────────────────────────────

/**
 * Flatten every tool execution across the archive, optionally filtered by
 * toolId. Each returned entry is ONE tool call — so a single message with
 * three tool_calls yields three entries, each pointing back at the same
 * `messageId` so the agent can `around` into the surrounding context.
 */
export function byTool(messages, params = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const toolId = typeof params.toolId === 'string' ? params.toolId : null;
  const limit = _clamp(params.limit, 1, HARD_MAX_LIMIT, DEFAULT_LIMIT);
  const maxBytes = _clamp(params.maxBytes, 1024, 1024 * 1024, DEFAULT_MAX_BYTES);

  const cursorObj = decodeCursor(params.cursor);
  const lastMessageId = cursorObj?.lastMessageId || null;

  let startIdx = 0;
  if (lastMessageId) {
    const i = list.findIndex(m => m?.id === lastMessageId);
    startIdx = i >= 0 ? i + 1 : 0;
  }

  const out = [];
  let total = 0;
  // ID of the message whose tool call was the LAST RETURNED entry. Cursor
  // anchors here so resumption is gap-free. Same pattern as search().
  let lastReturnedAnchor = null;

  for (let i = startIdx; i < list.length; i++) {
    const m = list[i];
    const execs = Array.isArray(m?.toolExecutions) ? m.toolExecutions : [];
    for (const e of execs) {
      if (toolId && e?.toolId !== toolId) continue;
      total++;
      if (out.length >= limit) continue;
      lastReturnedAnchor = m?.id || lastReturnedAnchor;

      out.push({
        messageId: m?.id || null,
        at: _messageAt(m),
        toolId: e?.toolId || null,
        status: e?.status || null,
        executionTime: typeof e?.executionTime === 'number' ? e.executionTime : null,
        inputSnippet: _truncateContent(
          typeof e?.input === 'string' ? e.input : _safeJsonStringify(e?.input),
          200
        ),
        // Outputs are explicitly NOT included (user decision — tool RESULTS
        // excluded from reminisce to keep payloads clean).
      });
    }
  }

  const { entries, truncatedCount } = capEntries(out, maxBytes);
  const hasMore = out.length < total;
  const cursor = hasMore ? encodeCursor({ lastMessageId: lastReturnedAnchor, toolId }) : null;

  return {
    toolCalls: entries,
    total,
    hasMore,
    cursor,
    truncatedByBytes: truncatedCount,
  };
}

function _safeJsonStringify(v) {
  if (v == null) return '';
  try { return JSON.stringify(v); }
  catch { return String(v); }
}

// ── Public: read ─────────────────────────────────────────────────────────

/**
 * Default char-window when the agent asks for a char range but leaves the
 * upper bound open. Keeps the response bounded without forcing the agent
 * to compute content length.
 */
export const DEFAULT_READ_CHAR_WINDOW = 4000;

/** Max chars a single `read` call will return regardless of what the agent asks. */
export const HARD_MAX_READ_CHARS = 16000;

/**
 * Default line-window when `lineFrom` is set without `lineTo`.
 */
export const DEFAULT_READ_LINE_WINDOW = 80;

/** Max lines a single `read` call will return. */
export const HARD_MAX_READ_LINES = 500;

/**
 * Read a single message, optionally windowed by LINES or CHARS.
 *
 * This is the sub-message granularity surface the other modes don't cover:
 *   - `around` moves at message granularity (N messages before/after).
 *   - `range` slices at message granularity (offset/limit).
 *   - `search` returns a fixed 120-char snippet around a hit.
 *   - `read` lets the agent pull a specific window INSIDE a single long
 *     message — lines 100–150 of a stack trace, chars 5000–7000 of a
 *     large paste, etc. — without yanking the whole thing into context.
 *
 * Window selectors are mutually exclusive:
 *   - `lineFrom` / `lineTo`    : 1-indexed inclusive line range
 *   - `contentFrom` / `contentTo` : 0-indexed half-open char offsets
 *   - neither                  : return the whole content (still byte-capped)
 *
 * If both kinds are provided, `lineFrom`/`lineTo` win and the char fields
 * are silently ignored (picking one prevents the agent from accidentally
 * getting a wrong window when it passes both).
 *
 * Out-of-bounds selectors are clamped (never throw). The returned
 * `contentWindow` descriptor tells the agent exactly what slice it got:
 *
 *   contentWindow = {
 *     kind: 'full' | 'lines' | 'chars',
 *     lineFrom?, lineTo?, totalLines?,       // when kind='lines'
 *     contentFrom?, contentTo?,              // when kind='chars'
 *     totalContentLength,                    // always
 *     hasMoreBefore, hasMoreAfter,           // did we omit content on either side?
 *     truncatedAtBytes: number|null,         // if byte cap kicked in mid-window
 *   }
 *
 * @param {Array<Object>} messages
 * @param {Object} params
 * @param {string} params.messageId
 * @param {number} [params.lineFrom]   1-indexed inclusive
 * @param {number} [params.lineTo]     1-indexed inclusive
 * @param {number} [params.contentFrom] 0-indexed char offset (inclusive)
 * @param {number} [params.contentTo]   0-indexed char offset (exclusive)
 * @param {'default'|'full'} [params.detail]
 * @param {number} [params.maxBytes]
 */
export function read(messages, params = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const messageId = typeof params.messageId === 'string' ? params.messageId : '';
  const detail = params.detail === 'full' ? 'full' : 'default';
  const maxBytes = _clamp(params.maxBytes, 1024, 1024 * 1024, DEFAULT_MAX_BYTES);

  const idx = messageId ? list.findIndex(m => m?.id === messageId) : -1;
  if (idx < 0) {
    return {
      message: null,
      targetFound: false,
      center: messageId || null,
    };
  }
  const m = list[idx];
  const full = _contentString(m);
  const totalContentLength = full.length;

  // Resolve window kind. Lines take precedence over chars when both are
  // provided (see doc above — prevents ambiguous requests).
  const hasLineSelector = params.lineFrom != null || params.lineTo != null;
  const hasCharSelector = !hasLineSelector && (params.contentFrom != null || params.contentTo != null);

  let windowText, windowDescriptor;

  if (hasLineSelector) {
    // Line-based window. Split once, slice, rejoin.
    const lines = full.split('\n');
    const totalLines = lines.length;

    const rawFrom = Number.isFinite(params.lineFrom) ? params.lineFrom : 1;
    // `lineTo` defaults to from + DEFAULT_READ_LINE_WINDOW - 1 so a bare
    // `lineFrom` request gets a sane window, not the rest of the message.
    const rawTo = Number.isFinite(params.lineTo)
      ? params.lineTo
      : rawFrom + DEFAULT_READ_LINE_WINDOW - 1;

    // Clamp to [1, totalLines]; guarantee from <= to.
    let lineFrom = _clamp(rawFrom, 1, Math.max(1, totalLines), 1);
    let lineTo   = _clamp(rawTo,   1, Math.max(1, totalLines), totalLines);
    if (lineFrom > lineTo) [lineFrom, lineTo] = [lineTo, lineFrom];

    // Hard cap on window size.
    if (lineTo - lineFrom + 1 > HARD_MAX_READ_LINES) {
      lineTo = lineFrom + HARD_MAX_READ_LINES - 1;
    }

    windowText = lines.slice(lineFrom - 1, lineTo).join('\n');
    windowDescriptor = {
      kind: 'lines',
      lineFrom, lineTo, totalLines,
      totalContentLength,
      hasMoreBefore: lineFrom > 1,
      hasMoreAfter:  lineTo < totalLines,
      truncatedAtBytes: null,
    };
  } else if (hasCharSelector) {
    const rawFrom = Number.isFinite(params.contentFrom) ? params.contentFrom : 0;
    const rawTo = Number.isFinite(params.contentTo)
      ? params.contentTo
      : rawFrom + DEFAULT_READ_CHAR_WINDOW;

    let contentFrom = _clamp(rawFrom, 0, Math.max(0, totalContentLength), 0);
    let contentTo   = _clamp(rawTo,   0, totalContentLength,             totalContentLength);
    if (contentFrom > contentTo) [contentFrom, contentTo] = [contentTo, contentFrom];

    if (contentTo - contentFrom > HARD_MAX_READ_CHARS) {
      contentTo = contentFrom + HARD_MAX_READ_CHARS;
    }

    windowText = full.slice(contentFrom, contentTo);
    windowDescriptor = {
      kind: 'chars',
      contentFrom, contentTo, totalContentLength,
      hasMoreBefore: contentFrom > 0,
      hasMoreAfter:  contentTo < totalContentLength,
      truncatedAtBytes: null,
    };
  } else {
    // No selector — whole content (byte cap below may still trim).
    windowText = full;
    windowDescriptor = {
      kind: 'full', totalContentLength,
      hasMoreBefore: false, hasMoreAfter: false,
      truncatedAtBytes: null,
    };
  }

  // Byte-cap enforcement: if the window's serialized size exceeds maxBytes,
  // trim the content tail and record where we cut so the agent can
  // continue with a follow-up read starting at truncatedAtBytes.
  const shapedBase = {
    messageId: m?.id || null,
    role: m?.role || 'unknown',
    at: _messageAt(m),
    tokenCount: _tokenCountOf(m),
    hasToolCalls: _hasToolCalls(m),
    model: m?.metadata?.model || null,
    // Signal presence of reasoning even when we're not returning the text
    // — agent can decide to re-fetch with includeReasoning=true.
    hasReasoning: typeof m?.reasoning === 'string' && m.reasoning.length > 0,
    reasoningTokens: Number.isFinite(m?.reasoningTokens) ? m.reasoningTokens : null,
  };
  const extras = detail === 'full' ? {
    toolExecutions: Array.isArray(m?.toolExecutions) ? m.toolExecutions : [],
    contextReferences: Array.isArray(m?.contextReferences) ? m.contextReferences : [],
  } : {};
  // Reasoning is opt-in on `read` because chain-of-thought can dwarf the
  // content in token count; default slim responses skip it, callers who
  // want the thinking text pass includeReasoning=true. When included, it
  // gets its own byte budget (50% of maxBytes by default) so a huge
  // reasoning block doesn't devour content or blow the response cap.
  // Truncation marker "…(N more chars)" preserves the "hasMore" signal.
  if (params.includeReasoning && typeof m?.reasoning === 'string' && m.reasoning.length > 0) {
    const reasoningBudget = Math.floor(maxBytes / 2);
    if (Buffer.byteLength(m.reasoning, 'utf-8') <= reasoningBudget) {
      extras.reasoning = m.reasoning;
    } else {
      // Binary-trim to the budget (same pattern as content truncation below).
      let lo = 0, hi = m.reasoning.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (Buffer.byteLength(m.reasoning.slice(0, mid), 'utf-8') <= reasoningBudget) lo = mid;
        else hi = mid - 1;
      }
      extras.reasoning = m.reasoning.slice(0, lo) + `…(${m.reasoning.length - lo} more chars)`;
      extras.reasoningTruncated = true;
    }
  }

  // Serialize incrementally: shell of the response minus content is a
  // cheap lower bound on overhead; we give content the remaining budget.
  const shell = { ...shapedBase, ...extras, contentWindow: windowDescriptor, content: '' };
  const overhead = Buffer.byteLength(JSON.stringify(shell), 'utf-8');
  const contentBudget = Math.max(0, maxBytes - overhead - 64 /* JSON punctuation slack */);

  if (Buffer.byteLength(windowText, 'utf-8') > contentBudget) {
    // Back off one character at a time (rare; tiny cost) until it fits.
    // A binary trim is faster, but correctness first — this path runs at
    // most once per read call.
    let lo = 0, hi = windowText.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (Buffer.byteLength(windowText.slice(0, mid), 'utf-8') <= contentBudget) lo = mid;
      else hi = mid - 1;
    }
    const truncated = lo;
    windowText = windowText.slice(0, truncated);
    windowDescriptor.truncatedAtBytes = Buffer.byteLength(windowText, 'utf-8');
    windowDescriptor.hasMoreAfter = true;  // more content exists past the cut
  }

  return {
    message: {
      ...shapedBase,
      ...extras,
      contentWindow: windowDescriptor,
      content: windowText,
    },
    targetFound: true,
    center: messageId,
  };
}

export default {
  overview,
  range,
  search,
  around,
  byTool,
  read,
  encodeCursor,
  decodeCursor,
  capEntries,
  // Constants (for tests + tool description)
  DEFAULT_MAX_BYTES,
  DEFAULT_LIMIT,
  HARD_MAX_LIMIT,
  DEFAULT_MAX_RESULTS,
  HARD_MAX_RESULTS,
  DEFAULT_AROUND_BEFORE,
  DEFAULT_AROUND_AFTER,
  HARD_MAX_AROUND,
  OVERVIEW_TIMELINE_SIZE,
};
