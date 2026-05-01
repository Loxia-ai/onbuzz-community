/**
 * Help Tool - Provides full tool documentation on demand
 *
 * Purpose:
 * - Part of the two-layer tool description system
 * - Layer 1: Compact tool index in system prompt (summaries only)
 * - Layer 2: This tool provides full descriptions when agents need them
 * - Reduces system prompt token usage by ~65-75%
 */

import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';

class HelpTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);
    this.id = 'help';
    this.name = 'Help Tool';
    this.description = 'Get full documentation for any available tool';
    this.version = '1.0.0';
    this.requiresProject = false;
    this.isAsync = false;
    this.toolsRegistry = null;
  }

  /**
   * Set the ToolsRegistry reference for accessing tool descriptions
   * @param {ToolsRegistry} registry
   */
  setToolsRegistry(registry) {
    this.toolsRegistry = registry;
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
Help Tool: Get full documentation for any available tool.

USAGE:

1. **Get full documentation for a specific tool:**
\`\`\`json
{
  "toolId": "help",
  "parameters": { "tool": "filesystem" }
}
\`\`\`

2. **List all available tools with summaries:**
\`\`\`json
{
  "toolId": "help",
  "parameters": { "list": true }
}
\`\`\`

NOTES:
- Use this tool before using any tool for the first time to get its full documentation
- The "tool" parameter accepts any valid tool ID (e.g., "terminal", "filesystem", "web", "pdf")
- Use "list" to see all available tool IDs and their brief descriptions
    `.trim();
  }

  /**
   * Parse parameters from tool command content
   * @param {string} content - Raw tool command content
   * @returns {Object} Parsed parameters object
   */
  parseParameters(content) {
    try {
      const toolMatches = TagParser.extractContent(content, 'tool');
      const listMatches = TagParser.extractContent(content, 'list');

      return {
        tool: toolMatches.length > 0 ? toolMatches[0].trim() : null,
        list: listMatches.length > 0 ? listMatches[0].trim() === 'true' : false
      };
    } catch (error) {
      throw new Error(`Failed to parse Help tool parameters: ${error.message}`);
    }
  }

  /**
   * Get supported actions
   * @returns {Array<string>}
   */
  getSupportedActions() {
    return ['get-description', 'list-tools'];
  }

  /**
   * Execute help tool
   * @param {Object} params - Parsed parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(params, context) {
    if (!this.toolsRegistry) {
      return {
        success: false,
        error: 'Help tool not properly initialized',
        output: 'Help tool requires a ToolsRegistry reference. This is an internal configuration issue.'
      };
    }

    const { tool, list, parameters } = params;

    // Handle nested parameters from JSON invocation format
    const targetTool = tool || parameters?.tool || null;
    const showList = list || parameters?.list || false;

    if (showList) {
      return this.listTools();
    }

    if (targetTool) {
      return this.getToolDescription(targetTool);
    }

    return {
      success: false,
      error: 'No tool specified',
      output: 'Please specify a tool name with {"tool": "toolname"} or use {"list": true} to see all available tools.'
    };
  }

  /**
   * Get full description for a specific tool
   * @param {string} toolId - Tool identifier
   * @returns {Object} Tool description result
   */
  getToolDescription(toolId) {
    const tool = this.toolsRegistry.getTool(toolId);

    if (!tool) {
      const available = this.toolsRegistry.listTools().join(', ');
      return {
        success: false,
        error: `Tool not found: ${toolId}`,
        output: `No tool found with ID "${toolId}".\n\nAvailable tools: ${available}`
      };
    }

    const description = tool.getDescription();
    const capabilities = tool.getCapabilities();
    const actions = capabilities.supportedActions || ['execute'];

    let output = `## ${toolId.toUpperCase()} TOOL - Full Documentation\n\n`;
    output += description;
    output += `\n\n---\nSupported actions: ${actions.join(', ')}`;
    output += `\nAsync: ${capabilities.async ? 'Yes' : 'No'}`;
    output += `\nRequires project: ${capabilities.requiresProject ? 'Yes' : 'No'}`;

    return {
      success: true,
      action: 'get-description',
      toolId,
      description,
      supportedActions: actions,
      output
    };
  }

  /**
   * List all available tools with summaries
   * @returns {Object} Tool list result
   */
  listTools() {
    const tools = this.toolsRegistry.listTools();

    let output = '## Available Tools\n\n';

    for (const toolId of tools) {
      const summary = this.toolsRegistry.toolSummaries.get(toolId) || `${toolId} tool`;
      const tool = this.toolsRegistry.getTool(toolId);
      const enabled = tool ? tool.isEnabled : false;
      output += `- **${toolId}**: ${summary}${enabled ? '' : ' (disabled)'}\n`;
    }

    output += `\n---\nTotal: ${tools.length} tools`;
    output += `\n\nUse \`{"toolId": "help", "parameters": {"tool": "toolname"}}\` to get full documentation for any tool.`;

    return {
      success: true,
      action: 'list-tools',
      tools: tools.map(id => ({
        id,
        summary: this.toolsRegistry.toolSummaries.get(id) || `${id} tool`
      })),
      output
    };
  }
}

export default HelpTool;
