import React from 'react';
import {
  UserIcon,
  CpuChipIcon,
  WrenchScrewdriverIcon,
  ExclamationCircleIcon
} from '@heroicons/react/24/outline';
import { useAppStore } from '../stores/appStore.js';
import { AgentMessageDisplay } from './toolRenderers/AgentCommunicationRenderer.jsx';
import ToolContentRenderer from './toolRenderers/ToolContentRenderer.jsx';
import ToolResultCard from './ToolResultCard.jsx';
import ReasoningPanel from './ReasoningPanel.jsx';

function MessageBubble({ message }) {
  const { currentAgent } = useAppStore();
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isTool = message.role === 'tool';

  // Handle tool role messages (persisted tool results)
  if (isTool) {
    // Convert the message format to match ToolResultCard expectations
    const toolResult = {
      id: message.id,
      toolId: message.toolId || 'unknown',
      status: message.status || 'completed',
      result: message.result || message.content,
      error: message.error,
      executionTime: message.executionTime,
      timestamp: message.timestamp
    };

    return (
      <div className="my-2">
        <ToolResultCard
          result={toolResult}
          defaultExpanded={false}
        />
      </div>
    );
  }

  // Check if this is an inter-agent communication message
  if (message.metadata?.type === 'agent-communication') {
    const messageData = {
      eventType: message.metadata.eventType,
      timestamp: message.timestamp,
      sender: {
        name: message.metadata.senderName || 'Unknown Agent'
      },
      recipients: message.metadata.recipients || [],
      subject: message.metadata.subject || '',
      content: message.metadata.content || message.content,
      priority: message.metadata.priority || 'normal',
      requiresReply: message.metadata.requiresReply || false,
      hasAttachments: message.metadata.hasAttachments || false,
      attachmentCount: message.metadata.attachmentCount || 0,
      conversationId: message.metadata.conversationId || 'unknown'
    };

    // Determine if this is an outgoing message from current agent
    const isOutgoing = currentAgent && (
      message.metadata.senderId === currentAgent.id ||
      message.metadata.senderName === currentAgent.name
    );

    return <AgentMessageDisplay message={messageData} isOutgoing={isOutgoing} />;
  }

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const renderToolResults = (toolResults) => {
    if (!toolResults || toolResults.length === 0) return null;

    return (
      <div className="mt-4 space-y-2">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center">
          <WrenchScrewdriverIcon className="w-4 h-4 mr-1" />
          Tool Results ({toolResults.length})
        </div>

        {toolResults.map((result, index) => (
          <ToolResultCard
            key={result.id || index}
            result={result}
            defaultExpanded={false}
          />
        ))}
      </div>
    );
  };

  const renderAgentRedirects = (agentRedirects) => {
    if (!agentRedirects || agentRedirects.length === 0) return null;

    return (
      <div className="mt-4 space-y-2">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center">
          <CpuChipIcon className="w-4 h-4 mr-1" />
          Agent Communications
        </div>
        
        {agentRedirects.map((redirect, index) => (
          <div key={index} className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center mb-2">
              <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                → {redirect.to}
              </span>
              {redirect.urgent && (
                <span className="ml-2 px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded">
                  Urgent
                </span>
              )}
            </div>
            
            <div className="text-sm text-blue-800 dark:text-blue-200">
              {typeof redirect.content === 'string' ? redirect.content : JSON.stringify(redirect.content)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderContextReferences = (contextReferences) => {
    if (!contextReferences || contextReferences.length === 0) return null;

    return (
      <div className="mt-2 mb-3">
        <div className="flex flex-wrap gap-1">
          {contextReferences.map((ref, index) => (
            <span key={index} 
              className="inline-flex items-center px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded"
            >
              📎 {ref.name || ref.path}
            </span>
          ))}
        </div>
      </div>
    );
  };

  // FIX: Don't render internal system messages (scheduler prompts)
  const contentStr = typeof message.content === 'string' ? message.content : '';
  if (isSystem && (message.type === 'scheduler-prompt' ||
      (contentStr && contentStr.includes('queued message(s) to process')))) {
    return null;
  }

  return (
    <div className={`message-bubble ${
      isUser ? 'message-user' :
      isSystem ? 'message-system' :
      'message-assistant'
    }${message.isPending ? ' animate-pulse opacity-70' : ''}`}>
      <div className="flex items-start space-x-3">
        {/* Avatar */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser 
            ? 'bg-gray-200 dark:bg-gray-700' 
            : isSystem
            ? 'bg-amber-500 dark:bg-amber-600'
            : 'bg-loxia-600'
        }`}>
          {isUser ? (
            <UserIcon className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          ) : isSystem ? (
            <ExclamationCircleIcon className="w-5 h-5 text-white" />
          ) : (
            <CpuChipIcon className="w-5 h-5 text-white" />
          )}
        </div>

        {/* Message Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center mb-1">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {isUser ? 'You' : 
               isSystem ? 'System' : 
               message.agentName || 'Agent'}
            </span>
            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
              {formatTimestamp(message.timestamp)}
            </span>
            {message.isPending && (
              <span className="ml-2 text-xs text-gray-400 italic flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Queued
              </span>
            )}
          </div>

          {/* Context References */}
          {renderContextReferences(message.contextReferences)}

          {/* Reasoning / thinking panel — only renders when the model
              produced thinking tokens on this turn (reasoning text from
              DeepSeek-R1 / Kimi / xAI / Claude-thinking, or an opaque
              reasoning_tokens count from OpenAI o-series). Collapsed by
              default. No-op for non-reasoning messages. */}
          <ReasoningPanel
            reasoning={message.reasoning}
            reasoningTokens={message.reasoningTokens}
          />

          {/* Message Content - Uses ToolContentRenderer for tool invocation detection */}
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ToolContentRenderer
              content={message.content}
              messageTimestamp={message.timestamp}
              agentId={message.agentId}
              toolResults={message.toolResults}
              toolExecutions={message.toolExecutions}
              pendingToolExecution={message.pendingToolExecution}
            />
          </div>

          {/* Image Display - Render generated images */}
          {message.imageUrl && (
            <div className="mt-4 mb-2">
              <img
                src={message.imageUrl}
                alt={message.content || 'Generated image'}
                className="rounded-lg max-w-full h-auto border border-gray-200 dark:border-gray-700 shadow-lg"
                onError={(e) => {
                  console.error('Failed to load image:', message.imageUrl);
                  e.target.style.display = 'none';
                }}
                onLoad={() => {
                  console.log('✅ Image loaded successfully:', message.imageUrl);
                }}
              />
            </div>
          )}

          {/* Video Display - Render generated videos */}
          {message.videoUrl && (
            <div className="mt-4 mb-2">
              <video
                src={message.videoUrl}
                controls
                className="rounded-lg max-w-full h-auto border border-gray-200 dark:border-gray-700 shadow-lg"
                style={{ maxHeight: '400px' }}
                onError={(e) => {
                  console.error('Failed to load video:', message.videoUrl);
                  e.target.style.display = 'none';
                }}
                onLoadedData={() => {
                  console.log('✅ Video loaded successfully:', message.videoUrl);
                }}
              >
                Your browser does not support the video tag.
              </video>
              {message.isTemporary && (
                <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  ⚠️ Temporary URL - expires in ~24 hours
                </div>
              )}
            </div>
          )}

          {/* Tool results that have NO matching inline renderer (orphan results) */}
          {!message.pendingToolExecution && (() => {
            // Find results whose toolId does NOT appear in the parsed content segments
            const contentStr = typeof message.content === 'string' ? message.content : '';
            const inlineToolIds = new Set();
            const jsonPattern = /```json\s*(\{[\s\S]*?\})\s*```/g;
            let m;
            while ((m = jsonPattern.exec(contentStr)) !== null) {
              try {
                const j = JSON.parse(m[1]);
                const tid = (j.toolId || j.tool || '').toLowerCase();
                if (tid) inlineToolIds.add(tid);
              } catch {}
            }
            const orphanResults = (message.toolResults || []).filter(
              r => !inlineToolIds.has((r.toolId || '').toLowerCase())
            );
            return orphanResults.length > 0 ? renderToolResults(orphanResults) : null;
          })()}

          {/* Tool Execution Error */}
          {message.toolExecutionError && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <div className="flex items-center text-sm text-red-700 dark:text-red-300">
                <ExclamationCircleIcon className="w-4 h-4 mr-2" />
                <span>Tool execution error: {typeof message.toolExecutionError === 'string' ? message.toolExecutionError : (message.toolExecutionError?.message || JSON.stringify(message.toolExecutionError))}</span>
              </div>
            </div>
          )}

          {/* Agent Redirects */}
          {renderAgentRedirects(message.agentRedirects)}

          {/* Token Usage */}
          {message.tokenUsage && (
            <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Tokens used: {message.tokenUsage.total_tokens || 'N/A'}
              {message.tokenUsage.cost && ` • Cost: $${message.tokenUsage.cost.toFixed(4)}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(MessageBubble, (prevProps, nextProps) => {
  // Only re-render if message content actually changed
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.imageUrl === nextProps.message.imageUrl &&
    prevProps.message.videoUrl === nextProps.message.videoUrl &&
    prevProps.message.toolExecutions === nextProps.message.toolExecutions &&
    prevProps.message.toolResults === nextProps.message.toolResults &&
    prevProps.message.pendingToolExecution === nextProps.message.pendingToolExecution &&
    prevProps.message.toolExecutionError === nextProps.message.toolExecutionError &&
    prevProps.message.isPending === nextProps.message.isPending
  );
});