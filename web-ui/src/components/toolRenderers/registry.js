/**
 * Tool Renderer Registry
 *
 * Manages the mapping between tool IDs and their specialized renderers.
 * Uses TOOL_IDS constants to ensure type safety and avoid magic strings.
 *
 * Architecture:
 * - Each tool ID from TOOL_IDS must be explicitly registered
 * - null value means "use fallback renderer" (explicit choice)
 * - Unregistered tool IDs will warn and use fallback
 * - New renderers are added by importing and registering here
 */

import { TOOL_IDS, isValidToolId, getToolDisplayName } from '../../constants/toolConstants';

// Import renderers (add imports as renderers are created)
import TaskManagerRenderer from './TaskManagerRenderer';
import FileSystemRenderer from './FileSystemRenderer';
import FileContentReplaceRenderer from './FileContentReplaceRenderer';
import JobDoneRenderer from './JobDoneRenderer';
import TerminalRenderer from './TerminalRenderer';
import AgentCommunicationRenderer from './AgentCommunicationRenderer';
import AgentDelayRenderer from './AgentDelayRenderer';
import SeekRenderer from './SeekRenderer';
import FileTreeRenderer from './FileTreeRenderer';
import CodeMapRenderer from './CodeMapRenderer';
import StaticAnalysisRenderer from './StaticAnalysisRenderer';
import CloneDetectionRenderer from './CloneDetectionRenderer';
import ImportAnalyzerRenderer from './ImportAnalyzerRenderer';
import DependencyResolverRenderer from './DependencyResolverRenderer';
import PdfRenderer from './PdfRenderer';
import DocRenderer from './DocRenderer';
import SpreadsheetRenderer from './SpreadsheetRenderer';
import WebToolRenderer from './WebToolRenderer';
import VisualEditorRenderer from './VisualEditorRenderer';
import MemoryRenderer from './MemoryRenderer';
import SkillsRenderer from './SkillsRenderer';
import UserPromptRenderer from './UserPromptRenderer';
import HelpRenderer from './HelpRenderer';
import PlatformControlRenderer from './PlatformControlRenderer';
// widget-module: remove this line if the module is deleted.
import { WidgetRenderer } from '../../modules/widget';

/**
 * The renderer registry Map
 * Key: TOOL_IDS constant value
 * Value: React component or null (for fallback)
 *
 * IMPORTANT: Every tool in TOOL_IDS should be listed here explicitly.
 * Use `null` to indicate "use fallback renderer" - this makes it clear
 * that the tool was considered but no custom renderer exists yet.
 */
const RENDERER_REGISTRY = new Map([
  // Tools with custom renderers
  [TOOL_IDS.FILESYSTEM, FileSystemRenderer],
  [TOOL_IDS.TASK_MANAGER, TaskManagerRenderer],
  [TOOL_IDS.FILE_CONTENT_REPLACE, FileContentReplaceRenderer],
  [TOOL_IDS.JOB_DONE, JobDoneRenderer],
  [TOOL_IDS.TERMINAL, TerminalRenderer],

  // Agent communication
  [TOOL_IDS.AGENT_COMMUNICATION, AgentCommunicationRenderer],

  // Agent delay
  [TOOL_IDS.AGENT_DELAY, AgentDelayRenderer],

  // Code analysis & search
  [TOOL_IDS.SEEK, SeekRenderer],
  [TOOL_IDS.FILE_TREE, FileTreeRenderer],
  [TOOL_IDS.CODE_MAP, CodeMapRenderer],
  [TOOL_IDS.STATIC_ANALYSIS, StaticAnalysisRenderer],
  [TOOL_IDS.CLONE_DETECTION, CloneDetectionRenderer],
  [TOOL_IDS.IMPORT_ANALYZER, ImportAnalyzerRenderer],
  [TOOL_IDS.DEPENDENCY_RESOLVER, DependencyResolverRenderer],

  // Web automation
  [TOOL_IDS.WEB, WebToolRenderer],

  // Visual editor
  [TOOL_IDS.VISUAL_EDITOR, VisualEditorRenderer],

  // Document tools
  [TOOL_IDS.PDF, PdfRenderer],
  [TOOL_IDS.DOC, DocRenderer],
  [TOOL_IDS.SPREADSHEET, SpreadsheetRenderer],

  // Help — command-palette style
  [TOOL_IDS.HELP, HelpRenderer],

  // Memory — rolodex + reminisce timeline
  [TOOL_IDS.MEMORY, MemoryRenderer],

  // Skills — grimoire/spellbook
  [TOOL_IDS.SKILLS, SkillsRenderer],

  // User prompt — form receipt with carbon-copy REPLIED stamp
  [TOOL_IDS.USER_PROMPT, UserPromptRenderer],

  // Platform control — flight-plan style schedule cards + 24h time strip
  [TOOL_IDS.PLATFORM_CONTROL, PlatformControlRenderer],

  // widget-module: remove this line if the module is deleted.
  [TOOL_IDS.WIDGET, WidgetRenderer],
]);

/**
 * Fallback renderer reference (set during initialization)
 * This avoids circular imports
 */
let FallbackRendererRef = null;

/**
 * Set the fallback renderer component
 * Called during module initialization
 */
export function setFallbackRenderer(renderer) {
  FallbackRendererRef = renderer;
}

/**
 * Get the appropriate renderer for a tool ID
 *
 * @param {string} toolId - The tool ID (should be from TOOL_IDS)
 * @returns {React.Component} The renderer component
 */
export function getRenderer(toolId) {
  // Validate tool ID
  if (!isValidToolId(toolId)) {
    console.warn(`[ToolRegistry] Unknown tool ID: "${toolId}". Using fallback renderer.`);
    return FallbackRendererRef;
  }

  // Check if registered
  if (!RENDERER_REGISTRY.has(toolId)) {
    console.warn(`[ToolRegistry] Tool "${toolId}" not in registry. Using fallback renderer.`);
    return FallbackRendererRef;
  }

  // Get renderer (may be null for explicit fallback)
  const renderer = RENDERER_REGISTRY.get(toolId);
  return renderer || FallbackRendererRef;
}

/**
 * Register a custom renderer for a tool
 *
 * @param {string} toolId - Must be a valid TOOL_IDS value
 * @param {React.Component} renderer - The renderer component
 * @throws {Error} If toolId is not valid
 */
export function registerRenderer(toolId, renderer) {
  if (!isValidToolId(toolId)) {
    throw new Error(
      `[ToolRegistry] Invalid tool ID: "${toolId}". ` +
      `Must be one of: ${Object.keys(TOOL_IDS).join(', ')}`
    );
  }

  RENDERER_REGISTRY.set(toolId, renderer);
  console.log(`[ToolRegistry] Registered renderer for "${getToolDisplayName(toolId)}"`);
}

/**
 * Check if a tool has a custom renderer (not fallback)
 *
 * @param {string} toolId - The tool ID to check
 * @returns {boolean} True if tool has a custom renderer
 */
export function hasCustomRenderer(toolId) {
  return RENDERER_REGISTRY.has(toolId) && RENDERER_REGISTRY.get(toolId) !== null;
}

/**
 * Get list of all registered tool IDs
 *
 * @returns {string[]} Array of tool IDs
 */
export function getRegisteredToolIds() {
  return Array.from(RENDERER_REGISTRY.keys());
}

/**
 * Get list of tools with custom renderers
 *
 * @returns {string[]} Array of tool IDs with custom renderers
 */
export function getToolsWithCustomRenderers() {
  return Array.from(RENDERER_REGISTRY.entries())
    .filter(([, renderer]) => renderer !== null)
    .map(([toolId]) => toolId);
}

export default {
  getRenderer,
  registerRenderer,
  setFallbackRenderer,
  hasCustomRenderer,
  getRegisteredToolIds,
  getToolsWithCustomRenderers
};
