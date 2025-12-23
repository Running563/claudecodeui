/**
 * messageHandlers - WebSocket message handling utilities
 * Processes different types of messages from Claude, Cursor, and CodeBuddy
 */

import { decodeHtmlEntities, formatUsageLimitText } from './textProcessing';
import { hasImageContent } from './imageUtils';

/**
 * Process streaming content block delta
 */
export function processContentBlockDelta(messageData, streamBufferRef, streamTimerRef, setChatMessages) {
  if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
    const decodedText = decodeHtmlEntities(messageData.delta.text);
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
    return true;
  }
  return false;
}

/**
 * Process content block stop
 */
export function processContentBlockStop(streamBufferRef, streamTimerRef, setChatMessages) {
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
      } else {
        updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
      }
      return updated;
    });
  }
  
  setChatMessages(prev => {
    const updated = [...prev];
    const last = updated[updated.length - 1];
    if (last && last.type === 'assistant' && last.isStreaming) {
      last.isStreaming = false;
    }
    return updated;
  });
}

/**
 * Process tool use content block
 */
export function processToolUseBlock(contentBlock, pendingToolResultsRef, setChatMessages) {
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
    console.log('✅ Applied pending result for:', toolId);
    pendingToolResultsRef.current.delete(toolId);
  }
}

/**
 * Process tool result message
 */
export function processToolResult(messageData, pendingToolResultsRef, setChatMessages) {
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
  
  console.log('📥 Received tool_result:', toolUseId, 'content:', String(resultContent).slice(0, 100));
  
  pendingToolResultsRef.current.set(toolUseId, toolResultData);
  
  setChatMessages(prev => {
    const toolUseIndex = prev.findIndex(msg => msg.isToolUse && msg.toolId === toolUseId);
    if (toolUseIndex !== -1) {
      console.log('✅ Matched tool_use:', prev[toolUseIndex].toolName, toolUseId);
      pendingToolResultsRef.current.delete(toolUseId);
      const updated = [...prev];
      updated[toolUseIndex] = {
        ...updated[toolUseIndex],
        toolResult: toolResultData
      };
      return updated;
    }
    console.log('⏳ Tool use not found yet, queued:', toolUseId);
    return prev;
  });
}

/**
 * Process Claude response content array
 */
export function processClaudeResponseContent(messageData, setChatMessages) {
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
}

/**
 * Process user message tool results
 */
export function processUserToolResults(messageData, setChatMessages) {
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
}

/**
 * Process raw output (Claude/Cursor/CodeBuddy)
 */
export function processRawOutput(data, streamBufferRef, streamTimerRef, setChatMessages) {
  const cleaned = String(data || '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim();
    
  if (cleaned) {
    streamBufferRef.current += (streamBufferRef.current ? `\n${cleaned}` : cleaned);
    
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
  }
}

/**
 * Flush stream buffer and finalize streaming message
 */
export function flushStreamBuffer(streamBufferRef, streamTimerRef, setChatMessages, textResult = '') {
  if (streamTimerRef.current) {
    clearTimeout(streamTimerRef.current);
    streamTimerRef.current = null;
  }
  
  const pendingChunk = streamBufferRef.current;
  streamBufferRef.current = '';

  setChatMessages(prev => {
    const updated = [...prev];
    const last = updated[updated.length - 1];
    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
      const finalContent = textResult && textResult.trim() 
        ? textResult 
        : (last.content || '') + (pendingChunk || '');
      last.content = finalContent;
      last.isStreaming = false;
    } else if (textResult && textResult.trim()) {
      updated.push({ type: 'assistant', content: textResult, timestamp: new Date(), isStreaming: false });
    }
    return updated;
  });
}

/**
 * Parse Claude status message
 */
export function parseClaudeStatus(statusData) {
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
  
  return statusInfo;
}
