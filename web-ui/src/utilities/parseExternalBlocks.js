/**
 * parseExternalBlocks — frontend parser for <external>…</external> tags.
 *
 * Given a raw assistant-message string, produces an ordered list of
 * segments:
 *
 *   [
 *     { type: 'text',              text: '…' },
 *     { type: 'external',          to: string[]|null, text: '…' },
 *     { type: 'external-streaming', to: string[]|null, text: '…' },
 *     …
 *   ]
 *
 * `external` segments come from fully-closed `<external>…</external>` blocks.
 * `external-streaming` segments come from an OPEN `<external …>` tag with no
 * matching `</external>` yet — i.e. the block is still being produced by the
 * stream. The consuming renderer (StreamingBubble) uses this to show a
 * skeleton card while the agent is still drafting.
 *
 * Contract match with the backend:
 *   The regex and attribute-parsing shape here are deliberately kept in
 *   lock-step with `src/services/channelFilter.js::EXTERNAL_TAG_RE` so the
 *   frontend's view of blocks matches the backend's view exactly. If the
 *   backend ever rewrites the regex (e.g. add a new attribute), this file
 *   is the second edit.
 *
 * This module has zero React / DOM dependencies and is trivially testable.
 */

// Closed block: <external to="…">…</external>. Captured groups:
//   1: to="…"   (double-quoted)
//   2: to='…'   (single-quoted)
//   3: body
const CLOSED_EXTERNAL_RE =
  /<external(?:\s+to\s*=\s*(?:"([^"]*)"|'([^']*)'))?>([\s\S]*?)<\/external>/gi;

// Open-only tag (no closing counterpart). Only meaningful for streaming —
// we look for this ONLY in the tail of the input after every closed block
// has been consumed. Captured groups:
//   1: to="…"   (double-quoted)
//   2: to='…'   (single-quoted)
const OPEN_EXTERNAL_RE =
  /<external(?:\s+to\s*=\s*(?:"([^"]*)"|'([^']*)'))?\s*>/i;

/**
 * Normalize the raw `to="…"` attribute into an array of trimmed aliases,
 * or null when absent. `*` stays as-is (explicit broadcast marker).
 * @param {string|null} raw
 * @returns {string[]|null}
 */
function parseToAttribute(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return null;
  const parts = trimmed.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

/**
 * Parse a raw content string into an ordered segment list.
 *
 * @param {string|null|undefined} content
 * @returns {Array<{ type: 'text'|'external'|'external-streaming', text: string, to: (string[]|null) }>}
 */
export function parseExternalBlocks(content) {
  if (typeof content !== 'string' || content.length === 0) return [];

  const segments = [];
  let cursor = 0;
  let m;
  CLOSED_EXTERNAL_RE.lastIndex = 0;

  while ((m = CLOSED_EXTERNAL_RE.exec(content)) !== null) {
    const blockStart = m.index;
    const blockEnd = blockStart + m[0].length;

    // Leading text between previous block and this one.
    if (blockStart > cursor) {
      const text = content.slice(cursor, blockStart);
      if (text.length > 0) segments.push({ type: 'text', text });
    }

    const to = parseToAttribute(m[1] ?? m[2] ?? null);
    const body = (m[3] ?? '').replace(/^\s+|\s+$/g, '');
    segments.push({ type: 'external', to, text: body });

    cursor = blockEnd;
  }

  // Tail after the last closed block. This is where we look for a
  // dangling open tag — that's the "streaming, not done yet" case.
  const tail = content.slice(cursor);
  if (tail.length === 0) return segments;

  const openMatch = OPEN_EXTERNAL_RE.exec(tail);
  if (!openMatch) {
    // Plain tail, no open tag — just trailing text.
    segments.push({ type: 'text', text: tail });
    return segments;
  }

  // Text before the dangling open tag (if any).
  if (openMatch.index > 0) {
    segments.push({ type: 'text', text: tail.slice(0, openMatch.index) });
  }

  // Body seen so far for the streaming block (whitespace NOT trimmed because
  // the stream may drop us mid-space — trimming would cause flicker as the
  // next chunk arrives). The renderer can whitespace-trim visually.
  const openTo = parseToAttribute(openMatch[1] ?? openMatch[2] ?? null);
  const partialBody = tail.slice(openMatch.index + openMatch[0].length);
  segments.push({ type: 'external-streaming', to: openTo, text: partialBody });

  return segments;
}

/**
 * True when the content contains at least one closed OR streaming
 * `<external>` block. Cheap early-exit for renderers that want to skip
 * the segmentation pass when there's nothing to slice.
 * @param {string} content
 * @returns {boolean}
 */
export function hasExternalBlock(content) {
  if (typeof content !== 'string' || content.length === 0) return false;
  return /<external\b/i.test(content);
}

export default { parseExternalBlocks, hasExternalBlock };
