import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Use cross-spawn for better command execution (handles PATH lookup without shell)
const spawnFunction = crossSpawn;

let activeCodeBuddyProcesses = new Map(); // Track active processes by session ID

/**
 * Spawns a CodeBuddy CLI process to handle a query
 * Modeled after Cursor CLI behavior
 * 
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function spawnCodeBuddy(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const { sessionId, projectPath, cwd, resume, toolsSettings, skipPermissions, model, images, permissionMode } = options;
    let capturedSessionId = sessionId; // Track session ID throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    let messageBuffer = ''; // Buffer for accumulating assistant messages
    // isNewSession should only be true when we start without a sessionId (not resuming)
    // This matches CodeBuddy SDK behavior: isNewSession: !sessionId && !!command
    const isNewSession = !sessionId && !!command;
    
    // Use tools settings passed from frontend, or defaults
    const settings = toolsSettings || {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false
    };
    
    // Build CodeBuddy CLI command
    const args = [];
    
    // Build flags allowing both resume and prompt together (reply in existing session)
    // ONLY add --resume if sessionId exists and is NOT a temp ID
    if (sessionId && !sessionId.startsWith('temp-')) {
      args.push('--resume=' + sessionId);
      console.log('🔄 Resuming existing session:', sessionId);
    } else if (sessionId && sessionId.startsWith('temp-')) {
      console.log('⚠️  Ignoring temp session ID, starting new session');
      capturedSessionId = null; // Reset to allow new session
    }

    if (command && command.trim()) {
      // Provide a prompt (works for both new and resumed sessions)
      // Sanitize command to prevent shell injection and newline issues
      const sanitizedCommand = command.replace(/\n/g, ' ').replace(/\r/g, '');
      args.push('-p', sanitizedCommand);

      // Add model flag if specified (only meaningful for new sessions; harmless on resume)
      if (!sessionId && model && model !== 'default') {
        args.push('--model', model);
      }

      // Request streaming JSON output (--print is required for --output-format to work)
      args.push('--print');
      args.push('--output-format', 'stream-json');
      
      // Increase max turns to allow longer conversations with many tool calls
      args.push('--max-turns', '1000');
    }
    
    // Add skip permissions flag for non-interactive mode
    // In --print mode, we cannot handle interactive permission prompts,
    // so we need to either skip permissions or use a mode that auto-approves
    // Only skip if not in plan mode (plan mode should remain read-only)
    const effectivePermissionMode = permissionMode || 'default';
    const needsAutoApprove = effectivePermissionMode !== 'plan' && (
      skipPermissions || 
      settings.skipPermissions || 
      effectivePermissionMode === 'bypassPermissions' ||
      effectivePermissionMode === 'acceptEdits' ||
      effectivePermissionMode === 'default'  // In non-interactive mode, default also needs -y
    );
    
    if (needsAutoApprove) {
      args.push('-y');
      console.log('⚠️  Using -y flag (non-interactive mode requires auto-approve)');
    }
    
    // Add permission mode if specified and not default
    if (effectivePermissionMode && effectivePermissionMode !== 'default') {
      args.push('--permission-mode', effectivePermissionMode);
      console.log('🔐 Permission mode:', effectivePermissionMode);
    }
    
    // Use cwd (actual project directory) instead of projectPath
    // Ensure workingDir is an absolute path
    let workingDir = cwd || projectPath || process.cwd();
    if (!path.isAbsolute(workingDir)) {
      workingDir = path.join('/', workingDir);
    }
    
    // CodeBuddy CLI command
    const codebuddyCmd = 'codebuddy';
    
    console.log('🤖 Spawning CodeBuddy CLI:', codebuddyCmd, args.join(' '));
    console.log('📁 Working directory:', workingDir);
    console.log('🔑 Session info - Input sessionId:', sessionId, 'Resume:', resume);
    
    const codebuddyProcess = spawnFunction(codebuddyCmd, args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false, // Disable shell to avoid output buffering
      env: { 
        ...process.env,
        // Force unbuffered output
        PYTHONUNBUFFERED: '1',
        NODE_OPTIONS: '--no-warnings',
        // Disable interactive prompts
        CI: 'true',
        TERM: 'dumb'
      }
    });
    
    // Close stdin immediately to prevent process from waiting for input
    // This is important for --print mode which should be non-interactive
    codebuddyProcess.stdin.end();
    
    // Store process reference for potential abort
    // Use timestamp as key for new sessions (will be updated when we capture real session ID)
    const processKey = (capturedSessionId && !capturedSessionId.startsWith('temp-')) 
      ? capturedSessionId 
      : `process-${Date.now()}`;
    activeCodeBuddyProcesses.set(processKey, codebuddyProcess);
    
    // Handle stdout (streaming JSON responses)
    codebuddyProcess.stdout.on('data', (data) => {
      const rawOutput = data.toString();
      const lines = rawOutput.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          
          // Debug log all message types
          console.log('📨 CodeBuddy message:', response.type, response.subtype || '');
          
          // Handle different message types
          switch (response.type) {
            case 'system':
              if (response.subtype === 'init') {
                // Capture session ID
                if (response.session_id && !capturedSessionId) {
                  capturedSessionId = response.session_id;
                  console.log('📝 Captured NEW session ID:', capturedSessionId);
                  
                  // Update process key with captured session ID
                  if (processKey !== capturedSessionId) {
                    activeCodeBuddyProcesses.delete(processKey);
                    activeCodeBuddyProcesses.set(capturedSessionId, codebuddyProcess);
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
                      model: response.model,
                      cwd: response.cwd
                    }));
                  }
                }
                
                // Send system info to frontend
                ws.send(JSON.stringify({
                  type: 'codebuddy-system',
                  data: response
                }));
              }
              break;
              
            case 'user':
              // User messages contain tool execution results
              // Forward them to frontend so users can see tool call results
              console.log('📥 CodeBuddy user message (tool result):', JSON.stringify(response.message?.content || response).slice(0, 500));
              
              if (response.message && response.message.content) {
                for (const contentBlock of response.message.content) {
                  if (contentBlock.type === 'tool_result') {
                    // Convert content to string if it's an array or object
                    let resultContent = contentBlock.content;
                    if (Array.isArray(resultContent)) {
                      // Extract text from content array (common format: [{type: 'text', text: '...'}])
                      resultContent = resultContent
                        .map(item => item.text || JSON.stringify(item))
                        .join('\n');
                    } else if (typeof resultContent === 'object' && resultContent !== null) {
                      resultContent = JSON.stringify(resultContent, null, 2);
                    }
                    
                    // Forward tool result to frontend
                    ws.send(JSON.stringify({
                      type: 'claude-response',
                      data: {
                        type: 'tool_result',
                        tool_use_id: contentBlock.tool_use_id,
                        content: resultContent,
                        is_error: contentBlock.is_error
                      }
                    }));
                    console.log('📤 Sending tool result to frontend:', contentBlock.tool_use_id, 'content length:', String(resultContent).length);
                  }
                }
              }
              break;
              
            case 'assistant':
              // Handle assistant message - may have different content structures
              console.log('📝 Assistant message content:', JSON.stringify(response.message?.content || response).slice(0, 500));
              
              if (response.message && response.message.content) {
                for (const contentBlock of response.message.content) {
                  console.log('📦 Content block type:', contentBlock.type);
                  
                  if (contentBlock.type === 'text' && contentBlock.text) {
                    messageBuffer += contentBlock.text;
                    
                    // Send as Claude-compatible format for frontend
                    const textMessage = {
                      type: 'claude-response',
                      data: {
                        type: 'content_block_delta',
                        delta: {
                          type: 'text_delta',
                          text: contentBlock.text
                        }
                      }
                    };
                    console.log('📤 Sending text delta to frontend:', contentBlock.text.slice(0, 100));
                    ws.send(JSON.stringify(textMessage));
                  } else if (contentBlock.type === 'tool_use') {
                    // Forward tool use as claude-response for frontend compatibility
                    ws.send(JSON.stringify({
                      type: 'claude-response',
                      data: {
                        type: 'content_block_start',
                        content_block: {
                          type: 'tool_use',
                          id: contentBlock.id,
                          name: contentBlock.name,
                          input: contentBlock.input
                        }
                      }
                    }));
                    // Also send tool_use complete
                    ws.send(JSON.stringify({
                      type: 'claude-response',
                      data: {
                        type: 'content_block_stop'
                      }
                    }));
                  } else if (contentBlock.type === 'tool_result') {
                    // Forward tool result
                    ws.send(JSON.stringify({
                      type: 'claude-response',
                      data: {
                        type: 'tool_result',
                        tool_use_id: contentBlock.tool_use_id,
                        content: contentBlock.content
                      }
                    }));
                  }
                }
              }
              // Note: Not forwarding raw assistant message to avoid cluttering frontend
              break;
              
            case 'result':
              // Session complete
              console.log('📋 CodeBuddy result:', JSON.stringify(response).slice(0, 500));
              
              // Send final message if we have buffered content
              if (messageBuffer) {
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
                data: response,
                success: response.subtype === 'success'
              }));
              
              // Cleanup
              activeCodeBuddyProcesses.delete(capturedSessionId || processKey);
              break;
            
            case 'content_block_start':
            case 'content_block_delta':
            case 'content_block_stop':
              // Forward content blocks directly as claude-response
              ws.send(JSON.stringify({
                type: 'claude-response',
                data: response
              }));
              break;
              
            default:
              // Log unknown message types for debugging but don't forward to frontend
              // to avoid cluttering the UI with raw JSON
              console.log('📦 Unknown CodeBuddy message type:', response.type, JSON.stringify(response).slice(0, 200));
          }
        } catch (parseError) {
          // If not JSON, check for OSC title sequence first
          // OSC sequence format: ESC ] 0 ; title BEL (where ESC=\x1b=\u001b, BEL=\x07=\u0007)
          const oscTitleMatch = line.match(/\u001b\]0;(.+?)\u0007/);
          if (oscTitleMatch && oscTitleMatch[1]) {
            // Extract title (remove status emoji prefix like ✳ ✓ ✗ ⏳)
            const rawTitle = oscTitleMatch[1];
            const cleanTitle = rawTitle.replace(/^[✳✓✗⏳]\s*/, '').trim();
            if (cleanTitle) {
              const currentSessionId = capturedSessionId || sessionId;
              console.log('📝 OSC title detected:', cleanTitle);
              ws.send(JSON.stringify({
                type: 'session-title-update',
                sessionId: currentSessionId,
                title: cleanTitle
              }));
              
              // Persist title to a separate JSON file (not JSONL - CodeBuddy CLI doesn't recognize 'summary' type)
              // Store in session-titles.json in the project directory
              if (currentSessionId && workingDir) {
                const projectName = workingDir.replace(/\//g, '-').replace(/^-/, '');
                const codebuddyProjectDir = path.join(os.homedir(), '.codebuddy', 'projects', projectName);
                const titlesFile = path.join(codebuddyProjectDir, 'session-titles.json');
                
                // Use async IIFE since we're in a non-async callback
                (async () => {
                  try {
                    // Read existing titles or create new object
                    let titles = {};
                    try {
                      const content = await fs.readFile(titlesFile, 'utf8');
                      titles = JSON.parse(content);
                    } catch (e) {
                      // File doesn't exist or is invalid, start fresh
                    }
                    
                    // Update title for this session
                    titles[currentSessionId] = cleanTitle;
                    
                    // Write back
                    await fs.writeFile(titlesFile, JSON.stringify(titles, null, 2));
                  } catch (err) {
                    console.warn('⚠️  Failed to persist session title:', err.message);
                  }
                })();
              }
            }
            // Don't send as codebuddy-output if it's just a title update
            if (line.trim() === oscTitleMatch[0]) {
              continue;
            }
          }
          // In stream-json mode, non-JSON output is typically debug/internal output
          // that shouldn't be shown to users. Only log it for debugging.
          console.log('📝 CodeBuddy non-JSON output (ignored):', line.slice(0, 100));
        }
      }
    });
    
    // Handle stderr
    codebuddyProcess.stderr.on('data', (data) => {
      console.error('❌ CodeBuddy CLI stderr:', data.toString());
      ws.send(JSON.stringify({
        type: 'codebuddy-error',
        error: data.toString()
      }));
    });
    
    // Handle process completion
    codebuddyProcess.on('close', (code) => {
      // Clean up process reference
      activeCodeBuddyProcesses.delete(capturedSessionId || processKey);
      
      ws.send(JSON.stringify({
        type: 'codebuddy-complete',
        sessionId: capturedSessionId || sessionId,
        exitCode: code,
        isNewSession: isNewSession // Use tracked flag instead of calculating
      }));
      
      resolve({ 
        sessionId: capturedSessionId || sessionId,
        exitCode: code 
      });
    });
    
    // Handle process errors
    codebuddyProcess.on('error', (error) => {
      console.error('❌ CodeBuddy process error:', error);
      
      // Clean up process reference
      activeCodeBuddyProcesses.delete(capturedSessionId || processKey);
      
      ws.send(JSON.stringify({
        type: 'codebuddy-error',
        error: error.message
      }));
      
      reject(error);
    });
  });
}

/**
 * Aborts an active CodeBuddy session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortCodeBuddySession(sessionId) {
  const process = activeCodeBuddyProcesses.get(sessionId);
  
  if (!process) {
    console.log(`⚠️  CodeBuddy session ${sessionId} not found in active processes`);
    return false;
  }
  
  try {
    console.log(`🛑 Aborting CodeBuddy session: ${sessionId}`);
    process.kill('SIGTERM');
    activeCodeBuddyProcesses.delete(sessionId);
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
  return activeCodeBuddyProcesses.has(sessionId);
}

/**
 * Gets all active CodeBuddy session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveCodeBuddySessions() {
  return Array.from(activeCodeBuddyProcesses.keys());
}

// Export public API
export {
  spawnCodeBuddy,
  abortCodeBuddySession,
  isCodeBuddySessionActive,
  getActiveCodeBuddySessions
};
