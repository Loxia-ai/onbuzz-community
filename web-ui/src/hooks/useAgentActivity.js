/**
 * useAgentActivity Hook
 *
 * Polls the backend for agent activity status to determine if the agent
 * is entitled to a scheduler slot (has pending work to process).
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = `${window.location.origin}/api`;
const POLL_INTERVAL_MS = 3000; // Poll every 3 seconds

/**
 * Hook to monitor agent activity status
 * @param {string} agentId - The agent ID to monitor
 * @param {boolean} enabled - Whether polling should be active
 * @returns {Object} Activity status object
 */
export function useAgentActivity(agentId, enabled = true) {
  const [activityStatus, setActivityStatus] = useState({
    isActive: false,
    reason: null,
    details: null,
    loading: false,
    error: null
  });

  const pollTimeoutRef = useRef(null);
  const mountedRef = useRef(true);

  const fetchActivityStatus = useCallback(async () => {
    if (!agentId || !enabled) {
      setActivityStatus(prev => ({ ...prev, isActive: false, loading: false }));
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/agents/${agentId}/activity`);
      const data = await response.json();

      if (!mountedRef.current) return;

      if (data.success) {
        setActivityStatus({
          isActive: data.isActive,  // Does agent have pending work?
          reason: data.reason,       // Why (for display)
          details: data.details,     // Additional info
          loading: false,
          error: null
        });
      } else {
        setActivityStatus(prev => ({
          ...prev,
          loading: false,
          error: data.error || 'Failed to fetch activity status'
        }));
      }
    } catch (error) {
      if (!mountedRef.current) return;

      // Don't spam errors - just mark as inactive on error
      setActivityStatus(prev => ({
        ...prev,
        isActive: false,
        loading: false,
        error: error.message
      }));
    }
  }, [agentId, enabled]);

  // Start/stop polling based on enabled state
  useEffect(() => {
    mountedRef.current = true;

    const poll = async () => {
      if (!mountedRef.current || !enabled) return;

      await fetchActivityStatus();

      if (mountedRef.current && enabled) {
        pollTimeoutRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    if (enabled && agentId) {
      // Initial fetch
      setActivityStatus(prev => ({ ...prev, loading: true }));
      poll();
    } else {
      // Clear status when disabled
      setActivityStatus({
        isActive: false,
        reason: null,
        details: null,
        loading: false,
        error: null
      });
    }

    return () => {
      mountedRef.current = false;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [agentId, enabled, fetchActivityStatus]);

  // Manual refresh function
  const refresh = useCallback(() => {
    if (enabled && agentId) {
      fetchActivityStatus();
    }
  }, [enabled, agentId, fetchActivityStatus]);

  return {
    ...activityStatus,
    refresh
  };
}

export default useAgentActivity;
