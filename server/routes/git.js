import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { promises as fs } from 'fs';
import { getProjectById, deleteSessionBySessionId } from '../db.js';
import { queryClaudeSDK } from '../claude-sdk.js';
import { spawnCursor } from '../cursor-cli.js';
import { query } from '@tencent-ai/agent-sdk';

const router = express.Router();
const execAsync = promisify(exec);

// Helper function to get the actual project path from database ID
function getActualProjectPath(projectId) {
  const project = getProjectById(parseInt(projectId, 10));
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  return project.original_path;
}

// Helper function to strip git diff headers
function stripDiffHeaders(diff) {
  if (!diff) return '';

  const lines = diff.split('\n');
  const filteredLines = [];
  let startIncluding = false;

  for (const line of lines) {
    // Skip all header lines including diff --git, index, file mode, and --- / +++ file paths
    if (line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode') ||
        line.startsWith('---') ||
        line.startsWith('+++')) {
      continue;
    }

    // Start including lines from @@ hunk headers onwards
    if (line.startsWith('@@') || startIncluding) {
      startIncluding = true;
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n');
}

// Helper function to validate git repository
async function validateGitRepository(projectPath) {
  try {
    // Check if directory exists
    await fs.access(projectPath);
  } catch {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  try {
    // Use --show-toplevel to get the root of the git repository
    const { stdout: gitRoot } = await execAsync('git rev-parse --show-toplevel', { cwd: projectPath });
    const normalizedGitRoot = path.resolve(gitRoot.trim());
    const normalizedProjectPath = path.resolve(projectPath);
    
    // Ensure the git root matches our project path (prevent using parent git repos)
    if (normalizedGitRoot !== normalizedProjectPath) {
      throw new Error(`Project directory is not a git repository. This directory is inside a git repository at ${normalizedGitRoot}, but git operations should be run from the repository root.`);
    }
  } catch (error) {
    if (error.message.includes('Project directory is not a git repository')) {
      throw error;
    }
    throw new Error('Not a git repository. This directory does not contain a .git folder. Initialize a git repository with "git init" to use source control features.');
  }
}

// Get git status for a project
router.get('/status', async (req, res) => {
  const { project } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);

    // Validate git repository
    await validateGitRepository(projectPath);

    // Get current branch - handle case where there are no commits yet
    let branch = 'main';
    let hasCommits = true;
    try {
      const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
      branch = branchOutput.trim();
    } catch (error) {
      // No HEAD exists - repository has no commits yet
      if (error.message.includes('unknown revision') || error.message.includes('ambiguous argument')) {
        hasCommits = false;
        branch = 'main';
      } else {
        throw error;
      }
    }

    // Get git status - use --untracked-files=all to show all untracked files (not just directories)
    const { stdout: statusOutput } = await execAsync('git status --porcelain --untracked-files=all', { cwd: projectPath });

    // Staged changes (index)
    const staged = {
      modified: [],
      added: [],
      deleted: [],
      renamed: []
    };
    
    // Unstaged changes (working tree)
    const unstaged = {
      modified: [],
      deleted: []
    };
    
    const untracked = [];

    // For backward compatibility
    const modified = [];
    const added = [];
    const deleted = [];

    statusOutput.split('\n').forEach(line => {
      if (!line.trim()) return;

      const indexStatus = line[0];  // First char: staged status
      const workStatus = line[1];   // Second char: unstaged status
      const file = line.substring(3);

      // Staged changes (first column)
      if (indexStatus === 'M') {
        staged.modified.push(file);
        if (!modified.includes(file)) modified.push(file);
      } else if (indexStatus === 'A') {
        staged.added.push(file);
        if (!added.includes(file)) added.push(file);
      } else if (indexStatus === 'D') {
        staged.deleted.push(file);
        if (!deleted.includes(file)) deleted.push(file);
      } else if (indexStatus === 'R') {
        staged.renamed.push(file);
        if (!added.includes(file)) added.push(file);
      }

      // Unstaged changes (second column)
      if (workStatus === 'M') {
        unstaged.modified.push(file);
        if (!modified.includes(file)) modified.push(file);
      } else if (workStatus === 'D') {
        unstaged.deleted.push(file);
        if (!deleted.includes(file)) deleted.push(file);
      }

      // Untracked files
      if (indexStatus === '?' && workStatus === '?') {
        untracked.push(file);
      }
    });

    // Get line stats for all changed files using git diff --numstat
    const fileStats = {};
    
    try {
      // Get stats for staged files
      if (hasCommits) {
        const { stdout: stagedStats } = await execAsync('git diff --cached --numstat', { cwd: projectPath });
        stagedStats.split('\n').forEach(line => {
          if (!line.trim()) return;
          const [additions, deletions, filename] = line.split('\t');
          if (filename) {
            fileStats[filename] = {
              additions: additions === '-' ? 0 : parseInt(additions, 10) || 0,
              deletions: deletions === '-' ? 0 : parseInt(deletions, 10) || 0
            };
          }
        });
      }
      
      // Get stats for unstaged files
      const { stdout: unstagedStats } = await execAsync('git diff --numstat', { cwd: projectPath });
      unstagedStats.split('\n').forEach(line => {
        if (!line.trim()) return;
        const [additions, deletions, filename] = line.split('\t');
        if (filename) {
          if (fileStats[filename]) {
            // Merge with existing stats
            fileStats[filename].additions += additions === '-' ? 0 : parseInt(additions, 10) || 0;
            fileStats[filename].deletions += deletions === '-' ? 0 : parseInt(deletions, 10) || 0;
          } else {
            fileStats[filename] = {
              additions: additions === '-' ? 0 : parseInt(additions, 10) || 0,
              deletions: deletions === '-' ? 0 : parseInt(deletions, 10) || 0
            };
          }
        }
      });
    } catch (error) {
      // Ignore stats fetch error, continue without stats
      console.error('Error fetching file stats:', error.message);
    }

    res.json({
      branch,
      hasCommits,
      // New structured format
      staged,
      unstaged,
      untracked,
      // Backward compatible flat format
      modified,
      added,
      deleted,
      // Line change stats per file
      fileStats
    });
  } catch (error) {
    console.error('Git status error:', error);
    res.json({
      error: error.message.includes('not a git repository') || error.message.includes('Project directory is not a git repository')
        ? error.message
        : 'Git operation failed',
      details: error.message.includes('not a git repository') || error.message.includes('Project directory is not a git repository')
        ? error.message
        : `Failed to get git status: ${error.message}`
    });
  }
});

// Get diff for a specific file
router.get('/diff', async (req, res) => {
  const { project, file } = req.query;
  
  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Check if file is untracked or deleted
    const { stdout: statusOutput } = await execAsync(`git status --porcelain "${file}"`, { cwd: projectPath });
    const isUntracked = statusOutput.startsWith('??');
    const isDeleted = statusOutput.trim().startsWith('D ') || statusOutput.trim().startsWith(' D');

    let diff;
    if (isUntracked) {
      // For untracked files, show the entire file content as additions
      const filePath = path.join(projectPath, file);
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        // For directories, show a simple message
        diff = `Directory: ${file}\n(Cannot show diff for directories)`;
      } else {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const lines = fileContent.split('\n');
        diff = `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n` +
               lines.map(line => `+${line}`).join('\n');
      }
    } else if (isDeleted) {
      // For deleted files, show the entire file content from HEAD as deletions
      const { stdout: fileContent } = await execAsync(`git show HEAD:"${file}"`, { cwd: projectPath });
      const lines = fileContent.split('\n');
      diff = `--- a/${file}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n` +
             lines.map(line => `-${line}`).join('\n');
    } else {
      // Get diff for tracked files
      // First check for unstaged changes (working tree vs index)
      const { stdout: unstagedDiff } = await execAsync(`git diff -- "${file}"`, { cwd: projectPath });

      if (unstagedDiff) {
        // Show unstaged changes if they exist
        diff = stripDiffHeaders(unstagedDiff);
      } else {
        // If no unstaged changes, check for staged changes (index vs HEAD)
        const { stdout: stagedDiff } = await execAsync(`git diff --cached -- "${file}"`, { cwd: projectPath });
        diff = stripDiffHeaders(stagedDiff) || '';
      }
    }

    res.json({ diff });
  } catch (error) {
    console.error('Git diff error:', error);
    res.json({ error: error.message });
  }
});

// Get file content with diff information for CodeEditor
router.get('/file-with-diff', async (req, res) => {
  const { project, file, staged } = req.query;

  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  const isStaged = staged === 'true';

  try {
    const projectPath = await getActualProjectPath(project);

    // Validate git repository
    await validateGitRepository(projectPath);

    // Check file status
    const { stdout: statusOutput } = await execAsync(`git status --porcelain "${file}"`, { cwd: projectPath });
    const isUntracked = statusOutput.startsWith('??');
    const isDeleted = statusOutput.trim().startsWith('D ') || statusOutput.trim().startsWith(' D');

    let currentContent = '';
    let oldContent = '';

    if (isDeleted) {
      // For deleted files, get content from HEAD
      const { stdout: headContent } = await execAsync(`git show HEAD:"${file}"`, { cwd: projectPath });
      oldContent = headContent;
      currentContent = headContent; // Show the deleted content in editor
    } else {
      // Get current file content
      const filePath = path.join(projectPath, file);
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        // Cannot show content for directories
        return res.status(400).json({ error: 'Cannot show diff for directories' });
      }

      currentContent = await fs.readFile(filePath, 'utf-8');

      if (!isUntracked) {
        // For tracked files, get the appropriate old content based on whether it's staged
        try {
          if (isStaged) {
            // For staged files: show INDEX vs HEAD
            // oldContent = HEAD version
            const { stdout: headContent } = await execAsync(`git show HEAD:"${file}"`, { cwd: projectPath });
            oldContent = headContent;
            // currentContent = INDEX version (staged content)
            try {
              const { stdout: indexContent } = await execAsync(`git show :${file}`, { cwd: projectPath });
              currentContent = indexContent;
            } catch (error) {
              // File might be newly added to index (no HEAD version)
              // In this case, keep currentContent as working directory version
            }
          } else {
            // For unstaged files: show WORKING DIRECTORY vs INDEX
            // oldContent = INDEX version (staged content, or HEAD if nothing staged)
            try {
              const { stdout: indexContent } = await execAsync(`git show :${file}`, { cwd: projectPath });
              oldContent = indexContent;
            } catch (error) {
              // File might not be in index, fall back to HEAD
              try {
                const { stdout: headContent } = await execAsync(`git show HEAD:"${file}"`, { cwd: projectPath });
                oldContent = headContent;
              } catch (headError) {
                // File might be newly added (not in HEAD or index)
                oldContent = '';
              }
            }
            // currentContent = already set to working directory version above
          }
        } catch (error) {
          // File might be newly added to git (staged but not committed)
          oldContent = '';
        }
      }
    }

    res.json({
      currentContent,
      oldContent,
      isDeleted,
      isUntracked
    });
  } catch (error) {
    console.error('Git file-with-diff error:', error);
    res.json({ error: error.message });
  }
});

// Create initial commit
router.post('/initial-commit', async (req, res) => {
  const { project } = req.body;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);

    // Validate git repository
    await validateGitRepository(projectPath);

    // Check if there are already commits
    try {
      await execAsync('git rev-parse HEAD', { cwd: projectPath });
      return res.status(400).json({ error: 'Repository already has commits. Use regular commit instead.' });
    } catch (error) {
      // No HEAD - this is good, we can create initial commit
    }

    // Add all files
    await execAsync('git add .', { cwd: projectPath });

    // Create initial commit
    const { stdout } = await execAsync('git commit -m "Initial commit"', { cwd: projectPath });

    res.json({ success: true, output: stdout, message: 'Initial commit created successfully' });
  } catch (error) {
    console.error('Git initial commit error:', error);

    // Handle the case where there's nothing to commit
    if (error.message.includes('nothing to commit')) {
      return res.status(400).json({
        error: 'Nothing to commit',
        details: 'No files found in the repository. Add some files first.'
      });
    }

    res.status(500).json({ error: error.message });
  }
});

// Stage files (git add)
router.post('/stage', async (req, res) => {
  const { project, files } = req.body;
  
  if (!project || !files || files.length === 0) {
    return res.status(400).json({ error: 'Project name and files are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    // Stage selected files
    for (const file of files) {
      await execAsync(`git add "${file}"`, { cwd: projectPath });
    }
    
    res.json({ success: true, message: `Staged ${files.length} file(s)` });
  } catch (error) {
    console.error('Git stage error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Unstage files (git reset HEAD)
router.post('/unstage', async (req, res) => {
  const { project, files } = req.body;
  
  if (!project || !files || files.length === 0) {
    return res.status(400).json({ error: 'Project name and files are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    // Unstage selected files
    for (const file of files) {
      await execAsync(`git reset HEAD "${file}"`, { cwd: projectPath });
    }
    
    res.json({ success: true, message: `Unstaged ${files.length} file(s)` });
  } catch (error) {
    console.error('Git unstage error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stage all files
router.post('/stage-all', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    await execAsync('git add -A', { cwd: projectPath });
    
    res.json({ success: true, message: 'All files staged' });
  } catch (error) {
    console.error('Git stage all error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Unstage all files
router.post('/unstage-all', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    
    await execAsync('git reset HEAD', { cwd: projectPath });
    
    res.json({ success: true, message: 'All files unstaged' });
  } catch (error) {
    console.error('Git unstage all error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Commit changes
router.post('/commit', async (req, res) => {
  const { project, message } = req.body;
  
  if (!project || !message) {
    return res.status(400).json({ error: 'Project name and commit message are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Check if there are staged changes
    const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: projectPath });
    let hasStagedChanges = false;
    
    statusOutput.split('\n').forEach(line => {
      if (!line.trim()) return;
      
      const indexStatus = line[0];  // First char: staged status
      
      // Check if index has changes (M, A, D, R, etc., but not space or ?)
      if (indexStatus !== ' ' && indexStatus !== '?') {
        hasStagedChanges = true;
      }
    });
    
    // If no staged changes, return error
    if (!hasStagedChanges) {
      return res.status(400).json({ 
        error: 'Nothing to commit',
        details: 'No files are staged for commit. Please stage files first using "git add".'
      });
    }
    
    // Commit staged changes
    const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: projectPath });
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git commit error:', error);
    
    // Handle common commit errors
    if (error.message.includes('nothing to commit')) {
      return res.status(400).json({ 
        error: 'Nothing to commit',
        details: 'No files are staged for commit. Please stage files first using "git add".'
      });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Get list of branches
router.get('/branches', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Get all branches
    const { stdout } = await execAsync('git branch -a', { cwd: projectPath });
    
    // Parse branches
    const branches = stdout
      .split('\n')
      .map(branch => branch.trim())
      .filter(branch => branch && !branch.includes('->')) // Remove empty lines and HEAD pointer
      .map(branch => {
        // Remove asterisk from current branch
        if (branch.startsWith('* ')) {
          return branch.substring(2);
        }
        // Remove remotes/ prefix
        if (branch.startsWith('remotes/origin/')) {
          return branch.substring(15);
        }
        return branch;
      })
      .filter((branch, index, self) => self.indexOf(branch) === index); // Remove duplicates
    
    res.json({ branches });
  } catch (error) {
    console.error('Git branches error:', error);
    res.json({ error: error.message });
  }
});

// Checkout branch
router.post('/checkout', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Checkout the branch
    const { stdout } = await execAsync(`git checkout "${branch}"`, { cwd: projectPath });
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new branch
router.post('/create-branch', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch name are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Create and checkout new branch
    const { stdout } = await execAsync(`git checkout -b "${branch}"`, { cwd: projectPath });
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git create branch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get recent commits
router.get('/commits', async (req, res) => {
  const { project, limit = 10 } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Get commit log with stats
    const { stdout } = await execAsync(
      `git log --pretty=format:'%H|%an|%ae|%ad|%s' --date=relative -n ${limit}`,
      { cwd: projectPath }
    );
    
    const commits = stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [hash, author, email, date, ...messageParts] = line.split('|');
        return {
          hash,
          author,
          email,
          date,
          message: messageParts.join('|')
        };
      });
    
    // Get stats for each commit
    for (const commit of commits) {
      try {
        const { stdout: stats } = await execAsync(
          `git show --stat --format='' ${commit.hash}`,
          { cwd: projectPath }
        );
        commit.stats = stats.trim().split('\n').pop(); // Get the summary line
      } catch (error) {
        commit.stats = '';
      }
    }
    
    res.json({ commits });
  } catch (error) {
    console.error('Git commits error:', error);
    res.json({ error: error.message });
  }
});

// Get diff for a specific commit
router.get('/commit-diff', async (req, res) => {
  const { project, commit } = req.query;
  
  if (!project || !commit) {
    return res.status(400).json({ error: 'Project name and commit hash are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Get file list with stats for the commit using --numstat
    const { stdout: numstatOutput } = await execAsync(
      `git show --numstat --format='' ${commit}`,
      { cwd: projectPath }
    );
    
    // Parse numstat output: additions deletions filename
    const files = numstatOutput
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
          const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
          const filename = parts.slice(2).join('\t'); // Handle filenames with tabs
          
          // Determine status based on additions/deletions
          let status = 'M'; // Modified by default
          if (additions > 0 && deletions === 0) {
            // Check if it's a new file
            status = 'A';
          } else if (additions === 0 && deletions > 0) {
            // Could be deleted, but numstat doesn't distinguish well
            status = 'M';
          }
          
          return {
            filename,
            additions,
            deletions,
            status
          };
        }
        return null;
      })
      .filter(Boolean);
    
    // Get more accurate status using --name-status
    try {
      const { stdout: nameStatusOutput } = await execAsync(
        `git show --name-status --format='' ${commit}`,
        { cwd: projectPath }
      );
      
      const statusMap = {};
      nameStatusOutput
        .trim()
        .split('\n')
        .filter(line => line.trim())
        .forEach(line => {
          const match = line.match(/^([AMDRC])\d*\t(.+)$/);
          if (match) {
            statusMap[match[2]] = match[1];
          }
        });
      
      // Update file statuses
      files.forEach(file => {
        if (statusMap[file.filename]) {
          file.status = statusMap[file.filename];
        }
      });
    } catch (error) {
      // Ignore status fetch error, keep default statuses
    }
    
    res.json({ files });
  } catch (error) {
    console.error('Git commit diff error:', error);
    res.json({ error: error.message });
  }
});

// Get diff for a specific file in a specific commit
router.get('/commit-file-diff', async (req, res) => {
  const { project, commit, file, withContent } = req.query;
  
  if (!project || !commit || !file) {
    return res.status(400).json({ error: 'Project, commit hash, and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    if (withContent === 'true') {
      // Return old and new content for full-screen diff view
      let oldContent = '';
      let newContent = '';
      
      // Get the file content BEFORE this commit (parent commit)
      try {
        const { stdout } = await execAsync(
          `git show ${commit}^:"${file}"`,
          { cwd: projectPath }
        );
        oldContent = stdout;
      } catch (error) {
        // File didn't exist before this commit (new file)
        oldContent = '';
      }
      
      // Get the file content AT this commit
      try {
        const { stdout } = await execAsync(
          `git show ${commit}:"${file}"`,
          { cwd: projectPath }
        );
        newContent = stdout;
      } catch (error) {
        // File was deleted in this commit
        newContent = '';
      }
      
      res.json({ oldContent, newContent });
    } else {
      // Return diff string for inline diff view
      const { stdout } = await execAsync(
        `git show ${commit} -- "${file}"`,
        { cwd: projectPath }
      );
      
      // Strip the commit header info, keep only the diff part
      const diffStart = stdout.indexOf('diff --git');
      const diff = diffStart >= 0 ? stripDiffHeaders(stdout.substring(diffStart)) : stdout;
      
      res.json({ diff });
    }
  } catch (error) {
    console.error('Git commit file diff error:', error);
    res.json({ error: error.message });
  }
});

// Generate commit message based on staged changes using AI
router.post('/generate-commit-message', async (req, res) => {
  const { project, provider = 'claude' } = req.body;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  // Validate provider
  if (!['claude', 'cursor', 'codebuddy'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be "claude", "cursor" or "codebuddy"' });
  }

  try {
    const projectPath = await getActualProjectPath(project);

    // Get list of staged files from git status
    const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: projectPath });
    const stagedFiles = [];
    
    statusOutput.split('\n').forEach(line => {
      if (!line.trim()) return;
      
      const indexStatus = line[0];  // First char: staged status
      const file = line.substring(3);
      
      // Only files with changes in the index (staged) 
      if (indexStatus !== ' ' && indexStatus !== '?') {
        stagedFiles.push(file);
      }
    });

    if (stagedFiles.length === 0) {
      return res.status(400).json({ 
        error: 'No staged files',
        details: 'Please stage files before generating commit message.' 
      });
    }

    // Get diff for staged files (use --cached to get staged changes)
    let diffContext = '';
    try {
      const { stdout } = await execAsync('git diff --cached', { cwd: projectPath });
      if (stdout) {
        diffContext = stdout;
      }
    } catch (error) {
      console.error('Error getting staged diff:', error);
    }

    // If no diff found (might be new repository or only new files), get file contents
    if (!diffContext.trim()) {
      for (const file of stagedFiles) {
        try {
          const filePath = path.join(projectPath, file);
          const stats = await fs.stat(filePath);

          if (!stats.isDirectory()) {
            const content = await fs.readFile(filePath, 'utf-8');
            diffContext += `\n--- ${file} (new file) ---\n${content.substring(0, 1000)}\n`;
          } else {
            diffContext += `\n--- ${file} (new directory) ---\n`;
          }
        } catch (error) {
          console.error(`Error reading file ${file}:`, error);
        }
      }
    }

    if (!diffContext.trim()) {
      return res.status(400).json({ 
        error: 'No changes to analyze',
        details: 'Could not retrieve diff for staged files.' 
      });
    }

    // Generate commit message using AI
    const message = await generateCommitMessageWithAI(stagedFiles, diffContext, provider, projectPath);

    res.json({ message });
  } catch (error) {
    console.error('Generate commit message error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generates a commit message using AI (Claude SDK or Cursor CLI)
 * @param {Array<string>} files - List of changed files
 * @param {string} diffContext - Git diff content
 * @param {string} provider - 'claude' or 'cursor'
 * @param {string} projectPath - Project directory path
 * @returns {Promise<string>} Generated commit message
 */
async function generateCommitMessageWithAI(files, diffContext, provider, projectPath) {
  // Limit diff size but be more generous (30 files might need more context)
  const maxDiffSize = 4000; 
  const truncatedDiff = diffContext.length > maxDiffSize 
    ? diffContext.substring(0, maxDiffSize) + '\n\n... (diff truncated for brevity) ...'
    : diffContext;

  // Create the prompt - explicitly forbid tool usage
  const prompt = `你是一个 Git 提交信息生成器。请根据以下变更直接生成一个简短的提交信息。

**严格要求**：
- 格式：type(scope): 简短描述
- 类型(type)使用英文：feat, fix, docs, style, refactor, perf, test, build, ci, chore
- 描述使用中文，最多 50 个字，越简洁越好
- **只返回一行提交信息，不要换行、不要 markdown、不要解释**
- **禁止使用任何工具（Read/Bash/Edit等）**
- **禁止读取文件或执行命令**
- **直接根据下面提供的信息生成结果**

变更的文件：
${files.map(f => `- ${f}`).join('\n')}

变更内容（已提供完整信息，无需再查看文件）：
${truncatedDiff}

请直接生成提交信息（只返回一行）：`;

  let capturedSessionId = null;

  try {
    let responseText = '';

    // For Claude and Cursor, create a writer that collects responses
    const writer = {
      send: (data) => {
        try {
          const parsed = typeof data === 'string' ? JSON.parse(data) : data;

          // Capture session-id
          if (parsed.type === 'session-created' && parsed.sessionId) {
            capturedSessionId = parsed.sessionId;
          }

          // Claude SDK: {type: 'session-response', data: {message: {content: [...]}}}
          if (parsed.type === 'session-response' && parsed.data) {
            const message = parsed.data.message || parsed.data;
            if (message.content && Array.isArray(message.content)) {
              for (const item of message.content) {
                if (item.type === 'text' && item.text) {
                  responseText += item.text;
                }
              }
            }
          }
          // Cursor CLI: {type: 'cursor-output', output: '...'}
          else if (parsed.type === 'cursor-output' && parsed.output) {
            responseText += parsed.output;
          }
        } catch (e) {
          console.error('Error parsing writer data:', e);
        }
      },
      setSessionId: (sessionId) => {
        capturedSessionId = sessionId;
      }
    };

    // Call the appropriate agent
    if (provider === 'claude') {
      await queryClaudeSDK(prompt, {
        cwd: projectPath,
        permissionMode: 'bypassPermissions',
        model: 'sonnet'
      }, writer);
    } else if (provider === 'cursor') {
      await spawnCursor(prompt, {
        cwd: projectPath,
        skipPermissions: true
      }, writer);
    } else if (provider === 'codebuddy') {
      // Use official SDK for faster, non-interactive query
      const q = query({
        prompt: prompt,
        options: {
          cwd: "",
          permissionMode: 'bypassPermissions',  // Skip all permissions for speed
          model: 'claude-haiku-4.5',     // Fixed fast model
          settingSources: [],                   // Don't load any config files
          mcpServers: {},                       // Disable MCP servers
          hooks: {},                            // Disable hooks
          allowedTools: []  // Disable ALL tools - force text-only response
        }
      });

      // Stream results and extract text
      for await (const message of q) {
        if (message.type === 'assistant' && message.message?.content) {
          for (const item of message.message.content) {
            if (item.type === 'text' && item.text) {
              responseText += item.text;
            }
          }
        } 
        // Also try to extract from content_block_delta (streaming format)
        else if (message.type === 'content_block_delta' && message.delta?.text) {
          responseText += message.delta.text;
        }
        // Handle result message
        else if (message.type === 'result') {
          // CodeBuddy SDK puts the final result in the result field
          if (message.result && typeof message.result === 'string') {
            responseText = message.result;
          }
          
          // If we have response text, use it even if there was an error
          if (message.subtype !== 'success' && !responseText) {
            throw new Error(`CodeBuddy failed: ${message.error || message.subtype || 'No response generated'}`);
          }
          break;
        }
      }
    }

    // Clean up the session from database (if created)
    if (capturedSessionId) {
      try {
        deleteSessionBySessionId(capturedSessionId);
      } catch (cleanupError) {
        console.error('Failed to delete temporary session:', cleanupError);
      }
    }

    // Clean up the response
    const cleanedMessage = cleanCommitMessage(responseText);

    if (!cleanedMessage || cleanedMessage.trim().length === 0) {
      return `chore: update ${files.length} file${files.length !== 1 ? 's' : ''}`;
    }

    return cleanedMessage;
  } catch (error) {
    console.error('Error generating commit message with AI:', error);
    
    // Clean up session even on error
    if (capturedSessionId) {
      try {
        deleteSessionBySessionId(capturedSessionId);
      } catch (cleanupError) {
        console.error('Failed to delete temporary session on error:', cleanupError);
      }
    }
    
    // Fallback to simple message
    return `chore: update ${files.length} file${files.length !== 1 ? 's' : ''}`;
  }
}

/**
 * Cleans the AI-generated commit message by removing markdown, code blocks, and extra formatting
 * @param {string} text - Raw AI response
 * @returns {string} Clean commit message
 */
function cleanCommitMessage(text) {
  if (!text || !text.trim()) {
    return '';
  }

  let cleaned = text.trim();

  // Remove markdown code blocks
  cleaned = cleaned.replace(/```[a-z]*\n/g, '');
  cleaned = cleaned.replace(/```/g, '');

  // Remove markdown headers
  cleaned = cleaned.replace(/^#+\s*/gm, '');

  // Remove leading/trailing quotes
  cleaned = cleaned.replace(/^["']|["']$/g, '');

  // If there are multiple lines, take everything (subject + body)
  // Just clean up extra blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Remove any explanatory text before the actual commit message
  // Look for conventional commit pattern and start from there
  const conventionalCommitMatch = cleaned.match(/(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+?\))?:.+/s);
  if (conventionalCommitMatch) {
    cleaned = cleaned.substring(cleaned.indexOf(conventionalCommitMatch[0]));
  }

  return cleaned.trim();
}

// Get remote status (ahead/behind commits with smart remote detection)
router.get('/remote-status', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get current branch
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const branch = currentBranch.trim();

    // Check if there's a remote tracking branch (smart detection)
    let trackingBranch;
    let remoteName;
    try {
      const { stdout } = await execAsync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd: projectPath });
      trackingBranch = stdout.trim();
      remoteName = trackingBranch.split('/')[0]; // Extract remote name (e.g., "origin/main" -> "origin")
    } catch (error) {
      // No upstream branch configured - but check if we have remotes
      let hasRemote = false;
      let remoteName = null;
      try {
        const { stdout } = await execAsync('git remote', { cwd: projectPath });
        const remotes = stdout.trim().split('\n').filter(r => r.trim());
        if (remotes.length > 0) {
          hasRemote = true;
          remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
        }
      } catch (remoteError) {
        // No remotes configured
      }
      
      return res.json({ 
        hasRemote,
        hasUpstream: false,
        branch,
        remoteName,
        message: 'No remote tracking branch configured'
      });
    }

    // Get ahead/behind counts
    const { stdout: countOutput } = await execAsync(
      `git rev-list --count --left-right ${trackingBranch}...HEAD`,
      { cwd: projectPath }
    );
    
    const [behind, ahead] = countOutput.trim().split('\t').map(Number);

    res.json({
      hasRemote: true,
      hasUpstream: true,
      branch,
      remoteBranch: trackingBranch,
      remoteName,
      ahead: ahead || 0,
      behind: behind || 0,
      isUpToDate: ahead === 0 && behind === 0
    });
  } catch (error) {
    console.error('Git remote status error:', error);
    res.json({ error: error.message });
  }
});

// Fetch from remote (using smart remote detection)
router.post('/fetch', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const branch = currentBranch.trim();

    let remoteName = 'origin'; // fallback
    try {
      const { stdout } = await execAsync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd: projectPath });
      remoteName = stdout.trim().split('/')[0]; // Extract remote name
    } catch (error) {
      // No upstream, try to fetch from origin anyway
      console.log('No upstream configured, using origin as fallback');
    }

    let stdout;
    try {
      const result = await execAsync(`git fetch ${remoteName}`, { cwd: projectPath });
      stdout = result.stdout;
    } catch (fetchError) {
      // Check if it's a ref lock error (e.g., after remote force push)
      if (fetchError.stderr && fetchError.stderr.includes('unable to update local ref')) {
        console.log('Ref lock error detected, pruning stale refs and retrying...');
        // Prune stale remote-tracking refs and retry
        await execAsync(`git remote prune ${remoteName}`, { cwd: projectPath });
        const result = await execAsync(`git fetch ${remoteName}`, { cwd: projectPath });
        stdout = result.stdout;
      } else {
        throw fetchError;
      }
    }
    
    res.json({ success: true, output: stdout || 'Fetch completed successfully', remoteName });
  } catch (error) {
    console.error('Git fetch error:', error);
    res.status(500).json({ 
      error: 'Fetch failed', 
      details: error.message.includes('Could not resolve hostname') 
        ? 'Unable to connect to remote repository. Check your internet connection.'
        : error.message.includes('fatal: \'origin\' does not appear to be a git repository')
        ? 'No remote repository configured. Add a remote with: git remote add origin <url>'
        : error.stderr || error.message
    });
  }
});

// Pull from remote (fetch + merge using smart remote detection)
router.post('/pull', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const branch = currentBranch.trim();

    let remoteName = 'origin'; // fallback
    let remoteBranch = branch; // fallback
    try {
      const { stdout } = await execAsync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd: projectPath });
      const tracking = stdout.trim();
      remoteName = tracking.split('/')[0]; // Extract remote name
      remoteBranch = tracking.split('/').slice(1).join('/'); // Extract branch name
    } catch (error) {
      // No upstream, use fallback
      console.log('No upstream configured, using origin/branch as fallback');
    }

    const { stdout } = await execAsync(`git pull ${remoteName} ${remoteBranch}`, { cwd: projectPath });
    
    res.json({ 
      success: true, 
      output: stdout || 'Pull completed successfully', 
      remoteName,
      remoteBranch
    });
  } catch (error) {
    console.error('Git pull error:', error);
    
    // Enhanced error handling for common pull scenarios
    let errorMessage = 'Pull failed';
    let details = error.message;
    
    if (error.message.includes('CONFLICT')) {
      errorMessage = 'Merge conflicts detected';
      details = 'Pull created merge conflicts. Please resolve conflicts manually in the editor, then commit the changes.';
    } else if (error.message.includes('Please commit your changes or stash them')) {
      errorMessage = 'Uncommitted changes detected';  
      details = 'Please commit or stash your local changes before pulling.';
    } else if (error.message.includes('Could not resolve hostname')) {
      errorMessage = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (error.message.includes('fatal: \'origin\' does not appear to be a git repository')) {
      errorMessage = 'Remote not configured';
      details = 'No remote repository configured. Add a remote with: git remote add origin <url>';
    } else if (error.message.includes('diverged')) {
      errorMessage = 'Branches have diverged';
      details = 'Your local branch and remote branch have diverged. Consider fetching first to review changes.';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

// Push commits to remote repository
router.post('/push', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const branch = currentBranch.trim();

    let remoteName = 'origin'; // fallback
    let remoteBranch = branch; // fallback
    try {
      const { stdout } = await execAsync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd: projectPath });
      const tracking = stdout.trim();
      remoteName = tracking.split('/')[0]; // Extract remote name
      remoteBranch = tracking.split('/').slice(1).join('/'); // Extract branch name
    } catch (error) {
      // No upstream, use fallback
      console.log('No upstream configured, using origin/branch as fallback');
    }

    const { stdout } = await execAsync(`git push ${remoteName} ${remoteBranch}`, { cwd: projectPath });
    
    res.json({ 
      success: true, 
      output: stdout || 'Push completed successfully', 
      remoteName,
      remoteBranch
    });
  } catch (error) {
    console.error('Git push error:', error);
    
    // Enhanced error handling for common push scenarios
    let errorMessage = 'Push failed';
    let details = error.message;
    
    if (error.message.includes('rejected')) {
      errorMessage = 'Push rejected';
      details = 'The remote has newer commits. Pull first to merge changes before pushing.';
    } else if (error.message.includes('non-fast-forward')) {
      errorMessage = 'Non-fast-forward push';
      details = 'Your branch is behind the remote. Pull the latest changes first.';
    } else if (error.message.includes('Could not resolve hostname')) {
      errorMessage = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (error.message.includes('fatal: \'origin\' does not appear to be a git repository')) {
      errorMessage = 'Remote not configured';
      details = 'No remote repository configured. Add a remote with: git remote add origin <url>';
    } else if (error.message.includes('Permission denied')) {
      errorMessage = 'Authentication failed';
      details = 'Permission denied. Check your credentials or SSH keys.';
    } else if (error.message.includes('no upstream branch')) {
      errorMessage = 'No upstream branch';
      details = 'No upstream branch configured. Use: git push --set-upstream origin <branch>';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

// Publish branch to remote (set upstream and push)
router.post('/publish', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get current branch to verify it matches the requested branch
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const currentBranchName = currentBranch.trim();
    
    if (currentBranchName !== branch) {
      return res.status(400).json({ 
        error: `Branch mismatch. Current branch is ${currentBranchName}, but trying to publish ${branch}` 
      });
    }

    // Check if remote exists
    let remoteName = 'origin';
    try {
      const { stdout } = await execAsync('git remote', { cwd: projectPath });
      const remotes = stdout.trim().split('\n').filter(r => r.trim());
      if (remotes.length === 0) {
        return res.status(400).json({ 
          error: 'No remote repository configured. Add a remote with: git remote add origin <url>' 
        });
      }
      remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
    } catch (error) {
      return res.status(400).json({ 
        error: 'No remote repository configured. Add a remote with: git remote add origin <url>' 
      });
    }

    // Publish the branch (set upstream and push)
    const { stdout } = await execAsync(`git push --set-upstream ${remoteName} ${branch}`, { cwd: projectPath });
    
    res.json({ 
      success: true, 
      output: stdout || 'Branch published successfully', 
      remoteName,
      branch
    });
  } catch (error) {
    console.error('Git publish error:', error);
    
    // Enhanced error handling for common publish scenarios
    let errorMessage = 'Publish failed';
    let details = error.message;
    
    if (error.message.includes('rejected')) {
      errorMessage = 'Publish rejected';
      details = 'The remote branch already exists and has different commits. Use push instead.';
    } else if (error.message.includes('Could not resolve hostname')) {
      errorMessage = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (error.message.includes('Permission denied')) {
      errorMessage = 'Authentication failed';
      details = 'Permission denied. Check your credentials or SSH keys.';
    } else if (error.message.includes('fatal:') && error.message.includes('does not appear to be a git repository')) {
      errorMessage = 'Remote not configured';
      details = 'Remote repository not properly configured. Check your remote URL.';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

// Discard changes for a specific file or multiple files
router.post('/discard', async (req, res) => {
  const { project, file, files } = req.body;
  
  // Support both single file and multiple files
  const fileList = files || (file ? [file] : []);
  
  if (!project || fileList.length === 0) {
    return res.status(400).json({ error: 'Project name and file path(s) are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    const results = [];
    const errors = [];

    for (const filePath of fileList) {
      try {
        // Check file status to determine correct discard command
        const { stdout: statusOutput } = await execAsync(`git status --porcelain "${filePath}"`, { cwd: projectPath });
        
        if (!statusOutput.trim()) {
          errors.push({ file: filePath, error: 'No changes to discard' });
          continue;
        }

        const status = statusOutput.substring(0, 2);

        if (status === '??') {
          // Untracked file or directory - delete it
          const fullPath = path.join(projectPath, filePath);
          const stats = await fs.stat(fullPath);

          if (stats.isDirectory()) {
            await fs.rm(fullPath, { recursive: true, force: true });
          } else {
            await fs.unlink(fullPath);
          }
        } else if (status.includes('M') || status.includes('D')) {
          // Modified or deleted file - restore from HEAD
          await execAsync(`git restore "${filePath}"`, { cwd: projectPath });
        } else if (status.includes('A')) {
          // Added file - unstage it
          await execAsync(`git reset HEAD "${filePath}"`, { cwd: projectPath });
        }
        
        results.push(filePath);
      } catch (fileError) {
        errors.push({ file: filePath, error: fileError.message });
      }
    }

    if (errors.length > 0 && results.length === 0) {
      res.status(400).json({ error: 'Failed to discard changes', details: errors });
    } else {
      res.json({ 
        success: true, 
        message: `Changes discarded for ${results.length} file(s)`,
        discarded: results,
        errors: errors.length > 0 ? errors : undefined
      });
    }
  } catch (error) {
    console.error('Git discard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete untracked file or multiple files
router.post('/delete-untracked', async (req, res) => {
  const { project, file, files } = req.body;
  
  // Support both single file and multiple files
  const fileList = files || (file ? [file] : []);
  
  if (!project || fileList.length === 0) {
    return res.status(400).json({ error: 'Project name and file path(s) are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    const results = [];
    const errors = [];

    for (const filePath of fileList) {
      try {
        // Check if file is actually untracked
        const { stdout: statusOutput } = await execAsync(`git status --porcelain "${filePath}"`, { cwd: projectPath });
        
        if (!statusOutput.trim()) {
          errors.push({ file: filePath, error: 'File is not untracked or does not exist' });
          continue;
        }

        const status = statusOutput.substring(0, 2);
        
        if (status !== '??') {
          errors.push({ file: filePath, error: 'File is not untracked' });
          continue;
        }

        // Delete the untracked file or directory
        const fullPath = path.join(projectPath, filePath);
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory()) {
          await fs.rm(fullPath, { recursive: true, force: true });
        } else {
          await fs.unlink(fullPath);
        }
        
        results.push(filePath);
      } catch (fileError) {
        errors.push({ file: filePath, error: fileError.message });
      }
    }

    if (errors.length > 0 && results.length === 0) {
      res.status(400).json({ error: 'Failed to delete untracked files', details: errors });
    } else {
      res.json({ 
        success: true, 
        message: `Deleted ${results.length} untracked file(s)`,
        deleted: results,
        errors: errors.length > 0 ? errors : undefined
      });
    }
  } catch (error) {
    console.error('Git delete untracked error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ Git Stash APIs ============

// Get stash list
router.get('/stash/list', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get stash list with details
    const { stdout } = await execAsync('git stash list --format="%gd|%gs|%ci"', { cwd: projectPath });
    
    if (!stdout.trim()) {
      return res.json({ stashes: [] });
    }

    const stashes = stdout.trim().split('\n').map(line => {
      const [ref, message, date] = line.split('|');
      return {
        ref: ref.trim(),
        message: message.trim(),
        date: date.trim(),
        index: parseInt(ref.match(/stash@\{(\d+)\}/)?.[1] || '0')
      };
    });

    res.json({ stashes });
  } catch (error) {
    console.error('Git stash list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new stash
router.post('/stash/push', async (req, res) => {
  const { project, message, includeUntracked } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Build stash command
    let cmd = 'git stash push';
    if (includeUntracked) {
      cmd += ' --include-untracked';
    }
    if (message) {
      cmd += ` -m "${message.replace(/"/g, '\\"')}"`;
    }

    const { stdout, stderr } = await execAsync(cmd, { cwd: projectPath });
    
    // Check if anything was stashed
    if (stdout.includes('No local changes to save') || stderr.includes('No local changes to save')) {
      return res.status(400).json({ error: 'No local changes to stash' });
    }

    res.json({ 
      success: true, 
      message: stdout.trim() || 'Changes stashed successfully'
    });
  } catch (error) {
    console.error('Git stash push error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Apply a stash (keep stash in list)
router.post('/stash/apply', async (req, res) => {
  const { project, index } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    const stashRef = index !== undefined ? `stash@{${index}}` : 'stash@{0}';
    const { stdout } = await execAsync(`git stash apply ${stashRef}`, { cwd: projectPath });

    res.json({ 
      success: true, 
      message: stdout.trim() || 'Stash applied successfully'
    });
  } catch (error) {
    console.error('Git stash apply error:', error);
    
    let errorMessage = error.message;
    if (error.message.includes('CONFLICT')) {
      errorMessage = 'Stash applied with conflicts. Please resolve conflicts manually.';
    } else if (error.message.includes('No stash entries found')) {
      errorMessage = 'No stash entries found';
    }
    
    res.status(500).json({ error: errorMessage });
  }
});

// Pop a stash (apply and remove from list)
router.post('/stash/pop', async (req, res) => {
  const { project, index } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    const stashRef = index !== undefined ? `stash@{${index}}` : 'stash@{0}';
    const { stdout } = await execAsync(`git stash pop ${stashRef}`, { cwd: projectPath });

    res.json({ 
      success: true, 
      message: stdout.trim() || 'Stash popped successfully'
    });
  } catch (error) {
    console.error('Git stash pop error:', error);
    
    let errorMessage = error.message;
    if (error.message.includes('CONFLICT')) {
      errorMessage = 'Stash popped with conflicts. Please resolve conflicts manually. Stash was not removed.';
    } else if (error.message.includes('No stash entries found')) {
      errorMessage = 'No stash entries found';
    }
    
    res.status(500).json({ error: errorMessage });
  }
});

// Drop a stash
router.post('/stash/drop', async (req, res) => {
  const { project, index } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    const stashRef = index !== undefined ? `stash@{${index}}` : 'stash@{0}';
    const { stdout } = await execAsync(`git stash drop ${stashRef}`, { cwd: projectPath });

    res.json({ 
      success: true, 
      message: stdout.trim() || 'Stash dropped successfully'
    });
  } catch (error) {
    console.error('Git stash drop error:', error);
    
    let errorMessage = error.message;
    if (error.message.includes('No stash entries found')) {
      errorMessage = 'No stash entries found';
    }
    
    res.status(500).json({ error: errorMessage });
  }
});

// Clear all stashes
router.post('/stash/clear', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    await execAsync('git stash clear', { cwd: projectPath });

    res.json({ 
      success: true, 
      message: 'All stashes cleared'
    });
  } catch (error) {
    console.error('Git stash clear error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Show stash diff
router.get('/stash/show', async (req, res) => {
  const { project, index } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    const stashRef = index !== undefined ? `stash@{${index}}` : 'stash@{0}';
    
    // Get file list with stats using --numstat
    const { stdout: numstatOutput } = await execAsync(
      `git stash show ${stashRef} --numstat`,
      { cwd: projectPath }
    );
    
    // Parse numstat output: additions deletions filename
    const files = numstatOutput
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
          const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
          const filename = parts.slice(2).join('\t');
          return { filename, additions, deletions, status: 'M' };
        }
        return null;
      })
      .filter(Boolean);
    
    // Get more accurate status using --name-status
    try {
      const { stdout: nameStatusOutput } = await execAsync(
        `git stash show ${stashRef} --name-status`,
        { cwd: projectPath }
      );
      
      const statusMap = {};
      nameStatusOutput
        .trim()
        .split('\n')
        .filter(line => line.trim())
        .forEach(line => {
          const match = line.match(/^([AMDRC])\d*\t(.+)$/);
          if (match) {
            statusMap[match[2]] = match[1];
          }
        });
      
      // Update file statuses
      files.forEach(file => {
        if (statusMap[file.filename]) {
          file.status = statusMap[file.filename];
        }
      });
    } catch (error) {
      // Ignore status fetch error, keep default statuses
    }

    res.json({ files });
  } catch (error) {
    console.error('Git stash show error:', error);
    
    let errorMessage = error.message;
    if (error.message.includes('No stash entries found')) {
      errorMessage = 'No stash entries found';
    }
    
    res.status(500).json({ error: errorMessage });
  }
});

// Get diff for a specific file in a stash
router.get('/stash/file-diff', async (req, res) => {
  const { project, index, file } = req.query;
  
  if (!project || !file) {
    return res.status(400).json({ error: 'Project and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    const stashRef = index !== undefined ? `stash@{${index}}` : 'stash@{0}';
    
    // Get the file content from stash (the modified version)
    let newContent = '';
    try {
      const { stdout } = await execAsync(
        `git show "${stashRef}:${file}"`,
        { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 }
      );
      newContent = stdout;
    } catch (error) {
      // File might be deleted in stash
      newContent = '';
    }
    
    // Get the file content from stash's parent commit (the original version before stash was created)
    // stash@{n}^1 is the parent commit of the stash (the HEAD when stash was created)
    let oldContent = '';
    try {
      const { stdout } = await execAsync(
        `git show "${stashRef}^1:${file}"`,
        { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 }
      );
      oldContent = stdout;
    } catch (error) {
      // File might be new in the stash
      oldContent = '';
    }

    res.json({ 
      oldContent,
      newContent
    });
  } catch (error) {
    console.error('Git stash file diff error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;