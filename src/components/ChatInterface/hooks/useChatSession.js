/**
 * useChatSession - Hook for managing chat session state and loading
 * 
 * Handles:
 * - Session switching and loading
 * - External message updates (CLI modifications)
 * - Processing state restoration
 * - Session status checking
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getProjectId } from '../../../utils/api';

/**
 * Custom hook for managing chat session lifecycle
 */
export function useChatSession({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  provider,
  // Session messages hook
  loadSessionMessages,
  loadCursorSessionMessagesWithState,
  resetPagination,
  setSessionMessages,
  // Token budget hook
  resetTokenBudget,
  // Scroll management
  scrollToBottom,
  isNearBottom,
  autoScrollToBottom,
  // Processing sessions
  processingSessions,
  // External update trigger
  externalMessageUpdate,
  // Background task check
  getProjectTasks,
  // Token usage refresh
  fetchUpdatedTokenUsage
}) {
  const [currentSessionId, setCurrentSessionId] = useState(selectedSession?.id || null);
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [canAbortSession, setCanAbortSession] = useState(false);
  
  // Track session loading to prevent multiple scrolls
  const isLoadingSessionRef = useRef(false);
  // Track if we've already checked for background tasks
  const hasCheckedBackgroundTasksRef = useRef(false);

  // Load session messages when session changes
  useEffect(() => {
    const loadMessages = async () => {
      if (selectedSession && selectedProject) {
        const currentProvider = localStorage.getItem('selected-provider') || 'claude';

        // Mark that we're loading a session to prevent multiple scroll triggers
        isLoadingSessionRef.current = true;

        // Only reset state if the session ID actually changed (not initial load)
        const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSession.id;

        // CRITICAL: If we're currently loading (processing a message), don't reload messages
        if (isLoading && !sessionChanged) {
          console.log('[useChatSession] Skipping message reload - currently loading');
          isLoadingSessionRef.current = false;
          return;
        }

        if (sessionChanged) {
          resetPagination();
          resetTokenBudget();
          setIsLoading(false);

          if (ws && sendMessage) {
            sendMessage({
              type: 'check-session-status',
              sessionId: selectedSession.id,
              provider: currentProvider
            });
          }
        } else if (currentSessionId === null) {
          resetPagination();

          if (ws && sendMessage) {
            sendMessage({
              type: 'check-session-status',
              sessionId: selectedSession.id,
              provider: currentProvider
            });
          }
        }
        
        if (currentProvider === 'cursor') {
          setCurrentSessionId(selectedSession.id);
          sessionStorage.setItem('cursorSessionId', selectedSession.id);
          
          if (!isSystemSessionChange) {
            const projectPath = selectedProject.path || selectedProject.path;
            const converted = await loadCursorSessionMessagesWithState(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            setIsSystemSessionChange(false);
          }
        } else {
          setCurrentSessionId(selectedSession.id);
          
          if (!isSystemSessionChange) {
            const messages = await loadSessionMessages(getProjectId(selectedProject), selectedSession.id, false);
            setSessionMessages(messages);
            // chatMessages will be updated by the useEffect that watches convertedMessages
          } else {
            setIsSystemSessionChange(false);
          }
        }
      } else {
        if (!isSystemSessionChange && !isLoading) {
          setChatMessages([]);
          setSessionMessages([]);
        }
        setCurrentSessionId(null);
        sessionStorage.removeItem('cursorSessionId');
        resetPagination();
      }

      setTimeout(() => {
        isLoadingSessionRef.current = false;
      }, 250);
    };

    loadMessages();
  }, [selectedSession?.id, selectedProject?.name]);

  // External Message Update Handler
  useEffect(() => {
    if (externalMessageUpdate > 0 && selectedSession && selectedProject) {
      const reloadExternalMessages = async () => {
        try {
          const currentProvider = localStorage.getItem('selected-provider') || 'claude';

          if (currentProvider === 'cursor') {
            const projectPath = selectedProject.path || selectedProject.path;
            const converted = await loadCursorSessionMessagesWithState(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            const messages = await loadSessionMessages(getProjectId(selectedProject), selectedSession.id, false);
            setSessionMessages(messages);

            if (isNearBottom && autoScrollToBottom) {
              setTimeout(() => scrollToBottom(), 200);
            }
          }
        } catch (error) {
          console.error('Error reloading messages from external update:', error);
        }
      };

      reloadExternalMessages();
    }
  }, [externalMessageUpdate]);

  // Restore processing state when switching to a processing session
  useEffect(() => {
    if (currentSessionId && processingSessions) {
      const shouldBeProcessing = processingSessions.has(currentSessionId);
      if (shouldBeProcessing && !isLoading) {
        setIsLoading(true);
        setCanAbortSession(true);
      }
    }
  }, [currentSessionId, processingSessions]);

  // Check for background tasks when session changes
  useEffect(() => {
    if (!selectedSession || !selectedProject || !getProjectTasks) return;
    if (hasCheckedBackgroundTasksRef.current && currentSessionId === selectedSession.id) return;
    
    hasCheckedBackgroundTasksRef.current = true;
    
    // Request project tasks to see if there are any running tasks
    if (selectedProject.path) {
      getProjectTasks(selectedProject.path);
    }
  }, [selectedSession?.id, selectedProject?.path, getProjectTasks]);

  // Reset background task check flag when session changes
  useEffect(() => {
    if (currentSessionId !== selectedSession?.id) {
      hasCheckedBackgroundTasksRef.current = false;
    }
  }, [selectedSession?.id, currentSessionId]);

  // Abort session handler
  const handleAbortSession = useCallback(() => {
    if (currentSessionId && canAbortSession) {
      sendMessage({
        type: 'abort-session',
        sessionId: currentSessionId,
        provider: provider
      });
    }
  }, [currentSessionId, canAbortSession, sendMessage, provider]);

  // Refresh session handler - reload messages from server (like re-entering session)
  const handleRefreshSession = useCallback(async () => {
    if (!selectedSession || !selectedProject) {
      console.warn('[useChatSession] Cannot refresh - no session or project selected');
      return;
    }

    // Don't refresh if currently processing a message
    if (isLoading) {
      console.log('[useChatSession] Skipping refresh - currently loading');
      return;
    }

    try {
      const currentProvider = localStorage.getItem('selected-provider') || 'claude';
      
      console.log('[useChatSession] Refreshing session messages...');
      
      // Check if user was near bottom before refresh
      const wasNearBottom = isNearBottom();
      
      // Reset pagination
      resetPagination();
      
      if (currentProvider === 'cursor') {
        const projectPath = selectedProject.path || selectedProject.path;
        const converted = await loadCursorSessionMessagesWithState(projectPath, selectedSession.id);
        setSessionMessages([]);
        setChatMessages(converted);
      } else {
        const messages = await loadSessionMessages(getProjectId(selectedProject), selectedSession.id, false);
        setSessionMessages(messages);
        console.log(`[useChatSession] Loaded ${messages.length} messages`);
        // chatMessages will be updated by the useEffect that watches convertedMessages
      }

      // Check session status
      if (ws && sendMessage) {
        sendMessage({
          type: 'check-session-status',
          sessionId: selectedSession.id,
          provider: currentProvider
        });
      }

      // Refresh token usage
      if (fetchUpdatedTokenUsage) {
        setTimeout(() => {
          fetchUpdatedTokenUsage();
        }, 100);
      }

      // Scroll to bottom after refresh (if auto-scroll is enabled or user was near bottom)
      if (autoScrollToBottom || wasNearBottom) {
        console.log('[useChatSession] Scrolling to bottom after refresh');
        setTimeout(() => {
          scrollToBottom();
        }, 200);
      }

      console.log('[useChatSession] Session refreshed successfully');
    } catch (error) {
      console.error('[useChatSession] Error refreshing session:', error);
    }
  }, [selectedSession, selectedProject, isLoading, loadSessionMessages, loadCursorSessionMessagesWithState, 
      setSessionMessages, setChatMessages, resetPagination, ws, sendMessage, fetchUpdatedTokenUsage,
      autoScrollToBottom, isNearBottom, scrollToBottom]);

  return {
    currentSessionId,
    setCurrentSessionId,
    isSystemSessionChange,
    setIsSystemSessionChange,
    chatMessages,
    setChatMessages,
    isLoading,
    setIsLoading,
    canAbortSession,
    setCanAbortSession,
    isLoadingSessionRef,
    handleAbortSession,
    handleRefreshSession
  };
}

export default useChatSession;
