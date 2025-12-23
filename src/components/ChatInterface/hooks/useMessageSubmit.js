/**
 * useMessageSubmit - Hook for message submission
 * Handles sending messages to different providers
 */

import { useCallback } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { safeLocalStorage } from '../utils';

/**
 * Hook for managing message submission
 * @param {Object} params
 * @param {Object} params.selectedProject - Currently selected project
 * @param {Object} params.selectedSession - Currently selected session
 * @param {string} params.currentSessionId - Current session ID
 * @param {string} params.provider - Current provider (claude/cursor/codebuddy)
 * @param {string} params.cursorModel - Current Cursor model
 * @param {string} params.codebuddyModel - Current CodeBuddy model
 * @param {string} params.permissionMode - Current permission mode
 * @param {Array} params.attachedImages - Attached images
 * @param {Function} params.sendMessage - WebSocket send message function
 * @param {Function} params.setChatMessages - Set chat messages
 * @param {Function} params.setIsLoading - Set loading state
 * @param {Function} params.setCanAbortSession - Set abort session state
 * @param {Function} params.setClaudeStatus - Set Claude status
 * @param {Function} params.setIsUserScrolledUp - Set scroll state
 * @param {Function} params.scrollToBottom - Scroll to bottom function
 * @param {Function} params.clearImages - Clear attached images
 * @param {Function} params.onSessionActive - Callback when session becomes active
 */
export function useMessageSubmit({
  selectedProject,
  selectedSession,
  currentSessionId,
  provider,
  cursorModel,
  codebuddyModel,
  permissionMode,
  attachedImages,
  sendMessage,
  setChatMessages,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setIsUserScrolledUp,
  scrollToBottom,
  clearImages,
  onSessionActive
}) {
  // Upload images and return uploaded image info
  const uploadImages = useCallback(async () => {
    if (attachedImages.length === 0) return [];

    const formData = new FormData();
    attachedImages.forEach(file => {
      formData.append('images', file);
    });
    
    try {
      const response = await authenticatedFetch(`/api/projects/${selectedProject.name}/upload-images`, {
        method: 'POST',
        headers: {}, // Let browser set Content-Type for FormData
        body: formData
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to upload images');
      }
      
      const result = await response.json();
      return result.images;
    } catch (error) {
      console.error('Image upload failed:', error);
      throw error;
    }
  }, [attachedImages, selectedProject]);

  // Get tools settings from localStorage based on provider
  const getToolsSettings = useCallback(() => {
    try {
      const settingsKey = provider === 'cursor' ? 'cursor-tools-settings' : 'claude-settings';
      const savedSettings = safeLocalStorage.getItem(settingsKey);
      if (savedSettings) {
        return JSON.parse(savedSettings);
      }
    } catch (error) {
      console.error('Error loading tools settings:', error);
    }
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false
    };
  }, [provider]);

  // Submit message to the appropriate provider
  const submitMessage = useCallback(async (input, uploadedImages = []) => {
    if (!input.trim() || !selectedProject) return false;

    const userMessage = {
      type: 'user',
      content: input,
      images: uploadedImages,
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setCanAbortSession(true);
    
    // Set a default status when starting
    setClaudeStatus({
      text: 'Processing',
      tokens: 0,
      can_interrupt: true
    });
    
    // Always scroll to bottom when user sends a message and reset scroll state
    setIsUserScrolledUp(false);
    setTimeout(() => scrollToBottom(), 100);

    // Determine effective session id for replies to avoid race on state updates
    const effectiveSessionId = currentSessionId || selectedSession?.id || sessionStorage.getItem('cursorSessionId');

    // Session Protection: Mark session as active to prevent automatic project updates during conversation
    const sessionToActivate = effectiveSessionId || `new-session-${Date.now()}`;
    if (onSessionActive) {
      onSessionActive(sessionToActivate);
    }

    const toolsSettings = getToolsSettings();

    // Send command based on provider
    if (provider === 'cursor') {
      sendMessage({
        type: 'cursor-command',
        command: input,
        sessionId: effectiveSessionId,
        options: {
          cwd: selectedProject.fullPath || selectedProject.path,
          projectPath: selectedProject.fullPath || selectedProject.path,
          sessionId: effectiveSessionId,
          resume: !!effectiveSessionId,
          model: cursorModel,
          skipPermissions: toolsSettings?.skipPermissions || false,
          toolsSettings: toolsSettings
        }
      });
    } else if (provider === 'codebuddy') {
      sendMessage({
        type: 'codebuddy-command',
        command: input,
        sessionId: effectiveSessionId,
        options: {
          cwd: selectedProject.fullPath || selectedProject.path,
          projectPath: selectedProject.fullPath || selectedProject.path,
          sessionId: effectiveSessionId,
          resume: !!effectiveSessionId,
          model: codebuddyModel,
          toolsSettings: toolsSettings,
          permissionMode: permissionMode,
          images: uploadedImages
        }
      });
    } else {
      sendMessage({
        type: 'claude-command',
        command: input,
        options: {
          projectPath: selectedProject.path,
          cwd: selectedProject.fullPath,
          sessionId: currentSessionId,
          resume: !!currentSessionId,
          toolsSettings: toolsSettings,
          permissionMode: permissionMode,
          images: uploadedImages
        }
      });
    }

    // Clear the saved draft since message was sent
    if (selectedProject) {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }

    return true;
  }, [
    selectedProject, selectedSession, currentSessionId, provider, cursorModel, codebuddyModel,
    permissionMode, sendMessage, setChatMessages, setIsLoading, setCanAbortSession,
    setClaudeStatus, setIsUserScrolledUp, scrollToBottom, onSessionActive, getToolsSettings
  ]);

  // Full submit handler (upload images + submit message)
  const handleSubmit = useCallback(async (input) => {
    if (!input.trim() || !selectedProject) return false;

    try {
      // Upload images first if any
      let uploadedImages = [];
      if (attachedImages.length > 0) {
        uploadedImages = await uploadImages();
      }

      // Submit the message
      const success = await submitMessage(input, uploadedImages);
      
      if (success) {
        // Clear attached images
        clearImages();
      }

      return success;
    } catch (error) {
      setChatMessages(prev => [...prev, {
        type: 'error',
        content: `Failed to upload images: ${error.message}`,
        timestamp: new Date()
      }]);
      return false;
    }
  }, [selectedProject, attachedImages, uploadImages, submitMessage, clearImages, setChatMessages]);

  return {
    uploadImages,
    submitMessage,
    handleSubmit,
    getToolsSettings
  };
}
