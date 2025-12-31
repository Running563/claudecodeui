#!/usr/bin/env node
// Load environment variables from .env file
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    ok: (text) => `${colors.green}${text}${colors.reset}`,
    warn: (text) => `${colors.yellow}${text}${colors.reset}`,
    tip: (text) => `${colors.blue}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

try {
    const envPath = path.join(__dirname, '../.env');
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            const [key, ...valueParts] = trimmedLine.split('=');
            if (key && valueParts.length > 0 && !process.env[key]) {
                process.env[key] = valueParts.join('=').trim();
            }
        }
    });
} catch (e) {
    console.log('No .env file found or error reading it:', e.message);
}

console.log('PORT from env:', process.env.PORT);

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import http from 'http';
import cors from 'cors';
import { promises as fsPromises } from 'fs';
import { spawn } from 'child_process';
import pty from 'node-pty';
import fetch from 'node-fetch';
import mime from 'mime-types';
import multer from 'multer';

import { getProjects, getSessions, getSessionMessages, renameProject, deleteSession, deleteProject, addProjectManually, extractProjectDirectory, clearProjectDirectoryCache } from './projects.js';
import { getProjectById, getProjectsWithSessions, deleteSessionBySessionId } from './db.js';
import { queryClaudeSDK, abortClaudeSDKSession, isClaudeSDKSessionActive, getActiveClaudeSDKSessions } from './claude-sdk.js';
import { spawnCursor, abortCursorSession, isCursorSessionActive, getActiveCursorSessions } from './cursor-cli.js';
// Use SDK-style CodeBuddy integration (similar to Cursor CLI)
import { spawnCodeBuddy, abortCodeBuddySession, isCodeBuddySessionActive, getActiveCodeBuddySessions } from './codebuddy-sdk.js';
// Background task manager for persistent tasks
import { 
    getRunningTasks, 
    getTasksByProject,
    isTaskRunning 
} from './background-task-manager.js';
import gitRoutes from './routes/git.js';
import authRoutes from './routes/auth.js';
import mcpRoutes from './routes/mcp.js';
import cursorRoutes from './routes/cursor.js';
import mcpUtilsRoutes from './routes/mcp-utils.js';
import commandsRoutes from './routes/commands.js';
import settingsRoutes from './routes/settings.js';
import agentRoutes from './routes/agent.js';
import projectsRoutes from './routes/projects.js';
import cliAuthRoutes from './routes/cli-auth.js';
import userRoutes from './routes/user.js';
import terminalsRoutes from './routes/terminals.js';
import dbRoutes from './routes/db.js';
import { quickTerminals, setPtySessionsMap } from './routes/terminals.js';
import { initializeDatabase } from './database/db.js';
import { initDatabase as initProjectsDb } from './db.js';
import { validateApiKey, authenticateToken, authenticateWebSocket } from './middleware/auth.js';

// Resolve project path from database ID
function resolveProjectPath(projectId) {
  const project = getProjectById(parseInt(projectId, 10));
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  return project.original_path;
}

// Convert project ID to directory name format for projects.js
// Returns: { path: '/data/codes/stock-quant', dirName: '-data-codes-stock-quant' }
function resolveProjectInfo(projectId) {
  const project = getProjectById(parseInt(projectId, 10));
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  const projectPath = project.original_path;
  // /data/codes/stock-quant -> -data-codes-stock-quant
  const dirName = '-' + projectPath.replace(/^\//, '').replace(/\//g, '-');
  return { path: projectPath, dirName };
}

// File system watcher for projects folder
let projectsWatcher = null;
const connectedClients = new Set();

// Setup file system watcher for Claude and CodeBuddy projects folders using chokidar
async function setupProjectsWatcher() {
    const chokidar = (await import('chokidar')).default;
    const claudeProjectsPath = path.join(process.env.HOME, '.claude', 'projects');
    // NOTE: We intentionally do NOT watch .codebuddy/projects because CodeBuddy CLI
    // writes session files during the conversation, which triggers projects_updated
    // messages that can interfere with the active chat session.
    // CodeBuddy sessions are refreshed via explicit API calls after completion instead.

    if (projectsWatcher) {
        projectsWatcher.close();
    }

    try {
        // Only watch Claude projects directory (not CodeBuddy)
        const watchPaths = [claudeProjectsPath];
        
        // Initialize chokidar watcher with optimized settings
        projectsWatcher = chokidar.watch(watchPaths, {
            ignored: [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/build/**',
                '**/*.tmp',
                '**/*.swp',
                '**/.DS_Store'
            ],
            persistent: true,
            ignoreInitial: true, // Don't fire events for existing files on startup
            followSymlinks: false,
            depth: 10, // Reasonable depth limit
            awaitWriteFinish: {
                stabilityThreshold: 100, // Wait 100ms for file to stabilize
                pollInterval: 50
            }
        });

        // Debounce function to prevent excessive notifications
        let debounceTimer;
        const debouncedUpdate = async (eventType, filePath) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                try {

                    // Clear project directory cache when files change
                    clearProjectDirectoryCache();

                    // Get updated projects list
                    const updatedProjects = await getProjects();

                    // Since we only watch Claude projects now, provider is always 'claude'
                    const basePath = claudeProjectsPath;
                    
                    // Notify all connected clients about the project changes
                    const updateMessage = JSON.stringify({
                        type: 'projects_updated',
                        projects: updatedProjects,
                        timestamp: new Date().toISOString(),
                        changeType: eventType,
                        changedFile: path.relative(basePath, filePath),
                        provider: 'claude'
                    });

                    connectedClients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(updateMessage);
                        }
                    });

                } catch (error) {
                    console.error('[ERROR] Error handling project changes:', error);
                }
            }, 300); // 300ms debounce (slightly faster than before)
        };

        // Set up event listeners
        projectsWatcher
            .on('add', (filePath) => debouncedUpdate('add', filePath))
            .on('change', (filePath) => debouncedUpdate('change', filePath))
            .on('unlink', (filePath) => debouncedUpdate('unlink', filePath))
            .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath))
            .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath))
            .on('error', (error) => {
                console.error('[ERROR] Chokidar watcher error:', error);
            })
            .on('ready', () => {
            });

    } catch (error) {
        console.error('[ERROR] Failed to setup projects watcher:', error);
    }
}


const app = express();
const server = http.createServer(app);

const ptySessionsMap = new Map();
const PTY_SESSION_TIMEOUT = 30 * 60 * 1000;

// Set ptySessionsMap reference for terminals.js to use
setPtySessionsMap(ptySessionsMap);

// Single WebSocket server that handles both paths
const wss = new WebSocketServer({
    server,
    verifyClient: (info) => {
        console.log('WebSocket connection attempt to:', info.req.url);

        // Platform mode: always allow connection
        if (process.env.VITE_IS_PLATFORM === 'true') {
            const user = authenticateWebSocket(null); // Will return first user
            if (!user) {
                console.log('[WARN] Platform mode: No user found in database');
                return false;
            }
            info.req.user = user;
            console.log('[OK] Platform mode WebSocket authenticated for user:', user.username);
            return true;
        }

        // Normal mode: verify token
        // Extract token from query parameters or headers
        const url = new URL(info.req.url, 'http://localhost');
        const token = url.searchParams.get('token') ||
            info.req.headers.authorization?.split(' ')[1];

        // Verify token
        const user = authenticateWebSocket(token);
        if (!user) {
            console.log('[WARN] WebSocket authentication failed');
            return false;
        }

        // Store user info in the request for later use
        info.req.user = user;
        console.log('[OK] WebSocket authenticated for user:', user.username);
        return true;
    }
});

// Make WebSocket server available to routes
app.locals.wss = wss;

// CORS must be applied BEFORE any route handlers
app.use(cors());

// Configure multer for image uploads (before express.json middleware)
const imageUploadStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path.join(os.tmpdir(), 'claude-ui-uploads', String(req.user?.id || 'anonymous'));
        await fsPromises.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, uniqueSuffix + '-' + sanitizedName);
    }
});

const imageUploadFilter = (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
    }
};

const imageUpload = multer({
    storage: imageUploadStorage,
    fileFilter: imageUploadFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 5
    }
});

// Image upload endpoint - MUST be defined BEFORE express.json() middleware
// because multer needs to handle multipart/form-data before JSON parsing
app.post('/api/projects/:projectId/upload-images', authenticateToken, (req, res, next) => {
    // Use multer with error handling
    imageUpload.array('images', 5)(req, res, (err) => {
        if (err) {
            console.error('Image upload error:', err.message);
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
                }
                if (err.code === 'LIMIT_FILE_COUNT') {
                    return res.status(400).json({ error: 'Too many files. Maximum is 5 files.' });
                }
                return res.status(400).json({ error: `Upload error: ${err.message}` });
            }
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}, async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No image files provided' });
    }

    try {
        // Process uploaded images
        const processedImages = await Promise.all(
            req.files.map(async (file) => {
                // Read file and convert to base64
                const buffer = await fsPromises.readFile(file.path);
                const base64 = buffer.toString('base64');
                const mimeType = file.mimetype;

                // Clean up temp file immediately
                await fsPromises.unlink(file.path);

                return {
                    name: file.originalname,
                    data: `data:${mimeType};base64,${base64}`,
                    size: file.size,
                    mimeType: mimeType
                };
            })
        );

        res.json({ images: processedImages });
    } catch (error) {
        console.error('Error processing images:', error);
        // Clean up any remaining files
        if (req.files) {
            await Promise.all(req.files.map(f => fsPromises.unlink(f.path).catch(() => { })));
        }
        res.status(500).json({ error: 'Failed to process images' });
    }
});

// JSON body parser (AFTER image upload endpoint)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Public health check endpoint (no authentication required)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// Projects API Routes (protected)
app.use('/api/projects', authenticateToken, projectsRoutes);

// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);

// MCP API Routes (protected)
app.use('/api/mcp', authenticateToken, mcpRoutes);

// Cursor API Routes (protected)
app.use('/api/cursor', authenticateToken, cursorRoutes);

// MCP utilities
app.use('/api/mcp-utils', authenticateToken, mcpUtilsRoutes);

// Commands API Routes (protected)
app.use('/api/commands', authenticateToken, commandsRoutes);

// Settings API Routes (protected)
app.use('/api/settings', authenticateToken, settingsRoutes);

// CLI Authentication API Routes (protected)
app.use('/api/cli', authenticateToken, cliAuthRoutes);

// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);

// Terminals API Routes (protected)
app.use('/api/terminals', authenticateToken, terminalsRoutes);

// Database API Routes (protected)
app.use('/api/db', dbRoutes);

// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);

// Serve public files (like api-docs.html)
app.use(express.static(path.join(__dirname, '../public')));

// Static files served after API routes
// Add cache control: HTML files should not be cached, but assets can be cached
app.use(express.static(path.join(__dirname, '../dist'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      // Prevent HTML caching to avoid service worker issues after builds
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
      // Cache static assets for 1 year (they have hashed names)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// API Routes (protected)
// /api/config endpoint removed - no longer needed
// Frontend now uses window.location for WebSocket URLs



app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        // 直接从数据库查询项目和会话
        const projects = getProjectsWithSessions(10);
        res.json(projects);
    } catch (error) {
        console.error('[API] Error fetching projects:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectId/sessions', authenticateToken, async (req, res) => {
    try {
        const { limit = 5, offset = 0 } = req.query;
        const { dirName } = resolveProjectInfo(req.params.projectId);
        const result = await getSessions(dirName, parseInt(limit), parseInt(offset));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get messages for a specific session
app.get('/api/projects/:projectId/sessions/:sessionId/messages', authenticateToken, async (req, res) => {
    try {
        const { projectId, sessionId } = req.params;
        const { limit, offset } = req.query;
        
        // Get project directory name from database ID
        const { dirName } = resolveProjectInfo(projectId);
        
        // Parse limit and offset if provided
        const parsedLimit = limit ? parseInt(limit, 10) : null;
        const parsedOffset = offset ? parseInt(offset, 10) : 0;
        
        const result = await getSessionMessages(dirName, sessionId, parsedLimit, parsedOffset);
        
        // Handle both old and new response formats
        if (Array.isArray(result)) {
            res.json({ messages: result });
        } else {
            res.json(result);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rename project endpoint
app.put('/api/projects/:projectId/rename', authenticateToken, async (req, res) => {
    try {
        const { displayName } = req.body;
        const { dirName } = resolveProjectInfo(req.params.projectId);
        await renameProject(dirName, displayName);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete session endpoint
app.delete('/api/projects/:projectId/sessions/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { projectId, sessionId } = req.params;
        const { dirName } = resolveProjectInfo(projectId);
        console.log(`[API] Deleting session: ${sessionId} from project: ${dirName}`);
        // 1. 删除磁盘文件
        await deleteSession(dirName, sessionId);
        // 2. 删除数据库记录
        deleteSessionBySessionId(sessionId);
        console.log(`[API] Session ${sessionId} deleted successfully`);
        res.json({ success: true });
    } catch (error) {
        console.error(`[API] Error deleting session ${req.params.sessionId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Delete project endpoint (only if empty)
app.delete('/api/projects/:projectId', authenticateToken, async (req, res) => {
    try {
        const { dirName } = resolveProjectInfo(req.params.projectId);
        await deleteProject(dirName);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create project endpoint
app.post('/api/projects/create', authenticateToken, async (req, res) => {
    try {
        const { path: projectPath } = req.body;

        if (!projectPath || !projectPath.trim()) {
            return res.status(400).json({ error: 'Project path is required' });
        }

        const project = await addProjectManually(projectPath.trim());
        res.json({ success: true, project });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: error.message });
    }
});

// Browse filesystem endpoint for project suggestions - uses existing getFileTree
app.get('/api/browse-filesystem', authenticateToken, async (req, res) => {    
    try {
        const { path: dirPath } = req.query;
        
        // Default to home directory if no path provided
        const homeDir = os.homedir();
        let targetPath = dirPath ? dirPath.replace('~', homeDir) : homeDir;
        
        // Resolve and normalize the path
        targetPath = path.resolve(targetPath);
        
        // Security check - ensure path is accessible
        try {
            await fs.promises.access(targetPath);
            const stats = await fs.promises.stat(targetPath);
            
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Path is not a directory' });
            }
        } catch (err) {
            return res.status(404).json({ error: 'Directory not accessible' });
        }
        
        // Use existing getFileTree function with shallow depth (only direct children)
        const fileTree = await getFileTree(targetPath, 1, 0, false); // maxDepth=1, showHidden=false
        
        // Filter only directories and format for suggestions
        const directories = fileTree
            .filter(item => item.type === 'directory')
            .map(item => ({
                path: item.path,
                name: item.name,
                type: 'directory'
            }))
            .slice(0, 20); // Limit results
            
        // Add common directories if browsing home directory
        const suggestions = [];
        if (targetPath === homeDir) {
            const commonDirs = ['Desktop', 'Documents', 'Projects', 'Development', 'Dev', 'Code', 'workspace'];
            const existingCommon = directories.filter(dir => commonDirs.includes(dir.name));
            const otherDirs = directories.filter(dir => !commonDirs.includes(dir.name));
            
            suggestions.push(...existingCommon, ...otherDirs);
        } else {
            suggestions.push(...directories);
        }
        
        res.json({ 
            path: targetPath,
            suggestions: suggestions 
        });
        
    } catch (error) {
        console.error('Error browsing filesystem:', error);
        res.status(500).json({ error: 'Failed to browse filesystem' });
    }
});

// Read file content endpoint
app.get('/api/projects/:projectId/file', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { filePath } = req.query;

        console.log('[DEBUG] File read request:', projectId, filePath);

        // Security: ensure the requested path is inside the project root
        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        let projectRoot;
        try {
            projectRoot = resolveProjectPath(projectId);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }

        // Handle both absolute and relative paths
        const resolved = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(projectRoot, filePath);
        const normalizedRoot = path.resolve(projectRoot) + path.sep;
        if (!resolved.startsWith(normalizedRoot)) {
            return res.status(403).json({ error: 'Path must be under project root' });
        }

        const content = await fsPromises.readFile(resolved, 'utf8');
        res.json({ content, path: resolved });
    } catch (error) {
        console.error('Error reading file:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File not found' });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Serve binary file content endpoint (for images, etc.)
app.get('/api/projects/:projectId/files/content', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { path: filePath } = req.query;

        console.log('[DEBUG] Binary file serve request:', projectId, filePath);

        // Security: ensure the requested path is inside the project root
        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        let projectRoot;
        try {
            projectRoot = resolveProjectPath(projectId);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }

        const resolved = path.resolve(filePath);
        const normalizedRoot = path.resolve(projectRoot) + path.sep;
        if (!resolved.startsWith(normalizedRoot)) {
            return res.status(403).json({ error: 'Path must be under project root' });
        }

        // Check if file exists
        try {
            await fsPromises.access(resolved);
        } catch (error) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Get file extension and set appropriate content type
        const mimeType = mime.lookup(resolved) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);

        // Stream the file
        const fileStream = fs.createReadStream(resolved);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            console.error('Error streaming file:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error reading file' });
            }
        });

    } catch (error) {
        console.error('Error serving binary file:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// Serve temporary image files (for chat image display)
// Only allows access to .tmp/images/ directories for security
app.get('/api/temp-image', authenticateToken, async (req, res) => {
    try {
        const { path: imagePath } = req.query;

        if (!imagePath) {
            return res.status(400).json({ error: 'Invalid image path' });
        }

        // Security: only allow paths containing .tmp/images/
        if (!imagePath.includes('.tmp/images/') && !imagePath.includes('.tmp\\images\\')) {
            return res.status(403).json({ error: 'Access denied: only temp images allowed' });
        }

        const resolved = path.resolve(imagePath);

        // Additional security: verify the path still contains .tmp/images after resolution
        if (!resolved.includes('.tmp/images/') && !resolved.includes('.tmp\\images\\')) {
            return res.status(403).json({ error: 'Access denied: path traversal detected' });
        }

        // Check if file exists
        try {
            await fsPromises.access(resolved);
        } catch (error) {
            return res.status(404).json({ error: 'Image not found' });
        }

        // Get file extension and set appropriate content type
        const mimeType = mime.lookup(resolved) || 'image/png';
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

        // Stream the file
        const fileStream = fs.createReadStream(resolved);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            console.error('Error streaming temp image:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error reading image' });
            }
        });

    } catch (error) {
        console.error('Error serving temp image:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// Save file content endpoint
app.put('/api/projects/:projectId/file', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { filePath, content } = req.body;

        console.log('[DEBUG] File save request:', projectId, filePath);

        // Security: ensure the requested path is inside the project root
        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        if (content === undefined) {
            return res.status(400).json({ error: 'Content is required' });
        }

        let projectRoot;
        try {
            projectRoot = resolveProjectPath(projectId);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }

        // Handle both absolute and relative paths
        const resolved = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(projectRoot, filePath);
        const normalizedRoot = path.resolve(projectRoot) + path.sep;
        if (!resolved.startsWith(normalizedRoot)) {
            return res.status(403).json({ error: 'Path must be under project root' });
        }

        // Write the new content
        await fsPromises.writeFile(resolved, content, 'utf8');

        res.json({
            success: true,
            path: resolved,
            message: 'File saved successfully'
        });
    } catch (error) {
        console.error('Error saving file:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

app.get('/api/projects/:projectId/files', authenticateToken, async (req, res) => {
    try {
        // Resolve project path (requires database ID)
        let actualPath;
        try {
            actualPath = resolveProjectPath(req.params.projectId);
        } catch (error) {
            console.error('Error resolving project path:', error);
            return res.status(400).json({ error: error.message });
        }

        // Check if path exists
        try {
            await fsPromises.access(actualPath);
        } catch (e) {
            return res.status(404).json({ error: `Project path not found: ${actualPath}` });
        }

        // Support lazy loading: depth=1 for single level, or full tree for search
        const depth = parseInt(req.query.depth) || 1;
        const subPath = req.query.path ? decodeURIComponent(req.query.path) : null;
        
        // Target directory: project root or specified subdirectory
        let targetPath = actualPath;
        if (subPath) {
            targetPath = path.join(actualPath, subPath);
            // Security: ensure path is within project
            if (!targetPath.startsWith(actualPath)) {
                return res.status(403).json({ error: 'Access denied: path outside project' });
            }
        }

        const files = await getFileTree(targetPath, depth, 0, true);
        res.json(files);
    } catch (error) {
        console.error('[ERROR] File tree error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// WebSocket connection handler that routes based on URL path
wss.on('connection', (ws, request) => {
    const url = request.url;
    console.log('[INFO] Client connected to:', url);

    // Parse URL to get pathname without query parameters
    const urlObj = new URL(url, 'http://localhost');
    const pathname = urlObj.pathname;

    if (pathname === '/shell') {
        handleShellConnection(ws);
    } else if (pathname === '/ws') {
        handleChatConnection(ws);
    } else {
        console.log('[WARN] Unknown WebSocket path:', pathname);
        ws.close();
    }
});

// Handle chat WebSocket connections
function handleChatConnection(ws) {
    console.log('[INFO] Chat WebSocket connected');
    
    // Add unique ID for debugging
    const wsId = Math.random().toString(36).substring(7);
    ws.id = wsId;
    
    // Track current session for this connection (for disconnect handling)
    let currentSessionId = null;
    let currentProvider = null;

    // Add to connected clients for project updates
    connectedClients.add(ws);

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'claude-command') {
                console.log('[DEBUG] User message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', data.options?.projectPath || 'Unknown');
                console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
                
                // Track current session for disconnect handling
                currentSessionId = data.options?.sessionId;
                currentProvider = 'claude';

                // Use Claude Agents SDK
                await queryClaudeSDK(data.command, data.options, ws);
            } else if (data.type === 'cursor-command') {
                console.log('[DEBUG] Cursor message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', data.options?.cwd || 'Unknown');
                console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
                console.log('🤖 Model:', data.options?.model || 'default');
                
                currentSessionId = data.options?.sessionId;
                currentProvider = 'cursor';
                
                await spawnCursor(data.command, data.options, ws);
            } else if (data.type === 'codebuddy-command') {
                console.log('[DEBUG] CodeBuddy message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', data.options?.cwd || 'Unknown');
                console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
                console.log('🤖 Model:', data.options?.model || 'default');
                
                currentSessionId = data.options?.sessionId;
                currentProvider = 'codebuddy';
                
                await spawnCodeBuddy(data.command, data.options, ws);
            } else if (data.type === 'cursor-resume') {
                // Backward compatibility: treat as cursor-command with resume and no prompt
                console.log('[DEBUG] Cursor resume session (compat):', data.sessionId);
                currentSessionId = data.sessionId;
                currentProvider = 'cursor';
                
                await spawnCursor('', {
                    sessionId: data.sessionId,
                    resume: true,
                    cwd: data.options?.cwd
                }, ws);
            } else if (data.type === 'abort-session') {
                console.log('[DEBUG] Abort session request:', data.sessionId);
                const provider = data.provider || 'claude';
                let success;

                if (provider === 'cursor') {
                    success = abortCursorSession(data.sessionId);
                } else if (provider === 'codebuddy') {
                    success = abortCodeBuddySession(data.sessionId);
                } else {
                    // Use Claude Agents SDK
                    success = await abortClaudeSDKSession(data.sessionId);
                }

                ws.send(JSON.stringify({
                    type: 'session-aborted',
                    sessionId: data.sessionId,
                    provider,
                    success
                }));
            } else if (data.type === 'cursor-abort') {
                console.log('[DEBUG] Abort Cursor session:', data.sessionId);
                const success = abortCursorSession(data.sessionId);
                ws.send(JSON.stringify({
                    type: 'session-aborted',
                    sessionId: data.sessionId,
                    provider: 'cursor',
                    success
                }));
            } else if (data.type === 'check-session-status') {
                // Check if a specific session is currently processing
                const provider = data.provider || 'claude';
                const sessionId = data.sessionId;
                let isActive;

                if (provider === 'cursor') {
                    isActive = isCursorSessionActive(sessionId);
                } else if (provider === 'codebuddy') {
                    isActive = isCodeBuddySessionActive(sessionId);
                } else {
                    // Use Claude Agents SDK - also check background tasks
                    isActive = isClaudeSDKSessionActive(sessionId) || isTaskRunning(sessionId);
                }

                ws.send(JSON.stringify({
                    type: 'session-status',
                    sessionId,
                    provider,
                    isProcessing: isActive
                }));
            } else if (data.type === 'get-active-sessions') {
                // Get all currently active sessions
                const activeSessions = {
                    claude: getActiveClaudeSDKSessions(),
                    cursor: getActiveCursorSessions(),
                    codebuddy: getActiveCodeBuddySessions()
                };
                ws.send(JSON.stringify({
                    type: 'active-sessions',
                    sessions: activeSessions
                }));
            } else if (data.type === 'get-running-tasks') {
                // Get all running background tasks
                const runningTasks = getRunningTasks();
                ws.send(JSON.stringify({
                    type: 'running-tasks',
                    tasks: runningTasks
                }));
            } else if (data.type === 'get-project-tasks') {
                // Get tasks for a specific project
                const projectTasks = getTasksByProject(data.projectPath);
                ws.send(JSON.stringify({
                    type: 'project-tasks',
                    projectPath: data.projectPath,
                    tasks: projectTasks
                }));
            }
        } catch (error) {
            console.error('[ERROR] Chat WebSocket error:', error.message);
            ws.send(JSON.stringify({
                type: 'error',
                error: error.message
            }));
        }
    });

    ws.on('close', () => {
        console.log('🔌 Chat client disconnected, ID:', ws.id || 'unknown');
        // Remove from connected clients
        connectedClients.delete(ws);
        // Note: Tasks continue running in background, no need to mark disconnected
    });
}

// Handle shell WebSocket connections
function handleShellConnection(ws) {
    console.log('🐚 Shell client connected');
    let shellProcess = null;
    let ptySessionKey = null;
    let outputBuffer = [];

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Shell message received:', data.type);

            if (data.type === 'init') {
                const projectPath = data.projectPath || os.homedir();
                const sessionId = data.sessionId;
                const hasSession = data.hasSession;
                const provider = data.provider || 'claude';
                const initialCommand = data.initialCommand;
                const isQuickTerminal = provider === 'quick-terminal';
                const isPlainShell = data.isPlainShell || (!!initialCommand && !hasSession) || provider === 'plain-shell' || isQuickTerminal;
                
                // Check if this quick terminal has keepAlive enabled
                let isKeepAlive = false;
                if (isQuickTerminal && sessionId) {
                    const terminal = quickTerminals.get(sessionId);
                    if (terminal && terminal.keepAlive) {
                        isKeepAlive = true;
                    }
                }
                
                // Log received dimensions from client
                console.log('📐 Received dimensions from client:', data.cols, 'x', data.rows);

                // Different PTY session key format for quick terminals
                ptySessionKey = isQuickTerminal 
                    ? `terminal_${sessionId}_${projectPath}`
                    : `${projectPath}_${sessionId || 'default'}`;

                const existingSession = ptySessionsMap.get(ptySessionKey);
                if (existingSession) {
                    console.log('♻️  Reconnecting to existing PTY session:', ptySessionKey);
                    shellProcess = existingSession.pty;

                    clearTimeout(existingSession.timeoutId);
                    
                    // Resize PTY to match client dimensions on reconnect
                    if (data.cols && data.rows && shellProcess && shellProcess.resize) {
                        console.log('📐 Resizing PTY on reconnect:', data.cols, 'x', data.rows);
                        shellProcess.resize(data.cols, data.rows);
                    }

                    // Send buffered history as a single batch for efficient rendering
                    if (existingSession.buffer && existingSession.buffer.length > 0) {
                        console.log(`📜 Sending ${existingSession.buffer.length} buffered messages as batch`);
                        
                        // Combine all buffered data into one string
                        const combinedHistory = existingSession.buffer.join('');
                        
                        // Send as history-batch type (front-end will buffer until history-complete)
                        ws.send(JSON.stringify({
                            type: 'history-batch',
                            data: combinedHistory
                        }));
                    }
                    
                    // Only show reconnection message for non-quick terminals
                    if (!isQuickTerminal) {
                        ws.send(JSON.stringify({
                            type: 'history-batch',
                            data: `\x1b[36m[Reconnected to existing session]\x1b[0m\r\n`
                        }));
                    }
                    
                    // Signal that history loading is complete - front-end can now render
                    ws.send(JSON.stringify({
                        type: 'history-complete'
                    }));

                    existingSession.ws = ws;

                    return;
                }

                console.log('[INFO] Starting shell in:', projectPath);
                console.log('📋 Session info:', hasSession ? `Resume session ${sessionId}` : (isPlainShell ? 'Plain shell mode' : '新会话'));
                console.log('🤖 Provider:', isQuickTerminal ? 'quick-terminal' : (isPlainShell ? 'plain-shell' : provider));
                if (initialCommand) {
                    console.log('⚡ Initial command:', initialCommand);
                }

                // First send a welcome message
                let welcomeMsg;
                if (isQuickTerminal) {
                    // Quick terminal: no welcome message, clean start
                    welcomeMsg = '';
                } else if (isPlainShell) {
                    welcomeMsg = `\x1b[36mStarting terminal in: ${projectPath}\x1b[0m\r\n`;
                } else {
                    const providerName = provider === 'cursor' ? 'Cursor' : (provider === 'codebuddy' ? 'CodeBuddy' : 'Claude');
                    welcomeMsg = hasSession ?
                        `\x1b[36mResuming ${providerName} session ${sessionId} in: ${projectPath}\x1b[0m\r\n` :
                        `\x1b[36mStarting new ${providerName} session in: ${projectPath}\x1b[0m\r\n`;
                }

                if (welcomeMsg) {
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: welcomeMsg
                    }));
                }

                try {
                    // Prepare the shell command adapted to the platform and provider
                    let shellCommand;
                    if (isQuickTerminal) {
                        // Quick terminal mode - just start an interactive shell in the directory
                        // Always disable shell timeout for quick terminals to prevent auto-exit
                        if (os.platform() === 'win32') {
                            shellCommand = `Set-Location -Path "${projectPath}"`;
                        } else {
                            // Use PROMPT_COMMAND to continuously reset TMOUT (prevents .bashrc/.zshrc from re-enabling it)
                            // Also set IGNOREEOF to prevent accidental Ctrl+D exit
                            shellCommand = `cd "${projectPath}" && export TMOUT=0 && export IGNOREEOF=10 && export AUTOLOGOUT=0 && export PROMPT_COMMAND='TMOUT=0' && exec $SHELL`;
                        }
                    } else if (isPlainShell) {
                        // Plain shell mode - just run the initial command in the project directory
                        if (os.platform() === 'win32') {
                            shellCommand = `Set-Location -Path "${projectPath}"; ${initialCommand}`;
                        } else {
                            shellCommand = `cd "${projectPath}" && ${initialCommand}`;
                        }
                    } else if (provider === 'cursor') {
                        // Use cursor-agent command
                        if (os.platform() === 'win32') {
                            if (hasSession && sessionId) {
                                shellCommand = `Set-Location -Path "${projectPath}"; cursor-agent --resume="${sessionId}"`;
                            } else {
                                shellCommand = `Set-Location -Path "${projectPath}"; cursor-agent`;
                            }
                        } else {
                            if (hasSession && sessionId) {
                                shellCommand = `cd "${projectPath}" && cursor-agent --resume="${sessionId}"`;
                            } else {
                                shellCommand = `cd "${projectPath}" && cursor-agent`;
                            }
                        }
                    } else if (provider === 'codebuddy') {
                        // Use codebuddy command
                        if (os.platform() === 'win32') {
                            if (hasSession && sessionId) {
                                shellCommand = `Set-Location -Path "${projectPath}"; codebuddy --resume ${sessionId}`;
                            } else {
                                shellCommand = `Set-Location -Path "${projectPath}"; codebuddy`;
                            }
                        } else {
                            if (hasSession && sessionId) {
                                shellCommand = `cd "${projectPath}" && codebuddy --resume ${sessionId} || codebuddy`;
                            } else {
                                shellCommand = `cd "${projectPath}" && codebuddy`;
                            }
                        }
                    } else {
                        // Use claude command (default) or initialCommand if provided
                        const command = initialCommand || 'claude';
                        if (os.platform() === 'win32') {
                            if (hasSession && sessionId) {
                                // Try to resume session, but with fallback to new session if it fails
                                shellCommand = `Set-Location -Path "${projectPath}"; claude --resume ${sessionId}; if ($LASTEXITCODE -ne 0) { claude }`;
                            } else {
                                shellCommand = `Set-Location -Path "${projectPath}"; ${command}`;
                            }
                        } else {
                            if (hasSession && sessionId) {
                                shellCommand = `cd "${projectPath}" && claude --resume ${sessionId} || claude`;
                            } else {
                                shellCommand = `cd "${projectPath}" && ${command}`;
                            }
                        }
                    }

                    console.log('🔧 Executing shell command:', shellCommand);

                    // Use appropriate shell based on platform
                    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
                    const shellArgs = os.platform() === 'win32' ? ['-Command', shellCommand] : ['-c', shellCommand];

                    // Use terminal dimensions from client if provided, otherwise use defaults
                    const termCols = data.cols || 80;
                    const termRows = data.rows || 24;
                    console.log('📐 Using terminal dimensions:', termCols, 'x', termRows, data.cols ? '(from client)' : '(default fallback)');

                    // Build environment variables
                    const ptyEnv = {
                        ...process.env,
                        TERM: 'xterm-256color',
                        COLORTERM: 'truecolor',
                        FORCE_COLOR: '3',
                        // Override browser opening commands to echo URL for detection
                        BROWSER: os.platform() === 'win32' ? 'echo "OPEN_URL:"' : 'echo "OPEN_URL:"'
                    };
                    
                    // For keepAlive terminals or quick terminals, add environment variables to prevent shell timeout
                    if ((isKeepAlive || isQuickTerminal) && os.platform() !== 'win32') {
                        ptyEnv.TMOUT = '0';           // Disable bash/zsh idle timeout
                        ptyEnv.IGNOREEOF = '10';      // Require 10 Ctrl+D to exit
                        ptyEnv.HISTCONTROL = 'ignoredups:erasedups';  // Better history handling
                        // Prevent auto-logout in some shells
                        ptyEnv.AUTOLOGOUT = '0';
                        console.log('🔒 Quick/KeepAlive terminal: disabled TMOUT and set IGNOREEOF');
                    }

                    shellProcess = pty.spawn(shell, shellArgs, {
                        name: 'xterm-256color',
                        cols: termCols,
                        rows: termRows,
                        cwd: process.env.HOME || (os.platform() === 'win32' ? process.env.USERPROFILE : '/'),
                        env: ptyEnv
                    });

                    console.log('🟢 Shell process started with PTY, PID:', shellProcess.pid);

                    ptySessionsMap.set(ptySessionKey, {
                        pty: shellProcess,
                        ws: ws,
                        buffer: [],
                        timeoutId: null,
                        projectPath,
                        sessionId,
                        isKeepAlive
                    });

                    // Handle data output
                    shellProcess.onData((data) => {
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (!session) return;

                        if (session.buffer.length < 5000) {
                            session.buffer.push(data);
                        } else {
                            session.buffer.shift();
                            session.buffer.push(data);
                        }
                        
                        // Update quick terminal metadata if applicable
                        if (isQuickTerminal && sessionId) {
                            const terminal = quickTerminals.get(sessionId);
                            if (terminal) {
                                terminal.lastActivity = Date.now();
                                // Simple command extraction from input (best effort)
                                const cleanData = data.replace(/\x1b\[[0-9;]*m/g, '').trim();
                                if (cleanData && !cleanData.startsWith('\r') && cleanData.length < 100) {
                                    terminal.lastCommand = cleanData;
                                }
                            }
                        }

                        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                            let outputData = data;

                            // Check for various URL opening patterns
                            const patterns = [
                                // Direct browser opening commands
                                /(?:xdg-open|open|start)\s+(https?:\/\/[^\s\x1b\x07]+)/g,
                                // BROWSER environment variable override
                                /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
                                // Git and other tools opening URLs
                                /Opening\s+(https?:\/\/[^\s\x1b\x07]+)/gi,
                                // General URL patterns that might be opened
                                /Visit:\s*(https?:\/\/[^\s\x1b\x07]+)/gi,
                                /View at:\s*(https?:\/\/[^\s\x1b\x07]+)/gi,
                                /Browse to:\s*(https?:\/\/[^\s\x1b\x07]+)/gi
                            ];

                            patterns.forEach(pattern => {
                                let match;
                                while ((match = pattern.exec(data)) !== null) {
                                    const url = match[1];
                                    console.log('[DEBUG] Detected URL for opening:', url);

                                    // Send URL opening message to client
                                    session.ws.send(JSON.stringify({
                                        type: 'url_open',
                                        url: url
                                    }));

                                    // Replace the OPEN_URL pattern with a user-friendly message
                                    if (pattern.source.includes('OPEN_URL')) {
                                        outputData = outputData.replace(match[0], `[INFO] Opening in browser: ${url}`);
                                    }
                                }
                            });

                            // Send regular output
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: outputData
                            }));
                        }
                    });

                    // Handle process exit
                    shellProcess.onExit((exitCode) => {
                        console.log('🔚 Shell process exited with code:', exitCode.exitCode, 'signal:', exitCode.signal);
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}${exitCode.signal ? ` (${exitCode.signal})` : ''}\x1b[0m\r\n`
                            }));
                        }
                        if (session && session.timeoutId) {
                            clearTimeout(session.timeoutId);
                        }
                        ptySessionsMap.delete(ptySessionKey);
                        shellProcess = null;
                    });

                } catch (spawnError) {
                    console.error('[ERROR] Error spawning process:', spawnError);
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\r\n\x1b[31mError: ${spawnError.message}\x1b[0m\r\n`
                    }));
                }

            } else if (data.type === 'input') {
                // Send input to shell process
                if (shellProcess && shellProcess.write) {
                    try {
                        shellProcess.write(data.data);
                    } catch (error) {
                        console.error('Error writing to shell:', error);
                    }
                } else {
                    console.warn('No active shell process to send input to');
                }
            } else if (data.type === 'resize') {
                // Handle terminal resize
                if (shellProcess && shellProcess.resize) {
                    console.log('📐 Terminal resize:', data.cols, 'x', data.rows);
                    shellProcess.resize(data.cols, data.rows);
                }
            } else if (data.type === 'disconnect') {
                // User explicitly requested disconnect - kill the PTY and remove from cache
                console.log('🔌 User requested disconnect, killing PTY session:', ptySessionKey);
                if (ptySessionKey) {
                    const session = ptySessionsMap.get(ptySessionKey);
                    if (session) {
                        if (session.timeoutId) {
                            clearTimeout(session.timeoutId);
                        }
                        if (session.pty && session.pty.kill) {
                            session.pty.kill();
                        }
                        ptySessionsMap.delete(ptySessionKey);
                        console.log('✅ PTY session killed and removed from cache:', ptySessionKey);
                    }
                }
                shellProcess = null;
            }
        } catch (error) {
            console.error('[ERROR] Shell WebSocket error:', error.message);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'output',
                    data: `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`
                }));
            }
        }
    });

    ws.on('close', () => {
        console.log('🔌 Shell client disconnected');

        if (ptySessionKey) {
            const session = ptySessionsMap.get(ptySessionKey);
            if (session) {
                session.ws = null;

                // Check if this is a quick terminal with keepAlive enabled
                // Quick terminal session keys are formatted as: terminal_{sessionId}_{projectPath}
                // where sessionId itself is like "terminal_1234567890"
                // So the full key looks like: terminal_terminal_1234567890_/path/to/project
                const isQuickTerminalSession = ptySessionKey.startsWith('terminal_');
                let shouldKeepAlive = false;
                
                if (isQuickTerminalSession) {
                    // Extract the full sessionId (terminal_XXXXX) from the key
                    // Key format: terminal_{sessionId}_{projectPath}
                    // sessionId format: terminal_1234567890
                    // So we need to match: terminal_(terminal_\d+)_
                    const match = ptySessionKey.match(/^terminal_(terminal_\d+)_/);
                    if (match) {
                        const terminalId = match[1];
                        const terminal = quickTerminals.get(terminalId);
                        console.log('🔍 Looking up terminal:', terminalId, 'found:', !!terminal, 'keepAlive:', terminal?.keepAlive);
                        if (terminal && terminal.keepAlive) {
                            shouldKeepAlive = true;
                            console.log('🔒 PTY session will be kept alive indefinitely (keepAlive enabled):', ptySessionKey);
                        }
                    }
                }

                if (shouldKeepAlive) {
                    // No timeout - keep alive indefinitely
                    console.log('⏳ PTY session kept alive indefinitely:', ptySessionKey);
                } else {
                    // Set timeout to clean up after 30 minutes
                    console.log('⏳ PTY session kept alive, will timeout in 30 minutes:', ptySessionKey);
                    session.timeoutId = setTimeout(() => {
                        console.log('⏰ PTY session timeout, killing process:', ptySessionKey);
                        if (session.pty && session.pty.kill) {
                            session.pty.kill();
                        }
                        ptySessionsMap.delete(ptySessionKey);
                    }, PTY_SESSION_TIMEOUT);
                }
            }
        }
    });

    ws.on('error', (error) => {
        console.error('[ERROR] Shell WebSocket error:', error);
    });
}
// Audio transcription endpoint
app.post('/api/transcribe', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const upload = multer({ storage: multer.memoryStorage() });

        // Handle multipart form data
        upload.single('audio')(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: 'Failed to process audio file' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No audio file provided' });
            }

            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in server environment.' });
            }

            try {
                // Create form data for OpenAI
                const FormData = (await import('form-data')).default;
                const formData = new FormData();
                formData.append('file', req.file.buffer, {
                    filename: req.file.originalname,
                    contentType: req.file.mimetype
                });
                formData.append('model', 'whisper-1');
                formData.append('response_format', 'json');
                formData.append('language', 'en');

                // Make request to OpenAI
                const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        ...formData.getHeaders()
                    },
                    body: formData
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
                }

                const data = await response.json();
                let transcribedText = data.text || '';

                // Check if enhancement mode is enabled
                const mode = req.body.mode || 'default';

                // If no transcribed text, return empty
                if (!transcribedText) {
                    return res.json({ text: '' });
                }

                // If default mode, return transcribed text without enhancement
                if (mode === 'default') {
                    return res.json({ text: transcribedText });
                }

                // Handle different enhancement modes
                try {
                    const OpenAI = (await import('openai')).default;
                    const openai = new OpenAI({ apiKey });

                    let prompt, systemMessage, temperature = 0.7, maxTokens = 800;

                    switch (mode) {
                        case 'prompt':
                            systemMessage = 'You are an expert prompt engineer who creates clear, detailed, and effective prompts.';
                            prompt = `You are an expert prompt engineer. Transform the following rough instruction into a clear, detailed, and context-aware AI prompt.

Your enhanced prompt should:
1. Be specific and unambiguous
2. Include relevant context and constraints
3. Specify the desired output format
4. Use clear, actionable language
5. Include examples where helpful
6. Consider edge cases and potential ambiguities

Transform this rough instruction into a well-crafted prompt:
"${transcribedText}"

Enhanced prompt:`;
                            break;

                        case 'vibe':
                        case 'instructions':
                        case 'architect':
                            systemMessage = 'You are a helpful assistant that formats ideas into clear, actionable instructions for AI agents.';
                            temperature = 0.5; // Lower temperature for more controlled output
                            prompt = `Transform the following idea into clear, well-structured instructions that an AI agent can easily understand and execute.

IMPORTANT RULES:
- Format as clear, step-by-step instructions
- Add reasonable implementation details based on common patterns
- Only include details directly related to what was asked
- Do NOT add features or functionality not mentioned
- Keep the original intent and scope intact
- Use clear, actionable language an agent can follow

Transform this idea into agent-friendly instructions:
"${transcribedText}"

Agent instructions:`;
                            break;

                        default:
                            // No enhancement needed
                            break;
                    }

                    // Only make GPT call if we have a prompt
                    if (prompt) {
                        const completion = await openai.chat.completions.create({
                            model: 'gpt-4o-mini',
                            messages: [
                                { role: 'system', content: systemMessage },
                                { role: 'user', content: prompt }
                            ],
                            temperature: temperature,
                            max_tokens: maxTokens
                        });

                        transcribedText = completion.choices[0].message.content || transcribedText;
                    }

                } catch (gptError) {
                    console.error('GPT processing error:', gptError);
                    // Fall back to original transcription if GPT fails
                }

                res.json({ text: transcribedText });

            } catch (error) {
                console.error('Transcription error:', error);
                res.status(500).json({ error: error.message });
            }
        });
    } catch (error) {
        console.error('Endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get token usage for a specific session
app.get('/api/projects/:projectId/sessions/:sessionId/token-usage', authenticateToken, async (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const homeDir = os.homedir();

    // Get project info from database ID
    const { dirName } = resolveProjectInfo(projectId);

    // Allow only safe characters in sessionId
    const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safeSessionId) {
      return res.status(400).json({ error: 'Invalid sessionId' });
    }

    // Try to find the session file in both Claude and CodeBuddy directories
    // Claude format: -data-codes-xxx
    // CodeBuddy format: data-codes-xxx (without leading -)
    const claudeProjectName = dirName;
    const codebuddyProjectName = dirName.startsWith('-') ? dirName.substring(1) : dirName;
    
    const candidatePaths = [
      // Try Claude directory first
      {
        dir: path.join(homeDir, '.claude', 'projects', claudeProjectName),
        provider: 'claude'
      },
      // Then try CodeBuddy directory
      {
        dir: path.join(homeDir, '.codebuddy', 'projects', codebuddyProjectName),
        provider: 'codebuddy'
      }
    ];

    let fileContent = null;
    let foundPath = null;
    let foundProvider = null;

    // Try each candidate path
    for (const { dir: projectDir, provider } of candidatePaths) {
      const jsonlPath = path.join(projectDir, `${safeSessionId}.jsonl`);
      
      // Constrain to projectDir for security
      const rel = path.relative(path.resolve(projectDir), path.resolve(jsonlPath));
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        continue; // Skip invalid paths
      }

      // Try to read the file
      try {
        fileContent = await fsPromises.readFile(jsonlPath, 'utf8');
        foundPath = jsonlPath;
        foundProvider = provider;
  
        break; // Found the file, stop searching
      } catch (error) {
        if (error.code === 'ENOENT') {
          continue; // File not found, try next location
        }
        throw error; // Re-throw other errors
      }
    }

    // If file not found in any location, return default empty usage instead of 404
    // This is normal for new sessions that haven't been saved yet
    if (!fileContent) {
      const parsedContextWindow = parseInt(process.env.CONTEXT_WINDOW, 10);
      const contextWindow = Number.isFinite(parsedContextWindow) ? parsedContextWindow : 160000;
      
      return res.json({
        inputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        contextWindow: contextWindow,
        percentage: 0
      });
    }
    const lines = fileContent.trim().split('\n');

    const parsedContextWindow = parseInt(process.env.CONTEXT_WINDOW, 10);
    const contextWindow = Number.isFinite(parsedContextWindow) ? parsedContextWindow : 160000;
    let inputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;

    // Find the latest assistant message with usage data (scan from end)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);

        // Only count assistant messages which have usage data
        // Handle both Claude format (type='assistant') and CodeBuddy format (type='message', role='assistant')
        if ((entry.type === 'assistant' || (entry.type === 'message' && entry.role === 'assistant')) && entry.message?.usage) {
          const usage = entry.message.usage;

          // Use token counts from latest assistant message only
          inputTokens = usage.input_tokens || 0;
          cacheCreationTokens = usage.cache_creation_input_tokens || 0;
          cacheReadTokens = usage.cache_read_input_tokens || 0;

          break; // Stop after finding the latest assistant message
        }
      } catch (parseError) {
        // Skip lines that can't be parsed
        continue;
      }
    }

    // Calculate total context usage (excluding output_tokens, as per ccusage)
    const totalUsed = inputTokens + cacheCreationTokens + cacheReadTokens;

    res.json({
      used: totalUsed,
      total: contextWindow,
      breakdown: {
        input: inputTokens,
        cacheCreation: cacheCreationTokens,
        cacheRead: cacheReadTokens
      }
    });
  } catch (error) {
    console.error('Error reading session token usage:', error);
    res.status(500).json({ error: 'Failed to read session token usage' });
  }
});

// Serve React app for all other routes (excluding static files)
app.get('*', (req, res) => {
  // Skip requests for static assets (files with extensions)
  if (path.extname(req.path)) {
    return res.status(404).send('Not found');
  }

  // Only serve index.html for HTML routes, not for static assets
  // Static assets should already be handled by express.static middleware above
  const indexPath = path.join(__dirname, '../dist/index.html');

  // Check if dist/index.html exists (production build available)
  if (fs.existsSync(indexPath)) {
    // Set no-cache headers for HTML to prevent service worker issues
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(indexPath);
  } else {
    // In development, redirect to Vite dev server only if dist doesn't exist
    res.redirect(`http://localhost:${process.env.VITE_PORT || 5173}`);
  }
});

// Helper function to convert permissions to rwx format
function permToRwx(perm) {
    const r = perm & 4 ? 'r' : '-';
    const w = perm & 2 ? 'w' : '-';
    const x = perm & 1 ? 'x' : '-';
    return r + w + x;
}

async function getFileTree(dirPath, maxDepth = 3, currentDepth = 0, showHidden = true) {
    // Using fsPromises from import
    const items = [];

    try {
        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            // Debug: log all entries including hidden files


            // Skip only heavy build directories
            if (entry.name === 'node_modules' ||
                entry.name === 'dist' ||
                entry.name === 'build') continue;

            const itemPath = path.join(dirPath, entry.name);
            const item = {
                name: entry.name,
                path: itemPath,
                type: entry.isDirectory() ? 'directory' : 'file'
            };

            // Get file stats for additional metadata
            try {
                const stats = await fsPromises.stat(itemPath);
                item.size = stats.size;
                item.modified = stats.mtime.toISOString();

                // Convert permissions to rwx format
                const mode = stats.mode;
                const ownerPerm = (mode >> 6) & 7;
                const groupPerm = (mode >> 3) & 7;
                const otherPerm = mode & 7;
                item.permissions = ((mode >> 6) & 7).toString() + ((mode >> 3) & 7).toString() + (mode & 7).toString();
                item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm);
            } catch (statError) {
                // If stat fails, provide default values
                item.size = 0;
                item.modified = null;
                item.permissions = '000';
                item.permissionsRwx = '---------';
            }

            if (entry.isDirectory() && currentDepth < maxDepth) {
                // Recursively get subdirectories but limit depth
                try {
                    // Check if we can access the directory before trying to read it
                    await fsPromises.access(item.path, fs.constants.R_OK);
                    item.children = await getFileTree(item.path, maxDepth, currentDepth + 1, showHidden);
                } catch (e) {
                    // Silently skip directories we can't access (permission denied, etc.)
                    item.children = [];
                }
            }

            items.push(item);
        }
    } catch (error) {
        // Only log non-permission errors to avoid spam
        if (error.code !== 'EACCES' && error.code !== 'EPERM') {
            console.error('Error reading directory:', error);
        }
    }

    return items.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}

const PORT = process.env.PORT || 3001;

// Initialize database and start server
async function startServer() {
    try {
        // Initialize authentication database
        await initializeDatabase();
        
        // Initialize projects database
        initProjectsDb();

        // Check if running in production mode (dist folder exists)
        const distIndexPath = path.join(__dirname, '../dist/index.html');
        const isProduction = fs.existsSync(distIndexPath);

        // Log Claude implementation mode
        console.log(`${c.info('[INFO]')} Using Claude Agents SDK for Claude integration`);
        console.log(`${c.info('[INFO]')} Running in ${c.bright(isProduction ? 'PRODUCTION' : 'DEVELOPMENT')} mode`);

        if (!isProduction) {
            console.log(`${c.warn('[WARN]')} Note: Requests will be proxied to Vite dev server at ${c.dim('http://localhost:' + (process.env.VITE_PORT || 5173))}`);
        }

        server.listen(PORT, '0.0.0.0', async () => {
            const appInstallPath = path.join(__dirname, '..');

            console.log('');
            console.log(c.dim('═'.repeat(63)));
            console.log(`  ${c.bright('Claude Code UI Server - Ready')}`);
            console.log(c.dim('═'.repeat(63)));
            console.log('');
            console.log(`${c.info('[INFO]')} Server URL:  ${c.bright('http://0.0.0.0:' + PORT)}`);
            console.log(`${c.info('[INFO]')} Installed at: ${c.dim(appInstallPath)}`);
            console.log(`${c.tip('[TIP]')}  Run "cloudcli status" for full configuration details`);
            console.log('');

            // Start watching the projects folder for changes
            await setupProjectsWatcher();
        });
    } catch (error) {
        console.error('[ERROR] Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
