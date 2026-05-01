/**
 * AgentCommunicationRenderer Component
 *
 * Displays agent communication in a modern email client style.
 * Shows messages, replies, and agent lists with clean mail-like UI.
 *
 * Handles both:
 * - Tool invocations (outgoing): { toolId: "agentcommunication", actions: [...] }
 * - WebSocket messages (incoming): { type: "agent-communication", sender: {...}, ... }
 */

import React, { useState, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import {
  EnvelopeIcon,
  EnvelopeOpenIcon,
  PaperAirplaneIcon,
  ArrowUturnLeftIcon,
  UserGroupIcon,
  InboxIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  PaperClipIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  UserIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import {
  EnvelopeIcon as EnvelopeSolidIcon
} from '@heroicons/react/24/solid';

/**
 * Priority badge
 */
function PriorityBadge({ priority }) {
  const config = {
    high: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400', label: 'High' },
    normal: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-600 dark:text-gray-400', label: 'Normal' },
    low: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-500 dark:text-slate-400', label: 'Low' }
  };

  const cfg = config[priority] || config.normal;
  if (priority === 'normal') return null; // Don't show badge for normal priority

  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

/**
 * Agent avatar with initials
 */
function AgentAvatar({ name, size = 'md' }) {
  const initials = (name || 'A')
    .split(/[-\s]/)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const sizeClasses = {
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-8 h-8 text-xs',
    lg: 'w-10 h-10 text-sm'
  };

  // Generate consistent color from name
  const colors = [
    'bg-blue-500', 'bg-emerald-500', 'bg-purple-500',
    'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'
  ];
  const colorIndex = (name || '').length % colors.length;

  return (
    <div className={`${sizeClasses[size]} ${colors[colorIndex]} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}>
      {initials}
    </div>
  );
}

/**
 * Message preview card (email list item style)
 */
function MessageCard({ message, isReply = false }) {
  const [expanded, setExpanded] = useState(false);

  const hasAttachments = message.attachments?.length > 0;
  const isUnread = message.status === 'unread' || message.requiresReply;

  return (
    <div className={`border-b border-gray-100 dark:border-gray-800 last:border-b-0 ${isUnread ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}>
      {/* Message header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left"
      >
        {/* Unread indicator */}
        <div className="w-2 flex-shrink-0">
          {isUnread && <div className="w-2 h-2 rounded-full bg-blue-500"></div>}
        </div>

        {/* Avatar */}
        <AgentAvatar name={message.senderName} size="sm" />

        {/* Sender */}
        <div className="w-32 flex-shrink-0 truncate">
          <span className={`text-sm ${isUnread ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}`}>
            {message.senderName || 'Unknown'}
          </span>
        </div>

        {/* Subject & preview */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {isReply && (
            <ArrowUturnLeftIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          )}
          <span className={`truncate ${isUnread ? 'font-medium text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
            {message.subject}
          </span>
          <span className="text-gray-400 dark:text-gray-500 mx-1">—</span>
          <span className="text-gray-500 dark:text-gray-400 truncate text-sm">
            {(message.content || '').slice(0, 60)}...
          </span>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasAttachments && (
            <PaperClipIcon className="w-4 h-4 text-gray-400" />
          )}
          <PriorityBadge priority={message.priority} />
          {message.requiresReply && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
              Reply needed
            </span>
          )}
        </div>

        {/* Timestamp */}
        <span className="text-xs text-gray-400 flex-shrink-0 w-16 text-right">
          {formatTime(message.timestamp)}
        </span>

        {/* Expand icon */}
        {expanded ? (
          <ChevronDownIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRightIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 ml-12">
          {/* Recipients */}
          {message.recipients?.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
              <span>To:</span>
              {message.recipients.map((r, i) => {
                const rid = typeof r === 'string' ? r : r.id || r.name;
                const storeAgents = useAppStore.getState().agents || [];
                const matchedAgent = storeAgents.find(a => a.id === rid || a.name === rid);
                const displayName = matchedAgent
                  ? (rid !== matchedAgent.name ? `${matchedAgent.name} (${rid.slice(-8)})` : matchedAgent.name)
                  : (typeof r === 'string' ? r : r.name || r.id);
                return (
                  <span
                    key={i}
                    className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded cursor-pointer hover:bg-loxia-100 dark:hover:bg-loxia-900/30"
                    onClick={() => {
                      if (matchedAgent) {
                        useAppStore.getState().setCurrentAgent(matchedAgent);
                      }
                    }}
                  >
                    {displayName}
                  </span>
                );
              })}
            </div>
          )}

          {/* Message body */}
          <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
            {message.content}
          </div>

          {/* Attachments */}
          {hasAttachments && (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-300">
                  <PaperClipIcon className="w-3.5 h-3.5" />
                  <span>{att.name || `Attachment ${i + 1}`}</span>
                </div>
              ))}
            </div>
          )}

          {/* Message ID */}
          <div className="mt-2 text-[10px] text-gray-400 font-mono">
            ID: {message.id || message.messageId}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Agent list item (for get-available-agents)
 */
function AgentListItem({ agent }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      <AgentAvatar name={agent.name} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {agent.name}
          </span>
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
            agent.status === 'active' ? 'bg-emerald-500' :
            agent.status === 'busy' ? 'bg-amber-500' : 'bg-gray-400'
          }`}></span>
        </div>
        <div className="text-xs text-gray-500 truncate">
          {agent.type || 'Agent'} • {agent.activeConversations || 0} active conversations
        </div>
      </div>

      <div className="text-right text-xs text-gray-400 flex-shrink-0">
        <div>{agent.messageStats?.sent || 0} sent</div>
        <div>{agent.messageStats?.received || 0} received</div>
      </div>
    </div>
  );
}

/**
 * Sent message confirmation
 */
function SentConfirmation({ result }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
      <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
        <PaperAirplaneIcon className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
          Message sent
        </div>
        <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
          To: {result.recipients?.join(', ') || 'Unknown'}
        </div>
        <div className="text-[10px] text-emerald-500 dark:text-emerald-500 mt-1 font-mono">
          {result.messageId}
        </div>
      </div>
      <CheckCircleIcon className="w-5 h-5 text-emerald-500 flex-shrink-0" />
    </div>
  );
}

/**
 * Delayed message notification
 */
function DelayedNotification({ result }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
      <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
        <ClockIcon className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium text-amber-800 dark:text-amber-200">
          Message delayed
        </div>
        <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
          {result.message}
        </div>
        <div className="text-xs text-amber-500 mt-1">
          Waiting {result.delaySeconds}s before sending
        </div>
      </div>
    </div>
  );
}

/**
 * Conversation ended notification
 */
function ConversationEnded({ result }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
      <XMarkIcon className="w-5 h-5 text-gray-500" />
      <div className="flex-1">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Conversation ended
        </div>
        {result.reason && (
          <div className="text-xs text-gray-500 mt-0.5">{result.reason}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Format timestamp for display
 */
function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Parse communication data from JSON
 *
 * Expected formats:
 * 1. Tool invocation: { toolId: "agentcommunication", actions: [{ type: "send-message", ... }] }
 * 2. Parameters format: { toolId: "agentcommunication", parameters: { action: "send-message", ... } }
 * 3. Direct action: { type: "send-message", ... }
 * 4. Result format: { success: true, agents: [...] } or { success: true, messageId: "..." }
 */
function parseCommunicationData(parsedData) {
  if (!parsedData) return null;

  // From actions array (standard tool invocation format)
  if (parsedData.actions && Array.isArray(parsedData.actions) && parsedData.actions.length > 0) {
    const action = parsedData.actions[0];
    return {
      type: action.type || action.action,
      ...action
    };
  }

  // From parameters format
  if (parsedData.parameters) {
    const params = parsedData.parameters;
    return {
      type: params.type || params.action,
      ...params
    };
  }

  // Direct format with action/type (for results or direct calls)
  if (parsedData.type || parsedData.action) {
    return {
      type: parsedData.type || parsedData.action,
      ...parsedData
    };
  }

  // Result format (from tool execution response)
  if (parsedData.success !== undefined) {
    // Determine type from result structure
    if (parsedData.agents) return { type: 'get-available-agents', ...parsedData };
    if (parsedData.messageId && parsedData.recipients) return { type: 'send-message-result', ...parsedData };
    if (parsedData.delayed) return { type: 'delayed', ...parsedData };
    if (parsedData.messages) return { type: 'inbox', ...parsedData };
    if (parsedData.status === 'ended') return { type: 'ended', ...parsedData };
    if (parsedData.conversationId) return { type: 'send-message-result', ...parsedData };
  }

  return null;
}

/**
 * Main component
 */
function AgentCommunicationRenderer({ toolId, rawContent, innerContent, parsedData }) {
  const data = useMemo(() => parseCommunicationData(parsedData), [parsedData]);

  // Debug: log what we received
  // console.log('[AgentCommunicationRenderer] parsedData:', parsedData, 'parsed:', data);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-gray-50 dark:bg-gray-800/50 text-sm text-gray-500">
        <EnvelopeIcon className="w-4 h-4" />
        <span>Agent communication</span>
      </div>
    );
  }

  const actionType = data.type?.toLowerCase()?.replace(/_/g, '-');

  // Render based on action type
  return (
    <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        {actionType === 'get-available-agents' && (
          <>
            <UserGroupIcon className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Available Agents</span>
            <span className="text-xs text-gray-500 ml-auto">{data.agents?.length || 0} online</span>
          </>
        )}
        {actionType === 'send-message' && (
          <>
            <PaperAirplaneIcon className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Compose Message</span>
          </>
        )}
        {actionType === 'send-message-result' && (
          <>
            <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Message Sent</span>
          </>
        )}
        {actionType === 'reply-to-message' && (
          <>
            <ArrowUturnLeftIcon className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Reply</span>
          </>
        )}
        {(actionType === 'get-unreplied-messages' || actionType === 'inbox') && (
          <>
            <InboxIcon className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Inbox</span>
            <span className="text-xs text-gray-500 ml-auto">{data.messages?.length || data.total || 0} pending</span>
          </>
        )}
        {actionType === 'delayed' && (
          <>
            <ClockIcon className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Delayed</span>
          </>
        )}
        {(actionType === 'mark-conversation-ended' || actionType === 'ended') && (
          <>
            <XMarkIcon className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Conversation Ended</span>
          </>
        )}
        {/* Fallback header for unknown action types */}
        {!['get-available-agents', 'send-message', 'send-message-result', 'reply-to-message',
           'get-unreplied-messages', 'inbox', 'delayed', 'mark-conversation-ended', 'ended'].includes(actionType) && (
          <>
            <EnvelopeIcon className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {actionType ? actionType.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Communication'}
            </span>
          </>
        )}
      </div>

      {/* Content */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {/* Available agents list */}
        {actionType === 'get-available-agents' && data.agents && (
          data.agents.length > 0 ? (
            data.agents.map((agent, idx) => (
              <AgentListItem key={agent.id || idx} agent={agent} />
            ))
          ) : (
            <div className="px-4 py-8 text-center text-gray-500">
              <UserGroupIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <div className="text-sm">No other agents available</div>
            </div>
          )
        )}

        {/* Send message form display */}
        {actionType === 'send-message' && (
          <div className="p-4">
            <MessageCard
              message={{
                senderName: 'You',
                subject: data.subject,
                content: data.message,
                recipients: data.recipients || [data.recipient],
                priority: data.priority,
                requiresReply: data.requiresReply || data['requires-reply'],
                attachments: data.attachments,
                timestamp: new Date().toISOString()
              }}
            />
          </div>
        )}

        {/* Sent confirmation */}
        {actionType === 'send-message-result' && (
          <div className="p-3">
            <SentConfirmation result={data} />
          </div>
        )}

        {/* Reply display */}
        {actionType === 'reply-to-message' && (
          <div className="p-4">
            <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
              <ArrowUturnLeftIcon className="w-3 h-3" />
              Replying to: {data.messageId || data['message-id']}
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300">
              {data.message}
            </div>
          </div>
        )}

        {/* Inbox / unreplied messages */}
        {(actionType === 'get-unreplied-messages' || actionType === 'inbox') && data.messages && (
          data.messages.length > 0 ? (
            data.messages.map((msg, idx) => (
              <MessageCard key={msg.messageId || idx} message={msg} />
            ))
          ) : (
            <div className="px-4 py-8 text-center text-gray-500">
              <EnvelopeOpenIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <div className="text-sm">Inbox is empty</div>
            </div>
          )
        )}

        {/* Delayed notification */}
        {actionType === 'delayed' && (
          <div className="p-3">
            <DelayedNotification result={data} />
          </div>
        )}

        {/* Conversation ended */}
        {(actionType === 'mark-conversation-ended' || actionType === 'ended') && (
          <div className="p-3">
            <ConversationEnded result={data} />
          </div>
        )}

        {/* Fallback content for unknown action types - show the raw data */}
        {!['get-available-agents', 'send-message', 'send-message-result', 'reply-to-message',
           'get-unreplied-messages', 'inbox', 'delayed', 'mark-conversation-ended', 'ended'].includes(actionType) && (
          <div className="p-4">
            {/* If it looks like a message, render it as such */}
            {(data.subject || data.message || data.content) ? (
              <MessageCard
                message={{
                  senderName: data.senderName || data.sender || 'Agent',
                  subject: data.subject || 'Message',
                  content: data.message || data.content || '',
                  recipients: data.recipients || (data.recipient ? [data.recipient] : []),
                  priority: data.priority || 'normal',
                  requiresReply: data.requiresReply || data['requires-reply'],
                  attachments: data.attachments,
                  timestamp: data.timestamp || new Date().toISOString(),
                  id: data.messageId || data.id
                }}
              />
            ) : (
              /* Otherwise show key-value pairs */
              <div className="space-y-2 text-sm">
                {Object.entries(data).filter(([k]) => k !== 'type' && k !== 'action').map(([key, value]) => (
                  <div key={key} className="flex">
                    <span className="text-gray-500 w-32 flex-shrink-0">{key}:</span>
                    <span className="text-gray-700 dark:text-gray-300">
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Standalone message display for incoming WebSocket messages
 * Used by MessageBubble for agent-communication type messages
 */
export function AgentMessageDisplay({ message, isOutgoing = false }) {
  const senderName = message.sender?.name || message.senderName || 'Unknown Agent';
  const recipients = message.recipients || [];
  const recipientNames = recipients.map(r => typeof r === 'string' ? r : r.name || r.id).join(', ');

  return (
    <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900">
      {/* Header bar */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 ${
        isOutgoing
          ? 'bg-blue-50 dark:bg-blue-900/20'
          : 'bg-emerald-50 dark:bg-emerald-900/20'
      }`}>
        {isOutgoing ? (
          <PaperAirplaneIcon className="w-4 h-4 text-blue-500" />
        ) : (
          <EnvelopeIcon className="w-4 h-4 text-emerald-500" />
        )}
        <span className={`text-sm font-medium ${
          isOutgoing ? 'text-blue-700 dark:text-blue-300' : 'text-emerald-700 dark:text-emerald-300'
        }`}>
          {isOutgoing ? 'Sent Message' : 'Received Message'}
        </span>
        <PriorityBadge priority={message.priority} />
        {message.requiresReply && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 ml-auto">
            Reply needed
          </span>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {formatTime(message.timestamp)}
        </span>
      </div>

      {/* Message content */}
      <div className="p-4">
        {/* From / To */}
        <div className="flex items-center gap-4 mb-3 text-sm">
          <div className="flex items-center gap-2">
            <AgentAvatar name={senderName} size="sm" />
            <div>
              <span className="text-gray-500">From:</span>
              <span className="ml-1 font-medium text-gray-800 dark:text-gray-200">{senderName}</span>
            </div>
          </div>
          {recipientNames && (
            <div>
              <span className="text-gray-500">To:</span>
              <span className="ml-1 text-gray-700 dark:text-gray-300">{recipientNames}</span>
            </div>
          )}
        </div>

        {/* Subject */}
        {message.subject && (
          <div className="mb-2 font-medium text-gray-900 dark:text-white">
            {message.subject}
          </div>
        )}

        {/* Body */}
        <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
          {message.content || message.message}
        </div>

        {/* Attachments */}
        {message.hasAttachments && message.attachmentCount > 0 && (
          <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
            <PaperClipIcon className="w-3.5 h-3.5" />
            <span>{message.attachmentCount} attachment{message.attachmentCount !== 1 ? 's' : ''}</span>
          </div>
        )}

        {/* Conversation ID */}
        {message.conversationId && (
          <div className="mt-2 text-[10px] text-gray-400 font-mono">
            Conversation: {message.conversationId.slice(-12)}
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentCommunicationRenderer;
