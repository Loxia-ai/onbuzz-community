/**
 * Connection State Management Hook
 * React hook for managing session and WebSocket connection state
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CONNECTION_STATUS, RECONNECT_CONFIG } from '../config/constants.js';

/**
 * Connection state management hook
 * Manages session state, connection status, and reconnection logic
 */
export function useConnection(sessionManager, wsManager) {
  // Connection state
  const [connectionStatus, setConnectionStatus] = useState(CONNECTION_STATUS.DISCONNECTED);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState(null);

  // Session state
  const [sessionId, setSessionId] = useState(null);
  const [sessionValid, setSessionValid] = useState(false);
  const [sessionExpiration, setSessionExpiration] = useState(null);

  // Connection metrics
  const [connectionUptime, setConnectionUptime] = useState(0);
  const [lastConnectedAt, setLastConnectedAt] = useState(null);
  const [lastDisconnectedAt, setLastDisconnectedAt] = useState(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Reconnection state
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const uptimeIntervalRef = useRef(null);
  const connectionStartTimeRef = useRef(null);

  /**
   * Calculate reconnection delay with exponential backoff
   */
  const getReconnectDelay = useCallback((attempt) => {
    const delay = Math.min(
      RECONNECT_CONFIG.INITIAL_DELAY * Math.pow(RECONNECT_CONFIG.BACKOFF_MULTIPLIER, attempt),
      RECONNECT_CONFIG.MAX_DELAY
    );

    // Add jitter (±20%)
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  }, []);

  /**
   * Start connection uptime tracking
   */
  const startUptimeTracking = useCallback(() => {
    connectionStartTimeRef.current = Date.now();

    // Update uptime every second
    uptimeIntervalRef.current = setInterval(() => {
      if (connectionStartTimeRef.current) {
        const uptime = Date.now() - connectionStartTimeRef.current;
        setConnectionUptime(uptime);
      }
    }, 1000);
  }, []);

  /**
   * Stop connection uptime tracking
   */
  const stopUptimeTracking = useCallback(() => {
    if (uptimeIntervalRef.current) {
      clearInterval(uptimeIntervalRef.current);
      uptimeIntervalRef.current = null;
    }
    connectionStartTimeRef.current = null;
  }, []);

  /**
   * Connect to server
   */
  const connect = useCallback(async () => {
    if (isConnected || connectionStatus === CONNECTION_STATUS.CONNECTING) {
      return { success: false, error: 'Already connected or connecting' };
    }

    setConnectionStatus(CONNECTION_STATUS.CONNECTING);
    setError(null);

    try {
      // Initialize session
      if (sessionManager && !sessionManager.isValid()) {
        const sessionResult = await sessionManager.initialize();

        if (!sessionResult.success) {
          throw new Error(sessionResult.error || 'Failed to initialize session');
        }

        setSessionId(sessionManager.getSessionId());
        setSessionValid(true);
        setSessionExpiration(sessionManager.getExpiration?.());
      }

      // Connect WebSocket
      if (wsManager && !wsManager.isConnected()) {
        const wsResult = await wsManager.connect();

        if (!wsResult.success) {
          throw new Error(wsResult.error || 'Failed to connect WebSocket');
        }
      }

      // Connection successful
      setConnectionStatus(CONNECTION_STATUS.CONNECTED);
      setIsConnected(true);
      setIsReconnecting(false);
      setLastConnectedAt(Date.now());
      setReconnectAttempts(0);
      reconnectAttemptsRef.current = 0;

      // Start uptime tracking
      startUptimeTracking();

      return { success: true };
    } catch (err) {
      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
      setIsConnected(false);
      setError(err.message);
      return { success: false, error: err.message };
    }
  }, [sessionManager, wsManager, isConnected, connectionStatus, startUptimeTracking]);

  /**
   * Disconnect from server
   */
  const disconnect = useCallback(async () => {
    if (!isConnected) {
      return { success: true };
    }

    // Cancel any pending reconnection
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    try {
      // Disconnect WebSocket
      if (wsManager?.isConnected()) {
        await wsManager.disconnect();
      }

      // Invalidate session
      if (sessionManager?.isValid()) {
        await sessionManager.invalidate();
      }

      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
      setIsConnected(false);
      setIsReconnecting(false);
      setSessionValid(false);
      setLastDisconnectedAt(Date.now());

      // Stop uptime tracking
      stopUptimeTracking();
      setConnectionUptime(0);

      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  }, [sessionManager, wsManager, isConnected, stopUptimeTracking]);

  /**
   * Reconnect with exponential backoff
   */
  const reconnect = useCallback(async (manual = false) => {
    // If manual reconnect, reset attempts
    if (manual) {
      reconnectAttemptsRef.current = 0;
      setReconnectAttempts(0);
    }

    // Check if we've exceeded max attempts
    if (reconnectAttemptsRef.current >= RECONNECT_CONFIG.MAX_ATTEMPTS) {
      setError(`Max reconnection attempts (${RECONNECT_CONFIG.MAX_ATTEMPTS}) exceeded`);
      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
      setIsReconnecting(false);
      return { success: false, error: 'Max reconnection attempts exceeded' };
    }

    setConnectionStatus(CONNECTION_STATUS.RECONNECTING);
    setIsReconnecting(true);
    setError(null);

    // Calculate delay
    const delay = getReconnectDelay(reconnectAttemptsRef.current);

    // Increment attempts
    reconnectAttemptsRef.current += 1;
    setReconnectAttempts(reconnectAttemptsRef.current);

    // Schedule reconnection
    return new Promise((resolve) => {
      reconnectTimeoutRef.current = setTimeout(async () => {
        reconnectTimeoutRef.current = null;

        const result = await connect();

        if (!result.success) {
          // Retry with next backoff
          const retryResult = await reconnect(false);
          resolve(retryResult);
        } else {
          resolve(result);
        }
      }, delay);
    });
  }, [connect, getReconnectDelay]);

  /**
   * Check session validity
   */
  const checkSessionValidity = useCallback(async () => {
    if (!sessionManager) {
      return { valid: false };
    }

    try {
      const valid = sessionManager.isValid();
      setSessionValid(valid);

      if (valid) {
        setSessionId(sessionManager.getSessionId());
        setSessionExpiration(sessionManager.getExpiration?.());
      } else {
        setSessionId(null);
        setSessionExpiration(null);
      }

      return { valid };
    } catch (err) {
      setError(err.message);
      return { valid: false, error: err.message };
    }
  }, [sessionManager]);

  /**
   * Refresh session
   */
  const refreshSession = useCallback(async () => {
    if (!sessionManager) {
      throw new Error('Session manager not available');
    }

    try {
      const result = await sessionManager.refresh();

      if (result.success) {
        setSessionId(sessionManager.getSessionId());
        setSessionValid(true);
        setSessionExpiration(sessionManager.getExpiration?.());
        return { success: true };
      }

      throw new Error(result.error || 'Failed to refresh session');
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [sessionManager]);

  /**
   * Get connection info
   */
  const getConnectionInfo = useCallback(() => {
    return {
      status: connectionStatus,
      isConnected,
      isReconnecting,
      sessionId,
      sessionValid,
      sessionExpiration,
      uptime: connectionUptime,
      lastConnectedAt,
      lastDisconnectedAt,
      reconnectAttempts,
    };
  }, [
    connectionStatus,
    isConnected,
    isReconnecting,
    sessionId,
    sessionValid,
    sessionExpiration,
    connectionUptime,
    lastConnectedAt,
    lastDisconnectedAt,
    reconnectAttempts,
  ]);

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Reset connection metrics
   */
  const resetMetrics = useCallback(() => {
    setConnectionUptime(0);
    setLastConnectedAt(null);
    setLastDisconnectedAt(null);
    setReconnectAttempts(0);
    reconnectAttemptsRef.current = 0;
  }, []);

  // Set up WebSocket event listeners for connection state
  useEffect(() => {
    if (!wsManager) return;

    // WebSocket connected
    const handleConnected = () => {
      setConnectionStatus(CONNECTION_STATUS.CONNECTED);
      setIsConnected(true);
      setIsReconnecting(false);
      setLastConnectedAt(Date.now());
      startUptimeTracking();
    };

    // WebSocket disconnected
    const handleDisconnected = () => {
      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
      setIsConnected(false);
      setLastDisconnectedAt(Date.now());
      stopUptimeTracking();

      // Auto-reconnect if not manually disconnected
      if (reconnectAttemptsRef.current < RECONNECT_CONFIG.MAX_ATTEMPTS) {
        reconnect(false);
      }
    };

    // WebSocket error
    const handleError = (errorData) => {
      setError(errorData.message || 'WebSocket error');
      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
      setIsConnected(false);
    };

    // Register event handlers
    wsManager.on?.('connected', handleConnected);
    wsManager.on?.('disconnected', handleDisconnected);
    wsManager.on?.('error', handleError);

    return () => {
      wsManager.off?.('connected', handleConnected);
      wsManager.off?.('disconnected', handleDisconnected);
      wsManager.off?.('error', handleError);
    };
  }, [wsManager, reconnect, startUptimeTracking, stopUptimeTracking]);

  // Session validity checking interval
  useEffect(() => {
    if (!sessionManager || !isConnected) return;

    // Check session validity every minute
    const intervalId = setInterval(() => {
      checkSessionValidity();
    }, 60000);

    return () => clearInterval(intervalId);
  }, [sessionManager, isConnected, checkSessionValidity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      // Stop uptime tracking
      stopUptimeTracking();
    };
  }, [stopUptimeTracking]);

  // Return hook interface
  return useMemo(() => ({
    // Connection state
    connectionStatus,
    isConnected,
    isReconnecting,
    error,

    // Session state
    sessionId,
    sessionValid,
    sessionExpiration,

    // Connection metrics
    connectionUptime,
    lastConnectedAt,
    lastDisconnectedAt,
    reconnectAttempts,

    // Connection operations
    connect,
    disconnect,
    reconnect,

    // Session operations
    checkSessionValidity,
    refreshSession,

    // Utilities
    getConnectionInfo,
    clearError,
    resetMetrics,
  }), [
    connectionStatus,
    isConnected,
    isReconnecting,
    error,
    sessionId,
    sessionValid,
    sessionExpiration,
    connectionUptime,
    lastConnectedAt,
    lastDisconnectedAt,
    reconnectAttempts,
    connect,
    disconnect,
    reconnect,
    checkSessionValidity,
    refreshSession,
    getConnectionInfo,
    clearError,
    resetMetrics,
  ]);
}

export default useConnection;
