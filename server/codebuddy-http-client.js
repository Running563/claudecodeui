/**
 * CodeBuddy HTTP Client Integration
 *
 * This module provides HTTP-based integration with CodeBuddy using the HTTP API
 * provided by `codebuddy --serve` command.
 *
 * Key features:
 * - HTTP API integration without child processes
 * - Server-Sent Events (SSE) stream parsing
 * - Session management with abort capability
 * - Options mapping to CodeBuddy HTTP API format
 * - WebSocket message streaming
 */

import fetch from 'node-fetch';

// Default CodeBuddy HTTP service configuration
const DEFAULT_CODEBUDDY_HOST = '127.0.0.1';
const DEFAULT_CODEBUDDY_PORT = 3000;

// Session tracking: Map of session IDs to abort controllers
const activeSessions = new Map();

/**
 * Get CodeBuddy HTTP service URL from environment or use defaults
 * @returns {string} Service URL
 */
function getCodeBuddyServiceUrl() {
  const host = process.env.CODEBUDDY_HTTP_HOST || DEFAULT_CODEBUDDY_HOST;
  const port = process.env.CODEBUDDY_HTTP_PORT || DEFAULT_CODEBUDDY_PORT;
  return `http://${host}:${port}`;
}

/**
 * Maps CLI-style options to CodeBuddy HTTP API format
 * @param {Object} options - CLI-style options
 * @returns {Object} HTTP API request body
 */
function mapOptionsToHttpApi(options = {}) {
  const { sessionId, projectPath, cwd, toolsSettings, skipPermissions, model } = options;
  
  const requestBody = {
    outputFormat: 'stream-json',
    inputFormat: 'text'
  };
  
  // Map resume parameter if sessionId exists
  if (sessionId) {
    requestBody.resume = sessionId;
  }
  
  // Map model (only meaningful for new sessions)
  if (!sessionId && model && model !== 'default') {
    requestBody.model = model;
  }
  
  // Map tools settings
  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };
  
  // Map skip permissions flag
  if (skipPermissions || settings.skipPermissions) {
    requestBody.dangerouslySkipPermissions = true;
  }
  
  // Map allowed tools
  if (settings.allowedTools && settings.allowedTools.length > 0) {
    requestBody.allowedTools = settings.allowedTools;
  }
  
  // Map disallowed tools
  if (settings.disallowedTools && settings.disallowedTools.length > 0) {
    requestBody.disallowedTools = settings.disallowedTools;
  }
  
  // Map working directory (addDir parameter)
  const workingDir = cwd || projectPath;
  if (workingDir) {
    requestBody.addDir = [workingDir];
  }
  
  return requestBody;
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {AbortController} abortController - AbortController instance
 */
function addSession(sessionId, abortController) {
  activeSessions.set(sessionId, {
    abortController,
    startTime: Date.now(),
    status: 'active'
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Handles SSE message data
 * @param {Object} data - Parsed message data
 * @param {Object} context - Message handling context
 */
function handleSseMessage(data, context) {
  const { ws, capturedSessionId, sessionId } = context;
  
  switch (data.type) {
    case 'system':
      if (data.subtype === 'init') {
        // Send system info to frontend
        ws.send(JSON.stringify({
          type: 'codebuddy-system',
          data: data
        }));
      }
      break;
      
    case 'user':
      // Forward user message
      ws.send(JSON.stringify({
        type: 'codebuddy-user',
        data: data
      }));
      break;
      
    case 'assistant':
      // Accumulate assistant message chunks
      if (data.message && data.message.content && data.message.content.length > 0) {
        const textContent = data.message.content[0].text;
        context.messageBuffer += textContent;
        
        // Send as Claude-compatible format for frontend
        ws.send(JSON.stringify({
          type: 'claude-response',
          data: {
            type: 'content_block_delta',
            delta: {
              type: 'text_delta',
              text: textContent
            }
          }
        }));
      }
      break;
      
    case 'result':
      // Session complete
      
      // Send final message if we have buffered content
      if (context.messageBuffer) {
        ws.send(JSON.stringify({
          type: 'claude-response',
          data: {
            type: 'content_block_stop'
          }
        }));
      }
      
      // Send completion event
      ws.send(JSON.stringify({
        type: 'codebuddy-result',
        sessionId: capturedSessionId || sessionId,
        data: data,
        success: data.subtype === 'success'
      }));
      break;
      
    case 'done':
      // Stream end marker
      console.log('✅ Stream completed');
      break;
      
    default:
      // Forward any other message types
      ws.send(JSON.stringify({
        type: 'codebuddy-response',
        data: data
      }));
  }
}

/**
 * Calls CodeBuddy HTTP API to handle a query
 * Uses the HTTP service started with `codebuddy --serve`
 * 
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function spawnCodeBuddy(command, options = {}, ws) {
  const { sessionId } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let messageBuffer = '';
  const isNewSession = !sessionId && !!command;
  
  try {
    // Build HTTP API request body
    const requestBody = mapOptionsToHttpApi(options);
    
    // Add prompt if provided
    if (command && command.trim()) {
      requestBody.prompt = command;
    }
    
    // Log session info
    if (sessionId) {
      console.log('🔄 Resuming existing session:', sessionId);
    }
    
    const serviceUrl = getCodeBuddyServiceUrl();
    const endpoint = `${serviceUrl}/agent`;
    
    console.log('🤖 Calling CodeBuddy HTTP API:', endpoint);
    console.log('📦 Request body:', JSON.stringify(requestBody, null, 2));
    
    const abortController = new AbortController();
    
    // Make HTTP POST request to CodeBuddy service
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Check if response is SSE stream
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('text/event-stream')) {
      throw new Error(`Expected SSE stream, got: ${contentType}`);
    }
    
    // Track session for abort capability
    const processKey = capturedSessionId || `process-${Date.now()}`;
    addSession(processKey, abortController);
    
    // Parse SSE stream
    let buffer = '';
    
    response.body.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        // Parse SSE format: "event: xxx" or "data: xxx"
        if (line.startsWith('data: ')) {
          const dataStr = line.substring(6);
          
          try {
            const data = JSON.parse(dataStr);
            
            // Capture session ID from init message
            if (data.type === 'system' && data.subtype === 'init' && data.session_id && !capturedSessionId) {
              capturedSessionId = data.session_id;
              console.log('📝 Captured NEW session ID:', capturedSessionId);
              
              // Update session tracking
              if (processKey !== capturedSessionId) {
                removeSession(processKey);
                addSession(capturedSessionId, abortController);
              }
              
              // Set session ID on writer (for API endpoint compatibility)
              if (ws.setSessionId && typeof ws.setSessionId === 'function') {
                ws.setSessionId(capturedSessionId);
              }

              // Send session-created event only once for new sessions
              if (!sessionId && !sessionCreatedSent) {
                sessionCreatedSent = true;
                ws.send(JSON.stringify({
                  type: 'session-created',
                  sessionId: capturedSessionId,
                  model: data.model,
                  cwd: data.cwd
                }));
              }
            }
            
            // Handle message
            const context = { ws, capturedSessionId, sessionId, messageBuffer };
            handleSseMessage(data, context);
            messageBuffer = context.messageBuffer; // Update message buffer
            
          } catch (parseError) {
            console.error('❌ Failed to parse SSE data:', parseError);
            // If not JSON, send as raw text
            ws.send(JSON.stringify({
              type: 'codebuddy-output',
              data: dataStr
            }));
          }
        } else if (line.startsWith('event: ')) {
          const eventType = line.substring(7);
          console.log(`📡 SSE Event: ${eventType}`);
        }
      }
    });
    
    response.body.on('end', () => {
      console.log('🏁 HTTP stream ended');
      
      // Clean up
      removeSession(capturedSessionId || processKey);
      
      ws.send(JSON.stringify({
        type: 'codebuddy-complete',
        sessionId: capturedSessionId || sessionId,
        exitCode: 0,
        isNewSession: isNewSession
      }));
    });
    
    response.body.on('error', (error) => {
      console.error('❌ Stream error:', error);
      
      // Clean up
      removeSession(capturedSessionId || processKey);
      
      ws.send(JSON.stringify({
        type: 'codebuddy-error',
        error: error.message
      }));
      
      throw error;
    });
    
  } catch (error) {
    console.error('❌ CodeBuddy HTTP request error:', error);
    
    // Clean up
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }
    
    // Check if it's a connection error
    if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
      const serviceUrl = getCodeBuddyServiceUrl();
      ws.send(JSON.stringify({
        type: 'codebuddy-error',
        error: `无法连接到 CodeBuddy HTTP 服务 (${serviceUrl})。请确保已启动服务: codebuddy --serve --port ${process.env.CODEBUDDY_HTTP_PORT || DEFAULT_CODEBUDDY_PORT}`
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'codebuddy-error',
        error: error.message
      }));
    }
    
    throw error;
  }
}

/**
 * Aborts an active CodeBuddy session
 * @param {string} sessionId - Session identifier
 * @returns {Promise<boolean>} True if session was aborted, false if not found
 */
async function abortCodeBuddySession(sessionId) {
  const session = getSession(sessionId);
  
  if (!session) {
    console.log(`⚠️  CodeBuddy session ${sessionId} not found in active sessions`);
    return false;
  }
  
  try {
    console.log(`🛑 Aborting CodeBuddy session: ${sessionId}`);
    
    // Abort the fetch request
    session.abortController.abort();
    
    // Update session status
    session.status = 'aborted';
    
    // Clean up session
    removeSession(sessionId);
    
    return true;
  } catch (error) {
    console.error(`❌ Error aborting CodeBuddy session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Checks if a CodeBuddy session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isCodeBuddySessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets all active CodeBuddy session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveCodeBuddySessions() {
  return Array.from(activeSessions.keys());
}

// Export public API
export {
  spawnCodeBuddy,
  abortCodeBuddySession,
  isCodeBuddySessionActive,
  getActiveCodeBuddySessions,
  getCodeBuddyServiceUrl
};
