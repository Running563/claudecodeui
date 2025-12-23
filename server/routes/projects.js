import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';
import { addProjectManually } from '../projects.js';
import { getProjectById } from '../db.js';

const router = express.Router();

/**
 * Truncate session messages up to a specific timestamp
 * PUT /api/projects/:projectId/sessions/:sessionId/truncate
 * 
 * Body: { keepUntilTimestamp: ISO timestamp string }
 * 
 * Deletes all messages after the specified timestamp in the session's JSONL file
 */
router.put('/:projectId/sessions/:sessionId/truncate', async (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const { keepUntilTimestamp } = req.body;

    if (!keepUntilTimestamp) {
      return res.status(400).json({ error: 'keepUntilTimestamp is required' });
    }

    const cutoffTime = new Date(keepUntilTimestamp);
    if (isNaN(cutoffTime.getTime())) {
      return res.status(400).json({ error: 'Invalid timestamp format' });
    }

    // Get project from database
    const project = getProjectById(parseInt(projectId, 10));
    if (!project) {
      return res.status(404).json({ error: `Project not found: ${projectId}` });
    }

    const projectPath = project.original_path;
    // Convert path to directory name format: /data/codes/stock-quant -> data-codes-stock-quant
    const projectDirName = projectPath.replace(/^\//, '').replace(/\//g, '-');

    // Determine JSONL file path based on provider
    // Try Claude first, then CodeBuddy
    const claudeDir = path.join(os.homedir(), '.claude', 'projects', '-' + projectDirName);
    const codebuddyDir = path.join(os.homedir(), '.codebuddy', 'projects', projectDirName);

    let jsonlFile = null;
    let provider = null;

    // Check Claude first
    try {
      await fs.access(claudeDir);
      jsonlFile = path.join(claudeDir, `${sessionId}.jsonl`);
      provider = 'claude';
      // Check if the session file exists in Claude directory
      try {
        await fs.access(jsonlFile);
      } catch (fileErr) {
        // File doesn't exist in Claude, try CodeBuddy
        throw new Error('Session file not in Claude directory');
      }
    } catch (err) {
      // Try CodeBuddy
      try {
        await fs.access(codebuddyDir);
        jsonlFile = path.join(codebuddyDir, `${sessionId}.jsonl`);
        provider = 'codebuddy';
      } catch (err2) {
        return res.status(404).json({ error: 'Project directory not found' });
      }
    }

    // Read JSONL file
    let fileContent;
    try {
      fileContent = await fs.readFile(jsonlFile, 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Session file not found', path: jsonlFile });
      }
      throw err;
    }

    // Parse messages
    const lines = fileContent.trim().split('\n').filter(line => line.trim());
    const allMessages = lines.map(line => JSON.parse(line));

    // Filter messages: keep only those with timestamp <= cutoffTime
    const filteredMessages = allMessages.filter(msg => {
      if (!msg.timestamp) return true; // Keep messages without timestamp
      const messageTime = new Date(msg.timestamp);
      return messageTime <= cutoffTime;
    });

    const deletedCount = allMessages.length - filteredMessages.length;

    // Write back to file
    const newContent = filteredMessages.map(msg => JSON.stringify(msg)).join('\n') + (filteredMessages.length > 0 ? '\n' : '');
    await fs.writeFile(jsonlFile, newContent, 'utf-8');

    res.json({
      success: true,
      deletedCount,
      keptCount: filteredMessages.length,
      provider
    });

  } catch (error) {
    console.error('Error truncating session:', error);
    res.status(500).json({
      error: error.message || 'Failed to truncate session'
    });
  }
});

// Configure allowed workspace root (defaults to user's home directory)
const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || os.homedir();

// System-critical paths that should never be used as workspace directories
const FORBIDDEN_PATHS = [
  '/',
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/dev',
  '/proc',
  '/sys',
  '/var',
  '/boot',
  '/root',
  '/lib',
  '/lib64',
  '/opt',
  '/tmp',
  '/run'
];

/**
 * Validates that a path is safe for workspace operations
 * @param {string} requestedPath - The path to validate
 * @returns {Promise<{valid: boolean, resolvedPath?: string, error?: string}>}
 */
async function validateWorkspacePath(requestedPath) {
  try {
    // Resolve to absolute path
    let absolutePath = path.resolve(requestedPath);

    // Check if path is a forbidden system directory
    const normalizedPath = path.normalize(absolutePath);
    if (FORBIDDEN_PATHS.includes(normalizedPath) || normalizedPath === '/') {
      return {
        valid: false,
        error: 'Cannot use system-critical directories as workspace locations'
      };
    }

    // Additional check for paths starting with forbidden directories
    for (const forbidden of FORBIDDEN_PATHS) {
      if (normalizedPath === forbidden ||
          normalizedPath.startsWith(forbidden + path.sep)) {
        // Exception: /var/tmp and similar user-accessible paths might be allowed
        // but /var itself and most /var subdirectories should be blocked
        if (forbidden === '/var' &&
            (normalizedPath.startsWith('/var/tmp') ||
             normalizedPath.startsWith('/var/folders'))) {
          continue; // Allow these specific cases
        }

        return {
          valid: false,
          error: `Cannot create workspace in system directory: ${forbidden}`
        };
      }
    }

    // Try to resolve the real path (following symlinks)
    let realPath;
    try {
      // Check if path exists to resolve real path
      await fs.access(absolutePath);
      realPath = await fs.realpath(absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Path doesn't exist yet - check parent directory
        let parentPath = path.dirname(absolutePath);
        try {
          const parentRealPath = await fs.realpath(parentPath);

          // Reconstruct the full path with real parent
          realPath = path.join(parentRealPath, path.basename(absolutePath));
        } catch (parentError) {
          if (parentError.code === 'ENOENT') {
            // Parent doesn't exist either - use the absolute path as-is
            // We'll validate it's within allowed root
            realPath = absolutePath;
          } else {
            throw parentError;
          }
        }
      } else {
        throw error;
      }
    }

    // Resolve the workspace root to its real path
    const resolvedWorkspaceRoot = await fs.realpath(WORKSPACES_ROOT);

    // Ensure the resolved path is contained within the allowed workspace root
    if (!realPath.startsWith(resolvedWorkspaceRoot + path.sep) &&
        realPath !== resolvedWorkspaceRoot) {
      return {
        valid: false,
        error: `Workspace path must be within the allowed workspace root: ${WORKSPACES_ROOT}`
      };
    }

    // Additional symlink check for existing paths
    try {
      await fs.access(absolutePath);
      const stats = await fs.lstat(absolutePath);

      if (stats.isSymbolicLink()) {
        // Verify symlink target is also within allowed root
        const linkTarget = await fs.readlink(absolutePath);
        const resolvedTarget = path.resolve(path.dirname(absolutePath), linkTarget);
        const realTarget = await fs.realpath(resolvedTarget);

        if (!realTarget.startsWith(resolvedWorkspaceRoot + path.sep) &&
            realTarget !== resolvedWorkspaceRoot) {
          return {
            valid: false,
            error: 'Symlink target is outside the allowed workspace root'
          };
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // Path doesn't exist - that's fine for new workspace creation
    }

    return {
      valid: true,
      resolvedPath: realPath
    };

  } catch (error) {
    return {
      valid: false,
      error: `Path validation failed: ${error.message}`
    };
  }
}

/**
 * Create a new workspace
 * POST /api/projects/create-workspace
 *
 * Body:
 * - workspaceType: 'existing' | 'new'
 * - path: string (workspace path)
 * - githubUrl?: string (optional, for new workspaces)
 * - githubTokenId?: number (optional, ID of stored token)
 * - newGithubToken?: string (optional, one-time token)
 */
router.post('/create-workspace', async (req, res) => {
  try {
    const { workspaceType, path: workspacePath, githubUrl, githubTokenId, newGithubToken } = req.body;

    // Validate required fields
    if (!workspaceType || !workspacePath) {
      return res.status(400).json({ error: 'workspaceType and path are required' });
    }

    if (!['existing', 'new'].includes(workspaceType)) {
      return res.status(400).json({ error: 'workspaceType must be "existing" or "new"' });
    }

    // Validate path safety before any operations
    const validation = await validateWorkspacePath(workspacePath);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid workspace path',
        details: validation.error
      });
    }

    const absolutePath = validation.resolvedPath;

    // Handle existing workspace
    if (workspaceType === 'existing') {
      // Check if the path exists
      try {
        await fs.access(absolutePath);
        const stats = await fs.stat(absolutePath);

        if (!stats.isDirectory()) {
          return res.status(400).json({ error: 'Path exists but is not a directory' });
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          return res.status(404).json({ error: 'Workspace path does not exist' });
        }
        throw error;
      }

      // Add the existing workspace to the project list
      const project = await addProjectManually(absolutePath);

      return res.json({
        success: true,
        project,
        message: 'Existing workspace added successfully'
      });
    }

    // Handle new workspace creation
    if (workspaceType === 'new') {
      // Check if path already exists
      try {
        await fs.access(absolutePath);
        return res.status(400).json({
          error: 'Path already exists. Please choose a different path or use "existing workspace" option.'
        });
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        // Path doesn't exist - good, we can create it
      }

      // Create the directory
      await fs.mkdir(absolutePath, { recursive: true });

      // If GitHub URL is provided, clone the repository
      if (githubUrl) {
        let githubToken = null;

        // Get GitHub token if needed
        if (githubTokenId) {
          // Fetch token from database
          const token = await getGithubTokenById(githubTokenId, req.user.id);
          if (!token) {
            // Clean up created directory
            await fs.rm(absolutePath, { recursive: true, force: true });
            return res.status(404).json({ error: 'GitHub token not found' });
          }
          githubToken = token.github_token;
        } else if (newGithubToken) {
          githubToken = newGithubToken;
        }

        // Clone the repository
        try {
          await cloneGitHubRepository(githubUrl, absolutePath, githubToken);
        } catch (error) {
          // Clean up created directory on failure
          try {
            await fs.rm(absolutePath, { recursive: true, force: true });
          } catch (cleanupError) {
            console.error('Failed to clean up directory after clone failure:', cleanupError);
            // Continue to throw original error
          }
          throw new Error(`Failed to clone repository: ${error.message}`);
        }
      }

      // Add the new workspace to the project list
      const project = await addProjectManually(absolutePath);

      return res.json({
        success: true,
        project,
        message: githubUrl
          ? 'New workspace created and repository cloned successfully'
          : 'New workspace created successfully'
      });
    }

  } catch (error) {
    console.error('Error creating workspace:', error);
    res.status(500).json({
      error: error.message || 'Failed to create workspace',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * Helper function to get GitHub token from database
 */
async function getGithubTokenById(tokenId, userId) {
  const { getDatabase } = await import('../database/db.js');
  const db = await getDatabase();

  const credential = await db.get(
    'SELECT * FROM user_credentials WHERE id = ? AND user_id = ? AND credential_type = ? AND is_active = 1',
    [tokenId, userId, 'github_token']
  );

  // Return in the expected format (github_token field for compatibility)
  if (credential) {
    return {
      ...credential,
      github_token: credential.credential_value
    };
  }

  return null;
}

/**
 * Helper function to clone a GitHub repository
 */
function cloneGitHubRepository(githubUrl, destinationPath, githubToken = null) {
  return new Promise((resolve, reject) => {
    // Parse GitHub URL and inject token if provided
    let cloneUrl = githubUrl;

    if (githubToken) {
      try {
        const url = new URL(githubUrl);
        // Format: https://TOKEN@github.com/user/repo.git
        url.username = githubToken;
        url.password = '';
        cloneUrl = url.toString();
      } catch (error) {
        return reject(new Error('Invalid GitHub URL format'));
      }
    }

    const gitProcess = spawn('git', ['clone', cloneUrl, destinationPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0' // Disable git password prompts
      }
    });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        // Parse git error messages to provide helpful feedback
        let errorMessage = 'Git clone failed';

        if (stderr.includes('Authentication failed') || stderr.includes('could not read Username')) {
          errorMessage = 'Authentication failed. Please check your GitHub token.';
        } else if (stderr.includes('Repository not found')) {
          errorMessage = 'Repository not found. Please check the URL and ensure you have access.';
        } else if (stderr.includes('already exists')) {
          errorMessage = 'Directory already exists';
        } else if (stderr) {
          errorMessage = stderr;
        }

        reject(new Error(errorMessage));
      }
    });

    gitProcess.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('Git is not installed or not in PATH'));
      } else {
        reject(error);
      }
    });
  });
}

export default router;
