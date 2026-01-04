import { useEffect, useRef, useCallback } from 'react';
import { decodeHtmlEntities, formatUsageLimitText, hasImageContent } from '../utils';

/**
 * Custom hook for handling WebSocket messages in ChatInterface
 * Processes unified session-* message types from all providers (Claude, Cursor, CodeBuddy)
 */
export function useWebSocketMessages({
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
}) {
  // Streaming throttle buffers
  const streamBufferRef = useRef('');
  const streamTimerRef = useRef(null);
  // Pending tool results queue (for handling race conditions)
  const pendingToolResultsRef = useRef(new Map());
  // Track processed message count to avoid re-processing on effect re-runs
  const processedMessageCountRef = useRef(0);
  // Track last processed messages array length to detect resets
  const lastMessagesLengthRef = useRef(0);
  // Track current session to detect session changes
  const lastSessionIdRef = useRef(currentSessionId);

  // Reset message processing state when session changes
  useEffect(() => {
    if (lastSessionIdRef.current !== currentSessionId) {
      lastSessionIdRef.current = currentSessionId;
      processedMessageCountRef.current = 0;
      lastMessagesLengthRef.current = 0;
      streamBufferRef.current = '';
      if (streamTimerRef.current) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      pendingToolResultsRef.current.clear();
    }
  }, [currentSessionId]);

  // Helper to flush stream buffer
  const flushStreamBuffer = useCallback((finalizeStreaming = false) => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    const chunk = streamBufferRef.current;
    streamBufferRef.current = '';
    
    if (chunk) {
      setChatMessages(prev => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;
        const last = updated[lastIndex];
        if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
          // Create new object instead of mutating
          updated[lastIndex] = {
            ...last,
            content: (last.content || '') + chunk,
            isStreaming: !finalizeStreaming
          };
        } else {
          updated.push({ 
            type: 'assistant', 
            content: chunk, 
            timestamp: new Date(), 
            isStreaming: !finalizeStreaming 
          });
        }
        return updated;
      });
    } else if (finalizeStreaming) {
      setChatMessages(prev => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;
        const last = updated[lastIndex];
        if (last && last.type === 'assistant' && last.isStreaming) {
          // Create new object instead of mutating
          updated[lastIndex] = {
            ...last,
            isStreaming: false
          };
        }
        return updated;
      });
    }
  }, [setChatMessages]);

  // Helper to buffer streaming content
  const bufferStreamContent = useCallback((content, appendNewline = false) => {
    const formattedContent = appendNewline && streamBufferRef.current 
      ? `\n${content}` 
      : content;
    streamBufferRef.current += formattedContent;
    
    if (!streamTimerRef.current) {
      streamTimerRef.current = setTimeout(() => {
        const chunk = streamBufferRef.current;
        streamBufferRef.current = '';
        streamTimerRef.current = null;
        if (!chunk) return;
        
        setChatMessages(prev => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          const last = updated[lastIndex];
          if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
            // Create new object instead of mutating
            updated[lastIndex] = {
              ...last,
              content: last.content ? `${last.content}\n${chunk}` : chunk
            };
          } else {
            updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
          }
          return updated;
        });
      }, 100);
    }
  }, [setChatMessages]);

  // Handle session created
  const handleSessionCreated = useCallback((latestMessage) => {
    if (latestMessage.sessionId && !currentSessionId) {
      sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);
      
      // Mark as system session change to prevent message reload when selectedSession updates
      setIsSystemSessionChange(true);
      
      if (onReplaceTemporarySession) {
        onReplaceTemporarySession(latestMessage.sessionId);
      }
    }
  }, [currentSessionId, onReplaceTemporarySession, setIsSystemSessionChange]);

  // Handle session resume failed
  const handleSessionResumeFailed = useCallback((latestMessage) => {
    console.warn('⚠️ Session resume failed:', {
      requested: latestMessage.requestedSessionId,
      created: latestMessage.newSessionId,
      message: latestMessage.message
    });
    
    setChatMessages(prev => [...prev, {
      type: 'system',
      content: `注意: 无法恢复之前的会话，已创建新会话。${latestMessage.message || ''}`,
      isWarning: true,
      timestamp: new Date()
    }]);
    
    if (latestMessage.newSessionId) {
      sessionStorage.setItem('pendingSessionId', latestMessage.newSessionId);
      if (onReplaceTemporarySession) {
        onReplaceTemporarySession(latestMessage.newSessionId);
      }
    }
  }, [setChatMessages, onReplaceTemporarySession]);

  // Handle content block start (tool use)
  const handleContentBlockStart = useCallback((contentBlock) => {
    if (contentBlock.type === 'tool_use') {
      const toolId = contentBlock.id;
      const pendingResult = pendingToolResultsRef.current.get(toolId);
      
      const toolInput = contentBlock.input ? JSON.stringify(contentBlock.input, null, 2) : '';
      setChatMessages(prev => [...prev, {
        type: 'assistant',
        content: '',
        timestamp: new Date(),
        isToolUse: true,
        toolName: contentBlock.name,
        toolInput: toolInput,
        toolId: toolId,
        toolResult: pendingResult || null
      }]);
      
      if (pendingResult) {
        pendingToolResultsRef.current.delete(toolId);
      }
      return true;
    }
    return false;
  }, [setChatMessages]);

  // Handle tool result
  const handleToolResult = useCallback((messageData) => {
    let resultContent = messageData.content;
    
    if (Array.isArray(resultContent) && !hasImageContent(resultContent)) {
      resultContent = resultContent
        .map(item => item.text || (typeof item === 'string' ? item : JSON.stringify(item)))
        .join('\n');
    } else if (typeof resultContent === 'object' && resultContent !== null && !hasImageContent(resultContent)) {
      resultContent = JSON.stringify(resultContent, null, 2);
    }
    
    const toolUseId = messageData.tool_use_id;
    const toolResultData = {
      toolUseResult: {
        content: resultContent,
        isError: messageData.is_error
      },
      timestamp: new Date()
    };
    
    pendingToolResultsRef.current.set(toolUseId, toolResultData);
    
    setChatMessages(prev => {
      const toolUseIndex = prev.findIndex(msg => msg.isToolUse && msg.toolId === toolUseId);
      if (toolUseIndex !== -1) {
        pendingToolResultsRef.current.delete(toolUseId);
        const updated = [...prev];
        updated[toolUseIndex] = {
          ...updated[toolUseIndex],
          toolResult: toolResultData
        };
        return updated;
      }
      return prev;
    });
  }, [setChatMessages]);

  // Handle content block delta
  const handleContentBlockDelta = useCallback((delta) => {
    const decodedText = decodeHtmlEntities(delta.text);
    streamBufferRef.current += decodedText;
    if (!streamTimerRef.current) {
      streamTimerRef.current = setTimeout(() => {
        const chunk = streamBufferRef.current;
        streamBufferRef.current = '';
        streamTimerRef.current = null;
        if (!chunk) return;
        setChatMessages(prev => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          const last = updated[lastIndex];
          if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
            // Create new object instead of mutating
            updated[lastIndex] = {
              ...last,
              content: (last.content || '') + chunk
            };
          } else {
            updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
          }
          return updated;
        });
      }, 100);
    }
  }, [setChatMessages]);

  // Handle session duplication detection
  const handleSessionDuplication = useCallback((sessionId) => {
    setIsSystemSessionChange(true);
    if (onNavigateToSession) {
      onNavigateToSession(sessionId);
    }
  }, [setIsSystemSessionChange, onNavigateToSession]);

  // Handle new session init
  const handleNewSessionInit = useCallback((sessionId) => {
    setIsSystemSessionChange(true);
    if (onNavigateToSession) {
      onNavigateToSession(sessionId);
    }
  }, [setIsSystemSessionChange, onNavigateToSession]);

  // Main message handler effect
  useEffect(() => {
    if (messages.length === 0) return;
    
    // Detect if messages array was reset (e.g., new conversation started)
    // If current length is less than what we've processed, reset the counter
    if (messages.length < lastMessagesLengthRef.current) {
      processedMessageCountRef.current = 0;
    }
    lastMessagesLengthRef.current = messages.length;
    
    // Skip if we've already processed this message count
    // This prevents re-processing when effect re-runs due to dependency changes
    if (messages.length <= processedMessageCountRef.current) {
      return;
    }
    
    const latestMessage = messages[messages.length - 1];
    
    // Update processed count BEFORE processing to prevent duplicate handling
    processedMessageCountRef.current = messages.length;

    // Filter messages by session ID to prevent cross-session interference
    // Include system init messages that may set up new sessions
    // Also include session-aborted and session-error as they should always update UI
    const globalMessageTypes = ['projects_updated', 'session-created', 'session-complete', 'session-status', 'session-aborted', 'session-error'];
    const isGlobalMessage = globalMessageTypes.includes(latestMessage.type);

    if (!isGlobalMessage && latestMessage.sessionId && currentSessionId && latestMessage.sessionId !== currentSessionId) {
      return;
    }

    switch (latestMessage.type) {
      case 'session-created':
        handleSessionCreated(latestMessage);
        break;

      case 'session-resume-failed':
        handleSessionResumeFailed(latestMessage);
        break;

      case 'token-budget':
        // Token budget now fetched via API after message completion
        break;

      case 'session-response': {
        const messageData = latestMessage.data.message || latestMessage.data;
        
        // Handle Cursor/CodeBuddy streaming format
        if (messageData && typeof messageData === 'object' && messageData.type) {
          if (messageData.type === 'content_block_start' && messageData.content_block) {
            if (handleContentBlockStart(messageData.content_block)) return;
          }
          
          if (messageData.type === 'tool_result') {
            handleToolResult(messageData);
            return;
          }
          
          if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
            handleContentBlockDelta(messageData.delta);
            return;
          }
          
          if (messageData.type === 'content_block_stop') {
            flushStreamBuffer(true);
            return;
          }
          
          if (messageData.type === 'message_stop') {
            flushStreamBuffer(true);
            setIsLoading(false);
            setCanAbortSession(false);
            return;
          }
        }

        // Handle Claude CLI session duplication
        if (latestMessage.data.type === 'system' && 
            latestMessage.data.subtype === 'init' && 
            latestMessage.data.session_id) {
          
          if (currentSessionId && latestMessage.data.session_id !== currentSessionId) {
            handleSessionDuplication(latestMessage.data.session_id);
            return;
          }
          
          if (!currentSessionId) {
            handleNewSessionInit(latestMessage.data.session_id);
            return;
          }
          
          if (latestMessage.data.session_id === currentSessionId) {
            return;
          }
        }
        
        // Handle different types of content in the response
        if (Array.isArray(messageData.content)) {
          for (const part of messageData.content) {
            if (part.type === 'tool_use') {
              const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';
              setChatMessages(prev => [...prev, {
                type: 'assistant',
                content: '',
                timestamp: new Date(),
                isToolUse: true,
                toolName: part.name,
                toolInput: toolInput,
                toolId: part.id,
                toolResult: null
              }]);
            } else if (part.type === 'text' && part.text?.trim()) {
              let content = decodeHtmlEntities(part.text);
              content = formatUsageLimitText(content);
              setChatMessages(prev => [...prev, {
                type: 'assistant',
                content: content,
                timestamp: new Date()
              }]);
            }
          }
        } else if (typeof messageData.content === 'string' && messageData.content.trim()) {
          let content = decodeHtmlEntities(messageData.content);
          content = formatUsageLimitText(content);
          setChatMessages(prev => [...prev, {
            type: 'assistant',
            content: content,
            timestamp: new Date()
          }]);
        }
        
        // Handle tool results from user messages
        if (messageData.role === 'user' && Array.isArray(messageData.content)) {
          for (const part of messageData.content) {
            if (part.type === 'tool_result') {
              setChatMessages(prev => prev.map(msg => {
                if (msg.isToolUse && msg.toolId === part.tool_use_id) {
                  return {
                    ...msg,
                    toolResult: {
                      content: part.content,
                      isError: part.is_error,
                      timestamp: new Date()
                    }
                  };
                }
                return msg;
              }));
            }
          }
        }
        break;
      }
        
      case 'session-output': {
        const cleaned = String(latestMessage.data || '');
        if (cleaned.trim()) {
          bufferStreamContent(cleaned, true);
        }
        break;
      }
      
      case 'session-prompt':
        setChatMessages(prev => [...prev, {
          type: 'assistant',
          content: latestMessage.data,
          timestamp: new Date(),
          isInteractivePrompt: true
        }]);
        break;

      // 统一处理所有 provider 的错误消息
      case 'session-error': {
        // Stop loading state on error
        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        
        const errorMessage = latestMessage.error || 'Unknown error';
        const errorDetails = latestMessage.details;
        const errorType = latestMessage.errorType;
        
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: `Error: ${errorMessage}`,
          errorType: errorType,
          errorDetails: errorDetails,
          timestamp: new Date()
        }]);
        
        // Mark session as inactive on error
        const errorSessionId = latestMessage.sessionId || currentSessionId;
        if (errorSessionId) {
          if (onSessionInactive) {
            onSessionInactive(errorSessionId);
          }
          if (onSessionNotProcessing) {
            onSessionNotProcessing(errorSessionId);
          }
        }
        
        if (errorDetails) {
          console.error('Error details:', { type: errorType, details: errorDetails });
        }
        break;
      }
        
      // 统一处理所有 provider 的完成消息
      case 'session-complete': {
        const completedSessionId = latestMessage.sessionId || currentSessionId || sessionStorage.getItem('pendingSessionId');
        const providerName = latestMessage.provider || 'claude';
        
        // 处理当前会话的 UI 状态 - 放宽条件，确保状态能被更新
        // 当 completedSessionId 匹配当前会话，或者没有当前会话时，或者 pendingSessionId 匹配时都更新
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        const shouldUpdateUI = completedSessionId === currentSessionId || 
                               !currentSessionId || 
                               completedSessionId === pendingSessionId;
        
        if (shouldUpdateUI) {
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);
          fetchUpdatedTokenUsage();
          
          // Apply pending tool results before cleanup
          if (pendingToolResultsRef.current.size > 0) {
            const pendingResults = new Map(pendingToolResultsRef.current);
            setChatMessages(prev => {
              const updated = [...prev];
              pendingResults.forEach((toolResultData, toolUseId) => {
                const toolUseIndex = updated.findIndex(msg => msg.isToolUse && msg.toolId === toolUseId);
                if (toolUseIndex !== -1 && !updated[toolUseIndex].toolResult) {
                  updated[toolUseIndex] = {
                    ...updated[toolUseIndex],
                    toolResult: toolResultData
                  };
                }
              });
              return updated;
            });
            pendingToolResultsRef.current.clear();
          }
          
          // Flush any remaining stream buffer
          if (streamBufferRef.current) {
            const finalChunk = streamBufferRef.current;
            streamBufferRef.current = '';
            if (finalChunk.trim()) {
              setChatMessages(prev => {
                const updated = [...prev];
                const lastIndex = updated.length - 1;
                const last = updated[lastIndex];
                if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                  // Create new object instead of mutating
                  updated[lastIndex] = {
                    ...last,
                    content: (last.content || '') + finalChunk,
                    isStreaming: false
                  };
                } else {
                  updated.push({ type: 'assistant', content: finalChunk, timestamp: new Date(), isStreaming: false });
                }
                return updated;
              });
            }
          }
          
          // Force finalize any streaming messages even if buffer is empty
          setChatMessages(prev => {
            const hasStreamingMessage = prev.some(msg => msg.isStreaming);
            if (!hasStreamingMessage) return prev;
            
            return prev.map(msg => 
              msg.isStreaming ? { ...msg, isStreaming: false } : msg
            );
          });
        }

        // 标记会话完成
        if (completedSessionId) {
          if (onSessionCompleted) {
            onSessionCompleted(completedSessionId, providerName);
          }
          if (onSessionInactive) {
            onSessionInactive(completedSessionId);
          }
          if (onSessionNotProcessing) {
            onSessionNotProcessing(completedSessionId);
          }
        }
        
        // Handle new session navigation (pendingSessionId already declared above)
        if (latestMessage.isNewSession && completedSessionId && !currentSessionId) {
          if (completedSessionId === pendingSessionId) {
            setCurrentSessionId(completedSessionId);
            sessionStorage.removeItem('pendingSessionId');
            setIsSystemSessionChange(true);
            
            if (onNavigateToSession) {
              onNavigateToSession(completedSessionId);
            }
          }
        } else if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
          setCurrentSessionId(pendingSessionId);
          sessionStorage.removeItem('pendingSessionId');
          setIsSystemSessionChange(true);
          
          if (onNavigateToSession) {
            onNavigateToSession(pendingSessionId);
          }
        }
        break;
      }
        
      case 'session-aborted': {
        const abortedSessionId = latestMessage.sessionId || currentSessionId;
        const abortPendingSessionId = sessionStorage.getItem('pendingSessionId');
        
        // 放宽条件：当前会话、没有会话、或 pending 会话匹配时都更新 UI
        const shouldUpdateAbortUI = abortedSessionId === currentSessionId || 
                                    !currentSessionId ||
                                    abortedSessionId === abortPendingSessionId;

        if (shouldUpdateAbortUI) {
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);
        }

        if (abortedSessionId) {
          if (onSessionInactive) {
            onSessionInactive(abortedSessionId);
          }
          if (onSessionNotProcessing) {
            onSessionNotProcessing(abortedSessionId);
          }
        }

        setChatMessages(prev => [...prev, {
          type: 'assistant',
          content: 'Session interrupted by user.',
          timestamp: new Date()
        }]);
        break;
      }

      case 'session-status': {
        const statusSessionId = latestMessage.sessionId;
        const statusPendingSessionId = sessionStorage.getItem('pendingSessionId');
        // 放宽条件：匹配当前会话、选中会话、或 pending 会话
        const isCurrentSession = statusSessionId === currentSessionId ||
                                 (selectedSession && statusSessionId === selectedSession.id) ||
                                 statusSessionId === statusPendingSessionId ||
                                 !currentSessionId;
        if (isCurrentSession) {
          if (latestMessage.isProcessing) {
            setIsLoading(true);
            setCanAbortSession(true);
            if (onSessionProcessing) {
              onSessionProcessing(statusSessionId);
            }
          } else {
            // Session is not processing - update UI state
            setIsLoading(false);
            setCanAbortSession(false);
            setClaudeStatus(null);
            if (onSessionNotProcessing) {
              onSessionNotProcessing(statusSessionId);
            }
          }
        }
        break;
      }

      case 'assistant-status': {
        const statusData = latestMessage.data;
        if (statusData) {
          let statusInfo = {
            text: 'Working...',
            tokens: 0,
            can_interrupt: true
          };
          
          if (statusData.message) {
            statusInfo.text = statusData.message;
          } else if (statusData.status) {
            statusInfo.text = statusData.status;
          } else if (typeof statusData === 'string') {
            statusInfo.text = statusData;
          }
          
          if (statusData.tokens) {
            statusInfo.tokens = statusData.tokens;
          } else if (statusData.token_count) {
            statusInfo.tokens = statusData.token_count;
          }
          
          if (statusData.can_interrupt !== undefined) {
            statusInfo.can_interrupt = statusData.can_interrupt;
          }
          
          setClaudeStatus(statusInfo);
          setIsLoading(true);
          setCanAbortSession(statusInfo.can_interrupt);
        }
        break;
      }

      case 'project-tasks': {
        // Received list of tasks for a specific project
        // Check if any task is running for the current session
        const tasks = latestMessage.tasks || [];
        const currentTask = tasks.find(t => t.sessionId === currentSessionId);
        if (currentTask) {
          setIsLoading(true);
          setCanAbortSession(true);
        }
        break;
      }
    }
  }, [messages, currentSessionId, selectedSession, setChatMessages, setIsLoading, setCanAbortSession, setClaudeStatus, setCurrentSessionId, setIsSystemSessionChange, fetchUpdatedTokenUsage, onSessionInactive, onSessionProcessing, onSessionNotProcessing, onSessionCompleted, onReplaceTemporarySession, onNavigateToSession, handleSessionCreated, handleSessionResumeFailed, handleContentBlockStart, handleToolResult, handleContentBlockDelta, flushStreamBuffer, bufferStreamContent, handleSessionDuplication, handleNewSessionInit]);

  return {
    streamBufferRef,
    streamTimerRef,
    pendingToolResultsRef
  };
}
