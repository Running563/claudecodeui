import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Use cross-spawn for better command execution (handles PATH lookup without shell)
const spawnFunction = crossSpawn;

let activeCodeBuddyProcesses = new Map(); // Track active processes by session ID

/**
 * Error type classification for user-friendly error messages
 */
const ERROR_TYPES = {
  // Authentication/API errors
  AUTH: {
    patterns: [/api[_-]?key/i, /authentication/i, /unauthorized/i, /invalid.*key/i, /ANTHROPIC_API_KEY/i],
    userMessage: 'API 认证失败。请检查您的 API 密钥配置。',
    type: 'auth'
  },
  // Rate limiting
  RATE_LIMIT: {
    patterns: [/rate[_-]?limit/i, /too many requests/i, /429/i, /quota/i],
    userMessage: 'API 请求频率过高，请稍后重试。',
    type: 'rate_limit'
  },
  // Network errors
  NETWORK: {
    patterns: [/network/i, /connection/i, /ECONNREFUSED/i, /ETIMEDOUT/i, /ENOTFOUND/i, /socket/i],
    userMessage: '网络连接失败。请检查您的网络连接。',
    type: 'network'
  },
  // Permission errors
  PERMISSION: {
    patterns: [/permission denied/i, /EACCES/i, /not allowed/i],
    userMessage: '权限不足。请检查文件或目录权限。',
    type: 'permission'
  },
  // File/Path errors
  FILE: {
    patterns: [/ENOENT/i, /no such file/i, /file not found/i, /directory not found/i],
    userMessage: '找不到指定的文件或目录。',
    type: 'file'
  },
  // Model errors
  MODEL: {
    patterns: [/model/i, /invalid.*model/i, /not available/i],
    userMessage: '模型不可用或配置错误。',
    type: 'model'
  },
  // Session errors
  SESSION: {
    patterns: [/session/i, /conversation/i, /context/i],
    userMessage: '会话出现问题。',
    type: 'session'
  }
};

/**
 * Classifies error message and returns user-friendly information
 * @param {string} errorMessage - Raw error message from stderr
 * @returns {{type: string, userMessage: string, rawMessage: string}}
 */
function classifyError(errorMessage) {
  const normalizedError = errorMessage.trim();
  
  for (const [key, errorType] of Object.entries(ERROR_TYPES)) {
    for (const pattern of errorType.patterns) {
      if (pattern.test(normalizedError)) {
        return {
          type: errorType.type,
          userMessage: errorType.userMessage,
          rawMessage: normalizedError
        };
      }
    }
  }
  
  // Default: unknown error
  return {
    type: 'unknown',
    userMessage: '发生了一个错误。',
    rawMessage: normalizedError
  };
}

/**
 * Handles image processing for CodeBuddy queries
 * Saves base64 images to temporary files and returns modified prompt with file paths
 * @param {string} command - Original user prompt
 * @param {Array} images - Array of image objects with base64 data
 * @param {string} cwd - Working directory for temp file creation
 * @returns {Promise<Object>} {modifiedCommand, tempImagePaths, tempDir}
 */
async function handleImages(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;

  if (!images || images.length === 0) {
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }

  try {
    // Create temp directory in the project directory
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    // Save each image to a temp file
    for (const [index, image] of images.entries()) {
      // Extract base64 data and mime type
      const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('Invalid image data format');
        continue;
      }

      const [, mimeType, base64Data] = matches;
      const extension = mimeType.split('/')[1] || 'png';
      const filename = `image_${index}.${extension}`;
      const filepath = path.join(tempDir, filename);

      // Write base64 data to file
      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
    }

    // Include the full image paths in the prompt
    let modifiedCommand = command;
    if (tempImagePaths.length > 0 && command && command.trim()) {
      const imageNote = `\n\n[Images provided at the following paths:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      modifiedCommand = command + imageNote;
    }

    console.log(`📸 Processed ${tempImagePaths.length} images to temp directory: ${tempDir}`);
    return { modifiedCommand, tempImagePaths, tempDir };
  } catch (error) {
    console.error('Error processing images for CodeBuddy:', error);
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }
}

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
    let tempImagePaths = [];
    let tempDir = null;
    
    // Debug log for images
    if (images && images.length > 0) {
      console.log('🖼️  [CodeBuddy] Received images:', images.length, 'images');
      console.log('🖼️  [CodeBuddy] Image details:', images.map(img => ({
        name: img.name,
        size: img.size,
        mimeType: img.mimeType,
        dataLength: img.data?.length
      })));
    } else {
      console.log('🖼️  [CodeBuddy] No images received');
    }
    
    // Use tools settings passed from frontend, or defaults
    const settings = toolsSettings || {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false
    };
    
    // Use cwd (actual project directory) instead of projectPath
    // Ensure workingDir is an absolute path
    let workingDir = cwd || projectPath || process.cwd();
    if (!path.isAbsolute(workingDir)) {
      workingDir = path.join('/', workingDir);
    }

    // Handle images - save to temp files and modify prompt (same as Claude SDK)
    const imageResult = await handleImages(command, images, workingDir);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

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

    // Use simple -p mode with modified command (containing image paths)
    if (finalCommand && finalCommand.trim()) {
      // Sanitize command to prevent shell injection and newline issues
      const sanitizedCommand = finalCommand.replace(/\n/g, ' ').replace(/\r/g, '');
      // Note: -p is shorthand for --print, so we use it with the prompt
      // The prompt follows -p directly as its argument
      args.push('-p', sanitizedCommand);

      // Request streaming JSON output
      // Note: -p already enables print mode, so we just need --output-format
      args.push('--output-format', 'stream-json');
      
      // Increase max turns to allow longer conversations with many tool calls
      args.push('--max-turns', '1000');
    }

    // Add model flag if specified (only meaningful for new sessions; harmless on resume)
    if (!sessionId && model && model !== 'default') {
      args.push('--model', model);
    }
    
    // Add tool restrictions if specified (Issue 5 fix)
    if (settings.allowedTools && settings.allowedTools.length > 0) {
      args.push('--allowedTools', settings.allowedTools.join(','));
      console.log('🔧 Allowed tools:', settings.allowedTools.join(','));
    }
    if (settings.disallowedTools && settings.disallowedTools.length > 0) {
      args.push('--disallowedTools', settings.disallowedTools.join(','));
      console.log('🚫 Disallowed tools:', settings.disallowedTools.join(','));
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
    
    // CodeBuddy CLI command
    const codebuddyCmd = 'codebuddy';
    
    console.log('🤖 Spawning CodeBuddy CLI:', codebuddyCmd, args.join(' '));
    console.log('📁 Working directory:', workingDir);
    console.log('🔑 Session info - Input sessionId:', sessionId, 'Resume:', resume);
    if (tempImagePaths.length > 0) {
      console.log('🖼️  Images saved to temp files:', tempImagePaths.length);
    }
    
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
        TERM: 'dumb',
        // Prevent color output from interfering with JSON parsing (Issue 4 fix)
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        // Signal headless mode to CodeBuddy
        CODEBUDDY_HEADLESS: '1'
      }
    });
    
    // Close stdin immediately (no need to write stdin for -p mode)
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
          // console.log('📨 CodeBuddy message:', response.type, response.subtype || '');
          
          // Handle different message types
          switch (response.type) {
            case 'system':
              if (response.subtype === 'init') {
                // Capture session ID
                if (response.session_id) {
                  const newSessionId = response.session_id;
                  
                  // Issue 3 fix: Detect session resume failure
                  // If we requested a specific session but got a different one, resume failed
                  if (sessionId && !sessionId.startsWith('temp-') && sessionId !== newSessionId) {
                    console.warn('⚠️ Session resume failed! Requested:', sessionId, 'Got:', newSessionId);
                    ws.send(JSON.stringify({
                      type: 'session-resume-failed',
                      requestedSessionId: sessionId,
                      newSessionId: newSessionId,
                      message: 'Unable to resume the requested session. A new session has been created.'
                    }));
                  }
                  
                  if (!capturedSessionId) {
                    capturedSessionId = newSessionId;
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
                    // console.log('📤 Sending tool result to frontend:', contentBlock.tool_use_id, 'content length:', String(resultContent).length);
                  }
                }
              }
              break;
              
            case 'assistant':
              // Handle assistant message - may have different content structures
              // console.log('📝 Assistant message content:', JSON.stringify(response.message?.content || response).slice(0, 500));
              
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
                    // console.log('📤 Sending text delta to frontend:', contentBlock.text.slice(0, 100));
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
              // console.log('📋 CodeBuddy result:', JSON.stringify(response).slice(0, 500));
              
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
          // Issue 6 fix: Improved OSC title sequence regex
          // Supports both BEL (\x07) and ST (\x9c) terminators
          const oscTitleMatch = line.match(/\u001b\]0;([^\u0007\u009c]+)[\u0007\u009c]/);
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
    
    // Handle stderr with error classification for user-friendly messages
    codebuddyProcess.stderr.on('data', (data) => {
      const rawError = data.toString();
      console.error('❌ CodeBuddy CLI stderr:', rawError);
      
      // Classify error for user-friendly display
      const classifiedError = classifyError(rawError);
      
      ws.send(JSON.stringify({
        type: 'codebuddy-error',
        error: rawError,
        errorType: classifiedError.type,
        userMessage: classifiedError.userMessage,
        // Include technical details for debugging
        details: {
          raw: classifiedError.rawMessage,
          classified: classifiedError.type !== 'unknown'
        }
      }));
    });
    
    // Handle process completion
    codebuddyProcess.on('close', (code) => {
      // Clean up process reference
      activeCodeBuddyProcesses.delete(capturedSessionId || processKey);
      
      // NOTE: Do NOT clean up temp images here!
      // Images need to persist for session resume/refresh scenarios
      // CodeBuddy may reference these images again when the session is resumed
      
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
      
      // NOTE: Keep temp images even on error - session might be resumed
      
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
