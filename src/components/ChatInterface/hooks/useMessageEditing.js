/**
 * useMessageEditing - Hook for message editing and deletion
 * Handles edit mode, message truncation, and deletion
 */

import { useState, useCallback } from 'react';
import { authenticatedFetch } from '../../../utils/api';

/**
 * Hook for managing message editing
 * @param {Object} params
 * @param {Object} params.selectedProject - Currently selected project
 * @param {string} params.currentSessionId - Current session ID
 * @param {boolean} params.isLoading - Whether a message is being processed
 * @param {Array} params.chatMessages - Current chat messages
 * @param {Function} params.setChatMessages - Set chat messages
 * @param {Function} params.setInput - Set input value
 * @param {React.RefObject} params.textareaRef - Reference to textarea element
 */
export function useMessageEditing({
  selectedProject,
  currentSessionId,
  isLoading,
  chatMessages,
  setChatMessages,
  setInput,
  textareaRef
}) {
  const [editingMessageIndex, setEditingMessageIndex] = useState(null);
  const [originalInput, setOriginalInput] = useState('');

  // Handle edit message
  const handleEditMessage = useCallback((messageIndex) => {
    // Prevent editing if already in edit mode or loading
    if (editingMessageIndex !== null || isLoading) return;
    
    const message = chatMessages[messageIndex];
    if (!message || message.type !== 'user') return;

    // Save original input in case user cancels
    const currentInput = textareaRef.current?.value || '';
    setOriginalInput(currentInput);
    
    // Fill input with message content
    setInput(message.content || '');
    
    // Mark this message as being edited
    setEditingMessageIndex(messageIndex);
    
    // Focus the input
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [chatMessages, editingMessageIndex, isLoading, setInput, textareaRef]);

  // Handle delete message
  const handleDeleteMessage = useCallback(async (messageIndex) => {
    if (isLoading || !selectedProject) return;
    
    try {
      // Find the timestamp to keep until
      // If we are deleting from index 0, we want to keep nothing (or until epoch)
      // If we are deleting from index > 0, we want to keep up to the previous message
      let keepUntilTimestamp;
      
      if (messageIndex > 0) {
        const previousMessage = chatMessages[messageIndex - 1];
        if (previousMessage && previousMessage.timestamp) {
           keepUntilTimestamp = previousMessage.timestamp;
        } else {
           console.error('Cannot delete: previous message missing timestamp');
           return;
        }
      } else {
        // Deleting the first message means clearing everything.
        // Use a very old timestamp to delete all
        keepUntilTimestamp = new Date(0).toISOString(); 
      }

      // Format timestamp correctly
      if (typeof keepUntilTimestamp === 'number') {
        keepUntilTimestamp = new Date(keepUntilTimestamp).toISOString();
      } else if (keepUntilTimestamp instanceof Date) {
        keepUntilTimestamp = keepUntilTimestamp.toISOString();
      }
      
      // Call backend to truncate
      const response = await authenticatedFetch(
        `/api/projects/${encodeURIComponent(selectedProject.name)}/sessions/${currentSessionId}/truncate`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keepUntilTimestamp
          })
        }
      );
      
      if (!response.ok) {
         const error = await response.json();
         throw new Error(error.error || 'Failed to truncate session');
      }
      
      // Update frontend state immediately
      setChatMessages(prev => prev.slice(0, messageIndex));

    } catch (error) {
      console.error('Failed to delete message:', error);
      setChatMessages(prev => [...prev, {
        type: 'error',
        content: `Failed to delete message: ${error.message}`,
        timestamp: new Date()
      }]);
    }
  }, [isLoading, chatMessages, selectedProject, currentSessionId, setChatMessages]);

  // Cancel editing
  const handleCancelEdit = useCallback(() => {
    // Restore original input
    setInput(originalInput);
    setEditingMessageIndex(null);
    setOriginalInput('');
  }, [originalInput, setInput]);

  // Truncate messages for editing (called before submitting edited message)
  const truncateForEdit = useCallback(async () => {
    if (editingMessageIndex === null) return true;

    const messageToEdit = chatMessages[editingMessageIndex];
    if (!messageToEdit || !messageToEdit.timestamp) {
      console.error('Cannot edit message: missing timestamp');
      setEditingMessageIndex(null);
      return false;
    }

    try {
      // We need to find the message BEFORE the one being edited
      // to use as the truncation point
      const messageBeforeEdit = editingMessageIndex > 0 
        ? chatMessages[editingMessageIndex - 1] 
        : null;

      if (messageBeforeEdit && messageBeforeEdit.timestamp) {
        // Convert timestamp to ISO string
        let timestampISO = messageBeforeEdit.timestamp;
        if (typeof timestampISO === 'number') {
          timestampISO = new Date(timestampISO).toISOString();
        } else if (timestampISO instanceof Date) {
          timestampISO = timestampISO.toISOString();
        }

        // Truncate backend messages (keep messages up to and including the one before)
        const response = await authenticatedFetch(
          `/api/projects/${encodeURIComponent(selectedProject.name)}/sessions/${currentSessionId}/truncate`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              keepUntilTimestamp: timestampISO
            })
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to truncate session');
        }
      }

      // Truncate frontend messages - keep messages BEFORE the one being edited
      const truncatedMessages = chatMessages.slice(0, editingMessageIndex);
      setChatMessages(truncatedMessages);
      
      return true;
    } catch (error) {
      console.error('Failed to truncate messages:', error);
      setChatMessages(prev => [...prev, {
        type: 'error',
        content: `Failed to edit message: ${error.message}`,
        timestamp: new Date()
      }]);
      setEditingMessageIndex(null);
      setOriginalInput('');
      return false;
    }
  }, [editingMessageIndex, chatMessages, selectedProject, currentSessionId, setChatMessages]);

  // Clear editing state (called after successful submit)
  const clearEditingState = useCallback(() => {
    setEditingMessageIndex(null);
    setOriginalInput('');
  }, []);

  return {
    editingMessageIndex,
    setEditingMessageIndex,
    originalInput,
    setOriginalInput,
    handleEditMessage,
    handleDeleteMessage,
    handleCancelEdit,
    truncateForEdit,
    clearEditingState
  };
}
