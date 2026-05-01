/**
 * ToolContentRenderer Component
 *
 * Parses message content for tool invocations and renders them
 * using specialized renderers or the fallback renderer.
 *
 * Architecture:
 * 1. Parse content for JSON tool invocation patterns (industry standard)
 * 2. Split content into text segments and tool blocks
 * 3. Render text with ReactMarkdown, tools with registry renderers
 *
 * Supported format (LLM industry standard):
 * - JSON code blocks: ```json {"toolId": "...", "parameters": {...}} ```
 */

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useAppStore } from '../../stores/appStore';
import { TOOL_IDS } from '../../constants/toolConstants';
import { getRenderer, setFallbackRenderer } from './registry';
import FallbackRenderer from './FallbackRenderer';
import { parseExternalBlocks, hasExternalBlock } from '../../utilities/parseExternalBlocks.js';
import ExternalBlockRenderer from '../externalRenderers/ExternalBlockRenderer.jsx';

// Initialize the fallback renderer in the registry
setFallbackRenderer(FallbackRenderer);

/**
 * Valid tool IDs for validation
 * Maps lowercase tool identifiers to canonical TOOL_IDS
 */
const VALID_TOOL_IDS = {
  [TOOL_IDS.TASK_MANAGER]: TOOL_IDS.TASK_MANAGER,
  [TOOL_IDS.FILESYSTEM]: TOOL_IDS.FILESYSTEM,
  [TOOL_IDS.TERMINAL]: TOOL_IDS.TERMINAL,
  [TOOL_IDS.WEB]: TOOL_IDS.WEB,
  [TOOL_IDS.AGENT_COMMUNICATION]: TOOL_IDS.AGENT_COMMUNICATION,
  [TOOL_IDS.AGENT_DELAY]: TOOL_IDS.AGENT_DELAY,
  [TOOL_IDS.JOB_DONE]: TOOL_IDS.JOB_DONE,
  [TOOL_IDS.IMPORT_ANALYZER]: TOOL_IDS.IMPORT_ANALYZER,
  [TOOL_IDS.DEPENDENCY_RESOLVER]: TOOL_IDS.DEPENDENCY_RESOLVER,
  [TOOL_IDS.CLONE_DETECTION]: TOOL_IDS.CLONE_DETECTION,
  [TOOL_IDS.FILE_TREE]: TOOL_IDS.FILE_TREE,
  [TOOL_IDS.FILE_CONTENT_REPLACE]: TOOL_IDS.FILE_CONTENT_REPLACE,
  [TOOL_IDS.SEEK]: TOOL_IDS.SEEK,
  [TOOL_IDS.STATIC_ANALYSIS]: TOOL_IDS.STATIC_ANALYSIS,
  [TOOL_IDS.CODE_MAP]: TOOL_IDS.CODE_MAP,
  [TOOL_IDS.PDF]: TOOL_IDS.PDF,
  [TOOL_IDS.DOC]: TOOL_IDS.DOC,
  [TOOL_IDS.SPREADSHEET]: TOOL_IDS.SPREADSHEET,
  [TOOL_IDS.VISUAL_EDITOR]: TOOL_IDS.VISUAL_EDITOR,
  [TOOL_IDS.HELP]: TOOL_IDS.HELP,
  [TOOL_IDS.MEMORY]: TOOL_IDS.MEMORY,
  [TOOL_IDS.SKILLS]: TOOL_IDS.SKILLS,
  [TOOL_IDS.USER_PROMPT]: TOOL_IDS.USER_PROMPT,
  // widget-module: remove this line if the module is deleted.
  [TOOL_IDS.WIDGET]: TOOL_IDS.WIDGET
};

/**
 * Check if a toolId is valid
 * @param {string} toolId - Tool ID to validate
 * @returns {string|null} Canonical tool ID or null if invalid
 */
/**
 * Parse a JSON block emitted by a model, tolerating the most common
 * shape mismatch: unescaped LF/CR/TAB inside string values. Strict
 * JSON.parse throws on those, but every model we use emits them
 * routinely in large tool-call payloads (filesystem writes,
 * file-content-replace, widget.content). The backend's tool_calls
 * ingestion bypasses this because the model API delivers parameters
 * as a structured object — but the frontend sees only the rendered
 * markdown code block and has to re-parse.
 *
 * Strategy: try strict parse first. On failure, walk the string,
 * track whether we're inside a double-quoted value, and escape raw
 * control characters found there. Try again. If THAT fails, give up
 * — the invocation is not recoverable and gets skipped (same as before).
 *
 * @returns {object|null}
 */
export function parseToolJsonLenient(raw) {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  try {
    const fixed = escapeControlCharsInJsonStrings(raw);
    return JSON.parse(fixed);
  } catch { return null; }
}

export function escapeControlCharsInJsonStrings(src) {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (escape) { out += ch; escape = false; continue; }
    if (ch === '\\') { out += ch; escape = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString) {
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
    }
    out += ch;
  }
  return out;
}

function getValidToolId(toolId) {
  if (!toolId) return null;
  const normalized = toolId.toLowerCase();
  return VALID_TOOL_IDS[normalized] || null;
}

/**
 * Parse content and extract tool invocations (JSON format only)
 *
 * @param {string} content - Message content to parse
 * @returns {Array} Array of segments: { type: 'text'|'tool', content, toolId?, rawContent? }
 */
function parseToolInvocations(content) {
  const segments = [];

  // JSON code blocks pattern: ```json ... ```
  // Capture the ENTIRE fenced body (not just the first balanced {...}) so
  // tool-call JSON that contains braces inside string values (e.g. widget
  // content with CSS "@keyframes { 0% { ... } }") doesn't get truncated.
  // The lenient parser below handles both valid JSON and the
  // common-model-quirk of unescaped LF/CR inside string values.
  const jsonPattern = /```json\s*([\s\S]*?)\s*```/g;

  // Collect all matches with their positions
  const matches = [];

  let match;
  while ((match = jsonPattern.exec(content)) !== null) {
    try {
      const jsonData = parseToolJsonLenient(match[1]);
      if (!jsonData) continue;

      // Extract toolId from standard JSON structure
      const rawToolId = jsonData.toolId || jsonData.tool;
      const toolId = getValidToolId(rawToolId);

      if (toolId) {
        // Normalize shape. The CLI's canonical inline tool-block is
        // { toolId, parameters: {...} } — but every per-tool renderer (and the
        // tool's own execute()) expects the param fields flat at the root of
        // parsedData (e.g. parsedData.actions, parsedData.command, etc.).
        // Flatten `parameters` into parsedData so renderers see a single shape
        // regardless of whether the block came from the Chat-Completions bridge,
        // the Responses-API bridge, or a model that emitted the block directly.
        const { parameters, ...rest } = jsonData;
        const flatParsed = (parameters && typeof parameters === 'object' && !Array.isArray(parameters))
          ? { ...rest, ...parameters }
          : jsonData;

        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          type: 'tool',
          toolId,
          rawContent: match[0],
          parsedData: flatParsed
        });
      }
    } catch {
      // Not valid JSON or not a tool command, skip
    }
  }

  // Sort matches by position
  matches.sort((a, b) => a.start - b.start);

  // Remove overlapping matches (keep first)
  const nonOverlapping = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      nonOverlapping.push(m);
      lastEnd = m.end;
    }
  }

  // Build segments array
  let currentPos = 0;
  for (const m of nonOverlapping) {
    // Add text segment before this match
    if (m.start > currentPos) {
      const textContent = content.substring(currentPos, m.start).trim();
      if (textContent) {
        segments.push({
          type: 'text',
          content: textContent
        });
      }
    }

    // Add tool segment
    segments.push({
      type: 'tool',
      toolId: m.toolId,
      rawContent: m.rawContent,
      parsedData: m.parsedData
    });

    currentPos = m.end;
  }

  // Add remaining text
  if (currentPos < content.length) {
    const textContent = content.substring(currentPos).trim();
    if (textContent) {
      segments.push({
        type: 'text',
        content: textContent
      });
    }
  }

  // If no tools found, return single text segment
  if (segments.length === 0 && content.trim()) {
    segments.push({
      type: 'text',
      content: content
    });
  }

  return segments;
}

/**
 * Markdown renderer component for text segments
 */
function MarkdownContent({ content }) {
  const { darkMode } = useAppStore();

  return (
    <ReactMarkdown
      components={{
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const language = match ? match[1] : '';

          // Code block with language tag → syntax highlighter
          if (!inline && language) {
            return (
              <SyntaxHighlighter
                style={darkMode ? oneDark : oneLight}
                language={language}
                PreTag="div"
                className="rounded-lg !mt-2 !mb-2"
                {...props}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            );
          }

          // Code block without language (``` ... ```) — preserve whitespace for ASCII tables/charts
          if (!inline) {
            return (
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto !mt-2 !mb-2">
                <code className="text-sm font-mono whitespace-pre block" {...props}>
                  {children}
                </code>
              </div>
            );
          }

          // Inline code (`text`)
          return (
            <code
              className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm font-mono"
              {...props}
            >
              {children}
            </code>
          );
        },
        // Passthrough — code block rendering is fully handled above
        pre({ children }) {
          return <>{children}</>;
        },
        // Wrap tables in scrollable container for wide content
        table({ children, ...props }) {
          return (
            <div className="overflow-x-auto my-2">
              <table {...props}>{children}</table>
            </div>
          );
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

/**
 * Match a tool segment to its corresponding result from toolResults.
 * Uses toolId matching with consumption tracking so multiple invocations
 * of the same tool each get their own result in order.
 *
 * @param {string} toolId - The tool ID from the parsed segment
 * @param {Array} toolResults - Array of tool result objects
 * @param {Map} consumedMap - Map<toolId, index> tracking which results have been consumed
 * @returns {object|null} The matched tool result, or null
 */
function matchToolResult(toolId, toolResults, consumedMap) {
  if (!toolResults || toolResults.length === 0) return null;
  const tid = toolId.toLowerCase();
  const startIdx = consumedMap.get(tid) || 0;
  for (let i = startIdx; i < toolResults.length; i++) {
    if ((toolResults[i].toolId || '').toLowerCase() === tid) {
      consumedMap.set(tid, i + 1); // consume this one
      return toolResults[i];
    }
  }
  return null;
}

/**
 * Tool-agnostic "Call + Result" details component.
 *
 * Shows the raw input parameters and the tool's output regardless of which
 * tool ran — works identically for all tools and for both chat-completion and
 * Responses-API paths (both deliver the tool call as a JSON block in
 * message content + the result in toolResults).
 *
 * Rationale: specific tool renderers (TaskManagerRenderer, TerminalRenderer,
 * etc.) are designed for specific param shapes and sometimes produce minimal
 * badges when the shape doesn't match. This component guarantees the user
 * always sees the actual data that was exchanged.
 */
function ToolCallDetails({ toolId, parsedData, matchedResult, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const { darkMode } = useAppStore();

  // Strip internal-only keys injected by the renderer pipeline.
  const INTERNAL_KEYS = new Set(['_result', '_hasResults', '_executionTime', '_status', '_error', 'success']);
  const displayParams = Object.fromEntries(
    Object.entries(parsedData || {}).filter(([k]) => !INTERNAL_KEYS.has(k) && k !== 'toolId')
  );

  const result = matchedResult?.result;
  const resultText = (() => {
    if (result == null) return null;
    if (typeof result === 'string') return result;
    try { return JSON.stringify(result, null, 2); }
    catch { return String(result); }
  })();

  const paramsText = (() => {
    try { return JSON.stringify(displayParams, null, 2); }
    catch { return String(displayParams); }
  })();

  const hasError = matchedResult?.status === 'failed' || matchedResult?.error;
  const statusLabel = matchedResult
    ? (hasError ? '⚠ failed' : '✓ completed')
    : 'pending…';
  const statusColor = matchedResult
    ? (hasError
        ? 'text-red-600 dark:text-red-400'
        : 'text-green-600 dark:text-green-400')
    : 'text-amber-500 dark:text-amber-400';

  return (
    <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        {open
          ? <ChevronDownIcon className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          : <ChevronRightIcon className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        }
        <span className="font-mono text-gray-700 dark:text-gray-300 font-medium">{toolId}</span>
        <span className={`ml-auto text-[10px] uppercase tracking-wider ${statusColor}`}>
          {statusLabel}
        </span>
        {matchedResult?.executionTime && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
            {(matchedResult.executionTime / 1000).toFixed(1)}s
          </span>
        )}
      </button>
      {open && (
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          <div className="p-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
              Parameters
            </div>
            <SyntaxHighlighter
              style={darkMode ? oneDark : oneLight}
              language="json"
              PreTag="div"
              className="!m-0 !text-xs"
              customStyle={{ margin: 0, padding: '0.5rem', borderRadius: '0.25rem' }}
            >
              {paramsText}
            </SyntaxHighlighter>
          </div>
          {matchedResult && (
            <div className="p-2">
              <div className={`text-[10px] uppercase tracking-wider mb-1 ${hasError ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {hasError ? 'Error' : 'Result'}
              </div>
              {hasError ? (
                <pre className="text-xs font-mono bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                  {matchedResult.error || resultText || 'unknown error'}
                </pre>
              ) : resultText ? (
                <SyntaxHighlighter
                  style={darkMode ? oneDark : oneLight}
                  language={typeof result === 'string' ? 'text' : 'json'}
                  PreTag="div"
                  className="!m-0 !text-xs"
                  customStyle={{ margin: 0, padding: '0.5rem', borderRadius: '0.25rem' }}
                >
                  {resultText}
                </SyntaxHighlighter>
              ) : (
                <div className="text-xs text-gray-400 dark:text-gray-500 italic">No output</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Main ToolContentRenderer component
 * @param {string} content - Message content to render
 * @param {string} messageTimestamp - Timestamp of the message (for delay calculations)
 * @param {string} agentId - Agent ID (for skip delay functionality)
 * @param {Array} toolResults - Tool results from completed execution (injected from MessageBubble)
 * @param {Array} toolExecutions - Tool execution status list
 * @param {boolean} pendingToolExecution - Whether tools are still executing
 */
/**
 * Render tool + text segments for a single chunk of textual content.
 * Extracted so the outer component can first split content by <external>
 * blocks and then run this inner parser only on the truly-local text parts.
 * This keeps the existing tool-invocation + markdown rendering unchanged
 * while letting external blocks bypass it entirely and render as cards.
 */
function InnerToolSegments({ text, messageTimestamp, agentId, toolResults, consumedMap, pendingToolExecution }) {
  const segments = parseToolInvocations(text);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return (
            <div key={index} className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownContent content={segment.content} />
            </div>
          );
        }

        if (segment.type === 'tool') {
          const Renderer = getRenderer(segment.toolId);
          const matchedResult = matchToolResult(segment.toolId, toolResults, consumedMap);

          let enrichedParsedData = segment.parsedData;
          if (matchedResult && matchedResult.result) {
            const resultPayload = typeof matchedResult.result === 'string'
              ? { output: matchedResult.result }
              : matchedResult.result;
            enrichedParsedData = {
              ...segment.parsedData,
              _result: resultPayload,
              success: matchedResult.status === 'completed',
              _hasResults: true,
              _executionTime: matchedResult.executionTime,
              _status: matchedResult.status,
              _error: matchedResult.error
            };
          } else if (matchedResult && matchedResult.error) {
            enrichedParsedData = {
              ...segment.parsedData,
              _result: null,
              success: false,
              _hasResults: true,
              _status: 'failed',
              _error: matchedResult.error,
              _executionTime: matchedResult.executionTime
            };
          }

          const isExecuting = pendingToolExecution && !matchedResult;

          return (
            <div key={index} className="relative">
              <Renderer
                toolId={segment.toolId}
                rawContent={segment.rawContent}
                innerContent={segment.innerContent}
                parsedData={enrichedParsedData}
                messageTimestamp={messageTimestamp}
                agentId={agentId}
              />
              {isExecuting && (
                <div className="absolute top-2 right-2">
                  <svg className="w-4 h-4 text-amber-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              )}
              <ToolCallDetails
                toolId={segment.toolId}
                parsedData={segment.parsedData}
                matchedResult={matchedResult}
              />
            </div>
          );
        }

        return null;
      })}
    </>
  );
}

function ToolContentRenderer({ content, messageTimestamp, agentId, toolResults, toolExecutions, pendingToolExecution }) {
  // Normalize content to string — some models return content as an array of parts
  // e.g. [{type: "text", text: "..."}] instead of a plain string, which causes
  // React Error #31 ("Objects are not valid as a React child")
  const normalizedContent = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('')
      : content != null
        ? String(content)
        : '';

  // Shared tool-result consumption tracker so the ordering is preserved
  // even across multiple text sub-segments (an <external> block between
  // two tool calls must not reset which tool result is "next").
  const consumedMap = new Map();

  // Fast path: no <external> blocks at all → skip the outer segmentation
  // and render exactly as before.
  if (!hasExternalBlock(normalizedContent)) {
    return (
      <div className="tool-content-renderer">
        <InnerToolSegments
          text={normalizedContent}
          messageTimestamp={messageTimestamp}
          agentId={agentId}
          toolResults={toolResults}
          consumedMap={consumedMap}
          pendingToolExecution={pendingToolExecution}
        />
      </div>
    );
  }

  // First pass: split by <external> tags. Text between/around blocks goes
  // through the normal tool-invocation + markdown pipeline; external
  // blocks render as platform-styled cards.
  const externalSegments = parseExternalBlocks(normalizedContent);

  return (
    <div className="tool-content-renderer">
      {externalSegments.map((seg, index) => {
        if (seg.type === 'text') {
          return (
            <InnerToolSegments
              key={`t-${index}`}
              text={seg.text}
              messageTimestamp={messageTimestamp}
              agentId={agentId}
              toolResults={toolResults}
              consumedMap={consumedMap}
              pendingToolExecution={pendingToolExecution}
            />
          );
        }
        // Both 'external' and 'external-streaming' render through the same
        // dispatcher — the streaming flag controls the skeleton chrome.
        // On persisted (non-streaming) messages we should never see
        // 'external-streaming' in practice, but render defensively.
        return (
          <ExternalBlockRenderer
            key={`ext-${index}`}
            to={seg.to}
            text={seg.text}
            streaming={seg.type === 'external-streaming'}
          />
        );
      })}
    </div>
  );
}

export default ToolContentRenderer;
