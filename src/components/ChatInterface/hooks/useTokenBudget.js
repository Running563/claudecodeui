/**
 * useTokenBudget - Hook for token usage tracking
 * Handles fetching and updating token budget information
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { authenticatedFetch } from '../../../utils/api';

/**
 * Hook for managing token budget
 * @param {Object} params
 * @param {Object} params.selectedProject - Currently selected project
 * @param {Object} params.selectedSession - Currently selected session
 */
export function useTokenBudget({ selectedProject, selectedSession }) {
  const [tokenBudget, setTokenBudget] = useState(null);
  
  // Use refs to avoid stale closures and prevent unnecessary re-renders
  const projectIdRef = useRef(selectedProject?.id);
  const sessionIdRef = useRef(selectedSession?.id);
  
  // Update refs when props change
  useEffect(() => {
    projectIdRef.current = selectedProject?.id;
    sessionIdRef.current = selectedSession?.id;
  }, [selectedProject?.id, selectedSession?.id]);

  // Track if initial fetch has been done for current session
  const hasFetchedRef = useRef(false);
  const lastFetchedSessionRef = useRef(null);

  // Load token usage when session changes
  useEffect(() => {
    const projectId = selectedProject?.id;
    const sessionId = selectedSession?.id;
    
    if (!projectId || !sessionId || sessionId.startsWith('new-session-')) {
      setTokenBudget(null);
      hasFetchedRef.current = false;
      lastFetchedSessionRef.current = null;
      return;
    }

    // Skip if already fetched for this session
    if (lastFetchedSessionRef.current === sessionId && hasFetchedRef.current) {
      return;
    }

    const fetchInitialTokenUsage = async () => {
      // Double-check to prevent race conditions
      if (lastFetchedSessionRef.current === sessionId && hasFetchedRef.current) {
        return;
      }
      
      lastFetchedSessionRef.current = sessionId;
      hasFetchedRef.current = true;
      
      try {
        const url = `/api/projects/${projectId}/sessions/${sessionId}/token-usage`;
        const response = await authenticatedFetch(url);

        if (response.ok) {
          const data = await response.json();
          setTokenBudget(data);
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };

    fetchInitialTokenUsage();
  }, [selectedSession?.id, selectedProject?.id]); // Only depend on primitive values

  // Fetch updated token usage (called after message completion)
  // Uses refs to get current values, avoiding stale closure issues
  const fetchUpdatedTokenUsage = useCallback(async () => {
    const projectId = projectIdRef.current;
    const sessionId = sessionIdRef.current;
    
    if (!projectId || !sessionId) return;

    try {
      const url = `/api/projects/${projectId}/sessions/${sessionId}/token-usage`;
      const response = await authenticatedFetch(url);
      if (response.ok) {
        const data = await response.json();
        setTokenBudget(data);
      }
    } catch (error) {
      console.error('Failed to fetch updated token usage:', error);
    }
  }, []); // Empty deps - uses refs for current values

  // Reset token budget
  const resetTokenBudget = useCallback(() => {
    setTokenBudget(null);
  }, []);

  return {
    tokenBudget,
    setTokenBudget,
    fetchUpdatedTokenUsage,
    resetTokenBudget
  };
}

export default useTokenBudget;
