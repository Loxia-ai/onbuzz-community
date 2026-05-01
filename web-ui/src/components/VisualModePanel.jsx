/**
 * @file VisualModePanel.jsx
 * @description Split panel component for embedded visual editor.
 * Contains iframe with visual editor, connection status, and controls.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { CONNECTION_STATUS, VIEW_MODES, INTERACTION_MODES } from '../hooks/useVisualEditor.js';

/**
 * VisualModePanel - Embedded visual editor panel
 */
export function VisualModePanel({
  editorUrl,
  connectionStatus,
  error,
  iframeRef,
  onClose,
  onPopOut,
  onRetry,
  onReload,               // Reload function
  appUrl,                 // Current app URL
  onAppUrlChange,         // Function to change app URL
  // Interaction mode
  interactionMode = INTERACTION_MODES.SELECT,
  onInteractionModeChange,
  // Multi-instance warnings
  projectCollision = null, // { agentName, projectPath }
  maxInstancesReached = false,
  activeInstances = [], // [{ agentId, agentName, projectPath }]
  onCloseInstance = null, // (agentId) => void
  onDismissCollision = null
}) {
  // State for URL input
  const [urlInput, setUrlInput] = useState(appUrl || '');
  const [isEditingUrl, setIsEditingUrl] = useState(false);

  // Update input when appUrl changes externally
  useEffect(() => {
    if (appUrl && !isEditingUrl) {
      setUrlInput(appUrl);
    }
  }, [appUrl, isEditingUrl]);

  // Handle URL submit
  const handleUrlSubmit = useCallback((e) => {
    e.preventDefault();
    if (urlInput && onAppUrlChange) {
      onAppUrlChange(urlInput);
      setIsEditingUrl(false);
    }
  }, [urlInput, onAppUrlChange]);
  // Resizable panel state
  const [panelWidth, setPanelWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef(null);

  // Handle resize drag
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isResizing || !panelRef.current) return;

    const containerRect = panelRef.current.parentElement.getBoundingClientRect();
    const newWidth = containerRect.right - e.clientX;

    // Constrain width between 300 and 800
    const constrainedWidth = Math.max(300, Math.min(800, newWidth));
    setPanelWidth(constrainedWidth);
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Add/remove resize listeners
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  // Connection status indicator
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

  // Project collision warning banner
  const CollisionWarning = () => {
    if (!projectCollision) return null;

    return (
      <div className="px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800">
        <div className="flex items-start gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Project Collision Detected
            </p>
            <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
              Agent "{projectCollision.agentName}" is also editing this project.
              Changes may conflict.
            </p>
          </div>
          {onDismissCollision && (
            <button
              onClick={onDismissCollision}
              className="p-1 text-yellow-600 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-200"
              title="Dismiss warning"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  };

  // Max instances reached modal
  const MaxInstancesModal = () => {
    if (!maxInstancesReached) return null;

    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md mx-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 text-red-600 dark:text-red-400">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Maximum Instances Reached
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                You can have up to 3 visual editor instances at a time
              </p>
            </div>
          </div>

          {activeInstances.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Active instances:
              </p>
              <ul className="space-y-2">
                {activeInstances.map((instance) => (
                  <li
                    key={instance.agentId}
                    className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded-lg"
                  >
                    <div className="text-sm">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {instance.agentName}
                      </span>
                      <span className="text-gray-500 dark:text-gray-400 ml-2">
                        {instance.projectPath ? `(${instance.projectPath})` : ''}
                      </span>
                    </div>
                    {onCloseInstance && (
                      <button
                        onClick={() => onCloseInstance(instance.agentId)}
                        className="px-2 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 rounded transition-colors"
                      >
                        Close
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={panelRef}
      className="flex flex-col h-full border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
      style={{ width: `${panelWidth}px`, minWidth: '300px', maxWidth: '800px' }}
    >
      {/* Resize handle */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 transition-colors z-10 ${
          isResizing ? 'bg-blue-500' : 'bg-transparent hover:bg-blue-400/50'
        }`}
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <StatusIndicator />
        </div>

        <div className="flex items-center gap-1">
          {/* Mode toggle (Select vs Preview) */}
          {onInteractionModeChange && (
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5 mr-1">
              <button
                onClick={() => onInteractionModeChange(INTERACTION_MODES.SELECT)}
                className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-all ${
                  interactionMode === INTERACTION_MODES.SELECT
                    ? 'bg-white dark:bg-gray-600 text-emerald-600 dark:text-emerald-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
                title="Select mode - click to capture element context"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M8 1a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 1ZM8 11a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 11ZM11.75 8a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75ZM1 8a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 1 8ZM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
                </svg>
                <span className="hidden sm:inline">Select</span>
              </button>
              <button
                onClick={() => onInteractionModeChange(INTERACTION_MODES.PREVIEW)}
                className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-all ${
                  interactionMode === INTERACTION_MODES.PREVIEW
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
                title="Preview mode - interact with site normally"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
                  <path fillRule="evenodd" d="M1.38 8.28a.87.87 0 0 1 0-.566 7.003 7.003 0 0 1 13.238.006.87.87 0 0 1 0 .566A7.003 7.003 0 0 1 1.379 8.28ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" clipRule="evenodd" />
                </svg>
                <span className="hidden sm:inline">Preview</span>
              </button>
            </div>
          )}

          {/* Reload button */}
          {onReload && (
            <button
              onClick={onReload}
              className="p-1.5 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="Reload preview"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
              </svg>
            </button>
          )}

          {/* Pop out button */}
          <button
            onClick={onPopOut}
            className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="Open in separate window"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
              <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
            </svg>
          </button>

          {/* Close button */}
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="Close visual editor"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      </div>

      {/* URL Input Bar */}
      {onAppUrlChange && (
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-850">
          <form onSubmit={handleUrlSubmit} className="flex gap-2">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setIsEditingUrl(true);
              }}
              onBlur={() => setIsEditingUrl(false)}
              placeholder="Enter app URL (e.g., http://localhost:3000)"
              className="flex-1 px-2 py-1 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-400"
            />
            <button
              type="submit"
              className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
              disabled={!urlInput}
            >
              Go
            </button>
          </form>
        </div>
      )}

      {/* Collision warning banner */}
      <CollisionWarning />

      {/* Max instances modal overlay */}
      <MaxInstancesModal />

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-50 dark:bg-red-900/20 p-4">
            <div className="text-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 text-red-500 mx-auto mb-3">
                <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
              </svg>
              <p className="text-red-600 dark:text-red-400 font-medium mb-2">Visual Editor Error</p>
              <p className="text-sm text-red-500 dark:text-red-300 mb-4">{error}</p>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {/* Loading state */}
        {connectionStatus === CONNECTION_STATUS.CONNECTING && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto mb-3" />
              <p className="text-gray-600 dark:text-gray-400">Connecting to Visual Editor...</p>
            </div>
          </div>
        )}

        {/* Disconnected state */}
        {connectionStatus === CONNECTION_STATUS.DISCONNECTED && !error && !editorUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800 p-4">
            <div className="text-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-gray-400 mx-auto mb-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
              </svg>
              <p className="text-gray-600 dark:text-gray-400 font-medium mb-2">Visual Editor Disconnected</p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                Make sure the visual editor server is running on port 4000
              </p>
            </div>
          </div>
        )}

        {/* Iframe */}
        {editorUrl && !error && (
          <iframe
            ref={iframeRef}
            src={editorUrl}
            className="w-full h-full border-0"
            title="Visual Editor"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"
            onLoad={() => {
              // Sync interaction mode to iframe on load
              if (iframeRef.current) {
                iframeRef.current.contentWindow?.postMessage({
                  type: 'toggle',
                  enabled: interactionMode === INTERACTION_MODES.SELECT
                }, '*');
              }
            }}
          />
        )}
      </div>

      {/* Footer with instructions */}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {interactionMode === INTERACTION_MODES.SELECT ? (
            <>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <strong>Select mode:</strong>
              </span>
              {' '}Click an element to capture its context for the AI.
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                <strong>Preview mode:</strong>
              </span>
              {' '}Interact with the site normally. Element selection is disabled.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export default VisualModePanel;
