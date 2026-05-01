/**
 * @file useVisualEditor.js
 * @description Custom hook for Visual Editor state and communication.
 * Supports both embedded (split panel) and separate window modes.
 * Uses service discovery to find the visual editor server.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../stores/appStore.js';
import { api } from '../services/api.js';
import { resolveVisualEditorOpenRequest } from '../utilities/visualEditorMessage.js';

// Default fallback URL (only used if service discovery fails)
// Derive from current host to support remote deployments
const DEFAULT_VISUAL_EDITOR_URL = `${window.location.protocol}//${window.location.hostname}:4000`;

// Service name in registry
const VISUAL_EDITOR_SERVICE = 'visualEditor';

// BroadcastChannel for cross-window communication
const CHANNEL_NAME = 'loxia-visual-editor';

// LocalStorage key for view mode preference
const VIEW_MODE_KEY = 'loxia-visual-editor-mode';

// Retry configuration
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  connectionTimeoutMs: 10000
};

/**
 * View modes for the visual editor
 */
export const VIEW_MODES = {
  CLOSED: 'closed',
  EMBEDDED: 'embedded',
  SEPARATE: 'separate'
};

/**
 * Connection status states
 */
export const CONNECTION_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error'
};

/**
 * Interaction modes for the visual editor
 * SELECT: Element selection is active (clicks captured for context)
 * PREVIEW: Normal browsing mode (clicks work as usual)
 */
export const INTERACTION_MODES = {
  SELECT: 'select',
  PREVIEW: 'preview'
};

/**
 * Custom hook for Visual Editor functionality
 */
export function useVisualEditor() {
  // Get current agent and visual editor open request from app store
  const {
    currentAgent,
    sessionId,
    visualEditorOpenRequest,
    clearVisualEditorRequest,
    visualEditorToolUsed
  } = useAppStore();
  const agentId = currentAgent?.id;

  // State
  const [isEnabled, setIsEnabled] = useState(false);
  const [viewMode, setViewModeState] = useState(() => {
    // Load saved preference or default to embedded
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    return saved || VIEW_MODES.EMBEDDED;
  });
  const [connectionStatus, setConnectionStatus] = useState(CONNECTION_STATUS.DISCONNECTED);
  const [visualContext, setVisualContext] = useState(null);
  const [editorUrl, setEditorUrl] = useState(null);
  const [appUrl, setAppUrlState] = useState(null); // The target app URL
  const [error, setError] = useState(null);
  const [interactionMode, setInteractionModeState] = useState(INTERACTION_MODES.SELECT);

  // Error reporting state
  const [errorReportingEnabled, setErrorReportingEnabledState] = useState(true);
  const [consoleErrors, setConsoleErrors] = useState([]);

  // Service discovery state
  const [serviceUrl, setServiceUrl] = useState(null); // Discovered from backend registry
  const [serviceDiscovered, setServiceDiscovered] = useState(false);

  // Retry state
  const [retryCount, setRetryCount] = useState(0);
  const [isServerAvailable, setIsServerAvailable] = useState(null); // null = unknown, true/false = checked

  // Refs
  const channelRef = useRef(null);
  const windowRef = useRef(null);
  const iframeRef = useRef(null);
  const retryTimeoutRef = useRef(null);

  // Discover visual editor service from backend registry
  // This is only called when visual mode is being enabled, not on mount
  const discoverService = useCallback(async (silent = false) => {
    try {
      const result = await api.getService(VISUAL_EDITOR_SERVICE);
      if (result.success && result.service) {
        const discoveredUrl = result.service.url;
        console.log(`[VisualEditor] Discovered service at ${discoveredUrl}`);
        setServiceUrl(discoveredUrl);
        setServiceDiscovered(true);
        return discoveredUrl;
      }
      // Service not registered yet - this is normal if visual editor hasn't been started
      if (!silent) {
        console.log('[VisualEditor] Service not registered yet, using default URL');
      }
    } catch (err) {
      // Only log as warning if it's an actual error, not just "not found"
      if (!err.message?.includes('404') && !silent) {
        console.warn('[VisualEditor] Service discovery error:', err.message);
      }
    }
    setServiceUrl(DEFAULT_VISUAL_EDITOR_URL);
    setServiceDiscovered(true);
    return DEFAULT_VISUAL_EDITOR_URL;
  }, []);

  // Discover visual editor service on mount (server is always-on)
  useEffect(() => {
    // Silent discovery on mount - server should be running since backend starts it
    discoverService(true);
  }, [discoverService]);

  // Get the current visual editor base URL (discovered or fallback)
  const getVisualEditorUrl = useCallback(() => {
    return serviceUrl || DEFAULT_VISUAL_EDITOR_URL;
  }, [serviceUrl]);

  // Check if visual editor server is available
  const checkServerAvailability = useCallback(async () => {
    // Ensure we have discovered the service first
    const baseUrl = serviceUrl || await discoverService();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), RETRY_CONFIG.connectionTimeoutMs);

      const response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        setIsServerAvailable(true);
        setError(null);
        return true;
      }
      setIsServerAvailable(false);
      return false;
    } catch (err) {
      console.warn('Visual editor server not available:', err.message);
      setIsServerAvailable(false);
      return false;
    }
  }, [serviceUrl, discoverService]);

  // Retry connection with exponential backoff
  const retryConnection = useCallback(async () => {
    if (retryCount >= RETRY_CONFIG.maxAttempts) {
      setConnectionStatus(CONNECTION_STATUS.ERROR);
      setError(`Failed to connect after ${RETRY_CONFIG.maxAttempts} attempts. Make sure the visual editor server is running.`);
      setRetryCount(0);
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      RETRY_CONFIG.baseDelayMs * Math.pow(2, retryCount),
      RETRY_CONFIG.maxDelayMs
    );

    console.log(`🔄 Retrying visual editor connection (attempt ${retryCount + 1}/${RETRY_CONFIG.maxAttempts}) in ${delay}ms`);
    setConnectionStatus(CONNECTION_STATUS.CONNECTING);

    retryTimeoutRef.current = setTimeout(async () => {
      const available = await checkServerAvailability();
      if (available) {
        setConnectionStatus(CONNECTION_STATUS.CONNECTED);
        setRetryCount(0);
      } else {
        setRetryCount(prev => prev + 1);
      }
    }, delay);
  }, [retryCount, checkServerAvailability]);

  // Manual retry action
  const manualRetry = useCallback(() => {
    setRetryCount(0);
    setError(null);
    setConnectionStatus(CONNECTION_STATUS.CONNECTING);
    checkServerAvailability().then(available => {
      if (!available) {
        setRetryCount(1);
      }
    });
  }, [checkServerAvailability]);

  // Auto-retry when connection fails
  useEffect(() => {
    if (isEnabled && retryCount > 0 && retryCount < RETRY_CONFIG.maxAttempts) {
      retryConnection();
    }

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [isEnabled, retryCount, retryConnection]);

  // Initialize BroadcastChannel for cross-window communication
  useEffect(() => {
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);

    channelRef.current.onmessage = (event) => {
      const { type, agentId: msgAgentId, data } = event.data;

      // Only process messages for current agent
      if (msgAgentId && msgAgentId !== agentId) return;

      switch (type) {
        case 'context-update':
          setVisualContext(data);
          break;
        case 'context-clear':
          setVisualContext(null);
          break;
        case 'status-update':
          setConnectionStatus(data);
          break;
        case 'url-change':
          // URL was changed from another window - update local state
          if (data?.url) {
            setAppUrlState(data.url);
            if (data.editorUrl) {
              setEditorUrl(data.editorUrl);
            }
          }
          break;
        case 'window-closed':
          // Separate window was closed, switch back to embedded if enabled
          if (isEnabled && viewMode === VIEW_MODES.SEPARATE) {
            setViewModeState(VIEW_MODES.EMBEDDED);
          }
          break;
        case 'editor-closed':
          // Agent was deleted/unloaded - close visual editor completely
          console.log('🎯 Visual editor closed for agent:', msgAgentId, event.data.reason);
          setIsEnabled(false);
          setConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
          setVisualContext(null);
          // Close separate window if open
          if (windowRef.current && !windowRef.current.closed) {
            windowRef.current.close();
          }
          break;
        default:
          break;
      }
    };

    return () => {
      channelRef.current?.close();
    };
  }, [agentId, isEnabled, viewMode]);

  // Broadcast context updates to other windows
  const broadcastContextUpdate = useCallback((context) => {
    channelRef.current?.postMessage({
      type: 'context-update',
      agentId,
      data: context
    });
  }, [agentId]);

  // Forward console errors to backend via WebSocket for agent awareness
  const broadcastConsoleError = useCallback((errorData) => {
    const { webSocketSend } = useAppStore.getState();
    if (webSocketSend) {
      webSocketSend({
        type: 'visual_editor_console_error',
        agentId,
        sessionId,
        data: errorData
      });
    }
  }, [agentId, sessionId]);

  // Toggle error reporting in the overlay
  const setErrorReporting = useCallback((enabled) => {
    setErrorReportingEnabledState(enabled);

    const message = {
      type: 'set-error-reporting',
      enabled
    };

    if (viewMode === VIEW_MODES.EMBEDDED && iframeRef.current) {
      iframeRef.current.contentWindow?.postMessage(message, '*');
    } else {
      channelRef.current?.postMessage({
        type: 'command',
        agentId,
        data: message
      });
    }
  }, [agentId, viewMode]);

  // Clear collected console errors
  const clearConsoleErrors = useCallback(() => {
    setConsoleErrors([]);
  }, []);

  // Set view mode and persist preference
  const setViewMode = useCallback((mode) => {
    setViewModeState(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }, []);

  // Connect agent to visual editor server (server is always-on, just registers agent instance)
  const startVisualEditorServer = useCallback(async (newAppUrl = null) => {
    if (!agentId || !sessionId) {
      setError('No agent selected');
      return false;
    }

    setConnectionStatus(CONNECTION_STATUS.CONNECTING);
    setError(null);

    // Use the provided appUrl or the current state value
    const effectiveAppUrl = newAppUrl || appUrl || 'http://localhost:3000';

    try {
      const response = await api.startVisualEditor(sessionId, agentId, effectiveAppUrl);

      if (response.success && response.instance) {
        // Server started - now discover the actual service URL from registry
        // This handles cases where the server uses a different port due to conflicts
        await discoverService(true);  // silent - don't log errors

        // Use the editorUrl from the backend response (which has the correct port)
        // Fall back to serverBaseUrl from response if available
        const baseUrl = response.instance.serverBaseUrl || getVisualEditorUrl();
        const serverEditorUrl = response.instance.editorUrl ||
          `${baseUrl}?agentId=${agentId}&appUrl=${encodeURIComponent(effectiveAppUrl)}`;

        // Update both editorUrl and appUrl state
        setEditorUrl(serverEditorUrl);
        setAppUrlState(effectiveAppUrl);  // Save appUrl for use by openSeparateWindow
        setIsServerAvailable(true);
        console.log('✅ Visual Editor Server started:', response.instance);
        return true;
      } else {
        setError(response.error || 'Failed to start visual editor');
        setConnectionStatus(CONNECTION_STATUS.ERROR);
        return false;
      }
    } catch (err) {
      console.error('Failed to start visual editor:', err);
      setError(err.message || 'Failed to start visual editor server');
      setConnectionStatus(CONNECTION_STATUS.ERROR);
      return false;
    }
  }, [agentId, sessionId, appUrl, discoverService, getVisualEditorUrl]);

  // Toggle visual mode on/off
  // Note: Can be called as onClick handler (receives event) or with appUrl string
  // IMPORTANT: Toggle always opens in EMBEDDED mode first. Use popOutToWindow to open separate window.
  const toggleVisualMode = useCallback(async (appUrlOrEvent = null) => {
    // If called as onClick handler, appUrlOrEvent will be an event object - ignore it
    const newAppUrl = (appUrlOrEvent && typeof appUrlOrEvent === 'string') ? appUrlOrEvent : null;
    // Use provided URL, current state, or default
    const effectiveAppUrl = newAppUrl || appUrl || 'http://localhost:3000';

    if (isEnabled) {
      // Disable visual mode — user explicitly closed
      userClosedRef.current = true;
      setIsEnabled(false);
      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
      setVisualContext(null);
      setViewMode(VIEW_MODES.EMBEDDED);  // Reset to embedded for next time

      // Close separate window if open
      if (windowRef.current && !windowRef.current.closed) {
        windowRef.current.close();
      }

      // Disconnect agent from visual editor (server stays running for other agents)
      if (agentId && sessionId) {
        try {
          await api.stopVisualEditor(sessionId, agentId);
        } catch (err) {
          console.warn('Failed to stop visual editor:', err);
        }
      }
    } else {
      // Enable visual mode - connect agent to always-on server
      const started = await startVisualEditorServer(effectiveAppUrl);

      if (started) {
        setIsEnabled(true);
        // Always start in embedded mode - user can pop out if desired
        setViewMode(VIEW_MODES.EMBEDDED);
      }
    }
  }, [isEnabled, agentId, sessionId, appUrl, startVisualEditorServer, setViewMode]);

  // Open visual editor in separate window
  const openSeparateWindow = useCallback(() => {
    if (!agentId) return;

    const width = 900;
    const height = 700;
    const left = window.screenX + window.outerWidth;
    const top = window.screenY;

    // Include appUrl in the URL for the separate window
    let url = `/visual-editor?agentId=${agentId}&sessionId=${sessionId}`;
    if (appUrl) {
      url += `&appUrl=${encodeURIComponent(appUrl)}`;
    }

    windowRef.current = window.open(
      url,
      `visual-editor-${agentId}`,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    // Check if window was blocked
    if (!windowRef.current) {
      setError('Popup blocked. Please allow popups for this site.');
      // Fall back to embedded mode
      setViewMode(VIEW_MODES.EMBEDDED);
      return;
    }

    setViewMode(VIEW_MODES.SEPARATE);

    // Monitor window close (backup for when beforeunload doesn't fire)
    const checkWindowClosed = setInterval(() => {
      if (windowRef.current?.closed) {
        clearInterval(checkWindowClosed);
        channelRef.current?.postMessage({
          type: 'window-closed',
          agentId
        });
      }
    }, 500);
  }, [agentId, sessionId, appUrl, setViewMode]);

  // Switch from embedded to separate window
  const popOutToWindow = useCallback(() => {
    openSeparateWindow();
  }, [openSeparateWindow]);

  // Switch from separate window to embedded
  const popInToEmbed = useCallback(() => {
    // Close separate window if open
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.close();
    }
    setViewMode(VIEW_MODES.EMBEDDED);
  }, [setViewMode]);

  // Clear current visual context
  const clearContext = useCallback(() => {
    setVisualContext(null);
    channelRef.current?.postMessage({
      type: 'context-clear',
      agentId
    });
  }, [agentId]);

  // Send highlight command to visual editor
  const highlightElement = useCallback((selector, durationMs = 2000) => {
    const message = {
      type: 'highlight',
      selector,
      duration: durationMs
    };

    if (viewMode === VIEW_MODES.EMBEDDED && iframeRef.current) {
      iframeRef.current.contentWindow?.postMessage(message, '*');
    } else {
      channelRef.current?.postMessage({
        type: 'command',
        agentId,
        data: message
      });
    }
  }, [agentId, viewMode]);

  // Send scroll-to command to visual editor
  const scrollToElement = useCallback((selector) => {
    const message = {
      type: 'scroll-to',
      selector
    };

    if (viewMode === VIEW_MODES.EMBEDDED && iframeRef.current) {
      iframeRef.current.contentWindow?.postMessage(message, '*');
    } else {
      channelRef.current?.postMessage({
        type: 'command',
        agentId,
        data: message
      });
    }
  }, [agentId, viewMode]);

  // Toggle interaction mode (SELECT vs PREVIEW)
  const setInteractionMode = useCallback((mode) => {
    setInteractionModeState(mode);

    // Send toggle command to overlay.js
    const isEnabled = mode === INTERACTION_MODES.SELECT;
    const message = {
      type: 'toggle',
      enabled: isEnabled
    };

    if (viewMode === VIEW_MODES.EMBEDDED && iframeRef.current) {
      iframeRef.current.contentWindow?.postMessage(message, '*');
    } else {
      channelRef.current?.postMessage({
        type: 'command',
        agentId,
        data: message
      });
    }

    console.log(`[VisualEditor] Interaction mode set to: ${mode}`);
  }, [agentId, viewMode]);

  // Handle messages from iframe (embedded mode)
  const handleIframeMessage = useCallback((event) => {
    // Validate origin — visual editor server may run on 4000 or a fallback port (4001, etc.)
    const expectedOrigin = serviceUrl ? new URL(serviceUrl).origin : null;
    const isFromEditor = (expectedOrigin && event.origin === expectedOrigin)
      || event.origin.includes('localhost:4000')
      || event.origin.includes('localhost:4001');
    if (!isFromEditor) return;

    const { type, data } = event.data;

    switch (type) {
      case 'element-selected':
        setVisualContext(data);
        broadcastContextUpdate(data);
        break;
      case 'editor-ready':
        setConnectionStatus(CONNECTION_STATUS.CONNECTED);
        break;
      case 'editor-error':
        setConnectionStatus(CONNECTION_STATUS.ERROR);
        setError(data?.message || 'Visual editor error');
        break;
      case 'console-error':
        if (data) {
          setConsoleErrors(prev => {
            const updated = [...prev, data].slice(-20); // Keep last 20
            return updated;
          });
          // Forward to backend via WebSocket so agent is notified
          broadcastConsoleError(data);
        }
        break;
      default:
        break;
    }
  }, [broadcastContextUpdate]);

  // Listen for iframe messages
  useEffect(() => {
    if (isEnabled && viewMode === VIEW_MODES.EMBEDDED) {
      window.addEventListener('message', handleIframeMessage);
      return () => {
        window.removeEventListener('message', handleIframeMessage);
      };
    }
  }, [isEnabled, viewMode, handleIframeMessage]);

  // Clear editor URL when disabled (but don't override if already set by startVisualEditorServer)
  useEffect(() => {
    if (!isEnabled) {
      setEditorUrl(null);
    }
  }, [isEnabled]);

  // Clear state when agent changes
  useEffect(() => {
    setVisualContext(null);
    setConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
    setError(null);
    setAppUrlState(null);
  }, [agentId]);

  // Handle visual editor open request from agent (via WebSocket).
  // Delegates the apply/clear/ignore decision to a pure helper so the
  // freshness window + agent-match logic is unit-testable in isolation.
  // See utilities/visualEditorMessage.js for the decision contract.
  useEffect(() => {
    // Log every effect run with the decision so operators can tell at a
    // glance why the panel didn't open ("agent mismatch" / "stale" /
    // "no request stashed"). Previously `ignore` returned silently and
    // "the panel never opens" required adding ad-hoc logs to diagnose.
    const decision = resolveVisualEditorOpenRequest(visualEditorOpenRequest, agentId);
    if (decision.action === 'ignore') {
      if (visualEditorOpenRequest) {
        console.log('🎯 Visual editor open request ignored (agent mismatch)', {
          hookAgentId: agentId,
          requestAgentId: visualEditorOpenRequest.agentId
        });
      }
      return;
    }

    if (decision.action === 'clear') {
      console.log('🎯 Skipping stale visual editor open request', {
        agentId,
        ageMs: Date.now() - (visualEditorOpenRequest?.timestamp || 0)
      });
      clearVisualEditorRequest();
      return;
    }

    // action === 'apply'
    console.log('🎯 Processing visual editor open request:', visualEditorOpenRequest);
    userClosedRef.current = false; // Agent explicitly opening — reset user-closed flag

    // Store the app URL
    setAppUrlState(visualEditorOpenRequest.appUrl);

    // Set the editor URL (use discovered service URL)
    const baseUrl = getVisualEditorUrl();
    const newEditorUrl = visualEditorOpenRequest.editorUrl ||
      `${baseUrl}?agentId=${agentId}&appUrl=${encodeURIComponent(visualEditorOpenRequest.appUrl)}`;
    setEditorUrl(newEditorUrl);

    // Enable the visual editor
    setIsEnabled(true);
    setConnectionStatus(CONNECTION_STATUS.CONNECTING);
    setIsServerAvailable(true);

    // Clear the request after processing so it doesn't re-fire.
    clearVisualEditorRequest();
  }, [visualEditorOpenRequest, agentId, clearVisualEditorRequest, getVisualEditorUrl]);

  // Auto-open visual editor panel when the visual-editor tool is used by the agent
  // (unless the user explicitly closed it — tracked by userClosedRef)
  const userClosedRef = useRef(false);
  useEffect(() => {
    if (visualEditorToolUsed && !isEnabled && !userClosedRef.current) {
      // Only auto-open if editor URL is already set (agent previously set up the editor)
      if (editorUrl) {
        console.log('[VisualEditor] Auto-opening panel — visual-editor tool was used');
        setIsEnabled(true);
      }
    }
    // Reset the flag after processing
    if (visualEditorToolUsed) {
      useAppStore.setState({ visualEditorToolUsed: null });
    }
  }, [visualEditorToolUsed]);

  // Set app URL manually (for user input)
  const setAppUrl = useCallback(async (url) => {
    if (!url) {
      setError('URL is required');
      return false;
    }

    try {
      new URL(url);
    } catch {
      setError(`Invalid URL format: ${url}`);
      return false;
    }

    setAppUrlState(url);
    setError(null);

    // If already enabled, update the editor URL
    if (isEnabled) {
      const baseUrl = getVisualEditorUrl();
      const newEditorUrl = `${baseUrl}?agentId=${agentId}&appUrl=${encodeURIComponent(url)}`;
      setEditorUrl(newEditorUrl);

      // Broadcast URL change to separate window (if open)
      channelRef.current?.postMessage({
        type: 'url-change',
        agentId,
        data: { url, editorUrl: newEditorUrl }
      });

      // If in separate window mode, reload the window with new URL
      if (viewMode === VIEW_MODES.SEPARATE && windowRef.current && !windowRef.current.closed) {
        const windowUrl = `/visual-editor?agentId=${agentId}&sessionId=${sessionId}&appUrl=${encodeURIComponent(url)}`;
        windowRef.current.location.href = windowUrl;
      }
    }

    return true;
  }, [isEnabled, agentId, sessionId, viewMode, getVisualEditorUrl]);

  // Reload the visual editor iframe
  const reloadEditor = useCallback(() => {
    if (viewMode === VIEW_MODES.EMBEDDED && iframeRef.current) {
      // Reload iframe by resetting src
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = '';
      setTimeout(() => {
        iframeRef.current.src = currentSrc;
      }, 100);
      setConnectionStatus(CONNECTION_STATUS.CONNECTING);
    } else if (windowRef.current && !windowRef.current.closed) {
      // Reload separate window
      windowRef.current.location.reload();
    }
  }, [viewMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (windowRef.current && !windowRef.current.closed) {
        windowRef.current.close();
      }
    };
  }, []);

  return {
    // State
    isEnabled,
    viewMode,
    connectionStatus,
    visualContext,
    editorUrl,
    appUrl,       // The target app URL
    error,
    isServerAvailable,
    retryCount,

    // Refs for components to use
    iframeRef,

    // Interaction mode (SELECT vs PREVIEW)
    interactionMode,
    setInteractionMode,

    // Error reporting
    errorReportingEnabled,
    setErrorReporting,
    consoleErrors,
    clearConsoleErrors,

    // Actions
    toggleVisualMode,
    startVisualEditorServer,
    setViewMode,
    setAppUrl,          // Set app URL manually
    reloadEditor,       // Reload the iframe/window
    popOutToWindow,
    popInToEmbed,
    clearContext,
    highlightElement,
    scrollToElement,
    manualRetry,
    checkServerAvailability,

    // Constants
    VIEW_MODES,
    CONNECTION_STATUS,
    INTERACTION_MODES,
    RETRY_CONFIG
  };
}

export default useVisualEditor;
