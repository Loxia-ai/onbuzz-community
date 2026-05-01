/**
 * StreamingBubble Component
 *
 * Displays AI response content as it streams in real-time with progressive
 * tool rendering. Complete tool invocations are rendered with pretty UI,
 * while in-progress tools show skeleton placeholders.
 *
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║  DESIGN GUIDELINE: VISUAL CONSISTENCY WITH MessageBubble                   ║
 * ╠════════════════════════════════════════════════════════════════════════════╣
 * ║  This component MUST visually match MessageBubble.jsx as closely as        ║
 * ║  possible to ensure a seamless transition when streaming completes.        ║
 * ║                                                                            ║
 * ║  Shared design elements (keep in sync):                                    ║
 * ║  - Container: message-bubble message-assistant CSS classes                 ║
 * ║  - Layout: flex items-start space-x-3                                      ║
 * ║  - Avatar: w-8 h-8 rounded-full bg-loxia-600 with CpuChipIcon             ║
 * ║  - Header: text-sm font-medium for name, text-xs for metadata              ║
 * ║  - Content: prose prose-sm dark:prose-invert max-w-none                    ║
 * ║                                                                            ║
 * ║  Differences (streaming-specific):                                         ║
 * ║  - Streaming indicator badge in header                                     ║
 * ║  - Typing cursor at end of content                                         ║
 * ║  - PendingToolCard for in-progress tools                                   ║
 * ║  - maxHeight constraint with overflow for long streaming content           ║
 * ║                                                                            ║
 * ║  If you modify MessageBubble styling, update this component to match!      ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 *
 * Features:
 * - Progressive markdown rendering
 * - Complete tool detection and pretty rendering
 * - Pending tool skeleton cards
 * - Auto-scroll to latest content
 * - Syntax highlighting for code blocks
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { CpuChipIcon } from '@heroicons/react/24/outline';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAppStore } from '../stores/appStore.js';
import { parseStreamingContent, resetParseCache } from './toolRenderers/streamingParser.js';
import { getRenderer } from './toolRenderers/registry.js';
import PendingToolCard from './toolRenderers/PendingToolCard.jsx';
import FallbackRenderer from './toolRenderers/FallbackRenderer.jsx';
import { parseExternalBlocks, hasExternalBlock } from '../utilities/parseExternalBlocks.js';
import ExternalBlockRenderer from './externalRenderers/ExternalBlockRenderer.jsx';
import ReasoningPanel from './ReasoningPanel.jsx';

/**
 * StreamingBubble displays AI response content as it streams in real-time.
 *
 * @param {Object} props
 * @param {string} props.content - Accumulated streaming content
 * @param {string} props.model - Model name being used
 * @param {string} props.agentName - Name of the agent
 * @param {boolean} props.isComplete - Whether streaming has completed
 */
function StreamingBubble({
  content,
  model,
  agentName = 'Agent',
  isComplete = false,
  // Reasoning fields become meaningful once stream_complete arrives with
  // them (see appStore.js `case 'stream_complete'`). During streaming they
  // may be empty; we still render a "thinking…" pulse for reasoning-capable
  // models so the operator knows deliberation is in flight.
  reasoning = '',
  reasoningTokens = null,
}) {
  const contentRef = useRef(null);
  const { darkMode } = useAppStore();

  // Reset incremental parse cache when a new stream starts (content resets to empty/short)
  const prevLengthRef = useRef(0);
  useEffect(() => {
    if (!content || content.length < prevLengthRef.current) {
      resetParseCache();
    }
    prevLengthRef.current = content?.length || 0;
  }, [content]);

  // Parse content for tool segments — uses incremental cache internally
  // so only the new tail is regex-scanned. After the tool-streaming parser
  // does its work, we post-process 'text' segments to peel out
  // <external>…</external> blocks into their own platform-styled cards
  // (with skeleton state for blocks that haven't closed yet).
  //
  // We avoid feeding sub-strings into parseStreamingContent because its
  // incremental cache assumes it sees the FULL content on every call.
  // Post-processing text segments keeps that invariant intact.
  const segments = useMemo(() => {
    if (!content) return [];
    const base = parseStreamingContent(content);
    if (!hasExternalBlock(content)) return base;

    const flat = [];
    for (const seg of base) {
      if (seg.type !== 'text') { flat.push(seg); continue; }
      const split = parseExternalBlocks(seg.content);
      // No externals in this text chunk — keep as-is.
      if (split.every(s => s.type === 'text')) { flat.push(seg); continue; }
      // Interleave text and external sub-segments, preserving order.
      for (const s of split) {
        if (s.type === 'text') {
          if (s.text.length > 0) flat.push({ type: 'text', content: s.text });
        } else {
          flat.push(s);  // 'external' or 'external-streaming'
        }
      }
    }
    return flat;
  }, [content]);

  // Note: Auto-scroll is handled by VirtualizedMessageList with isStreaming prop
  // The contentRef is kept for potential future use (e.g., scroll within code blocks)

  // Markdown components configuration for ReactMarkdown
  const markdownComponents = useMemo(() => ({
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';

      // Don't render json blocks as syntax highlighted if they contain tool invocations
      // (they should be handled by tool renderers)
      if (language === 'json' && String(children).includes('"toolId"')) {
        return null; // Will be handled by tool renderer
      }

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
  }), [darkMode]);

  /**
   * Render a single segment based on its type
   */
  const renderSegment = (segment, index) => {
    switch (segment.type) {
      case 'text':
        return (
          <div key={`text-${index}`} className="streaming-text-segment">
            <ReactMarkdown components={markdownComponents}>
              {segment.content}
            </ReactMarkdown>
          </div>
        );

      case 'tool-complete': {
        // Get the specialized renderer for this tool
        const Renderer = getRenderer(segment.toolId);

        // Use FallbackRenderer if no renderer found
        if (!Renderer) {
          return (
            <div key={`tool-${index}`} className="my-2">
              <FallbackRenderer
                toolId={segment.toolId}
                rawContent={segment.rawContent}
                parsedData={segment.data}
              />
            </div>
          );
        }

        return (
          <div key={`tool-${index}`} className="my-2">
            <Renderer
              toolId={segment.toolId}
              rawContent={segment.rawContent}
              parsedData={segment.data}
              data={segment.data}
              isStreaming={true}
            />
          </div>
        );
      }

      case 'tool-pending':
        return (
          <PendingToolCard
            key={`pending-${index}`}
            toolId={segment.toolId}
            action={segment.action}
            partial={segment.partial}
          />
        );

      case 'external':
      case 'external-streaming':
        return (
          <ExternalBlockRenderer
            key={`ext-${index}`}
            to={segment.to}
            text={segment.text}
            streaming={segment.type === 'external-streaming'}
          />
        );

      default:
        return null;
    }
  };

  return (
    // ⚠️ DESIGN SYNC: Container classes must match MessageBubble.jsx
    // Uses message-bubble + message-assistant classes for visual consistency
    <div className="message-bubble message-assistant">
      {/* ⚠️ DESIGN SYNC: Layout must match MessageBubble.jsx */}
      <div className="flex items-start space-x-3">
        {/* ⚠️ DESIGN SYNC: Avatar must match MessageBubble.jsx */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-loxia-600">
          <CpuChipIcon className="w-5 h-5 text-white" />
        </div>

        {/* Message Content */}
        <div className="flex-1 min-w-0">
          {/* ⚠️ DESIGN SYNC: Header layout must match MessageBubble.jsx */}
          <div className="flex items-center mb-1">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {agentName}
            </span>
            {/* Model badge - similar to timestamp position in MessageBubble */}
            {model && (
              <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
                {model}
              </span>
            )}
            {/* Streaming indicator - unique to StreamingBubble */}
            {!isComplete && (
              <span className="ml-2 flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                streaming
              </span>
            )}
          </div>

          {/* Reasoning panel. During streaming we render it as a
              "thinking…" pulse; once stream_complete arrives with
              reasoning text/tokens, it becomes the regular collapsible
              pill. Rendered ABOVE the content block so it doesn't pop
              in/out of position when it flips from pulsing to settled. */}
          <ReasoningPanel
            reasoning={reasoning}
            reasoningTokens={reasoningTokens}
          />

          {/* ⚠️ DESIGN SYNC: Content container must match MessageBubble.jsx */}
          {/* Note: No maxHeight constraint - VirtualizedMessageList handles scrolling */}
          {/* Tool renderers need full height for expand/collapse functionality */}
          <div
            ref={contentRef}
            className="prose prose-sm dark:prose-invert max-w-none"
          >
            {segments.length > 0 ? (
              <>
                {segments.map((segment, index) => renderSegment(segment, index))}
                {/* Typing cursor indicator - unique to StreamingBubble */}
                {!isComplete && (
                  <span className="inline-block w-2 h-4 bg-gray-400 dark:bg-gray-500 animate-pulse ml-1 align-middle" />
                )}
              </>
            ) : (
              // Initial loading state when no content yet
              <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <div className="flex gap-1">
                  <span
                    className="w-2 h-2 bg-loxia-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="w-2 h-2 bg-loxia-400 rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="w-2 h-2 bg-loxia-400 rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
                <span className="text-sm">Starting response...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default StreamingBubble;
