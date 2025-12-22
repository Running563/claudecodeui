/**
 * Cursor Message Loader Utility
 * 
 * Handles loading and converting Cursor session messages from SQLite backend.
 * Converts Cursor's message format to the unified format used by ChatInterface.
 */

import { authenticatedFetch } from '../../../utils/api';
import { decodeHtmlEntities } from './textProcessing';

/**
 * Map Cursor tool names to Claude Code equivalents
 * @param {string} toolName - Original tool name
 * @returns {string} Mapped tool name
 */
function mapToolName(toolName) {
  if (toolName === 'ApplyPatch') {
    return 'Edit';
  }
  return toolName || 'Unknown Tool';
}

/**
 * Convert relative path to absolute path
 * @param {string} filePath - File path (relative or absolute)
 * @param {string} projectPath - Project base path
 * @returns {string} Absolute path
 */
function toAbsolutePath(filePath, projectPath) {
  if (!filePath) return filePath;
  if (filePath.startsWith('/')) return filePath;
  return `${projectPath}/${filePath}`;
}

/**
 * Parse patch content to extract old and new strings
 * @param {string} patch - Patch content in diff format
 * @returns {{ oldLines: string[], newLines: string[] }}
 */
function parsePatch(patch) {
  const patchLines = patch.split('\n');
  const oldLines = [];
  const newLines = [];
  let inPatch = false;
  
  for (const line of patchLines) {
    if (line.startsWith('@@')) {
      inPatch = true;
    } else if (inPatch) {
      if (line.startsWith('-')) {
        oldLines.push(line.substring(1));
      } else if (line.startsWith('+')) {
        newLines.push(line.substring(1));
      } else if (line.startsWith(' ')) {
        // Context line - add to both
        oldLines.push(line.substring(1));
        newLines.push(line.substring(1));
      }
    }
  }
  
  return { oldLines, newLines };
}

/**
 * Convert Cursor tool args to Claude Code format
 * @param {string} toolName - Tool name
 * @param {object} args - Tool arguments
 * @param {string} projectPath - Project base path
 * @returns {object} Converted tool input
 */
function convertToolInput(toolName, args, projectPath) {
  if (!args) return args;
  
  if (toolName === 'Edit') {
    // ApplyPatch uses 'patch' format, convert to Edit format
    if (args.patch) {
      const { oldLines, newLines } = parsePatch(args.patch);
      const absolutePath = toAbsolutePath(args.file_path, projectPath);
      return {
        file_path: absolutePath,
        old_string: oldLines.join('\n') || args.patch,
        new_string: newLines.join('\n') || args.patch
      };
    }
    // Direct edit format
    return args;
  }
  
  if (toolName === 'Read') {
    // Map 'path' to 'file_path'
    const filePath = args.path || args.file_path;
    return {
      file_path: toAbsolutePath(filePath, projectPath)
    };
  }
  
  if (toolName === 'Write') {
    // Map fields for Write tool
    const filePath = args.path || args.file_path;
    return {
      file_path: toAbsolutePath(filePath, projectPath),
      content: args.contents || args.content
    };
  }
  
  return args;
}

/**
 * Process tool result content
 * @param {object} item - Tool result item
 * @param {object} toolUseMap - Map of tool uses by ID
 * @param {Array} converted - Converted messages array
 * @param {object} blob - Original blob data
 * @param {number} blobIdx - Blob index
 */
function processToolResult(item, toolUseMap, converted, blob, blobIdx) {
  const toolName = mapToolName(item.toolName);
  const toolCallId = item.toolCallId || blob.content?.id;
  const result = item.result || '';
  
  // Store the tool result to be linked later
  if (toolUseMap[toolCallId]) {
    toolUseMap[toolCallId].toolResult = {
      content: result,
      isError: false
    };
  } else {
    // No matching tool use found, create a standalone result message
    converted.push({
      type: 'assistant',
      content: '',
      timestamp: new Date(Date.now() + blobIdx * 1000),
      blobId: blob.id,
      sequence: blob.sequence,
      rowid: blob.rowid,
      isToolUse: true,
      toolName: toolName,
      toolId: toolCallId,
      toolInput: null,
      toolResult: {
        content: result,
        isError: false
      }
    });
  }
}

/**
 * Process tool call content
 * @param {object} part - Tool call part
 * @param {object} toolUseMap - Map of tool uses by ID
 * @param {Array} converted - Converted messages array
 * @param {object} blob - Original blob data
 * @param {number} blobIdx - Blob index
 * @param {string} projectPath - Project base path
 */
function processToolCall(part, toolUseMap, converted, blob, blobIdx, projectPath) {
  const toolName = mapToolName(part.toolName);
  const toolId = part.toolCallId || `tool_${blobIdx}`;
  const toolInput = convertToolInput(toolName, part.args, projectPath);
  
  const toolMessage = {
    type: 'assistant',
    content: '',
    timestamp: new Date(Date.now() + blobIdx * 1000),
    blobId: blob.id,
    sequence: blob.sequence,
    rowid: blob.rowid,
    isToolUse: true,
    toolName: toolName,
    toolId: toolId,
    toolInput: toolInput ? JSON.stringify(toolInput) : null,
    toolResult: null // Will be filled when we get the tool result
  };
  converted.push(toolMessage);
  toolUseMap[toolId] = toolMessage; // Store for linking results
}

/**
 * Process old format tool_use
 * @param {object} part - Tool use part
 * @param {object} toolUseMap - Map of tool uses by ID
 * @param {Array} converted - Converted messages array
 * @param {object} blob - Original blob data
 * @param {number} blobIdx - Blob index
 */
function processOldToolUse(part, toolUseMap, converted, blob, blobIdx) {
  const toolName = part.name || 'Unknown Tool';
  const toolId = part.id || `tool_${blobIdx}`;
  
  const toolMessage = {
    type: 'assistant',
    content: '',
    timestamp: new Date(Date.now() + blobIdx * 1000),
    blobId: blob.id,
    sequence: blob.sequence,
    rowid: blob.rowid,
    isToolUse: true,
    toolName: toolName,
    toolId: toolId,
    toolInput: part.input ? JSON.stringify(part.input) : null,
    toolResult: null
  };
  converted.push(toolMessage);
  toolUseMap[toolId] = toolMessage;
}

/**
 * Process content array from Cursor message
 * @param {Array} contentArray - Content array
 * @param {string} role - Message role
 * @param {object} toolUseMap - Map of tool uses by ID
 * @param {Array} converted - Converted messages array
 * @param {object} blob - Original blob data
 * @param {number} blobIdx - Blob index
 * @param {string} projectPath - Project base path
 * @returns {{ text: string, reasoningText: string|null }}
 */
function processContentArray(contentArray, role, toolUseMap, converted, blob, blobIdx, projectPath) {
  const textParts = [];
  let reasoningText = null;
  
  for (const part of contentArray) {
    if (part?.type === 'text' && part?.text) {
      textParts.push(decodeHtmlEntities(part.text));
    } else if (part?.type === 'reasoning' && part?.text) {
      // Handle reasoning type - will be displayed in a collapsible section
      reasoningText = decodeHtmlEntities(part.text);
    } else if (part?.type === 'tool-call') {
      // First, add any text/reasoning we've collected so far as a message
      if (textParts.length > 0 || reasoningText) {
        converted.push({
          type: role,
          content: textParts.join('\n'),
          reasoning: reasoningText,
          timestamp: new Date(Date.now() + blobIdx * 1000),
          blobId: blob.id,
          sequence: blob.sequence,
          rowid: blob.rowid
        });
        textParts.length = 0;
        reasoningText = null;
      }
      
      processToolCall(part, toolUseMap, converted, blob, blobIdx, projectPath);
    } else if (part?.type === 'tool_use') {
      // Old format support
      if (textParts.length > 0 || reasoningText) {
        converted.push({
          type: role,
          content: textParts.join('\n'),
          reasoning: reasoningText,
          timestamp: new Date(Date.now() + blobIdx * 1000),
          blobId: blob.id,
          sequence: blob.sequence,
          rowid: blob.rowid
        });
        textParts.length = 0;
        reasoningText = null;
      }
      
      processOldToolUse(part, toolUseMap, converted, blob, blobIdx);
    } else if (typeof part === 'string') {
      textParts.push(part);
    }
  }
  
  // Return remaining text and reasoning
  let text = '';
  if (textParts.length > 0) {
    text = textParts.join('\n');
    if (reasoningText && !text) {
      // Just reasoning, no text
      converted.push({
        type: role,
        content: '',
        reasoning: reasoningText,
        timestamp: new Date(Date.now() + blobIdx * 1000),
        blobId: blob.id,
        sequence: blob.sequence,
        rowid: blob.rowid
      });
      text = ''; // Clear to avoid duplicate
      reasoningText = null;
    }
  }
  
  return { text, reasoningText };
}

/**
 * Process a single blob from Cursor session
 * @param {object} blob - Blob data
 * @param {number} blobIdx - Blob index
 * @param {object} toolUseMap - Map of tool uses by ID
 * @param {Array} converted - Converted messages array
 * @param {string} projectPath - Project base path
 */
function processBlob(blob, blobIdx, toolUseMap, converted, projectPath) {
  const content = blob.content;
  let text = '';
  let role = 'assistant';
  let reasoningText = null;
  
  try {
    // Handle different Cursor message formats
    if (content?.role && content?.content) {
      // Direct format: {"role":"user","content":[{"type":"text","text":"..."}]}
      // Skip system messages
      if (content.role === 'system') {
        return;
      }
      
      // Handle tool messages
      if (content.role === 'tool') {
        // Tool result format - find the matching tool use message and update it
        if (Array.isArray(content.content)) {
          for (const item of content.content) {
            if (item?.type === 'tool-result') {
              processToolResult(item, toolUseMap, converted, blob, blobIdx);
            }
          }
        }
        return; // Don't add tool messages as regular messages
      }
      
      // User or assistant messages
      role = content.role === 'user' ? 'user' : 'assistant';
      
      if (Array.isArray(content.content)) {
        const result = processContentArray(
          content.content, role, toolUseMap, converted, blob, blobIdx, projectPath
        );
        text = result.text;
        reasoningText = result.reasoningText;
      } else if (typeof content.content === 'string') {
        text = content.content;
      }
    } else if (content?.message?.role && content?.message?.content) {
      // Nested message format
      if (content.message.role === 'system') {
        return;
      }
      role = content.message.role === 'user' ? 'user' : 'assistant';
      if (Array.isArray(content.message.content)) {
        text = content.message.content
          .map(p => (typeof p === 'string' ? p : (p?.text || '')))
          .filter(Boolean)
          .join('\n');
      } else if (typeof content.message.content === 'string') {
        text = content.message.content;
      }
    }
  } catch (e) {
    console.log('Error parsing blob content:', e);
  }
  
  if (text && text.trim()) {
    const message = {
      type: role,
      content: text,
      timestamp: new Date(Date.now() + blobIdx * 1000),
      blobId: blob.id,
      sequence: blob.sequence,
      rowid: blob.rowid
    };
    
    // Add reasoning if we have it
    if (reasoningText) {
      message.reasoning = reasoningText;
    }
    
    converted.push(message);
  }
}

/**
 * Sort messages by sequence/rowid to maintain chronological order
 * @param {Array} messages - Messages to sort
 * @returns {Array} Sorted messages
 */
function sortMessages(messages) {
  return messages.sort((a, b) => {
    // First sort by sequence if available (clean 1,2,3... numbering)
    if (a.sequence !== undefined && b.sequence !== undefined) {
      return a.sequence - b.sequence;
    }
    // Then try rowid (original SQLite row IDs)
    if (a.rowid !== undefined && b.rowid !== undefined) {
      return a.rowid - b.rowid;
    }
    // Fallback to timestamp
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
}

/**
 * Load and convert Cursor session messages from SQLite backend
 * @param {string} projectPath - Project path
 * @param {string} sessionId - Session ID
 * @returns {Promise<Array>} Converted messages
 */
export async function loadCursorSessionMessages(projectPath, sessionId) {
  if (!projectPath || !sessionId) return [];
  
  try {
    const url = `/api/cursor/sessions/${encodeURIComponent(sessionId)}?projectPath=${encodeURIComponent(projectPath)}`;
    const res = await authenticatedFetch(url);
    if (!res.ok) return [];
    
    const data = await res.json();
    const blobs = data?.session?.messages || [];
    const converted = [];
    const toolUseMap = {}; // Map to store tool uses by ID for linking results
    
    // Process all messages maintaining order
    for (let blobIdx = 0; blobIdx < blobs.length; blobIdx++) {
      processBlob(blobs[blobIdx], blobIdx, toolUseMap, converted, projectPath);
    }
    
    // Sort messages by sequence/rowid to maintain chronological order
    return sortMessages(converted);
  } catch (e) {
    console.error('Error loading Cursor session messages:', e);
    return [];
  }
}

export default loadCursorSessionMessages;
