/**
 * Streaming Content Parser
 *
 * Parses streaming content to detect complete and in-progress tool invocations.
 * Enables progressive rendering of tools as they stream in.
 *
 * Segment Types:
 * - 'text': Plain text/markdown content
 * - 'tool-complete': Fully parsed tool invocation (ready for pretty rendering)
 * - 'tool-pending': Incomplete tool block still streaming (show skeleton)
 */

import { TOOL_IDS, isValidToolId } from '../../constants/toolConstants';

/**
 * Build a set of valid tool IDs for quick lookup (case-insensitive)
 */
const VALID_TOOL_ID_SET = new Set(
  Object.values(TOOL_IDS).map(id => id.toLowerCase())
);

/**
 * Check if a toolId is valid (case-insensitive)
 * @param {string} toolId - Tool ID to validate
 * @returns {string|null} Normalized tool ID or null if invalid
 */
function normalizeToolId(toolId) {
  if (!toolId) return null;
  const normalized = toolId.toLowerCase();
  return VALID_TOOL_ID_SET.has(normalized) ? normalized : null;
}

/**
 * Try to extract toolId from partial/incomplete JSON
 * Handles cases where JSON is still streaming
 * @param {string} partial - Partial JSON string
 * @returns {string|null} Extracted toolId or null
 */
function extractPartialToolId(partial) {
  if (!partial) return null;

  // Try to find "toolId": "value" pattern
  const toolIdMatch = partial.match(/"toolId"\s*:\s*"([^"]+)"/i);
  if (toolIdMatch) {
    return normalizeToolId(toolIdMatch[1]);
  }

  // Also try "tool": "value" pattern
  const toolMatch = partial.match(/"tool"\s*:\s*"([^"]+)"/i);
  if (toolMatch) {
    return normalizeToolId(toolMatch[1]);
  }

  return null;
}

/**
 * Try to extract action from partial/incomplete JSON
 * @param {string} partial - Partial JSON string
 * @returns {string|null} Extracted action or null
 */
function extractPartialAction(partial) {
  if (!partial) return null;

  // Try to find "action": "value" pattern
  const actionMatch = partial.match(/"action"\s*:\s*"([^"]+)"/i);
  if (actionMatch) {
    return actionMatch[1];
  }

  return null;
}

/**
 * Incremental parse cache — avoids re-scanning completed tool blocks
 * when content only grows at the tail (streaming append).
 *
 * On each call we check whether the content prefix up to the last known
 * complete-block boundary is unchanged.  If so, we reuse cached segments
 * and only regex-scan the new tail.
 */
let _cache = {
  /** Content substring [0 .. lastCompleteEnd) that produced cachedSegments */
  prefix: '',
  /** Segments produced from completed blocks + inter-block text */
  segments: [],
  /** Position in content right after the last complete ```json…``` block */
  lastCompleteEnd: 0
};

/**
 * Parse streaming content and extract segments (incremental).
 *
 * @param {string} content - Accumulated streaming content
 * @returns {Array<{type: string, content?: string, toolId?: string, data?: object, rawContent?: string, partial?: string, action?: string}>}
 */
export function parseStreamingContent(content) {
  if (!content || typeof content !== 'string') {
    _cache = { prefix: '', segments: [], lastCompleteEnd: 0 };
    return [];
  }

  // --- Determine how much of the cached result we can reuse ---
  let reusedSegments = [];
  let scanFrom = 0;

  if (
    _cache.lastCompleteEnd > 0 &&
    content.length >= _cache.lastCompleteEnd &&
    content.substring(0, _cache.lastCompleteEnd) === _cache.prefix
  ) {
    // Prefix hasn't changed — reuse cached segments
    reusedSegments = _cache.segments;
    scanFrom = _cache.lastCompleteEnd;
  }

  // --- Scan only the NEW portion for complete blocks ---
  const tail = content.substring(scanFrom);
  const completeBlockRegex = /```json\s*(\{[\s\S]*?\})\s*```/g;
  const newCompleteMatches = [];
  let match;

  while ((match = completeBlockRegex.exec(tail)) !== null) {
    try {
      const jsonData = JSON.parse(match[1]);
      const rawToolId = jsonData.toolId || jsonData.tool;
      const toolId = normalizeToolId(rawToolId);

      if (toolId) {
        newCompleteMatches.push({
          start: scanFrom + match.index,
          end: scanFrom + match.index + match[0].length,
          type: 'tool-complete',
          toolId,
          rawContent: match[0],
          data: jsonData
        });
      }
    } catch {
      // Not valid JSON — skip
    }
  }

  // --- Build segments for newly found complete blocks ---
  const newSegments = [];
  let currentPos = scanFrom;

  for (const m of newCompleteMatches) {
    if (m.start > currentPos) {
      const textContent = content.substring(currentPos, m.start);
      if (textContent.trim()) {
        newSegments.push({ type: 'text', content: textContent });
      }
    }
    newSegments.push({
      type: 'tool-complete',
      toolId: m.toolId,
      data: m.data,
      rawContent: m.rawContent
    });
    currentPos = m.end;
  }

  // --- Update cache boundary ---
  const allCompleteSegments = [...reusedSegments, ...newSegments];
  const newLastCompleteEnd = newCompleteMatches.length > 0
    ? newCompleteMatches[newCompleteMatches.length - 1].end
    : _cache.lastCompleteEnd;

  _cache = {
    prefix: content.substring(0, newLastCompleteEnd),
    segments: allCompleteSegments,
    lastCompleteEnd: newLastCompleteEnd
  };

  // --- Handle trailing content (text / pending block) ---
  const segments = [...allCompleteSegments];
  const remaining = content.substring(currentPos);

  if (remaining) {
    const pendingMatch = remaining.match(/```json\s*(\{[\s\S]*)$/);

    if (pendingMatch) {
      const textBefore = remaining.substring(0, pendingMatch.index);
      if (textBefore.trim()) {
        segments.push({ type: 'text', content: textBefore });
      }
      const partialJson = pendingMatch[1];
      segments.push({
        type: 'tool-pending',
        partial: partialJson,
        toolId: extractPartialToolId(partialJson),
        action: extractPartialAction(partialJson)
      });
    } else if (remaining.trim()) {
      segments.push({ type: 'text', content: remaining });
    }
  }

  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', content: content });
  }

  return segments;
}

/**
 * Reset the incremental parse cache.
 * Call when switching agents or clearing conversation.
 */
export function resetParseCache() {
  _cache = { prefix: '', segments: [], lastCompleteEnd: 0 };
}

/**
 * Check if content has any tool invocations (complete or pending)
 * @param {string} content - Content to check
 * @returns {boolean} True if content contains tool invocations
 */
export function hasToolInvocations(content) {
  if (!content) return false;
  return content.includes('```json') && content.includes('"toolId"');
}

/**
 * Get count of complete and pending tools in content
 * @param {string} content - Content to analyze
 * @returns {{complete: number, pending: number}} Count of tools
 */
export function getToolCounts(content) {
  const segments = parseStreamingContent(content);
  return {
    complete: segments.filter(s => s.type === 'tool-complete').length,
    pending: segments.filter(s => s.type === 'tool-pending').length
  };
}

export default {
  parseStreamingContent,
  resetParseCache,
  hasToolInvocations,
  getToolCounts
};
