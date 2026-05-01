/**
 * @file VisualEditorPage.jsx
 * @description Standalone page for Visual Editor in separate window mode.
 * Displays visual editor iframe with context bar, syncs with main window via BroadcastChannel.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import VisualContextBar from '../components/VisualContextBar.jsx';

// Visual Editor server URL
const VISUAL_EDITOR_URL = 'http://localhost:4000';

// BroadcastChannel for cross-window communication
const CHANNEL_NAME = 'loxia-visual-editor';

/**
 * Connection status states
 */
const CONNECTION_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error'
};

function VisualEditorPage() {
  const [searchParams] = useSearchParams();
  const agentId = searchParams.get('agentId');
  const sessionId = searchParams.get('sessionId');
  const appUrl = searchParams.get('appUrl');  // Get appUrl from URL params

  const [connectionStatus, setConnectionStatus] = useState(CONNECTION_STATUS.CONNECTING);
  const [visualContext, setVisualContext] = useState(null);
  const [error, setError] = useState(null);

  const channelRef = useRef(null);
  const iframeRef = useRef(null);

  // Editor URL - include appUrl if provided
  const editorUrl = agentId
    ? `${VISUAL_EDITOR_URL}?agentId=${agentId}${appUrl ? `&appUrl=${encodeURIComponent(appUrl)}` : ''}`
    : null;

  // Initialize BroadcastChannel for cross-window communication
  useEffect(() => {
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);

    channelRef.current.onmessage = (event) => {
      const { type, agentId: msgAgentId, data } = event.data;

      // Only process messages for our agent
      if (msgAgentId && msgAgentId !== agentId) return;

      switch (type) {
        case 'context-update':
          setVisualContext(data);
          break;
        case 'context-clear':
          setVisualContext(null);
          break;
        case 'command':
          // Forward command to iframe
          if (iframeRef.current) {
            iframeRef.current.contentWindow?.postMessage(data, '*');
          }
          break;
        default:
          break;
      }
    };

    // Notify main window that separate window is open
    channelRef.current.postMessage({
      type: 'window-opened',
      agentId
    });

    // Use beforeunload to detect actual window close (not React effect cleanup)
    // This prevents false "window-closed" messages from React Strict Mode's double-render
    const handleBeforeUnload = () => {
      channelRef.current?.postMessage({
        type: 'window-closed',
        agentId
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      // Only cleanup the event listener and channel, don't send window-closed
      // The beforeunload handler will send window-closed when window actually closes
      window.removeEventListener('beforeunload', handleBeforeUnload);
      channelRef.current?.close();
    };
  }, [agentId]);

  // Handle messages from iframe
  const handleIframeMessage = useCallback((event) => {
    // Validate origin
    if (!event.origin.includes('localhost:4000')) return;

    const { type, data } = event.data;

    switch (type) {
      case 'element-selected':
        setVisualContext(data);
        // Broadcast to main window
        channelRef.current?.postMessage({
          type: 'context-update',
          agentId,
          data
        });
        break;
      case 'editor-ready':
        setConnectionStatus(CONNECTION_STATUS.CONNECTED);
        break;
      case 'editor-error':
        setConnectionStatus(CONNECTION_STATUS.ERROR);
        setError(data?.message || 'Visual editor error');
        break;
      default:
        break;
    }
  }, [agentId]);

  // Listen for iframe messages
  useEffect(() => {
    window.addEventListener('message', handleIframeMessage);
    return () => {
      window.removeEventListener('message', handleIframeMessage);
    };
  }, [handleIframeMessage]);

  // Clear visual context
  const clearContext = useCallback(() => {
    setVisualContext(null);
    channelRef.current?.postMessage({
      type: 'context-clear',
      agentId
    });
  }, [agentId]);

  // Scroll to element
  const scrollToElement = useCallback((selector) => {
    if (iframeRef.current) {
      iframeRef.current.contentWindow?.postMessage({
        type: 'scroll-to',
        selector
      }, '*');
    }
  }, []);

  // Status indicator
  const StatusIndicator = () => {
    const statusConfig = {
      [CONNECTION_STATUS.CONNECTED]: {
        color: 'bg-green-500',
        text: 'Connected',
        pulse: false
      },
      [CONNECTION_STATUS.CONNECTING]: {
        color: 'bg-yellow-500',
        text: 'Connecting...',
        pulse: true
      },
      [CONNECTION_STATUS.DISCONNECTED]: {
        color: 'bg-gray-400',
        text: 'Disconnected',
        pulse: false
      },
      [CONNECTION_STATUS.ERROR]: {
        color: 'bg-red-500',
        text: 'Error',
        pulse: false
      }
    };

    const config = statusConfig[connectionStatus] || statusConfig[CONNECTION_STATUS.DISCONNECTED];

    return (
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <span className={`w-2 h-2 rounded-full ${config.color} ${config.pulse ? 'animate-pulse' : ''}`} />
        <span>{config.text}</span>
      </div>
    );
  };

  if (!agentId) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Missing Agent ID
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            This page requires an agent ID parameter.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100 dark:bg-gray-900">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-green-600 dark:text-green-400">
              <path fillRule="evenodd" d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM5.05 3.05a.75.75 0 011.06 0l1.062 1.06A.75.75 0 116.11 5.173L5.05 4.11a.75.75 0 010-1.06zm9.9 0a.75.75 0 010 1.06l-1.06 1.062a.75.75 0 01-1.062-1.061l1.061-1.06a.75.75 0 011.06 0zM3 8a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 013 8zm11 0a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 0114 8zm-6.828 2.828a.75.75 0 010 1.061l-1.06 1.06a.75.75 0 01-1.061-1.06l1.06-1.06a.75.75 0 011.06 0zm3.594.001a.75.75 0 011.06 0l1.06 1.06a.75.75 0 01-1.06 1.06l-1.06-1.06a.75.75 0 010-1.06zM10 14a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 14z" clipRule="evenodd" />
            </svg>
            <h1 className="font-semibold text-gray-900 dark:text-gray-100">
              Visual Editor
            </h1>
          </div>
          <StatusIndicator />
        </div>

        <div className="text-sm text-gray-500 dark:text-gray-400">
          Agent: {agentId}
        </div>
      </div>

      {/* Context Bar */}
      {visualContext && (
        <div className="flex-shrink-0 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <VisualContextBar
            context={visualContext}
            onClear={clearContext}
            onScrollTo={scrollToElement}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 relative overflow-hidden">
        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-50 dark:bg-red-900/20 p-4 z-10">
            <div className="text-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 text-red-500 mx-auto mb-3">
                <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
              </svg>
              <p className="text-red-600 dark:text-red-400 font-medium mb-2">Visual Editor Error</p>
              <p className="text-sm text-red-500 dark:text-red-300">{error}</p>
            </div>
          </div>
        )}

        {/* Loading state */}
        {connectionStatus === CONNECTION_STATUS.CONNECTING && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800 z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto mb-3" />
              <p className="text-gray-600 dark:text-gray-400">Connecting to Visual Editor...</p>
            </div>
          </div>
        )}

        {/* Iframe */}
        {editorUrl && (
          <iframe
            ref={iframeRef}
            src={editorUrl}
            className="w-full h-full border-0"
            title="Visual Editor"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-4 py-2 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Click an element in the preview to select it. The selection will be shared with the main window.
        </p>
      </div>
    </div>
  );
}

export default VisualEditorPage;
