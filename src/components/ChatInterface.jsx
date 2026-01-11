/*
 * ChatInterface.jsx - Chat Component with Session Protection Integration
 * 
 * SESSION PROTECTION INTEGRATION:
 * ===============================
 * 
 * This component integrates with the Session Protection System to prevent project updates
 * from interrupting active conversations:
 * 
 * Key Integration Points:
 * 1. handleSubmit() - Marks session as active when user sends message (including temp ID for new sessions)
 * 2. session-created handler - Replaces temporary session ID with real WebSocket session ID  
 * 3. claude-complete handler - Marks session as inactive when conversation finishes
 * 4. session-aborted handler - Marks session as inactive when conversation is aborted
 * 
 * This ensures uninterrupted chat experience by coordinating with App.jsx to pause sidebar updates.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

// Import utilities from refactored modules
import {
  createMemoizedDiff,
} from './ChatInterface/utils';

// Import custom hooks
import { 
  useTokenBudget, 
  useProviderState, 
  useImageUpload, 
  useFileDropdown, 
  useSessionMessages, 
  useSlashCommands, 
  useScrollManagement, 
  useWebSocketMessages,
  useCommandExecution,
  useMessageEditing,
  useMessageSubmit,
  useChatSession,
  useInputManagement
} from './ChatInterface/hooks';

// Import components
import ImagePreviewModal from './ChatInterface/components/ImagePreviewModal';
import ToolResultModal from './ChatInterface/components/ToolResultModal';
import MessageList from './ChatInterface/components/MessageList';
import InputArea from './ChatInterface/components/InputArea';

// ChatInterface: Main chat component with Session Protection System integration
// 
// Session Protection System prevents automatic project updates from interrupting active conversations:
// - onSessionActive: Called when user sends message to mark session as protected
// - onSessionInactive: Called when conversation completes/aborts to re-enable updates
// - onReplaceTemporarySession: Called to replace temporary session ID with real WebSocket session ID
//
// This ensures uninterrupted chat experience by pausing sidebar refreshes during conversations.
function ChatInterface({ 
  selectedProject, 
  selectedSession, 
  ws, 
  sendMessage, 
  messages, 
  onFileOpen, 
  onInputFocusChange, 
  onSessionActive, 
  onSessionInactive, 
  onSessionProcessing, 
  onSessionNotProcessing, 
  onSessionCompleted, 
  processingSessions, 
  onReplaceTemporarySession, 
  onNavigateToSession, 
  onShowSettings, 
  autoExpandTools, 
  showRawParameters, 
  showThinking, 
  autoScrollToBottom, 
  sendByCtrlEnter, 
  externalMessageUpdate, 
  onToggleQuickSettings,
  // Background task support
  getProjectTasks,
  // Clear chat trigger from mobile header
  clearChatTrigger
}) {
  // Refs
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const inputContainerRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // Local state - declared early because hooks depend on setters
  const [imagePreview, setImagePreview] = useState(null);
  const [toolResultModal, setToolResultModal] = useState(null);
  const [claudeStatus, setClaudeStatus] = useState(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(100);
  // WebSocket message tracking
  const [wsMessageCount, setWsMessageCount] = useState(0);
  const [lastMessageTime, setLastMessageTime] = useState(null);

  // Session messages management via custom hook
  const {
    sessionMessages,
    setSessionMessages,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    loadSessionMessages,
    loadCursorSessionMessagesWithState,
    convertedMessages,
    resetPagination
  } = useSessionMessages();
  
  // Provider and model state management via custom hook
  const {
    provider,
    setProvider,
    claudeModel,
    setClaudeModel,
    cursorModel,
    setCursorModel,
    codebuddyModel,
    setCodebuddyModel,
    permissionMode,
    cyclePermissionMode
  } = useProviderState({ selectedSession });

  // Token budget management via custom hook
  const { tokenBudget, fetchUpdatedTokenUsage, resetTokenBudget } = useTokenBudget({
    selectedProject,
    selectedSession
  });

  // Scroll management via custom hook (chatMessages passed later via effect)
  const {
    isUserScrolledUp,
    setIsUserScrolledUp,
    scrollToBottom,
    isNearBottom,
    captureScrollPosition,
    handleAutoScroll,
    updateChatMessagesLength,
    isLoadingMoreMessagesRef,
    pendingScrollRestoreRef,
    loadMoreMessages
  } = useScrollManagement({
    scrollContainerRef,
    autoScrollToBottom,
    hasMoreMessages,
    selectedSession,
    selectedProject,
    loadSessionMessages,
    setSessionMessages
  });

  // Chat session management via custom hook
  const {
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
  } = useChatSession({
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    provider,
    loadSessionMessages,
    loadCursorSessionMessagesWithState,
    resetPagination,
    setSessionMessages,
    resetTokenBudget,
    scrollToBottom,
    isNearBottom,
    autoScrollToBottom,
    processingSessions,
    externalMessageUpdate,
    // Background task support
    getProjectTasks,
    // Token usage refresh
    fetchUpdatedTokenUsage
  });

  // Image upload management via custom hook
  const {
    attachedImages,
    uploadingImages,
    imageErrors,
    handlePaste: handleImagePaste,
    removeImage,
    clearImages,
    getRootProps,
    getInputProps,
    isDragActive,
    openFilePicker
  } = useImageUpload({ maxFiles: 5, maxSize: 5 * 1024 * 1024 });

  // Input management via custom hook
  const {
    input,
    setInput,
    cursorPosition,
    setCursorPosition,
    isTextareaExpanded,
    setIsTextareaExpanded,
    isInputFocused,
    setIsInputFocused,
    handleTranscript,
    handleTextareaClick,
    handleTextareaInput,
    handleClearInput,
    placeholderText
  } = useInputManagement({
    selectedProject,
    textareaRef,
    provider
  });

  // File dropdown management via custom hook
  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    setSelectedFileIndex,
    selectFile,
    closeDropdown: closeFileDropdown
  } = useFileDropdown({
    selectedProject,
    input,
    cursorPosition,
    setInput,
    setCursorPosition,
    textareaRef
  });

  // Slash commands management via custom hook
  const {
    slashCommands,
    filteredCommands,
    commandQuery,
    setCommandQuery,
    selectedCommandIndex,
    setSelectedCommandIndex,
    showCommandMenu,
    setShowCommandMenu,
    slashPosition,
    setSlashPosition,
    frequentCommands,
    updateCommandHistory,
    detectSlashCommand,
    closeCommandMenu,
    toggleCommandMenu,
    resetCommandMenu
  } = useSlashCommands({ selectedProject });

  // WebSocket message handling via custom hook
  useWebSocketMessages({
    messages,
    currentSessionId,
    selectedSession,
    selectedProject,
    provider,
    setChatMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setCurrentSessionId,
    setIsSystemSessionChange,
    setSessionMessages,
    fetchUpdatedTokenUsage,
    onSessionActive,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onSessionCompleted,
    onReplaceTemporarySession,
    onNavigateToSession
  });

  // Message editing via custom hook
  const {
    editingMessageIndex,
    handleEditMessage,
    handleDeleteMessage,
    handleCancelEdit,
    truncateForEdit,
    clearEditingState
  } = useMessageEditing({
    selectedProject,
    currentSessionId,
    isLoading,
    chatMessages,
    setChatMessages,
    setInput,
    textareaRef
  });

  // Message submission via custom hook
  const {
    handleSubmit: handleMessageSubmit
  } = useMessageSubmit({
    selectedProject,
    selectedSession,
    currentSessionId,
    provider,
    claudeModel,
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
  });

  // Command execution via custom hook
  const {
    executeCommand,
    setHandleSubmitRef
  } = useCommandExecution({
    setInput,
    resetCommandMenu
  });

  // Memoized diff calculation to prevent recalculating on every render
  const createDiff = useMemo(() => createMemoizedDiff(100), []);

  // Show only recent messages for better performance
  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) {
      return chatMessages;
    }
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  // Command selection callback with history tracking
  const handleCommandSelect = useCallback((command, index, isHover) => {
    if (!command || !selectedProject) return;

    // If hovering, just update the selected index
    if (isHover) {
      setSelectedCommandIndex(index);
      return;
    }

    // Update command history
    updateCommandHistory(command);

    // Execute the command
    executeCommand(command, input);
  }, [selectedProject, updateCommandHistory, executeCommand, input, setSelectedCommandIndex]);

  // Main form submit handler - combines editing and message submission
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !selectedProject) return;

    // Store editing state in local variable to avoid async state issues
    const wasEditing = editingMessageIndex !== null;

    // If editing a message, truncate first
    if (wasEditing) {
      const success = await truncateForEdit();
      if (!success) return;
    }

    // Submit the message using the hook
    const success = await handleMessageSubmit(input);
    
    if (success) {
      setInput('');
      setIsTextareaExpanded(false);

      // Clear editing state after message is sent
      if (wasEditing) {
        clearEditingState();
      }

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  }, [input, isLoading, selectedProject, editingMessageIndex, truncateForEdit, handleMessageSubmit, clearEditingState, setInput, setIsTextareaExpanded, textareaRef]);

  // Store handleSubmit in ref so handleCustomCommand can access it
  useEffect(() => {
    setHandleSubmitRef(handleSubmit);
  }, [handleSubmit, setHandleSubmitRef]);

  // Notify parent when input focus changes
  useEffect(() => {
    if (onInputFocusChange) {
      onInputFocusChange(isInputFocused);
    }
  }, [isInputFocused, onInputFocusChange]);

  // Track processing state: notify parent when isLoading becomes true
  useEffect(() => {
    if (currentSessionId && isLoading && onSessionProcessing) {
      onSessionProcessing(currentSessionId);
    }
  }, [isLoading, currentSessionId, onSessionProcessing]);

  // Track WebSocket messages for progress display
  useEffect(() => {
    if (!isLoading) {
      // Reset counters when not loading
      setWsMessageCount(0);
      setLastMessageTime(null);
    } else if (messages.length > 0) {
      // Update message count and last message time when loading
      setWsMessageCount(messages.length);
      setLastMessageTime(Date.now());
    }
  }, [messages.length, isLoading]);

  // Update chatMessages when convertedMessages changes
  useEffect(() => {
    if (sessionMessages.length > 0) {
      setChatMessages(convertedMessages);
      
      // Restore scroll position after loading more messages (maintain distance from bottom)
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
    } else if (sessionMessages.length === 0 && convertedMessages.length === 0) {
      if (!isLoadingSessionMessages && !isSystemSessionChange) {
        setChatMessages([]);
      }
    }
  }, [convertedMessages, sessionMessages, isLoadingSessionMessages, isSystemSessionChange, setChatMessages, pendingScrollRestoreRef, scrollContainerRef]);

  // Capture scroll position before render when auto-scroll is disabled
  useEffect(() => {
    captureScrollPosition();
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    updateChatMessagesLength(chatMessages.length);
    handleAutoScroll();
  }, [chatMessages.length, handleAutoScroll, updateChatMessagesLength]);

  // Scroll to bottom when messages first load after session switch
  useEffect(() => {
    if (scrollContainerRef.current && chatMessages.length > 0 && !isLoadingSessionRef.current) {
      setIsUserScrolledUp(false);
      setTimeout(() => {
        scrollToBottom();
      }, 200);
    }
  }, [selectedSession?.id, selectedProject?.name, setIsUserScrolledUp, scrollToBottom, isLoadingSessionRef]);

  // Load earlier messages by increasing the visible message count
  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount(prevCount => prevCount + 100);
  }, []);

  // Handle clear chat trigger from mobile header
  useEffect(() => {
    if (clearChatTrigger > 0) {
      setChatMessages([]);
      setSessionMessages([]);
    }
  }, [clearChatTrigger, setChatMessages, setSessionMessages]);

  // Don't render if no project is selected
  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <p>Select a project to start chatting with Claude</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>
        {`
          details[open] .details-chevron {
            transform: rotate(180deg);
          }
        `}
      </style>
      <div className="h-full flex flex-col">
        {/* Messages Area - Scrollable Middle Section */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden px-0 py-3 sm:p-4 space-y-3 sm:space-y-4 relative"
        >
          <MessageList
            chatMessages={chatMessages}
            visibleMessages={visibleMessages}
            sessionMessages={sessionMessages}
            isLoadingSessionMessages={isLoadingSessionMessages}
            isLoadingMoreMessages={isLoadingMoreMessages}
            hasMoreMessages={hasMoreMessages}
            totalMessages={totalMessages}
            visibleMessageCount={visibleMessageCount}
            loadEarlierMessages={hasMoreMessages ? loadMoreMessages : loadEarlierMessages}
            selectedSession={selectedSession}
            currentSessionId={currentSessionId}
            selectedProject={selectedProject}
            provider={provider}
            setProvider={setProvider}
            claudeModel={claudeModel}
            setClaudeModel={setClaudeModel}
            cursorModel={cursorModel}
            setCursorModel={setCursorModel}
            codebuddyModel={codebuddyModel}
            setCodebuddyModel={setCodebuddyModel}
            createDiff={createDiff}
            onFileOpen={onFileOpen}
            onShowSettings={onShowSettings}
            handleEditMessage={handleEditMessage}
            handleDeleteMessage={handleDeleteMessage}
            setImagePreview={setImagePreview}
            setToolResultModal={setToolResultModal}
            autoExpandTools={autoExpandTools}
            showRawParameters={showRawParameters}
            showThinking={showThinking}
            textareaRef={textareaRef}
            messagesEndRef={messagesEndRef}
          />
        </div>

        {/* Input Area - Fixed Bottom */}
        <InputArea
          // Input state
          input={input}
          setInput={setInput}
          isLoading={isLoading}
          isInputFocused={isInputFocused}
          setIsInputFocused={setIsInputFocused}
          handleSubmit={handleSubmit}
          sendByCtrlEnter={sendByCtrlEnter}
          // Permission mode
          permissionMode={permissionMode}
          cyclePermissionMode={cyclePermissionMode}
          // Image upload props
          attachedImages={attachedImages}
          removeImage={removeImage}
          uploadingImages={uploadingImages}
          imageErrors={imageErrors}
          getRootProps={getRootProps}
          getInputProps={getInputProps}
          isDragActive={isDragActive}
          openFilePicker={openFilePicker}
          handleImagePaste={handleImagePaste}
          // File dropdown props
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          setSelectedFileIndex={setSelectedFileIndex}
          selectFile={selectFile}
          closeFileDropdown={closeFileDropdown}
          // Command menu props
          showCommandMenu={showCommandMenu}
          setShowCommandMenu={setShowCommandMenu}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          setSelectedCommandIndex={setSelectedCommandIndex}
          handleCommandSelect={handleCommandSelect}
          slashCommands={slashCommands}
          frequentCommands={frequentCommands}
          commandQuery={commandQuery}
          setCommandQuery={setCommandQuery}
          slashPosition={slashPosition}
          setSlashPosition={setSlashPosition}
          toggleCommandMenu={toggleCommandMenu}
          closeCommandMenu={closeCommandMenu}
          detectSlashCommand={detectSlashCommand}
          // Token budget
          tokenBudget={tokenBudget}
          // Refs
          textareaRef={textareaRef}
          inputContainerRef={inputContainerRef}
          // Scroll
          scrollToBottom={scrollToBottom}
          isUserScrolledUp={isUserScrolledUp}
          chatMessages={chatMessages}
          // Quick settings
          onToggleQuickSettings={onToggleQuickSettings}
          // Edit mode
          editingMessageIndex={editingMessageIndex}
          handleCancelEdit={handleCancelEdit}
          // Claude status
          claudeStatus={claudeStatus}
          handleAbortSession={handleAbortSession}
          provider={provider}
          showThinking={showThinking}
          // WebSocket message tracking
          wsMessageCount={wsMessageCount}
          lastMessageTime={lastMessageTime}
          // Transcript & input handlers from useInputManagement
          handleTranscript={handleTranscript}
          isTextareaExpanded={isTextareaExpanded}
          cursorPosition={cursorPosition}
          setCursorPosition={setCursorPosition}
          handleTextareaClick={handleTextareaClick}
          handleTextareaInput={handleTextareaInput}
          handleClearInput={handleClearInput}
          placeholderText={placeholderText}
          // Refresh session
          onRefreshSession={handleRefreshSession}
          // Model selection
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          cursorModel={cursorModel}
          setCursorModel={setCursorModel}
          codebuddyModel={codebuddyModel}
          setCodebuddyModel={setCodebuddyModel}
        />

        {/* Image Preview Modal */}
        <ImagePreviewModal
          imagePreview={imagePreview}
          onClose={() => setImagePreview(null)}
        />

        {/* Tool Result Modal */}
        <ToolResultModal
          toolResultModal={toolResultModal}
          onClose={() => setToolResultModal(null)}
          onFileOpen={onFileOpen}
        />
      </div>
    </>
  );
}

export default React.memo(ChatInterface);
