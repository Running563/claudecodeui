import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Use cross-spawn on Windows for better command execution
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

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

      // Request streaming JSON when we are providing a prompt
      args.push('--output-format', 'stream-json');
    }
    
    // Add skip permissions flag if enabled (legacy support)
    if (skipPermissions || settings.skipPermissions) {
      args.push('-y');
      console.log('⚠️  Using -y flag (dangerously-skip-permissions)');
    }
    
    // Add permission mode if specified and not default
    if (permissionMode && permissionMode !== 'default') {
      args.push('--permission-mode', permissionMode);
      console.log('🔐 Permission mode:', permissionMode);
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
      shell: true, // Use shell to find codebuddy in PATH
      env: { ...process.env } // Inherit all environment variables
    });
    
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
              // Forward user message
              ws.send(JSON.stringify({
                type: 'codebuddy-user',
                data: response
              }));
              break;
              
            case 'assistant':
              // Accumulate assistant message chunks
              if (response.message && response.message.content && response.message.content.length > 0) {
                const textContent = response.message.content[0].text;
                messageBuffer += textContent;
                
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
              
            default:
              // Forward any other message types
              ws.send(JSON.stringify({
                type: 'codebuddy-response',
                data: response
              }));
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
          // Send as raw text output
          ws.send(JSON.stringify({
            type: 'codebuddy-output',
            data: line
          }));
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
