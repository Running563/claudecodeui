/**
 * CodeBuddy SDK Integration
 *
 * This module provides SDK-based integration with CodeBuddy using @tencent-ai/agent-sdk.
 * It mirrors the interface of Claude SDK for consistency.
 *
 * Key features:
 * - Direct SDK integration without child processes
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 * - Background task support (tasks continue even when client disconnects)
 */

import { query } from '@tencent-ai/agent-sdk';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { getProjectByPath, createSession } from './db.js';
import {
  registerTask,
  updateTaskId,
  setAbortFn,
  completeTask,
  isTaskRunning
} from './background-task-manager.js';

// Session tracking: Map of session IDs to active query instances
const activeSessions = new Map();

/**
 * Maps CLI options to SDK-compatible options format
 * @param {Object} options - CLI options
 * @returns {Object} SDK-compatible options
 */
function mapCliOptionsToSDK(options = {}) {
  const { sessionId, cwd, toolsSettings, permissionMode } = options;

  const sdkOptions = {};

  // Map working directory
  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  // Map permission mode
  if (permissionMode && permissionMode !== 'default') {
    sdkOptions.permissionMode = permissionMode;
  }

  // Map tool settings
  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  // Handle tool permissions
  if (settings.skipPermissions && permissionMode !== 'plan') {
    // When skipping permissions, use bypassPermissions mode
    sdkOptions.permissionMode = 'bypassPermissions';
  } else {
    // Map allowed tools
    let allowedTools = [...(settings.allowedTools || [])];

    // Add plan mode default tools
    if (permissionMode === 'plan') {
      const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite'];
      for (const tool of planModeTools) {
        if (!allowedTools.includes(tool)) {
          allowedTools.push(tool);
        }
      }
    }

    if (allowedTools.length > 0) {
      sdkOptions.allowedTools = allowedTools;
    }

    // Map disallowed tools
    if (settings.disallowedTools && settings.disallowedTools.length > 0) {
      sdkOptions.disallowedTools = settings.disallowedTools;
    }
  }

  // Map model (default to claude-4.5)
  // Support both CLI format ('claude-4.5') and UI format ('default')
  let modelValue = options.model || 'default';
  
  // Map 'default' to CLI's default model
  if (modelValue === 'default') {
    modelValue = 'claude-4.5';  // CLI 的默认模型
  }
  
  sdkOptions.model = modelValue;

  // Map system prompt configuration
  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'codebuddy_code'  // CodeBuddy preset for CODEBUDDY.md
  };

  // Map setting sources for CODEBUDDY.md loading
  sdkOptions.settingSources = ['project', 'user', 'local'];

  // Map resume session
  if (sessionId) {
    sdkOptions.resume = sessionId;
  }

  // Map max turns
  sdkOptions.maxTurns = 1000;

  return sdkOptions;
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Array<string>} tempImagePaths - Temp image file paths for cleanup
 * @param {string} tempDir - Temp directory for cleanup
 */
function addSession(sessionId, queryInstance, tempImagePaths = [], tempDir = null) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    tempImagePaths,
    tempDir
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
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
  // SDK messages are already in a format compatible with the frontend
  return sdkMessage;
}

/**
 * Extracts token usage from SDK result messages
 * @param {Object} resultMessage - SDK result message
 * @returns {Object|null} Token budget object or null
 */
function extractTokenBudget(resultMessage) {
  if (resultMessage.type !== 'result' || !resultMessage.usage) {
    return null;
  }

  const usage = resultMessage.usage;

  // Calculate total used tokens
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens || 0;

  const totalUsed = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

  // Use configured context window budget from environment (default 160000)
  const contextWindow = parseInt(process.env.CONTEXT_WINDOW) || 160000;

  console.log(`📊 Token calculation: input=${inputTokens}, output=${outputTokens}, cache=${cacheReadTokens + cacheCreationTokens}, total=${totalUsed}/${contextWindow}`);

  return {
    used: totalUsed,
    total: contextWindow
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
 * Cleans up temporary image files
 * @param {Array<string>} tempImagePaths - Array of temp file paths to delete
 * @param {string} tempDir - Temp directory to remove
 */
async function cleanupTempFiles(tempImagePaths, tempDir) {
  if (!tempImagePaths || tempImagePaths.length === 0) {
    return;
  }

  let cleanedCount = 0;
  try {
    // Delete individual temp files
    for (const imagePath of tempImagePaths) {
      try {
        await fs.unlink(imagePath);
        cleanedCount++;
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`Failed to delete temp image ${imagePath}:`, err.message);
        }
      }
    }

    // Delete temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err.message)
      );
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} temp image files`);
    }
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

/**
 * Cleans up old temporary image directories (older than 24 hours)
 * @param {string} baseDir - Base directory to scan for .tmp/images folders
 */
async function cleanupOldTempImages(baseDir) {
  const tmpImagesDir = path.join(baseDir, '.tmp', 'images');
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  try {
    await fs.access(tmpImagesDir);

    const entries = await fs.readdir(tmpImagesDir, { withFileTypes: true });
    const now = Date.now();
    let cleanedCount = 0;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const timestamp = parseInt(entry.name, 10);
        if (!isNaN(timestamp) && (now - timestamp) > maxAge) {
          const dirPath = path.join(tmpImagesDir, entry.name);
          await fs.rm(dirPath, { recursive: true, force: true });
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} old temp image directories (>24h)`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Error cleaning up old temp images:', err.message);
    }
  }
}

/**
 * Loads MCP server configurations from ~/.codebuddy.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd) {
  try {
    const codebuddyConfigPath = path.join(os.homedir(), '.codebuddy.json');

    // Check if config file exists
    try {
      await fs.access(codebuddyConfigPath);
    } catch (error) {
      console.log('📡 No ~/.codebuddy.json found, proceeding without MCP servers');
      return null;
    }

    // Read and parse config file
    let codebuddyConfig;
    try {
      const configContent = await fs.readFile(codebuddyConfigPath, 'utf8');
      codebuddyConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('❌ Failed to parse ~/.codebuddy.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers = {};

    // Add global MCP servers
    if (codebuddyConfig.mcpServers && typeof codebuddyConfig.mcpServers === 'object') {
      mcpServers = { ...codebuddyConfig.mcpServers };
      console.log(`📡 Loaded ${Object.keys(mcpServers).length} global MCP servers`);
    }

    // Add/override with project-specific MCP servers
    if (codebuddyConfig.codebuddyProjects && cwd) {
      const projectConfig = codebuddyConfig.codebuddyProjects[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        console.log(`📡 Loaded ${Object.keys(projectConfig.mcpServers).length} project-specific MCP servers`);
      }
    }

    // Return null if no servers found
    if (Object.keys(mcpServers).length === 0) {
      console.log('📡 No MCP servers configured');
      return null;
    }

    console.log(`✅ Total MCP servers loaded: ${Object.keys(mcpServers).length}`);
    return mcpServers;
  } catch (error) {
    console.error('❌ Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Spawns a CodeBuddy query using the SDK
 * Tasks continue running in background even if client disconnects.
 * Only manual abort stops the task.
 * 
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function spawnCodeBuddy(command, options = {}, ws) {
  const { sessionId, projectPath } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;
  let queryInstance = null;
  
  // Generate a temporary task ID for new sessions
  const tempTaskId = sessionId || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Register background task
  registerTask(tempTaskId, 'codebuddy', projectPath, null);

  // Helper: 安全发送消息（忽略断开的连接）
  const safeSend = (data) => {
    try {
      if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
        ws.send(data);
      }
    } catch (e) {
      // 连接已断开，忽略发送错误
    }
  };

  try {
    // Map CLI options to SDK format
    const sdkOptions = mapCliOptionsToSDK(options);

    // Load MCP configuration
    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }

    // Handle images - save to temp files and modify prompt
    const imageResult = await handleImages(command, options.images, options.cwd);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    console.log('🤖 Starting CodeBuddy SDK query');
    console.log('📁 Working directory:', options.cwd);
    console.log('🔑 Session info - Input sessionId:', sessionId);
    if (tempImagePaths.length > 0) {
      console.log('🖼️  Images saved to temp files:', tempImagePaths.length);
    }

    // Create SDK query instance
    queryInstance = query({
      prompt: finalCommand,
      options: sdkOptions
    });

    // Track the query instance for abort capability
    if (capturedSessionId) {
      addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir);
    }
    
    // 设置 abort 函数
    // 注意：interrupt() 可能会抛出 "Session not found" 错误，这是 SDK 内部的异步错误
    // 需要安全地处理，避免导致进程崩溃
    setAbortFn(tempTaskId, async () => {
      if (queryInstance) {
        try {
          // 给 interrupt 一个超时，防止无限等待
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Interrupt timeout')), 5000)
          );
          await Promise.race([
            queryInstance.interrupt(),
            timeoutPromise
          ]);
        } catch (interruptError) {
          // Ignore "Session not found" errors - session may have already completed
          // Also ignore timeout errors - we tried our best
          const errorMsg = interruptError.message || '';
          if (!errorMsg.includes('Session not found') && !errorMsg.includes('Interrupt timeout')) {
            console.error(`Error calling interrupt() in abort handler:`, errorMsg);
          }
        }
      }
    });

    // Process streaming messages
    console.log('🔄 Starting async generator loop for session:', capturedSessionId || 'NEW');
    for await (const message of queryInstance) {
      // Check if task is still running (may have been aborted)
      if (!isTaskRunning(capturedSessionId || tempTaskId)) {
        console.log('🛑 Task was aborted, stopping message processing');
        break;
      }
      
      // Handle different message types
      if (message.type === 'system' && message.subtype === 'init') {
        // Capture session ID
        if (message.session_id) {
          const newSessionId = message.session_id;
          
          // Detect session resume failure
          if (sessionId && !sessionId.startsWith('temp-') && sessionId !== newSessionId) {
            console.warn('⚠️ Session resume failed! Requested:', sessionId, 'Got:', newSessionId);
            safeSend(JSON.stringify({
              type: 'session-resume-failed',
              requestedSessionId: sessionId,
              newSessionId: newSessionId,
              message: 'Unable to resume the requested session. A new session has been created.'
            }));
          }
          
          if (!capturedSessionId) {
            capturedSessionId = newSessionId;
            addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir);
            
            // Update task ID in background manager
            updateTaskId(tempTaskId, capturedSessionId);

            // Send session-created event only once for new sessions
            if (!sessionId && !sessionCreatedSent) {
              sessionCreatedSent = true;
              
              // Save session to database
              try {
                const project = getProjectByPath(projectPath);
                if (project) {
                  createSession(project.id, capturedSessionId, 'codebuddy', null, null);
                  console.log('✅ [CodeBuddy SDK] Session saved to database:', capturedSessionId);
                }
              } catch (dbError) {
                console.error('❌ [CodeBuddy SDK] Failed to save session to database:', dbError);
              }
              
              safeSend(JSON.stringify({
                type: 'session-created',
                sessionId: capturedSessionId,
                model: message.model,
                cwd: message.cwd
              }));
            }
          }
        }
      }

      // Transform and send message
      const transformedMessage = transformMessage(message);
      safeSend(JSON.stringify({
        type: 'session-response',
        data: transformedMessage,
        sessionId: capturedSessionId  // Include sessionId for session isolation
      }));

      // Extract and send token budget updates from result messages
      if (message.type === 'result') {
        const tokenBudget = extractTokenBudget(message);
        if (tokenBudget) {
          console.log('📊 Token budget from usage:', tokenBudget);
          safeSend(JSON.stringify({
            type: 'token-budget',
            data: tokenBudget
          }));
        }
      }
    }

    // Clean up session on completion
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Mark background task as completed
    completeTask(capturedSessionId || tempTaskId);

    // Send completion event
    console.log('✅ Streaming complete, sending session-complete event');
    safeSend(JSON.stringify({
      type: 'session-complete',
      sessionId: capturedSessionId,
      exitCode: 0,
      isNewSession: !sessionId && !!command,
      provider: 'codebuddy'
    }));

  } catch (error) {
    // Check if this is an abort-related error (Session not found during interrupt)
    const isAbortError = error.message?.includes('Session not found');
    
    if (isAbortError) {
      console.log('🛑 Session was interrupted/aborted:', error.message);
    } else {
      console.error('CodeBuddy SDK query error:', error);
    }

    // Clean up session on error
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Mark background task as completed (with error)
    completeTask(capturedSessionId || tempTaskId);

    // Send appropriate event based on error type
    if (isAbortError) {
      safeSend(JSON.stringify({
        type: 'session-aborted',
        sessionId: capturedSessionId,
        provider: 'codebuddy'
      }));
    } else {
      // Send error
      safeSend(JSON.stringify({
        type: 'session-error',
        sessionId: capturedSessionId,
        error: error.message,
        provider: 'codebuddy'
      }));
    }
    
    // Don't re-throw abort errors - they are expected during interruption
    if (!isAbortError) {
      throw error;
    }
  }
}

/**
 * Aborts an active CodeBuddy session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortCodeBuddySession(sessionId) {
  const session = getSession(sessionId);

  if (!session && !isTaskRunning(sessionId)) {
    console.log(`⚠️ CodeBuddy session ${sessionId} not found`);
    return false;
  }

  try {
    console.log(`🛑 Aborting CodeBuddy session: ${sessionId}`);

    // Update session status
    if (session) {
      session.status = 'aborted';
    }

    // Clean up session
    removeSession(sessionId);
    
    // Abort via background task manager (which calls the registered abortFn with interrupt())
    // Note: Don't call interrupt() directly here to avoid calling it twice
    const { abortTask } = await import('./background-task-manager.js');
    await abortTask(sessionId);

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
  return getAllSessions();
}

// Export public API
export {
  spawnCodeBuddy,
  abortCodeBuddySession,
  isCodeBuddySessionActive,
  getActiveCodeBuddySessions,
  cleanupOldTempImages
};
