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
// Note: useDropzone is now used internally by useImageUpload hook

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
  useMessageSubmit
} from './ChatInterface/hooks';

// Import components
import ImageAttachment from './ChatInterface/components/ImageAttachment';
import ImagePreviewModal from './ChatInterface/components/ImagePreviewModal';
import ToolResultModal from './ChatInterface/components/ToolResultModal';
import MessageList from './ChatInterface/components/MessageList';

import ClaudeStatus from './ClaudeStatus';
import TokenUsagePie from './TokenUsagePie';
import { MicButton } from './MicButton.jsx';
import CommandMenu from './CommandMenu';

// ChatInterface: Main chat component with Session Protection System integration
// 
// Session Protection System prevents automatic project updates from interrupting active conversations:
// - onSessionActive: Called when user sends message to mark session as protected
// - onSessionInactive: Called when conversation completes/aborts to re-enable updates
// - onReplaceTemporarySession: Called to replace temporary session ID with real WebSocket session ID
//
// This ensures uninterrupted chat experience by pausing sidebar refreshes during conversations.
function ChatInterface({ selectedProject, selectedSession, ws, sendMessage, messages, onFileOpen, onInputFocusChange, onSessionActive, onSessionInactive, onSessionProcessing, onSessionNotProcessing, onSessionCompleted, processingSessions, onReplaceTemporarySession, onNavigateToSession, onShowSettings, autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter, externalMessageUpdate, onToggleQuickSettings }) {
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    }
    return '';
  });
  const [chatMessages, setChatMessages] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      const saved = safeLocalStorage.getItem(`chat_messages_${selectedProject.name}`);
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(selectedSession?.id || null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  
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
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const inputContainerRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isLoadingSessionRef = useRef(false); // Track session loading to prevent multiple scrolls
  // Note: Streaming buffers and pending tool results are now managed by useWebSocketMessages hook
  // Note: commandQueryTimerRef is now provided by useSlashCommands hook
  const [debouncedInput, setDebouncedInput] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
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
  const [imagePreview, setImagePreview] = useState(null); // { url: string, filename: string }
  const [toolResultModal, setToolResultModal] = useState(null); // { message: object, toolName: string }
  const [canAbortSession, setCanAbortSession] = useState(false);
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  // Token budget management via custom hook
  const { tokenBudget, setTokenBudget, fetchUpdatedTokenUsage, resetTokenBudget } = useTokenBudget({
    selectedProject,
    selectedSession
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
  const [visibleMessageCount, setVisibleMessageCount] = useState(100);
  const [claudeStatus, setClaudeStatus] = useState(null);
  // Note: Provider/model state and permission mode are now managed by useProviderState hook

  // Scroll management via custom hook
  // Note: Must be called after scrollContainerRef, hasMoreMessages, selectedSession, selectedProject, loadSessionMessages are defined
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
    chatMessages,
    hasMoreMessages,
    selectedSession,
    selectedProject,
    loadSessionMessages,
    setSessionMessages
  });

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
  }, [selectedProject, updateCommandHistory, executeCommand, input]);

  // Memoized diff calculation to prevent recalculating on every render
  const createDiff = useMemo(() => createMemoizedDiff(100), []);

  // Note: loadSessionMessages, loadCursorSessionMessagesWithState, and convertedMessages
  // are now provided by useSessionMessages hook

  // Note: Token budgets are not saved to JSONL files, only sent via WebSocket
  // So we don't try to extract them from loaded sessionMessages

  // Note: scrollToBottom, isNearBottom, handleScroll, handleTouchStart, handleTouchMove, handleWheel
  // and related refs are now provided by useScrollManagement hook

  useEffect(() => {
    // Load session messages when session changes
    const loadMessages = async () => {
      if (selectedSession && selectedProject) {
        const provider = localStorage.getItem('selected-provider') || 'claude';

        // Mark that we're loading a session to prevent multiple scroll triggers
        isLoadingSessionRef.current = true;

        // Only reset state if the session ID actually changed (not initial load)
        const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSession.id;

        if (sessionChanged) {
          // Reset pagination state when switching sessions
          resetPagination();
          // Reset token budget when switching sessions
          // It will update when user sends a message and receives new budget from WebSocket
          resetTokenBudget();
          // Reset loading state when switching sessions (unless the new session is processing)
          // The restore effect will set it back to true if needed
          setIsLoading(false);

          // Check if the session is currently processing on the backend
          if (ws && sendMessage) {
            sendMessage({
              type: 'check-session-status',
              sessionId: selectedSession.id,
              provider
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
              provider
            });
          }
        }
        
        if (provider === 'cursor') {
          // For Cursor, set the session ID for resuming
          setCurrentSessionId(selectedSession.id);
          sessionStorage.setItem('cursorSessionId', selectedSession.id);
          
          // Only load messages from SQLite if this is NOT a system-initiated session change
          // For system-initiated changes, preserve existing messages
          if (!isSystemSessionChange) {
            // Load historical messages for Cursor session from SQLite
            const projectPath = selectedProject.fullPath || selectedProject.path;
            const converted = await loadCursorSessionMessagesWithState(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            // Reset the flag after handling system session change
            setIsSystemSessionChange(false);
          }
        } else {
          // For Claude, load messages normally with pagination
          setCurrentSessionId(selectedSession.id);
          
          // Only load messages from API if this is a user-initiated session change
          // For system-initiated changes, preserve existing messages and rely on WebSocket
          if (!isSystemSessionChange) {
            const messages = await loadSessionMessages(selectedProject.name, selectedSession.id, false);
            setSessionMessages(messages);
            // convertedMessages will be automatically updated via useMemo
            // Scroll will be handled by the main scroll useEffect after messages are rendered
          } else {
            // Reset the flag after handling system session change
            setIsSystemSessionChange(false);
          }
        }
      } else {
        // Only clear messages if this is NOT a system-initiated session change AND we're not loading
        // During system session changes or while loading, preserve the chat messages
        if (!isSystemSessionChange && !isLoading) {
          setChatMessages([]);
          setSessionMessages([]);
        }
        setCurrentSessionId(null);
        sessionStorage.removeItem('cursorSessionId');
        resetPagination();
      }

      // Mark loading as complete after messages are set
      // Use setTimeout to ensure state updates and DOM rendering are complete
      setTimeout(() => {
        isLoadingSessionRef.current = false;
      }, 250);
    };

    loadMessages();
  }, [selectedSession, selectedProject, loadCursorSessionMessagesWithState, scrollToBottom, isSystemSessionChange, resetPagination, loadSessionMessages]);

  // External Message Update Handler: Reload messages when external CLI modifies current session
  // This triggers when App.jsx detects a JSONL file change for the currently-viewed session
  // Only reloads if the session is NOT active (respecting Session Protection System)
  useEffect(() => {
    if (externalMessageUpdate > 0 && selectedSession && selectedProject) {
      const reloadExternalMessages = async () => {
        try {
          const provider = localStorage.getItem('selected-provider') || 'claude';

          if (provider === 'cursor') {
            // Reload Cursor messages from SQLite
            const projectPath = selectedProject.fullPath || selectedProject.path;
            const converted = await loadCursorSessionMessagesWithState(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            // Reload Claude messages from API/JSONL
            const messages = await loadSessionMessages(selectedProject.name, selectedSession.id, false);
            setSessionMessages(messages);
            // convertedMessages will be automatically updated via useMemo

            // Smart scroll behavior: only auto-scroll if user is near bottom
            if (isNearBottom && autoScrollToBottom) {
              setTimeout(() => scrollToBottom(), 200);
            }
            // If user scrolled up, preserve their position (they're reading history)
          }
        } catch (error) {
          console.error('Error reloading messages from external update:', error);
        }
      };

      reloadExternalMessages();
    }
  }, [externalMessageUpdate, selectedSession, selectedProject, loadCursorSessionMessagesWithState, loadSessionMessages, isNearBottom, autoScrollToBottom, scrollToBottom]);

  // Update chatMessages when convertedMessages changes
  useEffect(() => {
    if (sessionMessages.length > 0) {
      setChatMessages(convertedMessages);
      
      // Restore scroll position after loading more messages (maintain distance from bottom)
      if (pendingScrollRestoreRef.current && scrollContainerRef.current) {
        const { distanceFromBottom } = pendingScrollRestoreRef.current;
        // Use requestAnimationFrame to ensure DOM has updated
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const newScrollHeight = scrollContainerRef.current.scrollHeight;
            const clientHeight = scrollContainerRef.current.clientHeight;
            // Restore: scrollTop = scrollHeight - clientHeight - distanceFromBottom
            scrollContainerRef.current.scrollTop = newScrollHeight - clientHeight - distanceFromBottom;
          }
          pendingScrollRestoreRef.current = null;
        });
      }
    } else if (sessionMessages.length === 0 && convertedMessages.length === 0) {
      // Clear chatMessages when switching to an empty session
      // Only clear if we're not in a loading or system session change state
      if (!isLoadingSessionMessages && !isSystemSessionChange) {
        setChatMessages([]);
      }
    }
  }, [convertedMessages, sessionMessages, isLoadingSessionMessages, isSystemSessionChange]);

  // Notify parent when input focus changes
  useEffect(() => {
    if (onInputFocusChange) {
      onInputFocusChange(isInputFocused);
    }
  }, [isInputFocused, onInputFocusChange]);

  // Persist input draft to localStorage
  useEffect(() => {
    if (selectedProject && input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProject.name}`, input);
    } else if (selectedProject && input === '') {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, selectedProject]);

  // Persist chat messages to localStorage
  useEffect(() => {
    if (selectedProject && chatMessages.length > 0) {
      safeLocalStorage.setItem(`chat_messages_${selectedProject.name}`, JSON.stringify(chatMessages));
    }
  }, [chatMessages, selectedProject]);

  // Load saved state when project changes (but don't interfere with session loading)
  useEffect(() => {
    if (selectedProject) {
      // Always load saved input draft for the project
      const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
      if (savedInput !== input) {
        setInput(savedInput);
      }
    }
  }, [selectedProject?.name]);

  // Track processing state: notify parent when isLoading becomes true
  // Note: onSessionNotProcessing is called directly in completion message handlers
  useEffect(() => {
    if (currentSessionId && isLoading && onSessionProcessing) {
      onSessionProcessing(currentSessionId);
    }
  }, [isLoading, currentSessionId, onSessionProcessing]);

  // Restore processing state when switching to a processing session
  useEffect(() => {
    if (currentSessionId && processingSessions) {
      const shouldBeProcessing = processingSessions.has(currentSessionId);
      if (shouldBeProcessing && !isLoading) {
        setIsLoading(true);
        setCanAbortSession(true); // Assume processing sessions can be aborted
      }
    }
  }, [currentSessionId, processingSessions]);

  // Note: WebSocket message handling is now managed by useWebSocketMessages hook

  // Load file list when project changes
  // Note: File fetching and @ symbol detection are now handled by useFileDropdown hook

  // Debounced input handling
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedInput(input);
    }, 150); // 150ms debounce
    
    return () => clearTimeout(timer);
  }, [input]);

  // Show only recent messages for better performance
  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) {
      return chatMessages;
    }
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  // Capture scroll position before render when auto-scroll is disabled
  useEffect(() => {
    captureScrollPosition();
  });

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    handleAutoScroll();
  }, [chatMessages.length, handleAutoScroll]);

  // Scroll to bottom when messages first load after session switch
  useEffect(() => {
    if (scrollContainerRef.current && chatMessages.length > 0 && !isLoadingSessionRef.current) {
      // Only scroll if we're not in the middle of loading a session
      // This prevents the "double scroll" effect during session switching
      // Reset scroll state when switching sessions
      setIsUserScrolledUp(false);
      setTimeout(() => {
        scrollToBottom();
        // After scrolling, the scroll event handler will naturally set isUserScrolledUp based on position
      }, 200); // Delay to ensure full rendering
    }
  }, [selectedSession?.id, selectedProject?.name]); // Only trigger when session/project changes

  // Note: Scroll event listeners (scroll, touchstart, touchmove, wheel) are now
  // set up internally by useScrollManagement hook

  // Initial textarea setup - set to 2 rows height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';

      // Check if initially expanded
      const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
      const isExpanded = textareaRef.current.scrollHeight > lineHeight * 2;
      setIsTextareaExpanded(isExpanded);
    }
  }, []); // Only run once on mount

  // Reset textarea height when input is cleared programmatically
  useEffect(() => {
    if (textareaRef.current && !input.trim()) {
      textareaRef.current.style.height = 'auto';
      setIsTextareaExpanded(false);
    }
  }, [input]);

  // Note: Token usage loading is now handled by useTokenBudget hook

  const handleTranscript = useCallback((text) => {
    if (text.trim()) {
      setInput(prevInput => {
        const newInput = prevInput.trim() ? `${prevInput} ${text}` : text;

        // Update textarea height after setting new content
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';

            // Check if expanded after transcript
            const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
            const isExpanded = textareaRef.current.scrollHeight > lineHeight * 2;
            setIsTextareaExpanded(isExpanded);
          }
        }, 0);

        return newInput;
      });
    }
  }, []);

  // Load earlier messages by increasing the visible message count
  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount(prevCount => prevCount + 100);
  }, []);

  // Note: handleImageFiles, handlePaste, and dropzone setup are now provided by useImageUpload hook
  // Note: handleEditMessage, handleDeleteMessage, handleCancelEdit are now provided by useMessageEditing hook

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
  }, [input, isLoading, selectedProject, editingMessageIndex, truncateForEdit, handleMessageSubmit, clearEditingState, textareaRef]);

  // Store handleSubmit in ref so handleCustomCommand can access it
  useEffect(() => {
    setHandleSubmitRef(handleSubmit);
  }, [handleSubmit, setHandleSubmitRef]);

  const selectCommand = (command) => {
    if (!command) return;

    // Prepare the input with command name and any arguments that were already typed
    const textBeforeSlash = input.slice(0, slashPosition);
    const textAfterSlash = input.slice(slashPosition);
    const spaceIndex = textAfterSlash.indexOf(' ');
    const textAfterQuery = spaceIndex !==-1 ? textAfterSlash.slice(spaceIndex) : '';

    const newInput = textBeforeSlash + command.name + ' ' + textAfterQuery;

    // Update input temporarily so executeCommand can parse arguments
    setInput(newInput);

    // Hide command menu and clear debounce timer
    closeCommandMenu();

    // Execute the command (which will load its content and send to Claude)
    executeCommand(command, newInput);
  };

  const handleKeyDown = (e) => {
    // Handle command menu navigation
    if (showCommandMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex(prev =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex(prev =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (selectedCommandIndex >= 0) {
          selectCommand(filteredCommands[selectedCommandIndex]);
        } else if (filteredCommands.length > 0) {
          selectCommand(filteredCommands[0]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandMenu();
        return;
      }
    }

    // Handle file dropdown navigation
    if (showFileDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedFileIndex(prev => 
          prev < filteredFiles.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedFileIndex(prev => 
          prev > 0 ? prev - 1 : filteredFiles.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (selectedFileIndex >= 0) {
          selectFile(filteredFiles[selectedFileIndex]);
        } else if (filteredFiles.length > 0) {
          selectFile(filteredFiles[0]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeFileDropdown();
        return;
      }
    }
    
    // Handle Tab key for mode switching (only when dropdowns are not showing)
    if (e.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
      e.preventDefault();
      cyclePermissionMode();
      return;
    }
    
    // Handle Enter key: Ctrl+Enter (Cmd+Enter on Mac) sends, Shift+Enter creates new line
    if (e.key === 'Enter') {
      // If we're in composition, don't send message
      if (e.nativeEvent.isComposing) {
        return; // Let IME handle the Enter key
      }
      
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        // Ctrl+Enter or Cmd+Enter: Send message
        e.preventDefault();
        handleSubmit(e);
      } else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Plain Enter: Send message only if not in IME composition
        if (!sendByCtrlEnter) {
          e.preventDefault();
          handleSubmit(e);
        }
      }
      // Shift+Enter: Allow default behavior (new line)
    }
  };

  // Note: selectFile function is now provided by useFileDropdown hook

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    // Auto-select Claude provider if no session exists and user starts typing
    if (!currentSessionId && newValue.trim() && provider === 'claude') {
      // Provider is already set to 'claude' by default, so no need to change it
      // The session will be created automatically when they submit
    }

    setInput(newValue);
    setCursorPosition(cursorPos);

    // Handle height reset when input becomes empty
    if (!newValue.trim()) {
      e.target.style.height = 'auto';
      setIsTextareaExpanded(false);
      closeCommandMenu();
      return;
    }

    // Detect slash command at cursor position (handled by hook)
    detectSlashCommand(newValue, cursorPos);
  };

  const handleTextareaClick = (e) => {
    setCursorPosition(e.target.selectionStart);
  };



  const handleAbortSession = () => {
    if (currentSessionId && canAbortSession) {
      sendMessage({
        type: 'abort-session',
        sessionId: currentSessionId,
        provider: provider
      });
    }
  };

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
      <div className={`p-2 sm:p-4 md:p-4 flex-shrink-0 ${
        isInputFocused ? 'pb-2 sm:pb-4 md:pb-6' : 'pb-2 sm:pb-4 md:pb-6'
      }`}>
    
        <div className="flex-1">
              <ClaudeStatus
                status={claudeStatus}
                isLoading={isLoading}
                onAbort={handleAbortSession}
                provider={provider}
                showThinking={showThinking}
              />
              </div>
        {/* Permission Mode Selector with scroll to bottom button - Above input, clickable for mobile */}
        <div ref={inputContainerRef} className="max-w-4xl mx-auto mb-3">
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={cyclePermissionMode}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200 ${
                permissionMode === 'default' 
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                  : permissionMode === 'acceptEdits'
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-300 dark:border-green-600 hover:bg-green-100 dark:hover:bg-green-900/30'
                  : permissionMode === 'bypassPermissions'
                  ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-600 hover:bg-orange-100 dark:hover:bg-orange-900/30'
                  : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30'
              }`}
              title="Click to change permission mode (or press Tab in input)"
            >
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  permissionMode === 'default' 
                    ? 'bg-gray-500'
                    : permissionMode === 'acceptEdits'
                    ? 'bg-green-500'
                    : permissionMode === 'bypassPermissions'
                    ? 'bg-orange-500'
                    : 'bg-blue-500'
                }`} />
                <span>
                  {permissionMode === 'default' && 'Default Mode'}
                  {permissionMode === 'acceptEdits' && 'Accept Edits'}
                  {permissionMode === 'bypassPermissions' && 'Bypass Permissions'}
                  {permissionMode === 'plan' && 'Plan Mode'}
                </span>
              </div>
            </button>
            {/* Token usage pie chart - positioned next to mode indicator */}
            <TokenUsagePie
              used={tokenBudget?.used || 0}
              total={tokenBudget?.total || parseInt(import.meta.env.VITE_CONTEXT_WINDOW) || 160000}
            />

            {/* Slash commands button */}
            <button
              type="button"
              onClick={() => {
                toggleCommandMenu();
                if (textareaRef.current) {
                  textareaRef.current.focus();
                }
              }}
              className="relative w-8 h-8 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
              title="Show all commands"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                />
              </svg>
              {/* Command count badge */}
              {slashCommands.length > 0 && (
                <span
                  className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center"
                  style={{ fontSize: '10px' }}
                >
                  {slashCommands.length}
                </span>
              )}
            </button>

            {/* Clear input button - positioned to the right of token pie, only shows when there's input */}
            {input.trim() && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setInput('');
                  if (textareaRef.current) {
                    textareaRef.current.style.height = 'auto';
                    textareaRef.current.focus();
                  }
                  setIsTextareaExpanded(false);
                }}
                className="w-8 h-8 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-full flex items-center justify-center transition-all duration-200 group shadow-sm"
                title="Clear input"
              >
                <svg
                  className="w-4 h-4 text-gray-600 dark:text-gray-300 group-hover:text-gray-800 dark:group-hover:text-gray-100 transition-colors"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}

            {/* Quick Settings button */}
            {onToggleQuickSettings && (
              <button
                type="button"
                onClick={onToggleQuickSettings}
                className="w-8 h-8 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Quick Settings"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}

            {/* Scroll to bottom button - positioned last */}
            {isUserScrolledUp && chatMessages.length > 0 && (
              <button
                onClick={scrollToBottom}
                className="w-8 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
                title="Scroll to bottom"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </button>
            )}
          </div>
        </div>
        
        <form onSubmit={handleSubmit} className="relative max-w-4xl mx-auto">
          {/* Drag overlay */}
          {isDragActive && (
            <div className="absolute inset-0 bg-blue-500/20 border-2 border-dashed border-blue-500 rounded-lg flex items-center justify-center z-50">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-lg">
                <svg className="w-8 h-8 text-blue-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm font-medium">Drop images here</p>
              </div>
            </div>
          )}
          
          {/* Image attachments preview */}
          {attachedImages.length > 0 && (
            <div className="mb-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex flex-wrap gap-2">
                {attachedImages.map((file, index) => (
                  <ImageAttachment
                    key={index}
                    file={file}
                    onRemove={() => removeImage(index)}
                    uploadProgress={uploadingImages.get(file.name)}
                    error={imageErrors.get(file.name)}
                  />
                ))}
              </div>
            </div>
          )}
          
          {/* File dropdown - positioned outside dropzone to avoid conflicts */}
          {showFileDropdown && filteredFiles.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50 backdrop-blur-sm">
              {filteredFiles.map((file, index) => (
                <div
                  key={file.path}
                  className={`px-4 py-3 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0 touch-manipulation ${
                    index === selectedFileIndex
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}
                  onMouseDown={(e) => {
                    // Prevent textarea from losing focus on mobile
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectFile(file);
                  }}
                >
                  <div className="font-medium text-sm">{file.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                    {file.path}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Command Menu */}
          <CommandMenu
            commands={filteredCommands}
            selectedIndex={selectedCommandIndex}
            onSelect={handleCommandSelect}
            onClose={() => {
              setShowCommandMenu(false);
              setSlashPosition(-1);
              setCommandQuery('');
              setSelectedCommandIndex(-1);
            }}
            position={{
              top: textareaRef.current
                ? Math.max(16, textareaRef.current.getBoundingClientRect().top - 316)
                : 0,
              left: textareaRef.current
                ? textareaRef.current.getBoundingClientRect().left
                : 16,
              bottom: textareaRef.current
                ? window.innerHeight - textareaRef.current.getBoundingClientRect().top + 8
                : 90
            }}
            isOpen={showCommandMenu}
            frequentCommands={commandQuery ? [] : frequentCommands}
          />

          {/* Editing message indicator */}
          {editingMessageIndex !== null && (
            <div className="mb-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span>正在编辑消息 - 发送后将删除此消息之后的所有内容</span>
              </div>
              <button
                onClick={handleCancelEdit}
                className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 font-medium text-sm transition-colors"
              >
                取消
              </button>
            </div>
          )}

          <div className={`relative bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-500 focus-within:border-blue-500 transition-all duration-200 overflow-hidden ${isTextareaExpanded ? 'chat-input-expanded' : ''}`}>
            <input {...getInputProps()} />
            {/* Dropzone area - wrapped in a separate div to avoid interfering with buttons */}
            <div {...getRootProps()} className="absolute inset-0 pointer-events-none">
              <div className="pointer-events-auto absolute inset-0" style={{ left: '48px', right: '64px' }}></div>
            </div>
            
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onClick={handleTextareaClick}
              onKeyDown={handleKeyDown}
              onPaste={handleImagePaste}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              onInput={(e) => {
                // Immediate resize on input for better UX
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
                setCursorPosition(e.target.selectionStart);

                // Check if textarea is expanded (more than 2 lines worth of height)
                const lineHeight = parseInt(window.getComputedStyle(e.target).lineHeight);
                const isExpanded = e.target.scrollHeight > lineHeight * 2;
                setIsTextareaExpanded(isExpanded);
              }}
              placeholder={`输入 / 执行命令、@ 选择文件,或向 ${provider === 'cursor' ? 'Cursor' : provider === 'codebuddy' ? 'CodeBuddy' : 'Claude'} 提问...`}
              disabled={isLoading}
              className="chat-input-placeholder block w-full pl-12 pr-20 sm:pr-40 py-1.5 sm:py-4 bg-transparent rounded-2xl focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50 resize-none min-h-[50px] sm:min-h-[80px] max-h-[40vh] sm:max-h-[300px] overflow-y-auto text-sm sm:text-base leading-[21px] sm:leading-6 transition-all duration-200 relative z-10"
              style={{ height: '50px' }}
            />
            {/* Image upload button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openFilePicker();
              }}
              className="absolute left-2 top-1/2 transform -translate-y-1/2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors z-20"
              title="Attach images"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
            
            {/* Mic button - HIDDEN */}
            <div className="absolute right-16 sm:right-16 top-1/2 transform -translate-y-1/2 z-20" style={{ display: 'none' }}>
              <MicButton
                onTranscript={handleTranscript}
                className="w-10 h-10 sm:w-10 sm:h-10"
              />
            </div>

            {/* Send button with explicit click handler to prevent dropzone interference */}
            <button
              type="button"
              onClick={(e) => {
                console.log('[Send Button] Click detected', { 
                  hasInput: !!input.trim(), 
                  isLoading, 
                  inputLength: input.length,
                  disabled: !input.trim() || isLoading 
                });
                e.preventDefault();
                e.stopPropagation();
                
                // Check if button should be disabled
                if (!input.trim() || isLoading) {
                  console.warn('[Send Button] Click ignored - button is disabled');
                  return;
                }
                
                // Manually trigger form submit
                const fakeEvent = { preventDefault: () => {} };
                handleSubmit(fakeEvent);
              }}
              onTouchStart={(e) => {
                // Prevent touch delay and ensure immediate response on mobile
                console.log('[Send Button] Touch start');
                e.stopPropagation();
              }}
              onTouchEnd={(e) => {
                console.log('[Send Button] Touch end', { 
                  hasInput: !!input.trim(), 
                  isLoading 
                });
                e.preventDefault();
                e.stopPropagation();
                
                // Check if button should be disabled
                if (!input.trim() || isLoading) {
                  console.warn('[Send Button] Touch ignored - button is disabled');
                  return;
                }
                
                // Manually trigger form submit on touch
                const fakeEvent = { preventDefault: () => {} };
                handleSubmit(fakeEvent);
              }}
              disabled={!input.trim() || isLoading}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 w-12 h-12 sm:w-12 sm:h-12 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800 z-20"
              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
            >
              <svg 
                className="w-4 h-4 sm:w-5 sm:h-5 text-white transform rotate-90" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" 
                />
              </svg>
            </button>

            {/* Hint text inside input box at bottom - Desktop only */}
            <div className={`absolute bottom-1 left-12 right-14 sm:right-40 text-xs text-gray-400 dark:text-gray-500 pointer-events-none hidden sm:block transition-opacity duration-200 ${
              input.trim() ? 'opacity-0' : 'opacity-100'
            }`}>
              {sendByCtrlEnter
                ? "Ctrl+Enter 发送 • Shift+Enter 换行 • Tab 切换模式 • / 斜杠命令"
                : "Enter 发送 • Shift+Enter 换行 • Tab 切换模式 • / 斜杠命令"}
            </div>
          </div>
        </form>
      </div>

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
