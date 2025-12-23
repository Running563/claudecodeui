/**
 * useSessionMessages - Hook for session message management
 * Handles loading, pagination, and conversion of session messages
 */

import { useState, useCallback, useMemo } from 'react';
import { api } from '../../../utils/api';
import { convertSessionMessages, loadCursorSessionMessages } from '../utils';

const MESSAGES_PER_PAGE = 20;

/**
 * Hook for managing session messages
 * @param {Object} params
 * @param {Object} params.selectedProject - Currently selected project
 * @param {Object} params.selectedSession - Currently selected session
 */
export function useSessionMessages() {
  const [sessionMessages, setSessionMessages] = useState([]);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [messagesOffset, setMessagesOffset] = useState(0);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);

  // Load session messages from API with pagination
  const loadSessionMessages = useCallback(async (projectId, sessionId, loadMore = false) => {
    if (!projectId || !sessionId) return [];
    
    const isInitialLoad = !loadMore;
    if (isInitialLoad) {
      setIsLoadingSessionMessages(true);
    } else {
      setIsLoadingMoreMessages(true);
    }
    
    try {
      const currentOffset = loadMore ? messagesOffset : 0;
      const response = await api.sessionMessages(projectId, sessionId, MESSAGES_PER_PAGE, currentOffset);
      if (!response.ok) {
        throw new Error('Failed to load session messages');
      }
      const data = await response.json();
      
      // Handle paginated response
      if (data.hasMore !== undefined) {
        setHasMoreMessages(data.hasMore);
        setTotalMessages(data.total);
        setMessagesOffset(currentOffset + (data.messages?.length || 0));
        return data.messages || [];
      } else {
        // Backward compatibility for non-paginated response
        const messages = data.messages || [];
        setHasMoreMessages(false);
        setTotalMessages(messages.length);
        return messages;
      }
    } catch (error) {
      console.error('Error loading session messages:', error);
      return [];
    } finally {
      if (isInitialLoad) {
        setIsLoadingSessionMessages(false);
      } else {
        setIsLoadingMoreMessages(false);
      }
    }
  }, [messagesOffset]);

  // Wrapper for loadCursorSessionMessages that manages loading state
  const loadCursorSessionMessagesWithState = useCallback(async (projectPath, sessionId) => {
    if (!projectPath || !sessionId) return [];
    setIsLoadingSessionMessages(true);
    try {
      return await loadCursorSessionMessages(projectPath, sessionId);
    } finally {
      setIsLoadingSessionMessages(false);
    }
  }, []);

  // Memoize expensive convertSessionMessages operation
  const convertedMessages = useMemo(() => {
    return convertSessionMessages(sessionMessages);
  }, [sessionMessages]);

  // Reset pagination state
  const resetPagination = useCallback(() => {
    setMessagesOffset(0);
    setHasMoreMessages(false);
    setTotalMessages(0);
  }, []);

  // Clear all messages
  const clearMessages = useCallback(() => {
    setSessionMessages([]);
    resetPagination();
  }, [resetPagination]);

  return {
    sessionMessages,
    setSessionMessages,
    isLoadingSessionMessages,
    setIsLoadingSessionMessages,
    isLoadingMoreMessages,
    setIsLoadingMoreMessages,
    messagesOffset,
    setMessagesOffset,
    hasMoreMessages,
    setHasMoreMessages,
    totalMessages,
    setTotalMessages,
    loadSessionMessages,
    loadCursorSessionMessagesWithState,
    convertedMessages,
    resetPagination,
    clearMessages,
    MESSAGES_PER_PAGE
  };
}

export default useSessionMessages;
