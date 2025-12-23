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

import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';

// Import utilities from refactored modules
import {
  safeLocalStorage,
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
  onToggleQuickSettings 
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

  // Session messages management via custom hook
  const {
    sessionMessages,
    setSessionMessages,
    isLoadingSessionMessages,
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
    MESSAGES_PER_PAGE
  } = useSessionMessages();
  
  // Provider and model state management via custom hook
  const {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    codebuddyModel,
    setCodebuddyModel,
    permissionMode,
    setPermissionMode,
    cyclePermissionMode
  } = useProviderState({ selectedSession });

  // Token budget management via custom hook
  const { tokenBudget, setTokenBudget, fetchUpdatedTokenUsage, resetTokenBudget } = useTokenBudget({
    selectedProject,
    selectedSession
  });

  // Scroll management via custom hook
  const {
    isUserScrolledUp,
    setIsUserScrolledUp,
    scrollToBottom,
    isNearBottom,
    handleScroll,
    handleTouchStart,
    handleTouchMove,
    handleWheel,
    captureScrollPosition,
    handleAutoScroll,
    isLoadingMoreMessagesRef,
    pendingScrollRestoreRef
  } = useScrollManagement({
    scrollContainerRef,
    autoScrollToBottom,
    chatMessages: [], // Will be updated after useChatSession
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
    handleAbortSession
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
    externalMessageUpdate
  });

  // Image upload management via custom hook
  const {
    attachedImages,
    setAttachedImages,
    uploadingImages,
    setUploadingImages,
    imageErrors,
    setImageErrors,
    handleImageFiles,
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
    debouncedInput,
    cursorPosition,
    setCursorPosition,
    isTextareaExpanded,
    setIsTextareaExpanded,
    isInputFocused,
    setIsInputFocused,
    handleTranscript,
    clearInput
  } = useInputManagement({
    selectedProject,
    textareaRef
  });

  // File dropdown management via custom hook
  const {
    showFileDropdown,
    setShowFileDropdown,
    fileList,
    filteredFiles,
    selectedFileIndex,
    setSelectedFileIndex,
    atSymbolPosition,
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
    setFilteredCommands,
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
    resetCommandMenu,
    commandQueryTimerRef
  } = useSlashCommands({ selectedProject });

  // WebSocket message handling via custom hook
  const {
    streamBufferRef,
    streamTimerRef,
    pendingToolResultsRef
  } = useWebSocketMessages({
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
    setEditingMessageIndex,
    originalInput,
    setOriginalInput,
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
    uploadImages,
    submitMessage,
    handleSubmit: handleMessageSubmit,
    getToolsSettings
  } = useMessageSubmit({
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
  });

  // Command execution via custom hook
  const {
    executeCommand,
    handleBuiltInCommand,
    handleCustomCommand,
    setHandleSubmitRef
  } = useCommandExecution({
    selectedProject,
    currentSessionId,
    provider,
    cursorModel,
    tokenBudget,
    setChatMessages,
    setSessionMessages,
    setInput,
    resetCommandMenu,
    onFileOpen,
    onShowSettings
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
    handleAutoScroll();
  }, [chatMessages.length, handleAutoScroll]);

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
            isLoading={isLoading}
            hasMoreMessages={hasMoreMessages}
            totalMessages={totalMessages}
            visibleMessageCount={visibleMessageCount}
            loadEarlierMessages={loadEarlierMessages}
            selectedSession={selectedSession}
            currentSessionId={currentSessionId}
            selectedProject={selectedProject}
            provider={provider}
            setProvider={setProvider}
            cursorModel={cursorModel}
            setCursorModel={setCursorModel}
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
          provider={provider}
          selectedProject={selectedProject}
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
          showThinking={showThinking}
          // Transcript
          handleTranscript={handleTranscript}
          // Textarea state
          isTextareaExpanded={isTextareaExpanded}
          setIsTextareaExpanded={setIsTextareaExpanded}
          cursorPosition={cursorPosition}
          setCursorPosition={setCursorPosition}
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
