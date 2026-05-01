/**
 * TagParser - Utility for parsing JSON tool commands
 *
 * Purpose:
 * - Parse JSON tool commands from agent messages (LLM industry standard)
 * - Extract parameters from JSON format
 * - Agent redirect parsing
 *
 * Supported format:
 * - JSON code blocks: ```json {"toolId": "...", "parameters": {...}} ```
 */

import {
  AGENT_REDIRECT_ATTRIBUTES
} from './constants.js';
import {
  TOOL_IDS,
  COMMAND_FORMATS,
  JSON_STRUCTURES,
  identifyJsonStructure,
  getToolIdFromAction,
  isValidToolId
} from './toolConstants.js';
import { parseJSONWithRepair, looksLikeTruncatedJSON } from './jsonRepair.js';

class TagParser {
  constructor() {
    // Tag parsing patterns - JSON only (industry standard)
    this.patterns = {
      attribute: /([\w-]+)=["']([^"']*)["']/g,
      agentRedirect: /\[agent-redirect\s+([^\]]*)\](.*?)\[\/agent-redirect\]/gs,
      jsonBlock: /```json\s*(\{[\s\S]*?\})\s*```/g,
      // Also match plain JSON objects on their own line(s) as fallback
      plainJson: /^(\{(?:[^{}]|(?:\{[^{}]*\}))*\})$/gm
    };
  }

  /**
   * Decode HTML entities that might be present in tool content
   * @param {string} text - Text that might contain HTML entities
   * @returns {string} Decoded text
   */
  decodeHtmlEntities(text) {
    const entityMap = {
      '&lt;': '<',
      '&gt;': '>',
      '&amp;': '&',
      '&quot;': '"',
      '&#x27;': "'",
      '&#x2F;': '/',
      '&#39;': "'",
      '&#47;': '/'
    };
    
    return text.replace(/&(?:lt|gt|amp|quot|#x27|#x2F|#39|#47);/g, match => entityMap[match] || match);
  }

  /**
   * Extract tool commands from message content (JSON format only)
   * @param {string} content - Message content to parse
   * @returns {Array} Array of parsed tool commands
   */
  extractToolCommands(content) {
    const commands = [];

    // Decode HTML entities that might be present in the content
    const decodedContent = this.decodeHtmlEntities(content);

    // PHASE 1: Extract JSON code blocks (LLM industry standard format)
    // Format: ```json {"toolId": "...", "parameters": {...}} ```
    const jsonCodeBlockCommands = this.extractJSONCodeBlocks(decodedContent);
    commands.push(...jsonCodeBlockCommands);

    // PHASE 2: Sanitize content by removing already-extracted JSON blocks
    // This prevents duplicate extraction
    const sanitizedContent = this.removeJsonBlocks(decodedContent);

    // PHASE 3: Extract plain JSON (fallback for agents that don't use code blocks)
    // This should rarely find anything if agents follow the ```json block convention
    const plainJsonCommands = this.extractPlainJSON(sanitizedContent);
    commands.push(...plainJsonCommands);

    return commands;
  }

  /**
   * Extract top-level parameters from JSON data (excluding toolId)
   * Used as fallback when JSON doesn't use standard parameters/actions/files wrappers
   * @param {Object} jsonData - JSON data to extract from
   * @returns {Object} Extracted parameters
   * @private
   */
  _extractTopLevelParams(jsonData) {
    const params = {};
    for (const [key, value] of Object.entries(jsonData)) {
      // Skip the tool identifier keys
      if (key !== 'toolId' && key !== 'tool') {
        params[key] = value;
      }
    }
    return params;
  }

  /**
   * Remove JSON code blocks from content to prevent duplicate extraction
   * @param {string} content - Content to sanitize
   * @returns {string} Content with JSON code blocks removed
   * @private
   */
  removeJsonBlocks(content) {
    let sanitized = content;
    let position = 0;

    while (position < sanitized.length) {
      const startMarker = '```json';
      const endMarker = '```';

      const startIndex = sanitized.indexOf(startMarker, position);
      if (startIndex === -1) break;

      const contentStart = startIndex + startMarker.length;
      const endIndex = sanitized.indexOf(endMarker, contentStart);
      if (endIndex === -1) break;

      // Replace JSON code block with placeholder
      const before = sanitized.substring(0, startIndex);
      const after = sanitized.substring(endIndex + endMarker.length);
      sanitized = before + '[JSON_BLOCK_REMOVED]' + after;

      position = startIndex + '[JSON_BLOCK_REMOVED]'.length;
    }

    return sanitized;
  }

  /**
   * Extract JSON from markdown code blocks using string functions
   * @private
   */
  extractJSONCodeBlocks(content) {
    const commands = [];
    let searchIndex = 0;

    while (true) {
      // Find opening marker
      const startMarker = '```json';
      const endMarker = '```';

      const startIndex = content.indexOf(startMarker, searchIndex);
      if (startIndex === -1) break;

      // Find closing marker - MUST find the MATCHING one, not nested ones
      const contentStart = startIndex + startMarker.length;
      const endIndex = this._findMatchingCodeBlockEnd(content, contentStart);
      if (endIndex === -1) break;

      // Extract JSON content
      const jsonString = content.substring(contentStart, endIndex).trim();

      // Use repair-capable JSON parser to handle truncated responses
      const parseResult = parseJSONWithRepair(jsonString, { silent: false });

      if (parseResult.error) {
        // Even repair failed - skip this block
        console.log('TagParser DEBUG: JSON parse failed even with repair:', parseResult.error);
        searchIndex = endIndex + endMarker.length;
        continue;
      }

      const jsonData = parseResult.data;
      const wasRepaired = parseResult.wasRepaired;
      const wasTruncated = parseResult.wasTruncated;

      if (wasRepaired) {
        console.log('TagParser DEBUG: JSON was repaired', {
          wasTruncated,
          originalLength: jsonString.length,
          repairedLength: parseResult.repaired?.length
        });
      }

      if (this.isToolCommandJSON(jsonData)) {
        // ARCHITECTURAL PRINCIPLE: Use OUTER layer (toolId) for tool identification
        const toolId = jsonData.toolId || jsonData.tool;

        // Skip if no explicit outer tool identifier
        if (!toolId || toolId === 'unknown') {
          console.log('TagParser DEBUG: Skipping JSON block - missing explicit toolId');
          searchIndex = endIndex + endMarker.length;
          continue;
        }

        // Extract parameters from JSON:
        // - If 'parameters' wrapper exists, use it (standard format)
        // - Otherwise, extract ALL top-level properties (operation, headless, actions, files, etc.)
        // This ensures tools like 'web' receive operation alongside actions
        let extractedParams;
        if (jsonData.parameters) {
          extractedParams = { ...jsonData.parameters };
          // Hoist top-level `action` into the param object when the
          // agent emits the action-at-top/params-nested shape:
          //   { toolId, action: "...", parameters: { url: "..." } }
          // Tools that dispatch on `params.action` (visual-editor,
          // memory, codemap, etc.) would otherwise never see the
          // action and silently fall through to whatever default their
          // parseParameters has — which for visual-editor is
          // get-context, bypassing set-app-url / open-editor / serve-static
          // entirely. Hoisting is guarded so an action nested inside
          // parameters (rare but valid) still wins.
          if (jsonData.action && !extractedParams.action) {
            extractedParams.action = jsonData.action;
          }
        } else {
          // Extract all top-level params (excluding toolId) - includes operation, headless, actions, files, etc.
          extractedParams = this._extractTopLevelParams(jsonData);
        }

        const command = {
          type: COMMAND_FORMATS.JSON,
          toolId: toolId,
          parameters: extractedParams,
          actions: jsonData.actions,
          rawContent: content.substring(startIndex, endIndex + endMarker.length),
          jsonData,
          // Mark if this was repaired/truncated for tool to handle appropriately
          wasRepaired,
          wasTruncated
        };

        commands.push(command);
      }

      // Handle toolCommands array format
      if (jsonData.toolCommands && Array.isArray(jsonData.toolCommands)) {
        for (const toolCommand of jsonData.toolCommands) {
          if (this.isToolCommandJSON(toolCommand)) {
            // ARCHITECTURAL PRINCIPLE: Use OUTER layer (toolId) for tool identification
            const toolId = toolCommand.toolId || toolCommand.tool;

            // Skip if no explicit outer tool identifier
            if (!toolId || toolId === 'unknown') {
              console.log('TagParser DEBUG: Skipping toolCommand - missing explicit toolId');
              continue;
            }

            // Extract parameters using same logic as single commands,
            // including the top-level `action` hoist (see above for the
            // rationale — visual-editor and other action-dispatched
            // tools were silently executing the wrong action path).
            let cmdParams;
            if (toolCommand.parameters) {
              cmdParams = { ...toolCommand.parameters };
              if (toolCommand.action && !cmdParams.action) {
                cmdParams.action = toolCommand.action;
              }
            } else {
              // Extract all top-level params (operation, headless, actions, files, etc.)
              cmdParams = this._extractTopLevelParams(toolCommand);
            }

            const command = {
              type: COMMAND_FORMATS.JSON,
              toolId: toolId,
              parameters: cmdParams,
              actions: toolCommand.actions,
              rawContent: JSON.stringify(toolCommand, null, 2),
              jsonData: toolCommand,
              wasRepaired,
              wasTruncated
            };

            commands.push(command);
          }
        }
      }

      searchIndex = endIndex + endMarker.length;
    }
    
    return commands;
  }
  
  /**
   * Extract plain JSON objects using string functions
   * @private
   */
  extractPlainJSON(content) {
    const commands = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip if line doesn't start with {
      if (!line.startsWith('{')) continue;
      
      // Try to find complete JSON object
      let jsonString = '';
      let braceCount = 0;
      let foundComplete = false;
      
      // Start from current line and look for complete JSON
      for (let j = i; j < lines.length; j++) {
        const currentLine = lines[j].trim();
        jsonString += (j > i ? '\n' : '') + currentLine;
        
        // Count braces to find complete object
        for (const char of currentLine) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
          if (braceCount === 0 && char === '}') {
            foundComplete = true;
            break;
          }
        }
        
        if (foundComplete) break;
      }
      
      if (!foundComplete) continue;

      // Use repair-capable JSON parser
      const parseResult = parseJSONWithRepair(jsonString, { silent: true });

      if (parseResult.error) {
        // Even repair failed - skip
        continue;
      }

      const jsonData = parseResult.data;
      const wasRepaired = parseResult.wasRepaired;
      const wasTruncated = parseResult.wasTruncated;

      // ARCHITECTURAL PRINCIPLE: Use OUTER layer for tool identification
      // Only parse INNER content (actions, type) if OUTER identifier missing
      // This follows the layered invocation hierarchy:
      //   OUTER (message level): Tool identification via "toolId"
      //   INNER (payload level): Action specification via "type"

      // Check if this JSON looks like a tool command
      if (this.isToolCommandJSON(jsonData) ||
          (jsonData.actions && Array.isArray(jsonData.actions)) ||
          (jsonData.type && typeof jsonData.type === 'string')) {

        // CRITICAL: Use OUTER identifier first, only infer from INNER as fallback
        const toolId = jsonData.toolId || jsonData.tool || this.inferToolFromActions(jsonData);

        // Skip if we couldn't determine a valid tool
        if (!toolId || toolId === 'unknown') {
          console.log('TagParser DEBUG: Skipping plain JSON - could not determine valid toolId');
          continue;
        }

        const command = {
          type: COMMAND_FORMATS.JSON_PLAIN,
          toolId: toolId,
          // Use parameters if wrapped, otherwise extract all top-level params (excluding toolId)
          parameters: jsonData.parameters || this._extractTopLevelParams(jsonData),
          actions: jsonData.actions,
          rawContent: jsonString,
          jsonData,
          warning: 'Plain JSON detected - should use ```json blocks',
          wasRepaired,
          wasTruncated
        };

        commands.push(command);
      }
    }
    
    return commands;
  }
  
  /**
   * Infer tool ID from JSON structure
   * Uses the constants-based approach for deterministic tool identification
   * @private
   */
  inferToolFromActions(jsonData) {
    const structure = identifyJsonStructure(jsonData);
    
    switch (structure) {
      case JSON_STRUCTURES.STANDARD:
        // Already has toolId
        return jsonData.toolId || 'unknown';
        
      case JSON_STRUCTURES.ACTIONS_ARRAY:
        // Get tool from first action type
        if (jsonData.actions && jsonData.actions.length > 0) {
          const firstAction = jsonData.actions[0];
          const toolId = getToolIdFromAction(firstAction.type);
          return toolId || 'unknown';
        }
        break;
        
      case JSON_STRUCTURES.DIRECT_ACTION:
        // Get tool from type field
        const toolId = getToolIdFromAction(jsonData.type);
        return toolId || 'unknown';
        
      case JSON_STRUCTURES.TOOL_COMMANDS:
        // Get from first command
        if (jsonData.toolCommands && jsonData.toolCommands.length > 0) {
          return this.inferToolFromActions(jsonData.toolCommands[0]);
        }
        break;
    }
    
    return 'unknown';
  }

  /**
   * Extract agent redirects from content
   * @param {string} content - Content to parse
   * @returns {Array} Array of parsed agent redirects
   */
  extractAgentRedirects(content) {
    const redirects = [];
    
    const matches = this.matchAll(content, this.patterns.agentRedirect);
    
    for (const match of matches) {
      const attributeString = match.groups[0];
      const messageContent = match.groups[1].trim();
      
      const attributes = this.parseAttributes(attributeString);
      
      const redirect = {
        to: attributes.to,
        content: messageContent,
        urgent: attributes[AGENT_REDIRECT_ATTRIBUTES.URGENT] === 'true',
        requiresResponse: attributes[AGENT_REDIRECT_ATTRIBUTES.REQUIRES_RESPONSE] === 'true',
        context: attributes[AGENT_REDIRECT_ATTRIBUTES.CONTEXT],
        rawMatch: match.match
      };
      
      // Add any additional attributes
      for (const [key, value] of Object.entries(attributes)) {
        if (!['to', AGENT_REDIRECT_ATTRIBUTES.URGENT, AGENT_REDIRECT_ATTRIBUTES.REQUIRES_RESPONSE, AGENT_REDIRECT_ATTRIBUTES.CONTEXT].includes(key)) {
          redirect[key] = value;
        }
      }
      
      redirects.push(redirect);
    }
    
    return redirects;
  }

  /**
   * Parse XML parameters from tool content
   * @param {string} content - Tool content to parse
   * @returns {Object} Parsed parameters
   */
  parseXMLParameters(content) {
    const parameters = {};
    
    console.log('TagParser DEBUG: parseXMLParameters - content length:', content.length);
    
    let position = 0;
    let foundCount = 0;
    
    // Look for opening tags like <write>, <read>, etc.
    while (position < content.length) {
      const openTagStart = content.indexOf('<', position);
      if (openTagStart === -1) break;
      
      const openTagEnd = content.indexOf('>', openTagStart);
      if (openTagEnd === -1) break;
      
      // Extract the full opening tag
      const openTag = content.substring(openTagStart, openTagEnd + 1);
      
      // Parse tag name and attributes from the opening tag
      const spaceIndex = openTag.indexOf(' ');
      const tagName = spaceIndex > 0 
        ? openTag.substring(1, spaceIndex)
        : openTag.substring(1, openTag.length - 1);
      
      const isValid = this.isValidXmlTagName(tagName);

      // Skip malformed tags or content that looks like code
      if (tagName.includes('/') || !tagName || !this.isValidXmlTagName(tagName)) {
        position = openTagEnd + 1;
        continue;
      }

      // Check if this is a self-closing tag (ends with />)
      const isSelfClosing = openTag.endsWith('/>');

      let tagContent = '';
      let closingTagStart = openTagEnd;

      if (isSelfClosing) {
        // Self-closing tag has no content
        tagContent = '';
        closingTagStart = openTagEnd; // Position right after the self-closing tag
      } else {
        // Look for the closing tag
        const closingTag = `</${tagName}>`;
        closingTagStart = content.indexOf(closingTag, openTagEnd + 1);

        if (closingTagStart === -1) {
          position = openTagEnd + 1;
          continue;
        }

        // Extract the content between tags
        tagContent = content.substring(openTagEnd + 1, closingTagStart);
      }
      
      // Extract attributes from the opening tag
      let attributeString = spaceIndex > 0
        ? openTag.substring(spaceIndex + 1, openTag.length - 1).trim()
        : '';

      // For self-closing tags, remove the trailing '/' from attributes
      if (isSelfClosing && attributeString.endsWith('/')) {
        attributeString = attributeString.substring(0, attributeString.length - 1).trim();
      }

      const attributes = this.parseAttributes(attributeString);
      
      console.log('TagParser DEBUG: parseXMLParameters - found match:', {
        paramName: tagName,
        attributeString,
        valueLength: tagContent.length,
        valuePreview: tagContent.substring(0, 50) + (tagContent.length > 50 ? '...' : '')
      });

      // CRITICAL FIX: Handle multiple tags with same name (e.g., multiple <write> tags)
      // Convert to array if duplicate detected
      const paramValue = {
        value: tagContent.trim(),
        attributes
      };

      if (parameters[tagName]) {
        // Tag already exists - convert to array or append to existing array
        if (Array.isArray(parameters[tagName])) {
          // Already an array, append
          parameters[tagName].push(paramValue);
          console.log('TagParser DEBUG: appended to existing array for tag:', tagName, 'count:', parameters[tagName].length);
        } else {
          // First duplicate - convert to array
          const existingValue = parameters[tagName];
          parameters[tagName] = [existingValue, paramValue];
          console.log('TagParser DEBUG: converted to array for duplicate tag:', tagName);
        }
      } else {
        // First occurrence - store as single object
        parameters[tagName] = paramValue;
      }

      // For convenience, also store direct access to value (deprecated, kept for backward compatibility)
      // Only define if it doesn't exist (handles multiple tags with same name)
      const valuePropertyName = tagName + '_value';
      if (!Object.prototype.hasOwnProperty.call(parameters, valuePropertyName)) {
        Object.defineProperty(parameters, valuePropertyName, {
          value: tagContent.trim(),
          enumerable: false
        });
      }

      foundCount++;

      // Update position based on whether it's self-closing or paired tags
      if (isSelfClosing) {
        position = openTagEnd + 1;
      } else {
        const closingTag = `</${tagName}>`;
        position = closingTagStart + closingTag.length;
      }
    }
    
    console.log('TagParser DEBUG: parseXMLParameters - matches found:', foundCount);
    console.log('TagParser DEBUG: parseXMLParameters - final parameters:', Object.keys(parameters));
    return parameters;
  }

  /**
   * Parse attributes from attribute string
   * @param {string} attributeString - Attribute string to parse
   * @returns {Object} Parsed attributes
   */
  parseAttributes(attributeString) {
    const attributes = {};
    
    if (!attributeString) return attributes;
    
    const attrMatches = this.matchAll(attributeString, this.patterns.attribute);
    
    for (const match of attrMatches) {
      const attrName = match.groups[0];
      const attrValue = match.groups[1];
      
      attributes[attrName] = attrValue;
    }
    
    return attributes;
  }

  /**
   * Extract content from tags
   * @param {string} content - Content to search
   * @param {string} tagName - Tag name to extract
   * @returns {Array} Array of extracted content strings
   */
  static extractContent(content, tagName) {
    const pattern = new RegExp(`<${tagName}[^>]*>([^<]*)<\\/${tagName}>`, 'g');
    const matches = [];
    let match;
    
    while ((match = pattern.exec(content)) !== null) {
      matches.push(match[1].trim());
    }
    
    return matches;
  }

  /**
   * Extract tag with attributes
   * @param {string} content - Content to search
   * @param {string} tagName - Tag name to extract
   * @returns {Array} Array of extracted tag objects with content and attributes
   */
  static extractTagsWithAttributes(content, tagName) {
    const pattern = new RegExp(`<${tagName}\\s*([^>]*)>([^<]*)<\\/${tagName}>`, 'g');
    const tags = [];
    let match;
    
    while ((match = pattern.exec(content)) !== null) {
      const attributeString = match[1];
      const tagContent = match[2].trim();
      
      const parser = new TagParser();
      const attributes = parser.parseAttributes(attributeString);
      
      tags.push({
        content: tagContent,
        attributes,
        rawMatch: match[0]
      });
    }
    
    return tags;
  }

  /**
   * Check if JSON object represents a tool command
   * @private
   */
  isToolCommandJSON(obj) {
    return obj &&
           typeof obj === 'object' &&
           (obj.toolId || obj.tool) &&
           (obj.parameters || obj.actions || obj.files || this._hasToolParams(obj));
  }

  /**
   * Check if object has any tool-related parameters (excluding toolId/tool)
   * @private
   */
  _hasToolParams(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj);
    // Has more than just toolId/tool
    return keys.some(k => k !== 'toolId' && k !== 'tool');
  }

  /**
   * Match all occurrences of a pattern
   * @private
   */
  matchAll(content, pattern) {
    const matches = [];
    let match;
    
    // Reset pattern lastIndex to ensure clean matching
    pattern.lastIndex = 0;
    
    while ((match = pattern.exec(content)) !== null) {
      matches.push({
        match: match[0],
        groups: match.slice(1),
        index: match.index
      });
    }
    
    return matches;
  }

  /**
   * Validate tool command structure (JSON format)
   * @param {Object} command - Tool command to validate
   * @returns {Object} Validation result
   */
  validateToolCommand(command) {
    const errors = [];

    if (!command.toolId) {
      errors.push('Missing toolId');
    }

    if (!command.parameters && !command.actions) {
      errors.push('Missing parameters or actions');
    }

    if (command.type === COMMAND_FORMATS.JSON || command.type === COMMAND_FORMATS.JSON_PLAIN) {
      if (!command.jsonData) {
        errors.push('Missing jsonData for JSON command');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Normalize tool command to consistent format (JSON only)
   * @param {Object} command - Tool command to normalize
   * @returns {Object} Normalized command
   */
  normalizeToolCommand(command) {
    const normalized = {
      toolId: command.toolId,
      type: command.type,
      parameters: {},
      rawContent: command.rawContent
    };

    // JSON parameters are already in simple format
    normalized.parameters = { ...command.parameters };

    // Handle actions array format (common in agentcommunication tool)
    if (command.actions && Array.isArray(command.actions)) {
      normalized.parameters.actions = command.actions;

      // For agentcommunication tool, extract the action from the first item
      if (command.toolId === TOOL_IDS.AGENT_COMMUNICATION && command.actions.length > 0) {
        const firstAction = command.actions[0];
        normalized.parameters.action = firstAction.type || firstAction.action;
        // Spread the rest of the action properties
        Object.assign(normalized.parameters, firstAction);
      }
    }

    return normalized;
  }

  /**
   * Find the matching closing ``` for a code block, handling nested code blocks
   *
   * The challenge: JSON content may contain embedded ``` markers (e.g., README with bash examples)
   * We need to find the ``` that closes our JSON block, not a nested one inside the content.
   *
   * Strategy: Parse character by character, tracking if we're inside a JSON string.
   * When inside a string, ``` is just content. When outside strings, ``` closes the block.
   *
   * @param {string} content - Full content to search
   * @param {number} startPos - Position after the opening ```json marker
   * @returns {number} Position of the closing ```, or -1 if not found
   * @private
   */
  _findMatchingCodeBlockEnd(content, startPos) {
    let pos = startPos;
    let inString = false;
    let escaped = false;

    while (pos < content.length) {
      const char = content[pos];

      // Handle escape sequences inside strings
      if (escaped) {
        escaped = false;
        pos++;
        continue;
      }

      if (char === '\\' && inString) {
        escaped = true;
        pos++;
        continue;
      }

      // Track string boundaries
      if (char === '"') {
        inString = !inString;
        pos++;
        continue;
      }

      // Only look for ``` when we're outside of JSON strings
      if (!inString && content.substring(pos, pos + 3) === '```') {
        // Check this is the end marker (not another opening like ```bash)
        // The closing ``` should be followed by newline, EOF, or just whitespace
        const afterMarker = content.substring(pos + 3, pos + 20);
        const isClosingMarker = !afterMarker.match(/^[a-zA-Z]/); // Not followed by language name

        if (isClosingMarker) {
          return pos;
        }
      }

      pos++;
    }

    // Fallback: if we couldn't find it with state tracking,
    // try to find the last ``` in the content (less accurate but better than nothing)
    const lastBackticks = content.lastIndexOf('```', content.length);
    if (lastBackticks > startPos) {
      console.warn('[TagParser] Used fallback method to find closing code block');
      return lastBackticks;
    }

    return -1;
  }

  /**
   * Convert kebab-case or snake_case to camelCase
   * @private
   */
  _toCamelCase(str) {
    return str.replace(/[-_](.)/g, (_, char) => char.toUpperCase());
  }

  /**
   * Extract all content between tags, including nested tags
   * @param {string} content - Content to search
   * @param {string} startTag - Opening tag
   * @param {string} endTag - Closing tag
   * @returns {Array} Array of extracted content blocks
   */
  static extractBetweenTags(content, startTag, endTag) {
    const blocks = [];
    let startIndex = 0;
    
    while (true) {
      const start = content.indexOf(startTag, startIndex);
      if (start === -1) break;
      
      const end = content.indexOf(endTag, start + startTag.length);
      if (end === -1) break;
      
      const blockContent = content.substring(start + startTag.length, end);
      blocks.push({
        content: blockContent,
        fullMatch: content.substring(start, end + endTag.length),
        startIndex: start,
        endIndex: end + endTag.length
      });
      
      startIndex = end + endTag.length;
    }
    
    return blocks;
  }

  /**
   * Clean content by removing all tool commands and agent redirects
   * @param {string} content - Content to clean
   * @returns {string} Cleaned content
   */
  cleanContent(content) {
    let cleaned = content;
    
    // Remove tool command blocks
    cleaned = cleaned.replace(this.patterns.toolCommand, '');
    
    // Remove agent redirects
    cleaned = cleaned.replace(this.patterns.agentRedirect, '');
    
    // Remove JSON tool command blocks
    cleaned = cleaned.replace(this.patterns.jsonBlock, (match, jsonContent) => {
      try {
        const jsonData = JSON.parse(jsonContent);
        if (this.isToolCommandJSON(jsonData) || 
            (jsonData.toolCommands && Array.isArray(jsonData.toolCommands))) {
          return '';
        }
      } catch {
        // Not a tool command JSON block, keep it
      }
      return match;
    });
    
    // Clean up excessive whitespace
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
    cleaned = cleaned.trim();
    
    return cleaned;
  }
}

export default TagParser;