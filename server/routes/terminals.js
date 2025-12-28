import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// In-memory storage for quick terminals metadata
// (PTY sessions are managed in index.js ptySessionsMap)
const quickTerminals = new Map();

// Reference to ptySessionsMap from index.js (will be set via setPtySessionsMap)
let ptySessionsMap = null;

// Function to set ptySessionsMap reference (called from index.js)
function setPtySessionsMap(map) {
  ptySessionsMap = map;
}

// Helper to validate directory
function validateDirectory(dirPath) {
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      return { valid: false, error: 'Not a directory' };
    }
    // Test read access
    fs.readdirSync(dirPath);
    return { valid: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { valid: false, error: 'Directory does not exist' };
    } else if (error.code === 'EACCES') {
      return { valid: false, error: 'Permission denied' };
    }
    return { valid: false, error: error.message };
  }
}

// Helper to expand path (resolve ~, ., ..)
function expandPath(dirPath) {
  if (!dirPath) return dirPath;
  
  // Expand tilde
  if (dirPath.startsWith('~/') || dirPath === '~') {
    const home = process.env.HOME || process.env.USERPROFILE;
    dirPath = dirPath.replace(/^~/, home);
  }
  
  // Resolve relative paths
  return path.resolve(dirPath);
}

// GET /api/terminals - Get all quick terminals
router.get('/', (req, res) => {
  try {
    const terminals = Array.from(quickTerminals.values()).map(t => ({
      id: t.id,
      workingDir: t.workingDir,
      lastCommand: t.lastCommand,
      isRunning: t.isRunning,
      createdAt: t.createdAt,
      lastActivity: t.lastActivity,
      keepAlive: t.keepAlive || false
    }));
    
    res.json(terminals);
  } catch (error) {
    console.error('[ERROR] Get terminals error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/terminals - Create new terminal
router.post('/', (req, res) => {
  try {
    let { workingDir } = req.body;
    
    if (!workingDir) {
      return res.status(400).json({ error: 'workingDir is required' });
    }
    
    // Expand and validate path
    workingDir = expandPath(workingDir);
    const validation = validateDirectory(workingDir);
    
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    // Generate unique terminal ID
    const terminalId = `terminal_${Date.now()}`;
    
    const terminal = {
      id: terminalId,
      workingDir,
      lastCommand: '',
      isRunning: false,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      keepAlive: false
    };
    
    quickTerminals.set(terminalId, terminal);
    
    console.log('[INFO] Created quick terminal:', terminalId, 'in', workingDir);
    
    res.json({ 
      sessionId: terminalId,
      terminal
    });
  } catch (error) {
    console.error('[ERROR] Create terminal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/terminals/validate-dir - Validate directory
router.post('/validate-dir', (req, res) => {
  try {
    let { path: dirPath } = req.body;
    
    if (!dirPath) {
      return res.status(400).json({ error: 'path is required' });
    }
    
    dirPath = expandPath(dirPath);
    const validation = validateDirectory(dirPath);
    
    res.json({
      valid: validation.valid,
      error: validation.error,
      expandedPath: dirPath
    });
  } catch (error) {
    console.error('[ERROR] Validate directory error:', error);
    res.status(500).json({ 
      valid: false,
      error: error.message 
    });
  }
});

// PUT /api/terminals/:id - Update terminal metadata
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const terminal = quickTerminals.get(id);
    
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }
    
    // Update allowed fields
    if (req.body.lastCommand !== undefined) {
      terminal.lastCommand = req.body.lastCommand;
    }
    if (req.body.isRunning !== undefined) {
      terminal.isRunning = req.body.isRunning;
    }
    if (req.body.keepAlive !== undefined) {
      const wasKeepAlive = terminal.keepAlive;
      terminal.keepAlive = req.body.keepAlive;
      
      // If keepAlive was just enabled, send command to disable shell timeout
      if (!wasKeepAlive && terminal.keepAlive && ptySessionsMap) {
        // Find the PTY session for this terminal
        // PTY session key format: terminal_{sessionId}_{projectPath}
        for (const [key, session] of ptySessionsMap.entries()) {
          if (key.startsWith(`${id}_`)) {
            // Send commands to disable timeout in the running shell
            // These commands work for bash/zsh
            const disableTimeoutCmd = 'export TMOUT=0; export IGNOREEOF=10\n';
            if (session.pty && session.pty.write) {
              session.pty.write(disableTimeoutCmd);
              console.log(`🔒 Sent keepAlive commands to terminal ${id}`);
            }
            break;
          }
        }
      }
    }
    
    terminal.lastActivity = Date.now();
    
    res.json({ success: true, terminal });
  } catch (error) {
    console.error('[ERROR] Update terminal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/terminals/:id - Delete terminal
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const terminal = quickTerminals.get(id);
    
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }
    
    // Remove from metadata storage
    quickTerminals.delete(id);
    
    console.log('[INFO] Deleted quick terminal:', id);
    
    // Note: PTY session cleanup is handled by WebSocket disconnect in index.js
    res.json({ success: true });
  } catch (error) {
    console.error('[ERROR] Delete terminal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/terminals/:id/clone - Clone terminal (create new one with same workingDir)
router.post('/:id/clone', (req, res) => {
  try {
    const { id } = req.params;
    const terminal = quickTerminals.get(id);
    
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }
    
    // Create new terminal with same working directory
    const newTerminalId = `terminal_${Date.now()}`;
    const newTerminal = {
      id: newTerminalId,
      workingDir: terminal.workingDir,
      lastCommand: '',
      isRunning: false,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      keepAlive: terminal.keepAlive || false
    };
    
    quickTerminals.set(newTerminalId, newTerminal);
    
    console.log('[INFO] Cloned terminal:', id, '→', newTerminalId);
    
    res.json({ 
      sessionId: newTerminalId,
      terminal: newTerminal
    });
  } catch (error) {
    console.error('[ERROR] Clone terminal error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
export { quickTerminals, setPtySessionsMap };
