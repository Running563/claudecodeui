/**
 * Message Converter Utilities
 * 
 * Functions for converting raw session messages to display format.
 */

import { decodeHtmlEntities, unescapeWithMathProtection } from './textProcessing';
import { hasImageContent } from './imageUtils';

/**
 * Convert raw session messages to display format
 * Supports both Claude format (nested message) and CodeBuddy format (flat)
 * 
 * @param {Array} rawMessages - Raw messages from session
 * @returns {Array} Converted messages for display
 */
export const convertSessionMessages = (rawMessages) => {
  const converted = [];
  const toolResults = new Map(); // Map tool_use_id or callId to tool result
  
  // First pass: collect all tool results
  for (const msg of rawMessages) {
    // Support both Claude format (nested message) and CodeBuddy format (flat)
    const role = msg.message?.role || msg.role;
    const content = msg.message?.content || msg.content;
    
    if (role === 'user' && Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'tool_result') {
          toolResults.set(part.tool_use_id, {
            content: part.content,
            isError: part.is_error,
            timestamp: new Date(msg.timestamp || Date.now()),
            // Extract structured tool result data (e.g., for Grep, Glob)
            toolUseResult: msg.toolUseResult || null
          });
        }
      }
    }
    
    // Handle function_call_result type (CodeBuddy format)
    if (msg.type === 'function_call_result') {
      const resultContent = msg.output?.text || msg.output || '';
      toolResults.set(msg.callId, {
        content: resultContent,
        isError: msg.status === 'error',
        timestamp: new Date(msg.timestamp || Date.now()),
        toolUseResult: msg.providerData?.toolResult || null
      });
    }
  }
  
  // Second pass: process messages and attach tool results to tool uses
  for (const msg of rawMessages) {
    // Support both Claude format (nested message) and CodeBuddy format (flat)
    const role = msg.message?.role || msg.role;
    const content = msg.message?.content || msg.content;
    
    // Handle reasoning messages (CodeBuddy format: top-level type="reasoning")
    if (msg.type === 'reasoning' && msg.rawContent && Array.isArray(msg.rawContent)) {
      for (const part of msg.rawContent) {
        if (part.type === 'reasoning_text') {
          let text = part.text;
          if (typeof text === 'string') {
            text = unescapeWithMathProtection(text);
          }
          converted.push({
            type: 'assistant',
            content: text,
            timestamp: msg.timestamp || new Date().toISOString(),
            isThinking: true
          });
        }
      }
      continue;
    }
    
    // Handle function_call type (CodeBuddy format)
    if (msg.type === 'function_call') {
      const toolResult = toolResults.get(msg.callId);
      const displayText = msg.providerData?.argumentsDisplayText || '';
      
      converted.push({
        type: 'assistant',
        content: '',
        timestamp: msg.timestamp || new Date().toISOString(),
        isToolUse: true,
        toolName: msg.name || 'Unknown Tool',
        toolId: msg.callId,
        toolInput: msg.arguments || '{}',
        toolResult: toolResult ? {
          content: (() => {
            // Keep array if it contains image data, otherwise convert to string
            if (hasImageContent(toolResult.content)) {
              return toolResult.content;
            }
            return typeof toolResult.content === 'string' 
              ? toolResult.content 
              : JSON.stringify(toolResult.content);
          })(),
          isError: toolResult.isError,
          toolUseResult: toolResult.toolUseResult
        } : null,
        toolError: toolResult?.isError || false,
        toolResultTimestamp: toolResult?.timestamp || new Date(),
        displayText: displayText
      });
      continue;
    }
    
    // Skip function_call_result messages as they are handled in first pass
    if (msg.type === 'function_call_result') {
      continue;
    }
    
    // Handle user messages
    if (role === 'user' && content) {
      let textContent = '';
      let messageType = 'user';
      
      if (Array.isArray(content)) {
        // Handle array content, but skip tool results (they're attached to tool uses)
        const textParts = [];
        
        for (const part of content) {
          if (part.type === 'text' || part.type === 'input_text') {
            // Support both 'text' and 'input_text' types
            textParts.push(decodeHtmlEntities(part.text));
          }
          // Skip tool_result parts - they're handled in the first pass
        }
        
        textContent = textParts.join('\n');
      } else if (typeof content === 'string') {
        textContent = decodeHtmlEntities(content);
      } else {
        textContent = decodeHtmlEntities(String(content));
      }
      
      // Skip command messages, system messages, and empty content
      const shouldSkip = !textContent ||
                        textContent.startsWith('<command-name>') ||
                        textContent.startsWith('<command-message>') ||
                        textContent.startsWith('<command-args>') ||
                        textContent.startsWith('<local-command-stdout>') ||
                        textContent.startsWith('<system-reminder>') ||
                        textContent.startsWith('Caveat:') ||
                        textContent.startsWith('This session is being continued from a previous') ||
                        textContent.startsWith('[Request interrupted');

      if (!shouldSkip) {
        // Unescape with math formula protection
        textContent = unescapeWithMathProtection(textContent);
        converted.push({
          type: messageType,
          content: textContent,
          timestamp: msg.timestamp || new Date().toISOString()
        });
      }
    }
    
    // Handle assistant messages
    else if (role === 'assistant' && content) {
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'text' || part.type === 'output_text') {
            // Support both 'text' and 'output_text' types
            // Unescape with math formula protection
            let text = part.text;
            if (typeof text === 'string') {
              text = unescapeWithMathProtection(text);
            }
            converted.push({
              type: 'assistant',
              content: text,
              timestamp: msg.timestamp || new Date().toISOString()
            });
          } else if (part.type === 'reasoning_text' || part.type === 'thinking') {
            // Handle reasoning/thinking content
            let text = part.text;
            if (typeof text === 'string') {
              text = unescapeWithMathProtection(text);
            }
            converted.push({
              type: 'assistant',
              content: text,
              timestamp: msg.timestamp || new Date().toISOString(),
              isThinking: true
            });
          } else if (part.type === 'tool_use') {
            // Get the corresponding tool result
            const toolResult = toolResults.get(part.id);

            converted.push({
              type: 'assistant',
              content: '',
              timestamp: msg.timestamp || new Date().toISOString(),
              isToolUse: true,
              toolName: part.name,
              toolId: part.id,
              toolInput: JSON.stringify(part.input),
              toolResult: toolResult ? {
                content: (() => {
                  // Keep array if it contains image data, otherwise convert to string
                  if (hasImageContent(toolResult.content)) {
                    return toolResult.content;
                  }
                  return typeof toolResult.content === 'string' 
                    ? toolResult.content 
                    : JSON.stringify(toolResult.content);
                })(),
                isError: toolResult.isError,
                toolUseResult: toolResult.toolUseResult
              } : null,
              toolError: toolResult?.isError || false,
              toolResultTimestamp: toolResult?.timestamp || new Date()
            });
          }
        }
      } else if (typeof content === 'string') {
        // Unescape with math formula protection
        let text = content;
        text = unescapeWithMathProtection(text);
        converted.push({
          type: 'assistant',
          content: text,
          timestamp: msg.timestamp || new Date().toISOString()
        });
      }
    }
  }
  
  return converted;
};

export default convertSessionMessages;
