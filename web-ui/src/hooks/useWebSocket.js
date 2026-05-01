import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../stores/appStore.js';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

// Reconnection config
const RECONNECT_INITIAL_DELAY = 100;    // First reconnect attempt: 100ms
const RECONNECT_MAX_DELAY = 10000;      // Max backoff: 10 seconds
const RECONNECT_BACKOFF_FACTOR = 2;
const HEARTBEAT_INTERVAL = 15000;       // Send ping every 15 seconds
const HEARTBEAT_TIMEOUT = 5000;         // Expect pong within 5 seconds
const MAX_MISSED_PONGS = 2;             // Allow 2 missed pongs before forced reconnect

export function useWebSocket() {
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectDelayRef = useRef(RECONNECT_INITIAL_DELAY);
  const heartbeatIntervalRef = useRef(null);
  const missedPongsRef = useRef(0);
  const pongTimeoutRef = useRef(null);
  const intentionalCloseRef = useRef(false);
  const {
    setWebSocketConnection,
    handleWebSocketMessage
  } = useAppStore();

  // Read sessionId from store at call time (not captured in closure)
  const getSessionId = useCallback(() => useAppStore.getState().sessionId, []);

  const sendMessage = useCallback((message) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  // Join session helper — reads current sessionId from store
  const joinSession = useCallback(() => {
    const sessionId = getSessionId();
    if (sessionId && wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('🔗 Joining WebSocket session:', sessionId);
      wsRef.current.send(JSON.stringify({
        type: 'join_session',
        sessionId
      }));
    } else if (!sessionId) {
      console.warn('⚠️ No sessionId available for session join');
    }
  }, [getSessionId]);

  // Start heartbeat monitoring
  const startHeartbeat = useCallback(() => {
    // Clear any existing heartbeat
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
    }
    missedPongsRef.current = 0;

    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;

      // Send ping
      sendMessage({ type: 'ping', ts: Date.now() });

      // Start pong timeout
      pongTimeoutRef.current = setTimeout(() => {
        missedPongsRef.current++;
        console.warn(`⚠️ Missed pong #${missedPongsRef.current}/${MAX_MISSED_PONGS}`);

        if (missedPongsRef.current >= MAX_MISSED_PONGS) {
          console.error('💀 Server unresponsive — forcing reconnect');
          missedPongsRef.current = 0;
          // Force close to trigger reconnection
          if (wsRef.current) {
            wsRef.current.close(4000, 'Heartbeat timeout');
          }
        }
      }, HEARTBEAT_TIMEOUT);
    }, HEARTBEAT_INTERVAL);
  }, [sendMessage]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
      pongTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    // Prevent duplicate connections (important for React StrictMode)
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    intentionalCloseRef.current = false;
    console.log('🔌 Attempting WebSocket connection to:', WS_URL);

    try {
      wsRef.current = new WebSocket(WS_URL);

      wsRef.current.onopen = () => {
        console.log('✅ WebSocket connected');
        setWebSocketConnection(true);
        // Store send function in appStore for cross-component access
        useAppStore.setState({ webSocketSend: sendMessage });

        // Reset reconnect delay on successful connection
        reconnectDelayRef.current = RECONNECT_INITIAL_DELAY;

        // Clear reconnect timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

        // Start heartbeat monitoring
        startHeartbeat();
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'connected':
              setWebSocketConnection(true, message.connectionId);
              // Join session using current store value (not stale closure)
              joinSession();
              break;

            case 'session_joined':
              console.log('Joined session:', message.sessionId);
              break;

            case 'pong':
              // Clear pong timeout — server is alive
              missedPongsRef.current = 0;
              if (pongTimeoutRef.current) {
                clearTimeout(pongTimeoutRef.current);
                pongTimeoutRef.current = null;
              }
              break;

            default:
              // Handle other message types
              handleWebSocketMessage(message);
              break;
          }

        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log('WebSocket disconnected', event.code, event.reason);
        setWebSocketConnection(false);
        useAppStore.setState({ webSocketSend: null });
        stopHeartbeat();

        // Always reconnect unless intentionally closed (component unmount)
        if (!intentionalCloseRef.current) {
          const delay = reconnectDelayRef.current;
          console.log(`🔄 Reconnecting in ${delay}ms...`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
          // Exponential backoff (capped)
          reconnectDelayRef.current = Math.min(
            delay * RECONNECT_BACKOFF_FACTOR,
            RECONNECT_MAX_DELAY
          );
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setWebSocketConnection(false);
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setWebSocketConnection(false);
    }
  }, [setWebSocketConnection, handleWebSocketMessage, sendMessage, joinSession, startHeartbeat, stopHeartbeat]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    stopHeartbeat();

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'Component unmounting');
      wsRef.current = null;
    }

    setWebSocketConnection(false);
  }, [setWebSocketConnection, stopHeartbeat]);

  // Connect on mount only
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-join session when sessionId changes (e.g., switching sessions)
  useEffect(() => {
    const sessionId = getSessionId();
    if (sessionId && wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('Re-joining session due to sessionId change:', sessionId);
      sendMessage({
        type: 'join_session',
        sessionId
      });
    }
  }, [useAppStore.getState().sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reconnect on tab focus only if connection is dead (avoid spamming join_session)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (wsRef.current?.readyState !== WebSocket.OPEN) {
          console.log('🔄 Tab became visible with dead connection — reconnecting');
          connect();
          // joinSession() will be called in onopen handler after connect succeeds
        }
        // If connection is open, do nothing — session is already joined.
        // The server retains session state for active connections.
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [connect]);

  return {
    connected: wsRef.current?.readyState === WebSocket.OPEN,
    sendMessage,
    connect,
    disconnect
  };
}
