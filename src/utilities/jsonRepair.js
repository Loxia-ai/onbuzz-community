/**
 * JSON Repair Utility
 *
 * Handles parsing of potentially truncated or malformed JSON from AI responses.
 * Uses jsonrepair library to fix common issues like:
 * - Missing closing brackets/braces
 * - Truncated strings
 * - Missing commas
 * - Trailing commas
 */

import { jsonrepair } from 'jsonrepair';

/**
 * Parse JSON with automatic repair for truncated/malformed content
 * @param {string} jsonString - The JSON string to parse
 * @param {Object} options - Options
 * @param {boolean} options.silent - If true, don't log warnings
 * @returns {Object} { data, wasRepaired, original, repaired, error }
 */
export function parseJSONWithRepair(jsonString, options = {}) {
  const result = {
    data: null,
    wasRepaired: false,
    wasTruncated: false,
    original: jsonString,
    repaired: null,
    error: null
  };

  // First, try standard JSON.parse
  try {
    result.data = JSON.parse(jsonString);
    return result;
  } catch (originalError) {
    // Standard parse failed, try repair
    try {
      const repairedString = jsonrepair(jsonString);
      result.repaired = repairedString;
      result.data = JSON.parse(repairedString);
      result.wasRepaired = true;

      // Detect if it was likely truncated (common patterns)
      result.wasTruncated = detectTruncation(jsonString, repairedString);

      if (!options.silent) {
        console.warn('[JSONRepair] Repaired malformed JSON:', {
          originalLength: jsonString.length,
          repairedLength: repairedString.length,
          wasTruncated: result.wasTruncated
        });
      }

      return result;
    } catch (repairError) {
      // Even repair failed
      result.error = {
        originalError: originalError.message,
        repairError: repairError.message
      };
      return result;
    }
  }
}

/**
 * Detect if JSON was truncated (vs just malformed)
 * Uses state machine approach for accurate string tracking
 * @param {string} original - Original JSON string
 * @param {string} repaired - Repaired JSON string
 * @returns {boolean} True if likely truncated
 */
function detectTruncation(original, repaired) {
  const trimmed = original.trim();

  // State machine to accurately track JSON structure
  let depth = 0;        // Bracket nesting depth
  let inString = false; // Currently inside a string
  let escaped = false;  // Previous char was escape

  for (const char of trimmed) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{' || char === '[') depth++;
    if (char === '}' || char === ']') depth--;
  }

  // PRIMARY CHECK: If we end mid-string, definitely truncated
  // This catches the common case where content was cut off mid-sentence
  if (inString) {
    console.log('[JSONRepair] Truncation detected: ended mid-string');
    return true;
  }

  // If we have unclosed brackets, truncated
  if (depth > 0) {
    console.log('[JSONRepair] Truncation detected: unclosed brackets, depth=' + depth);
    return true;
  }

  // If we end mid-escape sequence, truncated
  if (escaped) {
    console.log('[JSONRepair] Truncation detected: ended mid-escape');
    return true;
  }

  // Count bracket differences between original and repaired
  const countBrackets = (str) => {
    let open = 0, close = 0;
    let inStr = false, esc = false;
    for (const char of str) {
      if (esc) { esc = false; continue; }
      if (char === '\\' && inStr) { esc = true; continue; }
      if (char === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (char === '{' || char === '[') open++;
      if (char === '}' || char === ']') close++;
    }
    return { open, close };
  };

  const originalBrackets = countBrackets(original);
  const repairedBrackets = countBrackets(repaired);

  // If repair added closing brackets, it was truncated
  if (repairedBrackets.close > originalBrackets.close) {
    console.log('[JSONRepair] Truncation detected: repair added closing brackets');
    return true;
  }

  // Check for common truncation patterns in the ending
  const lastChars = trimmed.slice(-20);
  const truncationPatterns = [
    /,\s*$/,           // Ends with comma (expecting more)
    /:\s*$/,           // Ends with colon (expecting value)
    /\[\s*$/,          // Ends with open bracket
    /\{\s*$/,          // Ends with open brace
  ];

  for (const pattern of truncationPatterns) {
    if (pattern.test(lastChars)) {
      console.log('[JSONRepair] Truncation detected: suspicious ending pattern');
      return true;
    }
  }

  return false;
}

/**
 * Check if a string looks like it might be truncated JSON
 * Useful for pre-checking before attempting parse
 * @param {string} str - String to check
 * @returns {boolean} True if likely truncated
 */
export function looksLikeTruncatedJSON(str) {
  const trimmed = str.trim();

  // Must start with { or [ to be JSON
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return false;
  }

  // Check for balanced brackets
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (const char of trimmed) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{' || char === '[') depth++;
    if (char === '}' || char === ']') depth--;
  }

  // If depth > 0, we have unclosed brackets (truncated)
  // If inString is true, we're mid-string (truncated)
  return depth > 0 || inString;
}

/**
 * Create a truncation notice for file content
 * @param {string} fileType - Type of file (md, js, etc.)
 * @returns {string} Truncation notice
 */
export function createTruncationNotice(fileType) {
  const notices = {
    md: '\n\n---\n**[CONTENT TRUNCATED]** - AI response exceeded token limit. Content above this line may be incomplete.\n',
    js: '\n\n// [CONTENT TRUNCATED] - AI response exceeded token limit. Content above this line may be incomplete.\n',
    ts: '\n\n// [CONTENT TRUNCATED] - AI response exceeded token limit. Content above this line may be incomplete.\n',
    jsx: '\n\n// [CONTENT TRUNCATED] - AI response exceeded token limit. Content above this line may be incomplete.\n',
    tsx: '\n\n// [CONTENT TRUNCATED] - AI response exceeded token limit. Content above this line may be incomplete.\n',
    json: '', // Can't add comments to JSON
    css: '\n\n/* [CONTENT TRUNCATED] - AI response exceeded token limit. Content above this line may be incomplete. */\n',
    html: '\n\n<!-- [CONTENT TRUNCATED] - AI response exceeded token limit. Content above this line may be incomplete. -->\n',
    py: '\n\n# [CONTENT TRUNCATED] - AI response exceeded token limit. Content above this line may be incomplete.\n',
    default: '\n\n[CONTENT TRUNCATED] - AI response exceeded token limit.\n'
  };

  return notices[fileType] || notices.default;
}

/**
 * Get file extension from path
 * @param {string} filePath - File path
 * @returns {string} Extension without dot
 */
export function getFileExtension(filePath) {
  const match = filePath.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
}

export default {
  parseJSONWithRepair,
  looksLikeTruncatedJSON,
  createTruncationNotice,
  getFileExtension
};
