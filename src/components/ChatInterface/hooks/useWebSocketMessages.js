import { useEffect, useRef, useCallback } from 'react';
import { decodeHtmlEntities, formatUsageLimitText, hasImageContent, safeLocalStorage } from '../utils';

/**
 * Custom hook for handling WebSocket messages in ChatInterface
 * Processes various message types from Claude, Cursor, and CodeBuddy providers
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
        const last = updated[updated.length - 1];
        if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
          last.content = (last.content || '') + chunk;
          if (finalizeStreaming) {
            last.isStreaming = false;
          }
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
        const last = updated[updated.length - 1];
        if (last && last.type === 'assistant' && last.isStreaming) {
          last.isStreaming = false;
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
          const last = updated[updated.length - 1];
          if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
            last.content = last.content ? `${last.content}\n${chunk}` : chunk;
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
      
      if (onReplaceTemporarySession) {
        onReplaceTemporarySession(latestMessage.sessionId);
      }
    }
  }, [currentSessionId, onReplaceTemporarySession]);

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
          const last = updated[updated.length - 1];
          if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
            last.content = (last.content || '') + chunk;
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

  // Handle session completion (common logic for all providers)
  const handleSessionCompletion = useCallback((completedSessionId, providerName, latestMessage, isResult = false) => {
    // Update UI state if this is the current session
    if (completedSessionId === currentSessionId || !currentSessionId) {
      setIsLoading(false);
      setCanAbortSession(false);
      setClaudeStatus(null);
      
      // Fetch updated token usage after message completes
      if (!isResult || providerName === 'claude') {
        fetchUpdatedTokenUsage();
      }
    }

    // Always mark the completed session as inactive and not processing
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
  }, [currentSessionId, setIsLoading, setCanAbortSession, setClaudeStatus, fetchUpdatedTokenUsage, onSessionCompleted, onSessionInactive, onSessionNotProcessing]);

  // Handle new session navigation
  const handleNewSessionNavigation = useCallback((sessionId) => {
    const pendingSessionId = sessionStorage.getItem('pendingSessionId');
    if (sessionId && !currentSessionId && sessionId === pendingSessionId) {
      setCurrentSessionId(sessionId);
      sessionStorage.removeItem('pendingSessionId');
      setIsSystemSessionChange(true);
      
      if (onNavigateToSession) {
        onNavigateToSession(sessionId);
      }
      return true;
    }
    return false;
  }, [currentSessionId, setCurrentSessionId, setIsSystemSessionChange, onNavigateToSession]);

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
    const globalMessageTypes = ['projects_updated', 'session-created', 'claude-complete', 'codebuddy-system', 'cursor-system'];
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

      case 'claude-response': {
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
        
      case 'claude-output': {
        const cleaned = String(latestMessage.data || '');
        if (cleaned.trim()) {
          bufferStreamContent(cleaned, true);
        }
        break;
      }
      
      case 'claude-interactive-prompt':
        setChatMessages(prev => [...prev, {
          type: 'assistant',
          content: latestMessage.data,
          timestamp: new Date(),
          isInteractivePrompt: true
        }]);
        break;

      case 'claude-error':
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: `Error: ${latestMessage.error}`,
          timestamp: new Date()
        }]);
        break;
        
      case 'cursor-system': {
        try {
          const cdata = latestMessage.data;
          if (cdata && cdata.type === 'system' && cdata.subtype === 'init' && cdata.session_id) {
            if (currentSessionId && cdata.session_id !== currentSessionId) {
              handleSessionDuplication(cdata.session_id);
              return;
            }
            if (!currentSessionId) {
              handleNewSessionInit(cdata.session_id);
              return;
            }
          }
        } catch (e) {
          // Silently ignore cursor-system errors
        }
        break;
      }
        
      case 'cursor-user':
        // Don't add user messages as they're already shown from input
        break;
        
      case 'cursor-tool-use':
        setChatMessages(prev => [...prev, {
          type: 'assistant',
          content: `Using tool: ${latestMessage.tool} ${latestMessage.input ? `with ${latestMessage.input}` : ''}`,
          timestamp: new Date(),
          isToolUse: true,
          toolName: latestMessage.tool,
          toolInput: latestMessage.input
        }]);
        break;
      
      case 'cursor-error':
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: `Cursor error: ${latestMessage.error || 'Unknown error'}`,
          timestamp: new Date()
        }]);
        break;
        
      case 'cursor-result': {
        const cursorCompletedSessionId = latestMessage.sessionId || currentSessionId;
        handleSessionCompletion(cursorCompletedSessionId, 'cursor', latestMessage, true);

        if (cursorCompletedSessionId === currentSessionId) {
          try {
            const r = latestMessage.data || {};
            const textResult = typeof r.result === 'string' ? r.result : '';
            flushStreamBuffer(false);
            const pendingChunk = streamBufferRef.current;
            streamBufferRef.current = '';

            setChatMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                const finalContent = textResult && textResult.trim() ? textResult : (last.content || '') + (pendingChunk || '');
                last.content = finalContent;
                last.isStreaming = false;
              } else if (textResult && textResult.trim()) {
                updated.push({ type: r.is_error ? 'error' : 'assistant', content: textResult, timestamp: new Date(), isStreaming: false });
              }
              return updated;
            });
          } catch (e) {
            // Silently ignore cursor-result errors
          }
        }

        handleNewSessionNavigation(cursorCompletedSessionId);
        break;
      }

      case 'cursor-output': {
        try {
          const raw = String(latestMessage.data ?? '');
          const cleaned = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
          if (cleaned) {
            bufferStreamContent(cleaned, true);
          }
        } catch (e) {
          // Silently ignore cursor-output errors
        }
        break;
      }
        
      case 'codebuddy-system': {
        try {
          const cbdata = latestMessage.data;
          if (cbdata && cbdata.type === 'system' && cbdata.subtype === 'init' && cbdata.session_id) {
            if (currentSessionId && cbdata.session_id !== currentSessionId) {
              handleSessionDuplication(cbdata.session_id);
              return;
            }
            if (!currentSessionId) {
              handleNewSessionInit(cbdata.session_id);
              return;
            }
            if (cbdata.session_id === currentSessionId) {
              return;
            }
          }
        } catch (e) {
          // Silently ignore codebuddy-system errors
        }
        break;
      }

      case 'codebuddy-user':
        break;

      case 'codebuddy-error': {
        const errorMessage = latestMessage.userMessage || latestMessage.error || 'Unknown error';
        const errorDetails = latestMessage.details?.raw || latestMessage.error;
        const errorType = latestMessage.errorType || 'unknown';
        
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: `CodeBuddy error: ${errorMessage}`,
          errorType: errorType,
          errorDetails: errorDetails !== errorMessage ? errorDetails : null,
          timestamp: new Date()
        }]);
        
        if (errorDetails) {
          console.error('CodeBuddy error details:', { type: errorType, details: errorDetails });
        }
        break;
      }
        
      case 'codebuddy-result': {
        const codebuddyCompletedSessionId = latestMessage.sessionId || currentSessionId;

        if (codebuddyCompletedSessionId === currentSessionId) {
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);
        }

        if (codebuddyCompletedSessionId) {
          if (onSessionInactive) {
            onSessionInactive(codebuddyCompletedSessionId);
          }
          if (onSessionNotProcessing) {
            onSessionNotProcessing(codebuddyCompletedSessionId);
          }
        }

        if (codebuddyCompletedSessionId === currentSessionId) {
          try {
            const r = latestMessage.data || {};
            const textResult = typeof r.result === 'string' ? r.result : '';
            flushStreamBuffer(false);
            const pendingChunk = streamBufferRef.current;
            streamBufferRef.current = '';

            setChatMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                const finalContent = textResult && textResult.trim() ? textResult : (last.content || '') + (pendingChunk || '');
                last.content = finalContent;
                last.isStreaming = false;
              } else if (textResult && textResult.trim()) {
                updated.push({ type: r.is_error ? 'error' : 'assistant', content: textResult, timestamp: new Date(), isStreaming: false });
              }
              return updated;
            });
          } catch (e) {
            // Silently ignore codebuddy-result errors
          }
        }

        handleNewSessionNavigation(codebuddyCompletedSessionId);
        break;
      }

      case 'codebuddy-output': {
        try {
          const cbraw = String(latestMessage.data ?? '');
          const cbcleaned = cbraw
            .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            .trim();
          if (cbcleaned) {
            bufferStreamContent(cbcleaned, true);
          }
        } catch (e) {
          // Silently ignore codebuddy-output errors
        }
        break;
      }

      case 'codebuddy-complete': {
        const cbCompletedSessionId = latestMessage.sessionId || currentSessionId;

        if (cbCompletedSessionId === currentSessionId || !currentSessionId) {
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
                const last = updated[updated.length - 1];
                if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                  last.content = (last.content || '') + finalChunk;
                  last.isStreaming = false;
                } else {
                  updated.push({ type: 'assistant', content: finalChunk, timestamp: new Date(), isStreaming: false });
                }
                return updated;
              });
            }
          }
        }

        if (cbCompletedSessionId) {
          if (onSessionCompleted) {
            onSessionCompleted(cbCompletedSessionId, 'codebuddy');
          }
          if (onSessionInactive) {
            onSessionInactive(cbCompletedSessionId);
          }
          if (onSessionNotProcessing) {
            onSessionNotProcessing(cbCompletedSessionId);
          }
        }

        // Handle new session navigation (fallback)
        if (latestMessage.isNewSession && cbCompletedSessionId && !currentSessionId) {
          const pendingCbSessionId = sessionStorage.getItem('pendingSessionId');
          
          if (cbCompletedSessionId === pendingCbSessionId) {
            setCurrentSessionId(cbCompletedSessionId);
            sessionStorage.removeItem('pendingSessionId');
            setIsSystemSessionChange(true);
            
            if (onNavigateToSession) {
              onNavigateToSession(cbCompletedSessionId);
            }
          }
        }
        break;
      }
        
      case 'claude-complete': {
        const completedSessionId = latestMessage.sessionId || currentSessionId || sessionStorage.getItem('pendingSessionId');
        handleSessionCompletion(completedSessionId, 'claude', latestMessage);
        
        // Handle new session
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
          setCurrentSessionId(pendingSessionId);
          sessionStorage.removeItem('pendingSessionId');
          setIsSystemSessionChange(true);
          
          if (onNavigateToSession) {
            onNavigateToSession(pendingSessionId);
          }
        }
        
        // Clear persisted chat messages after successful completion
        if (selectedProject && latestMessage.exitCode === 0) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        break;
      }
        
      case 'session-aborted': {
        const abortedSessionId = latestMessage.sessionId || currentSessionId;

        if (abortedSessionId === currentSessionId) {
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
        const isCurrentSession = statusSessionId === currentSessionId ||
                                 (selectedSession && statusSessionId === selectedSession.id);
        if (isCurrentSession && latestMessage.isProcessing) {
          setIsLoading(true);
          setCanAbortSession(true);
          if (onSessionProcessing) {
            onSessionProcessing(statusSessionId);
          }
        }
        break;
      }

      case 'claude-status': {
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
    }
  }, [messages, currentSessionId, selectedSession, selectedProject, setChatMessages, setIsLoading, setCanAbortSession, setClaudeStatus, setCurrentSessionId, setIsSystemSessionChange, fetchUpdatedTokenUsage, onSessionInactive, onSessionProcessing, onSessionNotProcessing, onSessionCompleted, onReplaceTemporarySession, onNavigateToSession, handleSessionCreated, handleSessionResumeFailed, handleContentBlockStart, handleToolResult, handleContentBlockDelta, flushStreamBuffer, bufferStreamContent, handleSessionDuplication, handleNewSessionInit, handleSessionCompletion, handleNewSessionNavigation]);

  return {
    streamBufferRef,
    streamTimerRef,
    pendingToolResultsRef
  };
}
