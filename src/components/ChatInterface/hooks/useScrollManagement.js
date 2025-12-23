/**
 * useScrollManagement - Hook for scroll behavior management
 * Handles auto-scroll, scroll position preservation, and load-more triggers
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { getProjectId } from '../../../utils/api';

/**
 * Hook for managing scroll behavior in chat interface
 * @param {Object} params
 * @param {React.RefObject} params.scrollContainerRef - Ref to scroll container
 * @param {boolean} params.autoScrollToBottom - Whether auto-scroll is enabled
 * @param {boolean} params.hasMoreMessages - Whether there are more messages to load
 * @param {Object} params.selectedSession - Currently selected session
 * @param {Object} params.selectedProject - Currently selected project
 * @param {Function} params.loadSessionMessages - Function to load more messages
 * @param {Function} params.setSessionMessages - Function to update session messages
 */
export function useScrollManagement({
  scrollContainerRef,
  autoScrollToBottom,
  hasMoreMessages,
  selectedSession,
  selectedProject,
  loadSessionMessages,
  setSessionMessages
}) {
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const isLoadingMoreMessagesRef = useRef(false);
  const pendingScrollRestoreRef = useRef(null);
  const lastScrollLoadTimeRef = useRef(0);
  const touchStartYRef = useRef(0);
  const pullDownTriggeredRef = useRef(false);
  // Store chatMessages length in ref to avoid dependency issues
  const chatMessagesLengthRef = useRef(0);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [scrollContainerRef]);

  // Check if user is near the bottom of the scroll container
  const isNearBottom = useCallback(() => {
    if (!scrollContainerRef.current) return false;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, [scrollContainerRef]);

  // Load more messages when pull-down is triggered
  const loadMoreMessagesOnPullDown = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const provider = localStorage.getItem('selected-provider') || 'claude';
    
    // Throttle: minimum 2 seconds between load requests
    const now = Date.now();
    if (now - lastScrollLoadTimeRef.current < 2000) {
      return;
    }
    
    if (hasMoreMessages && !isLoadingMoreMessagesRef.current && selectedSession && selectedProject && provider !== 'cursor') {
      isLoadingMoreMessagesRef.current = true;
      lastScrollLoadTimeRef.current = now;
      
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      
      try {
        const moreMessages = await loadSessionMessages(getProjectId(selectedProject), selectedSession.id, true);
        
        if (moreMessages.length > 0) {
          pendingScrollRestoreRef.current = { distanceFromBottom };
          setSessionMessages(prev => [...moreMessages, ...prev]);
        }
      } catch (error) {
        console.error('Error loading more messages:', error);
        isLoadingMoreMessagesRef.current = false;
      }
    }
  }, [hasMoreMessages, selectedSession, selectedProject, loadSessionMessages, scrollContainerRef, setSessionMessages]);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      const nearBottom = isNearBottom();
      setIsUserScrolledUp(!nearBottom);
    }
  }, [isNearBottom, scrollContainerRef]);

  // Handle touch start
  const handleTouchStart = useCallback((e) => {
    touchStartYRef.current = e.touches[0].clientY;
    pullDownTriggeredRef.current = false;
  }, []);

  // Handle touch move - detect pull-down gesture
  const handleTouchMove = useCallback((e) => {
    if (!scrollContainerRef.current || pullDownTriggeredRef.current) return;
    
    const container = scrollContainerRef.current;
    const atTop = container.scrollTop === 0;
    const touchY = e.touches[0].clientY;
    const pullDistance = touchY - touchStartYRef.current;
    
    if (atTop && pullDistance > 50) {
      pullDownTriggeredRef.current = true;
      loadMoreMessagesOnPullDown();
    }
  }, [loadMoreMessagesOnPullDown, scrollContainerRef]);

  // Handle wheel event for desktop
  const handleWheel = useCallback((e) => {
    if (!scrollContainerRef.current) return;
    
    const container = scrollContainerRef.current;
    const atTop = container.scrollTop === 0;
    
    if (atTop && e.deltaY < -30) {
      loadMoreMessagesOnPullDown();
    }
  }, [loadMoreMessagesOnPullDown, scrollContainerRef]);

  // Capture scroll position before render when auto-scroll is disabled
  const captureScrollPosition = useCallback(() => {
    if (!autoScrollToBottom && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      scrollPositionRef.current = {
        height: container.scrollHeight,
        top: container.scrollTop
      };
    }
  }, [autoScrollToBottom, scrollContainerRef]);

  // Restore scroll position after content changes
  const restoreScrollPosition = useCallback(() => {
    if (pendingScrollRestoreRef.current && scrollContainerRef.current) {
      const { distanceFromBottom } = pendingScrollRestoreRef.current;
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          const newScrollHeight = scrollContainerRef.current.scrollHeight;
          const clientHeight = scrollContainerRef.current.clientHeight;
          scrollContainerRef.current.scrollTop = newScrollHeight - clientHeight - distanceFromBottom;
        }
        pendingScrollRestoreRef.current = null;
      });
    }
  }, [scrollContainerRef]);

  // Handle auto-scroll behavior
  const handleAutoScroll = useCallback(() => {
    if (scrollContainerRef.current && chatMessagesLengthRef.current > 0) {
      if (autoScrollToBottom) {
        if (!isUserScrolledUp) {
          setTimeout(() => scrollToBottom(), 50);
        }
      } else {
        const container = scrollContainerRef.current;
        const prevHeight = scrollPositionRef.current.height;
        const prevTop = scrollPositionRef.current.top;
        const newHeight = container.scrollHeight;
        const heightDiff = newHeight - prevHeight;

        if (heightDiff > 0 && prevTop > 0) {
          container.scrollTop = prevTop + heightDiff;
        }
      }
    }
  }, [autoScrollToBottom, isUserScrolledUp, scrollToBottom, scrollContainerRef]);

  // Update chatMessages length ref (call this from parent component)
  const updateChatMessagesLength = useCallback((length) => {
    chatMessagesLengthRef.current = length;
  }, []);

  // Setup scroll event listeners
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      scrollContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
      scrollContainer.addEventListener('touchmove', handleTouchMove, { passive: true });
      scrollContainer.addEventListener('wheel', handleWheel, { passive: true });
      return () => {
        scrollContainer.removeEventListener('scroll', handleScroll);
        scrollContainer.removeEventListener('touchstart', handleTouchStart);
        scrollContainer.removeEventListener('touchmove', handleTouchMove);
        scrollContainer.removeEventListener('wheel', handleWheel);
      };
    }
  }, [handleScroll, handleTouchStart, handleTouchMove, handleWheel, scrollContainerRef]);

  return {
    isUserScrolledUp,
    setIsUserScrolledUp,
    scrollToBottom,
    isNearBottom,
    captureScrollPosition,
    restoreScrollPosition,
    handleAutoScroll,
    updateChatMessagesLength,
    isLoadingMoreMessagesRef,
    pendingScrollRestoreRef
  };
}

export default useScrollManagement;
