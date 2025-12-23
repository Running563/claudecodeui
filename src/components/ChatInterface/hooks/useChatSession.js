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
import { safeLocalStorage } from '../utils';

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
  externalMessageUpdate
}) {
  const [currentSessionId, setCurrentSessionId] = useState(selectedSession?.id || null);
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  const [chatMessages, setChatMessages] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      const saved = safeLocalStorage.getItem(`chat_messages_${selectedProject.name}`);
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [canAbortSession, setCanAbortSession] = useState(false);
  
  // Track session loading to prevent multiple scrolls
  const isLoadingSessionRef = useRef(false);

  // Load session messages when session changes
  useEffect(() => {
    const loadMessages = async () => {
      if (selectedSession && selectedProject) {
        const currentProvider = localStorage.getItem('selected-provider') || 'claude';

        // Mark that we're loading a session to prevent multiple scroll triggers
        isLoadingSessionRef.current = true;

        // Only reset state if the session ID actually changed (not initial load)
        const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSession.id;

        if (sessionChanged) {
          // Reset pagination state when switching sessions
          resetPagination();
          // Reset token budget when switching sessions
          resetTokenBudget();
          // Reset loading state when switching sessions
          setIsLoading(false);

          // Check if the session is currently processing on the backend
          if (ws && sendMessage) {
            sendMessage({
              type: 'check-session-status',
              sessionId: selectedSession.id,
              provider: currentProvider
            });
          }
        } else if (currentSessionId === null) {
          // Initial load - reset pagination but not token budget
          resetPagination();

          // Check if the session is currently processing on the backend
          if (ws && sendMessage) {
            sendMessage({
              type: 'check-session-status',
              sessionId: selectedSession.id,
              provider: currentProvider
            });
          }
        }
        
        if (currentProvider === 'cursor') {
          // For Cursor, set the session ID for resuming
          setCurrentSessionId(selectedSession.id);
          sessionStorage.setItem('cursorSessionId', selectedSession.id);
          
          // Only load messages from SQLite if this is NOT a system-initiated session change
          if (!isSystemSessionChange) {
            const projectPath = selectedProject.fullPath || selectedProject.path;
            const converted = await loadCursorSessionMessagesWithState(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            setIsSystemSessionChange(false);
          }
        } else {
          // For Claude, load messages normally with pagination
          setCurrentSessionId(selectedSession.id);
          
          if (!isSystemSessionChange) {
            const messages = await loadSessionMessages(selectedProject.name, selectedSession.id, false);
            setSessionMessages(messages);
          } else {
            setIsSystemSessionChange(false);
          }
        }
      } else {
        // Only clear messages if this is NOT a system-initiated session change AND we're not loading
        if (!isSystemSessionChange && !isLoading) {
          setChatMessages([]);
          setSessionMessages([]);
        }
        setCurrentSessionId(null);
        sessionStorage.removeItem('cursorSessionId');
        resetPagination();
      }

      // Mark loading as complete after messages are set
      setTimeout(() => {
        isLoadingSessionRef.current = false;
      }, 250);
    };

    loadMessages();
  }, [selectedSession?.id, selectedProject?.name]); // Simplified dependencies

  // External Message Update Handler: Reload messages when external CLI modifies current session
  useEffect(() => {
    if (externalMessageUpdate > 0 && selectedSession && selectedProject) {
      const reloadExternalMessages = async () => {
        try {
          const currentProvider = localStorage.getItem('selected-provider') || 'claude';

          if (currentProvider === 'cursor') {
            const projectPath = selectedProject.fullPath || selectedProject.path;
            const converted = await loadCursorSessionMessagesWithState(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            const messages = await loadSessionMessages(selectedProject.name, selectedSession.id, false);
            setSessionMessages(messages);

            // Smart scroll behavior: only auto-scroll if user is near bottom
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

  // Persist chat messages to localStorage
  useEffect(() => {
    if (selectedProject && chatMessages.length > 0) {
      safeLocalStorage.setItem(`chat_messages_${selectedProject.name}`, JSON.stringify(chatMessages));
    }
  }, [chatMessages, selectedProject?.name]);

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
    handleAbortSession
  };
}

export default useChatSession;
